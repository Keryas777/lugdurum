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
    Days.preferredDay(assigned, "U_WILL", "LYON_J2", "2026-11-18", true).journee_id,
    "LYON_J2"
  );
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

test("une journée clôturée reste consultable mais la vente y est bloquée", () => {
  const closed = assigned.find((item) => item.journee_id === "CLOSED");
  assert.equal(Days.preferredDay([closed], "U_WILL", "CLOSED", "2026-11-18").journee_id, "CLOSED");
  assert.equal(Days.canSell(closed, "U_WILL", { mission_id: "MST_SHARED", statut: "en_cours" }, "2026-11-17").reason, "closed");
});

test("l’accueil sélectionne par capacité métier, transmet le contexte et ne navigue pas au clic", () => {
  const home = read("docs/home.js");
  const users = read("docs/lugdurum-users.js");
  assert.match(home, /hasCapability\("manage_inscriptions"\)/);
  assert.match(home, /hasCapability\("prepare_stock"\)/);
  assert.doesNotMatch(home, /U_WILL|William/);
  assert.match(users, /capabilities: \["sell", "manage_expenses", "close_day"\]/);
  assert.match(home, /url\.searchParams\.set\("journee_id", getDayId\(homeState\.journee\)\)/);
  assert.match(home, /url\.searchParams\.set\("mission_id", eventId\)/);
  assert.match(home, /url\.searchParams\.set\("stock_mission_id", stockId\)/);
  assert.match(home, /const applySelectedHomeDay = \(\) =>[\s\S]*?renderHome\(\);/);
  assert.match(home, /const rows = simplified[\s\S]*?\{ step: "vente"[\s\S]*?\{ step: "cloture"/);
  assert.match(home, /hasCapability\("manage_inscriptions"\)[\s\S]*?const rows = simplified/);
  assert.match(home, /text: "Vente rapide, encaissements, suivi des ventes et frais\./);
  const applyStart = home.indexOf("  const applySelectedHomeDay =");
  const apply = home.slice(applyStart, home.indexOf("  const renderHome =", applyStart));
  assert.doesNotMatch(apply, /location\.(?:href|assign|replace)|window\.open/);
});

test("le chargement initial réseau strict n’affiche pas l’ancien cache accueil", () => {
  const home = read("docs/home.js");
  const init = home.slice(home.indexOf("  const initHome ="), home.indexOf("  window.addEventListener(\"lugdurum:sync-status\""));
  assert.match(init, /renderLoading\(\);/);
  assert.doesNotMatch(init, /renderFromHomeCacheIfAvailable|loadCacheData/);
  assert.match(read("docs/index.html"), /homeDaySelect/);
  assert.match(read("docs/index.html"), /selectHomeDay/);
  assert.match(home, /window\.addEventListener\("offline"[\s\S]*?Dernières données en ligne/);
  assert.match(home, /window\.addEventListener\("online"[\s\S]*?refreshHomeFromRemote\(\)/);
});
