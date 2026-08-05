import Peer, { type DataConnection, type PeerOptions } from "peerjs";
import { create } from "zustand";
import { enablePush, initPush, notifyPeer } from "./push";

const STORAGE_KEY = "word-croosh-mp-state";
const DEBUG_KEY = "word-croosh-network-debug-visible";

function getDebugPanelInitialState(): boolean {
	return localStorage.getItem(DEBUG_KEY) === "1";
}

function readTurnConfig() {
	return {
		turnUsername: import.meta.env.VITE_TURN_USERNAME as string | undefined,
		turnCredential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
	};
}

function getTurnConfigError(): string | null {
	const { turnUsername, turnCredential } = readTurnConfig();
	const provided = [turnUsername, turnCredential].filter(Boolean);

	if (provided.length > 0 && provided.length < 2) {
		return "Partial TURN configuration: set VITE_TURN_USERNAME and VITE_TURN_CREDENTIAL to enable TURN relay.";
	}
	return null;
}

const MAX_DEBUG_LINES = 50;
let networkDebugSink: ((line: string) => void) | null = null;

function pushNetworkDebug(line: string) {
	networkDebugSink?.(`[${new Date().toLocaleTimeString()}] ${line}`);
}
type ConnectionType = { candidateType?: string; protocol?: string } | undefined;
async function logSelectedCandidatePair(pc: RTCPeerConnection): Promise<void> {
	try {
		const stats = await pc.getStats();
		let pair: RTCIceCandidatePairStats | undefined;

		stats.forEach((stat) => {
			if (stat.type === "transport" && stat.selectedCandidatePairId) {
				pair = stats.get(stat.selectedCandidatePairId);
			}
		});

		if (!pair) {
			stats.forEach((stat) => {
				if (stat.type === "candidate-pair" && stat.state === "succeeded") {
					pair = stat;
				}
			});
		}

		if (!pair || pair.type !== "candidate-pair") {
			return pushNetworkDebug("ICE selected path not available yet");
		}

		const local = stats.get(pair.localCandidateId) as ConnectionType;
		const remote = stats.get(pair.remoteCandidateId) as ConnectionType;
		const localType = local?.candidateType ?? "unknown";
		const remoteType = remote?.candidateType ?? "unknown";
		const protocol = local?.protocol ?? "unknown";
		const relay = localType === "relay" || remoteType === "relay";

		pushNetworkDebug(
			`ICE path: ${localType}<->${remoteType} via ${protocol}${relay ? " (TURN)" : " (direct)"}`,
		);
	} catch (err) {
		const msg = (err as Error).message ?? String(err);
		pushNetworkDebug(`Could not read ICE stats: ${msg}`);
	}
}

function buildPeerConfig(): PeerOptions {
	const iceServers: RTCIceServer[] = [
		// Public STUN — no cost, handles most NAT traversal
		{ urls: "stun:stun.l.google.com:19302" },
		{ urls: "stun:stun1.l.google.com:19302" },
	];

	// Add TURN whenever configured; ICE will still prefer direct paths when possible
	const { turnUsername, turnCredential } = readTurnConfig();
	if (!getTurnConfigError() && turnUsername && turnCredential) {
		iceServers.push(
			{
				urls: "turn:global.relay.metered.ca:80",
				username: turnUsername,
				credential: turnCredential,
			},
			{
				urls: "turn:global.relay.metered.ca:80?transport=tcp",
				username: turnUsername,
				credential: turnCredential,
			},
			{
				urls: "turn:global.relay.metered.ca:443",
				username: turnUsername,
				credential: turnCredential,
			},
			{
				urls: "turns:global.relay.metered.ca:443?transport=tcp",
				username: turnUsername,
				credential: turnCredential,
			},
		);
	}

	const opts: PeerOptions = { config: { iceServers } };
	// Optional self-hosted PeerJS broker (`npx peer --port 9000`), used by
	// tests and handy when the public cloud is flaky:
	// VITE_PEERJS_HOST=localhost pnpm dev
	const brokerHost = import.meta.env.VITE_PEERJS_HOST as string | undefined;
	if (brokerHost) {
		opts.host = brokerHost;
		opts.port = Number(import.meta.env.VITE_PEERJS_PORT ?? 9000);
		opts.secure = false;
	}
	return opts;
}

