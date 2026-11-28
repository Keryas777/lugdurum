const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../apps-script/11_collective_goals.js"), "utf8");
const apiSource = fs.readFileSync(path.join(__dirname, "../docs/lugdurum-api.js"), "utf8");
const FIRST_DAY = "J_NOEL_2026_20261128_CHARLY";
const SECOND_DAY = "J_NOEL_2026_20261128_COMMUNAY";

function calculate(rows, days = []) {
  const context = {
    readSheetRows_: (name) => name === "journees_vente" ? days : rows,
    Utilities: { formatDate: () => "2026-11-28" },
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

  const movedOut = calculate([
    transaction("TX_MOVE", FIRST_DAY, 500, { updated_at: "2026-11-28T10:00:00.000Z" }),
    transaction("TX_MOVE", "JOURNEE_HORS_OBJECTIF", 0, { updated_at: "2026-11-28T10:05:00.000Z" })
  ]);
  assert.equal(movedOut.amount, 0);

  const movedIn = calculate([
    transaction("TX_MOVE_IN", "JOURNEE_HORS_OBJECTIF", 0, { updated_at: "2026-11-28T10:00:00.000Z" }),
    transaction("TX_MOVE_IN", FIRST_DAY, 275, { updated_at: "2026-11-28T10:05:00.000Z" })
  ]);
  assert.equal(movedIn.amount, 275);
});

test("refuse un identifiant d'objectif inconnu", () => {
  const context = { readSheetRows_: () => [], Date, Number, isFinite };
  vm.runInNewContext(source, context);
  assert.throws(() => context.getCollectiveGoal_({ goal_id: "inconnu" }), /Objectif collectif inconnu/);
});

test("contributions par identifiant officiel, corrections et zéro vendeur", () => {
  const result = calculate([
    transaction("A", FIRST_DAY, 12.34, { user_id: "U_ANTHONY" }),
    transaction("J", SECOND_DAY, 20, { user_id: "U_JEROME" }),
    transaction("J", SECOND_DAY, 15.67, { user_id: "U_JEROME", updated_at: "2026-11-28T11:00:00.000Z" }),
    transaction("W", SECOND_DAY, 100, { user_id: "U_WILL", statut: "annulee" })
  ]);
  assert.equal(result.amount, 28.01);
  assert.equal(result.contributions.U_ANTHONY, 12.34);
  assert.equal(result.contributions.U_JEROME, 15.67);
  assert.equal(result.contributions.U_WILL, 0);
});

test("renvoie aussi les contributions du jour métier Europe/Paris", () => {
  const result = calculate([
    transaction("A", FIRST_DAY, 12.34, {user_id:"U_ANTHONY"}),
    transaction("J", SECOND_DAY, 20, {user_id:"U_JEROME"}),
    transaction("W", "J_NOEL_2026_20261204_PONT_DE_CHERUY", 9, {user_id:"U_WILL"})
  ], [
    {journee_id:FIRST_DAY,date:"2026-11-28"}, {journee_id:SECOND_DAY,date:"2026-11-28"},
    {journee_id:"J_NOEL_2026_20261204_PONT_DE_CHERUY",date:"2026-12-04"}
  ]);
  assert.equal(result.daily_date,"2026-11-28");
  assert.deepEqual(JSON.parse(JSON.stringify(result.daily_contributions)),{U_ANTHONY:12.34,U_JEROME:20,U_WILL:0});
});

test("détail vendeur: paiements inconnus séparés, coffret décomposé et vendeur filtré", () => {
  const rows=[transaction("A",FIRST_DAY,10,{user_id:"U_ANTHONY",mode_paiement:"CB",detail_ticket:JSON.stringify([{sku_id:"VB_50",parfum_code:"VB",parfum_nom:"Vanille Bleue",format_cl:50,quantite:1},{type:"box",composition:[{parfum_code:"AT",parfum_nom:"Abricot Tonka"},{parfum_code:"CG",parfum_nom:"Citron Gingembre"}]}])}),transaction("B",SECOND_DAY,4,{user_id:"U_ANTHONY",mode_paiement:"ESP"}),transaction("C",SECOND_DAY,3,{user_id:"U_ANTHONY",mode_paiement:"CHQ"})];
  const ctx={readSheetRows_:name=>name==="transactions"?rows:[{journee_id:FIRST_DAY,date:"2026-11-28"},{journee_id:SECOND_DAY,date:"2026-11-28"}],Utilities:{formatDate:()=>"2026-11-28"},Date,Number,isFinite};
  vm.runInNewContext(source,ctx);
  const p=JSON.parse(JSON.stringify(ctx.getCollectiveGoalSellerDetails_({goal_id:"noel-2026",seller_id:"U_ANTHONY"}))).periods.total;
  assert.equal(p.revenue,17); assert.equal(p.card,10); assert.equal(p.cash,4); assert.equal(p.other,3);
  assert.deepEqual(p.bottles,{"20":2,"50":1});
  assert.throws(()=>ctx.getCollectiveGoalSellerDetails_({goal_id:"noel-2026",seller_id:"U_OTHER"}),/Vendeur invalide/);
});

test("détail vendeur: le montant mixte reste dans les autres encaissements et les corrections remplacent la vente initiale", () => {
  const rows = [
    transaction("TX_CORRIGE", FIRST_DAY, 12, { user_id:"U_WILL", mode_paiement:"CB", updated_at:"2026-11-28T10:00:00Z" }),
    transaction("TX_CORRIGE", FIRST_DAY, 9, { user_id:"U_WILL", mode_paiement:"MIXTE", updated_at:"2026-11-28T10:05:00Z" }),
    transaction("TX_ANNULE", FIRST_DAY, 50, { user_id:"U_WILL", statut:"annulée", mode_paiement:"ESP" }),
    transaction("TX_CATALOGUE", SECOND_DAY, "", { user_id:"U_WILL", mode_paiement:"ESP", total_encaisse:"", total_catalogue_ttc:2.5 })
  ];
  const ctx = {
    readSheetRows_: name => name === "transactions" ? rows : [
      { journee_id:FIRST_DAY, date:"2026-11-28" },
      { journee_id:SECOND_DAY, date:"2026-11-28" }
    ],
    Utilities:{ formatDate:() => "2026-11-28" }, Date, Number, isFinite
  };
  vm.runInNewContext(source, ctx);
  const data = ctx.getCollectiveGoalSellerDetails_({ goal_id:"noel-2026", seller_id:"U_WILL" });
  const total = JSON.parse(JSON.stringify(data.periods.total));
  const daily = JSON.parse(JSON.stringify(data.periods.daily));
  assert.equal(total.revenue, 11.5);
  assert.equal(total.card, 0);
  assert.equal(total.cash, 2.5);
  assert.equal(total.other, 9);
  assert.equal(daily.revenue, 11.5);
  assert.throws(() => ctx.getCollectiveGoalSellerDetails_({ goal_id:"unknown", seller_id:"U_WILL" }), /Objectif collectif inconnu/);
});

test("le client expose une lecture GET détaillée sans vider ni planifier la file d’écriture", () => {
  assert.match(apiSource, /getCollectiveGoalSellerDetails\(params = \{\}, options = \{\}\)/);
  assert.match(apiSource, /"getCollectiveGoalSellerDetails"/);
  assert.match(apiSource, /flushBeforeRead: false, schedulePendingFlush: false/);
});
