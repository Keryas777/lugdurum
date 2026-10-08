/************************************************************
 * 06_write_bundles_vente.gs
 * ----------------------------------------------------------
 * Écritures liées à la vente terrain :
 *
 * - saveTransaction()
 * - upsertTransaction()
 * - saveVenteLigne()
 * - saveVentesLignes()
 * - saveVenteRapideBundle()
 * - saveCloture()
 *
 * Objectifs :
 * - enregistrer une transaction dans transactions ;
 * - enregistrer automatiquement ses lignes dans ventes_lignes ;
 * - permettre à vente-rapide.js d'écrire en UNE SEULE action :
 *   transaction + lignes + mouvements_stock + patches métier optionnels ;
 * - éviter de relire / réécrire mouvements_stock côté frontend ;
 * - retourner lignes_count / ventes_lignes_count / mouvements_stock_count ;
 * - supporter les paiements historiques avec transactions sans lignes ;
 * - supporter les lignes annulées lors des modifications historiques ;
 * - rester compatible avec les colonnes existantes : seules les colonnes
 *   présentes dans le Sheet sont écrites ;
 * - préserver les anciennes valeurs lors d’un update partiel.
 ************************************************************/

var WRITE_VENTE_VERSION = "V17_WRITE_BUNDLES_VENTE_SINGLE_ACTION";

var WRITE_VENTE_SHEETS = {
  transactions: "transactions",
  ventesLignes: "ventes_lignes",
  mouvementsStock: "mouvements_stock",
  clotures: "clotures_journees",
  journees: "journees_vente",
  missionsStock: "missions_stock"
};

var WRITE_VENTE_KEY_FIELDS = {
  transactions: "transaction_id",
  ventesLignes: "ligne_id",
  mouvementsStock: "mouvement_stock_id",
  clotures: "cloture_id",
  journees: "journee_id",
  missionsStock: "mission_id"
};

/* ==========================================================
   Actions publiques appelées par le routeur POST
   ========================================================== */

function saveTransaction(payload) {
  return writeVenteWithLock_(function () {
    payload = payload || {};

    var transaction =
      payload.transaction ||
      payload.row ||
      payload.data ||
      payload;

    return writeVenteSaveTransaction_(transaction, {
      source_action: "saveTransaction"
    });
  });
}

function upsertTransaction(payload) {
  return saveTransaction(payload);
}

function saveVenteLigne(payload) {
  return writeVenteWithLock_(function () {
    payload = payload || {};

    var line =
      payload.ligne ||
      payload.line ||
      payload.row ||
      payload.data ||
      payload;

    var batch = writeVenteSaveLinesBatch_([line], null);

    return {
      version: WRITE_VENTE_VERSION,
      ligne_id: batch.results[0] ? batch.results[0].key : "",
      lignes_count: batch.results.length,
      ventes_lignes_count: batch.results.length,
      result: batch.results[0] || null
    };
  });
}

function saveVentesLignes(payload) {
  return writeVenteWithLock_(function () {
    payload = payload || {};

    var lignes = writeVenteArray_(
      payload.lignes ||
      payload.lines ||
      payload.ventes_lignes ||
      payload.ventesLignes ||
      payload.rows ||
      payload.data ||
      []
    );

    var batch = writeVenteSaveLinesBatch_(lignes, null);

    return {
      version: WRITE_VENTE_VERSION,
      lignes_count: batch.results.length,
      ventes_lignes_count: batch.results.length,
      results: batch.results
    };
  });
}

/**
 * Bundle optimisé pour la vente rapide.
 *
 * Payload conseillé :
 * {
 *   transaction: {
 *     transaction_id: "...",
 *     ...,
 *     lignes: [...]
 *   },
 *   mouvements_stock: [...],     // optionnel
 *   journee: {...},              // optionnel
 *   mission_stock: {...},        // optionnel
 *   cloture: {...}               // optionnel
 * }
 *
 * Si mouvements_stock n’est PAS fourni, le bundle génère automatiquement
 * les sorties de stock à partir des lignes de transaction validée.
 *
 * Ainsi le frontend peut faire :
 * - 1 seul appel API ;
 * - aucune écriture batchUpsert séparée pour mouvements_stock ;
 * - pas de double décrément.
 */