export type TilePlacement = { tileId: number; pile: number; letter: string };

export type MoveData =
	| { type: "commit"; placements: TilePlacement[] }
	| { type: "pass" }
	| { type: "swap"; tileIds: number[] };

export interface SavedGameState {
	cards: CardType[];
	currentPlayerIndex: 0 | 1;
	scores: [number, number];
	passCount: number;
	moveCount?: number;
	gameOver: boolean;
	lastPlay?: { word: string; score: number; tileIds: number[] } | null;
	wins?: [number, number];
	lastWinnerIndex?: 0 | 1 | null;
}

type PeerMessage =
	| {
			type: "game-start" | "new-game";
			seed: number;
			wins: [number, number];
			lastWinnerIndex: 0 | 1 | null;
	  }
	| { type: "game-resume"; state: SavedGameState }
	| { type: "move"; move: MoveData }
	| { type: "sync-check"; moveCount: number }
	| { type: "sync-ack" } // sync-check reply when states already match
	| { type: "push-sub"; subscription: PushSubscriptionJSON }
	| { type: "leave" };

export function isTurnConfigured(): boolean {
	const { turnUsername, turnCredential } = readTurnConfig();
	return !!(turnUsername && turnCredential && !getTurnConfigError());
}

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
	recordResult: (winnerIndex: 0 | 1) => void;
	sendMove: (move: MoveData) => void;
	enableNotifications: () => Promise<void>;
	disconnect: () => void;
	toggleNetworkDebug: () => void;
	checkNetworkPath: () => void;
}

// Module-level PeerJS instances (not in Zustand to avoid serialization issues)
let peer: Peer | null = null;
let conn: DataConnection | null = null;

// Callbacks wired up by gameStore after both stores are created
let onRemoteMoveCallback: ((move: MoveData) => void) | null = null;
let onGameStartCallback:
	| ((seed: number, localPlayerIndex: 0 | 1) => void)
	| null = null;
let onGameResumeCallback:
	| ((state: SavedGameState, localPlayerIndex: 0 | 1) => void)
	| null = null;

let onDisconnectCallback: (() => void) | null = null;
let onHostReadyToStartCallback: (() => void) | null = null;

// Provides a sanitized snapshot of the live game (null when no game is
// running); wired up by gameStore.
let gameSnapshotProvider: (() => SavedGameState | null) | null = null;
export const setGameSnapshotProvider = (fn: () => SavedGameState | null) => {
	gameSnapshotProvider = fn;
};

// Web Push subscriptions: ours (announced to the peer whenever a connection
// opens or a sync-check arrives) and the peer's (poked via the relay
// whenever we make a move). The peer's is persisted so it survives reloads.
const PEER_PUSH_SUB_KEY = "word-croosh-peer-push-sub";
let ownPushSub: PushSubscriptionJSON | null = null;
let peerPushSub: PushSubscriptionJSON | null = loadPeerPushSub();

function loadPeerPushSub(): PushSubscriptionJSON | null {
	try {
		const raw = localStorage.getItem(PEER_PUSH_SUB_KEY);
		return raw ? (JSON.parse(raw) as PushSubscriptionJSON) : null;
	} catch {
		return null;
	}
}

function storePeerPushSub(sub: PushSubscriptionJSON) {
	peerPushSub = sub;
	localStorage.setItem(PEER_PUSH_SUB_KEY, JSON.stringify(sub));
	pushNetworkDebug("Received peer push subscription");
}

function clearPeerPushSub() {
	peerPushSub = null;
	localStorage.removeItem(PEER_PUSH_SUB_KEY);
}

