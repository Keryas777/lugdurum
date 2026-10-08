/************************************************************
 * 99_tests.gs
 * ----------------------------------------------------------
 * Tests manuels / smoke tests pour la WebApp Lugdurum.
 *
 * Objectif :
 * - vérifier que le découpage du code.gs fonctionne ;
 * - contrôler les onglets et colonnes réellement critiques ;
 * - tester le routeur HTTP GET / POST ;
 * - tester les lectures principales ;
 * - tester getHomeData sans écriture ;
 * - préparer des tests d’écriture, désactivés par défaut.
 *
 * Correction importante :
 * - Les tests ne doivent PAS inventer de colonnes obligatoires.
 * - Une colonne est bloquante uniquement si elle est nécessaire pour
 *   identifier / upserter une ligne, ou indispensable au routeur.
 * - Les colonnes métier utiles mais non présentes sont signalées en
 *   warnings, sans faire échouer toute la suite de tests.
 *
 * Important :
 * - Les tests d’écriture sont volontairement désactivés.
 * - Lancer test99_all() depuis Apps Script.
 ************************************************************/

var TESTS_VERSION = "V17_TESTS_SPLIT_SOFT_HEADERS";

var TESTS_CONFIG = {
  RUN_WRITE_TESTS: false,
  STRICT_OPTIONAL_SHEETS: false,
  STRICT_ADVISORY_COLUMNS: false,
  USER_ID: "U_JEROME",
  MAX_SAMPLE_ROWS: 3
};

/* ==========================================================
   Onglets et colonnes critiques
   ========================================================== */

/*
  Ici on ne met que les colonnes réellement bloquantes.

  Règle :
  - catalogue : sku_id
  - offres_vente : offre_id
  - onglets upsert : idKey historique du code Apps Script
  - mouvements_stock : mouvement_stock_id
  - transactions : transaction_id
  - ventes_lignes : ligne_id
  - frais : frais_id

  Les colonnes secondaires sont contrôlées plus bas en advisory.
*/

var TEST_REQUIRED_SHEETS_MINIMAL = {
  catalogue: ["sku_id"],
  offres_vente: ["offre_id"],

  inscriptions_evenements: ["inscription_id"],
  missions_vente: ["mission_id"],
  missions_stock: ["mission_id"],
  journees_vente: ["journee_id"],

  transactions: ["transaction_id"],
  ventes_lignes: ["ligne_id"],
  mouvements_stock: ["mouvement_stock_id"],
  frais: ["frais_id"],

  clotures_journees: []
};

/*
  Onglets optionnels / futurs modules.
  Ils ne doivent pas bloquer la webapp terrain si absents.
*/

var TEST_OPTIONAL_SHEETS_MINIMAL = {
  clients: ["client_id"],
  commandes_pro: ["commande_id"],
  commandes_pro_lignes: ["commande_ligne_id"],
  documents: ["document_id"],
  referentiels: []
};

/*
  Colonnes recommandées par les écrans actuels.
  Ces listes servent au diagnostic, pas au blocage.
  Si STRICT_ADVISORY_COLUMNS = true, elles deviennent bloquantes.
*/

