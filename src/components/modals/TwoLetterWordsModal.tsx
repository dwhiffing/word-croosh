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
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono max-h-[60vh] overflow-y-auto">
          {words.map((word, i) => {
            // first word of each initial letter gets that letter in red,
            // and starts on a new line of its own
            const startsNewLetter = i === 0 || words[i - 1][0] !== word[0]
            return (
              <div key={word} className="contents">
                {startsNewLetter && <span className="basis-full h-0" />}
                <span>
                  {startsNewLetter ? (
                    <>
                      <span className="font-black text-[#ffff00]">
                        {word[0]}
                      </span>
                      {word.slice(1)}
                    </>
                  ) : (
                    word
                  )}
                </span>
              </div>
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
