// Game-rule functions coupled to the store's get/set: placing a tile,
// committing a play, exchanging tiles with the bag, and ending a turn
// (including the game-over/scoring rules). Split out of gameStore.ts so the
// store body itself only has to wire these up to UI actions.
import { drawToRack, reindexRack, tileOnSquare, tilesInPile } from './bag'
import {
  BAG_PILE,
  BOARD_SIZE,
  pileToSquare,
  RACK_PILE,
  RACK_SIZE,
  squareToPile,
} from './constants'
import type { GameStore } from './gameStore'
import { useMultiplayerStore } from './multiplayerStore'
import { validatePlay } from './scoring'

type Get = () => GameStore
type Set = (s: Partial<GameStore>) => void

export const otherPlayer = (i: 0 | 1): 0 | 1 => (i === 0 ? 1 : 0)

// ── Placement ───────────────────────────────────────────────────────
// Return a tile to the rack, preferring the slot it was played from (still
// held in its cardPileIndex). If that slot has since been taken (rack was
// shuffled / reordered meanwhile), append it after the last tile instead.
export const returnTileToRack = (
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
          placedBy: null,
        }
      : c,
  )
}

// Return every listed tile to the rack and close up the gaps they left, in
// one call — the shared tail end of recall/pass/give-up.
export function recallPendingToRack(
  cards: CardType[],
  pendingIds: number[],
  playerIndex: 0 | 1,
): CardType[] {
  for (const id of pendingIds) cards = returnTileToRack(cards, id, playerIndex)
  return reindexRack(cards, playerIndex)
}

// Play a rack tile onto the currently selected square, then advance the
// selection in the current direction to the next empty square. Blank tiles
// first open the letter-picker modal; placement resumes in chooseBlankLetter.
export const playSelectedTile = (card: CardType, get: Get, set: Set) => {
  const state = get()
  const square = state.selectedSquare
  if (square == null || tileOnSquare(square, state.cards)) return
  if (card.isBlank && !card.letter) {
    set({ blankPick: card.id })
    return
  }
  placeOnSelected(card, card.letter, get, set)
}

export const placeOnSelected = (
  card: CardType,
  letter: string,
  get: Get,
  set: Set,
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
export const nextEmptySquare = (
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

// ── Commit / turn transition ────────────────────────────────────────
type Placement = { tileId: number; pile: number; letter: string }

export function commitPlacements(
  placements: Placement[],
  playerIndex: 0 | 1,
  get: Get,
  set: Set,
) {
  let cards = get().cards
  const ids = new Set(placements.map((p) => p.tileId))
  cards = cards.map((c) => {
    const p = placements.find((pl) => pl.tileId === c.id)
    return p
      ? {
          ...c,
          pileIndex: p.pile,
          cardPileIndex: 0,
          letter: p.letter,
          placedBy: playerIndex,
        }
      : c
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
export function exchangeTiles(
  tileIds: number[],
  playerIndex: 0 | 1,
  get: Get,
  set: Set,
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

export function endTurn(
  playerIndex: 0 | 1,
  wasPass: boolean,
  get: Get,
  set: Set,
) {
  const state = get()

  // Game ends: two consecutive passes, or the mover emptied their rack with
  // an empty bag. If the other player has given up, the mover is playing
  // solo — a single pass (or emptying their rack) is enough to end it.
  const bagEmpty = tilesInPile(BAG_PILE, state.cards).length === 0
  const moverRackEmpty =
    tilesInPile(RACK_PILE[playerIndex], state.cards).length === 0
  const opponentGaveUp = state.givenUpBy === otherPlayer(playerIndex)
  const gameOver = (bagEmpty && moverRackEmpty) || (opponentGaveUp && wasPass)

  // Once someone has given up, the turn never returns to them — the
  // remaining player just keeps going.
  const nextPlayer = opponentGaveUp ? playerIndex : otherPlayer(playerIndex)

  // `scores` here is intentionally left as "points from played words only" —
  // the server subtracts each player's leftover rack when it records the
  // result (see server/worker.js), so this stays the single source of
  // truth regardless of which client's upload wins any race at game end.
  set({
    currentPlayerIndex: nextPlayer,
    pending: [],
    activeCard: null,
    selectedSquare: null,
    selectedDir: 'right',
    swapMode: false,
    swapIds: [],
    moveCount: state.moveCount + 1,
    gameOver,
  })
  const { localPlayerIndex } = get()
  if (
    !gameOver &&
    nextPlayer === localPlayerIndex &&
    nextPlayer !== playerIndex &&
    useMultiplayerStore.getState().mode === 'multiplayer'
  ) {
    navigator.vibrate?.(60)
  }
}
