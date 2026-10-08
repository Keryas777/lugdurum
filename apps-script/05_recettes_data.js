/************************************************************
 * 05_recettes_datas.gs
 * ----------------------------------------------------------
 * Lectures rapides pour le module Recettes / Cuvées / Matières.
 *
 * Objectif :
 * - éviter d’appeler getCoreData() complet depuis les pages recettes ;
 * - fournir une action unique getRecettesData(view) ;
 * - charger seulement les onglets utiles selon la vue demandée ;
 * - rester compatible avec le frontend V16 :
 *   LugdurumAPI.getRecettesData(view)
 *   LugdurumAPI.getRecettesDashboardData()
 *   LugdurumAPI.getRecettesHistoriqueData()
 *   LugdurumAPI.getRecettesProductionData()
 *   LugdurumAPI.getRecettesMatieresData()
 *
 * Vues supportées :
 * - dashboard
 * - historique
 * - production
 * - matieres
 *
 * Onglets concernés :
 * - recettes
 * - recettes_ingredients
 * - ingredients
 * - cuvees
 * - cuvees_ingredients_reels
 * - matieres_premieres
 * - matieres_lots
 ************************************************************/

var RECETTES_DATA_VERSION = "V16_RECETTES_DATA_VIEWS_SPLIT";

var RECETTES_DATA_DEFAULT_VIEW = "dashboard";

var RECETTES_DATA_VIEW_TABLES = {
  dashboard: [
    "recettes",
    "recettesIngredients",
    "ingredients",
    "cuvees",
    "cuveesIngredientsReels",
    "matieresPremieres",
    "matieresLots"
  ],

  historique: [
    "recettes",
    "recettesIngredients",
    "cuvees",
    "cuveesIngredientsReels"
  ],

  production: [
    "recettes",
    "recettesIngredients",
    "ingredients",
    "cuvees",
    "cuveesIngredientsReels",
    "matieresPremieres",
    "matieresLots"
  ],

  matieres: [
    "ingredients",
    "matieresPremieres",
    "matieresLots",
    "cuveesIngredientsReels"
  ]
};

var RECETTES_DATA_SHEET_FALLBACKS = {
  recettes: "recettes",
  recettesIngredients: "recettes_ingredients",
  ingredients: "ingredients",
  cuvees: "cuvees",
  cuveesIngredientsReels: "cuvees_ingredients_reels",
  matieresPremieres: "matieres_premieres",
  matieresLots: "matieres_lots"
};

var RECETTES_DATA_ALIASES = {
  recettes: ["recettes"],
  recettesIngredients: ["recettesIngredients", "recettes_ingredients"],
  ingredients: ["ingredients"],
  cuvees: ["cuvees"],
  cuveesIngredientsReels: [
    "cuveesIngredientsReels",
    "cuvees_ingredients_reels"
  ],
  matieresPremieres: [
    "matieresPremieres",
    "matieres_premieres"
  ],
  matieresLots: [
    "matieresLots",
    "matieres_lots"
  ]
};

/**
 * Action GET principale.
 *
 * Exemples côté routeur :
 *   getRecettesData("dashboard")
 *   getRecettesData(e.parameter.view)
 *   getRecettesData({ view: "production" })
 */
function getRecettesData(view, options) {
  var startedAt = Date.now();
  var safeView = recettesDataNormalizeView_(view);
  var tableKeys = RECETTES_DATA_VIEW_TABLES[safeView];

  var tables = recettesDataReadTables_(tableKeys);
  var payload = recettesDataBuildPayload_(safeView, tables, startedAt);

  return payload;
}

function getRecettesDashboardData() {
  return getRecettesData("dashboard");
}

function getRecettesHistoriqueData() {
  return getRecettesData("historique");
}

function getRecettesProductionData() {
  return getRecettesData("production");
}

function getRecettesMatieresData() {
  return getRecettesData("matieres");
}

/**
 * Petit helper optionnel si le routeur préfère passer tout l’objet params.
 */
function handleGetRecettesData(params) {
  params = params || {};

  return getRecettesData(
    params.view ||
    params.vue ||
    params.mode ||
    params.type ||
    RECETTES_DATA_DEFAULT_VIEW
  );
}

