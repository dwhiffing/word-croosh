import { useEffect, useState } from 'react'
import { BAG_PILE, isSquarePile, RACK_PILE, RACK_SIZE } from './constants'

export const useForceUpdate = () => {
  const [, setValue] = useState(0)
  return () => setValue((value) => ++value)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const useWindowEvent = (event: any, callback: any) => {
  useEffect(() => {
    window.addEventListener(event, callback)
    return () => window.removeEventListener(event, callback)
  }, [event, callback])
}

// Size of a single square/tile, read from a rendered board square.
// Must target a square specifically — the rack is also a `.pile` but much wider.
export const getPileSize = () => {
  const pileEl = document.querySelector('.pile.square') as HTMLDivElement | null
  return {
    width: pileEl?.offsetWidth ?? 0,
    height: pileEl?.offsetHeight ?? 0,
  }
}

const getPilePos = (pileIndex: number) => {
  const pileEl = document.querySelector(
    `.pile[data-pileindex="${pileIndex}"]`,
  ) as HTMLDivElement | null
  const pilePos = pileEl?.getBoundingClientRect()
  return { x: pilePos?.x ?? 0, y: pilePos?.y ?? 0 }
}

export const pileTypeOf = (
  pileIndex: number,
): 'bag' | 'board' | 'rack' => {
  if (pileIndex === BAG_PILE) return 'bag'
  if (pileIndex === RACK_PILE[0] || pileIndex === RACK_PILE[1]) return 'rack'
  if (isSquarePile(pileIndex)) return 'board'
  return 'board'
}

// Screen position of a tile. Board tiles sit exactly on their square.
// Rack tiles fan out across RACK_SIZE slots spanning the full rack, scaled
// up (around their center) to fill the rack height.
export const getCardPilePosition = (card: CardType) => {
  const pileType = pileTypeOf(card.pileIndex)
  const pilePos = getPilePos(card.pileIndex)

  if (pileType === 'rack') {
    const { width } = getPileSize()
    const rackEl = document.querySelector(
      `.pile[data-pileindex="${card.pileIndex}"]`,
    ) as HTMLDivElement | null
    const rackWidth = rackEl?.offsetWidth ?? width * RACK_SIZE
    const rackHeight = rackEl?.offsetHeight ?? width
    const step = rackWidth / RACK_SIZE
    const scale = Math.min(
      (rackHeight * 0.9) / width,
      (step * 0.95) / width,
    )
    // translate positions the unscaled box; scale grows around its center,
    // so center the box on its slot / the rack's midline
    const centerX = pilePos.x + step * (card.cardPileIndex + 0.5)
    return {
      x: centerX - width / 2,
      y: pilePos.y + (rackHeight - width) / 2,
      pileType,
      rotate: 0,
      scale,
    }
  }

  return {
    x: pilePos.x,
    y: pilePos.y,
    pileType,
    rotate: 0,
    scale: 1,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const loadStorage = (key: string): any => {
  const saved = localStorage.getItem(key)
  return saved ? JSON.parse(saved) : {}
}

export const saveStorage = (key: string, value: unknown) =>
  localStorage.setItem(key, JSON.stringify(value))

export const cn = (...args: (string | false | null | undefined)[]) =>
  args.filter(Boolean).join(' ')
