(() => {
  "use strict";

  /*
    Accueil V11 :
    - Source prioritaire : Google Sheets via window.LugdurumAPI.
    - Chargement API prioritaire via getCoreData(), puis fallback par getters séparés.
    - Cache localStorage uniquement en secours si l’API est indisponible.
    - Accès localStorage sécurisé pour Safari privé.
    - Diagnostic visible dans "À surveiller" : source + compteurs bruts + compteurs filtrés.
    - Ne dépend plus de stock_preparations / stock_preparation_lignes.
    - Utilise mouvements_stock pour détecter une préparation initiale.
    - Évite les compteurs incohérents entre Safari privé / Safari normal / icône écran d’accueil.
    - Exclut les données historiques SAISIE_HISTORIQUE des compteurs d’accueil.
    - Exclut les missions stock clôturées anciennes du compteur d’accueil.
  */

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme",
    role: "admin"
  };

  const STORAGE_KEYS = {
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

    pendingTransactions: "lugdurum_pending_transactions"
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
    apiMode: "",
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
      "refuse",
      "refusee"
    ].includes(statut);
  };

  const isClosedStatus = (item) => {
    const statut = normalizeStatus(item?.statut);

    return [
      "cloture",
      "cloturee",
      "termine",
      "terminee"
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

  const normalizeRemoteData = (data) => ({
    inscriptions: Array.isArray(data.inscriptions) ? data.inscriptions : [],
    events: Array.isArray(data.events) ? data.events : [],
    stockMissions: Array.isArray(data.stockMissions) ? data.stockMissions : [],
    journees: Array.isArray(data.journees) ? data.journees : [],
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
    mouvementsStock: Array.isArray(data.mouvementsStock) ? data.mouvementsStock : []
  });

  const cacheRemoteData = (data) => {
    writeJson(STORAGE_KEYS.inscriptions, data.inscriptions);
    writeJson(STORAGE_KEYS.events, data.events);
    writeJson(STORAGE_KEYS.stockMissions, data.stockMissions);
    writeJson(STORAGE_KEYS.journees, data.journees);
    writeJson(STORAGE_KEYS.transactions, data.transactions);
    writeJson(STORAGE_KEYS.mouvementsStock, data.mouvementsStock);
  };

  const updateRawCounts = (data) => {
    state.rawCounts = {
      inscriptions: data.inscriptions.length,
      events: data.events.length,
      stockMissions: data.stockMissions.length,
      journees: data.journees.length,
      transactions: data.transactions.length,
      mouvementsStock: data.mouvementsStock.length
    };
  };

  const loadRemoteDataWithCoreData = async () => {
    if (!hasApi() || typeof api().getCoreData !== "function") {
      throw new Error("LugdurumAPI.getCoreData() est indisponible.");
    }

    const coreData = await api().getCoreData(CORE_TABLES);

    if (!coreData || typeof coreData !== "object" || Array.isArray(coreData)) {
      throw new Error("Réponse getCoreData invalide.");
    }

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

    try {
      data = await loadRemoteDataWithCoreData();
      state.apiMode = "getCoreData";
    } catch (coreError) {
      try {
        data = await loadRemoteDataWithSeparateCalls();
        state.apiMode = `getters séparés après échec getCoreData : ${coreError.message}`;
      } catch (separateError) {
        throw new Error(
          `getCoreData : ${coreError.message} · getters séparés : ${separateError.message}`
        );
      }
    }

    cacheRemoteData(data);
    updateRawCounts(data);

    return data;
  };

  const loadCacheData = () => {
    const data = normalizeRemoteData({
      inscriptions: getArray(STORAGE_KEYS.inscriptions),
      events: getArray(STORAGE_KEYS.events),
      stockMissions: getArray(STORAGE_KEYS.stockMissions),
      journees: getArray(STORAGE_KEYS.journees),
      transactions: getArray(STORAGE_KEYS.transactions),
      mouvementsStock: getArray(STORAGE_KEYS.mouvementsStock)
    });

    updateRawCounts(data);

    return data;
  };

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

  const getMissionJournees = (missionId, journees) =>
    journees
      .filter((journee) => !isHistoricalDay(journee))
      .filter((journee) => !isCancelledStatus(journee))
      .filter((journee) => {
        return (
          String(journee.mission_id || "") === String(missionId || "") ||
          String(journee.stock_mission_id || "") === String(missionId || "") ||
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

    if (["pret", "en_cours", "termine", "cloture"].includes(normalizeStatus(mission.statut))) {
      return true;
    }

    return hasInitialStockMovement(mission, mouvementsStock);
  };

  const getTransactionId = (transaction) =>
    String(transaction?.transaction_id || transaction?.id || "").trim();

  const getDayTransactions = (journeeId, transactions) => {
    if (!journeeId) return [];

    const remoteTransactions = transactions
      .filter(isValidStatus)
      .filter((transaction) => String(transaction.journee_id || "") === String(journeeId));

    const localPendingTransactions = getArray(STORAGE_KEYS.pendingTransactions)
      .filter((transaction) => String(transaction.journee_id || "") === String(journeeId));

    const byId = new Map();

    [...remoteTransactions, ...localPendingTransactions].forEach((transaction, index) => {
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

    const localPendingTransactionsCount = getArray(STORAGE_KEYS.pendingTransactions).length;
    const totalPendingSync = Math.max(
      state.pendingWritesCount,
      localPendingTransactionsCount
    );

    return {
      user: CURRENT_USER,
      dataSource: state.dataSource,
      apiMode: state.apiMode,
      loadError: state.loadError,
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

      filteredCounts: {
        events: events.length,
        stockMissions: stockMissions.length,
        journees: journees.length,
        mouvementsStock: mouvementsStock.length
      },

      resume: {
        ca_jour_ttc: revenue,
        nb_transactions: dayTransactions.length,
        ventes_en_attente_sync: localPendingTransactionsCount,
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
        secondaryText: "Missions stock",
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
        secondaryText: "Missions stock",
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
        secondaryText: "Missions stock",
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

    setText("#statThreeLabel", "Missions stock");
    setText("#pendingSync", "…");

    setLink("#primaryAction", "Gérer les inscriptions", "./inscriptions-evenements.html");
    setLink("#secondaryAction", "Missions stock", "./missions.html");

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

      setText("#statThreeLabel", "Missions stock");
      setText("#pendingSync", String(homeState.stockMissions.length));

      return;
    }

    if (uiState.code === "stock_to_prepare") {
      setText("#statOneLabel", "Journées");
      setText("#todayRevenue", String(homeState.linkedDays.length || 1));

      setText("#statTwoLabel", "Stock");
      setText("#todayTickets", homeState.stockPrepared ? "OK" : "À faire");

      setText("#statThreeLabel", "À synchroniser");
      setText("#pendingSync", String(homeState.resume.total_pending_sync || 0));

      syncCard?.classList.toggle(
        "hasWarning",
        Number(homeState.resume.total_pending_sync || 0) > 0
      );

      return;
    }

    setText("#statOneLabel", "CA jour");
    setText("#todayRevenue", formatEuro.format(Number(homeState.resume.ca_jour_ttc || 0)));

    setText("#statTwoLabel", "Tickets");
    setText("#todayTickets", String(homeState.resume.nb_transactions || 0));

    setText("#statThreeLabel", "À synchroniser");
    setText("#pendingSync", String(homeState.resume.total_pending_sync || 0));

    syncCard?.classList.toggle(
      "hasWarning",
      Number(homeState.resume.total_pending_sync || 0) > 0
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
      items.push(`Données chargées (${homeState.apiMode || "API"}).`);
    }

    if (homeState.dataSource === "cache") {
      items.push(`Données locales affichées : ${homeState.loadError || "API indisponible."}`);
    }

    items.push(
      `Brut Sheets : ${homeState.rawCounts.inscriptions} inscription(s), ${homeState.rawCounts.events} évènement(s), ${homeState.rawCounts.stockMissions} mission(s) stock, ${homeState.rawCounts.journees} journée(s), ${homeState.rawCounts.mouvementsStock} mouvement(s) stock.`
    );

    items.push(
      `Après filtres accueil : ${homeState.activeInscriptions.length} inscription(s), ${homeState.acceptedInscriptions.length} acceptée(s), ${homeState.filteredCounts.stockMissions} mission(s) stock utile(s), ${homeState.filteredCounts.journees} journée(s).`
    );

    if (!homeState.mission || !homeState.journee) {
      if (homeState.stockMissions.length > 0) {
        items.push(`${homeState.stockMissions.length} mission(s) de stock utile(s) trouvée(s), mais aucune journée active associée.`);
      } else {
        items.push("Aucune mission de stock active détectée pour l’accueil.");
      }

      if (homeState.rawCounts.stockMissions > 0 && homeState.stockMissions.length === 0) {
        items.push("Des missions existent dans Sheets, mais elles sont probablement historiques, annulées ou clôturées anciennes.");
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

    if (Number(homeState.resume.total_pending_sync || 0) > 0) {
      items.push(`${homeState.resume.total_pending_sync} écriture(s) en attente de synchronisation.`);
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

  const renderWatchList = (items) => {
    const list = qs("#watchList");

    if (!list) return;

    list.innerHTML = "";

    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
  };

  const renderHome = () => {
    const homeState = buildHomeState();
    const uiState = getUiState(homeState);

    renderHero(homeState, uiState);
    renderWorkflow(uiState);
    renderWatchList(buildWatchItems(homeState, uiState));
  };

  const initHome = async () => {
    renderLoading();

    try {
      state.data = await loadRemoteData();
      state.dataSource = "remote";
      state.loadError = "";
      state.pendingWritesCount = getPendingWritesCount();
    } catch (error) {
      state.data = loadCacheData();
      state.dataSource = "cache";
      state.loadError = error.message || "Lecture API impossible.";
      state.apiMode = "cache";
      state.pendingWritesCount = 0;
    }

    renderHome();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initHome);
  } else {
    initHome();
  }
})();