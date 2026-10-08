/*
  02_sheets_core.gs

  Cœur Google Sheets pour l’API Lugdurum.

  Responsabilités :
  - lire les lignes d’un onglet en objets JS ;
  - écrire / mettre à jour une ligne par clé métier ;
  - ajouter les colonnes manquantes à la fin, sans casser l’ordre existant ;
  - exécuter batchUpsert_() pour les écritures groupées ;
  - exposer getCoreData_() pour les lectures multi-onglets.

  Dépendances attendues :
  - 00_config.gs :
    SHEETS, SHEET_CONFIG, CORE_DATA_TABLES, EMPTY_CORE_TABLES.
  - 01_http_router.gs :
    appelle readSheetRows_(), getCoreData_(), upsertRowByConfig_(), batchUpsert_().
*/

/* ==============================
   Fallbacks de sécurité
   ============================== */

const FALLBACK_SHEETS_CORE = {
  catalogue: "catalogue",
  offresVente: "offres_vente",

  inscriptions: "inscriptions_evenements",

  missions: "missions_vente",
  missionsStock: "missions_stock",
  journees: "journees_vente",

  mouvementsStock: "mouvements_stock",

  transactions: "transactions",
  ventesLignes: "ventes_lignes",
  frais: "frais",

  clotures: "clotures_journees",

  clients: "clients",
  commandesPro: "commandes_pro",
  commandesProLignes: "commandes_pro_lignes",
  documents: "documents",
  referentiel: "referentiel",

  recettes: "recettes",
  recettesIngredients: "recettes_ingredients",
  ingredients: "ingredients",
  cuvees: "cuvees",
  cuveesIngredientsReels: "cuvees_ingredients_reels",

  matieresPremieres: "matieres_premieres",
  matieresLots: "matieres_lots",
  cuveesMatieresConsommees: "cuvees_matieres_consommees",
  mouvementsMatieres: "mouvements_matieres",

  stockPreparations: "stock_preparations",
  stockPreparationLines: "stock_preparation_lines"
};

const FALLBACK_SHEET_CONFIG_CORE = {
  catalogue: {
    sheetName: "catalogue",
    keyField: "sku_id"
  },

  offresVente: {
    sheetName: "offres_vente",
    keyField: "offre_id"
  },

  inscriptions: {
    sheetName: "inscriptions_evenements",
    keyField: "inscription_id"
  },

  missions: {
    sheetName: "missions_vente",
    keyField: "mission_id"
  },

  missionsStock: {
    sheetName: "missions_stock",
    keyField: "mission_id"
  },

  journees: {
    sheetName: "journees_vente",
    keyField: "journee_id"
  },

  mouvementsStock: {
    sheetName: "mouvements_stock",
    keyField: "mouvement_stock_id"
  },

  transactions: {
    sheetName: "transactions",
    keyField: "transaction_id"
  },

  ventesLignes: {
    sheetName: "ventes_lignes",
    keyField: "ligne_id"
  },

  frais: {
    sheetName: "frais",
    keyField: "frais_id"
  },

  clotures: {
    sheetName: "clotures_journees",
    keyField: "cloture_id"
  },

  clients: {
    sheetName: "clients",
    keyField: "client_id"
  },

  commandesPro: {
    sheetName: "commandes_pro",
    keyField: "commande_id"
  },

  commandesProLignes: {
    sheetName: "commandes_pro_lignes",
    keyField: "commande_ligne_id"
  },

  documents: {
    sheetName: "documents",
    keyField: "document_id"
  },

  referentiel: {
    sheetName: "referentiel",
    keyField: "referentiel_id"
  },

  recettes: {
    sheetName: "recettes",
    keyField: "recette_id"
  },

  recettesIngredients: {
    sheetName: "recettes_ingredients",
    keyField: "recette_ingredient_id"
  },

  ingredients: {
    sheetName: "ingredients",
    keyField: "ingredient_id"
  },

  cuvees: {
    sheetName: "cuvees",
    keyField: "cuvee_id"
  },

  cuveesIngredientsReels: {
    sheetName: "cuvees_ingredients_reels",
    keyField: "cuvee_ingredient_reel_id"
  },

  matieresPremieres: {
    sheetName: "matieres_premieres",
    keyField: "matiere_id"
  },

  matieresLots: {
    sheetName: "matieres_lots",
    keyField: "lot_id"
  },

  cuveesMatieresConsommees: {
    sheetName: "cuvees_matieres_consommees",
    keyField: "consommation_id"
  },

  mouvementsMatieres: {
    sheetName: "mouvements_matieres",
    keyField: "mouvement_matiere_id"
  },

  stockPreparations: {
    sheetName: "stock_preparations",
    keyField: "preparation_id"
  },

  stockPreparationLines: {
    sheetName: "stock_preparation_lines",
    keyField: "preparation_ligne_id"
  }
};

