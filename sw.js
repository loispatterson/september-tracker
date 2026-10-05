/* The service worker. Push and notification clicks only.

   NO fetch HANDLER, DELIBERATELY, AND NEVER.

   The app already detects new deployments by comparing board.build on every
   poll and reloading when it changes. A caching service worker would fight
   that: it would serve the old index.html from cache, the new build id would
   never arrive, and the reload would bring back the same stale page. The
   symptom is a phone stuck on a week-old version that cannot be cleared by
   refreshing, and the cause is invisible from the outside. Several hours were
   nearly spent on exactly this.

   So this file exists for one reason — iOS and Android will not deliver a push
   message to a page, only to a worker — and does nothing else. Offline support
   is not a goal: the board is a live shared thing and a cached copy of
   yesterday would be worse than an error.

   It is also deliberately tiny and stable. A service worker updates on its own
   schedule, so a bug in here can outlive the deploy that fixed it. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  /* Anything could be in here, including nothing: some push services send an
     empty message to keep the subscription warm, and a worker that throws on
     one of those gets its subscription dropped. */
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const title = data.title || "Cairn";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/movember/icon-192.png",
    badge: data.badge || "/icons/movember/icon-192.png",
    /* A tag means a second notification replaces the first rather than
       stacking. Nobody wants three of these on a lock screen. */
    tag: data.tag || "cairn",
    renotify: false,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  /* Focus the app if it is already open rather than opening a second copy.
     Someone who taps a notification while the board is in another tab should
     land on that tab, not a duplicate. */
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if ("focus" in client) {
        try { await client.navigate(url); } catch { /* cross-origin, ignore */ }
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
