(() => {
  "use strict";

  /*
    Missions V7 — connecté Google Sheets :
    - La page ne crée plus d’évènements.
    - Les évènements viennent de missions_vente, créés depuis inscriptions-evenements.
    - Les journées viennent de journees_vente.
    - Cette page crée des missions de stock dans missions_stock.
    - Une mission de stock rattache une ou plusieurs journées via stock_mission_id.
    - Le champ mission_id des journées reste l’évènement / mission de vente d’origine.
    - Écriture via LugdurumAPI, avec file d’attente offline gérée dans lugdurum-api.js.
    - Cache localStorage conservé pour affichage de secours.
    - Corrige le parcours inscription -> évènement -> mission stock.
    - Exclut les journées historiques SAISIE_HISTORIQUE de la préparation stock.
    - Exclut les journées clôturées / annulées / déjà liées du sélecteur de mission stock.
    - Supporte missions.html?event_id=...&auto_select=1 pour préremplir la mission de stock.
    - Supporte missions.html?event_id=...&auto_prepare=1 pour créer directement la mission de stock.
  */

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
    CAVISTE: "Caviste / pro",
    COMMANDE_DIRECTE: "Commande directe",
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

  const urlParams = new URLSearchParams(window.location.search);
  const ROUTE_EVENT_ID = String(urlParams.get("event_id") || "").trim();
  const ROUTE_AUTO_SELECT = urlParams.get("auto_select") === "1";
  const ROUTE_AUTO_PREPARE = urlParams.get("auto_prepare") === "1";

  const state = {
    selectedDayIds: new Set(),
    stockSubmitAction: "save",
    events: [],
    stockMissions: [],
    journees: [],
    isLoading: false,
    isSaving: false,
    usingCache: false,
    routeHandled: false
  };

  const els = {
    stockMissionForm: document.getElementById("stockMissionForm"),
    eventsList: document.getElementById("eventsList"),
    stockMissionsList: document.getElementById("stockMissionsList"),
    stockMissionNameInput: document.getElementById("stockMissionNameInput"),
    stockMissionNoteInput: document.getElementById("stockMissionNoteInput"),
    stockDayList: document.getElementById("stockDayList"),
    stockMissionPreview: document.getElementById("stockMissionPreview"),
    resetStockMissionBtn: document.getElementById("resetStockMissionBtn"),
    stockMissionStatus: document.getElementById("stockMissionStatus")
  };

  const api = () => window.LugdurumAPI || null;

  const hasApi = () => Boolean(api());

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

  const normalizeStatus = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const parseLocalDate = (value) => {
    if (!value) return null;

    const [year, month, day] = String(value).split("-").map(Number);

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

  const getPendingWritesCount = () => {
    if (hasApi() && typeof api().getPendingWritesCount === "function") {
      return api().getPendingWritesCount();
    }

    return 0;
  };

  const mergeByKey = (remoteItems, localItems, getKey) => {
    const map = new Map();

    localItems.forEach((item) => {
      const key = getKey(item);
      if (key) map.set(key, item);
    });

    remoteItems.forEach((item) => {
      const key = getKey(item);
      if (key) map.set(key, item);
    });

    return [...map.values()];
  };

  const getEventId = (eventItem) =>
    String(eventItem?.mission_id || eventItem?.evenement_id || "").trim();

  const getDayId = (journee) =>
    String(journee?.journee_id || "").trim();

  const getDayEventId = (journee) =>
    String(journee?.mission_id || journee?.evenement_id || "").trim();

  const getStockMissionId = (mission) =>
    String(mission?.mission_id || "").trim();

  const isCancelledStatus = (item) => {
    const statut = normalizeStatus(item?.statut);

    return [
      "annule",
      "annulee",
      "refuse",
      "refusee"
    ].includes(statut);
  };

  const isClosedStatus = (item) => {
    const statut = normalizeStatus(item?.statut);

    return [
      "cloture",
      "cloturee",
      "termine",
      "terminee"
    ].includes(statut);
  };

  const isHistoricalSource = (item) =>
    String(item?.source || "")
      .trim()
      .toUpperCase() === "SAISIE_HISTORIQUE";

  const isHistoricalEvent = (eventItem) => {
    const eventId = getEventId(eventItem);

    return (
      isHistoricalSource(eventItem) ||
      eventId.startsWith("EVT_HIST_")
    );
  };

  const isHistoricalStockMission = (mission) => {
    const missionId = getStockMissionId(mission);

    return (
      isHistoricalSource(mission) ||
      missionId.startsWith("MST_HIST_")
    );
  };

  const isHistoricalDay = (journee) => {
    const journeeId = getDayId(journee);
    const eventId = getDayEventId(journee);
    const stockMissionId = String(journee?.stock_mission_id || "").trim();

    return (
      isHistoricalSource(journee) ||
      journeeId.startsWith("J_HIST_") ||
      eventId.startsWith("EVT_HIST_") ||
      stockMissionId.startsWith("MST_HIST_")
    );
  };

  const isEventUsableForStock = (eventItem) => {
    if (!eventItem) return false;
    if (isCancelledStatus(eventItem)) return false;
    if (isHistoricalEvent(eventItem)) return false;

    return true;
  };

  const isDaySelectableForStock = (journee) => {
    if (!journee) return false;
    if (isHistoricalDay(journee)) return false;
    if (isCancelledStatus(journee)) return false;
    if (isClosedStatus(journee)) return false;
    if (String(journee.stock_mission_id || "").trim()) return false;

    const eventItem = getEventById(getDayEventId(journee));

    if (!eventItem) return false;
    if (!isEventUsableForStock(eventItem)) return false;

    return true;
  };

  const cacheAll = () => {
    writeJson(STORAGE_KEYS.events, state.events);
    writeJson(STORAGE_KEYS.stockMissions, state.stockMissions);
    writeJson(STORAGE_KEYS.journees, state.journees);
  };

  const loadFromCache = () => {
    state.events = readJson(STORAGE_KEYS.events, []);
    state.stockMissions = readJson(STORAGE_KEYS.stockMissions, []);
    state.journees = readJson(STORAGE_KEYS.journees, []);
    state.usingCache = true;
  };

  const getEvents = () => state.events;

  const getStockMissions = () => state.stockMissions;

  const getJournees = () => state.journees;

  const upsertLocal = (collectionName, idKey, item) => {
    const collection = state[collectionName];
    const id = String(item[idKey] || "");
    const index = collection.findIndex((entry) => String(entry[idKey] || "") === id);

    if (index >= 0) {
      collection[index] = item;
    } else {
      collection.push(item);
    }

    cacheAll();
  };

  const upsertManyLocal = (collectionName, idKey, items) => {
    items.forEach((item) => upsertLocal(collectionName, idKey, item));
    cacheAll();
  };

  const getEventById = (eventId) =>
    getEvents().find((eventItem) => getEventId(eventItem) === String(eventId || ""));

  const getStockMissionById = (missionId) =>
    getStockMissions().find((mission) => String(mission.mission_id || "") === String(missionId || ""));

  const getEventJournees = (eventId) =>
    getJournees()
      .filter((journee) => getDayEventId(journee) === String(eventId || ""))
      .filter((journee) => !isHistoricalDay(journee))
      .filter((journee) => !isCancelledStatus(journee))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const getStockMissionJournees = (missionId) =>
    getJournees()
      .filter((journee) => String(journee.stock_mission_id || "") === String(missionId || ""))
      .filter((journee) => !isHistoricalDay(journee))
      .filter((journee) => !isCancelledStatus(journee))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const getFirstOpenDayForStockMission = (missionId) => {
    const jours = getStockMissionJournees(missionId);

    return (
      jours.find((journee) => !isClosedStatus(journee) && !isCancelledStatus(journee)) ||
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
    const status = normalizeStatus(statut);

    if (status === "pret") return "isReady";
    if (status === "en_cours") return "isActive";
    if (status === "stock_a_preparer") return "isWarning";
    return "";
  };

  const getDayEventTitle = (journee) => {
    const eventItem = getEventById(getDayEventId(journee));

    if (!eventItem) {
      return `${journee.jour_label || "J?"} · ${formatDisplayDate(journee.date)}`;
    }

    const dayLabel =
      eventItem.date_debut === eventItem.date_fin
        ? ""
        : ` ${journee.jour_label || ""}`;

    return `${eventItem.nom}${dayLabel}`;
  };

  const setStockStatus = (message, type = "") => {
    if (!els.stockMissionStatus) return;

    els.stockMissionStatus.textContent = message;
    els.stockMissionStatus.className = "missionStatus";

    if (type) {
      els.stockMissionStatus.classList.add(type);
    }
  };

  const setSaving = (isSaving) => {
    state.isSaving = isSaving;

    [
      els.resetStockMissionBtn,
      els.stockMissionForm?.querySelector("[type='submit']")
    ].forEach((button) => {
      if (button) button.disabled = isSaving;
    });
  };

  const setPreparationContext = (stockMissionId, journeeId) => {
    localStorage.setItem(STORAGE_KEYS.activeMissionId, stockMissionId);
    localStorage.setItem(STORAGE_KEYS.activeStockMissionId, stockMissionId);
    localStorage.setItem(STORAGE_KEYS.activeJourneeId, journeeId);

    writeJson(STORAGE_KEYS.preparationContext, {
      mission_id: stockMissionId,
      stock_mission_id: stockMissionId,
      journee_id: journeeId,
      step: "preparation_stock",
      updated_at: new Date().toISOString()
    });
  };

  const setFraisContext = (stockMissionId) => {
    localStorage.setItem(STORAGE_KEYS.activeMissionId, stockMissionId);
    localStorage.setItem(STORAGE_KEYS.activeStockMissionId, stockMissionId);

    writeJson(STORAGE_KEYS.fraisContext, {
      mission_id: stockMissionId,
      stock_mission_id: stockMissionId,
      journee_id: "",
      source: "missions",
      updated_at: new Date().toISOString()
    });
  };

  const getSelectableDays = () =>
    getJournees()
      .filter(isDaySelectableForStock)
      .sort((a, b) => {
        const byDate = String(a.date).localeCompare(String(b.date));
        if (byDate !== 0) return byDate;

        const eventA = getEventById(getDayEventId(a));
        const eventB = getEventById(getDayEventId(b));

        return String(eventA?.nom || "").localeCompare(String(eventB?.nom || ""));
      });

  const buildDefaultStockMissionName = (days) => {
    if (!days.length) return "";

    const events = [...new Set(days.map((day) => getDayEventId(day)))]
      .map((eventId) => getEventById(eventId))
      .filter(Boolean);

    if (events.length === 1) {
      return events[0].nom;
    }

    return `Stock partagé ${formatDisplayDate(days[0].date)} → ${formatDisplayDate(days[days.length - 1].date)}`;
  };

  const getSelectedDays = (fromDays = null) => {
    if (Array.isArray(fromDays)) {
      return fromDays
        .slice()
        .filter(Boolean)
        .filter(isDaySelectableForStock)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }

    const selectableDays = getSelectableDays();

    return [...state.selectedDayIds]
      .map((journeeId) => selectableDays.find((journee) => journee.journee_id === journeeId))
      .filter(Boolean)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  };

  const buildStockMissionPayload = ({ selectedDays, nameOverride = "" }) => {
    if (selectedDays.length === 0) {
      setStockStatus("Sélectionne au moins une journée pour cette mission de stock.", "isError");
      return null;
    }

    const unavailable = selectedDays.find((journee) => !isDaySelectableForStock(journee));

    if (unavailable) {
      setStockStatus("Une des journées sélectionnées n’est plus disponible pour une mission de stock.", "isError");
      return null;
    }

    const name =
      nameOverride.trim() ||
      els.stockMissionNameInput.value.trim() ||
      buildDefaultStockMissionName(selectedDays);

    if (!name) {
      setStockStatus("Indique le nom de la mission de stock.", "isError");
      return null;
    }

    const now = new Date().toISOString();
    const slug = slugify(name, "STOCK");
    const stamp = Date.now().toString(36).toUpperCase();
    const missionId = `MST_${selectedDays[0].date.replaceAll("-", "")}_${slug}_${stamp}`;

    const eventIds = [...new Set(selectedDays.map((journee) => getDayEventId(journee)).filter(Boolean))];

    const mission = {
      mission_id: missionId,
      evenement_id: eventIds.length === 1 ? eventIds[0] : "",
      nom: name,
      date_debut: selectedDays[0].date,
      date_fin: selectedDays[selectedDays.length - 1].date,
      statut: "stock_a_preparer",
      stock_prepare: false,
      responsable_user_id: CURRENT_USER.user_id,
      journees_count: selectedDays.length,
      total_bouteilles_preparees: "",
      total_50cl_prepare: "",
      total_20cl_prepare: "",
      parfums_prepare_count: "",
      source: "MISSIONS_STOCK",
      note: els.stockMissionNoteInput.value.trim(),
      created_at: now,
      updated_at: now
    };

    const selectedSet = new Set(selectedDays.map((journee) => journee.journee_id));

    const updatedJournees = getJournees()
      .filter((journee) => selectedSet.has(journee.journee_id))
      .map((journee) => {
        const currentStatus = normalizeStatus(journee.statut || "prevu");

        return {
          ...journee,
          stock_mission_id: missionId,
          statut:
            currentStatus === "prevu" ||
            currentStatus === "brouillon" ||
            currentStatus === ""
              ? "stock_a_preparer"
              : journee.statut,
          updated_at: now
        };
      });

    return {
      mission,
      jours: updatedJournees
    };
  };

  const saveStockMissionBundle = async ({ mission, jours }) => {
    if (
      hasApi() &&
      typeof api().saveMissionStockBundle === "function"
    ) {
      try {
        await api().saveMissionStockBundle({
          mission,
          mission_stock: mission,
          journees: jours
        });

        upsertLocal("stockMissions", "mission_id", mission);
        upsertManyLocal("journees", "journee_id", jours);
        return;
      } catch (error) {
        console.warn("Bundle mission stock impossible, tentative en écritures séparées.", error);
      }
    }

    if (hasApi() && typeof api().saveMissionStock === "function") {
      await api().saveMissionStock(mission);
    }

    if (hasApi() && typeof api().saveJournee === "function") {
      for (const journee of jours) {
        await api().saveJournee(journee);
      }
    }

    upsertLocal("stockMissions", "mission_id", mission);
    upsertManyLocal("journees", "journee_id", jours);
  };

  const createStockMission = async ({ fromDays = null, nameOverride = "" } = {}) => {
    const selectedDays = getSelectedDays(fromDays);
    const payload = buildStockMissionPayload({
      selectedDays,
      nameOverride
    });

    if (!payload) return null;

    setSaving(true);
    setStockStatus("Enregistrement de la mission de stock...");

    try {
      await saveStockMissionBundle(payload);

      state.selectedDayIds = new Set();

      setStockStatus("Mission de stock enregistrée.", "isSuccess");

      return payload;
    } catch (error) {
      setStockStatus(`Erreur enregistrement : ${error.message}`, "isError");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const prepareEventStock = async (eventId) => {
    const eventItem = getEventById(eventId);

    if (!eventItem) {
      setStockStatus("Évènement introuvable. Recharge la page si la création vient d’être faite.", "isError");
      return;
    }

    const availableDays = getEventJournees(eventId).filter(isDaySelectableForStock);

    if (availableDays.length === 0) {
      setStockStatus("Aucune journée disponible pour cet évènement. Elle est peut-être déjà liée à une mission de stock.", "isError");
      return;
    }

    const result = await createStockMission({
      fromDays: availableDays,
      nameOverride: eventItem.nom
    });

    renderAll();

    if (result?.mission && result?.jours?.[0]) {
      setPreparationContext(result.mission.mission_id, result.jours[0].journee_id);
      window.location.href = "./preparation-stock.html";
    }
  };

  const selectEventDays = (eventId) => {
    const eventItem = getEventById(eventId);

    if (!eventItem) {
      setStockStatus("Évènement introuvable dans les données chargées.", "isError");
      return;
    }

    const availableDays = getEventJournees(eventId).filter(isDaySelectableForStock);

    if (availableDays.length === 0) {
      setStockStatus("Aucune journée disponible pour cet évènement.", "isError");
      return;
    }

    availableDays.forEach((journee) => {
      state.selectedDayIds.add(journee.journee_id);
    });

    const selectedDays = getSelectedDays();

    if (!els.stockMissionNameInput.value.trim()) {
      els.stockMissionNameInput.value = buildDefaultStockMissionName(selectedDays);
    }

    setStockStatus(`${availableDays.length} journée(s) ajoutée(s) à la sélection.`, "isSuccess");
    renderStockDayList();
    renderStockMissionPreview();

    document.getElementById("createStockMissionTitle")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const renderEventsList = () => {
    const today = formatIsoDate(new Date());

    const events = getEvents()
      .slice()
      .filter(isEventUsableForStock)
      .filter((eventItem) => {
        const statut = normalizeStatus(eventItem.statut || "prevu");

        if (statut !== "cloture" && statut !== "cloturee" && statut !== "termine" && statut !== "terminee") {
          return true;
        }

        return String(eventItem.date_fin || "") >= today;
      })
      .sort((a, b) => {
        const byDate = String(a.date_debut).localeCompare(String(b.date_debut));
        if (byDate !== 0) return byDate;
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });

    if (state.isLoading) {
      els.eventsList.innerHTML =
        `<p class="missionEmpty">Chargement des évènements...</p>`;
      return;
    }

    if (events.length === 0) {
      els.eventsList.innerHTML = `
        <div class="missionEmptyBlock">
          <p class="missionEmpty">Aucun évènement enregistré pour l’instant.</p>
          <a class="missionSmallBtn primary" href="./inscriptions-evenements.html">
            Créer depuis les inscriptions
          </a>
        </div>
      `;
      return;
    }

    els.eventsList.innerHTML = events
      .map((eventItem) => {
        const eventId = getEventId(eventItem);
        const jours = getEventJournees(eventId);
        const availableDays = jours.filter(isDaySelectableForStock);
        const place = [eventItem.lieu, eventItem.ville].filter(Boolean).join(" · ");
        const statusClass = getStatusClass(eventItem.statut);
        const statusLabel = STATUS_LABELS[normalizeStatus(eventItem.statut)] || eventItem.statut || "Prévu";

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

            <div class="missionDayChips">
              ${
                jours.length > 0
                  ? jours
                      .map((jour) => {
                        const linked = Boolean(String(jour.stock_mission_id || "").trim());
                        const closed = isClosedStatus(jour);
                        const mission = linked
                          ? getStockMissionById(jour.stock_mission_id)
                          : null;

                        return `
                          <span class="missionDayChip ${linked ? "isLinked" : ""}">
                            ${escapeHtml(jour.jour_label || "J?")} · ${escapeHtml(formatDisplayDate(jour.date))}
                            ${mission ? ` · ${escapeHtml(mission.nom)}` : ""}
                            ${closed ? " · clôturée" : ""}
                          </span>
                        `;
                      })
                      .join("")
                  : `<span class="missionDayChip">Aucune journée liée</span>`
              }
            </div>

            <div class="missionListActions">
              <button
                class="missionSmallBtn"
                type="button"
                data-select-event-days="${escapeAttr(eventId)}"
                ${availableDays.length === 0 ? "disabled" : ""}
              >
                Sélectionner
              </button>

              <button
                class="missionSmallBtn primary"
                type="button"
                data-prepare-event="${escapeAttr(eventId)}"
                ${availableDays.length === 0 ? "disabled" : ""}
              >
                Préparer le stock
              </button>
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
      .filter((mission) => !isCancelledStatus(mission))
      .filter((mission) => !isHistoricalStockMission(mission))
      .filter((mission) => {
        if (!isClosedStatus(mission)) return true;
        return String(mission.date_fin || "") >= today;
      })
      .sort((a, b) => {
        const byDate = String(a.date_debut).localeCompare(String(b.date_debut));
        if (byDate !== 0) return byDate;
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
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
        const statusLabel = STATUS_LABELS[normalizeStatus(mission.statut)] || mission.statut || "Mission";

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
              ${
                jours.length > 0
                  ? jours
                      .map((jour) => {
                        const eventItem = getEventById(getDayEventId(jour));

                        return `
                          <span class="missionDayChip isLinked">
                            ${escapeHtml(formatDisplayDate(jour.date))}
                            · ${escapeHtml(eventItem ? eventItem.nom : "Évènement inconnu")}
                            ${eventItem && eventItem.date_debut !== eventItem.date_fin ? ` ${escapeHtml(jour.jour_label || "")}` : ""}
                          </span>
                        `;
                      })
                      .join("")
                  : `<span class="missionDayChip">Aucune journée liée</span>`
              }
            </div>

            <div class="missionListActions">
              <button
                class="missionSmallBtn primary"
                type="button"
                data-resume-stock-mission="${escapeAttr(mission.mission_id)}"
                data-resume-day="${escapeAttr(firstOpenDay ? firstOpenDay.journee_id : "")}"
                ${firstOpenDay ? "" : "disabled"}
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
    const selectableDays = getSelectableDays();

    if (selectableDays.length === 0) {
      els.stockDayList.innerHTML =
        `<p class="missionEmpty">Aucune journée disponible pour l’instant. Crée d’abord un évènement depuis les inscriptions.</p>`;
      return;
    }

    els.stockDayList.innerHTML = selectableDays
      .map((journee) => {
        const eventItem = getEventById(getDayEventId(journee));
        const checked = state.selectedDayIds.has(journee.journee_id);

        return `
          <label class="stockDayOption ${checked ? "isSelected" : ""}">
            <input
              type="checkbox"
              value="${escapeAttr(journee.journee_id)}"
              data-stock-day-choice
              ${checked ? "checked" : ""}
            />

            <span class="stockDayCheck" aria-hidden="true"></span>

            <span class="stockDayText">
              <strong>${escapeHtml(getDayEventTitle(journee))}</strong>
              <small>
                ${escapeHtml(formatDisplayDate(journee.date))}
                ${eventItem?.ville ? ` · ${escapeHtml(eventItem.ville)}` : ""}
              </small>
            </span>
          </label>
        `;
      })
      .join("");
  };

  const renderStockMissionPreview = () => {
    const selectedDays = getSelectedDays();

    if (selectedDays.length === 0) {
      els.stockMissionPreview.innerHTML =
        `<p class="missionEmpty">Sélectionne au moins une journée.</p>`;
      els.stockMissionNameInput.placeholder = "Ex : Week-end 1-3 mai";
      return;
    }

    const defaultName = buildDefaultStockMissionName(selectedDays);
    els.stockMissionNameInput.placeholder = defaultName;

    els.stockMissionPreview.innerHTML = `
      <div class="stockPreviewHeader">
        <strong>${selectedDays.length} journée${selectedDays.length > 1 ? "s" : ""} sélectionnée${selectedDays.length > 1 ? "s" : ""}</strong>
        <span>${escapeHtml(defaultName)}</span>
      </div>

      <div class="missionDayChips">
        ${selectedDays
          .map((journee) => {
            const eventItem = getEventById(getDayEventId(journee));

            return `
              <span class="missionDayChip isLinked">
                ${escapeHtml(formatDisplayDate(journee.date))}
                · ${escapeHtml(eventItem ? eventItem.nom : "Évènement inconnu")}
                ${eventItem && eventItem.date_debut !== eventItem.date_fin ? ` ${escapeHtml(journee.jour_label || "")}` : ""}
              </span>
            `;
          })
          .join("")}
      </div>
    `;
  };

  const renderAll = () => {
    renderEventsList();
    renderStockMissionsList();
    renderStockDayList();
    renderStockMissionPreview();
  };

  const resetStockMissionForm = () => {
    state.selectedDayIds = new Set();
    state.stockSubmitAction = "save";

    els.stockMissionForm.reset();
    setStockStatus("");

    renderStockDayList();
    renderStockMissionPreview();
  };

  const handleRouteRequest = async () => {
    if (state.routeHandled) return;
    if (!ROUTE_EVENT_ID) return;

    state.routeHandled = true;

    const eventItem = getEventById(ROUTE_EVENT_ID);

    if (!eventItem) {
      setStockStatus(
        "L’évènement vient peut-être d’être créé, mais il n’est pas encore visible ici. Recharge la page si besoin.",
        "isError"
      );
      return;
    }

    if (ROUTE_AUTO_PREPARE) {
      await prepareEventStock(ROUTE_EVENT_ID);
      return;
    }

    if (ROUTE_AUTO_SELECT) {
      selectEventDays(ROUTE_EVENT_ID);
    }
  };

  const loadData = async () => {
    state.isLoading = true;
    renderAll();
    setStockStatus("Chargement...");

    const cachedEvents = readJson(STORAGE_KEYS.events, []);
    const cachedStockMissions = readJson(STORAGE_KEYS.stockMissions, []);
    const cachedJournees = readJson(STORAGE_KEYS.journees, []);

    try {
      if (!hasApi()) {
        throw new Error("lugdurum-api.js n’est pas chargé.");
      }

      const [events, stockMissions, journees] = await Promise.all([
        api().getMissions(),
        api().getMissionsStock(),
        api().getJournees()
      ]);

      const shouldKeepOptimisticCache = getPendingWritesCount() > 0;

      state.events = shouldKeepOptimisticCache
        ? mergeByKey(
            Array.isArray(events) ? events : [],
            cachedEvents,
            getEventId
          )
        : Array.isArray(events)
          ? events
          : [];

      state.stockMissions = shouldKeepOptimisticCache
        ? mergeByKey(
            Array.isArray(stockMissions) ? stockMissions : [],
            cachedStockMissions,
            getStockMissionId
          )
        : Array.isArray(stockMissions)
          ? stockMissions
          : [];

      state.journees = shouldKeepOptimisticCache
        ? mergeByKey(
            Array.isArray(journees) ? journees : [],
            cachedJournees,
            getDayId
          )
        : Array.isArray(journees)
          ? journees
          : [];

      state.usingCache = false;

      cacheAll();
      setStockStatus("");
    } catch (error) {
      loadFromCache();

      setStockStatus(
        `Lecture Sheets impossible. Données locales affichées : ${error.message}`,
        "isError"
      );
    } finally {
      state.isLoading = false;
      renderAll();
      await handleRouteRequest();
    }
  };

  document.addEventListener("click", async (event) => {
    const stockSubmitButton = event.target.closest("[data-stock-submit-action]");
    if (stockSubmitButton) {
      state.stockSubmitAction = stockSubmitButton.dataset.stockSubmitAction;
      return;
    }

    const selectEventButton = event.target.closest("[data-select-event-days]");
    if (selectEventButton) {
      selectEventDays(selectEventButton.dataset.selectEventDays);
      return;
    }

    const prepareEventButton = event.target.closest("[data-prepare-event]");
    if (prepareEventButton) {
      await prepareEventStock(prepareEventButton.dataset.prepareEvent);
      return;
    }

    const resumeButton = event.target.closest("[data-resume-stock-mission]");
    if (resumeButton) {
      const missionId = resumeButton.dataset.resumeStockMission;
      const journeeId = resumeButton.dataset.resumeDay;

      if (!missionId || !journeeId) return;

      setPreparationContext(missionId, journeeId);
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

  els.stockMissionForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (state.isSaving) return;

    const result = await createStockMission();

    if (!result) return;

    renderAll();

    if (state.stockSubmitAction === "prepare") {
      setPreparationContext(result.mission.mission_id, result.jours[0].journee_id);
      window.location.href = "./preparation-stock.html";
    }
  });

  els.resetStockMissionBtn.addEventListener("click", resetStockMissionForm);

  loadFromCache();
  renderAll();
  loadData();
})();