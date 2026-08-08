// Play validation and scoring: given the board and the tiles placed this
// turn, check the play is legal and compute its score. Pure — no store
// dependency.
import { tileOnSquare } from './bag'
import {
  BINGO_BONUS,
  BOARD_SIZE,
  CENTER_SQUARE,
  getBonus,
  isSquarePile,
  pileToSquare,
  RACK_SIZE,
  squareToPile,
} from './constants'
import { isValidWord } from './dictionary'

export type PlayResult =
  | { ok: true; words: string[]; score: number }
  | { ok: false; error: string }

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
