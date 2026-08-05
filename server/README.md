# Word Croosh game server

Cloudflare Worker + Neon Postgres. Stores an authoritative snapshot per game
(the clients' `SavedGameState`), guarded by an optimistic `version` counter,
and sends the "your turn" Web Push after each accepted move. Replaces the
old PeerJS P2P transport **and** the `push-server/` relay (both obsolete —
the old workers can be removed with `npx wrangler delete word-croosh-push`).

## API

- `POST /games` → `{ code, version }` — create a game
- `POST /games/:code/join` → `{ version, seed, state }` — guest joins
- `GET  /games/:code?v=N` → `{ changed, version, seed, guestJoined, state }`
  (`changed: false` and no state when nothing is newer than version N)
- `PUT  /games/:code/state` `{ state, seed, version }` — optimistic write;
  `409 { conflict: true, …current row }` if `version` is stale
- `PUT  /games/:code/push-sub` `{ playerIndex, subscription }`

The 4-letter game code is the only credential (capability URL model). The
schema is created automatically on first request; games idle for 30 days are
cleaned up opportunistically.

## Deploying

1. Create a Neon project (free tier — autosuspends and auto-wakes) and copy
   its connection string.
2. ```bash
   cd server
   npm install                # @neondatabase/serverless
   npx wrangler deploy        # prints https://word-croosh-api.<subdomain>.workers.dev
   npx wrangler secret put DATABASE_URL       # paste the Neon connection string
   npx wrangler secret put VAPID_PRIVATE_JWK  # same key as before (see below)
   ```
3. If the printed URL differs from the default in `src/utils/api.ts`
   (`word-croosh-api.danielwhiffing.workers.dev`), update that constant and
   redeploy the site.

The VAPID public key lives in `wrangler.toml` and `src/utils/push.ts`; the
private JWK is the same one used by the old push relay.

## Local development / tests

No Neon needed: run the in-memory mock (same contract) and point the client
at it:

```bash
node scratchpad/mock-api.mjs           # port 8788 (see e2e test scripts)
VITE_API_URL=http://localhost:8788 pnpm dev
```
