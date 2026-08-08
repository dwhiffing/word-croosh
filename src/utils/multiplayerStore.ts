// Multiplayer over the game server (Cloudflare Worker + Neon Postgres).
//
// The server row holds the authoritative game snapshot; this store is a
// thin reconciler around it. After every settled local change the snapshot
// is uploaded (optimistic version check); a poll loop (paused while the tab
// is hidden) fetches the row and adopts the server state whenever it has
// seen more moves than we have.

import { create } from 'zustand'
import { clearUrlParams, setUrlParam } from '.'
import {
  apiCreateGame,
  apiGetGame,
  apiGetPlayer,
  apiGetResults,
  apiJoinGame,
  apiPutPushSub,
  apiPutState,
  apiSetPlayer,
  apiStartGame,
  deviceId,
  type GameData,
  type GameResults,
  type SavedGameState,
  type SeatInfo,
} from './api'
import type { TileColorName } from './constants'
import { pushNetworkDebug } from './networkDebug'
import { clearTurnNotifications, enablePush, initPush } from './push'

export type { SavedGameState } from './api'

type LobbyPhase = 'hosting' | 'joining' | 'connecting'

interface MultiplayerStore {
  mode: 'ai' | 'multiplayer'
  showLobbyModal: boolean
  lobbyPhase: LobbyPhase
  gameCode: string | null
  peerConnected: boolean
  reconnecting: boolean
  error: string | null
  results: GameResults | null // win tally + history for this code, from the DB
  lastGame: LastGame | null // most recent game, for the reconnect option
  notificationsEnabled: boolean
  // Our own profile (persisted server-side, keyed by device id).
  myName: string | null
  myColor: TileColorName | null
  showNameModal: boolean // prompted on load until a name is set
  // The current game's seats (name + color per joined seat), once known.
  seats: SeatInfo[]
  maxPlayers: number
  started: boolean // the host has closed the lobby and dealt
  openLobby: (phase: Exclude<LobbyPhase, 'connecting'>) => void
  closeLobby: () => void
  hostGame: (maxPlayers?: number, existingCode?: string) => void
  joinGame: (code: string) => void
  startGame: () => void // host-only: close the lobby and deal the first game
  startNewGame: () => void // host-only: deal a rematch with the same seats
  reconnectLastGame: () => void
  enableNotifications: () => Promise<void>
  disconnect: () => void
  openNameModal: () => void
  closeNameModal: () => void
  setMyProfile: (name: string, color: TileColorName) => Promise<void>
}

// gameStore wires itself into this store once at module load, so it can
// react to server-driven events (a deal, a resync, a disconnect, the host's
// "go ahead and deal" signal) and supply the snapshot this store uploads.
interface GameHooks {
  onGameStart: (
    seed: number,
    localPlayerIndex: number,
    playerCount: number,
  ) => void
  onGameResume: (
    state: SavedGameState,
    localPlayerIndex: number,
    playerCount: number,
  ) => void
  onDisconnect: () => void
  gameSnapshot: () => SavedGameState | null
}
let gameHooks: GameHooks | null = null
export const setGameHooks = (hooks: GameHooks) => {
  gameHooks = hooks
}

// ── Sync engine ─────────────────────────────────────────────────────
let localPlayerIndex = 0
let serverVersion = 0
let currentSeed: number | null = null // seed of the game we've started locally
let lastUploadedCount = -1
let uploading = false
let pollTimer: ReturnType<typeof setInterval> | null = null

const POLL_MS = 5000
// While waiting in the lobby (for more players to join, or for the host to
// deal), there's no push notification to wake anyone up — polling is the
// only signal. Poll faster during that window so "waiting for players"
// doesn't stack multiple full POLL_MS delays end to end.
const LOBBY_POLL_MS = 1500
let dealPending = false

function startPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(
    () => void pollTick(),
    dealPending ? LOBBY_POLL_MS : POLL_MS,
  )
}

