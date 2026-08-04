import { CENTER_SQUARE, getBonus } from '../utils/constants'

// A single board square. Shows its bonus label when no tile covers it.
export const Square = ({ pileIndex }: { pileIndex: number }) => {
  const bonus = getBonus(pileIndex)
  const isCenter = pileIndex === CENTER_SQUARE
  return (
    <div
      className={`pile square ${bonus ? `bonus-${bonus}` : ''} ${
        isCenter ? 'center' : ''
      } flex justify-center items-center`}
      data-pileindex={pileIndex}
      data-piletype="board">
      {isCenter ? (
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
