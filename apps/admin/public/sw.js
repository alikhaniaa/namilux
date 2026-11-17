const BUILD = new URL(self.location.href).searchParams.get("b") || "dev";
const STATIC_CACHE = `nla-static-${BUILD}`;
const SHELL_CACHE = `nla-shell-${BUILD}`;
const OWN = [STATIC_CACHE, SHELL_CACHE];
const OFFLINE_URL = "/offline";

function storable(res) {
  if (!res || res.status !== 200 || res.type === "opaque") return false;
  if (res.headers.has("set-cookie")) return false;
  const cc = (res.headers.get("cache-control") || "").toLowerCase();
  return !cc.includes("no-store") && !cc.includes("private");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("nla-") && !OWN.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (storable(res)) await cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.startsWith("/api/")) return;
  if (path.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()));
  }
});
