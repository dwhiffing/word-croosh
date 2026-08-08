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
  schemaReady = true
}

// Which seat does this device hold? The server is the authority on roles —
// clients send a persistent device id (`?d=`) with every request.
function seatOf(row, dev) {
  if (dev && row.host_id === dev) return 0
  if (dev && row.guest_id === dev) return 1
  return null
}

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
    if (parts[0] !== 'games') return json({ error: 'not found' }, 404)
    const code = parts[1]?.toUpperCase()
    const dev = url.searchParams.get('d')

    try {
      // POST /games → create a game, returns its code
      if (req.method === 'POST' && !code) {
        // opportunistic cleanup of long-dead games
        ctx.waitUntil(
          sql`DELETE FROM games WHERE updated_at < now() - interval '30 days'`,
        )
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
        const rows = await sql`
					UPDATE games SET guest_joined = TRUE,
						guest_id = CASE WHEN host_id = ${dev} THEN guest_id ELSE ${dev} END,
						version = version + 1, updated_at = now()
					WHERE code = ${code}
					RETURNING version, seed, state, host_id, guest_id`
        if (!rows.length) return json({ error: 'no such game' }, 404)
        const g = rows[0]
        return json({
          version: g.version,
          seed: g.seed,
          state: g.state,
          you: seatOf(g, dev),
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
        const rows = await sql`
					UPDATE games
					SET state = ${JSON.stringify(state)}::jsonb, seed = ${seed ?? null},
						version = version + 1, updated_at = now()
					WHERE code = ${code} AND version = ${version}
					RETURNING version, push_subs`
        if (!rows.length) {
          const cur = await sql`
						SELECT version, seed, guest_joined, state, host_id, guest_id
						FROM games WHERE code = ${code}`
          if (!cur.length) return json({ error: 'no such game' }, 404)
          // stale writer: hand back the current truth
          return json({ conflict: true, ...shape(cur[0], dev) }, 409)
        }
        // notify the player whose turn it now is (skip fresh deals)
        const subs = rows[0].push_subs ?? {}
        const next = state.currentPlayerIndex
        if ((state.moveCount ?? 0) > 0 && !state.gameOver && subs[next]) {
          ctx.waitUntil(sendPush(subs[next], env))
        }
        return json({ version: rows[0].version })
      }

      // GET /games/:code?v=N → poll; state omitted when nothing changed
      if (req.method === 'GET' && !parts[2]) {
        const since = Number(url.searchParams.get('v') ?? -1)
        const rows = await sql`
					SELECT version, seed, guest_joined, state, host_id, guest_id
					FROM games WHERE code = ${code}`
        if (!rows.length) return json({ error: 'no such game' }, 404)
        const g = rows[0]
        if (g.version === since)
          return json({
            changed: false,
            version: g.version,
            you: seatOf(g, dev),
          })
        return json({ changed: true, ...shape(g, dev) })
      }

      return json({ error: 'not found' }, 404)
    } catch (e) {
      return json({ error: String(e?.message ?? e) }, 500)
    }
  },
}

function shape(row, dev) {
  return {
    version: row.version,
    seed: row.seed,
    guestJoined: row.guest_joined,
    state: row.state,
    you: seatOf(row, dev),
  }
}
