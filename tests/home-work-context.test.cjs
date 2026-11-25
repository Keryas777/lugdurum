"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Days = require("../docs/lugdurum-day-context.js");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const auth = (...ids) => JSON.stringify(ids.map((user_id) => ({ user_id })));
const event = (id, name, date) => ({ mission_id: id, nom: name, date_debut: date, date_fin: date });
const day = (id, eventId, date, userIds, stockId = "", status = "prevu", extra = {}) => ({
  journee_id: id,
  mission_id: eventId,
  stock_mission_id: stockId,
  date,
  jour_label: "J1",
  statut: status,
  vendeurs_autorises: auth(...userIds),
  ...extra
});

const events = [
  event("EVT_COMMUNAY", "Marché de Noël de Communay", "2026-11-28"),
  event("EVT_CHARLY", "Marché de Noël de Charly", "2026-11-28"),
  event("EVT_TOUR", "Marché de Noël de La Tour de Salvagny", "2026-12-05")
];
const days = [
  day("J_COMMUNAY", "EVT_COMMUNAY", "2026-11-28", ["U_JEROME"]),
  day("J_CHARLY", "EVT_CHARLY", "2026-11-28", ["U_ANTHONY"]),
  day("J_TOUR_1", "EVT_TOUR", "2026-12-05", ["U_ANTHONY", "U_WILL"]),
  day("J_TOUR_2", "EVT_TOUR", "2026-12-06", ["U_ANTHONY"])
];

for (const staleDayId of ["J_CHARLY", "J_TOUR_1"]) {
  test(`sélection locale périmée ${staleDayId} ne détourne pas le contexte de Jérôme`, () => {
    const resolved = Days.resolveWorkContext({
      days,
      events,
      userId: "U_JEROME",
      selectedDayId: staleDayId,
      today: "2026-11-25",
      forceSelection: true,
      manualOverride: false
    });
    assert.equal(resolved.day.journee_id, "J_COMMUNAY");
    assert.equal(resolved.event.mission_id, "EVT_COMMUNAY");
    assert.deepEqual(resolved.context, {
      user_id: "U_JEROME",
      journee_id: "J_COMMUNAY",
      mission_id: "EVT_COMMUNAY",
      stock_mission_id: ""
    });
    assert.equal(resolved.stockMission, null);
    assert.deepEqual(resolved.linkedDays, []);
  });
}

test("Charly et La Tour ne sont pas des choix personnels de Jérôme", () => {
  const resolved = Days.resolveWorkContext({ days, events, userId: "U_JEROME", today: "2026-11-25" });
  assert.deepEqual(resolved.selectableDays.map((item) => item.journee_id), ["J_COMMUNAY"]);
  assert.equal(resolved.context.mission_id, "EVT_COMMUNAY");
});

test("plusieurs journées autorisées aujourd’hui exigent un choix, puis le choix manuel pilote tout le contexte", () => {
  const sameDay = [
    day("J_A", "EVT_A", "2026-11-25", ["U_JEROME"], "MST_A"),
    day("J_B", "EVT_B", "2026-11-25", ["U_JEROME"], "MST_B")
  ];
  const byEvent = [event("EVT_A", "Marché A", "2026-11-25"), event("EVT_B", "Marché B", "2026-11-25")];
  const ambiguous = Days.resolveWorkContext({ days: sameDay, events: byEvent, userId: "U_JEROME", today: "2026-11-25" });
  assert.equal(ambiguous.day, null);
  assert.equal(ambiguous.selectionRequired, true);
  const manual = Days.resolveWorkContext({
    days: sameDay, events: byEvent, stockMissions: [{ mission_id: "MST_B" }],
    userId: "U_JEROME", selectedDayId: "J_B", today: "2026-11-25", forceSelection: true, manualOverride: true
  });
  assert.equal(manual.context.journee_id, "J_B");
  assert.equal(manual.context.mission_id, "EVT_B");
  assert.equal(manual.context.stock_mission_id, "MST_B");
});

test("une ancienne sélection valide ne tranche pas automatiquement entre deux journées d’aujourd’hui", () => {
  const sameDay = [
    day("J_A", "EVT_A", "2026-11-25", ["U_JEROME"]),
    day("J_B", "EVT_B", "2026-11-25", ["U_JEROME"])
  ];
  const result = Days.resolveWorkContext({
    days: sameDay, userId: "U_JEROME", selectedDayId: "J_B", today: "2026-11-25", forceSelection: false
  });
  assert.equal(result.day, null);
  assert.equal(result.selectionRequired, true);
});

test("une nouvelle journée aujourd’hui prend la priorité sur l’ancien choix futur au rechargement", () => {
  const next = [
    day("J_NEXT", "EVT_NEXT", "2026-11-28", ["U_JEROME"]),
    day("J_TODAY", "EVT_TODAY", "2026-11-25", ["U_JEROME"])
  ];
  assert.equal(Days.resolveWorkContext({
    days: next, userId: "U_JEROME", selectedDayId: "J_NEXT", today: "2026-11-25", forceSelection: true
  }).context.journee_id, "J_TODAY");
});

