(() => {
  "use strict";

  /*
    Vente rapide V18 :
    - Catalogue chargé depuis Google Sheets via lugdurum-api.js.
    - Offres de vente chargées depuis Google Sheets via lugdurum-api.js.
    - Fallback cache localStorage conservé uniquement pour catalogue / offres.
    - Contexte journée lu depuis lugdurum_preparation_context / active ids.
    - Aucun fallback de test : aucune vente possible sans mission_id + journee_id.
    - Enregistrement des tickets via LugdurumAPI.saveTransaction().
    - Écriture complémentaire des sorties de stock dans mouvements_stock.
    - CA jour affiché en haut :
      lecture réseau uniquement via getTransactions().
      aucun calcul depuis lugdurum_transactions_backup ou cache local.
    - Total ticket affiché uniquement dans le panier.
    - La file d’attente offline est gérée dans lugdurum-api.js.
    - SumUp V1 :
      - CB → bouton “Encaisser avec SumUp”.
      - Ouverture app SumUp via Payment Switch.
      - Retour manuel → popup de confirmation.
      - Ticket enregistré seulement après confirmation verte.
  */

  const EMPTY_JOURNEE_ACTIVE = {
    journee_id: "",
    mission_id: "",
    label: "Aucune journée active",
    date_label: "Retourne dans Missions ou Préparation stock pour démarrer une journée.",
    user_id: "U_JEROME",
    vendeur: "Jérôme"
  };

  const SHEETS = {
    mouvementsStock: "mouvements_stock"
  };

  const MOVEMENT_TYPE = {
    VENTE: "vente"
  };

  const MOVEMENT_SENS = {
    SORTIE: "SORTIE"
  };

  const SUMUP_CONFIG = {
    affiliateKey: "sup_afk_XKnrqZNyKlv6T1c29eBSYdrco9uwKz0j",
    currency: "EUR",
    titlePrefix: "Lugdurum",
    callbackEnabled: false
  };

  const SALE_MODES = {
    BOTTLE_50: {
      label: "50 cL",
      kind: "bottle",
      format_cl: 50
    },
    BOX_3_20: {
      label: "Coffret 3×20 cL",
      kind: "box",
      format_cl: 20,
      box_size: 3,
      offer_id: "COFFRET_3_20"
    },
    BOX_6_20: {
      label: "Coffret 6×20 cL",
      kind: "box",
      format_cl: 20,
      box_size: 6,
      offer_id: "COFFRET_6_20"
    }
  };

  const STORAGE_KEYS = {
    preparationContext: "lugdurum_preparation_context",
    activeMissionId: "lugdurum_active_mission_id",
    activeStockMissionId: "lugdurum_active_stock_mission_id",
    activeJourneeId: "lugdurum_active_journee_id",
    lastTicket: "lugdurum_last_ticket",
    localTransactionsBackup: "lugdurum_transactions_backup",
    catalogueCache: "lugdurum_catalogue_cache",
    offresVenteCache: "lugdurum_offres_vente_cache",
    mouvementsStock: "lugdurum_mouvements_stock",
    sumupPending: "lugdurum_pending_sumup_ticket",
    sumupAffiliateKey: "lugdurum_sumup_affiliate_key"
  };

  const state = {
    selectedMode: "BOTTLE_50",
    paymentMode: "ESP",
    ticketItems: [],
    draftPack: [],
    amountManuallyEdited: false,
    catalogue: [],
    offresVente: [],
    missionsStock: [],
    journees: [],
    mouvementsStock: [],
    dataLoaded: false,
    contextLoaded: false,
    journeeActive: { ...EMPTY_JOURNEE_ACTIVE },
    daySummary: {
      isLoading: false,
      isLoaded: false,
      revenue: 0,
      tickets: 0,
      lastLoadedAt: "",
      lastError: ""
    }
  };

  const els = {
    productGrid: document.getElementById("productGrid"),
    ticketLines: document.getElementById("ticketLines"),
    ticketTotal: document.getElementById("ticketTotal"),
    ticketPanelTotal: document.getElementById("ticketPanelTotal"),
    dayRevenueTotal: document.getElementById("dayRevenueTotal"),
    dayTicketCount: document.getElementById("dayTicketCount"),
    saleSummaryTitle: document.getElementById("saleSummaryTitle"),
    missionMeta: document.querySelector(".saleSummary .missionMeta"),
    packComposer: document.getElementById("packComposer"),
    packProgressLabel: document.getElementById("packProgressLabel"),
    packPricePreview: document.getElementById("packPricePreview"),
    packProgressBar: document.getElementById("packProgressBar"),
    draftPackList: document.getElementById("draftPackList"),
    clearDraftPackBtn: document.getElementById("clearDraftPackBtn"),
    addPackBtn: document.getElementById("addPackBtn"),
    clearTicketBtn: document.getElementById("clearTicketBtn"),
    undoBtn: document.getElementById("undoBtn"),
    saveTicketBtn: document.getElementById("saveTicketBtn"),
    amountPaidInput: document.getElementById("amountPaidInput"),
    saveStatus: document.getElementById("saveStatus"),

    sumupConfirmOverlay: document.getElementById("sumupConfirmOverlay"),
    sumupConfirmText: document.getElementById("sumupConfirmText"),
    sumupPendingAmount: document.getElementById("sumupPendingAmount"),
    sumupPendingReference: document.getElementById("sumupPendingReference"),
    sumupConfirmSuccessBtn: document.getElementById("sumupConfirmSuccessBtn"),
    sumupConfirmFailBtn: document.getElementById("sumupConfirmFailBtn"),
    sumupReturnBtn: document.getElementById("sumupReturnBtn")
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
    localStorage.setItem(key, JSON.stringify(value));
  };

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value || 0);

  const formatAmount = (value) =>
    Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;

  const formatAmountInput = (value) =>
    (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const escapeAttr = (value) =>
    escapeHtml(value).replaceAll("`", "&#096;");

  const normalizeKey = (value) =>
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

  const toBoolean = (value, fallback = false) => {
    if (value === true) return true;
    if (value === false) return false;
    if (typeof value === "number") return value !== 0;

    const normalized = String(value ?? "")
      .trim()
      .toLowerCase();

    if (!normalized) return fallback;

    if (["true", "vrai", "oui", "yes", "1", "x", "actif"].includes(normalized)) return true;
    if (["false", "faux", "non", "no", "0", "inactif"].includes(normalized)) return false;

    return fallback;
  };

  const parseLocalDate = (value) => {
    if (!value) return null;

    const [year, month, day] = String(value).split("-").map(Number);

    if (!year || !month || !day) return null;

    return new Date(year, month - 1, day);
  };

  const formatDisplayDateLong = (isoDate) => {
    const date = parseLocalDate(isoDate);

    if (!date) return "date non définie";

    return new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(date);
  };

  const normalizeProduct = (rawProduct, index) => {
    const parfumCode = String(rawProduct.parfum_code || "")
      .trim()
      .toUpperCase();

    const formatCl = toNumber(rawProduct.format_cl, 0);

    const hasVisibleWebappColumn = Object.prototype.hasOwnProperty.call(
      rawProduct,
      "visible_webapp"
    );

    return {
      sku_id: String(rawProduct.sku_id || `${parfumCode}_${formatCl}`).trim(),
      parfum_code: parfumCode,
      parfum_nom: String(rawProduct.parfum_nom || parfumCode).trim(),
      format_cl: formatCl,
      gamme_tarif: String(rawProduct.gamme_tarif || "").trim(),
      vendable_seul: toBoolean(rawProduct.vendable_seul, false),
      composable_coffret: toBoolean(rawProduct.composable_coffret, false),
      cout_revient: toNumber(rawProduct.cout_revient, 0),
      actif: toBoolean(rawProduct.actif, false),
      visible_webapp: hasVisibleWebappColumn
        ? toBoolean(rawProduct.visible_webapp, true)
        : true,
      ordre_affichage: toNumber(rawProduct.ordre_affichage, 1000 + index),
      note: String(rawProduct.note || "").trim(),
      image_src: String(rawProduct.image_src || "").trim()
    };
  };

  const normalizeOffer = (rawOffer, index) => {
    const typeOffre = String(rawOffer.type_offre || "")
      .trim()
      .toLowerCase();

    const supplementCode = String(rawOffer.supplement_parfum_code || "")
      .trim()
      .toUpperCase();

    return {
      offre_id: String(rawOffer.offre_id || "").trim(),
      libelle: String(rawOffer.libelle || rawOffer.offre_id || "").trim(),
      type_offre: typeOffre,
      format_cl: toNumber(rawOffer.format_cl, 0),
      gamme_tarif: String(rawOffer.gamme_tarif || "").trim(),
      quantite_bouteilles: toNumber(rawOffer.quantite_bouteilles, 0),
      prix_ttc: toNumber(rawOffer.prix_ttc, 0),
      prix_ht: toNumber(rawOffer.prix_ht, toNumber(rawOffer.prix_ttc, 0)),
      taux_tva: toNumber(rawOffer.taux_tva, 0),
      regime_tva: String(rawOffer.regime_tva || "").trim(),
      actif: toBoolean(rawOffer.actif, false),
      ordre_affichage: toNumber(rawOffer.ordre_affichage, 1000 + index),
      supplement_parfum_code: supplementCode,
      supplement_unitaire_ttc: toNumber(rawOffer.supplement_unitaire_ttc, 0),
      note: String(rawOffer.note || "").trim()
    };
  };

  const readCachedArray = (key) => {
    const value = readJson(key, []);
    return Array.isArray(value) ? value : [];
  };

  const writeCachedArray = (key, value) => {
    writeJson(key, value);
  };

  const setStatus = (message, type = "") => {
    if (!els.saveStatus) return;

    els.saveStatus.textContent = message;
    els.saveStatus.className = "saveStatus";

    if (type) {
      els.saveStatus.classList.add(type);
    }
  };

  const hasActiveSalesContext = () =>
    Boolean(
      String(state.journeeActive?.mission_id || "").trim() &&
      String(state.journeeActive?.journee_id || "").trim()
    );

  const transactionHasValidContext = (transaction) =>
    Boolean(
      String(transaction?.mission_id || "").trim() &&
      String(transaction?.journee_id || "").trim()
    );

  const showMissingContextStatus = () => {
    setStatus(
      "Aucune journée active. Retourne dans Missions ou Préparation stock avant d’encaisser.",
      "isError"
    );
  };

  const syncAmountPaidInput = (total) => {
    if (state.amountManuallyEdited) return;
    els.amountPaidInput.value = total > 0 ? formatAmountInput(total) : "";
  };

  const getMode = () => SALE_MODES[state.selectedMode];

  const isBoxMode = () => getMode().kind === "box";

  const getProductImageSrc = (product) =>
    product.image_src || `./assets/parfums/${product.parfum_code.toLowerCase()}.webp`;

  const getActiveOffers = () =>
    state.offresVente.filter((offer) => offer.actif);

  const findBottleOfferForProduct = (product) => {
    const productGamme = normalizeKey(product.gamme_tarif);

    return getActiveOffers().find((offer) => {
      return (
        offer.type_offre === "bouteille" &&
        offer.format_cl === product.format_cl &&
        normalizeKey(offer.gamme_tarif) === productGamme
      );
    });
  };

  const findBoxOfferForMode = (mode = getMode()) => {
    const byId = getActiveOffers().find((offer) => offer.offre_id === mode.offer_id);

    if (byId) return byId;

    return getActiveOffers().find((offer) => {
      return (
        offer.type_offre === "coffret" &&
        offer.format_cl === mode.format_cl &&
        offer.quantite_bouteilles === mode.box_size
      );
    });
  };

  const getSupplementCount = (composition, offer) => {
    if (!offer || !offer.supplement_parfum_code) return 0;

    return composition.filter(
      (item) => item.parfum_code === offer.supplement_parfum_code
    ).length;
  };

  const getPackPricing = (composition, mode = getMode()) => {
    const offer = findBoxOfferForMode(mode);

    if (!offer) {
      return {
        offer: null,
        basePriceTtc: 0,
        basePriceHt: 0,
        supplementCount: 0,
        supplementTotalTtc: 0,
        supplementUnitTtc: 0,
        totalTtc: 0,
        totalHt: 0
      };
    }

    const supplementCount = getSupplementCount(composition, offer);
    const supplementTotalTtc = supplementCount * offer.supplement_unitaire_ttc;

    return {
      offer,
      basePriceTtc: offer.prix_ttc,
      basePriceHt: offer.prix_ht,
      supplementCount,
      supplementTotalTtc,
      supplementUnitTtc: offer.supplement_unitaire_ttc,
      totalTtc: offer.prix_ttc + supplementTotalTtc,
      totalHt: offer.prix_ht + supplementTotalTtc
    };
  };

  const getItemTotal = (item) => {
    if (item.type === "bottle") return item.quantite * item.prix_unitaire_ttc;
    if (item.type === "box") return item.prix_ttc;
    return 0;
  };

  const getTicketTotal = () =>
    state.ticketItems.reduce((sum, item) => sum + getItemTotal(item), 0);

  const getTransactionId = (transaction) =>
    String(transaction?.transaction_id || transaction?.id || "").trim();

  const isInvalidTransactionForDaySummary = (transaction) => {
    const status = normalizeKey(transaction?.statut);
    const paymentStatus = normalizeKey(transaction?.paiement_statut);

    return (
      status.includes("annule") ||
      status.includes("refuse") ||
      status.includes("rembourse") ||
      status.includes("attente") ||
      paymentStatus.includes("annule") ||
      paymentStatus.includes("refuse") ||
      paymentStatus.includes("rembourse") ||
      paymentStatus.includes("lance")
    );
  };

  const getTransactionAmount = (transaction) =>
    toNumber(
      transaction?.total_encaisse_ttc ??
      transaction?.total_encaisse ??
      transaction?.total_catalogue_ttc ??
      transaction?.total_catalogue,
      0
    );

  const computeDaySummaryFromTransactions = (transactions = []) => {
    const journeeId = String(state.journeeActive?.journee_id || "").trim();

    if (!journeeId) {
      return {
        revenue: 0,
        tickets: 0
      };
    }

    const byId = new Map();

    transactions
      .filter((transaction) => String(transaction?.journee_id || "").trim() === journeeId)
      .filter((transaction) => !isInvalidTransactionForDaySummary(transaction))
      .forEach((transaction, index) => {
        const id = getTransactionId(transaction) || `TX_INDEX_${index}`;
        byId.set(id, transaction);
      });

    const validTransactions = [...byId.values()];

    return {
      revenue: validTransactions.reduce(
        (sum, transaction) => sum + getTransactionAmount(transaction),
        0
      ),
      tickets: validTransactions.length
    };
  };

  const renderDaySummary = () => {
    if (!els.dayRevenueTotal || !els.dayTicketCount) return;

    if (!hasActiveSalesContext()) {
      els.dayRevenueTotal.textContent = "—";
      els.dayTicketCount.textContent = "aucune journée";
      return;
    }

    if (state.daySummary.isLoading && !state.daySummary.isLoaded) {
      els.dayRevenueTotal.textContent = "…";
      els.dayTicketCount.textContent = "lecture réseau";
      return;
    }

    if (state.daySummary.lastError && !state.daySummary.isLoaded) {
      els.dayRevenueTotal.textContent = "—";
      els.dayTicketCount.textContent = "réseau indisponible";
      return;
    }

    els.dayRevenueTotal.textContent = formatCurrency(state.daySummary.revenue);
    els.dayTicketCount.textContent =
      `${state.daySummary.tickets} ticket${state.daySummary.tickets > 1 ? "s" : ""}`;
  };

  const loadDaySummaryFromNetwork = async ({ silent = false } = {}) => {
    if (!hasActiveSalesContext()) {
      state.daySummary = {
        ...state.daySummary,
        isLoading: false,
        isLoaded: false,
        revenue: 0,
        tickets: 0,
        lastError: "Aucune journée active."
      };
      renderDaySummary();
      return state.daySummary;
    }

    if (!hasApi() || typeof api().getTransactions !== "function") {
      state.daySummary = {
        ...state.daySummary,
        isLoading: false,
        isLoaded: false,
        lastError: "LugdurumAPI.getTransactions() est indisponible."
      };
      renderDaySummary();

      if (!silent) {
        setStatus("Résumé journée indisponible : getTransactions() est introuvable.", "isError");
      }

      return state.daySummary;
    }

    state.daySummary = {
      ...state.daySummary,
      isLoading: true,
      lastError: ""
    };

    renderDaySummary();

    try {
      const transactions = await api().getTransactions();
      const summary = computeDaySummaryFromTransactions(
        Array.isArray(transactions) ? transactions : []
      );

      state.daySummary = {
        isLoading: false,
        isLoaded: true,
        revenue: summary.revenue,
        tickets: summary.tickets,
        lastLoadedAt: new Date().toISOString(),
        lastError: ""
      };

      renderDaySummary();

      return state.daySummary;
    } catch (error) {
      state.daySummary = {
        ...state.daySummary,
        isLoading: false,
        lastError: error.message || "Lecture réseau impossible."
      };

      renderDaySummary();

      if (!silent) {
        setStatus(`Résumé journée non actualisé : ${state.daySummary.lastError}`, "isError");
      }

      return state.daySummary;
    }
  };

  const refreshDaySummaryAfterSale = async () => {
    await loadDaySummaryFromNetwork({ silent: true });
  };

  const getVisibleProducts = () => {
    const mode = getMode();

    return state.catalogue
      .filter((product) => product.actif)
      .filter((product) => product.visible_webapp !== false)
      .filter((product) => product.format_cl === mode.format_cl)
      .filter((product) => {
        if (isBoxMode()) return product.composable_coffret;
        return product.vendable_seul;
      })
      .sort((a, b) => {
        const byOrder = a.ordre_affichage - b.ordre_affichage;
        if (byOrder !== 0) return byOrder;
        return String(a.parfum_code).localeCompare(String(b.parfum_code));
      });
  };

  const findProductBySku = (skuId) =>
    state.catalogue.find((product) => product.sku_id === skuId);

  const getDraftCounts = () => {
    return state.draftPack.reduce((map, product) => {
      map.set(product.parfum_code, (map.get(product.parfum_code) || 0) + 1);
      return map;
    }, new Map());
  };

  const getDraftProductByCode = (parfumCode) =>
    state.draftPack.find((product) => product.parfum_code === parfumCode) ||
    state.catalogue.find(
      (product) => product.parfum_code === parfumCode && product.format_cl === 20
    );

  const removeOneDraftProduct = (parfumCode) => {
    for (let i = state.draftPack.length - 1; i >= 0; i -= 1) {
      if (state.draftPack[i].parfum_code === parfumCode) {
        state.draftPack.splice(i, 1);
        break;
      }
    }

    setStatus("");
    renderAll();
  };

  const getTicketBottleQty = (skuId) => {
    return state.ticketItems
      .filter((item) => item.type === "bottle" && item.sku_id === skuId)
      .reduce((sum, item) => sum + item.quantite, 0);
  };

  const renderContext = () => {
    if (els.saleSummaryTitle) {
      els.saleSummaryTitle.textContent = state.journeeActive.label || "Aucune journée active";
    }

    if (els.missionMeta) {
      els.missionMeta.textContent = state.journeeActive.date_label || "date non définie";
    }

    renderDaySummary();
  };

  const renderModes = () => {
    document.querySelectorAll(".saleModeBtn").forEach((button) => {
      const isActive = button.dataset.saleMode === state.selectedMode;
      button.classList.toggle("isActive", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  };

  const renderProducts = () => {
    const draftCounts = getDraftCounts();
    const lightTextCodes = ["MV", "PE"];
    const longNameCodes = ["LP"];
    const visibleProducts = getVisibleProducts();

    if (!state.dataLoaded && state.catalogue.length === 0) {
      els.productGrid.innerHTML =
        `<p class="emptyTicket">Chargement du catalogue...</p>`;
      return;
    }

    if (visibleProducts.length === 0) {
      els.productGrid.innerHTML =
        `<p class="emptyTicket">Aucun parfum actif pour ce format.</p>`;
      return;
    }

    els.productGrid.innerHTML = visibleProducts
      .map((product) => {
        const qty = isBoxMode()
          ? draftCounts.get(product.parfum_code) || 0
          : getTicketBottleQty(product.sku_id);

        const offer = isBoxMode() ? null : findBottleOfferForProduct(product);
        const missingPrice = !isBoxMode() && !offer;

        const meta = isBoxMode()
          ? `${product.format_cl} cL · dans le coffret`
          : missingPrice
            ? `${product.format_cl} cL · prix à définir`
            : `${product.format_cl} cL · ${formatCurrency(offer.prix_ttc)}`;

        const buttonClasses = [
          "productBtn",
          qty > 0 ? "hasQty" : "",
          missingPrice ? "hasMissingPrice" : "",
          lightTextCodes.includes(product.parfum_code) ? "isLightText" : "",
          longNameCodes.includes(product.parfum_code) ? "isLongName" : ""
        ]
          .filter(Boolean)
          .join(" ");

        return `
          <button
            class="${buttonClasses}"
            type="button"
            data-sku="${escapeAttr(product.sku_id)}"
            data-parfum="${escapeAttr(product.parfum_code)}"
            style="--product-bg: url('${escapeAttr(getProductImageSrc(product))}')"
          >
            <span class="productCode">${escapeHtml(product.parfum_code)}</span>
            <span class="productName">${escapeHtml(product.parfum_nom)}</span>
            <span class="productMeta">${escapeHtml(meta)}</span>
            <strong class="productQty" aria-hidden="${qty > 0 ? "false" : "true"}">
              ${qty > 0 ? `×${qty}` : "×0"}
            </strong>
          </button>
        `;
      })
      .join("");
  };

  const updateProductQuantities = () => {
    const draftCounts = getDraftCounts();

    document.querySelectorAll(".productBtn[data-sku]").forEach((button) => {
      const product = findProductBySku(button.dataset.sku);
      if (!product) return;

      const qty = isBoxMode()
        ? draftCounts.get(product.parfum_code) || 0
        : getTicketBottleQty(product.sku_id);

      button.classList.toggle("hasQty", qty > 0);

      const badge = button.querySelector(".productQty");
      if (!badge) return;

      badge.textContent = qty > 0 ? `×${qty}` : "×0";
      badge.setAttribute("aria-hidden", qty > 0 ? "false" : "true");
    });
  };

  const renderPackComposer = () => {
    const mode = getMode();

    if (!isBoxMode()) {
      els.packComposer.hidden = true;
      return;
    }

    els.packComposer.hidden = false;

    const current = state.draftPack.length;
    const max = mode.box_size;
    const pricing = getPackPricing(state.draftPack, mode);
    const offer = pricing.offer;

    els.packProgressLabel.textContent = `${current} / ${max} parfums`;
    els.packPricePreview.textContent = offer
      ? formatCurrency(pricing.totalTtc)
      : "Offre manquante";
    els.packProgressBar.max = max;
    els.packProgressBar.value = current;
    els.addPackBtn.disabled = current !== max || !offer;

    if (current === 0) {
      els.draftPackList.innerHTML =
        `<p class="emptyTicket">Choisis les ${max} parfums du coffret.</p>`;
      return;
    }

    const counts = getDraftCounts();
    const lines = [...counts.entries()]
      .map(([code, qty]) => {
        const product = getDraftProductByCode(code);

        return {
          parfum_code: code,
          parfum_nom: product ? product.parfum_nom : code,
          ordre_affichage: product ? product.ordre_affichage : 9999,
          qty
        };
      })
      .sort((a, b) => a.ordre_affichage - b.ordre_affichage);

    els.draftPackList.innerHTML = `
      <div class="draftChips">
        ${lines
          .map((line) => `
            <button
              class="draftChip"
              type="button"
              data-remove-draft-code="${escapeAttr(line.parfum_code)}"
              aria-label="Retirer un ${escapeAttr(line.parfum_code)} du coffret"
              title="Toucher pour retirer"
            >
              ${escapeHtml(line.parfum_code)}${line.qty > 1 ? ` ×${line.qty}` : ""}
            </button>
          `)
          .join("")}
      </div>
      <p class="packHint">
        ${
          !offer
            ? "Offre de coffret introuvable dans le Sheet."
            : pricing.supplementCount > 0
              ? `Supplément ${escapeHtml(offer.supplement_parfum_code)} appliqué : +${formatCurrency(pricing.supplementTotalTtc)}`
              : offer.supplement_parfum_code
                ? `Aucun supplément ${escapeHtml(offer.supplement_parfum_code)} pour ce coffret.`
                : "Aucun supplément pour ce coffret."
        }
      </p>
    `;
  };

  const renderCart = () => {
    const total = getTicketTotal();

    if (els.ticketTotal) {
      els.ticketTotal.textContent = formatCurrency(total);
    }

    if (els.ticketPanelTotal) {
      els.ticketPanelTotal.textContent = formatCurrency(total);
    }

    if (state.ticketItems.length === 0) {
      els.ticketLines.innerHTML = `<p class="emptyTicket">Aucun produit ajouté.</p>`;
      els.amountPaidInput.value = "";
      state.amountManuallyEdited = false;
      return;
    }

    syncAmountPaidInput(total);

    els.ticketLines.innerHTML = state.ticketItems
      .map((item) => {
        if (item.type === "box") {
          const counts = item.composition.reduce((map, product) => {
            map.set(product.parfum_code, (map.get(product.parfum_code) || 0) + 1);
            return map;
          }, new Map());

          const chips = [...counts.entries()]
            .map(
              ([code, qty]) =>
                `<span class="ticketChip">${escapeHtml(code)}${qty > 1 ? ` ×${qty}` : ""}</span>`
            )
            .join("");

          return `
            <article class="ticketLine ticketLineBox">
              <div>
                <strong>${escapeHtml(item.label)}</strong>
                <span>${chips}</span>
              </div>

              <button class="removeLineBtn" type="button" data-remove-item="${escapeAttr(item.item_id)}">
                Retirer
              </button>

              <strong class="lineTotal">${formatCurrency(item.prix_ttc)}</strong>
            </article>
          `;
        }

        const lineTotal = item.quantite * item.prix_unitaire_ttc;

        return `
          <article class="ticketLine">
            <div>
              <strong>${escapeHtml(item.parfum_code)} ${escapeHtml(item.format_cl)} cL</strong>
              <span>${escapeHtml(item.parfum_nom)} · ${formatCurrency(item.prix_unitaire_ttc)}</span>
            </div>

            <div class="qtyControls" aria-label="Quantité ${escapeAttr(item.parfum_code)}">
              <button type="button" data-action="decrement" data-item="${escapeAttr(item.item_id)}">−</button>
              <span>${item.quantite}</span>
              <button type="button" data-action="increment" data-item="${escapeAttr(item.item_id)}">+</button>
            </div>

            <strong class="lineTotal">${formatCurrency(lineTotal)}</strong>
          </article>
        `;
      })
      .join("");
  };

  const renderPayment = () => {
    document.querySelectorAll(".paymentBtn").forEach((button) => {
      button.classList.toggle("isActive", button.dataset.payment === state.paymentMode);
    });

    const isCb = state.paymentMode === "CB";

    els.saveTicketBtn.textContent = isCb
      ? "Encaisser avec SumUp"
      : "Enregistrer le ticket";

    els.saveTicketBtn.classList.toggle("isSumupButton", isCb);

    els.saveTicketBtn.disabled = !hasActiveSalesContext();
  };

  const renderAll = ({ refreshProducts = false } = {}) => {
    renderContext();
    renderModes();
    renderPackComposer();

    if (refreshProducts || els.productGrid.children.length === 0) {
      renderProducts();
    } else {
      updateProductQuantities();
    }

    renderCart();
    renderPayment();
  };

  const addBottle = (product) => {
    const offer = findBottleOfferForProduct(product);

    if (!offer) {
      setStatus(
        `Aucune offre de vente trouvée pour ${product.parfum_code} ${product.format_cl} cL / gamme ${product.gamme_tarif || "non renseignée"}.`,
        "isError"
      );
      return;
    }

    const existing = state.ticketItems.find(
      (item) => item.type === "bottle" && item.sku_id === product.sku_id
    );

    if (existing) {
      existing.quantite += 1;
    } else {
      state.ticketItems.push({
        item_id: `ITEM_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        type: "bottle",
        offre_id: offer.offre_id,
        offre_libelle: offer.libelle,
        sku_id: product.sku_id,
        parfum_code: product.parfum_code,
        parfum_nom: product.parfum_nom,
        format_cl: product.format_cl,
        gamme_tarif: product.gamme_tarif,
        quantite: 1,
        prix_unitaire_ttc: offer.prix_ttc,
        prix_unitaire_ht: offer.prix_ht,
        taux_tva: offer.taux_tva,
        regime_tva: offer.regime_tva
      });
    }
  };

  const addProductToDraftPack = (product) => {
    const mode = getMode();

    if (state.draftPack.length >= mode.box_size) {
      setStatus("Le coffret est complet. Ajoute-le au ticket ou vide la composition.", "isError");
      return;
    }

    state.draftPack.push({ ...product });
  };

  const addPackToTicket = () => {
    const mode = getMode();

    if (!isBoxMode() || state.draftPack.length !== mode.box_size) return;

    const composition = state.draftPack.map((product) => ({ ...product }));
    const pricing = getPackPricing(composition, mode);

    if (!pricing.offer) {
      setStatus("Impossible d’ajouter le coffret : offre de vente introuvable.", "isError");
      return;
    }

    state.ticketItems.push({
      item_id: `BOX_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type: "box",
      offre_id: pricing.offer.offre_id,
      label: pricing.offer.libelle || mode.label,
      conditionnement: state.selectedMode,
      format_cl: mode.format_cl,
      box_size: mode.box_size,
      prix_ttc: pricing.totalTtc,
      prix_ht: pricing.totalHt,
      base_price: pricing.basePriceTtc,
      base_price_ht: pricing.basePriceHt,
      taux_tva: pricing.offer.taux_tva,
      regime_tva: pricing.offer.regime_tva,
      supplement_parfum_code: pricing.offer.supplement_parfum_code,
      supplement_unitaire_ttc: pricing.offer.supplement_unitaire_ttc,
      supplement_ttc: pricing.supplementTotalTtc,
      composition
    });

    state.draftPack = [];
    setStatus(`${pricing.offer.libelle || mode.label} ajouté au ticket.`, "isSuccess");
    renderAll();
  };

  const changeBottleQty = (itemId, delta) => {
    const item = state.ticketItems.find((line) => line.item_id === itemId);
    if (!item || item.type !== "bottle") return;

    item.quantite += delta;

    if (item.quantite <= 0) {
      state.ticketItems = state.ticketItems.filter((line) => line.item_id !== itemId);
    }
  };

  const removeTicketItem = (itemId) => {
    state.ticketItems = state.ticketItems.filter((item) => item.item_id !== itemId);
  };

  const clearTicket = () => {
    state.ticketItems = [];
    state.draftPack = [];
    els.amountPaidInput.value = "";
    state.amountManuallyEdited = false;
    setStatus("");
    renderAll();
  };

  const undoLast = () => {
    if (state.draftPack.length > 0) {
      state.draftPack.pop();
    } else {
      state.ticketItems.pop();
    }

    setStatus("");
    renderAll();
  };

  const saveLocalTransactionBackup = (transaction) => {
    const backup = readCachedArray(STORAGE_KEYS.localTransactionsBackup);
    backup.push(transaction);
    writeJson(STORAGE_KEYS.localTransactionsBackup, backup);
    writeJson(STORAGE_KEYS.lastTicket, transaction);
  };

  const upsertLocalMouvementsStock = (movements) => {
    if (!Array.isArray(movements) || movements.length === 0) return;

    const current = readCachedArray(STORAGE_KEYS.mouvementsStock);
    const byId = new Map();

    current.forEach((movement) => {
      const id = String(movement.mouvement_stock_id || "").trim();
      if (id) byId.set(id, movement);
    });

    movements.forEach((movement) => {
      const id = String(movement.mouvement_stock_id || "").trim();
      if (id) byId.set(id, movement);
    });

    const next = [...byId.values()];
    state.mouvementsStock = next;
    writeCachedArray(STORAGE_KEYS.mouvementsStock, next);
  };

  const getSourceForPayment = ({ provider = "" } = {}) => {
    if (state.paymentMode === "ESP") return "WEBAPP_ESPECES";
    if (state.paymentMode === "CHQ") return "WEBAPP_CHEQUE";
    if (state.paymentMode === "CB" && provider === "SUMUP") return "SUMUP";
    if (state.paymentMode === "CB") return "WEBAPP_CB_MANUEL";
    return "MANUEL";
  };

  const buildSaleLines = (transactionId, { provider = "" } = {}) => {
    const lines = [];
    const createdAt = new Date().toISOString();

    state.ticketItems.forEach((item) => {
      if (item.type === "bottle") {
        lines.push({
          ligne_id: `${transactionId}_L${String(lines.length + 1).padStart(2, "0")}`,
          transaction_id: transactionId,
          mission_id: state.journeeActive.mission_id,
          stock_mission_id: state.journeeActive.mission_id,
          journee_id: state.journeeActive.journee_id,
          sku_id: item.sku_id,
          parfum_code: item.parfum_code,
          parfum_nom: item.parfum_nom,
          format_cl: item.format_cl,
          quantite: item.quantite,
          prix_unitaire_ttc: item.prix_unitaire_ttc,
          prix_unitaire_ht: item.prix_unitaire_ht,
          taux_tva: item.taux_tva || 0,
          montant_tva_ligne: 0,
          total_catalogue_ligne_ttc: formatAmount(item.quantite * item.prix_unitaire_ttc),
          total_catalogue_ligne_ht: formatAmount(item.quantite * item.prix_unitaire_ht),
          cout_unitaire: 0,
          marge_brute_ligne: 0,
          source: getSourceForPayment({ provider }),
          note: item.offre_id ? `Offre : ${item.offre_id}` : "",
          created_at: createdAt,
          updated_at: createdAt
        });
        return;
      }

      if (item.type === "box") {
        const counts = item.composition.reduce((map, product) => {
          const current = map.get(product.sku_id) || {
            product,
            qty: 0
          };

          current.qty += 1;
          map.set(product.sku_id, current);
          return map;
        }, new Map());

        const supplementCode = item.supplement_parfum_code || "";
        const supplementCount = supplementCode
          ? item.composition.filter((product) => product.parfum_code === supplementCode).length
          : 0;

        const baseUnitPriceTtc = item.base_price / item.box_size;
        const baseUnitPriceHt = item.base_price_ht / item.box_size;

        const surchargePerSupplement =
          supplementCount > 0 ? item.supplement_ttc / supplementCount : 0;

        [...counts.values()].forEach(({ product, qty }) => {
          const hasSupplement = product.parfum_code === supplementCode;
          const unitPriceTtc = baseUnitPriceTtc + (hasSupplement ? surchargePerSupplement : 0);
          const unitPriceHt = baseUnitPriceHt + (hasSupplement ? surchargePerSupplement : 0);

          const totalLineTtc = unitPriceTtc * qty;
          const totalLineHt = unitPriceHt * qty;

          lines.push({
            ligne_id: `${transactionId}_L${String(lines.length + 1).padStart(2, "0")}`,
            transaction_id: transactionId,
            mission_id: state.journeeActive.mission_id,
            stock_mission_id: state.journeeActive.mission_id,
            journee_id: state.journeeActive.journee_id,
            sku_id: product.sku_id,
            parfum_code: product.parfum_code,
            parfum_nom: product.parfum_nom,
            format_cl: product.format_cl,
            quantite: qty,
            prix_unitaire_ttc: formatAmount(unitPriceTtc),
            prix_unitaire_ht: formatAmount(unitPriceHt),
            taux_tva: item.taux_tva || 0,
            montant_tva_ligne: 0,
            total_catalogue_ligne_ttc: formatAmount(totalLineTtc),
            total_catalogue_ligne_ht: formatAmount(totalLineHt),
            cout_unitaire: 0,
            marge_brute_ligne: 0,
            source: getSourceForPayment({ provider }),
            note: `${item.label} · ${item.composition.map((p) => p.parfum_code).join(" ")}`,
            created_at: createdAt,
            updated_at: createdAt
          });
        });
      }
    });

    return lines;
  };

  const buildStockMovementId = (line) =>
    `MVT_${line.ligne_id}_VENTE`;

  const buildStockMovementsFromTransaction = (transaction) => {
    const lines = Array.isArray(transaction?.lignes) ? transaction.lignes : [];
    const now = new Date().toISOString();

    return lines
      .filter((line) => toNumber(line.quantite, 0) > 0)
      .map((line) => ({
        mouvement_stock_id: buildStockMovementId(line),
        date_heure: transaction.date_heure || now,
        mission_id: transaction.mission_id,
        stock_mission_id: transaction.stock_mission_id || transaction.mission_id,
        journee_id: transaction.journee_id,
        type_mouvement: MOVEMENT_TYPE.VENTE,
        sens: MOVEMENT_SENS.SORTIE,
        sku_id: line.sku_id,
        parfum_code: line.parfum_code || "",
        parfum_nom: line.parfum_nom || "",
        format_cl: line.format_cl || "",
        quantite: toNumber(line.quantite, 0),
        source: transaction.source || getSourceForPayment(),
        source_id: transaction.transaction_id,
        transaction_id: transaction.transaction_id,
        ligne_id: line.ligne_id,
        statut: transaction.statut === "validee" ? "valide" : transaction.statut,
        note: line.note || "",
        user_id: transaction.user_id,
        created_at: line.created_at || now,
        updated_at: now
      }));
  };

  const buildBatchOperation = ({ sheet, sheetKey, keyField, row }) => ({
    action: "upsert",
    type: "upsert",

    sheetKey,
    sheet_key: sheetKey,

    sheet,
    sheet_name: sheet,
    sheetName: sheet,

    key: keyField,
    key_field: keyField,
    keyField,

    row,
    data: row
  });

  const saveStockMovementsToApi = async (movements) => {
    if (!Array.isArray(movements) || movements.length === 0) {
      return {
        skipped: true,
        mouvements_count: 0
      };
    }

    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    if (typeof api().batchUpsert !== "function") {
      throw new Error("LugdurumAPI.batchUpsert() est indisponible pour écrire les mouvements de stock.");
    }

    const operations = movements.map((movement) =>
      buildBatchOperation({
        sheet: SHEETS.mouvementsStock,
        sheetKey: "mouvementsStock",
        keyField: "mouvement_stock_id",
        row: movement
      })
    );

    const result = await api().batchUpsert(operations);

    upsertLocalMouvementsStock(movements);

    return result;
  };

  const buildTransaction = ({
    provider = "",
    paymentStatus = "PAYE",
    status = "validee",
    foreignTxId = ""
  } = {}) => {
    const transactionId = foreignTxId || `TX_${Date.now()}`;
    const totalCatalogue = getTicketTotal();
    const amountInput = Number(String(els.amountPaidInput.value).replace(",", "."));
    const totalEncaisse =
      Number.isFinite(amountInput) && amountInput > 0 ? amountInput : totalCatalogue;

    const createdAt = new Date().toISOString();

    const transaction = {
      transaction_id: transactionId,
      date_heure: createdAt,
      mission_id: state.journeeActive.mission_id,
      stock_mission_id: state.journeeActive.mission_id,
      journee_id: state.journeeActive.journee_id,
      user_id: state.journeeActive.user_id,
      mode_paiement: state.paymentMode,
      paiement_provider: provider,
      paiement_statut: paymentStatus,
      sumup_foreign_tx_id: provider === "SUMUP" ? foreignTxId : "",
      source: getSourceForPayment({ provider }),
      source_id: provider === "SUMUP" ? foreignTxId : "",
      total_catalogue_ttc: formatAmount(totalCatalogue),
      total_catalogue_ht: formatAmount(totalCatalogue),
      total_tva: 0,
      total_encaisse_ttc: formatAmount(totalEncaisse),
      remise_totale: formatAmount(totalCatalogue - totalEncaisse),
      motif_remise: totalCatalogue !== totalEncaisse ? "Montant encaissé modifié" : "",
      statut: status,
      note: "",
      detail_ticket: JSON.stringify(state.ticketItems),
      created_at: createdAt,
      updated_at: createdAt,
      lignes: []
    };

    transaction.lignes = buildSaleLines(transactionId, { provider });

    return transaction;
  };

  const saveTransactionToApi = async (transaction) => {
    if (!transactionHasValidContext(transaction)) {
      throw new Error("Transaction bloquée : mission_id ou journee_id manquant.");
    }

    if (!hasApi() || typeof api().saveTransaction !== "function") {
      throw new Error("LugdurumAPI.saveTransaction() est indisponible.");
    }

    const result = await api().saveTransaction(transaction);
    const movements = buildStockMovementsFromTransaction(transaction);

    if (transaction.statut === "validee") {
      await saveStockMovementsToApi(movements);
    }

    saveLocalTransactionBackup(transaction);

    return {
      transaction: result,
      mouvements_stock_count: movements.length
    };
  };

  const getSumupAffiliateKey = () => {
    return (
      localStorage.getItem(STORAGE_KEYS.sumupAffiliateKey) ||
      SUMUP_CONFIG.affiliateKey ||
      ""
    ).trim();
  };

  const buildForeignTxId = () => {
    return `LUG_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  };

  const buildCallbackUrl = (status, foreignTxId) => {
    const url = new URL(window.location.href);
    url.searchParams.set("sumup_callback", status);
    url.searchParams.set("foreign_tx_id", foreignTxId);
    return url.toString();
  };

  const buildSumupUrl = (transaction, foreignTxId) => {
    const affiliateKey = getSumupAffiliateKey();
    const params = new URLSearchParams();

    params.set("amount", formatAmountInput(transaction.total_encaisse_ttc));
    params.set("currency", SUMUP_CONFIG.currency);
    params.set("affiliate-key", affiliateKey);
    params.set("title", `${SUMUP_CONFIG.titlePrefix} - Ticket`);
    params.set("foreign-tx-id", foreignTxId);

    if (SUMUP_CONFIG.callbackEnabled) {
      params.set("callbacksuccess", buildCallbackUrl("success", foreignTxId));
      params.set("callbackfail", buildCallbackUrl("failed", foreignTxId));
    }

    return `sumupmerchant://pay/1.0?${params.toString()}`;
  };

  const getPendingSumup = () => {
    const value = readJson(STORAGE_KEYS.sumupPending, null);
    return value && typeof value === "object" ? value : null;
  };

  const setPendingSumup = (payload) => {
    writeJson(STORAGE_KEYS.sumupPending, payload);
  };

  const clearPendingSumup = () => {
    localStorage.removeItem(STORAGE_KEYS.sumupPending);
  };

  const showSumupConfirm = (pending, message = "") => {
    if (!pending || !pending.transaction || !els.sumupConfirmOverlay) return;

    els.sumupPendingAmount.textContent = formatCurrency(pending.transaction.total_encaisse_ttc);
    els.sumupPendingReference.textContent =
      pending.foreign_tx_id ? `Réf. ${pending.foreign_tx_id}` : "Référence SumUp en attente";

    els.sumupConfirmText.textContent =
      message ||
      "Le paiement SumUp a été lancé. Confirme le résultat après ton retour dans Lugdurum.";

    els.sumupConfirmOverlay.hidden = false;
  };

  const hideSumupConfirm = () => {
    if (els.sumupConfirmOverlay) {
      els.sumupConfirmOverlay.hidden = true;
    }
  };

  const restoreTicketFromTransaction = (transaction) => {
    try {
      state.ticketItems = Array.isArray(transaction.detail_ticket)
        ? transaction.detail_ticket
        : JSON.parse(transaction.detail_ticket || "[]");
    } catch {
      state.ticketItems = [];
    }

    state.draftPack = [];
    state.paymentMode = transaction.mode_paiement || "CB";
    state.amountManuallyEdited = true;
    els.amountPaidInput.value = formatAmountInput(transaction.total_encaisse_ttc || 0);
  };

  const checkPendingSumup = (message = "") => {
    const pending = getPendingSumup();

    if (!pending) return;

    showSumupConfirm(pending, message);
  };

  const handleSumupCallbackParams = () => {
    const url = new URL(window.location.href);
    const callbackStatus =
      url.searchParams.get("sumup_callback") ||
      url.searchParams.get("smp-status") ||
      "";

    const foreignTxId =
      url.searchParams.get("foreign_tx_id") ||
      url.searchParams.get("foreign-tx-id") ||
      "";

    if (!callbackStatus) return;

    const pending = getPendingSumup();

    if (pending) {
      pending.callback_status = callbackStatus;
      pending.callback_foreign_tx_id = foreignTxId;
      pending.updated_at = new Date().toISOString();
      setPendingSumup(pending);

      if (callbackStatus === "success") {
        showSumupConfirm(
          pending,
          "SumUp indique un paiement réussi. Confirme pour enregistrer le ticket dans Lugdurum."
        );
      } else {
        showSumupConfirm(
          pending,
          "SumUp indique un paiement non validé. Tu peux annuler ou retourner dans SumUp."
        );
      }
    }

    url.searchParams.delete("sumup_callback");
    url.searchParams.delete("smp-status");
    url.searchParams.delete("foreign_tx_id");
    url.searchParams.delete("foreign-tx-id");

    window.history.replaceState({}, document.title, url.toString());
  };

  const launchSumupPayment = () => {
    if (!hasActiveSalesContext()) {
      showMissingContextStatus();
      return;
    }

    if (state.ticketItems.length === 0) {
      setStatus("Ajoute au moins un produit avant d’encaisser.", "isError");
      return;
    }

    if (state.draftPack.length > 0) {
      setStatus("Tu as un coffret en cours non ajouté au ticket.", "isError");
      return;
    }

    const affiliateKey = getSumupAffiliateKey();

    if (!affiliateKey) {
      setStatus(
        "Clé SumUp manquante. Renseigne SUMUP_CONFIG.affiliateKey dans vente-rapide.js.",
        "isError"
      );
      return;
    }

    const foreignTxId = buildForeignTxId();
    const transaction = buildTransaction({
      provider: "SUMUP",
      paymentStatus: "SUMUP_LANCE",
      status: "paiement_en_attente",
      foreignTxId
    });

    const sumupUrl = buildSumupUrl(transaction, foreignTxId);

    setPendingSumup({
      foreign_tx_id: foreignTxId,
      sumup_url: sumupUrl,
      transaction,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    setStatus("Ouverture de SumUp… Confirme le paiement au retour.", "isSuccess");
    showSumupConfirm(getPendingSumup());

    window.location.href = sumupUrl;
  };

  const confirmSumupSuccess = async () => {
    const pending = getPendingSumup();

    if (!pending || !pending.transaction) {
      hideSumupConfirm();
      return;
    }

    const transaction = {
      ...pending.transaction,
      statut: "validee",
      paiement_statut: "PAYE",
      updated_at: new Date().toISOString(),
      note: [
        pending.transaction.note || "",
        pending.callback_status ? `Retour SumUp : ${pending.callback_status}` : ""
      ].filter(Boolean).join("\n")
    };

    if (!transactionHasValidContext(transaction)) {
      setStatus(
        "Paiement non enregistré : mission ou journée manquante. Le ticket est conservé dans la popup SumUp.",
        "isError"
      );
      return;
    }

    try {
      await saveTransactionToApi(transaction);
      await refreshDaySummaryAfterSale();

      clearPendingSumup();
      hideSumupConfirm();

      const pendingCount = hasApi() && typeof api().getPendingWritesCount === "function"
        ? api().getPendingWritesCount()
        : 0;

      setStatus(
        pendingCount > 0
          ? `Paiement SumUp validé · ticket et stock en attente de synchronisation · ${formatCurrency(transaction.total_encaisse_ttc)}`
          : `Paiement SumUp validé · ${formatCurrency(transaction.total_encaisse_ttc)}`,
        pendingCount > 0 ? "isError" : "isSuccess"
      );

      state.ticketItems = [];
      state.draftPack = [];
      els.amountPaidInput.value = "";
      state.amountManuallyEdited = false;
      renderAll();
    } catch (error) {
      setStatus(`Paiement validé, mais erreur d’enregistrement : ${error.message}`, "isError");
    }
  };

  const confirmSumupFailure = () => {
    const pending = getPendingSumup();

    if (pending?.transaction) {
      restoreTicketFromTransaction(pending.transaction);
    }

    clearPendingSumup();
    hideSumupConfirm();

    setStatus(
      "Paiement SumUp non validé. Le panier est conservé : tu peux réessayer ou changer le paiement.",
      "isError"
    );

    renderAll({ refreshProducts: true });
  };

  const reopenSumup = () => {
    const pending = getPendingSumup();

    if (!pending?.sumup_url) {
      setStatus("Aucun paiement SumUp en attente.", "isError");
      hideSumupConfirm();
      return;
    }

    window.location.href = pending.sumup_url;
  };

  const saveTicket = async () => {
    if (!hasActiveSalesContext()) {
      showMissingContextStatus();
      return;
    }

    if (state.paymentMode === "CB") {
      launchSumupPayment();
      return;
    }

    if (state.ticketItems.length === 0) {
      setStatus("Ajoute au moins un produit avant d’enregistrer.", "isError");
      return;
    }

    if (state.draftPack.length > 0) {
      setStatus("Tu as un coffret en cours non ajouté au ticket.", "isError");
      return;
    }

    const transaction = buildTransaction({
      provider: "",
      paymentStatus: "PAYE",
      status: "validee"
    });

    try {
      await saveTransactionToApi(transaction);
      await refreshDaySummaryAfterSale();

      const pendingCount = hasApi() && typeof api().getPendingWritesCount === "function"
        ? api().getPendingWritesCount()
        : 0;

      setStatus(
        pendingCount > 0
          ? `Ticket + sortie stock conservés dans la file d’attente · ${formatCurrency(transaction.total_encaisse_ttc)} · ${transaction.mode_paiement}`
          : `Ticket enregistré + stock décrémenté · ${formatCurrency(transaction.total_encaisse_ttc)} · ${transaction.mode_paiement}`,
        pendingCount > 0 ? "isError" : "isSuccess"
      );

      state.ticketItems = [];
      state.draftPack = [];
      els.amountPaidInput.value = "";
      state.amountManuallyEdited = false;
      renderAll();
    } catch (error) {
      setStatus(`Erreur enregistrement ticket : ${error.message}`, "isError");
    }
  };

  const loadContext = async () => {
    const context = readJson(STORAGE_KEYS.preparationContext, null);

    const stockMissionId =
      context?.stock_mission_id ||
      context?.mission_id ||
      localStorage.getItem(STORAGE_KEYS.activeStockMissionId) ||
      localStorage.getItem(STORAGE_KEYS.activeMissionId) ||
      "";

    const journeeId =
      context?.journee_id ||
      localStorage.getItem(STORAGE_KEYS.activeJourneeId) ||
      "";

    state.journeeActive = {
      ...EMPTY_JOURNEE_ACTIVE,
      mission_id: stockMissionId,
      journee_id: journeeId
    };

    if (!stockMissionId || !journeeId) {
      state.contextLoaded = true;
      renderAll();
      showMissingContextStatus();
      return;
    }

    state.journeeActive = {
      ...state.journeeActive,
      label: "Journée active",
      date_label: "Contexte local chargé"
    };

    renderAll();
    loadDaySummaryFromNetwork({ silent: true });

    try {
      if (!hasApi()) return;

      const [missionsStock, journees] = await Promise.all([
        api().getMissionsStock(),
        api().getJournees()
      ]);

      state.missionsStock = Array.isArray(missionsStock) ? missionsStock : [];
      state.journees = Array.isArray(journees) ? journees : [];

      const mission = state.missionsStock.find(
        (item) => String(item.mission_id || "") === String(stockMissionId || "")
      );

      const journee = state.journees.find(
        (item) => String(item.journee_id || "") === String(journeeId || "")
      );

      if (mission || journee) {
        state.journeeActive = {
          ...state.journeeActive,
          label: [
            mission?.nom || "Mission",
            journee?.jour_label || ""
          ].filter(Boolean).join(" — "),
          date_label: journee?.date ? formatDisplayDateLong(journee.date) : state.journeeActive.date_label,
          mission_id: stockMissionId,
          journee_id: journeeId
        };

        renderAll();
        loadDaySummaryFromNetwork({ silent: true });
      }
    } catch (error) {
      console.warn("Contexte journée non chargé depuis Sheets.", error);
    } finally {
      state.contextLoaded = true;
      renderAll();
    }
  };

  const loadData = async () => {
    renderProducts();

    try {
      if (!hasApi()) {
        throw new Error("lugdurum-api.js n’est pas chargé.");
      }

      if (typeof api().getCatalogue !== "function") {
        throw new Error("getCatalogue() est introuvable dans lugdurum-api.js.");
      }

      if (typeof api().getOffresVente !== "function") {
        throw new Error("getOffresVente() est introuvable dans lugdurum-api.js.");
      }

      const [
        catalogueRows,
        offresRows,
        mouvementsRows
      ] = await Promise.all([
        api().getCatalogue(),
        api().getOffresVente(),
        typeof api().getMouvementsStock === "function"
          ? api().getMouvementsStock()
          : Promise.resolve([])
      ]);

      state.catalogue = catalogueRows
        .map((row, index) => normalizeProduct(row, index))
        .filter((product) => product.sku_id && product.parfum_code && product.format_cl);

      state.offresVente = offresRows
        .map((row, index) => normalizeOffer(row, index))
        .filter((offer) => offer.offre_id && offer.type_offre && offer.format_cl);

      state.mouvementsStock = Array.isArray(mouvementsRows) ? mouvementsRows : [];

      state.dataLoaded = true;

      writeCachedArray(STORAGE_KEYS.catalogueCache, state.catalogue);
      writeCachedArray(STORAGE_KEYS.offresVenteCache, state.offresVente);
      writeCachedArray(STORAGE_KEYS.mouvementsStock, state.mouvementsStock);

      if (state.offresVente.length === 0) {
        setStatus("Catalogue chargé, mais aucune offre de vente active trouvée.", "isError");
      } else if (hasActiveSalesContext()) {
        setStatus("");
      }

      renderAll({ refreshProducts: true });
    } catch (error) {
      const cachedCatalogue = readCachedArray(STORAGE_KEYS.catalogueCache);
      const cachedOffres = readCachedArray(STORAGE_KEYS.offresVenteCache);
      const cachedMouvements = readCachedArray(STORAGE_KEYS.mouvementsStock);

      if (cachedCatalogue.length > 0 || cachedOffres.length > 0) {
        state.catalogue = cachedCatalogue.map((row, index) => normalizeProduct(row, index));
        state.offresVente = cachedOffres.map((row, index) => normalizeOffer(row, index));
        state.mouvementsStock = cachedMouvements;
        state.dataLoaded = true;

        setStatus("Données chargées depuis le cache local. Le CA jour reste basé uniquement sur la lecture réseau.", "isError");
        renderAll({ refreshProducts: true });
        return;
      }

      state.dataLoaded = true;
      state.catalogue = [];
      state.offresVente = [];
      state.mouvementsStock = [];

      setStatus(`Impossible de charger les données : ${error.message}`, "isError");
      renderAll({ refreshProducts: true });
    }
  };

  document.addEventListener("click", (event) => {
    const draftRemoveButton = event.target.closest("[data-remove-draft-code]");
    if (draftRemoveButton) {
      removeOneDraftProduct(draftRemoveButton.dataset.removeDraftCode);
      return;
    }

    const modeButton = event.target.closest(".saleModeBtn");
    if (modeButton) {
      state.selectedMode = modeButton.dataset.saleMode;
      state.draftPack = [];
      setStatus("");
      renderAll({ refreshProducts: true });
      return;
    }

    const productButton = event.target.closest(".productBtn");
    if (productButton) {
      const product = findProductBySku(productButton.dataset.sku);
      if (!product) return;

      if (isBoxMode()) {
        addProductToDraftPack(product);
      } else {
        addBottle(product);
      }

      renderAll();
      return;
    }

    const paymentButton = event.target.closest(".paymentBtn");
    if (paymentButton) {
      state.paymentMode = paymentButton.dataset.payment;
      setStatus("");
      renderPayment();
      return;
    }

    const qtyButton = event.target.closest("[data-action][data-item]");
    if (qtyButton) {
      const delta = qtyButton.dataset.action === "increment" ? 1 : -1;
      changeBottleQty(qtyButton.dataset.item, delta);
      setStatus("");
      renderAll();
      return;
    }

    const removeButton = event.target.closest("[data-remove-item]");
    if (removeButton) {
      removeTicketItem(removeButton.dataset.removeItem);
      setStatus("");
      renderAll();
    }
  });

  els.amountPaidInput.addEventListener("input", () => {
    state.amountManuallyEdited = els.amountPaidInput.value.trim() !== "";
  });

  els.clearDraftPackBtn.addEventListener("click", () => {
    state.draftPack = [];
    setStatus("");
    renderAll();
  });

  els.addPackBtn.addEventListener("click", addPackToTicket);
  els.clearTicketBtn.addEventListener("click", clearTicket);
  els.undoBtn.addEventListener("click", undoLast);
  els.saveTicketBtn.addEventListener("click", saveTicket);

  if (els.sumupConfirmSuccessBtn) {
    els.sumupConfirmSuccessBtn.addEventListener("click", confirmSumupSuccess);
  }

  if (els.sumupConfirmFailBtn) {
    els.sumupConfirmFailBtn.addEventListener("click", confirmSumupFailure);
  }

  if (els.sumupReturnBtn) {
    els.sumupReturnBtn.addEventListener("click", reopenSumup);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkPendingSumup();

      if (hasActiveSalesContext()) {
        loadDaySummaryFromNetwork({ silent: true });
      }
    }
  });

  window.addEventListener("focus", () => {
    checkPendingSumup();

    if (hasActiveSalesContext()) {
      loadDaySummaryFromNetwork({ silent: true });
    }
  });

  window.addEventListener("lugdurum:sync-status", (event) => {
    const detail = event.detail || {};

    if (Number(detail.pending_count || 0) > 0 && state.ticketItems.length === 0) {
      setStatus(`${detail.pending_count} écriture(s) en attente de synchronisation.`, "isError");
    }
  });

  handleSumupCallbackParams();
  renderAll();
  loadContext();
  loadData();
  checkPendingSumup();
})();