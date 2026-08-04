import { create } from 'zustand'
import { getCardPilePosition, getPileSize } from '.'
import {
  BAG_LETTERS,
  BAG_PILE,
  BINGO_BONUS,
  BOARD_SIZE,
  CENTER_SQUARE,
  getBonus,
  isSquarePile,
  LETTER_VALUES,
  pileToSquare,
  RACK_PILE,
  RACK_SIZE,
  squareToPile,
} from './constants'
import { isValidWord, loadDictionary } from './dictionary'
import {
  clearGameState,
  type MoveData,
  type SavedGameState,
  saveGameState,
  setOnDisconnect,
  setOnGameResume,
  setOnGameStart,
  setOnHostReadyToStart,
  setOnRemoteMove,
  useMultiplayerStore,
} from './multiplayerStore'
import { seededShuffle } from './seededShuffle'

type MouseParams = { clientX: number; clientY: number }

export interface GameState {
  cards: CardType[]
  activeCard: CardType | null
  cursorState: { mouseX: number; mouseY: number; pressed: boolean }
  dealPhase: -1 | 0 | 1 // -1 = idle, 0 = tiles in bag, 1 = dealing
  currentPlayerIndex: 0 | 1
  localPlayerIndex: 0 | 1 // 0 = host, 1 = guest
  scores: [number, number]
  pending: number[] // tile ids placed on the board this turn, not yet committed
  passCount: number // consecutive passes; 2 ends the game
  gameOver: boolean
  message: string | null // transient status / error text
  showInstructionsModal: boolean
}

interface GameStore extends GameState {
  newGame: () => void
  startMultiplayerGame: (seed: number, localPlayerIndex: 0 | 1) => void
  restoreMultiplayerGame: (
    state: SavedGameState,
    localPlayerIndex: 0 | 1,
  ) => void
  applyRemoteMove: (move: MoveData) => void
  onMouseDown: (params: MouseParams) => void
  onMouseUp: (params: MouseParams) => void
  onMouseMove: (params: MouseParams) => void
  submitTurn: () => void
  recallTiles: () => void
  passTurn: () => void
  openInstructions: () => void
  closeInstructions: () => void
}

let cursorDownAt = 0
let cursorDownPos = { x: 0, y: 0 }
let cursorDelta = { x: 0, y: 0 }
let dealTimeout: number | null = null

const otherPlayer = (i: 0 | 1): 0 | 1 => (i === 0 ? 1 : 0)

// ── Tile helpers ────────────────────────────────────────────────────
const tilesInPile = (pileIndex: number, cards: CardType[]) =>
  cards
    .filter((c) => c.pileIndex === pileIndex)
    .sort((a, b) => a.cardPileIndex - b.cardPileIndex)

const tileOnSquare = (pile: number, cards: CardType[]) =>
  cards.find((c) => c.pileIndex === pile)

// ── Deterministic bag ───────────────────────────────────────────────
// Both peers build the identical shuffled bag from the shared seed, so
// drawing tiles (pop from the top of the bag stack) stays in lockstep.
function generateTiles(seed: number): CardType[] {
  const letters = seededShuffle(BAG_LETTERS, seed)
  return letters.map((letter, i) => {
    const isBlank = letter === '_'
    return {
      id: i,
      // bag ordering lives in cardPileIndex; higher = drawn first (top of stack)
      pileIndex: BAG_PILE,
      cardPileIndex: i,
      letter: isBlank ? '' : letter,
      value: LETTER_VALUES[letter] ?? 0,
      isBlank,
    }
  })
}

// Draw `count` tiles from the top of the bag into the given rack, filling
// the rack up to RACK_SIZE. Mutates & returns a new cards array.
function drawToRack(
  cards: CardType[],
  playerIndex: 0 | 1,
  count: number,
): CardType[] {
  const rackPile = RACK_PILE[playerIndex]
  const bag = tilesInPile(BAG_PILE, cards).sort(
    (a, b) => b.cardPileIndex - a.cardPileIndex, // top of stack first
  )
  const rackCount = tilesInPile(rackPile, cards).length
  const toDraw = Math.min(count, RACK_SIZE - rackCount, bag.length)
  const drawn = new Set(bag.slice(0, toDraw).map((t) => t.id))
  let next = rackCount
  return cards.map((c) =>
    drawn.has(c.id)
      ? { ...c, pileIndex: rackPile, cardPileIndex: next++ }
      : c,
  )
}

