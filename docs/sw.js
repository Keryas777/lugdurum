/*
  Lugdurum Service Worker V15_STATIC_NETWORK_ONLY

  Objectif :
  - Ne plus mettre en cache les fichiers statiques HTML/CSS/JS.
  - Ne jamais intercepter les appels API Apps Script.
  - Supprimer les anciens caches PWA Lugdurum.
  - Garder le service worker actif pour prise de contrôle / mise à jour,
    mais sans fallback statique susceptible de servir un vieux fichier.
*/

const CACHE_PREFIX = "lugdurum-cache-";
const SW_VERSION = "v15-static-network-only";

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

self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(isLugdurumPwaCache)
          .map((key) => caches.delete(key))
      )
    )
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

  return;
});