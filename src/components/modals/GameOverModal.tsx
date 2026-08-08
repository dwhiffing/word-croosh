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
  const { mode, results, disconnect, myName, hostName, guestName } =
    useMultiplayerStore(
      useShallow((s) => ({
        mode: s.mode,
        results: s.results,
        disconnect: s.disconnect,
        myName: s.myName,
        hostName: s.hostName,
        guestName: s.guestName,
      })),
    )
  const wins = results?.wins ?? [0, 0]
  const isGuest = mode === 'multiplayer' && localPlayerIndex === 1

  const myIndex = localPlayerIndex
  const opponentIndex: 0 | 1 = myIndex === 0 ? 1 : 0
  const myDisplayName = myName ?? 'You'
  const opponentDisplayName =
    (myIndex === 0 ? guestName : hostName) ?? 'Opponent'
  // The server is the sole authority on the final score (it applies the
  // leftover-rack deduction) — read the most recently finished game for
  // this code rather than trusting the client's own in-memory scores.
  const latest = results?.games[0]
  const hostGuestScore: [number, number] = latest
    ? [latest.hostScore, latest.guestScore]
    : [0, 0]
  const myScore = hostGuestScore[myIndex]
  const opponentScore = hostGuestScore[opponentIndex]
  const winner =
    myScore > opponentScore
      ? 'You win!'
      : opponentScore > myScore
        ? `${opponentDisplayName} wins!`
        : "It's a tie!"

  return (
    <Modal show={gameOver}>
      <div className="flex flex-col gap-6 bg-surface rounded-lg shadow-xl w-[calc(100vw-40px)] min-w-72 max-w-sm p-6">
        <h2 className="text-2xl font-bold text-center">Game Over</h2>

        <div className="flex justify-around gap-4 text-center">
          <div className="flex-1">
            <div className="text-sm opacity-60 mb-2">{myDisplayName}</div>
            <div className="text-3xl font-bold">{myScore}</div>
          </div>
          <div className="w-px bg-current opacity-10" />
          <div className="flex-1">
            <div className="text-sm opacity-60 mb-2">{opponentDisplayName}</div>
            <div className="text-3xl font-bold">{opponentScore}</div>
          </div>
        </div>

        <p className="text-center text-lg font-semibold">{winner}</p>

        <p className="text-center text-2xl font-bold">
          {wins[myIndex] ?? 0} - {wins[opponentIndex] ?? 0}
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
