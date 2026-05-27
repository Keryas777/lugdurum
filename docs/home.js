(() => {
  "use strict";

  /*
    Accueil V21 — sélecteur d’évènements + parcours par évènement

    - Affiche un sélecteur d’évènements à venir entre le header et la tuile récap.
    - Le défaut est calculé côté Apps Script :
      1) prochain évènement lié à l’utilisateur connecté ;
      2) sinon prochain évènement global.
    - Le dernier évènement sélectionné n’est pas utilisé comme défaut durable.
    - La sélection est temporaire : URL + état mémoire de la page.
    - getHomeData reçoit user_id, selected_type et selected_id.
    - Compatible avec le nouveau getHomeData :
      upcomingItems, selectedItem, selectedSummary, progress, nextAction.
    - Compatible avec l’ancien getHomeData :
      active/ui/resume/data.
    - Fallback conservé :
      getCoreData(), getters séparés, cache accueil, anciens caches locaux.
    - File d’attente officielle : lugdurum_pending_writes.
    - Legacy transactions : lugdurum_pending_transactions.
    - Corrige l’affichage des statuts bruts :
      DOSSIER_A_ENVOYER -> Dossier à envoyer, etc.
    - Corrige les tuiles récap :
      labels toujours affichés, valeurs fallback si getHomeData renvoie "-", "—" ou rien.
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

  const INSCRIPTION_STATUS_LABELS = {
    A_CONTACTER: "À contacter",
    DOSSIER_A_ENVOYER: "Dossier à envoyer",
    EN_ATTENTE_REPONSE: "En attente",
    A_RELANCER: "À relancer",
    LISTE_ATTENTE: "Liste d’attente",
    ACCEPTE: "Accepté",
    ACCEPTEE: "Acceptée",
    REFUSE: "Refusé",
    ANNULE: "Annulé"
  };

  const PAYMENT_STATUS_LABELS = {
    A_ENVOYER: "À envoyer",
    ENVOYE: "Envoyé",
    ENCAISSE: "Encaissé"
  };

  const formatEuro = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });

  const formatLongDate = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

  const formatShortDate = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short"
  });

  const state = {
    dataSource: "loading",
    loadError: "",
    pendingWritesCount: 0,
    legacyPendingTransactionsCount: 0,

    selected: {
      type: "",
      id: ""
    },

    apiMode: "",
    apiFetchedAt: "",
    apiGeneratedAt: "",
    apiDurationMs: null,

    cacheSavedAt: "",
    lastHomePayload: null,

    remoteTransactionIds: null,
    remoteTransactionIndexComplete: false,

    runtime: {
      upcomingItems: [],
      selectedItem: null,
      selectedSummary: null,
      progress: [],
      nextAction: null,
      ui: null,
      watchItems: [],
      active: null,
      resume: null
    },

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

  const toArray = (value) => (Array.isArray(value) ? value : []);

  const toObject = (value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;

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

  const normalizeKey = (value) =>
    normalizeText(value)
      .replace(/[-\s]+/g, "_")
      .replace(/[^a-z0-9_]/g, "");

  const normalizeCode = (value) =>
    String(value ?? "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const normalizeStatus = (value) => normalizeText(value);

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const isPlaceholderValue = (value) => {
    if (value === undefined || value === null) return true;

    const text = String(value).trim();

    return text === "" || text === "—" || text === "-" || text === "_";
  };

  const pickFirst = (source, keys = []) => {
    if (!source || typeof source !== "object") return undefined;

    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) {
        return source[key];
      }
    }

    return undefined;
  };

  const getInscriptionStatusLabel = (itemOrValue) => {
    const rawValue =
      typeof itemOrValue === "object"
        ? String(itemOrValue?.statut || "").trim()
        : String(itemOrValue || "").trim();

    const key = normalizeCode(rawValue);

    if (INSCRIPTION_STATUS_LABELS[key]) {
      return INSCRIPTION_STATUS_LABELS[key];
    }

    if (typeof itemOrValue === "object") {
      const explicit =
        itemOrValue?.status_label ||
        itemOrValue?.statut_label ||
        itemOrValue?.acceptation_label ||
        itemOrValue?.label_statut ||
        "";

      if (!isPlaceholderValue(explicit)) {
        return String(explicit).trim();
      }
    }

    return rawValue || "Dossier";
  };

  const getPaymentStatusValue = (item) => {
    const key = normalizeCode(item?.paiement_statut || "");

    if (PAYMENT_STATUS_LABELS[key]) {
      return key;
    }

    return "A_ENVOYER";
  };

  const getPaymentStatusLabel = (itemOrValue) => {
    const rawValue =
      typeof itemOrValue === "object"
        ? String(itemOrValue?.paiement_statut || "").trim()
        : String(itemOrValue || "").trim();

    const key = normalizeCode(rawValue);

    if (PAYMENT_STATUS_LABELS[key]) {
      return PAYMENT_STATUS_LABELS[key];
    }

    if (typeof itemOrValue === "object") {
      const explicit = String(itemOrValue?.paiement_statut_label || "").trim();

      if (!isPlaceholderValue(explicit)) {
        return explicit;
      }
    }

    return PAYMENT_STATUS_LABELS.A_ENVOYER;
  };

  const getReadableStatusLabel = (value, item = null) => {
    const type = item ? getSelectedItemType(item) || getUpcomingItemType(item) : "";
    const key = normalizeCode(value);

    if (type === "inscription" && INSCRIPTION_STATUS_LABELS[key]) {
      return INSCRIPTION_STATUS_LABELS[key];
    }

    if (INSCRIPTION_STATUS_LABELS[key]) {
      return INSCRIPTION_STATUS_LABELS[key];
    }

    if (PAYMENT_STATUS_LABELS[key]) {
      return PAYMENT_STATUS_LABELS[key];
    }

    if (key === "STOCK_A_PREPARER") return "Stock à préparer";
    if (key === "PRET") return "Stock prêt";
    if (key === "EN_COURS") return "En cours";
    if (key === "PREVU") return "Prévu";
    if (key === "CLOTURE" || key === "CLOTUREE") return "Clôturé";
    if (key === "MISSION_A_PREPARER") return "Mission à préparer";

    if (!isPlaceholderValue(value)) {
      return String(value).trim();
    }

    if (item) {
      return getUpcomingItemStatusLabel(item);
    }

    return "À suivre";
  };

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
    return formatLongDate.format(date);
  };

  const formatEventDateBadge = (item) => {
    const date = parseDate(item?.date_debut || item?.date || "");
    if (!date) return "—";

    const label = formatShortDate.format(date).replace(".", "");
    return label.replace(" ", "\n");
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

  const getInscriptionId = (inscription) =>
    String(inscription?.inscription_id || "").trim();

  const getStockMissionId = (mission) =>
    String(mission?.mission_id || "").trim();

  const getStockMissionEventId = (mission) =>
    String(mission?.evenement_id || mission?.event_id || "").trim();

  const getDayId = (journee) =>
    String(journee?.journee_id || "").trim();

  const getDayEventId = (journee) =>
    String(journee?.evenement_id || journee?.mission_id || "").trim();

  const getDayStockMissionId = (journee) =>
    String(journee?.stock_mission_id || journee?.mission_stock_id || "").trim();

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
    const stockMissionId = getDayStockMissionId(journee);

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

  const isAcceptedInscription = (item) => {
    if (isCancelledStatus(item)) return false;

    const statut = normalizeStatus(item?.statut);

    return (
      statut === "accepte" ||
      statut === "acceptee" ||
      statut === "accepté" ||
      statut === "acceptée" ||
      toBoolean(item?.acceptation, false)
    );
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

  const getUrlParams = () => {
    try {
      return new URLSearchParams(window.location.search || "");
    } catch {
      return new URLSearchParams();
    }
  };

  const inferSelectedTypeFromId = (id) => {
    const value = String(id || "").trim().toUpperCase();

    if (value.startsWith("INS_")) return "inscription";
    if (value.startsWith("EVT_")) return "mission";
    if (value.startsWith("MIS_")) return "mission";
    if (value.startsWith("MST_")) return "stock";

    return "";
  };

  const readSelectionFromUrl = () => {
    const params = getUrlParams();

    const selectedId =
      params.get("selected_id") ||
      params.get("selectedId") ||
      params.get("item_id") ||
      params.get("itemId") ||
      params.get("event_id") ||
      params.get("evenement_id") ||
      params.get("mission_vente_id") ||
      params.get("inscription_id") ||
      "";

    const selectedType =
      params.get("selected_type") ||
      params.get("selectedType") ||
      params.get("item_type") ||
      params.get("itemType") ||
      (params.get("inscription_id") ? "inscription" : "") ||
      inferSelectedTypeFromId(selectedId) ||
      "";

    return {
      type: String(selectedType || "").trim(),
      id: String(selectedId || "").trim()
    };
  };

  const setSelectionInUrl = (type, id) => {
    const safeType = String(type || "").trim();
    const safeId = String(id || "").trim();

    const url = new URL(window.location.href);

    [
      "selected_type",
      "selected_id",
      "selectedType",
      "selectedId",
      "item_type",
      "item_id",
      "event_id",
      "evenement_id",
      "mission_vente_id",
      "inscription_id",
      "stock_mission_id",
      "journee_id"
    ].forEach((key) => url.searchParams.delete(key));

    if (safeType && safeId) {
      url.searchParams.set("selected_type", safeType);
      url.searchParams.set("selected_id", safeId);
    }

    window.history.replaceState({}, "", url.toString());
  };

  const getCurrentSelection = () => {
    const urlSelection = readSelectionFromUrl();

    if (urlSelection.id) {
      state.selected = urlSelection;
      return urlSelection;
    }

    return state.selected;
  };

  const setCurrentSelection = (type, id) => {
    state.selected = {
      type: String(type || "").trim(),
      id: String(id || "").trim()
    };

    setSelectionInUrl(state.selected.type, state.selected.id);

    return state.selected;
  };

  const buildSelectedParams = () => {
    const selected = getCurrentSelection();

    return {
      today: todayIso(),
      user_id: CURRENT_USER.user_id,
      current_user_id: CURRENT_USER.user_id,
      selected_type: selected.type,
      selected_id: selected.id
    };
  };

  const appendContextToHref = (href, homeState = null) => {
    const selected =
      homeState?.selected ||
      getCurrentSelection();

    const safeHref = String(href || "./index.html");

    let url;

    try {
      url = new URL(safeHref, window.location.href);
    } catch {
      return safeHref;
    }

    if (selected?.type && selected?.id) {
      url.searchParams.set("selected_type", selected.type);
      url.searchParams.set("selected_id", selected.id);
    }

    if (homeState?.mission) {
      url.searchParams.set("stock_mission_id", getStockMissionId(homeState.mission));
    }

    if (homeState?.journee) {
      url.searchParams.set("journee_id", getDayId(homeState.journee));
    }

    return `${url.pathname.split("/").pop()}${url.search}${url.hash}`;
  };

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

  const pickObject = (source, keys = []) => {
    if (!source || typeof source !== "object") return null;

    for (const key of keys) {
      const value = toObject(source[key]);
      if (value) return value;
    }

    return null;
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

  const normalizeRuntime = (runtime = {}) => ({
    upcomingItems: toArray(runtime.upcomingItems),
    selectedItem: toObject(runtime.selectedItem),
    selectedSummary: toObject(runtime.selectedSummary),
    progress: toArray(runtime.progress),
    nextAction: toObject(runtime.nextAction),
    ui: toObject(runtime.ui),
    watchItems: toArray(runtime.watchItems),
    active: toObject(runtime.active),
    resume: toObject(runtime.resume)
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

    const runtime = normalizeRuntime({
      upcomingItems: [
        ...pickArray(envelope, ["upcomingItems", "upcoming_items", "items", "eventItems", "event_items"]),
        ...pickArray(active, ["upcomingItems", "upcoming_items", "items"])
      ],
      selectedItem:
        pickObject(envelope, ["selectedItem", "selected_item", "currentItem", "current_item"]) ||
        pickObject(active, ["selectedItem", "selected_item", "currentItem", "current_item"]),
      selectedSummary:
        pickObject(envelope, ["selectedSummary", "selected_summary", "summary"]) ||
        pickObject(active, ["selectedSummary", "selected_summary", "summary"]),
      progress: [
        ...pickArray(envelope, ["progress", "steps", "workflow"]),
        ...pickArray(active, ["progress", "steps", "workflow"])
      ],
      nextAction:
        pickObject(envelope, ["nextAction", "next_action"]) ||
        pickObject(active, ["nextAction", "next_action"]),
      ui:
        pickObject(envelope, ["ui", "uiState", "ui_state"]) ||
        pickObject(active, ["ui", "uiState", "ui_state"]),
      watchItems: [
        ...pickArray(envelope, ["watchItems", "watch_items"]),
        ...pickArray(active, ["watchItems", "watch_items"])
      ],
      active,
      resume:
        pickObject(envelope, ["resume"]) ||
        pickObject(active, ["resume"])
    });

    const indexComplete =
      envelope.transaction_ids_complete === true ||
      envelope.transactionIdsComplete === true ||
      envelope.all_transaction_ids_complete === true ||
      envelope.allTransactionIdsComplete === true ||
      envelope.remote_transaction_index_complete === true ||
      envelope.remoteTransactionIndexComplete === true ||
      active.transaction_ids_complete === true ||
      active.remote_transaction_index_complete === true;

    const selectedFromPayload =
      runtime.selectedItem
        ? {
            type:
              runtime.selectedItem.selected_type ||
              runtime.selectedItem.type ||
              runtime.selectedItem.item_type ||
              "",
            id:
              runtime.selectedItem.selected_id ||
              runtime.selectedItem.id ||
              runtime.selectedItem.item_id ||
              runtime.selectedItem.mission_id ||
              runtime.selectedItem.inscription_id ||
              ""
          }
        : {
            type: envelope.selected_type || envelope.selectedType || "",
            id: envelope.selected_id || envelope.selectedId || ""
          };

    return {
      data,
      rawCounts,
      transactionIds,
      transactionIndexComplete: indexComplete,
      runtime,
      selectedFromPayload,
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

    const payload = await api().getHomeData(buildSelectedParams());
    const normalized = normalizeHomeDataPayload(payload);

    state.remoteTransactionIds =
      normalized.transactionIds.length > 0
        ? new Set(normalized.transactionIds)
        : null;

    state.remoteTransactionIndexComplete = normalized.transactionIndexComplete;
    state.lastHomePayload = normalized.homePayload;
    state.runtime = normalized.runtime;

    if (normalized.selectedFromPayload?.id) {
      state.selected = {
        type:
          normalized.selectedFromPayload.type ||
          inferSelectedTypeFromId(normalized.selectedFromPayload.id),
        id: normalized.selectedFromPayload.id
      };

      setSelectionInUrl(state.selected.type, state.selected.id);
    }

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
    state.runtime = normalizeRuntime({});

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
    state.runtime = normalizeRuntime({});

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
    state.runtime = normalized.runtime;

    if (normalized.selectedFromPayload?.id && !getCurrentSelection().id) {
      state.selected = {
        type:
          normalized.selectedFromPayload.type ||
          inferSelectedTypeFromId(normalized.selectedFromPayload.id),
        id: normalized.selectedFromPayload.id
      };
    }

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

    state.runtime = normalizeRuntime({});

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

  const getMissionJournees = (mission, journees) => {
    const stockMissionId = typeof mission === "string" ? mission : getStockMissionId(mission);
    const eventId = typeof mission === "string" ? "" : getStockMissionEventId(mission);

    return journees
      .filter((journee) => !isHistoricalDay(journee))
      .filter((journee) => !isCancelledStatus(journee))
      .filter((journee) => {
        return (
          String(journee.mission_id || "") === stockMissionId ||
          String(journee.stock_mission_id || "") === stockMissionId ||
          String(journee.mission_stock_id || "") === stockMissionId ||
          String(journee.evenement_id || "") === stockMissionId ||
          (eventId && String(journee.evenement_id || "") === eventId) ||
          (eventId && String(journee.mission_id || "") === eventId)
        );
      })
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  };

  const getFirstOpenDay = (mission, journees) => {
    const linkedDays = getMissionJournees(mission, journees);

    return (
      linkedDays.find((journee) => !isClosedStatus(journee) && !isCancelledStatus(journee)) ||
      linkedDays[0] ||
      null
    );
  };

  const findFallbackActiveStockMission = (stockMissions) => {
    const candidates = stockMissions
      .filter((mission) => {
        if (!isStockMissionUsefulForHome(mission)) return false;
        if (isClosedStatus(mission)) return false;
        return true;
      })
      .sort((a, b) => {
        const byDate = String(a.date_debut || "").localeCompare(String(b.date_debut || ""));
        if (byDate !== 0) return byDate;

        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });

    return candidates[0] || null;
  };

  const findStockMissionForEvent = (eventId, stockMissions) => {
    const id = String(eventId || "").trim();

    if (!id) return null;

    return (
      stockMissions.find((mission) => getStockMissionId(mission) === id) ||
      stockMissions.find((mission) => getStockMissionEventId(mission) === id) ||
      null
    );
  };

  const getSelectedItemId = (item) =>
    String(
      item?.selected_id ||
      item?.item_id ||
      item?.id ||
      item?.mission_id ||
      item?.evenement_id ||
      item?.inscription_id ||
      ""
    ).trim();

  const getSelectedItemType = (item) =>
    normalizeKey(
      item?.selected_type ||
      item?.item_type ||
      item?.type ||
      inferSelectedTypeFromId(getSelectedItemId(item))
    );

  const findEventForSelectedItem = (selectedItem, events) => {
    const type = getSelectedItemType(selectedItem);
    const id = getSelectedItemId(selectedItem);

    if (type === "mission" || type === "event" || type === "evenement") {
      return events.find((eventItem) => getEventId(eventItem) === id) || null;
    }

    const eventId =
      selectedItem?.evenement_id ||
      selectedItem?.event_id ||
      selectedItem?.mission_id ||
      "";

    if (eventId) {
      return events.find((eventItem) => getEventId(eventItem) === eventId) || null;
    }

    return null;
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

  const getCleanInscriptions = (inscriptions) =>
    inscriptions.filter((item) => !isCancelledStatus(item));

  const getAcceptedInscriptions = (inscriptions) =>
    inscriptions.filter(isAcceptedInscription);

  const getUpcomingItemId = (item) => getSelectedItemId(item);

  const getUpcomingItemType = (item) => getSelectedItemType(item) || "mission";

  const getUpcomingItemTitle = (item) =>
    String(item?.nom || item?.title || item?.label || item?.name || "Évènement").trim();

  const getUpcomingItemCity = (item) =>
    String(item?.ville || item?.city || "").trim();

  const getUpcomingItemStatusLabel = (item) => {
    const explicit =
      item?.status_label ||
      item?.statut_label ||
      item?.acceptation_label ||
      item?.label_statut ||
      "";

    if (!isPlaceholderValue(explicit)) {
      return getReadableStatusLabel(explicit, item);
    }

    const type = getUpcomingItemType(item);
    const statut = normalizeStatus(item?.statut || item?.acceptation || "");

    if (type === "inscription") {
      if (isAcceptedInscription(item)) return "Accepté";
      return getInscriptionStatusLabel(item);
    }

    if (isClosedStatus(item)) return "Clôturé";

    if (statut === "stock_a_preparer") return "Stock à préparer";
    if (statut === "pret") return "Stock prêt";
    if (statut === "en_cours") return "En cours";
    if (statut === "prevu") return "Prévu";

    return "Évènement";
  };

  const getUpcomingItemTone = (item) => {
    const type = getUpcomingItemType(item);
    const statut = normalizeStatus(item?.statut || item?.acceptation || "");

    if (isClosedStatus(item)) return "closed";
    if (type === "inscription" && !isAcceptedInscription(item)) return "pending";
    if (statut === "stock_a_preparer") return "pending";
    if (statut === "pret" || statut === "en_cours") return "ready";

    return "accepted";
  };

  const buildFallbackUpcomingItems = (data) => {
    const acceptedEventIds = new Set(
      data.events
        .map(getEventId)
        .filter(Boolean)
    );

    const missionItems = data.events
      .filter((eventItem) => !isHistoricalEvent(eventItem))
      .filter((eventItem) => !isCancelledStatus(eventItem))
      .filter(isUpcomingOrCurrent)
      .map((eventItem) => {
        const eventId = getEventId(eventItem);
        const stockMission = findStockMissionForEvent(eventId, data.stockMissions);

        return {
          ...eventItem,
          selected_type: "mission",
          selected_id: eventId,
          item_type: "mission",
          item_id: eventId,
          type: "mission",
          stock_mission_id: stockMission ? getStockMissionId(stockMission) : "",
          statut:
            stockMission?.statut ||
            eventItem.statut ||
            "",
          status_label: stockMission
            ? getUpcomingItemStatusLabel(stockMission)
            : "Mission à préparer"
        };
      });

    const inscriptionItems = data.inscriptions
      .filter((item) => !isCancelledStatus(item))
      .filter((item) => !isAcceptedInscription(item))
      .filter(isUpcomingOrCurrent)
      .filter((item) => {
        const linkedEventId = String(item.evenement_id || "").trim();
        return !linkedEventId || !acceptedEventIds.has(linkedEventId);
      })
      .map((item) => ({
        ...item,
        selected_type: "inscription",
        selected_id: getInscriptionId(item),
        item_type: "inscription",
        item_id: getInscriptionId(item),
        type: "inscription",
        status_label: getUpcomingItemStatusLabel({
          ...item,
          type: "inscription"
        })
      }));

    return [...missionItems, ...inscriptionItems]
      .filter((item) => getUpcomingItemId(item))
      .sort((a, b) => {
        const byDate = String(a.date_debut || "").localeCompare(String(b.date_debut || ""));
        if (byDate !== 0) return byDate;

        return getUpcomingItemTitle(a).localeCompare(getUpcomingItemTitle(b), "fr");
      });
  };

  const resolveSelectedItem = (data, upcomingItems) => {
    const runtimeSelected = state.runtime.selectedItem;

    if (runtimeSelected && getSelectedItemId(runtimeSelected)) {
      return runtimeSelected;
    }

    const selected = getCurrentSelection();

    if (selected.id) {
      return (
        upcomingItems.find((item) => {
          return (
            getUpcomingItemId(item) === selected.id &&
            (!selected.type || getUpcomingItemType(item) === normalizeKey(selected.type))
          );
        }) ||
        upcomingItems.find((item) => getUpcomingItemId(item) === selected.id) ||
        null
      );
    }

    return upcomingItems[0] || null;
  };

  const getSelectedContextFromItem = (selectedItem) => {
    if (!selectedItem) {
      return {
        type: "",
        id: ""
      };
    }

    return {
      type: getSelectedItemType(selectedItem),
      id: getSelectedItemId(selectedItem)
    };
  };

  const normalizeStep = (step) => {
    const value = normalizeKey(step);

    if (value === "mission" || value === "preparation_mission" || value === "missions_vente") {
      return "missions";
    }

    if (value === "preparation_stock" || value === "stock_preparation") {
      return "stock";
    }

    if (value === "journee" || value === "journee_vente" || value === "vente_rapide" || value === "sales") {
      return "vente";
    }

    if (value === "clotures" || value === "cloture_journee") {
      return "cloture";
    }

    return value || "inscriptions";
  };

  const buildFallbackProgress = (uiState) => {
    const currentStep = normalizeStep(uiState?.step || "inscriptions");
    const currentIndex = STEP_ORDER.indexOf(currentStep);

    return STEP_ORDER.map((step, index) => {
      let status = "upcoming";

      if (currentIndex >= 0 && index < currentIndex) {
        status = "done";
      } else if (currentIndex >= 0 && index === currentIndex) {
        status = "active";
      }

      return {
        step,
        status
      };
    });
  };

  const normalizeProgress = (progress, uiState) => {
    const rows = toArray(progress);

    if (rows.length === 0) {
      return buildFallbackProgress(uiState);
    }

    const byStep = new Map();

    rows.forEach((row) => {
      const step = normalizeStep(row.step || row.key || row.code || row.id);
      if (!step) return;

      byStep.set(step, {
        step,
        status: normalizeKey(row.status || row.state || row.etat || ""),
        raw: row
      });
    });

    return STEP_ORDER.map((step) => {
      const found = byStep.get(step);

      if (!found) {
        return {
          step,
          status: "upcoming"
        };
      }

      const status = found.status;

      return {
        step,
        status:
          status === "done" ||
          status === "complete" ||
          status === "completed" ||
          status === "ok" ||
          status === "termine" ||
          status === "terminee"
            ? "done"
            : status === "active" ||
                status === "current" ||
                status === "en_cours" ||
                status === "todo" ||
                status === "a_faire"
              ? "active"
              : "upcoming",
        raw: found.raw
      };
    });
  };

  const buildSelectedSummaryFallback = (homeState) => {
    const { selectedItem, mission, journee, linkedDays, stockPrepared, dayTransactions } = homeState;

    if (!selectedItem) {
      return null;
    }

    const type = getSelectedItemType(selectedItem);

    if (type === "inscription") {
      return {
        statOneLabel: "Dossier",
        statOneValue: getInscriptionStatusLabel(selectedItem),
        statTwoLabel: "Paiement",
        statTwoValue: getPaymentStatusLabel(selectedItem),
        statThreeLabel: "À synchro",
        statThreeValue: String(homeState.pending.total || 0)
      };
    }

    if (mission && (!stockPrepared || normalizeStatus(mission.statut) === "stock_a_preparer")) {
      return {
        statOneLabel: "Journées",
        statOneValue: String(linkedDays.length || 1),
        statTwoLabel: "Stock",
        statTwoValue: stockPrepared ? "Prêt" : "À faire",
        statThreeLabel: "À synchro",
        statThreeValue: String(homeState.pending.total || 0)
      };
    }

    if (mission && journee) {
      return {
        statOneLabel: "CA jour",
        statOneValue: formatEuro.format(Number(homeState.resume.ca_jour_ttc || 0)),
        statTwoLabel: "Tickets",
        statTwoValue: String(dayTransactions.length || 0),
        statThreeLabel: "À synchro",
        statThreeValue: String(homeState.pending.total || 0)
      };
    }

    return {
      statOneLabel: "Journées",
      statOneValue: String(linkedDays.length || 0),
      statTwoLabel: "Mission",
      statTwoValue: "À préparer",
      statThreeLabel: "À synchro",
      statThreeValue: String(homeState.pending.total || 0)
    };
  };

  const getMergedSelectedSummary = (homeState) => {
    const fallback = buildSelectedSummaryFallback(homeState);
    const server = state.runtime.selectedSummary;

    if (!fallback) return null;
    if (!server || typeof server !== "object") return fallback;

    const label1 = pickFirst(server, ["statOneLabel", "one_label", "label_1", "stat_one_label", "stat1_label"]);
    const value1 = pickFirst(server, ["statOneValue", "one_value", "value_1", "stat_one_value", "stat1_value"]);

    const label2 = pickFirst(server, ["statTwoLabel", "two_label", "label_2", "stat_two_label", "stat2_label"]);
    const value2 = pickFirst(server, ["statTwoValue", "two_value", "value_2", "stat_two_value", "stat2_value"]);

    const label3 = pickFirst(server, ["statThreeLabel", "three_label", "label_3", "stat_three_label", "stat3_label"]);
    const value3 = pickFirst(server, ["statThreeValue", "three_value", "value_3", "stat_three_value", "stat3_value"]);

    return {
      statOneLabel: isPlaceholderValue(label1) ? fallback.statOneLabel : String(label1),
      statOneValue: isPlaceholderValue(value1) ? fallback.statOneValue : String(value1),
      statTwoLabel: isPlaceholderValue(label2) ? fallback.statTwoLabel : String(label2),
      statTwoValue: isPlaceholderValue(value2) ? fallback.statTwoValue : String(value2),
      statThreeLabel: isPlaceholderValue(label3) ? fallback.statThreeLabel : String(label3),
      statThreeValue: isPlaceholderValue(value3) ? fallback.statThreeValue : String(value3)
    };
  };

  const buildHomeState = () => {
    const data = {
      inscriptions: state.data.inscriptions,
      events: state.data.events.filter((eventItem) => !isHistoricalEvent(eventItem)),
      stockMissions: state.data.stockMissions.filter(isStockMissionUsefulForHome),
      journees: state.data.journees
        .filter((journee) => !isHistoricalDay(journee))
        .filter((journee) => !isCancelledStatus(journee)),
      transactions: state.data.transactions,
      mouvementsStock: state.data.mouvementsStock
    };

    const runtimeItems = state.runtime.upcomingItems.length > 0
      ? state.runtime.upcomingItems
      : buildFallbackUpcomingItems(data);

    const upcomingItems = runtimeItems
      .filter((item) => getUpcomingItemId(item))
      .sort((a, b) => {
        const byDate = String(a.date_debut || "").localeCompare(String(b.date_debut || ""));
        if (byDate !== 0) return byDate;

        return getUpcomingItemTitle(a).localeCompare(getUpcomingItemTitle(b), "fr");
      });

    let selectedItem = resolveSelectedItem(data, upcomingItems);

    if (!selectedItem && upcomingItems.length > 0) {
      selectedItem = upcomingItems[0];
    }

    const selected = getSelectedContextFromItem(selectedItem);

    if (selected.id && (!state.selected.id || state.selected.id !== selected.id)) {
      state.selected = selected;
    }

    const selectedEvent = selectedItem
      ? findEventForSelectedItem(selectedItem, data.events)
      : null;

    let mission = null;

    if (state.runtime.active?.mission) {
      mission = state.runtime.active.mission;
    }

    if (!mission && state.runtime.active?.stockMission) {
      mission = state.runtime.active.stockMission;
    }

    if (!mission && state.runtime.active?.stock_mission) {
      mission = state.runtime.active.stock_mission;
    }

    if (!mission && selectedItem) {
      const itemType = getSelectedItemType(selectedItem);
      const itemId = getSelectedItemId(selectedItem);

      if (itemType === "stock") {
        mission = data.stockMissions.find((item) => getStockMissionId(item) === itemId) || null;
      } else if (itemType === "mission" || itemType === "event" || itemType === "evenement") {
        mission = findStockMissionForEvent(itemId, data.stockMissions);
      }

      if (!mission && selectedEvent) {
        mission = findStockMissionForEvent(getEventId(selectedEvent), data.stockMissions);
      }

      if (!mission && selectedItem.stock_mission_id) {
        mission =
          data.stockMissions.find((item) => getStockMissionId(item) === String(selectedItem.stock_mission_id || "")) ||
          null;
      }
    }

    if (!mission && !selectedItem) {
      mission = findFallbackActiveStockMission(data.stockMissions);
    }

    let journee = null;

    if (state.runtime.active?.journee) {
      journee = state.runtime.active.journee;
    }

    if (!journee && state.runtime.active?.activeJournee) {
      journee = state.runtime.active.activeJournee;
    }

    if (!journee && mission) {
      journee = getFirstOpenDay(mission, data.journees);
    }

    const linkedDays = mission ? getMissionJournees(mission, data.journees) : [];
    const dayTransactions = getDayTransactions(journee?.journee_id || "", data.transactions);
    const revenue = getRevenueForTransactions(dayTransactions);
    const stockPrepared = isStockPrepared(mission, data.mouvementsStock);

    const legacyPendingTransactions = getUnmatchedLegacyPendingTransactions(data.transactions);
    state.legacyPendingTransactionsCount = legacyPendingTransactions.length;

    const totalPendingSync =
      toNumber(state.pendingWritesCount, 0) +
      toNumber(state.legacyPendingTransactionsCount, 0);

    const resume = {
      ca_jour_ttc: toNumber(state.runtime.resume?.ca_jour_ttc, revenue),
      nb_transactions: toNumber(state.runtime.resume?.nb_transactions, dayTransactions.length),
      ventes_en_attente_sync: legacyPendingTransactions.length,
      total_pending_sync: totalPendingSync
    };

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

      selected,
      selectedItem,
      selectedEvent,
      upcomingItems,

      inscriptions: data.inscriptions,
      activeInscriptions: getCleanInscriptions(data.inscriptions),
      acceptedInscriptions: getAcceptedInscriptions(data.inscriptions),

      events: data.events,
      stockMissions: data.stockMissions,
      journees: data.journees,
      mouvementsStock: data.mouvementsStock,
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
        events: data.events.length,
        stockMissions: data.stockMissions.length,
        journees: data.journees.length,
        mouvementsStock: data.mouvementsStock.length
      },

      resume
    };
  };

  const getUiState = (homeState) => {
    const serverUi = state.runtime.ui;

    if (serverUi && (serverUi.title || serverUi.code || serverUi.step)) {
      return {
        code: serverUi.code || "selected",
        step: normalizeStep(serverUi.step || serverUi.current_step || "inscriptions"),
        label: getReadableStatusLabel(
          serverUi.label || serverUi.status_label || "Évènement sélectionné",
          homeState.selectedItem
        ),
        title: serverUi.title || getUpcomingItemTitle(homeState.selectedItem),
        meta: serverUi.meta || serverUi.subtitle || "",
        primaryText: serverUi.primaryText || serverUi.primary_text || state.runtime.nextAction?.label || "Continuer",
        primaryHref: serverUi.primaryHref || serverUi.primary_href || state.runtime.nextAction?.href || "./missions.html",
        secondaryText: serverUi.secondaryText || serverUi.secondary_text || "Préparation mission",
        secondaryHref: serverUi.secondaryHref || serverUi.secondary_href || "./missions.html"
      };
    }

    const { selectedItem, selectedEvent, mission, journee, stockPrepared } = homeState;

    if (selectedItem && getSelectedItemType(selectedItem) === "inscription") {
      return {
        code: "event_planning",
        step: "inscriptions",
        label: getUpcomingItemStatusLabel(selectedItem),
        title: getUpcomingItemTitle(selectedItem),
        meta: `${getDateLabel(selectedItem)}${getUpcomingItemCity(selectedItem) ? ` · ${getUpcomingItemCity(selectedItem)}` : ""}`,
        primaryText: "Suivre l’inscription",
        primaryHref: "./inscriptions-evenements.html",
        secondaryText: "Voir les dossiers",
        secondaryHref: "./inscriptions-evenements.html"
      };
    }

    if (selectedItem && !mission) {
      return {
        code: "mission_to_prepare",
        step: "missions",
        label: "Mission à préparer",
        title: getUpcomingItemTitle(selectedEvent || selectedItem),
        meta: `${getDateLabel(selectedEvent || selectedItem)}${getUpcomingItemCity(selectedEvent || selectedItem) ? ` · ${getUpcomingItemCity(selectedEvent || selectedItem)}` : ""}`,
        primaryText: "Préparation mission",
        primaryHref: "./missions.html",
        secondaryText: "Voir les inscriptions",
        secondaryHref: "./inscriptions-evenements.html"
      };
    }

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
        title: mission.nom || getUpcomingItemTitle(selectedEvent || selectedItem) || "Mission de stock",
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

  const getHeroClassForCode = (code) => {
    const normalized = normalizeKey(code);

    if (normalized === "stock_to_prepare") return "isStockToPrepare";
    if (normalized === "mission_to_prepare") return "isMissionToPrepare";
    if (normalized === "selling") return "isSelling";
    if (normalized === "closed" || normalized === "cloture" || normalized === "cloturee") return "isClosed";
    if (normalized === "event_planning" || normalized === "inscription" || normalized === "inscription_pending") return "isEventPlanning";

    return "isNoMission";
  };

  const setText = (selector, value) => {
    const el = qs(selector);
    if (el) el.textContent = value;
  };

  const setLink = (selector, text, href, homeState = null) => {
    const el = qs(selector);
    if (!el) return;

    el.textContent = text;
    el.href = appendContextToHref(href, homeState);
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

    renderEventSelectorLoading();
    renderWorkflow({ step: "inscriptions" }, []);
    renderWatchList(["Chargement des données…"]);
  };

  const renderEventSelectorLoading = () => {
    const list = qs("#eventSelectorList");
    if (!list) return;

    setText("#eventSelectorCount", "—");
    setText("#eventSelectorHint", "Lecture des évènements à venir.");

    list.innerHTML = `
      <article class="eventOption isSkeleton" aria-hidden="true">
        <span class="eventOptionDate">—</span>
        <span class="eventOptionMain">
          <strong>Chargement…</strong>
          <small>Lecture des évènements.</small>
        </span>
      </article>
    `;
  };

  const buildEventOptionClass = (item, selected) => {
    const classes = ["eventOption"];
    const tone = getUpcomingItemTone(item);

    if (selected?.id && getUpcomingItemId(item) === selected.id) {
      classes.push("isSelected");
    }

    if (tone === "pending") {
      classes.push("isPending");
    } else if (tone === "ready") {
      classes.push("isReady");
    } else if (tone === "closed") {
      classes.push("isClosed");
    } else {
      classes.push("isAccepted");
    }

    return classes.join(" ");
  };

  const renderEventSelector = (homeState) => {
    const list = qs("#eventSelectorList");
    if (!list) return;

    const items = homeState.upcomingItems;
    const selected = homeState.selected;

    setText(
      "#eventSelectorCount",
      items.length > 0
        ? `${items.length} à venir`
        : "Aucun"
    );

    setText(
      "#eventSelectorHint",
      selected?.id
        ? "Le choix est temporaire : au prochain chargement sans sélection, l’accueil reprend le prochain évènement prioritaire."
        : "L’accueil se cale par défaut sur le prochain évènement lié à l’utilisateur connecté."
    );

    list.innerHTML = "";

    if (items.length === 0) {
      const empty = document.createElement("article");
      empty.className = "eventOption isSkeleton";
      empty.innerHTML = `
        <span class="eventOptionDate">—</span>
        <span class="eventOptionMain">
          <strong>Aucun évènement à venir</strong>
          <small>Ajoute ou valide un dossier depuis les inscriptions.</small>
        </span>
      `;
      list.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const type = getUpcomingItemType(item);
      const id = getUpcomingItemId(item);
      const title = getUpcomingItemTitle(item);
      const city = getUpcomingItemCity(item);
      const statusLabel = getUpcomingItemStatusLabel(item);
      const tone = getUpcomingItemTone(item);

      const button = document.createElement("button");
      button.type = "button";
      button.className = buildEventOptionClass(item, selected);
      button.dataset.selectedType = type;
      button.dataset.selectedId = id;
      button.setAttribute("role", "listitem");
      button.setAttribute("aria-pressed", selected?.id === id ? "true" : "false");

      const statusClass =
        tone === "pending"
          ? "isAmber"
          : tone === "closed"
            ? ""
            : "isGreen";

      button.innerHTML = `
        <span class="eventOptionDate">${formatEventDateBadge(item)}</span>
        <span class="eventOptionMain">
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml([getDateLabel(item), city].filter(Boolean).join(" · "))}</small>
          <span class="eventOptionMeta">
            <span class="eventChip ${statusClass}">${escapeHtml(statusLabel)}</span>
          </span>
        </span>
      `;

      button.addEventListener("click", () => {
        handleSelectEvent(type, id);
      });

      list.appendChild(button);
    });
  };

  const renderStats = (homeState, uiState) => {
    const syncCard = qs("#syncStatCard");
    syncCard?.classList.remove("hasWarning");

    const summary = getMergedSelectedSummary(homeState);

    if (summary) {
      setText("#statOneLabel", summary.statOneLabel);
      setText("#todayRevenue", summary.statOneValue);

      setText("#statTwoLabel", summary.statTwoLabel);
      setText("#todayTickets", summary.statTwoValue);

      setText("#statThreeLabel", summary.statThreeLabel);
      setText("#pendingSync", summary.statThreeValue);

      syncCard?.classList.toggle(
        "hasWarning",
        Number(homeState.pending.total || 0) > 0
      );

      return;
    }

    if (uiState.code === "no_mission") {
      setText("#statOneLabel", "Inscriptions");
      setText("#todayRevenue", String(homeState.activeInscriptions.length));

      setText("#statTwoLabel", "Acceptées");
      setText("#todayTickets", String(homeState.acceptedInscriptions.length));

      setText("#statThreeLabel", "Préparation mission");
      setText("#pendingSync", String(homeState.stockMissions.length));

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
      "isEventPlanning",
      "isMissionToPrepare",
      "isStockToPrepare",
      "isSelling",
      "isClosed"
    );

    liveDot?.classList.remove(
      "isNoMission",
      "isEventPlanning",
      "isMissionToPrepare",
      "isStockToPrepare",
      "isSelling",
      "isClosed"
    );

    const stateClass = getHeroClassForCode(uiState.code);

    statusHero?.classList.add(stateClass);
    liveDot?.classList.add(stateClass);

    setText("#currentUserName", homeState.user.nom || "Utilisateur");
    setText("#activeStatusLabel", uiState.label);
    setText("#missionTitle", uiState.title);
    setText("#missionMeta", uiState.meta);

    renderStats(homeState, uiState);

    setLink("#primaryAction", uiState.primaryText, uiState.primaryHref, homeState);
    setLink("#secondaryAction", uiState.secondaryText, uiState.secondaryHref, homeState);
  };

  const renderWorkflow = (uiState, progress = []) => {
    const normalizedProgress = normalizeProgress(progress, uiState);
    const statusByStep = new Map(
      normalizedProgress.map((item) => [normalizeStep(item.step), item.status])
    );

    document.querySelectorAll("[data-step]").forEach((card) => {
      const step = normalizeStep(card.dataset.step);
      const status = statusByStep.get(step) || "upcoming";

      card.classList.remove("isDone", "isActive", "isUpcoming");

      if (status === "done") {
        card.classList.add("isDone");
      } else if (status === "active") {
        card.classList.add("isActive");
      } else {
        card.classList.add("isUpcoming");
      }
    });
  };

  const buildWatchItems = (homeState, uiState) => {
    const serverWatch = state.runtime.watchItems
      .map((item) => String(item || "").trim())
      .filter(Boolean);

    if (serverWatch.length > 0) {
      return serverWatch;
    }

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

    if (homeState.selectedItem) {
      items.push(`Évènement sélectionné : ${getUpcomingItemTitle(homeState.selectedItem)}.`);
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
      if (homeState.selectedItem && getSelectedItemType(homeState.selectedItem) === "inscription") {
        items.push("Le dossier n’est pas encore transformé en évènement confirmé / mission de vente.");
      } else if (homeState.selectedItem && !homeState.mission) {
        items.push("L’évènement est confirmé, mais aucune mission de stock associée n’est encore détectée.");
      } else if (homeState.stockMissions.length > 0) {
        items.push(`${homeState.stockMissions.length} mission(s) de stock utile(s) trouvée(s), mais aucune journée active associée.`);
      } else {
        items.push("Aucune mission de stock active détectée pour l’accueil.");
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
    const progress = normalizeProgress(state.runtime.progress, uiState);

    renderEventSelector(homeState);
    renderHero(homeState, uiState);
    renderWorkflow(uiState, progress);
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

  const refreshHomeFromRemote = async () => {
    setDataState("refreshing", "Actualisation · évènement sélectionné");

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
      state.loadError = error.message || "Lecture API impossible.";
      refreshPendingCounts();

      setDataState("local", "Données locales · actualisation impossible");
      renderHome();
    }
  };

  const handleSelectEvent = (type, id) => {
    const safeType = String(type || "").trim();
    const safeId = String(id || "").trim();

    if (!safeId) return;

    setCurrentSelection(safeType || inferSelectedTypeFromId(safeId), safeId);
    refreshHomeFromRemote();
  };

  const initHome = async () => {
    state.selected = readSelectionFromUrl();

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

  window.addEventListener("popstate", () => {
    state.selected = readSelectionFromUrl();

    if (state.dataSource !== "loading") {
      refreshHomeFromRemote();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initHome);
  } else {
    initHome();
  }
})();