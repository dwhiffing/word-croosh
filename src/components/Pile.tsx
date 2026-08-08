import { tileOnSquare } from '../utils/bag'
import { CENTER_SQUARE, getBonus } from '../utils/constants'
import { useGameStore } from '../utils/gameStore'

const BONUS_LABELS: Record<string, string> = {
  DL: '2L',
  TL: '3L',
  DW: '2W',
  TW: '3W',
}

// A single board square. Shows its bonus label when no tile covers it, and
// the direction arrow when it's the selected play target.
export const Square = ({ pileIndex }: { pileIndex: number }) => {
  const selectedDir = useGameStore((s) =>
    s.selectedSquare === pileIndex ? s.selectedDir : null,
  )
  const isOccupied = useGameStore((s) => !!tileOnSquare(pileIndex, s.cards))
  const bonus = getBonus(pileIndex)
  const isCenter = pileIndex === CENTER_SQUARE
  return (
    <div
      className={`pile square ${bonus ? `bonus-${bonus}` : ''} ${
        isCenter ? 'center' : ''
      } ${selectedDir ? 'selected' : ''} ${
        isOccupied ? 'occupied' : ''
      } flex justify-center items-center`}
      data-pileindex={pileIndex}
      data-piletype="board">
      {selectedDir ? (
        <span className="square-arrow">
          {selectedDir === 'right' ? '➡️' : '⬇️'}
        </span>
      ) : isCenter ? (
        <span className="square-star">★</span>
      ) : bonus ? (
        <span className="square-label">{BONUS_LABELS[bonus]}</span>
      ) : null}
    </div>
  )
}

// A rack container. Tiles position themselves within it (see index.ts).
export const Rack = ({ pileIndex }: { pileIndex: number }) => (
  <div className="pile rack" data-pileindex={pileIndex} data-piletype="rack" />
)
