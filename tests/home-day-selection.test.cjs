"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Days = require("../docs/lugdurum-day-context.js");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const day = (id, date, userIds, status = "prevu", extra = {}) => ({
  journee_id: id,
  mission_id: `EVT_${id}`,
  stock_mission_id: "MST_SHARED",
  date,
  statut: status,
  vendeurs_autorises: JSON.stringify(userIds.map((user_id) => ({ user_id }))),
  ...extra
});

const assigned = [
  day("LYON_J1", "2026-11-18", ["U_WILL", "U_ANTHONY"], "en_cours"),
  day("LYON_J2", "2026-11-19", ["U_WILL"]),
  day("OTHER_VENDOR", "2026-11-18", ["U_ANTHONY"]),
  day("CLOSED", "2026-11-17", ["U_WILL"], "cloture")
];

test("le sélecteur ne retourne que les journées autorisées au vendeur courant", () => {
  assert.deepEqual(
    Days.authorizedDaysFor(assigned, "U_WILL").map((item) => item.journee_id),
    ["CLOSED", "LYON_J1", "LYON_J2"]
  );
});

test("une journée commencée reste prioritaire sur une sélection mémorisée", () => {
  assert.equal(
    Days.preferredDay(assigned, "U_WILL", "LYON_J2", "2026-11-18").journee_id,
    "LYON_J1"
  );
});

test("une sélection explicitement validée peut changer le contexte pendant la session", () => {
  assert.equal(
    Days.preferredDay(assigned, "U_WILL", "LYON_J2", "2026-11-18", true, true).journee_id,
    "LYON_J2"
  );
});

test("une nouvelle journée aujourd’hui remplace une préférence future mémorisée", () => {
  const days = [
    day("TODAY", "2026-11-19", ["U_WILL"]),
    day("FUTURE", "2026-11-22", ["U_WILL"])
  ];
  assert.equal(Days.preferredDay(days, "U_WILL", "FUTURE", "2026-11-19", true)?.journee_id, "TODAY");
});

test("la sélection mémorisée est conservée si elle reste affectée et ouverte", () => {
  assert.equal(
    Days.preferredDay(assigned, "U_WILL", "LYON_J2", "2026-11-18").journee_id,
    "LYON_J1"
  );
  const nextDay = assigned.filter((item) => item.journee_id !== "LYON_J1");
  assert.equal(Days.preferredDay(nextDay, "U_WILL", "LYON_J2", "2026-11-18").journee_id, "LYON_J2");
});

test("une ancienne sélection non affectée est invalidée et ne révèle pas la journée d’un autre vendeur", () => {
  assert.equal(Days.preferredDay(assigned, "U_WILL", "OTHER_VENDOR", "2026-11-18").journee_id, "LYON_J1");
  assert.equal(Days.isAuthorized(assigned.find((item) => item.journee_id === "OTHER_VENDOR"), "U_WILL"), false);
});

test("une journée clôturée est exclue du parcours actif", () => {
  const closed = assigned.find((item) => item.journee_id === "CLOSED");
  assert.equal(Days.preferredDay([closed], "U_WILL", "CLOSED", "2026-11-18"), null);
  assert.equal(Days.canSell(closed, "U_WILL", { mission_id: "MST_SHARED", statut: "en_cours" }, "2026-11-17").reason, "closed");
});

test("une sélection devenue clôturée laisse la journée ouverte suivante reprendre la priorité", () => {
  const days = [
    day("YESTERDAY", "2026-11-18", ["U_WILL"], "cloture"),
    day("TODAY", "2026-11-19", ["U_WILL"], "prevu")
  ];
  assert.equal(Days.preferredDay(days, "U_WILL", "YESTERDAY", "2026-11-19").journee_id, "TODAY");
});

