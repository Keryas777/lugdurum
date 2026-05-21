(() => {
  "use strict";

  /*
    Diagnostic synchro V1 :
    - Page outil pour traiter les anciens résidus locaux : lugdurum_pending_transactions.
    - Ne touche pas aux caches métier ni aux données Sheets.
    - Lit les transactions locales legacy.
    - Compare avec les transactions distantes via LugdurumAPI.getTransactions().
    - Permet de :
      1) nettoyer les résidus déjà présents dans Sheets ;
      2) réenvoyer une sélection via LugdurumAPI.saveTransaction() ;
      3) supprimer localement une sélection ;
      4) vider uniquement le stockage legacy après confirmation.
  */

  const STORAGE_KEYS = {
    legacyPendingTransactions: "lugdurum_pending_transactions"
  };

  const state = {
    source: "loading",
    remoteLoaded: false,
    remoteError: "",
    legacyTransactions: [],
    remoteTransactions: [],
    remoteIds: new Set(),
    selectedKeys: new Set(),
    officialQueueCount: 0,
    isBusy: false
  };

  const els = {
    legacyCount: document.getElementById("legacyCount"),
    alreadyRemoteCount: document.getElementById("alreadyRemoteCount"),
    toReviewCount: document.getElementById("toReviewCount"),
    officialQueueCount: document.getElementById("officialQueueCount"),
    status: document.getElementById("diagnosticStatus"),
    list: document.getElementById("legacyTransactionsList"),

    refresh: document.getElementById("refreshDiagnosticBtn"),
    cleanSynced: document.getElementById("cleanSyncedBtn"),
    sendSelected: document.getElementById("sendSelectedBtn"),
    deleteSelected: document.getElementById("deleteSelectedBtn"),
    clearAll: document.getElementById("clearAllLegacyBtn"),
    toggleSelectAll: document.getElementById("toggleSelectAllBtn")
  };

  const api = () => window.LugdurumAPI || null;
  const hasApi = () => Boolean(api());

  const safeLocalGet = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const safeLocalSet = (key, value) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };

  const readJson = (key, fallback) => {
    try {
      const raw = safeLocalGet(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    const written = safeLocalSet(key, JSON.stringify(value));

    if (!written) {
      throw new Error("Impossible d’écrire dans localStorage sur cet appareil.");
    }
  };

  const toArray = (value) => (Array.isArray(value) ? value : []);

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const escapeAttr = (value) => escapeHtml(value).replaceAll("`", "&#096;");

  const normalizeText = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const toNumber = (value, fallback = 0) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;

    const normalized = String(value ?? "")
      .trim()
      .replace(/\s/g, "")
      .replace(",", ".");

    if (!normalized) return fallback;

    const number = Number(normalized);
    return Number.isFinite(number) ? number : fallback;
  };

  const formatCurrency = (value) => {
    const amount = Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;

    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const formatShortDateTime = (value) => {
    if (!value) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);

    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  };

  const setText = (element, value) => {
    if (element) element.textContent = value;
  };

  const setStatus = (message, type = "") => {
    if (!els.status) return;

    els.status.textContent = message;
    els.status.className = "diagnosticStatus";

    if (type) {
      els.status.classList.add(type);
    }
  };

  const setBusy = (busy) => {
    state.isBusy = busy;

    [
      els.refresh,
      els.cleanSynced,
      els.sendSelected,
      els.deleteSelected,
      els.clearAll,
      els.toggleSelectAll
    ].forEach((button) => {
      if (button) button.disabled = busy;
    });
  };

  const setDataState = (status, message = "") => {
    if (!window.LugdurumDataState || typeof window.LugdurumDataState.set !== "function") return;

    window.LugdurumDataState.set(status, {
      message
    });
  };

  const waitForApi = (timeoutMs = 2500) =>
    new Promise((resolve) => {
      if (hasApi()) {
        resolve(true);
        return;
      }

      const startedAt = Date.now();

      const tick = () => {
        if (hasApi()) {
          resolve(true);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
          return;
        }

        window.setTimeout(tick, 50);
      };

      tick();
    });

  const getLegacyTransactions = () => {
    const value = readJson(STORAGE_KEYS.legacyPendingTransactions, []);
    return Array.isArray(value) ? value : [];
  };

  const setLegacyTransactions = (transactions) => {
    writeJson(STORAGE_KEYS.legacyPendingTransactions, toArray(transactions));
    dispatchSyncStatus();
  };

  const getTransactionId = (transaction) =>
    String(transaction?.transaction_id || transaction?.id || "").trim();

  const getJourneeId = (transaction) =>
    String(transaction?.journee_id || transaction?.day_id || "").trim();

  const getTransactionDate = (transaction) =>
    String(
      transaction?.date_heure ||
      transaction?.date ||
      transaction?.created_at ||
      transaction?.updated_at ||
      ""
    ).trim();

  const getTransactionAmount = (transaction) =>
    toNumber(
      transaction?.total_encaisse_ttc ??
      transaction?.total_encaisse ??
      transaction?.total_catalogue_ttc ??
      transaction?.total_catalogue ??
      transaction?.montant ??
      transaction?.amount,
      0
    );

  const getPaymentLabel = (transaction) => {
    const raw = String(
      transaction?.mode_paiement ||
      transaction?.paiement_provider ||
      transaction?.payment_mode ||
      transaction?.source ||
      ""
    ).trim();

    const key = raw.toUpperCase();

    const labels = {
      ESP: "Espèces",
      ESPECES: "Espèces",
      "ESPÈCES": "Espèces",
      CB: "CB",
      SUMUP: "SumUp",
      CHQ: "Chèque",
      CHEQUE: "Chèque",
      "CHÈQUE": "Chèque",
      WEBAPP_ESPECES: "Espèces",
      WEBAPP_CHEQUE: "Chèque",
      WEBAPP_CB_MANUEL: "CB manuel",
      HISTORIQUE: "Historique",
      MANUEL: "Manuel"
    };

    return labels[key] || raw || "Mode inconnu";
  };

  const parseDetailTicket = (transaction) => {
    const raw = transaction?.detail_ticket;

    if (Array.isArray(raw)) return raw;
    if (typeof raw !== "string" || !raw.trim()) return [];

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const getLinesCount = (transaction) => {
    if (Array.isArray(transaction?.lignes)) return transaction.lignes.length;
    if (Array.isArray(transaction?.lines)) return transaction.lines.length;

    const ticket = parseDetailTicket(transaction);

    return ticket.reduce((sum, item) => {
      if (item?.type === "box" && Array.isArray(item.composition)) {
        return sum + item.composition.length;
      }

      return sum + 1;
    }, 0);
  };

  const getTransactionSignature = (transaction) => [
    getTransactionDate(transaction),
    getJourneeId(transaction),
    getTransactionAmount(transaction),
    getPaymentLabel(transaction),
    getLinesCount(transaction)
  ].join("|");

  const simpleHash = (value) => {
    const text = String(value || "");
    let hash = 0;

    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(index);
      hash |= 0;
    }

    return Math.abs(hash).toString(36).toUpperCase();
  };

  const getLocalKey = (transaction, index) => {
    const id = getTransactionId(transaction);

    if (id) return `id:${id}`;

    return `sig:${simpleHash(getTransactionSignature(transaction))}:${index}`;
  };

  const getRemoteIds = (transactions) =>
    new Set(
      toArray(transactions)
        .map(getTransactionId)
        .filter(Boolean)
    );

  const getOfficialQueueCount = () => {
    if (hasApi() && typeof api().getPendingWritesCount === "function") {
      return toNumber(api().getPendingWritesCount(), 0);
    }

    return 0;
  };

  const getClassForItem = (transaction) => {
    const id = getTransactionId(transaction);

    if (!id) return "noId";
    if (state.remoteIds.has(id)) return "synced";

    return "unsynced";
  };

  const getStatusInfo = (transaction) => {
    const itemClass = getClassForItem(transaction);

    if (itemClass === "synced") {
      return {
        className: "isSynced",
        label: "Déjà dans Sheets"
      };
    }

    if (itemClass === "noId") {
      return {
        className: "isWarning",
        label: "Sans transaction_id"
      };
    }

    if (!state.remoteLoaded) {
      return {
        className: "isUnknown",
        label: "Comparaison non faite"
      };
    }

    return {
      className: "isUnsynced",
      label: "À réenvoyer ou supprimer"
    };
  };

  const getSelectedItems = () =>
    state.legacyTransactions
      .map((transaction, index) => ({
        transaction,
        index,
        key: getLocalKey(transaction, index)
      }))
      .filter((item) => state.selectedKeys.has(item.key));

  const removeLegacyTransactionsByKeys = (keys) => {
    const keySet = new Set(keys);
    const current = getLegacyTransactions();

    const remaining = current.filter((transaction, index) => {
      const key = getLocalKey(transaction, index);
      return !keySet.has(key);
    });

    setLegacyTransactions(remaining);
    state.legacyTransactions = remaining;
    state.selectedKeys.clear();

    return current.length - remaining.length;
  };

  const removeAllLegacyTransactions = () => {
    const count = getLegacyTransactions().length;

    setLegacyTransactions([]);
    state.legacyTransactions = [];
    state.selectedKeys.clear();

    return count;
  };

  const dispatchSyncStatus = () => {
    window.dispatchEvent(
      new CustomEvent("lugdurum:sync-status", {
        detail: {
          pending_count: getOfficialQueueCount(),
          legacy_pending_transactions_count: getLegacyTransactions().length,
          updated_at: new Date().toISOString()
        }
      })
    );
  };

  const loadLocal = () => {
    state.legacyTransactions = getLegacyTransactions();
    state.officialQueueCount = getOfficialQueueCount();
  };

  const loadRemote = async () => {
    const ready = await waitForApi();

    if (!ready || !hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    if (typeof api().getTransactions !== "function") {
      throw new Error("LugdurumAPI.getTransactions() est indisponible.");
    }

    setDataState("refreshing", "diagnostic synchro");

    const transactions = await api().getTransactions();

    state.remoteTransactions = toArray(transactions);
    state.remoteIds = getRemoteIds(state.remoteTransactions);
    state.remoteLoaded = true;
    state.remoteError = "";
    state.officialQueueCount = getOfficialQueueCount();

    const time = new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());

    setDataState("online", time);
  };

  const getCounts = () => {
    const legacy = state.legacyTransactions;
    const alreadyRemote = legacy.filter((transaction) => {
      const id = getTransactionId(transaction);
      return id && state.remoteIds.has(id);
    }).length;

    const noId = legacy.filter((transaction) => !getTransactionId(transaction)).length;
    const toReview = state.remoteLoaded
      ? legacy.length - alreadyRemote
      : legacy.length;

    return {
      legacy: legacy.length,
      alreadyRemote,
      toReview,
      noId,
      officialQueue: state.officialQueueCount
    };
  };

  const renderKpis = () => {
    const counts = getCounts();

    setText(els.legacyCount, String(counts.legacy));
    setText(els.alreadyRemoteCount, state.remoteLoaded ? String(counts.alreadyRemote) : "—");
    setText(els.toReviewCount, String(counts.toReview));
    setText(els.officialQueueCount, String(counts.officialQueue));
  };

  const renderStatus = () => {
    if (state.isBusy) return;

    const counts = getCounts();

    if (state.remoteError) {
      setStatus(
        `Lecture Sheets impossible. Résidus locaux affichés uniquement : ${state.remoteError}`,
        "isError"
      );
      return;
    }

    if (!state.remoteLoaded) {
      setStatus("Comparaison Sheets non effectuée.", "isWarning");
      return;
    }

    if (counts.legacy === 0) {
      setStatus("Aucun résidu legacy détecté sur cet appareil.", "isSuccess");
      return;
    }

    if (counts.alreadyRemote > 0) {
      setStatus(
        `${counts.alreadyRemote} transaction(s) locale(s) déjà retrouvée(s) dans Sheets. Tu peux les nettoyer.`,
        "isSuccess"
      );
      return;
    }

    setStatus(
      `${counts.legacy} transaction(s) locale(s) à vérifier. Rien n’est supprimé automatiquement.`,
      "isWarning"
    );
  };

  const renderEmpty = () => {
    if (!els.list) return;

    els.list.innerHTML = `
      <p class="diagnosticEmpty">
        Aucun résidu dans <code>lugdurum_pending_transactions</code> sur cet appareil.
      </p>
    `;
  };

  const renderTransactionCard = (transaction, index) => {
    const key = getLocalKey(transaction, index);
    const id = getTransactionId(transaction);
    const journeeId = getJourneeId(transaction);
    const amount = getTransactionAmount(transaction);
    const statusInfo = getStatusInfo(transaction);
    const selected = state.selectedKeys.has(key);
    const date = getTransactionDate(transaction);
    const linesCount = getLinesCount(transaction);

    return `
      <article class="legacyTransactionCard ${escapeAttr(statusInfo.className)}">
        <label class="legacySelect">
          <input type="checkbox" data-select-legacy="${escapeAttr(key)}" ${selected ? "checked" : ""} />
          <span aria-hidden="true"></span>
        </label>

        <div class="legacyMain">
          <div class="legacyHeader">
            <div>
              <strong>${escapeHtml(id || "Transaction sans ID")}</strong>
              <span>${escapeHtml(statusInfo.label)}</span>
            </div>
            <strong class="legacyAmount">${escapeHtml(formatCurrency(amount))}</strong>
          </div>

          <div class="legacyMeta">
            <span>${escapeHtml(getPaymentLabel(transaction))}</span>
            <span>${escapeHtml(date ? formatShortDateTime(date) : "Date inconnue")}</span>
            <span>${escapeHtml(journeeId || "Journée inconnue")}</span>
            <span>${escapeHtml(`${linesCount} ligne${linesCount > 1 ? "s" : ""}`)}</span>
          </div>
        </div>
      </article>
    `;
  };

  const renderList = () => {
    if (!els.list) return;

    if (state.legacyTransactions.length === 0) {
      renderEmpty();
      return;
    }

    els.list.innerHTML = state.legacyTransactions
      .map(renderTransactionCard)
      .join("");
  };

  const renderButtons = () => {
    const counts = getCounts();
    const selectedCount = state.selectedKeys.size;

    if (els.cleanSynced) {
      els.cleanSynced.disabled = state.isBusy || !state.remoteLoaded || counts.alreadyRemote === 0;
    }

    if (els.sendSelected) {
      els.sendSelected.disabled = state.isBusy || selectedCount === 0;
    }

    if (els.deleteSelected) {
      els.deleteSelected.disabled = state.isBusy || selectedCount === 0;
    }

    if (els.clearAll) {
      els.clearAll.disabled = state.isBusy || counts.legacy === 0;
    }

    if (els.toggleSelectAll) {
      els.toggleSelectAll.disabled = state.isBusy || counts.legacy === 0;
      els.toggleSelectAll.textContent = selectedCount === counts.legacy && counts.legacy > 0
        ? "Tout désélectionner"
        : "Tout sélectionner";
    }
  };

  const render = () => {
    renderKpis();
    renderList();
    renderButtons();
    renderStatus();
  };

  const refresh = async () => {
    setBusy(true);
    setStatus("Lecture locale et comparaison Sheets…");

    try {
      loadLocal();
      await loadRemote();
      setStatus("Comparaison terminée.", "isSuccess");
    } catch (error) {
      state.remoteLoaded = false;
      state.remoteError = error.message || "Erreur inconnue";
      loadLocal();
      setDataState("local", "diagnostic hors ligne");
    } finally {
      setBusy(false);
      render();
    }
  };

  const cleanSynced = () => {
    if (!state.remoteLoaded) {
      setStatus("Impossible de nettoyer automatiquement sans comparaison Sheets.", "isError");
      return;
    }

    const keys = state.legacyTransactions
      .map((transaction, index) => ({
        key: getLocalKey(transaction, index),
        id: getTransactionId(transaction)
      }))
      .filter((item) => item.id && state.remoteIds.has(item.id))
      .map((item) => item.key);

    if (keys.length === 0) {
      setStatus("Aucune transaction locale déjà présente dans Sheets à nettoyer.", "isWarning");
      return;
    }

    const removedCount = removeLegacyTransactionsByKeys(keys);

    setStatus(`${removedCount} transaction(s) locale(s) déjà synchronisée(s) nettoyée(s).`, "isSuccess");
    render();
  };

  const sendSelected = async () => {
    const selectedItems = getSelectedItems();

    if (selectedItems.length === 0) {
      setStatus("Aucune transaction sélectionnée.", "isWarning");
      return;
    }

    if (!hasApi() || typeof api().saveTransaction !== "function") {
      setStatus("Impossible de réenvoyer : LugdurumAPI.saveTransaction() est indisponible.", "isError");
      return;
    }

    setBusy(true);
    setStatus(`Réenvoi de ${selectedItems.length} transaction(s)…`);

    const removeKeys = [];
    const failures = [];
    let sentCount = 0;
    let queuedCount = 0;
    let skippedCount = 0;

    try {
      for (const item of selectedItems) {
        const id = getTransactionId(item.transaction);

        if (!id) {
          failures.push("Transaction sans ID ignorée.");
          continue;
        }

        if (state.remoteLoaded && state.remoteIds.has(id)) {
          removeKeys.push(item.key);
          skippedCount += 1;
          continue;
        }

        try {
          const result = await api().saveTransaction(item.transaction);

          removeKeys.push(item.key);

          if (result?.queued) {
            queuedCount += 1;
          } else {
            sentCount += 1;
          }
        } catch (error) {
          failures.push(`${id} : ${error.message || "erreur inconnue"}`);
        }
      }

      if (removeKeys.length > 0) {
        removeLegacyTransactionsByKeys(removeKeys);
      }

      state.officialQueueCount = getOfficialQueueCount();

      const parts = [];
      if (sentCount > 0) parts.push(`${sentCount} envoyée(s)`);
      if (queuedCount > 0) parts.push(`${queuedCount} transférée(s) dans la file API`);
      if (skippedCount > 0) parts.push(`${skippedCount} déjà présente(s) dans Sheets`);

      if (failures.length > 0) {
        setStatus(
          `${parts.join(" · ") || "Aucun envoi terminé"}. Erreurs : ${failures.slice(0, 3).join(" / ")}`,
          "isError"
        );
      } else {
        setStatus(parts.join(" · ") || "Aucune transaction réenvoyée.", "isSuccess");
      }
    } finally {
      setBusy(false);
      render();
    }
  };

  const deleteSelected = () => {
    const selectedItems = getSelectedItems();

    if (selectedItems.length === 0) {
      setStatus("Aucune transaction sélectionnée.", "isWarning");
      return;
    }

    const ok = window.confirm(
      `Supprimer localement ${selectedItems.length} transaction(s) legacy ?\n\nCette action ne supprime rien dans Sheets.`
    );

    if (!ok) return;

    const removedCount = removeLegacyTransactionsByKeys(selectedItems.map((item) => item.key));

    setStatus(`${removedCount} transaction(s) supprimée(s) localement.`, "isSuccess");
    render();
  };

  const clearAll = () => {
    const count = state.legacyTransactions.length;

    if (count === 0) {
      setStatus("Aucun résidu à vider.", "isWarning");
      return;
    }

    const ok = window.confirm(
      `Vider les ${count} transaction(s) legacy de cet appareil ?\n\nÀ utiliser seulement si tu es sûr qu’il s’agit de vieux résidus ou de données déjà traitées.`
    );

    if (!ok) return;

    const removedCount = removeAllLegacyTransactions();

    setStatus(`${removedCount} transaction(s) legacy supprimée(s) localement.`, "isSuccess");
    render();
  };

  const toggleSelectAll = () => {
    if (state.legacyTransactions.length === 0) return;

    const allKeys = state.legacyTransactions.map(getLocalKey);
    const allSelected = allKeys.every((key) => state.selectedKeys.has(key));

    state.selectedKeys.clear();

    if (!allSelected) {
      allKeys.forEach((key) => state.selectedKeys.add(key));
    }

    render();
  };

  const bindEvents = () => {
    els.refresh?.addEventListener("click", refresh);
    els.cleanSynced?.addEventListener("click", cleanSynced);
    els.sendSelected?.addEventListener("click", sendSelected);
    els.deleteSelected?.addEventListener("click", deleteSelected);
    els.clearAll?.addEventListener("click", clearAll);
    els.toggleSelectAll?.addEventListener("click", toggleSelectAll);

    document.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-select-legacy]");
      if (!checkbox) return;

      const key = checkbox.dataset.selectLegacy || "";

      if (!key) return;

      if (checkbox.checked) {
        state.selectedKeys.add(key);
      } else {
        state.selectedKeys.delete(key);
      }

      renderButtons();
    });
  };

  const init = async () => {
    bindEvents();
    loadLocal();
    render();
    await refresh();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
