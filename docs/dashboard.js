(() => {
  "use strict";

  /*
    Dashboard V4 :
    - API en source prioritaire.
    - Aucun affichage temporaire depuis le local si l’API répond.
    - Cache/localStorage utilisé uniquement si l’API est indisponible.
    - Accès localStorage sécurisé pour Safari privé.
    - Affiche les totaux uniquement pour l’année courante.
    - Année métier basée en priorité sur journees_vente.date via journee_id.
    - Ne classe plus les historiques selon created_at / updated_at.
    - Libellés dynamiques : CA 2026 / Frais 2026.
    - Messages de chargement neutres : “Chargement…”.
    - Sert de porte d’entrée vers les pages statistiques détaillées.
  */

  const CURRENT_YEAR = new Date().getFullYear();
  const CURRENT_YEAR_LABEL = String(CURRENT_YEAR);

  const CACHE_KEYS = {
    transactions: "lugdurum_transactions_cache",
    ventesLignes: "lugdurum_ventes_lignes_cache",
    frais: "lugdurum_frais_cache",
    stockMissions: "lugdurum_missions_stock_cache",
    mouvementsStock: "lugdurum_mouvements_stock_cache",
    journees: "lugdurum_journees_cache"
  };

  const LEGACY_KEYS = {
    transactions: [
      "lugdurum_transactions_cache",
      "lugdurum_transactions_backup",
      "lugdurum_pending_transactions"
    ],
    ventesLignes: [
      "lugdurum_ventes_lignes_cache",
      "lugdurum_ventes_lignes"
    ],
    frais: [
      "lugdurum_frais_cache",
      "lugdurum_frais"
    ],
    stockMissions: [
      "lugdurum_missions_stock_cache",
      "lugdurum_missions_stock"
    ],
    mouvementsStock: [
      "lugdurum_mouvements_stock_cache",
      "lugdurum_mouvements_stock"
    ],
    journees: [
      "lugdurum_journees_cache",
      "lugdurum_journees"
    ]
  };

  const CORE_TABLES = [
    "transactions",
    "ventesLignes",
    "frais",
    "missionsStock",
    "mouvementsStock",
    "journees"
  ];

  const DATE_FIELDS = {
    journee: ["date", "date_journee", "date_debut"],
    transaction: ["date_vente", "date", "date_heure"],
    venteLigne: ["date_vente", "date", "date_heure"],
    frais: ["date_frais", "date", "date_heure"],
    mission: ["date_debut", "date_fin"],
    mouvement: ["date_mouvement", "date", "date_heure"]
  };

  const state = {
    source: "loading",
    apiMode: "",
    loadError: "",
    transactions: [],
    ventesLignes: [],
    frais: [],
    stockMissions: [],
    mouvementsStock: [],
    journees: []
  };

  const els = {
    revenue: document.getElementById("dashboardRevenue"),
    expenses: document.getElementById("dashboardExpenses"),
    list: document.getElementById("dashboardList"),
    status: document.getElementById("dashboardStatus")
  };

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

  const readJsonNullable = (key) => {
    const raw = safeLocalGet(key);

    if (raw === null) return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const readFirstArray = (keys) => {
    for (const key of keys) {
      const value = readJsonNullable(key);
      if (Array.isArray(value)) return value;
    }

    return [];
  };

  const writeJson = (key, value) => {
    safeLocalSet(key, JSON.stringify(Array.isArray(value) ? value : []));
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const escapeAttr = (value) =>
    escapeHtml(value).replaceAll("`", "&#096;");

  const normalizeText = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

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

  const roundAmount = (value) =>
    Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;

  const formatCurrency = (value) => {
    const amount = roundAmount(value);

    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const setStatus = (message, type = "") => {
    if (!els.status) return;

    els.status.textContent = message;
    els.status.className = "dashboardStatus";

    if (type) {
      els.status.classList.add(type);
    }
  };

  const setMetricLabel = (valueEl, label) => {
    if (!valueEl) return;

    const card = valueEl.closest("article");
    const labelEl = card?.querySelector("span");

    if (labelEl) {
      labelEl.textContent = label;
    }
  };

  const updateMainLabels = () => {
    setMetricLabel(els.revenue, `CA ${CURRENT_YEAR_LABEL}`);
    setMetricLabel(els.expenses, `Frais ${CURRENT_YEAR_LABEL}`);
  };

  const getYearFromValue = (value) => {
    const text = String(value ?? "").trim();

    if (!text) return null;

    const match = text.match(/^(\d{4})/);

    if (!match) return null;

    const year = Number(match[1]);

    return Number.isFinite(year) ? year : null;
  };

  const getFirstYearFromFields = (item, fields) => {
    for (const field of fields) {
      const year = getYearFromValue(item?.[field]);

      if (year) {
        return year;
      }
    }

    return null;
  };

  const isYear = (year, wantedYear = CURRENT_YEAR) =>
    Number(year) === Number(wantedYear);

  const isCancelledStatus = (item) => {
    const statut = normalizeText(item?.statut || item?.paiement_statut || "validee");

    return [
      "annule",
      "annulee",
      "annulé",
      "annulée",
      "refuse",
      "refusee",
      "refusé",
      "refusée",
      "rembourse",
      "remboursee",
      "remboursé",
      "remboursée"
    ].includes(statut);
  };

  const isValidStatus = (item) => !isCancelledStatus(item);

  const isClosedStatus = (item) => {
    const statut = normalizeText(item?.statut);

    return [
      "cloture",
      "cloturee",
      "clôturé",
      "clôturée",
      "termine",
      "terminee",
      "terminé",
      "terminée"
    ].includes(statut);
  };

  const getJourneeId = (item) =>
    String(item?.journee_id || item?.day_id || "").trim();

  const getTransactionId = (transaction) =>
    String(transaction?.transaction_id || transaction?.id || "").trim();

  const getMissionId = (item) =>
    String(
      item?.stock_mission_id ||
      item?.mission_stock_id ||
      item?.mission_id ||
      item?.evenement_id ||
      ""
    ).trim();

  const getJourneeMap = () =>
    state.journees.reduce((map, journee) => {
      const id = getJourneeId(journee);

      if (id) {
        map.set(id, journee);
      }

      return map;
    }, new Map());

  const getValidTransactionMap = () =>
    state.transactions.reduce((map, transaction) => {
      if (!isValidStatus(transaction)) return map;

      const id = getTransactionId(transaction);

      if (id) {
        map.set(id, transaction);
      }

      return map;
    }, new Map());

  const getJourneeBusinessYear = (journee) =>
    getFirstYearFromFields(journee, DATE_FIELDS.journee);

  const getBusinessYearFromJourneeLink = (item, journeeMap) => {
    const journeeId = getJourneeId(item);

    if (!journeeId) return null;

    const journee = journeeMap.get(journeeId);

    if (!journee) return null;

    return getJourneeBusinessYear(journee);
  };

  const getTransactionBusinessYear = (transaction, journeeMap) => {
    const yearFromJournee = getBusinessYearFromJourneeLink(transaction, journeeMap);

    if (yearFromJournee) {
      return yearFromJournee;
    }

    return getFirstYearFromFields(transaction, DATE_FIELDS.transaction);
  };

  const getFraisBusinessYear = (item, journeeMap) => {
    const yearFromJournee = getBusinessYearFromJourneeLink(item, journeeMap);

    if (yearFromJournee) {
      return yearFromJournee;
    }

    return getFirstYearFromFields(item, DATE_FIELDS.frais);
  };

  const getMovementBusinessYear = (item, journeeMap) => {
    const yearFromJournee = getBusinessYearFromJourneeLink(item, journeeMap);

    if (yearFromJournee) {
      return yearFromJournee;
    }

    return getFirstYearFromFields(item, DATE_FIELDS.mouvement);
  };

  const getLineBusinessYear = (line, transactionMap, journeeMap) => {
    const yearFromLineJournee = getBusinessYearFromJourneeLink(line, journeeMap);

    if (yearFromLineJournee) {
      return yearFromLineJournee;
    }

    const transactionId = String(line?.transaction_id || "").trim();
    const transaction = transactionId ? transactionMap.get(transactionId) : null;

    if (transaction) {
      const yearFromTransaction = getTransactionBusinessYear(transaction, journeeMap);

      if (yearFromTransaction) {
        return yearFromTransaction;
      }
    }

    return getFirstYearFromFields(line, DATE_FIELDS.venteLigne);
  };

  const missionBelongsToCurrentYear = (mission) => {
    const startYear = getYearFromValue(mission?.date_debut);
    const endYear = getYearFromValue(mission?.date_fin);

    if (startYear && endYear) {
      return startYear <= CURRENT_YEAR && endYear >= CURRENT_YEAR;
    }

    if (startYear) {
      return isYear(startYear);
    }

    if (endYear) {
      return isYear(endYear);
    }

    return false;
  };

  const getTransactionAmount = (transaction) =>
    toNumber(
      transaction?.total_encaisse_ttc ??
      transaction?.total_encaisse ??
      transaction?.total_catalogue_ttc ??
      transaction?.total_catalogue,
      0
    );

  const getFraisAmount = (item) =>
    toNumber(
      item?.montant_ttc ??
      item?.montant ??
      item?.prix ??
      item?.amount,
      0
    );

  const getMovementQuantity = (item) =>
    toNumber(
      item?.quantite ??
      item?.quantity ??
      item?.qty,
      0
    );

  const isPreparationMovement = (item) => {
    const type = normalizeText(
      item?.type_mouvement ||
      item?.mouvement_type ||
      item?.type ||
      item?.categorie ||
      ""
    );

    return (
      type === "preparation" ||
      type === "preparation_initiale" ||
      type === "stock_initial" ||
      type === "preparation_stock" ||
      type.includes("preparation")
    );
  };

  const parseDetailTicket = (transaction) => {
    const raw = transaction?.detail_ticket;

    if (Array.isArray(raw)) return raw;
    if (typeof raw !== "string" || !raw.trim()) return [];

    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };

  const collectProductRefsFromTicket = (refs, transaction) => {
    const ticket = parseDetailTicket(transaction);

    ticket.forEach((item) => {
      if (item?.type === "bottle" && item.sku_id) {
        refs.add(String(item.sku_id).trim());
        return;
      }

      if (item?.type === "box" && Array.isArray(item.composition)) {
        item.composition.forEach((product) => {
          if (product?.sku_id) {
            refs.add(String(product.sku_id).trim());
          }
        });

        return;
      }

      if (item?.sku_id) {
        refs.add(String(item.sku_id).trim());
      }
    });
  };

  const getValidTransactionsForCurrentYear = (journeeMap) =>
    state.transactions
      .filter(isValidStatus)
      .filter((transaction) =>
        isYear(getTransactionBusinessYear(transaction, journeeMap))
      );

  const getValidFraisForCurrentYear = (journeeMap) =>
    state.frais
      .filter(isValidStatus)
      .filter((item) =>
        isYear(getFraisBusinessYear(item, journeeMap))
      );

  const getValidPreparationMovementsForCurrentYear = (journeeMap) =>
    state.mouvementsStock
      .filter(isValidStatus)
      .filter(isPreparationMovement)
      .filter((item) =>
        isYear(getMovementBusinessYear(item, journeeMap))
      );

  const getCurrentYearStockMissions = () =>
    state.stockMissions
      .filter(isValidStatus)
      .filter(missionBelongsToCurrentYear);

  const getCurrentYearClosedDays = () =>
    state.journees
      .filter(isValidStatus)
      .filter(isClosedStatus)
      .filter((journee) =>
        isYear(getJourneeBusinessYear(journee))
      );

  const getCurrentYearProductReferences = (transactions, journeeMap) => {
    const transactionMap = getValidTransactionMap();
    const currentYearTransactionIds = new Set(
      transactions
        .map(getTransactionId)
        .filter(Boolean)
    );

    const transactionIdsWithLines = new Set();
    const refs = new Set();

    state.ventesLignes
      .filter(isValidStatus)
      .forEach((line) => {
        const transactionId = String(line?.transaction_id || "").trim();

        if (transactionId) {
          transactionIdsWithLines.add(transactionId);
        }

        const lineYear = getLineBusinessYear(line, transactionMap, journeeMap);

        if (!isYear(lineYear)) {
          return;
        }

        const quantity = toNumber(
          line?.quantite ??
          line?.qty ??
          line?.quantity,
          0
        );

        if (quantity <= 0) {
          return;
        }

        const sku = String(
          line?.sku_id ||
          line?.sku ||
          [
            line?.parfum_code,
            line?.format_cl
          ].filter(Boolean).join("_")
        ).trim();

        if (sku) {
          refs.add(sku);
        }
      });

    transactions.forEach((transaction) => {
      const transactionId = getTransactionId(transaction);

      if (transactionId && transactionIdsWithLines.has(transactionId)) {
        return;
      }

      if (transactionId && !currentYearTransactionIds.has(transactionId)) {
        return;
      }

      collectProductRefsFromTicket(refs, transaction);
    });

    return refs;
  };

  const compute = () => {
    const journeeMap = getJourneeMap();

    const transactions = getValidTransactionsForCurrentYear(journeeMap);
    const frais = getValidFraisForCurrentYear(journeeMap);
    const preparationMovements = getValidPreparationMovementsForCurrentYear(journeeMap);
    const stockMissions = getCurrentYearStockMissions();
    const closedDays = getCurrentYearClosedDays();
    const productRefs = getCurrentYearProductReferences(transactions, journeeMap);

    const ca = transactions.reduce(
      (sum, item) => sum + getTransactionAmount(item),
      0
    );

    const fraisTotal = frais.reduce(
      (sum, item) => sum + getFraisAmount(item),
      0
    );

    const stockPrepare = preparationMovements.reduce(
      (sum, item) => sum + getMovementQuantity(item),
      0
    );

    return {
      year: CURRENT_YEAR_LABEL,
      ca,
      fraisTotal,
      tickets: transactions.length,
      fraisCount: frais.length,
      productReferences: productRefs.size,
      stockMissionsCount: stockMissions.length,
      stockPrepare,
      closedDays: closedDays.length
    };
  };

  const render = () => {
    const stats = compute();

    updateMainLabels();

    if (els.revenue) {
      els.revenue.textContent = formatCurrency(stats.ca);
    }

    if (els.expenses) {
      els.expenses.textContent = formatCurrency(stats.fraisTotal);
    }

    if (!els.list) return;

    const cards = [
      {
        href: "./journees-cloturees.html",
        title: "Journées clôturées",
        text: `Historique ${stats.year} : ventes, paiements, stocks et bilan journalier.`,
        amount: stats.closedDays
      },
      {
        href: "./stats-annee.html",
        title: `Stats ${stats.year}`,
        text: "CA annuel, moyenne par journée, nombre d’évènements et comparaison globale.",
        amount: formatCurrency(stats.ca)
      },
      {
        href: "./stats-produits.html",
        title: "Stats produits",
        text: `Parfums vendus en ${stats.year}, formats 50 cL / 20 cL, coffrets et chiffre d’affaires.`,
        amount: stats.productReferences
      },
      {
        href: "./stats-evenements.html",
        title: "Stats évènements",
        text: `Marchés, salons, missions, frais et rentabilité terrain ${stats.year}.`,
        amount: stats.stockMissionsCount
      }
    ];

    els.list.innerHTML = cards
      .map((card) => `
        <a class="dashboardCard dashboardNavCard" href="${escapeAttr(card.href)}">
          <div class="dashboardCardHeader">
            <div class="dashboardCardTitle">
              <strong>${escapeHtml(card.title)}</strong>
              <span>${escapeHtml(card.text)}</span>
            </div>
            <strong class="dashboardAmount">${escapeHtml(String(card.amount))}</strong>
          </div>
        </a>
      `)
      .join("");
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

  const normalizeCoreArray = (coreData, key) => {
    const value = coreData?.[key];

    if (Array.isArray(value)) return value;

    if (value && typeof value === "object" && value.ok === false) {
      throw new Error(value.error || `Table coreData invalide : ${key}`);
    }

    return [];
  };

  const callArray = async (fnName) => {
    if (!hasApi() || typeof api()[fnName] !== "function") {
      throw new Error(`Fonction API indisponible : ${fnName}`);
    }

    const result = await api()[fnName]();

    return Array.isArray(result) ? result : [];
  };

  const loadRemoteWithCoreData = async () => {
    if (!hasApi() || typeof api().getCoreData !== "function") {
      throw new Error("LugdurumAPI.getCoreData() est indisponible.");
    }

    const coreData = await api().getCoreData(CORE_TABLES);

    if (!coreData || typeof coreData !== "object" || Array.isArray(coreData)) {
      throw new Error("Réponse getCoreData invalide.");
    }

    return {
      transactions: normalizeCoreArray(coreData, "transactions"),
      ventesLignes: normalizeCoreArray(coreData, "ventesLignes"),
      frais: normalizeCoreArray(coreData, "frais"),
      stockMissions: normalizeCoreArray(coreData, "missionsStock"),
      mouvementsStock: normalizeCoreArray(coreData, "mouvementsStock"),
      journees: normalizeCoreArray(coreData, "journees")
    };
  };

  const loadRemoteWithSeparateCalls = async () => {
    const [
      transactions,
      ventesLignes,
      frais,
      stockMissions,
      mouvementsStock,
      journees
    ] = await Promise.all([
      callArray("getTransactions"),
      callArray("getVentesLignes"),
      callArray("getFrais"),
      callArray("getMissionsStock"),
      callArray("getMouvementsStock"),
      callArray("getJournees")
    ]);

    return {
      transactions,
      ventesLignes,
      frais,
      stockMissions,
      mouvementsStock,
      journees
    };
  };

  const applyRemoteData = (data) => {
    state.transactions = data.transactions;
    state.ventesLignes = data.ventesLignes;
    state.frais = data.frais;
    state.stockMissions = data.stockMissions;
    state.mouvementsStock = data.mouvementsStock;
    state.journees = data.journees;
    state.source = "api";
    state.loadError = "";

    writeJson(CACHE_KEYS.transactions, state.transactions);
    writeJson(CACHE_KEYS.ventesLignes, state.ventesLignes);
    writeJson(CACHE_KEYS.frais, state.frais);
    writeJson(CACHE_KEYS.stockMissions, state.stockMissions);
    writeJson(CACHE_KEYS.mouvementsStock, state.mouvementsStock);
    writeJson(CACHE_KEYS.journees, state.journees);
  };

  const loadRemote = async () => {
    const ready = await waitForApi();

    if (!ready) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    let data;

    try {
      data = await loadRemoteWithCoreData();
      state.apiMode = "getCoreData";
    } catch (coreError) {
      try {
        data = await loadRemoteWithSeparateCalls();
        state.apiMode = `getters séparés après échec getCoreData : ${coreError.message}`;
      } catch (separateError) {
        throw new Error(
          `getCoreData : ${coreError.message} · getters séparés : ${separateError.message}`
        );
      }
    }

    applyRemoteData(data);
  };

  const loadLocalFallback = (error) => {
    state.transactions = readFirstArray(LEGACY_KEYS.transactions);
    state.ventesLignes = readFirstArray(LEGACY_KEYS.ventesLignes);
    state.frais = readFirstArray(LEGACY_KEYS.frais);
    state.stockMissions = readFirstArray(LEGACY_KEYS.stockMissions);
    state.mouvementsStock = readFirstArray(LEGACY_KEYS.mouvementsStock);
    state.journees = readFirstArray(LEGACY_KEYS.journees);
    state.source = "local";
    state.apiMode = "cache";
    state.loadError = error?.message || "Lecture données impossible.";
  };

  const init = async () => {
    updateMainLabels();

    if (els.revenue) {
      els.revenue.textContent = "—";
    }

    if (els.expenses) {
      els.expenses.textContent = "—";
    }

    if (els.list) {
      els.list.innerHTML = `<p class="dashboardEmpty">Chargement…</p>`;
    }

    setStatus("Chargement…");

    try {
      await loadRemote();
      render();
      setStatus("");
    } catch (error) {
      loadLocalFallback(error);
      render();
      setStatus(`Données locales affichées : ${error.message}`, "isError");
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();