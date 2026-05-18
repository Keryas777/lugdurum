(() => {
  "use strict";

  /*
    Lugdurum API V7
    - Connexion Apps Script / Google Sheets.
    - Lectures GET directes.
    - Écritures POST avec file d’attente offline.
    - Rejeu automatique au retour réseau, au focus, à la visibilité et au chargement.
    - Rejeu de la file d’attente par paquets via batchActions pour limiter les appels Apps Script.
    - Support mouvements_stock.
    - Support stock_preparations / stock_preparation_lignes pour compatibilité.
    - Support saveJourneeHistoriqueBundle pour écrire mission + mission_stock + journée + transactions/lignes + frais en un seul appel.
    - Support getCoreData pour charger plusieurs onglets en un seul GET.
  */

  const API_URL =
    "https://script.google.com/macros/s/AKfycbzPnUPJsS-cdZk15j8J1cp_jSeE4yv0ki-I9mKt6sO9iPTsAsLMyeY7EBt_Uv954NXd/exec";

  const STORAGE_KEYS = {
    pendingWrites: "lugdurum_pending_writes",
    lastSyncState: "lugdurum_last_sync_state"
  };

  const FLUSH_BATCH_SIZE = 20;

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

  const getPendingWritesCount = () => getPendingWrites().length;

  const writeSyncState = (patch = {}) => {
    const previous = readJson(STORAGE_KEYS.lastSyncState, {});

    const next = {
      ...previous,
      pending_count: getPendingWritesCount(),
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

  const setPendingWrites = (writes) => {
    writeJson(STORAGE_KEYS.pendingWrites, Array.isArray(writes) ? writes : []);

    writeSyncState({
      pending_count: Array.isArray(writes) ? writes.length : 0
    });
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
    setPendingWrites(getPendingWrites().filter((item) => item.id !== queueId));
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
      error.api_result = result;
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

    const initialCount = getPendingWritesCount();

    if (initialCount === 0) {
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
      last_message: `Synchronisation de ${initialCount} écriture(s)…`,
      last_error: ""
    });

    let syncedCount = 0;
    let failedCount = 0;

    try {
      while (getPendingWritesCount() > 0) {
        const currentWrites = getPendingWrites();
        const batch = currentWrites.slice(0, FLUSH_BATCH_SIZE);

        if (batch.length === 0) break;

        try {
          const batchPayload = {
            actions: batch.map((item) => ({
              queue_id: item.id,
              action: item.action,
              payload: item.payload
            }))
          };

          const batchResult = await rawPost("batchActions", batchPayload);
          const results = Array.isArray(batchResult?.results)
            ? batchResult.results
            : [];

          if (results.length === 0) {
            throw makeQueueableError("Réponse batchActions vide ou invalide.");
          }

          let mustStop = false;

          for (const queuedItem of batch) {
            const result =
              results.find((item) => item.queue_id === queuedItem.id) ||
              results.find((item) => item.action === queuedItem.action);

            if (!result) {
              failedCount += 1;
              updatePendingWriteError(
                queuedItem.id,
                new Error("Résultat absent dans la réponse batchActions.")
              );
              mustStop = true;
              break;
            }

            if (result.ok) {
              removePendingWrite(queuedItem.id);
              syncedCount += 1;

              writeSyncState({
                status: "syncing",
                last_message: `Synchronisé : ${queuedItem.action}`,
                last_synced_action: queuedItem.action,
                last_error: ""
              });
            } else {
              failedCount += 1;
              updatePendingWriteError(
                queuedItem.id,
                new Error(result.error || `Erreur API sur ${queuedItem.action}`)
              );

              writeSyncState({
                status: "error",
                last_message: `Synchronisation bloquée sur : ${queuedItem.action}`,
                last_error: result.error || "Erreur inconnue",
                last_failed_action: queuedItem.action
              });

              mustStop = true;
              break;
            }
          }

          if (mustStop) break;
        } catch (error) {
          const firstItem = batch[0];

          failedCount += 1;

          if (firstItem) {
            updatePendingWriteError(firstItem.id, error);

            writeSyncState({
              status: "error",
              last_message: `Synchronisation bloquée sur : ${firstItem.action}`,
              last_error: error.message,
              last_failed_action: firstItem.action
            });
          }

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

  const requestGet = async (action, params = {}) => {
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

    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;

      if (Array.isArray(value)) {
        url.searchParams.set(key, value.join(","));
      } else {
        url.searchParams.set(key, String(value));
      }
    });

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

  const saveMouvementStock = (mouvement) =>
    requestQueuedPost("upsertMouvementStock", {
      mouvement
    });

  const saveStockPreparation = (preparation) =>
    requestQueuedPost("upsertStockPreparation", {
      preparation
    });

  const saveStockPreparationLine = (line) =>
    requestQueuedPost("upsertStockPreparationLine", {
      line
    });

  const saveStockPreparationWithLines = (preparation) =>
    requestQueuedPost("saveStockPreparation", {
      preparation
    });

  const saveTransaction = (transaction) =>
    requestQueuedPost("saveTransaction", {
      transaction
    });

  const saveFrais = (frais) =>
    requestQueuedPost("upsertFrais", {
      frais
    });

  const saveJourneeHistoriqueBundle = ({ mission, mission_stock, journee, transactions, frais }) =>
    requestQueuedPost("saveJourneeHistoriqueBundle", {
      mission,
      mission_stock,
      journee,
      transactions,
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

    getCoreData(tables = []) {
      return requestGet("getCoreData", {
        tables
      });
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

    getMouvementsStock() {
      return requestGet("getMouvementsStock");
    },

    saveMouvementStock,

    getStockPreparations() {
      return requestGet("getStockPreparations");
    },

    getStockPreparationLines() {
      return requestGet("getStockPreparationLines");
    },

    getStockPreparationLignes() {
      return requestGet("getStockPreparationLines");
    },

    saveStockPreparation,
    saveStockPreparationLine,
    saveStockPreparationWithLines,

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

    saveJourneeHistoriqueBundle,

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