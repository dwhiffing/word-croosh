// A read-only replica of a finished board — a plain grid over a snapshot's
// `cards` array, independent of the live game store. Not the interactive
// board: no drag, no animation, no DOM measurement, just letters in a grid.
import type { SeatInfo } from '../../utils/api'
import {
  BAG_PILE,
  BOARD_SIZE,
  FIRST_SQUARE_PILE,
  getBonus,
  RACK_PILE,
  TILE_COLOR_HEX,
} from '../../utils/constants'

const BONUS_LABELS: Record<string, string> = {
  DL: '2L',
  TL: '3L',
  DW: '2W',
  TW: '3W',
}

export function BoardViewer({
  cards,
  seats,
}: {
  cards: CardType[]
  seats: SeatInfo[]
}) {
  const bySquare = new Map<number, CardType>()
  for (const c of cards) {
    if (c.pileIndex >= FIRST_SQUARE_PILE && c.pileIndex < FIRST_SQUARE_PILE + BOARD_SIZE * BOARD_SIZE) {
      bySquare.set(c.pileIndex, c)
    }
  }
  const playerCount = seats.length || 2
  const racks = Array.from({ length: playerCount }, (_, p) =>
    cards
      .filter((c) => c.pileIndex === RACK_PILE[p])
      .sort((a, b) => a.cardPileIndex - b.cardPileIndex),
  )
  const bagCount = cards.filter((c) => c.pileIndex === BAG_PILE).length

  return (
    <div className="flex flex-col gap-3 items-center">
      <div
        className="board"
        style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`, width: '100%', maxWidth: 360 }}>
        {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => {
          const pile = FIRST_SQUARE_PILE + i
          const tile = bySquare.get(pile)
          const bonus = getBonus(pile)
          return (
            <div
              key={pile}
              className={`pile square ${bonus ? `bonus-${bonus}` : ''} flex items-center justify-center text-[8px] font-bold`}
              style={{ width: 'auto', aspectRatio: 1 }}>
              {tile ? (
                <span style={{ color: 'var(--color-tile-text)' }}>
                  {tile.letter}
                </span>
              ) : bonus ? (
                BONUS_LABELS[bonus]
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="w-full flex flex-col gap-2 text-sm">
        {racks.map((rack, p) => {
          const seat = seats.find((s) => s.seat === p)
          const color = seat?.color
            ? TILE_COLOR_HEX[seat.color]
            : 'var(--color-tile)'
          return (
            <div key={p} className="flex items-center gap-2">
              <span className="opacity-60 w-20 shrink-0 truncate">
                {seat?.name ?? `Player ${p + 1}`}:
              </span>
              <div className="flex gap-1 flex-wrap">
                {rack.length === 0 ? (
                  <span className="opacity-40">—</span>
                ) : (
                  rack.map((t) => (
                    <span
                      key={t.id}
                      className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold"
                      style={{
                        background: color,
                        color: 'var(--color-tile-text)',
                      }}>
                      {t.isBlank && !t.letter ? '?' : t.letter}
                    </span>
                  ))
                )}
              </div>
            </div>
          )
        })}
        {bagCount > 0 && (
          <div className="opacity-60">{bagCount} tile{bagCount === 1 ? '' : 's'} left in the bag</div>
        )}
      </div>
    </div>
  )
}
