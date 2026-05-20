const CACHE_NAME = "lugdurum-cache-v13-ignore-api";
const STATIC_CACHE_PREFIX = "lugdurum-cache-";

const STATIC_EXTENSIONS = [
  ".html",
  ".css",
  ".js",
  ".json",
  ".webmanifest",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".webp",
  ".ico"
];

const isLugdurumCache = (cacheName) =>
  String(cacheName || "").startsWith(STATIC_CACHE_PREFIX);

const isApiRequest = (url) => {
  const href = String(url?.href || "");

  return (
    href.includes("script.google.com/macros/") ||
    href.includes("script.googleusercontent.com/macros/") ||
    href.includes("googleusercontent.com/macros/")
  );
};

const isSameOriginRequest = (url) => url.origin === self.location.origin;

const isCacheableStaticRequest = (request) => {
  if (!request || request.method !== "GET") return false;

  const url = new URL(request.url);

  if (isApiRequest(url)) return false;
  if (!isSameOriginRequest(url)) return false;

  if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
    return false;
  }

  if (request.mode === "navigate") return true;

  return STATIC_EXTENSIONS.some((extension) =>
    url.pathname.toLowerCase().endsWith(extension)
  );
};

const fetchAndCacheStatic = async (request) => {
  const response = await fetch(request);

  if (
    response &&
    response.ok &&
    response.status === 200 &&
    (response.type === "basic" || response.type === "default")
  ) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }

  return response;
};

self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(caches.open(CACHE_NAME));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => isLugdurumCache(key) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  /*
    Très important :
    Les appels Apps Script / Googleusercontent sont volontairement IGNORÉS
    par le service worker.

    On ne fait pas event.respondWith(fetch(request)).
    On ne fait pas de cache.
    On laisse le navigateur gérer l’appel réseau normalement.
  */
  if (isApiRequest(url)) {
    return;
  }

  if (!isCacheableStaticRequest(request)) {
    return;
  }

  event.respondWith(
    fetchAndCacheStatic(request).catch(async () => {
      const cached = await caches.match(request);

      if (cached) return cached;

      if (request.mode === "navigate") {
        const indexCached =
          (await caches.match("./index.html")) ||
          (await caches.match("/index.html")) ||
          (await caches.match(self.location.origin + "/index.html"));

        if (indexCached) return indexCached;
      }

      throw new Error(`Ressource indisponible hors ligne : ${request.url}`);
    })
  );
});