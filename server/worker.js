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

const MAX_PLAYERS = 4

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
			state JSONB,
			push_subs JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`
  await sql`ALTER TABLE games ADD COLUMN IF NOT EXISTS max_players INT NOT NULL DEFAULT 2`
  await sql`ALTER TABLE games ADD COLUMN IF NOT EXISTS started BOOLEAN NOT NULL DEFAULT FALSE`
  // Rate-limits POST /games/:code/nudge — last time ANY player nudged the
  // current mover, regardless of who sent it (a shared cooldown, not
  // per-sender, so nobody can be nudged by everyone at once either).
  await sql`ALTER TABLE games ADD COLUMN IF NOT EXISTS last_nudge_at TIMESTAMPTZ`

  // One row per device that has ever played — `id` is the client's
  // persistent device UUID.
  await sql`
		CREATE TABLE IF NOT EXISTS players (
			id TEXT PRIMARY KEY,
			first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS name TEXT`
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS color TEXT`
  // PIN-based login: a name + 4-digit PIN recovers a player's identity on a
  // new device (see POST /players/login). Hashed, never stored/returned as
  // plaintext. Name uniqueness is enforced case-insensitively via a partial
  // index (partial so it doesn't choke on old NULL-named rows, and NULLIF
  // on empty string so a blank name can't collide) — this can't be a plain
  // UNIQUE column constraint added after the fact if any duplicates already
  // exist, so it's a best-effort index; the login/name-set queries below are
  // what actually enforce it going forward.
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS pin_hash TEXT`
  // Guarded in a try/catch: if any pre-existing rows already collide on
  // name (case-insensitively), creating the index throws and would
  // otherwise break ensureSchema — and therefore the whole worker — on
  // every request. Degrades to "not yet enforced" rather than "down".
  try {
    await sql`
			CREATE UNIQUE INDEX IF NOT EXISTS players_name_unique_idx
			ON players (lower(name)) WHERE name IS NOT NULL`
  } catch {
    // pre-existing duplicate names — see comment above
  }

  // One row per seat in a game — replaces the old host_id/guest_id/
  // host_color/guest_color named-column scheme so a game can have any
  // number of seats up to MAX_PLAYERS. `seat` is the fixed 0..N-1 turn-order
  // index assigned when the player joins.
  await sql`
		CREATE TABLE IF NOT EXISTS game_players (
			code TEXT NOT NULL,
			seat INT NOT NULL,
			device_id TEXT NOT NULL,
			color TEXT,
			joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (code, seat)
		)`
  await sql`CREATE INDEX IF NOT EXISTS game_players_device_idx ON game_players (device_id)`

  // One row per finished game (a rematch under the same code gets its own
  // row here, unlike `games` which is overwritten in place). Stores the
  // full final board so a player can reopen exactly what the game looked
  // like when it ended.
  await sql`
		CREATE TABLE IF NOT EXISTS game_results (
			id SERIAL PRIMARY KEY,
			code TEXT NOT NULL,
			seed DOUBLE PRECISION,
			winner_seat INT, -- NULL = tie
			final_state JSONB,
			finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`
  // `scores`/`seat_device_ids` replace the old host_score/guest_score/
  // host_id/guest_id columns — nullable since CREATE TABLE IF NOT EXISTS is
  // a no-op against an already-existing table, so old rows never get a
  // value backfilled (and NOT NULL would reject the ALTER on those rows).
  await sql`ALTER TABLE game_results ADD COLUMN IF NOT EXISTS scores JSONB`
  await sql`ALTER TABLE game_results ADD COLUMN IF NOT EXISTS seat_device_ids JSONB`
  // The color each seat actually played with in this specific finished
  // game — game_players.color can later change (a rematch under the same
  // code can reassign it), so this is captured at game-end time to stay
  // historically accurate, unlike a live join of players.color (a
  // preference that can also change after the fact).
  await sql`ALTER TABLE game_results ADD COLUMN IF NOT EXISTS seat_colors JSONB`
  // The old host_score/guest_score columns (from before the seat-based
  // rewrite) are no longer written to, but their NOT NULL constraints from
  // the original CREATE TABLE still stand on a pre-existing table — every
  // insert violated them until these were relaxed, so game_results rows
  // were silently never created (a swallowed ctx.waitUntil error). Guarded
  // with a column-existence check since a fresh DB never has these columns.
  await sql`
		DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name = 'game_results' AND column_name = 'host_score') THEN
				ALTER TABLE game_results ALTER COLUMN host_score DROP NOT NULL;
			END IF;
			IF EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name = 'game_results' AND column_name = 'guest_score') THEN
				ALTER TABLE game_results ALTER COLUMN guest_score DROP NOT NULL;
			END IF;
		END $$`
  await sql`CREATE INDEX IF NOT EXISTS game_results_code_idx ON game_results (code)`
  schemaReady = true
}

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

// PIN hashing (SHA-256 with a fixed app-level salt — a 4-digit PIN has only
// 10,000 possibilities so this is not meant to resist a targeted brute
// force; it just avoids storing PINs in plaintext against casual DB access).
async function hashPin(pin) {
  const data = new TextEncoder().encode(`word-croosh-pin:${pin}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return b64url(digest)
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
// with another seat's in a given game, the later-joining seat gets
// reassigned a random different color for that game only (see
// resolveSeatColor) — the stored preference itself never changes.
const TILE_COLORS = [
  'yellow', 'orange', 'pink', 'purple', 'blue', 'teal', 'green', 'gray',
]

