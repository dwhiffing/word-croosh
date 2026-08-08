import { useEffect, useState } from 'react'
import {
  apiGetPlayerHistory,
  deviceId,
  type PlayerGameHistoryEntry,
} from '../../utils/api'
import { TILE_COLOR_HEX } from '../../utils/constants'
import { useGameStore } from '../../utils/gameStore'
import { BoardViewer } from './BoardViewer'
import { Modal } from './Modal'

function seatLabel(g: PlayerGameHistoryEntry, seat: number) {
  if (seat === g.you) return 'You'
  return g.seats.find((s) => s.seat === seat)?.name ?? `Player ${seat + 1}`
}

function opponentNames(g: PlayerGameHistoryEntry) {
  return g.seats
    .filter((s) => s.seat !== g.you)
    .map((s) => s.name ?? `Player ${s.seat + 1}`)
    .join(', ')
}

function scoreLine(g: PlayerGameHistoryEntry) {
  const myScore = g.scores[g.you]
  const otherScores = g.scores.filter((_, i) => i !== g.you)
  const result =
    g.winnerSeat == null ? 'Tie' : g.winnerSeat === g.you ? 'Won' : 'Lost'
  return `${result} ${myScore}-${otherScores.join('/')}`
}

function ColorDot({ color }: { color: string | null }) {
  if (!color) return null
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ background: TILE_COLOR_HEX[color as keyof typeof TILE_COLOR_HEX] }}
    />
  )
}

export function HistoryModal() {
  const show = useGameStore((s) => s.showHistoryModal)
  const onClose = useGameStore((s) => s.closeHistory)
  const [games, setGames] = useState<PlayerGameHistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<PlayerGameHistoryEntry | null>(null)

  useEffect(() => {
    if (!show) return
    let cancelled = false
    apiGetPlayerHistory(deviceId()).then(
      (result) => {
        if (cancelled) return
        setGames(result)
        setSelected(null)
        setError(null)
      },
      (e: Error) => {
        if (cancelled) return
        setError(e.message)
      },
    )
    return () => {
      cancelled = true
    }
  }, [show])

  return (
    <Modal show={show} onClose={selected ? () => setSelected(null) : onClose}>
      <div className="flex flex-col gap-4 bg-surface rounded-lg shadow-xl w-[calc(100vw-40px)] min-w-72 max-w-md p-6">
        {selected ? (
          <>
            <h2 className="text-xl font-bold">{scoreLine(selected)}</h2>
            <div className="flex flex-col gap-1 text-sm opacity-80">
              {selected.seats.map((s) => (
                <div key={s.seat} className="flex items-center gap-2">
                  <ColorDot color={s.color} />
                  <span>{seatLabel(selected, s.seat)}</span>
                  <span className="opacity-60">
                    {selected.scores[s.seat]}
                  </span>
                </div>
              ))}
            </div>
            {selected.finalState && (
              <BoardViewer cards={selected.finalState.cards} seats={selected.seats} />
            )}
            <button className="button" onClick={() => setSelected(null)}>
              Back
            </button>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold">My Games</h2>
            <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
              {error && <p className="text-red-400 text-sm">{error}</p>}
              {!error && games == null && (
                <p className="opacity-60 text-sm">Loading…</p>
              )}
              {games?.length === 0 && (
                <p className="opacity-60 text-sm">No finished games yet.</p>
              )}
              {games?.map((g, i) => (
                <button
                  key={`${g.code}-${g.finishedAt}-${i}`}
                  className="button w-full flex justify-between items-center px-3 py-2 text-left"
                  onClick={() => setSelected(g)}>
                  <span className="flex items-center gap-1.5 min-w-0">
                    {g.seats
                      .filter((s) => s.seat !== g.you)
                      .map((s) => (
                        <ColorDot key={s.seat} color={s.color} />
                      ))}
                    <span className="truncate">{opponentNames(g) || g.code}</span>
                  </span>
                  <span className="opacity-70 text-sm">{scoreLine(g)}</span>
                  <span className="opacity-40 text-xs">
                    {new Date(g.finishedAt).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </div>
            <button className="button" onClick={onClose}>
              Close
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
