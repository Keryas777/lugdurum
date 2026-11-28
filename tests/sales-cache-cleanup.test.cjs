const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../docs/sales-cache-cleanup.js"), "utf8");
const txKey = "lugdurum_transactions_cache";
const lineKey = "lugdurum_ventes_lignes_cache";
const markerKey = "lugdurum_sales_cache_partial";

const makeHarness = ({
  transactions = [], lines = [], missions = [], days = [],
  online = true, pendingWrites = 0, failLineRead = false, quota = Infinity
} = {}) => {
  const data = new Map();
  let used = 0;
  let apiCalls = 0;
  const storage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) {
      value = String(value);
      const nextUsed = used - (data.get(key)?.length || 0) + value.length;
      if (nextUsed > quota) {
        const error = new Error("Quota exceeded");
        error.name = "QuotaExceededError";
        throw error;
      }
      data.set(key, value);
      used = nextUsed;
    },
    removeItem(key) {
      if (data.has(key)) used -= data.get(key).length;
      data.delete(key);
    }
  };
  const api = {
    async getTransactions() { apiCalls += 1; return transactions; },
    async getVentesLignes() {
      apiCalls += 1;
      if (failLineRead) return { error: "partial" };
      return lines;
    },
    async getMissionsStock() { apiCalls += 1; return missions; },
    async getJournees() { apiCalls += 1; return days; },
    getPendingWritesCount() { return pendingWrites; },
    getLegacyPendingTransactions() { return []; }
  };
  const window = { LugdurumAPI: api, setTimeout: (callback, delay) => setTimeout(callback, delay) };
  vm.runInNewContext(source, {
    window,
    localStorage: storage,
    navigator: { onLine: online },
    console
  });
  return { storage, api, cleanup: window.LugdurumSalesCacheCleanup, get apiCalls() { return apiCalls; } };
};

const setJson = (storage, key, value) => storage.setItem(key, JSON.stringify(value));
const getJson = (storage, key) => JSON.parse(storage.getItem(key));
const closedMission = (mission_id) => ({ mission_id, statut: "cloture", closed_at: "2026-11-27T21:00:00Z" });
const openMission = (mission_id) => ({ mission_id, statut: "en_cours", closed_at: "" });
const day = (journee_id, mission_id, stock_mission_id = "MST-1") => ({ journee_id, mission_id, stock_mission_id, statut: "cloture" });

