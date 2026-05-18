(() => {
  "use strict";

  /*
    Dashboard V2 :
    - API Google Sheets en source prioritaire.
    - Aucun affichage temporaire depuis le local si l’API répond.
    - Cache/localStorage utilisé uniquement si l’API est indisponible.
    - Sert de porte d’entrée vers les pages statistiques détaillées.
  */

  const CACHE_KEYS = {
    transactions: "lugdurum_transactions_cache",
    ventesLignes: "lugdurum_ventes_lignes_cache",
    frais: "lugdurum_frais_cache",
    stockMissions: "lugdurum_missions_stock_cache",
    mouvementsStock: "lugdurum_mouvements_stock_cache",
    journees: "lugdurum_journees_cache"
  };

  const LEGACY_KEYS = {
    transactions: ["lugdurum_transactions_cache", "lugdurum_transactions_backup", "lugdurum_pending_transactions"],
    ventesLignes: ["lugdurum_ventes_lignes_cache", "lugdurum_ventes_lignes"],
    frais: ["lugdurum_frais_cache", "lugdurum_frais"],
    stockMissions: ["lugdurum_missions_stock_cache", "lugdurum_missions_stock"],
    mouvementsStock: ["lugdurum_mouvements_stock_cache", "lugdurum_mouvements_stock"],
    journees: ["lugdurum_journees_cache", "lugdurum_journees"]
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

  const readJsonNullable = (key) => {
    const raw = localStorage.getItem(key);
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
    localStorage.setItem(key, JSON.stringify(value));
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
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value || 0);

  const setStatus = (message, type = "") => {
    if (!els.status) return;

    els.status.textContent = message;
    els.status.className = "dashboardStatus";

    if (type) {
      els.status.classList.add(type);
    }
  };

  const isValidStatus = (item) => {
    const statut = String(item?.statut || item?.paiement_statut || "validee").toLowerCase();
    return !["annule", "annulee", "annulé", "annulée", "refuse", "refusé"].includes(statut);
  };

  const getTransactionAmount = (transaction) =>
    toNumber(
      transaction.total_encaisse_ttc ??
      transaction.total_encaisse ??
      transaction.total_catalogue_ttc ??
      transaction.total_catalogue,
      0
    );

  const getFraisAmount = (item) =>
    toNumber(item.montant_ttc ?? item.montant ?? item.prix ?? item.amount, 0);

  const getValidTransactions = () => state.transactions.filter(isValidStatus);
  const getValidFrais = () => state.frais.filter(isValidStatus);

  const getValidPreparationMovements = () =>
    state.mouvementsStock.filter((item) => (
      String(item.type_mouvement || "") === "PREPARATION" &&
      isValidStatus(item)
    ));

  const compute = () => {
    const transactions = getValidTransactions();
    const frais = getValidFrais();
    const preparationMovements = getValidPreparationMovements();
    const stockMissions = state.stockMissions.filter(isValidStatus);

    const ca = transactions.reduce((sum, item) => sum + getTransactionAmount(item), 0);
    const fraisTotal = frais.reduce((sum, item) => sum + getFraisAmount(item), 0);
    const stockPrepare = preparationMovements.reduce((sum, item) => sum + toNumber(item.quantite, 0), 0);

    const closedDays = state.journees.filter((journee) =>
      String(journee.statut || "").toLowerCase() === "cloture"
    ).length;

    return {
      ca,
      fraisTotal,
      tickets: transactions.length,
      fraisCount: frais.length,
      stockMissionsCount: stockMissions.length,
      stockPrepare,
      closedDays
    };
  };

  const render = () => {
    const stats = compute();

    if (els.revenue) els.revenue.textContent = formatCurrency(stats.ca);
    if (els.expenses) els.expenses.textContent = formatCurrency(stats.fraisTotal);

    if (!els.list) return;

    const cards = [
      {
        href: "./journees-cloturees.html",
        title: "Journées clôturées",
        text: "Historique par journée : CA, paiements, bouteilles vendues.",
        amount: stats.closedDays
      },
      {
        href: "./stats-annee.html",
        title: "Résultats par année",
        text: "CA annuel, moyenne par jour, liste des journées.",
        amount: formatCurrency(stats.ca)
      },
      {
        href: "./stats-produits.html",
        title: "Stats produits",
        text: "Parfums, formats 50 cL / 20 cL, coffrets et quantités.",
        amount: stats.tickets
      },
      {
        href: "./stats-evenements.html",
        title: "Stats évènements",
        text: "Marchés, salons, missions, frais et rentabilité terrain.",
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

  const callArray = async (fnName) => {
    if (!api() || typeof api()[fnName] !== "function") return [];

    const result = await api()[fnName]();
    return Array.isArray(result) ? result : [];
  };

  const loadRemote = async () => {
    if (!api()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    const [transactions, ventesLignes, frais, stockMissions, mouvementsStock, journees] = await Promise.all([
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
    if (els.list) {
      els.list.innerHTML = `<p class="dashboardEmpty">Chargement depuis Google Sheets…</p>`;
    }

    setStatus("Chargement depuis Google Sheets...");

    try {
      await loadRemote();
      render();
      setStatus("");
    } catch (error) {
      loadLocalFallback();
      render();
      setStatus(`API indisponible. Données locales affichées : ${error.message}`, "isError");
    }
  };

  init();
})();