// Call after `dealPending` changes so the running timer picks up the new
// interval immediately instead of waiting out whatever's left of the old one.
function restartPollingIfActive() {
  if (pollTimer) startPolling()
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

async function pollTick(force = false) {
  const s = useMultiplayerStore.getState()
  if (!s.gameCode) return
  if (!force && document.visibilityState !== 'visible') return
  if (uploading) return
  try {
    const data = await apiGetGame(s.gameCode, serverVersion)
    if (!data) return // game row is gone (expired)
    if (s.reconnecting) useMultiplayerStore.setState({ reconnecting: false })
    if (data.changed === false) {
      // nothing new server-side; retry a failed upload if we're ahead
      void uploadState()
      return
    }
    serverVersion = data.version
    reconcile(data)
  } catch (e) {
    useMultiplayerStore.setState({ reconnecting: true })
    pushNetworkDebug(`Poll failed: ${(e as Error).message}`)
  }
}

// Compare the server row with local state and converge on whichever has
// seen more of the game. `forceAdopt` is set when we already know our
// local write lost a version race (a CAS conflict) — in that case the
// server is authoritative even if both sides happen to be at the same
// moveCount (e.g. multiple players ended the game independently at once).
function reconcile(data: GameData, forceAdopt = false) {
  const store = useMultiplayerStore
  const s = store.getState()

  // The server knows which seat this device holds — it beats whatever role
  // we claimed from the URL or saved state.
  let seatCorrected = false
  if (data.you != null && data.you !== localPlayerIndex) {
    pushNetworkDebug(`Server corrected our seat to player ${data.you}`)
    localPlayerIndex = data.you
    seatCorrected = true
    if (s.gameCode) saveLastGame(s.gameCode, data.you)
  }

  const seats = data.seats ?? s.seats
  const maxPlayers = data.maxPlayers ?? s.maxPlayers
  const started = data.started ?? s.started

  // Waiting in the lobby: a player just joined (or left) but the game
  // hasn't been dealt yet — refresh the seat list and stay in the lobby.
  // `mode` flips to 'multiplayer' here (not only once state exists) so the
  // host's very first upload — which is what creates that state — passes
  // uploadState's mode check.
  if (!data.state && !started) {
    store.setState({
      mode: 'multiplayer',
      peerConnected: seats.length > 1,
      reconnecting: false,
      showLobbyModal: true,
      seats,
      maxPlayers,
      started,
    })
    pushNetworkDebug('Lobby updated')
    return
  }
  if (!data.state) return

  const state = data.state
  store.setState({
    peerConnected: true,
    reconnecting: false,
    mode: 'multiplayer',
    showLobbyModal: false,
    seats,
    maxPlayers,
    started,
  })
  if (state.gameOver && s.gameCode) void fetchResults(s.gameCode)

  const localCount = gameHooks?.gameSnapshot()?.moveCount ?? -1
  const serverCount = state.moveCount ?? 0

  // A deal we haven't started locally (initial game or rematch): play the
  // deal animation from the seed instead of restoring the snapshot.
  if (
    data.seed != null &&
    data.seed !== currentSeed &&
    serverCount === 0 &&
    !state.gameOver
  ) {
    currentSeed = data.seed
    lastUploadedCount = 0
    pushNetworkDebug('New game from server')
    dealPending = false
    restartPollingIfActive()
    gameHooks?.onGameStart(data.seed, localPlayerIndex, seats.length)
    return
  }

  if (serverCount > localCount || seatCorrected || forceAdopt) {
    pushNetworkDebug(
      `Adopting server state (moves ${localCount} → ${serverCount})`,
    )
    currentSeed = data.seed ?? currentSeed
    lastUploadedCount = serverCount
    dealPending = false
    restartPollingIfActive()
    gameHooks?.onGameResume(state, localPlayerIndex, seats.length)
  } else if (localCount > serverCount) {
    void uploadState() // we're ahead — e.g. an earlier upload failed
  }
}

// Upload the local snapshot when it has advanced past what we've written.
async function uploadState(force = false) {
  const s = useMultiplayerStore.getState()
  const snap = gameHooks?.gameSnapshot()
  if (!s.gameCode || !snap || s.mode !== 'multiplayer') return
  if (!force && (snap.moveCount ?? 0) <= lastUploadedCount) return
  if (uploading) return
  uploading = true
  try {
    const res = await apiPutState(s.gameCode, {
      state: snap,
      seed: currentSeed,
      version: serverVersion,
    })
    serverVersion = res.version
    if (res.conflict) {
      // Someone else wrote first — their row is the truth now, even if
      // it happens to be at the same moveCount as our rejected write.
      pushNetworkDebug('Write conflict — adopting server state')
      uploading = false
      reconcile(res, true)
      return
    }
    lastUploadedCount = snap.moveCount ?? 0
    useMultiplayerStore.setState({ reconnecting: false })
    pushNetworkDebug(`Uploaded move ${lastUploadedCount} (v${serverVersion})`)
    // The server recorded the result the instant it saw gameOver — pull the
    // updated tally now rather than waiting for the next poll.
    if (snap.gameOver) void fetchResults(s.gameCode)
  } catch (e) {
    // the poll loop notices we're ahead and retries
    useMultiplayerStore.setState({ reconnecting: true })
    pushNetworkDebug(`Upload failed: ${(e as Error).message}`)
  } finally {
    uploading = false
  }
}

// The server inserts the finished-game row via ctx.waitUntil after already
// responding to the move that ended the game, so the very next fetch can
// briefly race it. One short retry covers that window without delaying the
// normal case (a fetch triggered by a later poll already sees it).
async function fetchResults(code: string, retriesLeft = 1) {
  try {
    const results = await apiGetResults(code)
    const prevCount = useMultiplayerStore.getState().results?.games.length ?? 0
    useMultiplayerStore.setState({ results })
    if (results.games.length === prevCount && retriesLeft > 0) {
      setTimeout(() => void fetchResults(code, retriesLeft - 1), 1500)
    }
  } catch (e) {
    pushNetworkDebug(`Results fetch failed: ${(e as Error).message}`)
  }
}

// Called by gameStore's subscriber whenever settled game state changes.
// The snapshot itself comes from the provider; this is the "state settled,
// consider uploading" signal.
export function saveGameState(snapshot: SavedGameState) {
  void snapshot
  void uploadState()
}

// ── Push subscriptions ──────────────────────────────────────────────
let ownPushSub: PushSubscriptionJSON | null = null

function sendPushSubIfAny() {
  const { gameCode } = useMultiplayerStore.getState()
  if (gameCode && ownPushSub) {
    void apiPutPushSub(gameCode, localPlayerIndex, ownPushSub).then(() =>
      pushNetworkDebug('Push subscription registered with server'),
    )
  }
}

function registerOwnPushSubscription(sub: PushSubscriptionJSON) {
  ownPushSub = sub
  useMultiplayerStore.setState({ notificationsEnabled: true })
  sendPushSubIfAny()
}

// ── Store ───────────────────────────────────────────────────────────
export const useMultiplayerStore = create<MultiplayerStore>((set, get) => ({
  mode: 'ai',
  showLobbyModal: false,
  lobbyPhase: 'joining' as LobbyPhase,
  gameCode: null,
  peerConnected: false,
  reconnecting: false,
  error: null,
  results: null,
  lastGame: loadLastGame(),
  notificationsEnabled: false,
  myName: null,
  myColor: null,
  showNameModal: false,
  seats: [],
  maxPlayers: 4,
  started: false,

  openLobby: (phase) =>
    set({ showLobbyModal: true, lobbyPhase: phase, error: null }),

  closeLobby: () => {
    if (!get().peerConnected) {
      stopPolling()
      set({ gameCode: null })
      clearUrlParams()
    }
    set({ showLobbyModal: false })
  },

  hostGame: async (maxPlayers = 4, existingCode?: string) => {
    localPlayerIndex = 0
    set({
      lobbyPhase: 'hosting',
      error: null,
      results: null,
      seats: [],
      maxPlayers,
      started: false,
    })
    try {
      if (existingCode) {
        // Resume a game we were hosting (e.g. after a reload).
        const data = await apiGetGame(existingCode, 0)
        if (data) {
          serverVersion = data.version
          set({ gameCode: existingCode.toUpperCase() })
          setUrlParam('host', existingCode.toUpperCase())
          saveLastGame(existingCode, 0)
          pushNetworkDebug(`Rejoined game ${existingCode.toUpperCase()}`)
          void fetchResults(existingCode.toUpperCase())
          reconcile(data)
          startPolling()
          sendPushSubIfAny()
          return
        }
        pushNetworkDebug('Previous game expired — creating a new one')
      }
      const created = await apiCreateGame(maxPlayers)
      serverVersion = created.version
      set({
        gameCode: created.code,
        seats: created.seats,
        maxPlayers: created.maxPlayers,
      })
      setUrlParam('host', created.code)
      saveLastGame(created.code, 0)
      pushNetworkDebug(`Hosting game ${created.code}`)
      dealPending = true // poll fast until players join and we start
      startPolling()
      sendPushSubIfAny()
      void pollTick(true)
    } catch (e) {
      set({ error: 'Could not reach the game server. Try again.' })
      pushNetworkDebug(`Host failed: ${(e as Error).message}`)
    }
  },

  joinGame: async (code: string) => {
    localPlayerIndex = 1
    set({
      lobbyPhase: 'connecting',
      error: null,
      results: null,
      seats: [],
      started: false,
    })
    try {
      const data = await apiJoinGame(code)
      if (!data) {
        if (get().lastGame?.code === code.toUpperCase()) clearLastGame()
        set({ error: 'Could not find that game', lobbyPhase: 'joining' })
        return
      }
      serverVersion = data.version
      if (data.you != null) localPlayerIndex = data.you
      set({
        gameCode: code.toUpperCase(),
        seats: data.seats ?? [],
        maxPlayers: data.maxPlayers ?? 4,
        started: data.started ?? false,
        showLobbyModal: true,
      })
      setUrlParam('join', code.toUpperCase())
      saveLastGame(code, localPlayerIndex)
      pushNetworkDebug(`Joined game ${code.toUpperCase()}`)
      void fetchResults(code.toUpperCase())
      // If the host has dealt, this starts/restores the game; otherwise
      // we stay in the lobby, polling fast, until it sees the deal.
      dealPending = true
      reconcile(data)
      startPolling()
      sendPushSubIfAny()
    } catch (e) {
      set({
        error: (e as Error).message || 'Could not reach the game server. Try again.',
        lobbyPhase: 'joining',
      })
      pushNetworkDebug(`Join failed: ${(e as Error).message}`)
    }
  },

  // Host-only: close the lobby to new joiners and deal the first game.
  startGame: () => {
    if (localPlayerIndex !== 0) return
    void apiStartGame(get().gameCode!)
    set({ started: true, showLobbyModal: false })
    get().startNewGame()
  },

  // Host-only: deal a fresh game (initial deal or rematch) to the same seats.
  startNewGame: () => {
    if (localPlayerIndex !== 0) return
    const seed = Date.now()
    currentSeed = seed
    lastUploadedCount = -1
    const playerCount = get().seats.length
    gameHooks?.onGameStart(seed, 0, playerCount) // host is always seat 0
    void uploadState(true)
  },

  reconnectLastGame: () => {
    const last = get().lastGame
    if (!last) return
    if (last.role === 0) {
      get().openLobby('hosting')
      get().hostGame(4, last.code)
    } else {
      get().openLobby('joining')
      get().joinGame(last.code)
    }
  },

  enableNotifications: async () => {
    const result = await enablePush()
    if (result.ok) {
      registerOwnPushSubscription(result.sub)
      pushNetworkDebug('Push subscription created')
    } else {
      pushNetworkDebug(`Push enable failed: ${result.reason}`)
    }
  },

  disconnect: () => {
    stopPolling()
    clearUrlParams()
    clearLastGame()
    serverVersion = 0
    currentSeed = null
    lastUploadedCount = -1
    localPlayerIndex = 0
    set({
      mode: 'ai',
      peerConnected: false,
      reconnecting: false,
      gameCode: null,
      lobbyPhase: 'joining' as LobbyPhase,
      results: null,
      seats: [],
      started: false,
    })
    gameHooks?.onDisconnect()
  },

  openNameModal: () => set({ showNameModal: true }),
  closeNameModal: () => set({ showNameModal: false }),

  setMyProfile: async (name: string, color: TileColorName) => {
    await apiSetPlayer(deviceId(), { name, color })
    set({ myName: name, myColor: color, showNameModal: false })
  },
}))

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  void clearTurnNotifications()
  void pollTick(true)
})

