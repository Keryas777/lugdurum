"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const path = require("node:path");

// Aucun appel réel à SumUp et aucun secret requis.
const source = fs.readFileSync(
  path.join(__dirname, "..", "apps-script", "10_sumup_verification.gs"), "utf8"
);

const ID = "LUG_1791450000000_123E4567-E89B-12D3-A456-426614174000";
const BASE = {
  foreign_transaction_id: ID,
  merchant_code: "MH000001",
  amount: 34.90,
  currency: "EUR",
  status: "SUCCESSFUL",
  simple_status: "SUCCESSFUL",
  transaction_code: "TEST123"
};

function runSumup({ tx = BASE, httpCode = 200, hasKey = true, params = {} } = {}) {
  const requests = [];
  const context = {
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) {
            if (!hasKey) return "";
            return key === "SUMUP_API_KEY" ? "FAKE_TEST_KEY" : "MH000001";
          }
        };
      }
    },
    UrlFetchApp: {
      fetch(url, opts) {
        requests.push({ url, opts });
        return {
          getResponseCode() { return httpCode; },
          getContentText() { return JSON.stringify(tx); }
        };
      }
    }
  };
  vm.runInNewContext(source, context, { filename: "10_sumup_verification.gs" });
  const response = context.lugdurumGetSumupPaymentStatus({
    foreign_tx_id: ID,
    amount: "34.90",
    currency: "EUR",
    ...params
  });
  return { response, requests };
}

test("paiement réussi, même référence/marchand/montant/devise", () => {
  const { response, requests } = runSumup();
  assert.equal(response.status, "SUCCESSFUL");
  assert.equal(response.verified, true);
  assert.equal(response.foreign_tx_id, ID);
  assert.equal(response.transaction_code, "TEST123");
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.includes("foreign_transaction_id="));
  assert.equal(requests[0].opts.headers.Authorization, "Bearer FAKE_TEST_KEY");
});

test("transaction non encore disponible", () => {
  const { response } = runSumup({ httpCode: 404 });
  assert.equal(response.status, "NOT_FOUND");
  assert.equal(response.verified, false);
});

test("paiement encore en attente", () => {
  const { response } = runSumup({ tx: { ...BASE, status: "PENDING" } });
  assert.equal(response.status, "PENDING");
  assert.equal(response.verified, false);
});

test("paiement échoué ou annulé ou remboursé", () => {
  for (const status of ["FAILED", "CANCELLED", "REFUNDED"]) {
    const { response } = runSumup({ tx: { ...BASE, status } });
    assert.equal(response.status, status);
    assert.equal(response.verified, false);
  }
});

test("remboursement postérieur au succès", () => {
  const { response } = runSumup({
    tx: { ...BASE, status: "SUCCESSFUL", simple_status: "REFUNDED" }
  });
  assert.equal(response.status, "REFUNDED");
  assert.equal(response.verified, false);
});

test("aucune validation sur incohérence de données", () => {
  const variations = [
    { amount: 35.9 },
    { currency: "USD" },
    { merchant_code: "WRONG" },
    { foreign_transaction_id: "WRONG" }
  ];
  for (const patch of variations) {
    const { response } = runSumup({ tx: { ...BASE, ...patch } });
    assert.equal(response.status, "MISMATCH");
    assert.equal(response.verified, false);
  }
});

test("référence trop faible ou mal formée rejetée avant appel API", () => {
  const { response, requests } = runSumup({
    params: { foreign_tx_id: "LUG_1791450000000_AB1234" }
  });
  assert.equal(response.status, "UNSUPPORTED_ID");
  assert.equal(requests.length, 0);
});

test("absence de clé API => aucune lecture SumUp", () => {
  const { response, requests } = runSumup({ hasKey: false });
  assert.equal(response.status, "NOT_CONFIGURED");
  assert.equal(requests.length, 0);
});

