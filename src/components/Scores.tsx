import { useShallow } from 'zustand/react/shallow'
import { TILE_COLOR_HEX, type TileColorName } from '../utils/constants'
import { useGameStore } from '../utils/gameStore'
import { useMultiplayerStore } from '../utils/multiplayerStore'

// Score + turn display. Rendered twice: inline above the board (default),
// and centered in the header on squarer aspect ratios where vertical space
// is scarce (see the `squarish:` variant — index.css) — the header copy
// swaps in and the inline one hides so they never show at once.
//
// `compact` (used in the header) drops the turn-row sentence and shrinks
// the score line — the header only has one row's worth of height to spare,
// shared with the title and menu button either side of it.
export function Scores() {
  const { myName, seats } = useMultiplayerStore()
  const {
    localPlayerIndex,
    currentPlayerIndex,
    scores,
    lastPlay,
    gameOver,
    givenUpBy,
  } = useGameStore(
    useShallow((s) => ({
      localPlayerIndex: s.localPlayerIndex,
      currentPlayerIndex: s.currentPlayerIndex,
      scores: s.scores,
      lastPlay: s.lastPlay,
      gameOver: s.gameOver,
      givenUpBy: s.givenUpBy,
    })),
  )

  const lp = localPlayerIndex
  const myTurn = currentPlayerIndex === lp && !gameOver
  const myDisplayName = myName ?? 'You'
  const opponentSeats = Array.from(
    { length: scores.length },
    (_, i) => i,
  ).filter((i) => i !== lp)
  const lastPlayText = lastPlay && `${lastPlay.word} (${lastPlay.score}) - `

  return (
    <div className="flex flex-col">
      <div className="score-row">
        <span className={myTurn ? 'active-player' : ''}>
          <ColorDot color={seats[lp]?.color} />
          {myDisplayName}: {scores[lp]}
        </span>
        {opponentSeats.map((seat) => (
          <span key={seat}>
            {' / '}
            <span
              className={currentPlayerIndex === seat ? 'active-player' : ''}>
              <ColorDot color={seats[seat]?.color} />
              {seats[seat]?.name ?? `Player ${seat + 1}`}: {scores[seat]}
            </span>
          </span>
        ))}
      </div>
      {!gameOver && (
        <div className="turn-row">
          <>
            <b>{lastPlayText}</b>
            {givenUpBy.includes(lp) && !myTurn
              ? `${seats[currentPlayerIndex]?.name ?? `Player ${currentPlayerIndex + 1}`}'s turn (you gave up)`
              : myTurn
                ? 'Your turn!'
                : `${seats[currentPlayerIndex]?.name ?? `Player ${currentPlayerIndex + 1}`}'s turn!`}
          </>
        </div>
      )}
    </div>
  )
}

function ColorDot({ color }: { color?: TileColorName | null }) {
  if (!color) return null
  return (
    <span
      className="inline-block w-2 h-2 rounded-full mr-1"
      style={{ background: TILE_COLOR_HEX[color] }}
    />
  )
}
