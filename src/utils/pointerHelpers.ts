// DOM-coupled pointer helpers for the board/rack: reading what's under the
// cursor and reordering the rack while dragging. Store-agnostic beyond the
// `{ cards }` slice they read and write.
import { tilesInPile } from './bag'
import { RACK_PILE, RACK_SIZE } from './constants'

export const getCardFromPoint = (x: number, y: number, cards: CardType[]) => {
  const el = document.elementFromPoint(x, y) as HTMLDivElement | null
  return el?.dataset.id ? cards[+el.dataset.id] : undefined
}

export const getPileAtPoint = (x: number, y: number): number => {
  const el = document.elementFromPoint(x, y) as HTMLDivElement | null
  if (el?.dataset.id) {
    // point is over a tile, not a pile
    return -1
  }
  return +(el?.dataset.pileindex ?? '-1')
}

export const getRackRect = (playerIndex: number): DOMRect | null => {
  const rackEl = document.querySelector(
    `.pile[data-pileindex="${RACK_PILE[playerIndex]}"]`,
  ) as HTMLDivElement | null
  return rackEl?.getBoundingClientRect() ?? null
}

export const isOverRack = (
  x: number,
  y: number,
  playerIndex: number,
): boolean => {
  const r = getRackRect(playerIndex)
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

// Reorder the rack live while dragging a rack tile across it: move the
// dragged tile to the slot under the cursor.
export const swapWithinRack = (
  clientX: number,
  clientY: number,
  card: CardType,
  playerIndex: number,
  get: () => { cards: CardType[] },
  set: (s: { cards: CardType[] }) => void,
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
