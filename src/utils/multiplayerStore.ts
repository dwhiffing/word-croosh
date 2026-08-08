// Multiplayer over the game server (Cloudflare Worker + Neon Postgres).
//
// The server row holds the authoritative game snapshot; this store is a
// thin reconciler around it. After every settled local change the snapshot
// is uploaded (optimistic version check); a poll loop (paused while the tab
// is hidden) fetches the row and adopts the server state whenever it has
// seen more moves than we have. That one rule covers opponent moves,
// reloads, backgrounding, conflicts — everything the old P2P layer needed
// bespoke machinery for.

import { create } from "zustand";
import {
	apiCreateGame,
	apiGetGame,
	apiJoinGame,
	apiPutPushSub,
	apiPutState,
	type GameData,
	type SavedGameState,
} from "./api";
import { clearTurnNotifications, enablePush, initPush } from "./push";

export type { SavedGameState } from "./api";

const DEBUG_KEY = "word-croosh-network-debug-visible";
const LAST_GAME_KEY = "word-croosh-last-game";
const POLL_MS = 3500;

export type LastGame = { code: string; role: 0 | 1 };

function loadLastGame(): LastGame | null {
	try {
		const raw = localStorage.getItem(LAST_GAME_KEY);
		return raw ? (JSON.parse(raw) as LastGame) : null;
	} catch {
		return null;
	}
}

function saveLastGame(code: string, role: 0 | 1) {
	const lastGame: LastGame = { code: code.toUpperCase(), role };
	localStorage.setItem(LAST_GAME_KEY, JSON.stringify(lastGame));
	useMultiplayerStore.setState({ lastGame });
}

function clearLastGame() {
	localStorage.removeItem(LAST_GAME_KEY);
	useMultiplayerStore.setState({ lastGame: null });
}

function getDebugPanelInitialState(): boolean {
	return localStorage.getItem(DEBUG_KEY) === "1";
}

const MAX_DEBUG_LINES = 50;
let networkDebugSink: ((line: string) => void) | null = null;

function pushNetworkDebug(line: string) {
	networkDebugSink?.(`[${new Date().toLocaleTimeString()}] ${line}`);
}

export type TilePlacement = { tileId: number; pile: number; letter: string };

// Kept for the game store's sendMove call sites; moves now travel to the
// opponent as full state snapshots rather than as messages.
export type MoveData =
	| { type: "commit"; placements: TilePlacement[] }
	| { type: "pass" }
	| { type: "swap"; tileIds: number[] };

export type LobbyPhase = "hosting" | "joining" | "connecting";

export interface MultiplayerState {
	mode: "ai" | "multiplayer";
	showLobbyModal: boolean;
	lobbyPhase: LobbyPhase;
	gameCode: string | null;
	peerConnected: boolean;
	reconnecting: boolean;
	error: string | null;
	wins: [number, number];
	lastWinnerIndex: 0 | 1 | null;
	lastGame: LastGame | null; // most recent game, for the reconnect option
	notificationsEnabled: boolean;
	showNetworkDebug: boolean;
	networkDebugLines: string[];
}

interface MultiplayerStore extends MultiplayerState {
	openLobby: (phase: Exclude<LobbyPhase, "connecting">) => void;
	closeLobby: () => void;
	hostGame: (code?: string) => void;
	joinGame: (code: string) => void;
	startNewGame: () => void;
	reconnectLastGame: () => void;
	recordResult: (winnerIndex: 0 | 1) => void;
	sendMove: (move: MoveData) => void;
	enableNotifications: () => Promise<void>;
	disconnect: () => void;
	toggleNetworkDebug: () => void;
}

// Callbacks wired up by gameStore after both stores are created
let onGameStartCallback:
	| ((seed: number, localPlayerIndex: 0 | 1) => void)
	| null = null;
let onGameResumeCallback:
	| ((state: SavedGameState, localPlayerIndex: 0 | 1) => void)
	| null = null;
let onDisconnectCallback: (() => void) | null = null;
let onHostReadyToStartCallback: (() => void) | null = null;
let onRemoteMoveCallback: ((move: MoveData) => void) | null = null;

export const setOnGameStart = (
	fn: (seed: number, localPlayerIndex: 0 | 1) => void,
) => {
	onGameStartCallback = fn;
};
export const setOnGameResume = (
	fn: (state: SavedGameState, localPlayerIndex: 0 | 1) => void,
) => {
	onGameResumeCallback = fn;
};
export const setOnDisconnect = (fn: () => void) => {
	onDisconnectCallback = fn;
};
export const setOnHostReadyToStart = (fn: () => void) => {
	onHostReadyToStartCallback = fn;
};
export const setOnRemoteMove = (fn: (move: MoveData) => void) => {
	onRemoteMoveCallback = fn;
	void onRemoteMoveCallback; // moves arrive as snapshots now
};

