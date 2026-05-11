(() => {
  "use strict";

  /*
    Missions V4 :
    - Séparation claire :
      - Évènement = salon / marché / foire réel.
      - Mission de stock = stock partagé sur une ou plusieurs journées.
      - Journée = journée réelle de vente liée à un évènement et éventuellement à une mission de stock.
    - Un évènement peut être créé plusieurs mois à l’avance.
    - Un évènement peut durer un ou plusieurs jours.
    - Une mission de stock peut regrouper plusieurs journées issues d’évènements différents.
    - Exemple : Yzeron J1 + Salagnon J1/J2 avec le même stock.
    - Stockage localStorage provisoire avant connexion Google Sheets.
  */

  const OPERATORS = {
    U_JEROME: "Jérôme",
    U_ANTHO: "Antho",
    U_WILL: "Will"
  };

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme"
  };

  const STORAGE_KEYS = {
    events: "lugdurum_evenements",
    stockMissions: "lugdurum_missions_stock",
    journees: "lugdurum_journees",
    activeMissionId: "lugdurum_active_mission_id",
    activeStockMissionId: "lugdurum_active_stock_mission_id",
    activeJourneeId: "lugdurum_active_journee_id",
    preparationContext: "lugdurum_preparation_context",
    fraisContext: "lugdurum_frais_context"
  };

  const EVENT_KIND_LABELS = {
    MARCHE_ARTISANAL: "Marché artisanal",
    SALON_DES_VINS: "Salon des vins",
    MARCHE_DE_NOEL: "Marché de Noël",
    FOIRE: "Foire",
    AUTRE: "Autre"
  };

  const STATUS_LABELS = {
    brouillon: "Brouillon",
    prevu: "Prévu",
    stock_a_preparer: "Stock à préparer",
    pret: "Prêt",
    en_cours: "En cours",
    termine: "Terminé",
    cloture: "Clôturé",
    annule: "Annulé"
  };

  const state = {
    eventMode: "single",
    selectedOperators: new Set(["U_JEROME"]),
    selectedDayIds: new Set(),
    eventSubmitAction: "save",
    stockSubmitAction: "save"
  };

  const els = {
    eventForm: document.getElementById("eventForm"),
    stockMissionForm: document.getElementById("stockMissionForm"),

    eventNameInput: document.getElementById("eventNameInput"),
    eventKindInput: document.getElementById("eventKindInput"),
    locationInput: document.getElementById("locationInput"),
    cityInput: document.getElementById("cityInput"),
    startDateInput: document.getElementById("startDateInput"),
    endDateInput: document.getElementById("endDateInput"),
    endDateField: document.getElementById("endDateField"),
    startDateLabel: document.getElementById("startDateLabel"),
    noteInput: document.getElementById("noteInput"),

    otherOperatorField: document.getElementById("otherOperatorField"),
    otherOperatorInput: document.getElementById("otherOperatorInput"),

    dayPreviewList: document.getElementById("dayPreviewList"),
    eventsList: document.getElementById("eventsList"),

    stockMissionsList: document.getElementById("stockMissionsList"),
    stockMissionNameInput: document.getElementById("stockMissionNameInput"),
    stockMissionNoteInput: document.getElementById("stockMissionNoteInput"),
    stockDayList: document.getElementById("stockDayList"),
    stockMissionPreview: document.getElementById("stockMissionPreview"),

    resetEventBtn: document.getElementById("resetEventBtn"),
    resetStockMissionBtn: document.getElementById("resetStockMissionBtn"),

    eventStatus: document.getElementById("eventStatus"),
    stockMissionStatus: document.getElementById("stockMissionStatus")
  };

  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
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

  const escapeAttr = (value) =>
    escapeHtml(value).replaceAll("`", "&#096;");

  const slugify = (value, fallback = "ITEM") =>
    String(value || fallback)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 28) || fallback;

  const parseLocalDate = (value) => {
    if (!value) return null;

    const [year, month, day] = value.split("-").map(Number);

    if (!year || !month || !day) return null;

    return new Date(year, month - 1, day);
  };

  const formatIsoDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  };

  const formatDisplayDate = (isoDate) => {
    const date = parseLocalDate(isoDate);

    if (!date) return "Date inconnue";

    return new Intl.DateTimeFormat("fr-FR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  };

  const addDays = (date, days) => {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  };

  const getEvents = () => readJson(STORAGE_KEYS.events, []);

  const setEvents = (events) => writeJson(STORAGE_KEYS.events, events);

  const getStockMissions = () => readJson(STORAGE_KEYS.stockMissions, []);

  const setStockMissions = (stockMissions) =>
    writeJson(STORAGE_KEYS.stockMissions, stockMissions);

  const getJournees = () => readJson(STORAGE_KEYS.journees, []);

  const setJournees = (journees) => writeJson(STORAGE_KEYS.journees, journees);

  const getEventById = (eventId) =>
    getEvents().find((eventItem) => eventItem.evenement_id === eventId);

  const getStockMissionById = (missionId) =>
    getStockMissions().find((mission) => mission.mission_id === missionId);

  const setEventStatus = (message, type = "") => {
    els.eventStatus.textContent = message;
    els.eventStatus.className = "missionStatus";

    if (type) {
      els.eventStatus.classList.add(type);
    }
  };

  const setStockStatus = (message, type = "") => {
    els.stockMissionStatus.textContent = message;
    els.stockMissionStatus.className = "missionStatus";

    if (type) {
      els.stockMissionStatus.classList.add(type);
    }
  };

  const getDateRange = () => {
    const start = parseLocalDate(els.startDateInput.value);
    const end =
      state.eventMode === "multi"
        ? parseLocalDate(els.endDateInput.value)
        : start;

    if (!start || !end) return [];
    if (end < start) return [];

    const dates = [];
    let cursor = new Date(start);

    while (cursor <= end && dates.length < 15) {
      dates.push(formatIsoDate(cursor));
      cursor = addDays(cursor, 1);
    }

    return dates;
  };

  const getOperatorLabels = (source) => {
    const values = Array.isArray(source?.vendeurs_prevus)
      ? source.vendeurs_prevus
      : [];

    return values
      .map((operator) => {
        if (typeof operator === "string") return OPERATORS[operator] || operator;
        return operator.nom || OPERATORS[operator.user_id] || operator.user_id || "";
      })
      .filter(Boolean);
  };

  const getSelectedOperatorsPayload = () => {
    const payload = [...state.selectedOperators]
      .filter((operatorId) => operatorId !== "AUTRE")
      .map((operatorId) => ({
        user_id: operatorId,
        nom: OPERATORS[operatorId] || operatorId
      }));

    if (state.selectedOperators.has("AUTRE")) {
      const otherName = els.otherOperatorInput.value.trim();

      if (otherName) {
        payload.push({
          user_id: "AUTRE",
          nom: otherName
        });
      }
    }

    return payload;
  };

  const getEventJournees = (eventId) =>
    getJournees()
      .filter((journee) => journee.evenement_id === eventId)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const getStockMissionJournees = (missionId) =>
    getJournees()
      .filter((journee) => journee.mission_id === missionId)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const getFirstOpenDayForStockMission = (missionId) => {
    const jours = getStockMissionJournees(missionId);

    return (
      jours.find((journee) => journee.statut !== "cloture" && journee.statut !== "annule") ||
      jours[0]
    );
  };

  const getDateLabel = (item) => {
    if (!item?.date_debut) return "Date inconnue";

    if (item.date_debut === item.date_fin) {
      return formatDisplayDate(item.date_debut);
    }

    return `${formatDisplayDate(item.date_debut)} → ${formatDisplayDate(item.date_fin)}`;
  };

  const getStatusClass = (statut) => {
    if (statut === "pret") return "isReady";
    if (statut === "en_cours") return "isActive";
    if (statut === "stock_a_preparer") return "isWarning";
    return "";
  };

  const getJourneeTitle = (journee) => {
    const eventItem = getEventById(journee.evenement_id);

    if (!eventItem) {
      return `${journee.jour_label} · ${formatDisplayDate(journee.date)}`;
    }

    const dayPart = eventItem.date_debut === eventItem.date_fin
      ? ""
      : ` ${journee.jour_label}`;

    return `${eventItem.nom}${dayPart}`;
  };

  const renderEventMode = () => {
    document.querySelectorAll("[data-event-mode]").forEach((button) => {
      const isActive = button.dataset.eventMode === state.eventMode;

      button.classList.toggle("isActive", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    const isMulti = state.eventMode === "multi";

    els.endDateField.hidden = !isMulti;
    els.startDateLabel.textContent = isMulti ? "Date de début" : "Date";

    if (!isMulti) {
      els.endDateInput.value = "";
    }
  };

  const renderOperators = () => {
    document.querySelectorAll("[data-operator]").forEach((button) => {
      const isActive = state.selectedOperators.has(button.dataset.operator);

      button.classList.toggle("isActive", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    const hasOther = state.selectedOperators.has("AUTRE");

    els.otherOperatorField.hidden = !hasOther;

    if (!hasOther) {
      els.otherOperatorInput.value = "";
    }
  };

  const renderDayPreview = () => {
    const dates = getDateRange();

    if (!els.startDateInput.value) {
      els.dayPreviewList.innerHTML =
        `<p class="missionEmpty">Choisis une date pour générer J1.</p>`;
      return;
    }

    if (state.eventMode === "multi" && !els.endDateInput.value) {
      els.dayPreviewList.innerHTML =
        `<p class="missionEmpty">Choisis une date de fin pour générer les journées.</p>`;
      return;
    }

    if (dates.length === 0) {
      els.dayPreviewList.innerHTML =
        `<p class="missionEmpty">La date de fin doit être après la date de début.</p>`;
      return;
    }

    if (dates.length >= 15) {
      els.dayPreviewList.innerHTML =
        `<p class="missionEmpty">Évènement trop long pour cette V1. Limite provisoire : 14 jours.</p>`;
      return;
    }

    els.dayPreviewList.innerHTML = dates
      .map((date, index) => `
        <article class="dayPreviewItem">
          <div>
            <strong>${escapeHtml(formatDisplayDate(date))}</strong>
            <span>${index === 0 ? "Première journée" : `Journée ${index + 1}`}</span>
          </div>
          <span class="dayBadge">J${index + 1}</span>
        </article>
      `)
      .join("");
  };

  const setPreparationContext = (missionId, journeeId) => {
    localStorage.setItem(STORAGE_KEYS.activeMissionId, missionId);
    localStorage.setItem(STORAGE_KEYS.activeStockMissionId, missionId);
    localStorage.setItem(STORAGE_KEYS.activeJourneeId, journeeId);

    writeJson(STORAGE_KEYS.preparationContext, {
      mission_id: missionId,
      stock_mission_id: missionId,
      journee_id: journeeId,
      step: "preparation_stock",
      updated_at: new Date().toISOString()
    });
  };

  const setFraisContext = (missionId) => {
    localStorage.setItem(STORAGE_KEYS.activeMissionId, missionId);
    localStorage.setItem(STORAGE_KEYS.activeStockMissionId, missionId);

    writeJson(STORAGE_KEYS.fraisContext, {
      mission_id: missionId,
      stock_mission_id: missionId,
      journee_id: "",
      source: "missions",
      updated_at: new Date().toISOString()
    });
  };

  const createEvent = () => {
    const name = els.eventNameInput.value.trim();
    const startDate = els.startDateInput.value;
    const dates = getDateRange();
    const operators = getSelectedOperatorsPayload();

    if (!name) {
      setEventStatus("Indique le nom de l’évènement.", "isError");
      return null;
    }

    if (!startDate || dates.length === 0) {
      setEventStatus("Indique une date valide.", "isError");
      return null;
    }

    if (dates.length >= 15) {
      setEventStatus("Évènement trop long pour cette V1. Limite provisoire : 14 jours.", "isError");
      return null;
    }

    if (operators.length === 0) {
      setEventStatus("Indique au moins une personne prévue sur l’évènement.", "isError");
      return null;
    }

    const now = new Date().toISOString();
    const slug = slugify(name, "EVENEMENT");
    const stamp = Date.now().toString(36).toUpperCase();

    const eventId = `EVT_${dates[0].replaceAll("-", "")}_${slug}_${stamp}`;

    const eventItem = {
      evenement_id: eventId,
      nom: name,
      date_debut: dates[0],
      date_fin: dates[dates.length - 1],
      lieu: els.locationInput.value.trim(),
      ville: els.cityInput.value.trim(),
      type_evenement: els.eventKindInput.value,
      type_evenement_label: EVENT_KIND_LABELS[els.eventKindInput.value],
      duree_type: state.eventMode === "multi" ? "PLUSIEURS_JOURS" : "JOURNEE_UNIQUE",
      statut: "prevu",
      vendeurs_prevus: operators,
      responsable_user_id: CURRENT_USER.user_id,
      note: els.noteInput.value.trim(),
      created_at: now,
      updated_at: now
    };

    const jours = dates.map((date, index) => ({
      journee_id: `J_${date.replaceAll("-", "")}_${slug}_J${index + 1}_${stamp}`,
      evenement_id: eventId,
      mission_id: "",
      stock_mission_id: "",
      date,
      jour_label: `J${index + 1}`,
      statut: "prevu",
      meteo: "",
      affluence_ressentie: "",
      note: "",
      created_at: now,
      updated_at: now
    }));

    const events = getEvents();
    const journees = getJournees();

    events.push(eventItem);
    journees.push(...jours);

    setEvents(events);
    setJournees(journees);

    setEventStatus("Évènement enregistré.", "isSuccess");

    return {
      eventItem,
      jours
    };
  };

  const createStockMission = ({ fromDays = null } = {}) => {
    const selectedDayIds = Array.isArray(fromDays)
      ? fromDays.map((journee) => journee.journee_id)
      : [...state.selectedDayIds];

    const allJournees = getJournees();
    const selectedDays = selectedDayIds
      .map((journeeId) => allJournees.find((journee) => journee.journee_id === journeeId))
      .filter(Boolean)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const name = els.stockMissionNameInput.value.trim() ||
      buildDefaultStockMissionName(selectedDays);

    if (selectedDays.length === 0) {
      setStockStatus("Sélectionne au moins une journée pour cette mission de stock.", "isError");
      return null;
    }

    if (!name) {
      setStockStatus("Indique le nom de la mission de stock.", "isError");
      return null;
    }

    const now = new Date().toISOString();
    const slug = slugify(name, "STOCK");
    const stamp = Date.now().toString(36).toUpperCase();
    const missionId = `MST_${selectedDays[0].date.replaceAll("-", "")}_${slug}_${stamp}`;

    const mission = {
      mission_id: missionId,
      nom: name,
      date_debut: selectedDays[0].date,
      date_fin: selectedDays[selectedDays.length - 1].date,
      statut: "stock_a_preparer",
      stock_prepare: false,
      responsable_user_id: CURRENT_USER.user_id,
      journees_count: selectedDays.length,
      note: els.stockMissionNoteInput.value.trim(),
      created_at: now,
      updated_at: now
    };

    const selectedSet = new Set(selectedDayIds);

    const updatedJournees = allJournees.map((journee) => {
      if (!selectedSet.has(journee.journee_id)) return journee;

      return {
        ...journee,
        mission_id: missionId,
        stock_mission_id: missionId,
        statut: journee.statut === "prevu" ? "stock_a_preparer" : journee.statut,
        updated_at: now
      };
    });

    const stockMissions = getStockMissions();

    stockMissions.push(mission);

    setStockMissions(stockMissions);
    setJournees(updatedJournees);

    state.selectedDayIds = new Set();

    setStockStatus("Mission de stock enregistrée.", "isSuccess");

    return {
      mission,
      jours: selectedDays
    };
  };

  const buildDefaultStockMissionName = (days) => {
    if (!days.length) return "";

    const events = [...new Set(days.map((day) => day.evenement_id))]
      .map((eventId) => getEventById(eventId))
      .filter(Boolean);

    if (events.length === 1) {
      return events[0].nom;
    }

    return `Stock partagé ${formatDisplayDate(days[0].date)} → ${formatDisplayDate(days[days.length - 1].date)}`;
  };

  const renderEventsList = () => {
    const today = formatIsoDate(new Date());

    const events = getEvents()
      .slice()
      .filter((eventItem) => eventItem.statut !== "annule")
      .filter((eventItem) => eventItem.statut !== "cloture" || eventItem.date_fin >= today)
      .sort((a, b) => {
        const byDate = String(a.date_debut).localeCompare(String(b.date_debut));
        if (byDate !== 0) return byDate;
        return String(a.created_at).localeCompare(String(b.created_at));
      });

    if (events.length === 0) {
      els.eventsList.innerHTML =
        `<p class="missionEmpty">Aucun évènement enregistré pour l’instant.</p>`;
      return;
    }

    els.eventsList.innerHTML = events
      .map((eventItem) => {
        const jours = getEventJournees(eventItem.evenement_id);
        const place = [eventItem.lieu, eventItem.ville].filter(Boolean).join(" · ");
        const operatorLabels = getOperatorLabels(eventItem);
        const statusClass = getStatusClass(eventItem.statut);
        const statusLabel = STATUS_LABELS[eventItem.statut] || eventItem.statut;

        return `
          <article class="missionListItem">
            <div class="missionListHeader">
              <div class="missionListTitle">
                <strong>${escapeHtml(eventItem.nom)}</strong>
                <span class="missionStatusBadge ${escapeAttr(statusClass)}">
                  ${escapeHtml(statusLabel)}
                </span>
              </div>

              <div class="missionListMeta">
                ${escapeHtml(EVENT_KIND_LABELS[eventItem.type_evenement] || eventItem.type_evenement_label || "Évènement")}
                · ${escapeHtml(getDateLabel(eventItem))}
                ${place ? `<br />${escapeHtml(place)}` : ""}
              </div>
            </div>

            ${
              operatorLabels.length > 0
                ? `
                  <div class="missionOperatorLine" aria-label="Personnes prévues">
                    ${operatorLabels
                      .map((name) => `<span class="missionOperatorChip">${escapeHtml(name)}</span>`)
                      .join("")}
                  </div>
                `
                : ""
            }

            <div class="missionDayChips">
              ${jours
                .map((jour) => {
                  const linked = Boolean(jour.mission_id);
                  const mission = linked ? getStockMissionById(jour.mission_id) : null;

                  return `
                    <span class="missionDayChip ${linked ? "isLinked" : ""}">
                      ${escapeHtml(jour.jour_label)} · ${escapeHtml(formatDisplayDate(jour.date))}
                      ${mission ? ` · ${escapeHtml(mission.nom)}` : ""}
                    </span>
                  `;
                })
                .join("")}
            </div>
          </article>
        `;
      })
      .join("");
  };

  const renderStockMissionsList = () => {
    const today = formatIsoDate(new Date());

    const stockMissions = getStockMissions()
      .slice()
      .filter((mission) => mission.statut !== "annule")
      .filter((mission) => mission.statut !== "cloture" || mission.date_fin >= today)
      .sort((a, b) => {
        const byDate = String(a.date_debut).localeCompare(String(b.date_debut));
        if (byDate !== 0) return byDate;
        return String(a.created_at).localeCompare(String(b.created_at));
      });

    if (stockMissions.length === 0) {
      els.stockMissionsList.innerHTML =
        `<p class="missionEmpty">Aucune mission de stock préparée pour l’instant.</p>`;
      return;
    }

    els.stockMissionsList.innerHTML = stockMissions
      .map((mission) => {
        const jours = getStockMissionJournees(mission.mission_id);
        const firstOpenDay = getFirstOpenDayForStockMission(mission.mission_id);
        const statusClass = getStatusClass(mission.statut);
        const statusLabel = STATUS_LABELS[mission.statut] || mission.statut;

        return `
          <article class="missionListItem">
            <div class="missionListHeader">
              <div class="missionListTitle">
                <strong>${escapeHtml(mission.nom)}</strong>
                <span class="missionStatusBadge ${escapeAttr(statusClass)}">
                  ${escapeHtml(statusLabel)}
                </span>
              </div>

              <div class="missionListMeta">
                Stock partagé · ${escapeHtml(getDateLabel(mission))}
              </div>
            </div>

            <div class="missionDayChips">
              ${jours
                .map((jour) => {
                  const eventItem = getEventById(jour.evenement_id);

                  return `
                    <span class="missionDayChip isLinked">
                      ${escapeHtml(formatDisplayDate(jour.date))}
                      · ${escapeHtml(eventItem ? eventItem.nom : "Évènement inconnu")}
                      ${eventItem && eventItem.date_debut !== eventItem.date_fin ? ` ${escapeHtml(jour.jour_label)}` : ""}
                    </span>
                  `;
                })
                .join("")}
            </div>

            <div class="missionListActions">
              <button
                class="missionSmallBtn primary"
                type="button"
                data-resume-stock-mission="${escapeAttr(mission.mission_id)}"
                data-resume-day="${escapeAttr(firstOpenDay ? firstOpenDay.journee_id : "")}"
              >
                Reprendre
              </button>

              <button
                class="missionSmallBtn"
                type="button"
                data-expense-stock-mission="${escapeAttr(mission.mission_id)}"
              >
                Ajouter un frais
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const renderStockDayList = () => {
    const events = getEvents();
    const journees = getJournees()
      .slice()
      .filter((journee) => journee.statut !== "annule")
      .sort((a, b) => {
        const byDate = String(a.date).localeCompare(String(b.date));
        if (byDate !== 0) return byDate;

        const eventA = getEventById(a.evenement_id);
        const eventB = getEventById(b.evenement_id);

        return String(eventA?.nom || "").localeCompare(String(eventB?.nom || ""));
      });

    if (events.length === 0 || journees.length === 0) {
      els.stockDayList.innerHTML =
        `<p class="missionEmpty">Crée d’abord un évènement pour pouvoir choisir ses journées.</p>`;
      return;
    }

    els.stockDayList.innerHTML = journees
      .map((journee) => {
        const eventItem = getEventById(journee.evenement_id);
        const checked = state.selectedDayIds.has(journee.journee_id);
        const linked = Boolean(journee.mission_id);
        const linkedMission = linked ? getStockMissionById(journee.mission_id) : null;

        return `
          <label class="stockDayOption ${checked ? "isSelected" : ""} ${linked ? "isLinked" : ""}">
            <input
              type="checkbox"
              value="${escapeAttr(journee.journee_id)}"
              data-stock-day-choice
              ${checked ? "checked" : ""}
            />

            <span class="stockDayCheck" aria-hidden="true"></span>

            <span class="stockDayText">
              <strong>${escapeHtml(getJourneeTitle(journee))}</strong>
              <small>
                ${escapeHtml(formatDisplayDate(journee.date))}
                ${eventItem?.ville ? ` · ${escapeHtml(eventItem.ville)}` : ""}
                ${linkedMission ? ` · déjà liée à ${escapeHtml(linkedMission.nom)}` : ""}
              </small>
            </span>
          </label>
        `;
      })
      .join("");
  };

  const renderStockMissionPreview = () => {
    const allJournees = getJournees();
    const selectedDays = [...state.selectedDayIds]
      .map((journeeId) => allJournees.find((journee) => journee.journee_id === journeeId))
      .filter(Boolean)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    if (selectedDays.length === 0) {
      els.stockMissionPreview.innerHTML =
        `<p class="missionEmpty">Sélectionne au moins une journée.</p>`;
      return;
    }

    els.stockMissionPreview.innerHTML = `
      <div class="stockPreviewHeader">
        <strong>${selectedDays.length} journée${selectedDays.length > 1 ? "s" : ""} sélectionnée${selectedDays.length > 1 ? "s" : ""}</strong>
        <span>${escapeHtml(formatDisplayDate(selectedDays[0].date))} → ${escapeHtml(formatDisplayDate(selectedDays[selectedDays.length - 1].date))}</span>
      </div>

      <div class="missionDayChips">
        ${selectedDays
          .map((journee) => {
            const eventItem = getEventById(journee.evenement_id);

            return `
              <span class="missionDayChip isLinked">
                ${escapeHtml(formatDisplayDate(journee.date))}
                · ${escapeHtml(eventItem ? eventItem.nom : "Évènement inconnu")}
                ${eventItem && eventItem.date_debut !== eventItem.date_fin ? ` ${escapeHtml(journee.jour_label)}` : ""}
              </span>
            `;
          })
          .join("")}
      </div>
    `;
  };

  const renderAll = () => {
    renderEventMode();
    renderOperators();
    renderDayPreview();
    renderEventsList();
    renderStockMissionsList();
    renderStockDayList();
    renderStockMissionPreview();
  };

  const resetEventForm = () => {
    state.eventMode = "single";
    state.selectedOperators = new Set(["U_JEROME"]);
    state.eventSubmitAction = "save";

    els.eventForm.reset();
    setDefaultDate();
    setEventStatus("");

    renderEventMode();
    renderOperators();
    renderDayPreview();
  };

  const resetStockMissionForm = () => {
    state.selectedDayIds = new Set();
    state.stockSubmitAction = "save";

    els.stockMissionForm.reset();
    setStockStatus("");

    renderStockDayList();
    renderStockMissionPreview();
  };

  const setDefaultDate = () => {
    if (els.startDateInput.value) return;

    const today = new Date();
    els.startDateInput.value = formatIsoDate(today);
  };

  document.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-event-mode]");
    if (modeButton) {
      state.eventMode = modeButton.dataset.eventMode;
      setEventStatus("");
      renderEventMode();
      renderDayPreview();
      return;
    }

    const operatorButton = event.target.closest("[data-operator]");
    if (operatorButton) {
      const operatorId = operatorButton.dataset.operator;

      if (state.selectedOperators.has(operatorId)) {
        state.selectedOperators.delete(operatorId);
      } else {
        state.selectedOperators.add(operatorId);
      }

      if (state.selectedOperators.size === 0) {
        state.selectedOperators.add("U_JEROME");
      }

      renderOperators();
      return;
    }

    const eventSubmitButton = event.target.closest("[data-event-submit-action]");
    if (eventSubmitButton) {
      state.eventSubmitAction = eventSubmitButton.dataset.eventSubmitAction;
      return;
    }

    const stockSubmitButton = event.target.closest("[data-stock-submit-action]");
    if (stockSubmitButton) {
      state.stockSubmitAction = stockSubmitButton.dataset.stockSubmitAction;
      return;
    }

    const resumeButton = event.target.closest("[data-resume-stock-mission]");
    if (resumeButton) {
      const missionId = resumeButton.dataset.resumeStockMission;
      const journeeId = resumeButton.dataset.resumeDay;

      if (!missionId || !journeeId) return;

      setPreparationContext(missionId, journeeId);

      const mission = getStockMissionById(missionId);

      if (mission && mission.statut === "en_cours") {
        window.location.href = "./index.html";
        return;
      }

      window.location.href = "./preparation-stock.html";
      return;
    }

    const expenseButton = event.target.closest("[data-expense-stock-mission]");
    if (expenseButton) {
      const missionId = expenseButton.dataset.expenseStockMission;

      if (!missionId) return;

      setFraisContext(missionId);
      window.location.href = "./frais.html";
    }
  });

  document.addEventListener("change", (event) => {
    const dayChoice = event.target.closest("[data-stock-day-choice]");
    if (!dayChoice) return;

    if (dayChoice.checked) {
      state.selectedDayIds.add(dayChoice.value);
    } else {
      state.selectedDayIds.delete(dayChoice.value);
    }

    setStockStatus("");
    renderStockDayList();
    renderStockMissionPreview();
  });

  els.eventForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const result = createEvent();

    if (!result) return;

    renderAll();

    if (state.eventSubmitAction === "stock") {
      const stockName = buildDefaultStockMissionName(result.jours);
      els.stockMissionNameInput.value = stockName;
      state.selectedDayIds = new Set(result.jours.map((journee) => journee.journee_id));

      const stockResult = createStockMission({ fromDays: result.jours });

      renderAll();

      if (stockResult?.mission && stockResult?.jours?.[0]) {
        setPreparationContext(stockResult.mission.mission_id, stockResult.jours[0].journee_id);
        window.location.href = "./preparation-stock.html";
      }
    }
  });

  els.stockMissionForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const result = createStockMission();

    if (!result) return;

    renderAll();

    if (state.stockSubmitAction === "prepare") {
      setPreparationContext(result.mission.mission_id, result.jours[0].journee_id);
      window.location.href = "./preparation-stock.html";
    }
  });

  els.resetEventBtn.addEventListener("click", resetEventForm);
  els.resetStockMissionBtn.addEventListener("click", resetStockMissionForm);

  [els.startDateInput, els.endDateInput].forEach((input) => {
    input.addEventListener("change", () => {
      setEventStatus("");
      renderDayPreview();
    });
  });

  setDefaultDate();
  renderAll();
})();