function saveVenteRapideBundle(payload) {
  return writeVenteWithLock_(function () {
    payload = payload || {};

    var transactionInput =
      payload.transaction ||
      payload.ticket ||
      payload.row ||
      payload.data ||
      null;

    if (
      transactionInput &&
      writeVenteArray_(payload.lignes || payload.lines || payload.ventes_lignes || payload.ventesLignes).length > 0 &&
      writeVenteExtractLines_(transactionInput).length === 0
    ) {
      transactionInput = writeVenteClone_(transactionInput);
      transactionInput.lignes = writeVenteArray_(
        payload.lignes ||
        payload.lines ||
        payload.ventes_lignes ||
        payload.ventesLignes
      );
    }

    var transactionResult = null;
    var mouvementsResults = [];
    var mouvementsRows = [];

    var journeesResults = [];
    var missionStockResults = [];
    var clotureResult = null;

    if (transactionInput) {
      transactionResult = writeVenteSaveTransaction_(transactionInput, {
        source_action: "saveVenteRapideBundle"
      });
    }

    var explicitMouvements = writeVenteArray_(
      payload.mouvements_stock ||
      payload.mouvementsStock ||
      payload.stock_movements ||
      payload.stockMovements ||
      payload.movements ||
      []
    );

    var shouldWriteMovements =
      payload.write_mouvements_stock !== false &&
      payload.writeMouvementsStock !== false &&
      payload.skip_mouvements_stock !== true &&
      payload.skipStockMovements !== true;

    if (shouldWriteMovements) {
      if (explicitMouvements.length > 0) {
        mouvementsRows = explicitMouvements.map(function (movement) {
          return writeVenteNormalizeStockMovement_(movement);
        });
      } else if (
        transactionResult &&
        writeVenteShouldCreateStockMovementsForTransaction_(transactionResult.transaction_row)
      ) {
        mouvementsRows = writeVenteBuildStockMovementsFromTransaction_(
          transactionResult.transaction_row,
          transactionResult.lignes_rows
        );
      }

      if (mouvementsRows.length > 0) {
        mouvementsResults = writeVenteUpsertManyByKey_(
          "mouvementsStock",
          WRITE_VENTE_KEY_FIELDS.mouvementsStock,
          mouvementsRows
        );
      }
    }

    var journeesRows = [];

    if (payload.journee) {
      journeesRows.push(payload.journee);
    }

    writeVenteArray_(payload.journees || payload.days).forEach(function (journee) {
      journeesRows.push(journee);
    });

    if (journeesRows.length > 0) {
      journeesResults = writeVenteUpsertManyByKey_(
        "journees",
        WRITE_VENTE_KEY_FIELDS.journees,
        journeesRows.map(writeVenteNormalizeRow_)
      );
    }

    var missionStockRows = [];

    if (payload.mission_stock || payload.missionStock) {
      missionStockRows.push(payload.mission_stock || payload.missionStock);
    }

    writeVenteArray_(payload.missions_stock || payload.missionsStock).forEach(function (missionStock) {
      missionStockRows.push(missionStock);
    });

    if (missionStockRows.length > 0) {
      missionStockResults = writeVenteUpsertManyByKey_(
        "missionsStock",
        WRITE_VENTE_KEY_FIELDS.missionsStock,
        missionStockRows.map(writeVenteNormalizeRow_)
      );
    }

    if (payload.cloture) {
      clotureResult = writeVenteSaveCloture_(payload.cloture);
    }

    return {
      ok: true,
      version: WRITE_VENTE_VERSION,
      source_action: "saveVenteRapideBundle",

      transaction_id: transactionResult ? transactionResult.transaction_id : "",
      transaction: transactionResult,

      lignes_count: transactionResult ? transactionResult.lignes_count : 0,
      lines_count: transactionResult ? transactionResult.lines_count : 0,
      ventes_lignes_count: transactionResult ? transactionResult.ventes_lignes_count : 0,
      ventesLignes_count: transactionResult ? transactionResult.ventesLignes_count : 0,

      mouvements_stock_count: mouvementsResults.length,
      mouvementsStock_count: mouvementsResults.length,
      mouvements_results: mouvementsResults,

      journees_count: journeesResults.length,
      journee: journeesResults[0] || null,
      journees: journeesResults,

      missions_stock_count: missionStockResults.length,
      mission_stock: missionStockResults[0] || null,
      missions_stock: missionStockResults,

      cloture: clotureResult,

      single_action: true,
      mouvements_stock_auto_generated:
        shouldWriteMovements &&
        explicitMouvements.length === 0 &&
        mouvementsRows.length > 0
    };
  });
}

