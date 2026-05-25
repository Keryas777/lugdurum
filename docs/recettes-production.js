(() => {
  "use strict";

  /*
    Production recettes V2 — connecté Google Sheets via LugdurumAPI

    - Lecture remote-first via getCoreData :
      recettes, recettesIngredients, matieresLots

    - Écriture :
      upsertCuvee
      upsertCuveeIngredientReel
      upsertCuveeMatiereConsommee
      upsertMouvementMatiere
      upsertMatiereLot

    - Cache localStorage uniquement en secours :
      - hors ligne
      - API indisponible
      - erreur Google Sheets

    - Le brouillon reste local par nature.
    - Aucune donnée démo.
  */

  const STORAGE_KEYS = {
    recipes: "lugdurum_recettes",
    recipeIngredients: "lugdurum_recettes_ingredients",
    batches: "lugdurum_cuvees",
    lots: "lugdurum_matieres_lots",
    consumptions: "lugdurum_cuvees_matieres_consommees",
    batchIngredientRows: "lugdurum_cuvees_ingredients_reels",
    movements: "lugdurum_mouvements_matieres",
    draft: "lugdurum_cuvee_brouillon"
  };

  const CORE_TABLES = "recettes,recettesIngredients,matieresLots";

  const TABLE_ALIASES = {
    recettes: ["recettes"],
    recettesIngredients: ["recettesIngredients", "recettes_ingredients"],
    matieresLots: ["matieresLots", "matieres_lots"]
  };

  const ACTION_TABLE_MAP = {
    upsertCuvee: ["cuvees"],
    upsertCuveeIngredientReel: ["cuveesIngredientsReels", "cuvees_ingredients_reels"],
    upsertCuveeMatiereConsommee: [
      "cuveesMatieresConsommees",
      "cuvees_matieres_consommees"
    ],
    upsertMouvementMatiere: ["mouvementsMatieres", "mouvements_matieres"],
    upsertMatiereLot: ["matieresLots", "matieres_lots"]
  };

  let recipes = [];
  let recipeIngredients = [];
  let lots = [];
  let selectedRecipe = null;
  let globalLines = [];
  let isSaving = false;
  let eventsBound = false;

  function $(id) {
    return document.getElementById(id);
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function toNumber(value, fallback = 0) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    const normalized = String(value ?? "")
      .trim()
      .replace(/\s/g, "")
      .replace(",", ".");

    if (!normalized) return fallback;

    const parsed = Number(normalized);

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function roundAmount(value) {
    return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
  }

  function money(value) {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR"
    }).format(toNumber(value, 0));
  }

  function number(value, decimals = 0) {
    return new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(toNumber(value, 0));
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;
  }

  function safeId(value) {
    return String(value ?? "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);
  }

  function normalizeText(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function normalizeStatus(value) {
    return normalizeText(value).replace(/\s+/g, "_");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function readLocal(key, fallback = []) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;

      const parsed = JSON.parse(raw);

      if (Array.isArray(fallback)) {
        return Array.isArray(parsed) ? parsed : fallback;
      }

      return parsed || fallback;
    } catch {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn("Impossible d’écrire le cache local.", err);
    }
  }

  function removeLocal(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn("Impossible de nettoyer le cache local.", err);
    }
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function setStatus(text, kind = "") {
    const el = $("syncStatus");

    if (!el) return;

    el.textContent = text;
    el.className = `syncPill ${kind}`.trim();
  }

  function hydrateFromCache() {
    recipes = readLocal(STORAGE_KEYS.recipes, []);
    recipeIngredients = readLocal(STORAGE_KEYS.recipeIngredients, []);
    lots = readLocal(STORAGE_KEYS.lots, []);
  }

  function saveReadCache() {
    writeLocal(STORAGE_KEYS.recipes, recipes);
    writeLocal(STORAGE_KEYS.recipeIngredients, recipeIngredients);
    writeLocal(STORAGE_KEYS.lots, lots);
  }

  function unwrapCoreData(response) {
    if (!response) return {};

    if (response.data && typeof response.data === "object") {
      if (response.data.data && typeof response.data.data === "object") {
        return response.data.data;
      }

      return response.data;
    }

    return response;
  }

  function getRowsFromCoreData(core, key) {
    const aliases = TABLE_ALIASES[key] || [key];

    for (const alias of aliases) {
      const value = core?.[alias];

      if (Array.isArray(value)) {
        return value;
      }

      if (value && typeof value === "object" && value.ok === false) {
        throw new Error(value.error || `Table indisponible : ${alias}`);
      }
    }

    return [];
  }

  async function readCoreDataFromApi() {
    const api = window.LugdurumAPI;

    if (!api) {
      throw new Error("LugdurumAPI indisponible.");
    }

    if (typeof api.getCoreData === "function") {
      const response = await api.getCoreData(CORE_TABLES);
      const core = unwrapCoreData(response);

      return {
        recipes: getRowsFromCoreData(core, "recettes"),
        recipeIngredients: getRowsFromCoreData(core, "recettesIngredients"),
        lots: getRowsFromCoreData(core, "matieresLots")
      };
    }

    if (typeof api.list === "function") {
      const [recipeRows, ingredientRows, lotRows] = await Promise.all([
        readTableWithListApi("recettes"),
        readTableWithListApi("recettesIngredients"),
        readTableWithListApi("matieresLots")
      ]);

      return {
        recipes: recipeRows,
        recipeIngredients: ingredientRows,
        lots: lotRows
      };
    }

    throw new Error("Aucune méthode de lecture compatible dans LugdurumAPI.");
  }

  async function readTableWithListApi(key) {
    const api = window.LugdurumAPI;
    const aliases = TABLE_ALIASES[key] || [key];
    let lastError = null;

    for (const alias of aliases) {
      try {
        const response = await api.list(alias);
        return asArray(response?.data || response);
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error(`Lecture impossible : ${key}`);
  }

  async function apiPost(action, payload) {
    const api = window.LugdurumAPI;

    if (!api) {
      throw new Error("LugdurumAPI indisponible.");
    }

    if (typeof api.post === "function") {
      return api.post(action, payload);
    }

    if (typeof api.request === "function") {
      return api.request(action, payload);
    }

    if (typeof api.call === "function") {
      return api.call(action, payload);
    }

    if (typeof api.queueAction === "function") {
      return api.queueAction(action, payload);
    }

    if (typeof api.enqueueAction === "function") {
      return api.enqueueAction(action, payload);
    }

    if (typeof api.upsert === "function" && ACTION_TABLE_MAP[action]) {
      return apiUpsertFallback(action, payload?.data || payload);
    }

    throw new Error(`Aucune méthode POST compatible pour ${action}.`);
  }

  async function apiUpsertFallback(action, row) {
    const api = window.LugdurumAPI;
    const aliases = ACTION_TABLE_MAP[action] || [];
    let lastError = null;

    for (const alias of aliases) {
      try {
        return await api.upsert(alias, row);
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error(`Upsert impossible : ${action}.`);
  }

  async function apiBatchActions(actions) {
    try {
      return await apiPost("batchActions", { actions });
    } catch (batchErr) {
      console.warn("batchActions indisponible, tentative action par action.", batchErr);

      const results = [];

      for (const item of actions) {
        try {
          const data = await apiPost(item.action, item.payload || {});
          results.push({
            ok: true,
            action: item.action,
            queue_id: item.queue_id || "",
            data
          });
        } catch (err) {
          results.push({
            ok: false,
            action: item.action,
            queue_id: item.queue_id || "",
            error: err.message
          });
        }
      }

      const failed = results.filter((item) => !item.ok);

      if (failed.length > 0) {
        throw new Error(
          failed.map((item) => `${item.action}: ${item.error}`).join(" | ")
        );
      }

      return {
        ok: true,
        data: {
          results,
          success_count: results.length,
          failed_count: 0
        }
      };
    }
  }

  function upsertInArray(rows, idKey, row) {
    const safeRows = asArray(rows);
    const id = String(row?.[idKey] || "").trim();

    if (!id) return safeRows;

    const index = safeRows.findIndex((item) => String(item?.[idKey] || "") === id);

    if (index >= 0) {
      safeRows[index] = {
        ...safeRows[index],
        ...row
      };
    } else {
      safeRows.unshift(row);
    }

    return safeRows;
  }

  function isArchivedLot(lot) {
    const status = normalizeStatus(lot?.statut);

    return [
      "archive",
      "archivee",
      "inactif",
      "annule",
      "annulee"
    ].includes(status);
  }

  function getUnitCost(lot) {
    const explicit = toNumber(lot?.cout_unitaire, NaN);

    if (Number.isFinite(explicit)) {
      return explicit;
    }

    const total = toNumber(lot?.cout_total, 0);
    const initial = toNumber(lot?.quantite_initiale, 0);

    if (!initial) return 0;

    return total / initial;
  }

  function getActiveLots() {
    return lots.filter((lot) => !isArchivedLot(lot));
  }

  function findLotByCategory(category, preferredText = "") {
    const wantedCategory = normalizeText(category);
    const wantedText = normalizeText(preferredText);

    const candidates = getActiveLots().filter((lot) => {
      return normalizeText(lot.categorie) === wantedCategory;
    });

    if (wantedText) {
      const preferred = candidates.find((lot) => {
        return normalizeText(lot.nom_lot || lot.nom_matiere || lot.nom).includes(wantedText);
      });

      if (preferred) return preferred;
    }

    return candidates[0] || null;
  }

  function fillRecipes() {
    const select = $("recipeSelect");

    if (!select) return;

    const query = new URLSearchParams(window.location.search);
    const requestedId = query.get("recette_id");

    select.innerHTML = recipes.length
      ? recipes
          .map((recipe) => {
            return `
              <option value="${escapeHtml(recipe.recette_id)}">
                ${escapeHtml(recipe.parfum_nom || recipe.nom || "Recette")}
                ${escapeHtml(recipe.version || "")}
                (${escapeHtml(recipe.annee_reference || "—")})
              </option>
            `;
          })
          .join("")
      : `<option value="">Aucune recette disponible</option>`;

    if (requestedId && recipes.some((recipe) => String(recipe.recette_id) === String(requestedId))) {
      select.value = requestedId;
    }
  }

  function selectRecipe(id, options = {}) {
    selectedRecipe =
      recipes.find((recipe) => String(recipe.recette_id || "") === String(id || "")) ||
      recipes[0] ||
      null;

    const summary = $("recipeSummary");

    if (!selectedRecipe) {
      if (summary) {
        summary.textContent =
          "Aucune recette disponible. Ajoute d’abord une recette dans l’historique.";
      }

      renderIngredients();
      recalculate();
      return;
    }

    if (summary) {
      summary.textContent =
        `Base : ${selectedRecipe.parfum_nom || selectedRecipe.nom || "Recette"} ` +
        `${selectedRecipe.version || ""} (${selectedRecipe.annee_reference || "—"})` +
        ` · dilution cible +${selectedRecipe.dilution_cible_pct || 0}%` +
        ` · ${selectedRecipe.temps_maceration_jours || "—"} jours`;
    }

    const batchName = $("batchName");
    const batchYear = $("batchYear");
    const dilutionPct = $("dilutionPct");

    if (batchName && !batchName.value && !options.preserveFields) {
      batchName.value =
        `${selectedRecipe.parfum_nom || selectedRecipe.nom || "Cuvée"} ` +
        `${selectedRecipe.version || ""} (${new Date().getFullYear()})`;
    }

    if (batchYear && !batchYear.value && !options.preserveFields) {
      batchYear.value = String(new Date().getFullYear());
    }

    if (dilutionPct && !dilutionPct.value && !options.preserveFields) {
      dilutionPct.value = selectedRecipe.dilution_cible_pct || 0;
    }

    renderIngredients();
    recalculate();
  }

  function getRecipeIngredientRows() {
    if (!selectedRecipe) return [];

    return recipeIngredients
      .filter((ingredient) => {
        return String(ingredient.recette_id || "") === String(selectedRecipe.recette_id || "");
      })
      .sort((a, b) => {
        return toNumber(a.ordre_affichage, 999) - toNumber(b.ordre_affichage, 999);
      });
  }

  function renderIngredients() {
    const container = $("ingredientRows");

    if (!container) return;

    const rows = getRecipeIngredientRows();

    if (rows.length === 0) {
      container.innerHTML = `<div class="empty">Aucun ratio d’ingrédient pour cette recette.</div>`;
      return;
    }

    const savedDraft = readLocal(STORAGE_KEYS.draft, null);
    const savedIngredientRows = asArray(savedDraft?.ingredientRows);

    container.innerHTML = rows
      .map((ingredient) => {
        const saved = savedIngredientRows.find((item) => {
          return String(item.recette_ingredient_id || "") === String(ingredient.recette_ingredient_id || "");
        });

        return `
          <div class="calcRow" data-ing="${escapeHtml(ingredient.recette_ingredient_id)}">
            <div>
              <strong>${escapeHtml(ingredient.nom_ingredient || "Ingrédient")}</strong>
              <div class="meta">
                ${number(ingredient.quantite_par_litre_rhum, 2)}
                ${escapeHtml(ingredient.unite || "")} / L
                ${ingredient.note ? `· ${escapeHtml(ingredient.note)}` : ""}
              </div>
            </div>

            <div class="field">
              <label>Prévu</label>
              <input readonly value="0" data-role="plannedQty" />
            </div>

            <div class="field">
              <label>Quantité réelle</label>
              <input
                type="number"
                step="0.01"
                data-role="realQty"
                value="${escapeHtml(saved?.quantite_reelle ?? "")}"
              />
            </div>

            <div class="field">
              <label>Coût réel €</label>
              <input
                type="number"
                step="0.01"
                data-role="cost"
                value="${escapeHtml(saved?.cout_total_reel ?? 0)}"
              />
            </div>

            <div class="field">
              <label>Fournisseur / note</label>
              <input
                data-role="note"
                value="${escapeHtml(saved?.note || "")}"
              />
            </div>
          </div>
        `;
      })
      .join("");
  }

  function finalVolume() {
    const rum = toNumber($("rumVolume")?.value, 0);
    const dilution = toNumber($("dilutionPct")?.value, 0);
    const loss = toNumber($("lossLiters")?.value, 0);

    return Math.max(0, rum * (1 + dilution / 100) - loss);
  }

  function getBottleCount50() {
    return Math.floor(finalVolume() / 0.5);
  }

  function getBottleCount20() {
    return Math.floor(finalVolume() / 0.2);
  }

  function ensureDefaultGlobalLines() {
    if (globalLines.length > 0) return;

    const rumLot = findLotByCategory("rhum");
    const bottleLot =
      findLotByCategory("bouteille", "50") ||
      findLotByCategory("bouteille");

    globalLines = [];

    if (rumLot) {
      globalLines.push({
        id: uid("TMP"),
        auto_role: "rhum",
        lot_id: rumLot.lot_id,
        quantite: toNumber($("rumVolume")?.value, 0),
        note: "Rhum utilisé"
      });
    }

    if (bottleLot) {
      globalLines.push({
        id: uid("TMP"),
        auto_role: "bouteille_50",
        lot_id: bottleLot.lot_id,
        quantite: getBottleCount50(),
        note: "Bouteilles 50 cL"
      });
    }

    if (globalLines.length === 0) {
      globalLines.push({
        id: uid("TMP"),
        auto_role: "",
        lot_id: "",
        quantite: 0,
        note: ""
      });
    }
  }

  function syncAutoGlobalLines() {
    globalLines = globalLines.map((line) => {
      if (line.auto_role === "rhum") {
        return {
          ...line,
          quantite: toNumber($("rumVolume")?.value, 0)
        };
      }

      if (line.auto_role === "bouteille_50") {
        return {
          ...line,
          quantite: getBottleCount50()
        };
      }

      if (line.auto_role === "bouteille_20") {
        return {
          ...line,
          quantite: getBottleCount20()
        };
      }

      return line;
    });
  }

  function addGlobalLine(seed = {}) {
    globalLines.push({
      id: uid("TMP"),
      auto_role: "",
      lot_id: seed.lot_id || getActiveLots()[0]?.lot_id || "",
      quantite: seed.quantite || 0,
      note: seed.note || ""
    });

    renderGlobalRows();
    recalculate();
    saveDraft(false);
  }

  function renderGlobalRows() {
    const container = $("globalRows");

    if (!container) return;

    ensureDefaultGlobalLines();

    const activeLots = getActiveLots();

    container.innerHTML = globalLines
      .map((line) => {
        const selectedLot = lots.find((lot) => String(lot.lot_id || "") === String(line.lot_id || ""));
        const options = [
          `<option value="">Sélectionner un lot</option>`,
          ...activeLots.map((lot) => {
            const selected = String(lot.lot_id || "") === String(line.lot_id || "")
              ? "selected"
              : "";

            return `
              <option value="${escapeHtml(lot.lot_id)}" ${selected}>
                ${escapeHtml(lot.nom_lot || lot.nom_matiere || "Lot")}
                · ${money(getUnitCost(lot))}/${escapeHtml(lot.unite || "u")}
              </option>
            `;
          })
        ].join("");

        return `
          <div class="calcRow" data-line="${escapeHtml(line.id)}">
            <div class="field">
              <label>Lot</label>
              <select data-role="lot">${options}</select>
            </div>

            <div class="field">
              <label>Quantité</label>
              <input
                type="number"
                step="0.01"
                data-role="qty"
                value="${escapeHtml(line.quantite)}"
              />
            </div>

            <div class="field">
              <label>Unité</label>
              <input readonly data-role="unit" value="${escapeHtml(selectedLot?.unite || "")}" />
            </div>

            <div class="field">
              <label>Coût imputé</label>
              <input readonly data-role="cost" value="${escapeHtml(money(getGlobalLineCost(line)))}" />
            </div>

            <div class="field">
              <label>Note</label>
              <input data-role="note" value="${escapeHtml(line.note || "")}" />
            </div>
          </div>
        `;
      })
      .join("");
  }

  function captureGlobalRows() {
    const container = $("globalRows");

    if (!container) return;

    globalLines = [...container.querySelectorAll(".calcRow")].map((row) => {
      const previous = globalLines.find((line) => String(line.id) === String(row.dataset.line)) || {};

      return {
        id: row.dataset.line || uid("TMP"),
        auto_role: previous.auto_role || "",
        lot_id: row.querySelector('[data-role="lot"]')?.value || "",
        quantite: toNumber(row.querySelector('[data-role="qty"]')?.value, 0),
        note: row.querySelector('[data-role="note"]')?.value || ""
      };
    });
  }

  function refreshGlobalLineCosts() {
    const container = $("globalRows");

    if (!container) return;

    container.querySelectorAll(".calcRow").forEach((row) => {
      const id = row.dataset.line || "";
      const line = globalLines.find((item) => String(item.id) === String(id));

      if (!line) return;

      const lot = lots.find((item) => String(item.lot_id || "") === String(line.lot_id || ""));
      const unitInput = row.querySelector('[data-role="unit"]');
      const costInput = row.querySelector('[data-role="cost"]');

      if (unitInput) unitInput.value = lot?.unite || "";
      if (costInput) costInput.value = money(getGlobalLineCost(line));
    });
  }

  function getGlobalLineCost(line) {
    const lot = lots.find((item) => String(item.lot_id || "") === String(line.lot_id || ""));

    if (!lot) return 0;

    return toNumber(line.quantite, 0) * getUnitCost(lot);
  }

  function specificCost() {
    const container = $("ingredientRows");

    if (!container) return 0;

    return [...container.querySelectorAll('.calcRow input[data-role="cost"]')]
      .reduce((sum, input) => sum + toNumber(input.value, 0), 0);
  }

  function globalCost() {
    return globalLines.reduce((sum, line) => sum + getGlobalLineCost(line), 0);
  }

  function recalculate() {
    const fv = finalVolume();
    const rumVolume = toNumber($("rumVolume")?.value, 0);

    setText("finalVolume", `${number(fv, 1)} L`);
    setText("bottles50", String(getBottleCount50()));
    setText("bottles20", String(getBottleCount20()));
    setText("yieldNote", `+${number(toNumber($("dilutionPct")?.value, 0), 0)}%`);

    const rows = getRecipeIngredientRows();

    $("ingredientRows")?.querySelectorAll(".calcRow").forEach((row) => {
      const ingredient = rows.find((item) => {
        return String(item.recette_ingredient_id || "") === String(row.dataset.ing || "");
      });

      const plannedQuantity = toNumber(ingredient?.quantite_par_litre_rhum, 0) * rumVolume;
      const plannedInput = row.querySelector('[data-role="plannedQty"]');

      if (plannedInput) {
        plannedInput.value = `${number(plannedQuantity, 2)} ${ingredient?.unite || ""}`;
      }
    });

    captureGlobalRows();
    refreshGlobalLineCosts();

    const spec = specificCost();
    const glob = globalCost();
    const total = spec + glob;
    const bottles50 = Math.max(1, getBottleCount50());
    const unitCost50 = fv ? total / bottles50 : 0;
    const margin50 = toNumber($("salePrice50")?.value, 0) - unitCost50;

    setText("specificCost", money(spec));
    setText("globalCost", money(glob));
    setText("totalCost", money(total));
    setText("unitCost50", fv ? money(unitCost50) : "—");

    const marginSummary = $("marginSummary");

    if (marginSummary) {
      marginSummary.textContent =
        `Marge brute estimée 50 cL : ${money(margin50)} par bouteille, ` +
        "avant charges globales et sans valeur fiscale officielle.";
    }
  }

  function captureIngredientRows() {
    const container = $("ingredientRows");

    if (!container) return [];

    const recipeRows = getRecipeIngredientRows();
    const rumVolume = toNumber($("rumVolume")?.value, 0);

    return [...container.querySelectorAll(".calcRow")].map((row) => {
      const ingredient = recipeRows.find((item) => {
        return String(item.recette_ingredient_id || "") === String(row.dataset.ing || "");
      });

      const plannedQuantity =
        toNumber(ingredient?.quantite_par_litre_rhum, 0) * rumVolume;

      const realQuantity = toNumber(
        row.querySelector('[data-role="realQty"]')?.value,
        plannedQuantity
      );

      return {
        recette_ingredient_id: ingredient?.recette_ingredient_id || "",
        ingredient_id: ingredient?.ingredient_id || "",
        nom_ingredient: ingredient?.nom_ingredient || "",
        categorie: ingredient?.categorie || "",
        quantite_prevue: roundAmount(plannedQuantity),
        quantite_reelle: roundAmount(realQuantity),
        unite: ingredient?.unite || "",
        cout_total_reel: roundAmount(row.querySelector('[data-role="cost"]')?.value || 0),
        note: row.querySelector('[data-role="note"]')?.value || ""
      };
    });
  }

  function draftPayload(status = "brouillon") {
    const existingDraft = readLocal(STORAGE_KEYS.draft, null) || {};
    const spec = specificCost();
    const glob = globalCost();
    const total = spec + glob;
    const fv = finalVolume();
    const bottles50 = getBottleCount50();
    const bottles20 = getBottleCount20();
    const unitCost50 = fv ? total / Math.max(1, bottles50) : 0;

    return {
      cuvee_id: existingDraft.cuvee_id || uid("CUV"),
      recette_id: selectedRecipe?.recette_id || "",
      recette_source_id: selectedRecipe?.recette_source_id || selectedRecipe?.recette_id || "",
      nom: $("batchName")?.value.trim() || "",
      parfum_code: selectedRecipe?.parfum_code || "",
      parfum_nom: selectedRecipe?.parfum_nom || selectedRecipe?.nom || "",
      version: selectedRecipe?.version || "",
      annee_production: $("batchYear")?.value || String(new Date().getFullYear()),
      type_cuvee: $("batchType")?.value || "nouvelle",
      statut: status,
      date_lancement: existingDraft.date_lancement || todayIso(),
      volume_rhum_l: roundAmount($("rumVolume")?.value || 0),
      volume_final_estime_l: roundAmount(fv),
      dilution_pct_estimee: roundAmount($("dilutionPct")?.value || 0),
      pertes_l: roundAmount($("lossLiters")?.value || 0),
      format_principal: $("mainFormat")?.value || "50",
      nombre_bouteilles_50: bottles50,
      nombre_bouteilles_20: bottles20,
      nombre_bouteilles_total: $("mainFormat")?.value === "20" ? bottles20 : bottles50,
      cout_ingredients_specifiques: roundAmount(spec),
      cout_matieres_globales: roundAmount(glob),
      cout_total: roundAmount(total),
      cout_unitaire_50_estime: roundAmount(unitCost50),
      prix_vente_50_ttc: roundAmount($("salePrice50")?.value || 0),
      prix_vente_20_ttc: roundAmount($("salePrice20")?.value || 0),
      marge_brute_50_estimee: roundAmount(
        toNumber($("salePrice50")?.value, 0) - unitCost50
      ),
      note_fabrication: $("batchNotes")?.value || "",
      created_at: existingDraft.created_at || isoNow(),
      updated_at: isoNow(),
      ingredientRows: captureIngredientRows(),
      globalLines: globalLines
    };
  }

  function saveDraft(showStatus = true) {
    recalculate();

    const draft = draftPayload("brouillon");

    writeLocal(STORAGE_KEYS.draft, draft);

    if (showStatus) {
      setStatus("Brouillon sauvegardé localement", "isLocal");
    }
  }

  function restoreDraft() {
    const draft = readLocal(STORAGE_KEYS.draft, null);

    if (!draft) return;

    const values = {
      batchName: draft.nom,
      batchYear: draft.annee_production,
      batchType: draft.type_cuvee,
      rumVolume: draft.volume_rhum_l,
      dilutionPct: draft.dilution_pct_estimee,
      lossLiters: draft.pertes_l,
      mainFormat: draft.format_principal,
      salePrice50: draft.prix_vente_50_ttc,
      salePrice20: draft.prix_vente_20_ttc,
      batchNotes: draft.note_fabrication
    };

    Object.entries(values).forEach(([id, value]) => {
      const el = $(id);

      if (el && value !== undefined && value !== null) {
        el.value = value;
      }
    });

    if (draft.recette_id && $("recipeSelect")) {
      $("recipeSelect").value = draft.recette_id;
    }

    globalLines = asArray(draft.globalLines);
  }

  function buildIngredientWriteRows(cuvee) {
    return captureIngredientRows().map((row) => {
      const id =
        `CIR_${safeId(cuvee.cuvee_id)}_${safeId(row.recette_ingredient_id || row.ingredient_id)}`;

      return {
        cuvee_ingredient_id: id,
        cuvee_id: cuvee.cuvee_id,
        recette_id: cuvee.recette_id,
        recette_ingredient_id: row.recette_ingredient_id,
        ingredient_id: row.ingredient_id,
        nom_ingredient: row.nom_ingredient,
        categorie: row.categorie,
        quantite_prevue: row.quantite_prevue,
        quantite_reelle: row.quantite_reelle,
        unite: row.unite,
        cout_total_reel: row.cout_total_reel,
        note: row.note,
        created_at: isoNow(),
        updated_at: isoNow()
      };
    });
  }

  function buildGlobalConsumptionRows(cuvee) {
    return globalLines
      .filter((line) => line.lot_id && toNumber(line.quantite, 0) > 0)
      .map((line) => {
        const lot = lots.find((item) => String(item.lot_id || "") === String(line.lot_id || ""));
        const unitCost = getUnitCost(lot);
        const quantity = toNumber(line.quantite, 0);

        return {
          conso_id: `CONSO_${safeId(cuvee.cuvee_id)}_${safeId(line.id || line.lot_id)}`,
          cuvee_id: cuvee.cuvee_id,
          lot_id: lot?.lot_id || "",
          matiere_id: lot?.matiere_id || "",
          nom_matiere: lot?.nom_matiere || lot?.nom_lot || "",
          categorie: lot?.categorie || "",
          quantite_consommee: roundAmount(quantity),
          unite: lot?.unite || "",
          cout_unitaire_snapshot: roundAmount(unitCost),
          cout_total_impute: roundAmount(quantity * unitCost),
          note: line.note || "",
          created_at: isoNow(),
          updated_at: isoNow()
        };
      });
  }

  function buildMovementRows(cuvee, consumptionRows) {
    return consumptionRows.map((row) => {
      return {
        mouvement_matiere_id: `MMAT_${safeId(row.conso_id)}`,
        lot_id: row.lot_id,
        matiere_id: row.matiere_id,
        type_mouvement: "consommation_cuvee",
        source_type: "cuvee",
        source_id: cuvee.cuvee_id,
        date_mouvement: todayIso(),
        nom_matiere: row.nom_matiere,
        categorie: row.categorie,
        quantite: -Math.abs(toNumber(row.quantite_consommee, 0)),
        unite: row.unite,
        cout_unitaire_snapshot: row.cout_unitaire_snapshot,
        cout_total_snapshot: -Math.abs(toNumber(row.cout_total_impute, 0)),
        note: `Consommation pour ${cuvee.nom || cuvee.cuvee_id}`,
        created_at: isoNow(),
        updated_at: isoNow()
      };
    });
  }

  function buildUpdatedLots(consumptionRows) {
    return consumptionRows
      .map((consumption) => {
        const lot = lots.find((item) => String(item.lot_id || "") === String(consumption.lot_id || ""));

        if (!lot) return null;

        const remaining =
          toNumber(lot.quantite_restante, 0) -
          toNumber(consumption.quantite_consommee, 0);

        return {
          ...lot,
          quantite_restante: roundAmount(remaining),
          updated_at: isoNow()
        };
      })
      .filter(Boolean);
  }

  function hasOverConsumption(consumptionRows) {
    return consumptionRows.some((consumption) => {
      const lot = lots.find((item) => String(item.lot_id || "") === String(consumption.lot_id || ""));

      if (!lot) return false;

      return toNumber(consumption.quantite_consommee, 0) > toNumber(lot.quantite_restante, 0);
    });
  }

  function saveRowsToLocalCache(cuvee, ingredientRows, consumptionRows, movementRows, updatedLots) {
    let batchRows = readLocal(STORAGE_KEYS.batches, []);
    let ingredientRealRows = readLocal(STORAGE_KEYS.batchIngredientRows, []);
    let consumptionCacheRows = readLocal(STORAGE_KEYS.consumptions, []);
    let movementCacheRows = readLocal(STORAGE_KEYS.movements, []);
    let lotCacheRows = readLocal(STORAGE_KEYS.lots, lots);

    batchRows = upsertInArray(batchRows, "cuvee_id", cuvee);

    ingredientRows.forEach((row) => {
      ingredientRealRows = upsertInArray(
        ingredientRealRows,
        "cuvee_ingredient_id",
        row
      );
    });

    consumptionRows.forEach((row) => {
      consumptionCacheRows = upsertInArray(
        consumptionCacheRows,
        "conso_id",
        row
      );
    });

    movementRows.forEach((row) => {
      movementCacheRows = upsertInArray(
        movementCacheRows,
        "mouvement_matiere_id",
        row
      );
    });

    updatedLots.forEach((row) => {
      lotCacheRows = upsertInArray(lotCacheRows, "lot_id", row);
      lots = upsertInArray(lots, "lot_id", row);
    });

    writeLocal(STORAGE_KEYS.batches, batchRows);
    writeLocal(STORAGE_KEYS.batchIngredientRows, ingredientRealRows);
    writeLocal(STORAGE_KEYS.consumptions, consumptionCacheRows);
    writeLocal(STORAGE_KEYS.movements, movementCacheRows);
    writeLocal(STORAGE_KEYS.lots, lotCacheRows);
  }

  async function archiveBatch(event) {
    event.preventDefault();

    if (isSaving) return;

    recalculate();

    const cuvee = draftPayload("archivee");

    if (!cuvee.nom) {
      alert("Nom de cuvée obligatoire.");
      return;
    }

    const ingredientRows = buildIngredientWriteRows(cuvee);
    const consumptionRows = buildGlobalConsumptionRows(cuvee);
    const movementRows = buildMovementRows(cuvee, consumptionRows);
    const updatedLots = buildUpdatedLots(consumptionRows);

    if (hasOverConsumption(consumptionRows)) {
      const confirmed = confirm(
        "Certaines quantités consommées dépassent le stock restant connu. Continuer quand même ?"
      );

      if (!confirmed) return;
    }

    const actions = [
      {
        queue_id: uid("QUEUE_CUV"),
        action: "upsertCuvee",
        payload: {
          data: cuvee
        }
      },
      ...ingredientRows.map((row) => {
        return {
          queue_id: uid("QUEUE_CIR"),
          action: "upsertCuveeIngredientReel",
          payload: {
            data: row
          }
        };
      }),
      ...consumptionRows.map((row) => {
        return {
          queue_id: uid("QUEUE_CONSO"),
          action: "upsertCuveeMatiereConsommee",
          payload: {
            data: row
          }
        };
      }),
      ...movementRows.map((row) => {
        return {
          queue_id: uid("QUEUE_MMAT"),
          action: "upsertMouvementMatiere",
          payload: {
            data: row
          }
        };
      }),
      ...updatedLots.map((row) => {
        return {
          queue_id: uid("QUEUE_LOT"),
          action: "upsertMatiereLot",
          payload: {
            data: row
          }
        };
      })
    ];

    isSaving = true;
    setStatus("Archivage de la cuvée…", "isRefreshing");

    try {
      await apiBatchActions(actions);

      saveRowsToLocalCache(cuvee, ingredientRows, consumptionRows, movementRows, updatedLots);
      removeLocal(STORAGE_KEYS.draft);

      setStatus("Cuvée archivée dans Google Sheets", "isOnline");
      alert("Cuvée archivée / mise à jour.");
    } catch (err) {
      console.warn("Archivage distant impossible, données conservées localement.", err);

      saveRowsToLocalCache(cuvee, ingredientRows, consumptionRows, movementRows, updatedLots);
      writeLocal(STORAGE_KEYS.draft, {
        ...cuvee,
        ingredientRows: captureIngredientRows(),
        globalLines
      });

      setStatus("Archivage conservé en local — synchro à refaire", "isLocal");
      alert("Google Sheets est indisponible. La cuvée est conservée en local.");
    } finally {
      isSaving = false;
      recalculate();
    }
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    const recipeSelect = $("recipeSelect");
    const ingredientRows = $("ingredientRows");
    const globalRows = $("globalRows");
    const addGlobalRowButton = $("addGlobalRow");
    const saveDraftButton = $("saveDraftBtn");
    const form = $("batchForm");

    if (recipeSelect) {
      recipeSelect.addEventListener("change", () => {
        selectRecipe(recipeSelect.value);
        saveDraft(false);
      });
    }

    [
      "rumVolume",
      "dilutionPct",
      "lossLiters",
      "mainFormat",
      "salePrice50",
      "salePrice20",
      "batchName",
      "batchYear",
      "batchType",
      "batchNotes"
    ].forEach((id) => {
      const el = $(id);

      if (!el) return;

      el.addEventListener("input", () => {
        if (["rumVolume", "mainFormat"].includes(id)) {
          syncAutoGlobalLines();
          renderGlobalRows();
        }

        recalculate();
        saveDraft(false);
      });

      el.addEventListener("change", () => {
        if (["rumVolume", "mainFormat"].includes(id)) {
          syncAutoGlobalLines();
          renderGlobalRows();
        }

        recalculate();
        saveDraft(false);
      });
    });

    if (ingredientRows) {
      ingredientRows.addEventListener("input", () => {
        recalculate();
        saveDraft(false);
      });
    }

    if (globalRows) {
      globalRows.addEventListener("input", (event) => {
        captureGlobalRows();

        if (event.target?.matches('[data-role="lot"]')) {
          renderGlobalRows();
        }

        recalculate();
        saveDraft(false);
      });

      globalRows.addEventListener("change", (event) => {
        captureGlobalRows();

        if (event.target?.matches('[data-role="lot"]')) {
          renderGlobalRows();
        }

        recalculate();
        saveDraft(false);
      });
    }

    if (addGlobalRowButton) {
      addGlobalRowButton.addEventListener("click", () => addGlobalLine());
    }

    if (saveDraftButton) {
      saveDraftButton.addEventListener("click", () => saveDraft(true));
    }

    if (form) {
      form.addEventListener("submit", archiveBatch);
    }

    window.addEventListener("online", () => {
      refreshFromApi();
    });

    window.addEventListener("offline", () => {
      setStatus("Hors ligne — brouillon local", "isLocal");
    });
  }

  function renderAfterDataLoad() {
    fillRecipes();
    restoreDraft();

    if ($("recipeSelect")?.value) {
      selectRecipe($("recipeSelect").value, {
        preserveFields: true
      });
    } else {
      selectRecipe(recipes[0]?.recette_id || "", {
        preserveFields: true
      });
    }

    ensureDefaultGlobalLines();
    syncAutoGlobalLines();
    renderGlobalRows();
    recalculate();
  }

  async function refreshFromApi() {
    if (!navigator.onLine) {
      hydrateFromCache();
      renderAfterDataLoad();
      setStatus("Hors ligne — données locales", "isLocal");
      return;
    }

    if (!window.LugdurumAPI) {
      hydrateFromCache();
      renderAfterDataLoad();
      setStatus("API indisponible — cache local", "isLocal");
      return;
    }

    setStatus("Chargement Google Sheets…", "isRefreshing");

    try {
      const fresh = await readCoreDataFromApi();

      recipes = asArray(fresh.recipes);
      recipeIngredients = asArray(fresh.recipeIngredients);
      lots = asArray(fresh.lots);

      saveReadCache();
      renderAfterDataLoad();

      setStatus("Atelier Google Sheets à jour", "isOnline");
    } catch (err) {
      console.warn("Lecture Google Sheets impossible.", err);

      hydrateFromCache();
      renderAfterDataLoad();

      setStatus("Google Sheets indisponible — cache local", "isLocal");
    }
  }

  function init() {
    bindEvents();

    if (navigator.onLine && window.LugdurumAPI) {
      setStatus("Chargement Google Sheets…", "isRefreshing");
      refreshFromApi();
      return;
    }

    hydrateFromCache();
    renderAfterDataLoad();

    if (!navigator.onLine) {
      setStatus("Hors ligne — données locales", "isLocal");
      return;
    }

    setStatus("API indisponible — cache local", "isLocal");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();