"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sale = fs.readFileSync(path.join(__dirname, "..", "docs", "vente-rapide.js"), "utf8");
const start = sale.indexOf("  const calculateAvailableStock = (");
const end = sale.indexOf("  const showStockSummary = () => {", start);
assert.ok(start >= 0 && end > start, "Stock disponible : calcul isolable introuvable");

const calculate = new Function(
  "normalizeKey", "toNumber",
  sale.slice(start, end) + "\nreturn calculateAvailableStock;"
)(
  (value) => String(value ?? "").trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[\s-]+/g, "_"),
  (value, fallback = 0) => {
    const result = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(result) ? result : fallback;
  }
);

const missionId = "MST_GERZAT";
const j1 = { journee_id: "J_GERZAT_J1", stock_mission_id: missionId, date: "2026-10-10", statut: "cloture" };
const j2 = { journee_id: "J_GERZAT_J2", stock_mission_id: missionId, date: "2026-10-11", statut: "pret" };
const days = [j1, j2];

const initial = (code, format, qty, i) => ({
  mouvement_stock_id: "PREP_" + i,
  stock_mission_id: missionId, journee_id: j1.journee_id,
  type_mouvement: "PREPARATION", sens: "ENTREE",
  sku_id: code + "_" + format, format_cl: format, quantite: qty, statut: "valide"
});
const report = (code, format, qty, i) => ({
  mouvement_stock_id: "REPORT_" + i,
  stock_mission_id: missionId, journee_id: j2.journee_id,
  type_mouvement: "REPORT_CLOTURE",
  sku_id: code + "_" + format, format_cl: format, quantite: qty, statut: "valide"
});
// Stocks vrais du report J1 -> J2 (17 SKU), relevés dans Google Sheets.
const quantities50 = [9, 7, 10, 9, 8, 6, 6, 19, 14];
const codes50 = ["AT", "CG", "FP", "LP", "MV", "OC", "PR", "VB", "VT"];
const quantities20 = [8, 6, 7, 8, 7, 6, 6, 9];
const codes20 = ["AT", "CG", "FP", "LP", "MV", "OC", "PR", "VT"];
const reports = [
  ...quantities50.map((q, i) => report(codes50[i], 50, q, i)),
  ...quantities20.map((q, i) => report(codes20[i], 20, q, 100 + i))
];

test("Gerzat : J2 affiche 145 = 88 × 50 cL + 57 × 20 cL", () => {
  // Même si la préparation initiale figure dans la même mission, on ne
  // l'additionne PAS au report (ni 297 ni 152).
  const rows = reports.concat([
    initial("AT", 50, 9, 1), initial("FP", 20, 8, 2),
    { ...reports[0], mouvement_stock_id: "CLOTURE_COMPTE_1",
      journee_id: j1.journee_id, type_mouvement: "CLOTURE_COMPTE" }
  ]);
  const result = calculate(rows, missionId, j2, days);
  assert.equal(result.source, "report_cloture");
  assert.equal(result.total, 145);
  assert.equal(result.total50, 88);
  assert.equal(result.total20, 57);
});

test("deux vendeurs : déduire uniquement les sorties de J2, sans doublon", () => {
  const vente = (id, sku, format, qty, journeeId) => ({
    mouvement_stock_id: id, stock_mission_id: missionId,
    journee_id: journeeId, type_mouvement: "vente",
    sens: "SORTIE", sku_id: sku, format_cl: format,
    quantite: qty, statut: "valide"
  });
  const saleJerome = vente("MVT_JEROME", "VT_50", 50, 2, j2.journee_id);
  const saleAnthony = vente("MVT_ANTHONY", "FP_20", 20, 3, j2.journee_id);
  const j1Historical = vente("OLD", "VB_50", 50, 1, j1.journee_id);
  const result = calculate(
    [...reports, saleJerome, saleJerome, saleAnthony, j1Historical],
    missionId, j2, days
  );
  assert.equal(result.total, 140);
  assert.equal(result.total50, 86);
  assert.equal(result.total20, 54);
});

test("réappro et mouvements annulés : total corrigé sans double débit", () => {
  const extras = [
    { mouvement_stock_id: "REAPPRO_J2", stock_mission_id: missionId,
      journee_id: j2.journee_id, sku_id: "VT_50", format_cl: 50,
      type_mouvement: "REAPPRO", sens: "ENTREE", quantite: 2, statut: "valide" },
    { mouvement_stock_id: "VENTE_ANNULEE", stock_mission_id: missionId,
      journee_id: j2.journee_id, sku_id: "VT_50", format_cl: 50,
      type_mouvement: "vente", sens: "SORTIE", quantite: 7, statut: "annule" }
  ];
  assert.equal(calculate([...reports, ...extras], missionId, j2, days).total, 147);
});

test("sans report J2 : ne jamais présenter 152 comme stock disponible", () => {
  const source = [initial("VT", 50, 92, 1), initial("FP", 20, 60, 2)];
  assert.equal(calculate(source, missionId, j2, days), null);
  const first = calculate(source, missionId, j1, days);
  assert.equal(first.total, 152);
  assert.equal(first.source, "preparation");
});

test("lecture stock non bloquante et source versionnée pour Safari/PWA", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "docs", "vente-rapide.html"), "utf8");
  assert.match(page, /id="stockTravelTitle">Stock disponible/);
  assert.match(page, /vente-rapide\.js\?v=\d+/);
  assert.match(page, /vente-rapide\.css\?v=\d+/);
  assert.match(sale, /void loadStockSummaryFromNetwork\(\);/);
  assert.match(sale, /api\(\)\.getCoreData\(\["mouvementsStock"\]/);
  assert.match(sale, /stock_mission_id: missionId, journee_id: dayId/);
});
