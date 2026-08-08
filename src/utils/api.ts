// HTTP client for the game server (server/ — Cloudflare Worker over Neon).
// The server stores an authoritative SavedGameState per game, guarded by an
// optimistic `version`; see server/worker.js for the contract.

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'https://word-croosh-api.danielwhiffing.workers.dev'

export interface SavedGameState {
  cards: CardType[]
  currentPlayerIndex: 0 | 1
  scores: [number, number]
  moveCount?: number
  gameOver: boolean
  lastPlay?: { word: string; score: number; tileIds: number[] } | null
  givenUpBy?: 0 | 1 | null
}

export interface GameData {
  version: number
  seed: number | null
  guestJoined: boolean
  state: SavedGameState | null
  you?: 0 | 1 | null // which seat this device holds, per the server
  changed?: boolean
  conflict?: boolean
}

// One row per finished game under a code, recorded server-side the moment
// gameOver is first seen — see server/worker.js.
export interface GameResult {
  hostScore: number
  guestScore: number
  winnerSeat: 0 | 1 | null // null = tie
  finishedAt: string
}

export interface GameResults {
  wins: [number, number]
  games: GameResult[]
}

// One finished game from a specific player's point of view, including the
// full final board so it can be reopened for viewing.
export interface PlayerGameHistoryEntry {
  code: string
  you: 0 | 1
  opponentId: string | null
  hostScore: number
  guestScore: number
  winnerSeat: 0 | 1 | null
  finalState: SavedGameState | null
  finishedAt: string
}

// Persistent random id identifying this device to the server; the server
// uses it to remember which seat (host/guest) we hold in each game, and as
// the player identity behind stats/history.
export function deviceId(): string {
  let id = localStorage.getItem('word-croosh-device-id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('word-croosh-device-id', id)
  }
  return id
}

async function request(
  path: string,
  init?: RequestInit,
): Promise<{
  status: number
  data: GameData & { code?: string; error?: string }
}> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${API_URL}${path}${sep}d=${deviceId()}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

export async function apiCreateGame(): Promise<{
  code: string
  version: number
}> {
  const { status, data } = await request('/games', { method: 'POST' })
  if (status !== 200 || !data.code)
    throw new Error(data.error ?? `HTTP ${status}`)
  return { code: data.code, version: data.version }
}

// null = no such game
export async function apiJoinGame(code: string): Promise<GameData | null> {
  const { status, data } = await request(`/games/${code}/join`, {
    method: 'POST',
  })
  if (status === 404) return null
  if (status !== 200) throw new Error(data.error ?? `HTTP ${status}`)
  return { ...data, guestJoined: true }
}

// null = no such game
export async function apiGetGame(
  code: string,
  sinceVersion: number,
): Promise<GameData | null> {
  const { status, data } = await request(`/games/${code}?v=${sinceVersion}`)
  if (status === 404) return null
  if (status !== 200) throw new Error(data.error ?? `HTTP ${status}`)
  return data
}

// Optimistic write; a 409 returns the server's current truth as `conflict`.
export async function apiPutState(
  code: string,
  body: { state: SavedGameState; seed: number | null; version: number },
): Promise<GameData> {
  const { status, data } = await request(`/games/${code}/state`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  if (status === 409) return { ...data, conflict: true }
  if (status !== 200) throw new Error(data.error ?? `HTTP ${status}`)
  return data
}

export async function apiPutPushSub(
  code: string,
  playerIndex: 0 | 1,
  subscription: PushSubscriptionJSON,
): Promise<void> {
  await request(`/games/${code}/push-sub`, {
    method: 'PUT',
    body: JSON.stringify({ playerIndex, subscription }),
  })
}

// The win/loss tally (and recent history) of finished games under this code.
export async function apiGetResults(code: string): Promise<GameResults> {
  const { status, data } = await request(`/games/${code}/results`)
  if (status !== 200)
    throw new Error((data as { error?: string }).error ?? `HTTP ${status}`)
  return data as unknown as GameResults
}

// Every finished game a player (identified by their device id) took part
// in, across all game codes — for the "My Games" history list.
export async function apiGetPlayerHistory(
  playerId: string,
): Promise<PlayerGameHistoryEntry[]> {
  const { status, data } = await request(`/players/${playerId}/games`)
  if (status !== 200)
    throw new Error((data as { error?: string }).error ?? `HTTP ${status}`)
  return (data as unknown as { games: PlayerGameHistoryEntry[] }).games
}
