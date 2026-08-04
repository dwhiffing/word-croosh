import { useGameStore } from "../utils/gameStore";
import { useMultiplayerStore } from "../utils/multiplayerStore";
import { Dropdown } from "./Dropdown";
import { HamburgerSVG } from "./svg";

export function Header() {
	// const newGame = useGameStore((s) => s.newGame)
	const openInstructions = useGameStore((s) => s.openInstructions);
	const openTwoLetterWords = useGameStore((s) => s.openTwoLetterWords);
	const openUnseenTiles = useGameStore((s) => s.openUnseenTiles);
	const gameActive = useGameStore((s) => s.cards.length > 0);
	const { mode, openLobby, disconnect, showNetworkDebug, toggleNetworkDebug } =
		useMultiplayerStore();

	return (
		<div className="flex justify-between items-center text-white py-2 px-3 lg:p-5 relative z-header pointer-events-none">
			<div className="flex-1 flex items-center gap-3 pointer-events-auto">
				<span className="text-lg lg:text-2xl whitespace-nowrap font-bold">
					WordCrüsh
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
				<Dropdown
					className="w-10"
					label={<HamburgerSVG />}
					items={[
						...(gameActive
							? [
									{
										label: "Two Letter Words",
										onClick: () => openTwoLetterWords(),
									},
									{
										label: "Unseen Tiles",
										onClick: () => openUnseenTiles(),
									},
								]
							: []),
						...(mode !== "multiplayer"
							? [
									{
										label: "Host Game",
										onClick: () => {
											openLobby("hosting");
											useMultiplayerStore.getState().hostGame();
										},
									},
									{
										label: "Join Game",
										onClick: () => openLobby("joining"),
									},
									// {
									//   label: 'Local Game vs AI',
									//   onClick: () => newGame(),
									// },
								]
							: []),
						...(mode === "multiplayer"
							? [
									{
										label: "Leave Multiplayer",
										onClick: () => disconnect(),
									},
								]
							: []),
						{
							label: showNetworkDebug
								? "Hide Network Debug"
								: "Show Network Debug",
							onClick: () => toggleNetworkDebug(),
							active: showNetworkDebug,
						},
					]}
				/>
			</div>
		</div>
	);
}
