/************************************************************
 * 07_write_bundles_metier.gs
 * ----------------------------------------------------------
 * Écritures métier hors vente rapide pure :
 *
 * - inscriptions_evenements
 * - missions_vente
 * - missions_stock
 * - journees_vente
 * - mouvements_stock
 * - frais
 * - bundles inscription → évènement confirmé
 * - bundles mission stock → journées
 * - bundle journée historique
 * - batchUpsert générique
 * - batchActions pour rejouer la file offline frontend
 *
 * Important :
 * - Les upserts n’écrivent que dans les colonnes existantes.
 * - En modification, les colonnes absentes du payload sont conservées.
 * - Les dates sont en ISO 8601.
 * - Les IDs sont générés côté frontend quand c’est possible.
 ************************************************************/

var WRITE_METIER_VERSION = "V16_WRITE_BUNDLES_METIER_SPLIT";

var WRITE_METIER_SHEETS = {
  inscriptions: "inscriptions_evenements",
  missions: "missions_vente",
  missionsStock: "missions_stock",
  journees: "journees_vente",
  mouvementsStock: "mouvements_stock",
  frais: "frais",

  stockPreparations: "stock_preparations",
  stockPreparationLines: "stock_preparation_lignes",

  clients: "clients",
  commandesPro: "commandes_pro",
  commandesProLignes: "commandes_pro_lignes",
  documents: "documents",
  referentiel: "referentiel"
};

var WRITE_METIER_KEY_FIELDS = {
  inscriptions: "inscription_id",
  missions: "mission_id",
  missionsStock: "mission_id",
  journees: "journee_id",
  mouvementsStock: "mouvement_stock_id",
  frais: "frais_id",

  stockPreparations: "preparation_id",
  stockPreparationLines: "line_id",

  clients: "client_id",
  commandesPro: "commande_id",
  commandesProLignes: "commande_ligne_id",
  documents: "document_id",
  referentiel: "referentiel_id"
};

/* ==========================================================
   Batch offline / batch générique
   ========================================================== */

function batchActions(payload) {
  payload = payload || {};

  var actions = writeMetierArray_(payload.actions);

  var results = actions.map(function(item, index) {
    var action = String(item.action || "").trim();
    var itemPayload = item.payload || {};
    var queueId = String(item.queue_id || item.queueId || item.id || "").trim();

    try {
      var data = writeMetierDispatchAction_(action, itemPayload);

      return {
        ok: true,
        queue_id: queueId,
        action: action,
        index: index,
        data: data
      };
    } catch (error) {
      return {
        ok: false,
        queue_id: queueId,
        action: action,
        index: index,
        error: error && error.message ? error.message : String(error)
      };
    }
  });

  return {
    version: WRITE_METIER_VERSION,
    results: results,
    actions_count: actions.length,
    ok_count: results.filter(function(result) {
      return result.ok === true;
    }).length,
    failed_count: results.filter(function(result) {
      return result.ok !== true;
    }).length
  };
}

function batchUpsert(payload) {
  var operations = Array.isArray(payload)
    ? payload
    : writeMetierArray_((payload || {}).operations);

  var results = operations.map(function(operation, index) {
    return writeMetierRunBatchOperation_(operation, index);
  });

  return {
    version: WRITE_METIER_VERSION,
    operations_count: operations.length,
    upsert_count: results.length,
    results: results
  };
}

function writeMetierRunBatchOperation_(operation, index) {
  operation = operation || {};

  var row =
    operation.row ||
    operation.data ||
    operation.value ||
    operation.payload ||
    {};

  var sheetKey =
    operation.sheetKey ||
    operation.sheet_key ||
    operation.table ||
    operation.tableKey ||
    operation.table_key ||
    "";

  var sheetName =
    operation.sheetName ||
    operation.sheet_name ||
    operation.sheet ||
    "";

  var keyField =
    operation.keyField ||
    operation.key_field ||
    operation.key ||
    "";

  if (!sheetKey && sheetName) {
    sheetKey = writeMetierInferSheetKeyFromName_(sheetName);
  }

  if (!sheetName) {
    sheetName = writeMetierResolveSheetName_(sheetKey);
  }

  if (!keyField) {
    keyField =
      writeMetierInferKeyFieldFromSheetKey_(sheetKey) ||
      writeMetierInferKeyFieldFromSheetName_(sheetName);
  }

  if (!sheetName) {
    throw new Error("batchUpsert opération " + index + " : onglet manquant.");
  }

  if (!keyField) {
    throw new Error("batchUpsert opération " + index + " : champ clé manquant.");
  }

  return writeMetierUpsertBySheetName_(
    sheetName,
    keyField,
    writeMetierNormalizeRow_(row)
  );
}

