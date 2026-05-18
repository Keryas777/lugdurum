(() => {
  "use strict";

  /*
    Stats évènements V1 : lecture API + fallback cache local.
    Compare les marchés / salons : CA, journées, moyenne, frais et résultat estimé.
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
    yearSelect: document.getElementById("eventYearSelect"),
    typeSelect: document.getElementById("eventTypeSelect"),
    summaryTotal: document.getElementById("eventSummaryTotal"),
    summaryCount: document.getElementById("eventSummaryCount"),
    summaryAverage: document.getElementById("eventSummaryAverage"),
    summaryBest: document.getElementById("eventSummaryBest"),
    cards: document.getElementById("eventCards"),
    status: document.getElementById("statsEventsStatus")
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
  const formatDisplayDate = (value) => { const date = parseLocalDate(value); return date ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "Date inconnue"; };
  const setStatus = (message, type = "") => { els.status.textContent = message; els.status.className = "statsEventsStatus"; if (type) els.status.classList.add(type); };

  const getMissionById = (id) => state.missions.find((item) => String(item.mission_id || item.evenement_id || "") === String(id || "")) || null;
  const getStockMissionById = (id) => state.stockMissions.find((item) => String(item.mission_id || "") === String(id || "")) || null;
  const getDayMission = (journee) => getMissionById(journee.evenement_id) || getMissionById(journee.mission_vente_id) || getStockMissionById(journee.stock_mission_id || journee.mission_id);
  const getTransactionTotal = (transaction) => toNumber(transaction.total_encaisse_ttc, toNumber(transaction.total_encaisse, toNumber(transaction.total_catalogue_ttc, toNumber(transaction.total_catalogue, 0))));
  const getTransactionsForDay = (journeeId) => state.transactions.filter((transaction) => String(transaction.journee_id || "") === String(journeeId || ""));

  const getFeesForMission = (missionIds, dayIds) => state.frais.filter((item) => {
    const status = String(item.statut || "valide").toLowerCase();
    if (status === "annule") return false;
    return missionIds.has(String(item.stock_mission_id || item.mission_id || "")) || dayIds.has(String(item.journee_id || ""));
  });

  const aggregateEvents = () => {
    const map = new Map();

    state.journees.forEach((journee) => {
      const mission = getDayMission(journee);
      const key = String(journee.evenement_id || journee.mission_vente_id || journee.stock_mission_id || journee.mission_id || mission?.mission_id || mission?.evenement_id || journee.journee_id);
      const type = mission?.type_evenement || mission?.type || "AUTRE";
      const year = getYear(journee.date);
      if (state.selectedYear !== "ALL" && year !== state.selectedYear) return;
      if (state.selectedType !== "ALL" && type !== state.selectedType) return;

      const transactions = getTransactionsForDay(journee.journee_id);
      const ca = transactions.reduce((sum, transaction) => sum + getTransactionTotal(transaction), 0);
      const current = map.get(key) || {
        key,
        mission,
        type,
        year,
        title: mission?.nom || mission?.evenement || "Évènement sans nom",
        place: [mission?.lieu, mission?.ville].filter(Boolean).join(" · "),
        dateStart: journee.date,
        dateEnd: journee.date,
        dayIds: new Set(),
        missionIds: new Set(),
        ca: 0,
        tickets: 0
      };

      current.dayIds.add(String(journee.journee_id || ""));
      if (journee.stock_mission_id || journee.mission_id) current.missionIds.add(String(journee.stock_mission_id || journee.mission_id));
      if (mission?.mission_id || mission?.evenement_id) current.missionIds.add(String(mission.mission_id || mission.evenement_id));
      current.ca += ca;
      current.tickets += transactions.length;
      if (String(journee.date || "") < String(current.dateStart || journee.date)) current.dateStart = journee.date;
      if (String(journee.date || "") > String(current.dateEnd || journee.date)) current.dateEnd = journee.date;
      map.set(key, current);
    });

    return [...map.values()].map((event) => {
      const fees = getFeesForMission(event.missionIds, event.dayIds).reduce((sum, item) => sum + toNumber(item.montant_ttc, toNumber(item.montant, 0)), 0);
      const days = event.dayIds.size;
      return {
        ...event,
        fees,
        net: event.ca - fees,
        days,
        average: days ? event.ca / days : 0
      };
    }).filter((event) => event.ca > 0 || event.tickets > 0 || event.fees > 0).sort((a, b) => b.ca - a.ca);
  };

  const renderOptions = () => {
    const years = [...new Set(state.journees.map((journee) => getYear(journee.date)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    const types = [...new Set(state.journees.map((journee) => getDayMission(journee)?.type_evenement || getDayMission(journee)?.type || "AUTRE"))].sort();

    els.yearSelect.innerHTML = [`<option value="ALL">Toutes</option>`, ...years.map((year) => `<option value="${escapeAttr(year)}">${escapeHtml(year)}</option>`)].join("");
    els.typeSelect.innerHTML = [`<option value="ALL">Tous</option>`, ...types.map((type) => `<option value="${escapeAttr(type)}">${escapeHtml(EVENT_KIND_LABELS[type] || type)}</option>`)].join("");

    if (years.includes(state.selectedYear)) els.yearSelect.value = state.selectedYear;
    else state.selectedYear = els.yearSelect.value = years[0] || "ALL";
    if (types.includes(state.selectedType)) els.typeSelect.value = state.selectedType;
    else els.typeSelect.value = state.selectedType = "ALL";
  };

  const render = () => {
    const events = aggregateEvents();
    const total = events.reduce((sum, event) => sum + event.ca, 0);
    const average = events.length ? total / events.length : 0;
    const best = events[0];

    els.summaryTotal.textContent = formatCurrency(total);
    els.summaryCount.textContent = String(events.length);
    els.summaryAverage.textContent = formatCurrency(average);
    els.summaryBest.textContent = best ? `${best.title} · ${formatCurrency(best.ca)}` : "—";

    els.cards.innerHTML = events.length ? events.map((event, index) => {
      const dateLabel = event.dateStart === event.dateEnd ? formatDisplayDate(event.dateStart) : `${formatDisplayDate(event.dateStart)} → ${formatDisplayDate(event.dateEnd)}`;
      return `
        <article class="eventCard">
          <div class="eventCardHeader">
            <div class="eventCardTitle">
              <strong>#${index + 1} · ${escapeHtml(event.title)}</strong>
              <span>${escapeHtml(dateLabel)}${event.place ? ` · ${escapeHtml(event.place)}` : ""}</span>
            </div>
            <strong class="eventAmount">${escapeHtml(formatCurrency(event.ca))}</strong>
          </div>
          <div class="eventMeta">
            <span>${escapeHtml(EVENT_KIND_LABELS[event.type] || event.type)}</span>
            <span>${event.days} journée${event.days > 1 ? "s" : ""}</span>
            <span>${event.tickets} ticket${event.tickets > 1 ? "s" : ""}</span>
          </div>
          <div class="eventMetrics">
            <article><span>Moyenne / jour</span><strong>${escapeHtml(formatCurrency(event.average))}</strong></article>
            <article><span>Frais</span><strong>${escapeHtml(formatCurrency(event.fees))}</strong></article>
            <article><span>Net estimé</span><strong>${escapeHtml(formatCurrency(event.net))}</strong></article>
          </div>
        </article>
      `;
    }).join("") : `<p class="statsEmpty">Aucun évènement avec ventes sur ce filtre.</p>`;
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
