import { useGameStore } from '../utils/gameStore'
import { MenuDropdown } from './MenuDropdown'
import { Scores } from './Scores'

export function Header() {
  const openInstructions = useGameStore((s) => s.openInstructions)
  const started = useGameStore((s) => s.cards.length > 0)

  return (
    <div className="flex justify-between items-center text-white pt-5 px-3 lg:px-5 relative z-header pointer-events-none">
      <div className="flex-1 flex items-center gap-3 pointer-events-auto">
        <span className="text-lg lg:text-2xl whitespace-nowrap font-bold">
          WordCrꚙsh
        </span>
        <button
          className="button"
          onClick={openInstructions}
          title="Instructions">
          ?
        </button>
      </div>

      {started && (
        <div className="hidden squarish:block absolute left-1/2 -translate-x-1/2 text-center pointer-events-none max-w-[45%] overflow-hidden text-ellipsis">
          <Scores />
        </div>
      )}

      <div className="flex-1 flex items-center justify-end gap-2 pointer-events-auto">
        <MenuDropdown className="w-10" />
      </div>
    </div>
  )
}
