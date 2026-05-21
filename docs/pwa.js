(() => {
  "use strict";

  /*
    PWA Lugdurum V16_DATA_STATE_BRIDGE :
    - Nettoie uniquement les caches PWA CacheStorage Lugdurum.
    - Ne touche pas aux caches métier localStorage.
    - Force la mise à jour du service worker.
    - Corrige la pastille données :
      - ne force plus “Données locales” au chargement si un état API existe déjà.
      - persiste l’état dans lugdurum_data_state.
      - accepte les mises à jour externes via l’évènement lugdurum:data-state.
      - crée la pastille si elle n’existe pas encore.
    - Garde window.LugdurumDataState comme point d’entrée global.
  */

  const PWA_VERSION = "v16-data-state-bridge";
  const SW_URL = `./sw.js?v=${encodeURIComponent(PWA_VERSION)}`;

  const VERSION_STORAGE_KEY = "lugdurum_pwa_version";
  const RELOAD_STORAGE_KEY = "lugdurum_pwa_reloaded_for_sw";

  const DATA_STATE_STORAGE_KEY = "lugdurum_data_state";
  const DATA_STATE_BADGE_ID = "lugdurumDataStateBadge";
  const DATA_STATE_STYLE_ID = "lugdurumDataStateStyle";

  const DATA_STATE_LABELS = {
    local: "Données locales",
    refreshing: "Actualisation",
    online: "Données en ligne"
  };

  let currentDataState = {
    status: "local",
    label: DATA_STATE_LABELS.local,
    message: "",
    updated_at: ""
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
      // localStorage peut être indisponible en navigation privée.
    }
  };

  const safeLocalRemove = (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Non critique.
    }
  };

  const readJson = (key, fallback = null) => {
    try {
      const raw = safeLocalGet(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    safeLocalSet(key, JSON.stringify(value));
  };

  const normalizeDataStateStatus = (status) => {
    if (status === "online") return "online";
    if (status === "refreshing") return "refreshing";
    return "local";
  };

  const normalizeDataStateOptions = (options = {}) => {
    if (typeof options === "string") {
      return {
        label: options.trim(),
        message: ""
      };
    }

    if (!options || typeof options !== "object") {
      return {
        label: "",
        message: ""
      };
    }

    return {
      ...options,
      label: String(options.label || "").trim(),
      message: String(options.message || "").trim()
    };
  };

  const buildDataState = (status, options = {}) => {
    const safeStatus = normalizeDataStateStatus(status);
    const normalizedOptions = normalizeDataStateOptions(options);

    const label =
      normalizedOptions.label ||
      DATA_STATE_LABELS[safeStatus] ||
      DATA_STATE_LABELS.local;

    const message = normalizedOptions.message || "";

    return {
      ...normalizedOptions,
      status: safeStatus,
      label,
      message,
      updated_at: normalizedOptions.updated_at || new Date().toISOString()
    };
  };

  const getDataStateText = (state) => {
    const status = normalizeDataStateStatus(state?.status);
    const label = String(state?.label || DATA_STATE_LABELS[status]).trim();
    const message = String(state?.message || "").trim();

    if (!message) return label;

    if (label.includes(message)) {
      return label;
    }

    return `${label} · ${message}`;
  };

  const getDataStateTitle = (state) => {
    const status = normalizeDataStateStatus(state?.status);

    if (status === "online") {
      return "Source active : API en ligne";
    }

    if (status === "refreshing") {
      return "Actualisation en cours";
    }

    return "Source active : cache local";
  };

  const ensureDataStateStyle = () => {
    if (document.getElementById(DATA_STATE_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = DATA_STATE_STYLE_ID;
    style.textContent = `
      .lugdurumDataStateBadge {
        position: fixed;
        left: max(12px, env(safe-area-inset-left));
        bottom: max(12px, env(safe-area-inset-bottom));
        z-index: 9999;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        max-width: calc(100vw - 24px);
        padding: 7px 10px;
        border-radius: 999px;
        font: 700 11px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0.01em;
        color: #1f1b16;
        background: rgba(255, 250, 241, 0.92);
        border: 1px solid rgba(31, 27, 22, 0.12);
        box-shadow: 0 10px 30px rgba(31, 27, 22, 0.12);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        pointer-events: none;
      }

      .lugdurumDataStateBadgeDot {
        width: 8px;
        height: 8px;
        flex: 0 0 auto;
        border-radius: 50%;
        background: #b35c3a;
        box-shadow: 0 0 0 4px rgba(179, 92, 58, 0.12);
      }

      .lugdurumDataStateBadgeText {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .lugdurumDataStateBadge.isLocal .lugdurumDataStateBadgeDot {
        background: #b35c3a;
        box-shadow: 0 0 0 4px rgba(179, 92, 58, 0.13);
      }

      .lugdurumDataStateBadge.isRefreshing .lugdurumDataStateBadgeDot {
        background: #d8a04f;
        box-shadow: 0 0 0 4px rgba(216, 160, 79, 0.16);
      }

      .lugdurumDataStateBadge.isOnline .lugdurumDataStateBadgeDot {
        background: #3f6f4f;
        box-shadow: 0 0 0 4px rgba(63, 111, 79, 0.15);
      }
    `;

    document.head.appendChild(style);
  };

  const ensureDataStateBadge = () => {
    if (!document.body) return null;

    ensureDataStateStyle();

    let badge = document.getElementById(DATA_STATE_BADGE_ID);

    if (!badge) {
      badge = document.createElement("div");
      badge.id = DATA_STATE_BADGE_ID;
      badge.className = "lugdurumDataStateBadge isLocal";
      badge.dataset.state = "local";
      badge.setAttribute("aria-live", "polite");
      badge.setAttribute("role", "status");
      badge.innerHTML = `
        <span class="lugdurumDataStateBadgeDot" aria-hidden="true"></span>
        <span class="lugdurumDataStateBadgeText">Données locales</span>
      `;
      document.body.appendChild(badge);
    }

    return badge;
  };

  const getBadgeState = () => {
    const badge = document.getElementById(DATA_STATE_BADGE_ID);

    if (!badge) return null;

    const text = badge.querySelector(".lugdurumDataStateBadgeText");

    let status = normalizeDataStateStatus(badge.dataset.state || "");

    if (badge.classList.contains("isOnline")) {
      status = "online";
    } else if (badge.classList.contains("isRefreshing")) {
      status = "refreshing";
    } else if (badge.classList.contains("isLocal")) {
      status = "local";
    }

    return {
      status,
      label: text?.textContent?.trim() || DATA_STATE_LABELS[status],
      message: "",
      updated_at: new Date().toISOString()
    };
  };

  const applyDataStateToBadge = () => {
    const render = () => {
      const badge = ensureDataStateBadge();
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
      badge.title = getDataStateTitle(currentDataState);

      if (text) {
        text.textContent = getDataStateText(currentDataState);
      }
    };

    if (document.body) {
      render();
    } else {
      document.addEventListener("DOMContentLoaded", render, { once: true });
    }
  };

  const setDataState = (status, options = {}) => {
    currentDataState = buildDataState(status, options);

    writeJson(DATA_STATE_STORAGE_KEY, currentDataState);
    applyDataStateToBadge();

    window.dispatchEvent(
      new CustomEvent("lugdurum:data-state", {
        detail: {
          ...currentDataState,
          source: "pwa"
        }
      })
    );

    return {
      ...currentDataState
    };
  };

  const getDataState = () => ({
    ...currentDataState
  });

  const syncFromExternalDataState = (detail) => {
    if (!detail || typeof detail !== "object") return;
    if (detail.source === "pwa") return;

    currentDataState = buildDataState(detail.status, detail);

    writeJson(DATA_STATE_STORAGE_KEY, currentDataState);
    applyDataStateToBadge();
  };

  const initCurrentDataState = () => {
    const badgeState = getBadgeState();
    const storedState = readJson(DATA_STATE_STORAGE_KEY, null);

    if (
      badgeState &&
      (badgeState.status === "online" || badgeState.status === "refreshing")
    ) {
      currentDataState = buildDataState(badgeState.status, badgeState);
      return;
    }

    if (storedState && typeof storedState === "object") {
      currentDataState = buildDataState(storedState.status, storedState);
      return;
    }

    if (badgeState) {
      currentDataState = buildDataState(badgeState.status, badgeState);
      return;
    }

    currentDataState = buildDataState("local");
  };

  window.LugdurumDataState = {
    set: setDataState,
    get: getDataState
  };

  window.addEventListener("lugdurum:data-state", (event) => {
    syncFromExternalDataState(event.detail);
  });

  const isLugdurumPwaCache = (cacheName) =>
    String(cacheName || "")
      .toLowerCase()
      .startsWith("lugdurum-cache-");

  const clearOldPwaCaches = async () => {
    if (!("caches" in window)) return;

    try {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames
          .filter(isLugdurumPwaCache)
          .map((cacheName) => caches.delete(cacheName))
      );
    } catch (error) {
      console.warn("Nettoyage cache PWA impossible :", error);
    }
  };

  const clearOldCachesIfNeeded = async () => {
    const previousVersion = safeLocalGet(VERSION_STORAGE_KEY);

    if (previousVersion === PWA_VERSION) return;

    await clearOldPwaCaches();

    safeLocalSet(VERSION_STORAGE_KEY, PWA_VERSION);
    safeLocalRemove(RELOAD_STORAGE_KEY);
  };

  const askWaitingWorkerToActivate = (registration) => {
    if (!registration?.waiting) return;

    try {
      registration.waiting.postMessage({
        type: "SKIP_WAITING",
        version: PWA_VERSION
      });
    } catch {
      // Non critique.
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

  const initDataStateBadge = () => {
    initCurrentDataState();
    applyDataStateToBadge();
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