test("sans journée aujourd’hui, le parcours choisit la prochaine journée future et ignore un ancien jour en cours", () => {
  const schedule = [
    day("J_YESTERDAY", "EVT_OLD", "2026-11-24", ["U_JEROME"], "MST_OLD", "en_cours"),
    day("J_NEXT", "EVT_NEXT", "2026-11-28", ["U_JEROME"])
  ];
  const resolved = Days.resolveWorkContext({ days: schedule, userId: "U_JEROME", today: "2026-11-25" });
  assert.equal(resolved.day.journee_id, "J_NEXT");
  assert.equal(resolved.schedule.mode, "next");
});

test("un choix futur manuel valide reste associé au même utilisateur au rechargement", () => {
  const resolved = Days.resolveWorkContext({
    days,
    events,
    userId: "U_JEROME",
    selectedDayId: "J_COMMUNAY",
    today: "2026-11-26",
    forceSelection: true
  });
  assert.equal(resolved.context.journee_id, "J_COMMUNAY");
  const switchedUser = Days.resolveWorkContext({
    days, events, userId: "U_ANTHONY", selectedDayId: "J_COMMUNAY",
    today: "2026-11-26", forceSelection: true
  });
  assert.equal(switchedUser.context.journee_id, "J_CHARLY");
  assert.equal(switchedUser.selectedDayWasInvalid, true);
});

test("sans journée affectée, le parcours reste vide", () => {
  const resolved = Days.resolveWorkContext({ days, events, userId: "U_UNKNOWN", today: "2026-11-25" });
  assert.equal(resolved.day, null);
  assert.equal(resolved.context.journee_id, "");
  assert.equal(resolved.selectableDays.length, 0);
});

test("journée clôturée sur un autre appareil invalide la sélection persistée", () => {
  const closed = day("J_CLOSED", "EVT_CLOSED", "2026-11-25", ["U_JEROME"], "MST_CLOSED", "cloture", {
    closed_at: "2026-11-25T18:00:00Z"
  });
  const result = Days.resolveWorkContext({
    days: [closed, day("J_NEXT", "EVT_NEXT", "2026-11-28", ["U_JEROME"])],
    userId: "U_JEROME", selectedDayId: "J_CLOSED", today: "2026-11-25", forceSelection: true
  });
  assert.equal(result.context.journee_id, "J_NEXT");
  assert.equal(result.selectedDayWasInvalid, true);
});

test("mission de stock partagée suit uniquement stock_mission_id, jamais journee.mission_id", () => {
  const sharedDays = [
    day("J_A", "EVT_A", "2026-11-25", ["U_JEROME"], "MST_SHARED"),
    day("J_B", "EVT_B", "2026-11-26", ["U_ANTHONY"], "MST_SHARED"),
    day("J_C", "MST_SHARED", "2026-11-27", ["U_JEROME"], "", "prevu")
  ];
  const result = Days.resolveWorkContext({
    days: sharedDays,
    events: [event("EVT_A", "Marché A", "2026-11-25"), event("EVT_B", "Marché B", "2026-11-26")],
    stockMissions: [{ mission_id: "MST_SHARED", statut: "en_cours" }],
    userId: "U_JEROME", today: "2026-11-25"
  });
  assert.equal(result.context.mission_id, "EVT_A");
  assert.equal(result.context.stock_mission_id, "MST_SHARED");
  assert.deepEqual(result.linkedDays.map((item) => item.journee_id), ["J_A", "J_B"]);
});

test("Apps Script résout le même contexte personnel depuis les lignes métier", () => {
  const server = read("apps-script/04_home_data.js");
  const build = new Function(server + "\nreturn buildPersonalWorkContextHomeData_;")();
  const result = build({
    events,
    stockMissions: [],
    journees: days,
    transactions: [
      { transaction_id: "TX_COMMUNAY", journee_id: "J_COMMUNAY", total_encaisse_ttc: 42 },
      { transaction_id: "TX_CHARLY", journee_id: "J_CHARLY", total_encaisse_ttc: 999 }
    ],
    mouvementsStock: []
  }, { today: "2026-11-25", userId: "U_JEROME", requestedDayId: "J_CHARLY", manualDaySelection: true });
  assert.deepEqual(result.context, {
    user_id: "U_JEROME", journee_id: "J_COMMUNAY", mission_id: "EVT_COMMUNAY", stock_mission_id: ""
  });
  assert.deepEqual(result.active.transactions.map((tx) => tx.transaction_id), ["TX_COMMUNAY"]);
  assert.equal(result.active.event.nom, "Marché de Noël de Communay");
});

