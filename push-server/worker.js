// Stateless Web Push relay for Word Croosh.
//
// POST a PushSubscription JSON ({ endpoint, keys }) and this worker sends a
// payload-less push to it, signed with our VAPID key. The subscriber's
// service worker (public/push-sw.js) shows a generic "your turn" notification.
// Payload-less keeps this dependency-free: no aes128gcm encryption needed.
//
// Deploy:  npx wrangler deploy
// Secret:  npx wrangler secret put VAPID_PRIVATE_JWK   (see .dev.vars)

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const b64url = (buf) =>
	btoa(String.fromCharCode(...new Uint8Array(buf)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

// RFC 8292 VAPID: ES256-signed JWT in the Authorization header.
async function vapidAuthHeader(endpoint, env) {
	const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
	const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({
		aud: new URL(endpoint).origin,
		exp: Math.floor(Date.now() / 1000) + 12 * 3600,
		sub: "mailto:daniel.whiffing@gmail.com",
	})}`;
	const key = await crypto.subtle.importKey(
		"jwk",
		JSON.parse(env.VAPID_PRIVATE_JWK),
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		new TextEncoder().encode(unsigned),
	);
	return `vapid t=${unsigned}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

export default {
	async fetch(req, env) {
		if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
		if (req.method !== "POST")
			return new Response("POST only", { status: 405, headers: CORS });

		let sub;
		try {
			sub = await req.json();
		} catch {
			return new Response("bad json", { status: 400, headers: CORS });
		}
		if (typeof sub?.endpoint !== "string" || !sub.endpoint.startsWith("https://"))
			return new Response("bad subscription", { status: 400, headers: CORS });

		const res = await fetch(sub.endpoint, {
			method: "POST",
			headers: {
				TTL: "86400",
				Urgency: "high",
				Authorization: await vapidAuthHeader(sub.endpoint, env),
			},
		});
		// 201 = accepted; 404/410 = subscription expired (client should resubscribe)
		return new Response(null, { status: res.status, headers: CORS });
	},
};
