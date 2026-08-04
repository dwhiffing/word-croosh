import { CENTER_SQUARE, getBonus } from '../utils/constants'
import { useGameStore } from '../utils/gameStore'

// A single board square. Shows its bonus label when no tile covers it, and
// the direction arrow when it's the selected play target.
export const Square = ({ pileIndex }: { pileIndex: number }) => {
  const selectedDir = useGameStore((s) =>
    s.selectedSquare === pileIndex ? s.selectedDir : null,
  )
  const bonus = getBonus(pileIndex)
  const isCenter = pileIndex === CENTER_SQUARE
  return (
    <div
      className={`pile square ${bonus ? `bonus-${bonus}` : ''} ${
        isCenter ? 'center' : ''
      } ${selectedDir ? 'selected' : ''} flex justify-center items-center`}
      data-pileindex={pileIndex}
      data-piletype="board">
      {selectedDir ? (
        <span className="square-arrow">
          {selectedDir === 'right' ? '➡️' : '⬇️'}
        </span>
      ) : isCenter ? (
        <span className="square-star">★</span>
      ) : bonus ? (
        <span className="square-label">{bonus}</span>
      ) : null}
    </div>
  )
}

// A rack container. Tiles position themselves within it (see index.ts).
export const Rack = ({ pileIndex }: { pileIndex: number }) => (
  <div
    className="pile rack"
    data-pileindex={pileIndex}
    data-piletype="rack"
  />
)
