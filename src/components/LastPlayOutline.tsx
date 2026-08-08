import debounce from 'lodash/debounce'
import { useShallow } from 'zustand/react/shallow'
import {
  getCardPilePosition,
  getPileSize,
  useForceUpdate,
  useWindowEvent,
} from '../utils'
import { useGameStore } from '../utils/gameStore'

// A single border drawn around the whole most-recently-played word, rather
// than around each tile individually — computed as the bounding box of the
// word's tiles' board positions.
export function LastPlayOutline() {
  useWindowEvent('resize', debounce(useForceUpdate(), 100))
  const { tileIds, cards } = useGameStore(
    useShallow((s) => ({
      tileIds: s.lastPlay?.tileIds ?? null,
      cards: s.cards,
    })),
  )
  if (!tileIds || tileIds.length === 0) return null

  const positions = tileIds.map((id) => getCardPilePosition(cards[id]))
  const { width, height } = getPileSize()
  if (!width || !height) return null

  const minX = Math.min(...positions.map((p) => p.x))
  const minY = Math.min(...positions.map((p) => p.y))
  const maxX = Math.max(...positions.map((p) => p.x)) + width
  const maxY = Math.max(...positions.map((p) => p.y)) + height

  return (
    <div
      className="last-play-outline"
      style={{
        translate: `${minX}px ${minY}px`,
        width: maxX - minX,
        height: maxY - minY,
      }}
    />
  )
}
