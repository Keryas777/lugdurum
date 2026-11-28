'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { verifyAppsScriptPreflight } = require('../ops/apps-script-preflight.cjs');

const manifest = JSON.stringify({ timeZone: 'Europe/Paris', dependencies: {}, exceptionLogging: 'STACKDRIVER', runtimeVersion: 'V8' }, null, 2);

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lugdurum-apps-script-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

function projects(t, { remoteExtension = '.gs', candidateExtension = '.js', manifestValue = manifest } = {}) {
  const router = `function invokeGetAction_(action, params) {\n  return action;\n}\n`;
  const remoteFiles = {
    'appsscript.json': manifestValue,
    [`01_http_router${remoteExtension}`]: router,
    '10_existing.gs': 'function existing_() { return true; }\n',
    'README-SUMUP-VERIFICATION.md': 'local docs only\n'
  };
  const candidateFiles = {
    'appsscript.json': manifest,
    [`01_http_router${candidateExtension}`]: `${router}// collective route\n`,
    '10_existing.js': 'function existing_() { return true; }\n',
    '11_collective_goals.js': 'function getCollectiveGoal_() { return { amount: 0 }; }\n',
    'README-SUMUP-VERIFICATION.md': 'docs changed; not deployed\n'
  };
  return {
    current: fixture(t, remoteFiles),
    production: fixture(t, remoteFiles),
    candidate: fixture(t, candidateFiles)
  };
}

test('normalise .gs et .js, exclut le README explicitement et accepte le delta prévu', t => {
  const input = projects(t);
  const result = verifyAppsScriptPreflight(input);
  assert.deepEqual(result.expectedChanges, ['01_http_router.js', '11_collective_goals.js']);
});

test('refuse une collision .gs/.js après normalisation', t => {
  const input = projects(t);
  fs.writeFileSync(path.join(input.production, '10_existing.js'), 'duplicate');
  assert.throws(() => verifyAppsScriptPreflight(input), /collision après normalisation/);
});

test('compare strictement les sources exécutables, y compris les espaces', t => {
  const input = projects(t);
  fs.writeFileSync(path.join(input.current, '10_existing.gs'), 'function existing_() { return true; }  \n');
  assert.throws(() => verifyAppsScriptPreflight(input), /sources distantes ne correspondent/);
});

test('refuse une source supplémentaire dans la version distante', t => {
  const input = projects(t);
  fs.writeFileSync(path.join(input.current, 'unexpected.js'), 'function unexpected_() {}\n');
  assert.throws(() => verifyAppsScriptPreflight(input), /sources distantes ne correspondent/);
});

test('refuse une source supplémentaire dans le candidat', t => {
  const input = projects(t);
  fs.writeFileSync(path.join(input.candidate, '12_unexpected.gs'), 'function unexpected_() {}\n');
  assert.throws(() => verifyAppsScriptPreflight(input), /Diff Apps Script inattendu/);
});

test('refuse une source attendue manquante ou modifiée de façon inattendue', t => {
  const input = projects(t);
  fs.rmSync(path.join(input.candidate, '11_collective_goals.js'));
  assert.throws(() => verifyAppsScriptPreflight(input), /Diff Apps Script inattendu/);
});

test('vérifie la validité et le contenu du manifeste', t => {
  const invalid = projects(t, { manifestValue: '{invalid json' });
  assert.throws(() => verifyAppsScriptPreflight(invalid), /manifeste appsscript.json invalide/);
});

test('refuse toute différence de configuration du manifeste candidat', t => {
  const input = projects(t);
  fs.writeFileSync(path.join(input.candidate, 'appsscript.json'), JSON.stringify({ timeZone: 'UTC', runtimeVersion: 'V8' }));
  assert.throws(() => verifyAppsScriptPreflight(input), /manifeste appsscript.json diffère/);
});

test('refuse un fichier non déployé absent de la liste documentaire explicite', t => {
  const input = projects(t);
  fs.writeFileSync(path.join(input.candidate, 'notes.txt'), 'not a script');
  assert.throws(() => verifyAppsScriptPreflight(input), /fichier non déployé non autorisé/);
});
