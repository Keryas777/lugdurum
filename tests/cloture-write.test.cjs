"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const frontend = source("docs/cloture.js");
const router = source("apps-script/01_http_router.js");
const sheetsCore = source("apps-script/02_sheets_core.js");
const serverConfig = source("apps-script/00_config.js");

function makeSheetsCore() {
  // Charger la vraie configuration et le vrai normaliseur Apps Script,
  // plutôt qu'un faux mapping codé dans ce test (ancienne régression).
  const context = vm.createContext({});
  vm.runInContext(serverConfig, context, { filename: "00_config.js" });
  vm.runInContext(sheetsCore, context, { filename: "02_sheets_core.js" });
  return {
    normalize: vm.runInContext("normalizeBatchOperation_", context),
    config: vm.runInContext("resolveSheetConfig_", context)
  };
}

function section(text, from, to) {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, "Section source introuvable : " + from);
  return text.slice(a, b);
}

const saveCode = section(
  frontend,
  "  const buildBatchOperation = (",
  "  // Les anciennes sauvegardes"
);
const createSaver = new Function(
  "hasApi", "api",
  saveCode + "\nreturn { buildClosureSheetRow, saveClosureToApi };"
);

function closure() {
  return {
    salon_id: "J_GERZAT_J1",
    cloture_id: "CLOT_J_GERZAT_J1",
    mission_id: "MST_GERZAT",
    stock_mission_id: "MST_GERZAT",
    journee_id: "J_GERZAT_J1",
    date_cloture: "2026-10-11T00:00:00.000Z",
    statut: "cloturee",
    especes_comptees: "77.98",
    cb_sumup: "65.98",
    autre_paiement: "31.99",
    total_reel: "175.95",
    total_tickets_calcule: "175.95",
    ecart: "0",
    ca_total_ttc: "175.95",
    total_frais_ttc: "0",
    note: "",
    created_at: "2026-10-11T00:00:00.000Z",
    updated_at: "2026-10-11T00:00:00.000Z"
  };
}

const patch = {
  updatedJournee: {
    journee_id: "J_GERZAT_J1",
    stock_mission_id: "MST_GERZAT",
    statut: "cloture"
  },
  updatedMission: {
    mission_id: "MST_GERZAT",
    statut: "en_cours"
  }
};

const movements = [
  {
    mouvement_stock_id: "MVT_CLOT_CLOT_J_GERZAT_J1_VT_50",
    journee_id: "J_GERZAT_J1",
    stock_mission_id: "MST_GERZAT",
    sku_id: "VT_50",
    quantite: 7
  },
  {
    mouvement_stock_id: "MVT_CLOT_CLOT_J_GERZAT_J1_FP_20",
    journee_id: "J_GERZAT_J1",
    stock_mission_id: "MST_GERZAT",
    sku_id: "FP_20",
    quantite: 5
  }
];

const keys = {
  clotures: "salon_id",
  mouvementsStock: "mouvement_stock_id",
  journees: "journee_id",
  missionsStock: "mission_id"
};

test("le routeur saveCloture utilise salon_id et non saveCloture_", () => {
  const content = section(router,
    '  if (action === "saveCloture") {',
    '  if (action === "saveJourneeHistoriqueBundle") {'
  );
  let called;
  const route = new Function("action", "payload", "callRequiredFunction_", content);
  const input = { cloture: { salon_id: "J_GERZAT_J1" } };
  route("saveCloture", input, (...args) => { called = args; return { ok: true }; });
  assert.deepEqual(called, [
    "upsertRowByConfig_", "clotures", input.cloture, "salon_id"
  ]);
  assert.throws(
    () => route("saveCloture", { cloture: { cloture_id: "CLOT_OLD" } }, () => {}),
    /salon_id obligatoire/
  );
});

test("clôture écrite avec ses colonnes Google Sheets exactes", () => {
  const h = createSaver(() => true, () => ({}));
  const row = h.buildClosureSheetRow(closure());
  assert.equal(row.salon_id, "J_GERZAT_J1");
  assert.equal(row.statut, "cloturee");
  assert.equal(row.stock_mission_id, "MST_GERZAT");
  assert.equal(row.total_reel, "175.95");
  assert.equal(row.ca_total_ttc, "175.95");
  assert.equal(row.cloture_id, undefined); // champ absent du Sheet V1
});

test("la vraie configuration Apps Script utilise salon_id, et accepte idKey", () => {
  const server = makeSheetsCore();
  assert.equal(server.config("clotures", {}).keyField, "salon_id");
  assert.equal(server.config("clotures_journees", {}).keyField, "salon_id");
  assert.equal(server.config("mouvementsStock", {}).keyField, "mouvement_stock_id");
  assert.equal(server.config("journees", {}).keyField, "journee_id");
  assert.equal(server.config("missionsStock", {}).keyField, "mission_id");
  const normalized = server.normalize({
    sheetKey: "clotures",
    keyField: "salon_id",
    data: { salon_id: "J_GERZAT_J1" }
  });
  assert.equal(server.config(normalized.tableKeyOrSheetName, {
    forcedKeyField: normalized.keyField
  }).keyField, "salon_id");
});

