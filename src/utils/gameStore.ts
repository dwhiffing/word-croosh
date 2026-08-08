import { create } from 'zustand'
import { getCardPilePosition } from '.'
import { drawToRack, generateTiles, tileOnSquare, tilesInPile } from './bag'
import { BAG_PILE, isSquarePile, RACK_PILE, RACK_SIZE } from './constants'
import { loadDictionary } from './dictionary'
import {
  type SavedGameState,
  saveGameState,
  setGameHooks,
  useMultiplayerStore,
} from './multiplayerStore'
import {
  getCardFromPoint,
  getPileAtPoint,
  swapWithinRack,
} from './pointerHelpers'
import {
  carryForwardPending,
  preserveLocalRackOrder,
  selectionSurvives,
} from './resync'
import { validatePlay } from './scoring'
import {
  commitPlacements,
  endTurn,
  exchangeTiles,
  finalizeScores,
  otherPlayer,
  placeOnSelected,
  playSelectedTile,
  recallPendingToRack,
  returnTileToRack,
} from './turnLogic'

export { validatePlay } from './scoring'

type MouseParams = { clientX: number; clientY: number }

export interface GameState {
  cards: CardType[]
  activeCard: CardType | null
  cursorState: { mouseX: number; mouseY: number; pressed: boolean }
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
  givenUpBy: 0 | 1 | null // if set, that player is done — the other plays on solo
  showInstructionsModal: boolean
  showTwoLetterModal: boolean
  showUnseenModal: boolean
}