function saveCloture(payload) {
  return writeVenteWithLock_(function () {
    payload = payload || {};

    var cloture =
      payload.cloture ||
      payload.row ||
      payload.data ||
      payload;

    var clotureResult = writeVenteSaveCloture_(cloture);
    var journeeResult = null;
    var missionStockResult = null;

    if (payload.journee) {
      journeeResult = writeVenteUpsertByKey_(
        "journees",
        WRITE_VENTE_KEY_FIELDS.journees,
        writeVenteNormalizeRow_(payload.journee)
      );
    }

    if (payload.mission_stock || payload.missionStock) {
      missionStockResult = writeVenteUpsertByKey_(
        "missionsStock",
        WRITE_VENTE_KEY_FIELDS.missionsStock,
        writeVenteNormalizeRow_(payload.mission_stock || payload.missionStock)
      );
    }

    return {
      version: WRITE_VENTE_VERSION,
      cloture_id: clotureResult.key,
      cloture: clotureResult,
      journee: journeeResult,
      mission_stock: missionStockResult
    };
  });
}

function saveClotureJournee(payload) {
  return saveCloture(payload);
}

/* ==========================================================
   Transaction + lignes
   ========================================================== */

function writeVenteSaveTransaction_(transaction, options) {
  options = options || {};

  if (!transaction || typeof transaction !== "object" || Array.isArray(transaction)) {
    throw new Error("Transaction invalide.");
  }

  var prepared = writeVentePrepareTransaction_(transaction);
  var transactionRow = prepared.transactionRow;
  var lignes = prepared.lignes;

  var transactionResult = writeVenteUpsertByKey_(
    "transactions",
    WRITE_VENTE_KEY_FIELDS.transactions,
    writeVenteNormalizeRow_(transactionRow)
  );

  var linesBatch = writeVenteSaveLinesBatch_(lignes, transactionRow);

  return {
    version: WRITE_VENTE_VERSION,
    source_action: options.source_action || "saveTransaction",
    transaction_id: transactionRow.transaction_id,
    transaction: transactionResult,

    lignes_count: linesBatch.results.length,
    lines_count: linesBatch.results.length,
    ventes_lignes_count: linesBatch.results.length,
    ventesLignes_count: linesBatch.results.length,

    results: linesBatch.results,

    transaction_row: transactionRow,
    lignes_rows: linesBatch.rows
  };
}

function writeVentePrepareTransaction_(transaction) {
  var now = writeVenteNowIso_();
  var lignes = writeVenteExtractLines_(transaction);

  var transactionRow = writeVenteCloneWithoutKeys_(transaction, [
    "lignes",
    "lines",
    "ventes_lignes",
    "ventesLignes"
  ]);

  if (!String(transactionRow.transaction_id || "").trim()) {
    transactionRow.transaction_id = "TX_" + Date.now() + "_" + writeVenteRandomSuffix_();
  }

  transactionRow.transaction_id = String(transactionRow.transaction_id || "").trim();

  if (!String(transactionRow.date_heure || "").trim()) {
    transactionRow.date_heure = now;
  }

  if (!String(transactionRow.created_at || "").trim()) {
    transactionRow.created_at = now;
  }

  transactionRow.updated_at = now;

  if (
    transactionRow.detail_ticket &&
    typeof transactionRow.detail_ticket === "object"
  ) {
    transactionRow.detail_ticket = JSON.stringify(transactionRow.detail_ticket);
  }

  if (!String(transactionRow.statut || "").trim()) {
    transactionRow.statut = "validee";
  }

  return {
    transactionRow: transactionRow,
    lignes: lignes
  };
}

