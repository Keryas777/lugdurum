(() => {
  "use strict";

  /*
    PWA Lugdurum V12_API_NETWORK_ONLY :
    - Force le navigateur à vérifier la nouvelle version du service worker.
    - Nettoie tous les anciens caches PWA Lugdurum.
    - Ne touche pas aux caches métier localStorage :
      home data, pending writes, transactions locales, etc.
    - Recharge une seule fois si un nouveau service worker prend le contrôle.
    - Expose window.LugdurumDataState pour piloter la barre :
      local / refreshing / online.
  */

  const PWA_VERSION = "v12-api-network-only";
  const SW_URL = `./sw.js?v=${encodeURIComponent(PWA_VERSION)}`;

  const VERSION_STORAGE_KEY = "lugdurum_pwa_version";
  const RELOAD_STORAGE_KEY = "lugdurum_pwa_reloaded_for_sw";

  const DATA_STATE_BADGE_ID = "lugdurumDataStateBadge";

  let currentDataState = {
    status: "local",
    message: ""
  };

  const safeLocalGet = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const safeLocalSet = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Non critique.
    }
  };

  const safeLocalRemove = (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Non critique.
    }
  };

  const isLugdurumCache = (cacheName) =>
    String(cacheName || "")
      .toLowerCase()
      .includes("lugdurum");

  const normalizeDataStateStatus = (status) => {
    if (status === "online") return "online";
    if (status === "refreshing") return "refreshing";
    return "local";
  };

  const getDataStateLabel = (status, message = "") => {
    const suffix = message ? ` · ${message}` : "";

    if (status === "online") {
      return `Données en ligne${suffix}`;
    }

    if (status === "refreshing") {
      return `Actualisation${suffix}`;
    }

    return `Données locales${suffix}`;
  };

  const applyDataStateToBadge = () => {
    const badge = document.getElementById(DATA_STATE_BADGE_ID);
    if (!badge) return;

    const status = normalizeDataStateStatus(currentDataState.status);
    const text = badge.querySelector(".lugdurumDataStateBadgeText");

    badge.classList.remove("isLocal", "isRefreshing", "isOnline");

    if (status === "online") {
      badge.classList.add("isOnline");
    } else if (status === "refreshing") {
      badge.classList.add("isRefreshing");
    } else {
      badge.classList.add("isLocal");
    }

    badge.dataset.state = status;

    if (text) {
      text.textContent = getDataStateLabel(status, currentDataState.message);
    }
  };

  const setDataState = (status, options = {}) => {
    currentDataState = {
      status: normalizeDataStateStatus(status),
      message: String(options.message || "").trim(),
      updated_at: new Date().toISOString()
    };

    applyDataStateToBadge();

    window.dispatchEvent(
      new CustomEvent("lugdurum:data-state", {
        detail: currentDataState
      })
    );

    return currentDataState;
  };

  window.LugdurumDataState = {
    set: setDataState,
    get() {
      return {
        ...currentDataState
      };
    }
  };

  const initDataStateBadge = () => {
    applyDataStateToBadge();
  };

  const clearOldCachesIfNeeded = async () => {
    if (!("caches" in window)) return;

    const previousVersion = safeLocalGet(VERSION_STORAGE_KEY);

    if (previousVersion === PWA_VERSION) return;

    try {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames
          .filter(isLugdurumCache)
          .map((cacheName) => caches.delete(cacheName))
      );

      safeLocalSet(VERSION_STORAGE_KEY, PWA_VERSION);
      safeLocalRemove(RELOAD_STORAGE_KEY);
    } catch (error) {
      console.warn("Nettoyage cache PWA impossible :", error);
    }
  };

  const askWaitingWorkerToActivate = (registration) => {
    if (!registration?.waiting) return;

    try {
      registration.waiting.postMessage({
        type: "SKIP_WAITING",
        version: PWA_VERSION
      });
    } catch {
      // Si sw.js ne gère pas encore ce message, ce n’est pas bloquant.
    }
  };

  const registerServiceWorker = async () => {
    if (!("serviceWorker" in navigator)) return;

    try {
      await clearOldCachesIfNeeded();

      const registration = await navigator.serviceWorker.register(SW_URL, {
        updateViaCache: "none"
      });

      await registration.update();

      askWaitingWorkerToActivate(registration);

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;

        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (
            newWorker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            askWaitingWorkerToActivate(registration);
          }
        });
      });

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (safeLocalGet(RELOAD_STORAGE_KEY) === PWA_VERSION) return;

        safeLocalSet(RELOAD_STORAGE_KEY, PWA_VERSION);
        window.location.reload();
      });
    } catch (error) {
      console.warn("Service worker non enregistré :", error);
    }
  };

  const initPwa = () => {
    initDataStateBadge();
    registerServiceWorker();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDataStateBadge);
  } else {
    initDataStateBadge();
  }

  window.addEventListener("load", initPwa);
})();