// Provides a sanitized snapshot of the live game (null when no game is
// running); wired up by gameStore.
let gameSnapshotProvider: (() => SavedGameState | null) | null = null;
export const setGameSnapshotProvider = (fn: () => SavedGameState | null) => {
	gameSnapshotProvider = fn;
};

// ── Sync engine ─────────────────────────────────────────────────────
let localPlayerIndex: 0 | 1 = 0;
let serverVersion = 0;
let currentSeed: number | null = null; // seed of the game we've started locally
let lastUploadedCount = -1;
let uploading = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling() {
	if (pollTimer) return;
	pollTimer = setInterval(() => void pollTick(), POLL_MS);
}

function stopPolling() {
	if (pollTimer) clearInterval(pollTimer);
	pollTimer = null;
}

async function pollTick(force = false) {
	const s = useMultiplayerStore.getState();
	if (!s.gameCode) return;
	if (!force && document.visibilityState !== "visible") return;
	if (uploading) return;
	try {
		const data = await apiGetGame(s.gameCode, serverVersion);
		if (!data) return; // game row is gone (expired)
		if (s.reconnecting) useMultiplayerStore.setState({ reconnecting: false });
		if (data.changed === false) {
			// nothing new server-side; retry a failed upload if we're ahead
			void uploadState();
			return;
		}
		serverVersion = data.version;
		reconcile(data);
	} catch (e) {
		useMultiplayerStore.setState({ reconnecting: true });
		pushNetworkDebug(`Poll failed: ${(e as Error).message}`);
	}
}

// Compare the server row with local state and converge on whichever has
// seen more of the game.
function reconcile(data: GameData) {
	const store = useMultiplayerStore;
	const s = store.getState();

	// The server knows which seat this device holds — it beats whatever role
	// we claimed from the URL or saved state.
	let seatCorrected = false;
	if (data.you != null && data.you !== localPlayerIndex) {
		pushNetworkDebug(`Server corrected our seat to player ${data.you}`);
		localPlayerIndex = data.you;
		seatCorrected = true;
		if (s.gameCode) saveLastGame(s.gameCode, data.you);
	}

	// Host waiting in the lobby: the guest just joined — deal a game.
	if (
		localPlayerIndex === 0 &&
		!data.state &&
		data.guestJoined &&
		!s.peerConnected
	) {
		store.setState({
			peerConnected: true,
			reconnecting: false,
			mode: "multiplayer",
			showLobbyModal: false,
		});
		pushNetworkDebug("Opponent joined — starting game");
		onHostReadyToStartCallback?.();
		return;
	}
	if (!data.state) return;

	const state = data.state;
	store.setState({
		peerConnected: true,
		reconnecting: false,
		mode: "multiplayer",
		showLobbyModal: false,
		wins: state.wins ?? s.wins,
		lastWinnerIndex: state.lastWinnerIndex ?? s.lastWinnerIndex,
	});

	const localCount = gameSnapshotProvider?.()?.moveCount ?? -1;
	const serverCount = state.moveCount ?? 0;

	// A deal we haven't started locally (initial game or rematch): play the
	// deal animation from the seed instead of restoring the snapshot.
	if (
		data.seed != null &&
		data.seed !== currentSeed &&
		serverCount === 0 &&
		!state.gameOver
	) {
		currentSeed = data.seed;
		lastUploadedCount = 0;
		pushNetworkDebug("New game from server");
		onGameStartCallback?.(data.seed, localPlayerIndex);
		return;
	}

	if (serverCount > localCount || seatCorrected) {
		pushNetworkDebug(
			`Adopting server state (moves ${localCount} → ${serverCount})`,
		);
		currentSeed = data.seed ?? currentSeed;
		lastUploadedCount = serverCount;
		onGameResumeCallback?.(state, localPlayerIndex);
	} else if (localCount > serverCount) {
		void uploadState(); // we're ahead — e.g. an earlier upload failed
	}
}