function writeVenteSaveLine_(line, transactionRow, index) {
  var batch = writeVenteSaveLinesBatch_([line], transactionRow || null, index || 0);

  if (!batch.results[0]) {
    throw new Error("Ligne de vente non écrite.");
  }

  return batch.results[0];
}

function writeVenteSaveLinesBatch_(lignes, transactionRow, startIndex) {
  lignes = writeVenteArray_(lignes);
  startIndex = Number(startIndex || 0);

  var now = writeVenteNowIso_();

  var rows = lignes
    .filter(writeVenteShouldWriteLine_)
    .map(function (line, index) {
      return writeVenteNormalizeLine_(
        line,
        transactionRow || null,
        startIndex + index,
        now
      );
    });

  if (rows.length === 0) {
    return {
      rows: [],
      results: []
    };
  }

  return {
    rows: rows,
    results: writeVenteUpsertManyByKey_(
      "ventesLignes",
      WRITE_VENTE_KEY_FIELDS.ventesLignes,
      rows.map(writeVenteNormalizeRow_)
    )
  };
}

function writeVenteNormalizeLine_(line, transactionRow, index, now) {
  if (!line || typeof line !== "object" || Array.isArray(line)) {
    throw new Error("Ligne de vente invalide.");
  }

  transactionRow = transactionRow || {};
  now = now || writeVenteNowIso_();

  var row = writeVenteClone_(line);
  var transactionId = String(
    row.transaction_id ||
    transactionRow.transaction_id ||
    ""
  ).trim();

  if (!transactionId) {
    transactionId = "TX_" + Date.now() + "_" + writeVenteRandomSuffix_();
  }

  if (!String(row.ligne_id || "").trim()) {
    row.ligne_id =
      transactionId +
      "_L" +
      String(Number(index || 0) + 1).padStart(2, "0");
  }

  row.ligne_id = String(row.ligne_id || "").trim();
  row.transaction_id = transactionId;

  if (!String(row.mission_id || "").trim()) {
    row.mission_id = String(transactionRow.mission_id || "").trim();
  }

  if (!String(row.stock_mission_id || "").trim()) {
    row.stock_mission_id = String(
      transactionRow.stock_mission_id ||
      transactionRow.mission_stock_id ||
      transactionRow.mission_id ||
      ""
    ).trim();
  }

  if (!String(row.evenement_id || "").trim()) {
    row.evenement_id = String(
      transactionRow.evenement_id ||
      transactionRow.event_id ||
      ""
    ).trim();
  }

  if (!String(row.journee_id || "").trim()) {
    row.journee_id = String(transactionRow.journee_id || "").trim();
  }

  if (!String(row.source || "").trim()) {
    row.source = String(transactionRow.source || "WEBAPP").trim();
  }

  if (!String(row.created_at || "").trim()) {
    row.created_at = now;
  }

  row.updated_at = now;

  if (!String(row.statut || "").trim()) {
    row.statut = "valide";
  }

  return row;
}

function writeVenteExtractLines_(transaction) {
  if (!transaction || typeof transaction !== "object") {
    return [];
  }

  var candidates = [
    transaction.lignes,
    transaction.lines,
    transaction.ventes_lignes,
    transaction.ventesLignes
  ];

  for (var index = 0; index < candidates.length; index += 1) {
    var value = candidates[index];

    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      try {
        var parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (error) {
        // Ce champ peut être un détail ticket texte : on ignore.
      }
    }
  }

  return [];
}

function writeVenteShouldWriteLine_(line) {
  if (!line || typeof line !== "object" || Array.isArray(line)) {
    return false;
  }

  return Boolean(
    String(line.ligne_id || "").trim() ||
    String(line.sku_id || "").trim() ||
    String(line.parfum_code || "").trim()
  );
}

/* ==========================================================
   Mouvements stock générés depuis transaction
   ========================================================== */

