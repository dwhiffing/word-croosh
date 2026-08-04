import debounce from 'lodash/debounce'
import { memo, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  getCardPilePosition,
  getPileSize,
  useForceUpdate,
  useWindowEvent,
} from '../utils'
import { CARD_TRANSITION_DURATION, RACK_PILE } from '../utils/constants'
import { type GameState, useGameStore } from '../utils/gameStore'

const Tile = ({ cardId }: { cardId: number }) => {
  const store = useGameStore(useShallow(getShallowTileState(cardId)))
  const [zIndex, setZIndex] = useState(store.zIndex)
  const [hasMounted, setHasMounted] = useState(false)
  useWindowEvent('resize', debounce(useForceUpdate(), 100))
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setHasMounted(true), [])

  useEffect(() => {
    const t = setTimeout(
      () => setZIndex(store.zIndex),
      CARD_TRANSITION_DURATION / 2,
    )
    return () => clearTimeout(t)
  }, [store.zIndex])

  if (!hasMounted) return null

  const translate = `${store.x}px ${store.y}px 0`
  const dur = store.isDragging ? 0 : CARD_TRANSITION_DURATION

  return (
    <div
      data-id={store.opacity === 1 ? cardId : undefined}
      className={`card ${store.isFaceDown ? 'face-down' : ''} ${
        store.isDragging ? 'active' : 'inactive'
      } ${store.isLastPlay ? 'last-play' : ''} ${
        store.isSwapSelected ? 'swap-selected' : ''
      }`}
      style={{
        zIndex: store.isDragging ? 99999 : zIndex,
        scale: store.scale,
        transitionProperty: 'translate, scale, opacity',
        transitionDuration: `${dur}ms`,
        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.6, 1)',
        transitionDelay: `${store.transitionDelay}ms`,
        translate,
        willChange: 'transform',
        opacity: store.opacity,
      }}>
      <div className="card-front tile-front">
        {store.isBlank && !store.letter ? null : (
          <>
            <span className="tile-letter">{store.letter}</span>
            {store.value > 0 && (
              <span className="tile-value">{store.value}</span>
            )}
          </>
        )}
      </div>
      <div className="card-back" />
    </div>
  )
}

const getShallowTileState =
  (cardId: number) =>
  (state: GameState): TileShallowState => {
    const card = state.cards[cardId]
    const { cardPileIndex, pileIndex, letter, value, isBlank } = card
    const { mouseX, mouseY, pressed } = state.cursorState
    const {
      x: xPos,
      y: yPos,
      pileType,
      scale: pileScale,
    } = getCardPilePosition(card)
    const { width, height } = getPileSize()

    const isActive = cardId === state.activeCard?.id
    const isShuffling = state.dealPhase === 0
    const isInBag = pileIndex === 0
    const ownRack = RACK_PILE[state.localPlayerIndex]
    const oppRack = RACK_PILE[state.localPlayerIndex === 0 ? 1 : 0]
    // hide identities of bag tiles and the opponent's rack tiles
    const isFaceDown = isInBag || pileIndex === oppRack || isShuffling
    const isDragging = isActive && pressed

    const bagX = window.innerWidth / 2 - width / 2
    const bagY = window.innerHeight / 2 - height / 2

    const x = isShuffling ? bagX : isDragging ? mouseX : xPos
    const y = isShuffling ? bagY : isDragging ? mouseY : yPos

    const isLastPlay = state.lastPlay?.tileIds.includes(cardId) ?? false
    const isSwapSelected = state.swapMode && state.swapIds.includes(cardId)
    const isOnBoard = pileIndex >= 1 && pileIndex <= 225
    // opponent-rack tiles collapse into a neat stacked pile; own-rack fans out
    const opacity = pileIndex === oppRack || isInBag ? 0 : 1

    const scale = isDragging ? pileScale * 1.05 : pileScale

    const zIndex = isOnBoard ? 10 : pileIndex === ownRack ? 100 : 0

    return {
      x,
      y,
      scale,
      isActive,
      isDragging,
      isLastPlay,
      isSwapSelected,
      pileType,
      isFaceDown,
      opacity,
      cardPileIndex,
      zIndex,
      letter,
      value,
      isBlank,
      transitionDelay:
        state.dealPhase === 1 ? (cardId % 14) * (CARD_TRANSITION_DURATION / 20) : 0,
    }
  }

type TileShallowState = {
  x: number
  y: number
  scale: number
  isActive: boolean
  isDragging: boolean
  isLastPlay: boolean
  isSwapSelected: boolean
  pileType: string
  isFaceDown: boolean
  opacity: number
  cardPileIndex: number
  zIndex: number
  letter: string
  value: number
  isBlank: boolean
  transitionDelay: number
}

export default memo(Tile)
