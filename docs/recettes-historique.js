(() => {
  "use strict";

  /*
    Historique recettes V2 — connecté Google Sheets via LugdurumAPI

    - Lecture remote-first via getCoreData :
      recettes, recettesIngredients, cuvees

    - Écriture :
      upsertRecette
      upsertRecetteIngredient

    - Cache localStorage uniquement en secours :
      - hors ligne
      - API indisponible
      - erreur Google Sheets

    - Aucune donnée démo.
  */

  const STORAGE_KEYS = {
    recipes: "lugdurum_recettes",
    recipeIngredients: "lugdurum_recettes_ingredients",
    batches: "lugdurum_cuvees"
  };

  const CORE_TABLES = "recettes,recettesIngredients,cuvees";

  const TABLE_ALIASES = {
    recettes: ["recettes"],
    recettesIngredients: ["recettesIngredients", "recettes_ingredients"],
    cuvees: ["cuvees"]
  };

  const ACTION_TABLE_MAP = {
    upsertRecette: ["recettes"],
    upsertRecetteIngredient: ["recettesIngredients", "recettes_ingredients"]
  };

  let recipes = [];
  let recipeIngredients = [];
  let batches = [];
  let selectedId = "";

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

  function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;
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

      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(asArray(value)));
    } catch (err) {
      console.warn("Impossible d’écrire le cache local.", err);
    }
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
    batches = readLocal(STORAGE_KEYS.batches, []);
  }

  function saveCache() {
    writeLocal(STORAGE_KEYS.recipes, recipes);
    writeLocal(STORAGE_KEYS.recipeIngredients, recipeIngredients);
    writeLocal(STORAGE_KEYS.batches, batches);
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
        batches: getRowsFromCoreData(core, "cuvees")
      };
    }

    if (typeof api.list === "function") {
      const [recipeRows, ingredientRows, batchRows] = await Promise.all([
        readTableWithListApi("recettes"),
        readTableWithListApi("recettesIngredients"),
        readTableWithListApi("cuvees")
      ]);

      return {
        recipes: recipeRows,
        recipeIngredients: ingredientRows,
        batches: batchRows
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

  function fillYears() {
    const yearFilter = $("yearFilter");

    if (!yearFilter) return;

    const currentValue = yearFilter.value;

    const years = [
      ...new Set(
        recipes
          .map((recipe) => String(recipe.annee_reference || "").trim())
          .filter(Boolean)
      )
    ].sort((a, b) => String(b).localeCompare(String(a)));

    yearFilter.innerHTML =
      '<option value="">Toutes années</option>' +
      years.map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join("");

    if (currentValue && years.includes(currentValue)) {
      yearFilter.value = currentValue;
    }
  }

  function filteredRecipes() {
    const searchValue = normalizeText($("searchInput")?.value || "");
    const yearValue = String($("yearFilter")?.value || "").trim();
    const statusValue = String($("statusFilter")?.value || "").trim();

    return recipes
      .filter((recipe) => {
        const haystack = normalizeText(
          [
            recipe.nom,
            recipe.parfum_nom,
            recipe.parfum_code,
            recipe.version,
            recipe.description,
            recipe.fabrication_note,
            recipe.degustation_note
          ].join(" ")
        );

        const matchesSearch = !searchValue || haystack.includes(searchValue);
        const matchesYear =
          !yearValue || String(recipe.annee_reference || "") === String(yearValue);
        const matchesStatus =
          !statusValue || String(recipe.statut || "") === String(statusValue);

        return matchesSearch && matchesYear && matchesStatus;
      })
      .sort((a, b) => {
        const byYear = String(b.annee_reference || "").localeCompare(
          String(a.annee_reference || "")
        );

        if (byYear !== 0) return byYear;

        return String(b.updated_at || b.created_at || "").localeCompare(
          String(a.updated_at || a.created_at || "")
        );
      });
  }

  function renderList() {
    const list = $("recipesList");

    if (!list) return;

    const rows = filteredRecipes();

    if (rows.length === 0) {
      list.innerHTML = `<div class="empty">Aucune recette ne correspond aux filtres.</div>`;
      renderEmptyDetail();
      return;
    }

    list.innerHTML = rows
      .map((recipe) => {
        const isSelected = String(recipe.recette_id || "") === String(selectedId || "");
        const status = normalizeStatus(recipe.statut);
        const badgeClass =
          status === "favorite" || status === "favori"
            ? "success"
            : status === "test" || status === "brouillon"
              ? "warning"
              : "";

        return `
          <button
            type="button"
            class="itemCard${isSelected ? " isSelected" : ""}"
            data-recette-id="${escapeHtml(recipe.recette_id)}"
          >
            <div class="itemTop">
              <div>
                <div class="itemTitle">
                  ${escapeHtml(recipe.parfum_nom || recipe.nom || "Recette")}
                  ${escapeHtml(recipe.version || "")}
                  (${escapeHtml(recipe.annee_reference || "—")})
                </div>

                <div class="meta">
                  ${escapeHtml(recipe.description || "Sans description")}
                </div>
              </div>

              <span class="badge ${badgeClass}">
                ${escapeHtml(recipe.statut || "brouillon")}
              </span>
            </div>
          </button>
        `;
      })
      .join("");

    list.querySelectorAll("[data-recette-id]").forEach((button) => {
      button.addEventListener("click", () => {
        selectRecipe(button.dataset.recetteId || "");
      });
    });

    if (!selectedId || !rows.some((recipe) => String(recipe.recette_id) === String(selectedId))) {
      selectRecipe(rows[0].recette_id);
    }
  }

  function renderEmptyDetail() {
    const detail = $("recipeDetail");

    if (!detail) return;

    detail.innerHTML = `
      <h2>Détail</h2>
      <div class="empty">Sélectionne une recette pour voir ses ratios, notes et cuvées liées.</div>
    `;
  }

  function selectRecipe(id) {
    selectedId = id;

    const recipe = recipes.find((item) => String(item.recette_id || "") === String(id || ""));

    if (!recipe) {
      renderEmptyDetail();
      return;
    }

    renderRecipeDetail(recipe);
    renderListSelectionOnly();
  }

  function renderListSelectionOnly() {
    const list = $("recipesList");

    if (!list) return;

    list.querySelectorAll("[data-recette-id]").forEach((button) => {
      const isSelected = String(button.dataset.recetteId || "") === String(selectedId || "");
      button.classList.toggle("isSelected", isSelected);
    });
  }

  function renderRecipeDetail(recipe) {
    const detail = $("recipeDetail");

    if (!detail) return;

    const ingredientRows = recipeIngredients
      .filter((item) => String(item.recette_id || "") === String(recipe.recette_id || ""))
      .sort((a, b) => toNumber(a.ordre_affichage, 999) - toNumber(b.ordre_affichage, 999));

    const linkedBatches = batches
      .filter((batch) => String(batch.recette_id || "") === String(recipe.recette_id || ""))
      .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(
        String(a.updated_at || a.created_at || "")
      ));

    detail.innerHTML = `
      <h2>
        ${escapeHtml(recipe.parfum_nom || recipe.nom || "Recette")}
        ${escapeHtml(recipe.version || "")}
      </h2>

      <p class="meta">
        Année ${escapeHtml(recipe.annee_reference || "—")}
        · statut ${escapeHtml(recipe.statut || "—")}
        · ${escapeHtml(recipe.temps_maceration_jours || "—")} jours de macération
      </p>

      ${recipe.description ? `<p>${escapeHtml(recipe.description)}</p>` : ""}

      <div class="stats">
        <div class="stat">
          <strong>${number(recipe.volume_reference_l || 1, 1)} L</strong>
          <span>référence rhum</span>
        </div>

        <div class="stat">
          <strong>${number(recipe.sucre_cible_g_l, 0)} g/L</strong>
          <span>sucre cible</span>
        </div>

        <div class="stat">
          <strong>+${number(recipe.dilution_cible_pct, 0)}%</strong>
          <span>dilution cible</span>
        </div>

        <div class="stat">
          <strong>${linkedBatches.length}</strong>
          <span>cuvées liées</span>
        </div>
      </div>

      <h2 style="margin-top:18px">Ratios par litre de rhum</h2>

      <div class="list">
        ${
          ingredientRows.length
            ? ingredientRows
                .map((ingredient) => {
                  return `
                    <div class="itemCard">
                      <div class="itemTop">
                        <div>
                          <div class="itemTitle">
                            ${escapeHtml(ingredient.nom_ingredient || "Ingrédient")}
                          </div>

                          <div class="meta">
                            ${number(ingredient.quantite_par_litre_rhum, 2)}
                            ${escapeHtml(ingredient.unite || "")} / L
                            ${ingredient.note ? `· ${escapeHtml(ingredient.note)}` : ""}
                          </div>
                        </div>

                        <span class="badge">
                          ${escapeHtml(ingredient.categorie || "ingrédient")}
                        </span>
                      </div>
                    </div>
                  `;
                })
                .join("")
            : `<div class="empty">Aucun ingrédient saisi.</div>`
        }
      </div>

      <h2 style="margin-top:18px">Notes</h2>

      <div class="itemCard">
        <strong>Fabrication</strong>
        <p>${escapeHtml(recipe.fabrication_note || "—")}</p>

        <strong>Dégustation</strong>
        <p>${escapeHtml(recipe.degustation_note || "—")}</p>
      </div>

      <h2 style="margin-top:18px">Cuvées produites</h2>

      <div class="list">
        ${
          linkedBatches.length
            ? linkedBatches
                .map((batch) => {
                  return `
                    <div class="itemCard">
                      <div class="itemTop">
                        <div>
                          <div class="itemTitle">
                            ${escapeHtml(batch.nom || "Cuvée")}
                          </div>

                          <div class="meta">
                            ${escapeHtml(batch.statut || "—")}
                            · coût 50 cL ${
                              toNumber(batch.cout_unitaire_50_estime, 0) > 0
                                ? money(batch.cout_unitaire_50_estime)
                                : "—"
                            }
                          </div>
                        </div>
                      </div>
                    </div>
                  `;
                })
                .join("")
            : `<div class="empty">Aucune cuvée liée.</div>`
        }
      </div>

      <div class="actions">
        <a
          class="button"
          href="./recettes-production.html?recette_id=${encodeURIComponent(recipe.recette_id)}"
        >
          Utiliser comme base
        </a>

        <button class="secondary" id="duplicateRecipeBtn" type="button">
          Dupliquer en nouvelle version
        </button>
      </div>
    `;

    const duplicateButton = $("duplicateRecipeBtn");

    if (duplicateButton) {
      duplicateButton.addEventListener("click", () => duplicateRecipe(recipe, ingredientRows));
    }
  }

  async function duplicateRecipe(recipe, ingredientRows) {
    const currentYear = String(new Date().getFullYear());

    const copy = {
      ...recipe,
      recette_id: uid("REC"),
      recette_source_id: recipe.recette_id,
      version: `${recipe.version || "V"}-copie`,
      annee_reference: currentYear,
      statut: "brouillon",
      created_at: isoNow(),
      updated_at: isoNow()
    };

    const copiedIngredients = ingredientRows.map((ingredient) => {
      return {
        ...ingredient,
        recette_ingredient_id: uid("RI"),
        recette_id: copy.recette_id,
        created_at: isoNow(),
        updated_at: isoNow()
      };
    });

    setStatus("Duplication de la recette…", "isRefreshing");

    recipes = upsertInArray(recipes, "recette_id", copy);

    copiedIngredients.forEach((ingredient) => {
      recipeIngredients = upsertInArray(
        recipeIngredients,
        "recette_ingredient_id",
        ingredient
      );
    });

    saveCache();

    try {
      await apiBatchActions([
        {
          queue_id: uid("QUEUE_REC"),
          action: "upsertRecette",
          payload: {
            data: copy
          }
        },
        ...copiedIngredients.map((ingredient) => {
          return {
            queue_id: uid("QUEUE_RI"),
            action: "upsertRecetteIngredient",
            payload: {
              data: ingredient
            }
          };
        })
      ]);

      setStatus("Recette dupliquée", "isOnline");
    } catch (err) {
      console.warn("Duplication distante impossible, copie conservée en local.", err);
      setStatus("Copie conservée en local — synchro à refaire", "isLocal");
    }

    selectedId = copy.recette_id;
    fillYears();
    renderList();
    selectRecipe(copy.recette_id);
  }

  async function refreshFromApi() {
    if (!navigator.onLine) {
      hydrateFromCache();
      fillYears();
      renderList();
      setStatus("Hors ligne — données locales", "isLocal");
      return;
    }

    if (!window.LugdurumAPI) {
      hydrateFromCache();
      fillYears();
      renderList();
      setStatus("API indisponible — cache local", "isLocal");
      return;
    }

    setStatus("Chargement Google Sheets…", "isRefreshing");

    try {
      const fresh = await readCoreDataFromApi();

      recipes = asArray(fresh.recipes);
      recipeIngredients = asArray(fresh.recipeIngredients);
      batches = asArray(fresh.batches);

      saveCache();
      fillYears();
      renderList();

      setStatus("Historique Google Sheets à jour", "isOnline");
    } catch (err) {
      console.warn("Lecture Google Sheets impossible.", err);

      hydrateFromCache();
      fillYears();
      renderList();

      setStatus("Google Sheets indisponible — cache local", "isLocal");
    }
  }

  function bindEvents() {
    ["searchInput", "yearFilter", "statusFilter"].forEach((id) => {
      const el = $(id);

      if (!el) return;

      el.addEventListener("input", () => {
        selectedId = "";
        renderList();
      });

      el.addEventListener("change", () => {
        selectedId = "";
        renderList();
      });
    });

    window.addEventListener("online", () => {
      refreshFromApi();
    });

    window.addEventListener("offline", () => {
      hydrateFromCache();
      fillYears();
      renderList();
      setStatus("Hors ligne — données locales", "isLocal");
    });
  }

  function init() {
    bindEvents();

    if (navigator.onLine && window.LugdurumAPI) {
      setStatus("Chargement Google Sheets…", "isRefreshing");
      refreshFromApi();
      return;
    }

    hydrateFromCache();
    fillYears();
    renderList();

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