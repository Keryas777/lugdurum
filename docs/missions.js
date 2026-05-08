(() => {
  "use strict";

  /*
    Missions V2 :
    - Page planning + création d’évènements.
    - Un évènement peut être créé plusieurs mois à l’avance.
    - Journée unique = mission + J1.
    - Plusieurs jours = mission + J1, J2, J3...
    - Les frais pourront être liés à une mission même sans journée active.
    - Vendeurs/opérateurs prévus : Jérôme, Antho, Will, Autre.
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
    missions: "lugdurum_missions",
    journees: "lugdurum_journees",
    activeMissionId: "lugdurum_active_mission_id",
    activeJourneeId: "lugdurum_active_journee_id",
    preparationContext: "lugdurum_preparation_context",
    fraisContext: "lugdurum_frais_context"
  };

  const state = {
    eventMode: "single",
    selectedOperators: new Set(["U_JEROME"]),
    submitAction: "save"
  };

  const els = {
    form: document.getElementById("missionForm"),
    missionNameInput: document.getElementById("missionNameInput"),
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
    resetMissionBtn: document.getElementById("resetMissionBtn"),
    missionStatus: document.getElementById("missionStatus"),
    missionsList: document.getElementById("missionsList")
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

  const slugify = (value) =>
    String(value || "mission")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 26) || "EVENEMENT";

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

  const getMissions = () => readJson(STORAGE_KEYS.missions, []);

  const getJournees = () => readJson(STORAGE_KEYS.journees, []);

  const setMissions = (missions) => writeJson(STORAGE_KEYS.missions, missions);

  const setJournees = (journees) => writeJson(STORAGE_KEYS.journees, journees);

  const setStatus = (message, type = "") => {
    els.missionStatus.textContent = message;
    els.missionStatus.className = "missionStatus";

    if (type) {
      els.missionStatus.classList.add(type);
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

  const getOperatorLabels = (mission) => {
    const values = Array.isArray(mission.vendeurs_prevus)
      ? mission.vendeurs_prevus
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

    els.otherOperatorField.hidden = !state.selectedOperators.has("AUTRE");

    if (!state.selectedOperators.has("AUTRE")) {
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
    localStorage.setItem(STORAGE_KEYS.activeJourneeId, journeeId);

    writeJson(STORAGE_KEYS.preparationContext, {
      mission_id: missionId,
      journee_id: journeeId,
      step: "preparation_stock",
      updated_at: new Date().toISOString()
    });
  };

  const setFraisContext = (missionId) => {
    localStorage.setItem(STORAGE_KEYS.activeMissionId, missionId);

    writeJson(STORAGE_KEYS.fraisContext, {
      mission_id: missionId,
      journee_id: "",
      source: "missions",
      updated_at: new Date().toISOString()
    });
  };

  const getMissionJournees = (missionId) =>
    getJournees()
      .filter((journee) => journee.mission_id === missionId)
      .sort((a, b) => a.date.localeCompare(b.date));

  const getFirstOpenDay = (missionId) => {
    const jours = getMissionJournees(missionId);

    return (
      jours.find((journee) => journee.statut !== "cloture" && journee.statut !== "annule") ||
      jours[0]
    );
  };

  const getMissionStatusClass = (statut) => {
    if (statut === "pret") return "isReady";
    if (statut === "en_cours") return "isActive";
    return "";
  };

  const getDateLabel = (mission) => {
    if (mission.date_debut === mission.date_fin) {
      return formatDisplayDate(mission.date_debut);
    }

    return `${formatDisplayDate(mission.date_debut)} → ${formatDisplayDate(mission.date_fin)}`;
  };

  const createMission = () => {
    const name = els.missionNameInput.value.trim();
    const startDate = els.startDateInput.value;
    const dates = getDateRange();
    const operators = getSelectedOperatorsPayload();

    if (!name) {
      setStatus("Indique le nom de l’évènement.", "isError");
      return null;
    }

    if (!startDate || dates.length === 0) {
      setStatus("Indique une date valide.", "isError");
      return null;
    }

    if (dates.length >= 15) {
      setStatus("Évènement trop long pour cette V1. Limite provisoire : 14 jours.", "isError");
      return null;
    }

    if (operators.length === 0) {
      setStatus("Indique au moins une personne prévue sur l’évènement.", "isError");
      return null;
    }

    const now = new Date().toISOString();
    const slug = slugify(name);
    const stamp = Date.now().toString(36).toUpperCase();

    const missionId = `M_${dates[0].replaceAll("-", "")}_${slug}_${stamp}`;

    const mission = {
      mission_id: missionId,
      nom: name,
      date_debut: dates[0],
      date_fin: dates[dates.length - 1],
      lieu: els.locationInput.value.trim(),
      ville: els.cityInput.value.trim(),
      type_evenement: els.eventKindInput.value,
      type_evenement_label: EVENT_KIND_LABELS[els.eventKindInput.value],
      type_parcours: state.eventMode === "multi" ? "PLUSIEURS_JOURS" : "JOURNEE_UNIQUE",
      statut: "stock_a_preparer",
      stock_prepare: false,
      vendeurs_prevus: operators,
      responsable_user_id: CURRENT_USER.user_id,
      objectif_ca: "",
      note: els.noteInput.value.trim(),
      created_at: now,
      updated_at: now
    };

    const jours = dates.map((date, index) => ({
      journee_id: `J_${date.replaceAll("-", "")}_${slug}_J${index + 1}_${stamp}`,
      mission_id: missionId,
      date,
      jour_label: `J${index + 1}`,
      statut: "prevu",
      meteo: "",
      affluence_ressentie: "",
      note: "",
      created_at: now,
      updated_at: now
    }));

    const missions = getMissions();
    const journees = getJournees();

    missions.push(mission);
    journees.push(...jours);

    setMissions(missions);
    setJournees(journees);

    const firstDay = jours[0];

    if (firstDay) {
      setPreparationContext(mission.mission_id, firstDay.journee_id);
    }

    setStatus("Évènement enregistré.", "isSuccess");
    renderMissionsList();

    return {
      mission,
      jours
    };
  };

  const renderMissionsList = () => {
    const today = formatIsoDate(new Date());

    const missions = getMissions()
      .slice()
      .filter((mission) => mission.statut !== "annule")
      .filter((mission) => mission.statut !== "cloture" || mission.date_fin >= today)
      .sort((a, b) => {
        const byDate = String(a.date_debut).localeCompare(String(b.date_debut));
        if (byDate !== 0) return byDate;
        return String(a.created_at).localeCompare(String(b.created_at));
      });

    if (missions.length === 0) {
      els.missionsList.innerHTML =
        `<p class="missionEmpty">Aucun évènement enregistré pour l’instant.</p>`;
      return;
    }

    els.missionsList.innerHTML = missions
      .map((mission) => {
        const jours = getMissionJournees(mission.mission_id);
        const firstOpenDay = getFirstOpenDay(mission.mission_id);
        const place = [mission.lieu, mission.ville].filter(Boolean).join(" · ");
        const operatorLabels = getOperatorLabels(mission);
        const statusClass = getMissionStatusClass(mission.statut);
        const statusLabel = STATUS_LABELS[mission.statut] || mission.statut;

        return `
          <article class="missionListItem">
            <div class="missionListHeader">
              <div class="missionListTitle">
                <strong>${escapeHtml(mission.nom)}</strong>
                <span class="missionStatusBadge ${escapeHtml(statusClass)}">
                  ${escapeHtml(statusLabel)}
                </span>
              </div>

              <div class="missionListMeta">
                ${escapeHtml(EVENT_KIND_LABELS[mission.type_evenement] || mission.type_evenement_label || "Évènement")}
                · ${escapeHtml(getDateLabel(mission))}
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
                .map((jour) => `
                  <span class="missionDayChip">
                    ${escapeHtml(jour.jour_label)} · ${escapeHtml(formatDisplayDate(jour.date))}
                  </span>
                `)
                .join("")}
            </div>

            <div class="missionListActions">
              <button
                class="missionSmallBtn primary"
                type="button"
                data-resume-mission="${escapeHtml(mission.mission_id)}"
                data-resume-day="${escapeHtml(firstOpenDay ? firstOpenDay.journee_id : "")}"
              >
                Reprendre
              </button>

              <button
                class="missionSmallBtn"
                type="button"
                data-expense-mission="${escapeHtml(mission.mission_id)}"
              >
                Ajouter un frais
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const resetForm = () => {
    state.eventMode = "single";
    state.selectedOperators = new Set(["U_JEROME"]);
    state.submitAction = "save";

    els.form.reset();
    setDefaultDate();
    setStatus("");

    renderEventMode();
    renderOperators();
    renderDayPreview();
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
      setStatus("");
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

    const submitButton = event.target.closest("[data-submit-action]");
    if (submitButton) {
      state.submitAction = submitButton.dataset.submitAction;
      return;
    }

    const resumeButton = event.target.closest("[data-resume-mission]");
    if (resumeButton) {
      const missionId = resumeButton.dataset.resumeMission;
      const journeeId = resumeButton.dataset.resumeDay;

      if (!missionId || !journeeId) return;

      setPreparationContext(missionId, journeeId);

      const mission = getMissions().find((item) => item.mission_id === missionId);

      if (mission && mission.statut === "en_cours") {
        window.location.href = "./index.html";
        return;
      }

      window.location.href = "./preparation-stock.html";
      return;
    }

    const expenseButton = event.target.closest("[data-expense-mission]");
    if (expenseButton) {
      const missionId = expenseButton.dataset.expenseMission;

      if (!missionId) return;

      setFraisContext(missionId);
      window.location.href = "./frais.html";
    }
  });

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();

    const result = createMission();

    if (!result) return;

    if (state.submitAction === "prepare") {
      window.location.href = "./preparation-stock.html";
    }
  });

  els.resetMissionBtn.addEventListener("click", resetForm);

  [els.startDateInput, els.endDateInput].forEach((input) => {
    input.addEventListener("change", () => {
      setStatus("");
      renderDayPreview();
    });
  });

  setDefaultDate();
  renderEventMode();
  renderOperators();
  renderDayPreview();
  renderMissionsList();
})();