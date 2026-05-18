(() => {
  "use strict";

  /*
    Stats produits V1 : lecture API + fallback cache local.
    Analyse les ventes_lignes pour les quantités et CA par produit / format.
  */

  const STORAGE_KEYS = {
    catalogue: "lugdurum_catalogue_cache",
    journees: "lugdurum_journees",
    transactions: "lugdurum_transactions_cache",
    transactionsBackup: "lugdurum_transactions_backup",
    ventesLignes: "lugdurum_ventes_lignes_cache"
  };

  const state = {
    selectedYear: "ALL",
    selectedFormat: "ALL",
    search: "",
    catalogue: [],
    journees: [],
    transactions: [],
    ventesLignes: []
  };

  const els = {
    yearSelect: document.getElementById("productYearSelect"),
    formatSelect: document.getElementById("productFormatSelect"),
    searchInput: document.getElementById("productSearchInput"),
    totalQty: document.getElementById("productTotalQty"),
    totalRevenue: document.getElementById("productTotalRevenue"),
    topProduct: document.getElementById("productTopProduct"),
    productCount: document.getElementById("productCount"),
    formatBreakdown: document.getElementById("productFormatBreakdown"),
    cards: document.getElementById("productCards"),
    status: document.getElementById("statsProductsStatus")
  };

  const api = () => window.LugdurumAPI || null;
  const hasApi = () => Boolean(api());
  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } };
  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const asArray = (value) => Array.isArray(value) ? value : [];
  const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const escapeAttr = (value) => escapeHtml(value).replaceAll("`", "&#096;");
  const toNumber = (value, fallback = 0) => { if (typeof value === "number" && Number.isFinite(value)) return value; const number = Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", ".")); return Number.isFinite(number) ? number : fallback; };
  const formatCurrency = (value) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: value % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(toNumber(value, 0));
  const getYear = (value) => String(value || "").slice(0, 4) || "Inconnue";
  const normalizeText = (value) => String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const setStatus = (message, type = "") => { els.status.textContent = message; els.status.className = "statsProductsStatus"; if (type) els.status.classList.add(type); };

  const getCatalogueBySku = (skuId) => state.catalogue.find((item) => String(item.sku_id || "") === String(skuId || "")) || null;
  const getTransactionById = (transactionId) => state.transactions.find((item) => String(item.transaction_id || "") === String(transactionId || "")) || null;
  const getJourneeById = (journeeId) => state.journees.find((item) => String(item.journee_id || "") === String(journeeId || "")) || null;

  const getLineYear = (line) => {
    const journee = getJourneeById(line.journee_id);
    if (journee?.date) return getYear(journee.date);
    const transaction = getTransactionById(line.transaction_id);
    return getYear(transaction?.date_heure || line.date_heure || line.created_at);
  };

  const extractFallbackLinesFromTransactions = () => {
    const lines = [];
    state.transactions.forEach((transaction) => {
      const transactionId = transaction.transaction_id || `TX_${lines.length}`;
      if (Array.isArray(transaction.lignes)) {
        transaction.lignes.forEach((line) => lines.push({ ...line, transaction_id: transactionId, journee_id: transaction.journee_id }));
        return;
      }

      let detail = transaction.detail_ticket || [];
      if (typeof detail === "string") {
        try { detail = JSON.parse(detail); } catch { detail = []; }
      }
      if (!Array.isArray(detail)) return;

      detail.forEach((item) => {
        if (item.type === "bottle") {
          lines.push({ transaction_id: transactionId, journee_id: transaction.journee_id, sku_id: item.sku_id, quantite: item.quantite, total_catalogue_ligne_ttc: toNumber(item.quantite, 0) * toNumber(item.prix_unitaire_ttc, 0) });
          return;
        }
        if (item.type === "box" && Array.isArray(item.composition)) {
          const unit = item.composition.length ? toNumber(item.prix_ttc, 0) / item.composition.length : 0;
          item.composition.forEach((product) => lines.push({ transaction_id: transactionId, journee_id: transaction.journee_id, sku_id: product.sku_id, quantite: 1, total_catalogue_ligne_ttc: unit, note: item.label || "Coffret" }));
        }
      });
    });
    return lines;
  };

  const getAllLines = () => state.ventesLignes.length > 0 ? state.ventesLignes : extractFallbackLinesFromTransactions();

  const aggregateProducts = () => {
    const query = normalizeText(state.search);
    const map = new Map();

    getAllLines().forEach((line) => {
      const year = getLineYear(line);
      if (state.selectedYear !== "ALL" && year !== state.selectedYear) return;

      const skuId = String(line.sku_id || "").trim();
      if (!skuId) return;

      const product = getCatalogueBySku(skuId);
      const formatCl = toNumber(line.format_cl, toNumber(product?.format_cl, toNumber(skuId.split("_")[1], 0)));
      if (state.selectedFormat !== "ALL" && String(formatCl) !== state.selectedFormat) return;

      const code = String(line.parfum_code || product?.parfum_code || skuId.split("_")[0] || "").trim().toUpperCase();
      const name = String(line.parfum_nom || product?.parfum_nom || code).trim();

      if (query && !normalizeText(`${code} ${name} ${skuId}`).includes(query)) return;

      const key = `${code}_${formatCl}`;
      const current = map.get(key) || { key, sku_id: skuId, parfum_code: code, parfum_nom: name, format_cl: formatCl, qty: 0, ca: 0 };
      const qty = toNumber(line.quantite, toNumber(line.qty, 0));
      const ca = toNumber(line.total_catalogue_ligne_ttc, toNumber(line.total_ligne_ttc, qty * toNumber(line.prix_unitaire_ttc, 0)));
      current.qty += qty;
      current.ca += ca;
      map.set(key, current);
    });

    return [...map.values()].sort((a, b) => b.qty - a.qty || b.ca - a.ca || a.parfum_code.localeCompare(b.parfum_code));
  };

  const renderOptions = () => {
    const years = [...new Set(getAllLines().map((line) => getLineYear(line)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    els.yearSelect.innerHTML = [`<option value="ALL">Toutes</option>`, ...years.map((year) => `<option value="${escapeAttr(year)}">${escapeHtml(year)}</option>`)].join("");
    if (years.includes(state.selectedYear)) els.yearSelect.value = state.selectedYear;
    else state.selectedYear = els.yearSelect.value = years[0] || "ALL";
  };

  const render = () => {
    const products = aggregateProducts();
    const totalQty = products.reduce((sum, item) => sum + item.qty, 0);
    const totalRevenue = products.reduce((sum, item) => sum + item.ca, 0);
    const top = products[0];

    els.totalQty.textContent = String(totalQty);
    els.totalRevenue.textContent = formatCurrency(totalRevenue);
    els.topProduct.textContent = top ? `${top.parfum_code} · ${top.qty}` : "—";
    els.productCount.textContent = String(products.length);

    const byFormat = products.reduce((map, item) => {
      const key = String(item.format_cl || "?");
      const current = map.get(key) || { format: key, qty: 0, ca: 0 };
      current.qty += item.qty;
      current.ca += item.ca;
      map.set(key, current);
      return map;
    }, new Map());

    const formats = [...byFormat.values()].sort((a, b) => toNumber(b.format, 0) - toNumber(a.format, 0));
    els.formatBreakdown.innerHTML = formats.length ? formats.map((item) => `
      <article class="formatCard">
        <span>${escapeHtml(item.format)} cL</span>
        <strong>${item.qty} vendu${item.qty > 1 ? "s" : ""}</strong>
        <span>${escapeHtml(formatCurrency(item.ca))}</span>
      </article>
    `).join("") : `<p class="statsEmpty">Aucune vente produit trouvée.</p>`;

    els.cards.innerHTML = products.length ? products.map((item, index) => `
      <article class="productCard">
        <div class="productCardHeader">
          <div class="productCardTitle">
            <strong>#${index + 1} · ${escapeHtml(item.parfum_code)} ${escapeHtml(item.format_cl || "?")} cL</strong>
            <span>${escapeHtml(item.parfum_nom)}</span>
          </div>
          <strong class="productCardAmount">${escapeHtml(formatCurrency(item.ca))}</strong>
        </div>
        <div class="productMetrics">
          <article><span>Quantité</span><strong>${item.qty}</strong></article>
          <article><span>Format</span><strong>${escapeHtml(item.format_cl || "?")} cL</strong></article>
          <article><span>CA moyen</span><strong>${escapeHtml(formatCurrency(item.qty ? item.ca / item.qty : 0))}</strong></article>
        </div>
      </article>
    `).join("") : `<p class="statsEmpty">Aucun produit ne correspond aux filtres.</p>`;
  };

  const loadLocalData = () => {
    state.catalogue = asArray(readJson(STORAGE_KEYS.catalogue, []));
    state.journees = asArray(readJson(STORAGE_KEYS.journees, []));
    state.transactions = [...asArray(readJson(STORAGE_KEYS.transactions, [])), ...asArray(readJson(STORAGE_KEYS.transactionsBackup, []))];
    state.ventesLignes = asArray(readJson(STORAGE_KEYS.ventesLignes, []));
  };

  const optionalArray = async (fnName, fallback = []) => {
    if (!hasApi() || typeof api()[fnName] !== "function") return fallback;
    try { const result = await api()[fnName](); return Array.isArray(result) ? result : fallback; } catch { return fallback; }
  };

  const loadRemoteData = async () => {
    if (!hasApi()) throw new Error("lugdurum-api.js n’est pas chargé.");
    const [catalogue, journees, transactions, ventesLignes] = await Promise.all([
      optionalArray("getCatalogue", state.catalogue),
      optionalArray("getJournees", state.journees),
      optionalArray("getTransactions", state.transactions),
      optionalArray("getVentesLignes", state.ventesLignes)
    ]);
    state.catalogue = catalogue; state.journees = journees; state.transactions = transactions; state.ventesLignes = ventesLignes;
    writeJson(STORAGE_KEYS.catalogue, catalogue); writeJson(STORAGE_KEYS.journees, journees); writeJson(STORAGE_KEYS.transactions, transactions); writeJson(STORAGE_KEYS.ventesLignes, ventesLignes);
  };

  els.yearSelect.addEventListener("change", () => { state.selectedYear = els.yearSelect.value; render(); });
  els.formatSelect.addEventListener("change", () => { state.selectedFormat = els.formatSelect.value; render(); });
  els.searchInput.addEventListener("input", () => { state.search = els.searchInput.value; render(); });

  const init = async () => {
    loadLocalData(); renderOptions(); render();
    try { setStatus("Chargement depuis Google Sheets..."); await loadRemoteData(); renderOptions(); render(); setStatus(""); }
    catch (error) { setStatus(`Données locales affichées : ${error.message}`, "isError"); }
  };

  init();
})();