test("la validation Apps Script refuse un vendeur non affecté et une journée clôturée même si son statut est périmé", () => {
  const writer = read("apps-script/06_write_bundles_vente.js");
  const guard = new Function("readSheetRows_", writer + "\nreturn writeAssertQuickSaleContext_;")((key) => {
    if (key === "journees") return [
      day("J_COMMUNAY", "EVT_COMMUNAY", "2026-11-25", ["U_JEROME"], "MST_COMMUNAY", "en_cours"),
      day("J_CLOSED", "EVT_COMMUNAY", "2026-11-25", ["U_JEROME"], "MST_COMMUNAY", "en_cours", { closed_at: "2026-11-25T18:00:00Z" })
    ];
    if (key === "missionsStock") return [{ mission_id: "MST_COMMUNAY", statut: "pret", stock_prepare: true }];
    return [];
  });
  const tx = (journee_id, user_id) => ({
    source: "WEBAPP_TEST", journee_id, mission_id: "EVT_COMMUNAY",
    stock_mission_id: "MST_COMMUNAY", user_id
  });
  assert.doesNotThrow(() => guard(tx("J_COMMUNAY", "U_JEROME"), []));
  assert.throws(() => guard(tx("J_COMMUNAY", "U_ANTHONY"), []), /vendeur n’est pas autorisé/);
  assert.throws(() => guard(tx("J_CLOSED", "U_JEROME"), []), /journée est clôturée/);
});

test("Apps Script ne traite pas la chaîne false comme un choix manuel", () => {
  const server = read("apps-script/04_home_data.js");
  const build = new Function(server + "\nreturn buildPersonalWorkContextHomeData_;")();
  const sameDate = [
    day("J_ONE", "EVT_ONE", "2026-11-25", ["U_JEROME"]),
    day("J_TWO", "EVT_TWO", "2026-11-25", ["U_JEROME"]),
    day("J_NEXT", "EVT_NEXT", "2026-11-28", ["U_JEROME"])
  ];
  const result = build({ events: [], stockMissions: [], journees: sameDate, transactions: [], mouvementsStock: [] }, {
    today: "2026-11-25", userId: "U_JEROME", requestedDayId: "J_NEXT", manualDaySelection: "false"
  });
  assert.equal(result.day, null);
  assert.deepEqual(result.context, { user_id: "U_JEROME", journee_id: "", mission_id: "", stock_mission_id: "" });
});

test("Apps Script conserve un choix mémorisé valide hors d’aujourd’hui mais donne priorité à une journée d’aujourd’hui", () => {
  const server = read("apps-script/04_home_data.js");
  const build = new Function(server + "\nreturn buildPersonalWorkContextHomeData_;" )();
  const persisted = build({ events, stockMissions: [], journees: days, transactions: [], mouvementsStock: [] }, {
    today: "2026-11-26", userId: "U_JEROME", requestedDayId: "J_COMMUNAY", preferredDaySelection: true
  });
  assert.equal(persisted.context.journee_id, "J_COMMUNAY");

  const dayAndFuture = [
    day("J_TODAY", "EVT_TODAY", "2026-11-25", ["U_JEROME"]),
    day("J_FUTURE", "EVT_FUTURE", "2026-11-28", ["U_JEROME"])
  ];
  const withToday = build({ events: [], stockMissions: [], journees: dayAndFuture, transactions: [], mouvementsStock: [] }, {
    today: "2026-11-25", userId: "U_JEROME", requestedDayId: "J_FUTURE", preferredDaySelection: true
  });
  assert.equal(withToday.context.journee_id, "J_TODAY");

  const sameDay = [
    day("J_A", "EVT_A", "2026-11-25", ["U_JEROME"]),
    day("J_B", "EVT_B", "2026-11-25", ["U_JEROME"])
  ];
  const ambiguous = build({ events: [], stockMissions: [], journees: sameDay, transactions: [], mouvementsStock: [] }, {
    today: "2026-11-25", userId: "U_JEROME", requestedDayId: "J_B", preferredDaySelection: false
  });
  assert.equal(ambiguous.day, null);
  assert.equal(ambiguous.context.journee_id, "");
});

test("le front reçoit un unique work_context et ignore les IDs historiques de l’API", () => {
  const frontend = read("docs/home.js");
  const api = read("docs/lugdurum-api.js");
  assert.match(frontend, /resolveWorkContext\(/);
  assert.match(frontend, /work_context: true/);
  assert.match(frontend, /ignore_legacy_context: true/);
  assert.match(frontend, /preferred_day_selection: state\.forceSelectedDay/);
  assert.match(api, /preferred_day_selection: params\.preferred_day_selection === true/);
  assert.match(api, /ignoreLegacyContext = params\.ignore_legacy_context === true \|\| params\.work_context === true/);
  assert.match(api, /ignoreLegacyContext \? "" : \(\s*getUrlParam\("stock_mission_id"\)/);
  assert.doesNotMatch(frontend, /Le choix est temporaire|renderEventSelector|upcomingItems/);
});
