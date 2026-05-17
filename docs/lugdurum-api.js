(() => {
  "use strict";

  /*
    Lugdurum API V5
    - Connexion Apps Script / Google Sheets.
    - File d’attente locale pour les écritures hors réseau.
    - Rejeu automatique au retour réseau, au focus de la page, et au chargement.
    - Les lectures GET restent directes vers Sheets.
    - Les écritures POST peuvent être mises en attente si Apps Script est inaccessible.
  */

  const API_URL =
    "https://script.google.com/macros/s/AKfycbzPnUPJsS-cdZk15j8J1cp_jSeE4yv0ki-I9mKt6sO9iPTsAsLMyeY7EBt_Uv954NXd/exec";

  const STORAGE_KEYS = {
    pendingWrites: "lugdurum_pending_writes",
    lastSyncState: "lugdurum_last_sync_state"
  };

  let isFlushing = false;
  let flushTimer = null;

  const nowIso = () => new Date().toISOString();

  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
  };

  const buildQueueId = () => {
    const random =
      window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : Math.random().toString(36).slice(2, 10).toUpperCase();

    return `Q_${Date.now()}_${random}`;
  };

  const isOnline = () => navigator.onLine !== false;

  const getPendingWrites = () => {
    const writes = readJson(STORAGE_KEYS.pendingWrites, []);
    return Array.isArray(writes) ? writes : [];
  };

  const setPendingWrites = (writes) => {
    writeJson(STORAGE_KEYS.pendingWrites, writes);
    writeSyncState({
      pending_count: writes.length
    });
  };

  const getPendingWritesCount = () => getPendingWrites().length;

  const writeSyncState = (patch = {}) => {
    const previous = readJson(STORAGE_KEYS.lastSyncState, {});

    const next = {
      ...previous,
      pending_count: getPendingWrites().length,
      online: isOnline(),
      is_flushing: isFlushing,
      updated_at: nowIso(),
      ...patch
    };

    writeJson(STORAGE_KEYS.lastSyncState, next);

    window.dispatchEvent(
      new CustomEvent("lugdurum:sync-status", {
        detail: next
      })
    );

    return next;
  };

  const getSyncState = () =>
    readJson(STORAGE_KEYS.lastSyncState, {
      pending_count: getPendingWritesCount(),
      online: isOnline(),
      is_flushing: isFlushing,
      updated_at: ""
    });

  const enqueueWrite = (action, payload = {}, reason = "") => {
    const writes = getPendingWrites();

    const item = {
      id: buildQueueId(),
      action,
      payload,
      created_at: nowIso(),
      updated_at: nowIso(),
      retry_count: 0,
      last_error: reason || ""
    };

    writes.push(item);
    setPendingWrites(writes);

    writeSyncState({
      status: "queued",
      last_message: `Écriture mise en attente : ${action}`,
      last_error: reason || "",
      last_queued_action: action
    });

    return {
      queued: true,
      queue_id: item.id,
      action,
      pending_count: writes.length,
      message: "Écriture conservée localement, à synchroniser."
    };
  };

  const removePendingWrite = (queueId) => {
    const writes = getPendingWrites().filter((item) => item.id !== queueId);
    setPendingWrites(writes);
  };

  const updatePendingWriteError = (queueId, error) => {
    const writes = getPendingWrites().map((item) => {
      if (item.id !== queueId) return item;

      return {
        ...item,
        retry_count: Number(item.retry_count || 0) + 1,
        updated_at: nowIso(),
        last_error: error?.message || String(error || "Erreur inconnue")
      };
    });

    setPendingWrites(writes);
  };

  const clearPendingWrites = () => {
    setPendingWrites([]);

    writeSyncState({
      status: "cleared",
      last_message: "File d’attente vidée.",
      last_error: ""
    });

    return {
      ok: true,
      pending_count: 0
    };
  };

  const makeQueueableError = (message) => {
    const error = new Error(message);
    error.queueable = true;
    return error;
  };

  const normaliseResponse = (result, action) => {
    if (!result || typeof result !== "object") {
      throw new Error(`Réponse API invalide sur ${action}`);
    }

    if (!result.ok) {
      const error = new Error(result.error || `Erreur API sur ${action}`);
      error.queueable = false;
      throw error;
    }

    return Object.prototype.hasOwnProperty.call(result, "data")
      ? result.data
      : result;
  };

  const rawPost = async (action, payload = {}) => {
    if (!API_URL) {
      throw new Error("API_URL manquante dans lugdurum-api.js");
    }

    let response;

    try {
      response = await fetch(API_URL, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
          action,
          ...payload
        })
      });
    } catch (error) {
      throw makeQueueableError(
        `Impossible de joindre Apps Script : ${error.message}`
      );
    }

    if (!response.ok) {
      throw makeQueueableError(`Erreur API HTTP ${response.status}`);
    }

    let result;

    try {
      result = await response.json();
    } catch (error) {
      throw makeQueueableError(
        `Réponse JSON illisible depuis Apps Script : ${error.message}`
      );
    }

    return normaliseResponse(result, action);
  };

  const flushPendingWrites = async () => {
    if (isFlushing) {
      return {
        ok: true,
        already_flushing: true,
        pending_count: getPendingWritesCount()
      };
    }

    if (!isOnline()) {
      writeSyncState({
        status: "offline",
        last_message: "Synchronisation impossible : hors ligne."
      });

      return {
        ok: false,
        offline: true,
        pending_count: getPendingWritesCount()
      };
    }

    const initialWrites = getPendingWrites();

    if (initialWrites.length === 0) {
      writeSyncState({
        status: "idle",
        last_message: "Aucune écriture en attente.",
        last_error: ""
      });

      return {
        ok: true,
        synced_count: 0,
        failed_count: 0,
        pending_count: 0
      };
    }

    isFlushing = true;

    writeSyncState({
      status: "syncing",
      last_message: `Synchronisation de ${initialWrites.length} écriture(s)...`,
      last_error: ""
    });

    let syncedCount = 0;
    let failedCount = 0;

    try {
      for (const queuedItem of initialWrites) {
        const stillPending = getPendingWrites().some(
          (item) => item.id === queuedItem.id
        );

        if (!stillPending) continue;

        try {
          await rawPost(queuedItem.action, queuedItem.payload);

          removePendingWrite(queuedItem.id);
          syncedCount += 1;

          writeSyncState({
            status: "syncing",
            last_message: `Synchronisé : ${queuedItem.action}`,
            last_synced_action: queuedItem.action,
            last_error: ""
          });
        } catch (error) {
          failedCount += 1;
          updatePendingWriteError(queuedItem.id, error);

          writeSyncState({
            status: "error",
            last_message: `Synchronisation bloquée sur : ${queuedItem.action}`,
            last_error: error.message,
            last_failed_action: queuedItem.action
          });

          break;
        }
      }

      const pendingCount = getPendingWritesCount();

      writeSyncState({
        status: pendingCount === 0 ? "synced" : "partial",
        last_message:
          pendingCount === 0
            ? "Toutes les écritures ont été synchronisées."
            : `${pendingCount} écriture(s) encore en attente.`,
        synced_count: syncedCount,
        failed_count: failedCount,
        pending_count: pendingCount
      });

      return {
        ok: pendingCount === 0,
        synced_count: syncedCount,
        failed_count: failedCount,
        pending_count: pendingCount
      };
    } finally {
      isFlushing = false;

      writeSyncState({
        is_flushing: false,
        pending_count: getPendingWritesCount()
      });
    }
  };

  const scheduleFlush = (delay = 350) => {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
    }

    flushTimer = window.setTimeout(() => {
      flushTimer = null;

      if (getPendingWritesCount() > 0 && isOnline()) {
        flushPendingWrites().catch((error) => {
          console.warn("Synchronisation Lugdurum impossible.", error);
        });
      }
    }, delay);
  };

  const requestGet = async (action) => {
    if (!API_URL) {
      throw new Error("API_URL manquante dans lugdurum-api.js");
    }

    if (getPendingWritesCount() > 0 && isOnline() && !isFlushing) {
      try {
        await flushPendingWrites();
      } catch (error) {
        console.warn("Lecture avant sync complète.", error);
      }
    }

    const url = new URL(API_URL);
    url.searchParams.set("action", action);

    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Erreur API ${response.status}`);
    }

    const result = await response.json();

    return normaliseResponse(result, action);
  };

  const requestPost = async (action, payload = {}, options = {}) => {
    const queueIfUnavailable = options.queueIfUnavailable === true;

    if (queueIfUnavailable && !isOnline()) {
      return enqueueWrite(action, payload, "Appareil hors ligne.");
    }

    try {
      const result = await rawPost(action, payload);

      if (getPendingWritesCount() > 0) {
        scheduleFlush();
      }

      return result;
    } catch (error) {
      if (queueIfUnavailable && error.queueable !== false) {
        return enqueueWrite(action, payload, error.message);
      }

      throw error;
    }
  };

  const requestQueuedPost = (action, payload = {}) =>
    requestPost(action, payload, {
      queueIfUnavailable: true
    });

  const saveInscriptionEvenement = (inscription) =>
    requestQueuedPost("upsertInscriptionEvenement", {
      inscription
    });

  const cancelInscriptionEvenement = (inscriptionId) =>
    requestQueuedPost("cancelInscriptionEvenement", {
      inscription_id: inscriptionId
    });

  const saveInscriptionEventBundle = ({ inscription, event, mission, journees }) =>
    requestQueuedPost("saveInscriptionEventBundle", {
      inscription,
      event,
      mission,
      journees
    });

  const saveMission = (mission) =>
    requestQueuedPost("upsertMission", {
      mission
    });

  const saveMissionStock = (mission) =>
    requestQueuedPost("upsertMissionStock", {
      mission
    });

  const saveMissionStockBundle = ({ mission, mission_stock, journees }) =>
    requestQueuedPost("saveMissionStockBundle", {
      mission,
      mission_stock,
      journees
    });

  const saveJournee = (journee) =>
    requestQueuedPost("upsertJournee", {
      journee
    });

  const saveTransaction = (transaction) =>
    requestQueuedPost("saveTransaction", {
      transaction
    });

  const saveFrais = (frais) =>
    requestQueuedPost("upsertFrais", {
      frais
    });

  const batchUpsert = (operations) =>
    requestQueuedPost("batchUpsert", {
      operations
    });

  window.LugdurumAPI = {
    ping() {
      return requestGet("ping");
    },

    postPing() {
      return requestPost("ping");
    },

    getSpreadsheetInfo() {
      return requestGet("getSpreadsheetInfo");
    },

    getCatalogue() {
      return requestGet("getCatalogue");
    },

    getOffresVente() {
      return requestGet("getOffresVente");
    },

    getInscriptionsEvenements() {
      return requestGet("getInscriptionsEvenements");
    },

    getInscriptions() {
      return requestGet("getInscriptionsEvenements");
    },

    saveInscriptionEvenement,

    cancelInscriptionEvenement,

    saveInscriptionEventBundle,

    getMissions() {
      return requestGet("getMissions");
    },

    saveMission,

    getMissionsStock() {
      return requestGet("getMissionsStock");
    },

    saveMissionStock,

    saveMissionStockBundle,

    getJournees() {
      return requestGet("getJournees");
    },

    getJourneesVente() {
      return requestGet("getJournees");
    },

    saveJournee,

    getTransactions() {
      return requestGet("getTransactions");
    },

    getVentesLignes() {
      return requestGet("getVentesLignes");
    },

    saveTransaction,

    getFrais() {
      return requestGet("getFrais");
    },

    saveFrais,

    batchUpsert,

    getPendingWrites,

    getPendingWritesCount,

    getSyncState,

    flushPendingWrites,

    clearPendingWrites,

    isOnline
  };

  window.addEventListener("online", () => {
    writeSyncState({
      status: "online",
      last_message: "Connexion retrouvée."
    });

    scheduleFlush(250);
  });

  window.addEventListener("offline", () => {
    writeSyncState({
      status: "offline",
      last_message: "Connexion perdue. Les prochaines écritures seront gardées localement."
    });
  });

  window.addEventListener("focus", () => {
    scheduleFlush(450);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleFlush(450);
    }
  });

  writeSyncState({
    status: getPendingWritesCount() > 0 ? "pending" : "idle",
    last_message:
      getPendingWritesCount() > 0
        ? `${getPendingWritesCount()} écriture(s) en attente.`
        : "Aucune écriture en attente."
  });

  scheduleFlush(900);
})();