/* ==========================================================
   Inscriptions évènements
   ========================================================== */

function upsertInscriptionEvenement(payload) {
  payload = payload || {};

  var inscription =
    payload.inscription ||
    payload.row ||
    payload.data ||
    payload;

  var result = writeMetierSaveInscription_(inscription);

  return {
    version: WRITE_METIER_VERSION,
    inscription_id: result.key,
    inscription: result
  };
}

function saveInscriptionEvenement(payload) {
  return upsertInscriptionEvenement(payload);
}

function cancelInscriptionEvenement(payload) {
  payload = payload || {};

  var inscriptionId =
    typeof payload === "string"
      ? payload
      : String(
          payload.inscription_id ||
          payload.inscriptionId ||
          payload.id ||
          ""
        ).trim();

  if (!inscriptionId) {
    throw new Error("inscription_id manquant pour annulation.");
  }

  var result = writeMetierUpsertBySheetKey_(
    "inscriptions",
    WRITE_METIER_KEY_FIELDS.inscriptions,
    {
      inscription_id: inscriptionId,
      statut: "ANNULE",
      updated_at: writeMetierNowIso_()
    }
  );

  return {
    version: WRITE_METIER_VERSION,
    inscription_id: inscriptionId,
    inscription: result
  };
}

function saveInscriptionEventBundle(payload) {
  payload = payload || {};

  var inscription = payload.inscription || null;
  var mission =
    payload.mission ||
    payload.event ||
    payload.evenement ||
    null;

  var journees = writeMetierArray_(payload.journees);

  if (!inscription && !mission && journees.length === 0) {
    throw new Error("Bundle inscription / évènement vide.");
  }

  var missionId = String(
    mission && mission.mission_id
      ? mission.mission_id
      : inscription && inscription.evenement_id
        ? inscription.evenement_id
        : ""
  ).trim();

  if (inscription && missionId && !String(inscription.evenement_id || "").trim()) {
    inscription.evenement_id = missionId;
  }

  var inscriptionResult = inscription
    ? writeMetierSaveInscription_(inscription)
    : null;

  var missionResult = mission
    ? writeMetierSaveMission_(mission)
    : null;

  var journeeResults = journees.map(function(journee) {
    if (missionId) {
      if (!String(journee.mission_id || "").trim()) {
        journee.mission_id = missionId;
      }

      if (!String(journee.evenement_id || "").trim()) {
        journee.evenement_id = missionId;
      }
    }

    return writeMetierSaveJournee_(journee);
  });

  return {
    version: WRITE_METIER_VERSION,
    inscription_id: inscriptionResult ? inscriptionResult.key : "",
    mission_id: missionResult ? missionResult.key : missionId,
    journees_count: journeeResults.length,
    inscription: inscriptionResult,
    mission: missionResult,
    journees: journeeResults
  };
}

/* ==========================================================
   Missions vente / missions stock / journées
   ========================================================== */

function upsertMission(payload) {
  payload = payload || {};

  var mission =
    payload.mission ||
    payload.row ||
    payload.data ||
    payload;

  var result = writeMetierSaveMission_(mission);

  return {
    version: WRITE_METIER_VERSION,
    mission_id: result.key,
    mission: result
  };
}

function saveMission(payload) {
  return upsertMission(payload);
}

function upsertMissionStock(payload) {
  payload = payload || {};

  var mission =
    payload.mission ||
    payload.mission_stock ||
    payload.missionStock ||
    payload.row ||
    payload.data ||
    payload;

  var result = writeMetierSaveMissionStock_(mission);

  return {
    version: WRITE_METIER_VERSION,
    mission_id: result.key,
    mission_stock: result
  };
}

function saveMissionStock(payload) {
  return upsertMissionStock(payload);
}