function reindexRack(cards: CardType[], playerIndex: 0 | 1): CardType[] {
  const rackPile = RACK_PILE[playerIndex]
  const rack = tilesInPile(rackPile, cards)
  return cards.map((c) => {
    const idx = rack.findIndex((t) => t.id === c.id)
    return idx === -1 ? c : { ...c, cardPileIndex: idx }
  })
}

export const useGameStore = create<GameStore>((set, get) => {
  const startGame = (seed?: number, localPlayerIndex: 0 | 1 = 0) => {
    const s = seed ?? Date.now()
    let cards = generateTiles(s)
    cards = drawToRack(cards, 0, RACK_SIZE)
    cards = drawToRack(cards, 1, RACK_SIZE)
    set({
      ...initializeGameState(),
      cards,
      localPlayerIndex,
      dealPhase: 0,
    })
    if (dealTimeout) clearTimeout(dealTimeout)
    dealTimeout = setTimeout(() => {
      set({ dealPhase: 1 })
      dealTimeout = setTimeout(() => set({ dealPhase: -1 }), 800)
    }, 400)
  }

  const newGame = () => {
    const { mode, startNewGame } = useMultiplayerStore.getState()
    if (mode === 'multiplayer' && get().localPlayerIndex === 0) {
      startNewGame()
    }
  }

  const hasSeenInstructions =
    localStorage.getItem('hasSeenInstructions') === 'true'
  if (!hasSeenInstructions) {
    localStorage.setItem('hasSeenInstructions', 'true')
    setTimeout(() => set({ showInstructionsModal: true }), 1000)
  }

  // Preload the dictionary in the background.
  void loadDictionary()

  return {
    cards: [],
    ...initializeGameState(),

    newGame,
    startMultiplayerGame: (seed, localPlayerIndex) =>
      startGame(seed, localPlayerIndex),
    restoreMultiplayerGame: (saved, localPlayerIndex) => {
      if (dealTimeout) clearTimeout(dealTimeout)
      set({
        ...initializeGameState(),
        cards: saved.cards,
        localPlayerIndex,
        dealPhase: -1,
        currentPlayerIndex: saved.currentPlayerIndex,
        scores: saved.scores,
        passCount: saved.passCount,
        gameOver: saved.gameOver,
      })
    },

    applyRemoteMove: (move: MoveData) => {
      const them = otherPlayer(get().localPlayerIndex)
      if (move.type === 'commit') {
        commitPlacements(move.placements, them, get, set)
      } else if (move.type === 'pass') {
        endTurn(them, 0, true, get, set)
      }
    },

    // ── Drag & drop ───────────────────────────────────────────────
    onMouseDown: ({ clientX, clientY }: MouseParams) => {
      const state = get()
      const us = state.localPlayerIndex
      if (state.currentPlayerIndex !== us || state.gameOver) return
      const { activeCard, cards } = state

      // If a tile is already picked up, this click drops it.
      if (activeCard) {
        const targetPile = getPileAtPoint(clientX, clientY)
        placeTile(activeCard, targetPile, us, get, set)
        return
      }

      const clicked = getCardFromPoint(clientX, clientY, cards)
      if (!clicked || !isPickable(clicked, us, state.pending)) return

      set({ activeCard: clicked })
      const { x, y } = getCardPilePosition(clicked)
      cursorDelta = { x: clientX - x, y: clientY - y }
      cursorDownPos = { x: clientX, y: clientY }
      cursorDownAt = Date.now()
      set({ cursorState: { mouseX: x, mouseY: y, pressed: true } })
    },

    onMouseUp: ({ clientX, clientY }: MouseParams) => {
      const state = get()
      if (state.currentPlayerIndex !== state.localPlayerIndex) return
      const { activeCard } = state
      const posDiff =
        Math.abs(cursorDownPos.x - clientX) +
        Math.abs(cursorDownPos.y - clientY)
      const timeDiff = Date.now() - cursorDownAt

      // Treat as a drag-drop (not a click-to-select) when moved / held.
      if (activeCard && (posDiff > 5 || timeDiff > 300)) {
        const targetPile = getPileAtPoint(clientX, clientY)
        placeTile(activeCard, targetPile, state.localPlayerIndex, get, set)
      }
      cursorDownPos = { x: 0, y: 0 }
      cursorDelta = { x: 0, y: 0 }
      set({ cursorState: { ...get().cursorState, pressed: false } })
    },

    onMouseMove: ({ clientX, clientY }: MouseParams) => {
      const mouseX = clientX - cursorDelta.x
      const mouseY = clientY - cursorDelta.y
      set({ cursorState: { ...get().cursorState, mouseX, mouseY } })
    },

    // ── Turn actions ──────────────────────────────────────────────
    submitTurn: () => {
      const state = get()
      const us = state.localPlayerIndex
      if (state.currentPlayerIndex !== us || state.gameOver) return
      if (state.pending.length === 0) {
        set({ message: 'Place at least one tile.' })
        return
      }
      const result = validatePlay(state.cards, state.pending)
      if (!result.ok) {
        set({ message: result.error })
        return
      }
      const placements = state.pending.map((id) => {
        const t = state.cards.find((c) => c.id === id)!
        return { tileId: id, pile: t.pileIndex, letter: t.letter }
      })
      useMultiplayerStore
        .getState()
        .sendMove({ type: 'commit', placements })
      commitPlacements(placements, us, get, set)
    },

    recallTiles: () => {
      const state = get()
      if (state.pending.length === 0) return
      let cards = state.cards
      for (const id of state.pending) {
        cards = returnTileToRack(cards, id, state.localPlayerIndex)
      }
      cards = reindexRack(cards, state.localPlayerIndex)
      set({ cards, pending: [], activeCard: null, message: null })
    },

    passTurn: () => {
      const state = get()
      const us = state.localPlayerIndex
      if (state.currentPlayerIndex !== us || state.gameOver) return
      // recall any placed-but-uncommitted tiles first
      let cards = state.cards
      for (const id of state.pending) cards = returnTileToRack(cards, id, us)
      cards = reindexRack(cards, us)
      set({ cards, pending: [] })
      useMultiplayerStore.getState().sendMove({ type: 'pass' })
      endTurn(us, 0, true, get, set)
    },

    openInstructions: () => set({ showInstructionsModal: true }),
    closeInstructions: () => set({ showInstructionsModal: false }),
  }
})

