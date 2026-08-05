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
  type MoveData,
  type SavedGameState,
  saveGameState,
  setGameSnapshotProvider,
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
  selectedSquare: number | null // board square tiles will play onto
  selectedDir: 'right' | 'down' // direction the selection advances after a play
  // most recent committed play: every word it formed (comma-separated),
  // the move's total score, and its newly placed tiles
  lastPlay: { word: string; score: number; tileIds: number[] } | null
  swapMode: boolean // passing: picking rack tiles to exchange with the bag
  swapIds: number[] // rack tiles marked for exchange
  blankPick: number | null // blank tile awaiting a letter choice (modal open)
  passCount: number // consecutive passes; 2 ends the game
  moveCount: number // total turns taken; used to resync after reconnects
  gameOver: boolean
  showInstructionsModal: boolean
  showTwoLetterModal: boolean
  showUnseenModal: boolean
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
  undoLastTile: () => void
  shuffleRack: () => void
  passTurn: () => void
  startPass: () => void
  confirmSwap: () => void
  cancelSwap: () => void
  openInstructions: () => void
  closeInstructions: () => void
  openTwoLetterWords: () => void
  closeTwoLetterWords: () => void
  chooseBlankLetter: (letter: string) => void
  cancelBlankPick: () => void
  openUnseenTiles: () => void
  closeUnseenTiles: () => void
}