/* ==============================
   Lecture publique interne
   ============================== */

function readSheetRows_(tableKeyOrSheetName, options) {
  const sheetName = resolveSheetName_(tableKeyOrSheetName);
  const sheet = getRequiredSheet_(sheetName);
  const headers = getSheetHeaders_(sheet);

  if (headers.length === 0) {
    return [];
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  const lastColumn = headers.length;
  const values = sheet
    .getRange(2, 1, lastRow - 1, lastColumn)
    .getValues();

  const includeEmptyRows = Boolean(options && options.includeEmptyRows);

  return values
    .map((rowValues, index) => {
      const row = {};

      headers.forEach((header, columnIndex) => {
        if (!header) return;

        row[header] = normalizeReadValue_(
          rowValues[columnIndex],
          header
        );
      });

      if (options && options.includeRowNumber) {
        row.__row_number = index + 2;
      }

      return row;
    })
    .filter((row) => {
      if (includeEmptyRows) return true;

      return Object.keys(row).some((key) => {
        if (key === "__row_number") return false;

        const value = row[key];

        return value !== "" && value !== null && value !== undefined;
      });
    });
}

function getCoreData_(tables, params) {
  const requestedTables = normalizeTableList_(tables);
  const coreMap = getCoreDataTableMap_();

  const tableKeys = requestedTables.length > 0
    ? requestedTables
    : Object.keys(coreMap);

  const result = {};

  tableKeys.forEach((requestedKey) => {
    const safeRequestedKey = String(requestedKey || "").trim();

    if (!safeRequestedKey) return;

    if (isEmptyCoreTable_(safeRequestedKey)) {
      result[safeRequestedKey] = [];
      return;
    }

    const sheetName = resolveCoreTableSheetName_(safeRequestedKey);

    if (!sheetName) {
      result[safeRequestedKey] = [];
      return;
    }

    result[safeRequestedKey] = readSheetRows_(sheetName);
  });

  return result;
}

/* ==============================
   Écriture publique interne
   ============================== */

function upsertRowByConfig_(tableKeyOrSheetName, row, forcedKeyField) {
  return withDocumentLock_(function () {
    return upsertRowInternal_(tableKeyOrSheetName, row, {
      forcedKeyField: forcedKeyField || ""
    });
  });
}

function batchUpsert_(operations) {
  const safeOperations = Array.isArray(operations) ? operations : [];

  if (safeOperations.length === 0) {
    return {
      ok: true,
      operations_count: 0,
      results: []
    };
  }

  return withDocumentLock_(function () {
    const results = [];

    for (let index = 0; index < safeOperations.length; index += 1) {
      const operation = safeOperations[index];

      try {
        const normalized = normalizeBatchOperation_(operation);

        const result = upsertRowInternal_(
          normalized.tableKeyOrSheetName,
          normalized.row,
          {
            forcedKeyField: normalized.keyField
          }
        );

        results.push({
          ok: true,
          index,
          action: normalized.action,
          sheet_name: result.sheet_name,
          table_key: result.table_key,
          key_field: result.key_field,
          key_value: result.key_value,
          row_number: result.row_number,
          inserted: result.inserted,
          updated: result.updated
        });
      } catch (error) {
        throw new Error(
          `batchUpsert bloqué à l’opération ${index + 1}/${safeOperations.length} : ${error.message}`
        );
      }
    }

    return {
      ok: true,
      operations_count: safeOperations.length,
      success_count: results.length,
      results
    };
  });
}

/* ==============================
   Upsert interne
   ============================== */

function upsertRowInternal_(tableKeyOrSheetName, row, options) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Ligne invalide pour upsert.");
  }

  const config = resolveSheetConfig_(tableKeyOrSheetName, options);
  const sheet = getRequiredSheet_(config.sheetName);

  const keyField = String(config.keyField || "").trim();

  if (!keyField) {
    throw new Error(`Champ clé introuvable pour ${tableKeyOrSheetName}.`);
  }

  const keyValue = String(row[keyField] || "").trim();

  if (!keyValue) {
    throw new Error(`Valeur manquante pour la clé ${keyField} dans ${config.sheetName}.`);
  }

  const headers = ensureHeadersForRow_(sheet, row, keyField);
  const keyColumnIndex = headers.indexOf(keyField);

  if (keyColumnIndex < 0) {
    throw new Error(`Colonne clé ${keyField} introuvable dans ${config.sheetName}.`);
  }

  const existingRowNumber = findRowNumberByKey_(
    sheet,
    keyColumnIndex + 1,
    keyValue
  );

  if (existingRowNumber) {
    const existingValues = sheet
      .getRange(existingRowNumber, 1, 1, headers.length)
      .getValues()[0];

    const mergedRow = mergeExistingRowWithPatch_(
      headers,
      existingValues,
      row
    );

    const nextValues = buildSheetRowValues_(headers, mergedRow);

    sheet
      .getRange(existingRowNumber, 1, 1, headers.length)
      .setValues([nextValues]);

    return {
      ok: true,
      inserted: false,
      updated: true,
      table_key: config.tableKey,
      sheet_name: config.sheetName,
      key_field: keyField,
      key_value: keyValue,
      row_number: existingRowNumber
    };
  }

  const nextValues = buildSheetRowValues_(headers, row);

  sheet.appendRow(nextValues);

  return {
    ok: true,
    inserted: true,
    updated: false,
    table_key: config.tableKey,
    sheet_name: config.sheetName,
    key_field: keyField,
    key_value: keyValue,
    row_number: sheet.getLastRow()
  };
}

