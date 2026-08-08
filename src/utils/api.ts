// HTTP client for the game server (server/ — Cloudflare Worker over Neon).
// The server stores an authoritative SavedGameState per game, guarded by an
// optimistic `version`; see server/worker.js for the contract.

import type { TileColorName } from './constants'

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'https://word-croosh-api.danielwhiffing.workers.dev'

export interface SavedGameState {
  cards: CardType[]
  currentPlayerIndex: number
  scores: number[]
  moveCount?: number
  gameOver: boolean
  lastPlay?: { word: string; score: number; tileIds: number[] } | null
  givenUpBy?: number[] // seats that have given up
}

// One seat's profile as known to the server for the current game code.
export interface SeatInfo {
  seat: number
  name: string | null
  color: TileColorName | null
}

export interface GameData {
  version: number
  seed: number | null
  state: SavedGameState | null
  you?: number | null // which seat this device holds, per the server
  maxPlayers?: number
  started?: boolean
  seats?: SeatInfo[]
  changed?: boolean
  conflict?: boolean
}

// One row per finished game under a code, recorded server-side the moment
// gameOver is first seen — see server/worker.js.
export interface GameResult {
  scores: number[]
  winnerSeat: number | null // null = tie
  finishedAt: string
}

export interface GameResults {
  wins: Record<number, number>
  games: GameResult[]
}

// One finished game from a specific player's point of view, including the
// full final board so it can be reopened for viewing.
export interface PlayerGameHistoryEntry {
  code: string
  you: number
  seats: SeatInfo[]
  scores: number[]
  winnerSeat: number | null
  finalState: SavedGameState | null
  finishedAt: string
}

// Persistent random id identifying this device to the server; the server
// uses it to remember which seat we hold in each game, and as the player
// identity behind stats/history.
export function deviceId(): string {
  let id = localStorage.getItem('word-croosh-device-id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('word-croosh-device-id', id)
  }
  return id
}

// Overwrite this device's identity with a recovered player id (see
// apiLoginPlayer) — every subsequent deviceId() call, and thus every
// request, acts as that player from here on. Does not affect any other
// device that may still be using the old id.
export function setDeviceId(id: string): void {
  localStorage.setItem('word-croosh-device-id', id)
}

async function request(
  path: string,
  init?: RequestInit,
): Promise<{
  status: number
  data: GameData & { code?: string; error?: string; playerId?: string }
}> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${API_URL}${path}${sep}d=${deviceId()}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

export async function apiCreateGame(
  maxPlayers: number,
): Promise<{ code: string; version: number; seats: SeatInfo[]; maxPlayers: number }> {
  const { status, data } = await request('/games', {
    method: 'POST',
    body: JSON.stringify({ maxPlayers }),
  })
  if (status !== 200 || !data.code)
    throw new Error(data.error ?? `HTTP ${status}`)
  return {
    code: data.code,
    version: data.version,
    seats: data.seats ?? [],
    maxPlayers: data.maxPlayers ?? maxPlayers,
  }
}

// null = no such game; throws (with a message) on join errors like "full"
// or "already started".
export async function apiJoinGame(code: string): Promise<GameData | null> {
  const { status, data } = await request(`/games/${code}/join`, {
    method: 'POST',
  })
  if (status === 404) return null
  if (status !== 200) throw new Error(data.error ?? `HTTP ${status}`)
  return data
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

// Host closes the lobby and starts the game — rejects late joiners from then on.
export async function apiStartGame(code: string): Promise<void> {
  const { status, data } = await request(`/games/${code}/start`, {
    method: 'POST',
  })
  if (status !== 200) throw new Error(data.error ?? `HTTP ${status}`)
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
  playerIndex: number,
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

export interface PlayerProfile {
  name: string | null
  color: TileColorName | null
}

export async function apiGetPlayer(playerId: string): Promise<PlayerProfile> {
  const { status, data } = await request(`/players/${playerId}`)
  if (status !== 200)
    throw new Error((data as { error?: string }).error ?? `HTTP ${status}`)
  return data as unknown as PlayerProfile
}

export async function apiSetPlayer(
  playerId: string,
  profile: { name: string; color: TileColorName; pin: string },
): Promise<void> {
  const { status, data } = await request(`/players/${playerId}`, {
    method: 'PUT',
    body: JSON.stringify(profile),
  })
  if (status !== 200)
    throw new Error((data as { error?: string }).error ?? `HTTP ${status}`)
}

// Recover an existing player identity by name + 4-digit PIN (e.g. on a new
// device). Returns the player's id on a match — the caller is responsible
// for adopting it as this device's identity (see multiplayerStore.loginAs).
export async function apiLoginPlayer(
  name: string,
  pin: string,
): Promise<string> {
  const { status, data } = await request('/players/login', {
    method: 'POST',
    body: JSON.stringify({ name, pin }),
  })
  if (status !== 200 || !data.playerId)
    throw new Error(
      (data as { error?: string }).error ?? `HTTP ${status}`,
    )
  return data.playerId as string
}