var TEST_ADVISORY_COLUMNS = {
  catalogue: [
    "sku_id",
    "parfum_code",
    "parfum_nom",
    "format_cl",
    "gamme_tarif",
    "vendable_seul",
    "composable_coffret",
    "cout_revient",
    "actif",
    "visible_webapp",
    "ordre_affichage",
    "note",
    "image_src"
  ],

  offres_vente: [
    "offre_id",
    "libelle",
    "type_offre",
    "format_cl",
    "gamme_tarif",
    "quantite_bouteilles",
    "prix_ttc",
    "prix_ht",
    "taux_tva",
    "regime_tva",
    "actif",
    "ordre_affichage",
    "supplement_parfum_code",
    "supplement_unitaire_ttc",
    "note"
  ],

  inscriptions_evenements: [
    "inscription_id",
    "nom",
    "type_evenement",
    "type_evenement_label",
    "date_debut",
    "date_fin",
    "horaires",
    "mise_en_place",
    "ville",
    "lieu",
    "adresse",
    "statut",
    "prix_emplacement",
    "dossier_envoye",
    "acceptation",
    "paiement_statut",
    "paiement_statut_label",
    "caution",
    "responsable_user_id",
    "responsable_nom",
    "vendeurs_prevus",
    "vendeurs_prevus_noms",
    "evenement_id",
    "source",
    "note",
    "created_at",
    "updated_at"
  ],

  missions_vente: [
    "mission_id",
    "inscription_id",
    "nom",
    "date_debut",
    "date_fin",
    "lieu",
    "ville",
    "adresse",
    "horaires",
    "mise_en_place",
    "type_evenement",
    "type_evenement_label",
    "duree_type",
    "statut",
    "vendeurs_prevus",
    "vendeurs_prevus_noms",
    "responsable_user_id",
    "source",
    "note",
    "created_at",
    "updated_at"
  ],

  missions_stock: [
    "mission_id",
    "evenement_id",
    "nom",
    "date_debut",
    "date_fin",
    "statut",
    "stock_prepare",
    "responsable_user_id",
    "journees_count",
    "total_bouteilles_preparees",
    "total_50cl_prepare",
    "total_20cl_prepare",
    "parfums_prepare_count",
    "ca_total_ttc",
    "total_frais_ttc",
    "source",
    "note",
    "created_at",
    "updated_at",
    "closed_at"
  ],

  journees_vente: [
    "journee_id",
    "mission_id",
    "evenement_id",
    "stock_mission_id",
    "date",
    "jour_label",
    "statut",
    "ca_total_ttc",
    "total_frais_ttc",
    "meteo",
    "affluence_ressentie",
    "source",
    "note",
    "started_at",
    "closed_at",
    "created_at",
    "updated_at"
  ],

  transactions: [
    "transaction_id",
    "date_heure",
    "mission_id",
    "stock_mission_id",
    "journee_id",
    "user_id",
    "mode_paiement",
    "paiement_provider",
    "paiement_statut",
    "sumup_foreign_tx_id",
    "source",
    "source_id",
    "total_catalogue_ttc",
    "total_catalogue_ht",
    "total_tva",
    "total_encaisse_ttc",
    "remise_totale",
    "motif_remise",
    "statut",
    "note",
    "detail_ticket",
    "created_at",
    "updated_at"
  ],

  ventes_lignes: [
    "ligne_id",
    "transaction_id",
    "mission_id",
    "stock_mission_id",
    "evenement_id",
    "journee_id",
    "sku_id",
    "parfum_code",
    "parfum_nom",
    "format_cl",
    "quantite",
    "type_vente",
    "conditionnement",
    "offre_id",
    "offre_libelle",
    "prix_unitaire_ttc",
    "prix_unitaire_ht",
    "taux_tva",
    "montant_tva_ligne",
    "total_catalogue_ligne_ttc",
    "total_catalogue_ligne_ht",
    "cout_unitaire",
    "marge_brute_ligne",
    "source",
    "statut",
    "note",
    "created_at",
    "updated_at"
  ],

  mouvements_stock: [
    "mouvement_stock_id",
    "date_heure",
    "mission_id",
    "stock_mission_id",
    "journee_id",
    "type_mouvement",
    "sens",
    "sku_id",
    "parfum_code",
    "parfum_nom",
    "format_cl",
    "quantite",
    "source",
    "source_id",
    "transaction_id",
    "ligne_id",
    "statut",
    "note",
    "user_id",
    "created_at",
    "updated_at"
  ],

  frais: [
    "frais_id",
    "date",
    "date_heure",
    "mission_id",
    "stock_mission_id",
    "evenement_id",
    "journee_id",
    "categorie",
    "categorie_label",
    "libelle",
    "montant",
    "montant_ttc",
    "paye_par",
    "paye_par_nom",
    "mode_paiement",
    "mode_paiement_label",
    "justificatif_url",
    "statut",
    "note",
    "user_id",
    "source",
    "created_at",
    "updated_at"
  ],

  clotures_journees: [
    "cloture_id",
    "journee_id",
    "mission_id",
    "stock_mission_id",
    "date",
    "ca_total_ttc",
    "total_frais_ttc",
    "statut",
    "note",
    "created_at",
    "updated_at"
  ]
};

