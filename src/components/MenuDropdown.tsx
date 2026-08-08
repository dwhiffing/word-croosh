import { useGameStore } from '../utils/gameStore'
import { useMultiplayerStore } from '../utils/multiplayerStore'
import { useNetworkDebugStore } from '../utils/networkDebug'
import { pushSupported } from '../utils/push'
import { Dropdown } from './Dropdown'

// The hamburger menu, shared by the Header and the in-game action row.
export function MenuDropdown({
  className,
  triggerClassName,
  openUp,
}: {
  className?: string
  triggerClassName?: string
  openUp?: boolean
}) {
  const openTwoLetterWords = useGameStore((s) => s.openTwoLetterWords)
  const openUnseenTiles = useGameStore((s) => s.openUnseenTiles)
  const openHistory = useGameStore((s) => s.openHistory)
  const gameActive = useGameStore((s) => s.cards.length > 0)
  const {
    mode,
    openLobby,
    disconnect,
    notificationsEnabled,
    enableNotifications,
    openNameModal,
  } = useMultiplayerStore()
  const { visible: showNetworkDebug, toggle: toggleNetworkDebug } =
    useNetworkDebugStore()

  return (
    <Dropdown
      className={className}
      triggerClassName={triggerClassName}
      openUp={openUp}
      label={<HamburgerSVG />}
      items={[
        ...(gameActive
          ? [
              {
                label: 'Two Letter Words',
                onClick: () => openTwoLetterWords(),
              },
              {
                label: 'Unseen Tiles',
                onClick: () => openUnseenTiles(),
              },
            ]
          : []),
        {
          label: 'My Games',
          onClick: () => openHistory(),
        },
        ...(pushSupported() && !notificationsEnabled
          ? [
              {
                label: 'Enable Notifications',
                onClick: () => void enableNotifications(),
              },
            ]
          : []),
        ...(mode !== 'multiplayer'
          ? [
              {
                label: 'Change Name',
                onClick: () => openNameModal(),
              },
              {
                label: 'Host Game',
                onClick: () => {
                  openLobby('hosting')
                  useMultiplayerStore.getState().hostGame()
                },
              },
              {
                label: 'Join Game',
                onClick: () => openLobby('joining'),
              },
            ]
          : []),
        ...(mode === 'multiplayer'
          ? [
              {
                label: 'Leave Multiplayer',
                onClick: () => disconnect(),
              },
            ]
          : []),
        {
          label: showNetworkDebug ? 'Hide Network Debug' : 'Show Network Debug',
          onClick: () => toggleNetworkDebug(),
          active: showNetworkDebug,
        },
      ]}
    />
  )
}

const HamburgerSVG = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
)
