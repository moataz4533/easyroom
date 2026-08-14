// Easyroom service worker.
//
// Caches the app itself so it opens with no connection. It deliberately
// does NOT cache API responses: stale booking data presented as current
// is worse than an honest "last updated at 14:02" label, which the app
// handles in its own cache layer.

const VERSION = "easyroom-v7-calendar";
const ROUTES = ["", "/calendar", "/new-booking", "/bookings", "/housekeeping", "/reports", "/settings", "/login"];
const SHELL = [
  ...["ar", "en"].flatMap((locale) => ROUTES.map((route) => `/${locale}${route}`)),
  "/manifest-ar.json", "/manifest-en.json", "/easyroom-logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // Individually, so one failed URL doesn't abort the whole install.
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never intercept Supabase: the app's own logic decides what to do
  // when those calls fail.
  if (url.origin !== self.location.origin) return;

  // Next.js dev assets keep stable URLs. Caching them on localhost serves
  // stale code after edits, so local development must always use the network.
  if (self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1") {
    event.respondWith(fetch(request));
    return;
  }

  // Pages: network first, cache as backup. Keeps the app fresh when
  // online and still openable when it isn't.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match("/ar"))
        )
    );
    return;
  }

  // Build assets are content-hashed, so cache first is safe and fast.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (res.ok && (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/easyroom-logo"))) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
        }
        return res;
      });
    })
  );
});