function saveMissionStockBundle(payload) {
  payload = payload || {};

  var mission = payload.mission || payload.event || null;
  var missionStock =
    payload.mission_stock ||
    payload.missionStock ||
    payload.stock_mission ||
    payload.stockMission ||
    null;

  var journees = writeMetierArray_(payload.journees);

  if (!mission && !missionStock && journees.length === 0) {
    throw new Error("Bundle mission stock vide.");
  }

  var missionResult = mission
    ? writeMetierSaveMission_(mission)
    : null;

  var missionStockResult = missionStock
    ? writeMetierSaveMissionStock_(missionStock)
    : null;

  var stockMissionId = String(
    missionStock && missionStock.mission_id
      ? missionStock.mission_id
      : ""
  ).trim();

  var eventMissionId = String(
    mission && mission.mission_id
      ? mission.mission_id
      : missionStock && missionStock.evenement_id
        ? missionStock.evenement_id
        : ""
  ).trim();

  var journeeResults = journees.map(function(journee) {
    if (stockMissionId && !String(journee.stock_mission_id || "").trim()) {
      journee.stock_mission_id = stockMissionId;
    }

    if (eventMissionId && !String(journee.mission_id || "").trim()) {
      journee.mission_id = eventMissionId;
    }

    if (eventMissionId && !String(journee.evenement_id || "").trim()) {
      journee.evenement_id = eventMissionId;
    }

    return writeMetierSaveJournee_(journee);
  });

  return {
    version: WRITE_METIER_VERSION,
    mission_id: missionResult ? missionResult.key : eventMissionId,
    stock_mission_id: missionStockResult ? missionStockResult.key : stockMissionId,
    journees_count: journeeResults.length,
    mission: missionResult,
    mission_stock: missionStockResult,
    journees: journeeResults
  };
}

function upsertJournee(payload) {
  payload = payload || {};

  var journee =
    payload.journee ||
    payload.row ||
    payload.data ||
    payload;

  var result = writeMetierSaveJournee_(journee);

  return {
    version: WRITE_METIER_VERSION,
    journee_id: result.key,
    journee: result
  };
}

function saveJournee(payload) {
  return upsertJournee(payload);
}

/* ==========================================================
   Stock / mouvements / préparation
   ========================================================== */

function upsertMouvementStock(payload) {
  payload = payload || {};

  var mouvement =
    payload.mouvement ||
    payload.mouvement_stock ||
    payload.movement ||
    payload.row ||
    payload.data ||
    payload;

  var result = writeMetierSaveMouvementStock_(mouvement);

  return {
    version: WRITE_METIER_VERSION,
    mouvement_stock_id: result.key,
    mouvement_stock: result
  };
}

function saveMouvementStock(payload) {
  return upsertMouvementStock(payload);
}

function upsertStockPreparation(payload) {
  payload = payload || {};

  var preparation =
    payload.preparation ||
    payload.row ||
    payload.data ||
    payload;

  var result = writeMetierSaveStockPreparation_(preparation);

  return {
    version: WRITE_METIER_VERSION,
    preparation_id: result ? result.key : "",
    preparation: result,
    skipped: result ? false : true
  };
}

function saveStockPreparation(payload) {
  payload = payload || {};

  var preparation =
    payload.preparation ||
    payload.row ||
    payload.data ||
    payload;

  var lines = writeMetierArray_(
    payload.lignes ||
    payload.lines ||
    preparation.lignes ||
    preparation.lines
  );

  var preparationResult = null;
  var lineResults = [];

  if (writeMetierSheetExists_(writeMetierResolveSheetName_("stockPreparations"))) {
    preparationResult = writeMetierSaveStockPreparation_(preparation);
  }

  if (
    lines.length > 0 &&
    writeMetierSheetExists_(writeMetierResolveSheetName_("stockPreparationLines"))
  ) {
    lineResults = lines.map(function(line, index) {
      return writeMetierSaveStockPreparationLine_(line, preparation, index);
    });
  }

  return {
    version: WRITE_METIER_VERSION,
    preparation_id: preparationResult ? preparationResult.key : "",
    preparation: preparationResult,
    lignes_count: lineResults.length,
    lines_count: lineResults.length,
    results: lineResults,
    skipped: !preparationResult && lineResults.length === 0
  };
}