let cursorDownAt = 0
let cursorDownPos = { x: 0, y: 0 }
let cursorDelta = { x: 0, y: 0 }
let dealTimeout: number | null = null
// A drag only starts reordering the rack after this much movement, so the
// small wobble of a tap never shuffles tiles around.
const SWAP_MIN_DRAG = 12
let swapArmed = false

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
  // Close any gaps left by played tiles so drawn tiles append cleanly
  // instead of colliding with existing slot indices.
  cards = reindexRack(cards, playerIndex)
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
        moveCount: saved.moveCount ?? 0,
        gameOver: saved.gameOver,
        lastPlay: saved.lastPlay ?? null,
      })
    },

    applyRemoteMove: (move: MoveData) => {
      const them = otherPlayer(get().localPlayerIndex)
      if (move.type === 'commit') {
        commitPlacements(move.placements, them, get, set)
      } else if (move.type === 'swap') {
        exchangeTiles(move.tileIds, them, get, set)
        // a swap ends the turn but is not a pass (doesn't end the game)
        endTurn(them, false, get, set)
      } else if (move.type === 'pass') {
        endTurn(them, true, get, set)
      }
    },

    // ── Pointer input ─────────────────────────────────────────────
    // Tap an empty board square to select it (tap again to toggle ➡️/⬇️).
    // Tap a rack tile to play it onto the selection; drag a rack tile to
    // reorder the rack.
    onMouseDown: ({ clientX, clientY }: MouseParams) => {
      const state = get()
      const us = state.localPlayerIndex
      const myTurn = state.currentPlayerIndex === us && !state.gameOver
      if (state.gameOver) return

      const clicked = getCardFromPoint(clientX, clientY, state.cards)
      if (clicked) {
        if (clicked.pileIndex === RACK_PILE[us]) {
          // Begin a rack drag (sorting is allowed on either turn); a quick
          // release plays it (see onMouseUp).
          const { x, y } = getCardPilePosition(clicked)
          cursorDelta = { x: clientX - x, y: clientY - y }
          cursorDownPos = { x: clientX, y: clientY }
          cursorDownAt = Date.now()
          swapArmed = false
          set({
            activeCard: clicked,
            cursorState: { mouseX: x, mouseY: y, pressed: true },
          })
        }
        // Board tiles (pending or committed) aren't tappable; use Back /
        // Recall to take uncommitted tiles back.
        return
      }

      if (!myTurn) return
      const pile = getPileAtPoint(clientX, clientY)
      if (isSquarePile(pile) && !tileOnSquare(pile, state.cards)) {
        if (state.selectedSquare === pile) {
          // Tap the selected square again to toggle direction.
          set({ selectedDir: state.selectedDir === 'right' ? 'down' : 'right' })
        } else {
          set({ selectedSquare: pile, selectedDir: 'right' })
        }
      }
      // Clicks elsewhere leave the selection alone; it only clears via
      // recall, backing out every tile, or the turn ending.
    },

    onMouseUp: ({ clientX, clientY }: MouseParams) => {
      const { activeCard } = get()
      if (activeCard) {
        const posDiff =
          Math.abs(cursorDownPos.x - clientX) +
          Math.abs(cursorDownPos.y - clientY)
        const timeDiff = Date.now() - cursorDownAt
        // A quick tap (not a reorder drag) plays the tile — or, while
        // picking tiles to exchange, toggles its selection.
        if (posDiff <= 5 && timeDiff <= 300) {
          const state = get()
          if (state.swapMode) {
            // marking tiles for exchange needs 8+ tiles left in the bag
            if (tilesInPile(BAG_PILE, state.cards).length < 8) return
            set({
              swapIds: state.swapIds.includes(activeCard.id)
                ? state.swapIds.filter((id) => id !== activeCard.id)
                : [...state.swapIds, activeCard.id],
            })
          } else {
            playSelectedTile(activeCard, get, set)
          }
        }
      }
      cursorDownPos = { x: 0, y: 0 }
      cursorDelta = { x: 0, y: 0 }
      set({
        activeCard: null,
        cursorState: { ...get().cursorState, pressed: false },
      })
    },

    onMouseMove: ({ clientX, clientY }: MouseParams) => {
      const mouseX = clientX - cursorDelta.x
      const mouseY = clientY - cursorDelta.y
      set({ cursorState: { ...get().cursorState, mouseX, mouseY } })

      const state = get()
      const { activeCard, localPlayerIndex } = state
      if (!activeCard || !state.cursorState.pressed) return
      if (!swapArmed) {
        const dist =
          Math.abs(clientX - cursorDownPos.x) +
          Math.abs(clientY - cursorDownPos.y)
        if (dist < SWAP_MIN_DRAG) return
        swapArmed = true
      }
      const card = state.cards[activeCard.id]
      if (card.pileIndex !== RACK_PILE[localPlayerIndex]) return
      swapWithinRack(clientX, clientY, card, localPlayerIndex, get, set)
    },

    // ── Turn actions ──────────────────────────────────────────────
    submitTurn: () => {
      const state = get()
      const us = state.localPlayerIndex
      if (state.currentPlayerIndex !== us || state.gameOver) return
      if (state.pending.length === 0) return
      const result = validatePlay(state.cards, state.pending)
      if (!result.ok) return
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
      set({
        cards,
        pending: [],
        activeCard: null,
        selectedSquare: null,
      })
    },

    // Randomize the local rack order. Purely visual, so it's allowed on
    // either player's turn.
    shuffleRack: () => {
      const state = get()
      if (state.gameOver) return
      const rackPile = RACK_PILE[state.localPlayerIndex]
      const rack = tilesInPile(rackPile, state.cards)
      if (rack.length < 2) return
      const order = rack.map((t) => t.id)
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[order[i], order[j]] = [order[j], order[i]]
      }
      set({
        cards: state.cards.map((c) => {
          const idx = order.indexOf(c.id)
          return idx === -1 ? c : { ...c, cardPileIndex: idx }
        }),
      })
    },

    // Take back the most recently placed tile and put the selection back
    // on the square it came off, so play can continue from there.
    undoLastTile: () => {
      const state = get()
      const us = state.localPlayerIndex
      if (state.currentPlayerIndex !== us || state.gameOver) return
      const lastId = state.pending[state.pending.length - 1]
      if (lastId == null) return
      const square = state.cards[lastId].pileIndex
      set({
        cards: returnTileToRack(state.cards, lastId, us),
        pending: state.pending.slice(0, -1),
        // keep the cursor on the freed square so play can resume there
        selectedSquare: square,
      })
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
      endTurn(us, true, get, set)
    },

    // Enter the pass/swap confirm state. With 8+ tiles in the bag the
    // player may also mark rack tiles to exchange; with fewer this is a
    // plain "really pass?" confirmation.
    startPass: () => {
      const state = get()
      const us = state.localPlayerIndex
      if (state.currentPlayerIndex !== us || state.gameOver) return
      set({ swapMode: true, swapIds: [] })
    },

    confirmSwap: () => {
      const state = get()
      const us = state.localPlayerIndex
      if (state.currentPlayerIndex !== us || state.gameOver) return
      const ids = state.swapIds
      set({ swapMode: false, swapIds: [] })
      if (ids.length === 0) return get().passTurn()
      useMultiplayerStore.getState().sendMove({ type: 'swap', tileIds: ids })
      exchangeTiles(ids, us, get, set)
      // a swap ends the turn but is not a pass (doesn't end the game)
      endTurn(us, false, get, set)
    },

    cancelSwap: () => set({ swapMode: false, swapIds: [] }),

    openInstructions: () => set({ showInstructionsModal: true }),
    closeInstructions: () => set({ showInstructionsModal: false }),
    openTwoLetterWords: () => set({ showTwoLetterModal: true }),
    closeTwoLetterWords: () => set({ showTwoLetterModal: false }),

    // Complete a blank-tile placement with the letter picked in the modal.
    chooseBlankLetter: (letter: string) => {
      const state = get()
      const id = state.blankPick
      set({ blankPick: null })
      if (id == null || !/^[A-Z]$/.test(letter)) return
      const card = state.cards[id]
      // the tile must still be on our rack (turn could have changed)
      if (card.pileIndex !== RACK_PILE[state.localPlayerIndex]) return
      placeOnSelected(card, letter, get, set)
    },
    cancelBlankPick: () => set({ blankPick: null }),
    openUnseenTiles: () => set({ showUnseenModal: true }),
    closeUnseenTiles: () => set({ showUnseenModal: false }),
  }
})