/* ==========================================================
   Construction payload
   ========================================================== */

function recettesDataBuildPayload_(view, tables, startedAt) {
  var rawCounts = recettesDataBuildRawCounts_(tables);
  var payload = {
    version: RECETTES_DATA_VERSION,
    view: view,
    generated_at: recettesDataNowIso_(),
    duration_ms: Date.now() - startedAt,
    tables_loaded: Object.keys(tables),
    rawCounts: rawCounts,
    raw_counts: rawCounts
  };

  recettesDataAttachTableAliases_(payload, tables);

  if (view === "dashboard") {
    payload.dashboard = recettesDataBuildDashboardView_(tables);
  }

  if (view === "historique") {
    payload.historique = recettesDataBuildHistoriqueView_(tables);
  }

  if (view === "production") {
    payload.production = recettesDataBuildProductionView_(tables);
  }

  if (view === "matieres") {
    payload.matieres = recettesDataBuildMatieresView_(tables);
  }

  return payload;
}

function recettesDataAttachTableAliases_(payload, tables) {
  Object.keys(RECETTES_DATA_ALIASES).forEach(function(logicalKey) {
    var aliases = RECETTES_DATA_ALIASES[logicalKey];
    var rows = tables[logicalKey] || [];

    aliases.forEach(function(alias) {
      payload[alias] = rows;
    });
  });
}

function recettesDataBuildRawCounts_(tables) {
  return {
    recettes: recettesDataArray_(tables.recettes).length,
    recettesIngredients: recettesDataArray_(tables.recettesIngredients).length,
    recettes_ingredients: recettesDataArray_(tables.recettesIngredients).length,
    ingredients: recettesDataArray_(tables.ingredients).length,
    cuvees: recettesDataArray_(tables.cuvees).length,
    cuveesIngredientsReels: recettesDataArray_(tables.cuveesIngredientsReels).length,
    cuvees_ingredients_reels: recettesDataArray_(tables.cuveesIngredientsReels).length,
    matieresPremieres: recettesDataArray_(tables.matieresPremieres).length,
    matieres_premieres: recettesDataArray_(tables.matieresPremieres).length,
    matieresLots: recettesDataArray_(tables.matieresLots).length,
    matieres_lots: recettesDataArray_(tables.matieresLots).length
  };
}

/* ==========================================================
   Vues métier
   ========================================================== */

function recettesDataBuildDashboardView_(tables) {
  var recettes = recettesDataArray_(tables.recettes);
  var cuvees = recettesDataArray_(tables.cuvees);
  var matieresPremieres = recettesDataArray_(tables.matieresPremieres);
  var matieresLots = recettesDataArray_(tables.matieresLots);

  var recettesActives = recettes.filter(recettesDataIsActiveRow_);
  var cuveesOuvertes = cuvees.filter(recettesDataIsOpenProductionRow_);
  var cuveesRecentes = recettesDataSortByRecentDate_(cuvees).slice(0, 8);
  var matieresAlertes = recettesDataBuildMatieresAlertes_(
    matieresPremieres,
    matieresLots
  );

  return {
    resume: {
      recettes_total: recettes.length,
      recettes_actives: recettesActives.length,
      cuvees_total: cuvees.length,
      cuvees_ouvertes: cuveesOuvertes.length,
      matieres_premieres_total: matieresPremieres.length,
      lots_matieres_total: matieresLots.length,
      alertes_matieres: matieresAlertes.length
    },

    recettes_actives: recettesActives,
    cuvees_ouvertes: cuveesOuvertes,
    cuvees_recentes: cuveesRecentes,
    matieres_alertes: matieresAlertes,

    next_actions: recettesDataBuildDashboardNextActions_({
      recettesActives: recettesActives,
      cuveesOuvertes: cuveesOuvertes,
      matieresAlertes: matieresAlertes
    })
  };
}