function normalizeBatchOperation_(operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new Error("Opération batch invalide.");
  }

  const row =
    operation.row ||
    operation.data ||
    operation.item ||
    null;

  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Ligne absente dans une opération batch.");
  }

  const tableKeyOrSheetName = String(
    operation.tableKey ||
    operation.sheetKey ||
    operation.table_key ||
    operation.sheet_key ||
    operation.sheet ||
    operation.sheetName ||
    operation.sheet_name ||
    ""
  ).trim();

  if (!tableKeyOrSheetName) {
    throw new Error("Onglet / table manquant dans une opération batch.");
  }

  const keyField = String(
    operation.keyField ||
    operation.key_field ||
    operation.key ||
    ""
  ).trim();

  return {
    action: String(operation.action || operation.type || "upsert").trim(),
    tableKeyOrSheetName,
    keyField,
    row
  };
}

/* ==============================
   Gestion des colonnes
   ============================== */

function getSheetHeaders_(sheet) {
  const lastColumn = sheet.getLastColumn();

  if (lastColumn < 1) {
    return [];
  }

  return sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0]
    .map((header) => String(header || "").trim());
}

function ensureHeadersForRow_(sheet, row, keyField) {
  let headers = getSheetHeaders_(sheet);

  if (headers.length === 0) {
    const initialHeaders = Object.keys(row || {}).filter(Boolean);

    if (initialHeaders.indexOf(keyField) < 0) {
      initialHeaders.unshift(keyField);
    }

    sheet
      .getRange(1, 1, 1, initialHeaders.length)
      .setValues([initialHeaders]);

    return initialHeaders;
  }

  const headerSet = new Set(headers.filter(Boolean));
  const missingHeaders = [];

  Object.keys(row || {}).forEach((key) => {
    const safeKey = String(key || "").trim();

    if (!safeKey) return;
    if (safeKey.startsWith("__")) return;

    if (!headerSet.has(safeKey)) {
      headerSet.add(safeKey);
      missingHeaders.push(safeKey);
    }
  });

  if (missingHeaders.length > 0) {
    const startColumn = headers.length + 1;

    sheet
      .getRange(1, startColumn, 1, missingHeaders.length)
      .setValues([missingHeaders]);

    headers = headers.concat(missingHeaders);
  }

  return headers;
}