function upsertStockPreparationLine(payload) {
  payload = payload || {};

  var line =
    payload.line ||
    payload.ligne ||
    payload.row ||
    payload.data ||
    payload;

  var result = writeMetierSaveStockPreparationLine_(line, null, 0);

  return {
    version: WRITE_METIER_VERSION,
    line_id: result.key,
    line: result
  };
}

function saveStockPreparationLine(payload) {
  return upsertStockPreparationLine(payload);
}

/* ==========================================================
   Frais
   ========================================================== */

function upsertFrais(payload) {
  payload = payload || {};

  var frais =
    payload.frais ||
    payload.row ||
    payload.data ||
    payload;

  var result = writeMetierSaveFrais_(frais);

  return {
    version: WRITE_METIER_VERSION,
    frais_id: result.key,
    frais: result
  };
}

function saveFrais(payload) {
  return upsertFrais(payload);
}

/* ==========================================================
   Journée historique complète
   ========================================================== */

function saveJourneeHistoriqueBundle(payload) {
  payload = payload || {};

  var mission = payload.mission || payload.mission_vente || null;
  var missionStock =
    payload.mission_stock ||
    payload.missionStock ||
    payload.stock_mission ||
    payload.stockMission ||
    null;

  var journee = payload.journee || null;
  var transactions = writeMetierArray_(payload.transactions);
  var fraisRows = writeMetierArray_(payload.frais);

  var missionResult = mission
    ? writeMetierSaveMission_(mission)
    : null;

  var missionStockResult = missionStock
    ? writeMetierSaveMissionStock_(missionStock)
    : null;

  var journeeResult = journee
    ? writeMetierSaveJournee_(journee)
    : null;

  var transactionResults = transactions.map(function(transaction) {
    if (typeof saveTransaction === "function") {
      return saveTransaction({
        transaction: transaction
      });
    }

    return writeMetierFallbackSaveTransaction_(transaction);
  });

  var fraisResults = fraisRows.map(function(frais) {
    return writeMetierSaveFrais_(frais);
  });

  var lignesCount = transactionResults.reduce(function(sum, result) {
    return sum + Number(
      result.lignes_count ||
      result.lines_count ||
      result.ventes_lignes_count ||
      0
    );
  }, 0);

  return {
    version: WRITE_METIER_VERSION,
    mission: missionResult,
    mission_stock: missionStockResult,
    journee: journeeResult,
    transactions: transactionResults,
    frais: fraisResults,
    transactions_count: transactionResults.length,
    lignes_count: lignesCount,
    ventes_lignes_count: lignesCount,
    frais_count: fraisResults.length
  };
}

/* ==========================================================
   Helpers d’écriture typés
   ========================================================== */

function writeMetierSaveInscription_(inscription) {
  var row = writeMetierPrepareTimedRow_(inscription, "inscription_id", "INS");

  return writeMetierUpsertBySheetKey_(
    "inscriptions",
    WRITE_METIER_KEY_FIELDS.inscriptions,
    row
  );
}

function writeMetierSaveMission_(mission) {
  var row = writeMetierPrepareTimedRow_(mission, "mission_id", "EVT");

  return writeMetierUpsertBySheetKey_(
    "missions",
    WRITE_METIER_KEY_FIELDS.missions,
    row
  );
}

function writeMetierSaveMissionStock_(mission) {
  var row = writeMetierPrepareTimedRow_(mission, "mission_id", "MST");

  return writeMetierUpsertBySheetKey_(
    "missionsStock",
    WRITE_METIER_KEY_FIELDS.missionsStock,
    row
  );
}

function writeMetierSaveJournee_(journee) {
  var row = writeMetierPrepareTimedRow_(journee, "journee_id", "J");

  return writeMetierUpsertBySheetKey_(
    "journees",
    WRITE_METIER_KEY_FIELDS.journees,
    row
  );
}

function writeMetierSaveMouvementStock_(mouvement) {
  var row = writeMetierPrepareTimedRow_(mouvement, "mouvement_stock_id", "MVT");

  return writeMetierUpsertBySheetKey_(
    "mouvementsStock",
    WRITE_METIER_KEY_FIELDS.mouvementsStock,
    row
  );
}

function writeMetierSaveFrais_(frais) {
  var row = writeMetierPrepareTimedRow_(frais, "frais_id", "FR");

  return writeMetierUpsertBySheetKey_(
    "frais",
    WRITE_METIER_KEY_FIELDS.frais,
    row
  );
}

