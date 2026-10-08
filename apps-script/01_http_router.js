/*
  01_http_router.gs

  Routeur HTTP principal API Lugdurum.

  Responsabilités :
  - exposer doGet(e) et doPost(e) ;
  - gérer les réponses JSON et JSONP ;
  - router les actions GET vers les fonctions de lecture ;
  - router les actions POST vers les fonctions métier / upsert ;
  - gérer batchActions pour la file d’attente offline frontend ;
  - retourner des réponses normalisées { ok, data, error }.

  Dépendances attendues :
  - 00_config.gs :
    SHEETS, API_VERSION, GET_ACTIONS, EMPTY_GET_ACTIONS,
    CORE_DATA_TABLES, EMPTY_CORE_TABLES, SHEET_CONFIG.
  - Fichiers suivants :
    readSheetRows_()
    getCoreData_()
    getHomeData_()
    getRecettesData_()
    batchUpsert_()
    upsertRowByConfig_()
    saveTransaction_()
    saveVenteRapideBundle() ou saveVenteRapideBundle_()
    saveInscriptionEventBundle_()
    saveMissionStockBundle_()
    saveJourneeHistoriqueBundle_()
    saveCloture_()
*/

const POST_UPSERT_ACTIONS = {
  upsertInscriptionEvenement: {
    tableKey: "inscriptions",
    payloadKeys: ["inscription", "data", "row"]
  },

  upsertMission: {
    tableKey: "missions",
    payloadKeys: ["mission", "event", "data", "row"]
  },

  upsertMissionStock: {
    tableKey: "missionsStock",
    payloadKeys: ["mission", "mission_stock", "missionStock", "data", "row"]
  },

  upsertJournee: {
    tableKey: "journees",
    payloadKeys: ["journee", "data", "row"]
  },

  upsertMouvementStock: {
    tableKey: "mouvementsStock",
    payloadKeys: ["mouvement", "movement", "data", "row"]
  },

  upsertFrais: {
    tableKey: "frais",
    payloadKeys: ["frais", "expense", "data", "row"]
  },

  upsertClient: {
    tableKey: "clients",
    payloadKeys: ["client", "data", "row"]
  },

  upsertCommandePro: {
    tableKey: "commandesPro",
    payloadKeys: ["commande", "commande_pro", "order", "data", "row"]
  },

  upsertCommandeProLigne: {
    tableKey: "commandesProLignes",
    payloadKeys: ["ligne", "commande_ligne", "line", "data", "row"]
  },

  upsertDocument: {
    tableKey: "documents",
    payloadKeys: ["document", "documentRow", "data", "row"]
  },

  upsertRecette: {
    tableKey: "recettes",
    payloadKeys: ["recette", "data", "row"]
  },

  upsertRecetteIngredient: {
    tableKey: "recettesIngredients",
    payloadKeys: ["recetteIngredient", "recette_ingredient", "ingredient", "data", "row"]
  },

  upsertIngredient: {
    tableKey: "ingredients",
    payloadKeys: ["ingredient", "data", "row"]
  },

  upsertCuvee: {
    tableKey: "cuvees",
    payloadKeys: ["cuvee", "data", "row"]
  },

  upsertCuveeIngredientReel: {
    tableKey: "cuveesIngredientsReels",
    payloadKeys: ["cuveeIngredient", "cuvee_ingredient", "ingredient", "data", "row"]
  },

  upsertMatierePremiere: {
    tableKey: "matieresPremieres",
    payloadKeys: ["matiere", "matierePremiere", "matiere_premiere", "data", "row"]
  },

  upsertMatieresLot: {
    tableKey: "matieresLots",
    payloadKeys: ["lot", "matiereLot", "matiere_lot", "data", "row"]
  },

  upsertCuveeMatiereConsommee: {
    tableKey: "cuveesMatieresConsommees",
    payloadKeys: ["conso", "consommation", "matiereConsommee", "data", "row"]
  },

  upsertMouvementMatiere: {
    tableKey: "mouvementsMatieres",
    payloadKeys: ["mouvement", "mouvementMatiere", "data", "row"]
  }
};