test("les 20 opérations d'une clôture portent leur clé réelle et un identifiant non vide", async () => {
  const server = makeSheetsCore();
  const h = createSaver(() => true, () => ({
    batchUpsert: async (operations) => {
      assert.equal(operations.length, 20);
      for (const operation of operations) {
        const normalized = server.normalize(operation);
        const key = server.config(normalized.tableKeyOrSheetName, {
          forcedKeyField: normalized.keyField
        }).keyField;
        assert.equal(key, keys[operation.sheetKey]);
        assert.ok(String(normalized.row[key] || "").trim());
      }
      return {
        ok: true,
        results: operations.map(() => ({ ok: true }))
      };
    }
  }));
  const twentyOpsMovements = Array.from({ length: 17 }, (_, index) => ({
    mouvement_stock_id: "MVT_CLOT_GERZAT_" + index,
    mission_id: "MST_GERZAT",
    stock_mission_id: "MST_GERZAT",
    journee_id: "J_GERZAT_J1",
    sku_id: "SKU_" + index,
    quantite: 1
  }));
  const result = await h.saveClosureToApi({
    closure: closure(),
    movements: twentyOpsMovements,
    patch
  });
  assert.equal(result.operations_count, 20);
});

test("une clé de mouvement absente bloque le lot AVANT l'appel réseau", async () => {
  let calls = 0;
  const h = createSaver(() => true, () => ({
    batchUpsert: async () => {
      calls++;
      return { ok: true, results: [] };
    }
  }));
  await assert.rejects(
    () => h.saveClosureToApi({
      closure: closure(),
      movements: [{ sku_id: "VT_50", quantite: 1 }],
      patch
    }),
    /Identifiant mouvement_stock_id manquant/
  );
  assert.equal(calls, 0);
});

test("un seul lot regroupe toutes les écritures, rejouable sans doublon", async () => {
  const sheets = new Map();
  let calls = 0;
  const api = () => ({
    batchUpsert: async (operations) => {
      calls++;
      for (const op of operations) {
        const key = keys[op.sheetKey];
        assert.ok(key, "Onglet non attendu : " + op.sheetKey);
        assert.ok(op.data[key], "Identifiant absent : " + key);
        sheets.set(op.sheetKey + ":" + op.data[key], { ...op.data });
      }
      return {
        ok: true,
        results: operations.map((op) => ({ ok: true, sheet_key: op.sheetKey })),
        operations_count: operations.length
      };
    }
  });
  const h = createSaver(() => true, api);
  const input = { closure: closure(), movements, patch };
  assert.deepEqual(await h.saveClosureToApi(input), { queued: false, operations_count: 5 });
  assert.deepEqual(await h.saveClosureToApi(input), { queued: false, operations_count: 5 });
  assert.equal(calls, 2);
  assert.equal(sheets.size, 5);
  assert.equal(sheets.get("clotures:J_GERZAT_J1").statut, "cloturee");
  assert.equal(sheets.get("journees:J_GERZAT_J1").statut, "cloture");
});

test("un lot placé en file ne signifie pas une clôture confirmée", async () => {
  const h = createSaver(() => true, () => ({
    batchUpsert: async () => ({ queued: true, pending_count: 1 })
  }));
  const result = await h.saveClosureToApi({ closure: closure(), movements, patch });
  assert.deepEqual(result, { queued: true, pending_count: 1 });
});

test("une réponse partielle ne peut pas valider la clôture", async () => {
  const h = createSaver(() => true, () => ({
    batchUpsert: async () => ({
      ok: true,
      results: [{ ok: true }]
    })
  }));
  await assert.rejects(
    () => h.saveClosureToApi({ closure: closure(), movements, patch }),
    /réponse du lot de clôture incomplète/i
  );
});

test("aucun succès local anticipé et report J2 protégé", () => {
  const save = section(frontend,
    "  const saveClosure = async (status) => {",
    "  const saveDraft = () => {"
  );
  assert.ok(
    save.indexOf("const response = await saveClosureToApi") <
    save.indexOf("upsertClosureLocal(closure)")
  );
  assert.ok(save.includes("state.dataLoaded = false;"));
  const carry = section(frontend,
    "  const carryStockToNextDay = async () => {",
    "  const ")
    // The next declaration after carry may vary: only assert the guard in its prefix.
  assert.ok(carry.includes("getPendingWritesCount() > 0"));
});
