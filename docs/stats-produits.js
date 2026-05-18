(() => {
  "use strict";

  /*
    Stats produits V2 :
    - API Google Sheets prioritaire.
    - Pas de rendu local avant la réponse API.
    - Cache/localStorage uniquement si l’API est indisponible.
    - Analyse ventes_lignes, avec fallback de calcul depuis detail_ticket si les lignes sont absentes.
  */

  const CACHE_KEYS = {
    transactions: "lugdurum_transactions_cache",
    ventesLignes: "lugdurum_ventes_lignes_cache",
    catalogue: "lugdurum_catalogue_cache"
  };

  const LEGACY_KEYS = {
    transactions: ["lugdurum_transactions_cache", "lugdurum_transactions_backup", "lugdurum_pending_transactions"],
    ventesLignes: ["lugdurum_ventes_lignes_cache", "lugdurum_ventes_lignes"],
    catalogue: ["lugdurum_catalogue_cache"]
  };

  const state = {
    source: "loading",
    transactions: [],
    lignes: [],
    catalogue: [],
    filters: {
      year: "ALL",
      format: "ALL",
      search: ""
    }
  };

  const $ = (...ids) => ids.map((id) => document.getElementById(id)).find(Boolean) || null;

  const els = {
    year: $("statsProductsYearInput", "statsProductYearInput", "productYearFilter", "yearFilter"),
    format: $("statsProductsFormatInput", "statsProductFormatInput", "productFormatFilter", "formatFilter"),
    search: $("statsProductsSearchInput", "statsProductSearchInput", "productSearchInput", "searchInput"),
    bottles: $("statsProductsBottleCount", "productBottleCount", "productsBottleCount", "statsBottleCount"),
    revenue: $("statsProductsRevenue", "productRevenue", "productsRevenue", "statsProductsCA"),
    topProduct: $("statsProductsTop", "topProduct", "productTop", "statsTopProduct"),
    references: $("statsProductsReferences", "productReferences", "productsReferences", "statsProductReferences"),
    formatList: $("statsProductsFormatList", "productFormatList", "formatsList"),
    list: $("statsProductsList", "productStatsList", "productsList", "statsList"),
    status: $("statsProductsStatus", "productStatsStatus", "productsStatus", "statsStatus")
  };

  const api = () => window.LugdurumAPI || null;

  const readJsonNullable = (key) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const readFirstArray = (keys) => {
    for (const key of keys) {
      const value = readJsonNullable(key);
      if (Array.isArray(value)) return value;
    }

    return [];
  };

  const writeJson = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

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

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value || 0);

  const getYearFromDate = (value) => {
    const text = String(value || "");
    const match = text.match(/^(\d{4})/);
    return match ? match[1] : "";
  };

  const setText = (element, value) => {
    if (element) element.textContent = value;
  };

  const setStatus = (message, type = "") => {
    if (!els.status) return;

    els.status.textContent = message;
    els.status.className = "statsStatus statsProductsStatus";

    if (type) {
      els.status.classList.add(type);
    }
  };

  const isValidStatus = (item) => {
    const statut = String(item?.statut || item?.paiement_statut || "validee").toLowerCase();
    return !["annule", "annulee", "annulé", "annulée", "refuse", "refusé"].includes(statut);
  };

  const getTransactionId = (transaction) => String(transaction.transaction_id || transaction.id || "").trim();

  const getTransactionAmount = (transaction) =>
    toNumber(
      transaction.total_encaisse_ttc ??
      transaction.total_encaisse ??
      transaction.total_catalogue_ttc ??
      transaction.total_catalogue,
      0
    );

  const parseDetailTicket = (transaction) => {
    const raw = transaction.detail_ticket;

    if (Array.isArray(raw)) return raw;

    if (typeof raw !== "string" || !raw.trim()) return [];

    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };

  const getCatalogueBySku = () => {
    return state.catalogue.reduce((map, item) => {
      const skuId = String(item.sku_id || "").trim();
      if (skuId) map.set(skuId, item);
      return map;
    }, new Map());
  };

  const parseSku = (skuId) => {
    const parts = String(skuId || "").split("_");

    return {
      parfum_code: String(parts[0] || "").toUpperCase(),
      format_cl: toNumber(parts[1], 0)
    };
  };

  const normalizeLine = (rawLine, transactionMap, catalogueMap) => {
    const transactionId = String(rawLine.transaction_id || rawLine.transactionId || "").trim();
    const transaction = transactionMap.get(transactionId) || null;
    const skuId = String(rawLine.sku_id || rawLine.sku || "").trim();
    const catalogueItem = catalogueMap.get(skuId) || null;
    const parsedSku = parseSku(skuId);
    const quantity = toNumber(rawLine.quantite ?? rawLine.qty ?? rawLine.quantity, 0);
    const unitPrice = toNumber(rawLine.prix_unitaire_ttc ?? rawLine.unit_price ?? rawLine.prix, 0);
    const lineTotal = toNumber(
      rawLine.total_catalogue_ligne_ttc ?? rawLine.total_ligne_ttc ?? rawLine.total_ttc,
      quantity * unitPrice
    );

    return {
      transaction_id: transactionId,
      mission_id: rawLine.mission_id || transaction?.mission_id || "",
      journee_id: rawLine.journee_id || transaction?.journee_id || "",
      date_heure: rawLine.date_heure || transaction?.date_heure || transaction?.created_at || "",
      sku_id: skuId,
      parfum_code: String(rawLine.parfum_code || catalogueItem?.parfum_code || parsedSku.parfum_code || "?").toUpperCase(),
      parfum_nom: String(rawLine.parfum_nom || catalogueItem?.parfum_nom || rawLine.nom || parsedSku.parfum_code || "Produit").trim(),
      format_cl: toNumber(rawLine.format_cl, toNumber(catalogueItem?.format_cl, parsedSku.format_cl)),
      quantite: quantity,
      total_ttc: lineTotal,
      source: rawLine.source || transaction?.source || ""
    };
  };

  const buildLinesFromTransactions = () => {
    const lines = [];

    state.transactions.filter(isValidStatus).forEach((transaction) => {
      const transactionId = getTransactionId(transaction);
      const ticket = parseDetailTicket(transaction);
      const total = getTransactionAmount(transaction);

      ticket.forEach((item) => {
        if (item.type === "bottle") {
          lines.push({
            transaction_id: transactionId,
            mission_id: transaction.mission_id || "",
            journee_id: transaction.journee_id || "",
            date_heure: transaction.date_heure || transaction.created_at || "",
            sku_id: item.sku_id,
            parfum_code: item.parfum_code,
            parfum_nom: item.parfum_nom,
            format_cl: item.format_cl,
            quantite: toNumber(item.quantite, 0),
            total_catalogue_ligne_ttc: toNumber(item.quantite, 0) * toNumber(item.prix_unitaire_ttc, 0),
            source: transaction.source || ""
          });
          return;
        }

        if (item.type === "box" && Array.isArray(item.composition)) {
          const boxTotal = toNumber(item.prix_ttc, total);
          const unitShare = item.composition.length > 0 ? boxTotal / item.composition.length : 0;

          item.composition.forEach((product) => {
            lines.push({
              transaction_id: transactionId,
              mission_id: transaction.mission_id || "",
              journee_id: transaction.journee_id || "",
              date_heure: transaction.date_heure || transaction.created_at || "",
              sku_id: product.sku_id,
              parfum_code: product.parfum_code,
              parfum_nom: product.parfum_nom,
              format_cl: product.format_cl || item.format_cl || 20,
              quantite: 1,
              total_catalogue_ligne_ttc: unitShare,
              source: transaction.source || "COFFRET"
            });
          });
        }
      });
    });

    return lines;
  };

  const getNormalizedLines = () => {
    const transactionMap = state.transactions.reduce((map, transaction) => {
      const id = getTransactionId(transaction);
      if (id && isValidStatus(transaction)) map.set(id, transaction);
      return map;
    }, new Map());

    const catalogueMap = getCatalogueBySku();
    const baseLines = state.lignes.length > 0 ? state.lignes : buildLinesFromTransactions();

    return baseLines
      .map((line) => normalizeLine(line, transactionMap, catalogueMap))
      .filter((line) => line.quantite > 0)
      .filter((line) => {
        if (!line.transaction_id) return true;
        const transaction = transactionMap.get(line.transaction_id);
        return !transaction || isValidStatus(transaction);
      });
  };

  const getAvailableYears = () => {
    const years = new Set();

    getNormalizedLines().forEach((line) => {
      const year = getYearFromDate(line.date_heure);
      if (year) years.add(year);
    });

    return [...years].sort((a, b) => b.localeCompare(a));
  };

  const syncYearFilter = () => {
    if (!els.year) return;

    const current = els.year.value || state.filters.year;
    const years = getAvailableYears();

    els.year.innerHTML = `
      <option value="ALL">Toutes</option>
      ${years.map((year) => `<option value="${year}">${year}</option>`).join("")}
    `;

    if (years.includes(current) || current === "ALL") {
      els.year.value = current;
      state.filters.year = current;
    } else if (years.length > 0) {
      els.year.value = years[0];
      state.filters.year = years[0];
    } else {
      els.year.value = "ALL";
      state.filters.year = "ALL";
    }
  };

  const getFilteredLines = () => {
    const query = normalizeText(state.filters.search);

    return getNormalizedLines()
      .filter((line) => {
        if (state.filters.year === "ALL") return true;
        return getYearFromDate(line.date_heure) === state.filters.year;
      })
      .filter((line) => {
        if (state.filters.format === "ALL") return true;
        return String(line.format_cl) === String(state.filters.format);
      })
      .filter((line) => {
        if (!query) return true;
        return normalizeText(`${line.parfum_code} ${line.parfum_nom} ${line.sku_id}`).includes(query);
      });
  };

  const computeByProduct = () => {
    const map = new Map();

    getFilteredLines().forEach((line) => {
      const key = line.sku_id || `${line.parfum_code}_${line.format_cl}`;
      const current = map.get(key) || {
        sku_id: key,
        parfum_code: line.parfum_code,
        parfum_nom: line.parfum_nom,
        format_cl: line.format_cl,
        quantite: 0,
        ca: 0
      };

      current.quantite += toNumber(line.quantite, 0);
      current.ca += toNumber(line.total_ttc, 0);

      map.set(key, current);
    });

    return [...map.values()].sort((a, b) => {
      const byQty = b.quantite - a.quantite;
      if (byQty !== 0) return byQty;
      const byCa = b.ca - a.ca;
      if (byCa !== 0) return byCa;
      return String(a.parfum_code).localeCompare(String(b.parfum_code));
    });
  };

  const computeByFormat = () => {
    const map = new Map();

    getFilteredLines().forEach((line) => {
      const key = line.format_cl || "?";
      const current = map.get(key) || { format_cl: key, quantite: 0, ca: 0 };
      current.quantite += toNumber(line.quantite, 0);
      current.ca += toNumber(line.total_ttc, 0);
      map.set(key, current);
    });

    return [...map.values()].sort((a, b) => toNumber(b.format_cl, 0) - toNumber(a.format_cl, 0));
  };

  const render = () => {
    syncYearFilter();

    const products = computeByProduct();
    const formats = computeByFormat();
    const totalQty = products.reduce((sum, product) => sum + product.quantite, 0);
    const totalCa = products.reduce((sum, product) => sum + product.ca, 0);
    const top = products[0] || null;

    setText(els.bottles, String(totalQty));
    setText(els.revenue, formatCurrency(totalCa));
    setText(els.topProduct, top ? `${top.parfum_code} · ${top.quantite}` : "—");
    setText(els.references, String(products.length));

    if (els.formatList) {
      els.formatList.innerHTML = formats.length
        ? formats.map((item) => `
            <article class="statFormatCard productFormatCard">
              <strong>${escapeHtml(String(item.format_cl))} cL</strong>
              <span>${escapeHtml(String(item.quantite))} vendu${item.quantite > 1 ? "s" : ""}</span>
              <small>${escapeHtml(formatCurrency(item.ca))}</small>
            </article>
          `).join("")
        : `<p class="statsEmpty">Aucune vente produit sur cette période.</p>`;
    }

    if (!els.list) return;

    if (products.length === 0) {
      els.list.innerHTML = `<p class="statsEmpty">Aucune vente produit à afficher.</p>`;
      return;
    }

    els.list.innerHTML = products.map((product) => `
      <article class="statsCard productStatCard">
        <div class="statsCardHeader">
          <div class="statsCardTitle">
            <strong>${escapeHtml(product.parfum_code)} ${escapeHtml(product.format_cl)} cL</strong>
            <span>${escapeHtml(product.parfum_nom || product.parfum_code)}</span>
          </div>
          <strong class="statsAmount">${escapeHtml(String(product.quantite))}</strong>
        </div>
        <div class="statsMeta">
          <span>${escapeHtml(formatCurrency(product.ca))}</span>
          <span>${escapeHtml(product.sku_id)}</span>
        </div>
      </article>
    `).join("");
  };

  const callArray = async (fnName) => {
    if (!api() || typeof api()[fnName] !== "function") return [];

    const result = await api()[fnName]();
    return Array.isArray(result) ? result : [];
  };

  const loadRemote = async () => {
    if (!api()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    const [transactions, lignes, catalogue] = await Promise.all([
      callArray("getTransactions"),
      callArray("getVentesLignes"),
      callArray("getCatalogue")
    ]);

    state.transactions = transactions;
    state.lignes = lignes;
    state.catalogue = catalogue;
    state.source = "api";

    writeJson(CACHE_KEYS.transactions, transactions);
    writeJson(CACHE_KEYS.ventesLignes, lignes);
    writeJson(CACHE_KEYS.catalogue, catalogue);
  };

  const loadLocalFallback = () => {
    state.transactions = readFirstArray(LEGACY_KEYS.transactions);
    state.lignes = readFirstArray(LEGACY_KEYS.ventesLignes);
    state.catalogue = readFirstArray(LEGACY_KEYS.catalogue);
    state.source = "local";
  };

  const bindEvents = () => {
    if (els.year) {
      els.year.addEventListener("change", () => {
        state.filters.year = els.year.value || "ALL";
        render();
      });
    }

    if (els.format) {
      els.format.addEventListener("change", () => {
        state.filters.format = els.format.value || "ALL";
        render();
      });
    }

    if (els.search) {
      els.search.addEventListener("input", () => {
        state.filters.search = els.search.value || "";
        render();
      });
    }
  };

  const init = async () => {
    bindEvents();

    if (els.list) {
      els.list.innerHTML = `<p class="statsEmpty">Chargement depuis Google Sheets…</p>`;
    }

    setStatus("Chargement depuis Google Sheets...");

    try {
      await loadRemote();
      render();
      setStatus("");
    } catch (error) {
      loadLocalFallback();
      render();
      setStatus(`API indisponible. Données locales affichées : ${error.message}`, "isError");
    }
  };

  init();
})();
