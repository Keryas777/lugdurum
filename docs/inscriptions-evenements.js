(() => {
  "use strict";

  /*
    Inscriptions évènements V9 — connecté Google Sheets :
    - Source principale : Google Sheets via window.LugdurumAPI.
    - Cache localStorage conservé en secours si l’API est indisponible.
    - Lecture :
      - inscriptions_evenements
      - missions_vente
      - journees_vente
    - Écriture :
      - création / modification inscription
      - annulation logique d’une inscription
      - création d’un évènement confirmé dans missions_vente
      - génération des journées liées dans journees_vente
    - Une inscription acceptée crée automatiquement un évènement si aucun évènement lié n’existe.
    - L’évènement créé est stocké dans missions_vente avec mission_id.
    - L’inscription conserve ce lien dans evenement_id.
    - Les journées utilisent mission_id = mission_id de missions_vente.
    - Les journées gardent aussi evenement_id = mission_id pour compatibilité avec les autres pages.
    - Après création d’un évènement, redirection vers missions.html?event_id=...&auto_select=1.
    - Si l’évènement existe déjà, un bouton Mission stock permet de poursuivre le parcours.
    - Le bouton Créer l’évènement reste disponible en secours manuel.
    - Le bouton Calendrier ouvre un lien Google Calendar en fallback si l’API calendrier n’est pas disponible.
    - Ajoute un vrai sélecteur paiement :
      paiement_statut = A_ENVOYER / ENVOYE / ENCAISSE
      paiement_statut_label = libellé lisible
    - Le champ texte “Détail paiement / caution” est stocké dans caution.
    - Compat ancienne donnée : si paiement_statut contenait du texte libre, il est repris dans caution.
    - Remplace le sélecteur personne unique par des chips multi-sélection :
      Antho, Will, Jay.
    - Écrit vendeurs_prevus et vendeurs_prevus_noms dans inscriptions_evenements.
    - Propage vendeurs_prevus et vendeurs_prevus_noms vers missions_vente.
    - Garde responsable_user_id / responsable_nom en compatibilité, basé sur Jay si sélectionné,
      sinon sur la première personne sélectionnée.
  */

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jay"
  };

  const OPERATORS = {
    U_JEROME: "Jay",
    U_ANTHO: "Antho",
    U_WILL: "Will"
  };

  const VENDORS = [
    {
      user_id: "U_ANTHO",
      nom: "Antho"
    },
    {
      user_id: "U_WILL",
      nom: "Will"
    },
    {
      user_id: "U_JEROME",
      nom: "Jay"
    }
  ];

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
    A_CONTACTER: "À contacter",
    DOSSIER_A_ENVOYER: "Dossier à envoyer",
    EN_ATTENTE_REPONSE: "En attente",
    A_RELANCER: "À relancer",
    LISTE_ATTENTE: "Liste d’attente",
    ACCEPTE: "Accepté",
    REFUSE: "Refusé",
    ANNULE: "Annulé"
  };

  const PAYMENT_STATUS_LABELS = {
    A_ENVOYER: "À envoyer",
    ENVOYE: "Envoyé",
    ENCAISSE: "Encaissé"
  };

  const STORAGE_KEYS = {
    inscriptions: "lugdurum_inscriptions_evenements",
    missions: "lugdurum_evenements",
    journees: "lugdurum_journees"
  };

  const state = {
    filterStatus: "ALL",
    search: "",
    editingId: "",
    inscriptions: [],
    missions: [],
    journees: [],
    isLoading: false,
    isSaving: false,
    usingCache: false
  };

  const els = {
    form: document.getElementById("inscriptionForm"),
    formTitle: document.getElementById("trackingFormTitle"),
    inscriptionIdInput: document.getElementById("inscriptionIdInput"),

    nameInput: document.getElementById("nameInput"),
    eventKindInput: document.getElementById("eventKindInput"),
    statusInput: document.getElementById("statusInput"),
    paymentStatusInput: document.getElementById("paymentStatusInput"),
    startDateInput: document.getElementById("startDateInput"),
    endDateInput: document.getElementById("endDateInput"),
    scheduleInput: document.getElementById("scheduleInput"),
    setupInput: document.getElementById("setupInput"),
    priceInput: document.getElementById("priceInput"),
    ownerInput: document.getElementById("ownerInput"),
    vendorsInput: document.getElementById("vendorsInput"),
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
    saveInscriptionBtn: document.getElementById("saveInscriptionBtn"),
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

  const api = () => window.LugdurumAPI || null;

  const hasApi = () => Boolean(api());

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

  const normalizeToken = (value) =>
    String(value ?? "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

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

  const toBoolean = (value, fallback = false) => {
    if (value === true) return true;
    if (value === false) return false;

    if (typeof value === "number") return value !== 0;

    const normalized = String(value ?? "")
      .trim()
      .toLowerCase();

    if (!normalized) return fallback;

    if (["true", "vrai", "oui", "yes", "1", "x", "actif"].includes(normalized)) {
      return true;
    }

    if (["false", "faux", "non", "no", "0", "inactif"].includes(normalized)) {
      return false;
    }

    return fallback;
  };

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

  const formatCalendarDate = (isoDate) =>
    String(isoDate || "").replaceAll("-", "");

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

  const isKnownPaymentStatus = (value) =>
    Object.prototype.hasOwnProperty.call(
      PAYMENT_STATUS_LABELS,
      String(value || "").trim()
    );

  const getPaymentStatusValue = (item) => {
    const value = String(item?.paiement_statut || "").trim();

    if (isKnownPaymentStatus(value)) return value;

    return "A_ENVOYER";
  };

  const getPaymentStatusLabel = (itemOrValue) => {
    const rawValue =
      typeof itemOrValue === "object"
        ? String(itemOrValue?.paiement_statut || "").trim()
        : String(itemOrValue || "").trim();

    if (isKnownPaymentStatus(rawValue)) {
      return PAYMENT_STATUS_LABELS[rawValue];
    }

    if (typeof itemOrValue === "object") {
      const label = String(itemOrValue?.paiement_statut_label || "").trim();
      if (label) return label;
    }

    return PAYMENT_STATUS_LABELS.A_ENVOYER;
  };

  const getLegacyPaymentDetail = (inscription) => {
    const caution = String(inscription?.caution || "").trim();
    if (caution) return caution;

    const oldPaymentValue = String(inscription?.paiement_statut || "").trim();

    if (oldPaymentValue && !isKnownPaymentStatus(oldPaymentValue)) {
      return oldPaymentValue;
    }

    return "";
  };

  const getVendorLabel = (vendorId) =>
    OPERATORS[vendorId] || String(vendorId || "").trim();

  const isKnownVendorId = (vendorId) =>
    Object.prototype.hasOwnProperty.call(OPERATORS, String(vendorId || "").trim());

  const normalizeVendorId = (value) => {
    if (value && typeof value === "object") {
      return normalizeVendorId(
        value.user_id ||
        value.vendor_id ||
        value.id ||
        value.value ||
        value.nom ||
        value.name ||
        ""
      );
    }

    const raw = String(value || "").trim();

    if (isKnownVendorId(raw)) return raw;

    const normalized = normalizeToken(raw);

    if (["U_JEROME", "JEROME", "JAY"].includes(normalized)) return "U_JEROME";
    if (["U_ANTHO", "ANTHO", "ANTHONY"].includes(normalized)) return "U_ANTHO";
    if (["U_WILL", "WILL", "WILLIAM"].includes(normalized)) return "U_WILL";

    return "";
  };

  const dedupeVendorIds = (vendorIds = []) => {
    const seen = new Set();
    const result = [];

    vendorIds.forEach((vendorId) => {
      const normalized = normalizeVendorId(vendorId);

      if (!normalized || seen.has(normalized)) return;

      seen.add(normalized);
      result.push(normalized);
    });

    return result;
  };

  const parseVendorIdsFromValue = (value) => {
    if (Array.isArray(value)) {
      return dedupeVendorIds(value.map((item) => normalizeVendorId(item)));
    }

    if (value && typeof value === "object") {
      return dedupeVendorIds([normalizeVendorId(value)]);
    }

    const text = String(value || "").trim();

    if (!text) return [];

    try {
      const parsed = JSON.parse(text);
      return parseVendorIdsFromValue(parsed);
    } catch {
      // Texte libre ou liste séparée par virgule.
    }

    return dedupeVendorIds(text.split(/[;,|]/).map((item) => normalizeVendorId(item)));
  };

  const getVendorIdsFromInscription = (inscription) => {
    const fromJson = parseVendorIdsFromValue(inscription?.vendeurs_prevus);

    if (fromJson.length > 0) return fromJson;

    const fromNames = parseVendorIdsFromValue(inscription?.vendeurs_prevus_noms);

    if (fromNames.length > 0) return fromNames;

    const fromResponsible = parseVendorIdsFromValue(inscription?.responsable_user_id);

    if (fromResponsible.length > 0) return fromResponsible;

    return [CURRENT_USER.user_id];
  };

  const getPrimaryVendorId = (vendorIds = []) => {
    const safeVendorIds = dedupeVendorIds(vendorIds);

    if (safeVendorIds.includes(CURRENT_USER.user_id)) {
      return CURRENT_USER.user_id;
    }

    return safeVendorIds[0] || CURRENT_USER.user_id;
  };

  const getVendorNames = (vendorIds = []) =>
    dedupeVendorIds(vendorIds)
      .map((vendorId) => getVendorLabel(vendorId))
      .filter(Boolean)
      .join(", ");

  const buildVendorsArray = (vendorIds = []) =>
    dedupeVendorIds(vendorIds).map((vendorId) => ({
      user_id: vendorId,
      nom: getVendorLabel(vendorId)
    }));

  const buildVendorsJson = (vendorIds = []) =>
    JSON.stringify(buildVendorsArray(vendorIds));

  const getVendorsLabel = (inscription) => {
    const names =
      String(inscription?.vendeurs_prevus_noms || "").trim() ||
      getVendorNames(getVendorIdsFromInscription(inscription));

    return names || getVendorLabel(inscription?.responsable_user_id || CURRENT_USER.user_id);
  };

  const getSelectedVendorIds = () => {
    const selected = [...document.querySelectorAll("[data-vendor-id].isActive")]
      .map((button) => button.dataset.vendorId)
      .filter(Boolean);

    return dedupeVendorIds(selected.length > 0 ? selected : [CURRENT_USER.user_id]);
  };

  const syncVendorInputs = (vendorIds = []) => {
    const safeVendorIds = dedupeVendorIds(vendorIds.length > 0 ? vendorIds : [CURRENT_USER.user_id]);
    const primaryVendorId = getPrimaryVendorId(safeVendorIds);

    if (els.ownerInput) {
      els.ownerInput.value = primaryVendorId;
    }

    if (els.vendorsInput) {
      els.vendorsInput.value = JSON.stringify(safeVendorIds);
    }
  };

  const setSelectedVendorIds = (vendorIds = []) => {
    const safeVendorIds = dedupeVendorIds(vendorIds.length > 0 ? vendorIds : [CURRENT_USER.user_id]);

    document.querySelectorAll("[data-vendor-id]").forEach((button) => {
      const isActive = safeVendorIds.includes(button.dataset.vendorId);

      button.classList.toggle("isActive", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    syncVendorInputs(safeVendorIds);
  };

  const toggleVendor = (vendorId) => {
    const safeVendorId = normalizeVendorId(vendorId);

    if (!safeVendorId) return;

    const currentVendorIds = getSelectedVendorIds();
    const isAlreadySelected = currentVendorIds.includes(safeVendorId);

    if (isAlreadySelected && currentVendorIds.length <= 1) {
      setStatus("Garde au moins une personne prévue sur l’évènement.", "isError");
      setSelectedVendorIds(currentVendorIds);
      return;
    }

    const nextVendorIds = isAlreadySelected
      ? currentVendorIds.filter((id) => id !== safeVendorId)
      : [...currentVendorIds, safeVendorId];

    setStatus("");
    setSelectedVendorIds(nextVendorIds);
  };

  const getPendingWritesCount = () => {
    if (hasApi() && typeof api().getPendingWritesCount === "function") {
      return api().getPendingWritesCount();
    }

    return 0;
  };

  const mergeByKey = (remoteItems, localItems, keyField) => {
    const map = new Map();

    localItems.forEach((item) => {
      const key = String(item?.[keyField] || "").trim();
      if (key) map.set(key, item);
    });

    remoteItems.forEach((item) => {
      const key = String(item?.[keyField] || "").trim();
      if (key) map.set(key, item);
    });

    return [...map.values()];
  };

  const setStatus = (message, type = "") => {
    els.formStatus.textContent = message;
    els.formStatus.className = "trackingStatus";

    if (type) {
      els.formStatus.classList.add(type);
    }
  };

  const setSaving = (isSaving) => {
    state.isSaving = isSaving;

    [
      els.saveInscriptionBtn,
      els.resetFormBtn,
      ...document.querySelectorAll("[data-vendor-id]")
    ].forEach((button) => {
      if (button) button.disabled = isSaving;
    });
  };

  const setDefaultDate = () => {
    if (!els.startDateInput.value) {
      els.startDateInput.value = formatIsoDate(new Date());
    }
  };

  const cacheAll = () => {
    writeJson(STORAGE_KEYS.inscriptions, state.inscriptions);
    writeJson(STORAGE_KEYS.missions, state.missions);
    writeJson(STORAGE_KEYS.journees, state.journees);
  };

  const loadFromCache = () => {
    state.inscriptions = readJson(STORAGE_KEYS.inscriptions, []);
    state.missions = readJson(STORAGE_KEYS.missions, []);
    state.journees = readJson(STORAGE_KEYS.journees, []);
    state.usingCache = true;
  };

  const getInscriptions = () => state.inscriptions;

  const getMissions = () => state.missions;

  const getJournees = () => state.journees;

  const getMissionIdFromInscription = (inscription) =>
    String(inscription?.evenement_id || inscription?.mission_id || "").trim();

  const getMissionById = (missionId) =>
    getMissions().find((mission) => String(mission.mission_id || "") === String(missionId || ""));

  const getMissionStockHref = (missionId) =>
    `./missions.html?event_id=${encodeURIComponent(missionId)}&auto_select=1`;

  const isAcceptedInscription = (inscription) =>
    Boolean(inscription) &&
    (
      inscription.statut === "ACCEPTE" ||
      toBoolean(inscription.acceptation)
    );

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
    items.forEach((item) => {
      upsertLocal(collectionName, idKey, item);
    });

    cacheAll();
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

  const buildNoteFromInscription = (inscription) =>
    [
      inscription.commentaire ? `Commentaire : ${inscription.commentaire}` : "",
      inscription.vendeurs_prevus_noms ? `Équipe prévue : ${inscription.vendeurs_prevus_noms}` : "",
      inscription.paiement_statut_label ? `Paiement : ${inscription.paiement_statut_label}` : "",
      inscription.caution ? `Détail paiement/caution : ${inscription.caution}` : "",
      inscription.contact_nom ? `Contact : ${inscription.contact_nom}` : "",
      inscription.contact_mail ? `Mail : ${inscription.contact_mail}` : "",
      inscription.contact_tel ? `Téléphone : ${inscription.contact_tel}` : ""
    ].filter(Boolean).join("\n");

  const buildVendorCell = (inscription) =>
    buildVendorsJson(getVendorIdsFromInscription(inscription));

  const buildInscriptionFromForm = () => {
    const now = new Date().toISOString();
    const name = els.nameInput.value.trim();
    const startDate = els.startDateInput.value;
    const endDate = els.endDateInput.value || startDate;
    const dates = getDateRange(startDate, endDate);
    const vendorIds = getSelectedVendorIds();
    const primaryVendorId = getPrimaryVendorId(vendorIds);

    if (!name) {
      setStatus("Indique le nom du marché ou salon.", "isError");
      return null;
    }

    if (!startDate || dates.length === 0) {
      setStatus("Indique une période valide.", "isError");
      return null;
    }

    if (vendorIds.length === 0) {
      setStatus("Sélectionne au moins une personne prévue sur l’évènement.", "isError");
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

    const paiementStatut = isKnownPaymentStatus(els.paymentStatusInput?.value)
      ? els.paymentStatusInput.value
      : "A_ENVOYER";

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
      paiement_statut: paiementStatut,
      paiement_statut_label: PAYMENT_STATUS_LABELS[paiementStatut] || paiementStatut,
      caution: els.paymentInput.value.trim(),
      table_fournie: els.tableInput.checked,
      barnum_fourni: els.barnumInput.checked,
      chaises_fournies: els.chairsInput.checked,
      eclairage_fourni: els.lightInput.checked,
      electricite_fournie: els.electricityInput.checked,
      responsable_user_id: primaryVendorId,
      responsable_nom: getVendorLabel(primaryVendorId),
      vendeurs_prevus: buildVendorsJson(vendorIds),
      vendeurs_prevus_noms: getVendorNames(vendorIds),
      contact_nom: els.contactNameInput.value.trim(),
      contact_mail: els.contactMailInput.value.trim(),
      contact_tel: els.contactPhoneInput.value.trim(),
      commentaire: els.commentInput.value.trim(),
      evenement_id: existing?.evenement_id || "",
      calendar_event_id: existing?.calendar_event_id || "",
      calendar_statut: existing?.calendar_statut || "",
      calendar_payload: existing?.calendar_payload || null,
      source: existing?.source || "INSCRIPTION",
      created_at: existing?.created_at || now,
      updated_at: now
    };
  };

  const buildMissionFromInscription = (inscription, missionId, existingMission = null, dates = null) => {
    const resolvedDates = dates || getDateRange(inscription.date_debut, inscription.date_fin);
    const now = new Date().toISOString();
    const vendorIds = getVendorIdsFromInscription(inscription);
    const primaryVendorId = getPrimaryVendorId(vendorIds);

    return {
      ...existingMission,
      mission_id: missionId,
      inscription_id: inscription.inscription_id,
      nom: inscription.nom,
      date_debut: resolvedDates[0] || inscription.date_debut,
      date_fin: resolvedDates[resolvedDates.length - 1] || inscription.date_fin,
      lieu: inscription.lieu,
      ville: inscription.ville,
      adresse: inscription.adresse,
      horaires: inscription.horaires,
      mise_en_place: inscription.mise_en_place,
      type_evenement: inscription.type_evenement,
      type_evenement_label: inscription.type_evenement_label,
      duree_type: resolvedDates.length > 1 ? "PLUSIEURS_JOURS" : "JOURNEE_UNIQUE",
      statut: existingMission?.statut || "prevu",
      vendeurs_prevus: buildVendorCell(inscription),
      vendeurs_prevus_noms: getVendorNames(vendorIds),
      responsable_user_id: primaryVendorId,
      responsable_nom: getVendorLabel(primaryVendorId),
      source: existingMission?.source || "INSCRIPTION",
      note: buildNoteFromInscription(inscription),
      created_at: existingMission?.created_at || now,
      updated_at: now
    };
  };

  const getAllMissionJournees = (missionId) =>
    getJournees()
      .filter((journee) => {
        return (
          String(journee.mission_id || "") === String(missionId || "") ||
          String(journee.evenement_id || "") === String(missionId || "")
        );
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const getEventJournees = (missionId) =>
    getAllMissionJournees(missionId)
      .filter((journee) => String(journee.statut || "").toLowerCase() !== "annule");

  const isJourneeSafeToRegenerate = (journee) => {
    const statut = String(journee.statut || "prevu").trim().toLowerCase();
    const stockMissionId = String(journee.stock_mission_id || "").trim();

    return (
      statut === "prevu" &&
      !stockMissionId &&
      !journee.started_at &&
      !journee.closed_at
    );
  };

  const canRegenerateEventJournees = (missionId) => {
    const linkedDays = getEventJournees(missionId);

    if (linkedDays.length === 0) return true;

    return linkedDays.every(isJourneeSafeToRegenerate);
  };

  const buildJourneesForMission = (missionId, inscription, dates, existingDays = []) => {
    const now = new Date().toISOString();
    const slug = slugify(inscription.nom, "EVENEMENT");
    const stamp = Date.now().toString(36).toUpperCase();

    const activeRows = dates.map((date, dayIndex) => {
      const existing = existingDays[dayIndex];

      return {
        ...existing,
        journee_id: existing?.journee_id || `J_${date.replaceAll("-", "")}_${slug}_J${dayIndex + 1}_${stamp}`,
        mission_id: missionId,
        evenement_id: missionId,
        stock_mission_id: existing?.stock_mission_id || "",
        date,
        jour_label: `J${dayIndex + 1}`,
        statut: existing?.statut && existing.statut !== "annule" ? existing.statut : "prevu",
        meteo: existing?.meteo || "",
        affluence_ressentie: existing?.affluence_ressentie || "",
        source: existing?.source || "INSCRIPTION",
        note: existing?.note || "",
        started_at: existing?.started_at || "",
        closed_at: existing?.closed_at || "",
        created_at: existing?.created_at || now,
        updated_at: now
      };
    });

    const cancelledRows = existingDays
      .slice(dates.length)
      .map((journee) => ({
        ...journee,
        statut: "annule",
        updated_at: now
      }));

    return [...activeRows, ...cancelledRows];
  };

  const saveInscriptionOnly = async (inscription) => {
    if (hasApi() && typeof api().saveInscriptionEvenement === "function") {
      await api().saveInscriptionEvenement(inscription);
    }

    upsertLocal("inscriptions", "inscription_id", inscription);
  };

  const saveMissionOnly = async (mission) => {
    if (hasApi() && typeof api().saveMission === "function") {
      await api().saveMission(mission);
    }

    upsertLocal("missions", "mission_id", mission);
  };

  const saveJourneesOnly = async (journees) => {
    if (hasApi() && typeof api().saveJournee === "function") {
      for (const journee of journees) {
        await api().saveJournee(journee);
      }
    }

    upsertManyLocal("journees", "journee_id", journees);
  };

  const saveInscriptionMissionBundle = async ({ inscription, mission, journees = [] }) => {
    if (
      hasApi() &&
      typeof api().saveInscriptionEventBundle === "function"
    ) {
      try {
        await api().saveInscriptionEventBundle({
          inscription,
          event: mission,
          mission,
          journees
        });

        upsertLocal("inscriptions", "inscription_id", inscription);
        upsertLocal("missions", "mission_id", mission);

        if (journees.length > 0) {
          upsertManyLocal("journees", "journee_id", journees);
        }

        return;
      } catch (error) {
        console.warn("Bundle API impossible, tentative en écritures séparées.", error);
      }
    }

    await saveInscriptionOnly(inscription);
    await saveMissionOnly(mission);

    if (journees.length > 0) {
      await saveJourneesOnly(journees);
    }
  };

  const syncLinkedEventFromInscription = async (inscription) => {
    const missionId = getMissionIdFromInscription(inscription);

    if (!missionId) {
      await saveInscriptionOnly(inscription);

      return {
        status: "none",
        message: ""
      };
    }

    const existingMission = getMissionById(missionId);

    if (!existingMission) {
      await saveInscriptionOnly(inscription);

      return {
        status: "warning",
        message: "Inscription modifiée, mais l’évènement lié est introuvable dans missions_vente."
      };
    }

    const dates = getDateRange(inscription.date_debut, inscription.date_fin);

    const newDateDebut = dates[0] || inscription.date_debut;
    const newDateFin = dates[dates.length - 1] || inscription.date_fin;

    const datesChanged =
      String(existingMission.date_debut || "") !== String(newDateDebut || "") ||
      String(existingMission.date_fin || "") !== String(newDateFin || "");

    if (datesChanged && !canRegenerateEventJournees(missionId)) {
      const missionWithoutDateChange = buildMissionFromInscription(
        inscription,
        missionId,
        {
          ...existingMission,
          date_debut: existingMission.date_debut,
          date_fin: existingMission.date_fin,
          duree_type: existingMission.duree_type
        },
        getDateRange(existingMission.date_debut, existingMission.date_fin)
      );

      missionWithoutDateChange.date_debut = existingMission.date_debut;
      missionWithoutDateChange.date_fin = existingMission.date_fin;
      missionWithoutDateChange.duree_type = existingMission.duree_type;

      await saveInscriptionMissionBundle({
        inscription,
        mission: missionWithoutDateChange,
        journees: []
      });

      return {
        status: "warning",
        message:
          "Modifications enregistrées, mais les dates de l’évènement lié n’ont pas été changées : des journées semblent déjà utilisées."
      };
    }

    const updatedMission = buildMissionFromInscription(
      inscription,
      missionId,
      existingMission,
      dates
    );

    let journeesToSave = [];

    if (datesChanged) {
      const existingDays = getAllMissionJournees(missionId);
      journeesToSave = buildJourneesForMission(
        missionId,
        inscription,
        dates,
        existingDays
      );
    }

    await saveInscriptionMissionBundle({
      inscription,
      mission: updatedMission,
      journees: journeesToSave
    });

    if (datesChanged) {
      const activeCount = journeesToSave.filter((journee) => journee.statut !== "annule").length;

      return {
        status: "success",
        message:
          activeCount > 1
            ? `Modifications enregistrées. Évènement lié mis à jour avec ${activeCount} journées.`
            : "Modifications enregistrées. Évènement lié mis à jour avec 1 journée."
      };
    }

    return {
      status: "success",
      message: "Modifications enregistrées. Évènement lié mis à jour."
    };
  };

  const resetForm = ({ keepStatus = false } = {}) => {
    state.editingId = "";
    els.form.reset();
    els.inscriptionIdInput.value = "";
    els.statusInput.value = "A_CONTACTER";

    if (els.paymentStatusInput) {
      els.paymentStatusInput.value = "A_ENVOYER";
    }

    setSelectedVendorIds([CURRENT_USER.user_id]);

    if (els.formTitle) {
      els.formTitle.textContent = "Ajouter une inscription";
    }

    if (els.saveInscriptionBtn) {
      els.saveInscriptionBtn.textContent = "Enregistrer";
    }

    setDefaultDate();

    if (!keepStatus) {
      setStatus("");
    }
  };

  const fillForm = (inscription) => {
    state.editingId = inscription.inscription_id;

    els.inscriptionIdInput.value = inscription.inscription_id;
    els.nameInput.value = inscription.nom || "";
    els.eventKindInput.value = inscription.type_evenement || "MARCHE_ARTISANAL";
    els.statusInput.value = inscription.statut || "A_CONTACTER";

    if (els.paymentStatusInput) {
      els.paymentStatusInput.value = getPaymentStatusValue(inscription);
    }

    els.startDateInput.value = inscription.date_debut || "";
    els.endDateInput.value = inscription.date_fin || "";
    els.scheduleInput.value = inscription.horaires || "";
    els.setupInput.value = inscription.mise_en_place || "";
    els.priceInput.value = inscription.prix_emplacement || "";
    els.cityInput.value = inscription.ville || "";
    els.locationInput.value = inscription.lieu || "";
    els.addressInput.value = inscription.adresse || "";

    setSelectedVendorIds(getVendorIdsFromInscription(inscription));

    els.docSentInput.checked = toBoolean(inscription.dossier_envoye);
    els.acceptedInput.checked = toBoolean(inscription.acceptation);
    els.tableInput.checked = toBoolean(inscription.table_fournie);
    els.barnumInput.checked = toBoolean(inscription.barnum_fourni);
    els.chairsInput.checked = toBoolean(inscription.chaises_fournies);
    els.lightInput.checked = toBoolean(inscription.eclairage_fourni);
    els.electricityInput.checked = toBoolean(inscription.electricite_fournie);

    els.contactNameInput.value = inscription.contact_nom || "";
    els.contactMailInput.value = inscription.contact_mail || "";
    els.contactPhoneInput.value = inscription.contact_tel || "";
    els.paymentInput.value = getLegacyPaymentDetail(inscription);
    els.commentInput.value = inscription.commentaire || "";

    if (els.formTitle) {
      els.formTitle.textContent = "Modifier une inscription";
    }

    if (els.saveInscriptionBtn) {
      els.saveInscriptionBtn.textContent = "Enregistrer les modifications";
    }

    setStatus("Fiche chargée pour modification.", "isSuccess");

    document.getElementById("trackingFormTitle")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const deleteInscription = async (inscriptionId) => {
    const item = getInscriptions().find((inscription) => inscription.inscription_id === inscriptionId);

    if (!item) return;

    const ok = window.confirm(`Annuler "${item.nom}" dans le suivi ?`);

    if (!ok) return;

    const cancelled = {
      ...item,
      statut: "ANNULE",
      updated_at: new Date().toISOString()
    };

    setSaving(true);
    setStatus("Annulation en cours...");

    try {
      if (
        hasApi() &&
        typeof api().cancelInscriptionEvenement === "function"
      ) {
        await api().cancelInscriptionEvenement(inscriptionId);
      } else {
        await saveInscriptionOnly(cancelled);
      }

      upsertLocal("inscriptions", "inscription_id", cancelled);

      renderAll();
      setStatus("Inscription annulée.", "isSuccess");
    } catch (error) {
      setStatus(`Erreur annulation : ${error.message}`, "isError");
    } finally {
      setSaving(false);
    }
  };

  const createEventFromInscription = async (inscriptionId) => {
    const items = getInscriptions();
    const inscription = items.find((item) => item.inscription_id === inscriptionId);

    if (!inscription) return null;

    if (!isAcceptedInscription(inscription)) {
      setStatus("L’inscription doit être acceptée avant de créer un évènement.", "isError");
      return null;
    }

    if (getMissionIdFromInscription(inscription)) {
      const missionId = getMissionIdFromInscription(inscription);
      setStatus("Un évènement existe déjà pour cette inscription. Redirection vers la mission de stock…", "isSuccess");

      window.setTimeout(() => {
        window.location.href = getMissionStockHref(missionId);
      }, 650);

      return {
        created: false,
        missionId
      };
    }

    const dates = getDateRange(inscription.date_debut, inscription.date_fin);

    if (dates.length === 0) {
      setStatus("Impossible de créer l’évènement : dates invalides.", "isError");
      return null;
    }

    const now = new Date().toISOString();
    const slug = slugify(inscription.nom, "EVENEMENT");
    const stamp = Date.now().toString(36).toUpperCase();
    const missionId = `EVT_${dates[0].replaceAll("-", "")}_${slug}_${stamp}`;

    const updatedInscription = {
      ...inscription,
      evenement_id: missionId,
      updated_at: now
    };

    const mission = buildMissionFromInscription(
      updatedInscription,
      missionId,
      null,
      dates
    );

    const journees = buildJourneesForMission(
      missionId,
      updatedInscription,
      dates,
      []
    );

    setSaving(true);
    setStatus("Création de l’évènement...");

    try {
      await saveInscriptionMissionBundle({
        inscription: updatedInscription,
        mission,
        journees
      });

      renderAll();

      setStatus(
        dates.length > 1
          ? `Évènement créé avec ${dates.length} journées. Redirection vers la mission de stock…`
          : "Évènement créé. Redirection vers la mission de stock…",
        "isSuccess"
      );

      window.setTimeout(() => {
        window.location.href = getMissionStockHref(missionId);
      }, 850);

      return {
        created: true,
        missionId
      };
    } catch (error) {
      setStatus(`Erreur création évènement : ${error.message}`, "isError");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const buildCalendarPayload = (inscription) => {
    const dateEnd = inscription.date_fin || inscription.date_debut;
    const vendorsLabel = getVendorsLabel(inscription);

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
        vendorsLabel ? `Qui : ${vendorsLabel}` : "",
        inscription.prix_emplacement ? `Prix : ${formatCurrency(inscription.prix_emplacement)}` : "",
        inscription.paiement_statut_label ? `Paiement : ${inscription.paiement_statut_label}` : "",
        inscription.caution ? `Détail paiement/caution : ${inscription.caution}` : "",
        inscription.contact_nom ? `Contact : ${inscription.contact_nom}` : "",
        inscription.contact_mail ? `Mail : ${inscription.contact_mail}` : "",
        inscription.contact_tel ? `Téléphone : ${inscription.contact_tel}` : "",
        inscription.commentaire ? `Commentaire : ${inscription.commentaire}` : ""
      ].filter(Boolean).join("\n")
    };
  };

  const buildGoogleCalendarUrl = (payload) => {
    const start = parseLocalDate(payload.start_date);
    const end = parseLocalDate(payload.end_date || payload.start_date);

    if (!start || !end) return "";

    const endExclusive = addDays(end, 1);
    const dates = `${formatCalendarDate(formatIsoDate(start))}/${formatCalendarDate(formatIsoDate(endExclusive))}`;

    const details = [
      payload.horaires ? `Horaires : ${payload.horaires}` : "",
      payload.description || ""
    ].filter(Boolean).join("\n\n");

    const url = new URL("https://calendar.google.com/calendar/render");
    url.searchParams.set("action", "TEMPLATE");
    url.searchParams.set("text", payload.title || "Évènement Lugdurum");
    url.searchParams.set("dates", dates);

    if (payload.location) {
      url.searchParams.set("location", payload.location);
    }

    if (details) {
      url.searchParams.set("details", details);
    }

    return url.toString();
  };

  const openCalendarUrl = (url) => {
    if (!url) return;

    const opened = window.open(url, "_blank");

    if (!opened) {
      window.location.href = url;
    }
  };

  const addToCalendar = async (inscriptionId) => {
    const items = getInscriptions();
    const inscription = items.find((item) => item.inscription_id === inscriptionId);

    if (!inscription) return;

    if (!isAcceptedInscription(inscription)) {
      setStatus("L’inscription doit être acceptée avant l’ajout calendrier.", "isError");
      return;
    }

    const payload = buildCalendarPayload(inscription);
    const calendarUrl = buildGoogleCalendarUrl(payload);

    try {
      if (hasApi() && typeof api().createCalendarEvent === "function") {
        const result = await api().createCalendarEvent(payload);

        const updated = {
          ...inscription,
          calendar_event_id: result.calendar_event_id || result.id || "",
          calendar_statut: "ajoute",
          calendar_payload: payload,
          updated_at: new Date().toISOString()
        };

        await saveInscriptionOnly(updated);

        setStatus("Évènement ajouté au calendrier.", "isSuccess");
        renderAll();
        return;
      }

      const updated = {
        ...inscription,
        calendar_statut: "a_synchroniser",
        calendar_payload: {
          ...payload,
          calendar_url: calendarUrl
        },
        updated_at: new Date().toISOString()
      };

      await saveInscriptionOnly(updated);

      setStatus("Lien calendrier ouvert. Le suivi est marqué à synchroniser.", "isSuccess");
      renderAll();

      openCalendarUrl(calendarUrl);
    } catch (error) {
      setStatus(`Erreur calendrier : ${error.message}`, "isError");

      if (calendarUrl) {
        openCalendarUrl(calendarUrl);
      }
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
          item.commentaire,
          item.paiement_statut_label,
          item.caution,
          item.vendeurs_prevus_noms,
          getVendorsLabel(item)
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
    if (item.statut === "EN_ATTENTE_REPONSE" && toBoolean(item.dossier_envoye)) return "isWaitingCard";
    return "";
  };

  const getPaymentFlagClass = (item) => {
    const value = getPaymentStatusValue(item);

    if (value === "ENCAISSE") return "flagOk";
    if (value === "A_ENVOYER") return "flagWarning";

    return "";
  };

  const renderStats = () => {
    const items = getInscriptions().filter((item) => item.statut !== "ANNULE");

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

  const renderEventAction = (item, missionId) => {
    if (missionId) {
      return `
        <a
          class="trackingSmallBtn primary"
          href="${escapeAttr(getMissionStockHref(missionId))}"
        >
          Mission stock
        </a>
      `;
    }

    const canCreateEvent = isAcceptedInscription(item);

    return `
      <button
        class="trackingSmallBtn primary"
        type="button"
        data-create-event="${escapeAttr(item.inscription_id)}"
        ${canCreateEvent ? "" : "disabled"}
      >
        Créer l’évènement
      </button>
    `;
  };

  const renderList = () => {
    const items = getFilteredInscriptions();

    if (state.isLoading) {
      els.inscriptionsList.innerHTML =
        `<p class="trackingEmpty">Chargement des inscriptions...</p>`;
      return;
    }

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
        const vendorsLabel = getVendorsLabel(item);
        const missionId = getMissionIdFromInscription(item);
        const paymentLabel = getPaymentStatusLabel(item);
        const paymentFlagClass = getPaymentFlagClass(item);
        const paymentDetail = getLegacyPaymentDetail(item);

        const material = [
          toBoolean(item.table_fournie) ? "Table" : "",
          toBoolean(item.barnum_fourni) ? "Barnum" : "",
          toBoolean(item.chaises_fournies) ? "Chaises" : "",
          toBoolean(item.eclairage_fourni) ? "Éclairage" : "",
          toBoolean(item.electricite_fournie) ? "Électricité" : ""
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
              ${vendorsLabel ? `<span>👥 ${escapeHtml(vendorsLabel)}</span>` : ""}
              ${paymentLabel ? `<span>💳 ${escapeHtml(paymentLabel)}</span>` : ""}
              ${paymentDetail ? `<span>🧾 ${escapeHtml(paymentDetail)}</span>` : ""}
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
              ${toBoolean(item.dossier_envoye) ? `<span class="flagOk">Dossier envoyé</span>` : `<span>Dossier non envoyé</span>`}
              ${toBoolean(item.acceptation) ? `<span class="flagOk">Accepté</span>` : ""}
              ${vendorsLabel ? `<span>Équipe : ${escapeHtml(vendorsLabel)}</span>` : ""}
              ${paymentLabel ? `<span class="${escapeAttr(paymentFlagClass)}">Paiement : ${escapeHtml(paymentLabel)}</span>` : ""}
              ${missionId ? `<span class="flagOk">Évènement créé</span>` : ""}
              ${item.calendar_statut === "ajoute" ? `<span class="flagOk">Calendrier OK</span>` : ""}
              ${item.calendar_statut === "a_synchroniser" ? `<span class="flagWarning">Calendrier à synchroniser</span>` : ""}
              ${state.usingCache ? `<span class="flagWarning">Cache local</span>` : ""}
            </div>

            <div class="inscriptionActions">
              <button
                class="trackingSmallBtn"
                type="button"
                data-edit-inscription="${escapeAttr(item.inscription_id)}"
              >
                Modifier
              </button>

              ${renderEventAction(item, missionId)}

              <button
                class="trackingSmallBtn"
                type="button"
                data-calendar-inscription="${escapeAttr(item.inscription_id)}"
                ${isAcceptedInscription(item) ? "" : "disabled"}
              >
                Calendrier
              </button>

              <button
                class="trackingSmallBtn danger"
                type="button"
                data-delete-inscription="${escapeAttr(item.inscription_id)}"
              >
                Annuler
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

  const loadData = async () => {
    state.isLoading = true;
    renderAll();
    setStatus("Chargement...");

    const cachedInscriptions = readJson(STORAGE_KEYS.inscriptions, []);
    const cachedMissions = readJson(STORAGE_KEYS.missions, []);
    const cachedJournees = readJson(STORAGE_KEYS.journees, []);

    try {
      if (!hasApi()) {
        throw new Error("lugdurum-api.js n’est pas chargé.");
      }

      const [
        inscriptions,
        missions,
        journees
      ] = await Promise.all([
        api().getInscriptionsEvenements(),
        api().getMissions(),
        api().getJournees()
      ]);

      const shouldKeepOptimisticCache = getPendingWritesCount() > 0;

      state.inscriptions = shouldKeepOptimisticCache
        ? mergeByKey(
            Array.isArray(inscriptions) ? inscriptions : [],
            cachedInscriptions,
            "inscription_id"
          )
        : Array.isArray(inscriptions)
          ? inscriptions
          : [];

      state.missions = shouldKeepOptimisticCache
        ? mergeByKey(
            Array.isArray(missions) ? missions : [],
            cachedMissions,
            "mission_id"
          )
        : Array.isArray(missions)
          ? missions
          : [];

      state.journees = shouldKeepOptimisticCache
        ? mergeByKey(
            Array.isArray(journees) ? journees : [],
            cachedJournees,
            "journee_id"
          )
        : Array.isArray(journees)
          ? journees
          : [];

      state.usingCache = false;

      cacheAll();

      setStatus("");
    } catch (error) {
      loadFromCache();

      setStatus(
        `Lecture Sheets impossible. Données locales affichées : ${error.message}`,
        "isError"
      );
    } finally {
      state.isLoading = false;
      renderAll();
    }
  };

  document.addEventListener("click", async (event) => {
    const vendorButton = event.target.closest("[data-vendor-id]");
    if (vendorButton) {
      toggleVendor(vendorButton.dataset.vendorId);
      return;
    }

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
      await createEventFromInscription(createEventButton.dataset.createEvent);
      return;
    }

    const calendarButton = event.target.closest("[data-calendar-inscription]");
    if (calendarButton) {
      await addToCalendar(calendarButton.dataset.calendarInscription);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-inscription]");
    if (deleteButton) {
      await deleteInscription(deleteButton.dataset.deleteInscription);
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

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (state.isSaving) return;

    const wasEditing = Boolean(els.inscriptionIdInput.value.trim());
    const inscription = buildInscriptionFromForm();

    if (!inscription) return;

    const isAccepted = isAcceptedInscription(inscription);
    const alreadyHasEvent = Boolean(getMissionIdFromInscription(inscription));

    setSaving(true);
    setStatus(wasEditing ? "Enregistrement des modifications..." : "Enregistrement...");

    try {
      if (!wasEditing) {
        await saveInscriptionOnly(inscription);
        renderAll();

        if (isAccepted && !alreadyHasEvent) {
          setStatus("Inscription acceptée. Création automatique de l’évènement...", "isSuccess");
          await createEventFromInscription(inscription.inscription_id);
          return;
        }

        resetForm({ keepStatus: true });
        setStatus("Inscription enregistrée.", "isSuccess");
        return;
      }

      const syncResult = await syncLinkedEventFromInscription(inscription);
      renderAll();

      if (isAccepted && !alreadyHasEvent) {
        setStatus("Inscription acceptée. Création automatique de l’évènement...", "isSuccess");
        await createEventFromInscription(inscription.inscription_id);
        return;
      }

      resetForm({ keepStatus: true });

      const message = syncResult.message || "Modifications enregistrées.";
      const type = syncResult.status === "warning" ? "isError" : "isSuccess";
      setStatus(message, type);
    } catch (error) {
      setStatus(`Erreur enregistrement : ${error.message}`, "isError");
    } finally {
      setSaving(false);
    }
  });

  els.resetFormBtn.addEventListener("click", () => {
    resetForm();
  });

  setDefaultDate();

  if (els.paymentStatusInput) {
    els.paymentStatusInput.value = "A_ENVOYER";
  }

  setSelectedVendorIds([CURRENT_USER.user_id]);

  loadFromCache();
  renderAll();
  loadData();
})();