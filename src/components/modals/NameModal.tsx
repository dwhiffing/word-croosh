import { useEffect, useState } from 'react'
import { TILE_COLOR_HEX, TILE_COLORS } from '../../utils/constants'
import { useMultiplayerStore } from '../../utils/multiplayerStore'
import { Modal } from './Modal'

const NAME_MAX = 12

export function NameModal() {
  const {
    showNameModal,
    myName,
    myColor,
    closeNameModal,
    setMyProfile,
    loginAsExisting,
  } = useMultiplayerStore()

  const [name, setName] = useState(myName ?? '')
  const [pin, setPin] = useState('')
  const [color, setColor] = useState(myColor ?? TILE_COLORS[0])
  const [mode, setMode] = useState<'create' | 'login'>('create')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // myName/myColor load asynchronously (apiGetPlayer resolves after mount),
  // so the initial useState above can capture stale/empty values — sync
  // whenever the modal opens with whatever profile has loaded by then.
  useEffect(() => {
    if (!showNameModal) return
    setName(myName ?? '')
    setColor(myColor ?? TILE_COLORS[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNameModal])

  // Only meaningful once a name already exists — first-time setup can't be
  // dismissed without picking one.
  const dismissible = myName != null
  const pinValid = /^\d{4}$/.test(pin)

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed || !pinValid) return
    setSaving(true)
    setError(null)
    try {
      if (mode === 'login') {
        await loginAsExisting(trimmed, pin)
      } else {
        await setMyProfile(trimmed, color, pin)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      show={showNameModal}
      onClose={dismissible ? closeNameModal : undefined}>
      <div className="flex flex-col gap-5 bg-surface rounded-lg shadow-xl w-[calc(100vw-40px)] min-w-72 max-w-sm p-6">
        <h2 className="text-2xl font-bold text-center">
          {dismissible
            ? 'Change Name'
            : mode === 'login'
              ? 'Recover Account'
              : 'Welcome!'}
        </h2>
        {!dismissible && (
          <p className="text-center text-sm opacity-70">
            {mode === 'login'
              ? 'Enter the name and PIN from your other device.'
              : 'Pick a name, a tile color, and a 4-digit PIN for your games.'}
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

        <input
          className="w-full py-2 px-4 rounded bg-on-surface text-white text-center text-lg tracking-widest"
          maxLength={4}
          inputMode="numeric"
          placeholder="4-digit PIN"
          value={pin}
          onChange={(e) =>
            setPin(e.target.value.replace(/\D/g, '').slice(0, 4))
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
          }}
        />

        {mode === 'create' && (
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
        )}

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        <button
          className="button w-full py-2 px-4 rounded bg-primary text-white font-bold disabled:opacity-40"
          disabled={!name.trim() || !pinValid || saving}
          onClick={() => void save()}>
          {saving ? 'Saving…' : mode === 'login' ? 'Submit' : 'Save'}
        </button>

        {!dismissible && (
          <button
            type="button"
            className="text-sm opacity-70 underline"
            onClick={() => {
              setMode(mode === 'login' ? 'create' : 'login')
              setError(null)
            }}>
            {mode === 'login'
              ? 'New here? Create a name instead'
              : 'Already have a name on another device?'}
          </button>
        )}
      </div>
    </Modal>
  )
}