/* ==========================================================
   Lancement global
   ========================================================== */

function test99_all() {
  return runLugdurumTests();
}

function runLugdurumTests(options) {
  var startedAt = new Date();
  var report = {
    ok: true,
    version: TESTS_VERSION,
    started_at: startedAt.toISOString(),
    finished_at: "",
    duration_ms: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    warnings: [],
    tests: []
  };

  var config = Object.assign({}, TESTS_CONFIG, options || {});

  lugRunTest_("00_config_globals", function() {
    return test99_config_globals_();
  }, report);

  lugRunTest_("00_spreadsheet_access", function() {
    return test99_spreadsheet_access_();
  }, report);

  lugRunTest_("02_required_sheets_minimal_headers", function() {
    return test99_required_sheets_minimal_headers_();
  }, report);

  lugRunTest_("02_optional_sheets_minimal_headers", function() {
    return test99_optional_sheets_minimal_headers_(config);
  }, report);

  lugRunTest_("02_advisory_columns", function() {
    return test99_advisory_columns_(config, report);
  }, report);

  lugRunTest_("01_http_get_ping", function() {
    return test99_http_get_ping_();
  }, report);

  lugRunTest_("01_http_post_ping", function() {
    return test99_http_post_ping_();
  }, report);

  lugRunTest_("01_http_get_spreadsheet_info", function() {
    return test99_http_get_spreadsheet_info_();
  }, report);

  lugRunTest_("03_get_catalogue", function() {
    return test99_get_array_action_("getCatalogue");
  }, report);

  lugRunTest_("03_get_offres_vente", function() {
    return test99_get_array_action_("getOffresVente");
  }, report);

  lugRunTest_("03_get_missions", function() {
    return test99_get_array_action_("getMissions");
  }, report);

  lugRunTest_("03_get_missions_stock", function() {
    return test99_get_array_action_("getMissionsStock");
  }, report);

  lugRunTest_("03_get_journees", function() {
    return test99_get_array_action_("getJournees");
  }, report);

  lugRunTest_("03_get_transactions", function() {
    return test99_get_array_action_("getTransactions");
  }, report);

  lugRunTest_("03_get_ventes_lignes", function() {
    return test99_get_array_action_("getVentesLignes");
  }, report);

  lugRunTest_("03_get_mouvements_stock", function() {
    return test99_get_array_action_("getMouvementsStock");
  }, report);

  lugRunTest_("03_get_core_data", function() {
    return test99_get_core_data_();
  }, report);

  lugRunTest_("04_home_data", function() {
    return test99_get_home_data_();
  }, report);

  lugRunTest_("06_vente_rapide_critical_columns", function() {
    return test99_vente_rapide_critical_columns_();
  }, report);

  lugRunTest_("07_historique_critical_columns", function() {
    return test99_historique_critical_columns_();
  }, report);

  lugRunTest_("99_write_tests_status", function() {
    return test99_write_tests_status_(config);
  }, report);

  report.finished_at = new Date().toISOString();
  report.duration_ms = new Date() - startedAt;
  report.ok = report.failed === 0;

  Logger.log(JSON.stringify(report, null, 2));

  return report;
}

/* ==========================================================
   Tests config / accès Sheets
   ========================================================== */

