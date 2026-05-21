(() => {
  "use strict";

  /*
    Stats produits V8 :
    - API Google Sheets prioritaire.
    - Chargement via getCoreData() si disponible, sinon getters séparés.
    - Cache/localStorage uniquement si l’API est indisponible.
    - Analyse ventes_lignes.
    - Fallback depuis detail_ticket pour les transactions sans lignes.
    - Année statistique via journees_vente.date.
    - Sépare :
      50 cL = bouteilles vendues
      20 cL = compositions / coffrets
    - Rendu visuel cohérent :
      médailles top 3, barre de progression partout, quantité toujours à droite.
    - SKU masqué dans l’interface.
    - Tuiles plus aérées.
    - Visuel parfum en fond avec effet verre dépoli / verre brossé.
    - Utilise ./assets/parfums/{code}.webp.
  */

  const CACHE_KEYS = {
    transactions: "lugdurum_transactions_cache",
    ventesLignes: "lugdurum_ventes_lignes_cache",
    catalogue: "lugdurum_catalogue_cache",
    journees: "lugdurum_journees_cache"
  };

  const LEGACY_KEYS = {
    transactions: [
      "lugdurum_transactions_cache",
      "lugdurum_transactions",
      "lugdurum_transactions_backup",
      "lugdurum_pending_transactions"
    ],
    ventesLignes: [
      "lugdurum_ventes_lignes_cache",
      "lugdurum_ventes_lignes"
    ],
    catalogue: [
      "lugdurum_catalogue_cache"
    ],
    journees: [
      "lugdurum_journees_cache",
      "lugdurum_journees"
    ]
  };

  const CORE_TABLES = ["transactions", "ventesLignes", "catalogue", "journees"];
  const CURRENT_YEAR = String(new Date().getFullYear());

  const state = {
    source: "loading",
    apiMode: "",
    loadError: "",
    transactions: [],
    lignes: [],
    catalogue: [],
    journees: [],
    filters: {
      year: "AUTO",
      format: "ALL",
      search: ""
    }
  };

  const els = {
    year: document.getElementById("productYearSelect"),
    format: document.getElementById("productFormatSelect"),
    search: document.getElementById("productSearchInput"),

    bottles: document.getElementById("productTotalQty"),
    revenue: document.getElementById("productTotalRevenue"),
    topProduct: document.getElementById("productTopProduct"),
    references: document.getElementById("productCount"),

    formatList: document.getElementById("productFormatBreakdown"),
    list: document.getElementById("productCards"),
    status: document.getElementById("statsProductsStatus")
  };

  const api = () => window.LugdurumAPI || null;
  const hasApi = () => Boolean(api());

  const waitForApi = (timeoutMs = 1800) =>
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

  const readJsonNullable = (key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
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
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Cache non critique.
    }
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const escapeAttr = (value) =>
    escapeHtml(value).replaceAll("`", "&#096;");

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

  const formatAmount = (value) =>
    Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;

  const formatCurrency = (value) => {
    const amount = formatAmount(value);

    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const getYearFromDate = (value) => {
    const text = String(value || "").slice(0, 10);
    const match = text.match(/^(\d{4})-/) || text.match(/^(\d{4})/);
    return match ? match[1] : "";
  };

  const setText = (element, value) => {
    if (element) element.textContent = value;
  };

  const setStatus = (message, type = "") => {
    if (!els.status) return;

    els.status.textContent = message;
    els.status.className = "statsStatus statsProductsStatus";

    if (type) els.status.classList.add(type);
  };

  const isInvalidStatus = (value) => {
    const status = normalizeText(value);

    return [
      "annule",
      "annulee",
      "refuse",
      "refusee",
      "rembourse",
      "remboursee"
    ].includes(status);
  };

  const isValidStatus = (item) => {
    const status = item?.statut ?? item?.paiement_statut ?? "validee";
    return !isInvalidStatus(status);
  };

  const getTransactionId = (transaction) =>
    String(transaction?.transaction_id || transaction?.id || "").trim();

  const getJourneeId = (journee) =>
    String(journee?.journee_id || "").trim();

  const getTransactionAmount = (transaction) =>
    toNumber(
      transaction?.total_encaisse_ttc ??
      transaction?.total_encaisse ??
      transaction?.total_catalogue_ttc ??
      transaction?.total_catalogue,
      0
    );

  const parseDetailTicket = (transaction) => {
    const raw = transaction?.detail_ticket;

    if (Array.isArray(raw)) return raw;
    if (typeof raw !== "string" || !raw.trim()) return [];

    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };

  const parseSku = (skuId) => {
    const text = String(skuId || "").trim();
    const parts = text.split("_");

    const maybeFormat = parts
      .map((part) => toNumber(part, 0))
      .find((number) => number === 50 || number === 20);

    return {
      parfum_code: String(parts[0] || "").toUpperCase(),
      format_cl: maybeFormat || 0
    };
  };

  const getParfumImageUrl = (product) => {
    const code = String(product?.parfum_code || "")
      .trim()
      .toLowerCase();

    if (!code || code === "?") return "";

    return `./assets/parfums/${code}.webp`;
  };

  const getProductImageFromCatalogue = (item) => {
    if (!item || typeof item !== "object") return "";

    return String(
      item.tuile_url ||
      item.tile_url ||
      item.visuel_url ||
      item.image_url ||
      item.image ||
      item.background_url ||
      item.background ||
      item.asset_url ||
      item.photo_url ||
      item.photo ||
      ""
    ).trim();
  };

  const getProductImageUrl = (product, catalogueItem = null) =>
    getProductImageFromCatalogue(catalogueItem) ||
    String(product?.image_url || "").trim() ||
    getParfumImageUrl(product);

  const getCatalogueBySku = () =>
    state.catalogue.reduce((map, item) => {
      const skuId = String(item?.sku_id || "").trim();
      if (skuId) map.set(skuId, item);
      return map;
    }, new Map());

  const getCatalogueByParfumCode = () =>
    state.catalogue.reduce((map, item) => {
      const code = String(item?.parfum_code || "").trim().toUpperCase();
      const current = map.get(code);

      if (!code) return map;

      if (!current || getProductImageFromCatalogue(item)) {
        map.set(code, item);
      }

      return map;
    }, new Map());

  const getJourneeById = () =>
    state.journees.reduce((map, journee) => {
      const id = getJourneeId(journee);
      if (id) map.set(id, journee);
      return map;
    }, new Map());

  const getTransactionById = () =>
    state.transactions.reduce((map, transaction) => {
      const id = getTransactionId(transaction);

      if (id && isValidStatus(transaction)) {
        map.set(id, transaction);
      }

      return map;
    }, new Map());

  const getBusinessDate = (rawLine, transaction, journeeMap) => {
    const lineJourneeId = String(rawLine?.journee_id || "").trim();
    const transactionJourneeId = String(transaction?.journee_id || "").trim();

    const journee =
      journeeMap.get(lineJourneeId) ||
      journeeMap.get(transactionJourneeId) ||
      null;

    return (
      journee?.date ||
      journee?.date_journee ||
      journee?.date_debut ||
      rawLine?.date_vente ||
      rawLine?.date ||
      transaction?.date_vente ||
      transaction?.date ||
      transaction?.date_heure ||
      rawLine?.date_heure ||
      transaction?.created_at ||
      rawLine?.created_at ||
      ""
    );
  };

  const normalizeLine = (rawLine, transactionMap, catalogueMap, journeeMap) => {
    const transactionId = String(rawLine?.transaction_id || rawLine?.transactionId || "").trim();
    const transaction = transactionMap.get(transactionId) || null;

    const skuId = String(rawLine?.sku_id || rawLine?.sku || "").trim();
    const catalogueItem = catalogueMap.get(skuId) || null;
    const parsedSku = parseSku(skuId);

    const quantity = toNumber(rawLine?.quantite ?? rawLine?.qty ?? rawLine?.quantity, 0);
    const unitPrice = toNumber(rawLine?.prix_unitaire_ttc ?? rawLine?.unit_price ?? rawLine?.prix, 0);

    const lineTotal = toNumber(
      rawLine?.total_catalogue_ligne_ttc ??
      rawLine?.total_ligne_ttc ??
      rawLine?.total_ttc ??
      rawLine?.ca,
      quantity * unitPrice
    );

    const businessDate = getBusinessDate(rawLine, transaction, journeeMap);
    const businessYear = getYearFromDate(businessDate);

    const normalized = {
      ligne_id: String(rawLine?.ligne_id || "").trim(),
      transaction_id: transactionId,
      mission_id: rawLine?.mission_id || transaction?.mission_id || "",
      journee_id: rawLine?.journee_id || transaction?.journee_id || "",
      business_date: businessDate,
      business_year: businessYear,
      sku_id: skuId,
      parfum_code: String(
        rawLine?.parfum_code ||
        catalogueItem?.parfum_code ||
        parsedSku.parfum_code ||
        "?"
      ).toUpperCase(),
      parfum_nom: String(
        rawLine?.parfum_nom ||
        catalogueItem?.parfum_nom ||
        rawLine?.nom ||
        parsedSku.parfum_code ||
        "Produit"
      ).trim(),
      format_cl: toNumber(
        rawLine?.format_cl,
        toNumber(catalogueItem?.format_cl, parsedSku.format_cl)
      ),
      quantite: quantity,
      total_ttc: lineTotal,
      image_url: "",
      source: rawLine?.source || transaction?.source || "",
      statut: rawLine?.statut || transaction?.statut || "valide"
    };

    normalized.image_url = getProductImageUrl(normalized, catalogueItem);

    return normalized;
  };

  const pushGenericTicketLine = (lines, transaction, item) => {
    const transactionId = getTransactionId(transaction);
    const quantity = toNumber(item?.quantite ?? item?.qty ?? item?.quantity, 0);

    if (!item?.sku_id || quantity <= 0) return;

    const unitPrice = toNumber(item?.prix_unitaire_ttc ?? item?.unit_price ?? item?.prix, 0);

    lines.push({
      ligne_id: item.ligne_id || "",
      transaction_id: transactionId,
      mission_id: item.mission_id || transaction.mission_id || "",
      journee_id: item.journee_id || transaction.journee_id || "",
      date_heure: transaction.date_heure || transaction.created_at || "",
      sku_id: item.sku_id,
      parfum_code: item.parfum_code || "",
      parfum_nom: item.parfum_nom || "",
      format_cl: item.format_cl || "",
      quantite: quantity,
      total_catalogue_ligne_ttc: toNumber(
        item.total_catalogue_ligne_ttc ??
        item.total_ligne_ttc ??
        item.total_ttc,
        quantity * unitPrice
      ),
      source: item.source || transaction.source || "DETAIL_TICKET",
      statut: item.statut || "valide"
    });
  };

  const buildLinesFromTransactions = (skipTransactionIds = new Set()) => {
    const lines = [];

    state.transactions
      .filter(isValidStatus)
      .forEach((transaction) => {
        const transactionId = getTransactionId(transaction);

        if (transactionId && skipTransactionIds.has(transactionId)) return;

        const ticket = parseDetailTicket(transaction);
        const transactionTotal = getTransactionAmount(transaction);

        ticket.forEach((item) => {
          if (item?.type === "bottle") {
            const quantity = toNumber(item.quantite ?? item.qty ?? item.quantity, 0);
            const unitPrice = toNumber(item.prix_unitaire_ttc ?? item.unit_price ?? item.prix, 0);

            if (!item.sku_id || quantity <= 0) return;

            lines.push({
              ligne_id: item.ligne_id || "",
              transaction_id: transactionId,
              mission_id: transaction.mission_id || "",
              journee_id: transaction.journee_id || "",
              date_heure: transaction.date_heure || transaction.created_at || "",
              sku_id: item.sku_id,
              parfum_code: item.parfum_code,
              parfum_nom: item.parfum_nom,
              format_cl: item.format_cl,
              quantite: quantity,
              total_catalogue_ligne_ttc: toNumber(
                item.total_catalogue_ligne_ttc ?? item.total_ttc,
                quantity * unitPrice
              ),
              source: transaction.source || "DETAIL_TICKET",
              statut: "valide"
            });

            return;
          }

          if (item?.type === "box" && Array.isArray(item.composition)) {
            const boxTotal = toNumber(item.prix_ttc, transactionTotal);
            const unitShare = item.composition.length > 0 ? boxTotal / item.composition.length : 0;

            item.composition.forEach((product) => {
              if (!product?.sku_id) return;

              lines.push({
                ligne_id: product.ligne_id || "",
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
                source: transaction.source || "COFFRET",
                statut: "valide"
              });
            });

            return;
          }

          pushGenericTicketLine(lines, transaction, item);
        });
      });

    return lines;
  };

  const dedupeSheetLines = (lines) => {
    const map = new Map();
    const withoutId = [];

    lines.forEach((line) => {
      const id = String(line?.ligne_id || "").trim();

      if (!id) {
        withoutId.push(line);
        return;
      }

      const existing = map.get(id);

      if (!existing) {
        map.set(id, line);
        return;
      }

      const existingUpdated = String(existing.updated_at || existing.created_at || "");
      const lineUpdated = String(line.updated_at || line.created_at || "");

      if (lineUpdated >= existingUpdated) {
        map.set(id, line);
      }
    });

    return [...map.values(), ...withoutId];
  };

  const getBaseLines = () => {
    const validSheetLines = dedupeSheetLines(state.lignes.filter(isValidStatus));

    const transactionIdsWithSheetLines = new Set(
      validSheetLines
        .map((line) => String(line.transaction_id || "").trim())
        .filter(Boolean)
    );

    return [
      ...validSheetLines,
      ...buildLinesFromTransactions(transactionIdsWithSheetLines)
    ];
  };

  const getNormalizedLines = () => {
    const transactionMap = getTransactionById();
    const catalogueMap = getCatalogueBySku();
    const journeeMap = getJourneeById();

    return getBaseLines()
      .filter(isValidStatus)
      .map((line) => normalizeLine(line, transactionMap, catalogueMap, journeeMap))
      .filter((line) => line.quantite > 0)
      .filter((line) => line.sku_id || line.parfum_code)
      .filter((line) => {
        if (!line.transaction_id) return true;

        const transaction = transactionMap.get(line.transaction_id);

        return !transaction || isValidStatus(transaction);
      });
  };

  const getAvailableYears = () => {
    const years = new Set();

    getNormalizedLines().forEach((line) => {
      if (line.business_year) years.add(line.business_year);
    });

    return [...years].sort((a, b) => b.localeCompare(a));
  };

  const syncYearFilter = () => {
    if (!els.year) return;

    const previous = state.filters.year;
    const years = getAvailableYears();

    els.year.innerHTML = `
      <option value="ALL">Toutes</option>
      ${years.map((year) => `<option value="${escapeAttr(year)}">${escapeHtml(year)}</option>`).join("")}
    `;

    if (previous === "AUTO") {
      state.filters.year = years.includes(CURRENT_YEAR) ? CURRENT_YEAR : "ALL";
      els.year.value = state.filters.year;
      return;
    }

    if (previous === "ALL" || years.includes(previous)) {
      els.year.value = previous;
      return;
    }

    state.filters.year = years.includes(CURRENT_YEAR) ? CURRENT_YEAR : "ALL";
    els.year.value = state.filters.year;
  };

  const getFilteredLines = () => {
    const query = normalizeText(state.filters.search);

    return getNormalizedLines()
      .filter((line) => state.filters.year === "ALL" || line.business_year === state.filters.year)
      .filter((line) => state.filters.format === "ALL" || String(line.format_cl) === String(state.filters.format))
      .filter((line) => {
        if (!query) return true;

        return normalizeText(`${line.parfum_code} ${line.parfum_nom} ${line.sku_id}`).includes(query);
      });
  };

  const computeByProduct = (lines = getFilteredLines()) => {
    const catalogueByCode = getCatalogueByParfumCode();
    const map = new Map();

    lines.forEach((line) => {
      const key = line.sku_id || `${line.parfum_code}_${line.format_cl}`;
      const catalogueFallback = catalogueByCode.get(line.parfum_code) || null;

      const current = map.get(key) || {
        sku_id: key,
        parfum_code: line.parfum_code,
        parfum_nom: line.parfum_nom,
        format_cl: line.format_cl,
        quantite: 0,
        ca: 0,
        image_url: getProductImageUrl(line, catalogueFallback)
      };

      current.quantite += toNumber(line.quantite, 0);
      current.ca += toNumber(line.total_ttc, 0);

      if (!current.image_url) {
        current.image_url = getProductImageUrl(line, catalogueFallback);
      }

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
      const current = map.get(key) || {
        format_cl: key,
        quantite: 0,
        ca: 0
      };

      current.quantite += toNumber(line.quantite, 0);
      current.ca += toNumber(line.total_ttc, 0);

      map.set(key, current);
    });

    return [...map.values()].sort(
      (a, b) => toNumber(b.format_cl, 0) - toNumber(a.format_cl, 0)
    );
  };

  const splitProducts = () => {
    const lines = getFilteredLines();

    return {
      bottles50: computeByProduct(lines.filter((line) => toNumber(line.format_cl, 0) === 50)),
      boxes20: computeByProduct(lines.filter((line) => toNumber(line.format_cl, 0) === 20)),
      other: computeByProduct(lines.filter((line) => ![50, 20].includes(toNumber(line.format_cl, 0))))
    };
  };

  const getPercent = (value, max) => {
    if (!max) return 0;
    return Math.max(4, Math.min(100, Math.round((value / max) * 100)));
  };

  const getRankLabel = (rank) => {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return `#${rank}`;
  };

  const getImageStyle = (url) => {
    if (!url) return "";
    return ` style="--product-image: url('${escapeAttr(url)}');"`;
  };

  const renderLoading = () => {
    if (els.year) {
      els.year.innerHTML = `<option value="ALL">Chargement…</option>`;
    }

    setText(els.bottles, "—");
    setText(els.revenue, "—");
    setText(els.topProduct, "—");
    setText(els.references, "—");

    if (els.formatList) {
      els.formatList.innerHTML = `<p class="statsEmpty">Chargement…</p>`;
    }

    if (els.list) {
      els.list.innerHTML = `<p class="statsEmpty">Chargement…</p>`;
    }

    setStatus("Chargement…");
  };

  const renderFormatSummary = (formats) => {
    if (!els.formatList) return;

    els.formatList.innerHTML = formats.length
      ? formats.map((item) => {
          const format = toNumber(item.format_cl, 0);
          const label =
            format === 50
              ? "Bouteilles"
              : format === 20
                ? "Compositions coffrets"
                : "Autres formats";

          return `
            <article class="productFormatCard">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(String(item.format_cl))} cL</strong>
              <em>${escapeHtml(String(item.quantite))} vendu${item.quantite > 1 ? "s" : ""}</em>
              <small>${escapeHtml(formatCurrency(item.ca))}</small>
            </article>
          `;
        }).join("")
      : `<p class="statsEmpty">Aucune vente produit sur cette période.</p>`;
  };

  const renderProductRow = (product, maxQty, rank) => {
    const percent = getPercent(product.quantite, maxQty);
    const imageUrl = getProductImageUrl(product);
    const hasImage = Boolean(imageUrl);

    return `
      <article class="productVisualRow ${hasImage ? "hasImage" : ""}"${getImageStyle(imageUrl)}>
        <div class="productVisualMedia" aria-hidden="true">
          <span class="productVisualRank">${escapeHtml(getRankLabel(rank))}</span>
        </div>

        <div class="productVisualMain">
          <div class="productVisualTitle">
            <strong>${escapeHtml(product.parfum_code)}</strong>
            <span>${escapeHtml(product.parfum_nom || product.parfum_code)}</span>
          </div>

          <div class="productVisualBar" aria-hidden="true">
            <span style="width: ${percent}%"></span>
          </div>

          <div class="productVisualFooter">
            <span class="productVisualRevenue">${escapeHtml(formatCurrency(product.ca))}</span>
          </div>
        </div>

        <strong class="productVisualQty">${escapeHtml(String(product.quantite))}</strong>
      </article>
    `;
  };

  const renderProductGroup = ({ title, subtitle, products, empty }) => {
    if (!products.length) {
      return `
        <section class="productVisualGroup">
          <div class="productVisualGroupHeader">
            <div>
              <p class="sectionEyebrow">${escapeHtml(subtitle)}</p>
              <h2>${escapeHtml(title)}</h2>
            </div>
          </div>

          <p class="statsEmpty">${escapeHtml(empty)}</p>
        </section>
      `;
    }

    const maxQty = Math.max(...products.map((product) => product.quantite), 0);
    const totalQty = products.reduce((sum, product) => sum + product.quantite, 0);
    const totalCa = products.reduce((sum, product) => sum + product.ca, 0);

    return `
      <section class="productVisualGroup">
        <div class="productVisualGroupHeader">
          <div>
            <p class="sectionEyebrow">${escapeHtml(subtitle)}</p>
            <h2>${escapeHtml(title)}</h2>
          </div>

          <div class="productGroupTotals">
            <strong>${escapeHtml(String(totalQty))}</strong>
            <span>${escapeHtml(formatCurrency(totalCa))}</span>
          </div>
        </div>

        <div class="productVisualList">
          ${products.map((product, index) => renderProductRow(product, maxQty, index + 1)).join("")}
        </div>
      </section>
    `;
  };

  const renderProducts = () => {
    if (!els.list) return;

    const groups = splitProducts();

    const html = [
      renderProductGroup({
        title: "Bouteilles 50 cL",
        subtitle: "Ventes directes",
        products: groups.bottles50,
        empty: "Aucune bouteille 50 cL vendue sur cette période."
      }),
      renderProductGroup({
        title: "Compositions 20 cL",
        subtitle: "Coffrets",
        products: groups.boxes20,
        empty: "Aucune composition 20 cL vendue sur cette période."
      })
    ];

    if (groups.other.length > 0) {
      html.push(
        renderProductGroup({
          title: "Autres formats",
          subtitle: "À vérifier",
          products: groups.other,
          empty: "Aucun autre format."
        })
      );
    }

    els.list.innerHTML = html.join("");
  };

  const render = () => {
    syncYearFilter();

    const normalizedLines = getNormalizedLines();
    const products = computeByProduct();
    const formats = computeByFormat();

    const totalQty = products.reduce((sum, product) => sum + product.quantite, 0);
    const totalCa = products.reduce((sum, product) => sum + product.ca, 0);
    const top = products[0] || null;

    setText(els.bottles, String(totalQty));
    setText(els.revenue, formatCurrency(totalCa));
    setText(els.topProduct, top ? `${top.parfum_code} · ${top.quantite}` : "—");
    setText(els.references, String(products.length));

    renderFormatSummary(formats);
    renderProducts();

    if (state.source === "api" && normalizedLines.length === 0) {
      setStatus(
        `Données chargées, mais aucune ligne produit exploitable. Transactions : ${state.transactions.length} · ventes_lignes : ${state.lignes.length}`,
        "isError"
      );
      return;
    }

    if (state.source === "local") {
      setStatus(
        `API indisponible. Données locales affichées : ${state.loadError}`,
        "isError"
      );
      return;
    }

    setStatus("");
  };

  const normalizeCoreArray = (coreData, key) => {
    const value = coreData?.[key];

    if (Array.isArray(value)) return value;

    if (value && typeof value === "object" && value.ok === false) {
      throw new Error(value.error || `Table coreData invalide : ${key}`);
    }

    return [];
  };

  const callArray = async (fnName) => {
    if (!hasApi() || typeof api()[fnName] !== "function") {
      throw new Error(`Fonction API indisponible : ${fnName}`);
    }

    const result = await api()[fnName]();
    return Array.isArray(result) ? result : [];
  };

  const loadRemoteWithCoreData = async () => {
    if (!hasApi() || typeof api().getCoreData !== "function") {
      throw new Error("LugdurumAPI.getCoreData() est indisponible.");
    }

    const coreData = await api().getCoreData(CORE_TABLES);

    if (!coreData || typeof coreData !== "object" || Array.isArray(coreData)) {
      throw new Error("Réponse getCoreData invalide.");
    }

    return {
      transactions: normalizeCoreArray(coreData, "transactions"),
      lignes: normalizeCoreArray(coreData, "ventesLignes"),
      catalogue: normalizeCoreArray(coreData, "catalogue"),
      journees: normalizeCoreArray(coreData, "journees")
    };
  };

  const loadRemoteWithSeparateCalls = async () => {
    const [transactions, lignes, catalogue, journees] = await Promise.all([
      callArray("getTransactions"),
      callArray("getVentesLignes"),
      callArray("getCatalogue"),
      callArray("getJournees")
    ]);

    return {
      transactions,
      lignes,
      catalogue,
      journees
    };
  };

  const loadRemote = async () => {
    const ready = await waitForApi();

    if (!ready) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    let data;

    try {
      data = await loadRemoteWithCoreData();
      state.apiMode = "getCoreData";
    } catch (coreError) {
      try {
        data = await loadRemoteWithSeparateCalls();
        state.apiMode = `getters séparés après échec getCoreData : ${coreError.message}`;
      } catch (separateError) {
        throw new Error(
          `getCoreData : ${coreError.message} · getters séparés : ${separateError.message}`
        );
      }
    }

    state.transactions = data.transactions;
    state.lignes = data.lignes;
    state.catalogue = data.catalogue;
    state.journees = data.journees;
    state.source = "api";
    state.loadError = "";

    writeJson(CACHE_KEYS.transactions, state.transactions);
    writeJson(CACHE_KEYS.ventesLignes, state.lignes);
    writeJson(CACHE_KEYS.catalogue, state.catalogue);
    writeJson(CACHE_KEYS.journees, state.journees);
  };

  const loadLocalFallback = (error) => {
    state.transactions = readFirstArray(LEGACY_KEYS.transactions);
    state.lignes = readFirstArray(LEGACY_KEYS.ventesLignes);
    state.catalogue = readFirstArray(LEGACY_KEYS.catalogue);
    state.journees = readFirstArray(LEGACY_KEYS.journees);
    state.source = "local";
    state.apiMode = "cache";
    state.loadError = error?.message || "Lecture données impossible.";
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
    renderLoading();

    try {
      await loadRemote();
    } catch (error) {
      loadLocalFallback(error);
    }

    render();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();