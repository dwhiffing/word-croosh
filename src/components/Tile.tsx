import debounce from 'lodash/debounce'
import { memo, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getCardPilePosition, useForceUpdate, useWindowEvent } from '../utils'
import {
  CARD_TRANSITION_DURATION,
  RACK_PILE,
  TILE_COLOR_HEX,
} from '../utils/constants'
import { type GameState, useGameStore } from '../utils/gameStore'
import { useMultiplayerStore } from '../utils/multiplayerStore'

const Tile = ({ cardId }: { cardId: number }) => {
  const store = useGameStore(useShallow(getShallowTileState(cardId)))
  // Colors are a multiplayer-profile concept, not game state — read them
  // separately so a solo/AI game (no colors set) just renders the default.
  const { hostColor, guestColor } = useMultiplayerStore(
    useShallow((s) => ({ hostColor: s.hostColor, guestColor: s.guestColor })),
  )
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
  const ownerColor = store.owner === 0 ? hostColor : store.owner === 1 ? guestColor : null

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
        translate,
        willChange: 'transform',
        opacity: store.opacity,
      }}>
      <div
        className="card-front tile-front"
        style={
          ownerColor
            ? {
                background: TILE_COLOR_HEX[ownerColor],
                color: '#000',
              }
            : undefined
        }>
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
    const { cardPileIndex, pileIndex, letter, value, isBlank, placedBy } = card
    const { mouseX, mouseY, pressed } = state.cursorState
    const {
      x: xPos,
      y: yPos,
      pileType,
      scale: pileScale,
    } = getCardPilePosition(card)

    const isActive = cardId === state.activeCard?.id
    const isInBag = pileIndex === 0
    const ownRack = RACK_PILE[state.localPlayerIndex]
    const oppRack = RACK_PILE[state.localPlayerIndex === 0 ? 1 : 0]
    // hide identities of bag tiles and the opponent's rack tiles
    const isFaceDown = isInBag || pileIndex === oppRack
    const isDragging = isActive && pressed

    const x = isDragging ? mouseX : xPos
    const y = isDragging ? mouseY : yPos

    const isLastPlay = state.lastPlay?.tileIds.includes(cardId) ?? false
    const isSwapSelected = state.swapMode && state.swapIds.includes(cardId)
    const isOnBoard = pileIndex >= 1 && pileIndex <= 225
    // opponent-rack tiles collapse into a neat stacked pile; own-rack fans out
    const opacity = pileIndex === oppRack || isInBag ? 0 : 1

    const scale = isDragging ? pileScale * 1.05 : pileScale

    const zIndex = isOnBoard ? 10 : pileIndex === ownRack ? 100 : 0

    // Whose color this tile shows: on the board that's whoever committed it
    // (permanent) — or, if it's still pending (placed but not submitted),
    // the local player, since only they can have tiles pending. In a rack
    // it's whoever's rack it's currently sitting in; the bag has no owner.
    const isPending = state.pending.includes(cardId)
    const owner: 0 | 1 | null = isOnBoard
      ? placedBy ?? (isPending ? state.localPlayerIndex : null)
      : pileIndex === RACK_PILE[0]
        ? 0
        : pileIndex === RACK_PILE[1]
          ? 1
          : null

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
      owner,
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
  owner: 0 | 1 | null
}

export default memo(Tile)