function recettesDataBuildHistoriqueView_(tables) {
  var recettes = recettesDataArray_(tables.recettes);
  var recettesIngredients = recettesDataArray_(tables.recettesIngredients);
  var cuvees = recettesDataArray_(tables.cuvees);
  var cuveesIngredientsReels = recettesDataArray_(tables.cuveesIngredientsReels);

  return {
    recettes: recettesDataSortByNameOrOrder_(recettes),
    recettes_ingredients: recettesIngredients,
    recettesIngredients: recettesIngredients,
    cuvees: recettesDataSortByRecentDate_(cuvees),
    cuvees_ingredients_reels: cuveesIngredientsReels,
    cuveesIngredientsReels: cuveesIngredientsReels,

    resume: {
      recettes_total: recettes.length,
      recettes_actives: recettes.filter(recettesDataIsActiveRow_).length,
      cuvees_total: cuvees.length,
      cuvees_cloturees: cuvees.filter(recettesDataIsClosedRow_).length,
      lignes_ingredients_theoriques: recettesIngredients.length,
      lignes_ingredients_reelles: cuveesIngredientsReels.length
    }
  };
}

function recettesDataBuildProductionView_(tables) {
  var recettes = recettesDataArray_(tables.recettes);
  var recettesIngredients = recettesDataArray_(tables.recettesIngredients);
  var ingredients = recettesDataArray_(tables.ingredients);
  var cuvees = recettesDataArray_(tables.cuvees);
  var cuveesIngredientsReels = recettesDataArray_(tables.cuveesIngredientsReels);
  var matieresPremieres = recettesDataArray_(tables.matieresPremieres);
  var matieresLots = recettesDataArray_(tables.matieresLots);

  var recettesActives = recettes
    .filter(recettesDataIsActiveRow_)
    .sort(recettesDataSortByOrderThenName_);

  var cuveesOuvertes = cuvees
    .filter(recettesDataIsOpenProductionRow_)
    .sort(recettesDataSortByDateAsc_);

  return {
    recettes: recettesActives,
    recettes_ingredients: recettesIngredients,
    recettesIngredients: recettesIngredients,
    ingredients: recettesDataSortByNameOrOrder_(ingredients),
    cuvees: cuveesOuvertes,
    cuvees_ingredients_reels: cuveesIngredientsReels,
    cuveesIngredientsReels: cuveesIngredientsReels,
    matieres_premieres: matieresPremieres,
    matieresPremieres: matieresPremieres,
    matieres_lots: matieresLots,
    matieresLots: matieresLots,

    resume: {
      recettes_actives: recettesActives.length,
      cuvees_ouvertes: cuveesOuvertes.length,
      ingredients_total: ingredients.length,
      matieres_premieres_total: matieresPremieres.length,
      lots_matieres_total: matieresLots.length,
      lignes_ingredients_theoriques: recettesIngredients.length,
      lignes_ingredients_reelles: cuveesIngredientsReels.length
    }
  };
}

function recettesDataBuildMatieresView_(tables) {
  var ingredients = recettesDataArray_(tables.ingredients);
  var matieresPremieres = recettesDataArray_(tables.matieresPremieres);
  var matieresLots = recettesDataArray_(tables.matieresLots);
  var cuveesIngredientsReels = recettesDataArray_(tables.cuveesIngredientsReels);

  var alertes = recettesDataBuildMatieresAlertes_(
    matieresPremieres,
    matieresLots
  );

  return {
    ingredients: recettesDataSortByNameOrOrder_(ingredients),
    matieres_premieres: recettesDataSortByNameOrOrder_(matieresPremieres),
    matieresPremieres: recettesDataSortByNameOrOrder_(matieresPremieres),
    matieres_lots: recettesDataSortLots_(matieresLots),
    matieresLots: recettesDataSortLots_(matieresLots),
    cuvees_ingredients_reels: cuveesIngredientsReels,
    cuveesIngredientsReels: cuveesIngredientsReels,
    alertes: alertes,

    resume: {
      ingredients_total: ingredients.length,
      matieres_premieres_total: matieresPremieres.length,
      lots_matieres_total: matieresLots.length,
      alertes_total: alertes.length,
      lots_actifs: matieresLots.filter(recettesDataIsActiveRow_).length
    }
  };
}