function buildSheetRowValues_(headers, row) {
  return headers.map((header) => {
    if (!header) return "";

    if (!Object.prototype.hasOwnProperty.call(row, header)) {
      return "";
    }

    return normalizeWriteValue_(row[header]);
  });
}

function mergeExistingRowWithPatch_(headers, existingValues, patch) {
  const merged = {};

  headers.forEach((header, index) => {
    if (!header) return;

    merged[header] = existingValues[index];
  });

  Object.keys(patch || {}).forEach((key) => {
    if (String(key || "").startsWith("__")) return;

    const value = patch[key];

    if (value === undefined) return;

    merged[key] = value;
  });

  return merged;
}

function findRowNumberByKey_(sheet, keyColumn, keyValue) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return 0;

  const values = sheet
    .getRange(2, keyColumn, lastRow - 1, 1)
    .getValues();

  const wanted = String(keyValue || "").trim();

  for (let index = 0; index < values.length; index += 1) {
    const current = String(values[index][0] || "").trim();

    if (current === wanted) {
      return index + 2;
    }
  }

  return 0;
}

/* ==============================
   Normalisation valeurs
   ============================== */

function normalizeReadValue_(value, header) {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    return formatDateForHeader_(value, header);
  }

  return value;
}

function normalizeWriteValue_(value) {
  if (value === undefined || value === null) return "";

  if (value instanceof Date) return value;

  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
}

function formatDateForHeader_(date, header) {
  const safeHeader = normalizeLookupKey_(header);
  const timezone = getSpreadsheetTimezone_();

  const looksLikeDateOnly =
    safeHeader === "date" ||
    safeHeader === "date_debut" ||
    safeHeader === "date_fin" ||
    safeHeader.startsWith("date_") &&
      !safeHeader.includes("heure") &&
      !safeHeader.endsWith("_at");

  if (looksLikeDateOnly) {
    return Utilities.formatDate(date, timezone, "yyyy-MM-dd");
  }

  return Utilities.formatDate(date, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function getSpreadsheetTimezone_() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  } catch {
    return Session.getScriptTimeZone() || "Europe/Paris";
  }
}

/* ==============================
   Résolution tables / onglets
   ============================== */

function resolveSheetConfig_(tableKeyOrSheetName, options) {
  const raw = String(tableKeyOrSheetName || "").trim();

  if (!raw) {
    throw new Error("Table ou onglet manquant.");
  }

  const tableKey = resolveTableKey_(raw);
  const sheetName = resolveSheetName_(raw);
  const config = getConfigForTableOrSheet_(raw);

  const forcedKeyField = String(options?.forcedKeyField || "").trim();

  return {
    tableKey,
    sheetName,
    keyField:
      forcedKeyField ||
      config.keyField ||
      inferKeyFieldFromSheetName_(sheetName)
  };
}

function resolveSheetName_(tableKeyOrSheetName) {
  const raw = String(tableKeyOrSheetName || "").trim();

  if (!raw) {
    throw new Error("Nom d’onglet manquant.");
  }

  const config = getConfigForTableOrSheet_(raw);

  if (config.sheetName) {
    return config.sheetName;
  }

  const sheetsMap = getSheetsMap_();

  if (Object.prototype.hasOwnProperty.call(sheetsMap, raw)) {
    return sheetsMap[raw];
  }

  const normalizedRaw = normalizeLookupKey_(raw);

  const directSheetName = findValueByNormalizedKey_(sheetsMap, normalizedRaw);

  if (directSheetName) {
    return directSheetName;
  }

  const existingSheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(raw);

  if (existingSheet) {
    return raw;
  }

  throw new Error(`Onglet inconnu : ${raw}`);
}

function resolveTableKey_(tableKeyOrSheetName) {
  const raw = String(tableKeyOrSheetName || "").trim();

  if (!raw) return "";

  const sheetsMap = getSheetsMap_();
  const normalizedRaw = normalizeLookupKey_(raw);

  const directKey = Object.keys(sheetsMap).find(
    (key) => normalizeLookupKey_(key) === normalizedRaw
  );

  if (directKey) return directKey;

  const bySheetName = Object.keys(sheetsMap).find(
    (key) => normalizeLookupKey_(sheetsMap[key]) === normalizedRaw
  );

  if (bySheetName) return bySheetName;

  const configMap = getSheetConfigMap_();

  const byConfigKey = Object.keys(configMap).find(
    (key) => normalizeLookupKey_(key) === normalizedRaw
  );

  if (byConfigKey) return byConfigKey;

  const byConfigSheetName = Object.keys(configMap).find((key) => {
    const config = configMap[key] || {};
    return normalizeLookupKey_(config.sheetName || config.sheet || "") === normalizedRaw;
  });

  if (byConfigSheetName) return byConfigSheetName;

  return raw;
}

