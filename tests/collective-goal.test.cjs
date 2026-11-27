const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../apps-script/11_collective_goals.js"), "utf8");
const FIRST_DAY = "J_NOEL_2026_20261128_CHARLY";
const SECOND_DAY = "J_NOEL_2026_20261128_COMMUNAY";

function calculate(rows) {
  const context = {
    readSheetRows_: () => rows,
    Date,
    Number,
    isFinite
  };
  vm.runInNewContext(source, context, { filename: "11_collective_goals.js" });
  return context.getCollectiveGoal_({ goal_id: "noel-2026" });
}

function transaction(id, dayId, amount, extra = {}) {
  return {
    transaction_id: id,
    journee_id: dayId,
    total_encaisse_ttc: amount,
    statut: "validee",
    user_id: "vendeur-test",
    updated_at: "2026-11-28T10:00:00.000Z",
    ...extra
  };
}

test("retourne un zéro disponible quand aucune vente n'est encore enregistrée", () => {
  const result = calculate([]);
  assert.equal(result.available, true);
  assert.equal(result.amount, 0);
  assert.equal(result.percent, 0);
  assert.equal(result.remaining, 14000);
  assert.equal(result.eligible_day_count, 21);
});

test("calcule exactement les jalons 25, 50, 75 et 100 %, puis continue au-delà", () => {
  for (const [amount, percent, remaining] of [
    [3500, 25, 10500],
    [7000, 50, 7000],
    [10500, 75, 3500],
    [14000, 100, 0],
    [15750, 112, 0]
  ]) {
    const result = calculate([transaction("TX_" + amount, FIRST_DAY, amount)]);
    assert.equal(result.amount, amount);
    assert.equal(result.percent, percent);
    assert.equal(result.remaining, remaining);
  }
});

test("additionne les vendeurs et journées sans filtrer vendeur ou journée sélectionnée", () => {
  const rows = [
    transaction("TX_JEROME", FIRST_DAY, 1200, { user_id: "jerome" }),
    transaction("TX_ANTHONY", SECOND_DAY, 800, { user_id: "anthony" }),
    transaction("TX_WILLIAM", "J_NOEL_2026_20261204_PONT_DE_CHERUY", 500, { user_id: "william" })
  ];
  const result = calculate(rows);
  assert.equal(result.amount, 2500);
  assert.equal(result.transaction_count, 3);
});

test("ignore les journées hors périmètre, annulations et paiements non confirmés", () => {
  const rows = [
    transaction("TX_OK", FIRST_DAY, 300),
    transaction("TX_OUTSIDE", "JOURNEE_HORS_OBJECTIF", 12000),
    transaction("TX_CANCEL", SECOND_DAY, 1000, { statut: "annulée" }),
    transaction("TX_PENDING", SECOND_DAY, 2000, { paiement_statut: "SUMUP_LANCE" })
  ];
  const result = calculate(rows);
  assert.equal(result.amount, 300);
  assert.equal(result.transaction_count, 1);
});

test("ne compte qu'une fois un identifiant et retient sa correction la plus récente", () => {
  const rows = [
    transaction("TX_CORRIGE", FIRST_DAY, 500, { updated_at: "2026-11-28T10:00:00.000Z" }),
    transaction("TX_CORRIGE", FIRST_DAY, 350, { updated_at: "2026-11-28T10:05:00.000Z" })
  ];
  const result = calculate(rows);
  assert.equal(result.amount, 350);
  assert.equal(result.transaction_count, 1);
});

test("refuse un identifiant d'objectif inconnu", () => {
  const context = { readSheetRows_: () => [], Date, Number, isFinite };
  vm.runInNewContext(source, context);
  assert.throws(() => context.getCollectiveGoal_({ goal_id: "inconnu" }), /Objectif collectif inconnu/);
});