/* ==============================
   Entrées Apps Script
   ============================== */

function doGet(e) {
  return handleHttpGet_(e || {});
}

function doPost(e) {
  return handleHttpPost_(e || {});
}

/* ==============================
   GET
   ============================== */

function handleHttpGet_(e) {
  const params = normalizeRequestParams_(e);
  const action = String(params.action || "ping").trim();

  try {
    const data = invokeGetAction_(action, params);

    return outputHttpResult_(
      normalizeActionResult_(data, action),
      params
    );
  } catch (error) {
    return outputHttpResult_(
      buildErrorResult_(error, {
        method: "GET",
        action
      }),
      params
    );
  }
}

function invokeGetAction_(action, params) {
  if (!action || action === "ping") {
    return buildPingData_("GET");
  }

  if (action === "getSpreadsheetInfo") {
    return getSpreadsheetInfoData_();
  }

  if (action === "getCoreData") {
    const tables = parseListParam_(
      params.tables ||
      params.table ||
      params.sheet ||
      ""
    );

    return callRequiredFunction_("getCoreData_", tables, params);
  }

  if (action === "getHomeData") {
    return callRequiredFunction_("getHomeData_", params);
  }

  if (action === "getRecettesData") {
    const view = String(params.view || params.vue || "dashboard").trim();

    return callRequiredFunction_("getRecettesData_", view, params);
  }

  if (Object.prototype.hasOwnProperty.call(GET_ACTIONS, action)) {
    return callRequiredFunction_("readSheetRows_", GET_ACTIONS[action]);
  }

  if (Object.prototype.hasOwnProperty.call(EMPTY_GET_ACTIONS, action)) {
    return [];
  }

  throw new Error(`Action GET inconnue : ${action}`);
}

/* ==============================
   POST
   ============================== */

function handleHttpPost_(e) {
  const params = normalizeRequestParams_(e);

  try {
    const body = parsePostBody_(e);
    const action = String(body.action || params.action || "").trim();

    if (!action) {
      throw new Error("Action POST manquante.");
    }

    const payload = cloneWithoutKeys_(body, ["action", "callback", "_"]);
    const data = invokePostAction_(action, payload, {
      method: "POST",
      action
    });

    return outputHttpResult_(
      normalizeActionResult_(data, action),
      params
    );
  } catch (error) {
    return outputHttpResult_(
      buildErrorResult_(error, {
        method: "POST",
        action: params.action || ""
      }),
      params
    );
  }
}

function invokePostAction_(action, payload, context) {
  if (!action || action === "ping") {
    return buildPingData_("POST");
  }

  if (action === "batchActions") {
    return handleBatchActions_(payload);
  }

  if (action === "batchUpsert") {
    return handleBatchUpsert_(payload);
  }

  if (action === "list") {
    return handleGenericList_(payload);
  }

  if (action === "upsert") {
    return handleGenericUpsert_(payload);
  }

  if (action === "cancelInscriptionEvenement") {
    return callRequiredFunction_(
      "cancelInscriptionEvenement_",
      payload.inscription_id || payload.inscriptionId || payload.id || ""
    );
  }

  if (action === "saveInscriptionEventBundle") {
    return callRequiredFunction_("saveInscriptionEventBundle_", payload);
  }

  if (action === "saveMissionStockBundle") {
    return callRequiredFunction_("saveMissionStockBundle_", payload);
  }

  if (action === "saveTransaction") {
    return callRequiredFunction_(
      "saveTransaction_",
      payload.transaction || payload.data || payload.row || {}
    );
  }

  if (action === "saveVenteRapideBundle") {
    return callFirstAvailableFunction_(
      ["saveVenteRapideBundle_", "saveVenteRapideBundle"],
      payload
    );
  }

  if (action === "saveCloture") {
    return callRequiredFunction_(
      "saveCloture_",
      payload.cloture || payload.data || payload.row || {}
    );
  }

  if (action === "saveJourneeHistoriqueBundle") {
    return callRequiredFunction_("saveJourneeHistoriqueBundle_", payload);
  }

  if (action === "saveStockPreparation") {
    return callRequiredFunction_(
      "saveStockPreparation_",
      payload.preparation || payload.data || payload.row || {}
    );
  }

  if (action === "upsertStockPreparation") {
    return callRequiredFunction_(
      "upsertStockPreparation_",
      payload.preparation || payload.data || payload.row || {}
    );
  }

  if (action === "upsertStockPreparationLine") {
    return callRequiredFunction_(
      "upsertStockPreparationLine_",
      payload.line || payload.ligne || payload.data || payload.row || {}
    );
  }

  const upsertSpec = POST_UPSERT_ACTIONS[action];

  if (upsertSpec) {
    const row = pickFirstPayloadValue_(payload, upsertSpec.payloadKeys);

    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`Payload invalide pour ${action}.`);
    }

    return callRequiredFunction_(
      "upsertRowByConfig_",
      upsertSpec.tableKey,
      row
    );
  }

  throw new Error(`Action POST inconnue : ${action}`);
}

