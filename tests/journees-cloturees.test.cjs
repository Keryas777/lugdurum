"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// On teste le vrai rendu sans contacter Apps Script ni démarrer l'application.
const docs = path.join(__dirname, "..", "docs");
const source = fs.readFileSync(path.join(docs, "journees-cloturees.js"), "utf8");
const bootstrap = /\n  init\(\);\s*\}\)\(\);\s*$/;
assert.match(source, bootstrap, "Bootstrap de la page introuvable");

const instrumented = source.replace(
  bootstrap,
  "\n  window.__test = { renderDetailProducts, renderDayCard };\n})();"
);

const window = {};
vm.runInNewContext(instrumented, {
  window,
  document: { getElementById() { return null; } },
  console
}, { filename: "journees-cloturees.js" });

const { renderDetailProducts, renderDayCard } = window.__test;

const products = [
  { parfum_code: "MV", gamme: "Collection", q50: 0, q20: 1, autres: 0 },
  { parfum_code: "VT", gamme: "Exception", q50: 2, q20: 1, autres: 0 },
  { parfum_code: "VB", gamme: "Prestige", q50: 1, q20: 0, autres: 0 },
  { parfum_code: "FP", gamme: "Exception", q50: 0, q20: 1, autres: 0 },
  { parfum_code: "LP", gamme: "Exception", q50: 1, q20: 0, autres: 0 }
];

test("Le tableau possède trois colonnes sémantiques et conserve les gammes", () => {
  const html = renderDetailProducts(products);
  assert.match(html, /<table class="closedSalesTable">/);
  assert.match(html, /<th scope="col">Réf\.<\/th>/);
  assert.match(html, /<th scope="col">50 cL<\/th>/);
  assert.match(html, /<th scope="col">20 cL<\/th>/);
  assert.equal((html.match(/class="closedSalesRow"/g) || []).length, 5);
  assert.ok(html.indexOf("Prestige") < html.indexOf("Exception"));
  assert.ok(html.indexOf("Exception") < html.indexOf("Collection"));
  assert.match(html, /<th scope="row">VT<\/th>\s*<td><span class="closedSalesQty">2<\/span><\/td>\s*<td><span class="closedSalesQty">1<\/span><\/td>/);
  assert.match(html, /<th scope="row">VB<\/th>\s*<td><span class="closedSalesQty">1<\/span><\/td>\s*<td><span class="closedSalesQtyEmpty" aria-label="0">—<\/span><\/td>/);
  assert.match(html, /<th scope="row">Total<\/th>\s*<td>4<\/td>\s*<td>3<\/td>/);
});

test("Aucune vente et autres formats sont pris en charge", () => {
  assert.match(renderDetailProducts([]), /Aucun produit vendu renseigné/);
  const html = renderDetailProducts([
    { parfum_code: "XX", gamme: "Autre", q50: 0, q20: 0, autres: 3 }
  ]);
  assert.match(html, /Autre/);
  assert.match(html, /Autres formats non affichés : 3 bouteille\(s\)/);
});

test("Les références sont échappées et les CSS sont reliés à la page", () => {
  const html = renderDetailProducts([
    { parfum_code: "<img src=x>", gamme: "Collection", q50: 1, q20: 0, autres: 0 }
  ]);
  assert.ok(!html.includes("<img src=x>"));
  assert.ok(html.includes("&lt;img src=x&gt;"));

  const css = fs.readFileSync(path.join(docs, "journees-cloturees.css"), "utf8");
  const page = fs.readFileSync(path.join(docs, "journees-cloturees.html"), "utf8");
  assert.match(css, /\.closedSalesTable \.closedSalesRow td/);
  assert.match(page, /journees-cloturees\.css\?v=4/);
  assert.match(page, /journees-cloturees\.js\?v=5/);
  assert.match(page, /class="detailBlock isSalesTable"/);
});

