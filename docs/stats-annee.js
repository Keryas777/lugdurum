(() => {
  "use strict";

  /*
    Stats année V1 : lecture API + fallback cache local.
    Remplace le bloc-notes des résultats annuels avec total, moyenne et liste des journées.
  */

  const STORAGE_KEYS = {
    missions: "lugdurum_evenements",
    stockMissions: "lugdurum_missions_stock",
    journees: "lugdurum_journees",
    transactions: "lugdurum_transactions_cache",
    transactionsBackup: "lugdurum_transactions_backup",
    frais: "lugdurum_frais"
  };

  const EVENT_KIND_LABELS = {
    MARCHE_ARTISANAL: "Marché artisanal",
    SALON_DES_VINS: "Salon des vins",
    MARCHE_DE_NOEL: "Marché de Noël",
    FOIRE: "Foire",
    AUTRE: "Autre"
  };

  const PAYMENT_LABELS = {
    CB: "CB",
    ESP: "Espèces",
    CHQ: "Chèque",
    SUMUP: "CB",
    WEBAPP_CB_MANUEL: "CB manuel",
    WEBAPP_ESPECES: "Espèces",
    WEBAPP_CHEQUE: "Chèque",
    MANUEL: "Manuel"
  };

  const state = {
    selectedYear: "ALL",
    selectedType: "ALL",
    missions: [],
    stockMissions: [],
    journees: [],
    transactions: [],
    frais: []
  };

  const els = {
    yearSelect: document.getElementById("yearSelect"),
    typeSelect: document.getElementById("typeSelect"),
    totalRevenue: document.getElementById("yearTotalRevenue"),
    dayCount: document.getElementById("yearDayCount"),
    average: document.getElementById("yearAverage"),
    bestDay: document.getElementById("yearBestDay"),
    paymentBreakdown: document.getElementById("paymentBreakdown"),
    yearList: document.getElementById("yearList"),
    status: document.getElementById("statsYearStatus")
  };

  const api = () => window.LugdurumAPI || null;
  const hasApi = () => Boolean(api());

  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } };
  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const asArray = (value) => Array.isArray(value) ? value : [];
  const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const escapeAttr = (value) => escapeHtml(value).replaceAll("`", "&#096;");
  const toNumber = (value, fallback = 0) => { if (typeof value === "number" && Number.isFinite(value)) return value; const number = Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", ".")); return Number.isFinite(number) ? number : fallback; };
  const formatCurrency = (value) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: value % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(toNumber(value, 0));
  const getYear = (value) => String(value || "").slice(0, 4) || "Inconnue";
  const parseLocalDate = (value) => { if (!value) return null; const [y, m, d] = String(value).slice(0,10).split("-").map(Number); return y && m && d ? new Date(y, m - 1, d) : null; };
  const formatDisplayDate = (value) => { const date = parseLocalDate(value); return date ? new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(date) : "Date inconnue"; };

  const setStatus = (message, type = "") => { els.status.textContent = message; els.status.className = "statsYearStatus"; if (type) els.status.classList.add(type); };

  const getMissionById = (id) => state.missions.find((item) => String(item.mission_id || item.evenement_id || "") === String(id || "")) || null;
  const getStockMissionById = (id) => state.stockMissions.find((item) => String(item.mission_id || "") === String(id || "")) || null;

  const getDayMission = (journee) => getMissionById(journee.evenement_id) || getMissionById(journee.mission_vente_id) || getStockMissionById(journee.stock_mission_id || journee.mission_id);
  const getDayTitle = (journee) => { const mission = getDayMission(journee); return [mission?.nom || mission?.evenement || "Journée", mission?.date_debut !== mission?.date_fin ? journee.jour_label : ""].filter(Boolean).join(" — "); };

  const normalizePaymentKey = (transaction) => {
    const provider = String(transaction.paiement_provider || transaction.source || "").toUpperCase();
    const mode = String(transaction.mode_paiement || "").toUpperCase();
    if (provider.includes("SUMUP")) return "CB";
    if (["WEBAPP_ESPECES", "ESP", "ESPECES", "ESPÈCES"].includes(mode) || provider === "WEBAPP_ESPECES") return "ESP";
    if (["WEBAPP_CHEQUE", "CHQ", "CHEQUE", "CHÈQUE"].includes(mode) || provider === "WEBAPP_CHEQUE") return "CHQ";
    if (["CB", "CARTE", "WEBAPP_CB_MANUEL"].includes(mode) || provider === "WEBAPP_CB_MANUEL") return "CB";
    return mode || provider || "MANUEL";
  };

  const getTransactionTotal = (transaction) => toNumber(transaction.total_encaisse_ttc, toNumber(transaction.total_encaisse, toNumber(transaction.total_catalogue_ttc, toNumber(transaction.total_catalogue, 0))));

  const getTransactionsForDay = (journeeId) => state.transactions.filter((transaction) => String(transaction.journee_id || "") === String(journeeId || ""));

  const getDayRows = () => {
    const rows = state.journees.map((journee) => {
      const mission = getDayMission(journee);
      const transactions = getTransactionsForDay(journee.journee_id);
      const ca = transactions.reduce((sum, transaction) => sum + getTransactionTotal(transaction), 0);
      return {
        journee,
        mission,
        transactions,
        ca,
        year: getYear(journee.date || transactions[0]?.date_heure),
        type: mission?.type_evenement || mission?.type || "AUTRE"
      };
    }).filter((row) => row.ca > 0 || row.transactions.length > 0);

    return rows.filter((row) => {
      if (state.selectedYear !== "ALL" && row.year !== state.selectedYear) return false;
      if (state.selectedType !== "ALL" && row.type !== state.selectedType) return false;
      return true;
    }).sort((a, b) => String(b.journee.date || "").localeCompare(String(a.journee.date || "")));
  };

  const renderOptions = () => {
    const rows = state.journees.map((journee) => ({ journee, mission: getDayMission(journee), year: getYear(journee.date) }));
    const years = [...new Set(rows.map((row) => row.year).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    const types = [...new Set(rows.map((row) => row.mission?.type_evenement || row.mission?.type || "AUTRE"))].sort();

    els.yearSelect.innerHTML = [`<option value="ALL">Toutes</option>`, ...years.map((year) => `<option value="${escapeAttr(year)}">${escapeHtml(year)}</option>`)].join("");
    els.typeSelect.innerHTML = [`<option value="ALL">Tous</option>`, ...types.map((type) => `<option value="${escapeAttr(type)}">${escapeHtml(EVENT_KIND_LABELS[type] || type)}</option>`)].join("");

    if (years.includes(state.selectedYear)) els.yearSelect.value = state.selectedYear;
    else state.selectedYear = els.yearSelect.value = years[0] || "ALL";
    if (types.includes(state.selectedType)) els.typeSelect.value = state.selectedType;
    else els.typeSelect.value = state.selectedType = "ALL";
  };

  const render = () => {
    const rows = getDayRows();
    const total = rows.reduce((sum, row) => sum + row.ca, 0);
    const average = rows.length ? total / rows.length : 0;
    const best = rows.slice().sort((a, b) => b.ca - a.ca)[0];

    els.totalRevenue.textContent = formatCurrency(total);
    els.dayCount.textContent = String(rows.length);
    els.average.textContent = formatCurrency(average);
    els.bestDay.textContent = best ? `${best.mission?.ville || best.mission?.nom || "—"} · ${formatCurrency(best.ca)}` : "—";

    const paymentMap = new Map();
    rows.forEach((row) => row.transactions.forEach((transaction) => {
      const key = normalizePaymentKey(transaction);
      const current = paymentMap.get(key) || { key, label: PAYMENT_LABELS[key] || key, total: 0, count: 0 };
      current.total += getTransactionTotal(transaction);
      current.count += 1;
      paymentMap.set(key, current);
    }));

    const payments = [...paymentMap.values()].sort((a, b) => b.total - a.total);
    els.paymentBreakdown.innerHTML = payments.length ? payments.map((payment) => `
      <article class="paymentCard">
        <span>${escapeHtml(payment.label)} · ${payment.count} ticket${payment.count > 1 ? "s" : ""}</span>
        <strong>${escapeHtml(formatCurrency(payment.total))}</strong>
      </article>
    `).join("") : `<p class="statsEmpty">Aucun paiement trouvé.</p>`;

    els.yearList.innerHTML = rows.length ? rows.map((row) => {
      const place = [row.mission?.lieu, row.mission?.ville].filter(Boolean).join(" · ");
      return `
        <article class="yearCard">
          <div class="yearCardHeader">
            <div class="yearCardTitle">
              <strong>${escapeHtml(getDayTitle(row.journee))}</strong>
              <span>${escapeHtml(formatDisplayDate(row.journee.date))}${place ? ` · ${escapeHtml(place)}` : ""}</span>
            </div>
            <strong class="yearCardAmount">${escapeHtml(formatCurrency(row.ca))}</strong>
          </div>
          <div class="yearCardMeta">
            <span>${row.transactions.length} ticket${row.transactions.length > 1 ? "s" : ""}</span>
            <span>${escapeHtml(EVENT_KIND_LABELS[row.type] || row.type)}</span>
          </div>
        </article>
      `;
    }).join("") : `<p class="statsEmpty">Aucune journée avec ventes sur ce filtre.</p>`;
  };

  const loadLocalData = () => {
    state.missions = asArray(readJson(STORAGE_KEYS.missions, []));
    state.stockMissions = asArray(readJson(STORAGE_KEYS.stockMissions, []));
    state.journees = asArray(readJson(STORAGE_KEYS.journees, []));
    state.transactions = [...asArray(readJson(STORAGE_KEYS.transactions, [])), ...asArray(readJson(STORAGE_KEYS.transactionsBackup, []))];
    state.frais = asArray(readJson(STORAGE_KEYS.frais, []));
  };

  const optionalArray = async (fnName, fallback = []) => {
    if (!hasApi() || typeof api()[fnName] !== "function") return fallback;
    try { const result = await api()[fnName](); return Array.isArray(result) ? result : fallback; } catch { return fallback; }
  };

  const loadRemoteData = async () => {
    if (!hasApi()) throw new Error("lugdurum-api.js n’est pas chargé.");
    const [missions, stockMissions, journees, transactions, frais] = await Promise.all([
      optionalArray("getMissions", state.missions),
      optionalArray("getMissionsStock", state.stockMissions),
      optionalArray("getJournees", state.journees),
      optionalArray("getTransactions", state.transactions),
      optionalArray("getFrais", state.frais)
    ]);
    state.missions = missions; state.stockMissions = stockMissions; state.journees = journees; state.transactions = transactions; state.frais = frais;
    writeJson(STORAGE_KEYS.missions, missions); writeJson(STORAGE_KEYS.stockMissions, stockMissions); writeJson(STORAGE_KEYS.journees, journees); writeJson(STORAGE_KEYS.transactions, transactions); writeJson(STORAGE_KEYS.frais, frais);
  };

  els.yearSelect.addEventListener("change", () => { state.selectedYear = els.yearSelect.value; render(); });
  els.typeSelect.addEventListener("change", () => { state.selectedType = els.typeSelect.value; render(); });

  const init = async () => {
    loadLocalData(); renderOptions(); render();
    try { setStatus("Chargement depuis Google Sheets..."); await loadRemoteData(); renderOptions(); render(); setStatus(""); }
    catch (error) { setStatus(`Données locales affichées : ${error.message}`, "isError"); }
  };

  init();
})();
