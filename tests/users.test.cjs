"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "docs", "lugdurum-users.js"), "utf8");
const makePhone = (rows = null) => {
  const data = new Map();
  const tracked = [];
  const window = {
    LugdurumAPI: {
      setCurrentUserId: (id) => tracked.push(id),
      getCoreTable: async () => rows
    }
  };
  const document = { getElementById: () => null };
  const localStorage = {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, String(value))
  };
  vm.runInNewContext(source, { window, document, localStorage, console });
  return { users: window.LugdurumUsers, data, tracked };
};

test("pas d'identité attribuée implicitement au premier lancement", () => {
  const phone = makePhone();
  assert.equal(phone.users.getCurrent(), null);
  assert.equal(phone.users.getUserId(), "");
});

test("deux téléphones conservent deux vendeurs distincts", () => {
  const phoneA = makePhone();
  const phoneB = makePhone();
  assert.equal(phoneA.users.select("U_JEROME"), true);
  assert.equal(phoneB.users.select("U_ANTHONY"), true);
  assert.equal(phoneA.users.getCurrent().nom, "Jérôme");
  assert.equal(phoneB.users.getCurrent().nom, "Anthony");
  assert.equal(phoneA.data.get("lugdurum_current_user_id"), "U_JEROME");
  assert.equal(phoneB.data.get("lugdurum_current_user_id"), "U_ANTHONY");
  assert.deepEqual(phoneA.tracked, ["U_JEROME"]);
  assert.deepEqual(phoneB.tracked, ["U_ANTHONY"]);
});

test("une identité inconnue ne peut pas devenir vendeur", () => {
  const phone = makePhone();
  assert.equal(phone.users.select("U_FAKE"), false);
  assert.equal(phone.users.getUserId(), "");
});

test("une lecture serveur d'utilisateurs inactifs retire ces choix", async () => {
  const phone = makePhone([
    { user_id: "U_JEROME", nom: "Jérôme", role: "admin", actif: "TRUE" },
    { user_id: "U_ANTHONY", nom: "Anthony", role: "vendeur", actif: "FALSE" }
  ]);
  await phone.users.refreshFromSheet();
  assert.equal(phone.users.list().length, 1);
  assert.equal(phone.users.select("U_ANTHONY"), false);
  assert.equal(phone.users.select("U_JEROME"), true);
});
