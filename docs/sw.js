const CACHE_NAME = "lugdurum-cache-v11-home-data";
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
    href.includes("googleusercontent.com/macros/")
  );
};

const isCacheableStaticRequest = (request) => {
  if (!request || request.method !== "GET") return false;

  const url = new URL(request.url);

  if (isApiRequest(url)) return false;

  if (url.origin !== self.location.origin) return false;

  if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
    return false;
  }

  if (request.mode === "navigate") return true;

  return STATIC_EXTENSIONS.some((extension) =>
    url.pathname.toLowerCase().endsWith(extension)
  );
};

const fetchAndCache = async (request) => {
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

  event.waitUntil(
    caches.open(CACHE_NAME)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
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

  if (!isCacheableStaticRequest(request)) {
    return;
  }

  event.respondWith(
    fetchAndCache(request)
      .catch(async () => {
        const cached = await caches.match(request);

        if (cached) return cached;

        if (request.mode === "navigate") {
          const indexCached = await caches.match("./index.html");

          if (indexCached) return indexCached;
        }

        throw new Error(`Ressource indisponible hors ligne : ${request.url}`);
      })
  );
});