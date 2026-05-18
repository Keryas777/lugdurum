(() => {
  "use strict";

  /*
    Stats année V2 :
    - API Google Sheets prioritaire.
    - Aucun chiffre local affiché avant la réponse API.
    - Cache/localStorage uniquement si l’API est indisponible.
    - Reconstitue les journées à partir des transactions, frais et journées connues.
  */

  const CACHE_KEYS = {
    transactions: "lugdurum_transactions_cache",
    frais: "lugdurum_frais_cache",
    journees: "lugdurum_journees_cache",
    missionsStock: "lugdurum_missions_stock_cache",
    missions: "lugdurum_missions_vente_cache"
  };

  const LEGACY_KEYS = {
    transactions: ["lugdurum_transactions_cache", "lugdurum_transactions_backup", "lugdurum_pending_transactions"],
    frais: ["lugdurum_frais_cache", "lugdurum_frais"],
    journees: ["lugdurum_journees_cache", "lugdurum_journees"],
    missionsStock: ["lugdurum_missions_stock_cache", "lugdurum_missions_stock"],
    missions: ["lugdurum_missions_vente_cache", "lugdurum_evenements"]
  };

  const state = {
    source: "loading",
    transactions: [],
    frais: [],
    journees: [],
    missionsStock: [],
    missions: [],
    selectedYear: "ALL"
  };

  const $ = (...ids) => ids.map((id) => document.getElementById(id)).find(Boolean) || null;

  const els = {
    year: $("statsYearInput", "statsAnneeYearInput", "yearFilter"),
    revenue: $("statsYearRevenue", "anneeRevenue", "yearRevenue"),
    average: $("statsYearAverage", "anneeAverage", "yearAverage"),
    days: $("statsYearDays", "anneeDays", "yearDays"),
    expenses: $("statsYearExpenses", "anneeExpenses", "yearExpenses"),
    list: $("statsYearList", "statsAnneeList", "yearStatsList", "statsList"),
    status: $("statsYearStatus", "statsAnneeStatus", "yearStatsStatus", "statsStatus")
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

  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));

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

  const parseLocalDate = (value) => {
    if (!value) return null;

    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatDisplayDate = (value) => {
    const date = parseLocalDate(value);

    if (!date) return "Date inconnue";

    return new Intl.DateTimeFormat("fr-FR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  };

  const getYearFromDate = (value) => {
    const text = String(value || "");
    const match = text.match(/^(\d{4})/);
    return match ? match[1] : "";
  };

  const setText = (element, value) => {
    if (element) element.textContent = value;
  };

  const setStatus = (message, type = "") => {
    if (!els.status) return;

    els.status.textContent = message;
    els.status.className = "statsStatus statsYearStatus";

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

  const getFraisAmount = (frais) =>
    toNumber(frais.montant_ttc ?? frais.montant ?? frais.prix ?? frais.amount, 0);

  const getMissionIdFromItem = (item) =>
    String(item.stock_mission_id || item.mission_id || item.evenement_id || "").trim();

  const getDayIdFromItem = (item) => String(item.journee_id || item.day_id || "").trim();

  const getMissionMap = () => {
    const map = new Map();

    [...state.missions, ...state.missionsStock].forEach((mission) => {
      const id = String(mission.mission_id || mission.evenement_id || "").trim();
      if (id) map.set(id, mission);
    });

    return map;
  };

  const getJourneeMap = () => {
    return state.journees.reduce((map, journee) => {
      const id = String(journee.journee_id || "").trim();
      if (id) map.set(id, journee);
      return map;
    }, new Map());
  };

  const buildDaySummaries = () => {
    const missionMap = getMissionMap();
    const journeeMap = getJourneeMap();
    const map = new Map();

    const getOrCreate = ({ journeeId = "", missionId = "", date = "" }) => {
      const key = journeeId || `${missionId || "NO_MISSION"}_${date || "NO_DATE"}`;
      const journee = journeeId ? journeeMap.get(journeeId) : null;
      const resolvedMissionId = missionId || getMissionIdFromItem(journee || {});
      const mission = missionMap.get(resolvedMissionId) || null;
      const resolvedDate = date || journee?.date || journee?.date_debut || "";

      if (!map.has(key)) {
        map.set(key, {
          key,
          journee_id: journeeId,
          mission_id: resolvedMissionId,
          date: resolvedDate,
          year: getYearFromDate(resolvedDate),
          label: [mission?.nom || journee?.nom || journee?.evenement || "Journée", journee?.jour_label || ""].filter(Boolean).join(" — "),
          ville: mission?.ville || journee?.ville || "",
          ca: 0,
          frais: 0,
          tickets: 0
        });
      }

      return map.get(key);
    };

    state.transactions.filter(isValidStatus).forEach((transaction) => {
      const journeeId = getDayIdFromItem(transaction);
      const missionId = getMissionIdFromItem(transaction);
      const date = String(transaction.date_heure || transaction.date || transaction.created_at || "").slice(0, 10);
      const summary = getOrCreate({ journeeId, missionId, date });

      summary.ca += getTransactionAmount(transaction);
      summary.tickets += 1;

      if (!summary.year) summary.year = getYearFromDate(date);
      if (!summary.date) summary.date = date;
    });

    state.frais.filter(isValidStatus).forEach((item) => {
      const journeeId = getDayIdFromItem(item);
      const missionId = getMissionIdFromItem(item);
      const date = String(item.date || item.date_heure || item.created_at || "").slice(0, 10);
      const summary = getOrCreate({ journeeId, missionId, date });

      summary.frais += getFraisAmount(item);

      if (!summary.year) summary.year = getYearFromDate(date);
      if (!summary.date) summary.date = date;
    });

    state.journees
      .filter((journee) => String(journee.statut || "").toLowerCase() === "cloture")
      .forEach((journee) => {
        getOrCreate({
          journeeId: journee.journee_id || "",
          missionId: getMissionIdFromItem(journee),
          date: journee.date || ""
        });
      });

    return [...map.values()]
      .filter((item) => item.year)
      .sort((a, b) => {
        const byDate = String(b.date).localeCompare(String(a.date));
        if (byDate !== 0) return byDate;
        return String(a.label).localeCompare(String(b.label));
      });
  };

  const getAvailableYears = () => {
    const years = new Set();

    buildDaySummaries().forEach((day) => years.add(day.year));

    return [...years].sort((a, b) => b.localeCompare(a));
  };

  const syncYearFilter = () => {
    if (!els.year) return;

    const current = els.year.value || state.selectedYear;
    const years = getAvailableYears();

    els.year.innerHTML = `
      <option value="ALL">Toutes</option>
      ${years.map((year) => `<option value="${year}">${year}</option>`).join("")}
    `;

    if (current === "ALL" || years.includes(current)) {
      els.year.value = current;
      state.selectedYear = current;
    } else if (years.length > 0) {
      els.year.value = years[0];
      state.selectedYear = years[0];
    } else {
      els.year.value = "ALL";
      state.selectedYear = "ALL";
    }
  };

  const getFilteredDays = () => {
    return buildDaySummaries().filter((day) => {
      if (state.selectedYear === "ALL") return true;
      return day.year === state.selectedYear;
    });
  };

  const compute = () => {
    const days = getFilteredDays();
    const ca = days.reduce((sum, day) => sum + day.ca, 0);
    const frais = days.reduce((sum, day) => sum + day.frais, 0);
    const tickets = days.reduce((sum, day) => sum + day.tickets, 0);
    const activeDays = days.filter((day) => day.ca > 0 || day.tickets > 0).length;

    return {
      days,
      ca,
      frais,
      tickets,
      activeDays,
      average: activeDays > 0 ? ca / activeDays : 0
    };
  };

  const render = () => {
    syncYearFilter();

    const stats = compute();

    setText(els.revenue, formatCurrency(stats.ca));
    setText(els.average, formatCurrency(stats.average));
    setText(els.days, String(stats.activeDays));
    setText(els.expenses, formatCurrency(stats.frais));

    if (!els.list) return;

    if (stats.days.length === 0) {
      els.list.innerHTML = `<p class="statsEmpty">Aucune journée à afficher.</p>`;
      return;
    }

    els.list.innerHTML = stats.days.map((day) => `
      <article class="statsCard yearDayCard">
        <div class="statsCardHeader">
          <div class="statsCardTitle">
            <strong>${escapeHtml(day.label || "Journée")}</strong>
            <span>${escapeHtml(formatDisplayDate(day.date))}${day.ville ? ` · ${escapeHtml(day.ville)}` : ""}</span>
          </div>
          <strong class="statsAmount">${escapeHtml(formatCurrency(day.ca))}</strong>
        </div>
        <div class="statsMeta">
          <span>${escapeHtml(String(day.tickets))} ticket${day.tickets > 1 ? "s" : ""}</span>
          <span>Frais ${escapeHtml(formatCurrency(day.frais))}</span>
          <span>Net ${escapeHtml(formatCurrency(day.ca - day.frais))}</span>
        </div>
      </article>
    `).join("");
  };

  const callArray = async (fnName) => {
    if (!api() || typeof api()[fnName] !== "function") return [];

    const result = await api()[fnName]();
    return Array.isArray(result) ? result : [];
  };

  const loadRemote = async () => {
    if (!api()) throw new Error("lugdurum-api.js n’est pas chargé.");

    const [transactions, frais, journees, missionsStock, missions] = await Promise.all([
      callArray("getTransactions"),
      callArray("getFrais"),
      callArray("getJournees"),
      callArray("getMissionsStock"),
      callArray("getMissions")
    ]);

    state.transactions = transactions;
    state.frais = frais;
    state.journees = journees;
    state.missionsStock = missionsStock;
    state.missions = missions;
    state.source = "api";

    writeJson(CACHE_KEYS.transactions, transactions);
    writeJson(CACHE_KEYS.frais, frais);
    writeJson(CACHE_KEYS.journees, journees);
    writeJson(CACHE_KEYS.missionsStock, missionsStock);
    writeJson(CACHE_KEYS.missions, missions);
  };

  const loadLocalFallback = () => {
    state.transactions = readFirstArray(LEGACY_KEYS.transactions);
    state.frais = readFirstArray(LEGACY_KEYS.frais);
    state.journees = readFirstArray(LEGACY_KEYS.journees);
    state.missionsStock = readFirstArray(LEGACY_KEYS.missionsStock);
    state.missions = readFirstArray(LEGACY_KEYS.missions);
    state.source = "local";
  };

  const bindEvents = () => {
    if (els.year) {
      els.year.addEventListener("change", () => {
        state.selectedYear = els.year.value || "ALL";
        render();
      });
    }
  };

  const init = async () => {
    bindEvents();

    if (els.list) {
      els.list.innerHTML = `<p class="statsEmpty">Chargement depuis Google Sheets…</p>`;
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
