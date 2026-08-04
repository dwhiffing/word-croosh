import { useGameStore } from '../utils/gameStore'
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
            <b>Drag tiles</b> from your rack onto empty board squares to build a
            word.
          </li>
          <li>
            The first word must cross the <b>center ★</b>. Later words must
            connect to tiles already on the board.
          </li>
          <li>
            All tiles you place must sit in a single <b>row or column</b> with
            no gaps.
          </li>
          <li>
            Press <b>Submit</b> to score. Only real dictionary words are
            accepted. <b>Recall</b> pulls your tiles back; <b>Pass</b> skips
            your turn.
          </li>
          <li>
            Coloured squares multiply letters (<b>DL/TL</b>) or words (
            <b>DW/TW</b>). Using all 7 tiles scores a <b>+50</b> bonus.
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
