(() => {
  "use strict";

  /*
    Inscriptions évènements V3 :
    - Suppression du statut "Dossier envoyé" pour éviter le doublon avec "En attente de réponse".
    - "Dossier envoyé" devient uniquement une case de suivi.
    - Adresse visible directement dans la carte.
    - L’adresse devient cliquable vers Waze avec un badge compact.
    - Ajout électricité dans le matériel fourni.
    - Date de fin conservée en modification, même si égale à la date de début.
    - Création automatique de J1/J2/J3 si l’évènement dure plusieurs jours.
    - Cartes colorées selon le statut :
      accepté = vert, dossier à envoyer = rouge, dossier envoyé + attente = jaune.
  */

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme"
  };

  const OPERATORS = {
    U_JEROME: "Jérôme",
    U_ANTHO: "Antho",
    U_WILL: "Will",
    AUTRE: "Autre"
  };

  const EVENT_KIND_LABELS = {
    MARCHE_ARTISANAL: "Marché artisanal",
    SALON_DES_VINS: "Salon des vins",
    MARCHE_DE_NOEL: "Marché de Noël",
    FOIRE: "Foire",
    AUTRE: "Autre"
  };

  const STATUS_LABELS = {
    A_CONTACTER: "À contacter",
    DOSSIER_A_ENVOYER: "Dossier à envoyer",
    EN_ATTENTE_REPONSE: "En attente",
    A_RELANCER: "À relancer",
    LISTE_ATTENTE: "Liste d’attente",
    ACCEPTE: "Accepté",
    REFUSE: "Refusé",
    ANNULE: "Annulé"
  };

  const STORAGE_KEYS = {
    inscriptions: "lugdurum_inscriptions_evenements",
    events: "lugdurum_evenements",
    journees: "lugdurum_journees"
  };

  const state = {
    filterStatus: "ALL",
    search: "",
    editingId: ""
  };

  const els = {
    form: document.getElementById("inscriptionForm"),
    inscriptionIdInput: document.getElementById("inscriptionIdInput"),

    nameInput: document.getElementById("nameInput"),
    eventKindInput: document.getElementById("eventKindInput"),
    statusInput: document.getElementById("statusInput"),
    startDateInput: document.getElementById("startDateInput"),
    endDateInput: document.getElementById("endDateInput"),
    scheduleInput: document.getElementById("scheduleInput"),
    setupInput: document.getElementById("setupInput"),
    priceInput: document.getElementById("priceInput"),
    ownerInput: document.getElementById("ownerInput"),
    cityInput: document.getElementById("cityInput"),
    locationInput: document.getElementById("locationInput"),
    addressInput: document.getElementById("addressInput"),

    docSentInput: document.getElementById("docSentInput"),
    acceptedInput: document.getElementById("acceptedInput"),
    tableInput: document.getElementById("tableInput"),
    barnumInput: document.getElementById("barnumInput"),
    chairsInput: document.getElementById("chairsInput"),
    lightInput: document.getElementById("lightInput"),
    electricityInput: document.getElementById("electricityInput"),

    contactNameInput: document.getElementById("contactNameInput"),
    contactMailInput: document.getElementById("contactMailInput"),
    contactPhoneInput: document.getElementById("contactPhoneInput"),
    paymentInput: document.getElementById("paymentInput"),
    commentInput: document.getElementById("commentInput"),

    resetFormBtn: document.getElementById("resetFormBtn"),
    formStatus: document.getElementById("formStatus"),

    searchInput: document.getElementById("searchInput"),
    inscriptionsList: document.getElementById("inscriptionsList"),

    statRelance: document.getElementById("statRelance"),
    statWaiting: document.getElementById("statWaiting"),
    statAccepted: document.getElementById("statAccepted")
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

  const getInscriptions = () => readJson(STORAGE_KEYS.inscriptions, []);

  const setInscriptions = (items) => writeJson(STORAGE_KEYS.inscriptions, items);

  const getEvents = () => readJson(STORAGE_KEYS.events, []);

  const setEvents = (items) => writeJson(STORAGE_KEYS.events, items);

  const getJournees = () => readJson(STORAGE_KEYS.journees, []);

  const setJournees = (items) => writeJson(STORAGE_KEYS.journees, items);

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const escapeAttr = (value) =>
    escapeHtml(value).replaceAll("`", "&#096;");

  const slugify = (value, fallback = "INSCRIPTION") =>
    String(value || fallback)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || fallback;

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

  const formatCurrency = (value) => {
    const amount = toNumber(value, 0);

    if (!amount) return "";

    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const addDays = (date, days) => {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  };

  const getDateRange = (startIso, endIso) => {
    const start = parseLocalDate(startIso);
    const end = parseLocalDate(endIso || startIso);

    if (!start || !end || end < start) return [];

    const dates = [];
    let cursor = new Date(start);

    while (cursor <= end && dates.length < 31) {
      dates.push(formatIsoDate(cursor));
      cursor = addDays(cursor, 1);
    }

    return dates;
  };

  const setStatus = (message, type = "") => {
    els.formStatus.textContent = message;
    els.formStatus.className = "trackingStatus";

    if (type) {
      els.formStatus.classList.add(type);
    }
  };

  const setDefaultDate = () => {
    if (!els.startDateInput.value) {
      els.startDateInput.value = formatIsoDate(new Date());
    }
  };

  const buildWazeUrl = (item) => {
    const addressParts = [
      item.adresse,
      item.lieu,
      item.ville
    ].filter(Boolean);

    const query = addressParts.join(" ");

    if (!query.trim()) return "";

    return `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;
  };

  const buildInscriptionFromForm = () => {
    const now = new Date().toISOString();
    const name = els.nameInput.value.trim();
    const startDate = els.startDateInput.value;
    const endDate = els.endDateInput.value || startDate;
    const dates = getDateRange(startDate, endDate);

    if (!name) {
      setStatus("Indique le nom du marché ou salon.", "isError");
      return null;
    }

    if (!startDate || dates.length === 0) {
      setStatus("Indique une période valide.", "isError");
      return null;
    }

    const editingId = els.inscriptionIdInput.value.trim();
    const existing = editingId
      ? getInscriptions().find((item) => item.inscription_id === editingId)
      : null;

    const slug = slugify(name);
    const id = editingId || `INS_${startDate.replaceAll("-", "")}_${slug}_${Date.now().toString(36).toUpperCase()}`;

    let statut = els.statusInput.value;
    const acceptation = els.acceptedInput.checked || statut === "ACCEPTE";

    const dossierEnvoye =
      els.docSentInput.checked ||
      ["EN_ATTENTE_REPONSE", "A_RELANCER", "LISTE_ATTENTE", "ACCEPTE"].includes(statut);

    if (acceptation) {
      statut = "ACCEPTE";
    }

    return {
      inscription_id: id,
      nom: name,
      type_evenement: els.eventKindInput.value,
      type_evenement_label: EVENT_KIND_LABELS[els.eventKindInput.value] || els.eventKindInput.value,
      date_debut: startDate,
      date_fin: endDate,
      horaires: els.scheduleInput.value.trim(),
      mise_en_place: els.setupInput.value.trim(),
      ville: els.cityInput.value.trim(),
      lieu: els.locationInput.value.trim(),
      adresse: els.addressInput.value.trim(),
      statut,
      prix_emplacement: toNumber(els.priceInput.value, 0),
      dossier_envoye: dossierEnvoye,
      date_dossier_envoye: dossierEnvoye
        ? existing?.date_dossier_envoye || now.slice(0, 10)
        : "",
      acceptation,
      date_acceptation: acceptation
        ? existing?.date_acceptation || now.slice(0, 10)
        : "",
      paiement_statut: els.paymentInput.value.trim(),
      table_fournie: els.tableInput.checked,
      barnum_fourni: els.barnumInput.checked,
      chaises_fournies: els.chairsInput.checked,
      eclairage_fourni: els.lightInput.checked,
      electricite_fournie: els.electricityInput.checked,
      responsable_user_id: els.ownerInput.value,
      responsable_nom: OPERATORS[els.ownerInput.value] || els.ownerInput.value,
      contact_nom: els.contactNameInput.value.trim(),
      contact_mail: els.contactMailInput.value.trim(),
      contact_tel: els.contactPhoneInput.value.trim(),
      commentaire: els.commentInput.value.trim(),
      evenement_id: existing?.evenement_id || "",
      calendar_event_id: existing?.calendar_event_id || "",
      calendar_statut: existing?.calendar_statut || "",
      calendar_payload: existing?.calendar_payload || null,
      created_at: existing?.created_at || now,
      updated_at: now
    };
  };

  const saveInscription = (inscription) => {
    const items = getInscriptions();
    const index = items.findIndex((item) => item.inscription_id === inscription.inscription_id);

    if (index >= 0) {
      items[index] = inscription;
    } else {
      items.push(inscription);
    }

    setInscriptions(items);
  };

  const resetForm = () => {
    state.editingId = "";
    els.form.reset();
    els.inscriptionIdInput.value = "";
    els.statusInput.value = "A_CONTACTER";
    els.ownerInput.value = CURRENT_USER.user_id;
    setDefaultDate();
    setStatus("");
  };

  const fillForm = (inscription) => {
    state.editingId = inscription.inscription_id;

    els.inscriptionIdInput.value = inscription.inscription_id;
    els.nameInput.value = inscription.nom || "";
    els.eventKindInput.value = inscription.type_evenement || "MARCHE_ARTISANAL";
    els.statusInput.value = inscription.statut || "A_CONTACTER";
    els.startDateInput.value = inscription.date_debut || "";
    els.endDateInput.value = inscription.date_fin || "";
    els.scheduleInput.value = inscription.horaires || "";
    els.setupInput.value = inscription.mise_en_place || "";
    els.priceInput.value = inscription.prix_emplacement || "";
    els.ownerInput.value = inscription.responsable_user_id || CURRENT_USER.user_id;
    els.cityInput.value = inscription.ville || "";
    els.locationInput.value = inscription.lieu || "";
    els.addressInput.value = inscription.adresse || "";

    els.docSentInput.checked = Boolean(inscription.dossier_envoye);
    els.acceptedInput.checked = Boolean(inscription.acceptation);
    els.tableInput.checked = Boolean(inscription.table_fournie);
    els.barnumInput.checked = Boolean(inscription.barnum_fourni);
    els.chairsInput.checked = Boolean(inscription.chaises_fournies);
    els.lightInput.checked = Boolean(inscription.eclairage_fourni);
    els.electricityInput.checked = Boolean(inscription.electricite_fournie);

    els.contactNameInput.value = inscription.contact_nom || "";
    els.contactMailInput.value = inscription.contact_mail || "";
    els.contactPhoneInput.value = inscription.contact_tel || "";
    els.paymentInput.value = inscription.paiement_statut || "";
    els.commentInput.value = inscription.commentaire || "";

    setStatus("Fiche chargée pour modification.", "isSuccess");

    document.getElementById("trackingFormTitle")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const deleteInscription = (inscriptionId) => {
    const item = getInscriptions().find((inscription) => inscription.inscription_id === inscriptionId);

    if (!item) return;

    const ok = window.confirm(`Supprimer "${item.nom}" du suivi ?`);

    if (!ok) return;

    setInscriptions(
      getInscriptions().filter((inscription) => inscription.inscription_id !== inscriptionId)
    );

    renderAll();
  };

  const createEventFromInscription = (inscriptionId) => {
    const items = getInscriptions();
    const index = items.findIndex((item) => item.inscription_id === inscriptionId);
    const inscription = items[index];

    if (!inscription) return;

    if (inscription.statut !== "ACCEPTE" && !inscription.acceptation) {
      setStatus("L’inscription doit être acceptée avant de créer un évènement.", "isError");
      return;
    }

    if (inscription.evenement_id) {
      setStatus("Un évènement existe déjà pour cette inscription.", "isError");
      return;
    }

    const dates = getDateRange(inscription.date_debut, inscription.date_fin);

    if (dates.length === 0) {
      setStatus("Impossible de créer l’évènement : dates invalides.", "isError");
      return;
    }

    const now = new Date().toISOString();
    const slug = slugify(inscription.nom, "EVENEMENT");
    const stamp = Date.now().toString(36).toUpperCase();
    const eventId = `EVT_${dates[0].replaceAll("-", "")}_${slug}_${stamp}`;

    const eventItem = {
      evenement_id: eventId,
      inscription_id: inscription.inscription_id,
      nom: inscription.nom,
      date_debut: dates[0],
      date_fin: dates[dates.length - 1],
      lieu: inscription.lieu,
      ville: inscription.ville,
      adresse: inscription.adresse,
      horaires: inscription.horaires,
      mise_en_place: inscription.mise_en_place,
      type_evenement: inscription.type_evenement,
      type_evenement_label: inscription.type_evenement_label,
      duree_type: dates.length > 1 ? "PLUSIEURS_JOURS" : "JOURNEE_UNIQUE",
      statut: "prevu",
      vendeurs_prevus: [
        {
          user_id: inscription.responsable_user_id || CURRENT_USER.user_id,
          nom: inscription.responsable_nom || CURRENT_USER.nom
        }
      ],
      responsable_user_id: inscription.responsable_user_id || CURRENT_USER.user_id,
      note: [
        inscription.commentaire ? `Commentaire : ${inscription.commentaire}` : "",
        inscription.paiement_statut ? `Paiement/caution : ${inscription.paiement_statut}` : "",
        inscription.contact_mail ? `Mail : ${inscription.contact_mail}` : "",
        inscription.contact_tel ? `Téléphone : ${inscription.contact_tel}` : ""
      ].filter(Boolean).join("\n"),
      created_at: now,
      updated_at: now
    };

    const jours = dates.map((date, dayIndex) => ({
      journee_id: `J_${date.replaceAll("-", "")}_${slug}_J${dayIndex + 1}_${stamp}`,
      evenement_id: eventId,
      mission_id: "",
      stock_mission_id: "",
      date,
      jour_label: `J${dayIndex + 1}`,
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

    items[index] = {
      ...inscription,
      evenement_id: eventId,
      updated_at: now
    };

    setInscriptions(items);

    setStatus(
      dates.length > 1
        ? `Évènement créé avec ${dates.length} journées : ${dates.map((_, i) => `J${i + 1}`).join(", ")}.`
        : "Évènement créé dans le planning.",
      "isSuccess"
    );

    renderAll();
  };

  const buildCalendarPayload = (inscription) => {
    const dateEnd = inscription.date_fin || inscription.date_debut;

    return {
      title: inscription.nom,
      start_date: inscription.date_debut,
      end_date: dateEnd,
      horaires: inscription.horaires,
      location: [inscription.lieu, inscription.adresse, inscription.ville]
        .filter(Boolean)
        .join(" · "),
      description: [
        inscription.mise_en_place ? `Mise en place : ${inscription.mise_en_place}` : "",
        inscription.responsable_nom ? `Qui : ${inscription.responsable_nom}` : "",
        inscription.prix_emplacement ? `Prix : ${formatCurrency(inscription.prix_emplacement)}` : "",
        inscription.contact_nom ? `Contact : ${inscription.contact_nom}` : "",
        inscription.contact_mail ? `Mail : ${inscription.contact_mail}` : "",
        inscription.contact_tel ? `Téléphone : ${inscription.contact_tel}` : "",
        inscription.commentaire ? `Commentaire : ${inscription.commentaire}` : ""
      ].filter(Boolean).join("\n")
    };
  };

  const addToCalendar = async (inscriptionId) => {
    const items = getInscriptions();
    const index = items.findIndex((item) => item.inscription_id === inscriptionId);
    const inscription = items[index];

    if (!inscription) return;

    if (inscription.statut !== "ACCEPTE" && !inscription.acceptation) {
      setStatus("L’inscription doit être acceptée avant l’ajout calendrier.", "isError");
      return;
    }

    const payload = buildCalendarPayload(inscription);

    try {
      if (window.LugdurumAPI && typeof window.LugdurumAPI.createCalendarEvent === "function") {
        const result = await window.LugdurumAPI.createCalendarEvent(payload);

        items[index] = {
          ...inscription,
          calendar_event_id: result.calendar_event_id || result.id || "",
          calendar_statut: "ajoute",
          calendar_payload: payload,
          updated_at: new Date().toISOString()
        };

        setInscriptions(items);
        setStatus("Évènement ajouté au calendrier.", "isSuccess");
        renderAll();
        return;
      }

      items[index] = {
        ...inscription,
        calendar_statut: "a_synchroniser",
        calendar_payload: payload,
        updated_at: new Date().toISOString()
      };

      setInscriptions(items);
      setStatus("Calendrier marqué à synchroniser. Le branchement Apps Script viendra ensuite.", "isSuccess");
      renderAll();
    } catch (error) {
      setStatus(`Erreur calendrier : ${error.message}`, "isError");
    }
  };

  const getFilteredInscriptions = () => {
    const query = state.search.trim().toLowerCase();

    return getInscriptions()
      .filter((item) => item.statut !== "ANNULE")
      .filter((item) => {
        if (state.filterStatus === "ALL") return true;
        return item.statut === state.filterStatus;
      })
      .filter((item) => {
        if (!query) return true;

        return [
          item.nom,
          item.ville,
          item.lieu,
          item.adresse,
          item.contact_nom,
          item.contact_mail,
          item.commentaire
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => {
        const byDate = String(a.date_debut).localeCompare(String(b.date_debut));
        if (byDate !== 0) return byDate;

        return String(a.nom).localeCompare(String(b.nom));
      });
  };

  const getStatusClass = (status) => {
    if (status === "ACCEPTE") return "isAccepted";
    if (status === "DOSSIER_A_ENVOYER") return "isTodo";
    if (status === "A_RELANCER") return "isWarning";
    if (status === "EN_ATTENTE_REPONSE") return "isWaiting";
    if (status === "REFUSE") return "isRefused";
    return "";
  };

  const getCardClass = (item) => {
    if (item.statut === "ACCEPTE") return "isAcceptedCard";
    if (item.statut === "DOSSIER_A_ENVOYER") return "isTodoCard";
    if (item.statut === "EN_ATTENTE_REPONSE" && item.dossier_envoye) return "isWaitingCard";
    return "";
  };

  const renderStats = () => {
    const items = getInscriptions();

    els.statRelance.textContent = items.filter((item) => item.statut === "A_RELANCER").length;
    els.statWaiting.textContent = items.filter((item) => item.statut === "EN_ATTENTE_REPONSE").length;
    els.statAccepted.textContent = items.filter((item) => item.statut === "ACCEPTE").length;
  };

  const renderFilters = () => {
    document.querySelectorAll("[data-filter-status]").forEach((button) => {
      const isActive = button.dataset.filterStatus === state.filterStatus;

      button.classList.toggle("isActive", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  };

  const renderDayChips = (item) => {
    const dates = getDateRange(item.date_debut, item.date_fin);

    if (dates.length <= 1) return "";

    return `
      <div class="eventDayPreview">
        ${dates
          .map((date, index) => `
            <span>
              J${index + 1} · ${escapeHtml(formatDisplayDate(date))}
            </span>
          `)
          .join("")}
      </div>
    `;
  };

  const renderAddressLine = (fullAddress, wazeUrl) => {
    if (!fullAddress) return "";

    if (!wazeUrl) {
      return `<span>🧭 ${escapeHtml(fullAddress)}</span>`;
    }

    return `
      <a
        class="addressWazeLink"
        href="${escapeAttr(wazeUrl)}"
        target="_blank"
        rel="noopener"
        aria-label="Ouvrir l’adresse dans Waze"
      >
        <span>🧭 ${escapeHtml(fullAddress)}</span>
        <strong>Waze</strong>
      </a>
    `;
  };

  const renderList = () => {
    const items = getFilteredInscriptions();

    if (items.length === 0) {
      els.inscriptionsList.innerHTML =
        `<p class="trackingEmpty">Aucune inscription ne correspond au filtre.</p>`;
      return;
    }

    els.inscriptionsList.innerHTML = items
      .map((item) => {
        const dateLabel =
          item.date_debut === item.date_fin
            ? formatDisplayDate(item.date_debut)
            : `${formatDisplayDate(item.date_debut)} → ${formatDisplayDate(item.date_fin)}`;

        const place = [item.lieu, item.ville].filter(Boolean).join(" · ");
        const fullAddress = [item.adresse, item.ville].filter(Boolean).join(" · ");
        const wazeUrl = buildWazeUrl(item);
        const statusLabel = STATUS_LABELS[item.statut] || item.statut;
        const statusClass = getStatusClass(item.statut);
        const cardClass = getCardClass(item);
        const price = formatCurrency(item.prix_emplacement);

        const material = [
          item.table_fournie ? "Table" : "",
          item.barnum_fourni ? "Barnum" : "",
          item.chaises_fournies ? "Chaises" : "",
          item.eclairage_fourni ? "Éclairage" : "",
          item.electricite_fournie ? "Électricité" : ""
        ].filter(Boolean);

        return `
          <article class="inscriptionCard ${escapeAttr(cardClass)}">
            <div class="inscriptionHeader">
              <div>
                <strong>${escapeHtml(item.nom)}</strong>
                <span>
                  ${escapeHtml(EVENT_KIND_LABELS[item.type_evenement] || item.type_evenement_label || "Évènement")}
                  · ${escapeHtml(dateLabel)}
                </span>
              </div>

              <span class="trackingStatusBadge ${escapeAttr(statusClass)}">
                ${escapeHtml(statusLabel)}
              </span>
            </div>

            ${renderDayChips(item)}

            <div class="inscriptionMeta">
              ${place ? `<span>📍 ${escapeHtml(place)}</span>` : ""}
              ${renderAddressLine(fullAddress, wazeUrl)}
              ${item.horaires ? `<span>🕒 ${escapeHtml(item.horaires)}</span>` : ""}
              ${item.mise_en_place ? `<span>🚚 ${escapeHtml(item.mise_en_place)}</span>` : ""}
              ${price ? `<span>💶 ${escapeHtml(price)}</span>` : ""}
              ${item.responsable_nom ? `<span>👤 ${escapeHtml(item.responsable_nom)}</span>` : ""}
            </div>

            ${
              material.length > 0
                ? `
                  <div class="trackingChips">
                    ${material.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
                  </div>
                `
                : ""
            }

            ${
              item.contact_mail || item.contact_tel || item.contact_nom
                ? `
                  <div class="contactBox">
                    ${item.contact_nom ? `<span>${escapeHtml(item.contact_nom)}</span>` : ""}
                    ${item.contact_mail ? `<span>${escapeHtml(item.contact_mail)}</span>` : ""}
                    ${item.contact_tel ? `<span>${escapeHtml(item.contact_tel)}</span>` : ""}
                  </div>
                `
                : ""
            }

            ${
              item.commentaire
                ? `<p class="inscriptionComment">${escapeHtml(item.commentaire)}</p>`
                : ""
            }

            <div class="inscriptionFlags">
              ${item.dossier_envoye ? `<span class="flagOk">Dossier envoyé</span>` : `<span>Dossier non envoyé</span>`}
              ${item.acceptation ? `<span class="flagOk">Accepté</span>` : ""}
              ${item.evenement_id ? `<span class="flagOk">Évènement créé</span>` : ""}
              ${item.calendar_statut === "ajoute" ? `<span class="flagOk">Calendrier OK</span>` : ""}
              ${item.calendar_statut === "a_synchroniser" ? `<span class="flagWarning">Calendrier à synchroniser</span>` : ""}
            </div>

            <div class="inscriptionActions">
              <button
                class="trackingSmallBtn"
                type="button"
                data-edit-inscription="${escapeAttr(item.inscription_id)}"
              >
                Modifier
              </button>

              <button
                class="trackingSmallBtn primary"
                type="button"
                data-create-event="${escapeAttr(item.inscription_id)}"
                ${item.evenement_id ? "disabled" : ""}
              >
                Créer l’évènement
              </button>

              <button
                class="trackingSmallBtn"
                type="button"
                data-calendar-inscription="${escapeAttr(item.inscription_id)}"
              >
                Calendrier
              </button>

              <button
                class="trackingSmallBtn danger"
                type="button"
                data-delete-inscription="${escapeAttr(item.inscription_id)}"
              >
                Supprimer
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const renderAll = () => {
    renderStats();
    renderFilters();
    renderList();
  };

  document.addEventListener("click", (event) => {
    const filterButton = event.target.closest("[data-filter-status]");
    if (filterButton) {
      state.filterStatus = filterButton.dataset.filterStatus;
      renderAll();
      return;
    }

    const editButton = event.target.closest("[data-edit-inscription]");
    if (editButton) {
      const item = getInscriptions().find(
        (inscription) => inscription.inscription_id === editButton.dataset.editInscription
      );

      if (item) fillForm(item);
      return;
    }

    const createEventButton = event.target.closest("[data-create-event]");
    if (createEventButton) {
      createEventFromInscription(createEventButton.dataset.createEvent);
      return;
    }

    const calendarButton = event.target.closest("[data-calendar-inscription]");
    if (calendarButton) {
      addToCalendar(calendarButton.dataset.calendarInscription);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-inscription]");
    if (deleteButton) {
      deleteInscription(deleteButton.dataset.deleteInscription);
    }
  });

  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value;
    renderList();
  });

  els.statusInput.addEventListener("change", () => {
    if (els.statusInput.value === "ACCEPTE") {
      els.acceptedInput.checked = true;
      els.docSentInput.checked = true;
    }

    if (["EN_ATTENTE_REPONSE", "A_RELANCER", "LISTE_ATTENTE"].includes(els.statusInput.value)) {
      els.docSentInput.checked = true;
    }
  });

  els.acceptedInput.addEventListener("change", () => {
    if (els.acceptedInput.checked) {
      els.statusInput.value = "ACCEPTE";
      els.docSentInput.checked = true;
    }
  });

  els.docSentInput.addEventListener("change", () => {
    if (
      els.docSentInput.checked &&
      ["A_CONTACTER", "DOSSIER_A_ENVOYER"].includes(els.statusInput.value)
    ) {
      els.statusInput.value = "EN_ATTENTE_REPONSE";
    }
  });

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();

    const inscription = buildInscriptionFromForm();

    if (!inscription) return;

    saveInscription(inscription);

    setStatus("Inscription enregistrée.", "isSuccess");
    resetForm();
    renderAll();
  });

  els.resetFormBtn.addEventListener("click", resetForm);

  setDefaultDate();
  renderAll();
})();