(() => {
  "use strict";

  /*
    Lugdurum API V16 RECETTES DATA + PRO TABLES + FRONT QUEUE + HOME DATA + JSONP GET

    - Connexion Apps Script / Google Sheets.
    - Lectures GET via JSONP pour éviter les blocages fetch/CORS Apps Script côté PWA.
    - Ajout méthode rapide getHomeData() pour l’accueil.
    - Ajout méthode rapide getRecettesData(view) pour le module recettes :
      dashboard, historique, production, matieres.
    - getHomeData() ne bloque pas le rendu sur la synchronisation de la file.
    - Écritures POST avec file d’attente offline officielle : lugdurum_pending_writes.
    - Rejeu automatique au retour réseau, au focus, à la visibilité et au chargement.
    - Rejeu par paquets via batchActions.
    - Nettoyage robuste de la file après succès batch.
    - Nettoyage des anciennes transactions locales legacy : lugdurum_pending_transactions.
    - Évènement global lugdurum:sync-status pour rafraîchir l’UI.
    - État données permanent : local / actualisation / en ligne.
    - Corrige la pastille :
      après toute lecture JSONP réussie, l’état passe explicitement en ligne.
    - Compatible avec une pastille déjà présente dans le HTML ou créée dynamiquement.
    - Évite les doublons d’écriture ventes_lignes quand Apps Script sauvegarde déjà les lignes dans les bundles.
    - Helpers pro :
      clients, commandes_pro, commandes_lignes, documents, referentiels.
    - Helpers recettes :
      recettes, recettes_ingredients, ingredients, cuvees, cuvees_ingredients_reels,
      matieres_premieres, matieres_lots, cuvees_matieres_consommees, mouvements_matieres.
    - Ajoute alias compatibles :
      getCommandesLignes() + getCommandesProLignes()
      saveCommandeLigne() + saveCommandeProLigne()
      saveCommandeLignes() + saveCommandeProLignes()
      getReferentiels() + getReferentiel()
      list() + upsert() + post() + request() + call()
  */

  const API_URL =
    "https://script.google.com/macros/s/AKfycbzPnUPJsS-cdZk15j8J1cp_jSeE4yv0ki-I9mKt6sO9iPTsAsLMyeY7EBt_Uv954NXd/exec";

  const STORAGE_KEYS = {
    pendingWrites: "lugdurum_pending_writes",
    lastSyncState: "lugdurum_last_sync_state",
    legacyPendingTransactions: "lugdurum_pending_transactions",
    dataState: "lugdurum_data_state",

    activeMissionId: "lugdurum_active_mission_id",
    activeStockMissionId: "lugdurum_active_stock_mission_id",
    activeJourneeId: "lugdurum_active_journee_id",
    preparationContext: "lugdurum_preparation_context"
  };

  const SHEET_UPSERT_CONFIG = {
    ventesLignes: {
      sheetKey: "ventesLignes",
      sheetName: "ventes_lignes",
      keyField: "ligne_id"
    },

    clients: {
      sheetKey: "clients",
      sheetName: "clients",
      keyField: "client_id"
    },
    commandesPro: {
      sheetKey: "commandesPro",
      sheetName: "commandes_pro",
      keyField: "commande_id"
    },
    commandesLignes: {
      sheetKey: "commandesLignes",
      sheetName: "commandes_lignes",
      keyField: "commande_ligne_id"
    },
    documents: {
      sheetKey: "documents",
      sheetName: "documents",
      keyField: "document_id"
    },
    referentiels: {
      sheetKey: "",
      sheetName: "referentiel",
      keyField: "referentiel_id"
    },

    recettes: {
      sheetKey: "recettes",
      sheetName: "recettes",
      keyField: "recette_id"
    },
    recettesIngredients: {
      sheetKey: "recettesIngredients",
      sheetName: "recettes_ingredients",
      keyField: "recette_ingredient_id"
    },
    ingredients: {
      sheetKey: "ingredients",
      sheetName: "ingredients",
      keyField: "ingredient_id"
    },
    cuvees: {
      sheetKey: "cuvees",
      sheetName: "cuvees",
      keyField: "cuvee_id"
    },
    cuveesIngredientsReels: {
      sheetKey: "cuveesIngredientsReels",
      sheetName: "cuvees_ingredients_reels",
      keyField: "cuvee_ingredient_id"
    },
    matieresPremieres: {
      sheetKey: "matieresPremieres",
      sheetName: "matieres_premieres",
      keyField: "matiere_id"
    },
    matieresLots: {
      sheetKey: "matieresLots",
      sheetName: "matieres_lots",
      keyField: "lot_id"
    },
    cuveesMatieresConsommees: {
      sheetKey: "cuveesMatieresConsommees",
      sheetName: "cuvees_matieres_consommees",
      keyField: "conso_id"
    },
    mouvementsMatieres: {
      sheetKey: "mouvementsMatieres",
      sheetName: "mouvements_matieres",
      keyField: "mouvement_matiere_id"
    }
  };

  const CORE_TABLE_KEY_ALIASES = {
    clients: ["clients"],

    commandesPro: ["commandesPro", "commandes_pro"],
    commandesLignes: [
      "commandesLignes",
      "commandes_lignes",
      "commandesProLignes",
      "commandes_pro_lignes"
    ],

    documents: ["documents"],
    referentiels: ["referentiels", "referentiel"],

    transactions: ["transactions"],
    ventesLignes: ["ventesLignes", "ventes_lignes"],

    catalogue: ["catalogue"],
    offresVente: ["offresVente", "offres_vente"],

    inscriptions: ["inscriptions", "inscriptions_evenements"],
    missions: ["missions", "missions_vente"],
    missionsStock: ["missionsStock", "missions_stock"],
    journees: ["journees", "journees_vente"],
    mouvementsStock: ["mouvementsStock", "mouvements_stock"],
    frais: ["frais"],
    clotures: ["clotures", "clotures_journees"],

    recettes: ["recettes"],
    recettesIngredients: ["recettesIngredients", "recettes_ingredients"],
    ingredients: ["ingredients"],

    cuvees: ["cuvees"],
    cuveesIngredientsReels: [
      "cuveesIngredientsReels",
      "cuvees_ingredients_reels"
    ],

    matieresPremieres: ["matieresPremieres", "matieres_premieres"],
    matieresLots: ["matieresLots", "matieres_lots"],

    cuveesMatieresConsommees: [
      "cuveesMatieresConsommees",
      "cuvees_matieres_consommees"
    ],

    mouvementsMatieres: ["mouvementsMatieres", "mouvements_matieres"]
  };

  const RECETTES_VIEW_ALIASES = {
    dashboard: ["dashboard", "hub", "accueil"],
    historique: ["historique", "history", "recettes", "archives"],
    production: [
      "production",
      "nouvelle_cuvee",
      "nouvelle-cuvee",
      "cuvee",
      "cuvees",
      "atelier"
    ],
    matieres: [
      "matieres",
      "matières",
      "matieres_premieres",
      "matières_premières",
      "matiere",
      "matiere_premiere",
      "stocks_matieres"
    ]
  };

  const FLUSH_BATCH_SIZE = 20;

  const DATA_STATE_LABELS = {
    local: "Données locales",
    refreshing: "Actualisation",
    online: "Données en ligne"
  };

  let isFlushing = false;
  let flushTimer = null;

  const nowIso = () => new Date().toISOString();

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
      // localStorage peut être indisponible en navigation privée / contexte isolé.
    }
  };

  const readJson = (key, fallback) => {
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

  const toArray = (value) => (Array.isArray(value) ? value : []);

  const isOnline = () => navigator.onLine !== false;

  const getTodayIso = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  };

  const normalizeSimpleKey = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/-/g, "_")
      .replace(/\s+/g, "_");

  const resolveRecettesView = (view) => {
    const normalized = normalizeSimpleKey(view || "dashboard");

    for (const [canonical, aliases] of Object.entries(RECETTES_VIEW_ALIASES)) {
      if (
        canonical === normalized ||
        aliases.some((alias) => normalizeSimpleKey(alias) === normalized)
      ) {
        return canonical;
      }
    }

    return normalized || "dashboard";
  };

  const resolveCoreTableKey = (tableName) => {
    const key = String(tableName || "").trim();

    if (!key) return "";

    const normalized = key.toLowerCase();

    for (const [canonicalKey, aliases] of Object.entries(CORE_TABLE_KEY_ALIASES)) {
      if (
        canonicalKey.toLowerCase() === normalized ||
        aliases.some((alias) => String(alias).toLowerCase() === normalized)
      ) {
        return canonicalKey;
      }
    }

    return key;
  };

  const normalizeCoreTablesParam = (tables = []) => {
    const list = Array.isArray(tables)
      ? tables
      : String(tables || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

    return [...new Set(list.map(resolveCoreTableKey).filter(Boolean))];
  };

  const getCoreArrayFromResult = (result, tableName) => {
    const canonicalKey = resolveCoreTableKey(tableName);
    const aliases = CORE_TABLE_KEY_ALIASES[canonicalKey] || [canonicalKey];

    for (const key of [canonicalKey, ...aliases]) {
      const value = result?.[key];

      if (Array.isArray(value)) return value;

      if (value && typeof value === "object" && value.ok === false) {
        throw new Error(value.error || `Table getCoreData invalide : ${key}`);
      }
    }

    return [];
  };

  const buildSheetUpsertOperation = ({ sheetKey, sheetName, keyField, data }) => ({
    action: "upsert",
    type: "upsert",

    sheetKey,
    sheet_key: sheetKey,

    sheet: sheetName,
    sheetName,
    sheet_name: sheetName,

    key: keyField,
    keyField,
    key_field: keyField,

    data,
    row: data
  });

  const buildConfiguredUpsertOperation = (configKey, data) => {
    const resolvedKey = resolveCoreTableKey(configKey);
    const config = SHEET_UPSERT_CONFIG[resolvedKey] || SHEET_UPSERT_CONFIG[configKey];

    if (!config) {
      throw new Error(`Configuration batchUpsert inconnue : ${configKey}`);
    }

    return buildSheetUpsertOperation({
      sheetKey: config.sheetKey,
      sheetName: config.sheetName,
      keyField: config.keyField,
      data
    });
  };

  const buildGenericUpsertOperation = (tableName, data) => {
    const resolvedKey = resolveCoreTableKey(tableName);
    const config = SHEET_UPSERT_CONFIG[resolvedKey];

    if (config) {
      return buildConfiguredUpsertOperation(resolvedKey, data);
    }

    const keyField =
      Object.keys(data || {}).find((key) => key.endsWith("_id")) ||
      "id";

    return buildSheetUpsertOperation({
      sheetKey: "",
      sheetName: String(tableName || resolvedKey || "").trim(),
      keyField,
      data
    });
  };

  const ensureDataStateStyle = () => {
    if (!document.head) return;
    if (document.getElementById("lugdurumDataStateStyle")) return;

    const style = document.createElement("style");
    style.id = "lugdurumDataStateStyle";
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

      .lugdurumDataStateBadge.isLocal .lugdurumDataStateBadgeDot,
      .lugdurumDataStateBar.isLocal .lugdurumDataStateBadgeDot {
        background: #b35c3a;
        box-shadow: 0 0 0 4px rgba(179, 92, 58, 0.13);
      }

      .lugdurumDataStateBadge.isRefreshing .lugdurumDataStateBadgeDot,
      .lugdurumDataStateBar.isRefreshing .lugdurumDataStateBadgeDot {
        background: #d8a04f;
        box-shadow: 0 0 0 4px rgba(216, 160, 79, 0.16);
      }

      .lugdurumDataStateBadge.isOnline .lugdurumDataStateBadgeDot,
      .lugdurumDataStateBar.isOnline .lugdurumDataStateBadgeDot {
        background: #3f6f4f;
        box-shadow: 0 0 0 4px rgba(63, 111, 79, 0.15);
      }
    `;

    document.head.appendChild(style);
  };

  const ensureDataStateBadge = () => {
    if (!document.body) return null;

    ensureDataStateStyle();

    let badge = document.getElementById("lugdurumDataStateBadge");

    if (!badge) {
      badge = document.createElement("div");
      badge.id = "lugdurumDataStateBadge";
      badge.className = "lugdurumDataStateBadge isLocal";
      badge.innerHTML = `
        <span class="lugdurumDataStateBadgeDot" aria-hidden="true"></span>
        <span class="lugdurumDataStateBadgeText">Données locales</span>
      `;
      document.body.appendChild(badge);
    }

    if (!badge.querySelector(".lugdurumDataStateBadgeDot")) {
      const dot = document.createElement("span");
      dot.className = "lugdurumDataStateBadgeDot";
      dot.setAttribute("aria-hidden", "true");
      badge.prepend(dot);
    }

    if (!badge.querySelector(".lugdurumDataStateBadgeText")) {
      const text = document.createElement("span");
      text.className = "lugdurumDataStateBadgeText";
      text.textContent = "Données locales";
      badge.appendChild(text);
    }

    badge.setAttribute("aria-live", "polite");
    badge.setAttribute("role", "status");

    return badge;
  };

  const setDataState = (status, details = {}) => {
    const safeStatus = DATA_STATE_LABELS[status] ? status : "local";
    const label = details.label || DATA_STATE_LABELS[safeStatus];
    const message = String(details.message || "").trim();
    const text = message ? `${label} · ${message}` : label;

    const state = {
      ...details,
      status: safeStatus,
      label,
      message,
      updated_at: nowIso()
    };

    writeJson(STORAGE_KEYS.dataState, state);

    const render = () => {
      const badge = ensureDataStateBadge();

      if (!badge) return;

      badge.classList.remove("isLocal", "isRefreshing", "isOnline");

      if (safeStatus === "online") {
        badge.classList.add("isOnline");
      } else if (safeStatus === "refreshing") {
        badge.classList.add("isRefreshing");
      } else {
        badge.classList.add("isLocal");
      }

      badge.dataset.state = safeStatus;

      const textElement =
        badge.querySelector(".lugdurumDataStateBadgeText") ||
        badge.querySelector("[data-data-state-text]");

      if (textElement) {
        textElement.textContent = text;
      }
    };

    if (document.body) {
      render();
    } else {
      document.addEventListener("DOMContentLoaded", render, { once: true });
    }

    window.dispatchEvent(
      new CustomEvent("lugdurum:data-state", {
        detail: state
      })
    );

    return state;
  };

  const getDataState = () =>
    readJson(STORAGE_KEYS.dataState, {
      status: "local",
      label: DATA_STATE_LABELS.local,
      message: "",
      updated_at: ""
    });

  const initDataStateBadge = () => {
    const saved = getDataState();

    setDataState(saved.status || "local", {
      ...saved,
      message: saved.message || ""
    });
  };

  const markDataRefreshing = (action) => {
    if (!isOnline()) {
      setDataState("local", {
        message: "hors ligne",
        last_action: action || ""
      });
      return;
    }

    setDataState("refreshing", {
      message: action || "lecture API",
      last_action: action || ""
    });
  };

  const markDataOnline = (action, durationMs = 0) => {
    setDataState("online", {
      message: action ? `${action} · ${durationMs} ms API` : "API Sheets",
      last_action: action || "",
      duration_ms: durationMs,
      last_error: ""
    });
  };

  const markDataLocalAfterReadError = (action, error) => {
    const message = isOnline()
      ? `API indisponible (${action})`
      : "hors ligne";

    setDataState("local", {
      message,
      last_action: action || "",
      last_error: error?.message || "Lecture API impossible"
    });
  };

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

    setDataState("local", {
      message: `${writes.length} écriture(s) en attente`,
      last_action: action,
      last_error: reason || ""
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

      setDataState("local", {
        message: "hors ligne"
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

    setDataState("refreshing", {
      message: `sync ${initialCount} écriture(s)`
    });

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

      if (pendingCount === 0) {
        setDataState("online", {
          message: "sync OK"
        });
      } else {
        setDataState("local", {
          message: `${pendingCount} écriture(s) en attente`,
          last_error: getSyncState().last_error || ""
        });
      }

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

  const requestGetJsonp = (action, params = {}, timeoutMs = 15000) =>
    new Promise((resolve, reject) => {
      if (!API_URL) {
        reject(new Error("API_URL manquante dans lugdurum-api.js"));
        return;
      }

      const callbackName = `__lugdurum_jsonp_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`;

      const url = new URL(API_URL);
      url.searchParams.set("action", action);
      url.searchParams.set("callback", callbackName);
      url.searchParams.set("_", String(Date.now()));

      Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;

        if (Array.isArray(value)) {
          url.searchParams.set(key, value.join(","));
        } else {
          url.searchParams.set(key, String(value));
        }
      });

      let script = null;
      let timer = null;
      let settled = false;

      const cleanup = () => {
        if (timer) {
          window.clearTimeout(timer);
          timer = null;
        }

        try {
          delete window[callbackName];
        } catch {
          window[callbackName] = undefined;
        }

        if (script && script.parentNode) {
          script.parentNode.removeChild(script);
        }
      };

      const settleResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const settleReject = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      timer = window.setTimeout(() => {
        settleReject(new Error(`Timeout JSONP sur ${action}`));
      }, timeoutMs);

      window[callbackName] = (result) => {
        try {
          settleResolve(normaliseResponse(result, action));
        } catch (error) {
          settleReject(error);
        }
      };

      script = document.createElement("script");
      script.async = true;
      script.src = url.toString();

      script.onerror = () => {
        settleReject(new Error(`Lecture JSONP impossible sur ${action}`));
      };

      document.head.appendChild(script);
    });

  const requestGet = async (action, params = {}, options = {}) => {
    const startedAt = Date.now();
    const flushBeforeRead = options.flushBeforeRead !== false;

    markDataRefreshing(action);

    try {
      if (flushBeforeRead && getPendingWritesCount() > 0 && isOnline() && !isFlushing) {
        try {
          await flushPendingWrites();
        } catch (error) {
          console.warn("Lecture avant synchronisation complète.", error);
        }
      }

      if (!flushBeforeRead && getPendingWritesCount() > 0 && isOnline() && !isFlushing) {
        scheduleFlush(250);
      }

      const data = await requestGetJsonp(
        action,
        params,
        options.timeoutMs || 15000
      );

      markDataOnline(action, Date.now() - startedAt);

      return data;
    } catch (error) {
      markDataLocalAfterReadError(action, error);
      throw error;
    }
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

    setDataState("online", {
      message:
        pendingCount > 0
          ? `${pendingCount} écriture(s) en attente`
          : `écriture OK · ${action}`,
      last_action: action
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
      .map((line) => buildConfiguredUpsertOperation("ventesLignes", line));

  const getSavedLinesCount = (result) => {
    if (!result || typeof result !== "object") return 0;

    return Number(
      result.lignes_count ??
      result.lines_count ??
      result.ventes_lignes_count ??
      (
        Array.isArray(result.lignes)
          ? result.lignes.length
          : 0
      )
    ) || 0;
  };

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

  const buildHomeDataParams = (params = {}) => {
    const context = readJson(STORAGE_KEYS.preparationContext, {});

    const activeStockMissionId =
      params.activeStockMissionId ||
      params.stockMissionId ||
      params.stock_mission_id ||
      safeLocalGet(STORAGE_KEYS.activeStockMissionId) ||
      context.stock_mission_id ||
      context.mission_stock_id ||
      context.mission_id ||
      safeLocalGet(STORAGE_KEYS.activeMissionId) ||
      "";

    const activeJourneeId =
      params.activeJourneeId ||
      params.journeeId ||
      params.journee_id ||
      safeLocalGet(STORAGE_KEYS.activeJourneeId) ||
      context.journee_id ||
      "";

    return {
      today: params.today || getTodayIso(),
      activeStockMissionId,
      activeJourneeId
    };
  };

  const getHomeData = (params = {}) =>
    requestGet("getHomeData", buildHomeDataParams(params), {
      flushBeforeRead: false
    });

  const getRecettesData = (view = "dashboard", params = {}) => {
    const safeView =
      typeof view === "object"
        ? resolveRecettesView(view.view || view.mode || "dashboard")
        : resolveRecettesView(view);

    const extraParams =
      typeof view === "object"
        ? {
            ...view,
            ...params
          }
        : {
            ...params
          };

    return requestGet(
      "getRecettesData",
      {
        ...extraParams,
        view: safeView
      },
      {
        flushBeforeRead: extraParams.flushBeforeRead !== false,
        timeoutMs: extraParams.timeoutMs || 15000
      }
    );
  };

  const getRecettesDashboardData = (params = {}) =>
    getRecettesData("dashboard", params);

  const getRecettesHistoriqueData = (params = {}) =>
    getRecettesData("historique", params);

  const getRecettesProductionData = (params = {}) =>
    getRecettesData("production", params);

  const getRecettesMatieresData = (params = {}) =>
    getRecettesData("matieres", params);

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

    if (lines.length === 0) {
      return result;
    }

    if (result?.queued) {
      return {
        transaction: result,
        queued: true,
        lignes_count: lines.length
      };
    }

    const savedLinesCount = getSavedLinesCount(result);

    if (savedLinesCount > 0) {
      return {
        ...(result && typeof result === "object" ? result : { result }),
        lignes_count: savedLinesCount
      };
    }

    const linesResult = await ensureVentesLignes(lines);

    return {
      transaction: result,
      ventes_lignes_guarantee: linesResult,
      lignes_count: lines.length
    };
  };

  const saveVenteLigne = (line) =>
    requestQueuedPost("batchUpsert", {
      operations: [
        buildConfiguredUpsertOperation("ventesLignes", line)
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

      if (result?.queued) {
        return {
          ...(result && typeof result === "object" ? result : { result }),
          lignes_count: allLines.length
        };
      }

      const savedLinesCount = getSavedLinesCount(result);

      if (allLines.length > 0 && savedLinesCount <= 0) {
        const linesResult = await ensureVentesLignes(allLines);

        return {
          ...(result && typeof result === "object" ? result : { result }),
          ventes_lignes_guarantee: linesResult,
          lignes_count: allLines.length
        };
      }

      return {
        ...(result && typeof result === "object" ? result : { result }),
        lignes_count: savedLinesCount || allLines.length
      };
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

  const getCoreTable = async (tableName) => {
    const key = resolveCoreTableKey(tableName);

    if (!key) return [];

    const result = await requestGet("getCoreData", {
      tables: [key]
    });

    return getCoreArrayFromResult(result, key);
  };

  const list = (tableName) =>
    getCoreTable(tableName);

  const upsert = (tableName, row) =>
    requestQueuedPost("batchUpsert", {
      operations: [
        buildGenericUpsertOperation(tableName, row)
      ]
    });

  const getClients = () =>
    getCoreTable("clients");

  const getCommandesPro = () =>
    getCoreTable("commandesPro");

  const getCommandesLignes = () =>
    getCoreTable("commandesLignes");

  const getCommandesProLignes = () =>
    getCommandesLignes();

  const getDocuments = () =>
    getCoreTable("documents");

  const getReferentiels = () =>
    getCoreTable("referentiels");

  const getReferentiel = () =>
    getReferentiels();

  const saveClient = (client) =>
    requestQueuedPost("batchUpsert", {
      operations: [
        buildConfiguredUpsertOperation("clients", client)
      ]
    });

  const saveCommandePro = (commande) =>
    requestQueuedPost("batchUpsert", {
      operations: [
        buildConfiguredUpsertOperation("commandesPro", commande)
      ]
    });

  const saveCommandeLigne = (ligne) =>
    requestQueuedPost("batchUpsert", {
      operations: [
        buildConfiguredUpsertOperation("commandesLignes", ligne)
      ]
    });

  const saveCommandeProLigne = (ligne) =>
    saveCommandeLigne(ligne);

  const saveCommandeLignes = (lignes = []) =>
    requestQueuedPost("batchUpsert", {
      operations: toArray(lignes).map((ligne) =>
        buildConfiguredUpsertOperation("commandesLignes", ligne)
      )
    });

  const saveCommandeProLignes = (lignes = []) =>
    saveCommandeLignes(lignes);

  const saveDocument = (documentRow) =>
    requestQueuedPost("batchUpsert", {
      operations: [
        buildConfiguredUpsertOperation("documents", documentRow)
      ]
    });

  const saveReferentiel = (referentiel) =>
    requestQueuedPost("batchUpsert", {
      operations: [
        buildConfiguredUpsertOperation("referentiels", referentiel)
      ]
    });

  const getRecettes = () =>
    getCoreTable("recettes");

  const getRecettesIngredients = () =>
    getCoreTable("recettesIngredients");

  const getIngredients = () =>
    getCoreTable("ingredients");

  const getCuvees = () =>
    getCoreTable("cuvees");

  const getCuveesIngredientsReels = () =>
    getCoreTable("cuveesIngredientsReels");

  const getMatieresPremieres = () =>
    getCoreTable("matieresPremieres");

  const getMatieresLots = () =>
    getCoreTable("matieresLots");

  const getCuveesMatieresConsommees = () =>
    getCoreTable("cuveesMatieresConsommees");

  const getMouvementsMatieres = () =>
    getCoreTable("mouvementsMatieres");

  const saveRecette = (recette) =>
    requestQueuedPost("upsertRecette", {
      recette
    });

  const saveRecetteIngredient = (recetteIngredient) =>
    requestQueuedPost("upsertRecetteIngredient", {
      recette_ingredient: recetteIngredient
    });

  const saveRecetteIngredients = (rows = []) =>
    requestQueuedPost("batchUpsert", {
      operations: toArray(rows).map((row) =>
        buildConfiguredUpsertOperation("recettesIngredients", row)
      )
    });

  const saveIngredient = (ingredient) =>
    requestQueuedPost("upsertIngredient", {
      ingredient
    });

  const saveCuvee = (cuvee) =>
    requestQueuedPost("upsertCuvee", {
      cuvee
    });

  const saveCuveeIngredientReel = (cuveeIngredientReel) =>
    requestQueuedPost("upsertCuveeIngredientReel", {
      cuvee_ingredient_reel: cuveeIngredientReel
    });

  const saveCuveeIngredientsReels = (rows = []) =>
    requestQueuedPost("batchUpsert", {
      operations: toArray(rows).map((row) =>
        buildConfiguredUpsertOperation("cuveesIngredientsReels", row)
      )
    });

  const saveMatierePremiere = (matiere) =>
    requestQueuedPost("upsertMatierePremiere", {
      matiere
    });

  const saveMatiereLot = (lot) =>
    requestQueuedPost("upsertMatiereLot", {
      lot
    });

  const saveCuveeMatiereConsommee = (conso) =>
    requestQueuedPost("upsertCuveeMatiereConsommee", {
      conso
    });

  const saveCuveesMatieresConsommees = (rows = []) =>
    requestQueuedPost("batchUpsert", {
      operations: toArray(rows).map((row) =>
        buildConfiguredUpsertOperation("cuveesMatieresConsommees", row)
      )
    });

  const saveMouvementMatiere = (mouvement) =>
    requestQueuedPost("upsertMouvementMatiere", {
      mouvement
    });

  const saveMouvementsMatieres = (rows = []) =>
    requestQueuedPost("batchUpsert", {
      operations: toArray(rows).map((row) =>
        buildConfiguredUpsertOperation("mouvementsMatieres", row)
      )
    });

  const saveCuveeProductionBundleFallback = async (payload = {}) => {
    const cuvee =
      payload.cuvee ||
      payload["cuvée"] ||
      payload.batch ||
      null;

    const ingredientsReels =
      toArray(payload.ingredients_reels).length
        ? toArray(payload.ingredients_reels)
        : toArray(payload.cuvees_ingredients_reels).length
          ? toArray(payload.cuvees_ingredients_reels)
          : toArray(payload.ingredients);

    const matieresConsommees =
      toArray(payload.matieres_consommees).length
        ? toArray(payload.matieres_consommees)
        : toArray(payload.cuvees_matieres_consommees).length
          ? toArray(payload.cuvees_matieres_consommees)
          : toArray(payload.consommations);

    const mouvementsMatieres =
      toArray(payload.mouvements_matieres).length
        ? toArray(payload.mouvements_matieres)
        : toArray(payload.mouvements);

    const matieresLots =
      toArray(payload.matieres_lots).length
        ? toArray(payload.matieres_lots)
        : toArray(payload.lots);

    const results = {
      fallback: true,
      cuvee: null,
      ingredients_reels: [],
      matieres_consommees: [],
      mouvements_matieres: [],
      matieres_lots: [],
      ingredients_reels_count: 0,
      matieres_consommees_count: 0,
      mouvements_matieres_count: 0,
      matieres_lots_count: 0
    };

    if (cuvee) {
      results.cuvee = await saveCuvee(cuvee);
    }

    if (ingredientsReels.length > 0) {
      results.ingredients_reels = await saveCuveeIngredientsReels(ingredientsReels);
      results.ingredients_reels_count = ingredientsReels.length;
    }

    if (matieresConsommees.length > 0) {
      results.matieres_consommees = await saveCuveesMatieresConsommees(matieresConsommees);
      results.matieres_consommees_count = matieresConsommees.length;
    }

    if (mouvementsMatieres.length > 0) {
      results.mouvements_matieres = await saveMouvementsMatieres(mouvementsMatieres);
      results.mouvements_matieres_count = mouvementsMatieres.length;
    }

    if (matieresLots.length > 0) {
      results.matieres_lots = await requestQueuedPost("batchUpsert", {
        operations: matieresLots.map((lot) =>
          buildConfiguredUpsertOperation("matieresLots", lot)
        )
      });
      results.matieres_lots_count = matieresLots.length;
    }

    return results;
  };

  const saveCuveeProductionBundle = async (payload = {}) => {
    try {
      return await requestQueuedPost("saveCuveeProductionBundle", payload);
    } catch (error) {
      if (
        isUnknownPostActionError(error, "saveCuveeProductionBundle") ||
        isUnknownPostActionError(error, "saveRecetteProductionBundle") ||
        isUnknownPostActionError(error, "saveCuveeBundle")
      ) {
        console.warn(
          "saveCuveeProductionBundle indisponible côté Apps Script, fallback détaillé utilisé.",
          error
        );

        return saveCuveeProductionBundleFallback(payload);
      }

      throw error;
    }
  };

  const saveRecetteProductionBundle = saveCuveeProductionBundle;
  const saveCuveeBundle = saveCuveeProductionBundle;

  const post = (action, payload = {}) =>
    requestQueuedPost(action, payload);

  const request = (action, payload = {}) =>
    requestQueuedPost(action, payload);

  const call = (action, payload = {}) =>
    requestQueuedPost(action, payload);

  const queueAction = (action, payload = {}) =>
    requestQueuedPost(action, payload);

  const enqueueAction = (action, payload = {}) =>
    requestQueuedPost(action, payload);

  window.LugdurumDataState = {
    set: setDataState,
    get: getDataState
  };

  window.LugdurumAPI = {
    ping() {
      return requestGet("ping", {}, { flushBeforeRead: false });
    },

    postPing() {
      return requestPost("ping");
    },

    getSpreadsheetInfo() {
      return requestGet("getSpreadsheetInfo", {}, { flushBeforeRead: false });
    },

    post,
    request,
    call,
    queueAction,
    enqueueAction,

    list,
    upsert,

    getHomeData,

    getRecettesData,
    getRecettesDashboardData,
    getRecettesHistoriqueData,
    getRecettesProductionData,
    getRecettesMatieresData,

    getCoreData(tables = []) {
      return requestGet("getCoreData", {
        tables: normalizeCoreTablesParam(tables)
      });
    },

    getCoreTable,

    getClients,
    getCommandesPro,
    getCommandesLignes,
    getCommandesProLignes,
    getDocuments,
    getReferentiels,
    getReferentiel,

    saveClient,
    saveCommandePro,
    saveCommandeLigne,
    saveCommandeProLigne,
    saveCommandeLignes,
    saveCommandeProLignes,
    saveDocument,
    saveReferentiel,

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

    getRecettes,
    getRecettesIngredients,
    getIngredients,
    getCuvees,
    getCuveesIngredientsReels,
    getMatieresPremieres,
    getMatieresLots,
    getCuveesMatieresConsommees,
    getMouvementsMatieres,

    saveRecette,
    saveRecetteIngredient,
    saveRecetteIngredients,
    saveIngredient,
    saveCuvee,
    saveCuveeIngredientReel,
    saveCuveeIngredientsReels,
    saveMatierePremiere,
    saveMatiereLot,
    saveCuveeMatiereConsommee,
    saveCuveesMatieresConsommees,
    saveMouvementMatiere,
    saveMouvementsMatieres,
    saveCuveeProductionBundle,
    saveRecetteProductionBundle,
    saveCuveeBundle,

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

    setDataState("refreshing", {
      message: "connexion retrouvée"
    });

    scheduleFlush(250);
  });

  window.addEventListener("offline", () => {
    writeSyncState({
      status: "offline",
      last_message: "Connexion perdue. Les prochaines écritures seront gardées localement."
    });

    setDataState("local", {
      message: "hors ligne"
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

  initDataStateBadge();

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