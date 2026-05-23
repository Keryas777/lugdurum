(() => {
  "use strict";

  /*
    Dépôt-vente / réapprovisionnement V1
    - Client existant ou nouveau client.
    - Calcule le stock attendu depuis commandes_pro + commandes_lignes.
    - 50 cL suivis par SKU/parfum.
    - 20 cL en mode global mixte ou détaillé.
    - Réassort optionnel.
    - Enregistre via LugdurumAPI.batchUpsert().
    - Ne crée pas directement la facture prestataire.
  */

  const SOURCE = "DEPOT_VENTE_REAPPRO";
  const VIRTUAL_20_SKU = "VIRT_20CL_MIXTE";

  const STORAGE_KEYS = {
    catalogueCache: "lugdurum_catalogue_cache",
    offresVenteCache: "lugdurum_offres_vente_cache",
    clientsCache: "lugdurum_clients_cache",
    commandesProCache: "lugdurum_commandes_pro_cache",
    commandesLignesCache: "lugdurum_commandes_lignes_cache"
  };

  const state = {
    clients: [],
    catalogue: [],
    offresVente: [],
    commandesPro: [],
    commandesLignes: [],
    stockBySku: new Map(),
    stock50: new Map(),
    stock20: new Map(),
    reappro20Global: new Map(),
    mode20: "global",
    invoiceAmountTouched: false,
    isSaving: false,
    dataLoaded: false
  };

  const els = {
    form: document.getElementById("reapproForm"),

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

    operationDateInput: document.getElementById("operationDateInput"),
    deliveryDateInput: document.getElementById("deliveryDateInput"),
    paymentModeInput: document.getElementById("paymentModeInput"),
    paymentStatusInput: document.getElementById("paymentStatusInput"),
    operationNoteInput: document.getElementById("operationNoteInput"),

    reloadDataBtn: document.getElementById("reloadDataBtn"),
    resetStock50Btn: document.getElementById("resetStock50Btn"),

    mode20GlobalBtn: document.getElementById("mode20GlobalBtn"),
    mode20DetailBtn: document.getElementById("mode20DetailBtn"),
    mode20Hint: document.getElementById("mode20Hint"),
    global20Panel: document.getElementById("global20Panel"),
    detail20Panel: document.getElementById("detail20Panel"),

    global20ExpectedInput: document.getElementById("global20ExpectedInput"),
    global20RemainingInput: document.getElementById("global20RemainingInput"),
    global20ReturnInput: document.getElementById("global20ReturnInput"),
    global20SoldValue: document.getElementById("global20SoldValue"),

    productRows50: document.getElementById("productRows50"),
    productRows20: document.getElementById("productRows20"),
    reapproRows20Global: document.getElementById("reapproRows20Global"),

    catalogueTotal: document.getElementById("catalogueTotal"),
    invoiceAmountInput: document.getElementById("invoiceAmountInput"),
    summarySold: document.getElementById("summarySold"),
    summaryReappro: document.getElementById("summaryReappro"),
    heroInvoiceAmount: document.getElementById("heroInvoiceAmount"),
    heroSoldBottles: document.getElementById("heroSoldBottles"),
    heroReapproBottles: document.getElementById("heroReapproBottles"),

    saveReapproBtn: document.getElementById("saveReapproBtn"),
    reapproStatus: document.getElementById("reapproStatus")
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

  const cleanString = (value) => String(value ?? "").trim();

  const toArray = (value) => (Array.isArray(value) ? value : []);

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const escapeAttr = (value) =>
    escapeHtml(value).replaceAll("`", "&#096;");

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

  const formatAmount = (value) =>
    Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value || 0);

  const todayIso = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  };

  const nowIso = () => new Date().toISOString();

  const slugify = (value, fallback = "DEPOT") =>
    String(value || fallback)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 42) || fallback;

  const setStatus = (message, type = "") => {
    if (!els.reapproStatus) return;

    els.reapproStatus.textContent = message;
    els.reapproStatus.className = "reapproStatus";

    if (type) {
      els.reapproStatus.classList.add(type);
    }
  };

  const setSaving = (isSaving) => {
    state.isSaving = isSaving;

    [
      els.saveReapproBtn,
      els.reloadDataBtn,
      els.resetStock50Btn,
      els.mode20GlobalBtn,
      els.mode20DetailBtn
    ].forEach((button) => {
      if (button) button.disabled = isSaving;
    });
  };

  const getSelectedOperationType = () => {
    const checked = document.querySelector('input[name="operationType"]:checked');
    return cleanString(checked?.value || "depot_vente_complet");
  };

  const getSelectedClient = () => {
    const id = cleanString(els.clientSelect?.value);
    if (!id) return null;

    return state.clients.find((client) => cleanString(client.client_id) === id) || null;
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
    actif: Object.prototype.hasOwnProperty.call(raw, "actif")
      ? toBoolean(raw.actif, false)
      : true,
    ordre_affichage: toNumber(raw.ordre_affichage, 1000 + index),
    supplement_parfum_code: cleanString(raw.supplement_parfum_code).toUpperCase(),
    supplement_unitaire_ttc: toNumber(raw.supplement_unitaire_ttc, 0)
  });

  const normalizeCommande = (raw = {}) => ({
    ...raw,
    commande_id: cleanString(raw.commande_id),
    client_id: cleanString(raw.client_id),
    statut: cleanString(raw.statut)
  });

  const normalizeCommandeLigne = (raw = {}) => ({
    ...raw,
    commande_ligne_id: cleanString(raw.commande_ligne_id),
    commande_id: cleanString(raw.commande_id),
    sku_id: cleanString(raw.sku_id),
    quantite: toNumber(raw.quantite, 0),
    quantite_deposee: toNumber(raw.quantite_deposee, 0),
    quantite_vendue: toNumber(raw.quantite_vendue, 0),
    quantite_reprise: toNumber(raw.quantite_reprise, 0),
    quantite_facturee: toNumber(raw.quantite_facturee, 0)
  });

  const isValidStatus = (item) => {
    const statut = normalizeKey(item?.statut || item?.paiement_statut || "valide");

    return ![
      "annule",
      "annulee",
      "annule",
      "refuse",
      "refusee"
    ].includes(statut);
  };

  const getProductImageSrc = (product) =>
    cleanString(product?.image_src) ||
    `./assets/parfums/${cleanString(product?.parfum_code).toLowerCase()}.webp`;

  const getProductsByFormat = (formatCl) =>
    state.catalogue
      .filter((product) => product.format_cl === formatCl)
      .filter((product) => product.vendable_seul || product.composable_coffret)
      .sort((a, b) => {
        const byOrder = a.ordre_affichage - b.ordre_affichage;
        if (byOrder !== 0) return byOrder;

        return a.parfum_code.localeCompare(b.parfum_code);
      });

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

      return {
        ttc: baseUnitTtc,
        ht: baseUnitHt,
        offer
      };
    }

    return {
      ttc: 0,
      ht: 0,
      offer: null
    };
  };

  const getVirtual20Price = () => {
    const offer = findBoxOffer();

    if (!offer || !offer.quantite_bouteilles) {
      return {
        ttc: 0,
        ht: 0,
        offer: null
      };
    }

    return {
      ttc: offer.prix_ttc / offer.quantite_bouteilles,
      ht: offer.prix_ht / offer.quantite_bouteilles,
      offer
    };
  };

  const getStockRow = (map, skuId) => {
    if (!map.has(skuId)) {
      map.set(skuId, {
        expected: 0,
        remaining: 0,
        reappro: 0,
        returned: 0
      });
    }

    return map.get(skuId);
  };

  const getSoldFromRow = (row) =>
    Math.max(0, Math.floor(toNumber(row.expected, 0) - toNumber(row.remaining, 0)));

  const getNewStockFromRow = (row) =>
    Math.max(
      0,
      Math.floor(
        toNumber(row.remaining, 0) -
        toNumber(row.returned, 0) +
        toNumber(row.reappro, 0)
      )
    );

  const getGlobal20Expected = () =>
    Math.max(0, Math.floor(toNumber(els.global20ExpectedInput?.value, 0)));

  const getGlobal20Remaining = () =>
    Math.max(0, Math.floor(toNumber(els.global20RemainingInput?.value, 0)));

  const getGlobal20Returned = () =>
    Math.max(0, Math.floor(toNumber(els.global20ReturnInput?.value, 0)));

  const getGlobal20Sold = () =>
    Math.max(0, getGlobal20Expected() - getGlobal20Remaining());

  const getGlobal20Reappro = () =>
    [...state.reappro20Global.values()]
      .reduce((sum, value) => sum + Math.max(0, Math.floor(toNumber(value, 0))), 0);

  const getSelectedClientId = () => {
    const selected = getSelectedClient();

    if (selected?.client_id) return selected.client_id;

    const siret = cleanString(els.clientSiretInput?.value).replace(/\D/g, "");

    if (siret) return `CL_${siret}`;

    return `CL_${slugify(els.clientCommercialNameInput?.value, "CLIENT")}`;
  };

  const calculateStockForClient = (clientId) => {
    const stock = new Map();

    if (!clientId) return stock;

    const validCommandes = state.commandesPro
      .filter(isValidStatus)
      .filter((commande) => cleanString(commande.client_id) === clientId);

    const commandeIds = new Set(validCommandes.map((commande) => commande.commande_id));

    state.commandesLignes
      .filter((line) => commandeIds.has(line.commande_id))
      .filter((line) => line.sku_id)
      .forEach((line) => {
        const previous = toNumber(stock.get(line.sku_id), 0);
        const delta =
          toNumber(line.quantite_deposee, 0) -
          toNumber(line.quantite_vendue, 0) -
          toNumber(line.quantite_reprise, 0);

        stock.set(line.sku_id, previous + delta);
      });

    return stock;
  };

  const getCurrentStockForSku = (skuId) =>
    Math.max(0, Math.floor(toNumber(state.stockBySku.get(skuId), 0)));

  const getCurrentGlobal20Stock = () => {
    const product20Skus = new Set(getProductsByFormat(20).map((product) => product.sku_id));

    let total = 0;

    state.stockBySku.forEach((quantity, skuId) => {
      if (product20Skus.has(skuId) || skuId === VIRTUAL_20_SKU) {
        total += toNumber(quantity, 0);
      }
    });

    return Math.max(0, Math.floor(total));
  };

  const initializeStockMapsFromClient = () => {
    const clientId = getSelectedClientId();

    state.stockBySku = calculateStockForClient(clientId);
    state.stock50 = new Map();
    state.stock20 = new Map();
    state.reappro20Global = new Map();

    getProductsByFormat(50).forEach((product) => {
      const expected = getCurrentStockForSku(product.sku_id);

      state.stock50.set(product.sku_id, {
        expected,
        remaining: expected,
        reappro: 0,
        returned: 0
      });
    });

    getProductsByFormat(20).forEach((product) => {
      const expected = getCurrentStockForSku(product.sku_id);

      state.stock20.set(product.sku_id, {
        expected,
        remaining: expected,
        reappro: 0,
        returned: 0
      });

      state.reappro20Global.set(product.sku_id, 0);
    });

    const global20Expected = getCurrentGlobal20Stock();

    if (els.global20ExpectedInput) els.global20ExpectedInput.value = global20Expected > 0 ? String(global20Expected) : "";
    if (els.global20RemainingInput) els.global20RemainingInput.value = global20Expected > 0 ? String(global20Expected) : "";
    if (els.global20ReturnInput) els.global20ReturnInput.value = "";
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

  const renderStockCard = (product, map, namespace) => {
    const row = getStockRow(map, product.sku_id);
    const sold = getSoldFromRow(row);
    const newStock = getNewStockFromRow(row);
    const imageSrc = getProductImageSrc(product);

    return `
      <article
        class="reapproStockCard"
        data-stock-card="${escapeAttr(namespace)}"
        data-sku="${escapeAttr(product.sku_id)}"
      >
        <div class="reapproStockHead">
          <div
            class="reapproStockThumb"
            style="--product-bg: url('${escapeAttr(imageSrc)}')"
            aria-hidden="true"
          ></div>

          <div class="reapproStockTitle">
            <strong>${escapeHtml(product.parfum_code)}</strong>
            <span>${escapeHtml(product.parfum_nom)}</span>
          </div>

          <span class="formatBadge">${escapeHtml(product.format_cl)} cL</span>
        </div>

        <div class="reapproStockGrid">
          ${renderStockInput(product.sku_id, namespace, "expected", "Attendu", row.expected)}
          ${renderStockInput(product.sku_id, namespace, "remaining", "Restant", row.remaining)}
          ${renderStockInput(product.sku_id, namespace, "reappro", "Réassort", row.reappro)}
          ${renderStockInput(product.sku_id, namespace, "returned", "Reprise", row.returned)}
        </div>

        <div class="stockComputedLine">
          <article>
            <span>Vendu</span>
            <strong data-sold-value="${escapeAttr(namespace)}:${escapeAttr(product.sku_id)}">${sold}</strong>
          </article>

          <article>
            <span>Nouveau stock</span>
            <strong data-new-stock-value="${escapeAttr(namespace)}:${escapeAttr(product.sku_id)}">${newStock}</strong>
          </article>
        </div>
      </article>
    `;
  };

  const renderStockInput = (skuId, namespace, field, label, value) => `
    <label class="stockField">
      <span>${escapeHtml(label)}</span>
      <input
        type="number"
        inputmode="numeric"
        min="0"
        step="1"
        value="${toNumber(value, 0) > 0 ? String(toNumber(value, 0)) : ""}"
        placeholder="0"
        data-stock-input="${escapeAttr(namespace)}"
        data-sku="${escapeAttr(skuId)}"
        data-field="${escapeAttr(field)}"
        aria-label="${escapeAttr(label)} ${escapeAttr(skuId)}"
      />
    </label>
  `;

  const renderProducts50 = () => {
    if (!els.productRows50) return;

    const products = getProductsByFormat(50);

    if (!state.dataLoaded && products.length === 0) {
      els.productRows50.innerHTML = `<p class="reapproEmpty">Chargement du catalogue…</p>`;
      return;
    }

    if (products.length === 0) {
      els.productRows50.innerHTML = `<p class="reapproEmpty">Aucune bouteille 50 cL trouvée.</p>`;
      return;
    }

    els.productRows50.innerHTML = products
      .map((product) => renderStockCard(product, state.stock50, "stock50"))
      .join("");
  };

  const renderProducts20 = () => {
    if (!els.productRows20) return;

    const products = getProductsByFormat(20);

    if (!state.dataLoaded && products.length === 0) {
      els.productRows20.innerHTML = `<p class="reapproEmpty">Chargement des 20 cL…</p>`;
      return;
    }

    if (products.length === 0) {
      els.productRows20.innerHTML = `<p class="reapproEmpty">Aucune bouteille 20 cL trouvée.</p>`;
      return;
    }

    els.productRows20.innerHTML = products
      .map((product) => renderStockCard(product, state.stock20, "stock20"))
      .join("");
  };

  const renderReappro20GlobalRows = () => {
    if (!els.reapproRows20Global) return;

    const products = getProductsByFormat(20);

    if (products.length === 0) {
      els.reapproRows20Global.innerHTML = `<p class="reapproEmpty">Aucune bouteille 20 cL trouvée.</p>`;
      return;
    }

    els.reapproRows20Global.innerHTML = products
      .map((product) => {
        const imageSrc = getProductImageSrc(product);
        const quantity = toNumber(state.reappro20Global.get(product.sku_id), 0);

        return `
          <article class="reapproMiniCard">
            <div
              class="reapproMiniThumb"
              style="--product-bg: url('${escapeAttr(imageSrc)}')"
              aria-hidden="true"
            ></div>

            <div class="reapproMiniTitle">
              <strong>${escapeHtml(product.parfum_code)}</strong>
              <span>${escapeHtml(product.parfum_nom)}</span>
            </div>

            <input
              type="number"
              inputmode="numeric"
              min="0"
              step="1"
              value="${quantity > 0 ? String(quantity) : ""}"
              placeholder="0"
              data-global-20-reappro="${escapeAttr(product.sku_id)}"
              aria-label="Réassort 20 cL ${escapeAttr(product.parfum_code)}"
            />
          </article>
        `;
      })
      .join("");
  };

  const setMode20 = (mode) => {
    state.mode20 = mode === "detail" ? "detail" : "global";

    els.mode20GlobalBtn?.classList.toggle("isActive", state.mode20 === "global");
    els.mode20DetailBtn?.classList.toggle("isActive", state.mode20 === "detail");

    if (els.global20Panel) els.global20Panel.hidden = state.mode20 !== "global";
    if (els.detail20Panel) els.detail20Panel.hidden = state.mode20 !== "detail";

    if (els.mode20Hint) {
      els.mode20Hint.textContent = state.mode20 === "global"
        ? "Les ventes 20 cL seront enregistrées en “20 cL mixte” et ne seront pas attribuées à un parfum."
        : "Les ventes 20 cL seront attribuées aux parfums saisis, seulement si le détail est connu.";
    }

    renderTotals();
  };

  const updateComputedForSku = (namespace, skuId) => {
    const map = namespace === "stock20" ? state.stock20 : state.stock50;
    const row = getStockRow(map, skuId);

    document
      .querySelectorAll(`[data-sold-value="${CSS.escape(`${namespace}:${skuId}`)}"]`)
      .forEach((element) => {
        element.textContent = String(getSoldFromRow(row));
      });

    document
      .querySelectorAll(`[data-new-stock-value="${CSS.escape(`${namespace}:${skuId}`)}"]`)
      .forEach((element) => {
        element.textContent = String(getNewStockFromRow(row));
      });
  };

  const getLineDrafts = () => {
    const drafts = [];

    state.stock50.forEach((row, skuId) => {
      const product = state.catalogue.find((item) => item.sku_id === skuId);
      if (!product) return;

      const sold = getSoldFromRow(row);
      const reappro = Math.max(0, Math.floor(toNumber(row.reappro, 0)));
      const returned = Math.max(0, Math.floor(toNumber(row.returned, 0)));

      if (sold <= 0 && reappro <= 0 && returned <= 0) return;

      const price = getEstimatedUnitPriceForProduct(product);

      drafts.push({
        sku_id: skuId,
        product,
        label: `${product.parfum_code} ${product.parfum_nom} ${product.format_cl} cL`,
        format_cl: product.format_cl,
        sold,
        reappro,
        returned,
        estimated_unit_ttc: price.ttc,
        estimated_unit_ht: price.ht,
        estimated_total_ttc: formatAmount(sold * price.ttc),
        estimated_total_ht: formatAmount(sold * price.ht),
        offer: price.offer,
        virtual: false
      });
    });

    if (state.mode20 === "detail") {
      state.stock20.forEach((row, skuId) => {
        const product = state.catalogue.find((item) => item.sku_id === skuId);
        if (!product) return;

        const sold = getSoldFromRow(row);
        const reappro = Math.max(0, Math.floor(toNumber(row.reappro, 0)));
        const returned = Math.max(0, Math.floor(toNumber(row.returned, 0)));

        if (sold <= 0 && reappro <= 0 && returned <= 0) return;

        const price = getEstimatedUnitPriceForProduct(product);

        drafts.push({
          sku_id: skuId,
          product,
          label: `${product.parfum_code} ${product.parfum_nom} ${product.format_cl} cL`,
          format_cl: product.format_cl,
          sold,
          reappro,
          returned,
          estimated_unit_ttc: price.ttc,
          estimated_unit_ht: price.ht,
          estimated_total_ttc: formatAmount(sold * price.ttc),
          estimated_total_ht: formatAmount(sold * price.ht),
          offer: price.offer,
          virtual: false
        });
      });
    } else {
      const sold = getGlobal20Sold();
      const returned = getGlobal20Returned();
      const price = getVirtual20Price();

      if (sold > 0 || returned > 0) {
        drafts.push({
          sku_id: VIRTUAL_20_SKU,
          product: null,
          label: "20 cL mixte — détail parfum non communiqué",
          format_cl: 20,
          sold,
          reappro: 0,
          returned,
          estimated_unit_ttc: price.ttc,
          estimated_unit_ht: price.ht,
          estimated_total_ttc: formatAmount(sold * price.ttc),
          estimated_total_ht: formatAmount(sold * price.ht),
          offer: price.offer,
          virtual: true
        });
      }

      state.reappro20Global.forEach((quantity, skuId) => {
        const reappro = Math.max(0, Math.floor(toNumber(quantity, 0)));
        if (reappro <= 0) return;

        const product = state.catalogue.find((item) => item.sku_id === skuId);
        if (!product) return;

        const price = getEstimatedUnitPriceForProduct(product);

        drafts.push({
          sku_id: skuId,
          product,
          label: `${product.parfum_code} ${product.parfum_nom} ${product.format_cl} cL`,
          format_cl: product.format_cl,
          sold: 0,
          reappro,
          returned: 0,
          estimated_unit_ttc: price.ttc,
          estimated_unit_ht: price.ht,
          estimated_total_ttc: 0,
          estimated_total_ht: 0,
          offer: price.offer,
          virtual: false
        });
      });
    }

    return drafts;
  };

  const getCatalogueTotal = () =>
    formatAmount(getLineDrafts().reduce((sum, line) => sum + line.estimated_total_ttc, 0));

  const getSoldTotal = () =>
    getLineDrafts().reduce((sum, line) => sum + toNumber(line.sold, 0), 0);

  const getReapproTotal = () =>
    getLineDrafts().reduce((sum, line) => sum + toNumber(line.reappro, 0), 0);

  const getInvoiceAmount = () =>
    formatAmount(toNumber(els.invoiceAmountInput?.value, 0));

  const syncInvoiceAmountIfNeeded = () => {
    if (state.invoiceAmountTouched) return;
    if (!els.invoiceAmountInput) return;

    const catalogueTotal = getCatalogueTotal();
    els.invoiceAmountInput.value = catalogueTotal > 0 ? String(catalogueTotal) : "";
  };

  const renderTotals = () => {
    const global20Sold = getGlobal20Sold();

    if (els.global20SoldValue) {
      els.global20SoldValue.textContent = String(global20Sold);
    }

    syncInvoiceAmountIfNeeded();

    const catalogueTotal = getCatalogueTotal();
    const invoiceAmount = getInvoiceAmount();
    const soldTotal = getSoldTotal();
    const reapproTotal = getReapproTotal();

    if (els.catalogueTotal) els.catalogueTotal.textContent = formatCurrency(catalogueTotal);
    if (els.heroInvoiceAmount) els.heroInvoiceAmount.textContent = formatCurrency(invoiceAmount);
    if (els.heroSoldBottles) els.heroSoldBottles.textContent = String(soldTotal);
    if (els.heroReapproBottles) els.heroReapproBottles.textContent = String(reapproTotal);
    if (els.summarySold) els.summarySold.textContent = `${soldTotal} bouteille${soldTotal > 1 ? "s" : ""}`;
    if (els.summaryReappro) els.summaryReappro.textContent = `${reapproTotal} bouteille${reapproTotal > 1 ? "s" : ""}`;
  };

  const renderAllProducts = () => {
    renderProducts50();
    renderProducts20();
    renderReappro20GlobalRows();
    renderTotals();
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
      : cleanString(tables);

    const result = await api().getCoreData(tableParam);

    return result && typeof result === "object" ? result : {};
  };

  const loadRemoteData = async () => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    const coreData = await callCoreData([
      "clients",
      "commandesPro",
      "commandesLignes"
    ]);

    const clientsRows =
      extractCoreTable(coreData, ["clients"]);

    const commandesRows =
      extractCoreTable(coreData, ["commandesPro", "commandes_pro"]);

    const lignesRows =
      extractCoreTable(coreData, ["commandesLignes", "commandes_lignes", "commandes_pro_lignes"]);

    const [catalogueRows, offresRows] = await Promise.all([
      typeof api().getCatalogue === "function" ? api().getCatalogue() : [],
      typeof api().getOffresVente === "function" ? api().getOffresVente() : []
    ]);

    state.clients = toArray(clientsRows)
      .map((row, index) => normalizeClient(row, index))
      .filter((client) => client.client_id && getClientDisplayName(client));

    state.commandesPro = toArray(commandesRows)
      .map(normalizeCommande)
      .filter((commande) => commande.commande_id);

    state.commandesLignes = toArray(lignesRows)
      .map(normalizeCommandeLigne)
      .filter((line) => line.commande_id && line.sku_id);

    state.catalogue = toArray(catalogueRows)
      .map((row, index) => normalizeProduct(row, index))
      .filter((product) => product.sku_id && product.parfum_code && product.format_cl);

    state.offresVente = toArray(offresRows)
      .map((row, index) => normalizeOffer(row, index))
      .filter((offer) => offer.offre_id && offer.type_offre && offer.format_cl);

    state.dataLoaded = true;

    writeJson(STORAGE_KEYS.clientsCache, state.clients);
    writeJson(STORAGE_KEYS.commandesProCache, state.commandesPro);
    writeJson(STORAGE_KEYS.commandesLignesCache, state.commandesLignes);
    writeJson(STORAGE_KEYS.catalogueCache, state.catalogue);
    writeJson(STORAGE_KEYS.offresVenteCache, state.offresVente);
  };

  const loadLocalFallback = () => {
    state.clients = readJson(STORAGE_KEYS.clientsCache, [])
      .map((row, index) => normalizeClient(row, index))
      .filter((client) => client.client_id && getClientDisplayName(client));

    state.commandesPro = readJson(STORAGE_KEYS.commandesProCache, [])
      .map(normalizeCommande)
      .filter((commande) => commande.commande_id);

    state.commandesLignes = readJson(STORAGE_KEYS.commandesLignesCache, [])
      .map(normalizeCommandeLigne)
      .filter((line) => line.commande_id && line.sku_id);

    state.catalogue = readJson(STORAGE_KEYS.catalogueCache, [])
      .map((row, index) => normalizeProduct(row, index))
      .filter((product) => product.sku_id && product.parfum_code && product.format_cl);

    state.offresVente = readJson(STORAGE_KEYS.offresVenteCache, [])
      .map((row, index) => normalizeOffer(row, index))
      .filter((offer) => offer.offre_id && offer.type_offre && offer.format_cl);

    state.dataLoaded = true;
  };

  const refreshClientStock = () => {
    initializeStockMapsFromClient();
    renderAllProducts();
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

    if (!cleanString(els.operationDateInput?.value)) {
      setStatus("Indique la date du relevé.", "isError");
      return false;
    }

    if (state.mode20 === "global" && getGlobal20Returned() > getGlobal20Remaining()) {
      setStatus("Sur les 20 cL globales, la reprise ne peut pas dépasser le stock restant.", "isError");
      return false;
    }

    for (const [skuId, row] of [...state.stock50.entries(), ...state.stock20.entries()]) {
      if (toNumber(row.returned, 0) > toNumber(row.remaining, 0)) {
        setStatus(`Reprise impossible sur ${skuId} : elle dépasse le stock restant.`, "isError");
        return false;
      }
    }

    const soldTotal = getSoldTotal();
    const reapproTotal = getReapproTotal();

    if (soldTotal <= 0 && reapproTotal <= 0) {
      setStatus("Aucune vente ni aucun réassort à enregistrer.", "isError");
      return false;
    }

    if (soldTotal > 0 && getInvoiceAmount() <= 0) {
      setStatus("Des ventes sont détectées : indique le montant à facturer.", "isError");
      return false;
    }

    return true;
  };

  const distributeInvoiceAmountOnSoldLines = (lines, invoiceAmount) => {
    const soldLines = lines.filter((line) => toNumber(line.sold, 0) > 0);
    const officialTotal = formatAmount(invoiceAmount);

    if (soldLines.length === 0) return lines;

    const catalogueTotal = formatAmount(
      soldLines.reduce((sum, line) => sum + line.estimated_total_ttc, 0)
    );

    const soldQuantityTotal = soldLines.reduce((sum, line) => sum + line.sold, 0);

    let alreadyDistributed = 0;
    const bySku = new Map();

    soldLines.forEach((line, index) => {
      const isLast = index === soldLines.length - 1;

      let totalTtc;

      if (isLast) {
        totalTtc = formatAmount(officialTotal - alreadyDistributed);
      } else if (catalogueTotal > 0) {
        totalTtc = formatAmount(officialTotal * (line.estimated_total_ttc / catalogueTotal));
      } else if (soldQuantityTotal > 0) {
        totalTtc = formatAmount(officialTotal * (line.sold / soldQuantityTotal));
      } else {
        totalTtc = 0;
      }

      alreadyDistributed = formatAmount(alreadyDistributed + totalTtc);

      bySku.set(line.sku_id, {
        total_ttc: totalTtc,
        total_ht: totalTtc,
        unit_ttc: line.sold > 0 ? formatAmount(totalTtc / line.sold) : 0,
        unit_ht: line.sold > 0 ? formatAmount(totalTtc / line.sold) : 0
      });
    });

    return lines.map((line) => {
      const distributed = bySku.get(line.sku_id);

      if (!distributed) {
        return {
          ...line,
          official_total_ttc: 0,
          official_total_ht: 0,
          official_unit_ttc: 0,
          official_unit_ht: 0
        };
      }

      return {
        ...line,
        official_total_ttc: distributed.total_ttc,
        official_total_ht: distributed.total_ht,
        official_unit_ttc: distributed.unit_ttc,
        official_unit_ht: distributed.unit_ht
      };
    });
  };

  const buildClientRow = (clientId, timestamp) => {
    const existing = getSelectedClient();
    const siret = cleanString(els.clientSiretInput?.value);
    const siren = deriveSirenFromSiret(siret);
    const clientName = cleanString(
      els.clientCommercialNameInput?.value ||
      els.clientLegalNameInput?.value
    );

    return {
      client_id: clientId,
      type_client: cleanString(els.clientTypeInput?.value || "caviste"),
      nom_commercial: clientName,
      raison_sociale: cleanString(els.clientLegalNameInput?.value),
      siren,
      siret,
      email: cleanString(els.clientEmailInput?.value),
      telephone: existing?.telephone || "",
      adresse: cleanString(els.clientAddressInput?.value),
      code_postal: cleanString(els.clientZipInput?.value),
      ville: cleanString(els.clientCityInput?.value),
      contact_nom: existing?.contact_nom || "",
      statut: cleanString(els.clientStatusInput?.value || "client_actif"),
      conditions_paiement: existing?.conditions_paiement || "",
      remise_habituelle: existing?.remise_habituelle || "",
      source_contact: existing?.source_contact || SOURCE,
      note: existing?.note || "",
      created_at: existing?.created_at || timestamp,
      updated_at: timestamp
    };
  };

  const buildRows = () => {
    const timestamp = nowIso();
    const clientId = getSelectedClientId();
    const operationDate = cleanString(els.operationDateInput?.value);
    const deliveryDate = cleanString(els.deliveryDateInput?.value || operationDate);
    const operationType = getSelectedOperationType();
    const invoiceAmount = getInvoiceAmount();
    const soldTotal = getSoldTotal();
    const reapproTotal = getReapproTotal();
    const commandeId = `CP_DEPOT_${operationDate.replaceAll("-", "")}_${slugify(clientId, "CLIENT")}_${Date.now()}`;

    const client = buildClientRow(clientId, timestamp);

    const rawLines = getLineDrafts();
    const officialLines = distributeInvoiceAmountOnSoldLines(rawLines, invoiceAmount);

    const commande = {
      commande_id: commandeId,
      client_id: clientId,
      type_operation: operationType,
      date_commande: operationDate,
      date_livraison_prevue: deliveryDate,
      statut: soldTotal > 0 ? "a_facturer" : "stock_mis_a_jour",
      montant_total_ttc: invoiceAmount,
      montant_total_ht: invoiceAmount,
      taux_tva: 0,
      montant_tva: 0,
      mode_paiement: cleanString(els.paymentModeInput?.value || "VIR"),
      paiement_statut: cleanString(els.paymentStatusInput?.value || "a_regler"),
      note: [
        cleanString(els.operationNoteInput?.value),
        state.mode20 === "global"
          ? "20 cL vendues enregistrées en mixte sans détail parfum"
          : "",
        `Vendu : ${soldTotal}`,
        `Réassort : ${reapproTotal}`
      ].filter(Boolean).join(" · "),
      created_at: timestamp,
      updated_at: timestamp
    };

    const lignes = officialLines.map((line) => ({
      commande_ligne_id: `${commandeId}_${slugify(line.sku_id, "SKU")}`,
      commande_id: commandeId,
      sku_id: line.sku_id,
      quantite:
        toNumber(line.sold, 0) +
        toNumber(line.reappro, 0) +
        toNumber(line.returned, 0),
      quantite_deposee: toNumber(line.reappro, 0),
      quantite_vendue: toNumber(line.sold, 0),
      quantite_reprise: toNumber(line.returned, 0),
      quantite_facturee: toNumber(line.sold, 0),
      prix_unitaire_ttc: line.official_unit_ttc || 0,
      prix_unitaire_ht: line.official_unit_ht || 0,
      taux_tva: 0,
      total_ligne_ttc: line.official_total_ttc || 0,
      total_ligne_ht: line.official_total_ht || 0,
      note: [
        line.label,
        line.virtual ? "Vente 20 cL mixte sans détail parfum" : "",
        line.estimated_total_ttc
          ? `Catalogue estimé : ${formatCurrency(line.estimated_total_ttc)}`
          : "",
        line.sold > 0 ? "Montant ligne proratisé sur le montant à facturer" : ""
      ].filter(Boolean).join(" · "),
      created_at: timestamp,
      updated_at: timestamp
    }));

    const document = soldTotal > 0
      ? {
          document_id: `DOC_${commandeId}`,
          type_document: "facture",
          client_id: clientId,
          commande_id: commandeId,
          numero_document: "",
          date_document: operationDate,
          date_echeance: deliveryDate,
          statut: "facture_a_creer",
          prestataire: "",
          prestataire_document_id: "",
          pdf_url: "",
          montant_ttc: invoiceAmount,
          montant_ht: invoiceAmount,
          taux_tva: 0,
          montant_tva: 0,
          email_envoye_at: "",
          prestataire_payload_json: JSON.stringify({
            source: SOURCE,
            page: "reapprovisionnement-facture.html",
            mode20: state.mode20
          }),
          note: "Document à créer depuis le détail de la commande dépôt-vente.",
          created_at: timestamp,
          updated_at: timestamp
        }
      : null;

    return {
      client,
      commande,
      lignes,
      document
    };
  };

  const saveReappro = async () => {
    if (state.isSaving) return;
    if (!validateForm()) return;

    const rows = buildRows();

    const operations = [
      {
        sheetKey: "clients",
        data: rows.client
      },
      {
        sheetKey: "commandesPro",
        data: rows.commande
      },
      ...rows.lignes.map((line) => ({
        sheetKey: "commandesLignes",
        data: line
      }))
    ];

    if (rows.document) {
      operations.push({
        sheetKey: "documents",
        data: rows.document
      });
    }

    setSaving(true);
    setStatus("Enregistrement du dépôt-vente…");

    try {
      await api().batchUpsert(operations);

      const pendingCount =
        typeof api().getPendingWritesCount === "function"
          ? api().getPendingWritesCount()
          : 0;

      setStatus(
        pendingCount > 0
          ? `Dépôt-vente enregistré en attente de synchronisation · ${pendingCount} écriture(s).`
          : "Dépôt-vente enregistré. La facture pourra être créée depuis le détail.",
        pendingCount > 0 ? "isError" : "isSuccess"
      );

      if (pendingCount === 0) {
        await loadAndRenderFreshData(false);
      }
    } catch (error) {
      setStatus(`Enregistrement impossible : ${error.message}`, "isError");
    } finally {
      setSaving(false);
    }
  };

  const loadAndRenderFreshData = async (showStatus = true) => {
    try {
      if (showStatus) setStatus("Chargement des données…");
      await loadRemoteData();
      renderClients();
      refreshClientStock();
      if (showStatus) setStatus("");
    } catch (error) {
      loadLocalFallback();
      renderClients();
      refreshClientStock();
      setStatus(`Données locales affichées : ${error.message}`, "isError");
    }
  };

  const initDates = () => {
    const today = todayIso();

    if (els.operationDateInput && !els.operationDateInput.value) {
      els.operationDateInput.value = today;
    }

    if (els.deliveryDateInput && !els.deliveryDateInput.value) {
      els.deliveryDateInput.value = today;
    }
  };

  const bindEvents = () => {
    if (els.clientSelect) {
      els.clientSelect.addEventListener("change", () => {
        const selected = getSelectedClient();

        if (selected) {
          fillClientFields(selected);
        }

        state.invoiceAmountTouched = false;
        refreshClientStock();
        setStatus("");
      });
    }

    [
      els.clientCommercialNameInput,
      els.clientSiretInput
    ].forEach((input) => {
      input?.addEventListener("change", () => {
        if (!getSelectedClient()) {
          state.invoiceAmountTouched = false;
          refreshClientStock();
        }
      });
    });

    document.addEventListener("change", (event) => {
      if (event.target.matches('input[name="operationType"]')) {
        renderTotals();
      }
    });

    document.addEventListener("input", (event) => {
      const stockInput = event.target.closest("[data-stock-input]");

      if (stockInput) {
        const namespace = stockInput.dataset.stockInput;
        const skuId = stockInput.dataset.sku;
        const field = stockInput.dataset.field;
        const map = namespace === "stock20" ? state.stock20 : state.stock50;
        const row = getStockRow(map, skuId);

        row[field] = Math.max(0, Math.floor(toNumber(stockInput.value, 0)));

        state.invoiceAmountTouched = false;
        updateComputedForSku(namespace, skuId);
        setStatus("");
        renderTotals();
        return;
      }

      const reappro20Input = event.target.closest("[data-global-20-reappro]");

      if (reappro20Input) {
        const skuId = reappro20Input.dataset.global20Reappro;
        state.reappro20Global.set(
          skuId,
          Math.max(0, Math.floor(toNumber(reappro20Input.value, 0)))
        );

        state.invoiceAmountTouched = false;
        setStatus("");
        renderTotals();
        return;
      }

      if (
        event.target === els.global20ExpectedInput ||
        event.target === els.global20RemainingInput ||
        event.target === els.global20ReturnInput
      ) {
        state.invoiceAmountTouched = false;
        setStatus("");
        renderTotals();
        return;
      }

      if (event.target === els.invoiceAmountInput) {
        state.invoiceAmountTouched = true;
        setStatus("");
        renderTotals();
      }
    });

    els.mode20GlobalBtn?.addEventListener("click", () => {
      state.invoiceAmountTouched = false;
      setMode20("global");
    });

    els.mode20DetailBtn?.addEventListener("click", () => {
      state.invoiceAmountTouched = false;
      setMode20("detail");
    });

    els.resetStock50Btn?.addEventListener("click", () => {
      state.invoiceAmountTouched = false;
      refreshClientStock();
      setStatus("Stock réinitialisé depuis l’historique client.");
    });

    els.reloadDataBtn?.addEventListener("click", async () => {
      await loadAndRenderFreshData(true);
    });

    els.form?.addEventListener("submit", (event) => {
      event.preventDefault();
      saveReappro();
    });

    window.addEventListener("lugdurum:sync-status", (event) => {
      const pendingCount = Number(event.detail?.pending_count || 0);

      if (pendingCount > 0) {
        setStatus(`${pendingCount} écriture(s) en attente de synchronisation.`, "isError");
      }
    });
  };

  const init = async () => {
    initDates();
    bindEvents();
    renderTotals();

    await loadAndRenderFreshData(true);
    setMode20("global");
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