test("La carte récapitulative ne montre plus les chips produits", () => {
  const html = renderDayCard({
    key: "JR-TEST", journee_id: "JR-TEST",
    label: "Foire aux pansettes de Gerzat — J1",
    date: "2024-10-13", ville: "Gerzat",
    ca: 561, frais: 0, tickets: 3,
    paiements: [{ label: "Espèces", total: 398.02 }, { label: "CB", total: 99 }],
    products
  });
  assert.ok(!html.includes("closedProductsGrid"));
  assert.ok(!html.includes("closedProductChip"));
  assert.ok(!html.includes(">VB<"));
  assert.match(html, /Foire aux pansettes de Gerzat/);
  assert.match(html, /Voir détail/);
  assert.match(html, /Modifier/);
  assert.match(html, /Frais/);
  assert.match(html, /Net/);
  assert.match(html, /Espèces/);
  assert.match(renderDetailProducts(products), /<th scope="row">VB<\/th>/);
});

function startClosedDaysWithStorage({ failCache = "", apiFails = false, identical = false } = {}) {
  const memory = new Map([["lugdurum_pending_writes", '[{"id":"VENTE_A_SYNC"}]']]);
  const rows = { getTransactions: [{ transaction_id: "TX_ONLINE", total_encaisse_ttc: 25 }] };
  const cacheMap = {
    getTransactions: "lugdurum_transactions_cache",
    getVentesLignes: "lugdurum_ventes_lignes_cache",
    getFrais: "lugdurum_frais_cache",
    getJournees: "lugdurum_journees_cache",
    getMissionsStock: "lugdurum_missions_stock_cache",
    getMissions: "lugdurum_missions_vente_cache",
    getCatalogue: "lugdurum_catalogue_cache"
  };
  let writes = 0;
  if (identical) {
    Object.entries(cacheMap).forEach(([fn, key]) => {
      memory.set(key, JSON.stringify(rows[fn] || []));
    });
  }
  const localStorage = {
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) {
      writes++;
      if (key === failCache) {
        const error = new Error("The quota has been exceeded.");
        error.name = "QuotaExceededError";
        throw error;
      }
      memory.set(key, String(value));
    }
  };
  const status = {
    textContent: "",
    className: "",
    classList: { add() {}, remove() {} }
  };
  const document = {
    getElementById(id) { return id === "closedDaysStatus" ? status : null; },
    addEventListener() {},
    querySelectorAll() { return []; }
  };
  const script = source.replace(
    bootstrap,
    "\\n  window.__test = { init, loadRemote, state };\\n})();".replaceAll("\\n", "\n")
  );
  const pageWindow = { LugdurumAPI: {} };
  Object.keys(cacheMap).forEach((fn) => {
    pageWindow.LugdurumAPI[fn] = async () => {
      if (apiFails && fn === "getFrais") throw new Error("Google indisponible");
      return rows[fn] || [];
    };
  });
  vm.runInNewContext(script, { window: pageWindow, document, localStorage, console }, { filename: "journees-cloturees.js" });
  return {
    ...pageWindow.__test, status, memory,
    get writes() { return writes; }
  };
}

test("Safari plein : les données API restent affichées et aucune vente en attente n'est effacée", async () => {
  const h = startClosedDaysWithStorage({ failCache: "lugdurum_transactions_cache" });
  await h.init();
  assert.equal(h.state.source, "api");
  assert.equal(h.state.transactions[0].transaction_id, "TX_ONLINE");
  assert.match(h.status.textContent, /Données en ligne à jour/);
  assert.match(h.status.textContent, /Cache local indisponible/);
  assert.doesNotMatch(h.status.textContent, /API indisponible/);
  assert.equal(JSON.parse(h.memory.get("lugdurum_pending_writes"))[0].id, "VENTE_A_SYNC");
  assert.equal(h.memory.get("lugdurum_ventes_lignes_cache"), "[]");
});

test("Cache inchangé : ne réécrit pas sept historiques sur iOS", async () => {
  const h = startClosedDaysWithStorage({ identical: true });
  await h.init();
  assert.equal(h.state.source, "api");
  assert.equal(h.writes, 0);
  assert.equal(h.status.textContent, "");
});

test("Vraie panne API : le statut distingue le réseau du stockage local", async () => {
  const h = startClosedDaysWithStorage({ apiFails: true });
  await h.init();
  assert.equal(h.state.source, "local");
  assert.match(h.status.textContent, /Lecture API impossible/);
  assert.match(h.status.textContent, /Google indisponible/);
});