/* ==============================
   Batch
   ============================== */

function handleBatchActions_(payload) {
  const actions = Array.isArray(payload.actions)
    ? payload.actions
    : [];

  if (actions.length === 0) {
    return {
      results: [],
      batch_count: 0
    };
  }

  const results = actions.map((item, index) => {
    const queueId = String(item.queue_id || item.queueId || item.id || "").trim();
    const action = String(item.action || "").trim();
    const actionPayload =
      item.payload && typeof item.payload === "object"
        ? item.payload
        : {};

    try {
      if (!action) {
        throw new Error(`Action manquante dans batchActions à l’index ${index}.`);
      }

      const data = invokePostAction_(action, actionPayload, {
        method: "POST",
        action,
        queue_id: queueId,
        batch_index: index
      });

      return {
        ok: true,
        queue_id: queueId,
        action,
        data
      };
    } catch (error) {
      return {
        ok: false,
        queue_id: queueId,
        action,
        error: error && error.message ? error.message : String(error)
      };
    }
  });

  return {
    results,
    batch_count: results.length,
    success_count: results.filter((item) => item.ok).length,
    error_count: results.filter((item) => !item.ok).length
  };
}

function handleBatchUpsert_(payload) {
  const operations = Array.isArray(payload.operations)
    ? payload.operations
    : [];

  if (operations.length === 0) {
    return {
      ok: true,
      skipped: true,
      operations_count: 0,
      results: []
    };
  }

  return callRequiredFunction_("batchUpsert_", operations);
}

/* ==============================
   Génériques list / upsert
   ============================== */

function handleGenericList_(payload) {
  const tableKey = String(
    payload.tableKey ||
    payload.sheetKey ||
    payload.table ||
    payload.sheet ||
    ""
  ).trim();

  if (!tableKey) {
    throw new Error("Table manquante pour l’action list.");
  }

  if (Object.prototype.hasOwnProperty.call(CORE_DATA_TABLES, tableKey)) {
    return callRequiredFunction_("readSheetRows_", CORE_DATA_TABLES[tableKey]);
  }

  if (Object.prototype.hasOwnProperty.call(SHEETS, tableKey)) {
    return callRequiredFunction_("readSheetRows_", SHEETS[tableKey]);
  }

  throw new Error(`Table inconnue pour list : ${tableKey}`);
}

function handleGenericUpsert_(payload) {
  const tableKey = String(
    payload.tableKey ||
    payload.sheetKey ||
    payload.table ||
    payload.sheet ||
    ""
  ).trim();

  const row = payload.data || payload.row || payload.item || null;

  if (!tableKey) {
    throw new Error("Table manquante pour l’action upsert.");
  }

  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Donnée invalide pour l’action upsert.");
  }

  return callRequiredFunction_("upsertRowByConfig_", tableKey, row);
}

/* ==============================
   Réponses HTTP
   ============================== */

