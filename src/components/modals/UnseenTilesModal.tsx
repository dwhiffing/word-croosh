import { BAG_PILE, RACK_PILE } from '../../utils/constants'
import { useGameStore } from '../../utils/gameStore'
import { Modal } from './Modal'

// Tiles the local player can't see: everything in the bag plus the
// opponent's rack, grouped by letter (blanks shown as "?").
export const UnseenTilesModal = () => {
  const show = useGameStore((s) => s.showUnseenModal)
  const closeUnseenTiles = useGameStore((s) => s.closeUnseenTiles)
  const cards = useGameStore((s) => s.cards)
  const localPlayerIndex = useGameStore((s) => s.localPlayerIndex)

  const oppRack = RACK_PILE[localPlayerIndex === 0 ? 1 : 0]
  const unseen = cards.filter(
    (c) => c.pileIndex === BAG_PILE || c.pileIndex === oppRack,
  )
  const counts = new Map<string, number>()
  for (const c of unseen) {
    const key = c.isBlank ? '?' : c.letter
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const entries = [...counts.entries()].sort((a, b) =>
    a[0] === '?' ? 1 : b[0] === '?' ? -1 : a[0].localeCompare(b[0]),
  )

  return (
    <Modal show={show} onClose={closeUnseenTiles}>
      <div className="flex flex-col gap-4 bg-surface rounded-lg shadow-xl w-[calc(100vw-40px)] min-w-72 max-w-md p-6">
        <h2 className="text-2xl font-bold">Unseen tiles ({unseen.length})</h2>
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono font-bold max-h-[60vh] overflow-y-auto">
          {entries.map(([letter, count]) => (
            <span key={letter}>
              {letter}×{count}
            </span>
          ))}
        </div>
        <button className="button" onClick={closeUnseenTiles}>
          Close
        </button>
      </div>
    </Modal>
  )
}
