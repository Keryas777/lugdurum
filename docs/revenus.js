(() => {
  "use strict";

  /*
    Revenus devient Saisie historique pro V2
    - Saisie d’anciennes commandes pro déjà livrées et déjà facturées.
    - Aucun appel VosFactures.
    - Enregistre dans Google Sheets via LugdurumAPI.batchUpsert().
    - Onglets visés :
      clients
      commandes_pro
      commandes_pro_lignes
      documents
    - Respect strict des colonnes existantes dans Google Sheets.
    - Le montant officiel est le montant facturé saisi.
    - Les tuiles produits servent aux quantités par parfum / format pour les statistiques.
    - Les montants de lignes sont répartis au prorata du catalogue estimé pour retomber sur le montant facturé.
  */

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme"
  };

  const SOURCE = "SAISIE_HISTORIQUE_PRO";

  const STORAGE_KEYS = {
    catalogueCache: "lugdurum_catalogue_cache",
    offresVenteCache: "lugdurum_offres_vente_cache",
    clientsCache: "lugdurum_clients_cache"
  };

  const state = {
    clients: [],
    catalogue: [],
    offresVente: [],
    quantities: new Map(),
    isSaving: false,
    dataLoaded: false
  };

  const els = {
    form: document.getElementById("historiqueProForm"),

    clientSelect: document.getElementById("clientSelect"),
    clientTypeInput: document.getElementById("clientTypeInput"),
    clientStatusInput: document.getElementById("clientStatusInput"),
    clientCommercialNameInput: document.getElementById("clientCommercialNameInput"),
    clientLegalNameInput: document.getElementById("clientLegalNameInput"),
    clientSiretInput: document.getElementById("clientSiretInput"),
    clientEmailInput: document.getElementById("clientEmailInput"),
    clientAddressInput: document.getElementById("clientAddressInput"),
    clientZipInput: document.getElementById("clientZipInput"),
    clientCityInput: document.getElementById("clientCityInput"),

    invoiceDateInput: document.getElementById("invoiceDateInput"),
    deliveryDateInput: document.getElementById("deliveryDateInput"),
    operationTypeInput: document.getElementById("operationTypeInput"),
    paymentStatusInput: document.getElementById("paymentStatusInput"),
    invoiceAmountInput: document.getElementById("invoiceAmountInput"),
    invoiceNumberInput: document.getElementById("invoiceNumberInput"),
    paymentModeInput: document.getElementById("paymentModeInput"),
    orderNoteInput: document.getElementById("orderNoteInput"),

    productRows: document.getElementById("productRows"),
    reloadProductsBtn: document.getElementById("reloadProductsBtn"),
    clearProductsBtn: document.getElementById("clearProductsBtn"),
    catalogueTotal: document.getElementById("catalogueTotal"),

    heroAmount: document.getElementById("heroAmount"),
    heroBottles: document.getElementById("heroBottles"),

    saveHistoricalProBtn: document.getElementById("saveHistoricalProBtn"),
    historiqueProStatus: document.getElementById("historiqueProStatus")
  };

  const api = () => window.LugdurumAPI || null;

  const hasApi = () => Boolean(api());

  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Cache indisponible.
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

  const cleanString = (value) => String(value ?? "").trim();

  const toArray = (value) => (Array.isArray(value) ? value : []);

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

  const toBoolean = (value, fallback = false) => {
    if (value === true) return true;
    if (value === false) return false;
    if (typeof value === "number") return value !== 0;

    const normalized = String(value ?? "")
      .trim()
      .toLowerCase();

    if (!normalized) return fallback;

    if (["true", "vrai", "oui", "yes", "1", "x", "actif"].includes(normalized)) {
      return true;
    }

    if (["false", "faux", "non", "no", "0", "inactif"].includes(normalized)) {
      return false;
    }

    return fallback;
  };

  const normalizeKey = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value || 0);

  const formatAmount = (value) =>
    Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;

  const todayIso = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  };

  const nowIso = () => new Date().toISOString();

  const slugify = (value, fallback = "PRO") =>
    String(value || fallback)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 42) || fallback;

  const centsKey = (value) =>
    String(Math.round(formatAmount(value) * 100));

  const setStatus = (message, type = "") => {
    if (!els.historiqueProStatus) return;

    els.historiqueProStatus.textContent = message;
    els.historiqueProStatus.className = "historiqueProStatus";

    if (type) {
      els.historiqueProStatus.classList.add(type);
    }
  };

  const setSaving = (isSaving) => {
    state.isSaving = isSaving;

    [
      els.saveHistoricalProBtn,
      els.clearProductsBtn,
      els.reloadProductsBtn
    ].forEach((button) => {
      if (button) button.disabled = isSaving;
    });
  };

  const getSelectedClient = () => {
    const clientId = cleanString(els.clientSelect?.value);

    if (!clientId) return null;

    return state.clients.find((client) => cleanString(client.client_id) === clientId) || null;
  };

  const getClientDisplayName = (client) =>
    cleanString(
      client?.nom_commercial ||
      client?.raison_sociale ||
      client?.nom ||
      client?.client_nom ||
      ""
    );

  const deriveSirenFromSiret = (siret) => {
    const digits = cleanString(siret).replace(/\D/g, "");
    return digits.length >= 9 ? digits.slice(0, 9) : "";
  };

  const normalizeClient = (raw = {}, index = 0) => {
    const commercialName = cleanString(
      raw.nom_commercial ||
      raw.client_nom ||
      raw.nom ||
      raw.buyer_name ||
      raw.raison_sociale
    );

    const legalName = cleanString(raw.raison_sociale || raw.buyer_name || commercialName);
    const siret = cleanString(raw.siret || raw.buyer_tax_no);
    const siren = cleanString(raw.siren || deriveSirenFromSiret(siret));

    return {
      client_id: cleanString(raw.client_id || raw.id || `CL_TMP_${index}`),
      type_client: cleanString(raw.type_client || raw.client_type || raw.type || "caviste"),
      nom_commercial: commercialName,
      raison_sociale: legalName,
      siren,
      siret,
      email: cleanString(raw.email || raw.buyer_email),
      telephone: cleanString(raw.telephone || raw.phone),
      adresse: cleanString(raw.adresse || raw.buyer_street),
      code_postal: cleanString(raw.code_postal || raw.buyer_post_code),
      ville: cleanString(raw.ville || raw.buyer_city),
      contact_nom: cleanString(raw.contact_nom || raw.contact),
      statut: cleanString(raw.statut || raw.client_statut || "client_actif"),
      conditions_paiement: cleanString(raw.conditions_paiement),
      remise_habituelle: cleanString(raw.remise_habituelle),
      source_contact: cleanString(raw.source_contact || raw.source),
      note: cleanString(raw.note),
      created_at: cleanString(raw.created_at),
      updated_at: cleanString(raw.updated_at)
    };
  };

  const normalizeProduct = (raw, index) => {
    const code = cleanString(raw.parfum_code).toUpperCase();
    const formatCl = toNumber(raw.format_cl, 0);

    return {
      sku_id: cleanString(raw.sku_id || `${code}_${formatCl}`),
      parfum_code: code,
      parfum_nom: cleanString(raw.parfum_nom || code),
      format_cl: formatCl,
      gamme_tarif: cleanString(raw.gamme_tarif),
      vendable_seul: toBoolean(raw.vendable_seul, false),
      composable_coffret: toBoolean(raw.composable_coffret, false),
      cout_revient: toNumber(raw.cout_revient, 0),
      actif: Object.prototype.hasOwnProperty.call(raw, "actif")
        ? toBoolean(raw.actif, false)
        : true,
      visible_webapp: Object.prototype.hasOwnProperty.call(raw, "visible_webapp")
        ? toBoolean(raw.visible_webapp, true)
        : true,
      ordre_affichage: toNumber(raw.ordre_affichage, 1000 + index),
      note: cleanString(raw.note),
      image_src: cleanString(raw.image_src)
    };
  };

  const normalizeOffer = (raw, index) => ({
    offre_id: cleanString(raw.offre_id),
    libelle: cleanString(raw.libelle || raw.offre_id),
    type_offre: cleanString(raw.type_offre).toLowerCase(),
    format_cl: toNumber(raw.format_cl, 0),
    gamme_tarif: cleanString(raw.gamme_tarif),
    quantite_bouteilles: toNumber(raw.quantite_bouteilles, 0),
    prix_ttc: toNumber(raw.prix_ttc, 0),
    prix_ht: toNumber(raw.prix_ht, toNumber(raw.prix_ttc, 0)),
    taux_tva: toNumber(raw.taux_tva, 0),
    regime_tva: cleanString(raw.regime_tva),
    actif: Object.prototype.hasOwnProperty.call(raw, "actif")
      ? toBoolean(raw.actif, false)
      : true,
    ordre_affichage: toNumber(raw.ordre_affichage, 1000 + index),
    supplement_parfum_code: cleanString(raw.supplement_parfum_code).toUpperCase(),
    supplement_unitaire_ttc: toNumber(raw.supplement_unitaire_ttc, 0),
    note: cleanString(raw.note)
  });

  const getProductImageSrc = (product) =>
    cleanString(product?.image_src) ||
    `./assets/parfums/${cleanString(product?.parfum_code).toLowerCase()}.webp`;

  const shouldDisplayProduct = (product) => {
    if (!product) return false;
    if (product.format_cl !== 50 && product.format_cl !== 20) return false;
    if (!product.vendable_seul && !product.composable_coffret) return false;

    return true;
  };

  const isOldOrHiddenProduct = (product) =>
    !product.actif || product.visible_webapp === false;

  const getGroupedCatalogue = () => {
    const products = state.catalogue
      .filter(shouldDisplayProduct)
      .sort((a, b) => {
        const byOrder = a.ordre_affichage - b.ordre_affichage;
        if (byOrder !== 0) return byOrder;

        const byCode = a.parfum_code.localeCompare(b.parfum_code);
        if (byCode !== 0) return byCode;

        return b.format_cl - a.format_cl;
      });

    const groups = new Map();

    products.forEach((product) => {
      if (!groups.has(product.parfum_code)) {
        groups.set(product.parfum_code, {
          parfum_code: product.parfum_code,
          parfum_nom: product.parfum_nom,
          ordre_affichage: product.ordre_affichage,
          products: []
        });
      }

      groups.get(product.parfum_code).products.push(product);
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        isHistoricalOnly: group.products.every(isOldOrHiddenProduct),
        hasHistoricalVariant: group.products.some(isOldOrHiddenProduct)
      }))
      .sort((a, b) => {
        const byOrder = a.ordre_affichage - b.ordre_affichage;
        if (byOrder !== 0) return byOrder;

        return a.parfum_code.localeCompare(b.parfum_code);
      });
  };

  const getProductBySku = (skuId) =>
    state.catalogue.find((product) => product.sku_id === skuId) || null;

  const getQuantity = (skuId) =>
    toNumber(state.quantities.get(skuId), 0);

  const setQuantity = (skuId, quantity) => {
    const safeQuantity = Math.max(0, Math.floor(toNumber(quantity, 0)));

    if (safeQuantity > 0) {
      state.quantities.set(skuId, safeQuantity);
    } else {
      state.quantities.delete(skuId);
    }
  };

  const updateQuantityInput = (skuId) => {
    document.querySelectorAll("[data-historique-pro-input]").forEach((input) => {
      if (input.dataset.historiqueProInput === skuId) {
        const qty = getQuantity(skuId);
        input.value = qty > 0 ? String(qty) : "";
      }
    });
  };

  const updateAllQuantityInputs = () => {
    document.querySelectorAll("[data-historique-pro-input]").forEach((input) => {
      const qty = getQuantity(input.dataset.historiqueProInput);
      input.value = qty > 0 ? String(qty) : "";
    });
  };

  const getHistoricalOffers = () =>
    state.offresVente
      .filter((offer) => offer.offre_id && offer.type_offre && offer.format_cl)
      .sort((a, b) => {
        const byActive = Number(b.actif) - Number(a.actif);
        if (byActive !== 0) return byActive;

        const byOrder = a.ordre_affichage - b.ordre_affichage;
        if (byOrder !== 0) return byOrder;

        return a.offre_id.localeCompare(b.offre_id);
      });

  const findBottleOffer = (product) => {
    const productGamme = normalizeKey(product.gamme_tarif);

    return getHistoricalOffers().find((offer) => (
      offer.type_offre === "bouteille" &&
      offer.format_cl === product.format_cl &&
      normalizeKey(offer.gamme_tarif) === productGamme
    )) || null;
  };

  const findBoxOffer = () => (
    getHistoricalOffers().find((offer) => offer.offre_id === "COFFRET_3_20") ||
    getHistoricalOffers().find((offer) => offer.offre_id === "COFFRET_6_20") ||
    getHistoricalOffers().find((offer) => offer.type_offre === "coffret" && offer.format_cl === 20) ||
    null
  );

  const getEstimatedUnitPriceForProduct = (product) => {
    if (!product) {
      return {
        ttc: 0,
        ht: 0,
        offer: null
      };
    }

    if (product.format_cl === 50) {
      const offer = findBottleOffer(product);

      return {
        ttc: offer ? offer.prix_ttc : 0,
        ht: offer ? offer.prix_ht : 0,
        offer
      };
    }

    if (product.format_cl === 20) {
      const offer = findBoxOffer();

      if (!offer || !offer.quantite_bouteilles) {
        return {
          ttc: 0,
          ht: 0,
          offer: null
        };
      }

      const baseUnitTtc = offer.prix_ttc / offer.quantite_bouteilles;
      const baseUnitHt = offer.prix_ht / offer.quantite_bouteilles;
      const supplement =
        offer.supplement_parfum_code && offer.supplement_parfum_code === product.parfum_code
          ? offer.supplement_unitaire_ttc
          : 0;

      return {
        ttc: baseUnitTtc + supplement,
        ht: baseUnitHt + supplement,
        offer
      };
    }

    return {
      ttc: 0,
      ht: 0,
      offer: null
    };
  };

  const getProductLinesDraft = () => {
    const lines = [];

    state.quantities.forEach((quantity, skuId) => {
      if (quantity <= 0) return;

      const product = getProductBySku(skuId);

      if (!product) return;

      const pricing = getEstimatedUnitPriceForProduct(product);

      lines.push({
        product,
        quantity,
        estimated_unit_ttc: pricing.ttc,
        estimated_unit_ht: pricing.ht,
        estimated_total_ttc: formatAmount(quantity * pricing.ttc),
        estimated_total_ht: formatAmount(quantity * pricing.ht),
        offer: pricing.offer
      });
    });

    return lines.sort((a, b) => {
      const byFormat = b.product.format_cl - a.product.format_cl;
      if (byFormat !== 0) return byFormat;

      return a.product.parfum_code.localeCompare(b.product.parfum_code);
    });
  };

  const getCatalogueTotal = () =>
    getProductLinesDraft().reduce((sum, line) => (
      sum + line.estimated_total_ttc
    ), 0);

  const getBottleTotal = () =>
    getProductLinesDraft().reduce((sum, line) => sum + line.quantity, 0);

  const getInvoiceAmount = () =>
    formatAmount(toNumber(els.invoiceAmountInput?.value, 0));

  const distributeInvoiceAmountOnLines = (lines, invoiceAmount) => {
    const safeLines = toArray(lines);
    const officialTotal = formatAmount(invoiceAmount);

    if (safeLines.length === 0) return [];

    const catalogueTotal = formatAmount(
      safeLines.reduce((sum, line) => sum + line.estimated_total_ttc, 0)
    );

    const bottleTotal = safeLines.reduce((sum, line) => sum + line.quantity, 0);

    let alreadyDistributed = 0;

    return safeLines.map((line, index) => {
      const isLast = index === safeLines.length - 1;

      let totalTtc;

      if (isLast) {
        totalTtc = formatAmount(officialTotal - alreadyDistributed);
      } else if (catalogueTotal > 0) {
        totalTtc = formatAmount(officialTotal * (line.estimated_total_ttc / catalogueTotal));
      } else if (bottleTotal > 0) {
        totalTtc = formatAmount(officialTotal * (line.quantity / bottleTotal));
      } else {
        totalTtc = 0;
      }

      alreadyDistributed = formatAmount(alreadyDistributed + totalTtc);

      const unitTtc = line.quantity > 0
        ? formatAmount(totalTtc / line.quantity)
        : 0;

      return {
        ...line,
        official_total_ttc: totalTtc,
        official_total_ht: totalTtc,
        official_unit_ttc: unitTtc,
        official_unit_ht: unitTtc
      };
    });
  };

  const renderFormatControl = (product, label) => {
    if (!product) {
      return `
        <div class="stockGlassFormat isUnavailable">
          <div class="stockGlassFormatHead">
            <span>${escapeHtml(label)}</span>
          </div>

          <div class="stockGlassUnavailable">—</div>
        </div>
      `;
    }

    const qty = getQuantity(product.sku_id);
    const oldBadge = isOldOrHiddenProduct(product)
      ? `<small class="historiqueProductBadge">Ancien</small>`
      : "";

    return `
      <div class="stockGlassFormat ${isOldOrHiddenProduct(product) ? "isHistoricalProduct" : ""}">
        <div class="stockGlassFormatHead">
          <span>${escapeHtml(label)}</span>
          ${oldBadge}
        </div>

        <div class="stockGlassQtyControl">
          <button
            type="button"
            data-historique-pro-delta="-1"
            data-sku="${escapeAttr(product.sku_id)}"
            aria-label="Retirer une bouteille ${escapeAttr(label)} ${escapeAttr(product.parfum_code)}"
          >
            −
          </button>

          <input
            type="number"
            inputmode="numeric"
            min="0"
            step="1"
            value="${qty > 0 ? qty : ""}"
            placeholder="0"
            data-historique-pro-input="${escapeAttr(product.sku_id)}"
            aria-label="Quantité ${escapeAttr(label)} ${escapeAttr(product.parfum_code)}"
          />

          <button
            type="button"
            data-historique-pro-delta="1"
            data-sku="${escapeAttr(product.sku_id)}"
            aria-label="Ajouter une bouteille ${escapeAttr(label)} ${escapeAttr(product.parfum_code)}"
          >
            +
          </button>
        </div>
      </div>
    `;
  };

  const renderProducts = () => {
    if (!els.productRows) return;

    if (!state.dataLoaded && state.catalogue.length === 0) {
      els.productRows.innerHTML = `<p class="historiqueProEmpty">Chargement du catalogue…</p>`;
      return;
    }

    const groups = getGroupedCatalogue();

    if (groups.length === 0) {
      els.productRows.innerHTML = `<p class="historiqueProEmpty">Aucun produit catalogue trouvé.</p>`;
      return;
    }

    els.productRows.innerHTML = groups
      .map((group) => {
        const product50 = group.products.find((product) => product.format_cl === 50);
        const product20 = group.products.find((product) => product.format_cl === 20);
        const imageProduct = product50 || product20;
        const imageSrc = getProductImageSrc(imageProduct);

        return `
          <article
            class="stockVisualCard ${group.isHistoricalOnly ? "isHistoricalProductCard" : ""}"
            style="--stock-bg: url('${escapeAttr(imageSrc)}')"
          >
            <div class="stockVisualBg" aria-hidden="true"></div>
            <div class="stockVisualShade" aria-hidden="true"></div>

            <div class="stockVisualContent">
              <div class="stockVisualTitle">
                <strong>${escapeHtml(group.parfum_code)}</strong>
                <span>${escapeHtml(group.parfum_nom)}</span>
                ${
                  group.isHistoricalOnly
                    ? `<small class="historiqueProductLabel">Ancien parfum</small>`
                    : group.hasHistoricalVariant
                      ? `<small class="historiqueProductLabel">Format ancien disponible</small>`
                      : ""
                }
              </div>

              <div class="stockGlassPanel">
                ${renderFormatControl(product50, "50 cL")}
                ${renderFormatControl(product20, "20 cL")}
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const renderClients = () => {
    if (!els.clientSelect) return;

    const currentValue = els.clientSelect.value;

    const options = state.clients
      .filter((client) => getClientDisplayName(client))
      .sort((a, b) => getClientDisplayName(a).localeCompare(getClientDisplayName(b)))
      .map((client) => `
        <option value="${escapeAttr(client.client_id)}">
          ${escapeHtml(getClientDisplayName(client))}
        </option>
      `)
      .join("");

    els.clientSelect.innerHTML = `
      <option value="">Nouveau client ou saisie manuelle</option>
      ${options}
    `;

    if (currentValue) {
      els.clientSelect.value = currentValue;
    }
  };

  const renderTotals = () => {
    const invoiceAmount = getInvoiceAmount();
    const catalogueTotal = getCatalogueTotal();
    const bottleTotal = getBottleTotal();

    if (els.heroAmount) els.heroAmount.textContent = formatCurrency(invoiceAmount);
    if (els.heroBottles) els.heroBottles.textContent = String(bottleTotal);
    if (els.catalogueTotal) els.catalogueTotal.textContent = formatCurrency(catalogueTotal);
  };

  const fillClientFields = (client) => {
    if (!client) return;

    if (els.clientTypeInput) els.clientTypeInput.value = client.type_client || "caviste";
    if (els.clientStatusInput) els.clientStatusInput.value = client.statut || "client_actif";
    if (els.clientCommercialNameInput) els.clientCommercialNameInput.value = client.nom_commercial || "";
    if (els.clientLegalNameInput) els.clientLegalNameInput.value = client.raison_sociale || "";
    if (els.clientSiretInput) els.clientSiretInput.value = client.siret || "";
    if (els.clientEmailInput) els.clientEmailInput.value = client.email || "";
    if (els.clientAddressInput) els.clientAddressInput.value = client.adresse || "";
    if (els.clientZipInput) els.clientZipInput.value = client.code_postal || "";
    if (els.clientCityInput) els.clientCityInput.value = client.ville || "";
  };

  const selectQuantityInput = (input) => {
    if (!input) return;

    window.setTimeout(() => {
      try {
        input.select();
      } catch {
        // iOS peut ignorer select() sur certains inputs numériques.
      }
    }, 0);
  };

  const extractCoreTable = (coreData, keys = []) => {
    for (const key of keys) {
      if (Array.isArray(coreData?.[key])) {
        return coreData[key];
      }
    }

    return [];
  };

  const callCoreData = async (tables) => {
    if (!hasApi() || typeof api().getCoreData !== "function") return {};

    const tableParam = Array.isArray(tables)
      ? tables.join(",")
      : String(tables || "");

    const result = await api().getCoreData(tableParam);

    return result && typeof result === "object" ? result : {};
  };

  const loadClients = async () => {
    try {
      let rows = [];

      if (hasApi() && typeof api().getClients === "function") {
        rows = await api().getClients();
      }

      if (!Array.isArray(rows) || rows.length === 0) {
        const coreData = await callCoreData(["clients"]);
        rows = extractCoreTable(coreData, ["clients"]);
      }

      state.clients = toArray(rows)
        .map((row, index) => normalizeClient(row, index))
        .filter((client) => client.client_id && getClientDisplayName(client));

      writeJson(STORAGE_KEYS.clientsCache, state.clients);
    } catch {
      state.clients = readJson(STORAGE_KEYS.clientsCache, [])
        .map((row, index) => normalizeClient(row, index))
        .filter((client) => client.client_id && getClientDisplayName(client));
    }

    renderClients();
  };

  const loadCatalogue = async () => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    if (typeof api().getCatalogue !== "function") {
      throw new Error("LugdurumAPI.getCatalogue() est indisponible.");
    }

    if (typeof api().getOffresVente !== "function") {
      throw new Error("LugdurumAPI.getOffresVente() est indisponible.");
    }

    const [catalogueRows, offresRows] = await Promise.all([
      api().getCatalogue(),
      api().getOffresVente()
    ]);

    state.catalogue = toArray(catalogueRows)
      .map((row, index) => normalizeProduct(row, index))
      .filter((product) => product.sku_id && product.parfum_code && product.format_cl);

    state.offresVente = toArray(offresRows)
      .map((row, index) => normalizeOffer(row, index))
      .filter((offer) => offer.offre_id && offer.type_offre && offer.format_cl);

    state.dataLoaded = true;

    writeJson(STORAGE_KEYS.catalogueCache, state.catalogue);
    writeJson(STORAGE_KEYS.offresVenteCache, state.offresVente);
  };

  const loadLocalCatalogueFallback = () => {
    state.catalogue = readJson(STORAGE_KEYS.catalogueCache, [])
      .map((row, index) => normalizeProduct(row, index))
      .filter((product) => product.sku_id && product.parfum_code && product.format_cl);

    state.offresVente = readJson(STORAGE_KEYS.offresVenteCache, [])
      .map((row, index) => normalizeOffer(row, index))
      .filter((offer) => offer.offre_id && offer.type_offre && offer.format_cl);

    state.dataLoaded = true;
  };

  const validateForm = () => {
    if (!hasApi()) {
      setStatus("lugdurum-api.js n’est pas chargé.", "isError");
      return false;
    }

    if (typeof api().batchUpsert !== "function") {
      setStatus("LugdurumAPI.batchUpsert() est indisponible.", "isError");
      return false;
    }

    if (!cleanString(els.clientCommercialNameInput?.value)) {
      setStatus("Indique au moins le nom commercial du client.", "isError");
      return false;
    }

    if (!els.invoiceDateInput?.value) {
      setStatus("Indique la date de facture.", "isError");
      return false;
    }

    if (getInvoiceAmount() <= 0) {
      setStatus("Indique le montant facturé.", "isError");
      return false;
    }

    if (getBottleTotal() <= 0) {
      setStatus("Saisis au moins une quantité de bouteille.", "isError");
      return false;
    }

    return true;
  };

  const buildClientId = () => {
    const selected = getSelectedClient();

    if (selected?.client_id) {
      return selected.client_id;
    }

    const siret = cleanString(els.clientSiretInput?.value).replace(/\D/g, "");

    if (siret) {
      return `CL_${siret}`;
    }

    return `CL_${slugify(els.clientCommercialNameInput?.value, "CLIENT")}`;
  };

  const buildCommandeId = (clientId, invoiceAmount) => {
    const datePart = cleanString(els.invoiceDateInput?.value).replaceAll("-", "") || "00000000";
    const invoiceNumber = cleanString(els.invoiceNumberInput?.value);

    if (invoiceNumber) {
      return `CP_HIST_${datePart}_${slugify(invoiceNumber, "FACTURE")}`;
    }

    return `CP_HIST_${datePart}_${slugify(clientId, "CLIENT")}_${centsKey(invoiceAmount)}`;
  };

  const buildRows = () => {
    const existingClient = getSelectedClient();
    const timestamp = nowIso();
    const clientId = buildClientId();
    const invoiceAmount = getInvoiceAmount();
    const commandeId = buildCommandeId(clientId, invoiceAmount);

    const productDraftLines = getProductLinesDraft();
    const officialLines = distributeInvoiceAmountOnLines(productDraftLines, invoiceAmount);

    const invoiceDate = cleanString(els.invoiceDateInput?.value);
    const deliveryDate = cleanString(els.deliveryDateInput?.value || invoiceDate);
    const invoiceNumber = cleanString(els.invoiceNumberInput?.value);
    const paymentStatus = cleanString(els.paymentStatusInput?.value || "paye");
    const paymentMode = cleanString(els.paymentModeInput?.value || "VIR");
    const operationType = cleanString(els.operationTypeInput?.value || "commande_ferme");
    const orderNote = cleanString(els.orderNoteInput?.value);
    const siret = cleanString(els.clientSiretInput?.value);
    const siren = cleanString(deriveSirenFromSiret(siret));
    const clientName = cleanString(
      els.clientCommercialNameInput?.value ||
      els.clientLegalNameInput?.value
    );

    const client = {
      client_id: clientId,
      type_client: cleanString(els.clientTypeInput?.value || "caviste"),
      nom_commercial: clientName,
      raison_sociale: cleanString(els.clientLegalNameInput?.value),
      siren,
      siret,
      email: cleanString(els.clientEmailInput?.value),
      telephone: existingClient?.telephone || "",
      adresse: cleanString(els.clientAddressInput?.value),
      code_postal: cleanString(els.clientZipInput?.value),
      ville: cleanString(els.clientCityInput?.value),
      contact_nom: existingClient?.contact_nom || "",
      statut: cleanString(els.clientStatusInput?.value || "client_actif"),
      conditions_paiement: existingClient?.conditions_paiement || "",
      remise_habituelle: existingClient?.remise_habituelle || "",
      source_contact: existingClient?.source_contact || SOURCE,
      note: existingClient?.note || "",
      created_at: existingClient?.created_at || timestamp,
      updated_at: timestamp
    };

    const commande = {
      commande_id: commandeId,
      client_id: clientId,
      type_operation: operationType,
      date_commande: invoiceDate,
      date_livraison_prevue: deliveryDate,
      statut: "facturee",
      montant_total_ttc: invoiceAmount,
      montant_total_ht: invoiceAmount,
      taux_tva: 0,
      montant_tva: 0,
      mode_paiement: paymentMode,
      paiement_statut: paymentStatus,
      note: [
        orderNote,
        invoiceNumber ? `Facture historique : ${invoiceNumber}` : "",
        `Source : ${SOURCE}`
      ].filter(Boolean).join(" · "),
      created_at: timestamp,
      updated_at: timestamp
    };

    const lignes = officialLines.map((line) => {
      const lineId = `${commandeId}_${slugify(line.product.sku_id, "SKU")}`;

      return {
        commande_ligne_id: lineId,
        commande_id: commandeId,
        sku_id: line.product.sku_id,
        quantite: line.quantity,
        quantite_deposee: "",
        quantite_vendue: "",
        quantite_reprise: "",
        quantite_facturee: line.quantity,
        prix_unitaire_ttc: line.official_unit_ttc,
        prix_unitaire_ht: line.official_unit_ht,
        taux_tva: 0,
        total_ligne_ttc: line.official_total_ttc,
        total_ligne_ht: line.official_total_ht,
        note: [
          `${line.product.parfum_code} ${line.product.parfum_nom} ${line.product.format_cl} cL`,
          line.estimated_total_ttc
            ? `Catalogue estimé : ${formatCurrency(line.estimated_total_ttc)}`
            : "",
          "Montant ligne proratisé sur le montant facturé"
        ].filter(Boolean).join(" · "),
        created_at: timestamp,
        updated_at: timestamp
      };
    });

    const document = {
      document_id: `DOC_${commandeId}`,
      type_document: "facture",
      client_id: clientId,
      commande_id: commandeId,
      numero_document: invoiceNumber,
      date_document: invoiceDate,
      date_echeance: deliveryDate || invoiceDate,
      statut: paymentStatus === "paye" ? "payee" : "facture_creee",
      prestataire: "historique",
      prestataire_document_id: "",
      pdf_url: "",
      montant_ttc: invoiceAmount,
      montant_ht: invoiceAmount,
      taux_tva: 0,
      montant_tva: 0,
      email_envoye_at: "",
      prestataire_payload_json: JSON.stringify({
        source: SOURCE,
        saisie: "revenus.html"
      }),
      note: orderNote,
      created_at: timestamp,
      updated_at: timestamp
    };

    return {
      client,
      commande,
      lignes,
      document
    };
  };

  const saveHistoricalPro = async () => {
    if (state.isSaving) return;
    if (!validateForm()) return;

    const rows = buildRows();

    const operations = [
      {
        sheetName: "clients",
        keyField: "client_id",
        data: rows.client
      },
      {
        sheetName: "commandes_pro",
        keyField: "commande_id",
        data: rows.commande
      },
      {
        sheetName: "documents",
        keyField: "document_id",
        data: rows.document
      },
      ...rows.lignes.map((line) => ({
        sheetName: "commandes_pro_lignes",
        keyField: "commande_ligne_id",
        data: line
      }))
    ];

    setSaving(true);
    setStatus("Enregistrement de l’historique pro…");

    try {
      await api().batchUpsert(operations);

      const pendingCount =
        typeof api().getPendingWritesCount === "function"
          ? api().getPendingWritesCount()
          : 0;

      setStatus(
        pendingCount > 0
          ? `Historique pro enregistré en attente de synchronisation · ${pendingCount} écriture(s).`
          : "Historique pro enregistré.",
        pendingCount > 0 ? "isError" : "isSuccess"
      );

      if (pendingCount === 0) {
        resetFormAfterSave();
      }
    } catch (error) {
      setStatus(`Enregistrement impossible : ${error.message}`, "isError");
    } finally {
      setSaving(false);
    }
  };

  const resetFormAfterSave = () => {
    const previousDate = els.invoiceDateInput?.value || todayIso();

    if (els.form) {
      els.form.reset();
    }

    if (els.invoiceDateInput) els.invoiceDateInput.value = previousDate;
    if (els.deliveryDateInput) els.deliveryDateInput.value = previousDate;
    if (els.paymentStatusInput) els.paymentStatusInput.value = "paye";
    if (els.paymentModeInput) els.paymentModeInput.value = "VIR";
    if (els.operationTypeInput) els.operationTypeInput.value = "commande_ferme";
    if (els.clientTypeInput) els.clientTypeInput.value = "caviste";
    if (els.clientStatusInput) els.clientStatusInput.value = "client_actif";

    state.quantities = new Map();

    renderClients();
    renderProducts();
    renderTotals();
  };

  const bindEvents = () => {
    document.addEventListener("click", (event) => {
      const deltaButton = event.target.closest("[data-historique-pro-delta]");

      if (deltaButton) {
        const skuId = deltaButton.dataset.sku;
        const delta = toNumber(deltaButton.dataset.historiqueProDelta, 0);
        const current = getQuantity(skuId);

        setQuantity(skuId, current + delta);
        updateQuantityInput(skuId);
        setStatus("");
        renderTotals();
      }
    });

    document.addEventListener("focusin", (event) => {
      const quantityInput = event.target.closest?.("[data-historique-pro-input]");

      if (!quantityInput) return;

      selectQuantityInput(quantityInput);
    });

    document.addEventListener("pointerup", (event) => {
      const quantityInput = event.target.closest?.("[data-historique-pro-input]");

      if (!quantityInput) return;

      event.preventDefault();
      quantityInput.focus();
      selectQuantityInput(quantityInput);
    });

    document.addEventListener("input", (event) => {
      const quantityInput = event.target.closest("[data-historique-pro-input]");

      if (quantityInput) {
        setQuantity(quantityInput.dataset.historiqueProInput, quantityInput.value);
        setStatus("");
        renderTotals();
        return;
      }

      if (event.target === els.invoiceAmountInput) {
        setStatus("");
        renderTotals();
      }
    });

    if (els.clientSelect) {
      els.clientSelect.addEventListener("change", () => {
        const selectedClient = getSelectedClient();

        if (selectedClient) {
          fillClientFields(selectedClient);
        }
      });
    }

    if (els.clearProductsBtn) {
      els.clearProductsBtn.addEventListener("click", () => {
        state.quantities = new Map();
        updateAllQuantityInputs();
        setStatus("");
        renderTotals();
      });
    }

    if (els.reloadProductsBtn) {
      els.reloadProductsBtn.addEventListener("click", async () => {
        try {
          setStatus("Rechargement du catalogue…");
          await loadCatalogue();
          renderProducts();
          renderTotals();
          setStatus("Catalogue rechargé.", "isSuccess");
        } catch (error) {
          setStatus(`Rechargement impossible : ${error.message}`, "isError");
        }
      });
    }

    if (els.form) {
      els.form.addEventListener("submit", (event) => {
        event.preventDefault();
        saveHistoricalPro();
      });
    }

    window.addEventListener("lugdurum:sync-status", (event) => {
      const detail = event.detail || {};
      const pendingCount = Number(detail.pending_count || 0);

      if (pendingCount > 0) {
        setStatus(`${pendingCount} écriture(s) en attente de synchronisation.`, "isError");
      }
    });
  };

  const initDates = () => {
    const today = todayIso();

    if (els.invoiceDateInput && !els.invoiceDateInput.value) {
      els.invoiceDateInput.value = today;
    }

    if (els.deliveryDateInput && !els.deliveryDateInput.value) {
      els.deliveryDateInput.value = today;
    }
  };

  const init = async () => {
    initDates();
    bindEvents();
    renderTotals();

    try {
      setStatus("Chargement des clients…");
      await loadClients();
    } catch {
      renderClients();
    }

    try {
      setStatus("Chargement catalogue…");
      await loadCatalogue();
      setStatus("");
    } catch (error) {
      loadLocalCatalogueFallback();
      setStatus(`Catalogue local affiché : ${error.message}`, "isError");
    }

    renderClients();
    renderProducts();
    renderTotals();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();