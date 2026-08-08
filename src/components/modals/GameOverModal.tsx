import { useShallow } from 'zustand/react/shallow'
import { useGameStore } from '../../utils/gameStore'
import { useMultiplayerStore } from '../../utils/multiplayerStore'
import { Modal } from './Modal'

export const GameOverModal = () => {
  const { gameOver, newGame, localPlayerIndex } = useGameStore(
    useShallow((state) => ({
      gameOver: state.gameOver,
      newGame: state.newGame,
      localPlayerIndex: state.localPlayerIndex,
    })),
  )
  const { mode, results, disconnect, myName, seats } = useMultiplayerStore(
    useShallow((s) => ({
      mode: s.mode,
      results: s.results,
      disconnect: s.disconnect,
      myName: s.myName,
      seats: s.seats,
    })),
  )
  const wins = results?.wins ?? {}
  const isGuest = mode === 'multiplayer' && localPlayerIndex !== 0

  const myIndex = localPlayerIndex
  const displayName = (seat: number) =>
    seat === myIndex ? myName ?? 'You' : seats[seat]?.name ?? `Player ${seat + 1}`
  // The server is the sole authority on the final score (it applies the
  // leftover-rack deduction) — read the most recently finished game for
  // this code rather than trusting the client's own in-memory scores.
  const latest = results?.games[0]
  const scores = latest?.scores ?? seats.map(() => 0)
  const bestScore = Math.max(...scores, 0)
  const winners = scores.flatMap((s, i) => (s === bestScore ? [i] : []))
  const winner =
    winners.length !== 1
      ? "It's a tie!"
      : winners[0] === myIndex
        ? 'You win!'
        : `${displayName(winners[0])} wins!`

  const order = scores
    .map((_, i) => i)
    .sort((a, b) => scores[b] - scores[a])

  return (
    <Modal show={gameOver}>
      <div className="flex flex-col gap-6 bg-surface rounded-lg shadow-xl w-[calc(100vw-40px)] min-w-72 max-w-sm p-6">
        <h2 className="text-2xl font-bold text-center">Game Over</h2>

        <div className="flex justify-around gap-4 text-center">
          {order.map((seat) => (
            <div className="flex-1" key={seat}>
              <div className="text-sm opacity-60 mb-2">
                {displayName(seat)}
              </div>
              <div className="text-3xl font-bold">{scores[seat]}</div>
            </div>
          ))}
        </div>

        <p className="text-center text-lg font-semibold">{winner}</p>

        <p className="text-center text-2xl font-bold">
          {order.map((seat) => wins[seat] ?? 0).join(' - ')}
        </p>

        {isGuest ? (
          <p className="text-center text-sm opacity-60">
            Waiting for host to start a new game…
          </p>
        ) : (
          <button className="button" onClick={newGame}>
            New Game
          </button>
        )}

        {mode === 'multiplayer' && (
          <button className="button" onClick={disconnect}>
            Leave Game
          </button>
        )}
      </div>
    </Modal>
  )
}
