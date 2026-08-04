import { useShallow } from 'zustand/react/shallow'
import { useGameStore } from '../utils/gameStore'
import { useMultiplayerStore } from '../utils/multiplayerStore'
import { Modal } from './Modal'

export const GameOverModal = () => {
  const { gameOver, scores, newGame, localPlayerIndex } = useGameStore(
    useShallow((state) => ({
      gameOver: state.gameOver,
      scores: state.scores,
      newGame: state.newGame,
      localPlayerIndex: state.localPlayerIndex,
    })),
  )
  const { mode, wins, disconnect } = useMultiplayerStore(
    useShallow((s) => ({
      mode: s.mode,
      wins: s.wins,
      disconnect: s.disconnect,
    })),
  )
  const isGuest = mode === 'multiplayer' && localPlayerIndex === 1

  const myIndex = localPlayerIndex
  const opponentIndex: 0 | 1 = myIndex === 0 ? 1 : 0
  const myScore = scores[myIndex]
  const opponentScore = scores[opponentIndex]
  const winner =
    myScore > opponentScore
      ? 'You win!'
      : opponentScore > myScore
        ? 'Opponent wins!'
        : "It's a tie!"

  return (
    <Modal show={gameOver}>
      <div className="flex flex-col gap-6 bg-surface rounded-lg shadow-xl w-[calc(100vw-40px)] min-w-72 max-w-sm p-6">
        <h2 className="text-2xl font-bold text-center">Game Over</h2>

        <div className="flex justify-around gap-4 text-center">
          <div className="flex-1">
            <div className="text-sm opacity-60 mb-2">You</div>
            <div className="text-3xl font-bold">{myScore}</div>
          </div>
          <div className="w-px bg-current opacity-10" />
          <div className="flex-1">
            <div className="text-sm opacity-60 mb-2">Opponent</div>
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
