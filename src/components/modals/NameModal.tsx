import { useState } from 'react'
import { TILE_COLOR_HEX, TILE_COLORS } from '../../utils/constants'
import { useMultiplayerStore } from '../../utils/multiplayerStore'
import { Modal } from './Modal'

const NAME_MAX = 12

export function NameModal() {
  const { showNameModal, myName, myColor, closeNameModal, setMyProfile } =
    useMultiplayerStore()
  const [name, setName] = useState(myName ?? '')
  const [color, setColor] = useState(myColor ?? TILE_COLORS[0])
  const [saving, setSaving] = useState(false)

  // Only meaningful once a name already exists — first-time setup can't be
  // dismissed without picking one.
  const dismissible = myName != null

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await setMyProfile(trimmed, color)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal show={showNameModal} onClose={dismissible ? closeNameModal : undefined}>
      <div className="flex flex-col gap-5 bg-surface rounded-lg shadow-xl w-[calc(100vw-40px)] min-w-72 max-w-sm p-6">
        <h2 className="text-2xl font-bold text-center">
          {dismissible ? 'Change Name' : 'Welcome!'}
        </h2>
        {!dismissible && (
          <p className="text-center text-sm opacity-70">
            Pick a name and a tile color for your games.
          </p>
        )}

        <input
          className="w-full py-2 px-4 rounded bg-on-surface text-white text-center text-lg"
          maxLength={NAME_MAX}
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
          }}
          autoFocus
        />

        <div className="grid grid-cols-4 gap-3 justify-center">
          {TILE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setColor(c)}
              className={`w-10 h-10 rounded-full mx-auto ${
                color === c ? 'ring-4 ring-white' : ''
              }`}
              style={{ background: TILE_COLOR_HEX[c] }}
            />
          ))}
        </div>

        <button
          className="button w-full py-2 px-4 rounded bg-primary text-white font-bold disabled:opacity-40"
          disabled={!name.trim() || saving}
          onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