function initializeGameState(): Omit<GameState, 'cards'> {
  return {
    activeCard: null,
    cursorState: { mouseX: 0, mouseY: 0, pressed: false },
    dealPhase: 0,
    currentPlayerIndex: 0,
    localPlayerIndex: 0,
    scores: [0, 0],
    pending: [],
    passCount: 0,
    gameOver: false,
    message: null,
    showInstructionsModal: false,
  }
}

// ── DOM point helpers ───────────────────────────────────────────────
const getCardFromPoint = (x: number, y: number, cards: CardType[]) => {
  const el = document.elementFromPoint(x, y) as HTMLDivElement | null
  return el?.dataset.id ? cards[+el.dataset.id] : undefined
}

const getPileAtPoint = (x: number, y: number): number => {
  const el = document.elementFromPoint(x, y) as HTMLDivElement | null
  if (el?.dataset.id) {
    // dropped onto another tile → resolve to that tile's pile
    return -1
  }
  return +(el?.dataset.pileindex ?? '-1')
}

// A tile is pickable if it's on the local player's rack, or it's one of the
// tiles they placed this turn (still uncommitted).
const isPickable = (
  card: CardType,
  us: 0 | 1,
  pending: number[],
): boolean => {
  if (card.pileIndex === RACK_PILE[us]) return true
  if (pending.includes(card.id)) return true
  return false
}

