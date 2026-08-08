import { getTwoLetterWords } from '../../utils/dictionary'
import { useGameStore } from '../../utils/gameStore'
import { Modal } from './Modal'

export const TwoLetterWordsModal = () => {
  const show = useGameStore((s) => s.showTwoLetterModal)
  const closeTwoLetterWords = useGameStore((s) => s.closeTwoLetterWords)
  const words = getTwoLetterWords()

  return (
    <Modal show={show} onClose={closeTwoLetterWords}>
      <div className="flex flex-col gap-4 bg-surface rounded-lg shadow-xl w-[calc(100vw-40px)] min-w-72 max-w-md p-6">
        <h2 className="text-2xl font-bold">Two letter words</h2>
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono font-bold max-h-[60vh] overflow-y-auto">
          {words.map((word, i) => {
            // first word of each initial letter gets that letter in red
            const startsNewLetter = i === 0 || words[i - 1][0] !== word[0]
            return (
              <span key={word}>
                {startsNewLetter ? (
                  <>
                    <span className="text-red-500">{word[0]}</span>
                    {word.slice(1)}
                  </>
                ) : (
                  word
                )}
              </span>
            )
          })}
        </div>
        <button className="button" onClick={closeTwoLetterWords}>
          Close
        </button>
      </div>
    </Modal>
  )
}
