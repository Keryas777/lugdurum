/*
  Lugdurum Service Worker V15_STATIC_NETWORK_ONLY

  Objectif :
  - Ne pas mettre en cache les fichiers statiques HTML/CSS/JS.
  - Mettre en cache uniquement les portraits pour les profils hors ligne.
  - Ne jamais intercepter les appels API Apps Script.
  - Supprimer les anciens caches PWA Lugdurum.
  - Garder le service worker actif pour prise de contrôle / mise à jour,
    mais sans fallback statique susceptible de servir un vieux fichier.
*/

const CACHE_PREFIX = "lugdurum-cache-";
const AVATAR_CACHE_NAME = "lugdurum-avatars-v1";
const AVATAR_PATHS = [
  "assets/avatars/william.webp",
  "assets/avatars/anthony.webp",
  "assets/avatars/jerome.webp"
];
const SW_VERSION = "v16-avatar-offline";

const isLugdurumPwaCache = (cacheName) =>
  String(cacheName || "")
    .toLowerCase()
    .startsWith(CACHE_PREFIX);

const isApiRequest = (url) => {
  const href = String(url?.href || "");

  return (
    href.includes("script.google.com/macros/") ||
    href.includes("script.googleusercontent.com/macros/") ||
    href.includes("googleusercontent.com/macros/")
  );
};

const isAvatarRequest = (url) =>
  AVATAR_PATHS.some((path) => url.pathname.endsWith(`/${path}`));

const cacheAvatars = async () => {
  try {
    const cache = await caches.open(AVATAR_CACHE_NAME);
    await Promise.all(AVATAR_PATHS.map(async (path) => {
      const url = new URL(path, self.registration.scope);
      try {
        const response = await fetch(url.href, { cache: "reload" });
        if (response.ok) await cache.put(url.href, response);
      } catch {
        // Un cache déjà présent reste utilisable si une mise à jour est hors ligne.
      }
    }));
  } catch {
    // L’échec du cache d’images ne doit pas empêcher l’application de s’ouvrir.
  }
};

self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter(isLugdurumPwaCache)
            .map((key) => caches.delete(key))
        )
      ),
      cacheAvatars()
    ])
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(isLugdurumPwaCache)
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
    Important :
    - API Apps Script : non interceptée.
    - Fichiers statiques : non mis en cache.
    - Le navigateur fait son fetch normal.
  */
  if (isApiRequest(url)) {
    return;
  }

  if (request.method !== "GET" || url.origin !== self.location.origin || !isAvatarRequest(url)) {
    return;
  }

  event.respondWith(
    (async () => {
      let cache = null;
      try {
        cache = await caches.open(AVATAR_CACHE_NAME);
        const cached = await cache.match(url.href, { ignoreSearch: true });
        if (cached) return cached;
      } catch {
        // CacheStorage peut être refusé par certains réglages de navigation privée.
      }

      const response = await fetch(request);
      if (cache && response.ok) {
        try {
          await cache.put(url.href, response.clone());
        } catch {
          // Le réseau direct reste utilisable même si la mise en cache échoue.
        }
      }
      return response;
    })()
  );
});