function writeMetierSaveStockPreparation_(preparation) {
  if (!preparation || typeof preparation !== "object" || Array.isArray(preparation)) {
    throw new Error("Préparation stock invalide.");
  }

  if (!writeMetierSheetExists_(writeMetierResolveSheetName_("stockPreparations"))) {
    return null;
  }

  var row = writeMetierPrepareTimedRow_(preparation, "preparation_id", "PREP");

  return writeMetierUpsertBySheetKey_(
    "stockPreparations",
    WRITE_METIER_KEY_FIELDS.stockPreparations,
    row
  );
}

function writeMetierSaveStockPreparationLine_(line, preparation, index) {
  if (!line || typeof line !== "object" || Array.isArray(line)) {
    throw new Error("Ligne de préparation stock invalide.");
  }

  var row = writeMetierClone_(line);

  if (!String(row.preparation_id || "").trim() && preparation) {
    row.preparation_id = String(preparation.preparation_id || "").trim();
  }

  if (!String(row.line_id || "").trim()) {
    row.line_id =
      "PREPL_" +
      String(row.preparation_id || "NO_PREP") +
      "_" +
      String(index + 1).padStart(2, "0");
  }

  row = writeMetierPrepareTimedRow_(row, "line_id", "PREPL");

  return writeMetierUpsertBySheetKey_(
    "stockPreparationLines",
    WRITE_METIER_KEY_FIELDS.stockPreparationLines,
    row
  );
}

/* ==========================================================
   Fallback minimal transaction si 06 n’est pas chargé
   ========================================================== */

function writeMetierFallbackSaveTransaction_(transaction) {
  if (!transaction || typeof transaction !== "object" || Array.isArray(transaction)) {
    throw new Error("Transaction invalide.");
  }

  var row = writeMetierCloneWithoutKeys_(transaction, [
    "lignes",
    "lines",
    "ventes_lignes",
    "ventesLignes"
  ]);

  row = writeMetierPrepareTimedRow_(row, "transaction_id", "TX");

  var transactionResult = writeMetierUpsertBySheetName_(
    writeMetierResolveSheetName_("transactions") || "transactions",
    "transaction_id",
    row
  );

  return {
    version: WRITE_METIER_VERSION,
    transaction_id: transactionResult.key,
    transaction: transactionResult,
    lignes_count: 0,
    ventes_lignes_count: 0,
    fallback: true
  };
}

/* ==========================================================
   Dispatcher batchActions
   ========================================================== */

function writeMetierDispatchAction_(action, payload) {
  switch (action) {
    case "batchUpsert":
      return batchUpsert(payload);

    case "upsertInscriptionEvenement":
    case "saveInscriptionEvenement":
      return upsertInscriptionEvenement(payload);

    case "cancelInscriptionEvenement":
      return cancelInscriptionEvenement(payload);

    case "saveInscriptionEventBundle":
      return saveInscriptionEventBundle(payload);

    case "upsertMission":
    case "saveMission":
      return upsertMission(payload);

    case "upsertMissionStock":
    case "saveMissionStock":
      return upsertMissionStock(payload);

    case "saveMissionStockBundle":
      return saveMissionStockBundle(payload);

    case "upsertJournee":
    case "saveJournee":
      return upsertJournee(payload);

    case "upsertMouvementStock":
    case "saveMouvementStock":
      return upsertMouvementStock(payload);

    case "upsertStockPreparation":
      return upsertStockPreparation(payload);

    case "saveStockPreparation":
      return saveStockPreparation(payload);

    case "upsertStockPreparationLine":
    case "saveStockPreparationLine":
      return upsertStockPreparationLine(payload);

    case "upsertFrais":
    case "saveFrais":
      return upsertFrais(payload);

    case "saveJourneeHistoriqueBundle":
      return saveJourneeHistoriqueBundle(payload);

    case "saveTransaction":
    case "upsertTransaction":
      if (typeof saveTransaction === "function") {
        return saveTransaction(payload);
      }
      return writeMetierFallbackSaveTransaction_(
        payload.transaction || payload.row || payload.data || payload
      );

    case "saveVenteLigne":
      if (typeof saveVenteLigne === "function") {
        return saveVenteLigne(payload);
      }
      throw new Error("saveVenteLigne indisponible : fichier 06 requis.");

    case "saveVentesLignes":
      if (typeof saveVentesLignes === "function") {
        return saveVentesLignes(payload);
      }
      throw new Error("saveVentesLignes indisponible : fichier 06 requis.");

    case "saveVenteRapideBundle":
      if (typeof saveVenteRapideBundle === "function") {
        return saveVenteRapideBundle(payload);
      }
      throw new Error("saveVenteRapideBundle indisponible : fichier 06 requis.");

    case "saveCloture":
    case "saveClotureJournee":
      if (typeof saveCloture === "function") {
        return saveCloture(payload);
      }
      throw new Error("saveCloture indisponible : fichier 06 requis.");

    default:
      throw new Error("Action POST inconnue : " + action);
  }
}