function recettesDataBuildDashboardNextActions_(context) {
  var actions = [];

  if (context.matieresAlertes.length > 0) {
    actions.push({
      code: "MATIERES_ALERTES",
      label: "Vérifier les matières premières",
      href: "./recettes-matieres.html",
      priority: 1
    });
  }

  if (context.cuveesOuvertes.length > 0) {
    actions.push({
      code: "CUEES_EN_COURS",
      label: "Suivre les cuvées en cours",
      href: "./recettes-production.html",
      priority: 2
    });
  }

  if (context.recettesActives.length === 0) {
    actions.push({
      code: "AUCUNE_RECETTE_ACTIVE",
      label: "Créer ou réactiver une recette",
      href: "./recettes-historique.html",
      priority: 3
    });
  }

  if (actions.length === 0) {
    actions.push({
      code: "RAS",
      label: "Ouvrir le dashboard recettes",
      href: "./recettes-dashboard.html",
      priority: 9
    });
  }

  return actions.sort(function(a, b) {
    return a.priority - b.priority;
  });
}

/* ==========================================================
   Lecture Sheets
   ========================================================== */

function recettesDataReadTables_(logicalKeys) {
  var output = {};
  var keys = recettesDataArray_(logicalKeys);

  keys.forEach(function(logicalKey) {
    output[logicalKey] = recettesDataReadTable_(logicalKey);
  });

  Object.keys(RECETTES_DATA_SHEET_FALLBACKS).forEach(function(logicalKey) {
    if (!output[logicalKey]) {
      output[logicalKey] = [];
    }
  });

  return output;
}

function recettesDataReadTable_(logicalKey) {
  var spreadsheet = recettesDataGetSpreadsheet_();
  var sheetName = recettesDataGetSheetName_(logicalKey);
  var sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    return [];
  }

  var range = sheet.getDataRange();
  var values = range.getValues();

  if (!values || values.length < 2) {
    return [];
  }

  var headers = values[0].map(function(header, index) {
    var key = String(header || "").trim();

    if (!key) {
      return "col_" + String(index + 1);
    }

    return key;
  });

  var rows = [];

  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    var valuesRow = values[rowIndex];

    if (recettesDataIsEmptyRow_(valuesRow)) {
      continue;
    }

    var row = {};

    headers.forEach(function(header, colIndex) {
      row[header] = recettesDataNormalizeCellValue_(valuesRow[colIndex]);
    });

    rows.push(row);
  }

  return rows;
}

function recettesDataGetSpreadsheet_() {
  if (typeof SPREADSHEET_ID !== "undefined" && SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }

  if (
    typeof CONFIG !== "undefined" &&
    CONFIG &&
    CONFIG.spreadsheetId
  ) {
    return SpreadsheetApp.openById(CONFIG.spreadsheetId);
  }

  if (
    typeof LUGDURUM_CONFIG !== "undefined" &&
    LUGDURUM_CONFIG &&
    LUGDURUM_CONFIG.spreadsheetId
  ) {
    return SpreadsheetApp.openById(LUGDURUM_CONFIG.spreadsheetId);
  }

  return SpreadsheetApp.getActiveSpreadsheet();
}

function recettesDataGetSheetName_(logicalKey) {
  if (
    typeof SHEETS !== "undefined" &&
    SHEETS &&
    SHEETS[logicalKey]
  ) {
    return SHEETS[logicalKey];
  }

  return RECETTES_DATA_SHEET_FALLBACKS[logicalKey] || logicalKey;
}

/* ==========================================================
   Normalisation / tri
   ========================================================== */

function recettesDataNormalizeView_(view) {
  var rawView = "";

  if (view && typeof view === "object") {
    rawView =
      view.view ||
      view.vue ||
      view.mode ||
      view.type ||
      RECETTES_DATA_DEFAULT_VIEW;
  } else {
    rawView = view;
  }

  var safeView = String(rawView || RECETTES_DATA_DEFAULT_VIEW)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (safeView === "matiere") {
    safeView = "matieres";
  }

  if (safeView === "history") {
    safeView = "historique";
  }

  if (safeView === "prod") {
    safeView = "production";
  }

  if (!RECETTES_DATA_VIEW_TABLES[safeView]) {
    safeView = RECETTES_DATA_DEFAULT_VIEW;
  }

  return safeView;
}

function recettesDataNormalizeCellValue_(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === null || value === undefined) {
    return "";
  }

  return value;
}