function announceOwnPushSub() {
	if (ownPushSub && conn?.open) {
		conn.send({
			type: "push-sub",
			subscription: ownPushSub,
		} satisfies PeerMessage);
		pushNetworkDebug("Sent our push subscription to peer");
	}
}

// Exported so tests can inject a fake subscription (real ones need a push
// service and aren't available headlessly).
export function registerOwnPushSubscription(sub: PushSubscriptionJSON) {
	ownPushSub = sub;
	useMultiplayerStore.setState({ notificationsEnabled: true });
	announceOwnPushSub();
}

const localMoveCount = (): number => {
	const snap = gameSnapshotProvider?.();
	// -1 when we have no game at all, so any started game beats us
	return snap ? (snap.moveCount ?? 0) : -1;
};

// Compare notes after a (re)connect: whichever peer has seen more moves
// pushes its full state to the other. Converges in at most two messages.
// A sync-check is ALWAYS answered (sync-ack when nothing differs), so the
// sender can treat silence as a dead connection.
function handleSyncCheck(theirCount: number) {
	const mine = localMoveCount();
	pushNetworkDebug(`Sync check: local moves ${mine} vs remote ${theirCount}`);
	if (!conn?.open) return;
	if (mine > theirCount) {
		const snap = gameSnapshotProvider?.();
		if (!snap) return;
		conn.send({
			type: "game-resume",
			state: { ...snap, wins: useMultiplayerStore.getState().wins },
		} satisfies PeerMessage);
	} else if (mine < theirCount) {
		conn.send({ type: "sync-check", moveCount: mine } satisfies PeerMessage);
	} else {
		conn.send({ type: "sync-ack" } satisfies PeerMessage);
	}
}
let intentionalDisconnect = false;
let remoteLeft = false;
let reconnectInterval: number | null = null;
// Timestamp of the last message received from the peer — used to detect
// zombie connections after the page resumes from suspension.
let lastPeerMessageAt = 0;
let resumeCheckTimer: ReturnType<typeof setTimeout> | null = null;
// Retries for re-registering the host code while the broker still holds our
// previous (dead) registration; reset once registration succeeds.
let hostRegisterRetries = 0;

function watchConnection(c: DataConnection) {
	const pc = c.peerConnection;
	pushNetworkDebug("Peer connection created");
	let lastIceState: RTCIceConnectionState | null = null;

	pc.oniceconnectionstatechange = () => {
		if (pc.iceConnectionState !== lastIceState) {
			lastIceState = pc.iceConnectionState;
			pushNetworkDebug(`ICE state: ${pc.iceConnectionState}`);
		}
		if (
			pc.iceConnectionState === "connected" ||
			pc.iceConnectionState === "completed"
		) {
			void logSelectedCandidatePair(pc);
		}
		if (
			pc.iceConnectionState === "disconnected" ||
			pc.iceConnectionState === "failed"
		) {
			handleConnClose();
		}
	};
}

export const setOnRemoteMove = (fn: (move: MoveData) => void) => {
	onRemoteMoveCallback = fn;
};

export const setOnGameStart = (
	fn: (seed: number, localPlayerIndex: 0 | 1) => void,
) => {
	onGameStartCallback = fn;
};

export const setOnHostReadyToStart = (fn: () => void) => {
	onHostReadyToStartCallback = fn;
};

export const setOnGameResume = (
	fn: (state: SavedGameState, localPlayerIndex: 0 | 1) => void,
) => {
	onGameResumeCallback = fn;
};

export const setOnDisconnect = (fn: () => void) => {
	onDisconnectCallback = fn;
};

function stopReconnecting() {
	if (reconnectInterval) {
		clearInterval(reconnectInterval);
		reconnectInterval = null;
	}
}

// URL param helpers
function setUrlParam(key: string, value: string) {
	const url = new URL(window.location.href);
	// clear both params, only one should be set at a time
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

// localStorage helpers for host game state persistence
export function saveGameState(state: SavedGameState) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadGameState(): SavedGameState | null {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as SavedGameState;
	} catch {
		return null;
	}
}

