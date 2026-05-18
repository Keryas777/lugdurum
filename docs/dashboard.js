(() => {
  "use strict";

  const STORAGE_KEYS = {
    transactionsBackup: "lugdurum_transactions_backup",
    pendingTransactionsLegacy: "lugdurum_pending_transactions",
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

  const hasApi = () => Boolean(api());

  const readJson = (key, fallback = []) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
      return Array.isArray(value) ? value : fallback;
    } catch {
      return fallback;
    }
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

    const number = Number(
      String(value ?? "")
        .trim()
        .replace(/\s/g, "")
        .replace(",", ".")
    );

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

  const dedupeById = (items, idKey) => {
    const map = new Map();

    items.forEach((item) => {
      const id = String(item?.[idKey] || "").trim();

      if (!id) return;

      map.set(id, item);
    });

    return [...map.values()];
  };

  const getValidTransactions = () =>
    state.transactions.filter((item) => {
      const statut = String(item.statut || "validee").toLowerCase();
      const paiementStatut = String(item.paiement_statut || "PAYE").toLowerCase();

      return (
        statut !== "annule" &&
        statut !== "annulee" &&
        statut !== "paiement_en_attente" &&
        paiementStatut !== "annule" &&
        paiementStatut !== "refuse"
      );
    });

  const getValidFrais = () =>
    state.frais.filter((item) => {
      const statut = String(item.statut || "valide").toLowerCase();
      return statut !== "annule" && statut !== "annulee";
    });

  const getValidStockMissions = () =>
    state.stockMissions.filter((item) => {
      const statut = String(item.statut || "").toLowerCase();
      return statut !== "annule" && statut !== "annulee";
    });

  const getValidPreparationMovements = () =>
    state.mouvementsStock.filter((item) => {
      const type = String(item.type_mouvement || "").toUpperCase();
      const statut = String(item.statut || "").toLowerCase();

      return type === "PREPARATION" && statut !== "annule" && statut !== "annulee";
    });

  const compute = () => {
    const transactions = getValidTransactions();
    const frais = getValidFrais();
    const stockMissions = getValidStockMissions();
    const preparationMovements = getValidPreparationMovements();

    const ca = transactions.reduce((sum, item) => {
      return sum + toNumber(
        item.total_encaisse_ttc ??
          item.total_encaisse ??
          item.total_catalogue_ttc ??
          item.total_catalogue,
        0
      );
    }, 0);

    const fraisTotal = frais.reduce((sum, item) => {
      return sum + toNumber(
        item.montant_ttc ??
          item.montant ??
          item.prix,
        0
      );
    }, 0);

    const stockPrepare = preparationMovements.reduce((sum, item) => {
      return sum + toNumber(item.quantite, 0);
    }, 0);

    const closedMissions = stockMissions.filter((mission) => {
      const statut = String(mission.statut || "").toLowerCase();
      return statut === "cloture" || statut === "cloturee";
    }).length;

    return {
      ca,
      fraisTotal,
      tickets: transactions.length,
      fraisCount: frais.length,
      stockMissionsCount: stockMissions.length,
      closedMissions,
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
            <span>Transactions validées, hors paiements annulés ou en attente.</span>
          </div>
          <strong class="dashboardAmount">${escapeHtml(String(stats.tickets))}</strong>
        </div>
      </article>

      <article class="dashboardCard">
        <div class="dashboardCardHeader">
          <div class="dashboardCardTitle">
            <strong>Frais saisis</strong>
            <span>Dépenses liées aux missions ou aux journées terrain.</span>
          </div>
          <strong class="dashboardAmount">${escapeHtml(String(stats.fraisCount))}</strong>
        </div>
      </article>

      <article class="dashboardCard">
        <div class="dashboardCardHeader">
          <div class="dashboardCardTitle">
            <strong>Missions de stock</strong>
            <span>Préparées, en cours, clôturées ou à préparer.</span>
          </div>
          <strong class="dashboardAmount">${escapeHtml(String(stats.stockMissionsCount))}</strong>
        </div>
      </article>

      <article class="dashboardCard">
        <div class="dashboardCardHeader">
          <div class="dashboardCardTitle">
            <strong>Missions clôturées</strong>
            <span>Missions dont toutes les journées ont été terminées.</span>
          </div>
          <strong class="dashboardAmount">${escapeHtml(String(stats.closedMissions))}</strong>
        </div>
      </article>

      <article class="dashboardCard">
        <div class="dashboardCardHeader">
          <div class="dashboardCardTitle">
            <strong>Bouteilles préparées</strong>
            <span>Total des mouvements de stock de type préparation.</span>
          </div>
          <strong class="dashboardAmount">${escapeHtml(String(stats.stockPrepare))}</strong>
        </div>
      </article>
    `;
  };

  const loadLocal = () => {
    const backupTransactions = readJson(STORAGE_KEYS.transactionsBackup, []);
    const legacyPendingTransactions = readJson(STORAGE_KEYS.pendingTransactionsLegacy, []);

    state.transactions = dedupeById(
      [...backupTransactions, ...legacyPendingTransactions],
      "transaction_id"
    );

    state.frais = readJson(STORAGE_KEYS.frais, []);
    state.stockMissions = readJson(STORAGE_KEYS.stockMissions, []);
    state.mouvementsStock = readJson(STORAGE_KEYS.mouvementsStock, []);
  };

  const optionalApi = async (fnName, fallback) => {
    if (!hasApi() || typeof api()[fnName] !== "function") {
      return fallback;
    }

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

    state.transactions = dedupeById(transactions, "transaction_id");
    state.frais = dedupeById(frais, "frais_id");
    state.stockMissions = dedupeById(stockMissions, "mission_id");
    state.mouvementsStock = dedupeById(mouvementsStock, "mouvement_stock_id");

    writeJson(STORAGE_KEYS.transactionsBackup, state.transactions);
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