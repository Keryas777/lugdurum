(() => {
  "use strict";

  /*
    Stats année V3 :
    - API Google Sheets prioritaire.
    - Aucun chiffre local affiché avant la réponse API.
    - Cache/localStorage uniquement si l’API est indisponible.
    - Reconstitue les journées à partir des transactions, frais et journées connues.
    - La date officielle vient de journees_vente.date quand elle existe.
    - Remplace la notion de tickets par encaissements pour les saisies historiques.
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

  const EVENT_TYPE_LABELS = {
    MARCHE_ARTISANAL: "Marché artisanal",
    SALON_DES_VINS: "Salon des vins",
    MARCHE_DE_NOEL: "Marché de Noël",
    FOIRE: "Foire",
    CAVISTE: "Caviste / pro",
    COMMANDE_DIRECTE: "Commande directe",
    AUTRE: "Autre"
  };

  const PAYMENT_LABELS = {
    CB: "CB",
    ESP: "Espèces",
    CHQ: "Chèque",
    SUMUP: "SumUp",
    HISTORIQUE: "Historique",
    WEBAPP_ESPECES: "Espèces",
    WEBAPP_CHEQUE: "Chèque",
    WEBAPP_CB_MANUEL: "CB manuel",
    MANUEL: "Manuel"
  };

  const state = {
    source: "loading",
    transactions: [],
    frais: [],
    journees: [],
    missionsStock: [],
    missions: [],
    selectedYear: "ALL",
    selectedType: "ALL"
  };

  const els = {
    year: document.getElementById("yearSelect"),
    type: document.getElementById("typeSelect"),
    revenue: document.getElementById("yearTotalRevenue"),
    days: document.getElementById("yearDayCount"),
    average: document.getElementById("yearAverage"),
    bestDay: document.getElementById("yearBestDay"),
    payments: document.getElementById("paymentBreakdown"),
    list: document.getElementById("yearList"),
    status: document.getElementById("statsYearStatus")
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

  const escapeAttr = (value) =>
    escapeHtml(value).replaceAll("`", "&#096;");

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

  const normalizeText = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

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
    els.status.className = "statsYearStatus";

    if (type) {
      els.status.classList.add(type);
    }
  };

  const isValidStatus = (item) => {
    const statut = String(item?.statut || item?.paiement_statut || "validee")
      .trim()
      .toLowerCase();

    return ![
      "annule",
      "annulee",
      "annulé",
      "annulée",
      "refuse",
      "refusé",
      "refusee",
      "refusée"
    ].includes(statut);
  };

  const getTransactionAmount = (transaction) =>
    toNumber(
      transaction?.total_encaisse_ttc ??
      transaction?.total_encaisse ??
      transaction?.total_catalogue_ttc ??
      transaction?.total_catalogue,
      0
    );

  const getFraisAmount = (frais) =>
    toNumber(
      frais?.montant_ttc ??
      frais?.montant ??
      frais?.prix ??
      frais?.amount,
      0
    );

  const getMissionIdFromItem = (item) =>
    String(item?.stock_mission_id || item?.mission_id || item?.evenement_id || "")
      .trim();

  const getJourneeIdFromItem = (item) =>
    String(item?.journee_id || item?.day_id || "").trim();

  const getPaymentKey = (transaction) =>
    String(
      transaction?.mode_paiement ||
      transaction?.paiement_provider ||
      transaction?.source ||
      "MANUEL"
    )
      .trim()
      .toUpperCase();

  const getTransactionDate = (transaction) =>
    String(
      transaction?.date_heure ||
      transaction?.date ||
      transaction?.created_at ||
      ""
    ).slice(0, 10);

  const getFraisDate = (frais) =>
    String(
      frais?.date ||
      frais?.date_heure ||
      frais?.created_at ||
      ""
    ).slice(0, 10);

  const getMissionsById = () =>
    state.missions.reduce((map, mission) => {
      const id = String(mission.mission_id || "").trim();

      if (id) {
        map.set(id, mission);
      }

      return map;
    }, new Map());

  const getStockMissionsById = () =>
    state.missionsStock.reduce((map, mission) => {
      const id = String(mission.mission_id || "").trim();

      if (id) {
        map.set(id, mission);
      }

      return map;
    }, new Map());

  const getJourneesById = () =>
    state.journees.reduce((map, journee) => {
      const id = String(journee.journee_id || "").trim();

      if (id) {
        map.set(id, journee);
      }

      return map;
    }, new Map());

  const resolveContext = ({ journee = null, missionId = "" } = {}) => {
    const missionsById = getMissionsById();
    const stockMissionsById = getStockMissionsById();

    const stockMissionId =
      String(journee?.stock_mission_id || "").trim() ||
      missionId;

    const stockMission =
      stockMissionsById.get(stockMissionId) ||
      null;

    const eventMissionId =
      String(journee?.evenement_id || "").trim() ||
      String(journee?.mission_id || "").trim() ||
      String(stockMission?.evenement_id || "").trim() ||
      missionId;

    const eventMission =
      missionsById.get(eventMissionId) ||
      missionsById.get(missionId) ||
      null;

    const type =
      String(
        eventMission?.type_evenement ||
        stockMission?.type_evenement ||
        journee?.type_evenement ||
        "AUTRE"
      )
        .trim()
        .toUpperCase();

    const typeLabel =
      eventMission?.type_evenement_label ||
      stockMission?.type_evenement_label ||
      journee?.type_evenement_label ||
      EVENT_TYPE_LABELS[type] ||
      type;

    const missionName =
      stockMission?.nom ||
      eventMission?.nom ||
      journee?.nom ||
      journee?.evenement ||
      "Journée";

    const dayLabel = String(journee?.jour_label || "").trim();

    return {
      stockMission,
      eventMission,
      type,
      typeLabel,
      label: [missionName, dayLabel].filter(Boolean).join(" — "),
      ville:
        eventMission?.ville ||
        stockMission?.ville ||
        journee?.ville ||
        "",
      date:
        journee?.date ||
        stockMission?.date_debut ||
        eventMission?.date_debut ||
        ""
    };
  };

  const addPayment = (summary, transaction) => {
    const key = getPaymentKey(transaction);

    const current = summary.paiements.get(key) || {
      key,
      label: PAYMENT_LABELS[key] || key,
      total: 0,
      count: 0
    };

    current.total += getTransactionAmount(transaction);
    current.count += 1;

    summary.paiements.set(key, current);
  };

  const buildDaySummaries = () => {
    const journeesById = getJourneesById();
    const map = new Map();

    const getOrCreate = ({ journeeId = "", missionId = "", fallbackDate = "" }) => {
      const journee = journeeId ? journeesById.get(journeeId) : null;
      const context = resolveContext({ journee, missionId });

      const officialDate =
        journee?.date ||
        context.date ||
        fallbackDate ||
        "";

      const key =
        journeeId ||
        `${missionId || "NO_MISSION"}_${officialDate || "NO_DATE"}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          journee_id: journeeId,
          mission_id: missionId || getMissionIdFromItem(journee || {}),
          date: officialDate,
          year: getYearFromDate(officialDate),
          label: context.label,
          ville: context.ville,
          type: context.type,
          typeLabel: context.typeLabel,
          statut: journee?.statut || "",
          ca: 0,
          frais: 0,
          encaissements: 0,
          paiements: new Map()
        });
      }

      const summary = map.get(key);

      if (journee?.date && summary.date !== journee.date) {
        summary.date = journee.date;
        summary.year = getYearFromDate(journee.date);
      } else if (!summary.date && officialDate) {
        summary.date = officialDate;
        summary.year = getYearFromDate(officialDate);
      }

      if (!summary.label || summary.label === "Journée") {
        summary.label = context.label;
      }

      if (!summary.ville) {
        summary.ville = context.ville;
      }

      if (!summary.type || summary.type === "AUTRE") {
        summary.type = context.type;
        summary.typeLabel = context.typeLabel;
      }

      if (!summary.statut && journee?.statut) {
        summary.statut = journee.statut;
      }

      return summary;
    };

    state.journees
      .filter((journee) => String(journee.statut || "").toLowerCase() === "cloture")
      .forEach((journee) => {
        getOrCreate({
          journeeId: getJourneeIdFromItem(journee),
          missionId: getMissionIdFromItem(journee),
          fallbackDate: journee.date || ""
        });
      });

    state.transactions
      .filter(isValidStatus)
      .forEach((transaction) => {
        const journeeId = getJourneeIdFromItem(transaction);
        const missionId = getMissionIdFromItem(transaction);
        const transactionDate = getTransactionDate(transaction);

        const summary = getOrCreate({
          journeeId,
          missionId,
          fallbackDate: journeeId ? "" : transactionDate
        });

        summary.ca += getTransactionAmount(transaction);
        summary.encaissements += 1;

        addPayment(summary, transaction);

        if (!summary.year) {
          summary.year = getYearFromDate(summary.date || transactionDate);
        }

        if (!summary.date) {
          summary.date = transactionDate;
        }
      });

    state.frais
      .filter(isValidStatus)
      .forEach((item) => {
        const journeeId = getJourneeIdFromItem(item);
        const missionId = getMissionIdFromItem(item);
        const fraisDate = getFraisDate(item);

        const summary = getOrCreate({
          journeeId,
          missionId,
          fallbackDate: journeeId ? "" : fraisDate
        });

        summary.frais += getFraisAmount(item);

        if (!summary.year) {
          summary.year = getYearFromDate(summary.date || fraisDate);
        }

        if (!summary.date) {
          summary.date = fraisDate;
        }
      });

    return [...map.values()]
      .filter((item) => (
        item.year &&
        (
          String(item.statut || "").toLowerCase() === "cloture" ||
          item.ca > 0 ||
          item.encaissements > 0 ||
          item.frais > 0
        )
      ))
      .map((item) => ({
        ...item,
        paiements: [...item.paiements.values()].sort((a, b) => b.total - a.total)
      }))
      .sort((a, b) => {
        const byDate = String(b.date).localeCompare(String(a.date));
        if (byDate !== 0) return byDate;
        return String(a.label).localeCompare(String(b.label));
      });
  };

  const getAvailableYears = () => {
    const years = new Set();

    buildDaySummaries().forEach((day) => {
      if (day.year) {
        years.add(day.year);
      }
    });

    return [...years].sort((a, b) => b.localeCompare(a));
  };

  const getAvailableTypes = () => {
    const types = new Map();

    buildDaySummaries()
      .filter((day) => {
        if (state.selectedYear === "ALL") return true;
        return day.year === state.selectedYear;
      })
      .forEach((day) => {
        const key = day.type || "AUTRE";
        types.set(key, day.typeLabel || EVENT_TYPE_LABELS[key] || key);
      });

    return [...types.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => normalizeText(a.label).localeCompare(normalizeText(b.label)));
  };

  const syncYearFilter = () => {
    if (!els.year) return;

    const current = els.year.value || state.selectedYear;
    const years = getAvailableYears();

    els.year.innerHTML = `
      <option value="ALL">Toutes</option>
      ${years.map((year) => `
        <option value="${escapeAttr(year)}">${escapeHtml(year)}</option>
      `).join("")}
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

  const syncTypeFilter = () => {
    if (!els.type) return;

    const current = els.type.value || state.selectedType;
    const types = getAvailableTypes();
    const typeKeys = types.map((item) => item.key);

    els.type.innerHTML = `
      <option value="ALL">Tous</option>
      ${types.map((item) => `
        <option value="${escapeAttr(item.key)}">${escapeHtml(item.label)}</option>
      `).join("")}
    `;

    if (current === "ALL" || typeKeys.includes(current)) {
      els.type.value = current;
      state.selectedType = current;
    } else {
      els.type.value = "ALL";
      state.selectedType = "ALL";
    }
  };

  const getFilteredDays = () =>
    buildDaySummaries()
      .filter((day) => {
        if (state.selectedYear === "ALL") return true;
        return day.year === state.selectedYear;
      })
      .filter((day) => {
        if (state.selectedType === "ALL") return true;
        return day.type === state.selectedType;
      });

  const compute = () => {
    const days = getFilteredDays();
    const ca = days.reduce((sum, day) => sum + day.ca, 0);
    const frais = days.reduce((sum, day) => sum + day.frais, 0);
    const encaissements = days.reduce((sum, day) => sum + day.encaissements, 0);
    const activeDays = days.filter((day) => day.ca > 0 || day.encaissements > 0).length;

    const bestDay = days.reduce((best, day) => {
      if (!best || day.ca > best.ca) return day;
      return best;
    }, null);

    const payments = new Map();

    days.forEach((day) => {
      day.paiements.forEach((payment) => {
        const current = payments.get(payment.key) || {
          key: payment.key,
          label: payment.label,
          total: 0,
          count: 0
        };

        current.total += payment.total;
        current.count += payment.count;
        payments.set(payment.key, current);
      });
    });

    return {
      days,
      ca,
      frais,
      encaissements,
      activeDays,
      average: activeDays > 0 ? ca / activeDays : 0,
      bestDay,
      payments: [...payments.values()].sort((a, b) => b.total - a.total)
    };
  };

  const renderPayments = (payments) => {
    if (!els.payments) return;

    if (!payments.length) {
      els.payments.innerHTML = `<p class="statsEmpty">Aucun paiement à afficher.</p>`;
      return;
    }

    els.payments.innerHTML = payments.map((payment) => `
      <article class="paymentCard">
        <span>${escapeHtml(payment.label)}</span>
        <strong>${escapeHtml(formatCurrency(payment.total))}</strong>
        <small>${escapeHtml(String(payment.count))} encaissement${payment.count > 1 ? "s" : ""}</small>
      </article>
    `).join("");
  };

  const renderList = (days) => {
    if (!els.list) return;

    if (!days.length) {
      els.list.innerHTML = `<p class="statsEmpty">Aucune journée à afficher.</p>`;
      return;
    }

    els.list.innerHTML = days.map((day) => `
      <article class="statsCard yearDayCard">
        <div class="statsCardHeader">
          <div class="statsCardTitle">
            <strong>${escapeHtml(day.label || "Journée")}</strong>
            <span>
              ${escapeHtml(formatDisplayDate(day.date))}
              ${day.ville ? ` · ${escapeHtml(day.ville)}` : ""}
              ${day.typeLabel ? ` · ${escapeHtml(day.typeLabel)}` : ""}
            </span>
          </div>

          <strong class="statsAmount">${escapeHtml(formatCurrency(day.ca))}</strong>
        </div>

        <div class="statsMeta">
          <span>${escapeHtml(String(day.encaissements))} encaissement${day.encaissements > 1 ? "s" : ""}</span>
          <span>Frais ${escapeHtml(formatCurrency(day.frais))}</span>
          <span>Net ${escapeHtml(formatCurrency(day.ca - day.frais))}</span>
        </div>
      </article>
    `).join("");
  };

  const render = () => {
    syncYearFilter();
    syncTypeFilter();

    const stats = compute();

    setText(els.revenue, formatCurrency(stats.ca));
    setText(els.days, String(stats.activeDays));
    setText(els.average, formatCurrency(stats.average));
    setText(
      els.bestDay,
      stats.bestDay && stats.bestDay.ca > 0
        ? formatCurrency(stats.bestDay.ca)
        : "—"
    );

    renderPayments(stats.payments);
    renderList(stats.days);
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
        state.selectedType = "ALL";
        render();
      });
    }

    if (els.type) {
      els.type.addEventListener("change", () => {
        state.selectedType = els.type.value || "ALL";
        render();
      });
    }
  };

  const setLoadingUi = () => {
    if (els.year) {
      els.year.innerHTML = `<option value="">Chargement…</option>`;
    }

    if (els.type) {
      els.type.innerHTML = `<option value="">Chargement…</option>`;
    }

    setText(els.revenue, "—");
    setText(els.days, "—");
    setText(els.average, "—");
    setText(els.bestDay, "—");

    if (els.payments) {
      els.payments.innerHTML = `<p class="statsEmpty">Chargement…</p>`;
    }

    if (els.list) {
      els.list.innerHTML = `<p class="statsEmpty">Chargement…</p>`;
    }

    setStatus("Chargement…");
  };

  const init = async () => {
    bindEvents();
    setLoadingUi();

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