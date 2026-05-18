(() => {
  "use strict";

  /*
    Stats évènements V2 :
    - API Google Sheets prioritaire.
    - Aucun rendu local avant la réponse API.
    - Cache/localStorage uniquement si l’API est indisponible.
    - Regroupe CA, frais, tickets et journées par mission/évènement.
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
    filters: {
      year: "ALL",
      search: ""
    }
  };

  const $ = (...ids) => ids.map((id) => document.getElementById(id)).find(Boolean) || null;

  const els = {
    year: $("statsEventsYearInput", "statsEvenementsYearInput", "eventYearFilter", "yearFilter"),
    search: $("statsEventsSearchInput", "statsEvenementsSearchInput", "eventSearchInput", "searchInput"),
    revenue: $("statsEventsRevenue", "eventRevenue", "eventsRevenue"),
    expenses: $("statsEventsExpenses", "eventExpenses", "eventsExpenses"),
    count: $("statsEventsCount", "eventCount", "eventsCount"),
    average: $("statsEventsAverage", "eventAverage", "eventsAverage"),
    list: $("statsEventsList", "statsEvenementsList", "eventsList", "statsList"),
    status: $("statsEventsStatus", "statsEvenementsStatus", "eventsStatus", "statsStatus")
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

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value || 0);

  const formatDisplayDate = (isoDate) => {
    if (!isoDate) return "Date inconnue";

    const date = new Date(`${String(isoDate).slice(0, 10)}T12:00:00`);

    if (Number.isNaN(date.getTime())) return "Date inconnue";

    return new Intl.DateTimeFormat("fr-FR", {
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
    els.status.className = "statsStatus statsEventsStatus";

    if (type) {
      els.status.classList.add(type);
    }
  };

  const isValidStatus = (item) => {
    const statut = String(item?.statut || item?.paiement_statut || "validee").toLowerCase();
    return !["annule", "annulee", "annulé", "annulée", "refuse", "refusé"].includes(statut);
  };

  const getMissionId = (item) =>
    String(item.stock_mission_id || item.mission_id || item.evenement_id || "").trim();

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

  const getMissionMap = () => {
    const map = new Map();

    [...state.missions, ...state.missionsStock].forEach((mission) => {
      const id = getMissionId(mission);
      if (id) map.set(id, mission);
    });

    return map;
  };

  const getMissionDate = (mission, fallback = "") =>
    String(mission?.date_debut || mission?.date || fallback || "").slice(0, 10);

  const buildEventSummaries = () => {
    const missionMap = getMissionMap();
    const map = new Map();

    const getOrCreate = (missionId, fallbackDate = "") => {
      const key = missionId || "MISSION_INCONNUE";
      const mission = missionMap.get(key) || null;
      const date = getMissionDate(mission, fallbackDate);

      if (!map.has(key)) {
        map.set(key, {
          mission_id: key,
          nom: mission?.nom || mission?.evenement || "Mission inconnue",
          ville: mission?.ville || "",
          type_evenement_label: mission?.type_evenement_label || mission?.type_evenement || "Évènement",
          date_debut: mission?.date_debut || date,
          date_fin: mission?.date_fin || date,
          year: getYearFromDate(date),
          ca: 0,
          frais: 0,
          tickets: 0,
          journees: new Set()
        });
      }

      return map.get(key);
    };

    state.missionsStock.filter(isValidStatus).forEach((mission) => {
      const missionId = getMissionId(mission);
      if (missionId) getOrCreate(missionId, mission.date_debut || mission.date || "");
    });

    state.transactions.filter(isValidStatus).forEach((transaction) => {
      const missionId = getMissionId(transaction);
      const date = String(transaction.date_heure || transaction.date || transaction.created_at || "").slice(0, 10);
      const event = getOrCreate(missionId, date);

      event.ca += getTransactionAmount(transaction);
      event.tickets += 1;
      if (transaction.journee_id) event.journees.add(transaction.journee_id);
      if (!event.year) event.year = getYearFromDate(date);
    });

    state.frais.filter(isValidStatus).forEach((item) => {
      const missionId = getMissionId(item);
      const date = String(item.date || item.date_heure || item.created_at || "").slice(0, 10);
      const event = getOrCreate(missionId, date);

      event.frais += getFraisAmount(item);
      if (item.journee_id) event.journees.add(item.journee_id);
      if (!event.year) event.year = getYearFromDate(date);
    });

    state.journees.filter(isValidStatus).forEach((journee) => {
      const missionId = getMissionId(journee);
      if (!missionId) return;

      const event = getOrCreate(missionId, journee.date || "");
      event.journees.add(journee.journee_id || `${missionId}_${journee.date}`);
      if (!event.year) event.year = getYearFromDate(journee.date);
    });

    return [...map.values()].map((item) => ({
      ...item,
      journees_count: item.journees.size,
      net: item.ca - item.frais
    })).sort((a, b) => {
      const byDate = String(b.date_debut || "").localeCompare(String(a.date_debut || ""));
      if (byDate !== 0) return byDate;
      return String(a.nom).localeCompare(String(b.nom));
    });
  };

  const getAvailableYears = () => {
    const years = new Set();

    buildEventSummaries().forEach((event) => {
      if (event.year) years.add(event.year);
    });

    return [...years].sort((a, b) => b.localeCompare(a));
  };

  const syncYearFilter = () => {
    if (!els.year) return;

    const current = els.year.value || state.filters.year;
    const years = getAvailableYears();

    els.year.innerHTML = `
      <option value="ALL">Toutes</option>
      ${years.map((year) => `<option value="${year}">${year}</option>`).join("")}
    `;

    if (current === "ALL" || years.includes(current)) {
      els.year.value = current;
      state.filters.year = current;
    } else if (years.length > 0) {
      els.year.value = years[0];
      state.filters.year = years[0];
    } else {
      els.year.value = "ALL";
      state.filters.year = "ALL";
    }
  };

  const getFilteredEvents = () => {
    const query = normalizeText(state.filters.search);

    return buildEventSummaries()
      .filter((event) => {
        if (state.filters.year === "ALL") return true;
        return event.year === state.filters.year;
      })
      .filter((event) => {
        if (!query) return true;
        return normalizeText(`${event.nom} ${event.ville} ${event.type_evenement_label}`).includes(query);
      });
  };

  const compute = () => {
    const events = getFilteredEvents();
    const ca = events.reduce((sum, item) => sum + item.ca, 0);
    const frais = events.reduce((sum, item) => sum + item.frais, 0);
    const activeEvents = events.filter((item) => item.ca > 0 || item.tickets > 0 || item.frais > 0).length;

    return {
      events,
      ca,
      frais,
      activeEvents,
      average: activeEvents > 0 ? ca / activeEvents : 0
    };
  };

  const render = () => {
    syncYearFilter();

    const stats = compute();

    setText(els.revenue, formatCurrency(stats.ca));
    setText(els.expenses, formatCurrency(stats.frais));
    setText(els.count, String(stats.activeEvents));
    setText(els.average, formatCurrency(stats.average));

    if (!els.list) return;

    if (stats.events.length === 0) {
      els.list.innerHTML = `<p class="statsEmpty">Aucun évènement à afficher.</p>`;
      return;
    }

    els.list.innerHTML = stats.events.map((event) => `
      <article class="statsCard eventStatsCard">
        <div class="statsCardHeader">
          <div class="statsCardTitle">
            <strong>${escapeHtml(event.nom)}</strong>
            <span>
              ${escapeHtml(formatDisplayDate(event.date_debut))}${event.date_fin && event.date_fin !== event.date_debut ? ` → ${escapeHtml(formatDisplayDate(event.date_fin))}` : ""}
              ${event.ville ? ` · ${escapeHtml(event.ville)}` : ""}
            </span>
          </div>
          <strong class="statsAmount">${escapeHtml(formatCurrency(event.ca))}</strong>
        </div>
        <div class="statsMeta">
          <span>${escapeHtml(event.type_evenement_label || "Évènement")}</span>
          <span>${escapeHtml(String(event.tickets))} ticket${event.tickets > 1 ? "s" : ""}</span>
          <span>${escapeHtml(String(event.journees_count))} journée${event.journees_count > 1 ? "s" : ""}</span>
          <span>Frais ${escapeHtml(formatCurrency(event.frais))}</span>
          <span>Net ${escapeHtml(formatCurrency(event.net))}</span>
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
        state.filters.year = els.year.value || "ALL";
        render();
      });
    }

    if (els.search) {
      els.search.addEventListener("input", () => {
        state.filters.search = els.search.value || "";
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