test("montant avec plus de deux décimales rejeté", () => {
  const { response, requests } = runSumup({ params: { amount: "34.901" } });
  assert.equal(response.status, "INVALID_REQUEST");
  assert.equal(requests.length, 0);
});


test("cle SumUp refusee : statut neutre sans donnees sensibles", () => {
  for (const httpCode of [401, 403]) {
    const { response } = runSumup({ httpCode });
    assert.equal(response.status, "NOT_AUTHORIZED");
    assert.equal(response.verified, false);
    assert.equal(response.transaction_code, undefined);
  }
});

test("chargeback et non-collection bloquent la validation", () => {
  for (const simple_status of ["CHARGEBACK", "CHARGE_BACK", "NON_COLLECTION"]) {
    const { response } = runSumup({
      tx: { ...BASE, simple_status }
    });
    assert.equal(response.verified, false);
    assert.equal(response.status, simple_status);
  }
});

test("route HTTP GET : status SumUp au format JSON de Lugdurum", () => {
  const routerSource = fs.readFileSync(
    path.join(__dirname, "..", "apps-script", "01_http_router.js"), "utf8"
  );
  const moduleSource = fs.readFileSync(
    path.join(__dirname, "..", "apps-script", "10_sumup_verification.gs"), "utf8"
  );
  const context = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name) => name === "SUMUP_API_KEY" ? "FAKE_TEST_KEY" : "MH000001"
      })
    },
    UrlFetchApp: {
      fetch: () => ({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify(BASE)
      })
    },
    ContentService: {
      MimeType: { JSON: "JSON", JAVASCRIPT: "JAVASCRIPT" },
      createTextOutput(value) {
        return {
          text: value, mime: null,
          setMimeType(type) { this.mime = type; return this; }
        };
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(routerSource, context, { filename: "01_http_router.js" });
  vm.runInContext(moduleSource, context, { filename: "10_sumup_verification.gs" });

  const output = context.doGet({
    parameter: {
      action: "getSumupPaymentStatus",
      foreign_tx_id: ID,
      amount: "34.90",
      currency: "EUR"
    }
  });

  const result = JSON.parse(output.text);
  assert.equal(output.mime, "JSON");
  assert.equal(result.ok, true);
  assert.equal(result.action, "getSumupPaymentStatus");
  assert.equal(result.data.verified, true);
  assert.equal(result.data.status, "SUCCESSFUL");
  assert.equal(result.data.foreign_tx_id, ID);
  assert.equal(result.data.transaction_code, "TEST123");
  assert.ok(!Object.hasOwn(result, "SUMUP_API_KEY"));
  assert.ok(!Object.hasOwn(result.data, "merchant_code"));

  // La couche de lecture PWA emploie JSONP (callback).
  const jsonpOutput = context.doGet({
    parameter: {
      action: "getSumupPaymentStatus",
      foreign_tx_id: ID,
      amount: "34.90",
      currency: "EUR",
      callback: "lugdurumTestCallback"
    }
  });
  assert.equal(jsonpOutput.mime, "JAVASCRIPT");
  assert.ok(jsonpOutput.text.startsWith("lugdurumTestCallback("));
  const jsonp = JSON.parse(jsonpOutput.text.slice("lugdurumTestCallback(".length, -2));
  assert.equal(jsonp.data.verified, true);
});