function recettesDataIsEmptyRow_(row) {
  return recettesDataArray_(row).every(function(value) {
    return value === "" || value === null || value === undefined;
  });
}

function recettesDataArray_(value) {
  return Array.isArray(value) ? value : [];
}

function recettesDataNormalizeText_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function recettesDataToNumber_(value, fallback) {
  if (typeof fallback === "undefined") {
    fallback = 0;
  }

  if (typeof value === "number" && isFinite(value)) {
    return value;
  }

  var normalized = String(value === null || value === undefined ? "" : value)
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");

  if (!normalized) {
    return fallback;
  }

  var number = Number(normalized);

  return isFinite(number) ? number : fallback;
}

function recettesDataToBoolean_(value, fallback) {
  if (typeof fallback === "undefined") {
    fallback = false;
  }

  if (value === true) return true;
  if (value === false) return false;

  if (typeof value === "number") {
    return value !== 0;
  }

  var normalized = recettesDataNormalizeText_(value);

  if (!normalized) {
    return fallback;
  }

  if (
    [
      "true",
      "vrai",
      "oui",
      "yes",
      "1",
      "x",
      "actif",
      "active",
      "valide",
      "validé",
      "validee",
      "validée"
    ].indexOf(normalized) >= 0
  ) {
    return true;
  }

  if (
    [
      "false",
      "faux",
      "non",
      "no",
      "0",
      "inactif",
      "inactive",
      "annule",
      "annulé",
      "annulee",
      "annulée"
    ].indexOf(normalized) >= 0
  ) {
    return false;
  }

  return fallback;
}

function recettesDataIsActiveRow_(row) {
  if (!row) return false;

  if (Object.prototype.hasOwnProperty.call(row, "actif")) {
    return recettesDataToBoolean_(row.actif, false);
  }

  var statut = recettesDataNormalizeText_(
    row.statut ||
    row.status ||
    row.etat ||
    ""
  );

  if (
    [
      "annule",
      "annulee",
      "annulé",
      "annulée",
      "supprime",
      "supprimé",
      "archive",
      "archivé",
      "inactive",
      "inactif"
    ].indexOf(statut) >= 0
  ) {
    return false;
  }

  return true;
}

function recettesDataIsClosedRow_(row) {
  var statut = recettesDataNormalizeText_(
    row && (
      row.statut ||
      row.status ||
      row.etat ||
      ""
    )
  );

  return [
    "cloture",
    "cloturee",
    "clôture",
    "clôturée",
    "termine",
    "terminee",
    "terminé",
    "terminée",
    "archive",
    "archivé"
  ].indexOf(statut) >= 0;
}

function recettesDataIsOpenProductionRow_(row) {
  if (!row) return false;
  if (!recettesDataIsActiveRow_(row)) return false;
  if (recettesDataIsClosedRow_(row)) return false;

  var statut = recettesDataNormalizeText_(
    row.statut ||
    row.status ||
    row.etat ||
    ""
  );

  if (!statut) return true;

  return [
    "brouillon",
    "prevu",
    "prévu",
    "en_preparation",
    "en préparation",
    "preparation",
    "préparation",
    "en_cours",
    "en cours",
    "maceration",
    "macération",
    "production",
    "soutirage",
    "filtration"
  ].indexOf(statut) >= 0;
}