function test99_config_globals_() {
  var found = {
    CONFIG_VERSION: typeof CONFIG_VERSION !== "undefined",
    HTTP_ROUTER_VERSION: typeof HTTP_ROUTER_VERSION !== "undefined",
    SHEETS_CORE_VERSION: typeof SHEETS_CORE_VERSION !== "undefined",
    GET_DATA_VERSION: typeof GET_DATA_VERSION !== "undefined",
    HOME_DATA_VERSION: typeof HOME_DATA_VERSION !== "undefined",
    RECETTES_DATA_VERSION: typeof RECETTES_DATA_VERSION !== "undefined",
    WRITE_BUNDLES_VENTE_VERSION: typeof WRITE_BUNDLES_VENTE_VERSION !== "undefined",
    WRITE_BUNDLES_METIER_VERSION: typeof WRITE_BUNDLES_METIER_VERSION !== "undefined",
    NORMALIZERS_VERSION: typeof NORMALIZERS_VERSION !== "undefined",
    UTILS_VERSION: typeof UTILS_VERSION !== "undefined",
    TESTS_VERSION: typeof TESTS_VERSION !== "undefined"
  };

  lugAssert_(found.TESTS_VERSION, "TESTS_VERSION absent.");
  lugAssert_(
    found.UTILS_VERSION,
    "UTILS_VERSION absent : 09_utils.gs semble absent ou non chargé."
  );

  return found;
}

function test99_spreadsheet_access_() {
  var ss = lugGetSpreadsheet_();

  lugAssert_(ss, "Spreadsheet introuvable.");
  lugAssert_(ss.getId(), "Spreadsheet ID introuvable.");

  return {
    spreadsheet_id: ss.getId(),
    spreadsheet_name: ss.getName(),
    sheets_count: ss.getSheets().length
  };
}

/* ==========================================================
   Tests colonnes
   ========================================================== */

function test99_required_sheets_minimal_headers_() {
  var result = {
    checked: [],
    missing_sheets: [],
    missing_columns: {},
    duplicate_columns: {}
  };

  Object.keys(TEST_REQUIRED_SHEETS_MINIMAL).forEach(function(sheetName) {
    var check = lugCheckSheetHeaders_(
      sheetName,
      TEST_REQUIRED_SHEETS_MINIMAL[sheetName],
      true
    );

    result.checked.push(check);

    if (check.missing_sheet) {
      result.missing_sheets.push(sheetName);
    }

    if (check.missing_columns.length > 0) {
      result.missing_columns[sheetName] = check.missing_columns;
    }

    if (check.duplicate_columns.length > 0) {
      result.duplicate_columns[sheetName] = check.duplicate_columns;
    }
  });

  lugAssert_(
    result.missing_sheets.length === 0,
    "Onglets critiques manquants : " + result.missing_sheets.join(", "),
    result.missing_sheets
  );

  lugAssert_(
    Object.keys(result.missing_columns).length === 0,
    "Colonnes ID critiques manquantes.",
    result.missing_columns
  );

  lugAssert_(
    Object.keys(result.duplicate_columns).length === 0,
    "Colonnes dupliquées détectées.",
    result.duplicate_columns
  );

  return result;
}

function test99_optional_sheets_minimal_headers_(config) {
  var result = {
    checked: [],
    missing_sheets: [],
    missing_columns: {},
    duplicate_columns: {},
    strict: Boolean(config.STRICT_OPTIONAL_SHEETS)
  };

  Object.keys(TEST_OPTIONAL_SHEETS_MINIMAL).forEach(function(sheetName) {
    var check = lugCheckSheetHeaders_(
      sheetName,
      TEST_OPTIONAL_SHEETS_MINIMAL[sheetName],
      false
    );

    result.checked.push(check);

    if (check.missing_sheet) {
      result.missing_sheets.push(sheetName);
    }

    if (check.missing_columns.length > 0) {
      result.missing_columns[sheetName] = check.missing_columns;
    }

    if (check.duplicate_columns.length > 0) {
      result.duplicate_columns[sheetName] = check.duplicate_columns;
    }
  });

  if (config.STRICT_OPTIONAL_SHEETS) {
    lugAssert_(
      result.missing_sheets.length === 0,
      "Onglets optionnels manquants en mode strict : " + result.missing_sheets.join(", "),
      result.missing_sheets
    );

    lugAssert_(
      Object.keys(result.missing_columns).length === 0,
      "Colonnes ID optionnelles manquantes en mode strict.",
      result.missing_columns
    );
  }

  return result;
}