function createSumupFrontendHarness(verifiedResult) {
  const original = fs.readFileSync(
    path.join(__dirname, "..", "docs", "vente-rapide.js"), "utf8"
  );
  // Activer la verification uniquement dans cette simulation (PAS dans la PWA livree).
  const enabled = original.replace(
    "verificationEnabled: false,",
    "verificationEnabled: true,"
  );
  assert.notEqual(enabled, original, "Flag pilote attendu absent du frontend");
  const start = [
    "  handleSumupCallbackParams();",
    "  renderAll();",
    "  loadContext();",
    "  loadData();",
    "  checkPendingSumup();",
    "})();"
  ].join("\n");
  assert.ok(enabled.includes(start), "Demarrage du frontend non reconnu");
  const source = enabled.replace(
    start,
    "  window.__test = { state, els, verifyPendingSumup, buildTransaction };\n})();"
  );
  const memory = new Map();
  const elements = new Map();
  const saved = [];
  const timers = [];
  const fakeElement = () => ({
    value: "", textContent: "", innerHTML: "", hidden: true, disabled: false,
    dataset: {}, children: [], style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }
  });
  const document = {
    visibilityState: "visible",
    title: "Test",
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, fakeElement());
      return elements.get(id);
    },
    querySelector: fakeElement,
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  const window = {
    crypto: { randomUUID: () => "123E4567-E89B-12D3-A456-426614174000" },
    location: { href: "https://example.test/vente-rapide.html" },
    history: { replaceState() {} },
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout() {},
    addEventListener() {},
    LugdurumAPI: {
      async verifySumupPayment() { return verifiedResult; },
      async saveVenteRapideBundle(payload) {
        saved.push(payload);
        return { ok: true };
      },
      async getTransactions() { return []; },
      getPendingWritesCount() { return 0; }
    }
  };
  const localStorage = {
    getItem(key) { return memory.get(key) || null; },
    setItem(key, value) { memory.set(key, String(value)); },
    removeItem(key) { memory.delete(key); }
  };
  vm.runInNewContext(source, {
    window, document, localStorage, navigator: { onLine: true },
    URL, URLSearchParams, console
  }, { filename: "vente-rapide.js" });
  const app = window.__test;
  app.state.journeeActive = {
    mission_id: "MS_TEST", journee_id: "JV_TEST", user_id: "U_TEST"
  };
  app.state.ticketItems = [{
    item_id: "1", type: "bottle", sku_id: "S", parfum_code: "P",
    parfum_nom: "TEST", format_cl: 50, quantite: 1,
    prix_unitaire_ttc: 34.90, prix_unitaire_ht: 34.90
  }];
  app.state.paymentMode = "CB";
  app.els.amountPaidInput.value = "34.90";
  const transaction = app.buildTransaction({
    provider: "SUMUP",
    paymentStatus: "SUMUP_LANCE",
    status: "paiement_en_attente",
    foreignTxId: ID
  });
  memory.set("lugdurum_pending_sumup_ticket", JSON.stringify({
    foreign_tx_id: ID,
    sumup_url: "sumupmerchant://pay/1.0",
    transaction
  }));
  return { app, memory, saved, timers };
}

test("PWA pilote : paiement API SUCCESSFUL => un ticket valide et panier vide", async () => {
  const h = createSumupFrontendHarness({
    verified: true,
    status: "SUCCESSFUL",
    foreign_tx_id: ID,
    transaction_code: "TEST123"
  });
  await h.app.verifyPendingSumup();
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].transaction.statut, "validee");
  assert.equal(h.saved[0].transaction.paiement_statut, "PAYE");
  assert.equal(h.saved[0].transaction.transaction_id, ID);
  assert.equal(h.app.state.ticketItems.length, 0);
  assert.equal(h.memory.has("lugdurum_pending_sumup_ticket"), false);
});

test("PWA pilote : MISMATCH ne doit jamais enregistrer la vente", async () => {
  const h = createSumupFrontendHarness({ verified: false, status: "MISMATCH" });
  await h.app.verifyPendingSumup();
  assert.equal(h.saved.length, 0);
  assert.equal(h.app.state.ticketItems.length, 1);
  assert.equal(h.memory.has("lugdurum_pending_sumup_ticket"), true);
});

test("PWA pilote : NOT_FOUND ne valide rien et planifie une nouvelle lecture", async () => {
  const h = createSumupFrontendHarness({
    verified: false, status: "NOT_FOUND", retryable: true
  });
  await h.app.verifyPendingSumup();
  assert.equal(h.saved.length, 0);
  assert.ok(h.timers.length > 0);
  assert.equal(h.memory.has("lugdurum_pending_sumup_ticket"), true);
});
