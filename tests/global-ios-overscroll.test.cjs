"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const docs = path.join(__dirname, "..", "docs");
const css = fs.readFileSync(path.join(docs, "style.css"), "utf8");

test("Le rebond vertical est désactivé sur html et body sans bloquer le défilement", () => {
  assert.match(css, /html,\s*body\s*\{[^}]*overscroll-behavior-y:\s*none;/);
  assert.doesNotMatch(css, /overscroll-behavior-y:\s*auto;/);
  assert.match(css, /touch-action:\s*pan-y;/);
  assert.match(css, /overflow-y:\s*auto;/);
  assert.doesNotMatch(css, /body\s*\{[^}]*position:\s*fixed;/);
});

test("Toutes les pages HTML utilisent le correctif anti-rebond", () => {
  const pages = fs.readdirSync(docs).filter((name) => name.endsWith(".html"));
  let shared = 0;
  for (const name of pages) {
    const html = fs.readFileSync(path.join(docs, name), "utf8");
    if (name === "diagnostic-sync.html") {
      assert.match(html, /href="\.\/diagnostic-sync\.css\?v=2"/);
    } else if (name === "api-test.html") {
      assert.match(html, /html,\s*body\s*\{\s*overscroll-behavior-y:\s*none;/);
    } else {
      assert.match(html, /href="\.\/style\.css\?v=24"/, name);
      shared += 1;
    }
  }
  assert.ok(shared >= 24);
  const diagnostic = fs.readFileSync(path.join(docs, "diagnostic-sync.css"), "utf8");
  assert.match(diagnostic, /html,\s*body\s*\{\s*overscroll-behavior-y:\s*none;/);
});

test("La vente rapide conserve son défilement interne", () => {
  const sale = fs.readFileSync(path.join(docs, "vente-rapide.css"), "utf8");
  assert.match(sale, /overflow-y:\s*auto;/);
  assert.match(sale, /overscroll-behavior:\s*contain;/);
});
