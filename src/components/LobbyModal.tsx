import { useState } from 'react'
import { useMultiplayerStore } from '../utils/multiplayerStore'
import { Modal } from './Modal'

function getGameCode(): string {
  const url = new URL(window.location.href)
  return url.searchParams.get('join') || ''
}

function getShareUrl(code: string): string {
  const url = new URL(window.location.href)
  url.searchParams.delete('host')
  url.searchParams.delete('join')
  url.searchParams.set('join', code)
  return url.toString()
}

export function LobbyModal() {
  const { showLobbyModal, lobbyPhase, gameCode, error, closeLobby, joinGame } =
    useMultiplayerStore()
  const [inputCode, setInputCode] = useState(getGameCode())
  const [copied, setCopied] = useState(false)

  const handleShare = async () => {
    if (!gameCode) return
    const url = getShareUrl(gameCode)

    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    await navigator.clipboard.writeText(url)
  }

  return (
    <Modal show={showLobbyModal} onClose={closeLobby}>
      <div className="flex flex-col gap-6 bg-surface rounded-lg shadow-xl w-[calc(100vw-40px)] min-w-72 max-w-sm p-6">
        <h2 className="text-2xl font-bold text-center">Multiplayer</h2>

        {lobbyPhase === 'hosting' && (
          <div className="flex flex-col gap-4 items-center">
            <p className="text-center text-sm opacity-70">
              Share this code with your opponent:
            </p>
            <div className="text-5xl font-mono font-bold tracking-widest text-primary">
              {gameCode}
            </div>
            <p className="text-center text-sm opacity-70">
              Waiting for opponent to join…
            </p>
            <button
              className="button w-full py-2 px-4 rounded bg-primary text-white font-bold"
              onClick={handleShare}
              type="button">
              {copied ? 'Link Copied!' : 'Share Link'}
            </button>
            <button
              className="button w-full py-2 px-4 rounded bg-on-surface text-white"
              onClick={closeLobby}>
              Cancel
            </button>
          </div>
        )}

        {lobbyPhase === 'joining' && (
          <div className="flex flex-col gap-4">
            <p className="text-center text-sm opacity-70">
              Enter the game code:
            </p>
            <input
              className="w-full py-2 px-4 rounded bg-on-surface text-white text-center text-2xl font-mono tracking-widest uppercase"
              maxLength={4}
              placeholder="XXXX"
              value={inputCode}
              onChange={(e) =>
                setInputCode(
                  e.target.value.toUpperCase().replace(/[^A-Z]/g, ''),
                )
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputCode.length === 4)
                  joinGame(inputCode)
              }}
              autoFocus={showLobbyModal}
            />
            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
            <button
              className="button w-full py-2 px-4 rounded bg-primary text-white font-bold disabled:opacity-40"
              disabled={inputCode.length < 4}
              onClick={() => joinGame(inputCode)}>
              Connect
            </button>
            <button
              className="button w-full py-2 px-4 rounded bg-on-surface text-white"
              onClick={closeLobby}>
              Cancel
            </button>
          </div>
        )}

        {lobbyPhase === 'connecting' && (
          <div className="flex flex-col gap-4 items-center">
            <p className="text-center text-sm opacity-70">Connecting…</p>
            <div className="text-5xl font-mono font-bold tracking-widest text-primary">
              {inputCode}
            </div>
            <button
              className="button w-full py-2 px-4 rounded bg-on-surface text-white"
              onClick={closeLobby}>
              Cancel
            </button>
          </div>
        )}

        {error && lobbyPhase !== 'joining' && (
          <p className="text-red-400 text-sm text-center">{error}</p>
        )}
      </div>
    </Modal>
  )
}