function initializeGameState(): Omit<GameState, 'cards'> {
  return {
    activeCard: null,
    cursorState: { mouseX: 0, mouseY: 0, pressed: false },
    selectedSquare: null,
    selectedDir: 'right',
    lastPlay: null,
    swapMode: false,
    swapIds: [],
    blankPick: null,
    dealPhase: 0,
    currentPlayerIndex: 0,
    localPlayerIndex: 0,
    scores: [0, 0],
    pending: [],
    passCount: 0,
    moveCount: 0,
    gameOver: false,
    showInstructionsModal: false,
    showTwoLetterModal: false,
    showUnseenModal: false,
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
    // point is over a tile, not a pile
    return -1
  }
  return +(el?.dataset.pileindex ?? '-1')
}

const getRackRect = (playerIndex: 0 | 1): DOMRect | null => {
  const rackEl = document.querySelector(
    `.pile[data-pileindex="${RACK_PILE[playerIndex]}"]`,
  ) as HTMLDivElement | null
  return rackEl?.getBoundingClientRect() ?? null
}

const isOverRack = (x: number, y: number, playerIndex: 0 | 1): boolean => {
  const r = getRackRect(playerIndex)
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

// Reorder the rack live while dragging a rack tile across it: move the
// dragged tile to the slot under the cursor.
const swapWithinRack = (
  clientX: number,
  clientY: number,
  card: CardType,
  playerIndex: 0 | 1,
  get: () => GameStore,
  set: (s: Partial<GameStore>) => void,
) => {
  const rackPile = RACK_PILE[playerIndex]
  const rect = getRackRect(playerIndex)
  if (!rect || !isOverRack(clientX, clientY, playerIndex)) return

  const { cards } = get()
  const rack = tilesInPile(rackPile, cards)
  // The fan spans the full rack in RACK_SIZE slots (see getCardPilePosition);
  // map cursor x to a slot, clamped to the tiles actually present.
  const slot = Math.floor(((clientX - rect.left) / rect.width) * RACK_SIZE)
  const to = Math.max(0, Math.min(rack.length - 1, slot))
  const from = rack.findIndex((t) => t.id === card.id)
  if (from === -1 || from === to) return

  const order = rack.map((t) => t.id)
  order.splice(from, 1)
  order.splice(to, 0, card.id)
  set({
    cards: cards.map((c) => {
      const idx = order.indexOf(c.id)
      return idx === -1 ? c : { ...c, cardPileIndex: idx }
    }),
  })
}

// ── Placement ───────────────────────────────────────────────────────
// Return a tile to the rack, preferring the slot it was played from (still
// held in its cardPileIndex). If that slot has since been taken (rack was
// shuffled / reordered meanwhile), append it after the last tile instead.
const returnTileToRack = (
  cards: CardType[],
  tileId: number,
  playerIndex: 0 | 1,
): CardType[] => {
  const rackPile = RACK_PILE[playerIndex]
  const tile = cards.find((c) => c.id === tileId)!
  const rack = tilesInPile(rackPile, cards)
  const slotTaken = rack.some((t) => t.cardPileIndex === tile.cardPileIndex)
  const slot = slotTaken
    ? rack[rack.length - 1].cardPileIndex + 1
    : tile.cardPileIndex
  return cards.map((c) =>
    c.id === tileId
      ? {
          ...c,
          pileIndex: rackPile,
          cardPileIndex: slot,
          // reset a blank back to unassigned when it returns to the rack
          letter: c.isBlank ? '' : c.letter,
        }
      : c,
  )
}

// Play a rack tile onto the currently selected square, then advance the
// selection in the current direction to the next empty square. Blank tiles
// first open the letter-picker modal; placement resumes in chooseBlankLetter.
const playSelectedTile = (
  card: CardType,
  get: () => GameStore,
  set: (s: Partial<GameStore>) => void,
) => {
  const state = get()
  const square = state.selectedSquare
  if (square == null || tileOnSquare(square, state.cards)) return
  if (card.isBlank && !card.letter) {
    set({ blankPick: card.id })
    return
  }
  placeOnSelected(card, card.letter, get, set)
}

const placeOnSelected = (
  card: CardType,
  letter: string,
  get: () => GameStore,
  set: (s: Partial<GameStore>) => void,
) => {
  const state = get()
  const square = state.selectedSquare
  if (square == null || tileOnSquare(square, state.cards)) return
  // cardPileIndex is left untouched: it keeps the rack slot the tile came
  // from, so taking it back (Back / Recall) restores its spot.
  const cards = state.cards.map((c) =>
    c.id === card.id ? { ...c, pileIndex: square, letter } : c,
  )
  set({
    cards,
    pending: [...state.pending, card.id],
    selectedSquare: nextEmptySquare(cards, square, state.selectedDir),
  })
}

// First empty square after `pile` in the given direction (skipping over
// occupied squares), or null when the edge of the board is reached.
const nextEmptySquare = (
  cards: CardType[],
  pile: number,
  dir: 'right' | 'down',
): number | null => {
  let { row, col } = pileToSquare(pile)
  while (true) {
    if (dir === 'right') col++
    else row++
    if (row >= BOARD_SIZE || col >= BOARD_SIZE) return null
    const p = squareToPile(row, col)
    if (!tileOnSquare(p, cards)) return p
  }
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

export function validatePlay(cards: CardType[], pending: number[]): PlayResult {
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
  set({
    cards,
    scores,
    lastPlay: result.ok
      ? { word: result.words.join(', '), score, tileIds: pendingIds }
      : get().lastPlay,
  })
  endTurn(playerIndex, false, get, set)
}

// Exchange rack tiles with the bag: they go under the bag (drawn last, so
// they can't come straight back) and the same number of fresh tiles are
// drawn. Runs identically on both peers to keep the shared bag in lockstep.
function exchangeTiles(
  tileIds: number[],
  playerIndex: 0 | 1,
  get: () => GameStore,
  set: (s: Partial<GameStore>) => void,
) {
  let cards = get().cards
  const bag = tilesInPile(BAG_PILE, cards) // sorted ascending
  const bottom = bag.length ? bag[0].cardPileIndex : 0
  const sorted = [...tileIds].sort((a, b) => a - b)
  cards = cards.map((c) => {
    const pos = sorted.indexOf(c.id)
    if (pos === -1) return c
    return {
      ...c,
      pileIndex: BAG_PILE,
      cardPileIndex: bottom - sorted.length + pos,
      letter: c.isBlank ? '' : c.letter,
    }
  })
  cards = drawToRack(cards, playerIndex, sorted.length)
  set({ cards })
}

function endTurn(
  playerIndex: 0 | 1,
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
    selectedSquare: null,
    selectedDir: 'right',
    swapMode: false,
    swapIds: [],
    passCount,
    moveCount: state.moveCount + 1,
    gameOver,
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

// Sanitized snapshot for persistence and peer resync. Uncommitted tiles are
// returned to the rack — the pending list isn't part of shared state, and
// restoring them on a board would strand them there.
function snapshotGameState(state: GameState): SavedGameState {
  let cards = state.cards
  for (const id of state.pending) {
    cards = returnTileToRack(cards, id, state.localPlayerIndex)
  }
  return {
    cards,
    currentPlayerIndex: state.currentPlayerIndex,
    scores: state.scores,
    passCount: state.passCount,
    moveCount: state.moveCount,
    gameOver: state.gameOver,
    lastPlay: state.lastPlay,
  }
}

// Lets the multiplayer layer compare/exchange state after a reconnect.
setGameSnapshotProvider(() => {
  const s = useGameStore.getState()
  return s.cards.length > 0 ? snapshotGameState(s) : null
})

// Push settled state to the server — each player uploads their own moves
// (the multiplayer layer only uploads when moveCount has advanced).
useGameStore.subscribe((state) => {
  const mp = useMultiplayerStore.getState()
  if (mp.mode !== 'multiplayer') return
  if (state.dealPhase !== -1) return
  saveGameState(snapshotGameState(state))
})

// exported for the board UI
export { getPileSize, tileOnSquare, tilesInPile }
