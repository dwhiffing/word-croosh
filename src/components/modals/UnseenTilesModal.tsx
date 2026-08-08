import { BAG_PILE, LETTER_VALUES, RACK_PILE } from '../../utils/constants'
import { useGameStore } from '../../utils/gameStore'
import { Modal } from './Modal'

// Tiles the local player can't see: everything in the bag plus every
// opponent's rack, grouped by letter (blanks shown as "?"). Rendered with
// the same card-front/tile-front classes the real board tiles use (see
// index.css), not the interactive Tile component — this is a static count
// grid, not a positioned/draggable board tile.
export const UnseenTilesModal = () => {
  const show = useGameStore((s) => s.showUnseenModal)
  const closeUnseenTiles = useGameStore((s) => s.closeUnseenTiles)
  const cards = useGameStore((s) => s.cards)
  const localPlayerIndex = useGameStore((s) => s.localPlayerIndex)
  const playerCount = useGameStore((s) => s.playerCount)

  const ownRack = RACK_PILE[localPlayerIndex]
  const opponentRacks = RACK_PILE.slice(0, playerCount).filter(
    (p) => p !== ownRack,
  )
  const unseen = cards.filter(
    (c) => c.pileIndex === BAG_PILE || opponentRacks.includes(c.pileIndex),
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
        <div className="flex flex-wrap gap-3 max-h-[60vh] overflow-y-auto">
          {entries.map(([letter, count]) => (
            <div key={letter} className="flex flex-col items-center gap-1">
              <div
                className="card static"
                style={{ position: 'relative', width: 'var(--base-size)' }}>
                <div className="card-front tile-front">
                  {letter === '?' ? null : (
                    <>
                      <span className="tile-letter">{letter}</span>
                      {LETTER_VALUES[letter] > 0 && (
                        <span className="tile-value">
                          {LETTER_VALUES[letter]}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <span className="font-mono font-bold text-sm">×{count}</span>
            </div>
          ))}
        </div>
        <button className="button" onClick={closeUnseenTiles}>
          Close
        </button>
      </div>
    </Modal>
  )
}
