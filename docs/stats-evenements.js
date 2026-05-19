(() => {
  "use strict";

  /*
    Stats évènements V3 :
    - API Google Sheets prioritaire.
    - Aucun rendu local avant la réponse API.
    - Cache/localStorage uniquement si l’API est indisponible.
    - Regroupe CA, frais, tickets et journées par évènement réel.
    - Source principale de rattachement : journees_vente.
    - Supporte les historiques SAISIE_HISTORIQUE.
    - Ne filtre plus les EVT_HIST_ / MST_HIST_ / J_HIST_.
    - L’année vient de la date réelle de journée / mission, pas de created_at.
    - Remplit les sélecteurs Année + Type.
    - Gère les transactions dont mission_id pointe vers une mission stock.
    - Gère les frais liés à une journée, une mission stock ou une mission vente.
  */

  const CACHE_KEYS = {
    transactions: "lugdurum_transactions_cache",
    frais: "lugdurum_frais_cache",
    journees: "lugdurum_journees_cache",
    missionsStock: "lugdurum_missions_stock_cache",
    missions: "lugdurum_missions_vente_cache"
  };

  const LEGACY_KEYS = {
    transactions: [
      "lugdurum_transactions_cache",
      "lugdurum_transactions",
      "lugdurum_transactions_backup",
      "lugdurum_pending_transactions"
    ],
    frais: [
      "lugdurum_frais_cache",
      "lugdurum_frais"
    ],
    journees: [
      "lugdurum_journees_cache",
      "lugdurum_journees"
    ],
    missionsStock: [
      "lugdurum_missions_stock_cache",
      "lugdurum_missions_stock"
    ],
    missions: [
      "lugdurum_missions_vente_cache",
      "lugdurum_evenements"
    ]
  };

  const INVALID_STATUSES = [
    "annule",
    "annulee",
    "annulé",
    "annulée",
    "refuse",
    "refusé",
    "refusee",
    "refusée",
    "rembourse",
    "remboursé",
    "remboursee",
    "remboursée"
  ];

  const DEFAULT_TYPE_LABELS = {
    MARCHE_ARTISANAL: "Marché artisanal",
    SALON_DES_VINS: "Salon des vins",
    MARCHE_DE_NOEL: "Marché de Noël",
    FOIRE: "Foire",
    CAVISTE: "Caviste / pro",
    COMMANDE_DIRECTE: "Commande directe",
    AUTRE: "Autre"
  };

  const state = {
    source: "loading",
    loadError: "",
    transactions: [],
    frais: [],
    journees: [],
    missionsStock: [],
    missions: [],
    filters: {
      year: "ALL",
      type: "ALL",
      search: ""
    }
  };

  const byId = (...ids) =>
    ids.map((id) => document.getElementById(id)).find(Boolean) || null;

  const firstSelector = (...selectors) =>
    selectors.map((selector) => document.querySelector(selector)).find(Boolean) || null;

  const els = {
    year: byId(
      "statsEventsYearInput",
      "statsEvenementsYearInput",
      "statsEventsYearSelect",
      "statsEvenementsYearSelect",
      "eventYearFilter",
      "eventsYearFilter",
      "yearFilter"
    ),

    type: byId(
      "statsEventsTypeInput",
      "statsEvenementsTypeInput",
      "statsEventsTypeSelect",
      "statsEvenementsTypeSelect",
      "eventTypeFilter",
      "eventsTypeFilter",
      "typeFilter"
    ),

    search: byId(
      "statsEventsSearchInput",
      "statsEvenementsSearchInput",
      "eventSearchInput",
      "eventsSearchInput",
      "searchInput"
    ),

    revenue: byId(
      "statsEventsRevenue",
      "statsEvenementsRevenue",
      "eventRevenue",
      "eventsRevenue",
      "statsRevenue"
    ),

    expenses: byId(
      "statsEventsExpenses",
      "statsEvenementsExpenses",
      "eventExpenses",
      "eventsExpenses",
      "statsExpenses"
    ),

    count: byId(
      "statsEventsCount",
      "statsEvenementsCount",
      "eventCount",
      "eventsCount",
      "statsCount"
    ),

    average: byId(
      "statsEventsAverage",
      "statsEvenementsAverage",
      "eventAverage",
      "eventsAverage",
      "statsAverage"
    ),

    best: byId(
      "statsEventsBest",
      "statsEvenementsBest",
      "eventBest",
      "eventsBest",
      "bestEvent",
      "statsBest"
    ),

    list: byId(
      "statsEventsList",
      "statsEvenementsList",
      "eventsList",
      "statsList"
    ),

    status: byId(
      "statsEventsStatus",
      "statsEvenementsStatus",
      "eventsStatus",
      "statsStatus"
    )
  };

  const api = () => window.LugdurumAPI || null;
  const hasApi = () => Boolean(api());

  const waitForApi = (timeoutMs = 1500) =>
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

  const readJsonNullable = (key) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
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
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Cache non critique.
    }
  };

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

  const normalizeStatus = (value) => normalizeText(value);

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

  const parseDateText = (value) => {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : "";
  };

  const getYearFromDate = (value) => {
    const date = parseDateText(value);
    return date ? date.slice(0, 4) : "";
  };

  const formatDisplayDate = (isoDate) => {
    const dateText = parseDateText(isoDate);

    if (!dateText) return "Date inconnue";

    const date = new Date(`${dateText}T12:00:00`);

    if (Number.isNaN(date.getTime())) return "Date inconnue";

    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
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
    const status = normalizeStatus(item?.statut ?? item?.paiement_statut ?? "validee");
    return !INVALID_STATUSES.includes(status);
  };

  const getEventMissionId = (item) =>
    String(
      item?.evenement_id ||
      item?.mission_vente_id ||
      item?.event_mission_id ||
      item?.event_id ||
      item?.mission_id ||
      ""
    ).trim();

  const getStockMissionId = (item) =>
    String(
      item?.stock_mission_id ||
      item?.mission_stock_id ||
      ""
    ).trim();

  const getAnyMissionId = (item) =>
    String(
      item?.stock_mission_id ||
      item?.mission_stock_id ||
      item?.mission_id ||
      item?.evenement_id ||
      item?.mission_vente_id ||
      ""
    ).trim();

  const getJourneeId = (item) =>
    String(item?.journee_id || item?.day_id || "").trim();

  const getTransactionId = (transaction) =>
    String(transaction?.transaction_id || transaction?.id || "").trim();

  const getMissionId = (mission) =>
    String(mission?.mission_id || mission?.evenement_id || "").trim();

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

  const getMissionVenteMap = () =>
    state.missions.reduce((map, mission) => {
      const id = getMissionId(mission);
      if (id) map.set(id, mission);
      return map;
    }, new Map());

  const getMissionStockMap = () =>
    state.missionsStock.reduce((map, mission) => {
      const id = getMissionId(mission);
      if (id) map.set(id, mission);
      return map;
    }, new Map());

  const getJourneeMap = () =>
    state.journees.reduce((map, journee) => {
      const id = getJourneeId(journee);
      if (id) map.set(id, journee);
      return map;
    }, new Map());

  const getStockToEventMap = () => {
    const map = new Map();

    state.missionsStock.forEach((missionStock) => {
      const stockId = getMissionId(missionStock);
      const eventId = String(
        missionStock?.evenement_id ||
        missionStock?.mission_vente_id ||
        missionStock?.event_id ||
        ""
      ).trim();

      if (stockId && eventId) {
        map.set(stockId, eventId);
      }
    });

    state.journees.forEach((journee) => {
      const stockId = getStockMissionId(journee);
      const eventId = getEventMissionId(journee);

      if (stockId && eventId) {
        map.set(stockId, eventId);
      }
    });

    return map;
  };

  const getEventDateFromJournees = (eventId) => {
    const dates = state.journees
      .filter(isValidStatus)
      .filter((journee) => getEventMissionId(journee) === eventId)
      .map((journee) => parseDateText(journee.date))
      .filter(Boolean)
      .sort();

    return {
      date_debut: dates[0] || "",
      date_fin: dates[dates.length - 1] || dates[0] || ""
    };
  };

  const getMissionTypeCode = (missionVente, missionStock) =>
    String(
      missionVente?.type_evenement ||
      missionStock?.type_evenement ||
      missionVente?.type ||
      missionStock?.type ||
      "AUTRE"
    ).trim() || "AUTRE";

  const getMissionTypeLabel = (missionVente, missionStock) => {
    const explicit = String(
      missionVente?.type_evenement_label ||
      missionStock?.type_evenement_label ||
      missionVente?.type_label ||
      missionStock?.type_label ||
      ""
    ).trim();

    if (explicit) return explicit;

    const code = getMissionTypeCode(missionVente, missionStock);
    return DEFAULT_TYPE_LABELS[code] || code || "Autre";
  };

  const getEventName = (missionVente, missionStock, fallback = "") =>
    String(
      missionVente?.nom ||
      missionVente?.evenement ||
      missionVente?.libelle ||
      missionStock?.nom ||
      missionStock?.evenement ||
      missionStock?.libelle ||
      fallback ||
      "Évènement inconnu"
    ).trim();

  const getEventCity = (missionVente, missionStock) =>
    String(
      missionVente?.ville ||
      missionStock?.ville ||
      ""
    ).trim();

  const resolveEventContext = (rawItem, helpers) => {
    const {
      journeeMap,
      missionVenteMap,
      missionStockMap,
      stockToEventMap
    } = helpers;

    const journeeId = getJourneeId(rawItem);
    const linkedJournee = journeeId ? journeeMap.get(journeeId) || null : null;

    const rawStockId = getStockMissionId(rawItem);
    const rawMissionId = String(rawItem?.mission_id || "").trim();
    const rawEventId = String(rawItem?.evenement_id || rawItem?.mission_vente_id || "").trim();

    const dayEventId = linkedJournee ? getEventMissionId(linkedJournee) : "";
    const dayStockId = linkedJournee ? getStockMissionId(linkedJournee) : "";

    const possibleStockId =
      rawStockId ||
      dayStockId ||
      (
        rawMissionId && missionStockMap.has(rawMissionId)
          ? rawMissionId
          : ""
      );

    const eventId =
      rawEventId ||
      dayEventId ||
      (
        rawMissionId && missionVenteMap.has(rawMissionId)
          ? rawMissionId
          : ""
      ) ||
      (
        possibleStockId && stockToEventMap.has(possibleStockId)
          ? stockToEventMap.get(possibleStockId)
          : ""
      ) ||
      rawMissionId ||
      possibleStockId ||
      "EVT_INCONNU";

    const stockId =
      possibleStockId ||
      (
        rawMissionId && missionStockMap.has(rawMissionId)
          ? rawMissionId
          : ""
      );

    const missionVente = missionVenteMap.get(eventId) || null;
    const missionStock =
      missionStockMap.get(stockId) ||
      (
        [...missionStockMap.values()].find((mission) => {
          const linkedEventId = String(
            mission?.evenement_id ||
            mission?.mission_vente_id ||
            ""
          ).trim();

          return linkedEventId && linkedEventId === eventId;
        }) || null
      );

    const date =
      parseDateText(linkedJournee?.date) ||
      parseDateText(rawItem?.date) ||
      parseDateText(rawItem?.date_heure) ||
      parseDateText(missionVente?.date_debut) ||
      parseDateText(missionStock?.date_debut) ||
      parseDateText(rawItem?.created_at);

    return {
      eventId,
      stockId,
      journee: linkedJournee,
      missionVente,
      missionStock,
      date
    };
  };

  const createSummaryFactory = () => {
    const missionVenteMap = getMissionVenteMap();
    const missionStockMap = getMissionStockMap();
    const journeeMap = getJourneeMap();
    const stockToEventMap = getStockToEventMap();

    const helpers = {
      missionVenteMap,
      missionStockMap,
      journeeMap,
      stockToEventMap
    };

    const summaries = new Map();

    const getOrCreate = (context, fallbackName = "") => {
      const key = context.eventId || "EVT_INCONNU";

      if (!summaries.has(key)) {
        const datesFromDays = getEventDateFromJournees(key);
        const missionVente = context.missionVente;
        const missionStock = context.missionStock;

        const dateDebut =
          parseDateText(missionVente?.date_debut) ||
          datesFromDays.date_debut ||
          parseDateText(missionStock?.date_debut) ||
          context.date ||
          "";

        const dateFin =
          parseDateText(missionVente?.date_fin) ||
          datesFromDays.date_fin ||
          parseDateText(missionStock?.date_fin) ||
          dateDebut ||
          "";

        summaries.set(key, {
          mission_id: key,
          stock_mission_id: context.stockId || "",
          nom: getEventName(missionVente, missionStock, fallbackName),
          ville: getEventCity(missionVente, missionStock),
          type_evenement: getMissionTypeCode(missionVente, missionStock),
          type_evenement_label: getMissionTypeLabel(missionVente, missionStock),
          date_debut: dateDebut,
          date_fin: dateFin,
          year: getYearFromDate(dateDebut || context.date),
          ca: 0,
          frais: 0,
          tickets: 0,
          journees: new Set(),
          hasData: false
        });
      }

      const summary = summaries.get(key);

      if (!summary.stock_mission_id && context.stockId) {
        summary.stock_mission_id = context.stockId;
      }

      if (!summary.year && context.date) {
        summary.year = getYearFromDate(context.date);
      }

      if (!summary.date_debut && context.date) {
        summary.date_debut = context.date;
      }

      if (!summary.date_fin && context.date) {
        summary.date_fin = context.date;
      }

      return summary;
    };

    return {
      summaries,
      helpers,
      getOrCreate
    };
  };

  const buildEventSummaries = () => {
    const { summaries, helpers, getOrCreate } = createSummaryFactory();

    state.journees
      .filter(isValidStatus)
      .forEach((journee) => {
        const context = resolveEventContext(journee, helpers);
        const summary = getOrCreate(context, journee.nom || journee.jour_label || "");

        const journeeId = getJourneeId(journee) || `${summary.mission_id}_${journee.date || ""}`;

        if (journeeId) {
          summary.journees.add(journeeId);
        }

        const dayDate = parseDateText(journee.date);

        if (dayDate) {
          if (!summary.date_debut || dayDate < summary.date_debut) {
            summary.date_debut = dayDate;
          }

          if (!summary.date_fin || dayDate > summary.date_fin) {
            summary.date_fin = dayDate;
          }

          summary.year = getYearFromDate(summary.date_debut);
        }
      });

    state.missions
      .filter(isValidStatus)
      .forEach((mission) => {
        const context = resolveEventContext(mission, helpers);
        getOrCreate(context, mission.nom || "");
      });

    state.missionsStock
      .filter(isValidStatus)
      .forEach((missionStock) => {
        const context = resolveEventContext(missionStock, helpers);
        getOrCreate(context, missionStock.nom || "");
      });

    state.transactions
      .filter(isValidStatus)
      .forEach((transaction) => {
        const context = resolveEventContext(transaction, helpers);
        const summary = getOrCreate(context);

        summary.ca += getTransactionAmount(transaction);
        summary.tickets += 1;
        summary.hasData = true;

        const journeeId = getJourneeId(transaction) || getJourneeId(context.journee);

        if (journeeId) {
          summary.journees.add(journeeId);
        }
      });

    state.frais
      .filter(isValidStatus)
      .forEach((item) => {
        const context = resolveEventContext(item, helpers);
        const summary = getOrCreate(context);

        summary.frais += getFraisAmount(item);
        summary.hasData = true;

        const journeeId = getJourneeId(item) || getJourneeId(context.journee);

        if (journeeId) {
          summary.journees.add(journeeId);
        }
      });

    return [...summaries.values()]
      .map((item) => ({
        ...item,
        ca: roundAmount(item.ca),
        frais: roundAmount(item.frais),
        net: roundAmount(item.ca - item.frais),
        journees_count: item.journees.size,
        year: item.year || getYearFromDate(item.date_debut)
      }))
      .sort((a, b) => {
        const byDate = String(b.date_debut || "").localeCompare(String(a.date_debut || ""));
        if (byDate !== 0) return byDate;

        return String(a.nom || "").localeCompare(String(b.nom || ""));
      });
  };

  const getAvailableYears = (events = buildEventSummaries()) => {
    const years = new Set();

    events.forEach((event) => {
      if (event.year) years.add(event.year);
    });

    return [...years].sort((a, b) => b.localeCompare(a));
  };

  const getAvailableTypes = (events = buildEventSummaries()) => {
    const map = new Map();

    events.forEach((event) => {
      const code = String(event.type_evenement || "AUTRE").trim() || "AUTRE";
      const label = String(event.type_evenement_label || DEFAULT_TYPE_LABELS[code] || code).trim();

      map.set(code, label);
    });

    return [...map.entries()]
      .map(([code, label]) => ({
        code,
        label
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };

  const syncYearFilter = (events) => {
    if (!els.year) return;

    const current = state.filters.year || els.year.value || "ALL";
    const years = getAvailableYears(events);

    els.year.innerHTML = `
      <option value="ALL">Toutes</option>
      ${years.map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join("")}
    `;

    if (current === "ALL" || years.includes(current)) {
      els.year.value = current;
      state.filters.year = current;
      return;
    }

    els.year.value = "ALL";
    state.filters.year = "ALL";
  };

  const syncTypeFilter = (events) => {
    if (!els.type) return;

    const current = state.filters.type || els.type.value || "ALL";
    const types = getAvailableTypes(events);
    const typeCodes = types.map((item) => item.code);

    els.type.innerHTML = `
      <option value="ALL">Tous</option>
      ${types.map((item) => `
        <option value="${escapeHtml(item.code)}">${escapeHtml(item.label)}</option>
      `).join("")}
    `;

    if (current === "ALL" || typeCodes.includes(current)) {
      els.type.value = current;
      state.filters.type = current;
      return;
    }

    els.type.value = "ALL";
    state.filters.type = "ALL";
  };

  const getFilteredEvents = (events) => {
    const query = normalizeText(state.filters.search);

    return events
      .filter((event) => {
        if (state.filters.year === "ALL") return true;
        return event.year === state.filters.year;
      })
      .filter((event) => {
        if (state.filters.type === "ALL") return true;
        return String(event.type_evenement || "AUTRE") === state.filters.type;
      })
      .filter((event) => {
        if (!query) return true;

        return normalizeText(
          `${event.nom} ${event.ville} ${event.type_evenement_label} ${event.mission_id}`
        ).includes(query);
      });
  };

  const compute = () => {
    const allEvents = buildEventSummaries();

    syncYearFilter(allEvents);
    syncTypeFilter(allEvents);

    const events = getFilteredEvents(allEvents);
    const eventsWithData = events.filter((event) =>
      event.ca > 0 ||
      event.frais > 0 ||
      event.tickets > 0 ||
      event.journees_count > 0
    );

    const ca = events.reduce((sum, event) => sum + event.ca, 0);
    const frais = events.reduce((sum, event) => sum + event.frais, 0);
    const best = events
      .slice()
      .sort((a, b) => b.ca - a.ca)[0] || null;

    return {
      allEvents,
      events,
      ca: roundAmount(ca),
      frais: roundAmount(frais),
      activeEvents: eventsWithData.length,
      average: eventsWithData.length > 0 ? ca / eventsWithData.length : 0,
      best
    };
  };

  const renderLoading = () => {
    if (els.year) {
      els.year.innerHTML = `<option value="ALL">Chargement…</option>`;
    }

    if (els.type) {
      els.type.innerHTML = `<option value="ALL">Chargement…</option>`;
    }

    setText(els.revenue, "—");
    setText(els.expenses, "—");
    setText(els.count, "—");
    setText(els.average, "—");
    setText(els.best, "—");

    if (els.list) {
      els.list.innerHTML = `<p class="statsEmpty">Chargement…</p>`;
    }

    setStatus("Chargement…");
  };

  const render = () => {
    const stats = compute();

    setText(els.revenue, formatCurrency(stats.ca));
    setText(els.expenses, formatCurrency(stats.frais));
    setText(els.count, String(stats.activeEvents));
    setText(els.average, formatCurrency(stats.average));
    setText(
      els.best,
      stats.best && stats.best.ca > 0
        ? `${stats.best.nom} · ${formatCurrency(stats.best.ca)}`
        : "—"
    );

    if (els.list) {
      if (stats.events.length === 0) {
        els.list.innerHTML = `<p class="statsEmpty">Aucun évènement à afficher.</p>`;
      } else {
        els.list.innerHTML = stats.events.map((event) => {
          const dateLabel =
            event.date_fin && event.date_fin !== event.date_debut
              ? `${formatDisplayDate(event.date_debut)} → ${formatDisplayDate(event.date_fin)}`
              : formatDisplayDate(event.date_debut);

          return `
            <article class="statsCard eventStatsCard">
              <div class="statsCardHeader">
                <div class="statsCardTitle">
                  <strong>${escapeHtml(event.nom)}</strong>
                  <span>
                    ${escapeHtml(dateLabel)}
                    ${event.ville ? ` · ${escapeHtml(event.ville)}` : ""}
                  </span>
                </div>

                <strong class="statsAmount">
                  ${escapeHtml(formatCurrency(event.ca))}
                </strong>
              </div>

              <div class="statsMeta">
                <span>${escapeHtml(event.type_evenement_label || "Évènement")}</span>
                <span>${escapeHtml(String(event.tickets))} ticket${event.tickets > 1 ? "s" : ""}</span>
                <span>${escapeHtml(String(event.journees_count))} journée${event.journees_count > 1 ? "s" : ""}</span>
                <span>Frais ${escapeHtml(formatCurrency(event.frais))}</span>
                <span>Net ${escapeHtml(formatCurrency(event.net))}</span>
              </div>
            </article>
          `;
        }).join("");
      }
    }

    if (state.source === "local") {
      setStatus(
        `API indisponible. Données locales affichées : ${state.loadError}`,
        "isError"
      );
      return;
    }

    if (state.source === "api" && stats.allEvents.length === 0) {
      setStatus(
        `Données chargées, mais aucun évènement exploitable. Missions : ${state.missions.length} · missions stock : ${state.missionsStock.length} · journées : ${state.journees.length} · transactions : ${state.transactions.length}`,
        "isError"
      );
      return;
    }

    setStatus("");
  };

  const callArray = async (fnName) => {
    if (!hasApi() || typeof api()[fnName] !== "function") {
      throw new Error(`Fonction API indisponible : ${fnName}`);
    }

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
      frais,
      journees,
      missionsStock,
      missions
    ] = await Promise.all([
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
    state.loadError = "";

    writeJson(CACHE_KEYS.transactions, transactions);
    writeJson(CACHE_KEYS.frais, frais);
    writeJson(CACHE_KEYS.journees, journees);
    writeJson(CACHE_KEYS.missionsStock, missionsStock);
    writeJson(CACHE_KEYS.missions, missions);
  };

  const loadLocalFallback = (error) => {
    state.transactions = readFirstArray(LEGACY_KEYS.transactions);
    state.frais = readFirstArray(LEGACY_KEYS.frais);
    state.journees = readFirstArray(LEGACY_KEYS.journees);
    state.missionsStock = readFirstArray(LEGACY_KEYS.missionsStock);
    state.missions = readFirstArray(LEGACY_KEYS.missions);
    state.source = "local";
    state.loadError = error?.message || "Lecture données impossible.";
  };

  const bindEvents = () => {
    if (els.year) {
      els.year.addEventListener("change", () => {
        state.filters.year = els.year.value || "ALL";
        render();
      });
    }

    if (els.type) {
      els.type.addEventListener("change", () => {
        state.filters.type = els.type.value || "ALL";
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
    renderLoading();

    try {
      await loadRemote();
    } catch (error) {
      loadLocalFallback(error);
    }

    render();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();