test("plusieurs marchés le même jour exigent un choix mémorisé explicitement", () => {
  const days = [
    day("MARKET_A", "2026-11-19", ["U_WILL"], "en_cours"),
    day("MARKET_B", "2026-11-19", ["U_WILL"], "en_cours")
  ];
  assert.equal(Days.preferredDay(days, "U_WILL", "MARKET_B", "2026-11-19"), null);
  assert.equal(Days.preferredDay(days, "U_WILL", "MARKET_B", "2026-11-19", true)?.journee_id, "MARKET_B");
});

test("un retrait d’affectation invalide la journée même si elle est mémorisée", () => {
  const days = [day("REMOVED", "2026-11-19", ["U_ANTHONY"], "en_cours")];
  assert.equal(Days.preferredDay(days, "U_WILL", "REMOVED", "2026-11-19"), null);
});

test("l’accueil dérive tous ses blocs du contexte journée et transmet les quatre identifiants", () => {
  const home = read("docs/home.js");
  const users = read("docs/lugdurum-users.js");
  assert.match(home, /hasCapability\("manage_inscriptions"\)/);
  assert.match(home, /hasCapability\("prepare_stock"\)/);
  assert.doesNotMatch(home, /U_WILL|William/);
  assert.match(users, /capabilities: \["sell", "manage_expenses", "close_day"\]/);
  assert.match(home, /const context = homeState\?\.workContext/);
  assert.match(home, /url\.searchParams\.set\("journee_id", context\.journee_id\)/);
  assert.match(home, /url\.searchParams\.set\("mission_id", context\.mission_id\)/);
  assert.match(home, /url\.searchParams\.set\("stock_mission_id", context\.stock_mission_id\)/);
  assert.match(home, /url\.searchParams\.set\("user_id", context\.user_id\)/);
  assert.match(home, /resolveWorkContext\(/);
  assert.match(home, /renderDaySelector\(homeState\)[\s\S]*?renderHero\(homeState, uiState\)[\s\S]*?renderWorkflow\(homeState, uiState\)/);
  assert.match(home, /rows = \[\s*\{ step: "vente", title: "Ventes"[\s\S]*?\{ step: "cloture", title: "Clôture"/);
  assert.doesNotMatch(home, /renderEventSelector|renderAssignedSellerDay|Le choix est temporaire|eventSelectorCount/);
  assert.match(home, /text: "Vente rapide, encaissements, suivi des ventes et frais\./);
  const applyStart = home.indexOf("  const applySelectedHomeDay =");
  const apply = home.slice(applyStart, home.indexOf("  const renderHome =", applyStart));
  assert.doesNotMatch(apply, /location\.(?:href|assign|replace)|window\.open/);
});

test("l’accueil essaie le réseau avant d’utiliser le cache hors ligne", () => {
  const home = read("docs/home.js");
  const init = home.slice(home.indexOf("  const initHome ="), home.indexOf("  window.addEventListener(\"lugdurum:sync-status\""));
  assert.match(init, /renderLoading\(\);/);
  const networkRead = init.indexOf("const data = await loadRemoteData(isCurrent)");
  const cacheFallback = init.indexOf("if (renderFromHomeCacheIfAvailable()) return;");
  assert.ok(networkRead >= 0 && cacheFallback > networkRead);
  assert.match(init, /if \(!data \|\| !isCurrent\(\)\) return;/);
  assert.match(home, /const renderFromHomeCacheIfAvailable = \(\) => \{[\s\S]*?state\.dataSource = "local";[\s\S]*?setDataState\("local", "Mode hors ligne"\)/);
  assert.match(read("docs/index.html"), /homeDaySelect/);
  assert.doesNotMatch(read("docs/index.html"), /selectHomeDay/);
  assert.match(home, /window\.addEventListener\("offline"[\s\S]*?"Mode hors ligne"/);
  assert.match(home, /window\.addEventListener\("online"[\s\S]*?state\.dataSource === "local" \|\| state\.dataSource === "cache"[\s\S]*?refreshHomeFromRemote\(\)/);
});
