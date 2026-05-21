(() => {
  "use strict";

  /*
    Accueil V17 :
    - Affiche immédiatement le dernier cache accueil connu, mais clairement marqué comme local.
    - Lance ensuite une actualisation en ligne via LugdurumAPI.getHomeData().
    - Le badge ne passe en vert qu’après une réponse API réussie.
    - Corrige la pastille :
      - passe par window.LugdurumDataState quand disponible.
      - envoie label + message pour rester compatible avec lugdurum-api.js ET pwa.js.
      - reste compatible avec un fallback DOM si le pont global n’est pas encore prêt.
    - Ajoute une preuve de provenance visible dans “À surveiller”.
    - Diagnostic sync masqué par défaut :
      visible uniquement avec ?debug=sync ou localStorage lugdurum_show_diagnostic_sync = "1".
    - Cache accueil dédié : lugdurum_home_data_cache.
    - Fallback API : getCoreData(), puis getters séparés.
    - File d’attente officielle : lugdurum_pending_writes.
    - Legacy transactions : lugdurum_pending_transactions.
  */

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme",
    role: "admin"
  };

  const STORAGE_KEYS = {
    homeDataCache: "lugdurum_home_data_cache",

    inscriptions: "lugdurum_inscriptions_evenements",
    events: "lugdurum_evenements",
    stockMissions: "lugdurum_missions_stock",
    journees: "lugdurum_journees",
    transactions: "lugdurum_transactions",
    mouvementsStock: "lugdurum_mouvements_stock",

    activeMissionId: "lugdurum_active_mission_id",
    activeStockMissionId: "lugdurum_active_stock_mission_id",
    activeJourneeId: "lugdurum_active_journee_id",
    preparationContext: "lugdurum_preparation_context",

    pendingTransactions: "lugdurum_pending_transactions",
    showDiagnosticSync: "lugdurum_show_diagnostic_sync"
  };

  const CORE_TABLES = [
    "inscriptions",
    "missions",
    "missionsStock",
    "journees",
    "transactions",
    "mouvementsStock"
  ];

  const STEP_ORDER = ["inscriptions", "missions", "stock", "vente", "cloture"];
  const HISTORICAL_SOURCE = "SAISIE_HISTORIQUE";

  const INITIAL_STOCK_MOVEMENT_TYPES = [
    "preparation_initiale",
    "stock_initial",
    "preparation_stock",
    "initial_stock",
    "entree_initiale",
    "preparation"
  ];

  const DATA_STATE_BASE_LABELS = {
    local: "Données locales",
    refreshing: "Actualisation",
    online: "Données en ligne"
  };

  const formatEuro = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });

  const formatDate = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

  const state = {
    dataSource: "loading",
    loadError: "",
    pendingWritesCount: 0,
    legacyPendingTransactionsCount: 0,

    apiMode: "",
    apiFetchedAt: "",
    apiGeneratedAt: "",
    apiDurationMs: null,

    cacheSavedAt: "",
    lastHomePayload: null,

    remoteTransactionIds: null,
    remoteTransactionIndexComplete: false,

    rawCounts: {
      inscriptions: 0,
      events: 0,
      stockMissions: 0,
      journees: 0,
      transactions: 0,
      mouvementsStock: 0
    },

    data: {
      inscriptions: [],
      events: [],
      stockMissions: [],
      journees: [],
      transactions: [],
      mouvementsStock: []
    }
  };

  const qs = (selector) => document.querySelector(selector);

  const api = () => window.LugdurumAPI || null;
  const hasApi = () => Boolean(api());

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
      // Cache non critique.
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

  const getArray = (key) => {
    const value = readJson(key, []);
    return Array.isArray(value) ? value : [];
  };

  const getObject = (key) => {
    const value = readJson(key, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  };

  const toNumber = (value, fallback = 0) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;

    const normalized = String(value ?? "")
      .trim()
      .replace(/\s/g, "")
      .replace(",", ".");

    if (!normalized) return fallback;

    const number = Number(normalized);
    return Number.isFinite(number) ? number : fallback;
  };

  const toBoolean = (value, fallback = false) => {
    if (value === true) return true;
    if (value === false) return false;
    if (typeof value === "number") return value !== 0;

    const normalized = String(value ?? "")
      .trim()
      .toLowerCase();

    if (!normalized) return fallback;

    if (["true", "vrai", "oui", "yes", "1", "x", "actif"].includes(normalized)) {
      return true;
    }

    if (["false", "faux", "non", "no", "0", "inactif"].includes(normalized)) {
      return false;
    }

    return fallback;
  };

  const normalizeText = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const normalizeStatus = (value) => normalizeText(value);

  const parseDate = (isoDate) => {
    if (!isoDate) return null;

    const value = String(isoDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

    return new Date(`${value}T12:00:00`);
  };

  const formatIsoDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  };

  const todayIso = () => formatIsoDate(new Date());

  const formatDisplayDate = (isoDate) => {
    const date = parseDate(isoDate);
    if (!date) return "date inconnue";
    return formatDate.format(date);
  };

  const formatShortDateTime = (isoDate) => {
    if (!isoDate) return "";

    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  };

  const getDateLabel = (item) => {
    if (!item?.date_debut) return "Date inconnue";

    if (!item.date_fin || item.date_debut === item.date_fin) {
      return formatDisplayDate(item.date_debut);
    }

    return `${formatDisplayDate(item.date_debut)} → ${formatDisplayDate(item.date_fin)}`;
  };

  const normalizeDataSourceMode = (mode) => {
    if (mode === "online") return "online";
    if (mode === "refreshing") return "refreshing";
    return "local";
  };

  const buildDataStatePayload = (mode, label = "") => {
    const safeMode = normalizeDataSourceMode(mode);
    const baseLabel = DATA_STATE_BASE_LABELS[safeMode] || DATA_STATE_BASE_LABELS.local;
    const rawLabel = String(label || "").trim();

    if (!rawLabel) {
      return {
        label: baseLabel,
        message: "",
        text: baseLabel
      };
    }

    if (rawLabel === baseLabel) {
      return {
        label: baseLabel,
        message: "",
        text: baseLabel
      };
    }

    if (rawLabel.startsWith(`${baseLabel} · `)) {
      const message = rawLabel.slice(`${baseLabel} · `.length).trim();

      return {
        label: baseLabel,
        message,
        text: message ? `${baseLabel} · ${message}` : baseLabel
      };
    }

    return {
      label: rawLabel,
      message: "",
      text: rawLabel
    };
  };

  const setDocumentDataSource = (mode) => {
    const safeMode = normalizeDataSourceMode(mode);

    if (safeMode === "online") {
      document.documentElement.dataset.lugdurumDataSource = "api";
      return;
    }

    if (safeMode === "refreshing") {
      document.documentElement.dataset.lugdurumDataSource = "refreshing";
      return;
    }

    document.documentElement.dataset.lugdurumDataSource = "cache";
  };

  const applyDataStateDirectlyToBadge = (mode, label = "") => {
    const badge = qs("#lugdurumDataStateBadge");
    if (!badge) return null;

    const safeMode = normalizeDataSourceMode(mode);
    const payload = buildDataStatePayload(safeMode, label);
    const text = badge.querySelector(".lugdurumDataStateBadgeText");

    badge.classList.remove("isLocal", "isRefreshing", "isOnline");

    if (safeMode === "online") {
      badge.classList.add("isOnline");
      badge.title = "Source active : API en ligne";
      badge.dataset.state = "online";
    } else if (safeMode === "refreshing") {
      badge.classList.add("isRefreshing");
      badge.title = "Actualisation en cours";
      badge.dataset.state = "refreshing";
    } else {
      badge.classList.add("isLocal");
      badge.title = "Source active : cache local";
      badge.dataset.state = "local";
    }

    if (text) {
      text.textContent = payload.text;
    }

    return {
      status: safeMode,
      label: payload.label,
      message: payload.message,
      text: payload.text
    };
  };

  const setDataState = (mode, label = "") => {
    const safeMode = normalizeDataSourceMode(mode);
    const payload = buildDataStatePayload(safeMode, label);

    setDocumentDataSource(safeMode);

    if (
      window.LugdurumDataState &&
      typeof window.LugdurumDataState.set === "function"
    ) {
      try {
        const result = window.LugdurumDataState.set(safeMode, {
          label: payload.label,
          message: payload.message
        });

        applyDataStateDirectlyToBadge(safeMode, payload.text);

        return result;
      } catch (error) {
        console.warn("Mise à jour LugdurumDataState impossible, fallback DOM utilisé.", error);
      }
    }

    return applyDataStateDirectlyToBadge(safeMode, payload.text);
  };

  const isCancelledStatus = (item) => {
    const statut = normalizeStatus(item?.statut || item?.paiement_statut);

    return [
      "annule",
      "annulee",
      "annulé",
      "annulée",
      "refuse",
      "refusee",
      "refusé",
      "refusée"
    ].includes(statut);
  };

  const isClosedStatus = (item) => {
    const statut = normalizeStatus(item?.statut);

    return [
      "cloture",
      "cloturee",
      "clôture",
      "clôturée",
      "termine",
      "terminee",
      "terminé",
      "terminée"
    ].includes(statut);
  };

  const isValidStatus = (item) => !isCancelledStatus(item);

  const getEventId = (eventItem) =>
    String(eventItem?.mission_id || eventItem?.evenement_id || "").trim();

  const getStockMissionId = (mission) =>
    String(mission?.mission_id || "").trim();

  const getStockMissionEventId = (mission) =>
    String(mission?.evenement_id || mission?.event_id || "").trim();

  const getDayId = (journee) =>
    String(journee?.journee_id || "").trim();

  const getDayEventId = (journee) =>
    String(journee?.evenement_id || journee?.mission_id || "").trim();

  const getMovementMissionId = (mouvement) =>
    String(
      mouvement?.stock_mission_id ||
      mouvement?.mission_stock_id ||
      mouvement?.mission_id ||
      ""
    ).trim();

  const getMovementType = (mouvement) =>
    normalizeStatus(
      mouvement?.type_mouvement ||
      mouvement?.mouvement_type ||
      mouvement?.type ||
      mouvement?.categorie ||
      ""
    );

  const getMovementQuantity = (mouvement) =>
    toNumber(
      mouvement?.quantite ??
      mouvement?.quantity ??
      mouvement?.qty,
      0
    );

  const isHistoricalSource = (item) =>
    String(item?.source || "")
      .trim()
      .toUpperCase() === HISTORICAL_SOURCE;

  const isHistoricalEvent = (eventItem) => {
    const eventId = getEventId(eventItem);

    return (
      isHistoricalSource(eventItem) ||
      eventId.startsWith("EVT_HIST_")
    );
  };

  const isHistoricalStockMission = (mission) => {
    const missionId = getStockMissionId(mission);

    return (
      isHistoricalSource(mission) ||
      missionId.startsWith("MST_HIST_")
    );
  };

  const isHistoricalDay = (journee) => {
    const journeeId = getDayId(journee);
    const eventId = getDayEventId(journee);
    const stockMissionId = String(journee?.stock_mission_id || "").trim();

    return (
      isHistoricalSource(journee) ||
      journeeId.startsWith("J_HIST_") ||
      eventId.startsWith("EVT_HIST_") ||
      stockMissionId.startsWith("MST_HIST_")
    );
  };

  const isUpcomingOrCurrent = (item) => {
    if (!item?.date_fin && !item?.date_debut) return true;

    const end = String(item.date_fin || item.date_debut || "").slice(0, 10);
    if (!end) return true;

    return end >= todayIso();
  };

  const isStockMissionUsefulForHome = (mission) => {
    if (!mission) return false;
    if (isCancelledStatus(mission)) return false;
    if (isHistoricalStockMission(mission)) return false;

    if (isClosedStatus(mission) && !isUpcomingOrCurrent(mission)) {
      return false;
    }

    return true;
  };

  const isStockMissionActiveCandidate = (mission) => {
    if (!isStockMissionUsefulForHome(mission)) return false;
    if (isClosedStatus(mission)) return false;

    return true;
  };

  const getCleanInscriptions = (inscriptions) =>
    inscriptions.filter((item) => !isCancelledStatus(item));

  const getAcceptedInscriptions = (inscriptions) =>
    inscriptions.filter((item) => {
      if (isCancelledStatus(item)) return false;

      const statut = normalizeStatus(item.statut);

      return (
        statut === "accepte" ||
        statut === "acceptee" ||
        statut === "accepté" ||
        statut === "acceptée" ||
        toBoolean(item.acceptation, false)
      );
    });

  const waitForApi = (timeoutMs = 2500) =>
    new Promise((resolve) => {
      if (hasApi()) {
        resolve(true);
        return;
      }

      const startedAt = Date.now();

      const tick = () => {
        if (hasApi()) {
          resolve(true);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
          return;
        }

        window.setTimeout(tick, 50);
      };

      tick();
    });

  const getActiveIds = () => {
    const context = getObject(STORAGE_KEYS.preparationContext);

    return {
      stockMissionId:
        safeLocalGet(STORAGE_KEYS.activeStockMissionId) ||
        context.stock_mission_id ||
        context.mission_stock_id ||
        context.mission_id ||
        safeLocalGet(STORAGE_KEYS.activeMissionId) ||
        "",
      journeeId:
        safeLocalGet(STORAGE_KEYS.activeJourneeId) ||
        context.journee_id ||
        ""
    };
  };

  const callArray = async (names, { required = true } = {}) => {
    const nameList = Array.isArray(names) ? names : [names];
    let lastError = null;
    let foundCallable = false;

    for (const name of nameList) {
      if (!hasApi() || typeof api()[name] !== "function") {
        continue;
      }

      foundCallable = true;

      try {
        const result = await api()[name]();
        return Array.isArray(result) ? result : [];
      } catch (error) {
        lastError = error;
      }
    }

    if (!required) {
      return [];
    }

    if (lastError) {
      throw lastError;
    }

    if (!foundCallable) {
      throw new Error(`Fonction API indisponible : ${nameList.join(" / ")}`);
    }

    throw new Error(`Lecture API impossible : ${nameList.join(" / ")}`);
  };

  const getPendingWritesCount = () => {
    if (hasApi() && typeof api().getPendingWritesCount === "function") {
      return toNumber(api().getPendingWritesCount(), 0);
    }

    return 0;
  };

  const getTransactionId = (transaction) =>
    String(transaction?.transaction_id || transaction?.id || "").trim();

  const getRemoteTransactionIds = (transactions) =>
    new Set(
      transactions
        .map(getTransactionId)
        .filter(Boolean)
    );

  const getKnownRemoteTransactionIds = (transactions = []) => {
    if (state.remoteTransactionIds instanceof Set && state.remoteTransactionIds.size > 0) {
      return state.remoteTransactionIds;
    }

    return getRemoteTransactionIds(transactions);
  };

  const getUnmatchedLegacyPendingTransactions = (remoteTransactions = []) => {
    const localPending = getArray(STORAGE_KEYS.pendingTransactions);

    if (localPending.length === 0) return [];

    const remoteIds = getKnownRemoteTransactionIds(remoteTransactions);

    if (remoteIds.size === 0) {
      if (state.apiMode === "getHomeData" && !state.remoteTransactionIndexComplete) {
        return [];
      }

      return localPending;
    }

    return localPending.filter((transaction) => {
      const id = getTransactionId(transaction);

      if (!id) return true;

      return !remoteIds.has(id);
    });
  };

  const reconcileLegacyPendingTransactionsLocal = (remoteTransactions = []) => {
    const localPending = getArray(STORAGE_KEYS.pendingTransactions);

    if (localPending.length === 0) {
      return {
        cleaned_count: 0,
        pending_count: 0,
        remaining: []
      };
    }

    const remaining = getUnmatchedLegacyPendingTransactions(remoteTransactions);
    const cleanedCount = localPending.length - remaining.length;

    if (cleanedCount > 0) {
      writeJson(STORAGE_KEYS.pendingTransactions, remaining);
    }

    return {
      cleaned_count: cleanedCount,
      pending_count: remaining.length,
      remaining
    };
  };

  const buildTransactionsForReconcile = (data) => {
    if (state.remoteTransactionIds instanceof Set && state.remoteTransactionIds.size > 0) {
      return [...state.remoteTransactionIds].map((transactionId) => ({
        transaction_id: transactionId
      }));
    }

    return data.transactions;
  };

  const canReconcileLegacyPendingTransactions = () => {
    if (state.apiMode !== "getHomeData") return true;
    return state.remoteTransactionIndexComplete;
  };

  const reconcileLegacyPendingTransactions = async (data) => {
    if (!canReconcileLegacyPendingTransactions()) {
      return {
        cleaned_count: 0,
        pending_count: getUnmatchedLegacyPendingTransactions(data.transactions).length,
        remaining: getUnmatchedLegacyPendingTransactions(data.transactions),
        skipped: true
      };
    }

    const remoteTransactions = buildTransactionsForReconcile(data);

    if (
      hasApi() &&
      typeof api().reconcileLegacyPendingTransactions === "function"
    ) {
      return api().reconcileLegacyPendingTransactions(remoteTransactions);
    }

    return reconcileLegacyPendingTransactionsLocal(remoteTransactions);
  };

  const normalizeCoreArray = (coreData, key, aliases = []) => {
    const keys = [key, ...aliases];

    for (const candidateKey of keys) {
      const value = coreData?.[candidateKey];

      if (Array.isArray(value)) return value;

      if (value && typeof value === "object" && value.ok === false) {
        throw new Error(value.error || `Table coreData invalide : ${candidateKey}`);
      }
    }

    return [];
  };

  const pickArray = (source, keys = []) => {
    if (!source || typeof source !== "object") return [];

    for (const key of keys) {
      const value = source[key];
      if (Array.isArray(value)) return value;
    }

    return [];
  };

  const uniqueBy = (items, getId) => {
    const map = new Map();

    items.forEach((item, index) => {
      if (!item || typeof item !== "object") return;

      const id = String(getId(item) || "").trim() || `__INDEX_${index}`;
      map.set(id, item);
    });

    return [...map.values()];
  };

  const pushIfObject = (items, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      items.push(value);
    }
  };

  const normalizeRemoteData = (data) => ({
    inscriptions: Array.isArray(data.inscriptions) ? data.inscriptions : [],
    events: Array.isArray(data.events) ? data.events : [],
    stockMissions: Array.isArray(data.stockMissions) ? data.stockMissions : [],
    journees: Array.isArray(data.journees) ? data.journees : [],
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
    mouvementsStock: Array.isArray(data.mouvementsStock) ? data.mouvementsStock : []
  });

  const getCountFrom = (counts, keys, fallback) => {
    if (!counts || typeof counts !== "object") return fallback;

    for (const key of keys) {
      const value = counts[key];

      if (value !== undefined && value !== null && value !== "") {
        return toNumber(value, fallback);
      }
    }

    return fallback;
  };

  const cacheRemoteData = (data) => {
    writeJson(STORAGE_KEYS.inscriptions, data.inscriptions);
    writeJson(STORAGE_KEYS.events, data.events);
    writeJson(STORAGE_KEYS.stockMissions, data.stockMissions);
    writeJson(STORAGE_KEYS.journees, data.journees);
    writeJson(STORAGE_KEYS.transactions, data.transactions);
    writeJson(STORAGE_KEYS.mouvementsStock, data.mouvementsStock);
  };

  const cacheHomeDataPayload = (payload) => {
    if (!payload || typeof payload !== "object") return;

    writeJson(STORAGE_KEYS.homeDataCache, {
      saved_at: new Date().toISOString(),
      payload
    });
  };

  const updateRawCounts = (data, counts = {}) => {
    state.rawCounts = {
      inscriptions: getCountFrom(counts, ["inscriptions", "inscriptions_count"], data.inscriptions.length),
      events: getCountFrom(counts, ["events", "missions", "missions_count", "missions_vente"], data.events.length),
      stockMissions: getCountFrom(counts, ["stockMissions", "missionsStock", "missions_stock", "missions_stock_count"], data.stockMissions.length),
      journees: getCountFrom(counts, ["journees", "journees_count", "journees_vente"], data.journees.length),
      transactions: getCountFrom(counts, ["transactions", "transactions_count"], data.transactions.length),
      mouvementsStock: getCountFrom(counts, ["mouvementsStock", "mouvements_stock", "mouvements_stock_count"], data.mouvementsStock.length)
    };
  };

  const refreshPendingCounts = () => {
    state.pendingWritesCount = getPendingWritesCount();
    state.legacyPendingTransactionsCount =
      getUnmatchedLegacyPendingTransactions(state.data.transactions).length;
  };

  const normalizeHomeDataPayload = (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Payload accueil invalide.");
    }

    const envelope =
      payload.homeData ||
      payload.home_data ||
      payload.home ||
      payload;

    const tables =
      envelope.tables ||
      envelope.coreData ||
      envelope.core_data ||
      envelope.data ||
      {};

    const active =
      envelope.active ||
      envelope.current ||
      {};

    const inscriptions = pickArray(tables, [
      "inscriptions",
      "inscriptions_evenements"
    ]);

    const events = pickArray(tables, [
      "events",
      "missions",
      "missions_vente"
    ]);

    const stockMissions = pickArray(tables, [
      "stockMissions",
      "missionsStock",
      "missions_stock"
    ]);

    const journees = pickArray(tables, [
      "journees",
      "journees_vente"
    ]);

    const transactions = pickArray(tables, [
      "transactions",
      "currentTransactions",
      "dayTransactions",
      "transactions_jour"
    ]);

    const mouvementsStock = pickArray(tables, [
      "mouvementsStock",
      "mouvements_stock",
      "stock_mouvements"
    ]);

    const extraEvents = [];
    pushIfObject(extraEvents, envelope.event);
    pushIfObject(extraEvents, envelope.eventItem);
    pushIfObject(extraEvents, envelope.activeEvent);
    pushIfObject(extraEvents, envelope.active_event);
    pushIfObject(extraEvents, envelope.missionVente);
    pushIfObject(extraEvents, envelope.mission_vente);
    pushIfObject(extraEvents, active.event);
    pushIfObject(extraEvents, active.eventItem);
    pushIfObject(extraEvents, active.event_item);
    pushIfObject(extraEvents, active.missionVente);
    pushIfObject(extraEvents, active.mission_vente);

    const extraStockMissions = [];
    pushIfObject(extraStockMissions, envelope.mission);
    pushIfObject(extraStockMissions, envelope.stockMission);
    pushIfObject(extraStockMissions, envelope.stock_mission);
    pushIfObject(extraStockMissions, envelope.activeMission);
    pushIfObject(extraStockMissions, envelope.active_mission);
    pushIfObject(extraStockMissions, active.mission);
    pushIfObject(extraStockMissions, active.stockMission);
    pushIfObject(extraStockMissions, active.stock_mission);

    const extraJournees = [];
    pushIfObject(extraJournees, envelope.journee);
    pushIfObject(extraJournees, envelope.activeJournee);
    pushIfObject(extraJournees, envelope.active_journee);
    pushIfObject(extraJournees, active.journee);
    pushIfObject(extraJournees, active.activeJournee);
    pushIfObject(extraJournees, active.active_journee);

    const extraTransactions = [
      ...pickArray(envelope, ["currentTransactions", "dayTransactions", "transactions_jour"]),
      ...pickArray(active, ["transactions", "currentTransactions", "dayTransactions", "transactions_jour"])
    ];

    const extraMouvements = [
      ...pickArray(envelope, ["currentMouvementsStock", "mouvementsStockMission", "mouvements_stock_mission"]),
      ...pickArray(active, ["mouvementsStock", "currentMouvementsStock", "mouvementsStockMission", "mouvements_stock_mission"])
    ];

    const data = normalizeRemoteData({
      inscriptions,
      events: uniqueBy([...events, ...extraEvents], getEventId),
      stockMissions: uniqueBy([...stockMissions, ...extraStockMissions], getStockMissionId),
      journees: uniqueBy([...journees, ...extraJournees], getDayId),
      transactions: uniqueBy([...transactions, ...extraTransactions], getTransactionId),
      mouvementsStock: [...mouvementsStock, ...extraMouvements]
    });

    const transactionIds =
      [
        ...pickArray(envelope, ["transactionIds", "transaction_ids", "allTransactionIds", "all_transaction_ids"]),
        ...pickArray(active, ["transactionIds", "transaction_ids", "allTransactionIds", "all_transaction_ids"])
      ]
        .map((item) => {
          if (typeof item === "string" || typeof item === "number") {
            return String(item).trim();
          }

          return getTransactionId(item);
        })
        .filter(Boolean);

    const rawCounts =
      envelope.rawCounts ||
      envelope.raw_counts ||
      envelope.counts ||
      tables.rawCounts ||
      tables.raw_counts ||
      {};

    const indexComplete =
      envelope.transaction_ids_complete === true ||
      envelope.transactionIdsComplete === true ||
      envelope.all_transaction_ids_complete === true ||
      envelope.allTransactionIdsComplete === true ||
      envelope.remote_transaction_index_complete === true ||
      envelope.remoteTransactionIndexComplete === true ||
      active.transaction_ids_complete === true ||
      active.remote_transaction_index_complete === true;

    return {
      data,
      rawCounts,
      transactionIds,
      transactionIndexComplete: indexComplete,
      generatedAt: envelope.generated_at || envelope.generatedAt || "",
      durationMs: toNumber(envelope.duration_ms ?? envelope.durationMs, null),
      apiMode: envelope.api_mode || envelope.apiMode || "getHomeData",
      homePayload: payload
    };
  };

  const loadRemoteDataWithHomeData = async () => {
    if (!hasApi() || typeof api().getHomeData !== "function") {
      throw new Error("LugdurumAPI.getHomeData() est indisponible.");
    }

    const activeIds = getActiveIds();

    const payload = await api().getHomeData({
      today: todayIso(),
      activeStockMissionId: activeIds.stockMissionId,
      activeJourneeId: activeIds.journeeId
    });

    const normalized = normalizeHomeDataPayload(payload);

    state.remoteTransactionIds =
      normalized.transactionIds.length > 0
        ? new Set(normalized.transactionIds)
        : null;

    state.remoteTransactionIndexComplete = normalized.transactionIndexComplete;
    state.lastHomePayload = normalized.homePayload;

    state.apiMode = normalized.apiMode || "getHomeData";
    state.apiFetchedAt = new Date().toISOString();
    state.apiGeneratedAt = normalized.generatedAt || "";
    state.apiDurationMs = normalized.durationMs;

    const data = normalized.data;
    data.__rawCounts = normalized.rawCounts;

    return data;
  };

  const loadRemoteDataWithCoreData = async () => {
    if (!hasApi() || typeof api().getCoreData !== "function") {
      throw new Error("LugdurumAPI.getCoreData() est indisponible.");
    }

    const coreData = await api().getCoreData(CORE_TABLES);

    if (!coreData || typeof coreData !== "object" || Array.isArray(coreData)) {
      throw new Error("Réponse getCoreData invalide.");
    }

    state.remoteTransactionIds = null;
    state.remoteTransactionIndexComplete = true;
    state.lastHomePayload = null;

    state.apiFetchedAt = new Date().toISOString();
    state.apiGeneratedAt = "";
    state.apiDurationMs = null;

    return normalizeRemoteData({
      inscriptions: normalizeCoreArray(coreData, "inscriptions", ["inscriptions_evenements"]),
      events: normalizeCoreArray(coreData, "missions", ["missions_vente"]),
      stockMissions: normalizeCoreArray(coreData, "missionsStock", ["missions_stock"]),
      journees: normalizeCoreArray(coreData, "journees", ["journees_vente"]),
      transactions: normalizeCoreArray(coreData, "transactions"),
      mouvementsStock: normalizeCoreArray(coreData, "mouvementsStock", ["mouvements_stock", "stock_mouvements"])
    });
  };

  const loadRemoteDataWithSeparateCalls = async () => {
    const [
      inscriptions,
      events,
      stockMissions,
      journees,
      transactions,
      mouvementsStock
    ] = await Promise.all([
      callArray(["getInscriptionsEvenements", "getInscriptions"]),
      callArray("getMissions"),
      callArray("getMissionsStock"),
      callArray(["getJournees", "getJourneesVente"]),
      callArray("getTransactions", { required: false }),
      callArray("getMouvementsStock", { required: false })
    ]);

    state.remoteTransactionIds = null;
    state.remoteTransactionIndexComplete = true;
    state.lastHomePayload = null;

    state.apiFetchedAt = new Date().toISOString();
    state.apiGeneratedAt = "";
    state.apiDurationMs = null;

    return normalizeRemoteData({
      inscriptions,
      events,
      stockMissions,
      journees,
      transactions,
      mouvementsStock
    });
  };

  const loadRemoteData = async () => {
    const ready = await waitForApi();

    if (!ready) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    let data;
    let shouldCacheGeneric = false;

    try {
      data = await loadRemoteDataWithHomeData();
    } catch (homeError) {
      try {
        data = await loadRemoteDataWithCoreData();
        state.apiMode = `getCoreData après échec getHomeData : ${homeError.message}`;
        shouldCacheGeneric = true;
      } catch (coreError) {
        try {
          data = await loadRemoteDataWithSeparateCalls();
          state.apiMode = `getters séparés après échec getHomeData/getCoreData : ${homeError.message} · ${coreError.message}`;
          shouldCacheGeneric = true;
        } catch (separateError) {
          throw new Error(
            `getHomeData : ${homeError.message} · getCoreData : ${coreError.message} · getters séparés : ${separateError.message}`
          );
        }
      }
    }

    const rawCounts = data.__rawCounts || {};

    if (state.lastHomePayload) {
      cacheHomeDataPayload(state.lastHomePayload);
    } else {
      cacheHomeDataPayload({
        api_mode: state.apiMode,
        generated_at: new Date().toISOString(),
        rawCounts: {},
        data
      });
    }

    if (shouldCacheGeneric) {
      cacheRemoteData(data);
    }

    updateRawCounts(data, rawCounts);

    const legacyCleanup = await Promise.resolve(
      reconcileLegacyPendingTransactions(data)
    );

    state.legacyPendingTransactionsCount = toNumber(
      legacyCleanup?.pending_count,
      getUnmatchedLegacyPendingTransactions(data.transactions).length
    );

    return data;
  };

  const loadHomeCacheData = () => {
    const cache = readJson(STORAGE_KEYS.homeDataCache, null);

    if (!cache || typeof cache !== "object") return null;

    const payload = cache.payload || cache;
    const normalized = normalizeHomeDataPayload(payload);

    state.remoteTransactionIds =
      normalized.transactionIds.length > 0
        ? new Set(normalized.transactionIds)
        : null;

    state.remoteTransactionIndexComplete = normalized.transactionIndexComplete;
    state.cacheSavedAt = cache.saved_at || normalized.generatedAt || "";
    state.apiMode = `cache accueil${state.cacheSavedAt ? ` · ${formatShortDateTime(state.cacheSavedAt)}` : ""}`;
    state.apiFetchedAt = "";
    state.apiGeneratedAt = "";
    state.apiDurationMs = null;

    const data = normalized.data;
    data.__rawCounts = normalized.rawCounts;

    updateRawCounts(data, normalized.rawCounts);

    return data;
  };

  const loadCacheData = () => {
    state.remoteTransactionIds = null;
    state.remoteTransactionIndexComplete = true;

    const homeCachedData = (() => {
      try {
        return loadHomeCacheData();
      } catch {
        return null;
      }
    })();

    if (homeCachedData) {
      state.legacyPendingTransactionsCount =
        getUnmatchedLegacyPendingTransactions(homeCachedData.transactions).length;

      return homeCachedData;
    }

    const data = normalizeRemoteData({
      inscriptions: getArray(STORAGE_KEYS.inscriptions),
      events: getArray(STORAGE_KEYS.events),
      stockMissions: getArray(STORAGE_KEYS.stockMissions),
      journees: getArray(STORAGE_KEYS.journees),
      transactions: getArray(STORAGE_KEYS.transactions),
      mouvementsStock: getArray(STORAGE_KEYS.mouvementsStock)
    });

    updateRawCounts(data);

    state.legacyPendingTransactionsCount =
      getUnmatchedLegacyPendingTransactions(data.transactions).length;

    return data;
  };

  const getMissionJournees = (missionId, journees) =>
    journees
      .filter((journee) => !isHistoricalDay(journee))
      .filter((journee) => !isCancelledStatus(journee))
      .filter((journee) => {
        return (
          String(journee.mission_id || "") === String(missionId || "") ||
          String(journee.stock_mission_id || "") === String(missionId || "") ||
          String(journee.mission_stock_id || "") === String(missionId || "") ||
          String(journee.evenement_id || "") === String(missionId || "")
        );
      })
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  const getFirstOpenDay = (missionId, journees) => {
    const linkedDays = getMissionJournees(missionId, journees);

    return (
      linkedDays.find((journee) => !isClosedStatus(journee) && !isCancelledStatus(journee)) ||
      linkedDays[0] ||
      null
    );
  };

  const findFallbackActiveMission = (stockMissions) => {
    const candidates = stockMissions
      .filter(isStockMissionActiveCandidate)
      .sort((a, b) => {
        const byDate = String(a.date_debut || "").localeCompare(String(b.date_debut || ""));
        if (byDate !== 0) return byDate;

        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });

    return candidates[0] || null;
  };

  const isInitialStockMovement = (mouvement) => {
    if (!mouvement || isCancelledStatus(mouvement)) return false;

    const type = getMovementType(mouvement);

    if (INITIAL_STOCK_MOVEMENT_TYPES.includes(type)) {
      return true;
    }

    return type.includes("preparation") && type.includes("initial");
  };

  const hasInitialStockMovement = (mission, mouvementsStock) => {
    if (!mission) return false;

    const missionIds = new Set(
      [
        getStockMissionId(mission),
        String(mission.stock_mission_id || "").trim(),
        String(mission.mission_stock_id || "").trim(),
        getStockMissionEventId(mission)
      ].filter(Boolean)
    );

    return mouvementsStock.some((mouvement) => {
      if (!isInitialStockMovement(mouvement)) return false;

      const movementMissionId = getMovementMissionId(mouvement);

      if (!missionIds.has(movementMissionId)) return false;

      const quantity = getMovementQuantity(mouvement);

      return quantity !== 0 || !Object.prototype.hasOwnProperty.call(mouvement, "quantite");
    });
  };

  const isStockPrepared = (mission, mouvementsStock) => {
    if (!mission) return false;

    if (toBoolean(mission.stock_prepare, false)) return true;

    if (["pret", "en_cours", "termine", "terminee", "cloture", "cloturee"].includes(normalizeStatus(mission.statut))) {
      return true;
    }

    return hasInitialStockMovement(mission, mouvementsStock);
  };

  const getDayTransactions = (journeeId, transactions) => {
    if (!journeeId) return [];

    const remoteTransactions = transactions
      .filter(isValidStatus)
      .filter((transaction) => String(transaction.journee_id || "") === String(journeeId));

    const legacyPendingTransactions = getUnmatchedLegacyPendingTransactions(transactions)
      .filter((transaction) => String(transaction.journee_id || "") === String(journeeId));

    const byId = new Map();

    [...remoteTransactions, ...legacyPendingTransactions].forEach((transaction, index) => {
      const id = getTransactionId(transaction) || `LOCAL_${index}`;
      byId.set(id, transaction);
    });

    return [...byId.values()];
  };

  const getTransactionAmount = (transaction) =>
    toNumber(
      transaction.total_encaisse_ttc ??
      transaction.total_encaisse ??
      transaction.total_catalogue_ttc ??
      transaction.total_catalogue,
      0
    );

  const getRevenueForTransactions = (transactions) =>
    transactions.reduce((sum, transaction) => sum + getTransactionAmount(transaction), 0);

  const getEventById = (eventId, events) => {
    const id = String(eventId || "").trim();

    return (
      events.find((eventItem) => getEventId(eventItem) === id) ||
      null
    );
  };

  const getDayReadableTitle = (journee, events) => {
    if (!journee) return "Aucune journée";

    const eventItem = getEventById(getDayEventId(journee), events);

    if (!eventItem) {
      return journee.jour_label || "Journée";
    }

    if (eventItem.date_debut === eventItem.date_fin) {
      return eventItem.nom;
    }

    return `${eventItem.nom} — ${journee.jour_label || "Journée"}`;
  };

  const buildHomeState = () => {
    const data = state.data;

    const inscriptions = data.inscriptions;
    const events = data.events.filter((eventItem) => !isHistoricalEvent(eventItem));
    const stockMissions = data.stockMissions.filter(isStockMissionUsefulForHome);
    const journees = data.journees.filter((journee) => !isHistoricalDay(journee));
    const transactions = data.transactions;
    const mouvementsStock = data.mouvementsStock;

    const activeIds = getActiveIds();

    let mission = activeIds.stockMissionId
      ? stockMissions.find((item) => {
          return (
            getStockMissionId(item) === activeIds.stockMissionId ||
            getStockMissionEventId(item) === activeIds.stockMissionId
          );
        }) || null
      : null;

    if (!mission) {
      mission = findFallbackActiveMission(stockMissions);
    }

    let journee = null;

    if (mission) {
      journee = activeIds.journeeId
        ? journees.find((item) => getDayId(item) === activeIds.journeeId) || null
        : null;

      if (!journee) {
        journee = getFirstOpenDay(mission.mission_id, journees);
      }
    }

    const linkedDays = mission ? getMissionJournees(mission.mission_id, journees) : [];
    const dayTransactions = getDayTransactions(journee?.journee_id || "", transactions);
    const revenue = getRevenueForTransactions(dayTransactions);
    const stockPrepared = isStockPrepared(mission, mouvementsStock);

    const legacyPendingTransactions = getUnmatchedLegacyPendingTransactions(transactions);

    state.legacyPendingTransactionsCount = legacyPendingTransactions.length;

    const totalPendingSync =
      toNumber(state.pendingWritesCount, 0) +
      toNumber(state.legacyPendingTransactionsCount, 0);

    return {
      user: CURRENT_USER,
      dataSource: state.dataSource,
      loadError: state.loadError,

      apiMode: state.apiMode,
      apiFetchedAt: state.apiFetchedAt,
      apiGeneratedAt: state.apiGeneratedAt,
      apiDurationMs: state.apiDurationMs,

      cacheSavedAt: state.cacheSavedAt,
      rawCounts: state.rawCounts,

      inscriptions,
      activeInscriptions: getCleanInscriptions(inscriptions),
      acceptedInscriptions: getAcceptedInscriptions(inscriptions),

      events,
      stockMissions,
      journees,
      mouvementsStock,
      linkedDays,
      mission,
      journee,
      stockPrepared,
      dayTransactions,

      pending: {
        official: toNumber(state.pendingWritesCount, 0),
        legacy_transactions: toNumber(state.legacyPendingTransactionsCount, 0),
        total: totalPendingSync
      },

      filteredCounts: {
        events: events.length,
        stockMissions: stockMissions.length,
        journees: journees.length,
        mouvementsStock: mouvementsStock.length
      },

      resume: {
        ca_jour_ttc: revenue,
        nb_transactions: dayTransactions.length,
        ventes_en_attente_sync: legacyPendingTransactions.length,
        total_pending_sync: totalPendingSync
      }
    };
  };

  const getUiState = (homeState) => {
    const { mission, journee, stockPrepared } = homeState;

    if (!mission || !journee) {
      return {
        code: "no_mission",
        step: "inscriptions",
        label: "Aucune mission active",
        title: "Commencer par les inscriptions",
        meta: "Crée ou valide un évènement, puis prépare une mission de stock.",
        primaryText: "Gérer les inscriptions",
        primaryHref: "./inscriptions-evenements.html",
        secondaryText: "Préparation mission",
        secondaryHref: "./missions.html"
      };
    }

    if (!stockPrepared || normalizeStatus(mission.statut) === "stock_a_preparer") {
      return {
        code: "stock_to_prepare",
        step: "stock",
        label: "Stock à préparer",
        title: mission.nom || "Mission de stock",
        meta: `${getDateLabel(mission)} · ${homeState.linkedDays.length || 1} journée(s) liée(s)`,
        primaryText: "Préparer le stock",
        primaryHref: "./preparation-stock.html",
        secondaryText: "Préparation mission",
        secondaryHref: "./missions.html"
      };
    }

    if (isClosedStatus(journee)) {
      return {
        code: "closed",
        step: "cloture",
        label: "Journée clôturée",
        title: getDayReadableTitle(journee, homeState.events),
        meta: `${mission.nom || "Mission"} · ${formatDisplayDate(journee.date)}`,
        primaryText: "Voir le dashboard",
        primaryHref: "./dashboard.html",
        secondaryText: "Préparation mission",
        secondaryHref: "./missions.html"
      };
    }

    return {
      code: "selling",
      step: "vente",
      label: normalizeStatus(journee.statut) === "en_cours" ? "Journée en cours" : "Stock prêt",
      title: getDayReadableTitle(journee, homeState.events),
      meta: `${mission.nom || "Mission"} · ${formatDisplayDate(journee.date)}`,
      primaryText: "+ Nouvelle vente",
      primaryHref: "./vente-rapide.html",
      secondaryText: "Clôturer la journée",
      secondaryHref: "./cloture.html"
    };
  };

  const setText = (selector, value) => {
    const el = qs(selector);
    if (el) el.textContent = value;
  };

  const setLink = (selector, text, href) => {
    const el = qs(selector);
    if (!el) return;

    el.textContent = text;
    el.href = href;
  };

  const renderLoading = () => {
    setText("#currentUserName", CURRENT_USER.nom);
    setText("#activeStatusLabel", "Chargement");
    setText("#missionTitle", "Chargement…");
    setText("#missionMeta", "Lecture des données.");

    setText("#statOneLabel", "Inscriptions");
    setText("#todayRevenue", "…");

    setText("#statTwoLabel", "Acceptées");
    setText("#todayTickets", "…");

    setText("#statThreeLabel", "Préparation mission");
    setText("#pendingSync", "…");

    setLink("#primaryAction", "Gérer les inscriptions", "./inscriptions-evenements.html");
    setLink("#secondaryAction", "Préparation mission", "./missions.html");

    renderWorkflow({
      step: "inscriptions"
    });

    renderWatchList(["Chargement des données…"]);
  };

  const renderStats = (homeState, uiState) => {
    const syncCard = qs("#syncStatCard");

    syncCard?.classList.remove("hasWarning");

    if (uiState.code === "no_mission") {
      setText("#statOneLabel", "Inscriptions");
      setText("#todayRevenue", String(homeState.activeInscriptions.length));

      setText("#statTwoLabel", "Acceptées");
      setText("#todayTickets", String(homeState.acceptedInscriptions.length));

      setText("#statThreeLabel", "Préparation mission");
      setText("#pendingSync", String(homeState.stockMissions.length));

      return;
    }

    if (uiState.code === "stock_to_prepare") {
      setText("#statOneLabel", "Journées");
      setText("#todayRevenue", String(homeState.linkedDays.length || 1));

      setText("#statTwoLabel", "Stock");
      setText("#todayTickets", homeState.stockPrepared ? "OK" : "À faire");

      setText("#statThreeLabel", "À synchro");
      setText("#pendingSync", String(homeState.pending.total || 0));

      syncCard?.classList.toggle(
        "hasWarning",
        Number(homeState.pending.total || 0) > 0
      );

      return;
    }

    setText("#statOneLabel", "CA jour");
    setText("#todayRevenue", formatEuro.format(Number(homeState.resume.ca_jour_ttc || 0)));

    setText("#statTwoLabel", "Tickets");
    setText("#todayTickets", String(homeState.resume.nb_transactions || 0));

    setText("#statThreeLabel", "À synchro");
    setText("#pendingSync", String(homeState.pending.total || 0));

    syncCard?.classList.toggle(
      "hasWarning",
      Number(homeState.pending.total || 0) > 0
    );
  };

  const renderHero = (homeState, uiState) => {
    const statusHero = qs("#statusHero");
    const liveDot = qs("#liveDot");

    statusHero?.classList.remove(
      "isNoMission",
      "isStockToPrepare",
      "isSelling",
      "isClosed"
    );

    liveDot?.classList.remove(
      "isNoMission",
      "isStockToPrepare",
      "isSelling",
      "isClosed"
    );

    const stateClass = {
      no_mission: "isNoMission",
      stock_to_prepare: "isStockToPrepare",
      selling: "isSelling",
      closed: "isClosed"
    }[uiState.code];

    if (stateClass) {
      statusHero?.classList.add(stateClass);
      liveDot?.classList.add(stateClass);
    }

    setText("#currentUserName", homeState.user.nom || "Utilisateur");
    setText("#activeStatusLabel", uiState.label);
    setText("#missionTitle", uiState.title);
    setText("#missionMeta", uiState.meta);

    renderStats(homeState, uiState);

    setLink("#primaryAction", uiState.primaryText, uiState.primaryHref);
    setLink("#secondaryAction", uiState.secondaryText, uiState.secondaryHref);
  };

  const renderWorkflow = (uiState) => {
    const currentIndex = STEP_ORDER.indexOf(uiState.step);

    document.querySelectorAll("[data-step]").forEach((card) => {
      const step = card.dataset.step;
      const index = STEP_ORDER.indexOf(step);

      card.classList.remove("isDone", "isActive", "isUpcoming");

      if (currentIndex < 0) {
        card.classList.add("isUpcoming");
        return;
      }

      if (index < currentIndex) {
        card.classList.add("isDone");
      } else if (index === currentIndex) {
        card.classList.add("isActive");
      } else {
        card.classList.add("isUpcoming");
      }
    });
  };

  const buildWatchItems = (homeState, uiState) => {
    const items = [];

    if (homeState.dataSource === "remote") {
      const fetched = homeState.apiFetchedAt
        ? ` à ${formatShortDateTime(homeState.apiFetchedAt)}`
        : "";

      const duration =
        homeState.apiDurationMs !== null && homeState.apiDurationMs !== undefined
          ? ` · ${homeState.apiDurationMs} ms API`
          : "";

      items.push(`Source active confirmée : API en ligne${fetched} (${homeState.apiMode || "API"}${duration}).`);
    }

    if (homeState.dataSource === "cache") {
      const cacheInfo = homeState.cacheSavedAt
        ? ` Cache du ${formatShortDateTime(homeState.cacheSavedAt)}.`
        : "";

      items.push(`Source active : cache local.${cacheInfo} ${homeState.loadError || ""}`.trim());
    }

    items.push(
      `Brut Sheets : ${homeState.rawCounts.inscriptions} inscription(s), ${homeState.rawCounts.events} évènement(s), ${homeState.rawCounts.stockMissions} mission(s) stock, ${homeState.rawCounts.journees} journée(s), ${homeState.rawCounts.mouvementsStock} mouvement(s) stock.`
    );

    items.push(
      `Après filtres accueil : ${homeState.activeInscriptions.length} inscription(s), ${homeState.acceptedInscriptions.length} acceptée(s), ${homeState.filteredCounts.stockMissions} mission(s) stock utile(s), ${homeState.filteredCounts.journees} journée(s).`
    );

    if (homeState.dataSource === "remote" && homeState.apiMode === "getHomeData") {
      items.push("Mode accueil rapide : seules les données utiles à l’accueil sont chargées.");
    }

    if (!homeState.mission || !homeState.journee) {
      if (homeState.stockMissions.length > 0) {
        items.push(`${homeState.stockMissions.length} mission(s) de stock utile(s) trouvée(s), mais aucune journée active associée.`);
      } else {
        items.push("Aucune mission de stock active détectée pour l’accueil.");
      }

      if (homeState.rawCounts.stockMissions > 0 && homeState.stockMissions.length === 0) {
        items.push("Des missions existent dans Sheets, mais elles sont probablement historiques, annulées ou clôturées anciennes.");
      }

      if (homeState.pending.total > 0) {
        items.push(
          `Synchronisation locale : ${homeState.pending.official} écriture(s) API et ${homeState.pending.legacy_transactions} ancienne(s) transaction(s) locale(s).`
        );
      } else {
        items.push("Aucune écriture en attente de synchronisation locale.");
      }

      return items;
    }

    items.push(
      `${homeState.linkedDays.length || 1} journée(s) liée(s) à la mission “${homeState.mission.nom}”.`
    );

    if (uiState.code === "stock_to_prepare") {
      items.push("Le stock initial n’est pas encore validé pour cette mission.");
    }

    if (homeState.stockPrepared) {
      items.push("Stock initial considéré comme préparé.");
    }

    if (uiState.code === "selling") {
      items.push("La vente rapide est disponible pour la journée active.");
    }

    if (homeState.pending.total > 0) {
      if (homeState.pending.official > 0 && homeState.pending.legacy_transactions > 0) {
        items.push(
          `${homeState.pending.total} écriture(s) en attente : ${homeState.pending.official} via file API, ${homeState.pending.legacy_transactions} ancienne(s) transaction(s) locale(s).`
        );
      } else if (homeState.pending.official > 0) {
        items.push(`${homeState.pending.official} écriture(s) API en attente de synchronisation.`);
      } else {
        items.push(`${homeState.pending.legacy_transactions} ancienne(s) transaction(s) locale(s) non retrouvée(s) dans Sheets.`);
      }
    } else {
      items.push("Aucune écriture en attente de synchronisation locale.");
    }

    if (uiState.code !== "closed") {
      items.push("Pense à saisir les frais avant la clôture si besoin.");
    } else {
      items.push("La journée active semble clôturée.");
    }

    return items;
  };

  const shouldShowDiagnosticSyncLink = () => {
    const params = new URLSearchParams(window.location.search);
    const debugParam = params.get("debug");

    return (
      debugParam === "sync" ||
      debugParam === "1" ||
      safeLocalGet(STORAGE_KEYS.showDiagnosticSync) === "1"
    );
  };

  const ensureDiagnosticSyncLinkStyle = () => {
    if (document.getElementById("lugdurumDiagnosticSyncLinkStyle")) return;

    const style = document.createElement("style");
    style.id = "lugdurumDiagnosticSyncLinkStyle";
    style.textContent = `
      .diagnosticSyncLink {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        margin-top: 14px;
        border: 1px solid rgba(179, 92, 58, 0.22);
        border-radius: var(--radius-md);
        padding: 14px 16px;
        color: var(--text);
        text-decoration: none;
        background:
          linear-gradient(
            145deg,
            rgba(255, 250, 241, 0.9),
            rgba(245, 231, 208, 0.58)
          );
        box-shadow: 0 8px 18px rgba(75, 48, 22, 0.06);
      }

      .diagnosticSyncLink:active {
        transform: scale(0.985);
      }

      .diagnosticSyncLinkIcon {
        width: 42px;
        height: 42px;
        display: inline-grid;
        place-items: center;
        flex: 0 0 auto;
        border-radius: 16px;
        background: rgba(179, 92, 58, 0.12);
        font-size: 1.25rem;
      }

      .diagnosticSyncLinkText {
        min-width: 0;
        display: grid;
        gap: 3px;
        flex: 1;
      }

      .diagnosticSyncLinkText strong {
        color: var(--text);
        font-size: 1rem;
        font-weight: 950;
        line-height: 1.1;
        letter-spacing: -0.025em;
      }

      .diagnosticSyncLinkText span {
        color: var(--muted);
        font-size: 0.84rem;
        font-weight: 800;
        line-height: 1.25;
      }

      .diagnosticSyncLinkArrow {
        color: var(--rum);
        font-size: 1.35rem;
        font-weight: 950;
      }
    `;

    document.head.appendChild(style);
  };

  const renderDiagnosticSyncLink = () => {
    const list = qs("#watchList");
    if (!list) return;

    const parent = list.parentElement;
    if (!parent) return;

    parent.querySelector("#diagnosticSyncLink")?.remove();

    if (!shouldShowDiagnosticSyncLink()) return;

    ensureDiagnosticSyncLinkStyle();

    const link = document.createElement("a");
    link.id = "diagnosticSyncLink";
    link.className = "diagnosticSyncLink";
    link.href = "./diagnostic-sync.html";
    link.innerHTML = `
      <span class="diagnosticSyncLinkIcon" aria-hidden="true">🛠️</span>
      <span class="diagnosticSyncLinkText">
        <strong>Diagnostic sync</strong>
        <span>Vérifier les données locales, la file d’attente et les anciennes transactions.</span>
      </span>
      <span class="diagnosticSyncLinkArrow" aria-hidden="true">→</span>
    `;

    parent.appendChild(link);
  };

  const renderWatchList = (items) => {
    const list = qs("#watchList");

    if (!list) return;

    list.innerHTML = "";

    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });

    renderDiagnosticSyncLink();
  };

  const renderHome = () => {
    refreshPendingCounts();

    const homeState = buildHomeState();
    const uiState = getUiState(homeState);

    renderHero(homeState, uiState);
    renderWorkflow(uiState);
    renderWatchList(buildWatchItems(homeState, uiState));
  };

  const renderFromHomeCacheIfAvailable = () => {
    try {
      const cachedData = loadHomeCacheData();

      if (!cachedData) return false;

      state.data = cachedData;
      state.dataSource = "cache";
      state.loadError = "";
      refreshPendingCounts();

      setDataState(
        "local",
        state.cacheSavedAt
          ? `Données locales · cache du ${formatShortDateTime(state.cacheSavedAt)}`
          : "Données locales · cache accueil"
      );

      renderHome();

      return true;
    } catch (error) {
      console.warn("Cache accueil inutilisable.", error);
      return false;
    }
  };

  const initHome = async () => {
    const cacheRendered = renderFromHomeCacheIfAvailable();

    if (!cacheRendered) {
      renderLoading();
    }

    setDataState(
      "refreshing",
      cacheRendered
        ? "Actualisation · vérification en ligne"
        : "Actualisation · lecture en ligne"
    );

    try {
      state.data = await loadRemoteData();
      state.dataSource = "remote";
      state.loadError = "";
      refreshPendingCounts();

      const onlineLabel = state.apiFetchedAt
        ? `Données en ligne · ${formatShortDateTime(state.apiFetchedAt)}`
        : "Données en ligne";

      setDataState("online", onlineLabel);

      renderHome();
    } catch (error) {
      if (!cacheRendered) {
        state.data = loadCacheData();
      }

      state.dataSource = "cache";
      state.loadError = error.message || "Lecture API impossible.";
      state.apiMode = state.apiMode || "cache";
      refreshPendingCounts();

      setDataState("local", "Données locales · actualisation impossible");

      renderHome();
    }
  };

  window.addEventListener("lugdurum:sync-status", (event) => {
    const detail = event.detail || {};

    state.pendingWritesCount = toNumber(
      detail.pending_count,
      getPendingWritesCount()
    );

    state.legacyPendingTransactionsCount = toNumber(
      detail.legacy_pending_transactions_count,
      getUnmatchedLegacyPendingTransactions(state.data.transactions).length
    );

    if (state.dataSource !== "loading") {
      renderHome();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initHome);
  } else {
    initHome();
  }
})();