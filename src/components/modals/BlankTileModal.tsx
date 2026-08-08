import { useGameStore } from '../../utils/gameStore'
import { Modal } from './Modal'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

// Letter picker shown when a blank tile is played.
export const BlankTileModal = () => {
  const show = useGameStore((s) => s.blankPick !== null)
  const chooseBlankLetter = useGameStore((s) => s.chooseBlankLetter)
  const cancelBlankPick = useGameStore((s) => s.cancelBlankPick)

  return (
    <Modal show={show} onClose={cancelBlankPick}>
      <div className="flex flex-col gap-4 bg-surface rounded-lg shadow-xl w-[calc(100vw-40px)] min-w-72 max-w-md p-6">
        <h2 className="text-2xl font-bold">Blank tile</h2>
        <div className="grid grid-cols-6 gap-2">
          {LETTERS.map((letter) => (
            <button
              key={letter}
              className="button py-2 text-lg"
              onClick={() => chooseBlankLetter(letter)}>
              {letter}
            </button>
          ))}
        </div>
        <button className="button" onClick={cancelBlankPick}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