function outputHttpResult_(result, params) {
  const safeResult = result && typeof result === "object"
    ? result
    : normalizeActionResult_(result, params.action || "");

  const callback = String(params.callback || "").trim();
  const json = JSON.stringify(safeResult);

  if (callback) {
    if (!isValidJsonpCallback_(callback)) {
      return ContentService
        .createTextOutput(JSON.stringify({
          ok: false,
          error: "Callback JSONP invalide."
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(`${callback}(${json});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeActionResult_(data, action) {
  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Object.prototype.hasOwnProperty.call(data, "ok")
  ) {
    if (!Object.prototype.hasOwnProperty.call(data, "action")) {
      data.action = action;
    }

    if (!Object.prototype.hasOwnProperty.call(data, "version")) {
      data.version = getApiVersion_();
    }

    if (!Object.prototype.hasOwnProperty.call(data, "generated_at")) {
      data.generated_at = new Date().toISOString();
    }

    return data;
  }

  return {
    ok: true,
    action,
    version: getApiVersion_(),
    generated_at: new Date().toISOString(),
    data
  };
}

function buildErrorResult_(error, context) {
  const message = error && error.message
    ? error.message
    : String(error || "Erreur inconnue");

  return {
    ok: false,
    action: context && context.action ? context.action : "",
    method: context && context.method ? context.method : "",
    version: getApiVersion_(),
    generated_at: new Date().toISOString(),
    error: message
  };
}

/* ==============================
   Helpers requête
   ============================== */

function normalizeRequestParams_(e) {
  const params = {};

  if (e && e.parameter && typeof e.parameter === "object") {
    Object.keys(e.parameter).forEach((key) => {
      params[key] = e.parameter[key];
    });
  }

  if (e && e.parameters && typeof e.parameters === "object") {
    Object.keys(e.parameters).forEach((key) => {
      const value = e.parameters[key];

      if (
        params[key] === undefined &&
        Array.isArray(value) &&
        value.length > 0
      ) {
        params[key] = value.length === 1 ? value[0] : value.join(",");
      }
    });
  }

  return params;
}

function parsePostBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  const raw = String(e.postData.contents || "").trim();

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Le corps POST doit être un objet JSON.");
    }

    return parsed;
  } catch (error) {
    throw new Error(`Corps POST JSON invalide : ${error.message}`);
  }
}

function parseListParam_(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cloneWithoutKeys_(object, keys) {
  const copy = {};

  Object.keys(object || {}).forEach((key) => {
    if (!keys.includes(key)) {
      copy[key] = object[key];
    }
  });

  return copy;
}

function pickFirstPayloadValue_(payload, keys) {
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];

    if (payload && payload[key] !== undefined && payload[key] !== null) {
      return payload[key];
    }
  }

  return null;
}

/* ==============================
   Helpers globaux
   ============================== */

function callRequiredFunction_(functionName) {
  const fn = globalThis[functionName];

  if (typeof fn !== "function") {
    throw new Error(`Fonction serveur manquante : ${functionName}`);
  }

  const args = Array.prototype.slice.call(arguments, 1);

  return fn.apply(null, args);
}

function callFirstAvailableFunction_(functionNames) {
  const names = Array.isArray(functionNames)
    ? functionNames
    : [functionNames];

  for (let index = 0; index < names.length; index += 1) {
    const functionName = names[index];
    const fn = globalThis[functionName];

    if (typeof fn === "function") {
      const args = Array.prototype.slice.call(arguments, 1);
      return fn.apply(null, args);
    }
  }

  throw new Error(`Fonction serveur manquante : ${names.join(" ou ")}`);
}

function getApiVersion_() {
  if (typeof API_VERSION !== "undefined") {
    return API_VERSION;
  }

  return "DEV";
}

function buildPingData_(method) {
  return {
    pong: true,
    method,
    version: getApiVersion_(),
    timestamp: new Date().toISOString()
  };
}

function getSpreadsheetInfoData_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  return {
    spreadsheet_id: spreadsheet.getId(),
    spreadsheet_name: spreadsheet.getName(),
    sheets: spreadsheet
      .getSheets()
      .map((sheet) => ({
        name: sheet.getName(),
        last_row: sheet.getLastRow(),
        last_column: sheet.getLastColumn()
      })),
    version: getApiVersion_(),
    timestamp: new Date().toISOString()
  };
}

function isValidJsonpCallback_(callback) {
  return /^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(
    String(callback || "")
  );
}