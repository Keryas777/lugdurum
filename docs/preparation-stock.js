(() => {
  "use strict";

  /*
    Préparation stock V1 :
    - Lit la mission de stock active depuis lugdurum_preparation_context.
    - Charge le catalogue depuis Google Sheets via lugdurum-api.js.
    - Fallback sur le cache catalogue local.
    - Permet de saisir le stock emmené par SKU, format 50 cL et 20 cL.
    - Enregistre provisoirement en localStorage avant écriture Google Sheets.
    - Met à jour la mission de stock et ses journées en local.
  */

  const STORAGE_KEYS = {
    events: "lugdurum_evenements",
    stockMissions: "lugdurum_missions_stock",
    journees: "lugdurum_journees",
    preparationContext: "lugdurum_preparation_context",
    activeMissionId: "lugdurum_active_mission_id",
    activeStockMissionId: "lugdurum_active_stock_mission_id",
    activeJourneeId: "lugdurum_active_journee_id",
    stockPreparations: "lugdurum_stock_preparations",
    catalogueCache: "lugdurum_catalogue_cache"
  };

  const state = {
    context: null,
    stockMission: null,
    journees: [],
    events: [],
    catalogue: [],
    quantities: new Map(),
    dataLoaded: false
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

    const [year, month, day] = value.split("-").map(Number);

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

  const setStatus = (message, type = "") => {
    els.stockStatus.textContent = message;
    els.stockStatus.className = "stockStatus";

    if (type) {
      els.stockStatus.classList.add(type);
    }
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
      actif: toBoolean(rawProduct.actif, false),
      visible_webapp: Object.prototype.hasOwnProperty.call(rawProduct, "visible_webapp")
        ? toBoolean(rawProduct.visible_webapp, true)
        : true,
      ordre_affichage: toNumber(rawProduct.ordre_affichage, 1000 + index),
      note: String(rawProduct.note || "").trim()
    };
  };

  const getEvents = () => readJson(STORAGE_KEYS.events, []);

  const getStockMissions = () => readJson(STORAGE_KEYS.stockMissions, []);

  const setStockMissions = (missions) =>
    writeJson(STORAGE_KEYS.stockMissions, missions);

  const getJournees = () => readJson(STORAGE_KEYS.journees, []);

  const setJournees = (journees) => writeJson(STORAGE_KEYS.journees, journees);

  const getStockPreparations = () =>
    readJson(STORAGE_KEYS.stockPreparations, []);

  const setStockPreparations = (preparations) =>
    writeJson(STORAGE_KEYS.stockPreparations, preparations);

  const getEventById = (eventId) =>
    state.events.find((eventItem) => eventItem.evenement_id === eventId);

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

  const getPreparationId = () => {
    const missionId = state.context?.stock_mission_id || state.context?.mission_id || "";
    return missionId ? `STOCK_PREP_${missionId}` : "";
  };

  const getExistingPreparation = () => {
    const preparationId = getPreparationId();

    if (!preparationId) return null;

    return getStockPreparations().find(
      (item) => item.stock_preparation_id === preparationId
    );
  };

  const hydrateExistingPreparation = () => {
    const existing = getExistingPreparation();

    if (!existing) return;

    if (existing.note) {
      els.stockNoteInput.value = existing.note;
    }

    if (Array.isArray(existing.lignes)) {
      existing.lignes.forEach((line) => {
        setQuantity(line.sku_id, line.quantite_preparee);
      });
    }
  };

  const savePreparation = (status = "brouillon") => {
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
    const preparationId = getPreparationId();
    const existing = getExistingPreparation();

    const lignes = state.catalogue
      .map((product) => {
        const quantity = getQuantity(product.sku_id);

        if (quantity <= 0) return null;

        return {
          stock_preparation_ligne_id: `${preparationId}_${product.sku_id}`,
          stock_preparation_id: preparationId,
          mission_id: state.stockMission.mission_id,
          stock_mission_id: state.stockMission.mission_id,
          sku_id: product.sku_id,
          parfum_code: product.parfum_code,
          parfum_nom: product.parfum_nom,
          format_cl: product.format_cl,
          quantite_preparee: quantity,
          created_at: existing?.created_at || now,
          updated_at: now
        };
      })
      .filter(Boolean);

    const preparation = {
      stock_preparation_id: preparationId,
      mission_id: state.stockMission.mission_id,
      stock_mission_id: state.stockMission.mission_id,
      statut: status,
      total_bouteilles: totals.total,
      total_50cl: totals.total50,
      total_20cl: totals.total20,
      parfums_count: totals.flavourCount,
      note: els.stockNoteInput.value.trim(),
      created_at: existing?.created_at || now,
      updated_at: now,
      lignes
    };

    const preparations = getStockPreparations();
    const index = preparations.findIndex(
      (item) => item.stock_preparation_id === preparationId
    );

    if (index >= 0) {
      preparations[index] = preparation;
    } else {
      preparations.push(preparation);
    }

    setStockPreparations(preparations);

    if (status === "valide") {
      markStockMissionReady();
    }

    setStatus(
      status === "valide" ? "Stock validé." : "Brouillon enregistré.",
      "isSuccess"
    );

    renderAll();

    return preparation;
  };

  const markStockMissionReady = () => {
    const now = new Date().toISOString();
    const missionId = state.stockMission.mission_id;

    const missions = getStockMissions().map((mission) => {
      if (mission.mission_id !== missionId) return mission;

      return {
        ...mission,
        statut: mission.statut === "en_cours" ? "en_cours" : "pret",
        stock_prepare: true,
        updated_at: now
      };
    });

    const journees = getJournees().map((journee) => {
      if (journee.mission_id !== missionId && journee.stock_mission_id !== missionId) {
        return journee;
      }

      const nextStatus =
        journee.statut === "en_cours" || journee.statut === "cloture"
          ? journee.statut
          : "pret";

      return {
        ...journee,
        statut: nextStatus,
        updated_at: now
      };
    });

    setStockMissions(missions);
    setJournees(journees);

    state.stockMission = missions.find((mission) => mission.mission_id === missionId);
    state.journees = journees
      .filter((journee) => journee.mission_id === missionId || journee.stock_mission_id === missionId)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  };

  const startDay = () => {
    const preparation = savePreparation("valide");

    if (!preparation) return;

    const missionId = state.stockMission.mission_id;
    const preferredDayId = state.context?.journee_id || "";
    const firstOpenDay =
      state.journees.find((journee) => journee.journee_id === preferredDayId) ||
      state.journees.find((journee) => journee.statut !== "cloture" && journee.statut !== "annule") ||
      state.journees[0];

    if (!firstOpenDay) {
      setStatus("Impossible de trouver une journée à démarrer.", "isError");
      return;
    }

    const now = new Date().toISOString();

    const missions = getStockMissions().map((mission) => {
      if (mission.mission_id !== missionId) return mission;

      return {
        ...mission,
        statut: "en_cours",
        stock_prepare: true,
        updated_at: now
      };
    });

    const journees = getJournees().map((journee) => {
      if (journee.journee_id !== firstOpenDay.journee_id) return journee;

      return {
        ...journee,
        statut: "en_cours",
        updated_at: now
      };
    });

    setStockMissions(missions);
    setJournees(journees);

    localStorage.setItem(STORAGE_KEYS.activeMissionId, missionId);
    localStorage.setItem(STORAGE_KEYS.activeStockMissionId, missionId);
    localStorage.setItem(STORAGE_KEYS.activeJourneeId, firstOpenDay.journee_id);

    writeJson(STORAGE_KEYS.preparationContext, {
      mission_id: missionId,
      stock_mission_id: missionId,
      journee_id: firstOpenDay.journee_id,
      step: "vente_rapide",
      updated_at: now
    });

    window.location.href = "./vente-rapide.html";
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
    if (!state.journees.length) {
      els.stockDayChips.innerHTML =
        `<p class="stockEmpty">Aucune journée liée à cette mission de stock.</p>`;
      return;
    }

    els.stockDayChips.innerHTML = state.journees
      .map((journee) => {
        const eventItem = getEventById(journee.evenement_id);
        const eventName = eventItem ? eventItem.nom : "Évènement inconnu";
        const city = eventItem?.ville ? ` · ${eventItem.ville}` : "";

        return `
          <article class="stockDayCard">
            <strong>${escapeHtml(formatDisplayDate(journee.date))}</strong>
            <span>
              ${escapeHtml(eventName)}
              ${eventItem && eventItem.date_debut !== eventItem.date_fin ? ` ${escapeHtml(journee.jour_label)}` : ""}
              ${escapeHtml(city)}
            </span>
          </article>
        `;
      })
      .join("");
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

        return `
          <article class="stockRow">
            <div class="stockProductTitle">
              <strong>${escapeHtml(group.parfum_code)}</strong>
              <span>${escapeHtml(group.parfum_nom)}</span>
            </div>

            <div class="stockFormatGrid">
              ${renderFormatControl(product50, "50 cL")}
              ${renderFormatControl(product20, "20 cL")}
            </div>
          </article>
        `;
      })
      .join("");
  };

  const renderFormatControl = (product, label) => {
    if (!product) {
      return `
        <div class="stockFormatControl isUnavailable">
          <span>${escapeHtml(label)}</span>
          <em>—</em>
        </div>
      `;
    }

    const qty = getQuantity(product.sku_id);

    return `
      <div class="stockFormatControl">
        <span>${escapeHtml(label)}</span>

        <div class="stockQtyControl">
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

  const loadContext = () => {
    const context = readJson(STORAGE_KEYS.preparationContext, null);

    if (!context || (!context.stock_mission_id && !context.mission_id)) {
      state.context = null;
      state.stockMission = null;
      state.journees = [];

      setStatus(
        "Aucune mission de stock active. Retourne dans Évènements puis clique sur préparer le stock.",
        "isError"
      );

      return false;
    }

    const missionId = context.stock_mission_id || context.mission_id;
    const missions = getStockMissions();
    const journees = getJournees();

    state.context = context;
    state.events = getEvents();
    state.stockMission = missions.find((mission) => mission.mission_id === missionId) || null;
    state.journees = journees
      .filter((journee) => journee.mission_id === missionId || journee.stock_mission_id === missionId)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    if (!state.stockMission) {
      setStatus("Mission de stock introuvable.", "isError");
      return false;
    }

    return true;
  };

  const loadCatalogue = async () => {
    try {
      if (!window.LugdurumAPI || typeof window.LugdurumAPI.getCatalogue !== "function") {
        throw new Error("lugdurum-api.js n’est pas chargé.");
      }

      const rows = await window.LugdurumAPI.getCatalogue();

      state.catalogue = rows
        .map((row, index) => normalizeProduct(row, index))
        .filter((product) => product.sku_id && product.parfum_code && product.format_cl);

      state.dataLoaded = true;

      writeJson(STORAGE_KEYS.catalogueCache, state.catalogue);
    } catch (error) {
      const cached = readJson(STORAGE_KEYS.catalogueCache, []);

      if (cached.length > 0) {
        state.catalogue = cached
          .map((row, index) => normalizeProduct(row, index))
          .filter((product) => product.sku_id && product.parfum_code && product.format_cl);

        state.dataLoaded = true;

        setStatus("Catalogue chargé depuis le cache local.", "isError");
        return;
      }

      state.catalogue = [];
      state.dataLoaded = true;

      setStatus(`Impossible de charger le catalogue : ${error.message}`, "isError");
    }
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
      return;
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

  const init = async () => {
    renderAll();

    const hasContext = loadContext();
    renderAll();

    if (!hasContext) return;

    await loadCatalogue();
    hydrateExistingPreparation();
    renderAll();
  };

  init();
})();
