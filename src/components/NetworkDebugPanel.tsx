import { useMultiplayerStore } from '../utils/multiplayerStore'

export function NetworkDebugPanel() {
  const { showNetworkDebug, networkDebugLines, checkNetworkPath } =
    useMultiplayerStore()

  if (!showNetworkDebug) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-2 z-header flex justify-center px-2 lg:bottom-4">
      <div className="pointer-events-auto w-full max-w-3xl rounded-lg border border-white/15 bg-black/55 shadow-lg">
        <div className="flex items-center justify-between border-b border-white/15 px-3 py-2 text-xs lg:text-sm">
          <span className="font-bold tracking-wide">Network Debug</span>
          <button
            className="button pointer-events-auto py-1! text-xs"
            onClick={checkNetworkPath}>
            Check Path
          </button>
        </div>
        <div className="max-h-24 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-4 text-white/90">
          {networkDebugLines.length === 0 ? (
            <div className="text-white/60">No logs yet.</div>
          ) : (
            networkDebugLines.map((line, i) => <div key={i}>{line}</div>)
          )}
        </div>
      </div>
    </div>
  )
}
