(() => {
  "use strict";

  /*
    Missions V1 :
    - Crée toujours une mission + une ou plusieurs journées.
    - Journée unique = mission avec J1.
    - Événement multi-jours = mission avec J1, J2, J3...
    - Données stockées en localStorage pour préparer la connexion Google Sheets.
    - Prochaine étape : preparation-stock.html.
  */

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme"
  };

  const STORAGE_KEYS = {
    missions: "lugdurum_missions",
    journees: "lugdurum_journees",
    activeMissionId: "lugdurum_active_mission_id",
    activeJourneeId: "lugdurum_active_journee_id",
    preparationContext: "lugdurum_preparation_context"
  };

  const state = {
    eventMode: "single",
    lastCreatedMissionId: ""
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
    dayPreviewList: document.getElementById("dayPreviewList"),
    resetMissionBtn: document.getElementById("resetMissionBtn"),
    missionStatus: document.getElementById("missionStatus"),
    missionCreatedPanel: document.getElementById("missionCreatedPanel"),
    missionCreatedText: document.getElementById("missionCreatedText"),
    prepareStockLink: document.getElementById("prepareStockLink"),
    missionsList: document.getElementById("missionsList")
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
      .slice(0, 26) || "MISSION";

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

  const getMissions = () => readJson(STORAGE_KEYS.missions, []);

  const getJournees = () => readJson(STORAGE_KEYS.journees, []);

  const setStatus = (message, type = "") => {
    els.missionStatus.textContent = message;
    els.missionStatus.className = "missionStatus";

    if (type) {
      els.missionStatus.classList.add(type);
    }
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
        `<p class="missionEmpty">Événement trop long pour cette V1. Limite provisoire : 14 jours.</p>`;
      return;
    }

    els.dayPreviewList.innerHTML = dates
      .map((date, index) => `
        <article class="dayPreviewItem">
          <div>
            <strong>${formatDisplayDate(date)}</strong>
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

  const renderCreatedPanel = (mission, jours) => {
    const firstDay = jours[0];

    if (!firstDay) return;

    setPreparationContext(mission.mission_id, firstDay.journee_id);

    els.missionCreatedText.textContent =
      `${mission.nom} est prêt : ${jours.length} journée${jours.length > 1 ? "s" : ""} créée${jours.length > 1 ? "s" : ""}.`;

    els.prepareStockLink.href = "./preparation-stock.html";
    els.missionCreatedPanel.hidden = false;
  };

  const createMission = () => {
    const name = els.missionNameInput.value.trim();
    const startDate = els.startDateInput.value;
    const dates = getDateRange();

    if (!name) {
      setStatus("Indique le nom de l’événement.", "isError");
      return;
    }

    if (!startDate || dates.length === 0) {
      setStatus("Indique une date valide.", "isError");
      return;
    }

    if (dates.length >= 15) {
      setStatus("Événement trop long pour cette V1. Limite provisoire : 14 jours.", "isError");
      return;
    }

    const now = new Date().toISOString();
    const slug = slugify(name);
    const missionId = `M_${dates[0].replaceAll("-", "")}_${slug}_${Date.now().toString(36).toUpperCase()}`;

    const mission = {
      mission_id: missionId,
      nom: name,
      date_debut: dates[0],
      date_fin: dates[dates.length - 1],
      lieu: els.locationInput.value.trim(),
      ville: els.cityInput.value.trim(),
      type_evenement: els.eventKindInput.value,
      type_parcours: state.eventMode === "multi" ? "PLUSIEURS_JOURS" : "JOURNEE_UNIQUE",
      statut: "en_preparation",
      responsable_user_id: CURRENT_USER.user_id,
      objectif_ca: "",
      note: els.noteInput.value.trim(),
      created_at: now,
      updated_at: now
    };

    const jours = dates.map((date, index) => ({
      journee_id: `J_${date.replaceAll("-", "")}_${slug}_J${index + 1}_${Date.now().toString(36).toUpperCase()}`,
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

    writeJson(STORAGE_KEYS.missions, missions);
    writeJson(STORAGE_KEYS.journees, journees);

    state.lastCreatedMissionId = missionId;

    setStatus("Mission créée. Tu peux maintenant préparer le stock.", "isSuccess");
    renderCreatedPanel(mission, jours);
    renderMissionsList();
  };

  const renderMissionsList = () => {
    const missions = getMissions()
      .slice()
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    if (missions.length === 0) {
      els.missionsList.innerHTML =
        `<p class="missionEmpty">Aucune mission enregistrée pour l’instant.</p>`;
      return;
    }

    els.missionsList.innerHTML = missions
      .map((mission) => {
        const jours = getMissionJournees(mission.mission_id);
        const firstOpenDay = getFirstOpenDay(mission.mission_id);
        const dateLabel =
          mission.date_debut === mission.date_fin
            ? formatDisplayDate(mission.date_debut)
            : `${formatDisplayDate(mission.date_debut)} → ${formatDisplayDate(mission.date_fin)}`;

        const place = [mission.lieu, mission.ville].filter(Boolean).join(" · ");

        return `
          <article class="missionListItem">
            <div class="missionListHeader">
              <div class="missionListTitle">
                <strong>${escapeHtml(mission.nom)}</strong>
                <span class="missionStatusBadge">${escapeHtml(mission.statut)}</span>
              </div>

              <div class="missionListMeta">
                ${escapeHtml(dateLabel)}
                ${place ? `<br />${escapeHtml(place)}` : ""}
              </div>
            </div>

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
                class="missionSmallBtn"
                type="button"
                data-activate-mission="${escapeHtml(mission.mission_id)}"
                data-activate-day="${escapeHtml(firstOpenDay ? firstOpenDay.journee_id : "")}"
              >
                Activer
              </button>

              <button
                class="missionSmallBtn primary"
                type="button"
                data-prepare-mission="${escapeHtml(mission.mission_id)}"
                data-prepare-day="${escapeHtml(firstOpenDay ? firstOpenDay.journee_id : "")}"
              >
                Préparer le stock
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const resetForm = () => {
    state.eventMode = "single";

    els.form.reset();
    els.missionCreatedPanel.hidden = true;

    setStatus("");
    renderEventMode();
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

    const activateButton = event.target.closest("[data-activate-mission]");
    if (activateButton) {
      const missionId = activateButton.dataset.activateMission;
      const journeeId = activateButton.dataset.activateDay;

      if (!missionId || !journeeId) return;

      setPreparationContext(missionId, journeeId);
      setStatus("Mission activée.", "isSuccess");
      return;
    }

    const prepareButton = event.target.closest("[data-prepare-mission]");
    if (prepareButton) {
      const missionId = prepareButton.dataset.prepareMission;
      const journeeId = prepareButton.dataset.prepareDay;

      if (!missionId || !journeeId) return;

      setPreparationContext(missionId, journeeId);
      window.location.href = "./preparation-stock.html";
    }
  });

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    createMission();
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
  renderDayPreview();
  renderMissionsList();
})();