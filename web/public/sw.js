/*
 * Offline reading for the back office.
 *
 * The rule this follows is that it will show you stale figures, clearly
 * labelled, but it will never quietly accept a change it cannot save. Every
 * screen here is a live server render against the shop's database, so nothing
 * can be recomputed on the device; what can be done is to keep the last copy
 * of each page you visited and hand it back when the network is gone.
 *
 * Deliberately not built: queuing sales made offline. Replaying writes later
 * means guessing at prices that may have changed, invoice numbers that may
 * have been taken, and stock that may have moved — and a double-recorded sale
 * is worse than a sale you had to write on paper.
 */

const VERSION = "nts-v1";
const SHELL = `${VERSION}-shell`;   // JS, CSS, fonts, icons — safe to keep
const PAGES = `${VERSION}-pages`;   // rendered admin pages — the shop's data

const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll([OFFLINE_URL])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Signing out has to take the cached pages with it. They are the customer
// book, the takings and every invoice that was open on this device.
/*
 * The last navigation that had to come out of the cache.
 *
 * navigator.onLine is not enough on its own: it says whether the device has a
 * network, not whether the shop's server answered. A phone on cafe wifi that
 * cannot reach Vercel is "online" and would have shown hour-old takings as
 * though they were current, which is the one thing this must not do. Lost if
 * the worker is stopped, which is fine — by then the page has been open a while.
 */
let servedStale = null;

self.addEventListener("message", (event) => {
  if (event.data === "nts:forget") {
    event.waitUntil(caches.delete(PAGES));
    return;
  }
  if (event.data === "nts:stale?") {
    event.ports[0]?.postMessage(servedStale);
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never hold on to a document, a PDF or a receipt token beyond the moment.
  if (url.pathname.startsWith("/api/")) return;

  // Build output is content-hashed, so it can be served from cache forever.
  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(pageWithFallback(req));
  }
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
  return res;
}

/**
 * The network first, always — a figure that is merely slow to arrive is still
 * the true one, and money is not something to guess at from a cache. Only a
 * real failure falls back, and what comes back carries the time it was stored
 * so the page can say how old it is.
 */
async function pageWithFallback(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    // A redirect is the sign-in bounce; caching it would strand the app on a
    // login loop the next time it opened without a network.
    if (res.ok && res.type === "basic" && !res.redirected) {
      const copy = res.clone();
      const body = await copy.blob();
      const headers = new Headers(copy.headers);
      headers.set("x-nts-cached-at", new Date().toISOString());
      cache.put(req, new Response(body, { status: 200, headers }));
    }
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: false });
    if (hit) {
      servedStale = { url: req.url, at: hit.headers.get("x-nts-cached-at") };
      return hit;
    }
    const any = await cache.match(new URL("/admin", self.location.origin).toString());
    return (await caches.match(OFFLINE_URL)) ?? any ?? Response.error();
  }
}
