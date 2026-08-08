import { useGameStore } from "../utils/gameStore";
import { MenuDropdown } from "./MenuDropdown";

export function Header() {
	const openInstructions = useGameStore((s) => s.openInstructions);

	return (
		<div className="flex justify-between items-center text-white py-2 px-3 lg:p-5 relative z-header pointer-events-none">
			<div className="flex-1 flex items-center gap-3 pointer-events-auto">
				<span className="text-lg lg:text-2xl whitespace-nowrap font-bold">
					WordCrꚙsh
				</span>
				<button
					className="button"
					onClick={openInstructions}
					title="Instructions"
				>
					?
				</button>
			</div>

			<div className="flex-1 flex items-center justify-end gap-2 pointer-events-auto">
				<MenuDropdown className="w-10" />
			</div>
		</div>
	);
}