function test99_advisory_columns_(config, report) {
  var result = {
    checked: [],
    missing_columns: {},
    duplicate_columns: {},
    strict: Boolean(config.STRICT_ADVISORY_COLUMNS)
  };

  Object.keys(TEST_ADVISORY_COLUMNS).forEach(function(sheetName) {
    var check = lugCheckSheetHeaders_(
      sheetName,
      TEST_ADVISORY_COLUMNS[sheetName],
      false
    );

    result.checked.push(check);

    if (!check.missing_sheet && check.missing_columns.length > 0) {
      result.missing_columns[sheetName] = check.missing_columns;
    }

    if (!check.missing_sheet && check.duplicate_columns.length > 0) {
      result.duplicate_columns[sheetName] = check.duplicate_columns;
    }
  });

  if (Object.keys(result.missing_columns).length > 0) {
    lugAddWarning_(report, {
      code: "ADVISORY_COLUMNS_MISSING",
      message:
        "Colonnes métier recommandées manquantes. Ce n’est pas bloquant sauf si STRICT_ADVISORY_COLUMNS=true.",
      details: result.missing_columns
    });
  }

  if (Object.keys(result.duplicate_columns).length > 0) {
    lugAddWarning_(report, {
      code: "ADVISORY_DUPLICATE_COLUMNS",
      message:
        "Colonnes dupliquées détectées sur des onglets contrôlés.",
      details: result.duplicate_columns
    });
  }

  if (config.STRICT_ADVISORY_COLUMNS) {
    lugAssert_(
      Object.keys(result.missing_columns).length === 0,
      "Colonnes métier recommandées manquantes en mode strict.",
      result.missing_columns
    );
  }

  return result;
}

function test99_vente_rapide_critical_columns_() {
  var checks = {
    transactions: lugCheckSheetHeaders_("transactions", [
      "transaction_id",
      "mission_id",
      "journee_id"
    ], true),

    ventes_lignes: lugCheckSheetHeaders_("ventes_lignes", [
      "ligne_id",
      "transaction_id",
      "mission_id",
      "journee_id",
      "sku_id",
      "quantite"
    ], true),

    mouvements_stock: lugCheckSheetHeaders_("mouvements_stock", [
      "mouvement_stock_id",
      "mission_id",
      "journee_id",
      "sku_id",
      "quantite"
    ], true)
  };

  var missing = {};

  Object.keys(checks).forEach(function(sheetName) {
    if (checks[sheetName].missing_columns.length > 0) {
      missing[sheetName] = checks[sheetName].missing_columns;
    }
  });

  lugAssert_(
    Object.keys(missing).length === 0,
    "Colonnes critiques nécessaires à vente-rapide.js manquantes.",
    missing
  );

  return checks;
}