/* ==========================================================
   Upsert Sheets robuste
   ========================================================== */

function writeMetierUpsertBySheetKey_(sheetKey, keyField, row) {
  var sheetName = writeMetierResolveSheetName_(sheetKey);

  return writeMetierUpsertBySheetName_(sheetName, keyField, row);
}

function writeMetierUpsertBySheetName_(sheetName, keyField, row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Ligne à écrire invalide.");
  }

  var safeSheetName = String(sheetName || "").trim();
  var safeKeyField = String(keyField || "").trim();

  if (!safeSheetName) {
    throw new Error("Nom d’onglet manquant.");
  }

  if (!safeKeyField) {
    throw new Error("Champ clé manquant.");
  }

  var keyValue = String(row[safeKeyField] || "").trim();

  if (!keyValue) {
    throw new Error("Valeur clé manquante pour " + safeKeyField + ".");
  }

  var sheet = writeMetierGetSheetByName_(safeSheetName);
  var headers = writeMetierGetHeaders_(sheet);

  if (headers.length === 0) {
    throw new Error("L’onglet " + safeSheetName + " n’a pas d’en-têtes.");
  }

  if (headers.indexOf(safeKeyField) < 0) {
    throw new Error(
      "Colonne clé manquante dans " +
      safeSheetName +
      " : " +
      safeKeyField
    );
  }

  var existing = writeMetierFindExistingRowByKey_(
    sheet,
    headers,
    safeKeyField,
    keyValue
  );

  var mergedRow = existing.rowObject
    ? writeMetierMergeRows_(existing.rowObject, row)
    : row;

  var values = headers.map(function(header) {
    return writeMetierSerializeCellValue_(mergedRow[header]);
  });

  if (existing.rowNumber > 0) {
    sheet.getRange(existing.rowNumber, 1, 1, headers.length).setValues([values]);

    return {
      ok: true,
      action: "update",
      sheet_name: safeSheetName,
      key_field: safeKeyField,
      key: keyValue,
      row_number: existing.rowNumber
    };
  }

  sheet.appendRow(values);

  return {
    ok: true,
    action: "insert",
    sheet_name: safeSheetName,
    key_field: safeKeyField,
    key: keyValue,
    row_number: sheet.getLastRow()
  };
}

function writeMetierFindExistingRowByKey_(sheet, headers, keyField, keyValue) {
  var keyIndex = headers.indexOf(keyField);

  if (keyIndex < 0) {
    return {
      rowNumber: -1,
      rowObject: null
    };
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return {
      rowNumber: -1,
      rowObject: null
    };
  }

  var keyValues = sheet
    .getRange(2, keyIndex + 1, lastRow - 1, 1)
    .getValues();

  var needle = String(keyValue || "").trim();

  for (var index = 0; index < keyValues.length; index += 1) {
    var current = String(keyValues[index][0] || "").trim();

    if (current !== needle) continue;

    var rowNumber = index + 2;
    var rowValues = sheet
      .getRange(rowNumber, 1, 1, headers.length)
      .getValues()[0];

    var rowObject = {};

    headers.forEach(function(header, headerIndex) {
      rowObject[header] = rowValues[headerIndex];
    });

    return {
      rowNumber: rowNumber,
      rowObject: rowObject
    };
  }

  return {
    rowNumber: -1,
    rowObject: null
  };
}

function writeMetierGetHeaders_(sheet) {
  var lastColumn = sheet.getLastColumn();

  if (lastColumn <= 0) return [];

  return sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0]
    .map(function(header, index) {
      var key = String(header || "").trim();

      return key || "col_" + String(index + 1);
    });
}

