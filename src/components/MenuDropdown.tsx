import { useGameStore } from "../utils/gameStore";
import { useMultiplayerStore } from "../utils/multiplayerStore";
import { pushSupported } from "../utils/push";
import { Dropdown } from "./Dropdown";
import { HamburgerSVG } from "./svg";

// The hamburger menu, shared by the Header and the in-game action row.
export function MenuDropdown({
	className,
	triggerClassName,
	openUp,
}: {
	className?: string;
	triggerClassName?: string;
	openUp?: boolean;
}) {
	const openTwoLetterWords = useGameStore((s) => s.openTwoLetterWords);
	const openUnseenTiles = useGameStore((s) => s.openUnseenTiles);
	const gameActive = useGameStore((s) => s.cards.length > 0);
	const {
		mode,
		openLobby,
		disconnect,
		notificationsEnabled,
		enableNotifications,
		showNetworkDebug,
		toggleNetworkDebug,
	} = useMultiplayerStore();

	return (
		<Dropdown
			className={className}
			triggerClassName={triggerClassName}
			openUp={openUp}
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
				...(pushSupported() && !notificationsEnabled
					? [
							{
								label: "Enable Notifications",
								onClick: () => void enableNotifications(),
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
	);
}
