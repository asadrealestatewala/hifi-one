// Hifi One field-visits service worker. Its one job: let /field open when the phone has no signal, so a visit can still be saved on the phone
// (the queue itself lives in IndexedDB, see src/lib/field-queue.ts). It touches nothing else: every other request goes straight to the network.
//   - A navigation to /field: network first; the fresh page is kept; offline, the kept copy is served.
//   - Hashed build files under /_next/static/: cache first (their names change when their content does).
// Nothing with a session or business data is cached beyond the one page the agent opened, and that page shows only the agent's own data.
const VERSION = "field-v3";
const PAGE_CACHE = `${VERSION}-page`;
const ASSET_CACHE = `${VERSION}-assets`;

self.addEventListener("install", (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
    // The page that registered this worker was loaded before the worker existed, so keep a copy now rather than waiting for the next visit
    try { const r = await fetch(new Request("/field", { credentials: "same-origin", cache: "no-store" })); if (r.ok) await keepPage(r); } catch { /* offline already; the next online load keeps a copy */ }
  })());
});

// Keep the page and every build file it names (scripts, styles), so an offline open does not depend on the browser's own HTTP cache
async function keepPage(res) {
  const html = await res.clone().text();
  const page = await caches.open(PAGE_CACHE);
  await page.put("/field", res);
  const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)]+/g) || [])];
  const c = await caches.open(ASSET_CACHE);
  await Promise.all(assets.map(async (u) => { if (!(await c.match(u))) { try { const a = await fetch(u); if (a.ok) await c.put(u, a); } catch { /* skipped */ } } }));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" && url.pathname === "/field") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok && fresh.type === "basic") event.waitUntil(keepPage(fresh.clone()));
        return fresh;
      } catch {
        const kept = await caches.match("/field");
        return kept ?? new Response("<!doctype html><meta charset=utf-8><title>Offline</title><p style=\"font-family:system-ui;padding:2rem\">You are offline and this screen has not been opened on this phone before. Open it once with signal; after that it works offline.</p>", { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const c = await caches.open(ASSET_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    })());
  }
});