function test99_historique_critical_columns_() {
  var checks = {
    missions_vente: lugCheckSheetHeaders_("missions_vente", [
      "mission_id",
      "nom",
      "date_debut",
      "date_fin",
      "statut"
    ], true),

    missions_stock: lugCheckSheetHeaders_("missions_stock", [
      "mission_id",
      "nom",
      "date_debut",
      "date_fin",
      "statut"
    ], true),

    journees_vente: lugCheckSheetHeaders_("journees_vente", [
      "journee_id",
      "mission_id",
      "date",
      "statut"
    ], true),

    transactions: lugCheckSheetHeaders_("transactions", [
      "transaction_id",
      "mission_id",
      "journee_id"
    ], true),

    ventes_lignes: lugCheckSheetHeaders_("ventes_lignes", [
      "ligne_id",
      "transaction_id",
      "mission_id",
      "journee_id",
      "sku_id",
      "quantite"
    ], true),

    frais: lugCheckSheetHeaders_("frais", [
      "frais_id",
      "mission_id",
      "journee_id"
    ], true)
  };

  var missing = {};

  Object.keys(checks).forEach(function(sheetName) {
    if (checks[sheetName].missing_columns.length > 0) {
      missing[sheetName] = checks[sheetName].missing_columns;
    }
  });

  lugAssert_(
    Object.keys(missing).length === 0,
    "Colonnes critiques nécessaires à la saisie historique manquantes.",
    missing
  );

  return checks;
}

/* ==========================================================
   Tests routeur HTTP
   ========================================================== */

function test99_http_get_ping_() {
  var response = lugCallGetAction_("ping", {});

  lugAssert_(response.ok === true, "GET ping doit répondre ok:true.", response);

  return response;
}

function test99_http_post_ping_() {
  var response = lugCallPostAction_("ping", {});

  lugAssert_(response.ok === true, "POST ping doit répondre ok:true.", response);

  return response;
}

function test99_http_get_spreadsheet_info_() {
  var response = lugCallGetAction_("getSpreadsheetInfo", {});

  lugAssert_(
    response.ok === true,
    "getSpreadsheetInfo doit répondre ok:true.",
    response
  );

  return response;
}

/* ==========================================================
   Tests lectures API
   ========================================================== */

function test99_get_array_action_(action) {
  var response = lugCallGetAction_(action, {});

  lugAssert_(response.ok === true, action + " doit répondre ok:true.", response);

  var data = response.data;

  lugAssert_(
    Array.isArray(data),
    action + " doit retourner un tableau dans data.",
    response
  );

  return {
    action: action,
    count: data.length,
    sample: data.slice(0, TESTS_CONFIG.MAX_SAMPLE_ROWS)
  };
}

function test99_get_core_data_() {
  var response = lugCallGetAction_("getCoreData", {
    tables: [
      "catalogue",
      "offresVente",
      "inscriptions",
      "missions",
      "missionsStock",
      "journees",
      "transactions",
      "ventesLignes",
      "mouvementsStock",
      "frais"
    ].join(",")
  });

  lugAssert_(response.ok === true, "getCoreData doit répondre ok:true.", response);

  lugAssert_(
    response.data && typeof response.data === "object",
    "getCoreData doit retourner un objet data.",
    response
  );

  return {
    keys: Object.keys(response.data || {}),
    raw: lugSummarizeObjectArrays_(response.data || {})
  };
}

function test99_get_home_data_() {
  var response = lugCallGetAction_("getHomeData", {
    today: lugTodayIso_(),
    user_id: TESTS_CONFIG.USER_ID,
    current_user_id: TESTS_CONFIG.USER_ID,
    selected_type: "",
    selected_id: ""
  });

  lugAssert_(response.ok === true, "getHomeData doit répondre ok:true.", response);

  lugAssert_(
    response.data && typeof response.data === "object",
    "getHomeData doit retourner un objet data.",
    response
  );

  var envelope =
    response.data.homeData ||
    response.data.home_data ||
    response.data.home ||
    response.data;

  lugAssert_(
    envelope && typeof envelope === "object",
    "Payload getHomeData invalide.",
    response
  );

  return {
    keys: Object.keys(envelope),
    generated_at: envelope.generated_at || envelope.generatedAt || "",
    summary: lugSummarizeObjectArrays_(envelope)
  };
}

/* ==========================================================
   Tests écriture — désactivés par défaut
   ========================================================== */

