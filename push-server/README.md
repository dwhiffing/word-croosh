# Word Croosh push relay

Stateless Cloudflare Worker that lets one player wake the other player's
device with a "your turn" notification. The client POSTs the opponent's
`PushSubscription` here; the worker signs a VAPID JWT and forwards a
payload-less push to the browser's push service. No storage, no accounts —
knowing a subscription endpoint (exchanged P2P over the game's data channel)
is the only credential.

Deployed at: `https://word-croosh-push.danielwhiffing.workers.dev`

## Deploying (first time)

```bash
# one-time: log in to Cloudflare (free tier is fine)
npx wrangler login

cd push-server
npx wrangler deploy            # prints the worker URL

# set the VAPID private key as a secret — paste ONLY the {"kty":...} JSON
# from .dev.vars (the part after VAPID_PRIVATE_JWK=)
npx wrangler secret put VAPID_PRIVATE_JWK
```

Then paste the worker URL into `PUSH_SERVER_URL` in `src/utils/push.ts` and
redeploy the site (`pnpm run deploy`). While that constant is empty, the
notifications feature is hidden in the app.

Verify it's up:

```bash
curl -X POST https://word-croosh-push.danielwhiffing.workers.dev -d '{}'
# → "bad subscription" (400) means the worker is running and parsing
```

## Redeploying after changes

```bash
cd push-server && npx wrangler deploy
```

Secrets persist across deploys; you only set `VAPID_PRIVATE_JWK` again if
you rotate the keypair.

## Rotating the VAPID keypair

Generate a new pair, then update all three places (they must match):

```bash
node -e "
const { generateKeyPairSync } = require('node:crypto');
const kp = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = kp.publicKey.export({ format: 'jwk' });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
console.log('PUBLIC=' + raw.toString('base64url'));
console.log('PRIVATE_JWK=' + JSON.stringify(kp.privateKey.export({ format: 'jwk' })));
"
```

- public key → `VAPID_PUBLIC_KEY` in `wrangler.toml` **and** `src/utils/push.ts`
- private key → `.dev.vars` (local) and `npx wrangler secret put VAPID_PRIVATE_JWK`

Rotating invalidates every existing subscription — players must tap
"Enable Notifications" again.

## On each device

Hamburger menu → **Enable Notifications** (appears once a game feature is
configured and permission not yet granted). iOS needs 16.4+ **and** the game
added to the home screen; Android Chrome works from the browser. The
permission is remembered — later visits resubscribe silently.
