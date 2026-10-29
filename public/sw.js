/* Service worker: lets the app open and a worker fill in the day's report with no network.
 *  - /_next/static, icons, manifest: cache-first (they never change for a given build hash)
 *  - page navigations: network-first (10 s, so a slow phone connection still gets the CURRENT screen), falling back to the last copy only when the network fails
 *  - GET /api reads: network-first, falling back to the last answer (stale but usable); a miss answers { error.code: "OFFLINE" }
 *  - writes are never touched here: the app's IndexedDB queue sends them later with idempotency keys
 * Private data never outlives the sign-in: the page tells us to wipe every cache on sign-out. */
// Bump this on a release that must reach everyone at once: every cache of an older version (old screens and old data) is deleted when the new worker starts.
const V = 'vss-v5';
const SHELL = V + '-shell';
const PAGES = V + '-pages';
const DATA = V + '-data';
const NO_CACHE_API = /^\/api\/(auth|export|files|jobs|admin|employees|users|stockitems|stockmovements|stockcounts)\b/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(V)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const cacheable = (res) => res && res.ok && !res.redirected && res.type !== 'opaqueredirect';

async function networkFirst(req, cacheName, ms) {
  const cache = await caches.open(cacheName);
  try {
    const res = await timeout(fetch(req), ms);
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    throw new Error('offline');
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith('/_next/static/') || /^\/(icon-|manifest)/.test(url.pathname)) {
    e.respondWith(caches.open(SHELL).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (NO_CACHE_API.test(url.pathname)) return;
    e.respondWith(networkFirst(req, DATA, 6000).catch(() => new Response(JSON.stringify({ error: { code: 'OFFLINE', message: 'You are offline' } }), { status: 503, headers: { 'Content-Type': 'application/json', 'x-offline': '1' } })));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, PAGES, 10000).catch(() => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="font-family:system-ui;padding:24px"><h2>You are offline</h2><p>Open this screen once with a connection and it will be available here next time. Entries you save are kept and sent when the network returns.</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
  }
});

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'clear') e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))));
  if (d.type === 'warm') {
    e.waitUntil((async () => {
      const cache = await caches.open(PAGES);
      for (const u of d.urls || []) {
        try { const r = await fetch(u, { credentials: 'same-origin' }); if (cacheable(r)) await cache.put(new Request(u), r); } catch { /* offline right now */ }
      }
    })());
  }
});