function test99_write_tests_status_(config) {
  if (!config.RUN_WRITE_TESTS) {
    return {
      skipped: true,
      message:
        "Tests d’écriture désactivés. C’est normal : on évite toute écriture parasite dans le Sheets de production."
    };
  }

  throw new Error(
    "RUN_WRITE_TESTS est activé, mais aucun test d’écriture destructif n’est fourni par défaut. Crée un scénario dédié sur un Sheet de test."
  );
}

/* ==========================================================
   Helpers internes tests
   ========================================================== */

function lugRunTest_(name, fn, report) {
  var startedAt = Date.now();

  try {
    var details = fn();

    if (details && details.skipped) {
      report.skipped += 1;
      report.tests.push({
        name: name,
        ok: true,
        skipped: true,
        duration_ms: Date.now() - startedAt,
        details: details
      });
      return;
    }

    report.passed += 1;
    report.tests.push({
      name: name,
      ok: true,
      duration_ms: Date.now() - startedAt,
      details: details || {}
    });
  } catch (error) {
    report.failed += 1;
    report.ok = false;
    report.tests.push({
      name: name,
      ok: false,
      duration_ms: Date.now() - startedAt,
      error: error && error.message ? error.message : String(error),
      details: error && error.details ? error.details : "",
      stack: error && error.stack ? String(error.stack) : ""
    });
  }
}

function lugAssert_(condition, message, details) {
  if (condition) return;

  var error = new Error(message || "Assertion échouée.");

  if (details !== undefined) {
    try {
      error.details = JSON.stringify(details);
    } catch (ignored) {
      error.details = String(details);
    }
  }

  throw error;
}

function lugAddWarning_(report, warning) {
  if (!report) return;

  if (!Array.isArray(report.warnings)) {
    report.warnings = [];
  }

  report.warnings.push(warning || {
    code: "WARNING",
    message: "Avertissement non détaillé."
  });
}

function lugGetSpreadsheet_() {
  if (typeof getSpreadsheet === "function") {
    return getSpreadsheet();
  }

  if (typeof getSpreadsheet_ === "function") {
    return getSpreadsheet_();
  }

  if (typeof openSpreadsheet === "function") {
    return openSpreadsheet();
  }

  if (typeof openSpreadsheet_ === "function") {
    return openSpreadsheet_();
  }

  if (typeof SPREADSHEET_ID !== "undefined" && SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }

  if (typeof CONFIG !== "undefined" && CONFIG) {
    if (CONFIG.spreadsheetId) {
      return SpreadsheetApp.openById(CONFIG.spreadsheetId);
    }

    if (CONFIG.SPREADSHEET_ID) {
      return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    }
  }

  if (typeof LUGDURUM_CONFIG !== "undefined" && LUGDURUM_CONFIG) {
    if (LUGDURUM_CONFIG.spreadsheetId) {
      return SpreadsheetApp.openById(LUGDURUM_CONFIG.spreadsheetId);
    }

    if (LUGDURUM_CONFIG.SPREADSHEET_ID) {
      return SpreadsheetApp.openById(LUGDURUM_CONFIG.SPREADSHEET_ID);
    }
  }

  var active = SpreadsheetApp.getActiveSpreadsheet();

  if (active) return active;

  throw new Error("Impossible de résoudre le Spreadsheet Lugdurum.");
}

function lugGetSheet_(sheetName) {
  var ss = lugGetSpreadsheet_();

  return ss.getSheetByName(sheetName);
}

function lugGetHeaders_(sheet) {
  if (!sheet) return [];

  var lastColumn = sheet.getLastColumn();

  if (lastColumn <= 0) return [];

  return sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0]
    .map(function(value) {
      return String(value || "").trim();
    })
    .filter(Boolean);
}