export function clearGameState() {
	localStorage.removeItem(STORAGE_KEY);
}

function generateCode(): string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
	return Array.from(
		{ length: 4 },
		() => chars[Math.floor(Math.random() * chars.length)],
	).join("");
}

function peerIdFromCode(code: string): string {
	return `ms-${code.toUpperCase()}`;
}

// Auto-reconnect a peer to the PeerJS broker if its socket drops (e.g. the
// page was suspended). Bound to the specific instance: `destroy()` also
// emits 'disconnected', and by then the module-level `peer` may already be
// a NEW peer that must not be touched. Only peers that once connected are
// retried, with backoff and a cap — otherwise a failing broker turns this
// into a hammering loop.
function keepBrokerRegistered(p: Peer) {
	let everOpened = false;
	let attempts = 0;
	p.on("open", () => {
		everOpened = true;
		attempts = 0;
	});
	p.on("disconnected", () => {
		if (peer !== p || p.destroyed || !everOpened || attempts >= 5) return;
		attempts++;
		setTimeout(() => {
			if (peer === p && !p.destroyed && p.disconnected) {
				pushNetworkDebug(`Broker reconnect attempt ${attempts}`);
				p.reconnect();
			}
		}, 1500 * attempts);
	});
}

// Guest re-establishes its peer and redials the host until it succeeds.
function startGuestReconnect(code: string) {
	peer?.destroy();
	peer = null;
	stopReconnecting();
	reconnectInterval = setInterval(() => {
		useMultiplayerStore.getState().joinGame(code);
	}, 3000);
	useMultiplayerStore.getState().joinGame(code);
}

