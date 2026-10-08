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