function writeVenteBuildStockMovementsFromTransaction_(transactionRow, lignesRows) {
  transactionRow = transactionRow || {};
  lignesRows = writeVenteArray_(lignesRows);

  var now = writeVenteNowIso_();
  var transactionId = String(transactionRow.transaction_id || "").trim();

  return lignesRows
    .filter(writeVenteShouldCreateStockMovementForLine_)
    .map(function (line) {
      var ligneId = String(line.ligne_id || "").trim();

      return writeVenteNormalizeStockMovement_({
        mouvement_stock_id: "MVT_" + ligneId + "_VENTE",
        date_heure: transactionRow.date_heure || now,

        mission_id: transactionRow.mission_id || "",
        stock_mission_id:
          transactionRow.stock_mission_id ||
          transactionRow.mission_stock_id ||
          transactionRow.mission_id ||
          "",
        journee_id: transactionRow.journee_id || "",

        type_mouvement: "vente",
        sens: "SORTIE",

        sku_id: line.sku_id || "",
        parfum_code: line.parfum_code || "",
        parfum_nom: line.parfum_nom || "",
        format_cl: line.format_cl || "",

        quantite: writeVenteToNumber_(line.quantite, 0),

        source: transactionRow.source || line.source || "WEBAPP",
        source_id: transactionRow.source_id || transactionId,
        transaction_id: transactionId,
        ligne_id: ligneId,

        statut: "valide",
        note: line.note || "",
        user_id: transactionRow.user_id || line.user_id || "",

        created_at: line.created_at || now,
        updated_at: now
      });
    });
}

function writeVenteShouldCreateStockMovementsForTransaction_(transactionRow) {
  if (!transactionRow || typeof transactionRow !== "object") {
    return false;
  }

  if (writeVenteIsCancelledStatus_(transactionRow.statut)) {
    return false;
  }

  var statut = writeVenteNormalizeStatus_(transactionRow.statut);
  var paiementStatut = writeVenteNormalizeStatus_(transactionRow.paiement_statut);

  if (
    [
      "paiement_en_attente",
      "sumup_lance",
      "en_attente",
      "attente"
    ].indexOf(statut) >= 0
  ) {
    return false;
  }

  if (
    [
      "paiement_en_attente",
      "sumup_lance",
      "en_attente",
      "attente"
    ].indexOf(paiementStatut) >= 0
  ) {
    return false;
  }

  if (
    [
      "validee",
      "valide",
      "validee",
      "valide",
      "cloture",
      "cloturee"
    ].indexOf(statut) >= 0
  ) {
    return true;
  }

  if (
    [
      "paye",
      "payee",
      "payé",
      "payée"
    ].indexOf(String(transactionRow.paiement_statut || "").trim().toLowerCase()) >= 0
  ) {
    return true;
  }

  return false;
}

function writeVenteShouldCreateStockMovementForLine_(line) {
  if (!line || typeof line !== "object" || Array.isArray(line)) {
    return false;
  }

  if (writeVenteIsCancelledStatus_(line.statut)) {
    return false;
  }

  if (!String(line.ligne_id || "").trim()) {
    return false;
  }

  if (!String(line.sku_id || "").trim() && !String(line.parfum_code || "").trim()) {
    return false;
  }

  return writeVenteToNumber_(line.quantite, 0) > 0;
}

function writeVenteNormalizeStockMovement_(movement) {
  var now = writeVenteNowIso_();
  var row = writeVenteClone_(movement || {});

  if (!String(row.mouvement_stock_id || "").trim()) {
    var baseId = [
      row.transaction_id,
      row.ligne_id,
      row.sku_id,
      "VENTE"
    ]
      .map(function (value) {
        return String(value || "").trim();
      })
      .filter(Boolean)
      .join("_");

    row.mouvement_stock_id = baseId
      ? "MVT_" + baseId
      : "MVT_VENTE_" + Date.now() + "_" + writeVenteRandomSuffix_();
  }

  row.mouvement_stock_id = String(row.mouvement_stock_id || "").trim();

  if (!String(row.date_heure || "").trim()) {
    row.date_heure = now;
  }

  if (!String(row.type_mouvement || "").trim()) {
    row.type_mouvement = "vente";
  }

  if (!String(row.sens || "").trim()) {
    row.sens = "SORTIE";
  }

  if (!String(row.statut || "").trim()) {
    row.statut = "valide";
  }

  if (!String(row.created_at || "").trim()) {
    row.created_at = now;
  }

  row.updated_at = now;

  return writeVenteNormalizeRow_(row);
}