function handleConnClose() {
	conn = null;
	if (intentionalDisconnect) return;
	if (remoteLeft) {
		remoteLeft = false;
		useMultiplayerStore.getState().disconnect();
		return;
	}
	const state = useMultiplayerStore.getState();
	if (state.mode === "multiplayer" && state.gameCode) {
		useMultiplayerStore.setState({ peerConnected: false, reconnecting: true });
		const isGuest = new URLSearchParams(window.location.search).has("join");
		if (isGuest) {
			pushNetworkDebug("Guest connection lost — reconnecting");
			startGuestReconnect(state.gameCode);
		}
	}
}

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
	notificationsEnabled: false,
	showNetworkDebug: getDebugPanelInitialState(),
	networkDebugLines: [],
	openLobby: (phase: Exclude<LobbyPhase, "connecting">) =>
		set({
			showLobbyModal: true,
			lobbyPhase: phase,
			error: getTurnConfigError(),
		}),

	closeLobby: () => {
		if (!get().peerConnected) {
			peer?.destroy();
			peer = null;
			conn = null;
		}
		set({ showLobbyModal: false });
		clearUrlParams();
	},

	hostGame: (existingCode?: string) => {
		if (peer) {
			peer.destroy();
			peer = null;
		}
		const code = existingCode || generateCode();
		set({
			lobbyPhase: "hosting",
			gameCode: code,
			error: null,
			...(existingCode
				? {}
				: {
						wins: [0, 0] as [number, number],
						lastWinnerIndex: null,
					}),
		});
		setUrlParam("host", code);

		peer = new Peer(peerIdFromCode(code), buildPeerConfig());
		pushNetworkDebug(`Hosting with code ${code.toUpperCase()}`);
		keepBrokerRegistered(peer);

		peer.on("open", () => {
			hostRegisterRetries = 0;
		});

		peer.on("connection", (connection) => {
			// An incoming connection while we already hold one means the
			// guest's side of the old one is dead (it only redials after
			// losing it, e.g. its phone was suspended) — adopt the new
			// connection and drop the stale one instead of rejecting.
			if (conn && conn !== connection) {
				pushNetworkDebug("Replacing stale connection with redial");
				const stale = conn;
				conn = null;
				stale.close();
			}
			conn = connection;
			pushNetworkDebug("Incoming connection attempt received");

			connection.on("open", () => {
				pushNetworkDebug("Connection open (host)");
				stopReconnecting();
				watchConnection(connection);
				announceOwnPushSub();
				// If we have a saved game state, resume it instead of starting fresh
				const saved = loadGameState();
				if (saved && !saved.gameOver) {
					// Restore from storage only when there's no live game in memory
					// (page refresh); a mid-game guest reconnect keeps our live state.
					if (!gameSnapshotProvider?.()) onGameResumeCallback?.(saved, 0);
					set({
						wins: saved.wins ?? get().wins,
						lastWinnerIndex: saved.lastWinnerIndex ?? null,
					});
					// Compare notes: whoever has seen more moves pushes their state.
					connection.send({
						type: "sync-check",
						moveCount: localMoveCount(),
					} satisfies PeerMessage);
				} else {
					onHostReadyToStartCallback?.();
				}
				set({
					peerConnected: true,
					reconnecting: false,
					mode: "multiplayer",
					showLobbyModal: false,
				});
			});

			connection.on("data", (raw) => {
				lastPeerMessageAt = Date.now();
				const msg = raw as PeerMessage;
				if (msg.type === "move") {
					onRemoteMoveCallback?.(msg.move);
				} else if (msg.type === "sync-check") {
					// a working channel is a good moment to (re)swap push subs
					announceOwnPushSub();
					handleSyncCheck(msg.moveCount);
				} else if (msg.type === "game-resume") {
					// The guest saw moves we missed — adopt their state.
					onGameResumeCallback?.(msg.state, 0);
				} else if (msg.type === "push-sub") {
					storePeerPushSub(msg.subscription);
				} else if (msg.type === "leave") {
					remoteLeft = true;
				}
			});

			// only react to the close of the connection we still consider
			// current — closes of replaced/stale connections are expected
			const onGone = () => {
				if (conn === connection) handleConnClose();
			};
			connection.on("close", onGone);
			connection.on("error", onGone);
		});

		peer.on("error", (err) => {
			const msg = (err as Error).message ?? String(err);
			if (msg.includes("unavailable-id")) {
				if (existingCode) {
					// Usually OUR OWN not-yet-expired registration (e.g. resuming
					// after suspension) — the broker drops it once the dead socket
					// times out, so retry a few times before giving up.
					if (hostRegisterRetries < 5) {
						hostRegisterRetries++;
						pushNetworkDebug(
							`Host code still registered — retry ${hostRegisterRetries}`,
						);
						setTimeout(() => get().hostGame(existingCode), 3000);
					} else {
						set({
							error: "Could not reconnect with previous code.",
							lobbyPhase: "hosting",
						});
					}
				} else {
					// Code collision — retry with a new code
					get().hostGame();
				}
			} else if ((err as { type?: string }).type === "network") {
				// Transient broker-socket loss (e.g. the app was backgrounded).
				// keepBrokerRegistered reconnects with the same code — don't
				// flip the lobby to the join phase over it.
				pushNetworkDebug(`Host broker hiccup (recovering): ${msg}`);
			} else {
				set({ error: `Error: ${msg}`, lobbyPhase: "joining" });
				pushNetworkDebug(`Host peer error: ${msg}`);
			}
		});
	},

	joinGame: (code: string) => {
		if (peer) {
			peer.destroy();
			peer = null;
		}
		const isReconnecting = get().reconnecting;
		if (!isReconnecting) {
			set({
				lobbyPhase: "joining",
				error: null,
				wins: [0, 0],
				lastWinnerIndex: null,
			});
		}
		setUrlParam("join", code.toUpperCase());

		peer = new Peer(buildPeerConfig());
		pushNetworkDebug(`Joining code ${code.toUpperCase()}`);
		keepBrokerRegistered(peer);

		peer.on("open", () => {
			console.log("Peer open with ID:", peer!.id);
			set({ lobbyPhase: "connecting" });
			const connection = peer!.connect(peerIdFromCode(code), {
				reliable: true,
			});
			conn = connection;

			const joinTimeout = setTimeout(() => {
				if (!get().peerConnected && !get().reconnecting) {
					set({
						error: "Could not connect. Check the code and try again.",
						lobbyPhase: "joining",
					});
					pushNetworkDebug("Join attempt timed out");
					handleConnClose();
				}
			}, 5000);

			connection.on("open", () => {
				clearTimeout(joinTimeout);
				pushNetworkDebug("Connection open (guest)");
				watchConnection(connection);
				announceOwnPushSub();
			});

			connection.on("data", (raw) => {
				lastPeerMessageAt = Date.now();
				const msg = raw as PeerMessage;
				if (msg.type === "game-start" || msg.type === "new-game") {
					onGameStartCallback?.(msg.seed, 1); // guest is always player 1
					set({
						gameCode: code.toUpperCase(),
						peerConnected: true,
						mode: "multiplayer",
						showLobbyModal: false,
						wins: msg.wins,
						lastWinnerIndex: msg.lastWinnerIndex,
					});
				} else if (msg.type === "game-resume") {
					stopReconnecting();
					onGameResumeCallback?.(msg.state, 1); // guest is always player 1
					set({
						gameCode: code.toUpperCase(),
						peerConnected: true,
						reconnecting: false,
						mode: "multiplayer",
						showLobbyModal: false,
						wins: msg.state.wins ?? get().wins,
						lastWinnerIndex: msg.state.lastWinnerIndex ?? null,
					});
				} else if (msg.type === "move") {
					onRemoteMoveCallback?.(msg.move);
				} else if (msg.type === "sync-check") {
					// The channel demonstrably works — mark ourselves connected even
					// if no game-resume follows (states may already match).
					stopReconnecting();
					set({
						gameCode: code.toUpperCase(),
						peerConnected: true,
						reconnecting: false,
						mode: "multiplayer",
						showLobbyModal: false,
					});
					// a working channel is a good moment to (re)swap push subs
					announceOwnPushSub();
					handleSyncCheck(msg.moveCount);
				} else if (msg.type === "push-sub") {
					storePeerPushSub(msg.subscription);
				} else if (msg.type === "leave") {
					remoteLeft = true;
				}
			});

			// ignore events from superseded connections (a redial replaces
			// `conn`; the old one's close must not null the new one)
			connection.on("close", () => {
				if (conn === connection) handleConnClose();
			});
			connection.on("error", (err) => {
				if (conn !== connection) return;
				if (!get().reconnecting) {
					set({
						error: "Could not connect. Check the code and try again.",
						lobbyPhase: "joining",
					});
					const msg = (err as Error).message ?? String(err);
					pushNetworkDebug(`Join connection error: ${msg}`);
				}
				// During reconnection, don't fully disconnect — the interval will retry
				if (!get().reconnecting) handleConnClose();
			});
		});

		peer.on("error", (err) => {
			console.log("Peer error:", err);
			const msg = (err as Error).message ?? String(err);
			// Suppress errors during reconnection — the interval will retry
			if (!get().reconnecting) {
				set({ error: `Error: ${msg}`, lobbyPhase: "joining" });
				pushNetworkDebug(`Guest peer error: ${msg}`);
			}
		});
	},

	recordResult: (winnerIndex: 0 | 1) => {
		set((s) => {
			const wins: [number, number] = [...s.wins];
			wins[winnerIndex]++;
			return { wins, lastWinnerIndex: winnerIndex };
		});
	},

	sendMove: (move: MoveData) => {
		conn?.send({ type: "move", move } satisfies PeerMessage);
		// it's the opponent's turn now — wake their device if they opted in
		if (peerPushSub) {
			void notifyPeer(peerPushSub).then((status) =>
				pushNetworkDebug(`Push poke: ${status}`),
			);
		} else {
			pushNetworkDebug("Push poke skipped: no peer subscription");
		}
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

	startNewGame: () => {
		clearGameState();
		const seed = Date.now();
		const { wins, lastWinnerIndex } = get();
		conn?.send({
			type: "new-game",
			seed,
			wins,
			lastWinnerIndex,
		} satisfies PeerMessage);
		onGameStartCallback?.(seed, 0); // host is always player 0
	},

	disconnect: () => {
		stopReconnecting();
		intentionalDisconnect = true;
		// Clear URL params before closing connection so handleConnClose
		// won't see ?join and start reconnecting
		clearUrlParams();
		clearGameState();
		clearPeerPushSub();
		conn?.send({ type: "leave" } satisfies PeerMessage);
		conn?.close();
		peer?.destroy();
		conn = null;
		peer = null;
		intentionalDisconnect = false;
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

	checkNetworkPath: () => {
		if (!conn?.peerConnection)
			return pushNetworkDebug("No active peer connection to inspect");
		void logSelectedCandidatePair(conn.peerConnection);
	},
}));