(async () => {
  {
    const h = makeHarness({
      transactions: [
        { transaction_id: "closed", mission_id: "EVT-1", stock_mission_id: "MST-1", total_encaisse_ttc: 10 },
        { transaction_id: "closed-2", mission_id: "EVT-2", stock_mission_id: "MST-1", total_encaisse_ttc: 20 },
        { transaction_id: "open", stock_mission_id: "MST-2", total_encaisse_ttc: 30 }
      ],
      lines: [
        { ligne_id: "closed-line", transaction_id: "closed" },
        { ligne_id: "closed-line-2", transaction_id: "closed-2" },
        { ligne_id: "open-line", transaction_id: "open" }
      ],
      missions: [closedMission("MST-1"), openMission("MST-2")],
      days: [day("J1", "EVT-1"), day("J2", "EVT-2"), day("J-open-closed", "EVT-3", "MST-2")]
    });
    setJson(h.storage, txKey, [
      { transaction_id: "closed", mission_id: "EVT-1", stock_mission_id: "MST-1" },
      { transaction_id: "closed-2", mission_id: "EVT-2", stock_mission_id: "MST-1" },
      { transaction_id: "open", stock_mission_id: "MST-2" },
      { transaction_id: "unknown", stock_mission_id: "MST-404" }
    ]);
    setJson(h.storage, lineKey, [
      { ligne_id: "closed-line", transaction_id: "closed" },
      { ligne_id: "closed-line-2", transaction_id: "closed-2" },
      { ligne_id: "open-line", transaction_id: "open" },
      { ligne_id: "orphan-line", transaction_id: "missing" }
    ]);
    const result = await h.cleanup.run();
    assert.equal(result.removedTransactions, 2);
    assert.equal(result.removedLines, 2);
    assert.deepEqual(getJson(h.storage, txKey).map((row) => row.transaction_id), ["open", "unknown"]);
    assert.deepEqual(getJson(h.storage, lineKey).map((row) => row.ligne_id), ["open-line", "orphan-line"]);
    assert.equal(h.storage.getItem(markerKey), "1");
    // The caller's full network arrays remain untouched for complete stats/history rendering.
    assert.equal((await h.api.getTransactions()).length, 3);
    assert.equal((await h.api.getTransactions()).reduce((sum, row) => sum + (row.total_encaisse_ttc || 0), 0), 60);
  }

  {
    const h = makeHarness({
      transactions: [{ transaction_id: "tx", stock_mission_id: "MST-1" }],
      lines: [{ ligne_id: "line", transaction_id: "tx" }],
      missions: [closedMission("MST-1")], days: [day("J1", "EVT-1")], pendingWrites: 1
    });
    setJson(h.storage, txKey, [{ transaction_id: "tx", stock_mission_id: "MST-1" }]);
    setJson(h.storage, lineKey, [{ ligne_id: "line", transaction_id: "tx" }]);
    assert.equal((await h.cleanup.run()).skipped, "writes-pending-or-uncertain");
    assert.equal(getJson(h.storage, txKey).length, 1);
    assert.equal(getJson(h.storage, lineKey).length, 1);
  }

  {
    const h = makeHarness({
      transactions: [{ transaction_id: "tx", stock_mission_id: "MST-1" }],
      lines: [{ ligne_id: "line", transaction_id: "tx" }],
      missions: [closedMission("MST-1")],
      days: [{ ...day("J1", "EVT-1"), statut: "en_cours" }]
    });
    setJson(h.storage, txKey, [{ transaction_id: "tx", stock_mission_id: "MST-1" }]);
    setJson(h.storage, lineKey, [{ ligne_id: "line", transaction_id: "tx" }]);
    assert.equal((await h.cleanup.run()).removedTransactions, 0);
    assert.equal(getJson(h.storage, txKey).length, 1);
  }

  {
    const h = makeHarness({ online: false });
    assert.equal((await h.cleanup.run()).skipped, "offline");
  }

  {
    const h = makeHarness();
    assert.equal((await h.cleanup.run()).skipped, "empty-cache");
    assert.equal(h.apiCalls, 0, "une ouverture ordinaire sans cache n'ajoute aucune lecture API");
  }

  {
    const h = makeHarness({
      transactions: [{ transaction_id: "tx", stock_mission_id: "MST-1" }],
      lines: [{ ligne_id: "line", transaction_id: "tx" }],
      missions: [closedMission("MST-1")], days: [day("J1", "EVT-1")]
    });
    setJson(h.storage, txKey, [{ transaction_id: "tx", stock_mission_id: "MST-1" }]);
    setJson(h.storage, lineKey, [{ ligne_id: "line", transaction_id: "tx" }]);
    const first = h.cleanup.run();
    const concurrent = h.cleanup.run();
    assert.equal(first, concurrent, "les appels concurrents partagent le même nettoyage");
    assert.equal(h.apiCalls, 0, "le nettoyage est différé hors du chemin de rendu");
    await Promise.all([first, concurrent]);
    assert.equal(h.apiCalls, 4, "un seul lot de lectures de vérification est lancé");
  }

  {
    const h = makeHarness({ failLineRead: true });
    setJson(h.storage, txKey, [{ transaction_id: "keep" }]);
    assert.equal((await h.cleanup.run()).skipped, "error");
    assert.deepEqual(getJson(h.storage, txKey), [{ transaction_id: "keep" }]);
  }

  {
    const h = makeHarness({
      transactions: [{ transaction_id: "tx", stock_mission_id: "MST-1" }],
      lines: [{ ligne_id: "line", transaction_id: "tx" }],
      missions: [closedMission("MST-1")], days: [day("J1", "EVT-1"), day("J2", "EVT-2")], quota: 350
    });
    setJson(h.storage, txKey, [{ transaction_id: "tx", stock_mission_id: "MST-1", padding: "x".repeat(80) }]);
    setJson(h.storage, lineKey, [{ ligne_id: "line", transaction_id: "tx", padding: "x".repeat(80) }]);
    assert.throws(() => h.storage.setItem("quota-probe", "q".repeat(100)), { name: "QuotaExceededError" });
    const first = await h.cleanup.run();
    assert.equal(first.removedTransactions, 1);
    assert.equal(first.removedLines, 1);
    const afterFirst = [h.storage.getItem(txKey), h.storage.getItem(lineKey)];
    const second = await h.cleanup.run();
    assert.deepEqual([h.storage.getItem(txKey), h.storage.getItem(lineKey)], afterFirst);
    assert.equal(second.skipped, "empty-cache");
  }

  for (const file of ["dashboard.js", "stats-annee.js", "stats-evenements.js", "stats-produits.js", "journees-cloturees.js"]) {
    const page = fs.readFileSync(path.join(__dirname, `../docs/${file}`), "utf8");
    assert.doesNotMatch(page, /LugdurumSalesCacheCleanup\?\.run\(\)/, `${file} must not trigger redundant maintenance reads`);
    assert.doesNotMatch(page, /writeJson\(CACHE_KEYS\.(transactions|ventesLignes),/, `${file} must not refill the operational caches`);
  }
  const closureSource = fs.readFileSync(path.join(__dirname, "../docs/cloture.js"), "utf8");
  const coreCacheWriter = closureSource.match(/const cacheCoreData = \(\) => \{([\s\S]*?)\n  \};/)?.[1] || "";
  assert.doesNotMatch(coreCacheWriter, /STORAGE_KEYS\.ventesLignes/, "la consultation de clôture ne doit pas réintroduire les lignes historiques dans le cache opérationnel");
  assert.match(closureSource, /status === "cloturee" && patch\?\.allClosed === true[\s\S]*?LugdurumSalesCacheCleanup\?\.run\(\)/, "le nettoyage reste déclenché après confirmation de clôture de mission");
  const homeSource = fs.readFileSync(path.join(__dirname, "../docs/home.js"), "utf8");
  assert.match(homeSource, /LugdurumSalesCacheCleanup\?\.run\(\)/, "l'accueil lance automatiquement la maintenance après récupération réussie");
  for (const file of ["dashboard.js", "stats-annee.js", "stats-evenements.js", "stats-produits.js", "journees-cloturees.js"]) {
    const page = fs.readFileSync(path.join(__dirname, `../docs/${file}`), "utf8");
    assert.match(page, /LugdurumSalesCacheCleanup\?\.isPartial\(\)/, `${file} must not treat partial cache as full history`);
  }

  console.log("sales-cache-cleanup: 6 scénarios + contrôles de réécriture/historique réussis");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