/* ==========================================================
   Clôture
   ========================================================== */

function writeVenteSaveCloture_(cloture) {
  if (!cloture || typeof cloture !== "object" || Array.isArray(cloture)) {
    throw new Error("Clôture invalide.");
  }

  var now = writeVenteNowIso_();
  var row = writeVenteClone_(cloture);

  if (!String(row.cloture_id || "").trim()) {
    var journeeId = String(row.journee_id || "").trim();

    row.cloture_id = journeeId
      ? "CLOT_" + journeeId
      : "CLOT_" + Date.now() + "_" + writeVenteRandomSuffix_();
  }

  if (!String(row.created_at || "").trim()) {
    row.created_at = now;
  }

  row.updated_at = now;

  if (!String(row.closed_at || "").trim()) {
    row.closed_at = now;
  }

  return writeVenteUpsertByKey_(
    "clotures",
    WRITE_VENTE_KEY_FIELDS.clotures,
    writeVenteNormalizeRow_(row)
  );
}

/* ==========================================================
   Upsert Sheets robuste
   ========================================================== */

function writeVenteUpsertByKey_(sheetKey, keyField, row) {
  var results = writeVenteUpsertManyByKey_(sheetKey, keyField, [row]);

  if (!results[0]) {
    throw new Error("Aucune ligne écrite dans " + sheetKey + ".");
  }

  return results[0];
}

function writeVenteUpsertManyByKey_(sheetKey, keyField, rows) {
  rows = writeVenteArray_(rows)
    .filter(function (row) {
      return row && typeof row === "object" && !Array.isArray(row);
    })
    .map(writeVenteNormalizeRow_);

  if (rows.length === 0) {
    return [];
  }

  var safeKeyField = String(keyField || "").trim();

  if (!safeKeyField) {
    throw new Error("Champ clé manquant pour upsert.");
  }

  var sheet = writeVenteGetSheet_(sheetKey);
  var headers = writeVenteGetHeaders_(sheet);

  if (headers.length === 0) {
    throw new Error("L’onglet " + sheet.getName() + " n’a pas d’en-têtes.");
  }

  if (headers.indexOf(safeKeyField) < 0) {
    throw new Error(
      "Colonne clé manquante dans " +
      sheet.getName() +
      " : " +
      safeKeyField
    );
  }

  var existingRowNumbers = writeVenteBuildRowNumberMapByKey_(
    sheet,
    headers,
    safeKeyField
  );

  var results = [];
  var appendValues = [];
  var appendIndexes = [];

  rows.forEach(function (row, index) {
    var keyValue = String(row[safeKeyField] || "").trim();

    if (!keyValue) {
      throw new Error("Valeur clé manquante pour " + safeKeyField + ".");
    }

    var rowNumber = existingRowNumbers[keyValue] || -1;

    if (rowNumber > 0) {
      var existingValues = writeVenteGetExistingRowValues_(
        sheet,
        rowNumber,
        headers.length
      );

      var updateValues = writeVenteBuildValuesForRow_(
        headers,
        row,
        existingValues
      );

      sheet
        .getRange(rowNumber, 1, 1, headers.length)
        .setValues([updateValues]);

      results[index] = {
        ok: true,
        action: "update",
        sheet_key: sheetKey,
        sheet_name: sheet.getName(),
        key_field: safeKeyField,
        key: keyValue,
        row_number: rowNumber
      };

      return;
    }

    appendIndexes.push(index);
    appendValues.push(
      writeVenteBuildValuesForRow_(headers, row, null)
    );

    results[index] = {
      ok: true,
      action: "insert",
      sheet_key: sheetKey,
      sheet_name: sheet.getName(),
      key_field: safeKeyField,
      key: keyValue,
      row_number: 0
    };
  });

  if (appendValues.length > 0) {
    var startRow = sheet.getLastRow() + 1;

    sheet
      .getRange(startRow, 1, appendValues.length, headers.length)
      .setValues(appendValues);

    appendIndexes.forEach(function (originalIndex, appendIndex) {
      results[originalIndex].row_number = startRow + appendIndex;
    });
  }

  return results;
}