function randomColor(excluding = []) {
  const options = TILE_COLORS.filter((c) => !excluding.includes(c))
  return options[Math.floor(Math.random() * options.length)]
}

// Resolve a joining seat's effective in-game color from their stored
// preference, avoiding every color already taken by an earlier seat.
function resolveSeatColor(preferredColor, takenColors) {
  if (preferredColor && !takenColors.includes(preferredColor))
    return preferredColor
  return randomColor(takenColors)
}

// Rack pile indices, matching src/utils/constants.ts RACK_PILE — the
// server is the sole authority on final scoring, so this mirrors the
// client's "sum of leftover tile values" end-of-game deduction exactly.
const RACK_PILE = [1000, 1001, 1002, 1003]

function finalScores(state) {
  const scores = [...(state.scores ?? [])]
  const leftover = scores.map(() => 0)
  for (const c of state.cards ?? []) {
    const seat = RACK_PILE.indexOf(c.pileIndex)
    if (seat !== -1 && seat < leftover.length) leftover[seat] += c.value ?? 0
  }
  return scores.map((s, i) => s - leftover[i])
}

// Every seat for a game, in turn order, with each seat's device id and
// resolved in-game color.
async function seatsFor(sql, code) {
  const rows = await sql`
		SELECT seat, device_id, color FROM game_players
		WHERE code = ${code} ORDER BY seat ASC`
  return rows
}

// Which seat does this device hold in this game? The server is the
// authority on roles — clients send a persistent device id (`?d=`) with
// every request.
function seatOf(seats, dev) {
  const row = seats.find((s) => s.device_id === dev)
  return row ? row.seat : null
}

