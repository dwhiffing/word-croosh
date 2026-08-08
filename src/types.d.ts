// Build timestamp injected by vite.config.ts `define` ("dev" in dev mode).
declare const __BUILD_TIME__: string

// A tile is rendered by the same machinery that used to render cards.
// `pileIndex`/`cardPileIndex` position it (see constants.ts pile scheme);
// `letter` is the face letter, `value` its point value.
interface CardType {
  id: number
  pileIndex: number
  cardPileIndex: number
  letter: string // 'A'..'Z', or '' for an unassigned blank
  value: number // point value (0 for blanks)
  isBlank: boolean
  placedBy: number | null // seat index of the player who committed this tile
}
