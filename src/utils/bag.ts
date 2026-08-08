// Pure helpers over the shared tile bag: build the deterministic shuffled
// bag, draw from it into a rack, and read piles. No store dependency —
// everything here just takes a `cards` array and returns a new one.
import {
  BAG_LETTERS,
  BAG_PILE,
  LETTER_VALUES,
  RACK_PILE,
  RACK_SIZE,
} from './constants'
import { seededShuffle } from './seededShuffle'

export const tilesInPile = (pileIndex: number, cards: CardType[]) =>
  cards
    .filter((c) => c.pileIndex === pileIndex)
    .sort((a, b) => a.cardPileIndex - b.cardPileIndex)

export const tileOnSquare = (pile: number, cards: CardType[]) =>
  cards.find((c) => c.pileIndex === pile)

// Both peers build the identical shuffled bag from the shared seed, so
// drawing tiles (pop from the top of the bag stack) stays in lockstep.
export function generateTiles(seed: number): CardType[] {
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
export function drawToRack(
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
    drawn.has(c.id) ? { ...c, pileIndex: rackPile, cardPileIndex: next++ } : c,
  )
}

export function reindexRack(cards: CardType[], playerIndex: 0 | 1): CardType[] {
  const rackPile = RACK_PILE[playerIndex]
  const rack = tilesInPile(rackPile, cards)
  return cards.map((c) => {
    const idx = rack.findIndex((t) => t.id === c.id)
    return idx === -1 ? c : { ...c, cardPileIndex: idx }
  })
}
