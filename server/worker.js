// Word Croosh game server: a thin Cloudflare Worker over Neon Postgres.
//
// The game row stores an authoritative snapshot of the game state (the same
// SavedGameState shape the clients use), guarded by an optimistic `version`
// counter. Clients poll GET with their last-seen version; writers PUT with
// the version they based their move on — a mismatch means they were stale.
// On each accepted move the worker sends a payload-less Web Push to the
// player whose turn it now is.
//
// Deploy:   npx wrangler deploy
// Secrets:  npx wrangler secret put DATABASE_URL        (Neon connection string)
//           npx wrangler secret put VAPID_PRIVATE_JWK   (same key as push-server)

import { neon } from '@neondatabase/serverless'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })

let schemaReady = false
async function ensureSchema(sql) {
  if (schemaReady) return
  // CREATE TABLE IF NOT EXISTS only handles a table that doesn't exist yet —
  // on a database from before a column was added, it silently no-ops and
  // that column is never created. Every column added after the table's
  // original release needs an explicit ALTER ... ADD COLUMN IF NOT EXISTS
  // below so this stays idempotent on both fresh and pre-existing databases.
  await sql`
		CREATE TABLE IF NOT EXISTS games (
			code TEXT PRIMARY KEY,
			version INT NOT NULL DEFAULT 1,
			seed DOUBLE PRECISION,
			guest_joined BOOLEAN NOT NULL DEFAULT FALSE,
			state JSONB,
			push_subs JSONB NOT NULL DEFAULT '{}',
			host_id TEXT,
			guest_id TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`
  await sql`ALTER TABLE games ADD COLUMN IF NOT EXISTS host_color TEXT`
  await sql`ALTER TABLE games ADD COLUMN IF NOT EXISTS guest_color TEXT`

  // One row per device that has ever played — `id` is the client's
  // persistent device UUID (the same one already used as host_id/guest_id).
  await sql`
		CREATE TABLE IF NOT EXISTS players (
			id TEXT PRIMARY KEY,
			first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS name TEXT`
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS color TEXT`

  // One row per finished game (a rematch under the same code gets its own
  // row here, unlike `games` which is overwritten in place). Stores the
  // full final board so a player can reopen exactly what the game looked
  // like when it ended.
  await sql`
		CREATE TABLE IF NOT EXISTS game_results (
			id SERIAL PRIMARY KEY,
			code TEXT NOT NULL,
			seed DOUBLE PRECISION,
			host_id TEXT,
			guest_id TEXT,
			host_score INT NOT NULL,
			guest_score INT NOT NULL,
			winner_seat INT, -- 0 host, 1 guest, NULL = tie
			final_state JSONB,
			finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`
  await sql`CREATE INDEX IF NOT EXISTS game_results_code_idx ON game_results (code)`
  await sql`CREATE INDEX IF NOT EXISTS game_results_host_idx ON game_results (host_id)`
  await sql`CREATE INDEX IF NOT EXISTS game_results_guest_idx ON game_results (guest_id)`
  schemaReady = true
}

// A device is "seen" whenever it's known to be playing (join, or a state
// write) — upserts its players row so it shows up as a stable identity.
async function touchPlayer(sql, id) {
  if (!id) return
  await sql`
		INSERT INTO players (id) VALUES (${id})
		ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`
}

// The 8 selectable tile colors, matching src/utils/constants.ts TILE_COLORS.
// A player's `players.color` is their stored preference; if it collides
// with their opponent's in a given game, one seat gets reassigned a random
// different color for that game only (see resolveGameColors) — the stored
// preference itself never changes from a collision.
const TILE_COLORS = [
  'yellow', 'orange', 'pink', 'purple', 'blue', 'teal', 'green', 'gray',
]

function randomColor(excluding) {
  const options = TILE_COLORS.filter((c) => c !== excluding)
  return options[Math.floor(Math.random() * options.length)]
}

// Resolve the two seats' effective in-game colors from their stored
// preferences, reassigning the guest's if it collides with the host's.
function resolveGameColors(hostColor, guestColor) {
  hostColor ??= randomColor()
  if (!guestColor || guestColor === hostColor) {
    guestColor = randomColor(hostColor)
  }
  return [hostColor, guestColor]
}

// Rack pile indices, matching src/utils/constants.ts RACK_PILE — the
// server is the sole authority on final scoring, so this mirrors the
// client's "sum of leftover tile values" end-of-game deduction exactly.
const RACK_PILE = [1000, 1001]

function finalScores(state) {
  const [wordScoreHost, wordScoreGuest] = state.scores ?? [0, 0]
  const leftover = [0, 0]
  for (const c of state.cards ?? []) {
    const seat = RACK_PILE.indexOf(c.pileIndex)
    if (seat !== -1) leftover[seat] += c.value ?? 0
  }
  return [wordScoreHost - leftover[0], wordScoreGuest - leftover[1]]
}

// Which seat does this device hold? The server is the authority on roles —
// clients send a persistent device id (`?d=`) with every request.
function seatOf(row, dev) {
  if (dev && row.host_id === dev) return 0
  if (dev && row.guest_id === dev) return 1
  return null
}

// [hostValue, guestValue] for one players.<column>, either null if that
// seat has no player row / no value set yet.
async function columnFor(sql, row, column) {
  const ids = [row.host_id, row.guest_id].filter(Boolean)
  if (!ids.length) return [null, null]
  const rows =
    column === 'color'
      ? await sql`SELECT id, color FROM players WHERE id = ANY(${ids})`
      : await sql`SELECT id, name FROM players WHERE id = ANY(${ids})`
  const byId = new Map(rows.map((r) => [r.id, r[column]]))
  return [byId.get(row.host_id) ?? null, byId.get(row.guest_id) ?? null]
}
const namesFor = (sql, row) => columnFor(sql, row, 'name')
const colorPrefsFor = (sql, row) => columnFor(sql, row, 'color')

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  return Array.from(
    { length: 4 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join('')
}

// ── Web Push (payload-less, RFC 8292 VAPID) ─────────────────────────
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

async function vapidAuthHeader(endpoint, env) {
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)))
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: 'mailto:daniel.whiffing@gmail.com',
  })}`
  const key = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(env.VAPID_PRIVATE_JWK),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  )
  return `vapid t=${unsigned}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`
}

