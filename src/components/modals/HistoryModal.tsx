import { useEffect, useState } from 'react'
import {
  apiGetPlayerHistory,
  deviceId,
  type PlayerGameHistoryEntry,
} from '../../utils/api'
import { useGameStore } from '../../utils/gameStore'
import { BoardViewer } from './BoardViewer'
import { Modal } from './Modal'

function scoreLine(g: PlayerGameHistoryEntry) {
  const myScore = g.you === 0 ? g.hostScore : g.guestScore
  const oppScore = g.you === 0 ? g.guestScore : g.hostScore
  const result =
    g.winnerSeat == null
      ? 'Tie'
      : g.winnerSeat === g.you
        ? 'Won'
        : 'Lost'
  return `${result} ${myScore}-${oppScore}`
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
            {selected.finalState && (
              <BoardViewer cards={selected.finalState.cards} />
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
                  <span>{g.code}</span>
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