networkDebugSink = (line) => {
	useMultiplayerStore.setState((s) => ({
		networkDebugLines: [...s.networkDebugLines, line].slice(-MAX_DEBUG_LINES),
	}));
};

// Reuse an existing push subscription without prompting (the user may have
// enabled notifications in an earlier session).
void initPush().then((sub) => {
	if (sub) registerOwnPushSubscription(sub);
});

// Tear down whatever is left of the connection and re-establish it.
function rebuildConnection() {
	const state = useMultiplayerStore.getState();
	if (state.mode !== "multiplayer" || !state.gameCode) return;
	useMultiplayerStore.setState({ peerConnected: false, reconnecting: true });
	const isGuest = new URLSearchParams(window.location.search).has("join");
	pushNetworkDebug(`Rebuilding connection (${isGuest ? "guest" : "host"})`);
	if (isGuest) {
		startGuestReconnect(state.gameCode);
		return;
	}
	// Host: drop the zombie conn so the guest's redial is accepted, and
	// keep our existing broker registration when it's salvageable — a full
	// re-host would collide with our own not-yet-expired registration.
	const stale = conn;
	conn = null;
	stale?.close();
	if (peer && !peer.destroyed) {
		if (peer.disconnected) peer.reconnect();
	} else {
		state.hostGame(state.gameCode);
	}
}