// Upload the local snapshot when it has advanced past what we've written.
async function uploadState(force = false) {
	const s = useMultiplayerStore.getState();
	const snap = gameSnapshotProvider?.();
	if (!s.gameCode || !snap || s.mode !== "multiplayer") return;
	if (!force && (snap.moveCount ?? 0) <= lastUploadedCount) return;
	if (uploading) return;
	uploading = true;
	try {
		const res = await apiPutState(s.gameCode, {
			state: {
				...snap,
				wins: s.wins,
				lastWinnerIndex: s.lastWinnerIndex,
			},
			seed: currentSeed,
			version: serverVersion,
		});
		serverVersion = res.version;
		if (res.conflict) {
			// Someone else wrote first — their row is the truth now.
			pushNetworkDebug("Write conflict — adopting server state");
			uploading = false;
			reconcile(res);
			return;
		}
		lastUploadedCount = snap.moveCount ?? 0;
		useMultiplayerStore.setState({ reconnecting: false });
		pushNetworkDebug(`Uploaded move ${lastUploadedCount} (v${serverVersion})`);
	} catch (e) {
		// the poll loop notices we're ahead and retries
		useMultiplayerStore.setState({ reconnecting: true });
		pushNetworkDebug(`Upload failed: ${(e as Error).message}`);
	} finally {
		uploading = false;
	}
}

// Called by gameStore's subscriber whenever settled game state changes.
// The snapshot itself comes from the provider; this is the "state settled,
// consider uploading" signal.
export function saveGameState(snapshot: SavedGameState) {
	void snapshot;
	void uploadState();
}

// ── Push subscriptions ──────────────────────────────────────────────
let ownPushSub: PushSubscriptionJSON | null = null;

function sendPushSubIfAny() {
	const { gameCode } = useMultiplayerStore.getState();
	if (gameCode && ownPushSub) {
		void apiPutPushSub(gameCode, localPlayerIndex, ownPushSub).then(() =>
			pushNetworkDebug("Push subscription registered with server"),
		);
	}
}

function registerOwnPushSubscription(sub: PushSubscriptionJSON) {
	ownPushSub = sub;
	useMultiplayerStore.setState({ notificationsEnabled: true });
	sendPushSubIfAny();
}

// ── URL params (auto-reconnect after reload) ────────────────────────
function setUrlParam(key: string, value: string) {
	const url = new URL(window.location.href);
	url.searchParams.delete("host");
	url.searchParams.delete("join");
	url.searchParams.set(key, value);
	history.replaceState(null, "", url.toString());
}

function clearUrlParams() {
	const url = new URL(window.location.href);
	url.searchParams.delete("host");
	url.searchParams.delete("join");
	history.replaceState(null, "", url.toString());
}

