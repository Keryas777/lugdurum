(() => {
  "use strict";

  const KEYS = {
    transactions: "lugdurum_transactions_cache",
    lines: "lugdurum_ventes_lignes_cache",
    legacyPendingTransactions: "lugdurum_pending_transactions",
    partialMarker: "lugdurum_sales_cache_partial"
  };

  const asId = (value) => String(value ?? "").trim();
  const normalizeStatus = (value) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  const readArray = (key) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return { exists: false, raw: null, value: [] };
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error(`Cache invalide : ${key}`);
    return { exists: true, raw, value };
  };

  const getArray = async (api, name, options = {}) => {
    if (typeof api?.[name] !== "function") throw new Error(`API indisponible : ${name}`);
    const value = await api[name](options);
    if (!Array.isArray(value) || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new Error(`Réponse API incomplète : ${name}`);
    }
    return value;
  };

  const getTransactionId = (row) => asId(row.transaction_id || row.id);
  const getLineId = (row) => asId(row.ligne_id || row.vente_ligne_id || row.id);
  const getStockMissionId = (row) => asId(row.stock_mission_id);
  const getLineTransactionId = (row) => asId(row.transaction_id || row.vente_id);

  const getPendingTransactionIds = (api) => {
    const ids = new Set();
    const pendingWrites = readArray("lugdurum_pending_writes");
    if (pendingWrites.value.length > 0) return null;
    if (typeof api?.getPendingWritesCount === "function" && api.getPendingWritesCount() > 0) {
      return null;
    }

    const pending = readArray(KEYS.legacyPendingTransactions);
    for (const row of pending.value) {
      const id = getTransactionId(row);
      if (!id) return null;
      ids.add(id);
    }
    if (typeof api?.getLegacyPendingTransactions === "function") {
      const legacy = api.getLegacyPendingTransactions();
      if (!Array.isArray(legacy)) return null;
      for (const row of legacy) {
        const id = getTransactionId(row);
        if (!id) return null;
        ids.add(id);
      }
    }
    return ids;
  };

  const clean = async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return { skipped: "offline" };

    try {
      // No cache rows means there is nothing to reclaim. This also keeps the
      // routine from adding background API traffic to ordinary page loads.
      const cachedTransactions = readArray(KEYS.transactions);
      const cachedLines = readArray(KEYS.lines);
      if (cachedTransactions.value.length === 0 && cachedLines.value.length === 0) {
        return { skipped: "empty-cache" };
      }

      // Never start maintenance reads while business writes are waiting.
      const pendingBeforeRead = getPendingTransactionIds(window.LugdurumAPI);
      if (pendingBeforeRead === null) return { skipped: "writes-pending-or-uncertain" };

      const api = window.LugdurumAPI;
      const [transactions, lines, stockMissions, days] = await Promise.all([
        getArray(api, "getTransactions", { maintenance: true }),
        getArray(api, "getVentesLignes", { maintenance: true }),
        getArray(api, "getMissionsStock", { maintenance: true }),
        getArray(api, "getJournees", { maintenance: true })
      ]);

      // A valid empty response is safe only when all required tables were returned.
      const txById = new Map();
      for (const transaction of transactions) {
        const id = getTransactionId(transaction);
        if (!id || txById.has(id)) return { skipped: "transactions-uncertain" };
        txById.set(id, transaction);
      }
      const missionById = new Map();
      for (const mission of stockMissions) {
        const id = asId(mission.mission_id || mission.stock_mission_id);
        if (!id || missionById.has(id)) return { skipped: "missions-uncertain" };
        missionById.set(id, mission);
      }
      for (const day of days) {
        if (!asId(day.journee_id || day.day_id || day.id)) return { skipped: "days-uncertain" };
      }
      const lineById = new Map();
      for (const line of lines) {
        const id = getLineId(line);
        if (!id || lineById.has(id)) return { skipped: "lines-uncertain" };
        lineById.set(id, line);
      }

      const daysByStockMission = new Map();
      for (const day of days) {
        const stockMissionId = getStockMissionId(day);
        if (!stockMissionId) continue;
        if (!daysByStockMission.has(stockMissionId)) daysByStockMission.set(stockMissionId, []);
        daysByStockMission.get(stockMissionId).push(day);
      }

      const pendingIds = getPendingTransactionIds(api);
      if (pendingIds === null) return { skipped: "writes-pending-or-uncertain" };

      const closedIds = new Set();
      for (const [id, mission] of missionById) {
        const status = normalizeStatus(mission.statut || mission.status);
        const linkedDays = daysByStockMission.get(id) || [];
        const allLinkedDaysClosed = linkedDays.length > 0 && linkedDays.every((day) => {
          const dayStatus = normalizeStatus(day.statut);
          return ["cloture", "annule", "annulee", "refuse", "refusee", "rembourse", "remboursee"].includes(dayStatus);
        });
        if (["cloture", "cloturee"].includes(status) && asId(mission.closed_at) && allLinkedDaysClosed) {
          closedIds.add(id);
        }
      }

      const confirmedClosedTransactionIds = new Set();
      for (const [id, transaction] of txById) {
        const stockMissionId = getStockMissionId(transaction);
        // mission_id denotes the sales event; stock_mission_id alone identifies the stock mission.
        if (!stockMissionId) continue;
        if (!closedIds.has(stockMissionId) || pendingIds.has(id)) continue;
        const nestedLines = transaction.lignes || transaction.ventes_lignes;
        if (Array.isArray(nestedLines) && nestedLines.some((line) => {
          const lineId = getLineId(line);
          if (!lineId || !lineById.has(lineId)) return true;
          const remoteTransactionId = getLineTransactionId(lineById.get(lineId));
          return Boolean(remoteTransactionId && remoteTransactionId !== id);
        })) continue;
        confirmedClosedTransactionIds.add(id);
      }

      const confirmedClosedLineIds = new Set();
      for (const [id, line] of lineById) {
        const transactionId = getLineTransactionId(line);
        const transaction = transactionId ? txById.get(transactionId) : null;
        if (!transaction || !confirmedClosedTransactionIds.has(transactionId)) continue;
        const lineMissionId = getStockMissionId(line);
        if (lineMissionId && lineMissionId !== getStockMissionId(transaction)) continue;
        confirmedClosedLineIds.add(id);
      }

      // Parse and validate both keys before changing either one.
      // A sale may have been queued while the remote tables were loading.
      // Recheck immediately before mutating either operational cache.
      const pendingBeforeWrite = getPendingTransactionIds(api);
      if (pendingBeforeWrite === null) return { skipped: "writes-pending-or-uncertain" };
      for (const id of pendingBeforeWrite) pendingIds.add(id);

      const currentCachedTransactions = readArray(KEYS.transactions);
      const currentCachedLines = readArray(KEYS.lines);
      const safeTransactions = currentCachedTransactions.value.filter((row) => {
        const id = getTransactionId(row);
        return !id || !confirmedClosedTransactionIds.has(id) || pendingIds.has(id);
      });
      const safeLines = currentCachedLines.value.filter((row) => {
        const id = getLineId(row);
        const transactionId = getLineTransactionId(row);
        return !id || !confirmedClosedLineIds.has(id) || pendingIds.has(transactionId);
      });

      const nextTransactions = safeTransactions;
      const nextLines = safeLines;

      let removedTransactions = 0;
      let removedLines = 0;
      const transactionJson = JSON.stringify(nextTransactions);
      const lineJson = JSON.stringify(nextLines);
      const transactionChanged = currentCachedTransactions.exists && transactionJson !== currentCachedTransactions.raw;
      const linesChanged = currentCachedLines.exists && lineJson !== currentCachedLines.raw;
      const shouldMarkPartial = (confirmedClosedTransactionIds.size > 0 || confirmedClosedLineIds.size > 0) &&
        (cachedTransactions.exists || cachedLines.exists);
      const markPartial = () => {
        if (!shouldMarkPartial || localStorage.getItem(KEYS.partialMarker) === "1") return;
        try { localStorage.setItem(KEYS.partialMarker, "1"); } catch { /* Retry after more cache space is freed. */ }
      };

      // Shrink a target cache first to free quota, then persist the marker before proceeding.
      if (transactionChanged) {
        localStorage.setItem(KEYS.transactions, transactionJson);
        removedTransactions = currentCachedTransactions.value.filter((row) => {
          const id = getTransactionId(row);
          return id && confirmedClosedTransactionIds.has(id);
        }).length;
        markPartial();
      }
      if (linesChanged) {
        localStorage.setItem(KEYS.lines, lineJson);
        removedLines = currentCachedLines.value.filter((row) => {
          const id = getLineId(row);
          return id && confirmedClosedLineIds.has(id);
        }).length;
        markPartial();
      }
      markPartial();
      const removedBytes = removedTransactions || removedLines
        ? Math.max(0, JSON.stringify(currentCachedTransactions.value).length + JSON.stringify(currentCachedLines.value).length -
          JSON.stringify(nextTransactions).length - JSON.stringify(nextLines).length) * 2
        : 0;
      return { removedTransactions, removedLines, removedBytes };
    } catch (error) {
      // Cleaning is best-effort: it must never block sales, closure, or history display.
      console.warn("Nettoyage automatique du cache des ventes ignoré", error);
      return { skipped: "error" };
    }
  };

  let inFlight = null;
  const run = () => {
    if (inFlight) return inFlight;
    inFlight = new Promise((resolve) => {
      const start = () => { clean().then(resolve); };
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(start, { timeout: 1500 });
      } else {
        window.setTimeout(start, 0);
      }
    }).finally(() => { inFlight = null; });
    return inFlight;
  };

  window.LugdurumSalesCacheCleanup = Object.freeze({
    run,
    isPartial: () => {
      try { return localStorage.getItem(KEYS.partialMarker) === "1"; } catch { return false; }
    }
  });
})();
