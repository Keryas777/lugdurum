(() => {
  "use strict";

  /*
    Dashboard recettes V2 — connecté Google Sheets via LugdurumAPI

    - Lecture remote-first via getCoreData :
      recettes, cuvees, matieresLots

    - Cache localStorage utilisé uniquement en secours :
      - hors ligne
      - API indisponible
      - erreur Google Sheets

    - Aucune donnée démo.
    - Page lecture seule.
  */

  const STORAGE_KEYS = {
    recipes: "lugdurum_recettes",
    batches: "lugdurum_cuvees",
    lots: "lugdurum_matieres_lots"
  };

  const CORE_TABLES = "recettes,cuvees,matieresLots";

  const TABLE_ALIASES = {
    recettes: ["recettes"],
    cuvees: ["cuvees"],
    matieresLots: ["matieresLots", "matieres_lots"]
  };

  let data = {
    recipes: [],
    batches: [],
    lots: []
  };

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

  function byDateDesc(a, b) {
    return String(b.updated_at || b.created_at || "").localeCompare(
      String(a.updated_at || a.created_at || "")
    );
  }

  function hydrateFromCache() {
    data = {
      recipes: readLocal(STORAGE_KEYS.recipes, []),
      batches: readLocal(STORAGE_KEYS.batches, []),
      lots: readLocal(STORAGE_KEYS.lots, [])
    };
  }

  function saveCache() {
    writeLocal(STORAGE_KEYS.recipes, data.recipes);
    writeLocal(STORAGE_KEYS.batches, data.batches);
    writeLocal(STORAGE_KEYS.lots, data.lots);
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
      if (Array.isArray(core?.[alias])) {
        return core[alias];
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
        batches: getRowsFromCoreData(core, "cuvees"),
        lots: getRowsFromCoreData(core, "matieresLots")
      };
    }

    if (typeof api.list === "function") {
      const [recipes, batches, lots] = await Promise.all([
        readTableWithListApi("recettes"),
        readTableWithListApi("cuvees"),
        readTableWithListApi("matieresLots")
      ]);

      return {
        recipes,
        batches,
        lots
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

  function isArchivedBatch(batch) {
    const status = normalizeStatus(batch?.statut);

    return [
      "archive",
      "archivee",
      "termine",
      "terminee",
      "cloture",
      "cloturee"
    ].includes(status);
  }

  function isActiveOrTrackedBatch(batch) {
    const status = normalizeStatus(batch?.statut);

    return [
      "brouillon",
      "en_preparation",
      "en_maceration",
      "en_cours",
      "active",
      "actif",
      "archive",
      "archivee",
      "termine",
      "terminee",
      "cloture",
      "cloturee"
    ].includes(status);
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

  function getAlerts(lots) {
    return asArray(lots)
      .filter((lot) => {
        if (isArchivedLot(lot)) return false;

        const initial = toNumber(lot.quantite_initiale, 0);
        const remaining = toNumber(lot.quantite_restante, 0);

        if (!initial) return false;

        return remaining / initial <= 0.25;
      })
      .sort((a, b) => {
        const ratioA =
          toNumber(a.quantite_restante, 0) /
          Math.max(1, toNumber(a.quantite_initiale, 0));

        const ratioB =
          toNumber(b.quantite_restante, 0) /
          Math.max(1, toNumber(b.quantite_initiale, 0));

        return ratioA - ratioB;
      });
  }

  function getAverageBatchCost(batches) {
    const costs = asArray(batches)
      .map((batch) => toNumber(batch.cout_unitaire_50_estime, 0))
      .filter((value) => value > 0);

    if (costs.length === 0) return null;

    return costs.reduce((sum, value) => sum + value, 0) / costs.length;
  }

  function render() {
    const recipes = asArray(data.recipes);
    const batches = asArray(data.batches);
    const lots = asArray(data.lots);

    const trackedBatches = batches.filter(isActiveOrTrackedBatch);
    const alerts = getAlerts(lots);
    const averageCost = getAverageBatchCost(trackedBatches);

    setText("statRecipes", String(recipes.length));
    setText("statBatches", String(trackedBatches.length));
    setText("statAvgCost", averageCost === null ? "—" : money(averageCost));
    setText("statAlerts", String(alerts.length));

    renderLatestBatches(trackedBatches);
    renderAlerts(alerts);
  }

  function renderLatestBatches(batches) {
    const el = $("latestBatches");

    if (!el) return;

    const rows = [...asArray(batches)].sort(byDateDesc).slice(0, 4);

    if (rows.length === 0) {
      el.innerHTML = `<div class="empty">Aucune cuvée pour le moment.</div>`;
      return;
    }

    el.innerHTML = rows
      .map((batch) => {
        const status = normalizeStatus(batch.statut);
        const badgeClass = isArchivedBatch(batch)
          ? "success"
          : status.includes("maceration") || status.includes("preparation")
            ? "warning"
            : "";

        return `
          <article class="itemCard">
            <div class="itemTop">
              <div>
                <div class="itemTitle">
                  ${escapeHtml(batch.nom || "Cuvée sans nom")}
                </div>

                <div class="meta">
                  ${escapeHtml(batch.parfum_nom || batch.parfum_code || "—")}
                  · ${escapeHtml(batch.annee_production || "—")}
                  · ${number(batch.volume_rhum_l, 1)} L rhum
                </div>
              </div>

              <span class="badge ${badgeClass}">
                ${escapeHtml(batch.statut || "brouillon")}
              </span>
            </div>

            <div class="stats">
              <div class="stat">
                <strong>${money(batch.cout_total)}</strong>
                <span>coût total</span>
              </div>

              <div class="stat">
                <strong>
                  ${
                    toNumber(batch.cout_unitaire_50_estime, 0) > 0
                      ? money(batch.cout_unitaire_50_estime)
                      : "—"
                  }
                </strong>
                <span>/ 50 cL</span>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderAlerts(alerts) {
    const el = $("matterAlerts");

    if (!el) return;

    const rows = asArray(alerts).slice(0, 5);

    if (rows.length === 0) {
      el.innerHTML = `<div class="empty">Aucune alerte matière.</div>`;
      return;
    }

    el.innerHTML = rows
      .map((lot) => {
        return `
          <article class="itemCard">
            <div class="itemTop">
              <div>
                <div class="itemTitle">
                  ${escapeHtml(lot.nom_lot || lot.nom_matiere || lot.nom || "Lot")}
                </div>

                <div class="meta">
                  Restant :
                  ${number(lot.quantite_restante, 2)}
                  ${escapeHtml(lot.unite || "")}
                  /
                  ${number(lot.quantite_initiale, 2)}
                  ${escapeHtml(lot.unite || "")}
                </div>
              </div>

              <span class="badge warning">À surveiller</span>
            </div>

            <div class="meta">
              Coût unitaire : ${money(getUnitCost(lot))}
            </div>
          </article>
        `;
      })
      .join("");
  }

  async function refreshFromApi() {
    if (!navigator.onLine) {
      hydrateFromCache();
      render();
      setStatus("Hors ligne — données locales", "isLocal");
      return;
    }

    if (!window.LugdurumAPI) {
      hydrateFromCache();
      render();
      setStatus("API indisponible — cache local", "isLocal");
      return;
    }

    setStatus("Chargement Google Sheets…", "isRefreshing");

    try {
      const fresh = await readCoreDataFromApi();

      data = {
        recipes: asArray(fresh.recipes),
        batches: asArray(fresh.batches),
        lots: asArray(fresh.lots)
      };

      saveCache();
      render();

      setStatus("Données Google Sheets à jour", "isOnline");
    } catch (err) {
      console.warn("Lecture Google Sheets impossible.", err);

      hydrateFromCache();
      render();

      setStatus("Google Sheets indisponible — cache local", "isLocal");
    }
  }

  function bindEvents() {
    window.addEventListener("online", () => {
      refreshFromApi();
    });

    window.addEventListener("offline", () => {
      hydrateFromCache();
      render();
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
    render();

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