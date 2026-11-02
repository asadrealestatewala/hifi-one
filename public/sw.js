/* Hifi One service worker.
 *
 * Deliberately small. It only caches files that are the same for everybody and carry no data:
 *   - the fixed offline page, and the app icons
 *   - build assets under /_next/static/ (content-hashed, public JavaScript, CSS and fonts)
 * It NEVER stores pages, server actions, /api/*, /files/*, portal or signing links, or anything else that can hold
 * a person's data. Page loads always go to the network; when the network is down the visitor sees offline.html.
 * Bump VERSION to drop old caches.
 */
const VERSION = "v1";
const STATIC_CACHE = `hifi-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png", "/logo.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("hifi-") && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // server actions and form posts go straight through
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations: network only, offline page as the fallback. Never cache the HTML (it holds private data).
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())));
    return;
  }

  // Public, content-hashed build assets: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Fixed icons: cache first. Everything else (API, files, data, RSC payloads) is not touched.
  if (url.pathname.startsWith("/icons/") || url.pathname === "/logo.png") {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