// Resync when the app returns to the foreground (phone unlock / app
// switch): timers and the WebRTC connection may have died while the page
// was suspended, and moves sent in the meantime may have been missed.
// Verify the connection and resync state with the peer. Runs on foreground
// resume and via the manual "Refresh" menu item.
export function resyncNow() {
	const state = useMultiplayerStore.getState();
	if (!state.gameCode) return;

	if (state.mode !== "multiplayer") {
		// Pre-game hosting lobby: re-register our code with the broker so a
		// guest can still join after we were backgrounded.
		if (state.lobbyPhase === "hosting" && !state.peerConnected) {
			if (!peer || peer.destroyed) state.hostGame(state.gameCode);
			else if (peer.disconnected) peer.reconnect();
		}
		return;
	}

	if (peer && peer.disconnected && !peer.destroyed) peer.reconnect();

	if (conn?.open) {
		// The channel *claims* to be alive, but our state may be stale (close
		// events queue up while the page is suspended). Send a sync check —
		// it is always answered — and rebuild if nothing comes back.
		pushNetworkDebug("Resync — sync check sent");
		const sentAt = Date.now();
		conn.send({
			type: "sync-check",
			moveCount: localMoveCount(),
		} satisfies PeerMessage);
		if (resumeCheckTimer) clearTimeout(resumeCheckTimer);
		resumeCheckTimer = setTimeout(() => {
			if (document.visibilityState !== "visible") return;
			if (lastPeerMessageAt >= sentAt) return; // got a reply — it's alive
			pushNetworkDebug("No reply to sync check — connection is dead");
			rebuildConnection();
		}, 3500);
		return;
	}

	// The connection is gone — rebuild it.
	rebuildConnection();
}

document.addEventListener("visibilitychange", () => {
	if (document.visibilityState !== "visible") return;
	resyncNow();
});

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