function recettesDataGetDateValue_(row) {
  if (!row) return 0;

  var candidates = [
    row.date_debut,
    row.date_lancement,
    row.date_mise_en_cuve,
    row.date_creation,
    row.date,
    row.created_at,
    row.updated_at
  ];

  for (var index = 0; index < candidates.length; index += 1) {
    var value = candidates[index];

    if (!value) continue;

    var date = new Date(value);

    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  return 0;
}

function recettesDataSortByRecentDate_(rows) {
  return recettesDataArray_(rows)
    .slice()
    .sort(function(a, b) {
      return recettesDataGetDateValue_(b) - recettesDataGetDateValue_(a);
    });
}

function recettesDataSortByDateAsc_(a, b) {
  return recettesDataGetDateValue_(a) - recettesDataGetDateValue_(b);
}

function recettesDataGetOrder_(row) {
  return recettesDataToNumber_(
    row && (
      row.ordre_affichage ||
      row.ordre ||
      row.position ||
      row.sort_order
    ),
    999999
  );
}

function recettesDataGetName_(row) {
  return String(
    row && (
      row.nom ||
      row.libelle ||
      row.name ||
      row.parfum_nom ||
      row.ingredient_nom ||
      row.matiere_nom ||
      row.code ||
      row.recette_id ||
      row.ingredient_id ||
      ""
    )
  );
}

function recettesDataSortByOrderThenName_(a, b) {
  var byOrder = recettesDataGetOrder_(a) - recettesDataGetOrder_(b);

  if (byOrder !== 0) {
    return byOrder;
  }

  return recettesDataGetName_(a).localeCompare(
    recettesDataGetName_(b),
    "fr"
  );
}

function recettesDataSortByNameOrOrder_(rows) {
  return recettesDataArray_(rows)
    .slice()
    .sort(recettesDataSortByOrderThenName_);
}

function recettesDataSortLots_(rows) {
  return recettesDataArray_(rows)
    .slice()
    .sort(function(a, b) {
      var matiereA = String(a.matiere_id || a.ingredient_id || "");
      var matiereB = String(b.matiere_id || b.ingredient_id || "");

      var byMatiere = matiereA.localeCompare(matiereB, "fr");

      if (byMatiere !== 0) {
        return byMatiere;
      }

      return recettesDataGetDateValue_(b) - recettesDataGetDateValue_(a);
    });
}

/* ==========================================================
   Alertes matières
   ========================================================== */

function recettesDataBuildMatieresAlertes_(matieresPremieres, matieresLots) {
  var alertes = [];

  recettesDataArray_(matieresPremieres).forEach(function(row) {
    var stock = recettesDataGetStockValue_(row);
    var seuil = recettesDataGetSeuilValue_(row);

    if (seuil > 0 && stock <= seuil) {
      alertes.push({
        type: "MATIERE_PREMIERE",
        niveau: stock <= 0 ? "rupture" : "alerte",
        id:
          row.matiere_id ||
          row.ingredient_id ||
          row.id ||
          "",
        nom:
          row.nom ||
          row.libelle ||
          row.matiere_nom ||
          row.ingredient_nom ||
          "",
        stock: stock,
        seuil: seuil,
        unite:
          row.unite ||
          row.unite_stock ||
          "",
        source: row
      });
    }
  });

  recettesDataArray_(matieresLots).forEach(function(row) {
    if (!recettesDataIsActiveRow_(row)) return;

    var stock = recettesDataGetStockValue_(row);
    var seuil = recettesDataGetSeuilValue_(row);

    if (seuil > 0 && stock <= seuil) {
      alertes.push({
        type: "LOT_MATIERE",
        niveau: stock <= 0 ? "rupture" : "alerte",
        id:
          row.lot_id ||
          row.matiere_lot_id ||
          row.id ||
          "",
        nom:
          row.nom ||
          row.libelle ||
          row.lot_nom ||
          row.matiere_nom ||
          "",
        stock: stock,
        seuil: seuil,
        unite:
          row.unite ||
          row.unite_stock ||
          "",
        source: row
      });
    }
  });

  return alertes;
}

function recettesDataGetStockValue_(row) {
  return recettesDataToNumber_(
    row.stock_actuel !== undefined ? row.stock_actuel :
    row.stock_restant !== undefined ? row.stock_restant :
    row.quantite_restante !== undefined ? row.quantite_restante :
    row.quantite_disponible !== undefined ? row.quantite_disponible :
    row.stock !== undefined ? row.stock :
    row.quantite !== undefined ? row.quantite :
    0,
    0
  );
}

function recettesDataGetSeuilValue_(row) {
  return recettesDataToNumber_(
    row.seuil_alerte !== undefined ? row.seuil_alerte :
    row.stock_min !== undefined ? row.stock_min :
    row.seuil_min !== undefined ? row.seuil_min :
    row.quantite_min !== undefined ? row.quantite_min :
    0,
    0
  );
}

/* ==========================================================
   Utils locales
   ========================================================== */

function recettesDataNowIso_() {
  return new Date().toISOString();
}