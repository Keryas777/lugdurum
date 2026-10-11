"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const docs = path.join(__dirname, "..", "docs");
const css = fs.readFileSync(path.join(docs, "style.css"), "utf8");

test("L'anti-rebond vertical reste réservé à Safari iOS, sans verrouiller Android", () => {
  const rootRule = css.match(/html,\s*body\s*\{([^}]*)\}/);
  assert.ok(rootRule);
  assert.doesNotMatch(rootRule[1], /overscroll-behavior-y:\s*none;/);
  assert.match(css, /@supports\s*\(-webkit-touch-callout:\s*none\)\s*\{\s*html,\s*body\s*\{[^}]*overscroll-behavior-y:\s*none;/);
  assert.match(css, /touch-action:\s*pan-y;/);
  assert.match(css, /overflow-y:\s*auto;/);
  assert.doesNotMatch(css, /body\s*\{[^}]*position:\s*fixed;/);
});

test("Toutes les pages HTML utilisent le correctif anti-rebond", () => {
  const pages = fs.readdirSync(docs).filter((name) => name.endsWith(".html"));
  let shared = 0;
  for (const name of pages) {
    const html = fs.readFileSync(path.join(docs, name), "utf8");
    // Les fichiers de fragments HTML ne sont pas des pages de l’application.
    if (!/<!doctype html/i.test(html)) continue;
    if (name === "diagnostic-sync.html") {
      assert.match(html, /href="\.\/diagnostic-sync\.css\?v=2"/);
    } else if (name === "api-test.html") {
      assert.match(html, /html,\s*body\s*\{\s*overscroll-behavior-y:\s*none;/);
    } else {
      assert.match(html, name === "vente-rapide.html"
        ? /href="\.\/style\.css\?v=25"/
        : /href="\.\/style\.css\?v=24"/, name);
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
