"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const event = { mission_id: "EVT_GERZAT", nom: "Foire aux pansettes de Gerzat" };
const stockMission = {
  mission_id: "MST_GERZAT", evenement_id: "EVT_GERZAT",
  nom: "Foire aux pansettes de Gerzat", statut: "en_cours"
};
const day1 = {
  journee_id: "J_GERZAT_J1", mission_id: "EVT_GERZAT",
  stock_mission_id: "MST_GERZAT", jour_label: "J1",
  date: "2026-10-10", statut: "cloture",
  closed_at: "2026-10-10T23:20:10.609Z"
};
const day2 = {
  journee_id: "J_GERZAT_J2", mission_id: "EVT_GERZAT",
  stock_mission_id: "MST_GERZAT", jour_label: "J2",
  date: "2026-10-11", statut: "pret", closed_at: ""
};
const selected = {
  ...event, selected_type: "mission", selected_id: "EVT_GERZAT"
};
const tables = (j1 = day1, j2 = day2) => ({
  events: [event],
  stockMissions: [stockMission],
  journees: [j1, j2],
  transactions: [],
  mouvementsStock: []
});

for (const [file, suffix] of [
  ["apps-script/03_get_data.js", "GetData_"],
  ["apps-script/04_home_data.js", "HomeData_"]
]) {
  // Évalue les véritables fonctions métier serveur, sans toucher à Sheets.
  const code = read(file);
  const choose = new Function(code + "\nreturn buildActiveContext" + suffix + ";")();

  test(file + " : après clôture de J1, J2 est la journée active commune", () => {
    for (const seller of ["Jerome", "Anthony"]) {
      const active = choose(tables(), selected, "2026-10-11");
      assert.equal(active.journee.journee_id, day2.journee_id, seller);
      assert.equal(active.linkedDays.length, 2);
      assert.equal(active.stockMission.mission_id, stockMission.mission_id);
    }
  });

  test(file + " : closed_at interdit de revenir sur J1 même avec statut erroné", () => {
    const oldRow = { ...day1, statut: "pret" };
    assert.equal(choose(tables(oldRow), selected, "2026-10-11").journee.journee_id, day2.journee_id);
  });

  test(file + " : une J1 réellement EN_COURS ne bascule pas à minuit", () => {
    const oldRow = { ...day1, statut: "en_cours", closed_at: "" };
    assert.equal(choose(tables(oldRow), selected, "2026-10-11").journee.journee_id, day1.journee_id);
  });

  test(file + " : lorsque J1 et J2 sont clôturées, aucune nouvelle journée n'est créée", () => {
    const closedJ2 = { ...day2, statut: "cloture", closed_at: "2026-10-11T20:00:00.000Z" };
    const active = choose(tables(day1, closedJ2), selected, "2026-10-11");
    assert.equal(active.journee.journee_id, day2.journee_id);
    assert.equal(active.journee.statut, "cloture");
  });
}

const frontend = read("docs/home.js");

test("accueil : la vraie ligne Sheets prime sur active.journee périmée", () => {
  assert.match(frontend, /journees: uniqueBy\(\[\.\.\.extraJournees, \.\.\.journees\], getDayId\)/);
  assert.match(frontend, /const journee = mission \? getFirstOpenDay\(mission, data\.journees\) : null;/);
  assert.match(frontend, /homeState\.runtimeDayMatches/);
  assert.match(frontend, /if \(!homeState\.runtimeDayMatches\) return fallback;/);
  assert.match(frontend, /const serverWatch = \(homeState\.runtimeDayMatches \?/);
  assert.match(frontend, /url\.searchParams\.set\("journee_id", getDayId\(homeState\.journee\)\)/);
});

test("accueil : même sélection J2 que le serveur et sans CA J1 réutilisé", () => {
  const from = frontend.indexOf("  const getFirstOpenDay = (");
  const to = frontend.indexOf("  const findFallbackActiveStockMission =", from);
  assert.ok(from >= 0 && to > from, "Sélecteur de journée de l'accueil manquant");
  const choose = new Function(
    "getMissionJournees", "isClosedStatus", "isCancelledStatus",
    "normalizeStatus", "todayIso",
    frontend.slice(from, to) + "\nreturn getFirstOpenDay;"
  )(
    () => [day1, day2],
    (day) => ["cloture", "cloturee"].includes(day.statut),
    (day) => day.statut === "annule",
    (value) => String(value || ""),
    () => "2026-10-11"
  );
  assert.equal(choose(stockMission, [day1, day2]).journee_id, day2.journee_id);
  assert.match(frontend, /const summaryReliable = runtimeDayMatches \|\| state\.apiMode !== "getHomeData";/);
});