// ── Placement ───────────────────────────────────────────────────────
const returnTileToRack = (
  cards: CardType[],
  tileId: number,
  playerIndex: 0 | 1,
): CardType[] => {
  const rackPile = RACK_PILE[playerIndex]
  const rackCount = tilesInPile(rackPile, cards).length
  return cards.map((c) =>
    c.id === tileId
      ? {
          ...c,
          pileIndex: rackPile,
          cardPileIndex: rackCount,
          // reset a blank back to unassigned when it returns to the rack
          letter: c.isBlank ? '' : c.letter,
        }
      : c,
  )
}

// Handle a local drag-drop / click-drop of `card` onto `targetPile`.
const placeTile = (
  card: CardType,
  targetPile: number,
  playerIndex: 0 | 1,
  get: () => GameStore,
  set: (s: Partial<GameStore>) => void,
) => {
  const state = get()
  const rackPile = RACK_PILE[playerIndex]

  // Drop back onto rack → return to rack.
  if (targetPile === rackPile) {
    let cards = returnTileToRack(state.cards, card.id, playerIndex)
    cards = reindexRack(cards, playerIndex)
    set({
      cards,
      activeCard: null,
      pending: state.pending.filter((id) => id !== card.id),
      message: null,
    })
    return
  }

  // Valid drop only onto an empty board square.
  const validSquare =
    isSquarePile(targetPile) && !tileOnSquare(targetPile, state.cards)
  if (!validSquare) {
    set({ activeCard: null })
    return
  }

  // Assign a letter to a blank tile on first placement.
  let letter = card.letter
  if (card.isBlank && !letter) {
    const input = window.prompt('Blank tile — choose a letter (A–Z):')
    const chosen = (input ?? '').trim().toUpperCase().slice(0, 1)
    if (!/^[A-Z]$/.test(chosen)) {
      set({ activeCard: null })
      return
    }
    letter = chosen
  }

  const cards = state.cards.map((c) =>
    c.id === card.id
      ? { ...c, pileIndex: targetPile, cardPileIndex: 0, letter }
      : c,
  )
  const pending = state.pending.includes(card.id)
    ? state.pending
    : [...state.pending, card.id]
  set({ cards, activeCard: null, pending, message: null })
}

// ── Validation & scoring ────────────────────────────────────────────
type PlayResult = { ok: true; words: string[]; score: number } | {
  ok: false
  error: string
}

// Read a full word (across or down) that passes through the given square.
function readWord(
  cards: CardType[],
  startPile: number,
  dr: number,
  dc: number,
): { tiles: CardType[]; word: string } {
  const { row, col } = pileToSquare(startPile)
  // walk back to the start of the word
  let r = row
  let c = col
  while (true) {
    const pr = r - dr
    const pc = c - dc
    if (pr < 0 || pc < 0 || pr >= BOARD_SIZE || pc >= BOARD_SIZE) break
    if (!tileOnSquare(squareToPile(pr, pc), cards)) break
    r = pr
    c = pc
  }
  // walk forward collecting tiles
  const tiles: CardType[] = []
  while (r < BOARD_SIZE && c < BOARD_SIZE && r >= 0 && c >= 0) {
    const t = tileOnSquare(squareToPile(r, c), cards)
    if (!t) break
    tiles.push(t)
    r += dr
    c += dc
  }
  return { tiles, word: tiles.map((t) => t.letter).join('') }
}

function scoreWord(tiles: CardType[], pendingSet: Set<number>): number {
  let wordMult = 1
  let sum = 0
  for (const t of tiles) {
    let letterScore = t.value
    // bonus squares apply only to tiles placed THIS turn
    if (pendingSet.has(t.id)) {
      const bonus = getBonus(t.pileIndex)
      if (bonus === 'DL') letterScore *= 2
      else if (bonus === 'TL') letterScore *= 3
      else if (bonus === 'DW') wordMult *= 2
      else if (bonus === 'TW') wordMult *= 3
    }
    sum += letterScore
  }
  return sum * wordMult
}