async function sendPush(sub, env) {
  if (!sub?.endpoint?.startsWith('https://') || !env.VAPID_PRIVATE_JWK) return
  try {
    await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        TTL: '86400',
        Urgency: 'high',
        Authorization: await vapidAuthHeader(sub.endpoint, env),
      },
    })
  } catch {
    // best effort — a dead subscription must not fail the move
  }
}

// ── Routes ──────────────────────────────────────────────────────────
export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
    const sql = neon(env.DATABASE_URL)
    await ensureSchema(sql)

    const url = new URL(req.url)
    const parts = url.pathname.split('/').filter(Boolean) // e.g. ["games", "ABCD", "join"]
    const dev = url.searchParams.get('d')

    try {
      // GET /players/:id → { name, color } (either null if never set)
      if (parts[0] === 'players' && req.method === 'GET' && !parts[2]) {
        ctx.waitUntil(touchPlayer(sql, parts[1]))
        const rows = await sql`
					SELECT name, color FROM players WHERE id = ${parts[1]}`
        return json({
          name: rows[0]?.name ?? null,
          color: rows[0]?.color ?? null,
        })
      }

      // PUT /players/:id { name, color } → set/change profile.
      // name: up to 12 chars. color: one of TILE_COLORS — this is the
      // player's stored *preference*; a same-game collision with the
      // opponent is resolved separately (see resolveGameColors), not here.
      if (parts[0] === 'players' && req.method === 'PUT' && !parts[2]) {
        const { name, color } = await req.json()
        if (typeof name !== 'string' || !name.trim() || name.length > 12)
          return json({ error: 'bad name' }, 400)
        if (!TILE_COLORS.includes(color))
          return json({ error: 'bad color' }, 400)
        await sql`
					INSERT INTO players (id, name, color) VALUES (${parts[1]}, ${name.trim()}, ${color})
					ON CONFLICT (id) DO UPDATE SET
						name = ${name.trim()}, color = ${color}, last_seen_at = now()`
        return json({ ok: true })
      }

      // GET /players/:id/games → history of finished games this player was in
      if (parts[0] === 'players' && req.method === 'GET' && parts[2] === 'games') {
        const playerId = parts[1]
        const rows = await sql`
					SELECT code, seed, host_id, guest_id, host_score, guest_score,
						winner_seat, final_state, finished_at
					FROM game_results
					WHERE host_id = ${playerId} OR guest_id = ${playerId}
					ORDER BY finished_at DESC LIMIT 200`
        return json({
          games: rows.map((r) => ({
            code: r.code,
            you: r.host_id === playerId ? 0 : 1,
            opponentId: r.host_id === playerId ? r.guest_id : r.host_id,
            hostScore: r.host_score,
            guestScore: r.guest_score,
            winnerSeat: r.winner_seat,
            finalState: r.final_state,
            finishedAt: r.finished_at,
          })),
        })
      }

      if (parts[0] !== 'games') return json({ error: 'not found' }, 404)
      const code = parts[1]?.toUpperCase()

      // POST /games → create a game, returns its code
      if (req.method === 'POST' && !code) {
        // opportunistic cleanup of long-dead games
        ctx.waitUntil(
          sql`DELETE FROM games WHERE updated_at < now() - interval '30 days'`,
        )
        ctx.waitUntil(touchPlayer(sql, dev))
        for (let i = 0; i < 5; i++) {
          const c = generateCode()
          const rows =
            await sql`INSERT INTO games (code, host_id) VALUES (${c}, ${dev})
							ON CONFLICT (code) DO NOTHING RETURNING code`
          if (rows.length) return json({ code: c, version: 1, you: 0 })
        }
        return json({ error: 'could not allocate code' }, 500)
      }
      if (!code) return json({ error: 'not found' }, 404)

      // POST /games/:code/join → claim the guest seat (the host joining
      // its own game keeps the host seat)
      if (req.method === 'POST' && parts[2] === 'join') {
        ctx.waitUntil(touchPlayer(sql, dev))
        const rows = await sql`
					UPDATE games SET guest_joined = TRUE,
						guest_id = CASE WHEN host_id = ${dev} THEN guest_id ELSE ${dev} END,
						version = version + 1, updated_at = now()
					WHERE code = ${code}
					RETURNING version, seed, state, host_id, guest_id, host_color, guest_color`
        if (!rows.length) return json({ error: 'no such game' }, 404)
        let g = rows[0]
        // Resolve each seat's in-game color once, the first time both seats
        // are known — a reconnect/rejoin must not reshuffle an already-set
        // pair, so this only fires while host_color is still unset.
        if (!g.host_color) {
          const [hostPref, guestPref] = await colorPrefsFor(sql, g)
          const [hostColor, guestColor] = resolveGameColors(hostPref, guestPref)
          const updated = await sql`
						UPDATE games SET host_color = ${hostColor}, guest_color = ${guestColor}
						WHERE code = ${code}
						RETURNING version, seed, state, host_id, guest_id, host_color, guest_color`
          g = updated[0]
        }
        const [hostName, guestName] = await namesFor(sql, g)
        return json({
          version: g.version,
          seed: g.seed,
          state: g.state,
          you: seatOf(g, dev),
          hostName,
          guestName,
          hostColor: g.host_color,
          guestColor: g.guest_color,
        })
      }

      // PUT /games/:code/push-sub { playerIndex, subscription }
      if (req.method === 'PUT' && parts[2] === 'push-sub') {
        const { playerIndex, subscription } = await req.json()
        if (playerIndex !== 0 && playerIndex !== 1)
          return json({ error: 'bad playerIndex' }, 400)
        const rows = await sql`
					UPDATE games
					SET push_subs = push_subs || ${JSON.stringify({ [playerIndex]: subscription })}::jsonb,
						updated_at = now()
					WHERE code = ${code} RETURNING code`
        if (!rows.length) return json({ error: 'no such game' }, 404)
        return json({ ok: true })
      }

      // PUT /games/:code/state { state, seed, version } → optimistic write
      if (req.method === 'PUT' && parts[2] === 'state') {
        const { state, seed, version } = await req.json()
        if (!state || typeof version !== 'number')
          return json({ error: 'bad body' }, 400)
        ctx.waitUntil(touchPlayer(sql, dev))
        const before = await sql`
					SELECT state, host_id, guest_id FROM games WHERE code = ${code}`
        const wasGameOver = before[0]?.state?.gameOver ?? false
        const rows = await sql`
					UPDATE games
					SET state = ${JSON.stringify(state)}::jsonb, seed = ${seed ?? null},
						version = version + 1, updated_at = now()
					WHERE code = ${code} AND version = ${version}
					RETURNING version, push_subs`
        if (!rows.length) {
          const cur = await sql`
						SELECT version, seed, guest_joined, state, host_id, guest_id,
							host_color, guest_color
						FROM games WHERE code = ${code}`
          if (!cur.length) return json({ error: 'no such game' }, 404)
          // stale writer: hand back the current truth
          return json({ conflict: true, ...(await shape(sql, cur[0], dev)) }, 409)
        }
        // record the result exactly once, the moment a game finishes —
        // the leftover-rack deduction happens here, not on the client, so
        // it's correct regardless of which client's upload wins any race.
        if (state.gameOver && !wasGameOver) {
          const [hostScore, guestScore] = finalScores(state)
          const winnerSeat =
            hostScore === guestScore ? null : hostScore > guestScore ? 0 : 1
          const { host_id, guest_id } = before[0] ?? {}
          ctx.waitUntil(
            sql`INSERT INTO game_results
							(code, seed, host_id, guest_id, host_score, guest_score, winner_seat, final_state)
							VALUES (${code}, ${seed ?? null}, ${host_id ?? null}, ${guest_id ?? null},
								${hostScore}, ${guestScore}, ${winnerSeat}, ${JSON.stringify(state)}::jsonb)`,
          )
        }
        // notify the player whose turn it now is (skip fresh deals)
        const subs = rows[0].push_subs ?? {}
        const next = state.currentPlayerIndex
        if ((state.moveCount ?? 0) > 0 && !state.gameOver && subs[next]) {
          ctx.waitUntil(sendPush(subs[next], env))
        }
        return json({ version: rows[0].version })
      }

      // GET /games/:code/results → per-code win tally + recent history
      if (req.method === 'GET' && parts[2] === 'results') {
        const rows = await sql`
					SELECT host_score, guest_score, winner_seat, finished_at
					FROM game_results WHERE code = ${code}
					ORDER BY finished_at DESC LIMIT 50`
        const wins = [0, 0]
        for (const r of rows) {
          if (r.winner_seat === 0) wins[0]++
          else if (r.winner_seat === 1) wins[1]++
        }
        return json({
          wins,
          games: rows.map((r) => ({
            hostScore: r.host_score,
            guestScore: r.guest_score,
            winnerSeat: r.winner_seat,
            finishedAt: r.finished_at,
          })),
        })
      }

      // GET /games/:code?v=N → poll; state omitted when nothing changed
      if (req.method === 'GET' && !parts[2]) {
        const since = Number(url.searchParams.get('v') ?? -1)
        const rows = await sql`
					SELECT version, seed, guest_joined, state, host_id, guest_id,
						host_color, guest_color
					FROM games WHERE code = ${code}`
        if (!rows.length) return json({ error: 'no such game' }, 404)
        const g = rows[0]
        if (g.version === since)
          return json({
            changed: false,
            version: g.version,
            you: seatOf(g, dev),
          })
        return json({ changed: true, ...(await shape(sql, g, dev)) })
      }

      return json({ error: 'not found' }, 404)
    } catch (e) {
      return json({ error: String(e?.message ?? e) }, 500)
    }
  },
}

async function shape(sql, row, dev) {
  const [hostName, guestName] = await namesFor(sql, row)
  return {
    version: row.version,
    seed: row.seed,
    guestJoined: row.guest_joined,
    state: row.state,
    you: seatOf(row, dev),
    hostName,
    guestName,
    hostColor: row.host_color ?? null,
    guestColor: row.guest_color ?? null,
  }
}
