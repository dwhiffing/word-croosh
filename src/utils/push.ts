// Web Push client. Subscriptions are exchanged with the opponent over the
// data channel; when you make a move, YOU ask the relay (push-server/) to
// poke the opponent's device. The relay is stateless — it just signs and
// forwards — so there's no account or database anywhere.

// Public half of the VAPID keypair (private half is a secret on the relay).
const VAPID_PUBLIC_KEY =
	"BPZ_aq1kjkZwAwoawr3prwDupxjy9GPnD4cZBXQ2xKPssNNVHF6L-Y1YL-IBAHRZxMpII55i31OkJgiJqEoTUlg";

// Deployed relay URL — paste yours after `npx wrangler deploy` in
// push-server/ (e.g. "https://word-croosh-push.<subdomain>.workers.dev").
// Leave empty to disable the notifications feature entirely.
const PUSH_SERVER_URL = "https://word-croosh-push.danielwhiffing.workers.dev";

export const pushSupported = (): boolean =>
	"serviceWorker" in navigator &&
	"PushManager" in window &&
	"Notification" in window;

// Silently reuse an existing subscription (no permission prompt) — e.g.
// after a page reload when the user enabled notifications previously.
export async function initPush(): Promise<PushSubscriptionJSON | null> {
	if (!pushSupported() || Notification.permission !== "granted") return null;
	try {
		const reg = await navigator.serviceWorker.getRegistration();
		const sub = await reg?.pushManager.getSubscription();
		return sub?.toJSON() ?? null;
	} catch {
		return null;
	}
}

export type PushEnableResult =
	| { ok: true; sub: PushSubscriptionJSON }
	| { ok: false; reason: string };

// Ask for permission and subscribe. On failure the reason says which step
// broke (permission, missing service worker, or the subscribe call itself).
export async function enablePush(): Promise<PushEnableResult> {
	if (!pushSupported()) return { ok: false, reason: "unsupported" };
	try {
		const perm = await Notification.requestPermission();
		if (perm !== "granted") return { ok: false, reason: `permission ${perm}` };
		const reg = await navigator.serviceWorker.getRegistration();
		if (!reg) return { ok: false, reason: "no service worker registration" };
		const sub =
			(await reg.pushManager.getSubscription()) ??
			(await reg.pushManager.subscribe({
				userVisibleOnly: true,
				// the Push API accepts the base64url VAPID key as a string —
				// do NOT decode to bytes (and never stringify a Uint8Array!)
				applicationServerKey: VAPID_PUBLIC_KEY,
			}));
		return { ok: true, sub: sub.toJSON() };
	} catch (e) {
		const err = e as Error;
		return { ok: false, reason: `${err.name}: ${err.message}` };
	}
}

// Wake the opponent's device via the relay. Resolves to a short status
// string for the network debug panel.
export async function notifyPeer(
	subscription: PushSubscriptionJSON,
): Promise<string> {
	if (!PUSH_SERVER_URL) return "no relay URL";
	try {
		const res = await fetch(PUSH_SERVER_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(subscription),
		});
		// 201 = push service accepted; 404/410 = subscription expired
		return `relay ${res.status}`;
	} catch (e) {
		return `relay unreachable: ${(e as Error).message}`;
	}
}
