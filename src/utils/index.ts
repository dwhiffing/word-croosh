import { useEffect, useState } from 'react'
import { BAG_PILE, isSquarePile, RACK_PILE } from './constants'

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
// Rack tiles fan out horizontally within the rack container.
export const getCardPilePosition = (card: CardType) => {
  const pileType = pileTypeOf(card.pileIndex)
  const pilePos = getPilePos(card.pileIndex)
  let offsetX = 0
  const offsetY = 0

  if (pileType === 'rack') {
    const { width } = getPileSize()
    const rackEl = document.querySelector(
      `.pile[data-pileindex="${card.pileIndex}"]`,
    ) as HTMLDivElement | null
    const rackWidth = rackEl?.offsetWidth ?? width * 7
    const rackHeight = rackEl?.offsetHeight ?? width
    const step = width * 1.05
    // center the 7-tile fan within the rack, and vertically inside it
    const inset = (rackWidth - step * 7) / 2 + (step - width) / 2
    offsetX = inset + card.cardPileIndex * step
    return {
      x: pilePos.x + offsetX,
      y: pilePos.y + (rackHeight - width) / 2,
      pileType,
      rotate: 0,
    }
  }

  return {
    x: pilePos.x + offsetX,
    y: pilePos.y + offsetY,
    pileType,
    rotate: 0,
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