export interface GameStore extends GameState {
  newGame: () => void
  startMultiplayerGame: (seed: number, localPlayerIndex: 0 | 1) => void
  restoreMultiplayerGame: (
    state: SavedGameState,
    localPlayerIndex: 0 | 1,
  ) => void
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
  giveUp: () => void
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
// A drag only starts reordering the rack after this much movement, so the
// small wobble of a tap never shuffles tiles around.
const SWAP_MIN_DRAG = 12
let swapArmed = false

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
    })
  }

  const newGame = () => {
    const { mode, startNewGame } = useMultiplayerStore.getState()
    if (mode === 'multiplayer' && get().localPlayerIndex === 0) {
      startNewGame()
    }
  }

  // Preload the dictionary in the background.
  void loadDictionary()

  const isOurTurn = () => {
    const state = get()
    const us = state.localPlayerIndex
    return state.currentPlayerIndex === us && !state.gameOver
  }

  return {
    cards: [],
    ...initializeGameState(),

    newGame,
    startMultiplayerGame: (seed, localPlayerIndex) =>
      startGame(seed, localPlayerIndex),
    restoreMultiplayerGame: (saved, localPlayerIndex) => {
      const before = get()

      // The snapshot's rack order and pending tiles are stale/missing from
      // our point of view — reapply what we were doing locally on top of it.
      const reordered = preserveLocalRackOrder(
        before.cards,
        saved.cards,
        localPlayerIndex,
      )
      const { cards, pending } = carryForwardPending(
        reordered,
        before.pending,
        before.cards,
        localPlayerIndex,
      )
      const selectedSquare = selectionSurvives(cards, before.selectedSquare)
        ? before.selectedSquare
        : null

      set({
        ...initializeGameState(),
        cards,
        pending,
        selectedSquare,
        selectedDir: before.selectedDir,
        localPlayerIndex,
        currentPlayerIndex: saved.currentPlayerIndex,
        scores: saved.scores,
        passCount: saved.passCount,
        moveCount: saved.moveCount ?? 0,
        gameOver: saved.gameOver,
        lastPlay: saved.lastPlay ?? null,
        givenUpBy: saved.givenUpBy ?? null,
      })
    },

    // ── Pointer input ─────────────────────────────────────────────
    // Tap an empty board square to select it (tap again to toggle ➡️/⬇️).
    // Tap a rack tile to play it onto the selection; drag a rack tile to
    // reorder the rack.
    onMouseDown: ({ clientX, clientY }: MouseParams) => {
      const state = get()
      const us = state.localPlayerIndex
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

      // Selecting a square and placing tiles is allowed on either turn, so
      // a player can plan their next word while waiting. Submitting still
      // requires it actually being their turn (see submitTurn).
      const pile = getPileAtPoint(clientX, clientY)
      if (isSquarePile(pile) && !tileOnSquare(pile, state.cards)) {
        if (state.selectedSquare === pile) {
          // Tap the selected square again to toggle direction.
          set({
            selectedDir: state.selectedDir === 'right' ? 'down' : 'right',
          })
        } else {
          // Selecting a different square keeps the current direction.
          set({ selectedSquare: pile })
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
      if (!isOurTurn() || state.pending.length === 0) return
      const result = validatePlay(state.cards, state.pending)
      const us = state.localPlayerIndex
      if (!result.ok) return
      const placements = state.pending.map((id) => {
        const t = state.cards.find((c) => c.id === id)!
        return { tileId: id, pile: t.pileIndex, letter: t.letter }
      })
      commitPlacements(placements, us, get, set)
    },

    recallTiles: () => {
      const state = get()
      if (state.pending.length === 0) return
      set({
        cards: recallPendingToRack(
          state.cards,
          state.pending,
          state.localPlayerIndex,
        ),
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
      if (state.gameOver) return
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
      if (!isOurTurn()) return
      // recall any placed-but-uncommitted tiles first
      set({
        cards: recallPendingToRack(state.cards, state.pending, us),
        pending: [],
      })
      endTurn(us, true, get, set)
    },

    // Enter the pass/swap confirm state. With 8+ tiles in the bag the
    // player may also mark rack tiles to exchange; with fewer this is a
    // plain "really pass?" confirmation.
    startPass: () => {
      if (!isOurTurn()) return
      set({ swapMode: true, swapIds: [] })
    },

    confirmSwap: () => {
      const state = get()
      const us = state.localPlayerIndex
      if (!isOurTurn()) return
      const ids = state.swapIds
      set({ swapMode: false, swapIds: [] })
      if (ids.length === 0) return get().passTurn()
      exchangeTiles(ids, us, get, set)
      // a swap ends the turn but is not a pass (doesn't end the game)
      endTurn(us, false, get, set)
    },

    cancelSwap: () => set({ swapMode: false, swapIds: [] }),

    // Bow out. The other player keeps taking turns on their own — no more
    // passing the turn back to us — until they empty their rack (with an
    // empty bag), pass, or give up too.
    giveUp: () => {
      const state = get()
      const us = state.localPlayerIndex
      // once we've already given up, giving up again is a no-op
      if (state.gameOver || state.givenUpBy === us) return
      const opponentAlreadyGaveUp = state.givenUpBy === otherPlayer(us)
      const ourTurn = state.currentPlayerIndex === us
      // Withdraw fully: any tiles placed for planning (turn or not) go back
      // to the rack, so nothing is left stranded on the board.
      set({
        cards: recallPendingToRack(state.cards, state.pending, us),
        givenUpBy: us,
        currentPlayerIndex: otherPlayer(us),
        gameOver: opponentAlreadyGaveUp,
        // bump moveCount so this change is recognized as newer and uploaded
        moveCount: state.moveCount + 1,
        pending: [],
        ...(ourTurn && { swapMode: false, swapIds: [] }),
      })
      if (opponentAlreadyGaveUp) finalizeScores(get, set)
    },

    openInstructions: () => set({ showInstructionsModal: true }),
    closeInstructions: () => set({ showInstructionsModal: false }),
    openTwoLetterWords: () => set({ showTwoLetterModal: true }),
    closeTwoLetterWords: () => set({ showTwoLetterModal: false }),

    // Complete a blank-tile placement with the letter picked in the modal.
    chooseBlankLetter: (letter: string) => {
      const state = get()
      const id = get().blankPick
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
    currentPlayerIndex: 0,
    localPlayerIndex: 0,
    scores: [0, 0],
    pending: [],
    passCount: 0,
    moveCount: 0,
    gameOver: false,
    givenUpBy: null,
    showInstructionsModal: false,
    showTwoLetterModal: false,
    showUnseenModal: false,
  }
}

// Sanitized snapshot for persistence and peer resync. Uncommitted tiles are
// returned to the rack — the pending list isn't part of shared state, and
// restoring them on a board would strand them there.
function snapshotGameState(state: GameState): SavedGameState {
  // Not reindexed: the receiving side sorts its own rack order (see
  // preserveLocalRackOrder), so this only needs the tiles off the board.
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
    givenUpBy: state.givenUpBy,
  }
}

// ── Multiplayer wiring ──────────────────────────────────────────────
// gameStore reacts to server-driven events (deal, resync, disconnect, the
// host's "go ahead and deal" signal) and supplies the snapshot the
// multiplayer layer uploads.
setGameHooks({
  onGameStart: (seed, localPlayerIndex) =>
    useGameStore.getState().startMultiplayerGame(seed, localPlayerIndex),
  onGameResume: (state, localPlayerIndex) =>
    useGameStore.getState().restoreMultiplayerGame(state, localPlayerIndex),
  onDisconnect: () =>
    useGameStore.setState({ ...initializeGameState(), cards: [] }),
  onHostReadyToStart: () => useMultiplayerStore.getState().startNewGame(),
  gameSnapshot: () => {
    const s = useGameStore.getState()
    return s.cards.length > 0 ? snapshotGameState(s) : null
  },
})

// Push settled state to the server — each player uploads their own moves
// (the multiplayer layer only uploads when moveCount has advanced).
useGameStore.subscribe((state) => {
  const mp = useMultiplayerStore.getState()
  if (mp.mode !== 'multiplayer') return
  saveGameState(snapshotGameState(state))
})