/* ==========================================================
   Résolution onglets / clés
   ========================================================== */

function writeMetierResolveSheetName_(sheetKey) {
  var key = String(sheetKey || "").trim();

  if (
    typeof SHEETS !== "undefined" &&
    SHEETS &&
    SHEETS[key]
  ) {
    return SHEETS[key];
  }

  return WRITE_METIER_SHEETS[key] || key;
}

function writeMetierInferSheetKeyFromName_(sheetName) {
  var safeName = String(sheetName || "").trim();

  var found = Object.keys(WRITE_METIER_SHEETS).find(function(key) {
    return WRITE_METIER_SHEETS[key] === safeName;
  });

  return found || safeName;
}

function writeMetierInferKeyFieldFromSheetKey_(sheetKey) {
  var key = String(sheetKey || "").trim();

  return WRITE_METIER_KEY_FIELDS[key] || "";
}

function writeMetierInferKeyFieldFromSheetName_(sheetName) {
  var safeName = String(sheetName || "").trim();

  if (safeName === "inscriptions_evenements") return "inscription_id";
  if (safeName === "missions_vente") return "mission_id";
  if (safeName === "missions_stock") return "mission_id";
  if (safeName === "journees_vente") return "journee_id";
  if (safeName === "mouvements_stock") return "mouvement_stock_id";
  if (safeName === "frais") return "frais_id";
  if (safeName === "clients") return "client_id";
  if (safeName === "commandes_pro") return "commande_id";
  if (safeName === "commandes_pro_lignes") return "commande_ligne_id";
  if (safeName === "documents") return "document_id";
  if (safeName === "referentiel") return "referentiel_id";

  return "";
}

function writeMetierGetSheetByName_(sheetName) {
  var spreadsheet = writeMetierGetSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("Onglet introuvable : " + sheetName);
  }

  return sheet;
}

function writeMetierSheetExists_(sheetName) {
  try {
    var spreadsheet = writeMetierGetSpreadsheet_();
    return Boolean(spreadsheet.getSheetByName(sheetName));
  } catch (error) {
    return false;
  }
}

function writeMetierGetSpreadsheet_() {
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

/* ==========================================================
   Normalisation / utilitaires
   ========================================================== */

function writeMetierPrepareTimedRow_(row, keyField, prefix) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Ligne invalide.");
  }

  var now = writeMetierNowIso_();
  var output = writeMetierNormalizeRow_(row);
  var safeKeyField = String(keyField || "").trim();

  if (!String(output[safeKeyField] || "").trim()) {
    output[safeKeyField] = writeMetierBuildId_(prefix || "ROW");
  }

  output[safeKeyField] = String(output[safeKeyField] || "").trim();

  if (!String(output.created_at || "").trim()) {
    output.created_at = now;
  }

  output.updated_at = now;

  return output;
}

function writeMetierNormalizeRow_(row) {
  var output = {};

  Object.keys(row || {}).forEach(function(key) {
    var safeKey = String(key || "").trim();

    if (!safeKey) return;

    output[safeKey] = row[key];
  });

  return output;
}

function writeMetierMergeRows_(existing, patch) {
  var output = writeMetierClone_(existing);

  Object.keys(patch || {}).forEach(function(key) {
    output[key] = patch[key];
  });

  return output;
}

function writeMetierSerializeCellValue_(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
}

function writeMetierClone_(value) {
  var output = {};

  Object.keys(value || {}).forEach(function(key) {
    output[key] = value[key];
  });

  return output;
}

function writeMetierCloneWithoutKeys_(value, keys) {
  var ignored = {};
  var output = {};

  writeMetierArray_(keys).forEach(function(key) {
    ignored[key] = true;
  });

  Object.keys(value || {}).forEach(function(key) {
    if (ignored[key]) return;
    output[key] = value[key];
  });

  return output;
}

function writeMetierArray_(value) {
  return Array.isArray(value) ? value : [];
}

function writeMetierNowIso_() {
  return new Date().toISOString();
}

function writeMetierBuildId_(prefix) {
  return (
    String(prefix || "ROW").toUpperCase() +
    "_" +
    Date.now() +
    "_" +
    Math.random().toString(36).slice(2, 8).toUpperCase()
  );
}