// ── Store ───────────────────────────────────────────────────────────
export const useMultiplayerStore = create<MultiplayerStore>((set, get) => ({
	mode: "ai",
	showLobbyModal: false,
	lobbyPhase: "joining" as LobbyPhase,
	gameCode: null,
	peerConnected: false,
	reconnecting: false,
	error: null,
	wins: [0, 0],
	lastWinnerIndex: null,
	lastGame: loadLastGame(),
	notificationsEnabled: false,
	showNetworkDebug: getDebugPanelInitialState(),
	networkDebugLines: [],

	openLobby: (phase) =>
		set({ showLobbyModal: true, lobbyPhase: phase, error: null }),

	closeLobby: () => {
		if (!get().peerConnected) {
			stopPolling();
			set({ gameCode: null });
			clearUrlParams();
		}
		set({ showLobbyModal: false });
	},

	hostGame: async (existingCode?: string) => {
		localPlayerIndex = 0;
		set({
			lobbyPhase: "hosting",
			error: null,
			...(existingCode
				? {}
				: { wins: [0, 0] as [number, number], lastWinnerIndex: null }),
		});
		try {
			if (existingCode) {
				// Resume a game we were hosting (e.g. after a reload).
				const data = await apiGetGame(existingCode, 0);
				if (data) {
					serverVersion = data.version;
					set({ gameCode: existingCode.toUpperCase() });
					setUrlParam("host", existingCode.toUpperCase());
					saveLastGame(existingCode, 0);
					pushNetworkDebug(`Rejoined game ${existingCode.toUpperCase()}`);
					reconcile(data);
					startPolling();
					sendPushSubIfAny();
					return;
				}
				pushNetworkDebug("Previous game expired — creating a new one");
			}
			const created = await apiCreateGame();
			serverVersion = created.version;
			set({ gameCode: created.code });
			setUrlParam("host", created.code);
			saveLastGame(created.code, 0);
			pushNetworkDebug(`Hosting game ${created.code}`);
			startPolling();
			sendPushSubIfAny();
		} catch (e) {
			set({ error: "Could not reach the game server. Try again." });
			pushNetworkDebug(`Host failed: ${(e as Error).message}`);
		}
	},

	joinGame: async (code: string) => {
		localPlayerIndex = 1;
		set({ lobbyPhase: "connecting", error: null });
		try {
			const data = await apiJoinGame(code);
			if (!data) {
				if (get().lastGame?.code === code.toUpperCase()) clearLastGame();
				set({
					error: "Could not find that game. Check the code.",
					lobbyPhase: "joining",
				});
				return;
			}
			serverVersion = data.version;
			if (data.you != null) localPlayerIndex = data.you;
			set({
				gameCode: code.toUpperCase(),
				wins: [0, 0],
				lastWinnerIndex: null,
			});
			setUrlParam("join", code.toUpperCase());
			saveLastGame(code, localPlayerIndex);
			pushNetworkDebug(`Joined game ${code.toUpperCase()}`);
			// If the host has dealt, this starts/restores the game; otherwise
			// we stay in the connecting lobby until the poll sees the deal.
			reconcile(data);
			startPolling();
			sendPushSubIfAny();
		} catch (e) {
			set({
				error: "Could not reach the game server. Try again.",
				lobbyPhase: "joining",
			});
			pushNetworkDebug(`Join failed: ${(e as Error).message}`);
		}
	},

	reconnectLastGame: () => {
		const last = get().lastGame;
		if (!last) return;
		if (last.role === 0) {
			get().openLobby("hosting");
			get().hostGame(last.code);
		} else {
			get().openLobby("joining");
			get().joinGame(last.code);
		}
	},

	startNewGame: () => {
		const seed = Date.now();
		currentSeed = seed;
		lastUploadedCount = -1;
		onGameStartCallback?.(seed, 0); // host is always player 0
		void uploadState(true);
	},

	recordResult: (winnerIndex: 0 | 1) => {
		set((s) => {
			const wins: [number, number] = [...s.wins];
			wins[winnerIndex]++;
			return { wins, lastWinnerIndex: winnerIndex };
		});
		// make sure the final state (with updated wins) reaches the server
		void uploadState(true);
	},

	sendMove: (move: MoveData) => {
		// Moves reach the opponent as state snapshots uploaded from the game
		// store's subscriber (saveGameState); kept for its call sites.
		void move;
	},

	enableNotifications: async () => {
		const result = await enablePush();
		if (result.ok) {
			registerOwnPushSubscription(result.sub);
			pushNetworkDebug("Push subscription created");
		} else {
			pushNetworkDebug(`Push enable failed: ${result.reason}`);
		}
	},

	disconnect: () => {
		stopPolling();
		clearUrlParams();
		clearLastGame();
		serverVersion = 0;
		currentSeed = null;
		lastUploadedCount = -1;
		localPlayerIndex = 0;
		set({
			mode: "ai",
			peerConnected: false,
			reconnecting: false,
			gameCode: null,
			lobbyPhase: "joining" as LobbyPhase,
			wins: [0, 0],
			lastWinnerIndex: null,
		});
		onDisconnectCallback?.();
	},

	toggleNetworkDebug: () =>
		set((s) => {
			localStorage.setItem(DEBUG_KEY, !s.showNetworkDebug ? "1" : "0");
			return { showNetworkDebug: !s.showNetworkDebug };
		}),
}));

networkDebugSink = (line) => {
	useMultiplayerStore.setState((s) => ({
		networkDebugLines: [...s.networkDebugLines, line].slice(-MAX_DEBUG_LINES),
	}));
};

// Force an immediate server check. Runs on foreground resume and via the
// manual 🔄 button.
export function resyncNow() {
	pushNetworkDebug("Manual/resume sync");
	void pollTick(true);
}

document.addEventListener("visibilitychange", () => {
	if (document.visibilityState !== "visible") return;
	void clearTurnNotifications();
	void pollTick(true);
});

// Reuse an existing push subscription without prompting (the user may have
// enabled notifications in an earlier session).
void initPush().then((sub) => {
	if (sub) registerOwnPushSubscription(sub);
});

// Opening the app means the user has seen the game — drop any stale
// "your turn" notification from the tray.
void clearTurnNotifications();

// Auto-connect from URL params on page load
export function autoConnect() {
	const params = new URLSearchParams(window.location.search);
	const hostCode = params.get("host");
	const joinCode = params.get("join");
	if (hostCode) {
		useMultiplayerStore.getState().openLobby("hosting");
		useMultiplayerStore.getState().hostGame(hostCode);
	} else if (joinCode) {
		useMultiplayerStore.getState().openLobby("joining");
		useMultiplayerStore.getState().joinGame(joinCode);
	}
}
