"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Banc de test DOM minimal : aucune connexion au vrai Google Sheets ni a SumUp.
const source = fs.readFileSync(
  path.join(__dirname, "..", "docs", "vente-rapide.js"),
  "utf8"
);
// Le bootstrap évolue avec le mode cache-first et la reprise SumUp.
const startup = source.slice(source.lastIndexOf("  handleSumupCallbackParams();"));

assert.ok(source.includes(startup), "Point d'injection du banc de test introuvable");
const code = source.replace(
  startup,
  "  window.__test = { state, els, saveTicket, confirmSumupSuccess, " +
    "confirmSumupFailure, reopenSumup, buildTransaction };\n})();"
);

function element() {
  return {
    textContent: "", value: "", innerHTML: "", hidden: true,
    dataset: {}, style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, appendChild() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
}

let nextDevice = 0;

function setup(saveBundle, pendingCount = () => 0) {
  const id = ++nextDevice;
  let seq = 0;
  const calls = [];
  const store = new Map();
  const els = new Map();
  const timers = [];

  const document = {
    title: "Test Lugdurum",
    getElementById(key) {
      if (!els.has(key)) els.set(key, element());
      return els.get(key);
    },
    querySelector: element,
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  const window = {
    location: { href: "https://example.test/vente-rapide.html" },
    history: { replaceState() {} },
    crypto: { randomUUID: () => "device-" + id + "-uuid-" + ++seq },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    addEventListener() {},
    LugdurumAPI: {
      saveVenteRapideBundle(payload) {
        calls.push(payload);
        return saveBundle(payload);
      },
      getPendingWritesCount: pendingCount,
      getTransactions: async () => []
    }
  };
  const localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); }
  };
  vm.runInNewContext(code, {
    window, document, localStorage, navigator: { onLine: true },
    URL, console
  }, { filename: "vente-rapide.js" });

  const api = window.__test;
  api.state.journeeActive = {
    mission_id: "MS_TEST", journee_id: "JV_TEST",
    user_id: "U_TEST", label: "Test", date_label: ""
  };
  api.state.paymentMode = "ESP";
  api.state.ticketItems = [{
    item_id: "ITEM_1", type: "bottle", sku_id: "SKU_TEST",
    parfum_code: "TEST", parfum_nom: "Produit test", format_cl: 50,
    quantite: 1, prix_unitaire_ttc: 25, prix_unitaire_ht: 25, taux_tva: 0
  }];
  api.els.amountPaidInput.value = "25";
  return { api, calls, store, timers, window };
}

test("double clic : une seule ecriture ticket et mouvements de stock", async () => {
  let resolve;
  const app = setup(() => new Promise((done) => { resolve = done; }));
  const first = app.api.saveTicket();
  await app.api.saveTicket();

  assert.equal(app.calls.length, 1);
  assert.equal(app.api.state.saveInProgress, true);
  assert.equal(app.calls[0].mouvements_stock.length, 1);

  resolve({ ok: true });
  await first;
  assert.equal(app.api.state.ticketItems.length, 0);
  assert.equal(app.api.state.saveInProgress, false);
  assert.ok(app.timers.length > 0, "CA differe apres vidage du panier");
});

test("echec incertain : retry avec panier identique = meme transaction_id", async () => {
  let attempt = 0;
  const app = setup(async () => {
    if (++attempt === 1) throw new Error("Reseau incertain");
    return { ok: true };
  });
  await app.api.saveTicket();
  assert.equal(app.api.state.ticketItems.length, 1, "Panier conserve apres erreur");

  await app.api.saveTicket();
  assert.equal(app.calls.length, 2);
  assert.equal(
    app.calls[0].transaction.transaction_id,
    app.calls[1].transaction.transaction_id
  );
  assert.equal(
    app.calls[0].mouvements_stock[0].mouvement_stock_id,
    app.calls[1].mouvements_stock[0].mouvement_stock_id
  );
  assert.equal(app.api.state.ticketItems.length, 0);
});

test("deux vendeurs : transaction_id distincts", async () => {
  const a = setup(async () => ({ ok: true }));
  const b = setup(async () => ({ ok: true }));
  await Promise.all([a.api.saveTicket(), b.api.saveTicket()]);
  assert.notEqual(
    a.calls[0].transaction.transaction_id,
    b.calls[0].transaction.transaction_id
  );
});

test("ecriture hors ligne mise en file : le ticket suivant reste disponible", async () => {
  const app = setup(async () => ({ queued: true }), () => 1);
  await app.api.saveTicket();
  assert.equal(app.calls.length, 1);
  assert.equal(app.api.state.ticketItems.length, 0);
  assert.equal(JSON.parse(app.store.get("lugdurum_transactions_backup")).length, 1);
});

test("SumUp : boutons annuler / retour bloques durant la sauvegarde", async () => {
  let resolve;
  const app = setup(() => new Promise((done) => { resolve = done; }));
  app.api.state.paymentMode = "CB";

  const foreignId = "LUG_123456789";
  const transaction = app.api.buildTransaction({
    provider: "SUMUP", paymentStatus: "SUMUP_LANCE",
    status: "paiement_en_attente", foreignTxId: foreignId
  });
  app.store.set("lugdurum_pending_sumup_ticket", JSON.stringify({
    foreign_tx_id: foreignId,
    sumup_url: "sumupmerchant://pay",
    transaction
  }));

  const saving = app.api.confirmSumupSuccess();
  assert.equal(app.api.state.saveInProgress, true);
  assert.equal(app.api.els.sumupConfirmFailBtn.disabled, true);
  assert.equal(app.api.els.sumupReturnBtn.disabled, true);

  app.api.confirmSumupFailure();
  app.api.reopenSumup();
  assert.ok(app.store.has("lugdurum_pending_sumup_ticket"));
  assert.equal(app.window.location.href, "https://example.test/vente-rapide.html");

  resolve({ ok: true });
  await saving;
  assert.equal(app.api.state.saveInProgress, false);
  assert.equal(app.store.has("lugdurum_pending_sumup_ticket"), false);
});
