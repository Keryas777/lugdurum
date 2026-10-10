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
  "\n  window.__test = { renderDetailProducts };\n})();"
);

const window = {};
vm.runInNewContext(instrumented, {
  window,
  document: { getElementById() { return null; } },
  console
}, { filename: "journees-cloturees.js" });

const { renderDetailProducts } = window.__test;

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
  assert.match(page, /journees-cloturees\.css\?v=2/);
  assert.match(page, /journees-cloturees\.js\?v=3/);
  assert.match(page, /class="detailBlock isSalesTable"/);
});