function getConfigForTableOrSheet_(tableKeyOrSheetName) {
  const raw = String(tableKeyOrSheetName || "").trim();
  const normalizedRaw = normalizeLookupKey_(raw);
  const configMap = getSheetConfigMap_();

  const directKey = Object.keys(configMap).find(
    (key) => normalizeLookupKey_(key) === normalizedRaw
  );

  if (directKey) {
    return normalizeSheetConfigObject_(directKey, configMap[directKey]);
  }

  const bySheetName = Object.keys(configMap).find((key) => {
    const config = configMap[key] || {};
    return normalizeLookupKey_(config.sheetName || config.sheet || config.name || "") === normalizedRaw;
  });

  if (bySheetName) {
    return normalizeSheetConfigObject_(bySheetName, configMap[bySheetName]);
  }

  const sheetsMap = getSheetsMap_();

  const sheetKey = Object.keys(sheetsMap).find(
    (key) =>
      normalizeLookupKey_(key) === normalizedRaw ||
      normalizeLookupKey_(sheetsMap[key]) === normalizedRaw
  );

  if (sheetKey) {
    return {
      tableKey: sheetKey,
      sheetName: sheetsMap[sheetKey],
      keyField: inferKeyFieldFromSheetName_(sheetsMap[sheetKey])
    };
  }

  return {
    tableKey: raw,
    sheetName: raw,
    keyField: inferKeyFieldFromSheetName_(raw)
  };
}

function normalizeSheetConfigObject_(tableKey, config) {
  const safeConfig = config || {};

  return {
    tableKey,
    sheetName:
      safeConfig.sheetName ||
      safeConfig.sheet_name ||
      safeConfig.sheet ||
      safeConfig.name ||
      "",
    keyField:
      safeConfig.keyField ||
      safeConfig.key_field ||
      safeConfig.key ||
      ""
  };
}

function getSheetsMap_() {
  const runtimeSheets =
    typeof SHEETS !== "undefined" && SHEETS && typeof SHEETS === "object"
      ? SHEETS
      : {};

  return {
    ...FALLBACK_SHEETS_CORE,
    ...runtimeSheets
  };
}

function getSheetConfigMap_() {
  const runtimeConfig =
    typeof SHEET_CONFIG !== "undefined" && SHEET_CONFIG && typeof SHEET_CONFIG === "object"
      ? SHEET_CONFIG
      : {};

  return {
    ...FALLBACK_SHEET_CONFIG_CORE,
    ...runtimeConfig
  };
}

function getCoreDataTableMap_() {
  const runtimeCoreTables =
    typeof CORE_DATA_TABLES !== "undefined" &&
    CORE_DATA_TABLES &&
    typeof CORE_DATA_TABLES === "object"
      ? CORE_DATA_TABLES
      : {};

  return {
    inscriptions: "inscriptions_evenements",
    missions: "missions_vente",
    missionsStock: "missions_stock",
    journees: "journees_vente",
    transactions: "transactions",
    mouvementsStock: "mouvements_stock",
    ...runtimeCoreTables
  };
}

function resolveCoreTableSheetName_(requestedKey) {
  const coreMap = getCoreDataTableMap_();
  const normalizedRequested = normalizeLookupKey_(requestedKey);

  const directCoreKey = Object.keys(coreMap).find(
    (key) => normalizeLookupKey_(key) === normalizedRequested
  );

  if (directCoreKey) {
    return coreMap[directCoreKey];
  }

  const bySheetName = Object.keys(coreMap).find(
    (key) => normalizeLookupKey_(coreMap[key]) === normalizedRequested
  );

  if (bySheetName) {
    return coreMap[bySheetName];
  }

  try {
    return resolveSheetName_(requestedKey);
  } catch {
    return "";
  }
}

