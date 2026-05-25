(() => {
  "use strict";

  /*
    Matières premières V4 — connecté Google Sheets via LugdurumAPI V16

    - Lecture remote-first via vue rapide recettes :
      getRecettesMatieresData()
      ou getRecettesData("matieres")

    - Fallback compatibilité :
      getCoreData("matieresPremieres,matieresLots,mouvementsMatieres,cuveesMatieresConsommees")
      puis list() si nécessaire.

    - Cache localStorage utilisé uniquement en secours :
      - hors ligne
      - API indisponible
      - erreur Google Sheets

    - Écriture :
      upsertMatierePremiere
      upsertMatiereLot
      upsertMouvementMatiere

    - Compatible offline/cache localStorage.
    - Ne dépend pas de données démo.
    - Les écritures passent par LugdurumAPI quand disponible.
  */

  const STORAGE_KEYS = {
    matters: "lugdurum_matieres_premieres",
    lots: "lugdurum_matieres_lots",
    movements: "lugdurum_mouvements_matieres",
    consumptions: "lugdurum_cuvees_matieres_consommees"
  };

  const CORE_TABLES =
    "matieresPremieres,matieresLots,mouvementsMatieres,cuveesMatieresConsommees";

  const TABLE_ALIASES = {
    matieresPremieres: ["matieresPremieres", "matieres_premieres", "matters"],
    matieresLots: ["matieresLots", "matieres_lots", "lots"],
    mouvementsMatieres: ["mouvementsMatieres", "mouvements_matieres", "movements"],
    cuveesMatieresConsommees: [
      "cuveesMatieresConsommees",
      "cuvees_matieres_consommees",
      "consumptions"
    ]
  };

  const ACTION_TABLE_MAP = {
    upsertMatierePremiere: ["matieresPremieres", "matieres_premieres"],
    upsertMatiereLot: ["matieresLots", "matieres_lots"],
    upsertMouvementMatiere: ["mouvementsMatieres", "mouvements_matieres"]
  };

  let matters = [];
  let lots = [];
  let movements = [];
  let consumptions = [];
  let selectedLotId = "";

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

  function normalizeText(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function normalizeCode(value) {
    return String(value ?? "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 42);
  }

  function normalizeStatus(value) {
    return normalizeText(value).replace(/\s+/g, "_");
  }

  function isArchived(item) {
    const status = normalizeStatus(item?.statut);

    return [
      "archive",
      "archivee",
      "inactif",
      "annule",
      "annulee"
    ].includes(status);
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

  function hydrateFromCache() {
    matters = readLocal(STORAGE_KEYS.matters, []);
    lots = readLocal(STORAGE_KEYS.lots, []);
    movements = readLocal(STORAGE_KEYS.movements, []);
    consumptions = readLocal(STORAGE_KEYS.consumptions, []);
  }

  function saveCache() {
    writeLocal(STORAGE_KEYS.matters, matters);
    writeLocal(STORAGE_KEYS.lots, lots);
    writeLocal(STORAGE_KEYS.movements, movements);
    writeLocal(STORAGE_KEYS.consumptions, consumptions);
  }

  function unwrapRemoteData(response) {
    if (!response) return {};

    if (response.data && typeof response.data === "object") {
      if (response.data.data && typeof response.data.data === "object") {
        return {
          ...response.data,
          ...response.data.data
        };
      }

      return response.data;
    }

    if (response.data === undefined && response.view && response.data !== null) {
      return response;
    }

    return response;
  }

  function getRowsFromRemoteData(remote, key) {
    const aliases = TABLE_ALIASES[key] || [key];
    const candidates = [
      remote,
      remote?.data
    ].filter(Boolean);

    for (const source of candidates) {
      for (const alias of aliases) {
        if (Array.isArray(source?.[alias])) {
          return source[alias];
        }
      }
    }

    return [];
  }

  async function readRecettesMatieresDataFromApi() {
    const api = window.LugdurumAPI;

    if (!api) {
      throw new Error("LugdurumAPI indisponible.");
    }

    if (typeof api.getRecettesMatieresData === "function") {
      const response = await api.getRecettesMatieresData({
        flushBeforeRead: false
      });

      const remote = unwrapRemoteData(response);

      return {
        matters: getRowsFromRemoteData(remote, "matieresPremieres"),
        lots: getRowsFromRemoteData(remote, "matieresLots"),
        movements: getRowsFromRemoteData(remote, "mouvementsMatieres"),
        consumptions: getRowsFromRemoteData(remote, "cuveesMatieresConsommees")
      };
    }

    if (typeof api.getRecettesData === "function") {
      const response = await api.getRecettesData("matieres", {
        flushBeforeRead: false
      });

      const remote = unwrapRemoteData(response);

      return {
        matters: getRowsFromRemoteData(remote, "matieresPremieres"),
        lots: getRowsFromRemoteData(remote, "matieresLots"),
        movements: getRowsFromRemoteData(remote, "mouvementsMatieres"),
        consumptions: getRowsFromRemoteData(remote, "cuveesMatieresConsommees")
      };
    }

    throw new Error("Vue rapide recettes indisponible.");
  }

  async function readCoreDataFromApi() {
    const api = window.LugdurumAPI;

    if (!api) {
      throw new Error("LugdurumAPI indisponible.");
    }

    if (typeof api.getCoreData === "function") {
      const response = await api.getCoreData(CORE_TABLES);
      const remote = unwrapRemoteData(response);

      return {
        matters: getRowsFromRemoteData(remote, "matieresPremieres"),
        lots: getRowsFromRemoteData(remote, "matieresLots"),
        movements: getRowsFromRemoteData(remote, "mouvementsMatieres"),
        consumptions: getRowsFromRemoteData(remote, "cuveesMatieresConsommees")
      };
    }

    if (typeof api.list === "function") {
      const [
        matterRows,
        lotRows,
        movementRows,
        consumptionRows
      ] = await Promise.all([
        readTableWithListApi("matieresPremieres"),
        readTableWithListApi("matieresLots"),
        readTableWithListApi("mouvementsMatieres"),
        readTableWithListApi("cuveesMatieresConsommees")
      ]);

      return {
        matters: matterRows,
        lots: lotRows,
        movements: movementRows,
        consumptions: consumptionRows
      };
    }

    throw new Error("Aucune méthode de lecture compatible dans LugdurumAPI.");
  }

  async function readDataFromApi() {
    try {
      return await readRecettesMatieresDataFromApi();
    } catch (viewErr) {
      console.warn(
        "Lecture getRecettesData(matieres) impossible, fallback getCoreData/list.",
        viewErr
      );

      return readCoreDataFromApi();
    }
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

  function getRemainingValue(lot) {
    return toNumber(lot?.quantite_restante, 0) * getUnitCost(lot);
  }

  function getMatterForLot(lot) {
    const matterId = String(lot?.matiere_id || "").trim();

    return matters.find((item) => String(item?.matiere_id || "") === matterId) || null;
  }

  function getMatterNameForLot(lot) {
    const matter = getMatterForLot(lot);

    return (
      matter?.nom ||
      lot?.nom_matiere ||
      lot?.nom_lot ||
      "Matière première"
    );
  }

  function cleanMatterNameFromLotName(lotName, category) {
    const beforeDash = String(lotName || "")
      .split("—")[0]
      .split(" - ")[0]
      .trim();

    const cleaned = beforeDash
      .replace(/\b\d+([,.]\d+)?\s*(l|kg|g|cl|ml|unités?|unites?|u)\b/gi, "")
      .replace(/\bpalette\b/gi, "")
      .replace(/\bcarton\b/gi, "")
      .replace(/\bachat\b/gi, "")
      .replace(/\b20\d{2}\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned) return cleaned;

    const labels = {
      rhum: "Rhum",
      bouteille: "Bouteilles",
      bouchon: "Bouchons",
      etiquette: "Étiquettes",
      coffret: "Coffrets",
      carton: "Cartons",
      sucre: "Sucre",
      consommable: "Consommable",
      autre: "Autre matière"
    };

    return labels[category] || "Matière première";
  }

  function findExistingMatter(category, lotName) {
    const cleanName = normalizeText(cleanMatterNameFromLotName(lotName, category));

    return (
      matters.find((matter) => {
        const sameCategory = normalizeText(matter?.categorie) === normalizeText(category);
        const matterName = normalizeText(matter?.nom);

        return (
          sameCategory &&
          matterName &&
          (cleanName.includes(matterName) || matterName.includes(cleanName))
        );
      }) || null
    );
  }

  function buildMatterFromLotForm(lotName, category, unit) {
    const existing = findExistingMatter(category, lotName);

    if (existing) {
      return {
        ...existing,
        categorie: existing.categorie || category,
        unite_stock: existing.unite_stock || unit || "unité",
        actif: existing.actif || "TRUE",
        updated_at: isoNow()
      };
    }

    const name = cleanMatterNameFromLotName(lotName, category);

    return {
      matiere_id: `MAT_${normalizeCode(category || "AUTRE")}_${normalizeCode(name)}`,
      nom: name,
      categorie: category || "autre",
      unite_stock: unit || "unité",
      actif: "TRUE",
      note: "",
      created_at: isoNow(),
      updated_at: isoNow()
    };
  }

  function buildInitialMovement(lot, matter) {
    const unitCost = getUnitCost(lot);

    return {
      mouvement_matiere_id: uid("MMAT"),
      lot_id: lot.lot_id,
      matiere_id: lot.matiere_id,
      type_mouvement: "achat",
      source_type: "achat_lot",
      source_id: lot.lot_id,
      date_mouvement: lot.date_achat || todayIso(),
      nom_matiere: matter?.nom || lot.nom_lot || "",
      categorie: lot.categorie || matter?.categorie || "",
      quantite: toNumber(lot.quantite_initiale, 0),
      unite: lot.unite || matter?.unite_stock || "unité",
      cout_unitaire_snapshot: roundAmount(unitCost),
      cout_total_snapshot: roundAmount(toNumber(lot.cout_total, 0)),
      note: `Entrée initiale du lot ${lot.nom_lot || lot.lot_id}`,
      created_at: isoNow(),
      updated_at: isoNow()
    };
  }

  function filteredLots() {
    const searchValue = normalizeText($("searchInput")?.value || "");
    const categoryValue = String($("categoryFilter")?.value || "").trim();

    return lots
      .filter((lot) => {
        const matter = getMatterForLot(lot);

        const haystack = normalizeText(
          [
            lot.nom_lot,
            lot.nom_matiere,
            lot.categorie,
            lot.fournisseur,
            lot.note,
            matter?.nom,
            matter?.categorie
          ].join(" ")
        );

        const matchesSearch = !searchValue || haystack.includes(searchValue);
        const matchesCategory = !categoryValue || lot.categorie === categoryValue;

        return matchesSearch && matchesCategory;
      })
      .sort((a, b) => {
        const statusSort = Number(isArchived(a)) - Number(isArchived(b));

        if (statusSort !== 0) return statusSort;

        return String(b.date_achat || b.created_at || "").localeCompare(
          String(a.date_achat || a.created_at || "")
        );
      });
  }

  function render() {
    renderStats();
    renderLots();

    if (selectedLotId) {
      renderLotDetail(selectedLotId);
    } else {
      renderEmptyDetail();
    }
  }

  function renderStats() {
    const activeLots = lots.filter((lot) => !isArchived(lot));

    const totalValue = activeLots.reduce((sum, lot) => {
      return sum + getRemainingValue(lot);
    }, 0);

    const lowLots = activeLots.filter((lot) => {
      const initial = toNumber(lot.quantite_initiale, 0);
      const remaining = toNumber(lot.quantite_restante, 0);

      if (!initial) return false;

      return remaining / initial <= 0.25;
    });

    const averageUnit =
      activeLots.length > 0
        ? activeLots.reduce((sum, lot) => sum + getUnitCost(lot), 0) / activeLots.length
        : 0;

    setText("activeLots", String(activeLots.length));
    setText("totalValue", money(totalValue));
    setText("lowLots", String(lowLots.length));
    setText("avgUnit", money(averageUnit));
  }

  function renderLots() {
    const list = $("lotsList");
    if (!list) return;

    const rows = filteredLots();

    if (rows.length === 0) {
      list.innerHTML = `<div class="empty">Aucun lot trouvé.</div>`;
      return;
    }

    list.innerHTML = rows
      .map((lot) => {
        const initial = toNumber(lot.quantite_initiale, 0);
        const remaining = toNumber(lot.quantite_restante, 0);
        const ratio = initial ? remaining / initial : 0;
        const ratioPct = initial ? Math.round(ratio * 100) : 0;
        const badgeClass = isArchived(lot)
          ? ""
          : ratio <= 0.25
            ? "warning"
            : ratio > 0.5
              ? "success"
              : "";

        const selectedClass =
          String(lot.lot_id || "") === selectedLotId ? " isSelected" : "";

        return `
          <button
            type="button"
            class="itemCard${selectedClass}"
            data-lot-id="${escapeHtml(lot.lot_id)}"
          >
            <div class="itemTop">
              <div>
                <div class="itemTitle">${escapeHtml(lot.nom_lot || "Lot sans nom")}</div>
                <div class="meta">
                  ${escapeHtml(getMatterNameForLot(lot))}
                  · ${escapeHtml(lot.fournisseur || "fournisseur inconnu")}
                  · ${escapeHtml(lot.date_achat || "date inconnue")}
                </div>
              </div>
              <span class="badge ${badgeClass}">
                ${escapeHtml(isArchived(lot) ? "archivé" : lot.categorie || "autre")}
              </span>
            </div>

            <div class="stats">
              <div class="stat">
                <strong>${number(remaining, 2)} ${escapeHtml(lot.unite || "")}</strong>
                <span>restant · ${ratioPct}%</span>
              </div>

              <div class="stat">
                <strong>${money(getUnitCost(lot))}</strong>
                <span>coût unitaire</span>
              </div>
            </div>
          </button>
        `;
      })
      .join("");

    list.querySelectorAll("[data-lot-id]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedLotId = button.dataset.lotId || "";
        render();
      });
    });

    if (!selectedLotId && rows[0]) {
      selectedLotId = rows[0].lot_id;
      renderLotDetail(selectedLotId);
    }
  }

  function renderEmptyDetail() {
    const detail = $("lotDetail");

    if (!detail) return;

    detail.className = "empty";
    detail.innerHTML =
      "Sélectionne un lot pour voir le coût unitaire, le restant et les consommations.";
  }

  function renderLotDetail(id) {
    const detail = $("lotDetail");

    if (!detail) return;

    const lot = lots.find((item) => String(item.lot_id || "") === String(id || ""));

    if (!lot) {
      renderEmptyDetail();
      return;
    }

    const initial = toNumber(lot.quantite_initiale, 0);
    const remaining = toNumber(lot.quantite_restante, 0);
    const ratioPct = initial ? Math.round((remaining / initial) * 100) : 0;
    const unitCost = getUnitCost(lot);
    const matter = getMatterForLot(lot);

    const linkedConsumptions = consumptions.filter((item) => {
      return String(item.lot_id || "") === String(lot.lot_id || "");
    });

    const linkedMovements = movements
      .filter((item) => String(item.lot_id || "") === String(lot.lot_id || ""))
      .sort((a, b) => {
        return String(b.date_mouvement || b.created_at || "").localeCompare(
          String(a.date_mouvement || a.created_at || "")
        );
      });

    detail.className = "";
    detail.innerHTML = `
      <article>
        <div class="itemTop">
          <div>
            <h2>${escapeHtml(lot.nom_lot || "Lot sans nom")}</h2>
            <p class="meta">
              ${escapeHtml(matter?.nom || lot.nom_matiere || "Matière non liée")}
              · ${escapeHtml(lot.categorie || "autre")}
              · ${escapeHtml(lot.fournisseur || "fournisseur inconnu")}
              · ${escapeHtml(lot.date_achat || "date inconnue")}
            </p>
          </div>

          <span class="badge ${ratioPct <= 25 && !isArchived(lot) ? "warning" : "success"}">
            ${escapeHtml(isArchived(lot) ? "archivé" : `${ratioPct}% restant`)}
          </span>
        </div>

        <div class="stats">
          <div class="stat">
            <strong>${number(initial, 2)} ${escapeHtml(lot.unite || "")}</strong>
            <span>quantité initiale</span>
          </div>

          <div class="stat">
            <strong>${number(remaining, 2)} ${escapeHtml(lot.unite || "")}</strong>
            <span>quantité restante</span>
          </div>

          <div class="stat">
            <strong>${money(lot.cout_total)}</strong>
            <span>coût achat</span>
          </div>

          <div class="stat">
            <strong>${money(unitCost)}</strong>
            <span>coût unitaire</span>
          </div>
        </div>

        ${lot.facture_reference ? `
          <p class="meta">
            Facture : ${escapeHtml(lot.facture_reference)}
          </p>
        ` : ""}

        ${lot.note ? `
          <p>${escapeHtml(lot.note)}</p>
        ` : ""}

        <h2 style="margin-top:18px">Consommations liées</h2>

        <div class="list">
          ${
            linkedConsumptions.length
              ? linkedConsumptions
                  .map((item) => {
                    return `
                      <div class="itemCard">
                        <div class="itemTop">
                          <div>
                            <div class="itemTitle">
                              ${escapeHtml(item.nom_matiere || matter?.nom || lot.nom_lot)}
                            </div>
                            <div class="meta">
                              Cuvée ${escapeHtml(item.cuvee_id || "—")}
                              · ${number(item.quantite_consommee, 2)}
                              ${escapeHtml(item.unite || lot.unite || "")}
                            </div>
                          </div>
                          <span class="badge">${money(item.cout_total_impute)}</span>
                        </div>
                      </div>
                    `;
                  })
                  .join("")
              : `<div class="empty">Aucune consommation enregistrée pour ce lot.</div>`
          }
        </div>

        <h2 style="margin-top:18px">Mouvements matière</h2>

        <div class="list">
          ${
            linkedMovements.length
              ? linkedMovements
                  .map((item) => {
                    return `
                      <div class="itemCard">
                        <div class="itemTop">
                          <div>
                            <div class="itemTitle">
                              ${escapeHtml(item.type_mouvement || "mouvement")}
                            </div>
                            <div class="meta">
                              ${escapeHtml(item.date_mouvement || item.created_at || "—")}
                              · ${number(item.quantite, 2)}
                              ${escapeHtml(item.unite || lot.unite || "")}
                            </div>
                          </div>
                          <span class="badge">${money(item.cout_total_snapshot)}</span>
                        </div>
                      </div>
                    `;
                  })
                  .join("")
              : `<div class="empty">Aucun mouvement enregistré pour ce lot.</div>`
          }
        </div>

        <div class="actions">
          <button
            type="button"
            class="secondary"
            id="archiveLotBtn"
            ${isArchived(lot) ? "disabled" : ""}
          >
            Archiver le lot
          </button>
        </div>
      </article>
    `;

    const archiveButton = $("archiveLotBtn");

    if (archiveButton) {
      archiveButton.addEventListener("click", () => archiveLot(lot));
    }
  }

  async function saveLot(event) {
    event.preventDefault();

    const name = $("lotName")?.value.trim() || "";
    const category = $("lotCategory")?.value || "autre";
    const supplier = $("supplier")?.value.trim() || "";
    const buyDate = $("buyDate")?.value || todayIso();
    const quantity = toNumber($("qtyInitial")?.value, 0);
    const unit = $("unit")?.value.trim() || "unité";
    const totalCost = toNumber($("costTotal")?.value, 0);
    const invoiceRef = $("invoiceRef")?.value.trim() || "";
    const note = $("lotNote")?.value.trim() || "";

    if (!name || quantity <= 0) {
      alert("Nom du lot et quantité initiale sont obligatoires.");
      return;
    }

    const matter = buildMatterFromLotForm(name, category, unit);
    const unitCost = quantity ? totalCost / quantity : 0;

    const lot = {
      lot_id: uid("LOT"),
      matiere_id: matter.matiere_id,
      nom_lot: name,
      nom_matiere: matter.nom,
      categorie: category,
      fournisseur: supplier,
      date_achat: buyDate,
      quantite_initiale: quantity,
      quantite_restante: quantity,
      unite: unit,
      cout_total: roundAmount(totalCost),
      cout_unitaire: roundAmount(unitCost),
      statut: "actif",
      facture_reference: invoiceRef,
      note,
      created_at: isoNow(),
      updated_at: isoNow()
    };

    const movement = buildInitialMovement(lot, matter);

    setStatus("Enregistrement du lot…", "isRefreshing");

    matters = upsertInArray(matters, "matiere_id", matter);
    lots = upsertInArray(lots, "lot_id", lot);
    movements = upsertInArray(movements, "mouvement_matiere_id", movement);
    saveCache();

    try {
      await apiBatchActions([
        {
          queue_id: uid("QUEUE_MAT"),
          action: "upsertMatierePremiere",
          payload: {
            data: matter
          }
        },
        {
          queue_id: uid("QUEUE_LOT"),
          action: "upsertMatiereLot",
          payload: {
            data: lot
          }
        },
        {
          queue_id: uid("QUEUE_MVT"),
          action: "upsertMouvementMatiere",
          payload: {
            data: movement
          }
        }
      ]);

      setStatus("Lot enregistré", "isOnline");
    } catch (err) {
      console.warn("Écriture distante impossible, données conservées en local.", err);
      setStatus("Lot conservé en local — synchro à refaire", "isLocal");
    }

    selectedLotId = lot.lot_id;

    if (event.target && typeof event.target.reset === "function") {
      event.target.reset();
    }

    const buyDateInput = $("buyDate");
    if (buyDateInput) buyDateInput.value = todayIso();

    render();
  }

  async function archiveLot(lot) {
    if (!lot || !lot.lot_id) return;

    const confirmed = confirm("Archiver ce lot ? Il restera consultable dans l’historique.");

    if (!confirmed) return;

    const updatedLot = {
      ...lot,
      statut: "archivee",
      updated_at: isoNow()
    };

    setStatus("Archivage du lot…", "isRefreshing");

    lots = upsertInArray(lots, "lot_id", updatedLot);
    saveCache();
    render();

    try {
      await apiPost("upsertMatiereLot", {
        data: updatedLot
      });

      setStatus("Lot archivé", "isOnline");
    } catch (err) {
      console.warn("Archivage distant impossible, modification conservée en local.", err);
      setStatus("Archivage local — synchro à refaire", "isLocal");
    }
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
      const fresh = await readDataFromApi();

      matters = asArray(fresh.matters);
      lots = asArray(fresh.lots);
      movements = asArray(fresh.movements);
      consumptions = asArray(fresh.consumptions);

      saveCache();

      if (
        selectedLotId &&
        !lots.some((lot) => String(lot.lot_id) === String(selectedLotId))
      ) {
        selectedLotId = "";
      }

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
    const searchInput = $("searchInput");
    const categoryFilter = $("categoryFilter");
    const lotForm = $("lotForm");
    const buyDateInput = $("buyDate");

    if (buyDateInput && !buyDateInput.value) {
      buyDateInput.value = todayIso();
    }

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        selectedLotId = "";
        render();
      });
    }

    if (categoryFilter) {
      categoryFilter.addEventListener("input", () => {
        selectedLotId = "";
        render();
      });

      categoryFilter.addEventListener("change", () => {
        selectedLotId = "";
        render();
      });
    }

    if (lotForm) {
      lotForm.addEventListener("submit", saveLot);
    }

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