function writeVenteBuildValuesForRow_(headers, row, existingValues) {
  return headers.map(function (header, index) {
    if (writeVenteHasOwn_(row, header)) {
      return writeVenteSerializeCellValue_(row[header]);
    }

    if (existingValues && index < existingValues.length) {
      return existingValues[index];
    }

    return "";
  });
}

function writeVenteGetExistingRowValues_(sheet, rowNumber, width) {
  if (!rowNumber || rowNumber < 2) {
    return [];
  }

  return sheet
    .getRange(rowNumber, 1, 1, width)
    .getValues()[0];
}

function writeVenteBuildRowNumberMapByKey_(sheet, headers, keyField) {
  var map = {};
  var keyIndex = headers.indexOf(keyField);

  if (keyIndex < 0) return map;

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) return map;

  var values = sheet
    .getRange(2, keyIndex + 1, lastRow - 1, 1)
    .getValues();

  values.forEach(function (row, index) {
    var key = String(row[0] || "").trim();

    if (!key) return;

    map[key] = index + 2;
  });

  return map;
}

function writeVenteGetHeaders_(sheet) {
  var lastColumn = sheet.getLastColumn();

  if (lastColumn <= 0) return [];

  return sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0]
    .map(function (header, index) {
      var key = String(header || "").trim();

      return key || "col_" + String(index + 1);
    });
}

function writeVenteGetSheet_(sheetKey) {
  var spreadsheet = writeVenteGetSpreadsheet_();
  var sheetName = writeVenteResolveSheetName_(sheetKey);
  var sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("Onglet introuvable : " + sheetName);
  }

  return sheet;
}

function writeVenteResolveSheetName_(sheetKey) {
  var key = String(sheetKey || "").trim();

  if (
    typeof SHEETS !== "undefined" &&
    SHEETS &&
    SHEETS[key]
  ) {
    return SHEETS[key];
  }

  return WRITE_VENTE_SHEETS[key] || key;
}

function writeVenteGetSpreadsheet_() {
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
   Normalisation locale
   ========================================================== */

function writeVenteNormalizeRow_(row) {
  var output = {};

  Object.keys(row || {}).forEach(function (key) {
    var safeKey = String(key || "").trim();

    if (!safeKey) return;

    output[safeKey] = row[key];
  });

  return output;
}

function writeVenteSerializeCellValue_(value) {
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

function writeVenteClone_(value) {
  var output = {};

  Object.keys(value || {}).forEach(function (key) {
    output[key] = value[key];
  });

  return output;
}

function writeVenteCloneWithoutKeys_(value, keys) {
  var ignored = {};
  var output = {};

  writeVenteArray_(keys).forEach(function (key) {
    ignored[key] = true;
  });

  Object.keys(value || {}).forEach(function (key) {
    if (ignored[key]) return;
    output[key] = value[key];
  });

  return output;
}

function writeVenteArray_(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    try {
      var parsed = JSON.parse(value);

      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (error) {
      return [];
    }
  }

  return [];
}

function writeVenteHasOwn_(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function writeVenteNowIso_() {
  return new Date().toISOString();
}

function writeVenteRandomSuffix_() {
  return Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase();
}

function writeVenteToNumber_(value, fallback) {
  if (typeof value === "number" && isFinite(value)) {
    return value;
  }

  var normalized = String(value === null || value === undefined ? "" : value)
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");

  if (!normalized) return fallback;

  var number = Number(normalized);

  return isFinite(number) ? number : fallback;
}

function writeVenteNormalizeStatus_(value) {
  return String(value === null || value === undefined ? "" : value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-\s]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function writeVenteIsCancelledStatus_(status) {
  var normalized = writeVenteNormalizeStatus_(status);

  return [
    "annule",
    "annulee",
    "annulé",
    "annulée",
    "refuse",
    "refusee",
    "refusé",
    "refusée"
  ].indexOf(normalized) >= 0;
}

function writeVenteWithLock_(callback) {
  var lock = null;

  try {
    lock = LockService.getScriptLock();
    lock.waitLock(25000);

    return callback();
  } finally {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (error) {
        // Rien à faire : l’écriture est déjà terminée ou le lock expiré.
      }
    }
  }
}