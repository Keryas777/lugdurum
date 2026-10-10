(() => {
  "use strict";

  /*
    Vente rapide V21 :
    - Catalogue + offres chargés en une seule lecture réseau quand possible :
      LugdurumAPI.getVenteRapideData() si disponible,
      sinon LugdurumAPI.getCoreData(["catalogue", "offresVente"]),
      sinon fallback legacy getCatalogue() + getOffresVente().
    - Ne charge plus mouvements_stock au démarrage.
    - Contexte journée + résumé CA chargés en une seule lecture réseau quand possible :
      missionsStock + journees + transactions via getCoreData().
    - CA jour affiché en haut :
      calculé uniquement depuis l’onglet transactions lu par réseau,
      jamais depuis lugdurum_transactions_backup ni cache local.
    - Total ticket affiché dans le panier.
    - Enregistrement optimisé :
      transaction + ventes_lignes + mouvements_stock via saveVenteRapideBundle
      quand disponible côté API / Apps Script.
    - Fallback conservé :
      saveTransaction(), puis batchUpsert() des mouvements_stock.
    - Aucun fallback de test :
      aucune vente possible sans mission_id + journee_id.
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
    callbackEnabled: false,
    // Verification SumUp commune a tous les vendeurs, avec confirmation
    // manuelle en secours si le paiement n'est pas confirme par l'API.
    verificationEnabled: true,
    // Après une réponse NOT_FOUND/PENDING, ne pas ajouter presque 2 s
    // d'attente alors que SumUp peut publier la transaction entre-temps.
    verificationRetryMs: 600,
    verificationMaxAttempts: 5
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

  const CORE_ALIASES = {
    catalogue: ["catalogue"],
    offresVente: ["offresVente", "offres_vente"],
    missionsStock: ["missionsStock", "missions_stock"],
    journees: ["journees", "journees_vente"],
    transactions: ["transactions"]
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
    catalogueSource: "loading",
    pendingProductRefresh: false,
    pendingCatalogueUpdate: null,
    saveInProgress: false,
    failedTicket: null,
    lastQueuedVerifiedSumupId: "",
    deferredLoadForSumup: false,
    sumupManualBlocked: false,
    journeeActive: { ...EMPTY_JOURNEE_ACTIVE },
    sharedStock: null,
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
    stockPreparedTotal: document.getElementById("stockPreparedTotal"),
    stockPreparedBreakdown: document.getElementById("stockPreparedBreakdown"),
    refreshDaySummaryBtn: document.getElementById("refreshDaySummaryBtn"),
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
    externalCbBtn: document.getElementById("externalCbBtn"),
    externalCbOverlay: document.getElementById("externalCbOverlay"),
    externalCbAmount: document.getElementById("externalCbAmount"),
    externalCbConfirmBtn: document.getElementById("externalCbConfirmBtn"),
    externalCbCancelBtn: document.getElementById("externalCbCancelBtn"),
    externalCbStatus: document.getElementById("externalCbStatus"),
    amountPaidInput: document.getElementById("amountPaidInput"),
    saveStatus: document.getElementById("saveStatus"),

    sumupConfirmOverlay: document.getElementById("sumupConfirmOverlay"),
    sumupConfirmTitle: document.getElementById("sumupConfirmTitle"),
    sumupConfirmText: document.getElementById("sumupConfirmText"),
    sumupSuccessHero: document.getElementById("sumupSuccessHero"),
    sumupPendingActions: document.getElementById("sumupPendingActions"),
    sumupSuccessActions: document.getElementById("sumupSuccessActions"),
    sumupContinueBtn: document.getElementById("sumupContinueBtn"),
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
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[-\s]+/g, "_")
      .replace(/[^a-z0-9_]/g, "");

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

  const getCoreArray = (result, tableKey) => {
    const aliases = CORE_ALIASES[tableKey] || [tableKey];
    const sources = [
      result,
      result?.tables,
      result?.data,
      result?.data?.tables
    ].filter(Boolean);

    for (const source of sources) {
      for (const alias of aliases) {
        if (Array.isArray(source[alias])) return source[alias];
      }
    }

    return [];
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

  const setDaySummaryFromTransactions = (transactions = []) => {
    const summary = computeDaySummaryFromTransactions(transactions);

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

  const loadTransactionsFromNetwork = async () => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    if (typeof api().getCoreData === "function") {
      const result = await api().getCoreData(["transactions"]);
      return getCoreArray(result, "transactions");
    }

    if (typeof api().getTransactions === "function") {
      const transactions = await api().getTransactions();
      return Array.isArray(transactions) ? transactions : [];
    }

    throw new Error("Aucune méthode de lecture transactions disponible.");
  };

  let currentSummaryRequest = 0;

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

    const requestId = ++currentSummaryRequest;
    const journeeId = state.journeeActive.journee_id;
    if (els.refreshDaySummaryBtn) els.refreshDaySummaryBtn.disabled = true;
    state.daySummary = {
      ...state.daySummary,
      isLoading: true,
      lastError: ""
    };

    renderDaySummary();

    try {
      const transactions = await loadTransactionsFromNetwork();
      if (requestId !== currentSummaryRequest || journeeId !== state.journeeActive.journee_id) {
        return state.daySummary;
      }
      return setDaySummaryFromTransactions(transactions);
    } catch (error) {
      if (requestId !== currentSummaryRequest || journeeId !== state.journeeActive.journee_id) {
        return state.daySummary;
      }
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
    } finally {
      if (els.refreshDaySummaryBtn) els.refreshDaySummaryBtn.disabled = false;
    }
  };

  // La lecture complète des statistiques ne doit jamais bloquer le ticket suivant.
  let summaryRefreshTimer = null;
  const refreshDaySummaryAfterSale = () => {
    if (summaryRefreshTimer) window.clearTimeout(summaryRefreshTimer);
    summaryRefreshTimer = window.setTimeout(() => {
      summaryRefreshTimer = null;
      loadDaySummaryFromNetwork({ silent: true }).catch(console.warn);
    }, 700);
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
    const stock = state.sharedStock;
    if (els.stockPreparedTotal) {
      els.stockPreparedTotal.textContent = stock
        ? String(toNumber(stock.total_bouteilles_preparees, 0))
        : "—";
    }
    if (els.stockPreparedBreakdown) {
      els.stockPreparedBreakdown.textContent = stock
        ? `${toNumber(stock.total_50cl_prepare, 0)} × 50 cL · ${toNumber(stock.total_20cl_prepare, 0)} × 20 cL`
        : "En attente du stock commun";
    }
  };

  const renderModes = () => {
    document.querySelectorAll(".saleModeBtn").forEach((button) => {
      const isActive = button.dataset.saleMode === state.selectedMode;
      button.classList.toggle("isActive", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  };

  // Les images hors écran ne doivent pas ralentir les premiers produits.
  // Les tuiles (texte et prix) restent immédiatement utilisables.
  let productImageObserver = null;
  const revealProductImage = (button) => {
    const src = button.dataset.imageSrc;
    if (!src) return;
    const safeUrl = src.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    button.style.setProperty("--product-bg", `url("${safeUrl}")`);
    delete button.dataset.imageSrc;
  };

  const observeProductImages = () => {
    if (productImageObserver) productImageObserver.disconnect();

    const buttons = els.productGrid.querySelectorAll(".productBtn[data-image-src]");
    if (!("IntersectionObserver" in window)) {
      buttons.forEach(revealProductImage);
      return;
    }

    productImageObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        revealProductImage(entry.target);
        productImageObserver.unobserve(entry.target);
      });
    }, { rootMargin: "350px 0px", threshold: 0 });

    buttons.forEach((button) => productImageObserver.observe(button));
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
            data-image-src="${escapeAttr(getProductImageSrc(product))}"
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
    observeProductImages();
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

    if (state.saveInProgress) els.saveTicketBtn.textContent = "Enregistrement…";
    els.saveTicketBtn.disabled = !hasActiveSalesContext() || state.saveInProgress;
    if (els.externalCbBtn) {
      els.externalCbBtn.hidden = !isCb;
      els.externalCbBtn.disabled = !hasActiveSalesContext() || state.saveInProgress;
    }
    if (els.externalCbConfirmBtn) els.externalCbConfirmBtn.disabled = state.saveInProgress;
    if (els.externalCbCancelBtn) els.externalCbCancelBtn.disabled = state.saveInProgress;
    els.amountPaidInput.disabled = state.saveInProgress;
    if (els.sumupConfirmSuccessBtn) els.sumupConfirmSuccessBtn.disabled = state.saveInProgress;
    if (els.sumupConfirmFailBtn) els.sumupConfirmFailBtn.disabled = state.saveInProgress;
    if (els.sumupReturnBtn) els.sumupReturnBtn.disabled = state.saveInProgress;
  };

  const renderAll = ({ refreshProducts = false, deferProductRefresh = false } = {}) => {
    // Ne jamais changer les prix du catalogue au milieu d'un ticket.
    // Le nouveau catalogue sera appliqué seulement après ce ticket.
    if (state.pendingCatalogueUpdate &&
        state.ticketItems.length === 0 &&
        state.draftPack.length === 0 &&
        !state.saveInProgress) {
      state.catalogue = state.pendingCatalogueUpdate.catalogue;
      state.offresVente = state.pendingCatalogueUpdate.offresVente;
      lastTilesSignature = state.pendingCatalogueUpdate.signature;
      state.pendingCatalogueUpdate = null;
      state.pendingProductRefresh = true;
    }
    renderContext();
    renderModes();
    renderPackComposer();

    const mayRefreshInBackground = state.ticketItems.length === 0 && state.draftPack.length === 0;
    if (refreshProducts && deferProductRefresh && !mayRefreshInBackground) {
      state.pendingProductRefresh = true;
    }

    if ((refreshProducts && (!deferProductRefresh || mayRefreshInBackground)) ||
        (state.pendingProductRefresh && mayRefreshInBackground) ||
        els.productGrid.children.length === 0) {
      state.pendingProductRefresh = false;
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

  const createLocalTransactionId = () => {
    const unique = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12);
    return `TX_${Date.now()}_${unique}`;
  };

  const buildTransaction = ({
    provider = "",
    paymentStatus = "PAYE",
    status = "validee",
    foreignTxId = ""
  } = {}) => {
    const transactionId = foreignTxId || createLocalTransactionId();
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

  const saveVenteRapideBundleToApi = async (transaction, movements) => {
    const payload = {
      transaction,
      mouvements_stock: movements,
      mouvementsStock: movements
    };

    if (typeof api().saveVenteRapideBundle === "function") {
      return api().saveVenteRapideBundle(payload);
    }

    if (typeof api().post === "function") {
      return api().post("saveVenteRapideBundle", payload);
    }

    throw new Error("saveVenteRapideBundle indisponible.");
  };

  const saveTransactionToApi = async (transaction) => {
    if (!transactionHasValidContext(transaction)) {
      throw new Error("Transaction bloquée : mission_id ou journee_id manquant.");
    }

    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    const movements = buildStockMovementsFromTransaction(transaction);

    if (transaction.statut === "validee") {
      try {
        const result = await saveVenteRapideBundleToApi(transaction, movements);

        upsertLocalMouvementsStock(movements);
        saveLocalTransactionBackup(transaction);

        return {
          transaction: result,
          mouvements_stock_count: movements.length,
          bundle: true
        };
      } catch (error) {
        const message = String(error?.message || "");

        if (
          !message.includes("Action POST inconnue") &&
          !message.includes("saveVenteRapideBundle indisponible")
        ) {
          throw error;
        }

        console.warn(
          "saveVenteRapideBundle indisponible, fallback saveTransaction + batchUpsert utilisé.",
          error
        );
      }
    }

    if (typeof api().saveTransaction !== "function") {
      throw new Error("LugdurumAPI.saveTransaction() est indisponible.");
    }

    const result = await api().saveTransaction(transaction);

    if (transaction.statut === "validee") {
      await saveStockMovementsToApi(movements);
    }

    saveLocalTransactionBackup(transaction);

    return {
      transaction: result,
      mouvements_stock_count: movements.length,
      bundle: false
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
    // Conserver le format deja utilise par SumUp tant que la verification
    // automatique n'est pas activee. Evite de changer le Payment Switch
    // historique simplement en livrant le pilote desactive.
    if (!SUMUP_CONFIG.verificationEnabled ||
        !window.crypto || typeof window.crypto.randomUUID !== "function") {
      return `LUG_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    }

    // Seul le mode de verification API emploie la reference UUID longue.
    return `LUG_${Date.now()}_${window.crypto.randomUUID().toUpperCase()}`;
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
    resetSumupVerification();
  };

  const showSumupConfirm = (pending, message = "") => {
    if (!pending || !pending.transaction || !els.sumupConfirmOverlay) return;

    els.sumupConfirmOverlay.classList.remove("isConfirmed", "isApiVerified");
    if (els.sumupConfirmTitle) els.sumupConfirmTitle.textContent = "Paiement SumUp en cours";
    if (els.sumupSuccessHero) els.sumupSuccessHero.hidden = true;
    if (els.sumupPendingActions) els.sumupPendingActions.hidden = false;
    if (els.sumupSuccessActions) els.sumupSuccessActions.hidden = true;

    if (els.sumupConfirmSuccessBtn) {
      els.sumupConfirmSuccessBtn.textContent = "Confirmer manuellement";
      els.sumupConfirmSuccessBtn.disabled = state.saveInProgress || state.sumupManualBlocked;
    }

    els.sumupPendingAmount.textContent = formatCurrency(pending.transaction.total_encaisse_ttc);
    els.sumupPendingReference.textContent =
      pending.foreign_tx_id ? `Réf. ${pending.foreign_tx_id}` : "Référence SumUp en attente";

    els.sumupConfirmText.textContent =
      message ||
      "Vérification SumUp en cours. Si le paiement est bien confirmé dans SumUp, la confirmation manuelle reste possible.";

    els.sumupConfirmOverlay.hidden = false;
  };

  // L'API SumUp prouve le paiement ; Google Sheets peut encore être
  // en attente. Ne jamais confondre ces deux validations.
  const showSumupSuccess = (transaction, { apiVerified = false, pendingCount = 0 } = {}) => {
    if (!els.sumupConfirmOverlay) return;

    els.sumupConfirmOverlay.classList.add("isConfirmed");
    els.sumupConfirmOverlay.classList.toggle("isApiVerified", apiVerified);
    if (els.sumupConfirmTitle) {
      els.sumupConfirmTitle.textContent = apiVerified
        ? "PAIEMENT VALIDÉ !"
        : "Paiement confirmé";
    }
    if (els.sumupSuccessHero) els.sumupSuccessHero.hidden = false;
    if (els.sumupPendingActions) els.sumupPendingActions.hidden = true;
    if (els.sumupSuccessActions) els.sumupSuccessActions.hidden = false;

    els.sumupPendingAmount.textContent = formatCurrency(transaction.total_encaisse_ttc);
    els.sumupPendingReference.textContent = `Réf. ${transaction.transaction_id}`;
    els.sumupConfirmText.textContent = apiVerified
      ? "Paiement vérifié par SumUp. Ticket sauvegardé sur cet appareil." +
        (pendingCount ? " Synchronisation Google Sheets en cours." : " Synchronisation Google Sheets terminée.")
      : "Paiement confirmé manuellement dans Lugdurum." +
        (pendingCount ? " Synchronisation Google Sheets en cours." : " Ticket enregistré dans Google Sheets.");
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

  let sumupVerificationTimer = null;
  let sumupVerificationPromise = null;
  let sumupVerificationAttempts = 0;
  let sumupVerificationCurrentId = "";
  let sumupVerificationStopped = false;
  let sumupVerificationStartedAt = 0;

  const resetSumupVerification = () => {
    if (sumupVerificationTimer) window.clearTimeout(sumupVerificationTimer);
    sumupVerificationTimer = null;
    sumupVerificationAttempts = 0;
    sumupVerificationCurrentId = "";
    sumupVerificationStopped = false;
    sumupVerificationStartedAt = 0;
  };

  const scheduleSumupVerification = (delayMs = SUMUP_CONFIG.verificationRetryMs) => {
    if (sumupVerificationTimer || sumupVerificationStopped ||
        sumupVerificationAttempts >= SUMUP_CONFIG.verificationMaxAttempts) return;
    sumupVerificationTimer = window.setTimeout(() => {
      sumupVerificationTimer = null;
      verifyPendingSumup();
    }, Math.max(350, Math.min(3000, delayMs)));
  };

  const verifyPendingSumup = async () => {
    if (!SUMUP_CONFIG.verificationEnabled || state.saveInProgress ||
        navigator.onLine === false ||
        document.visibilityState === "hidden" ||
        !hasApi() || typeof api().verifySumupPayment !== "function") return;
    if (sumupVerificationPromise || sumupVerificationStopped) return;

    const pending = getPendingSumup();
    if (!pending?.transaction || !pending.foreign_tx_id) return;
    if (!/^LUG_[0-9]{13}_[0-9A-F]{8}-[0-9A-F-]{27}$/.test(pending.foreign_tx_id)) {
      showSumupConfirm(pending, "Ancienne référence SumUp : utilise la confirmation manuelle.");
      return;
    }

    if (sumupVerificationCurrentId !== pending.foreign_tx_id) {
      resetSumupVerification();
      sumupVerificationCurrentId = pending.foreign_tx_id;
    }
    if (sumupVerificationAttempts >= SUMUP_CONFIG.verificationMaxAttempts) return;

    sumupVerificationAttempts++;
    const expectedId = pending.foreign_tx_id;
    const requestStartedAt = Date.now();
    if (!sumupVerificationStartedAt) sumupVerificationStartedAt = requestStartedAt;
    showSumupConfirm(pending, "Vérification du paiement auprès de SumUp… (" +
      sumupVerificationAttempts + "/" + SUMUP_CONFIG.verificationMaxAttempts +
      "). La confirmation manuelle reste disponible.");

    sumupVerificationPromise = api().verifySumupPayment({
      foreignTxId: expectedId,
      amount: pending.transaction.total_encaisse_ttc,
      currency: SUMUP_CONFIG.currency
    });

    try {
      const result = await sumupVerificationPromise;
      const requestMs = Date.now() - requestStartedAt;
      const timing = result?.timing || null;
      const sumupMs = Number(timing?.sumup_fetch_ms);
      const backendMs = Number(timing?.apps_script_ms);
      const backendTiming = timing && timing.sumup_fetch_ms !== null &&
        Number.isFinite(sumupMs) && Number.isFinite(backendMs)
          ? " (SumUp " + (sumupMs / 1000).toFixed(1).replace(".", ",") +
            " s, Apps Script " + (backendMs / 1000).toFixed(1).replace(".", ",") + " s)"
          : "";
      const current = getPendingSumup();
      if (!current || current.foreign_tx_id !== expectedId || state.saveInProgress || sumupVerificationStopped) return;

      if (result?.verified === true && result?.status === "SUCCESSFUL" &&
          result?.foreign_tx_id === expectedId) {
        sumupVerificationStopped = true;
        showSumupConfirm(current, "Paiement confirmé par SumUp. Enregistrement du ticket…");
        await confirmSumupSuccess(result);
        return;
      }

      const status = String(result?.status || "").toUpperCase();
      if (status === "MISMATCH") {
        sumupVerificationStopped = true;
        state.sumupManualBlocked = true;
        showSumupConfirm(current, "Attention : montant, devise, compte ou référence incohérents. " +
          "Aucun ticket automatique créé. Vérifie dans SumUp avant toute confirmation.");
      } else if (["FAILED", "CANCELLED", "REFUNDED", "CHARGEBACK"].includes(status)) {
        sumupVerificationStopped = true;
        state.sumupManualBlocked = true;
        showSumupConfirm(current, "SumUp signale : " + status +
          ". Aucune vente automatique enregistrée.");
      } else if (["UNSUPPORTED_ID", "INVALID_REQUEST", "NOT_CONFIGURED", "NOT_AUTHORIZED"].includes(status)) {
        sumupVerificationStopped = true;
        showSumupConfirm(current, "Vérification impossible avec cette référence ; " +
          "confirmation manuelle disponible.");
      } else if (sumupVerificationAttempts < SUMUP_CONFIG.verificationMaxAttempts) {
        const notIndexed = status === "NOT_FOUND";
        const awaiting = status === "PENDING" || status === "IN_PROGRESS";
        const reason = notIndexed
          ? "Transaction encore absente de l'API SumUp"
          : awaiting
            ? "Paiement encore en attente dans l'API SumUp"
            : "Réponse de vérification SumUp : " + (status || "INCONNU");
        showSumupConfirm(
          current,
          reason + " (tentative " + sumupVerificationAttempts + "/" +
          SUMUP_CONFIG.verificationMaxAttempts + ", " +
          (requestMs / 1000).toFixed(1).replace(".", ",") +
          " s)" + backendTiming + ". Nouvelle tentative automatique… Tu peux confirmer manuellement si SumUp affiche déjà le règlement comme validé."
        );
        // Retenter vite après NOT_FOUND (indexation retardée), un peu plus
        // prudemment après erreur du serveur. Ne jamais valider sans SUCCESSFUL.
        scheduleSumupVerification(
          notIndexed || awaiting ? SUMUP_CONFIG.verificationRetryMs : 1100
        );
      } else {
        showSumupConfirm(
          current,
          "Vérification automatique terminée sans succès (dernier statut : " +
          (status || "INCONNU") + ", en " +
          ((Date.now() - sumupVerificationStartedAt) / 1000).toFixed(1).replace(".", ",") +
          " s)" + backendTiming + ". Vérifie le résultat dans SumUp avant toute confirmation manuelle."
        );
      }
    } catch (error) {
      const current = getPendingSumup();
      if (current?.foreign_tx_id === expectedId && !sumupVerificationStopped) {
        const requestMs = Date.now() - requestStartedAt;
        const hasRetry = sumupVerificationAttempts < SUMUP_CONFIG.verificationMaxAttempts;
        showSumupConfirm(
          current,
          "Vérification SumUp momentanément indisponible (" +
          String(error?.message || "réseau") + ", tentative " +
          sumupVerificationAttempts + "/" + SUMUP_CONFIG.verificationMaxAttempts +
          ", " + (requestMs / 1000).toFixed(1).replace(".", ",") + " s)." +
          (hasRetry ? " Nouvelle tentative automatique…" : " Dernière tentative terminée.") +
          " Si SumUp confirme le paiement, tu peux le valider manuellement."
        );
        if (hasRetry) scheduleSumupVerification(900);
      }
    } finally {
      sumupVerificationPromise = null;
    }
  };

  const checkPendingSumup = (message = "") => {
    const pending = getPendingSumup();
    if (!pending) return;
    showSumupConfirm(pending, message);
    if (SUMUP_CONFIG.verificationEnabled && !message) {
      verifyPendingSumup();
    }
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

    resetSumupVerification();
    state.sumupManualBlocked = false;
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

    setStatus(
      SUMUP_CONFIG.verificationEnabled
        ? "Ouverture de SumUp… Contrôle API pilote actif sur cet appareil. Confirmation manuelle toujours possible."
        : "Ouverture de SumUp… Confirme le paiement au retour.",
      "isSuccess"
    );
    showSumupConfirm(getPendingSumup());

    window.location.href = sumupUrl;
  };

  const confirmSumupSuccess = async (verification = null) => {
    if (state.saveInProgress) return;
    const pending = getPendingSumup();

    if (!pending || !pending.transaction) {
      hideSumupConfirm();
      return;
    }

    const isApiVerified = verification?.verified === true &&
      verification?.status === "SUCCESSFUL" &&
      verification?.foreign_tx_id === pending.foreign_tx_id;
    if (!isApiVerified && state.sumupManualBlocked) {
      showSumupConfirm(
        pending,
        "SumUp a signalé un refus ou une incohérence. Impossible de confirmer manuellement ce paiement : vérifie dans SumUp."
      );
      return;
    }
    const transaction = {
      ...pending.transaction,
      statut: "validee",
      paiement_statut: "PAYE",
      updated_at: new Date().toISOString(),
      note: [
        pending.transaction.note || "",
        pending.callback_status ? `Retour SumUp : ${pending.callback_status}` : "",
        isApiVerified
          ? `Vérifié par API SumUp · ${String(verification.transaction_code || "")}`
          : "Paiement confirmé manuellement dans Lugdurum"
      ].filter(Boolean).join("\n")
    };

    if (!transactionHasValidContext(transaction)) {
      setStatus(
        "Paiement non enregistré : mission ou journée manquante. Le ticket est conservé dans la popup SumUp.",
        "isError"
      );
      return;
    }

    // Le premier chemin (manuel ou API) verrouille avant tout appel réseau.
    // Une réponse API concurrente ne doit jamais lancer un deuxième ticket.
    sumupVerificationStopped = true;
    if (sumupVerificationTimer) window.clearTimeout(sumupVerificationTimer);
    sumupVerificationTimer = null;
    state.saveInProgress = true;
    renderPayment();
    showSumupConfirm(pending, isApiVerified
      ? "Paiement vérifié par SumUp. Sécurisation du ticket…"
      : "Confirmation manuelle : enregistrement du ticket…");

    try {
      // Après preuve API positive de SumUp : écrire durablement l'opération
      // dans la file locale, puis libérer la caisse sans attendre Google Sheets.
      // Confirmation manuelle : garder le chemin d'écriture existant.
      const queueFastPath = isApiVerified &&
        typeof api()?.queueVerifiedSumupSale === "function";
      if (queueFastPath) {
        const movements = buildStockMovementsFromTransaction(transaction);
        const result = api().queueVerifiedSumupSale({
          transaction,
          mouvements_stock: movements,
          mouvementsStock: movements
        });
        if (!result?.queued) {
          throw new Error("Le ticket n'a pas pu être conservé localement.");
        }
        upsertLocalMouvementsStock(movements);
        saveLocalTransactionBackup(transaction);
        state.lastQueuedVerifiedSumupId = transaction.transaction_id;
      } else {
        await saveTransactionToApi(transaction);
      }

      clearPendingSumup();

      const pendingCount = hasApi() && typeof api().getPendingWritesCount === "function"
        ? api().getPendingWritesCount()
        : 0;

      showSumupSuccess(transaction, { apiVerified: isApiVerified, pendingCount });

      setStatus(
        queueFastPath
          ? `Paiement confirmé par SumUp · ticket sauvegardé sur cet appareil · synchronisation en cours (${pendingCount} en attente) · ${formatCurrency(transaction.total_encaisse_ttc)}`
          : pendingCount > 0
            ? `Paiement SumUp validé · ticket et stock en attente de synchronisation · ${formatCurrency(transaction.total_encaisse_ttc)}`
            : `Paiement SumUp validé · ${formatCurrency(transaction.total_encaisse_ttc)}`,
        queueFastPath || pendingCount > 0 ? "isError" : "isSuccess"
      );

      state.ticketItems = [];
      state.draftPack = [];
      els.amountPaidInput.value = "";
      state.amountManuallyEdited = false;
      renderAll();
      if (!queueFastPath) refreshDaySummaryAfterSale();
      if (state.deferredLoadForSumup) schedulePostSumupDataLoad();
    } catch (error) {
      setStatus(`Paiement validé, mais erreur d’enregistrement : ${error.message}. Réessaie le même ticket après vérification.`, "isError");
    } finally {
      state.saveInProgress = false;
      if (state.pendingCatalogueUpdate &&
          state.ticketItems.length === 0 && state.draftPack.length === 0) {
        renderAll();
      } else {
        renderPayment();
      }
    }
  };

  const confirmSumupFailure = () => {
    if (state.saveInProgress) return;
    const pending = getPendingSumup();

    if (pending?.transaction) {
      restoreTicketFromTransaction(pending.transaction);
    }

    clearPendingSumup();
    state.sumupManualBlocked = false;
    hideSumupConfirm();

    setStatus(
      "Paiement SumUp non validé. Le panier est conservé : tu peux réessayer ou changer le paiement.",
      "isError"
    );
    if (state.deferredLoadForSumup) schedulePostSumupDataLoad();

    renderAll({ refreshProducts: true });
  };

  const reopenSumup = () => {
    if (state.saveInProgress) return;
    const pending = getPendingSumup();

    if (!pending?.sumup_url) {
      setStatus("Aucun paiement SumUp en attente.", "isError");
      hideSumupConfirm();
      return;
    }

    window.location.href = pending.sumup_url;
  };

  // CB encaissee sur un autre telephone (Tap to Pay / autre terminal).
  // Ne pas initier de paiement bancaire ni attribuer une verification SumUp.
  const showExternalCbConfirm = () => {
    if (state.saveInProgress || state.paymentMode !== "CB") return;
    if (!hasActiveSalesContext()) {
      showMissingContextStatus();
      return;
    }
    if (!state.ticketItems.length) {
      setStatus("Ajoute au moins un produit avant d'enregistrer cette CB.", "isError");
      return;
    }
    if (state.draftPack.length) {
      setStatus("Termine ou vide le coffret en cours avant d'enregistrer cette CB.", "isError");
      return;
    }
    if (getPendingSumup()) {
      setStatus(
        "Un paiement SumUp est encore en attente sur ce telephone. Termine ou annule d'abord cette tentative pour eviter une vente en double.",
        "isError"
      );
      return;
    }
    if (!els.externalCbOverlay) return;

    const inputAmount = Number(String(els.amountPaidInput.value).replace(",", "."));
    const total = Number.isFinite(inputAmount) && inputAmount > 0
      ? inputAmount : getTicketTotal();
    els.externalCbAmount.textContent = formatCurrency(total);
    els.externalCbStatus.textContent = "";
    els.externalCbOverlay.hidden = false;
  };

  const closeExternalCbConfirm = () => {
    if (state.saveInProgress || !els.externalCbOverlay) return;
    els.externalCbOverlay.hidden = true;
  };

  const confirmExternalCbSale = async () => {
    if (state.saveInProgress || !els.externalCbOverlay || els.externalCbOverlay.hidden) return;
    if (state.paymentMode !== "CB" || getPendingSumup()) return;
    const saved = await saveTicket({ externalCb: true });
    if (saved) {
      els.externalCbOverlay.hidden = true;
    } else if (els.externalCbStatus) {
      els.externalCbStatus.textContent =
        "Enregistrement non confirme. Ne ressaisis pas la vente ailleurs : reessaie ici avec le meme ticket.";
    }
  };

  const getTicketFingerprint = () => JSON.stringify({
    mission_id: state.journeeActive.mission_id,
    journee_id: state.journeeActive.journee_id,
    payment: state.paymentMode,
    amount: els.amountPaidInput.value,
    items: state.ticketItems
  });

  const saveTicket = async ({ externalCb = false } = {}) => {
    if (state.saveInProgress) return false;
    if (!hasActiveSalesContext()) {
      showMissingContextStatus();
      return;
    }

    if (state.paymentMode === "CB" && !externalCb) {
      launchSumupPayment();
      return false;
    }
    if (externalCb && (state.paymentMode !== "CB" || getPendingSumup())) {
      setStatus("Paiement CB externe impossible : mode incorrect ou tentative SumUp encore en attente.", "isError");
      return false;
    }

    if (state.ticketItems.length === 0) {
      setStatus("Ajoute au moins un produit avant d’enregistrer.", "isError");
      return;
    }

    if (state.draftPack.length > 0) {
      setStatus("Tu as un coffret en cours non ajouté au ticket.", "isError");
      return;
    }

    const fingerprint = getTicketFingerprint();
    const transaction = state.failedTicket?.fingerprint === fingerprint
      ? state.failedTicket.transaction
      : buildTransaction({
          provider: externalCb ? "EXTERNE" : "",
          paymentStatus: "PAYE",
          status: "validee"
        });

    // Une CB externe est declaree par le vendeur, jamais verifiee par l'API SumUp.
    if (externalCb && transaction.paiement_provider === "EXTERNE") {
      transaction.note = "CB encaissee sur un autre appareil / Tap to Pay, confirmee manuellement dans Lugdurum.";
    }

    // Une tentative rejouée sur le même panier garde son transaction_id.
    state.failedTicket = { fingerprint, transaction };
    state.saveInProgress = true;
    renderPayment();

    try {
      await saveTransactionToApi(transaction);

      state.failedTicket = null;
      const pendingCount = hasApi() && typeof api().getPendingWritesCount === "function"
        ? api().getPendingWritesCount()
        : 0;

      setStatus(
        pendingCount > 0
          ? `${externalCb ? "CB externe déclarée" : "Ticket"} · ticket et stock en attente de synchronisation · ${formatCurrency(transaction.total_encaisse_ttc)}`
          : `${externalCb ? "CB externe enregistrée (sans SumUp sur cet appareil)" : "Ticket enregistré"} · sortie de stock enregistrée · ${formatCurrency(transaction.total_encaisse_ttc)}`,
        pendingCount > 0 ? "isError" : "isSuccess"
      );

      state.ticketItems = [];
      state.draftPack = [];
      els.amountPaidInput.value = "";
      state.amountManuallyEdited = false;
      renderAll();
      refreshDaySummaryAfterSale();
      return true;
    } catch (error) {
      setStatus(`Enregistrement incertain : ${error.message}. Réessaie SANS modifier le panier pour conserver le même ID et éviter un doublon.`, "isError");
      return false;
    } finally {
      state.saveInProgress = false;
      if (state.pendingCatalogueUpdate &&
          state.ticketItems.length === 0 && state.draftPack.length === 0) {
        renderAll();
      } else {
        renderPayment();
      }
    }
  };

  const loadRemoteContextBundle = async () => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    if (typeof api().getVenteRapideContextData === "function") {
      const result = await api().getVenteRapideContextData({
        stock_mission_id: state.journeeActive.mission_id,
        journee_id: state.journeeActive.journee_id
      });

      return {
        missionsStock: getCoreArray(result, "missionsStock"),
        journees: getCoreArray(result, "journees"),
        transactions: getCoreArray(result, "transactions")
      };
    }

    if (typeof api().getCoreData === "function") {
      const result = await api().getCoreData([
        "missionsStock",
        "journees",
        "transactions"
      ]);

      return {
        missionsStock: getCoreArray(result, "missionsStock"),
        journees: getCoreArray(result, "journees"),
        transactions: getCoreArray(result, "transactions")
      };
    }

    const [missionsStock, journees, transactions] = await Promise.all([
      typeof api().getMissionsStock === "function"
        ? api().getMissionsStock()
        : Promise.resolve([]),
      typeof api().getJournees === "function"
        ? api().getJournees()
        : Promise.resolve([]),
      typeof api().getTransactions === "function"
        ? api().getTransactions()
        : Promise.resolve([])
    ]);

    return {
      missionsStock: Array.isArray(missionsStock) ? missionsStock : [],
      journees: Array.isArray(journees) ? journees : [],
      transactions: Array.isArray(transactions) ? transactions : []
    };
  };

  // Les identifiants locaux sont propres à chaque iPhone. La relation
  // journees_vente.stock_mission_id est la source de vérité pour deux vendeurs.
  const selectSharedSalesContext = (
    missionsStock,
    journees,
    { stockMissionId = "", journeeId = "", explicitUrl = false } = {}
  ) => {
    const ignore = (item) => {
      const status = normalizeKey(item?.statut || "");
      return status.includes("annule") || status.includes("clotur") ||
        status.includes("clôtur");
    };
    const missions = (missionsStock || []).filter((mission) =>
      !ignore(mission) && String(mission.mission_id || "").trim()
    );
    const byId = new Map(missions.map((mission) => [String(mission.mission_id).trim(), mission]));
    const choices = (journees || [])
      .filter((day) => !ignore(day))
      .map((day) => {
        const linkedId = String(day.stock_mission_id || day.mission_stock_id || "").trim();
        const mission = byId.get(linkedId);
        if (!mission) return null;
        return { mission, journee: day };
      })
      .filter(Boolean);

    const date = new Date();
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const isToday = (choice) => String(choice.journee.date || "").slice(0, 10) === today;
    const requestedDay = String(journeeId || "").trim();
    const requestedStock = String(stockMissionId || "").trim();

    // Un lien explicite depuis l'accueil l'emporte sur l'ancien cache.
    if (explicitUrl && requestedDay) {
      const matched = choices.find((choice) => choice.journee.journee_id === requestedDay);
      if (matched) return matched;
    }

    if (requestedStock) {
      const linked = choices.filter((choice) => choice.mission.mission_id === requestedStock);
      const todayChoice = linked.find(isToday);
      if (todayChoice) return todayChoice;
      const requestedChoice = linked.find((choice) => choice.journee.journee_id === requestedDay);
      if (requestedChoice) return requestedChoice;
      if (linked.length === 1) return linked[0];
    }

    if (requestedDay) {
      const matched = choices.find((choice) => choice.journee.journee_id === requestedDay);
      if (matched && isToday(matched)) return matched;
    }

    const todayChoices = choices.filter(isToday);
    const inProgress = todayChoices.filter((choice) => normalizeKey(choice.journee.statut) === "en_cours");
    if (inProgress.length === 1) return inProgress[0];
    if (todayChoices.length === 1) return todayChoices[0];

    // Plusieurs événements en parallèle : ne surtout pas choisir au hasard.
    return null;
  };

  const loadContext = async () => {
    const context = readJson(STORAGE_KEYS.preparationContext, null);
    const url = new URLSearchParams(window.location.search || "");
    const urlStockId = url.get("stock_mission_id") || "";
    const urlJourneeId = url.get("journee_id") || "";
    const stockMissionId = urlStockId ||
      context?.stock_mission_id || context?.mission_id ||
      localStorage.getItem(STORAGE_KEYS.activeStockMissionId) ||
      localStorage.getItem(STORAGE_KEYS.activeMissionId) || "";
    const journeeId = urlJourneeId ||
      context?.journee_id || localStorage.getItem(STORAGE_KEYS.activeJourneeId) || "";
    const currentUserId = hasApi() && typeof api().getCurrentUserId === "function"
      ? api().getCurrentUserId() : "";

    state.journeeActive = {
      ...EMPTY_JOURNEE_ACTIVE,
      user_id: currentUserId || EMPTY_JOURNEE_ACTIVE.user_id,
      mission_id: stockMissionId,
      journee_id: journeeId,
      label: stockMissionId && journeeId ? "Journée active" : "Recherche de la journée partagée…",
      date_label: stockMissionId && journeeId ? "Contexte local, vérification réseau…" : "Recherche dans Google Sheets…"
    };
    state.daySummary = { ...state.daySummary, isLoading: true, lastError: "" };
    renderAll();

    try {
      // Même sans aucune information locale : lire les journées communes.
      const remote = await loadRemoteContextBundle();
      state.missionsStock = remote.missionsStock;
      state.journees = remote.journees;

      const selected = selectSharedSalesContext(
        state.missionsStock, state.journees,
        {
          stockMissionId,
          journeeId,
          explicitUrl: Boolean(urlStockId || urlJourneeId)
        }
      );

      if (!selected) {
        state.journeeActive = {
          ...state.journeeActive, mission_id: "", journee_id: "",
          label: "Journée non sélectionnée",
          date_label: "Sélectionne Gerzat sur l'accueil, puis ouvre Journée de vente."
        };
        state.sharedStock = null;
        state.daySummary = {
          ...state.daySummary, isLoading: false, isLoaded: false,
          revenue: 0, tickets: 0, lastError: "Aucune journée partagée unique pour aujourd'hui."
        };
        setStatus(
          "Plusieurs journées possibles ou aucune journée aujourd'hui. Choisis l'événement sur l'accueil.",
          "isError"
        );
        return;
      }

      const mission = selected.mission;
      const journee = selected.journee;
      const resolvedStockId = String(mission.mission_id).trim();
      const resolvedDayId = String(journee.journee_id).trim();
      state.sharedStock = mission;
      state.journeeActive = {
        ...state.journeeActive,
        mission_id: resolvedStockId,
        journee_id: resolvedDayId,
        label: [mission.nom || "Mission", journee.jour_label || ""].filter(Boolean).join(" — "),
        date_label: journee.date ? formatDisplayDateLong(journee.date) : ""
      };

      // Le prochain lancement de la PWA sur CE téléphone retrouvera le même
      // stock, sans partager une file offline ni une identité de vendeur.
      localStorage.setItem(STORAGE_KEYS.activeMissionId, resolvedStockId);
      localStorage.setItem(STORAGE_KEYS.activeStockMissionId, resolvedStockId);
      localStorage.setItem(STORAGE_KEYS.activeJourneeId, resolvedDayId);
      writeJson(STORAGE_KEYS.preparationContext, {
        mission_id: resolvedStockId,
        stock_mission_id: resolvedStockId,
        journee_id: resolvedDayId,
        step: "vente_rapide",
        updated_at: new Date().toISOString()
      });

      setDaySummaryFromTransactions(remote.transactions);
      setStatus("");
    } catch (error) {
      console.warn("Contexte partagé non chargé depuis Sheets.", error);
      state.daySummary = {
        ...state.daySummary, isLoading: false,
        lastError: error.message || "Lecture réseau impossible."
      };
      if (!hasActiveSalesContext()) {
        showMissingContextStatus();
      }
    } finally {
      state.contextLoaded = true;
      renderAll();
    }
  };

  const loadVenteRapideData = async () => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    if (typeof api().getVenteRapideData === "function") {
      const result = await api().getVenteRapideData();

      return {
        catalogueRows: getCoreArray(result, "catalogue"),
        offresRows: getCoreArray(result, "offresVente")
      };
    }

    if (typeof api().getCoreData === "function") {
      const result = await api().getCoreData([
        "catalogue",
        "offresVente"
      ]);

      return {
        catalogueRows: getCoreArray(result, "catalogue"),
        offresRows: getCoreArray(result, "offresVente")
      };
    }

    if (
      typeof api().getCatalogue !== "function" ||
      typeof api().getOffresVente !== "function"
    ) {
      throw new Error("Méthodes catalogue / offres introuvables dans lugdurum-api.js.");
    }

    const [catalogueRows, offresRows] = await Promise.all([
      api().getCatalogue(),
      api().getOffresVente()
    ]);

    return {
      catalogueRows: Array.isArray(catalogueRows) ? catalogueRows : [],
      offresRows: Array.isArray(offresRows) ? offresRows : []
    };
  };

  // Signature de l'affichage : recharger les mêmes offres ne remplace pas les
  // boutons (important pour éviter de perdre un tap pendant la synchronisation).
  const getTilesSignature = (catalogue = state.catalogue, offresVente = state.offresVente) => JSON.stringify([
    catalogue.map((product) => [
      product.sku_id, product.parfum_nom, product.format_cl, product.actif,
      product.visible_webapp, product.vendable_seul, product.composable_coffret,
      product.ordre_affichage, product.gamme_tarif, product.image_src
    ]),
    offresVente.map((offer) => [
      offer.offre_id, offer.actif, offer.type_offre, offer.format_cl,
      offer.gamme_tarif, offer.prix_ttc, offer.prix_ht, offer.quantite_bouteilles
    ])
  ]);
  let lastTilesSignature = "";

  // Affichage instantané depuis les dernières données connues, sans requête.
  // Les caches ne sont JAMAIS utilisés pour dédupliquer les ventes : les tickets
  // conservent leur transaction_id et leur file d'attente API indépendants.
  const hydrateCatalogueFromCache = () => {
    const catalogueRows = readCachedArray(STORAGE_KEYS.catalogueCache);
    const offresRows = readCachedArray(STORAGE_KEYS.offresVenteCache);
    if (!catalogueRows.length || !offresRows.length) return false;

    state.catalogue = catalogueRows
      .map((row, index) => normalizeProduct(row, index))
      .filter((product) => product.sku_id && product.parfum_code && product.format_cl);
    state.offresVente = offresRows
      .map((row, index) => normalizeOffer(row, index))
      .filter((offer) => offer.offre_id && offer.type_offre && offer.format_cl);
    if (!state.catalogue.length || !state.offresVente.length) return false;

    state.dataLoaded = true;
    state.catalogueSource = "cache";
    lastTilesSignature = getTilesSignature();
    renderAll({ refreshProducts: true });
    setStatus("Produits disponibles (cache local) · vérification des tarifs en cours.");
    return true;
  };

  const loadData = async () => {
    if (state.catalogue.length === 0) renderProducts();

    try {
      const { catalogueRows, offresRows } = await loadVenteRapideData();

      const catalogue = catalogueRows
        .map((row, index) => normalizeProduct(row, index))
        .filter((product) => product.sku_id && product.parfum_code && product.format_cl);
      const offresVente = offresRows
        .map((row, index) => normalizeOffer(row, index))
        .filter((offer) => offer.offre_id && offer.type_offre && offer.format_cl);

      const signature = getTilesSignature(catalogue, offresVente);
      const tilesChanged = signature !== lastTilesSignature;
      const hasActiveTicket = state.ticketItems.length > 0 ||
        state.draftPack.length > 0 || state.saveInProgress;

      state.mouvementsStock = [];
      state.dataLoaded = true;
      state.catalogueSource = "online";

      if (tilesChanged && hasActiveTicket && state.catalogue.length > 0) {
        // Ne pas afficher un prix cache tout en utilisant un prix réseau différent.
        state.pendingCatalogueUpdate = { catalogue, offresVente, signature };
      } else {
        state.catalogue = catalogue;
        state.offresVente = offresVente;
        lastTilesSignature = signature;
        state.pendingCatalogueUpdate = null;
      }

      writeCachedArray(STORAGE_KEYS.catalogueCache, catalogue);
      writeCachedArray(STORAGE_KEYS.offresVenteCache, offresVente);

      if (offresVente.length === 0) {
        setStatus("Catalogue chargé, mais aucune offre de vente active trouvée.", "isError");
      } else if (state.pendingCatalogueUpdate) {
        setStatus("Tarifs mis à jour : ils seront appliqués après le ticket en cours.");
      } else if (hasActiveSalesContext()) {
        setStatus("");
      }

      renderAll({ refreshProducts: tilesChanged && !state.pendingCatalogueUpdate, deferProductRefresh: true });
    } catch (error) {
      const cachedCatalogue = readCachedArray(STORAGE_KEYS.catalogueCache);
      const cachedOffres = readCachedArray(STORAGE_KEYS.offresVenteCache);

      if (cachedCatalogue.length > 0 || cachedOffres.length > 0) {
        state.catalogue = cachedCatalogue.map((row, index) => normalizeProduct(row, index));
        state.offresVente = cachedOffres.map((row, index) => normalizeOffer(row, index));
        state.mouvementsStock = [];
        state.dataLoaded = true;
        state.catalogueSource = "cache";

        setStatus(
          "Connexion catalogue indisponible · produits et tarifs du cache local.",
          "isError"
        );
        renderAll({ refreshProducts: state.pendingProductRefresh });
        return;
      }

      state.dataLoaded = true;
      state.catalogueSource = "error";
      state.catalogue = [];
      state.offresVente = [];
      state.mouvementsStock = [];

      setStatus(`Impossible de charger les données : ${error.message}`, "isError");
      renderAll({ refreshProducts: true });
    }
  };

  document.addEventListener("click", (event) => {
    if (state.saveInProgress) return;
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
    if (state.saveInProgress) return;
    state.draftPack = [];
    setStatus("");
    renderAll();
  });

  els.addPackBtn.addEventListener("click", () => { if (!state.saveInProgress) addPackToTicket(); });
  els.clearTicketBtn.addEventListener("click", () => { if (!state.saveInProgress) clearTicket(); });
  els.undoBtn.addEventListener("click", () => { if (!state.saveInProgress) undoLast(); });
  els.saveTicketBtn.addEventListener("click", () => saveTicket());
  els.refreshDaySummaryBtn?.addEventListener("click", () => {
    if (state.saveInProgress || getPendingSumup()) return;
    loadContext().catch(console.warn);
  });
  els.externalCbBtn?.addEventListener("click", showExternalCbConfirm);
  els.externalCbConfirmBtn?.addEventListener("click", confirmExternalCbSale);
  els.externalCbCancelBtn?.addEventListener("click", closeExternalCbConfirm);

  if (els.sumupConfirmSuccessBtn) {
    els.sumupConfirmSuccessBtn.addEventListener("click", () => {
      confirmSumupSuccess();
    });
  }

  if (els.sumupConfirmFailBtn) {
    els.sumupConfirmFailBtn.addEventListener("click", confirmSumupFailure);
  }

  if (els.sumupReturnBtn) {
    els.sumupReturnBtn.addEventListener("click", reopenSumup);
  }
  if (els.sumupContinueBtn) {
    els.sumupContinueBtn.addEventListener("click", () => {
      if (!state.saveInProgress) hideSumupConfirm();
    });
  }

  // Sur iOS, focus et visibilitychange arrivent souvent ensemble au retour
  // de SumUp. Une seule lecture des transactions suffit.
  let resumeSummaryTimer = null;
  const refreshSummaryOnResume = () => {
    // Vérification du paiement prioritaire : ne pas lancer une lecture
    // de toutes les transactions au même moment qu'un retour SumUp.
    if (!hasActiveSalesContext() || getPendingSumup() || state.saveInProgress) return;
    if (resumeSummaryTimer) window.clearTimeout(resumeSummaryTimer);
    resumeSummaryTimer = window.setTimeout(() => {
      resumeSummaryTimer = null;
      loadDaySummaryFromNetwork({ silent: true }).catch(console.warn);
    }, 350);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    checkPendingSumup();
    refreshSummaryOnResume();
  });

  window.addEventListener("focus", () => {
    checkPendingSumup();
    refreshSummaryOnResume();
  });

  // Le CA est commun aux deux vendeurs, pas aux caches de leurs téléphones.
  // Réseau seulement en avant-plan et sans concurrence avec SumUp / sync.
  window.setInterval?.(() => {
    if (document.visibilityState === "hidden" ||
        state.daySummary.isLoading || state.saveInProgress ||
        getPendingSumup() || !hasActiveSalesContext()) return;
    loadDaySummaryFromNetwork({ silent: true }).catch(console.warn);
  }, 90000);

  window.addEventListener("lugdurum:sync-status", (event) => {
    const detail = event.detail || {};
    const pendingCount = Number(detail.pending_count || 0);

    if (state.lastQueuedVerifiedSumupId) {
      if (pendingCount === 0 && ["synced", "idle"].includes(detail.status)) {
        state.lastQueuedVerifiedSumupId = "";
        setStatus("Ticket SumUp et sorties de stock synchronisés avec Google Sheets.", "isSuccess");
        refreshDaySummaryAfterSale();
      } else if (detail.status === "error") {
        setStatus(
          `Paiement SumUp confirmé, mais synchronisation en erreur (${pendingCount} en attente). Conserve les données locales et consulte le diagnostic synchro.`,
          "isError"
        );
      }
      return;
    }

    if (pendingCount > 0 && state.ticketItems.length === 0 && !getPendingSumup()) {
      setStatus(`${pendingCount} écriture(s) en attente de synchronisation.`, "isError");
    }
  });

  // Une PWA relancée au retour de SumUp ne doit pas concurrencer la
  // vérification du paiement avec getCoreData (parfois plusieurs secondes).
  let postSumupLoadTimer = null;
  const schedulePostSumupDataLoad = () => {
    if (!state.deferredLoadForSumup || postSumupLoadTimer) return;
    state.deferredLoadForSumup = false;
    postSumupLoadTimer = window.setTimeout(() => {
      postSumupLoadTimer = null;
      loadContext();
      loadData();
    }, 2500);
  };

  handleSumupCallbackParams();
  if (!hydrateCatalogueFromCache()) renderAll();

  const waitingSumup = getPendingSumup();
  if (waitingSumup?.transaction) {
    // Contexte local fiable du ticket sauvegardé AVANT d'ouvrir SumUp.
    // Aucun chargement des transactions Sheets avant vérification.
    state.deferredLoadForSumup = true;
    const transaction = waitingSumup.transaction;
    state.journeeActive = {
      ...state.journeeActive,
      mission_id: transaction.stock_mission_id || transaction.mission_id || "",
      journee_id: transaction.journee_id || "",
      user_id: transaction.user_id || state.journeeActive.user_id,
      label: "Journée active",
      date_label: "Contexte local chargé"
    };
    renderAll();
    checkPendingSumup();
  } else {
    loadContext();
    loadData();
    checkPendingSumup();
  }
})();