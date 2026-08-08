import { useGameStore } from '../../utils/gameStore'
import { Modal } from './Modal'

export const InstructionsModal = () => {
  const showInstructionsModal = useGameStore((s) => s.showInstructionsModal)
  const closeInstructions = useGameStore((s) => s.closeInstructions)

  return (
    <Modal show={showInstructionsModal} onClose={closeInstructions}>
      <div className="flex flex-col gap-4 bg-surface rounded-lg shadow-xl w-[calc(100vw-40px)] min-w-72 max-w-md p-6 text-base leading-relaxed">
        <h2 className="text-2xl font-bold">How to play</h2>
        <ul className="flex flex-col gap-2">
          <li>
            <b>Tap a board square</b> to pick where your word starts — tap it
            again to switch between ➡️ and ⬇️.
          </li>
          <li>
            Then <b>tap tiles</b> on your rack to play them; the arrow advances
            after each tile.
            <b>Drag rack tiles</b> to reorder them.
          </li>
          <li>
            The first word must cross the <b>center ★</b>. Later words must
            connect to tiles already on the board.
          </li>
          <li>
            Coloured squares multiply letters (<b>2L/3L</b>) or words (
            <b>2W/3W</b>). Using all 7 tiles scores a <b>+50</b> bonus.
          </li>
          <li>
            The game ends when the bag is empty and a rack is cleared, or after
            two passes each. Highest score wins.
          </li>
        </ul>
        <button className="button" onClick={closeInstructions}>
          Got it
        </button>
      </div>
    </Modal>
  )
}
