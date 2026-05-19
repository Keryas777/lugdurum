(() => {
  "use strict";

  /*
    Dashboard V3 :
    - API en source prioritaire.
    - Aucun affichage temporaire depuis le local si l’API répond.
    - Cache/localStorage utilisé uniquement si l’API est indisponible.
    - Accès localStorage sécurisé pour Safari privé.
    - Affiche les totaux uniquement pour l’année courante.
    - Libellés dynamiques : CA 2026 / Frais 2026.
    - Messages de chargement neutres : “Chargement…”.
    - Sert de porte d’entrée vers les pages statistiques détaillées.
  */

  const CURRENT_YEAR = new Date().getFullYear();

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

  const state = {
    source: "loading",
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

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: Number(value || 0) % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(Number(value || 0));

  const normalizeText = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

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
    setMetricLabel(els.revenue, `CA ${CURRENT_YEAR}`);
    setMetricLabel(els.expenses, `Frais ${CURRENT_YEAR}`);
  };

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

  const getYearFromValue = (value) => {
    const text = String(value ?? "").trim();

    if (!text) return null;

    const match = text.match(/^(\d{4})/);

    if (!match) return null;

    const year = Number(match[1]);

    return Number.isFinite(year) ? year : null;
  };

  const rowHasYear = (item, fields, year = CURRENT_YEAR) =>
    fields.some((field) => getYearFromValue(item?.[field]) === year);

  const transactionBelongsToCurrentYear = (transaction) =>
    rowHasYear(transaction, [
      "date_heure",
      "date",
      "created_at",
      "updated_at"
    ]);

  const fraisBelongsToCurrentYear = (item) =>
    rowHasYear(item, [
      "date",
      "date_heure",
      "created_at",
      "updated_at"
    ]);

  const missionBelongsToCurrentYear = (mission) =>
    rowHasYear(mission, [
      "date_debut",
      "date_fin",
      "created_at",
      "updated_at"
    ]);

  const journeeBelongsToCurrentYear = (journee) =>
    rowHasYear(journee, [
      "date",
      "date_debut",
      "created_at",
      "updated_at"
    ]);

  const movementBelongsToCurrentYear = (movement) =>
    rowHasYear(movement, [
      "date_heure",
      "date",
      "created_at",
      "updated_at"
    ]);

  const getTransactionAmount = (transaction) =>
    toNumber(
      transaction.total_encaisse_ttc ??
      transaction.total_encaisse ??
      transaction.total_catalogue_ttc ??
      transaction.total_catalogue,
      0
    );

  const getFraisAmount = (item) =>
    toNumber(
      item.montant_ttc ??
      item.montant ??
      item.prix ??
      item.amount,
      0
    );

  const getValidTransactions = () =>
    state.transactions
      .filter(isValidStatus)
      .filter(transactionBelongsToCurrentYear);

  const getValidFrais = () =>
    state.frais
      .filter(isValidStatus)
      .filter(fraisBelongsToCurrentYear);

  const getValidPreparationMovements = () =>
    state.mouvementsStock
      .filter(isValidStatus)
      .filter(movementBelongsToCurrentYear)
      .filter((item) => String(item.type_mouvement || "").trim().toUpperCase() === "PREPARATION");

  const getCurrentYearStockMissions = () =>
    state.stockMissions
      .filter(isValidStatus)
      .filter(missionBelongsToCurrentYear);

  const getCurrentYearClosedDays = () =>
    state.journees
      .filter(isValidStatus)
      .filter(journeeBelongsToCurrentYear)
      .filter((journee) => {
        const statut = normalizeText(journee.statut);
        return statut === "cloture" || statut === "cloturee";
      });

  const compute = () => {
    const transactions = getValidTransactions();
    const frais = getValidFrais();
    const preparationMovements = getValidPreparationMovements();
    const stockMissions = getCurrentYearStockMissions();
    const closedDays = getCurrentYearClosedDays();

    const ca = transactions.reduce((sum, item) => sum + getTransactionAmount(item), 0);
    const fraisTotal = frais.reduce((sum, item) => sum + getFraisAmount(item), 0);
    const stockPrepare = preparationMovements.reduce((sum, item) => sum + toNumber(item.quantite, 0), 0);

    return {
      year: CURRENT_YEAR,
      ca,
      fraisTotal,
      tickets: transactions.length,
      fraisCount: frais.length,
      stockMissionsCount: stockMissions.length,
      stockPrepare,
      closedDays: closedDays.length
    };
  };

  const render = () => {
    const stats = compute();

    updateMainLabels();

    if (els.revenue) els.revenue.textContent = formatCurrency(stats.ca);
    if (els.expenses) els.expenses.textContent = formatCurrency(stats.fraisTotal);

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
        amount: stats.tickets
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
        <a class="dashboardCard dashboardNavCard" href="${card.href}">
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

  const callArray = async (fnName) => {
    if (!hasApi() || typeof api()[fnName] !== "function") return [];

    const result = await api()[fnName]();
    return Array.isArray(result) ? result : [];
  };

  const loadRemote = async () => {
    const ready = await waitForApi();

    if (!ready) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

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

    state.transactions = transactions;
    state.ventesLignes = ventesLignes;
    state.frais = frais;
    state.stockMissions = stockMissions;
    state.mouvementsStock = mouvementsStock;
    state.journees = journees;
    state.source = "api";

    writeJson(CACHE_KEYS.transactions, transactions);
    writeJson(CACHE_KEYS.ventesLignes, ventesLignes);
    writeJson(CACHE_KEYS.frais, frais);
    writeJson(CACHE_KEYS.stockMissions, stockMissions);
    writeJson(CACHE_KEYS.mouvementsStock, mouvementsStock);
    writeJson(CACHE_KEYS.journees, journees);
  };

  const loadLocalFallback = () => {
    state.transactions = readFirstArray(LEGACY_KEYS.transactions);
    state.ventesLignes = readFirstArray(LEGACY_KEYS.ventesLignes);
    state.frais = readFirstArray(LEGACY_KEYS.frais);
    state.stockMissions = readFirstArray(LEGACY_KEYS.stockMissions);
    state.mouvementsStock = readFirstArray(LEGACY_KEYS.mouvementsStock);
    state.journees = readFirstArray(LEGACY_KEYS.journees);
    state.source = "local";
  };

  const init = async () => {
    updateMainLabels();

    if (els.list) {
      els.list.innerHTML = `<p class="dashboardEmpty">Chargement…</p>`;
    }

    setStatus("Chargement…");

    try {
      await loadRemote();
      render();
      setStatus("");
    } catch (error) {
      loadLocalFallback();
      render();
      setStatus(`Données locales affichées : ${error.message}`, "isError");
    }
  };

  init();
})();