(() => {
  "use strict";

  /*
    Lugdurum API V10 FRONT QUEUE
    - Connexion Apps Script / Google Sheets.
    - Lectures GET directes.
    - Écritures POST avec file d’attente offline officielle : lugdurum_pending_writes.
    - Rejeu automatique au retour réseau, au focus, à la visibilité et au chargement.
    - Rejeu par paquets via batchActions.
    - Nettoyage robuste de la file après succès batch.
    - Nettoyage des anciennes transactions locales legacy : lugdurum_pending_transactions.
    - Évènement global lugdurum:sync-status pour rafraîchir l’UI.
  */

  const API_URL =
    "https://script.google.com/macros/s/AKfycbzPnUPJsS-cdZk15j8J1cp_jSeE4yv0ki-I9mKt6sO9iPTsAsLMyeY7EBt_Uv954NXd/exec";

  const STORAGE_KEYS = {
    pendingWrites: "lugdurum_pending_writes",
    lastSyncState: "lugdurum_last_sync_state",
    legacyPendingTransactions: "lugdurum_pending_transactions"
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
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage peut être indisponible en navigation privée / contexte isolé.
    }
  };

  const toArray = (value) => (Array.isArray(value) ? value : []);

  const isOnline = () => navigator.onLine !== false;

  const buildQueueId = () => {
    const random =
      window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : Math.random().toString(36).slice(2, 10).toUpperCase();

    return `Q_${Date.now()}_${random}`;
  };

  const getPendingWrites = () => {
    const writes = readJson(STORAGE_KEYS.pendingWrites, []);
    return Array.isArray(writes) ? writes : [];
  };

  const getPendingWritesCount = () => getPendingWrites().length;

  const getLegacyPendingTransactions = () => {
    const transactions = readJson(STORAGE_KEYS.legacyPendingTransactions, []);
    return Array.isArray(transactions) ? transactions : [];
  };

  const getTransactionId = (transaction) =>
    String(transaction?.transaction_id || transaction?.id || "").trim();

  const getLegacyPendingTransactionsCount = () =>
    getLegacyPendingTransactions().length;

  const buildSyncState = (patch = {}) => {
    const previous = readJson(STORAGE_KEYS.lastSyncState, {});

    return {
      ...previous,
      pending_count: getPendingWritesCount(),
      legacy_pending_transactions_count: getLegacyPendingTransactionsCount(),
      online: isOnline(),
      is_flushing: isFlushing,
      updated_at: nowIso(),
      ...patch
    };
  };

  const writeSyncState = (patch = {}) => {
    const next = buildSyncState(patch);

    writeJson(STORAGE_KEYS.lastSyncState, next);

    window.dispatchEvent(
      new CustomEvent("lugdurum:sync-status", {
        detail: next
      })
    );

    return next;
  };

  const setPendingWrites = (writes, patch = {}) => {
    const safeWrites = Array.isArray(writes) ? writes : [];

    writeJson(STORAGE_KEYS.pendingWrites, safeWrites);

    writeSyncState({
      pending_count: safeWrites.length,
      ...patch
    });
  };

  const getSyncState = () =>
    readJson(STORAGE_KEYS.lastSyncState, {
      pending_count: getPendingWritesCount(),
      legacy_pending_transactions_count: getLegacyPendingTransactionsCount(),
      online: isOnline(),
      is_flushing: isFlushing,
      updated_at: ""
    });

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
      error.action = action;
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

    setPendingWrites(writes, {
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

  const removePendingWritesByIds = (queueIds = [], patch = {}) => {
    const ids = new Set(queueIds.filter(Boolean));

    if (ids.size === 0) return getPendingWrites();

    const remaining = getPendingWrites().filter((item) => !ids.has(item.id));

    setPendingWrites(remaining, patch);

    return remaining;
  };

  const updatePendingWritesErrors = (errorsById = {}, patch = {}) => {
    const writes = getPendingWrites().map((item) => {
      const message = errorsById[item.id];

      if (!message) return item;

      return {
        ...item,
        retry_count: Number(item.retry_count || 0) + 1,
        updated_at: nowIso(),
        last_error: message
      };
    });

    setPendingWrites(writes, patch);

    return writes;
  };

  const clearPendingWrites = () => {
    setPendingWrites([], {
      status: "cleared",
      last_message: "File d’attente vidée.",
      last_error: ""
    });

    return {
      ok: true,
      pending_count: 0
    };
  };

  const clearLegacyPendingTransactions = () => {
    writeJson(STORAGE_KEYS.legacyPendingTransactions, []);

    writeSyncState({
      legacy_pending_transactions_count: 0,
      legacy_pending_transactions_cleaned: true
    });

    return {
      ok: true,
      pending_count: 0
    };
  };

  const reconcileLegacyPendingTransactions = (remoteTransactions = []) => {
    const legacy = getLegacyPendingTransactions();

    if (legacy.length === 0) {
      writeSyncState({
        legacy_pending_transactions_count: 0
      });

      return {
        ok: true,
        cleaned_count: 0,
        pending_count: 0,
        remaining: []
      };
    }

    const remoteIds = new Set(
      toArray(remoteTransactions)
        .map(getTransactionId)
        .filter(Boolean)
    );

    if (remoteIds.size === 0) {
      writeSyncState({
        legacy_pending_transactions_count: legacy.length
      });

      return {
        ok: true,
        cleaned_count: 0,
        pending_count: legacy.length,
        remaining: legacy
      };
    }

    const remaining = legacy.filter((transaction) => {
      const id = getTransactionId(transaction);

      if (!id) return true;

      return !remoteIds.has(id);
    });

    const cleanedCount = legacy.length - remaining.length;

    if (cleanedCount > 0) {
      writeJson(STORAGE_KEYS.legacyPendingTransactions, remaining);
    }

    writeSyncState({
      legacy_pending_transactions_count: remaining.length,
      legacy_pending_transactions_cleaned_count: cleanedCount,
      last_message:
        remaining.length > 0
          ? `${remaining.length} ancienne transaction locale encore non retrouvée dans Sheets.`
          : cleanedCount > 0
            ? "Anciennes transactions locales déjà synchronisées nettoyées."
            : "Aucune ancienne transaction locale à nettoyer."
    });

    return {
      ok: true,
      cleaned_count: cleanedCount,
      pending_count: remaining.length,
      remaining
    };
  };

  const extractBatchResults = (batchResult) => {
    if (Array.isArray(batchResult)) return batchResult;

    if (Array.isArray(batchResult?.results)) return batchResult.results;

    if (Array.isArray(batchResult?.data?.results)) return batchResult.data.results;

    return [];
  };

  const findBatchResultForItem = (results, queuedItem, index) => {
    return (
      results.find((item) => item.queue_id === queuedItem.id) ||
      results[index] ||
      results.find((item) => item.action === queuedItem.action) ||
      null
    );
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
        last_error: "",
        pending_count: 0
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
      is_flushing: true,
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
          const results = extractBatchResults(batchResult);

          if (results.length === 0) {
            throw makeQueueableError("Réponse batchActions vide ou invalide.");
          }

          const okIds = [];
          const errorsById = {};
          let mustStop = false;

          batch.forEach((queuedItem, index) => {
            if (mustStop) return;

            const result = findBatchResultForItem(results, queuedItem, index);

            if (!result) {
              failedCount += 1;
              errorsById[queuedItem.id] =
                "Résultat absent dans la réponse batchActions.";
              mustStop = true;
              return;
            }

            if (result.ok) {
              okIds.push(queuedItem.id);
              syncedCount += 1;
              return;
            }

            failedCount += 1;
            errorsById[queuedItem.id] =
              result.error || `Erreur API sur ${queuedItem.action}`;
            mustStop = true;
          });

          if (okIds.length > 0) {
            removePendingWritesByIds(okIds, {
              status: "syncing",
              last_message: `${okIds.length} écriture(s) synchronisée(s).`,
              last_error: "",
              synced_count: syncedCount,
              failed_count: failedCount
            });
          }

          if (Object.keys(errorsById).length > 0) {
            const firstFailedId = Object.keys(errorsById)[0];
            const failedItem = batch.find((item) => item.id === firstFailedId);

            updatePendingWritesErrors(errorsById, {
              status: "error",
              last_message: failedItem
                ? `Synchronisation bloquée sur : ${failedItem.action}`
                : "Synchronisation bloquée.",
              last_error: errorsById[firstFailedId] || "Erreur inconnue",
              last_failed_action: failedItem?.action || "",
              synced_count: syncedCount,
              failed_count: failedCount
            });
          }

          if (mustStop) break;
        } catch (error) {
          const firstItem = batch[0];

          failedCount += 1;

          if (firstItem) {
            updatePendingWritesErrors(
              {
                [firstItem.id]: error.message || "Erreur inconnue"
              },
              {
                status: "error",
                last_message: `Synchronisation bloquée sur : ${firstItem.action}`,
                last_error: error.message,
                last_failed_action: firstItem.action,
                synced_count: syncedCount,
                failed_count: failedCount
              }
            );
          }

          break;
        }
      }

      const pendingCount = getPendingWritesCount();

      writeSyncState({
        status: pendingCount === 0 ? "synced" : "partial",
        is_flushing: true,
        last_message:
          pendingCount === 0
            ? "Toutes les écritures ont été synchronisées."
            : `${pendingCount} écriture(s) encore en attente.`,
        last_error: pendingCount === 0 ? "" : getSyncState().last_error || "",
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
      } else {
        writeSyncState({
          status: getPendingWritesCount() > 0 ? "pending" : "idle",
          last_message:
            getPendingWritesCount() > 0
              ? `${getPendingWritesCount()} écriture(s) en attente.`
              : "Aucune écriture en attente."
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
        console.warn("Lecture avant synchronisation complète.", error);
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

  const afterSuccessfulDirectWrite = (action) => {
    const pendingCount = getPendingWritesCount();

    writeSyncState({
      status: pendingCount > 0 ? "pending" : "synced",
      last_message:
        pendingCount > 0
          ? `${pendingCount} écriture(s) encore en attente.`
          : `Écriture synchronisée : ${action}`,
      last_synced_action: action,
      last_error: "",
      pending_count: pendingCount
    });

    if (pendingCount > 0) {
      scheduleFlush(250);
    }
  };

  const requestPost = async (action, payload = {}, options = {}) => {
    const queueIfUnavailable = options.queueIfUnavailable === true;

    if (queueIfUnavailable && !isOnline()) {
      return enqueueWrite(action, payload, "Appareil hors ligne.");
    }

    try {
      const result = await rawPost(action, payload);

      afterSuccessfulDirectWrite(action);

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

  const isUnknownPostActionError = (error, action) => {
    const message = String(error?.message || "");

    return (
      message.includes("Action POST inconnue") &&
      message.includes(action)
    );
  };

  const cloneWithoutKeys = (object, keys = []) => {
    const copy = {
      ...(object || {})
    };

    keys.forEach((key) => {
      delete copy[key];
    });

    return copy;
  };

  const getTransactionLines = (transaction) =>
    toArray(transaction?.lignes)
      .filter(Boolean)
      .filter((line) => typeof line === "object");

  const collectTransactionLines = (transactions = []) =>
    toArray(transactions)
      .flatMap(getTransactionLines)
      .filter((line) => String(line.ligne_id || "").trim());

  const buildVenteLigneOperations = (lines = []) =>
    toArray(lines)
      .filter((line) => String(line.ligne_id || "").trim())
      .map((line) => ({
        sheetKey: "ventesLignes",
        data: line
      }));

  const ensureVentesLignes = async (lines = []) => {
    const operations = buildVenteLigneOperations(lines);

    if (operations.length === 0) {
      return {
        ok: true,
        skipped: true,
        lignes_count: 0
      };
    }

    return requestQueuedPost("batchUpsert", {
      operations
    });
  };

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

  const saveStockPreparation = (preparation) => {
    const hasLines =
      Array.isArray(preparation?.lignes) && preparation.lignes.length > 0;

    if (hasLines) {
      return requestQueuedPost("saveStockPreparation", {
        preparation
      });
    }

    return requestQueuedPost("upsertStockPreparation", {
      preparation
    });
  };

  const saveStockPreparationLine = (line) =>
    requestQueuedPost("upsertStockPreparationLine", {
      line
    });

  const saveStockPreparationWithLines = (preparation) =>
    requestQueuedPost("saveStockPreparation", {
      preparation
    });

  const saveTransaction = async (transaction) => {
    const lines = getTransactionLines(transaction);

    const transactionPayload = cloneWithoutKeys(transaction, ["lignes"]);

    const result = await requestQueuedPost("saveTransaction", {
      transaction: {
        ...transactionPayload,
        lignes: lines
      }
    });

    if (lines.length > 0) {
      const linesResult = await ensureVentesLignes(lines);

      return {
        transaction: result,
        ventes_lignes: linesResult,
        lignes_count: lines.length
      };
    }

    return result;
  };

  const saveVenteLigne = (line) =>
    requestQueuedPost("batchUpsert", {
      operations: [
        {
          sheetKey: "ventesLignes",
          data: line
        }
      ]
    });

  const saveVentesLignes = (lines = []) =>
    ensureVentesLignes(lines);

  const saveFrais = (frais) =>
    requestQueuedPost("upsertFrais", {
      frais
    });

  const saveCloture = (cloture) =>
    requestQueuedPost("saveCloture", {
      cloture
    });

  const saveJourneeHistoriqueBundleFallback = async ({
    mission,
    mission_stock,
    missionStock,
    journee,
    transactions,
    frais
  }) => {
    const safeTransactions = toArray(transactions);
    const safeFrais = toArray(frais);
    const allLines = collectTransactionLines(safeTransactions);

    const results = {
      fallback: true,
      mission: null,
      mission_stock: null,
      journee: null,
      transactions: [],
      ventes_lignes: null,
      frais: []
    };

    if (mission) {
      results.mission = await saveMission(mission);
    }

    if (mission_stock || missionStock) {
      results.mission_stock = await saveMissionStock(mission_stock || missionStock);
    }

    if (journee) {
      results.journee = await saveJournee(journee);
    }

    for (const transaction of safeTransactions) {
      results.transactions.push(await saveTransaction(transaction));
    }

    if (allLines.length > 0) {
      results.ventes_lignes = await ensureVentesLignes(allLines);
    }

    for (const fraisRow of safeFrais) {
      results.frais.push(await saveFrais(fraisRow));
    }

    results.transactions_count = results.transactions.length;
    results.lignes_count = allLines.length;
    results.frais_count = results.frais.length;

    return results;
  };

  const saveJourneeHistoriqueBundle = async ({
    mission,
    mission_stock,
    missionStock,
    journee,
    transactions,
    frais
  }) => {
    const safeTransactions = toArray(transactions);
    const allLines = collectTransactionLines(safeTransactions);

    const payload = {
      mission,
      mission_stock: mission_stock || missionStock,
      journee,
      transactions: safeTransactions,
      frais: toArray(frais)
    };

    try {
      const result = await requestQueuedPost("saveJourneeHistoriqueBundle", payload);

      if (allLines.length > 0) {
        const linesResult = await ensureVentesLignes(allLines);

        return {
          ...(result && typeof result === "object" ? result : { result }),
          ventes_lignes_guarantee: linesResult,
          lignes_count: allLines.length
        };
      }

      return result;
    } catch (error) {
      if (isUnknownPostActionError(error, "saveJourneeHistoriqueBundle")) {
        console.warn(
          "saveJourneeHistoriqueBundle indisponible côté Apps Script, fallback détaillé utilisé.",
          error
        );

        return saveJourneeHistoriqueBundleFallback(payload);
      }

      throw error;
    }
  };

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
    saveVenteLigne,
    saveVentesLignes,

    getFrais() {
      return requestGet("getFrais");
    },

    saveFrais,

    getClotures() {
      return requestGet("getClotures");
    },

    getCloturesJournees() {
      return requestGet("getCloturesJournees");
    },

    saveCloture,

    saveJourneeHistoriqueBundle,

    batchUpsert,
    ensureVentesLignes,

    getPendingWrites,
    getPendingWritesCount,
    getSyncState,
    flushPendingWrites,
    clearPendingWrites,

    getLegacyPendingTransactions,
    getLegacyPendingTransactionsCount,
    reconcileLegacyPendingTransactions,
    clearLegacyPendingTransactions,

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
        : "Aucune écriture en attente.",
    last_error: getPendingWritesCount() > 0 ? getSyncState().last_error || "" : ""
  });

  scheduleFlush(900);
})();