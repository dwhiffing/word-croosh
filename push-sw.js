// Web Push handlers, merged into the generated service worker via
// vite.config.ts (workbox.importScripts). Pushes are payload-less — the
// arrival of one simply means "it's your turn".
self.addEventListener("push", (event) => {
	event.waitUntil(
		self.registration.showNotification("Word Croosh", {
			body: "It's your turn!",
			icon: "/word-croosh/pwa-192x192.png",
			badge: "/word-croosh/pwa-192x192.png",
			tag: "word-croosh-turn", // repeated pushes replace, not stack
		}),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	event.waitUntil(
		self.clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((wins) => {
				const win = wins.find((w) => w.url.includes("/word-croosh/"));
				return win ? win.focus() : self.clients.openWindow("/word-croosh/");
			}),
	);
});