function lugCheckSheetHeaders_(sheetName, expectedHeaders, requiredSheet) {
  var sheet = lugGetSheet_(sheetName);
  var expected = Array.isArray(expectedHeaders) ? expectedHeaders : [];

  if (!sheet) {
    return {
      sheet: sheetName,
      required: Boolean(requiredSheet),
      missing_sheet: true,
      headers_count: 0,
      rows_count: 0,
      missing_columns: expected.slice(),
      duplicate_columns: []
    };
  }

  var headers = lugGetHeaders_(sheet);
  var headerSet = {};

  headers.forEach(function(header) {
    headerSet[header] = true;
  });

  var missing = expected.filter(function(header) {
    return !headerSet[header];
  });

  var duplicates = lugFindDuplicates_(headers);

  return {
    sheet: sheetName,
    required: Boolean(requiredSheet),
    missing_sheet: false,
    headers_count: headers.length,
    rows_count: Math.max(0, sheet.getLastRow() - 1),
    missing_columns: missing,
    duplicate_columns: duplicates
  };
}

function lugFindDuplicates_(items) {
  var seen = {};
  var duplicates = {};

  items.forEach(function(item) {
    var key = String(item || "").trim();

    if (!key) return;

    if (seen[key]) {
      duplicates[key] = true;
    }

    seen[key] = true;
  });

  return Object.keys(duplicates);
}

function lugCallGetAction_(action, params) {
  lugAssert_(typeof doGet === "function", "doGet est introuvable.");

  var event = lugBuildGetEvent_(action, params || {});
  var output = doGet(event);

  return lugParseTextOutput_(output);
}

function lugCallPostAction_(action, payload) {
  lugAssert_(typeof doPost === "function", "doPost est introuvable.");

  var event = lugBuildPostEvent_(action, payload || {});
  var output = doPost(event);

  return lugParseTextOutput_(output);
}

function lugBuildGetEvent_(action, params) {
  var parameter = Object.assign({}, params || {}, {
    action: action
  });

  var parameters = {};

  Object.keys(parameter).forEach(function(key) {
    parameters[key] = [parameter[key]];
  });

  return {
    queryString: Object.keys(parameter)
      .map(function(key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(parameter[key]);
      })
      .join("&"),
    parameter: parameter,
    parameters: parameters,
    contextPath: "",
    contentLength: -1
  };
}

function lugBuildPostEvent_(action, payload) {
  var body = Object.assign({}, payload || {}, {
    action: action
  });

  var contents = JSON.stringify(body);

  return {
    parameter: {},
    parameters: {},
    postData: {
      type: "text/plain",
      contents: contents,
      length: contents.length,
      name: "postData"
    },
    contextPath: "",
    contentLength: contents.length
  };
}

function lugParseTextOutput_(output) {
  var content = "";

  if (output && typeof output.getContent === "function") {
    content = output.getContent();
  } else {
    content = String(output || "");
  }

  content = String(content || "").trim();

  if (!content) {
    throw new Error("Réponse HTTP vide.");
  }

  try {
    return JSON.parse(content);
  } catch (jsonError) {
    var match = content.match(/^[A-Za-z_$][0-9A-Za-z_$]*(?:\.[A-Za-z_$][0-9A-Za-z_$]*)*\(([\s\S]*)\);?$/);

    if (match && match[1]) {
      return JSON.parse(match[1]);
    }

    throw new Error("Réponse HTTP non JSON : " + content.slice(0, 250));
  }
}

function lugSummarizeObjectArrays_(object) {
  var summary = {};

  Object.keys(object || {}).forEach(function(key) {
    var value = object[key];

    if (Array.isArray(value)) {
      summary[key] = {
        type: "array",
        count: value.length
      };
      return;
    }

    if (value && typeof value === "object") {
      summary[key] = {
        type: "object",
        keys: Object.keys(value).slice(0, 20)
      };
      return;
    }

    summary[key] = {
      type: typeof value
    };
  });

  return summary;
}

function lugTodayIso_() {
  if (typeof todayIso === "function") {
    return todayIso();
  }

  if (typeof todayIso_ === "function") {
    return todayIso_();
  }

  var date = new Date();

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  );
}