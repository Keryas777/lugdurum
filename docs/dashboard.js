(() => {
  "use strict";

  const STORAGE_KEYS = {
    transactions: "lugdurum_pending_transactions",
    frais: "lugdurum_frais",
    stockMissions: "lugdurum_missions_stock",
    mouvementsStock: "lugdurum_mouvements_stock"
  };

  const state = {
    transactions: [],
    frais: [],
    stockMissions: [],
    mouvementsStock: []
  };

  const els = {
    revenue: document.getElementById("dashboardRevenue"),
    expenses: document.getElementById("dashboardExpenses"),
    list: document.getElementById("dashboardList"),
    status: document.getElementById("dashboardStatus")
  };

  const api = () => window.LugdurumAPI || null;

  const readJson = (key, fallback = []) => {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  };

  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  const toNumber = (value, fallback = 0) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const number = Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
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
    els.status.textContent = message;
    els.status.className = "dashboardStatus";
    if (type) els.status.classList.add(type);
  };

  const getValidTransactions = () =>
    state.transactions.filter((item) => {
      const statut = String(item.statut || "validee").toLowerCase();
      return statut !== "annulee" && statut !== "annule";
    });

  const getValidFrais = () =>
    state.frais.filter((item) => String(item.statut || "valide").toLowerCase() !== "annule");

  const getValidStockMissions = () =>
    state.stockMissions.filter((item) => String(item.statut || "").toLowerCase() !== "annule");

  const getValidPreparationMovements = () =>
    state.mouvementsStock.filter((item) => (
      String(item.type_mouvement || "") === "PREPARATION" &&
      String(item.statut || "").toLowerCase() !== "annule"
    ));

  const compute = () => {
    const transactions = getValidTransactions();
    const frais = getValidFrais();
    const stockMissions = getValidStockMissions();
    const preparationMovements = getValidPreparationMovements();

    const ca = transactions.reduce((sum, item) => (
      sum + toNumber(
        item.total_encaisse_ttc ??
        item.total_encaisse ??
        item.total_catalogue_ttc ??
        item.total_catalogue,
        0
      )
    ), 0);

    const fraisTotal = frais.reduce((sum, item) => sum + toNumber(item.montant, 0), 0);
    const stockPrepare = preparationMovements.reduce((sum, item) => sum + toNumber(item.quantite, 0), 0);

    return {
      ca,
      fraisTotal,
      tickets: transactions.length,
      fraisCount: frais.length,
      stockMissionsCount: stockMissions.length,
      stockPrepare
    };
  };

  const render = () => {
    const stats = compute();

    els.revenue.textContent = formatCurrency(stats.ca);
    els.expenses.textContent = formatCurrency(stats.fraisTotal);

    els.list.innerHTML = `
      <article class="dashboardCard">
        <div class="dashboardCardHeader">
          <div class="dashboardCardTitle">
            <strong>Tickets enregistrés</strong>
            <span>Transactions locales ou récupérées depuis Sheets.</span>
          </div>
          <strong class="dashboardAmount">${escapeHtml(String(stats.tickets))}</strong>
        </div>
      </article>
      <article class="dashboardCard">
        <div class="dashboardCardHeader">
          <div class="dashboardCardTitle">
            <strong>Frais saisis</strong>
            <span>Dépenses liées aux missions de stock.</span>
          </div>
          <strong class="dashboardAmount">${escapeHtml(String(stats.fraisCount))}</strong>
        </div>
      </article>
      <article class="dashboardCard">
        <div class="dashboardCardHeader">
          <div class="dashboardCardTitle">
            <strong>Missions de stock</strong>
            <span>Évènements préparés ou à préparer.</span>
          </div>
          <strong class="dashboardAmount">${escapeHtml(String(stats.stockMissionsCount))}</strong>
        </div>
      </article>
      <article class="dashboardCard">
        <div class="dashboardCardHeader">
          <div class="dashboardCardTitle">
            <strong>Bouteilles préparées</strong>
            <span>Total des mouvements PREPARATION disponibles.</span>
          </div>
          <strong class="dashboardAmount">${escapeHtml(String(stats.stockPrepare))}</strong>
        </div>
      </article>
    `;
  };

  const loadLocal = () => {
    state.transactions = readJson(STORAGE_KEYS.transactions, []);
    state.frais = readJson(STORAGE_KEYS.frais, []);
    state.stockMissions = readJson(STORAGE_KEYS.stockMissions, []);
    state.mouvementsStock = readJson(STORAGE_KEYS.mouvementsStock, []);
  };

  const optionalApi = async (fnName, fallback) => {
    if (!api() || typeof api()[fnName] !== "function") return fallback;

    try {
      const result = await api()[fnName]();
      return Array.isArray(result) ? result : fallback;
    } catch {
      return fallback;
    }
  };

  const loadRemote = async () => {
    const [transactions, frais, stockMissions, mouvementsStock] = await Promise.all([
      optionalApi("getTransactions", state.transactions),
      optionalApi("getFrais", state.frais),
      optionalApi("getMissionsStock", state.stockMissions),
      optionalApi("getMouvementsStock", state.mouvementsStock)
    ]);

    state.transactions = transactions;
    state.frais = frais;
    state.stockMissions = stockMissions;
    state.mouvementsStock = mouvementsStock;

    writeJson(STORAGE_KEYS.frais, state.frais);
    writeJson(STORAGE_KEYS.stockMissions, state.stockMissions);
    writeJson(STORAGE_KEYS.mouvementsStock, state.mouvementsStock);
  };

  const init = async () => {
    loadLocal();
    render();

    try {
      setStatus("Chargement depuis Google Sheets...");
      await loadRemote();
      render();
      setStatus("");
    } catch (error) {
      setStatus(`Données locales affichées : ${error.message}`, "isError");
    }
  };

  init();
})();
