const BUILD = new URL(self.location.href).searchParams.get("b") || "dev";
const STATIC_CACHE = `nl-static-${BUILD}`;
const MEDIA_CACHE = `nl-media-${BUILD}`;
const DATA_CACHE = `nl-data-${BUILD}`;
const PAGES_CACHE = `nl-pages-${BUILD}`;
const OWN_CACHES = [STATIC_CACHE, MEDIA_CACHE, DATA_CACHE, PAGES_CACHE];

const OFFLINE_URL = "/offline/";
const MEDIA_LIMIT = 300;
const PAGES_LIMIT = 60;
const NAV_TIMEOUT_MS = 3500;

/** the spec - personal, transactional or gateway-bound: the SW must not even see these. */
const NEVER = [/^\/api\//, /^\/account(\/|$)/, /^\/billing(\/|$)/, /^\/cart(\/|$)/, /^\/compare(\/|$)/, /^\/track(\/|$)/, /^\/pay(\/|$)/, /^\/sw(-kill)?\.js$/];

const isNever = (p) => NEVER.some((re) => re.test(p));
const isStatic = (p) => p.startsWith("/_next/static/") || p.startsWith("/fonts/") || p.startsWith("/icons/") || p.startsWith("/splash/");

/**
 * The second guard of the spec: even on a cacheable path, a response that says it is personal is
 * never stored. Without this a shared device could serve one shopper's page to the next.
 */
function storable(res) {
  if (!res || res.status !== 200 || res.type === "opaque") return false;
  if (res.headers.has("set-cookie")) return false;
  const cc = (res.headers.get("cache-control") || "").toLowerCase();
  return !cc.includes("no-store") && !cc.includes("private");
}

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  // Oldest first: Cache Storage preserves insertion order, so the head is the least recently added.
  for (let i = 0; i < keys.length - limit; i += 1) await cache.delete(keys[i]);
}

self.addEventListener("install", (event) => {
  // Precache only the offline page. Nothing else is guessed: a wrong guess costs the first visit.
  // No skipWaiting here - the page decides when to take the update (the spec update flow).
  event.waitUntil(caches.open(PAGES_CACHE).then((c) => c.add(OFFLINE_URL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("nl-") && !OWN_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (storable(res)) await cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fetching = fetch(req)
    .then(async (res) => {
      if (storable(res)) {
        await cache.put(req, res.clone());
        if (limit) await trimCache(cacheName, limit);
      }
      return res;
    })
    .catch(() => hit);
  return hit || fetching;
}

async function networkFirstNavigation(req) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    // A slow network must not hold the shell hostage: past the timeout the cached copy wins.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);
    const res = await fetch(req, { signal: controller.signal });
    clearTimeout(timer);
    if (storable(res)) {
      await cache.put(req, res.clone());
      await trimCache(PAGES_CACHE, PAGES_LIMIT);
    }
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    const offline = await cache.match(OFFLINE_URL);
    return offline || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Cross-origin (the gateway, the trust seals) is never intercepted - the spec
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;
  if (isNever(path)) return;

  if (isStatic(path)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
  if (path.startsWith("/media/")) {
    event.respondWith(staleWhileRevalidate(req, MEDIA_CACHE, MEDIA_LIMIT));
    return;
  }
  if (path === "/search-index.json") {
    event.respondWith(staleWhileRevalidate(req, DATA_CACHE, 0));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(networkFirstNavigation(req));
  }
});
