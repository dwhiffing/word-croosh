// Reconciling an incoming server snapshot with what the local player was
// doing before it arrived: keep their rack order, and don't silently drop
// tiles they'd placed for planning ahead.
import { RACK_PILE } from './constants'
import { returnTileToRack } from './turnLogic'

// A snapshot's rack order is whatever the sender last uploaded, which is
// stale for us — carry over our current slot for any tile that's in our
// rack both locally and in the snapshot. Newly drawn tiles (not seen
// locally) sort after, in the snapshot's order.
export function preserveLocalRackOrder(
  localCards: CardType[],
  snapshotCards: CardType[],
  playerIndex: number,
): CardType[] {
  const rackPile = RACK_PILE[playerIndex]
  const localSlot = new Map(
    localCards
      .filter((c) => c.pileIndex === rackPile)
      .map((c) => [c.id, c.cardPileIndex]),
  )
  const order = snapshotCards
    .filter((c) => c.pileIndex === rackPile)
    .sort(
      (a, b) =>
        (localSlot.get(a.id) ?? Infinity) - (localSlot.get(b.id) ?? Infinity) ||
        a.cardPileIndex - b.cardPileIndex,
    )
  return snapshotCards.map((c) => {
    const idx = order.findIndex((t) => t.id === c.id)
    return idx === -1 ? c : { ...c, cardPileIndex: idx }
  })
}

// Tiles placed for planning ahead are purely local — a snapshot always has
// them back in the sender's rack. Re-place each onto the incoming board,
// unless the opponent's move just took that square, in which case it goes
// back to the rack instead of silently vanishing. Returns the updated cards
// and the surviving pending ids.
export function carryForwardPending(
  cards: CardType[],
  localPendingIds: number[],
  localCardsBefore: CardType[],
  playerIndex: number,
): { cards: CardType[]; pending: number[] } {
  const pending: number[] = []
  for (const id of localPendingIds) {
    const local = localCardsBefore[id]
    const nowOccupied = cards.some(
      (c) => c.id !== id && c.pileIndex === local.pileIndex,
    )
    if (nowOccupied) {
      cards = returnTileToRack(cards, id, playerIndex)
    } else {
      cards = cards.map((c) =>
        c.id === id
          ? { ...c, pileIndex: local.pileIndex, letter: local.letter }
          : c,
      )
      pending.push(id)
    }
  }
  return { cards, pending }
}

// A board selection whose square just got taken by the opponent no longer
// makes sense — the caller should drop it so the player picks a fresh spot.
export function selectionSurvives(
  cards: CardType[],
  selectedSquare: number | null,
): boolean {
  return (
    selectedSquare == null || !cards.some((c) => c.pileIndex === selectedSquare)
  )
}
