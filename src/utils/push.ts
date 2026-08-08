// Web Push client. The subscription is registered with the game server
// (see server/worker.js), which sends a payload-less "your turn" push after
// each accepted move.

// Public half of the VAPID keypair (private half is a secret on the server).
const VAPID_PUBLIC_KEY =
	"BPZ_aq1kjkZwAwoawr3prwDupxjy9GPnD4cZBXQ2xKPssNNVHF6L-Y1YL-IBAHRZxMpII55i31OkJgiJqEoTUlg";

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

// Close any "It's your turn!" notifications still sitting in the tray —
// once the app is open the user has seen the move, so they're stale.
export async function clearTurnNotifications(): Promise<void> {
	if (!("serviceWorker" in navigator)) return;
	try {
		const reg = await navigator.serviceWorker.getRegistration();
		const notes = await reg?.getNotifications({ tag: "word-croosh-turn" });
		notes?.forEach((n) => n.close());
	} catch {
		// best-effort; nothing to do if the SW isn't ready yet
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