function validatePlay(cards: CardType[], pending: number[]): PlayResult {
  const placed = pending
    .map((id) => cards.find((c) => c.id === id)!)
    .map((t) => ({ tile: t, ...pileToSquare(t.pileIndex) }))

  // 1. All placed tiles share a row or a column.
  const rows = new Set(placed.map((p) => p.row))
  const cols = new Set(placed.map((p) => p.col))
  const isRow = rows.size === 1
  const isCol = cols.size === 1
  if (!isRow && !isCol) {
    return { ok: false, error: 'Tiles must be in a single row or column.' }
  }

  // 2. No gaps in the placed line (existing tiles may fill gaps).
  const line = isRow
    ? placed.map((p) => p.col).sort((a, b) => a - b)
    : placed.map((p) => p.row).sort((a, b) => a - b)
  const fixed = isRow ? placed[0].row : placed[0].col
  for (let i = line[0]; i <= line[line.length - 1]; i++) {
    const pile = isRow ? squareToPile(fixed, i) : squareToPile(i, fixed)
    if (!tileOnSquare(pile, cards)) {
      return { ok: false, error: 'Placed tiles must be connected.' }
    }
  }

  // 3. First move must cover the center; later moves must touch existing tiles.
  const boardTiles = cards.filter(
    (c) => isSquarePile(c.pileIndex) && !pending.includes(c.id),
  )
  const isFirstMove = boardTiles.length === 0
  if (isFirstMove) {
    if (!placed.some((p) => p.tile.pileIndex === CENTER_SQUARE)) {
      return { ok: false, error: 'First word must cross the center square.' }
    }
  } else {
    const touches = placed.some((p) => {
      const { row, col } = p
      return [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1],
      ].some(([r, c]) => {
        if (r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) return false
        const t = tileOnSquare(squareToPile(r, c), cards)
        return t && !pending.includes(t.id)
      })
    })
    if (!touches) {
      return { ok: false, error: 'New tiles must connect to the board.' }
    }
  }

  // 4. Collect all words formed and validate them.
  const pendingSet = new Set(pending)
  const wordEntries: { tiles: CardType[]; word: string }[] = []

  // main word (along the line of play)
  const [mdr, mdc] = isRow ? [0, 1] : [1, 0]
  const main = readWord(cards, placed[0].tile.pileIndex, mdr, mdc)
  if (main.tiles.length > 1) wordEntries.push(main)

  // cross words (perpendicular) for each placed tile
  const [cdr, cdc] = isRow ? [1, 0] : [0, 1]
  for (const p of placed) {
    const cross = readWord(cards, p.tile.pileIndex, cdr, cdc)
    if (cross.tiles.length > 1) wordEntries.push(cross)
  }

  if (wordEntries.length === 0) {
    return { ok: false, error: 'A word must be at least two tiles.' }
  }

  const invalid = wordEntries.find((w) => !isValidWord(w.word))
  if (invalid) {
    return { ok: false, error: `"${invalid.word}" is not a valid word.` }
  }

  // 5. Score all words + bingo bonus.
  let score = wordEntries.reduce(
    (sum, w) => sum + scoreWord(w.tiles, pendingSet),
    0,
  )
  if (pending.length === RACK_SIZE) score += BINGO_BONUS

  return { ok: true, words: wordEntries.map((w) => w.word), score }
}

// ── Commit / turn transition ────────────────────────────────────────
export type Placement = { tileId: number; pile: number; letter: string }

