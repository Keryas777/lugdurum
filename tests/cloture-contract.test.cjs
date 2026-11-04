"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontend = fs.readFileSync(path.join(__dirname, "../docs/cloture.js"), "utf8");
const backend = fs.readFileSync(path.join(__dirname, "../apps-script/03_get_data.js"), "utf8");

function section(source, from, until) {
  const start = source.indexOf(from);
  const end = source.indexOf(until, start + from.length);
  assert.ok(start >= 0 && end > start, "Section absente : " + from);
  return source.slice(start, end);
}

const days = [
  { journee_id: "J_A", mission_id: "EV_A", stock_mission_id: "STOCK_1", date: "2026-11-04" },
  { journee_id: "J_B", mission_id: "EV_B", stock_mission_id: "STOCK_1", date: "2026-11-05" },
  // Même nom que la mission de stock, mais autre mission de stock explicite.
  { journee_id: "J_AUTRE", mission_id: "STOCK_1", stock_mission_id: "STOCK_2", date: "2026-11-06" }
];
const fees = [
  { frais_id: "F_DAY", journee_id: "J_A" },
  { frais_id: "F_STOCK", stock_mission_id: "STOCK_1" },
  { frais_id: "F_EVENT", mission_id: "EV_A" },
  { frais_id: "F_LEGACY", mission_id: "STOCK_1" },
  { frais_id: "F_OTHER_DAY", journee_id: "J_B", stock_mission_id: "STOCK_1" },
  { frais_id: "F_OTHER_EVENT", mission_id: "EV_B" },
  { frais_id: "F_OTHER_STOCK", journee_id: "J_A", stock_mission_id: "STOCK_2" }
];
const state = {
  journees: days,
  mission: { mission_id: "STOCK_1" },
  journee: days[0],
  stockMissions: [{ mission_id: "STOCK_1" }],
  frais: fees
};

test("Une mission de stock peut couvrir plusieurs événements, sans englober les autres stocks", () => {
  const getMissionJournees = new Function(
    "state", "isCancelledStatus",
    section(frontend, "  const getMissionJournees =", "  const getExistingClosure =") +
      "\nreturn getMissionJournees;"
  )(state, () => false);
  assert.deepEqual(getMissionJournees("STOCK_1").map(x => x.journee_id), ["J_A", "J_B"]);
});

test("Les frais de journée, stock, événement et historiques restent isolés", () => {
  const getFraisForContext = new Function(
    "state", "isCancelledStatus", "getDayEventId",
    section(frontend, "  const getFraisForContext =", "  const getFraisTotal =") +
      "\nreturn getFraisForContext;"
  )(state, () => false, x => x.mission_id);
  assert.deepEqual(getFraisForContext().map(x => x.frais_id), [
    "F_DAY", "F_STOCK", "F_EVENT", "F_LEGACY"
  ]);
});

test("Le payload Sheets écrit les identifiants canoniques et la clé de compatibilité", () => {
  const buildClosureSheetRow = new Function(
    section(frontend, "  const buildClosureSheetRow =", "  const saveClosureToApi =") +
      "\nreturn buildClosureSheetRow;"
  )();
  const row = buildClosureSheetRow({
    salon_id: "J_A", cloture_id: "CLOT_J_A", journee_id: "J_A",
    mission_id: "EV_A", stock_mission_id: "STOCK_1", date: "2026-11-04"
  });
  assert.equal(row.salon_id, "J_A");
  assert.equal(row.cloture_id, "CLOT_J_A");
  assert.equal(row.journee_id, "J_A");
  assert.equal(row.mission_id, "EV_A");
  assert.equal(row.stock_mission_id, "STOCK_1");
  assert.equal(row.date, "2026-11-04");
});

test("getClotureData cible la bonne journée et préserve les frais pertinents", () => {
  const tables = {
    missionsStock: state.stockMissions,
    journees: days,
    missions: [{ mission_id: "EV_A" }, { mission_id: "EV_B" }],
    transactions: [],
    ventesLignes: [],
    mouvementsStock: [],
    frais: fees,
    clotures: [{ cloture_id: "CLOT_J_A", journee_id: "J_A" }]
  };
  const getClotureData = new Function(
    "readSheetRows_",
    backend.slice(backend.indexOf("function getClotureData_(params)")) +
      "\nreturn getClotureData_;"
  )(key => tables[key] || []);
  const result = getClotureData({ journee_id: "J_A", stock_mission_id: "STOCK_1" });
  assert.deepEqual(result.journees.map(x => x.journee_id), ["J_A", "J_B"]);
  assert.deepEqual(result.frais.map(x => x.frais_id), [
    "F_DAY", "F_STOCK", "F_EVENT", "F_LEGACY"
  ]);
  assert.equal(result.clotures.length, 1);
});
