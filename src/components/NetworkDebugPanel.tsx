import { useNetworkDebugStore } from '../utils/networkDebug'

export function NetworkDebugPanel() {
  const { visible, lines } = useNetworkDebugStore()

  if (!visible) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-2 z-header flex justify-center px-2 lg:bottom-4">
      <div className="pointer-events-auto w-full max-w-3xl rounded-lg border border-white/15 bg-black/55 shadow-lg">
        <div className="flex items-center justify-between border-b border-white/15 px-3 py-2 text-xs lg:text-sm">
          <span className="font-bold tracking-wide">
            Network Debug{' '}
            <span className="font-normal text-white/50">{__BUILD_TIME__}</span>
          </span>
        </div>
        <div className="max-h-24 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-4 text-white/90">
          {lines.length === 0 ? (
            <div className="text-white/60">No logs yet.</div>
          ) : (
            lines.map((line, i) => <div key={i}>{line}</div>)
          )}
        </div>
      </div>
    </div>
  )
}