function isEmptyCoreTable_(requestedKey) {
  if (
    typeof EMPTY_CORE_TABLES === "undefined" ||
    !EMPTY_CORE_TABLES
  ) {
    return false;
  }

  if (Array.isArray(EMPTY_CORE_TABLES)) {
    return EMPTY_CORE_TABLES.some(
      (key) => normalizeLookupKey_(key) === normalizeLookupKey_(requestedKey)
    );
  }

  if (typeof EMPTY_CORE_TABLES === "object") {
    return Object.keys(EMPTY_CORE_TABLES).some(
      (key) =>
        normalizeLookupKey_(key) === normalizeLookupKey_(requestedKey) &&
        EMPTY_CORE_TABLES[key] === true
    );
  }

  return false;
}

function inferKeyFieldFromSheetName_(sheetName) {
  const normalized = normalizeLookupKey_(sheetName);

  const rules = [
    {
      includes: "catalogue",
      keyField: "sku_id"
    },
    {
      includes: "offres_vente",
      keyField: "offre_id"
    },
    {
      includes: "inscriptions_evenements",
      keyField: "inscription_id"
    },
    {
      includes: "missions_vente",
      keyField: "mission_id"
    },
    {
      includes: "missions_stock",
      keyField: "mission_id"
    },
    {
      includes: "journees_vente",
      keyField: "journee_id"
    },
    {
      includes: "mouvements_stock",
      keyField: "mouvement_stock_id"
    },
    {
      includes: "transactions",
      keyField: "transaction_id"
    },
    {
      includes: "ventes_lignes",
      keyField: "ligne_id"
    },
    {
      includes: "frais",
      keyField: "frais_id"
    },
    {
      includes: "clotures_journees",
      keyField: "cloture_id"
    },
    {
      includes: "clients",
      keyField: "client_id"
    },
    {
      includes: "commandes_pro_lignes",
      keyField: "commande_ligne_id"
    },
    {
      includes: "commandes_pro",
      keyField: "commande_id"
    },
    {
      includes: "documents",
      keyField: "document_id"
    },
    {
      includes: "recettes_ingredients",
      keyField: "recette_ingredient_id"
    },
    {
      includes: "recettes",
      keyField: "recette_id"
    },
    {
      includes: "ingredients",
      keyField: "ingredient_id"
    },
    {
      includes: "cuvees_ingredients_reels",
      keyField: "cuvee_ingredient_reel_id"
    },
    {
      includes: "cuvees",
      keyField: "cuvee_id"
    },
    {
      includes: "matieres_lots",
      keyField: "lot_id"
    },
    {
      includes: "matieres_premieres",
      keyField: "matiere_id"
    },
    {
      includes: "mouvements_matieres",
      keyField: "mouvement_matiere_id"
    },
    {
      includes: "stock_preparation_lines",
      keyField: "preparation_ligne_id"
    },
    {
      includes: "stock_preparations",
      keyField: "preparation_id"
    }
  ];

  const found = rules.find((rule) => normalized.includes(rule.includes));

  return found ? found.keyField : "";
}

/* ==============================
   Utilitaires Spreadsheet
   ============================== */

function getRequiredSheet_(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    const existingNames = spreadsheet
      .getSheets()
      .map((item) => item.getName())
      .join(", ");

    throw new Error(`Onglet introuvable : ${sheetName}. Onglets disponibles : ${existingNames}`);
  }

  return sheet;
}

function withDocumentLock_(callback) {
  const lock = LockService.getDocumentLock();

  try {
    lock.waitLock(30000);
    return callback();
  } finally {
    try {
      lock.releaseLock();
    } catch {
      // Lock déjà relâché ou indisponible.
    }
  }
}

/* ==============================
   Utilitaires génériques
   ============================== */

function normalizeTableList_(tables) {
  if (Array.isArray(tables)) {
    return tables
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  return String(tables || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeLookupKey_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-\s]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function findValueByNormalizedKey_(object, normalizedKey) {
  const keys = Object.keys(object || {});

  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];

    if (normalizeLookupKey_(key) === normalizedKey) {
      return object[key];
    }

    if (normalizeLookupKey_(object[key]) === normalizedKey) {
      return object[key];
    }
  }

  return "";
}