// Reuse an existing push subscription without prompting (the user may have
// enabled notifications in an earlier session).
void initPush().then((sub) => {
  if (sub) registerOwnPushSubscription(sub)
})

// Opening the app means the user has seen the game — drop any stale
// "your turn" notification from the tray.
void clearTurnNotifications()

// Load our own profile on startup; prompt for a name if one was never set.
void apiGetPlayer(deviceId()).then(({ name, color }) => {
  useMultiplayerStore.setState({
    myName: name,
    myColor: color,
    showNameModal: name == null,
  })
})

// Auto-connect from URL params on page load
export function autoConnect() {
  const params = new URLSearchParams(window.location.search)
  const hostCode = params.get('host')
  const joinCode = params.get('join')
  if (hostCode) {
    useMultiplayerStore.getState().openLobby('hosting')
    useMultiplayerStore.getState().hostGame(4, hostCode)
  } else if (joinCode) {
    useMultiplayerStore.getState().openLobby('joining')
    useMultiplayerStore.getState().joinGame(joinCode)
  }
}

const LAST_GAME_KEY = 'word-croosh-last-game'
type LastGame = { code: string; role: number }

function loadLastGame(): LastGame | null {
  try {
    const raw = localStorage.getItem(LAST_GAME_KEY)
    return raw ? (JSON.parse(raw) as LastGame) : null
  } catch {
    return null
  }
}

function saveLastGame(code: string, role: number) {
  const lastGame: LastGame = { code: code.toUpperCase(), role }
  localStorage.setItem(LAST_GAME_KEY, JSON.stringify(lastGame))
  useMultiplayerStore.setState({ lastGame })
}

function clearLastGame() {
  localStorage.removeItem(LAST_GAME_KEY)
  useMultiplayerStore.setState({ lastGame: null })
}
