(() => {
  "use strict";

  /*
    Journées clôturées V1 :
    - Page de consultation uniquement.
    - Charge les données via lugdurum-api.js si disponible.
    - Fallback sur les caches localStorage.
    - Affiche CA, paiements, produits vendus, frais et stock/écarts par journée.
  */

  const STORAGE_KEYS = {
    missions: "lugdurum_evenements",
    stockMissions: "lugdurum_missions_stock",
    journees: "lugdurum_journees",
    transactions: "lugdurum_transactions_cache",
    transactionsBackup: "lugdurum_transactions_backup",
    ventesLignes: "lugdurum_ventes_lignes_cache",
    frais: "lugdurum_frais",
    clotures: "lugdurum_clotures",
    catalogue: "lugdurum_catalogue_cache"
  };

  const PAYMENT_LABELS = {
    CB: "Carte bancaire",
    ESP: "Espèces",
    CHQ: "Chèque",
    SUMUP: "Carte bancaire",
    WEBAPP_CB_MANUEL: "CB manuel",
    WEBAPP_ESPECES: "Espèces",
    WEBAPP_CHEQUE: "Chèque",
    MANUEL: "Manuel"
  };

  const EVENT_KIND_LABELS = {
    MARCHE_ARTISANAL: "Marché artisanal",
    SALON_DES_VINS: "Salon des vins",
    MARCHE_DE_NOEL: "Marché de Noël",
    FOIRE: "Foire",
    AUTRE: "Autre"
  };

  const state = {
    search: "",
    selectedYear: "ALL",
    selectedDayId: "",
    missions: [],
    stockMissions: [],
    journees: [],
    transactions: [],
    ventesLignes: [],
    frais: [],
    clotures: [],
    catalogue: []
  };

  const els = {
    search: document.getElementById("closedSearch"),
    yearSelect: document.getElementById("closedYearSelect"),
    list: document.getElementById("closedDaysList"),
    detailPanel: document.getElementById("dayDetailPanel"),
    detailTitle: document.getElementById("dayDetailTitle"),
    detailMeta: document.getElementById("dayDetailMeta"),
    detailRevenue: document.getElementById("detailRevenue"),
    detailTickets: document.getElementById("detailTickets"),
    detailPayment: document.getElementById("detailPayment"),
    detailSales: document.getElementById("detailSales"),
    detailFees: document.getElementById("detailFees"),
    detailStock: document.getElementById("detailStock"),
    status: document.getElementById("closedStatus")
  };

  const api = () => window.LugdurumAPI || null;
  const hasApi = () => Boolean(api());

  const readJson = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const asArray = (value) => Array.isArray(value) ? value : [];

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const escapeAttr = (value) => escapeHtml(value).replaceAll("`", "&#096;");

  const toNumber = (value, fallback = 0) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
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
    }).format(toNumber(value, 0));

  const parseLocalDate = (value) => {
    if (!value) return null;
    const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  };

  const getYear = (dateValue) => String(dateValue || "").slice(0, 4) || "Inconnue";

  const formatDisplayDate = (isoDate) => {
    const date = parseLocalDate(isoDate);
    if (!date) return "Date inconnue";
    return new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(date);
  };

  const setStatus = (message, type = "") => {
    els.status.textContent = message;
    els.status.className = "closedDaysStatus";
    if (type) els.status.classList.add(type);
  };

  const normalizePaymentKey = (transaction) => {
    const provider = String(transaction.paiement_provider || transaction.source || "").toUpperCase();
    const mode = String(transaction.mode_paiement || "").toUpperCase();
    if (provider.includes("SUMUP")) return "CB";
    if (["WEBAPP_ESPECES", "ESP", "ESPECES", "ESPÈCES"].includes(mode) || provider === "WEBAPP_ESPECES") return "ESP";
    if (["WEBAPP_CHEQUE", "CHQ", "CHEQUE", "CHÈQUE"].includes(mode) || provider === "WEBAPP_CHEQUE") return "CHQ";
    if (["CB", "CARTE", "WEBAPP_CB_MANUEL"].includes(mode) || provider === "WEBAPP_CB_MANUEL") return "CB";
    return mode || provider || "MANUEL";
  };

  const getTransactionTotal = (transaction) =>
    toNumber(
      transaction.total_encaisse_ttc,
      toNumber(transaction.total_encaisse, toNumber(transaction.total_catalogue_ttc, toNumber(transaction.total_catalogue, 0)))
    );

  const getMissionById = (id) =>
    state.missions.find((item) => String(item.mission_id || item.evenement_id || "") === String(id || "")) || null;

  const getStockMissionById = (id) =>
    state.stockMissions.find((item) => String(item.mission_id || "") === String(id || "")) || null;

  const getCatalogueBySku = (skuId) =>
    state.catalogue.find((item) => String(item.sku_id || "") === String(skuId || "")) || null;

  const getDayMission = (journee) =>
    getMissionById(journee.evenement_id) || getMissionById(journee.mission_vente_id) || getStockMissionById(journee.stock_mission_id || journee.mission_id);

  const getDayTitle = (journee) => {
    const mission = getDayMission(journee);
    if (!mission) return journee.jour_label || "Journée";
    if (mission.date_debut && mission.date_fin && mission.date_debut !== mission.date_fin) {
      return `${mission.nom || mission.evenement || "Évènement"} — ${journee.jour_label || "Journée"}`;
    }
    return mission.nom || mission.evenement || journee.jour_label || "Journée";
  };

  const getClosureForDay = (journeeId) =>
    state.clotures.find((item) => String(item.journee_id || "") === String(journeeId || "")) || null;

  const isClosedDay = (journee) => {
    const status = String(journee.statut || "").toLowerCase();
    return ["cloture", "cloturee", "clôturée", "closed"].includes(status) || Boolean(getClosureForDay(journee.journee_id));
  };

  const getTransactionsForDay = (journeeId) =>
    state.transactions.filter((transaction) => String(transaction.journee_id || "") === String(journeeId || ""));

  const getLinesForDay = (journeeId) => {
    const sheetLines = state.ventesLignes.filter((line) => String(line.journee_id || "") === String(journeeId || ""));
    if (sheetLines.length > 0) return sheetLines;

    const lines = [];
    getTransactionsForDay(journeeId).forEach((transaction) => {
      const transactionId = transaction.transaction_id || `TX_${lines.length}`;
      if (Array.isArray(transaction.lignes)) {
        transaction.lignes.forEach((line) => lines.push({ ...line, transaction_id: transactionId, journee_id: journeeId }));
        return;
      }

      let detail = transaction.detail_ticket || [];
      if (typeof detail === "string") {
        try { detail = JSON.parse(detail); } catch { detail = []; }
      }

      if (!Array.isArray(detail)) return;

      detail.forEach((item) => {
        if (item.type === "bottle") {
          lines.push({
            transaction_id: transactionId,
            journee_id: journeeId,
            sku_id: item.sku_id,
            quantite: item.quantite,
            prix_unitaire_ttc: item.prix_unitaire_ttc,
            total_catalogue_ligne_ttc: toNumber(item.quantite, 0) * toNumber(item.prix_unitaire_ttc, 0)
          });
          return;
        }

        if (item.type === "box" && Array.isArray(item.composition)) {
          const unit = item.composition.length > 0 ? toNumber(item.prix_ttc, 0) / item.composition.length : 0;
          item.composition.forEach((product) => {
            lines.push({
              transaction_id: transactionId,
              journee_id: journeeId,
              sku_id: product.sku_id,
              quantite: 1,
              prix_unitaire_ttc: unit,
              total_catalogue_ligne_ttc: unit,
              note: item.label || "Coffret"
            });
          });
        }
      });
    });

    return lines;
  };

  const getFeesForDay = (journee) => {
    const missionId = journee.stock_mission_id || journee.mission_id || "";
    return state.frais.filter((item) => {
      const itemStatus = String(item.statut || "valide").toLowerCase();
      if (itemStatus === "annule") return false;
      const dayMatch = String(item.journee_id || "") === String(journee.journee_id || "");
      const missionMatch = missionId && String(item.stock_mission_id || item.mission_id || "") === String(missionId);
      return dayMatch || (!item.journee_id && missionMatch);
    });
  };

  const getDaySummary = (journee) => {
    const transactions = getTransactionsForDay(journee.journee_id);
    const ca = transactions.reduce((sum, transaction) => sum + getTransactionTotal(transaction), 0);
    const fees = getFeesForDay(journee).reduce((sum, item) => sum + toNumber(item.montant_ttc, toNumber(item.montant, 0)), 0);
    return { ca, tickets: transactions.length, fees };
  };

  const aggregatePayments = (transactions) => {
    const map = new Map();
    transactions.forEach((transaction) => {
      const key = normalizePaymentKey(transaction);
      const current = map.get(key) || { key, label: PAYMENT_LABELS[key] || key, total: 0, count: 0 };
      current.total += getTransactionTotal(transaction);
      current.count += 1;
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  };

  const aggregateSales = (lines) => {
    const map = new Map();
    lines.forEach((line) => {
      const skuId = String(line.sku_id || "").trim();
      if (!skuId) return;
      const product = getCatalogueBySku(skuId);
      const formatCl = toNumber(line.format_cl, toNumber(product?.format_cl, toNumber(String(skuId).split("_")[1], 0)));
      const code = String(line.parfum_code || product?.parfum_code || skuId.split("_")[0] || "").trim().toUpperCase();
      const name = String(line.parfum_nom || product?.parfum_nom || code).trim();
      const key = `${code}_${formatCl}`;
      const current = map.get(key) || { key, sku_id: skuId, parfum_code: code, parfum_nom: name, format_cl: formatCl, qty: 0, ca: 0 };
      const qty = toNumber(line.quantite, toNumber(line.qty, 0));
      const total = toNumber(line.total_catalogue_ligne_ttc, toNumber(line.total_ligne_ttc, qty * toNumber(line.prix_unitaire_ttc, 0)));
      current.qty += qty;
      current.ca += total;
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => b.format_cl - a.format_cl || b.qty - a.qty || a.parfum_code.localeCompare(b.parfum_code));
  };

  const getFilteredDays = () => {
    const query = state.search.trim().toLowerCase();
    return state.journees
      .filter(isClosedDay)
      .filter((journee) => state.selectedYear === "ALL" || getYear(journee.date) === state.selectedYear)
      .filter((journee) => {
        if (!query) return true;
        const mission = getDayMission(journee);
        return [getDayTitle(journee), journee.date, journee.ville, mission?.ville, mission?.lieu, mission?.nom, mission?.type_evenement]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  };

  const renderYearOptions = () => {
    const years = [...new Set(state.journees.map((journee) => getYear(journee.date)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    els.yearSelect.innerHTML = [`<option value="ALL">Toutes</option>`, ...years.map((year) => `<option value="${escapeAttr(year)}">${escapeHtml(year)}</option>`)].join("");
    els.yearSelect.value = years.includes(state.selectedYear) ? state.selectedYear : "ALL";
    state.selectedYear = els.yearSelect.value;
  };

  const renderList = () => {
    const days = getFilteredDays();

    if (days.length === 0) {
      els.list.innerHTML = `<p class="closedDaysEmpty">Aucune journée clôturée trouvée.</p>`;
      state.selectedDayId = "";
      els.detailPanel.hidden = true;
      return;
    }

    if (!state.selectedDayId || !days.some((day) => day.journee_id === state.selectedDayId)) {
      state.selectedDayId = days[0].journee_id;
    }

    els.list.innerHTML = days.map((journee) => {
      const mission = getDayMission(journee);
      const summary = getDaySummary(journee);
      const active = journee.journee_id === state.selectedDayId;
      const place = [mission?.lieu, mission?.ville].filter(Boolean).join(" · ");
      return `
        <button class="closedDayCard ${active ? "isActive" : ""}" type="button" data-day-id="${escapeAttr(journee.journee_id)}">
          <div class="closedDayHeader">
            <div class="closedDayTitle">
              <strong>${escapeHtml(getDayTitle(journee))}</strong>
              <span>${escapeHtml(formatDisplayDate(journee.date))}${place ? ` · ${escapeHtml(place)}` : ""}</span>
            </div>
            <strong class="closedDayAmount">${escapeHtml(formatCurrency(summary.ca))}</strong>
          </div>
          <div class="closedDayMeta">
            <span>${summary.tickets} ticket${summary.tickets > 1 ? "s" : ""}</span>
            <span>Frais ${formatCurrency(summary.fees)}</span>
            ${mission?.type_evenement ? `<span>${escapeHtml(EVENT_KIND_LABELS[mission.type_evenement] || mission.type_evenement)}</span>` : ""}
          </div>
        </button>
      `;
    }).join("");

    renderDetail();
  };

  const renderPayment = (payments) => {
    if (payments.length === 0) {
      els.detailPayment.innerHTML = `<p class="detailEmpty">Aucun paiement trouvé.</p>`;
      return;
    }

    els.detailPayment.innerHTML = `<div class="paymentCards">${payments.map((payment) => `
      <article class="paymentCard">
        <span>${escapeHtml(payment.label)} · ${payment.count} ticket${payment.count > 1 ? "s" : ""}</span>
        <strong>${escapeHtml(formatCurrency(payment.total))}</strong>
      </article>
    `).join("")}</div>`;
  };

  const renderSales = (sales) => {
    if (sales.length === 0) {
      els.detailSales.innerHTML = `<p class="detailEmpty">Aucune vente détaillée trouvée.</p>`;
      return;
    }

    els.detailSales.innerHTML = `<div class="salesCards">${sales.map((item) => `
      <article class="salesCard">
        <span>${escapeHtml(item.parfum_code)} ${escapeHtml(item.format_cl || "?")} cL · ${escapeHtml(item.parfum_nom)}</span>
        <strong>${item.qty} vendu${item.qty > 1 ? "s" : ""}</strong>
        <span>${escapeHtml(formatCurrency(item.ca))}</span>
      </article>
    `).join("")}</div>`;
  };

  const renderFees = (fees) => {
    if (fees.length === 0) {
      els.detailFees.innerHTML = `<p class="detailEmpty">Aucun frais rattaché.</p>`;
      return;
    }

    const total = fees.reduce((sum, item) => sum + toNumber(item.montant_ttc, toNumber(item.montant, 0)), 0);
    els.detailFees.innerHTML = `<div class="feesCards">${fees.map((item) => `
      <article class="feesCard">
        <span>${escapeHtml(item.libelle || item.categorie_label || item.categorie || "Frais")}</span>
        <strong>${escapeHtml(formatCurrency(toNumber(item.montant_ttc, toNumber(item.montant, 0))))}</strong>
      </article>
    `).join("")}
      <article class="feesCard"><span>Total frais</span><strong>${escapeHtml(formatCurrency(total))}</strong></article>
    </div>`;
  };

  const renderStock = (closure) => {
    if (!closure || !Array.isArray(closure.stock_lignes) || closure.stock_lignes.length === 0) {
      els.detailStock.innerHTML = `<p class="detailEmpty">Aucune clôture stock détaillée trouvée.</p>`;
      return;
    }

    els.detailStock.innerHTML = `<div class="stockCards">${closure.stock_lignes.map((line) => `
      <article class="stockCard">
        <span>${escapeHtml(line.parfum_code || line.sku_id)} ${escapeHtml(line.format_cl || "")} cL</span>
        <strong>${line.stock_compte === "" || line.stock_compte === undefined ? "—" : escapeHtml(line.stock_compte)}</strong>
        <span>Théorique ${escapeHtml(line.stock_theorique ?? "—")} · écart ${escapeHtml(line.ecart ?? "—")}</span>
      </article>
    `).join("")}</div>`;
  };

  const renderDetail = () => {
    const journee = state.journees.find((item) => item.journee_id === state.selectedDayId);
    if (!journee) {
      els.detailPanel.hidden = true;
      return;
    }

    const mission = getDayMission(journee);
    const transactions = getTransactionsForDay(journee.journee_id);
    const payments = aggregatePayments(transactions);
    const sales = aggregateSales(getLinesForDay(journee.journee_id));
    const fees = getFeesForDay(journee);
    const closure = getClosureForDay(journee.journee_id);
    const revenue = transactions.reduce((sum, transaction) => sum + getTransactionTotal(transaction), 0);
    const place = [mission?.lieu, mission?.ville].filter(Boolean).join(" · ");

    els.detailPanel.hidden = false;
    els.detailTitle.textContent = getDayTitle(journee);
    els.detailMeta.textContent = `${formatDisplayDate(journee.date)}${place ? ` · ${place}` : ""}`;
    els.detailRevenue.textContent = formatCurrency(revenue);
    els.detailTickets.textContent = String(transactions.length);

    renderPayment(payments);
    renderSales(sales);
    renderFees(fees);
    renderStock(closure);
  };

  const loadLocalData = () => {
    state.missions = asArray(readJson(STORAGE_KEYS.missions, []));
    state.stockMissions = asArray(readJson(STORAGE_KEYS.stockMissions, []));
    state.journees = asArray(readJson(STORAGE_KEYS.journees, []));
    state.transactions = [
      ...asArray(readJson(STORAGE_KEYS.transactions, [])),
      ...asArray(readJson(STORAGE_KEYS.transactionsBackup, []))
    ];
    state.ventesLignes = asArray(readJson(STORAGE_KEYS.ventesLignes, []));
    state.frais = asArray(readJson(STORAGE_KEYS.frais, []));
    state.clotures = asArray(readJson(STORAGE_KEYS.clotures, []));
    state.catalogue = asArray(readJson(STORAGE_KEYS.catalogue, []));
  };

  const optionalArray = async (fnName, fallback = []) => {
    if (!hasApi() || typeof api()[fnName] !== "function") return fallback;
    try {
      const result = await api()[fnName]();
      return Array.isArray(result) ? result : fallback;
    } catch {
      return fallback;
    }
  };

  const loadRemoteData = async () => {
    if (!hasApi()) throw new Error("lugdurum-api.js n’est pas chargé.");

    const [missions, stockMissions, journees, transactions, ventesLignes, frais, clotures, catalogue] = await Promise.all([
      optionalArray("getMissions", state.missions),
      optionalArray("getMissionsStock", state.stockMissions),
      optionalArray("getJournees", state.journees),
      optionalArray("getTransactions", state.transactions),
      optionalArray("getVentesLignes", state.ventesLignes),
      optionalArray("getFrais", state.frais),
      optionalArray("getClotures", state.clotures),
      optionalArray("getCatalogue", state.catalogue)
    ]);

    state.missions = missions;
    state.stockMissions = stockMissions;
    state.journees = journees;
    state.transactions = transactions;
    state.ventesLignes = ventesLignes;
    state.frais = frais;
    state.clotures = clotures;
    state.catalogue = catalogue;

    writeJson(STORAGE_KEYS.missions, missions);
    writeJson(STORAGE_KEYS.stockMissions, stockMissions);
    writeJson(STORAGE_KEYS.journees, journees);
    writeJson(STORAGE_KEYS.transactions, transactions);
    writeJson(STORAGE_KEYS.ventesLignes, ventesLignes);
    writeJson(STORAGE_KEYS.frais, frais);
    writeJson(STORAGE_KEYS.clotures, clotures);
    writeJson(STORAGE_KEYS.catalogue, catalogue);
  };

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-day-id]");
    if (!button) return;
    state.selectedDayId = button.dataset.dayId;
    renderList();
    document.getElementById("dayDetailPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  els.search.addEventListener("input", () => {
    state.search = els.search.value;
    renderList();
  });

  els.yearSelect.addEventListener("change", () => {
    state.selectedYear = els.yearSelect.value;
    renderList();
  });

  const init = async () => {
    const params = new URLSearchParams(window.location.search);
    state.selectedDayId = params.get("journee_id") || "";

    loadLocalData();
    renderYearOptions();
    renderList();

    try {
      setStatus("Chargement depuis Google Sheets...");
      await loadRemoteData();
      renderYearOptions();
      renderList();
      setStatus("");
    } catch (error) {
      setStatus(`Données locales affichées : ${error.message}`, "isError");
    }
  };

  init();
})();