function commitPlacements(
  placements: Placement[],
  playerIndex: 0 | 1,
  get: () => GameStore,
  set: (s: Partial<GameStore>) => void,
) {
  let cards = get().cards
  // Apply placements (for remote moves the tiles are still in the mover's rack).
  const ids = new Set(placements.map((p) => p.tileId))
  cards = cards.map((c) => {
    const p = placements.find((pl) => pl.tileId === c.id)
    return p ? { ...c, pileIndex: p.pile, cardPileIndex: 0, letter: p.letter } : c
  })

  const pendingIds = [...ids]
  const result = validatePlay(cards, pendingIds)
  const score = result.ok ? result.score : 0

  // Refill the mover's rack from the bag.
  cards = drawToRack(cards, playerIndex, RACK_SIZE)
  cards = reindexRack(cards, otherPlayer(playerIndex)) // keep other rack tidy

  const scores: [number, number] = [...get().scores]
  scores[playerIndex] += score
  set({ cards, scores })
  endTurn(playerIndex, score, false, get, set)
}

function endTurn(
  playerIndex: 0 | 1,
  score: number,
  wasPass: boolean,
  get: () => GameStore,
  set: (s: Partial<GameStore>) => void,
) {
  const state = get()
  const passCount = wasPass ? state.passCount + 1 : 0

  // Game ends: two consecutive passes, or the mover emptied their rack with
  // an empty bag.
  const bagEmpty = tilesInPile(BAG_PILE, state.cards).length === 0
  const moverRackEmpty =
    tilesInPile(RACK_PILE[playerIndex], state.cards).length === 0
  const gameOver = passCount >= 4 || (bagEmpty && moverRackEmpty)

  set({
    currentPlayerIndex: otherPlayer(playerIndex),
    pending: [],
    activeCard: null,
    passCount,
    gameOver,
    message: wasPass
      ? `${playerName(playerIndex, get)} passed.`
      : score > 0
        ? `${playerName(playerIndex, get)} scored ${score}.`
        : null,
  })
  if (gameOver) finalizeScores(get, set)
  const { localPlayerIndex } = get()
  if (
    !gameOver &&
    otherPlayer(playerIndex) === localPlayerIndex &&
    useMultiplayerStore.getState().mode === 'multiplayer'
  ) {
    navigator.vibrate?.(60)
  }
}

function playerName(i: 0 | 1, get: () => GameStore): string {
  return i === get().localPlayerIndex ? 'You' : 'Opponent'
}

// Subtract each player's leftover rack tiles from their score.
function finalizeScores(
  get: () => GameStore,
  set: (s: Partial<GameStore>) => void,
) {
  const { cards } = get()
  const scores: [number, number] = [...get().scores]
  for (const p of [0, 1] as const) {
    const leftover = tilesInPile(RACK_PILE[p], cards).reduce(
      (sum, t) => sum + t.value,
      0,
    )
    scores[p] -= leftover
  }
  set({ scores })
  const { recordResult } = useMultiplayerStore.getState()
  if (scores[0] !== scores[1]) recordResult(scores[0] > scores[1] ? 0 : 1)
}

// ── Multiplayer wiring ──────────────────────────────────────────────
setOnRemoteMove((move) => useGameStore.getState().applyRemoteMove(move))
setOnGameStart((seed, localPlayerIndex) =>
  useGameStore.getState().startMultiplayerGame(seed, localPlayerIndex),
)
setOnHostReadyToStart(() => useMultiplayerStore.getState().startNewGame())
setOnGameResume((state, localPlayerIndex) =>
  useGameStore.getState().restoreMultiplayerGame(state, localPlayerIndex),
)
setOnDisconnect(() =>
  useGameStore.setState({ ...initializeGameState(), cards: [] }),
)

// Persist state on the host so a refresh / reconnect can resume.
useGameStore.subscribe((state) => {
  const mp = useMultiplayerStore.getState()
  if (mp.mode !== 'multiplayer' || state.localPlayerIndex !== 0) return
  if (state.dealPhase !== -1) return
  if (state.gameOver) return clearGameState()
  saveGameState({
    cards: state.cards,
    currentPlayerIndex: state.currentPlayerIndex,
    scores: state.scores,
    passCount: state.passCount,
    gameOver: state.gameOver,
  })
})

// exported for the board UI
export { getPileSize, tileOnSquare, tilesInPile }
