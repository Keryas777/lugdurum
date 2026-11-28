#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DOCUMENTATION_FILES = new Set([
  'README-SUMUP-VERIFICATION.md'
]);
const CLASP_CONFIG = '.clasp.json';
const MANIFEST = 'appsscript.json';
const SOURCE_EXTENSIONS = new Set(['.gs', '.js', '.html']);
const EXPECTED_SOURCE_CHANGES = [
  '01_http_router.js',
  '11_collective_goals.js'
];

function normalizeSourcePath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const ext = path.posix.extname(normalized);
  if (ext === '.gs' || ext === '.js') {
    return `${normalized.slice(0, -ext.length)}.js`;
  }
  return normalized;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  }
  return value;
}

function readManifest(root) {
  const filePath = path.join(root, MANIFEST);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${root}: manifeste ${MANIFEST} manquant.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${root}: manifeste ${MANIFEST} invalide (${error.message}).`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${root}: manifeste ${MANIFEST} doit contenir un objet JSON.`);
  }
  return canonicalJson(parsed);
}

function collectProject(root) {
  const absoluteRoot = path.resolve(root);
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Répertoire Apps Script absent: ${absoluteRoot}`);
  }

  const sources = new Map();
  function visit(directory, relativeDirectory = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`${absoluteRoot}: lien symbolique inattendu: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        visit(fullPath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`${absoluteRoot}: entrée de fichier inattendue: ${relativePath}`);
      }
      if (relativePath === CLASP_CONFIG || DOCUMENTATION_FILES.has(relativePath)) continue;
      if (relativePath === MANIFEST) continue;

      const ext = path.posix.extname(relativePath);
      if (!SOURCE_EXTENSIONS.has(ext)) {
        throw new Error(`${absoluteRoot}: fichier non déployé non autorisé: ${relativePath}`);
      }

      const key = normalizeSourcePath(relativePath);
      if (sources.has(key)) {
        throw new Error(`${absoluteRoot}: collision après normalisation .gs/.js: ${key}`);
      }
      sources.set(key, fs.readFileSync(fullPath));
    }
  }

  visit(absoluteRoot);
  return { root: absoluteRoot, manifest: readManifest(absoluteRoot), sources };
}

function compareManifests(left, right, context) {
  if (JSON.stringify(left.manifest) !== JSON.stringify(right.manifest)) {
    throw new Error(`${context}: le manifeste appsscript.json diffère.`);
  }
}

function sourceDifferences(left, right) {
  const paths = [...new Set([...left.sources.keys(), ...right.sources.keys()])].sort();
  return paths.filter(file => {
    const a = left.sources.get(file);
    const b = right.sources.get(file);
    return !a || !b || !a.equals(b);
  });
}

function verifyAppsScriptPreflight({ current, production, candidate }) {
  const currentProject = collectProject(current);
  const productionProject = collectProject(production);
  const candidateProject = collectProject(candidate);

  compareManifests(currentProject, productionProject, 'Sources distantes courantes / version de production');
  const remoteDrift = sourceDifferences(currentProject, productionProject);
  if (remoteDrift.length) {
    throw new Error(`Les sources distantes ne correspondent plus à la version de production attendue: ${remoteDrift.join(', ')}`);
  }

  compareManifests(candidateProject, productionProject, 'Candidat / version de production');
  const candidateChanges = sourceDifferences(productionProject, candidateProject);
  if (JSON.stringify(candidateChanges) !== JSON.stringify(EXPECTED_SOURCE_CHANGES)) {
    throw new Error(`Diff Apps Script inattendu; attendu [${EXPECTED_SOURCE_CHANGES.join(', ')}], obtenu [${candidateChanges.join(', ')}].`);
  }

  return {
    verifiedRemoteSources: [...productionProject.sources.keys()].sort(),
    expectedChanges: candidateChanges
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--current', '--production', '--candidate'].includes(key) || !argv[index + 1]) {
      throw new Error('Usage: node ops/apps-script-preflight.cjs --current DIR --production DIR --candidate DIR');
    }
    options[key.slice(2)] = argv[++index];
  }
  if (Object.keys(options).length !== 3) {
    throw new Error('Usage: node ops/apps-script-preflight.cjs --current DIR --production DIR --candidate DIR');
  }
  return options;
}

if (require.main === module) {
  try {
    const result = verifyAppsScriptPreflight(parseArgs(process.argv.slice(2)));
    console.log('Sources distantes identiques à la version Apps Script attendue.');
    console.log('Manifeste présent, JSON valide et configuration identique.');
    console.log(`Diff candidat limitée aux sources attendues: ${result.expectedChanges.join(', ')}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DOCUMENTATION_FILES,
  EXPECTED_SOURCE_CHANGES,
  collectProject,
  normalizeSourcePath,
  verifyAppsScriptPreflight
};
