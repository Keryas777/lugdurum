(() => {
  "use strict";

  /* Accueil vendeur : une seule source de contexte, la journée ouverte affectée. */

  // La sélection du vendeur est locale à chaque appareil.
  // Aucun utilisateur n'est attribué automatiquement lors d'un premier accès.
  const initialUser = window.LugdurumUsers?.getCurrent() || null;
  const CURRENT_USER = {
    user_id: initialUser?.user_id || "",
    nom: initialUser?.nom || "Choisir vendeur",
    role: initialUser?.role || "",
    capabilities: Array.isArray(initialUser?.capabilities) ? initialUser.capabilities : []
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
    homeRequestId: 0,
    pendingWritesCount: 0,
    legacyPendingTransactionsCount: 0,

    selectedDayId: "",
    forceSelectedDay: false,
    manualSelectionThisSession: false,

    apiMode: "",
    apiFetchedAt: "",
    apiGeneratedAt: "",
    apiDurationMs: null,

    cacheSavedAt: "",
    lastHomePayload: null,

    remoteTransactionIds: null,
    remoteTransactionIndexComplete: false,

    runtime: {
      active: null,
      resume: null,
      workContext: null
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

  const normalizeStatus = (value) => normalizeText(value);

  const normalizeKey = (value) =>
    normalizeText(value)
      .replace(/[-\s]+/g, "_")
      .replace(/[^a-z0-9_]/g, "");

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

  const getStockMissionId = (mission) =>
    String(mission?.mission_id || "").trim();

  const getDayId = (journee) =>
    String(journee?.journee_id || "").trim();

  const getDayEventId = (journee) =>
    String(journee?.mission_id || journee?.evenement_id || journee?.mission_vente_id || "").trim();

  const getDayStockMissionId = (journee) =>
    String(journee?.stock_mission_id || journee?.mission_stock_id || "").trim();

  const getWeekdayKey = (isoDate) => {
    const date = String(isoDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
    const weekday = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris", weekday: "long"
    }).format(new Date(`${date}T12:00:00Z`));
    return normalizeKey(weekday);
  };

  const getDayNumber = (journee) => {
    const match = String(journee?.jour_label || "").match(/\bJ\s*(\d+)\b/i);
    return match ? Number(match[1]) : 0;
  };

  const getDayNoteSchedule = (note, kind) => {
    const text = String(note || "");
    const label = kind === "setup"
      ? "(?:mise\\s+en\\s+place|installation)"
      : "(?:ouverture\\s+au\\s+public|horaires?\\s+(?:d['’]\\s*)?ouverture)";
    const marker = new RegExp(`(?:^|[\\s·])(${label})\\s*:\\s*`, "i");
    const match = marker.exec(text);
    if (!match) return "";
    const start = match.index + match[0].length;
    const rest = text.slice(start);
    const nextField = /\s+(?:ouverture\s+au\s+public|horaires?\s+(?:d['’]\s*)?ouverture|mise\s+en\s+place|installation)\s*:/i.exec(rest);
    return rest.slice(0, nextField ? nextField.index : rest.length).trim();
  };

  const resolveHoursForDay = (value, journee, isMultiDay) => {
    const text = String(value || "").trim();
    if (!text) return "";
    const markerPattern = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|J\s*([1-9]\d*))\b/gi;
    const markers = [...text.matchAll(markerPattern)];
    if (!markers.length) return isMultiDay ? "" : text;

    const dayIndex = getDayNumber(journee);
    const weekday = getWeekdayKey(journee?.date);
    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index];
      const markerText = normalizeKey(marker[1]);
      const markerIndex = marker[2] ? Number(marker[2]) : 0;
      const matchesDay = markerIndex
        ? markerIndex === dayIndex
        : markerText === weekday;
      if (!matchesDay) continue;

      const start = marker.index + marker[0].length;
      const end = index + 1 < markers.length ? markers[index + 1].index : text.length;
      const segment = text.slice(start, end)
        .replace(/^[\s:·–—-]+/, "")
        .replace(/[\s|,;]+$/, "")
        .trim();
      if (segment) return segment;
    }
    return "";
  };

  const getDayHours = (homeState, kind) => {
    const day = homeState.journee;
    const event = homeState.event || {};
    const eventIsMultiDay = Boolean(
      (event.date_debut && event.date_fin && event.date_debut !== event.date_fin) ||
      (homeState.linkedDays || []).length > 1
    );
    const noteValue = getDayNoteSchedule(day?.note, kind);
    const eventValue = kind === "setup" ? event.mise_en_place : event.horaires;
    const resolved = resolveHoursForDay(noteValue, day, eventIsMultiDay) ||
      resolveHoursForDay(eventValue, day, eventIsMultiDay);
    return resolved || "Non renseigné";
  };

  const renderPracticalInfo = (homeState) => {
    const container = qs("#missionMeta");
    if (!container) return;
    const day = homeState.journee;
    const event = homeState.event || {};
    const daySelector = qs(".homeDaySelector");
    const assignedDays = homeState.assignedDays || [];
    container.hidden = !day && assignedDays.length === 0;

    const practicalRows = [
      qs("#homeDayDateRow"), qs("#homeAddressLink"), qs("#homeAddressMissingRow"),
      qs("#homeSetupHours")?.closest(".marketPracticalLine"),
      qs("#homePublicHours")?.closest(".marketPracticalLine")
    ].filter(Boolean);
    practicalRows.forEach((row) => { row.hidden = !day; });
    if (daySelector) daySelector.hidden = false;
    if (!day) return;

    const dayDate = qs("#homeDayDate");
    if (dayDate) dayDate.textContent = `${formatDisplayDate(day.date)}${day.jour_label ? ` · ${day.jour_label}` : ""}`;

    const address = String(event.adresse || "").trim();
    const addressParts = [event.adresse, event.ville, event.lieu]
      .map((part) => String(part || "").trim())
      .filter((part, index, all) => part && all.findIndex((item) => normalizeKey(item) === normalizeKey(part)) === index);
    const addressText = addressParts.join(" · ");
    const addressLink = qs("#homeAddressLink");
    const addressMissing = qs("#homeAddressMissingRow");
    if (addressLink && address && addressText) {
      const wazeUrl = window.LugdurumAPI?.buildWazeUrl?.(event) || "";
      addressLink.hidden = !wazeUrl;
      addressLink.href = wazeUrl || "#";
      addressLink.setAttribute("aria-label", `Ouvrir l’itinéraire vers ${addressText} dans Waze`);
      setText("#homeAddressText", addressText);
      if (addressMissing) addressMissing.hidden = Boolean(wazeUrl);
      if (!wazeUrl && addressMissing) {
        setText("#homeAddressMissingText", `Itinéraire indisponible · ${addressText}`);
      }
    } else {
      if (addressLink) {
        addressLink.hidden = true;
        addressLink.removeAttribute("href");
      }
      if (addressMissing) {
        addressMissing.hidden = false;
        setText("#homeAddressMissingText", addressParts.length
          ? `Adresse complète non renseignée · ${addressParts.join(" · ")}`
          : "Adresse · Non renseignée");
      }
    }
    setText("#homeSetupHours", getDayHours(homeState, "setup"));
    setText("#homePublicHours", getDayHours(homeState, "public"));
  };

  const daySelectionKey = (userId = CURRENT_USER.user_id) =>
    `lugdurum_home_selected_journee:${String(userId || "").trim()}`;
  const daySelectionExplicitKey = (userId = CURRENT_USER.user_id) => `${daySelectionKey(userId)}:explicit`;

  const readSelectedDayId = (userId = CURRENT_USER.user_id) => {
    try { return String(localStorage.getItem(daySelectionKey(userId)) || "").trim(); }
    catch { return ""; }
  };

  const saveSelectedDayId = (dayId, userId = CURRENT_USER.user_id) => {
    state.selectedDayId = String(dayId || "").trim();
    try {
      if (state.selectedDayId) localStorage.setItem(daySelectionKey(userId), state.selectedDayId);
      else localStorage.removeItem(daySelectionKey(userId));
    } catch { /* préférence locale non critique */ }
  };

  const readExplicitDaySelection = (userId = CURRENT_USER.user_id) => {
    try { return localStorage.getItem(daySelectionExplicitKey(userId)) === "true"; }
    catch { return false; }
  };

  const saveExplicitDaySelection = (explicit, userId = CURRENT_USER.user_id) => {
    state.forceSelectedDay = Boolean(explicit);
    try {
      if (state.forceSelectedDay) localStorage.setItem(daySelectionExplicitKey(userId), "true");
      else localStorage.removeItem(daySelectionExplicitKey(userId));
    } catch { /* préférence locale non critique */ }
  };

  const hasCapability = (name) => CURRENT_USER.capabilities.includes(name);

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

  const buildSelectedParams = () => {
    const dayContext = window.LugdurumDayContext;
    return {
      today: dayContext?.parisDateIso() || todayIso(),
      user_id: CURRENT_USER.user_id,
      current_user_id: CURRENT_USER.user_id,
      selected_day_id: state.selectedDayId,
      journee_id: state.selectedDayId,
      manual_day_selection: state.manualSelectionThisSession,
      preferred_day_selection: state.forceSelectedDay,
      work_context: true,
      ignore_legacy_context: true
    };
  };

  const appendContextToHref = (href, homeState = null) => {
    const safeHref = String(href || "./index.html");

    let url;

    try {
      url = new URL(safeHref, window.location.href);
    } catch {
      return safeHref;
    }

    ["selected_type", "selected_id", "item_id", "evenement_id", "mission_vente_id", "inscription_id"].forEach((key) =>
      url.searchParams.delete(key));
    const context = homeState?.workContext;
    if (context?.journee_id) url.searchParams.set("journee_id", context.journee_id);
    if (context?.mission_id) {
      url.searchParams.set("mission_id", context.mission_id);
      url.searchParams.set("event_id", context.mission_id);
    }
    if (context?.stock_mission_id) url.searchParams.set("stock_mission_id", context.stock_mission_id);
    if (context?.user_id) url.searchParams.set("user_id", context.user_id);
    if (context?.journee_id && !context.stock_mission_id && url.pathname.endsWith("/missions.html")) {
      url.searchParams.set("auto_select", "1");
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
    active: toObject(runtime.active),
    resume: toObject(runtime.resume),
    workContext: toObject(runtime.workContext || runtime.work_context)
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
      // Les lignes complètes de journees_vente priment sur un ancien contexte active.journee.
      journees: uniqueBy([...extraJournees, ...journees], getDayId),
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
      active,
      resume: pickObject(envelope, ["resume"]) || pickObject(active, ["resume"]),
      workContext: pickObject(envelope, ["work_context", "workContext"]) ||
        pickObject(active, ["work_context", "workContext"])
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



    return {
      data,
      rawCounts,
      transactionIds,
      transactionIndexComplete: indexComplete,
      runtime,
      generatedAt: envelope.generated_at || envelope.generatedAt || "",
      durationMs: toNumber(envelope.duration_ms ?? envelope.durationMs, null),
      apiMode: envelope.api_mode || envelope.apiMode || "getHomeData",
      homePayload: payload
    };
  };

  const loadRemoteDataWithHomeData = async (isCurrent = () => true) => {
    if (!hasApi() || typeof api().getHomeData !== "function") {
      throw new Error("LugdurumAPI.getHomeData() est indisponible.");
    }

    const startedAt = performance.now();
    const payload = await api().getHomeData(buildSelectedParams());
    if (!isCurrent()) return null;
    const networkElapsedMs = Math.round(performance.now() - startedAt);
    console.info("[Lugdurum accueil] getHomeData réseau :", networkElapsedMs, "ms");
    const normalized = normalizeHomeDataPayload(payload);

    state.remoteTransactionIds =
      normalized.transactionIds.length > 0
        ? new Set(normalized.transactionIds)
        : null;

    state.remoteTransactionIndexComplete = normalized.transactionIndexComplete;
    state.lastHomePayload = normalized.homePayload;
    state.runtime = normalized.runtime;

    state.apiMode = normalized.apiMode || "getHomeData";
    state.apiFetchedAt = new Date().toISOString();
    state.apiGeneratedAt = normalized.generatedAt || "";
    state.apiDurationMs = normalized.durationMs;

    const data = normalized.data;
    data.__rawCounts = normalized.rawCounts;

    return data;
  };

  const loadRemoteDataWithCoreData = async (isCurrent = () => true) => {
    if (!hasApi() || typeof api().getCoreData !== "function") {
      throw new Error("LugdurumAPI.getCoreData() est indisponible.");
    }

    const coreData = await api().getCoreData(CORE_TABLES);
    if (!isCurrent()) return null;

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

  const loadRemoteDataWithSeparateCalls = async (isCurrent = () => true) => {
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
    if (!isCurrent()) return null;

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

  const loadRemoteData = async (isCurrent = () => true) => {
    const ready = await waitForApi();

    if (!isCurrent()) return null;
    if (!ready) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    let data;
    let shouldCacheGeneric = false;

    try {
      data = await loadRemoteDataWithHomeData(isCurrent);
      if (!isCurrent()) return null;
      const contextApi = window.LugdurumDayContext;
      const expected = contextApi?.resolveWorkContext({
        days: data.journees,
        events: data.events,
        stockMissions: data.stockMissions,
        userId: CURRENT_USER.user_id,
        selectedDayId: state.selectedDayId,
        today: contextApi.parisDateIso(),
        forceSelection: state.forceSelectedDay,
        manualOverride: state.manualSelectionThisSession
      });
      const active = state.runtime.active || {};
      const serverDay = active.journee || active.activeJournee || active.active_journee || null;
      const serverWorkContext = state.runtime.workContext || active.work_context || active.workContext || null;
      const responseMatches = Boolean(expected?.day && getDayId(serverDay) === getDayId(expected.day) &&
        (!serverWorkContext || (
          String(serverWorkContext.user_id || "").trim() === expected.context.user_id &&
          String(serverWorkContext.journee_id || "").trim() === expected.context.journee_id &&
          String(serverWorkContext.mission_id || "").trim() === expected.context.mission_id &&
          String(serverWorkContext.stock_mission_id || "").trim() === expected.context.stock_mission_id
        )));
      if (expected?.day && !responseMatches) {
        // Compatibilité avec Apps Script non encore aligné : relire les tables
        // complètes pour ne jamais afficher les ventes d'une autre journée.
        data = await loadRemoteDataWithCoreData(isCurrent);
        if (!isCurrent()) return null;
        state.apiMode = "getCoreData · contexte journée vérifié";
        shouldCacheGeneric = true;
      }
    } catch (homeError) {
      try {
        if (!isCurrent()) return null;
        data = await loadRemoteDataWithCoreData(isCurrent);
        if (!isCurrent()) return null;
        state.apiMode = `getCoreData après échec getHomeData : ${homeError.message}`;
        shouldCacheGeneric = true;
      } catch (coreError) {
        try {
          if (!isCurrent()) return null;
          data = await loadRemoteDataWithSeparateCalls(isCurrent);
          if (!isCurrent()) return null;
          state.apiMode = `getters séparés après échec getHomeData/getCoreData : ${homeError.message} · ${coreError.message}`;
          shouldCacheGeneric = true;
        } catch (separateError) {
          throw new Error(
            `getHomeData : ${homeError.message} · getCoreData : ${coreError.message} · getters séparés : ${separateError.message}`
          );
        }
      }
    }

    if (!isCurrent() || !data) return null;
    void window.LugdurumSalesCacheCleanup?.run();
    if (!isCurrent()) return null;
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
    if (!isCurrent()) return null;

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
    const data = {
      inscriptions: state.data.inscriptions,
      events: state.data.events.filter((eventItem) => !isHistoricalEvent(eventItem)),
      stockMissions: state.data.stockMissions.filter(isStockMissionUsefulForHome),
      journees: state.data.journees.filter((journee) => !isHistoricalDay(journee)),
      transactions: state.data.transactions,
      mouvementsStock: state.data.mouvementsStock
    };
    const dayContext = window.LugdurumDayContext;
    const resolved = dayContext?.resolveWorkContext({
      days: data.journees,
      events: data.events,
      stockMissions: data.stockMissions,
      userId: CURRENT_USER.user_id,
      selectedDayId: state.selectedDayId,
      today: dayContext.parisDateIso(),
      forceSelection: state.forceSelectedDay,
      manualOverride: state.manualSelectionThisSession
    }) || {
      day: null, event: null, stockMission: null, linkedDays: [], context: {
        user_id: CURRENT_USER.user_id, journee_id: "", mission_id: "", stock_mission_id: ""
      }, authorizedDays: [], selectableDays: [], schedule: { mode: "empty", days: [] },
      selectionRequired: false, selectedDayWasInvalid: Boolean(state.selectedDayId)
    };

    if (resolved.selectedDayWasInvalid || (state.selectedDayId && !resolved.day)) {
      saveSelectedDayId("");
      saveExplicitDaySelection(false);
      state.manualSelectionThisSession = false;
    } else if (resolved.day) {
      const chosenId = getDayId(resolved.day);
      if (chosenId !== state.selectedDayId) {
        saveSelectedDayId(chosenId);
        if (resolved.schedule.mode === "today" || resolved.schedule.mode === "choose_today") {
          saveExplicitDaySelection(false);
          state.manualSelectionThisSession = false;
        }
      }
    }

    const journee = resolved.day;
    const event = resolved.event;
    const mission = resolved.stockMission;
    const linkedDays = resolved.linkedDays;
    const dayId = getDayId(journee);
    const context = resolved.context;
    const dayTransactions = dayId ? getDayTransactions(dayId, data.transactions) : [];
    const dayRevenue = getRevenueForTransactions(dayTransactions);
    const dayEventIds = new Set(dayId ? [dayId] : []);
    const eventDayIds = new Set(journee ? data.journees
      .filter((day) => getDayEventId(day) === context.mission_id)
      .map(getDayId).filter(Boolean) : []);
    const eventTransactions = eventDayIds.size ? data.transactions
      .filter((transaction) => eventDayIds.has(String(transaction.journee_id || "").trim()))
      .filter(isValidStatus) : [];

    const active = state.runtime.active || {};
    const serverDay = active.journee || active.activeJournee || active.active_journee || null;
    const serverDayId = getDayId(serverDay);
    const runtimeWorkContext = state.runtime.workContext || active.work_context || active.workContext || null;
    const runtimeContextMatches = Boolean(journee && serverDayId === dayId && (
      !runtimeWorkContext || (
        String(runtimeWorkContext.user_id || "").trim() === context.user_id &&
        String(runtimeWorkContext.journee_id || "").trim() === context.journee_id &&
        String(runtimeWorkContext.mission_id || "").trim() === context.mission_id &&
        String(runtimeWorkContext.stock_mission_id || "").trim() === context.stock_mission_id
      )
    ));
    const runtimeDayMatches = Boolean(journee && serverDayId === dayId);
    const serverResume = state.runtime.resume || {};
    const serverDayRevenue = serverResume.ca_jour_ttc;
    const serverEventRevenue = serverResume.ca_evenement_ttc;
    const serverHasDayRevenue = runtimeContextMatches && serverDayRevenue !== null &&
      serverDayRevenue !== undefined && serverDayRevenue !== "" && Number.isFinite(Number(serverDayRevenue));
    const fullClientTransactions = state.apiMode !== "getHomeData";
    const summaryReliable = serverHasDayRevenue || fullClientTransactions;
    const resume = {
      ca_jour_ttc: serverHasDayRevenue ? Number(serverDayRevenue) : fullClientTransactions ? dayRevenue : null,
      nb_transactions: serverHasDayRevenue ? toNumber(serverResume.nb_transactions, dayTransactions.length) :
        fullClientTransactions ? dayTransactions.length : null,
      ca_evenement_ttc: runtimeContextMatches && serverEventRevenue !== null &&
        serverEventRevenue !== undefined && serverEventRevenue !== "" && Number.isFinite(Number(serverEventRevenue))
          ? Number(serverEventRevenue)
          : fullClientTransactions && journee ? getRevenueForTransactions(eventTransactions) : null
    };
    const relevantMovements = context.stock_mission_id
      ? data.mouvementsStock.filter((movement) => getMovementMissionId(movement) === context.stock_mission_id)
      : [];
    const stockPrepared = Boolean(mission && isStockPrepared(mission, relevantMovements));
    const pendingLegacy = getUnmatchedLegacyPendingTransactions(data.transactions)
      .filter((transaction) => !dayId || String(transaction.journee_id || "").trim() === dayId);
    const pendingTotal = toNumber(state.pendingWritesCount, 0) + pendingLegacy.length;
    state.legacyPendingTransactionsCount = getUnmatchedLegacyPendingTransactions(data.transactions).length;

    return {
      user: CURRENT_USER,
      dataSource: state.dataSource,
      loadError: state.loadError,
      apiMode: state.apiMode,
      apiFetchedAt: state.apiFetchedAt,
      apiDurationMs: state.apiDurationMs,
      cacheSavedAt: state.cacheSavedAt,
      rawCounts: state.rawCounts,
      workContext: context,
      contextSelection: resolved,
      selected: context.mission_id ? { type: "mission", id: context.mission_id } : { type: "", id: "" },
      selectedItem: event,
      selectedEvent: event,
      events: data.events,
      stockMissions: data.stockMissions,
      journees: data.journees,
      mouvementsStock: data.mouvementsStock,
      assignedDays: resolved.selectableDays,
      assignedDay: journee,
      journee,
      event,
      mission,
      linkedDays,
      runtimeDayMatches,
      runtimeContextMatches,
      summaryReliable,
      stockPrepared,
      dayTransactions,
      resume,
      pending: {
        official: toNumber(state.pendingWritesCount, 0),
        legacy_transactions: pendingLegacy.length,
        total: pendingTotal
      }
    };
  };

  const getUiState = (homeState) => {
    const day = homeState.journee;
    if (!day) {
      const multipleToday = homeState.contextSelection.selectionRequired &&
        homeState.contextSelection.schedule.mode.includes("today");
      return {
        code: "no_mission",
        step: "missions",
        label: multipleToday ? "Choisis ta journée" : "Aucune journée affectée",
        title: multipleToday ? "Plusieurs journées aujourd’hui" : "Aucune journée de vente",
        meta: multipleToday
          ? "Sélectionne la journée que tu vas gérer sur l’ensemble de l’accueil."
          : "Les journées en attente d’affectation ne font pas partie de ton parcours vendeur.",
        primaryText: "",
        primaryHref: "",
        secondaryText: "",
        secondaryHref: ""
      };
    }

    const event = homeState.event;
    const eventName = event?.nom || event?.name || day.nom || day.jour_label || "Évènement";
    const meta = "";
    const context = homeState.workContext;
    const stockId = context.stock_mission_id;
    const stock = homeState.mission;
    const stockStatus = normalizeStatus(stock?.statut);
    const stockClosed = stockStatus.includes("clotur") || stockStatus.includes("annul");
    const today = window.LugdurumDayContext?.parisDateIso() || todayIso();
    const isToday = String(day.date || "").slice(0, 10) === today;
    const salePermission = window.LugdurumDayContext?.canSell(day, CURRENT_USER.user_id, stock, today) ||
      { allowed: false, reason: "unauthorized" };

    if (!stockId) {
      const canAssociate = hasCapability("manage_missions") || hasCapability("prepare_stock");
      return {
        code: "mission_to_prepare", step: "missions", label: "Mission de stock à associer",
        title: eventName, meta,
        primaryText: canAssociate ? "Associer une mission de stock" : "Mission à associer",
        primaryHref: canAssociate ? "./missions.html" : "",
        secondaryText: "Voir le bilan", secondaryHref: "./dashboard.html"
      };
    }
    if (!stock) {
      return {
        code: "mission_to_prepare", step: "missions", label: "Mission de stock introuvable",
        title: eventName, meta,
        primaryText: "Vérifier la mission", primaryHref: "./missions.html",
        secondaryText: "", secondaryHref: ""
      };
    }
    if (stockClosed) {
      return {
        code: "stock_to_prepare", step: "stock", label: "Mission de stock clôturée",
        title: eventName, meta,
        primaryText: "Vérifier la mission", primaryHref: "./missions.html",
        secondaryText: "Voir la journée", secondaryHref: "./cloture.html"
      };
    }
    if (!homeState.stockPrepared) {
      return {
        code: "stock_to_prepare", step: "stock", label: "Stock à préparer",
        title: eventName, meta,
        primaryText: "Préparer le stock", primaryHref: "./preparation-stock.html",
        secondaryText: "Ajouter des frais", secondaryHref: "./frais.html"
      };
    }
    if (!isToday) {
      return {
        code: "selling", step: "vente", label: "Journée à venir",
        title: eventName, meta,
        primaryText: "Consulter le stock préparé", primaryHref: "./preparation-stock.html",
        secondaryText: "Ajouter des frais", secondaryHref: "./frais.html"
      };
    }
    if (!salePermission.allowed) {
      const labels = {
        unauthorized: "Vendeur non autorisé",
        not_today: "Journée pas encore ouverte",
        stock_missing: "Mission de stock indisponible",
        stock_not_prepared: "Stock non préparé",
        stock_closed: "Mission de stock clôturée"
      };
      return {
        code: "stock_to_prepare", step: "stock", label: "Vente indisponible",
        title: labels[salePermission.reason] || "Vente indisponible", meta,
        primaryText: "Vérifier la préparation", primaryHref: "./preparation-stock.html",
        secondaryText: "Ajouter des frais", secondaryHref: "./frais.html"
      };
    }
    return {
      code: "selling", step: "vente",
      label: "Journée en cours",
      title: eventName, meta,
      primaryText: "Ouvrir les ventes", primaryHref: "./vente-rapide.html",
      secondaryText: "Clôturer la journée", secondaryHref: "./cloture.html"
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
    const enabled = Boolean(text && href);
    el.hidden = !enabled;
    if (!enabled) {
      el.removeAttribute("href");
      el.setAttribute("aria-disabled", "true");
      el.tabIndex = -1;
      return;
    }
    el.removeAttribute("aria-disabled");
    el.tabIndex = 0;
    el.href = appendContextToHref(href, homeState);
  };

  const renderLoading = () => {
    const eventRevenuePanel = qs("#homeEventRevenue");
    if (eventRevenuePanel) eventRevenuePanel.hidden = true;
    setText("#currentUserName", CURRENT_USER.nom);
    setText("#activeStatusLabel", "Journée en cours");
    setText("#missionTitle", "Chargement");
    const progress = qs("#homeDayLoadingProgress");
    if (progress) {
      progress.hidden = false;
      const fill = progress.firstElementChild;
      if (fill) {
        fill.style.animation = "none";
        void fill.offsetWidth;
        fill.style.animation = "";
      }
    }
    const practicalInfo = qs("#missionMeta");
    if (practicalInfo) practicalInfo.hidden = true;
    setText("#statOneLabel", "CA jour");
    setText("#todayRevenue", "…");
    setText("#statTwoLabel", "Ventes");
    setText("#todayTickets", "…");
    setText("#statThreeLabel", "À synchroniser");
    setText("#pendingSync", "…");
    setLink("#primaryAction", "", "");
    setLink("#secondaryAction", "", "");
    renderWorkflow(null, { step: "missions" }, []);
    renderWatchList(["Lecture du contexte vendeur…"]);
  };

  const renderStats = (homeState) => {
    const eventRevenuePanel = qs("#homeEventRevenue");
    const showEventRevenue = Boolean(homeState.workContext.journee_id && homeState.workContext.mission_id);
    if (eventRevenuePanel) eventRevenuePanel.hidden = !showEventRevenue;
    if (showEventRevenue) {
      const amount = homeState.resume.ca_evenement_ttc;
      setText("#homeEventRevenueTotal", amount == null ? "—" : new Intl.NumberFormat("fr-FR", {
        style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2
      }).format(amount));
      setText("#homeEventRevenueStatus", amount == null
        ? "Cumul indisponible pour les données chargées"
        : "Journées rattachées à cet évènement uniquement");
    }

    const syncCard = qs("#syncStatCard");
    syncCard?.classList.toggle("hasWarning", Number(homeState.pending.total || 0) > 0);
    setText("#statOneLabel", "CA jour");
    setText("#todayRevenue", homeState.workContext.journee_id && homeState.summaryReliable && homeState.resume.ca_jour_ttc != null
      ? formatEuro.format(Number(homeState.resume.ca_jour_ttc)) : "—");
    setText("#statTwoLabel", "Tickets");
    setText("#todayTickets", homeState.workContext.journee_id && homeState.summaryReliable && homeState.resume.nb_transactions != null
      ? String(homeState.resume.nb_transactions) : "—");
    setText("#statThreeLabel", "À synchroniser");
    setText("#pendingSync", String(homeState.pending.total || 0));
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
    document.body.classList.toggle(
      "isSimplifiedSeller",
      !hasCapability("manage_inscriptions") &&
      !hasCapability("manage_missions") && !hasCapability("prepare_stock")
    );
    setText("#activeStatusLabel", uiState.label);
    setText("#missionTitle", uiState.title);
    const progress = qs("#homeDayLoadingProgress");
    if (progress) progress.hidden = true;
    renderPracticalInfo(homeState);

    renderStats(homeState);

    setLink("#primaryAction", uiState.primaryText, uiState.primaryHref, homeState);
    setLink("#secondaryAction", uiState.secondaryText, uiState.secondaryHref, homeState);
  };

  const renderWorkflow = (homeState, uiState) => {
    const grid = qs(".workflowGrid");
    if (!grid) return;
    grid.replaceChildren();
    const planning = qs("#generalPlanning");
    const canManagePlanning = ["manage_inscriptions", "manage_missions", "prepare_stock"]
      .some(hasCapability);
    if (planning) planning.hidden = !canManagePlanning;

    if (!homeState?.workContext?.journee_id) {
      const empty = document.createElement("p");
      empty.className = "workflowEmpty";
      empty.textContent = homeState?.contextSelection?.selectionRequired
        ? "Choisis une journée dans la liste pour afficher son parcours."
        : "Ton parcours apparaîtra dès qu’une journée de vente te sera affectée.";
      grid.appendChild(empty);
      return;
    }

    const context = homeState.workContext;
    const stockReady = homeState.stockPrepared;
    const today = window.LugdurumDayContext?.parisDateIso() || todayIso();
    const saleAllowed = window.LugdurumDayContext?.canSell(
      homeState.journee, CURRENT_USER.user_id, homeState.mission, today
    )?.allowed === true;
    let rows;

    if (!context.stock_mission_id || !homeState.mission) {
      const canAssociate = hasCapability("manage_missions") || hasCapability("prepare_stock");
      rows = [
        { step: "missions", title: "Mission de stock", text: canAssociate ? "Associer cette journée à un stock partagé." : "L’association doit être faite par un responsable.", href: canAssociate ? "./missions.html" : "", status: "active" },
        { step: "stock", title: "Préparation du stock", text: context.stock_mission_id && homeState.mission
          ? "Saisir le stock emporté pour cette mission."
          : "Disponible après l’association d’une mission de stock valide.",
          href: context.stock_mission_id && homeState.mission ? "./preparation-stock.html" : "", status: "upcoming" },
        { step: "vente", title: "Ventes", text: "Disponible après l’association et la préparation du stock.", href: "", status: "upcoming" },
        { step: "cloture", title: "Clôture", text: "Disponible après l’ouverture du parcours de vente.", href: "", status: "upcoming" }
      ];
    } else if (!stockReady) {
      rows = [
        { step: "stock", title: "Préparation du stock", text: "Saisir le stock emporté pour cette mission.", href: "./preparation-stock.html", status: "active" },
        { step: "vente", title: "Ventes", text: "Enregistrer les ventes après préparation du stock.", href: "", status: "upcoming" },
        { step: "cloture", title: "Clôture", text: "Disponible après l’ouverture du parcours de vente.", href: "", status: "upcoming" }
      ];
    } else if (!hasCapability("manage_inscriptions") && !hasCapability("manage_missions") && !hasCapability("prepare_stock")) {
      rows = [
        { step: "vente", title: "Ventes", text: "Vente rapide, encaissements, suivi des ventes et frais.", href: "./vente-rapide.html", status: saleAllowed ? "active" : "upcoming" },
        { step: "cloture", title: "Clôture", text: "Vérifier les ventes, les encaissements, les frais et le bilan.", href: "./cloture.html", status: "upcoming" }
      ];
    } else {
      rows = [
        { step: "stock", title: "Préparation du stock", text: `${homeState.linkedDays.length} journée(s) partagent cette mission de stock.`, href: "./preparation-stock.html", status: "done" },
        { step: "vente", title: "Ventes", text: "Enregistrer les ventes de la journée sélectionnée.", href: "./vente-rapide.html", status: saleAllowed ? "active" : "upcoming" },
        { step: "cloture", title: "Clôture", text: "Contrôler la caisse, les frais et le bilan.", href: "./cloture.html", status: "upcoming" }
      ];
    }

    rows.forEach((row, index) => {
      const card = document.createElement("a");
      card.className = "workflowCard";
      card.dataset.step = row.step;
      card.href = row.href ? appendContextToHref(row.href, homeState) : "#";
      if (!row.href) {
        card.removeAttribute("href");
        card.setAttribute("aria-disabled", "true");
        card.tabIndex = -1;
      }
      card.classList.add(row.status === "done" ? "isDone" : row.status === "active" ? "isActive" : "isUpcoming");
      const number = document.createElement("span");
      number.className = "workflowNumber";
      number.textContent = String(index + 1);
      const content = document.createElement("span");
      content.className = "workflowContent";
      const title = document.createElement("strong");
      title.textContent = row.title;
      const detail = document.createElement("small");
      detail.textContent = row.text;
      content.append(title, detail);
      card.append(number, content);
      grid.appendChild(card);
    });
  };

  const buildWatchItems = (homeState, uiState) => {
    const items = [];
    if (homeState.workContext.journee_id) {
      if (!homeState.workContext.stock_mission_id) {
        items.push("Aucune mission de stock n’est associée à cette journée.");
      } else if (!homeState.mission) {
        items.push("La mission de stock associée n’a pas été retrouvée.");
      } else if (!homeState.stockPrepared) {
        items.push("Le stock de cette mission n’est pas encore préparé.");
      }
      items.push(`${homeState.linkedDays.length} journée(s) sont liées à la mission de stock sélectionnée.`);
      if (!homeState.summaryReliable) {
        items.push("Les indicateurs financiers attendent une réponse API correspondant à cette journée.");
      }
    } else if (homeState.contextSelection.selectionRequired) {
      items.push("Plusieurs journées te sont affectées aujourd’hui : choisis celle à afficher.");
    } else {
      items.push("Aucune journée ouverte ne t’est affectée pour le moment.");
    }
    if (homeState.pending.total > 0) {
      items.push(`${homeState.pending.total} écriture(s) locale(s) attendent la synchronisation.`);
    } else {
      items.push("Aucune écriture en attente de synchronisation.");
    }
    if (homeState.dataSource === "local" && homeState.loadError) {
      items.push("Hors ligne : dernière lecture réseau conservée en mémoire.");
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

  const getOpenAuthorizedHomeDays = () => window.LugdurumDayContext?.openAuthorizedDaysFor(
    state.data.journees, CURRENT_USER.user_id
  ) || [];

  const renderDaySelector = (homeState) => {
    const select = qs("#homeDaySelect");
    if (!select) return;
    const days = getOpenAuthorizedHomeDays();
    const currentId = homeState.workContext.journee_id;
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = currentId ? "Choisir une autre journée" :
      homeState.contextSelection.selectionRequired ? "Choisir une journée d’aujourd’hui…" :
      days.length ? "Choisir une journée de vente…" : "Aucune journée affectée";
    select.appendChild(placeholder);

    days.forEach((day) => {
      const event = homeState.events.find((item) => getEventId(item) === getDayEventId(day));
      const dateLabel = new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short"
      }).format(new Date(`${String(day.date).slice(0, 10)}T12:00:00`));
      const eventName = event?.nom || event?.name || day.nom || "Marché";
      const option = document.createElement("option");
      option.value = getDayId(day);
      option.textContent = `${dateLabel} · ${eventName}${day.jour_label ? ` · ${day.jour_label}` : ""}`;
      select.appendChild(option);
    });

    select.disabled = days.length === 0;
    // La journée courante est déjà lisible dans le bloc principal ; ce contrôle
    // sert uniquement à basculer vers une autre journée affectée.
    select.value = "";
    select.setAttribute("aria-label", "Changer de journée");
    const title = qs("#eventSelectorTitle");
    if (title) title.textContent = "Changer de journée";
  };

  const applySelectedHomeDay = () => {
    const selectedId = String(qs("#homeDaySelect")?.value || "").trim();
    const day = getOpenAuthorizedHomeDays().find((item) => getDayId(item) === selectedId);
    if (!day || !window.LugdurumDayContext?.isAuthorized(day, CURRENT_USER.user_id)) {
      setText("#activeStatusLabel", "Journée indisponible");
      return;
    }
    state.manualSelectionThisSession = true;
    saveSelectedDayId(selectedId);
    saveExplicitDaySelection(true);
    state.homeRequestId += 1;
    // Mise à jour immédiate de toute la page à partir des lignes déjà chargées.
    renderHome();
    if (state.dataSource === "remote") refreshHomeFromRemote();
  };

  const renderHome = () => {
    refreshPendingCounts();
    const goalCached = readCollectiveGoalCache();
    if (goalCached) renderCollectiveGoal(goalCached, { cached: !navigator.onLine });
    const homeState = buildHomeState();
    const uiState = getUiState(homeState);
    renderDaySelector(homeState);
    renderHero(homeState, uiState);
    renderWorkflow(homeState, uiState);
    const feesLink = qs("#feesToolLink");
    if (feesLink) {
      feesLink.hidden = !homeState.workContext.journee_id || !homeState.workContext.stock_mission_id;
      if (!feesLink.hidden) feesLink.href = appendContextToHref("./frais.html", homeState);
    }
    renderWatchList(buildWatchItems(homeState, uiState));
  };

  const renderFromHomeCacheIfAvailable = () => {
    try {
      const cachedData = loadHomeCacheData();

      if (!cachedData) return false;

      state.data = cachedData;
      state.dataSource = "local";
      state.loadError = "Réseau indisponible · dernière réponse accueil en cache";
      refreshPendingCounts();

      setDataState("local", "Mode hors ligne");

      renderHome();

      return true;
    } catch (error) {
      console.warn("Cache accueil inutilisable.", error);
      return false;
    }
  };

  const refreshHomeFromRemote = async () => {
    const requestId = ++state.homeRequestId;
    const isCurrent = () => requestId === state.homeRequestId;
    setDataState("refreshing", "Actualisation…");

    try {
      const data = await loadRemoteData(isCurrent);
      if (!data || !isCurrent()) return;
      state.data = data;
      state.dataSource = "remote";
      state.loadError = "";
      refreshPendingCounts();

      setDataState("online", "Données en ligne");
      renderHome();
    } catch (error) {
      if (!isCurrent()) return;
      state.loadError = error.message || "Lecture API impossible.";
      refreshPendingCounts();

      setDataState("local", "Synchronisation à vérifier");
      setText("#activeStatusLabel", "Connexion indisponible");
    }
  };

  const COLLECTIVE_GOAL = {
    id: "noel-2026",
    target: 14000,
    cacheKey: "lugdurum_collective_goal_cache_v1"
  };
  let collectiveGoalRequest = null;
  let collectiveGoalRefreshPending = false;
  let collectiveGoalTimer = null;
  let lastCollectiveGoalAmount = null;
  let highestCollectiveGoalMilestone = 0;

  const readCollectiveGoalCache = () => {
    try {
      const raw = localStorage.getItem(COLLECTIVE_GOAL.cacheKey);
      const value = raw ? JSON.parse(raw) : null;
      if (!value || !Number.isFinite(Number(value.amount))) return null;
      highestCollectiveGoalMilestone = Math.max(0, Number(value.milestone) || 0);
      lastCollectiveGoalAmount = Number(value.amount);
      return value;
    } catch {
      return null;
    }
  };

  const saveCollectiveGoalCache = (amount, updatedAt, milestone) => {
    try {
      localStorage.setItem(COLLECTIVE_GOAL.cacheKey, JSON.stringify({
        amount: Number(amount) || 0,
        updated_at: updatedAt || "",
        milestone: Math.max(highestCollectiveGoalMilestone, milestone || 0)
      }));
    } catch {
      // Le total reste affichable en mémoire si le cache compact ne peut pas être écrit.
    }
  };

  const renderCollectiveGoal = (payload, { cached = false, animate = false } = {}) => {
    const amountNode = qs("#collectiveGoalAmount");
    const fill = qs("#collectiveGoalFill");
    const progress = qs("#collectiveGoalProgress");
    const percentNode = qs("#collectiveGoalPercent");
    const remainingNode = qs("#collectiveGoalRemaining");
    const syncNode = qs("#collectiveGoalSyncState");
    const panel = qs("#collectiveGoal");
    if (!amountNode || !fill || !progress || !percentNode || !remainingNode || !panel) return;

    const amount = Number(payload?.amount);
    if (!Number.isFinite(amount)) {
      amountNode.textContent = "—";
      percentNode.textContent = "—";
      remainingNode.textContent = "Total indisponible";
      progress.setAttribute("aria-valuenow", "0");
      syncNode.textContent = cached ? "Dernier total connu" : "Serveur indisponible";
      panel.classList.remove("is-pulse", "is-double-shine", "is-halo", "is-complete");
      return;
    }

    const safeAmount = Math.max(0, amount);
    const ratio = safeAmount / COLLECTIVE_GOAL.target;
    const percent = Math.floor(ratio * 100);
    const visiblePercent = Math.min(100, percent);
    const amountText = formatEuro.format(safeAmount);
    amountNode.textContent = amountText;
    percentNode.textContent = `${percent} %`;
    progress.setAttribute("aria-valuenow", String(visiblePercent));
    progress.setAttribute("aria-valuetext", `${percent} % atteint`);
    fill.style.width = `${visiblePercent}%`;
    remainingNode.textContent = safeAmount >= COLLECTIVE_GOAL.target
      ? "Objectif atteint · merci à tous !"
      : `${formatEuro.format(COLLECTIVE_GOAL.target - safeAmount)} restants`;
    syncNode.textContent = getPendingWritesCount() > 0
      ? cached ? "Total précédent · ventes à synchroniser" : "Ventes en attente de synchronisation"
      : cached ? "Dernier total connu" : "";

    panel.classList.toggle("is-complete", safeAmount >= COLLECTIVE_GOAL.target);
    panel.classList.remove("is-pulse", "is-double-shine", "is-halo");

    let milestone = 0;
    if (ratio >= 1) milestone = 100;
    else if (ratio >= 0.75) milestone = 75;
    else if (ratio >= 0.5) milestone = 50;
    else if (ratio >= 0.25) milestone = 25;

    const crossedMilestone = milestone > highestCollectiveGoalMilestone;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate && lastCollectiveGoalAmount !== null && safeAmount > lastCollectiveGoalAmount &&
        crossedMilestone && !reducedMotion) {
      if (milestone === 25) panel.classList.add("is-pulse");
      if (milestone === 50) panel.classList.add("is-double-shine");
      if (milestone === 75) panel.classList.add("is-halo");
      if (milestone === 100) {
        panel.classList.add("is-complete");
        const confetti = qs("#collectiveGoalConfetti");
        if (confetti) {
          confetti.replaceChildren();
          for (let index = 0; index < 12; index += 1) {
            const piece = document.createElement("span");
            piece.setAttribute("aria-hidden", "true");
            piece.style.cssText = "position:absolute;left:" + (5 + Math.random() * 90) +
              "%;top:-3px;width:5px;height:7px;background:hsl(" + Math.floor(Math.random() * 360) +
              " 85% 65%);transform:rotate(" + Math.floor(Math.random() * 180) +
              "deg);animation:collectiveGoalConfetti 1.4s ease-out forwards;";
            confetti.appendChild(piece);
          }
          window.setTimeout(() => confetti.replaceChildren(), 1600);
        }
      }
    }
    highestCollectiveGoalMilestone = Math.max(highestCollectiveGoalMilestone, milestone);

    lastCollectiveGoalAmount = safeAmount;
    saveCollectiveGoalCache(safeAmount, payload.updated_at || "", highestCollectiveGoalMilestone);
  };

  const refreshCollectiveGoal = async ({ force = false } = {}) => {
    if (document.visibilityState === "hidden" || !navigator.onLine) return;
    if (collectiveGoalRequest) {
      if (force) collectiveGoalRefreshPending = true;
      return collectiveGoalRequest;
    }
    if (typeof api()?.getCollectiveGoal !== "function") {
      renderCollectiveGoal(null);
      return;
    }

    collectiveGoalRequest = api().getCollectiveGoal({ goal_id: COLLECTIVE_GOAL.id })
      .then((payload) => {
        const normalized = payload?.goal || payload?.data || payload;
        if (!normalized || normalized.available === false || !Number.isFinite(Number(normalized.amount))) {
          throw new Error("Total collectif invalide.");
        }
        const previous = lastCollectiveGoalAmount;
        renderCollectiveGoal(normalized, {
          animate: previous !== null && Number(normalized.amount) > previous,
          cached: false
        });
      })
      .catch(() => {
        const cached = readCollectiveGoalCache();
        if (cached) renderCollectiveGoal(cached, { cached: true });
        else renderCollectiveGoal(null);
      })
      .finally(() => {
        collectiveGoalRequest = null;
        if (collectiveGoalRefreshPending && document.visibilityState !== "hidden" && navigator.onLine) {
          collectiveGoalRefreshPending = false;
          refreshCollectiveGoal({ force: true });
        }
      });

    return collectiveGoalRequest;
  };

  const startCollectiveGoalRefresh = () => {
    if (collectiveGoalTimer !== null) window.clearInterval(collectiveGoalTimer);
    collectiveGoalTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshCollectiveGoal();
    }, 30000);
  };

  const initCollectiveGoal = () => {
    const cached = readCollectiveGoalCache();
    if (cached) renderCollectiveGoal(cached, { cached: true });
    else if (!navigator.onLine) renderCollectiveGoal(null);
    refreshCollectiveGoal({ force: true });
    startCollectiveGoalRefresh();
  };

  const initHome = async () => {
    initCollectiveGoal();
    const requestId = ++state.homeRequestId;
    const isCurrent = () => requestId === state.homeRequestId;
    const params = getUrlParams();
    const routeUserId = String(params.get("user_id") || "").trim();
    const requestedDayId = routeUserId && routeUserId !== CURRENT_USER.user_id
      ? ""
      : String(params.get("journee_id") || "").trim();
    state.selectedDayId = requestedDayId || readSelectedDayId();
    state.forceSelectedDay = requestedDayId ? true : readExplicitDaySelection();
    state.manualSelectionThisSession = false;

    // Priorité au réseau ; le cache validé par le même résolveur sert uniquement
    // après l’échec de lecture, avec un état hors ligne explicite.
    renderLoading();
    setDataState("refreshing", "Actualisation…");

    try {
      const data = await loadRemoteData(isCurrent);
      if (!data || !isCurrent()) return;
      state.data = data;
      state.dataSource = "remote";
      state.loadError = "";
      refreshPendingCounts();

      setDataState("online", "Données en ligne");

      renderHome();
    } catch (error) {
      if (!isCurrent()) return;
      state.loadError = error.message || "Lecture API impossible.";
      if (renderFromHomeCacheIfAvailable()) return;
      setDataState("local", "Synchronisation à vérifier");
      setText("#activeStatusLabel", "Connexion indisponible");
      setText("#missionTitle", "Connexion indisponible");
      const progress = qs("#homeDayLoadingProgress");
      if (progress) progress.hidden = true;
      const practicalInfo = qs("#missionMeta");
      if (practicalInfo) practicalInfo.hidden = true;
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
    if (detail.status === "synced" && (detail.synced_count > 0 || detail.last_synced_action)) {
      refreshCollectiveGoal({ force: true });
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshCollectiveGoal({ force: true });
  });
  window.addEventListener("pageshow", () => refreshCollectiveGoal({ force: true }));

  window.addEventListener("popstate", () => {
    if (state.dataSource !== "loading") {
      refreshHomeFromRemote();
    }
  });

  window.addEventListener("offline", () => {
    if (state.dataSource !== "loading") state.homeRequestId += 1;
    // La réponse réseau déjà chargée reste utilisable en mémoire, avec son état hors ligne explicite.
    if (state.dataSource !== "remote") return;
    state.dataSource = "local";
    state.loadError = "Connexion perdue · données de la dernière lecture réseau";
    const pending = getPendingWritesCount();
    const label = pending > 0
      ? `Mode hors ligne · ${pending} opération(s) en attente`
      : "Mode hors ligne";
    setDataState("local", label);
    renderHome();
  });

  window.addEventListener("online", () => {
    refreshCollectiveGoal({ force: true });
    if (state.dataSource === "local" || state.dataSource === "cache") refreshHomeFromRemote();
  });

  document.getElementById("homeDaySelect")?.addEventListener("change", applySelectedHomeDay);

  window.LugdurumUsers?.mount({
    button: document.querySelector(".userPill"),
    nameElement: document.getElementById("currentUserName"),
    onChange(user) {
      const initialLoadInProgress = state.dataSource === "loading";
      if (!initialLoadInProgress) state.homeRequestId += 1;
      CURRENT_USER.user_id = user.user_id;
      CURRENT_USER.nom = user.nom;
      CURRENT_USER.role = user.role;
      CURRENT_USER.capabilities = Array.isArray(user.capabilities) ? user.capabilities : [];
      state.selectedDayId = readSelectedDayId(user.user_id);
      state.forceSelectedDay = readExplicitDaySelection(user.user_id);
      state.manualSelectionThisSession = false;
      const url = new URL(window.location.href);
      ["selected_type", "selected_id", "selectedType", "selectedId", "item_type", "item_id",
        "event_id", "mission_id", "stock_mission_id", "journee_id", "user_id"].forEach((key) =>
        url.searchParams.delete(key));
      window.history.replaceState({}, "", url.toString());
      if (initialLoadInProgress) {
        setText("#currentUserName", user.nom);
      } else {
        renderHome();
        if (navigator.onLine) refreshHomeFromRemote();
        else setDataState("local", "Mode hors ligne");
      }
    }
  });
  // Mise à jour distante optionnelle ; liste connue disponible même hors ligne.
  // Pas de requête utilisateurs bloquante au démarrage des ventes.

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initHome);
  } else {
    initHome();
  }
})();