// Player profile (name) for every seat, in seat order.
async function namesFor(sql, seats) {
  if (!seats.length) return []
  const ids = seats.map((s) => s.device_id)
  const rows = await sql`SELECT id, name FROM players WHERE id = ANY(${ids})`
  const byId = new Map(rows.map((r) => [r.id, r.name]))
  return seats.map((s) => byId.get(s.device_id) ?? null)
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  return Array.from(
    { length: 4 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join('')
}

// ── Web Push (payload-less, RFC 8292 VAPID) ─────────────────────────

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

      // PUT /players/:id { name, color, pin } → set/change profile.
      // name: up to 12 chars, unique (case-insensitive). color: one of
      // TILE_COLORS — this is the player's stored *preference*; a
      // same-game collision with another seat is resolved separately (see
      // resolveSeatColor), not here. pin: exactly 4 digits, required —
      // it's what lets this name+pin recover the account on a new device
      // (see POST /players/login). Changing color/keeping the same name
      // doesn't require re-entering the pin correctly since it's not a
      // login, just a profile edit from the device that already holds it;
      // but changing the pin itself always needs one, so it's simplest to
      // always require it and just re-hash on every save.
      if (parts[0] === 'players' && req.method === 'PUT' && !parts[2]) {
        const { name, color, pin } = await req.json()
        if (typeof name !== 'string' || !name.trim() || name.length > 12)
          return json({ error: 'bad name' }, 400)
        if (!TILE_COLORS.includes(color))
          return json({ error: 'bad color' }, 400)
        if (typeof pin !== 'string' || !/^\d{4}$/.test(pin))
          return json({ error: 'pin must be exactly 4 digits' }, 400)
        const trimmed = name.trim()
        const clash = await sql`
					SELECT id FROM players WHERE lower(name) = lower(${trimmed}) AND id != ${parts[1]}`
        if (clash.length) return json({ error: 'name already taken' }, 409)
        const pinHash = await hashPin(pin)
        await sql`
					INSERT INTO players (id, name, color, pin_hash) VALUES (${parts[1]}, ${trimmed}, ${color}, ${pinHash})
					ON CONFLICT (id) DO UPDATE SET
						name = ${trimmed}, color = ${color}, pin_hash = ${pinHash}, last_seen_at = now()`
        return json({ ok: true })
      }

      // POST /players/login { name, pin } → { playerId } if the name+pin
      // match an existing player record, so a new device can recover the
      // identity behind that name instead of creating a fresh one. Client
      // then overwrites its local device id with the returned playerId.
      if (parts[0] === 'players' && req.method === 'POST' && parts[1] === 'login') {
        const { name, pin } = await req.json()
        if (typeof name !== 'string' || !name.trim())
          return json({ error: 'bad name' }, 400)
        if (typeof pin !== 'string' || !/^\d{4}$/.test(pin))
          return json({ error: 'pin must be exactly 4 digits' }, 400)
        const pinHash = await hashPin(pin)
        const rows = await sql`
					SELECT id FROM players WHERE lower(name) = lower(${name.trim()}) AND pin_hash = ${pinHash}`
        if (!rows.length) return json({ error: 'no match for that name and pin' }, 404)
        ctx.waitUntil(touchPlayer(sql, rows[0].id))
        return json({ playerId: rows[0].id })
      }

      // GET /players/:id/games → history of finished games this player was in
      if (parts[0] === 'players' && req.method === 'GET' && parts[2] === 'games') {
        const playerId = parts[1]
        // The jsonb `?` operator tests top-level KEYS (seat numbers here,
        // e.g. "0"/"1"), not values — seat_device_ids' values are the
        // device ids, so this needs an EXISTS over jsonb_each_text to
        // actually search by value.
        const rows = await sql`
					SELECT code, seed, scores, seat_device_ids, seat_colors, winner_seat, final_state, finished_at
					FROM game_results
					WHERE EXISTS (
						SELECT 1 FROM jsonb_each_text(seat_device_ids) AS kv(seat, device_id)
						WHERE kv.device_id = ${playerId}
					)
					ORDER BY finished_at DESC LIMIT 200`
        // Every device id across every returned game, in one batch, so each
        // row's seats can be labeled with a name without a query per row.
        // Color is NOT looked up here — players.color is just a live
        // preference and can change after the fact; seat_colors on the row
        // is the color actually played with in that specific game.
        const allIds = [
          ...new Set(rows.flatMap((r) => Object.values(r.seat_device_ids ?? {}))),
        ]
        const nameById = new Map()
        if (allIds.length) {
          const playerRows = await sql`
						SELECT id, name FROM players WHERE id = ANY(${allIds})`
          for (const p of playerRows) nameById.set(p.id, p.name)
        }
        return json({
          games: rows.map((r) => {
            const seatIds = r.seat_device_ids ?? {}
            const seatColors = r.seat_colors ?? {}
            const you = Number(
              Object.entries(seatIds).find(([, id]) => id === playerId)?.[0],
            )
            const seats = Object.entries(seatIds)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([seat, id]) => ({
                seat: Number(seat),
                name: nameById.get(id) ?? null,
                color: seatColors[seat] ?? null,
              }))
            return {
              code: r.code,
              you,
              seats,
              scores: r.scores,
              winnerSeat: r.winner_seat,
              finalState: r.final_state,
              finishedAt: r.finished_at,
            }
          }),
        })
      }

      if (parts[0] !== 'games') return json({ error: 'not found' }, 404)
      const code = parts[1]?.toUpperCase()

      // POST /games { maxPlayers } → create a game, returns its code
      if (req.method === 'POST' && !code) {
        const body = await req.json().catch(() => ({}))
        const requestedMax = Number(body.maxPlayers) || MAX_PLAYERS
        const clampedMax = Math.min(MAX_PLAYERS, Math.max(2, requestedMax))
        // opportunistic cleanup of long-dead games
        ctx.waitUntil(
          sql`DELETE FROM games WHERE updated_at < now() - interval '30 days'`,
        )
        ctx.waitUntil(touchPlayer(sql, dev))
        for (let i = 0; i < 5; i++) {
          const c = generateCode()
          const rows = await sql`
						INSERT INTO games (code, max_players) VALUES (${c}, ${clampedMax})
						ON CONFLICT (code) DO NOTHING RETURNING code`
          if (rows.length) {
            const pref = await sql`SELECT name, color FROM players WHERE id = ${dev}`
            const color = pref[0]?.color ?? randomColor()
            await sql`
							INSERT INTO game_players (code, seat, device_id, color) VALUES (${c}, 0, ${dev}, ${color})`
            return json({
              code: c,
              version: 1,
              you: 0,
              maxPlayers: clampedMax,
              started: false,
              seats: [{ seat: 0, name: pref[0]?.name ?? null, color }],
            })
          }
        }
        return json({ error: 'could not allocate code' }, 500)
      }
      if (!code) return json({ error: 'not found' }, 404)

      // POST /games/:code/join → claim the next open seat (a device already
      // seated, including the host, keeps its existing seat on rejoin)
      if (req.method === 'POST' && parts[2] === 'join') {
        ctx.waitUntil(touchPlayer(sql, dev))
        const gameRows = await sql`
					SELECT code, version, seed, state, max_players, started FROM games WHERE code = ${code}`
        if (!gameRows.length) return json({ error: 'no such game' }, 404)
        const game = gameRows[0]

        let seats = await seatsFor(sql, code)
        let mySeat = seatOf(seats, dev)
        if (mySeat == null) {
          if (game.started) return json({ error: 'game already started' }, 409)
          if (seats.length >= game.max_players)
            return json({ error: 'game is full' }, 409)
          mySeat = seats.length
          const [preference] = await sql`
						SELECT color FROM players WHERE id = ${dev}`
          const takenColors = seats.map((s) => s.color).filter(Boolean)
          const color = resolveSeatColor(preference?.color ?? null, takenColors)
          await sql`
						INSERT INTO game_players (code, seat, device_id, color)
						VALUES (${code}, ${mySeat}, ${dev}, ${color})
						ON CONFLICT (code, seat) DO NOTHING`
          await sql`UPDATE games SET version = version + 1, updated_at = now() WHERE code = ${code}`
          seats = await seatsFor(sql, code)
        }

        const names = await namesFor(sql, seats)
        const versionRows = await sql`SELECT version FROM games WHERE code = ${code}`
        return json({
          version: versionRows[0].version,
          seed: game.seed,
          state: game.state,
          you: mySeat,
          maxPlayers: game.max_players,
          started: game.started,
          seats: seats.map((s, i) => ({
            seat: s.seat,
            name: names[i],
            color: s.color,
          })),
        })
      }

      // PUT /games/:code/push-sub { subscription } → registers a push
      // subscription for the CALLER's own seat, derived from their device
      // id server-side — a client-supplied playerIndex would let any seat
      // overwrite any other seat's subscription.
      if (req.method === 'PUT' && parts[2] === 'push-sub') {
        const { subscription } = await req.json()
        const seats = await seatsFor(sql, code)
        const mySeat = seatOf(seats, dev)
        if (mySeat == null) return json({ error: 'not seated in this game' }, 403)
        const rows = await sql`
					UPDATE games
					SET push_subs = push_subs || ${JSON.stringify({ [mySeat]: subscription })}::jsonb,
						updated_at = now()
					WHERE code = ${code} RETURNING code`
        if (!rows.length) return json({ error: 'no such game' }, 404)
        return json({ ok: true })
      }

      // POST /games/:code/nudge → re-sends the "your turn" push to whoever
      // is currently the active player. Any OTHER seated player can call
      // this; rate-limited to once every 60s per game (shared across all
      // callers) so it can't be used to spam the current mover.
      if (req.method === 'POST' && parts[2] === 'nudge') {
        const gameRows = await sql`
					SELECT state, push_subs, last_nudge_at FROM games WHERE code = ${code}`
        if (!gameRows.length) return json({ error: 'no such game' }, 404)
        const g = gameRows[0]
        const seats = await seatsFor(sql, code)
        const mySeat = seatOf(seats, dev)
        if (mySeat == null) return json({ error: 'not seated in this game' }, 403)
        const state = g.state
        if (!state || state.gameOver)
          return json({ error: 'no game in progress' }, 409)
        const target = state.currentPlayerIndex
        if (target === mySeat)
          return json({ error: "it's your turn — nothing to nudge" }, 400)
        if (g.last_nudge_at && Date.now() - new Date(g.last_nudge_at).getTime() < 60_000)
          return json({ error: 'already nudged recently — try again in a bit' }, 429)
        const sub = (g.push_subs ?? {})[target]
        if (!sub) return json({ error: 'that player has no notifications enabled' }, 409)
        await sql`UPDATE games SET last_nudge_at = now() WHERE code = ${code}`
        ctx.waitUntil(sendPush(sub, env))
        return json({ ok: true })
      }

      // POST /games/:code/start → host marks the lobby closed; the client
      // uploads the actual seed/state via PUT .../state right after, which
      // also sets `started` — so this deliberately does NOT bump `version`,
      // otherwise it would race that immediately-following state upload's
      // optimistic version check.
      if (req.method === 'POST' && parts[2] === 'start') {
        const seats = await seatsFor(sql, code)
        if (seatOf(seats, dev) !== 0)
          return json({ error: 'only the host can start the game' }, 403)
        await sql`UPDATE games SET started = TRUE, updated_at = now() WHERE code = ${code}`
        return json({ ok: true })
      }

      // PUT /games/:code/state { state, seed, version } → optimistic write
      if (req.method === 'PUT' && parts[2] === 'state') {
        const { state, seed, version } = await req.json()
        if (!state || typeof version !== 'number')
          return json({ error: 'bad body' }, 400)
        ctx.waitUntil(touchPlayer(sql, dev))
        const before = await sql`SELECT state FROM games WHERE code = ${code}`
        const wasGameOver = before[0]?.state?.gameOver ?? false
        const rows = await sql`
					UPDATE games
					SET state = ${JSON.stringify(state)}::jsonb, seed = ${seed ?? null},
						started = TRUE, version = version + 1, updated_at = now()
					WHERE code = ${code} AND version = ${version}
					RETURNING version, push_subs`
        if (!rows.length) {
          const cur = await sql`
						SELECT code, version, seed, state, max_players, started
						FROM games WHERE code = ${code}`
          if (!cur.length) return json({ error: 'no such game' }, 404)
          // stale writer: hand back the current truth
          return json({ conflict: true, ...(await shape(sql, cur[0], dev)) }, 409)
        }
        // record the result exactly once, the moment a game finishes —
        // the leftover-rack deduction happens here, not on the client, so
        // it's correct regardless of which client's upload wins any race.
        if (state.gameOver && !wasGameOver) {
          const seats = await seatsFor(sql, code)
          const scores = finalScores(state)
          const best = Math.max(...scores)
          const winners = scores.flatMap((s, i) => (s === best ? [i] : []))
          const winnerSeat = winners.length === 1 ? winners[0] : null
          const seatDeviceIds = Object.fromEntries(
            seats.map((s) => [s.seat, s.device_id]),
          )
          const seatColors = Object.fromEntries(
            seats.map((s) => [s.seat, s.color]),
          )
          ctx.waitUntil(
            sql`INSERT INTO game_results
							(code, seed, scores, seat_device_ids, seat_colors, winner_seat, final_state)
							VALUES (${code}, ${seed ?? null}, ${JSON.stringify(scores)}::jsonb,
								${JSON.stringify(seatDeviceIds)}::jsonb, ${JSON.stringify(seatColors)}::jsonb,
								${winnerSeat}, ${JSON.stringify(state)}::jsonb)`,
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
					SELECT scores, winner_seat, finished_at
					FROM game_results WHERE code = ${code}
					ORDER BY finished_at DESC LIMIT 50`
        const wins = {}
        for (const r of rows) {
          if (r.winner_seat != null) wins[r.winner_seat] = (wins[r.winner_seat] ?? 0) + 1
        }
        return json({
          wins,
          games: rows.map((r) => ({
            scores: r.scores,
            winnerSeat: r.winner_seat,
            finishedAt: r.finished_at,
          })),
        })
      }

      // GET /games/:code?v=N → poll; state omitted when nothing changed
      if (req.method === 'GET' && !parts[2]) {
        const since = Number(url.searchParams.get('v') ?? -1)
        const rows = await sql`
					SELECT code, version, seed, state, max_players, started
					FROM games WHERE code = ${code}`
        if (!rows.length) return json({ error: 'no such game' }, 404)
        const g = rows[0]
        const seats = await seatsFor(sql, code)
        if (g.version === since)
          return json({
            changed: false,
            version: g.version,
            you: seatOf(seats, dev),
          })
        return json({ changed: true, ...(await shape(sql, g, dev, seats)) })
      }

      return json({ error: 'not found' }, 404)
    } catch (e) {
      return json({ error: String(e?.message ?? e) }, 500)
    }
  },
}

async function shape(sql, row, dev, seats) {
  seats ??= await seatsFor(sql, row.code)
  const names = await namesFor(sql, seats)
  return {
    version: row.version,
    seed: row.seed,
    state: row.state,
    you: seatOf(seats, dev),
    maxPlayers: row.max_players,
    started: row.started,
    seats: seats.map((s, i) => ({
      seat: s.seat,
      name: names[i],
      color: s.color,
    })),
  }
}
