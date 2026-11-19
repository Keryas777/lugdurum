"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const close = read("docs/cloture.js");
const usersSource = read("docs/lugdurum-users.js");

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Section absente : ${start}`);
  return source.slice(from, to);
}

function sellerClosures(capabilities) {
  const identity = section(close, "  const LEGACY_CURRENT_USER =", "  const STORAGE_KEYS =");
  const movement = section(close, "  const buildClosureMovements =", "  const upsertLocalById =");
  const validation = section(close, "  const validateCountsBeforeClose =", "  const buildDayAndMissionPatchAfterClose =");
  const patch = section(close, "  const buildDayAndMissionPatchAfterClose =", "  const applyDayAndMissionPatchLocal =");
  const state = {
    stockRows: [{ sku_id: "SKU-1" }],
    counts: new Map(),
    linkedDays: [
      { journee_id: "DAY-A", statut: "en_cours", stock_mission_id: "STOCK-SHARED" },
      { journee_id: "DAY-B", statut: "prevu", stock_mission_id: "STOCK-SHARED" }
    ],
    journee: { journee_id: "DAY-A", statut: "en_cours", date: "2026-11-19" },
    mission: {
      mission_id: "STOCK-SHARED", statut: "en_cours", stock_initial_total: 80,
      stock_vendu_total: 14, stock_theorique_total: 66, stock_compte_total: 72,
      stock_ecart_total: 6, closed_at: ""
    },
    existingClosure: null
  };
  const window = { LugdurumUsers: { getCurrent: () => ({
    user_id: "SELLER", nom: "Vendeur", capabilities
  }) } };
  const deps = `
    const state = __state;
    const setStatus = (message) => { __messages.push(message); };
    const MOVEMENT_TYPES = { CLOTURE_COMPTE: "CLOTURE_COMPTE" };
    const getDayEventId = (day) => day.mission_id || "EVENT";
    const normalizeStatus = (value) => String(value || "").toLowerCase();
    const isCancelledStatus = () => false;
    const toNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  `;
  const messages = [];
  const code = `${identity}\n${deps}\n${validation}\n${movement}\n${patch}\nreturn { validateCountsBeforeClose, buildClosureMovements, buildDayAndMissionPatchAfterClose };`;
  return new Function("window", "__state", "__messages", code)(window, state, messages);
}

test("vendeur sans capacité inventaire clôture sans compter ni produire de mouvement stock", () => {
  const h = sellerClosures(["sell", "manage_expenses", "close_day"]);
  assert.equal(h.validateCountsBeforeClose(), true);
  const movements = h.buildClosureMovements({ stock_lignes: [{ sku_id: "SKU-1", stock_compte: 20 }] });
  assert.deepEqual(movements, []);
});

test("clôture simplifiée garde la mission partagée ouverte et conserve ses totaux", () => {
  const h = sellerClosures(["sell", "manage_expenses", "close_day"]);
  const patch = h.buildDayAndMissionPatchAfterClose({
    cloture_id: "CLOSE-A", journee_id: "DAY-A", ca_total_ttc: 100, total_frais_ttc: 4
  });
  assert.equal(patch.updatedJournee.statut, "cloture");
  assert.equal(patch.allClosed, false);
  assert.equal(patch.updatedMission.statut, "en_cours");
  assert.equal(patch.updatedMission.closed_at, "");
  assert.equal(patch.updatedMission.stock_initial_total, 80);
  assert.equal(patch.updatedMission.stock_vendu_total, 14);
  assert.equal(patch.updatedMission.stock_theorique_total, 66);
  assert.equal(patch.updatedMission.stock_compte_total, 72);
  assert.equal(patch.updatedMission.stock_ecart_total, 6);
});

test("profil avec inventaire garde l’obligation de comptage et le mouvement de clôture", () => {
  const h = sellerClosures(["sell", "close_day", "physical_stock_count"]);
  assert.equal(h.validateCountsBeforeClose(), false);
  const movements = h.buildClosureMovements({
    cloture_id: "CLOSE-A", mission_id: "EVENT-A", stock_mission_id: "STOCK-SHARED",
    journee_id: "DAY-A", created_at: "now", updated_at: "now", stock_lignes: [
      { sku_id: "SKU-1", stock_compte: 3, stock_theorique: 2, ecart: 1 }
    ]
  });
  assert.equal(movements.length, 1);
  assert.equal(movements[0].type_mouvement, "CLOTURE_COMPTE");
});

test("les capacités utilisateurs survivent au rafraîchissement Sheets sans colonne dédiée", async () => {
  const values = new Map([["lugdurum_current_user_id", "U_WILL"]]);
  const window = { LugdurumAPI: { getCoreTable: async () => [
    { user_id: "U_WILL", nom: "William changé", role: "vendeur", actif: true },
    { user_id: "U_NEW", nom: "Nouveau", role: "vendeur", actif: true }
  ] } };
  const context = vm.createContext({
    window,
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    }
  });
  vm.runInContext(usersSource, context);
  const users = window.LugdurumUsers;
  assert.equal(users.getCurrent().capabilities.includes("physical_stock_count"), false);
  await users.refreshFromSheet();
  assert.equal(users.getCurrent().nom, "William changé");
  assert.equal(users.getCurrent().capabilities.includes("physical_stock_count"), false);
  assert.equal(users.list().find((item) => item.user_id === "U_NEW").capabilities.includes("sell"), true);
  assert.equal(users.list().find((item) => item.user_id === "U_NEW").capabilities.includes("physical_stock_count"), false);
});
