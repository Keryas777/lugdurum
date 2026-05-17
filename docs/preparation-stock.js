(() => {
  "use strict";

  /*
    Préparation stock V4 :
    - Lit la mission de stock active depuis lugdurum_preparation_context.
    - Charge missions_stock, journees_vente, missions_vente, catalogue et mouvements_stock depuis Google Sheets.
    - Fallback localStorage si lecture Sheets impossible.
    - Permet de saisir le stock emmené par SKU, format 50 cL et 20 cL.
    - Affiche les parfums en grandes tuiles visuelles, avec sélecteurs glass par-dessus.
    - Enregistre le détail produit par produit dans mouvements_stock :
      type_mouvement = PREPARATION
      sens = ENTREE
    - Met à jour les totaux dans missions_stock :
      stock_prepare
      total_bouteilles_preparees
      total_50cl_prepare
      total_20cl_prepare
      parfums_prepare_count
    - Met à jour journees_vente via l’API.
    - La file d’attente offline est gérée par lugdurum-api.js.
    - Le cache localStorage reste utilisé pour garder l’interface exploitable.
  */

  const SHEETS = {
    mouvementsStock: "mouvements_stock"
  };

  const STORAGE_KEYS = {
    events: "lugdurum_evenements",
    stockMissions: "lugdurum_missions_stock",
    journees: "lugdurum_journees",
    preparationContext: "lugdurum_preparation_context",
    activeMissionId: "lugdurum_active_mission_id",
    activeStockMissionId: "lugdurum_active_stock_mission_id",
    activeJourneeId: "lugdurum_active_journee_id",
    mouvementsStock: "lugdurum_mouvements_stock",
    catalogueCache: "lugdurum_catalogue_cache"
  };

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme"
  };

  const MOVEMENT_TYPE = {
    PREPARATION: "PREPARATION"
  };

  const MOVEMENT_SENS = {
    ENTREE: "ENTREE"
  };

  const state = {
    context: null,
    stockMission: null,
    missionJournees: [],
    events: [],
    stockMissions: [],
    journees: [],
    catalogue: [],
    mouvementsStock: [],
    quantities: new Map(),
    dataLoaded: false,
    isSaving: false
  };

  const els = {
    stockMissionMeta: document.getElementById("stockMissionMeta"),
    stockTotalCount: document.getElementById("stockTotalCount"),
    stockTotal50: document.getElementById("stockTotal50"),
    stockTotal20: document.getElementById("stockTotal20"),
    stockFlavourCount: document.getElementById("stockFlavourCount"),
    stockDayChips: document.getElementById("stockDayChips"),
    stockRows: document.getElementById("stockRows"),
    stockNoteInput: document.getElementById("stockNoteInput"),
    clearStockBtn: document.getElementById("clearStockBtn"),
    saveDraftBtn: document.getElementById("saveDraftBtn"),
    validateStockBtn: document.getElementById("validateStockBtn"),
    startDayBtn: document.getElementById("startDayBtn"),
    stockStatus: document.getElementById("stockStatus")
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

  const normalizeProduct = (rawProduct, index) => {
    const parfumCode = String(rawProduct.parfum_code || "")
      .trim()
      .toUpperCase();

    const formatCl = toNumber(rawProduct.format_cl, 0);

    return {
      sku_id: String(rawProduct.sku_id || `${parfumCode}_${formatCl}`).trim(),
      parfum_code: parfumCode,
      parfum_nom: String(rawProduct.parfum_nom || parfumCode).trim(),
      format_cl: formatCl,
      gamme_tarif: String(rawProduct.gamme_tarif || "").trim(),
      vendable_seul: toBoolean(rawProduct.vendable_seul, false),
      composable_coffret: toBoolean(rawProduct.composable_coffret, false),
      cout_revient: toNumber(rawProduct.cout_revient, 0),
      actif: toBoolean(rawProduct.actif, false),
      visible_webapp: Object.prototype.hasOwnProperty.call(rawProduct, "visible_webapp")
        ? toBoolean(rawProduct.visible_webapp, true)
        : true,
      ordre_affichage: toNumber(rawProduct.ordre_affichage, 1000 + index),
      note: String(rawProduct.note || "").trim(),
      image_src: String(rawProduct.image_src || "").trim()
    };
  };

  const getProductImageSrc = (product) =>
    String(product?.image_src || "").trim() ||
    `./assets/parfums/${String(product?.parfum_code || "").toLowerCase()}.webp`;

  const setStatus = (message, type = "") => {
    els.stockStatus.textContent = message;
    els.stockStatus.className = "stockStatus";

    if (type) {
      els.stockStatus.classList.add(type);
    }
  };

  const setSaving = (isSaving) => {
    state.isSaving = isSaving;

    [
      els.clearStockBtn,
      els.saveDraftBtn,
      els.validateStockBtn,
      els.startDayBtn
    ].forEach((button) => {
      if (button) button.disabled = isSaving;
    });
  };

  const getEventId = (eventItem) =>
    String(eventItem?.mission_id || eventItem?.evenement_id || "").trim();

  const getDayEventId = (journee) =>
    String(journee?.mission_id || journee?.evenement_id || "").trim();

  const getStockMissionId = () =>
    String(
      state.context?.stock_mission_id ||
      state.context?.mission_id ||
      localStorage.getItem(STORAGE_KEYS.activeStockMissionId) ||
      localStorage.getItem(STORAGE_KEYS.activeMissionId) ||
      ""
    ).trim();

  const getActiveJourneeId = () =>
    String(
      state.context?.journee_id ||
      localStorage.getItem(STORAGE_KEYS.activeJourneeId) ||
      ""
    ).trim();

  const cacheCoreData = () => {
    writeJson(STORAGE_KEYS.events, state.events);
    writeJson(STORAGE_KEYS.stockMissions, state.stockMissions);
    writeJson(STORAGE_KEYS.journees, state.journees);
    writeJson(STORAGE_KEYS.catalogueCache, state.catalogue);
  };

  const cacheMouvementsStock = () => {
    writeJson(STORAGE_KEYS.mouvementsStock, state.mouvementsStock);
  };

  const loadLocalCaches = () => {
    state.events = readJson(STORAGE_KEYS.events, []);
    state.stockMissions = readJson(STORAGE_KEYS.stockMissions, []);
    state.journees = readJson(STORAGE_KEYS.journees, []);
    state.catalogue = readJson(STORAGE_KEYS.catalogueCache, []);
    state.mouvementsStock = readJson(STORAGE_KEYS.mouvementsStock, []);

    state.catalogue = state.catalogue
      .map((row, index) => normalizeProduct(row, index))
      .filter((product) => product.sku_id && product.parfum_code && product.format_cl);

    state.dataLoaded = state.catalogue.length > 0;
  };

  const getEventById = (eventId) =>
    state.events.find((eventItem) => getEventId(eventItem) === String(eventId || ""));

  const getQuantity = (skuId) =>
    toNumber(state.quantities.get(skuId), 0);

  const setQuantity = (skuId, quantity) => {
    const safeQuantity = Math.max(0, Math.floor(toNumber(quantity, 0)));

    if (safeQuantity > 0) {
      state.quantities.set(skuId, safeQuantity);
    } else {
      state.quantities.delete(skuId);
    }
  };

  const refreshMissionContextFromState = () => {
    const missionId = getStockMissionId();

    if (!missionId) {
      state.stockMission = null;
      state.missionJournees = [];
      return false;
    }

    state.stockMission =
      state.stockMissions.find((mission) => String(mission.mission_id || "") === missionId) ||
      null;

    state.missionJournees = state.journees
      .filter((journee) => {
        const stockMissionId = String(journee.stock_mission_id || "").trim();
        const legacyMissionId = String(journee.mission_id || "").trim();

        return stockMissionId === missionId || legacyMissionId === missionId;
      })
      .filter((journee) => String(journee.statut || "").toLowerCase() !== "annule")
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return Boolean(state.stockMission);
  };

  const loadContext = () => {
    const context = readJson(STORAGE_KEYS.preparationContext, null);

    state.context = context;

    const hasContext = Boolean(
      context?.stock_mission_id ||
      context?.mission_id ||
      localStorage.getItem(STORAGE_KEYS.activeStockMissionId) ||
      localStorage.getItem(STORAGE_KEYS.activeMissionId)
    );

    if (!hasContext) {
      state.stockMission = null;
      state.missionJournees = [];

      setStatus(
        "Aucune mission de stock active. Retourne dans Évènements puis clique sur préparer le stock.",
        "isError"
      );

      return false;
    }

    const ok = refreshMissionContextFromState();

    if (!ok) {
      setStatus("Mission de stock introuvable dans les données locales.", "isError");
      return false;
    }

    return true;
  };

  const getTotals = () => {
    let total = 0;
    let total50 = 0;
    let total20 = 0;
    const flavourCodes = new Set();

    state.catalogue.forEach((product) => {
      const qty = getQuantity(product.sku_id);

      if (qty <= 0) return;

      total += qty;
      flavourCodes.add(product.parfum_code);

      if (product.format_cl === 50) total50 += qty;
      if (product.format_cl === 20) total20 += qty;
    });

    return {
      total,
      total50,
      total20,
      flavourCount: flavourCodes.size
    };
  };

  const getGroupedCatalogue = () => {
    const products = state.catalogue
      .filter((product) => product.actif)
      .filter((product) => product.visible_webapp !== false)
      .filter((product) => product.format_cl === 50 || product.format_cl === 20)
      .filter((product) => product.vendable_seul || product.composable_coffret)
      .sort((a, b) => {
        const byOrder = a.ordre_affichage - b.ordre_affichage;
        if (byOrder !== 0) return byOrder;

        const byCode = a.parfum_code.localeCompare(b.parfum_code);
        if (byCode !== 0) return byCode;

        return b.format_cl - a.format_cl;
      });

    const groups = new Map();

    products.forEach((product) => {
      if (!groups.has(product.parfum_code)) {
        groups.set(product.parfum_code, {
          parfum_code: product.parfum_code,
          parfum_nom: product.parfum_nom,
          ordre_affichage: product.ordre_affichage,
          products: []
        });
      }

      groups.get(product.parfum_code).products.push(product);
    });

    return [...groups.values()].sort((a, b) => {
      const byOrder = a.ordre_affichage - b.ordre_affichage;
      if (byOrder !== 0) return byOrder;

      return a.parfum_code.localeCompare(b.parfum_code);
    });
  };

  const getPreparationJourneeId = () => {
    const activeJourneeId = getActiveJourneeId();

    if (
      activeJourneeId &&
      state.missionJournees.some((journee) => journee.journee_id === activeJourneeId)
    ) {
      return activeJourneeId;
    }

    return state.missionJournees[0]?.journee_id || "";
  };

  const buildPreparationMovementId = (skuId) => {
    const missionId = getStockMissionId();
    return `MVT_${missionId}_${skuId}_PREPARATION`;
  };

  const getExistingPreparationMovements = () => {
    const missionId = getStockMissionId();

    if (!missionId) return [];

    return state.mouvementsStock.filter((movement) => {
      return (
        String(movement.stock_mission_id || movement.mission_id || "") === missionId &&
        String(movement.type_mouvement || "") === MOVEMENT_TYPE.PREPARATION &&
        String(movement.statut || "").toLowerCase() !== "annule"
      );
    });
  };

  const hydrateExistingPreparation = () => {
    const existingMovements = getExistingPreparationMovements();

    existingMovements.forEach((movement) => {
      setQuantity(movement.sku_id, movement.quantite);
    });

    const firstNote = existingMovements.find((movement) => movement.note)?.note || "";

    if (firstNote && !els.stockNoteInput.value.trim()) {
      els.stockNoteInput.value = firstNote;
    }
  };

  const buildBatchOperation = ({ sheet, sheetKey, keyField, row }) => ({
    action: "upsert",
    type: "upsert",

    sheetKey,
    sheet_key: sheetKey,

    sheet,
    sheet_name: sheet,
    sheetName: sheet,

    key: keyField,
    key_field: keyField,
    keyField,

    row,
    data: row
  });

  const upsertLocalStockMission = (mission) => {
    const index = state.stockMissions.findIndex(
      (item) => item.mission_id === mission.mission_id
    );

    if (index >= 0) {
      state.stockMissions[index] = mission;
    } else {
      state.stockMissions.push(mission);
    }

    state.stockMission = mission;
    cacheCoreData();
  };

  const upsertLocalJournees = (journees) => {
    journees.forEach((journee) => {
      const index = state.journees.findIndex(
        (item) => item.journee_id === journee.journee_id
      );

      if (index >= 0) {
        state.journees[index] = journee;
      } else {
        state.journees.push(journee);
      }
    });

    refreshMissionContextFromState();
    cacheCoreData();
  };

  const upsertLocalMouvementsStock = (movements) => {
    movements.forEach((movement) => {
      const index = state.mouvementsStock.findIndex(
        (item) => item.mouvement_stock_id === movement.mouvement_stock_id
      );

      if (index >= 0) {
        state.mouvementsStock[index] = movement;
      } else {
        state.mouvementsStock.push(movement);
      }
    });

    cacheMouvementsStock();
  };

  const getPendingWritesCount = () => {
    if (hasApi() && typeof api().getPendingWritesCount === "function") {
      return api().getPendingWritesCount();
    }

    return 0;
  };

  const buildPreparationMovements = (status = "brouillon") => {
    if (!state.stockMission) {
      setStatus("Aucune mission de stock active.", "isError");
      return null;
    }

    const totals = getTotals();

    if (status !== "brouillon" && totals.total <= 0) {
      setStatus("Indique au moins une bouteille emmenée avant de valider.", "isError");
      return null;
    }

    const now = new Date().toISOString();
    const missionId = state.stockMission.mission_id;
    const journeeId = getPreparationJourneeId();
    const note = els.stockNoteInput.value.trim();

    const existingMovements = getExistingPreparationMovements();
    const nextMovementIds = new Set();

    const activeMovements = state.catalogue
      .map((product) => {
        const quantity = getQuantity(product.sku_id);

        if (quantity <= 0) return null;

        const movementId = buildPreparationMovementId(product.sku_id);
        const existing = existingMovements.find(
          (movement) => movement.mouvement_stock_id === movementId
        );

        nextMovementIds.add(movementId);

        return {
          mouvement_stock_id: movementId,
          date_heure: existing?.date_heure || now,
          mission_id: missionId,
          stock_mission_id: missionId,
          journee_id: journeeId,
          type_mouvement: MOVEMENT_TYPE.PREPARATION,
          sens: MOVEMENT_SENS.ENTREE,
          sku_id: product.sku_id,
          parfum_code: product.parfum_code,
          parfum_nom: product.parfum_nom,
          format_cl: product.format_cl,
          quantite: quantity,
          source: "PREPARATION_STOCK",
          statut: status,
          note,
          user_id: CURRENT_USER.user_id,
          created_at: existing?.created_at || now,
          updated_at: now
        };
      })
      .filter(Boolean);

    const cancelledMovements = existingMovements
      .filter((movement) => !nextMovementIds.has(movement.mouvement_stock_id))
      .map((movement) => ({
        ...movement,
        quantite: 0,
        statut: "annule",
        note: note || movement.note || "",
        updated_at: now
      }));

    return {
      movements: [...activeMovements, ...cancelledMovements],
      activeMovements,
      totals
    };
  };

  const buildStockMissionPatch = ({ status = "brouillon", totals }) => {
    const now = new Date().toISOString();
    const shouldMarkPrepared = status === "valide";

    let nextStatus = state.stockMission.statut || "stock_a_preparer";

    if (shouldMarkPrepared && nextStatus !== "en_cours") {
      nextStatus = "pret";
    }

    if (!shouldMarkPrepared && (!nextStatus || nextStatus === "brouillon")) {
      nextStatus = "stock_a_preparer";
    }

    return {
      ...state.stockMission,
      statut: nextStatus,
      stock_prepare: shouldMarkPrepared || state.stockMission.stock_prepare === true,
      total_bouteilles_preparees: totals.total,
      total_50cl_prepare: totals.total50,
      total_20cl_prepare: totals.total20,
      parfums_prepare_count: totals.flavourCount,
      updated_at: now
    };
  };

  const buildJourneesReadyPatch = (status = "brouillon") => {
    if (status !== "valide") return [];

    const now = new Date().toISOString();
    const missionId = state.stockMission.mission_id;

    return state.missionJournees.map((journee) => {
      const nextStatus =
        journee.statut === "en_cours" || journee.statut === "cloture"
          ? journee.statut
          : "pret";

      return {
        ...journee,
        stock_mission_id: missionId,
        statut: nextStatus,
        updated_at: now
      };
    });
  };

  const saveMouvementsStockToApi = async (movements) => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    if (typeof api().batchUpsert !== "function") {
      throw new Error("LugdurumAPI.batchUpsert() est indisponible.");
    }

    const operations = movements.map((movement) =>
      buildBatchOperation({
        sheet: SHEETS.mouvementsStock,
        sheetKey: "mouvementsStock",
        keyField: "mouvement_stock_id",
        row: movement
      })
    );

    await api().batchUpsert(operations);
  };

  const saveStockMissionToApi = async (mission) => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    if (typeof api().saveMissionStock !== "function") {
      throw new Error("LugdurumAPI.saveMissionStock() est indisponible.");
    }

    await api().saveMissionStock(mission);
  };

  const saveJourneesToApi = async (journees) => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    if (typeof api().saveJournee !== "function") {
      throw new Error("LugdurumAPI.saveJournee() est indisponible.");
    }

    for (const journee of journees) {
      await api().saveJournee(journee);
    }
  };

  const savePreparation = async (status = "brouillon") => {
    if (state.isSaving) return null;

    const payload = buildPreparationMovements(status);

    if (!payload) return null;

    const missionPatch = buildStockMissionPatch({
      status,
      totals: payload.totals
    });

    const journeesPatch = buildJourneesReadyPatch(status);

    upsertLocalMouvementsStock(payload.movements);
    upsertLocalStockMission(missionPatch);

    if (journeesPatch.length > 0) {
      upsertLocalJournees(journeesPatch);
    }

    setSaving(true);
    setStatus(status === "valide" ? "Validation du stock..." : "Enregistrement du brouillon...");

    try {
      await saveMouvementsStockToApi(payload.movements);
      await saveStockMissionToApi(missionPatch);

      if (journeesPatch.length > 0) {
        await saveJourneesToApi(journeesPatch);
      }

      const pendingCount = getPendingWritesCount();

      setStatus(
        pendingCount > 0
          ? `${status === "valide" ? "Stock validé" : "Brouillon enregistré"} · ${pendingCount} écriture(s) en attente de synchronisation.`
          : status === "valide"
            ? "Stock validé."
            : "Brouillon enregistré.",
        pendingCount > 0 ? "isError" : "isSuccess"
      );

      renderAll();

      return {
        movements: payload.activeMovements,
        mission: missionPatch,
        journees: journeesPatch
      };
    } catch (error) {
      setStatus(`Erreur enregistrement : ${error.message}`, "isError");
      renderAll();
      return null;
    } finally {
      setSaving(false);
    }
  };

  const markDayStartedLocal = (journeeId) => {
    const now = new Date().toISOString();
    const missionId = state.stockMission.mission_id;

    const updatedMission = {
      ...state.stockMission,
      statut: "en_cours",
      stock_prepare: true,
      updated_at: now
    };

    const updatedJournees = state.missionJournees.map((journee) => {
      if (journee.journee_id !== journeeId) return journee;

      return {
        ...journee,
        stock_mission_id: missionId,
        statut: "en_cours",
        started_at: journee.started_at || now,
        updated_at: now
      };
    });

    upsertLocalStockMission(updatedMission);
    upsertLocalJournees(updatedJournees);

    return {
      mission: updatedMission,
      journees: updatedJournees
    };
  };

  const startDay = async () => {
    const preparation = await savePreparation("valide");

    if (!preparation) return;

    const missionId = state.stockMission.mission_id;
    const preferredDayId = getActiveJourneeId();

    const firstOpenDay =
      state.missionJournees.find((journee) => journee.journee_id === preferredDayId) ||
      state.missionJournees.find((journee) => journee.statut !== "cloture" && journee.statut !== "annule") ||
      state.missionJournees[0];

    if (!firstOpenDay) {
      setStatus("Impossible de trouver une journée à démarrer.", "isError");
      return;
    }

    const startedPatch = markDayStartedLocal(firstOpenDay.journee_id);

    setSaving(true);
    setStatus("Démarrage de la journée...");

    try {
      await saveStockMissionToApi(startedPatch.mission);
      await saveJourneesToApi(startedPatch.journees);

      localStorage.setItem(STORAGE_KEYS.activeMissionId, missionId);
      localStorage.setItem(STORAGE_KEYS.activeStockMissionId, missionId);
      localStorage.setItem(STORAGE_KEYS.activeJourneeId, firstOpenDay.journee_id);

      writeJson(STORAGE_KEYS.preparationContext, {
        mission_id: missionId,
        stock_mission_id: missionId,
        journee_id: firstOpenDay.journee_id,
        step: "vente_rapide",
        updated_at: new Date().toISOString()
      });

      window.location.href = "./vente-rapide.html";
    } catch (error) {
      setStatus(`Stock validé, mais démarrage incomplet : ${error.message}`, "isError");
    } finally {
      setSaving(false);
    }
  };

  const renderMissionContext = () => {
    if (!state.stockMission) {
      els.stockMissionMeta.textContent =
        "Aucune mission active. Retourne dans Évènements pour préparer un stock.";
      return;
    }

    const dateLabel =
      state.stockMission.date_debut === state.stockMission.date_fin
        ? formatDisplayDate(state.stockMission.date_debut)
        : `${formatDisplayDate(state.stockMission.date_debut)} → ${formatDisplayDate(state.stockMission.date_fin)}`;

    els.stockMissionMeta.textContent =
      `${state.stockMission.nom} · ${dateLabel}`;
  };

  const renderDays = () => {
    if (!state.missionJournees.length) {
      els.stockDayChips.innerHTML =
        `<p class="stockEmpty">Aucune journée liée à cette mission de stock.</p>`;
      return;
    }

    els.stockDayChips.innerHTML = state.missionJournees
      .map((journee) => {
        const eventItem = getEventById(getDayEventId(journee));
        const eventName = eventItem ? eventItem.nom : "Évènement inconnu";
        const city = eventItem?.ville ? ` · ${eventItem.ville}` : "";

        return `
          <article class="stockDayCard">
            <strong>${escapeHtml(formatDisplayDate(journee.date))}</strong>
            <span>
              ${escapeHtml(eventName)}
              ${eventItem && eventItem.date_debut !== eventItem.date_fin ? ` ${escapeHtml(journee.jour_label || "")}` : ""}
              ${escapeHtml(city)}
            </span>
          </article>
        `;
      })
      .join("");
  };

  const renderFormatControl = (product, label) => {
    if (!product) {
      return `
        <div class="stockGlassFormat isUnavailable">
          <div class="stockGlassFormatHead">
            <span>${escapeHtml(label)}</span>
          </div>

          <div class="stockGlassUnavailable">—</div>
        </div>
      `;
    }

    const qty = getQuantity(product.sku_id);

    return `
      <div class="stockGlassFormat">
        <div class="stockGlassFormatHead">
          <span>${escapeHtml(label)}</span>
        </div>

        <div class="stockGlassQtyControl">
          <button
            type="button"
            data-stock-delta="-1"
            data-sku="${escapeAttr(product.sku_id)}"
            aria-label="Retirer une bouteille ${escapeAttr(label)} ${escapeAttr(product.parfum_code)}"
          >
            −
          </button>

          <input
            type="number"
            inputmode="numeric"
            min="0"
            step="1"
            value="${qty}"
            data-stock-input="${escapeAttr(product.sku_id)}"
            aria-label="Quantité ${escapeAttr(label)} ${escapeAttr(product.parfum_code)}"
          />

          <button
            type="button"
            data-stock-delta="1"
            data-sku="${escapeAttr(product.sku_id)}"
            aria-label="Ajouter une bouteille ${escapeAttr(label)} ${escapeAttr(product.parfum_code)}"
          >
            +
          </button>
        </div>
      </div>
    `;
  };

  const renderStockRows = () => {
    if (!state.dataLoaded && state.catalogue.length === 0) {
      els.stockRows.innerHTML = `<p class="stockEmpty">Chargement du catalogue…</p>`;
      return;
    }

    const groups = getGroupedCatalogue();

    if (groups.length === 0) {
      els.stockRows.innerHTML =
        `<p class="stockEmpty">Aucun produit actif trouvé dans le catalogue.</p>`;
      return;
    }

    els.stockRows.innerHTML = groups
      .map((group) => {
        const product50 = group.products.find((product) => product.format_cl === 50);
        const product20 = group.products.find((product) => product.format_cl === 20);
        const imageProduct = product50 || product20;
        const imageSrc = getProductImageSrc(imageProduct);

        return `
          <article
            class="stockVisualCard"
            style="--stock-bg: url('${escapeAttr(imageSrc)}')"
          >
            <div class="stockVisualBg" aria-hidden="true"></div>
            <div class="stockVisualShade" aria-hidden="true"></div>

            <div class="stockVisualContent">
              <div class="stockVisualTitle">
                <strong>${escapeHtml(group.parfum_code)}</strong>
                <span>${escapeHtml(group.parfum_nom)}</span>
              </div>

              <div class="stockGlassPanel">
                ${renderFormatControl(product50, "50 cL")}
                ${renderFormatControl(product20, "20 cL")}
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const renderTotals = () => {
    const totals = getTotals();

    els.stockTotalCount.textContent = totals.total;
    els.stockTotal50.textContent = totals.total50;
    els.stockTotal20.textContent = totals.total20;
    els.stockFlavourCount.textContent = totals.flavourCount;
  };

  const renderAll = () => {
    renderMissionContext();
    renderDays();
    renderStockRows();
    renderTotals();
  };

  const loadRemoteData = async () => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    const optional = async (fnName, fallback = []) => {
      if (typeof api()[fnName] !== "function") return fallback;

      try {
        const result = await api()[fnName]();
        return Array.isArray(result) ? result : fallback;
      } catch {
        return fallback;
      }
    };

    const [
      events,
      stockMissions,
      journees,
      catalogue,
      mouvementsStock
    ] = await Promise.all([
      api().getMissions(),
      api().getMissionsStock(),
      api().getJournees(),
      api().getCatalogue(),
      optional("getMouvementsStock", state.mouvementsStock)
    ]);

    state.events = Array.isArray(events) ? events : [];
    state.stockMissions = Array.isArray(stockMissions) ? stockMissions : [];
    state.journees = Array.isArray(journees) ? journees : [];
    state.mouvementsStock = mouvementsStock;

    state.catalogue = catalogue
      .map((row, index) => normalizeProduct(row, index))
      .filter((product) => product.sku_id && product.parfum_code && product.format_cl);

    state.dataLoaded = true;

    cacheCoreData();
    cacheMouvementsStock();

    refreshMissionContextFromState();
  };

  document.addEventListener("click", (event) => {
    const deltaButton = event.target.closest("[data-stock-delta]");
    if (deltaButton) {
      const skuId = deltaButton.dataset.sku;
      const delta = toNumber(deltaButton.dataset.stockDelta, 0);
      const current = getQuantity(skuId);

      setQuantity(skuId, current + delta);
      setStatus("");
      renderAll();
    }
  });

  document.addEventListener("input", (event) => {
    const input = event.target.closest("[data-stock-input]");
    if (!input) return;

    setQuantity(input.dataset.stockInput, input.value);
    setStatus("");
    renderTotals();
  });

  els.clearStockBtn.addEventListener("click", () => {
    state.quantities = new Map();
    setStatus("");
    renderAll();
  });

  els.saveDraftBtn.addEventListener("click", () => {
    savePreparation("brouillon");
  });

  els.validateStockBtn.addEventListener("click", () => {
    savePreparation("valide");
  });

  els.startDayBtn.addEventListener("click", startDay);

  window.addEventListener("lugdurum:sync-status", (event) => {
    const detail = event.detail || {};

    if (Number(detail.pending_count || 0) > 0) {
      setStatus(`${detail.pending_count} écriture(s) en attente de synchronisation.`, "isError");
    }
  });

  const init = async () => {
    loadLocalCaches();
    loadContext();
    hydrateExistingPreparation();
    renderAll();

    try {
      setStatus("Chargement depuis Google Sheets...");
      await loadRemoteData();

      const hasContext = loadContext();
      hydrateExistingPreparation();
      renderAll();

      if (hasContext) {
        setStatus("");
      }
    } catch (error) {
      setStatus(
        `Lecture Sheets impossible. Données locales affichées : ${error.message}`,
        "isError"
      );
      renderAll();
    }
  };

  init();
})();