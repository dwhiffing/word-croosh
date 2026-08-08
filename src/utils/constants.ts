// ── Scrabble constants ──────────────────────────────────────────────

export const CARD_TRANSITION_DURATION = 150

export const BOARD_SIZE = 15 // 15x15
export const RACK_SIZE = 7

export const MAX_PLAYERS = 4

export const BINGO_BONUS = 50 // using all 7 tiles in one turn

// Pile-index scheme (reuses the card/pile rendering system):
//   0                     → the bag (face-down draw pile)
//   1 .. BOARD_SIZE^2     → board squares, square (r,c) = 1 + r*BOARD_SIZE + c
//   RACK_PILE[playerIndex] → that player's rack (the "hand")
export const BAG_PILE = 0
export const FIRST_SQUARE_PILE = 1
export const LAST_SQUARE_PILE = BOARD_SIZE * BOARD_SIZE // 225
export const RACK_PILE: number[] = [1000, 1001, 1002, 1003]

// The 8 selectable player tile colors (see server/worker.js TILE_COLORS —
// keep these two lists in sync). All chosen light enough that black tile
// text stays readable on every one.
export type TileColorName =
  | 'yellow'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'blue'
  | 'teal'
  | 'green'
  | 'gray'

export const TILE_COLORS: TileColorName[] = [
  'yellow',
  'orange',
  'pink',
  'purple',
  'blue',
  'teal',
  'green',
  'gray',
]

export const TILE_COLOR_HEX: Record<TileColorName, string> = {
  yellow: '#e7da82', // the original default tile color
  orange: '#e8a869',
  pink: '#efa2bd',
  purple: '#b680dc',
  blue: '#7a8fe1',
  teal: '#80cfbf',
  green: '#6ed365',
  gray: '#bdbad1',
}

// Tile letter/value text color: a darker shade of the tile's own hue
// (rather than flat black) for each color, still readable at tile scale.
export const TILE_COLOR_TEXT_HEX: Record<TileColorName, string> = {
  yellow: '#4a2f10', // the original default tile-text color
  orange: '#714a28',
  pink: '#763756',
  purple: '#522f70',
  blue: '#28335e',
  teal: '#246156',
  green: '#285823',
  gray: '#4d4b5a',
}

export const BONUS_LABELS: Record<NonNullable<Bonus>, string> = {
  TW: 'TW',
  DW: 'DW',
  TL: 'TL',
  DL: 'DL',
}

export const squareToPile = (row: number, col: number) =>
  FIRST_SQUARE_PILE + row * BOARD_SIZE + col
export const pileToSquare = (pile: number) => {
  const i = pile - FIRST_SQUARE_PILE
  return { row: Math.floor(i / BOARD_SIZE), col: i % BOARD_SIZE }
}
export const isSquarePile = (pile: number) =>
  pile >= FIRST_SQUARE_PILE && pile <= LAST_SQUARE_PILE
export const CENTER_SQUARE = squareToPile(7, 7)

// ── Letter distribution & values (standard English Scrabble) ────────
// [letter, count, value]; '_' is the blank tile (value 0).
const LETTER_DATA: [string, number, number][] = [
  ['A', 9, 1],
  ['B', 2, 3],
  ['C', 2, 3],
  ['D', 4, 2],
  ['E', 12, 1],
  ['F', 2, 4],
  ['G', 3, 2],
  ['H', 2, 4],
  ['I', 9, 1],
  ['J', 1, 8],
  ['K', 1, 5],
  ['L', 4, 1],
  ['M', 2, 3],
  ['N', 6, 1],
  ['O', 8, 1],
  ['P', 2, 3],
  ['Q', 1, 10],
  ['R', 6, 1],
  ['S', 4, 1],
  ['T', 6, 1],
  ['U', 4, 1],
  ['V', 2, 4],
  ['W', 2, 4],
  ['X', 1, 8],
  ['Y', 2, 4],
  ['Z', 1, 10],
  ['_', 2, 0],
]

export const LETTER_VALUES: Record<string, number> = Object.fromEntries(
  LETTER_DATA.map(([letter, , value]) => [letter, value]),
)

// The full bag as an array of letters, before shuffling.
export const BAG_LETTERS: string[] = LETTER_DATA.flatMap(([letter, count]) =>
  Array.from({ length: count }, () => letter),
)

// ── Bonus squares ───────────────────────────────────────────────────
// 'TW' triple word, 'DW' double word, 'TL' triple letter, 'DL' double letter.
export type Bonus = 'TW' | 'DW' | 'TL' | 'DL' | null

const BONUS_LAYOUT: Record<string, [number, number][]> = {
  TW: [
    [0, 0],
    [0, 7],
    [0, 14],
    [7, 0],
    [7, 14],
    [14, 0],
    [14, 7],
    [14, 14],
  ],
  DW: [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [7, 7],
    [1, 13],
    [2, 12],
    [3, 11],
    [4, 10],
    [13, 1],
    [12, 2],
    [11, 3],
    [10, 4],
    [13, 13],
    [12, 12],
    [11, 11],
    [10, 10],
  ],
  TL: [
    [1, 5],
    [1, 9],
    [5, 1],
    [5, 5],
    [5, 9],
    [5, 13],
    [9, 1],
    [9, 5],
    [9, 9],
    [9, 13],
    [13, 5],
    [13, 9],
  ],
  DL: [
    [0, 3],
    [0, 11],
    [2, 6],
    [2, 8],
    [3, 0],
    [3, 7],
    [3, 14],
    [6, 2],
    [6, 6],
    [6, 8],
    [6, 12],
    [7, 3],
    [7, 11],
    [8, 2],
    [8, 6],
    [8, 8],
    [8, 12],
    [11, 0],
    [11, 7],
    [11, 14],
    [12, 6],
    [12, 8],
    [14, 3],
    [14, 11],
  ],
}

// square pile index → bonus
export const BONUS_SQUARES: Record<number, Bonus> = (() => {
  const map: Record<number, Bonus> = {}
  for (const [bonus, coords] of Object.entries(BONUS_LAYOUT)) {
    for (const [r, c] of coords) map[squareToPile(r, c)] = bonus as Bonus
  }
  return map
})()

export const getBonus = (pile: number): Bonus => BONUS_SQUARES[pile] ?? null
