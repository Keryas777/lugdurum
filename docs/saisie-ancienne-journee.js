(() => {
  "use strict";

  /*
    Saisie ancienne journée V5 :
    - Création OU modification d’une journée clôturée historique.
    - Mode édition via saisie-ancienne-journee.html?mode=edit&journee_id=...
    - Charge catalogue + offres depuis Google Sheets.
    - En édition, charge journée, missions, transactions, ventes_lignes et frais.
    - Écrit uniquement via LugdurumAPI.
    - IDs stables pour éviter les doublons.
    - Les lignes / transactions / frais retirés sont marqués annule/annulee.
    - Après succès réel API, retour automatique vers la page précédente ou journees-cloturees.html.
    - Produits vendus affichés avec les mêmes tuiles visuelles que Préparation stock.
    - Mode historique : affiche aussi les parfums inactifs / anciens pour permettre la saisie d’anciens marchés.
    - Anti-clignotement : les clics + / - ne reconstruisent plus toute la grille produits.
  */

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme"
  };

  const HISTORICAL_SOURCE = "SAISIE_HISTORIQUE";

  const EVENT_TYPE_LABELS = {
    MARCHE_ARTISANAL: "Marché artisanal",
    SALON_DES_VINS: "Salon des vins",
    MARCHE_DE_NOEL: "Marché de Noël",
    FOIRE: "Foire",
    CAVISTE: "Caviste / pro",
    COMMANDE_DIRECTE: "Commande directe",
    AUTRE: "Autre"
  };

  const EXPENSE_LABELS = {
    EMPLACEMENT: "Emplacement",
    ESSENCE: "Essence",
    PEAGE: "Péage",
    REPAS: "Repas",
    HEBERGEMENT: "Hébergement",
    MATERIEL: "Matériel",
    COMMUNICATION: "Communication",
    CONSOMMABLES: "Consommables",
    AUTRE: "Autre"
  };

  const PAYMENT_ROWS = [
    {
      key: "CB",
      label: "Carte bancaire",
      inputId: "amountCbInput",
      provider: "HISTORIQUE"
    },
    {
      key: "ESP",
      label: "Espèces",
      inputId: "amountCashInput",
      provider: "HISTORIQUE"
    },
    {
      key: "CHQ",
      label: "Chèque",
      inputId: "amountCheckInput",
      provider: "HISTORIQUE"
    }
  ];

  const STORAGE_KEYS = {
    catalogueCache: "lugdurum_catalogue_cache",
    offresVenteCache: "lugdurum_offres_vente_cache"
  };

  const urlParams = new URLSearchParams(window.location.search);
  const EDIT_JOURNEE_ID = String(urlParams.get("journee_id") || "").trim();
  const IS_EDIT_MODE = Boolean(EDIT_JOURNEE_ID);

  const state = {
    catalogue: [],
    offresVente: [],
    quantities: new Map(),
    expenses: [],
    isSaving: false,
    dataLoaded: false,
    edit: {
      isEditMode: IS_EDIT_MODE,
      journeeId: EDIT_JOURNEE_ID,
      loaded: false,
      existing: {
        journee: null,
        missionVente: null,
        missionStock: null,
        transactions: [],
        saleLines: [],
        frais: []
      }
    }
  };

  const els = {
    pageTitle: document.getElementById("oldDayPageTitle"),
    heroTitle: document.getElementById("oldDayHeroTitle"),
    heroText: document.getElementById("oldDayHeroText"),
    finalTitle: document.getElementById("oldDayFinalTitle"),

    form: document.getElementById("oldDayForm"),
    eventNameInput: document.getElementById("eventNameInput"),
    eventDateInput: document.getElementById("eventDateInput"),
    eventTypeInput: document.getElementById("eventTypeInput"),
    cityInput: document.getElementById("cityInput"),
    placeInput: document.getElementById("placeInput"),
    dayLabelInput: document.getElementById("dayLabelInput"),
    noteInput: document.getElementById("noteInput"),
    amountCbInput: document.getElementById("amountCbInput"),
    amountCashInput: document.getElementById("amountCashInput"),
    amountCheckInput: document.getElementById("amountCheckInput"),
    paymentTotal: document.getElementById("paymentTotal"),
    heroRevenue: document.getElementById("heroRevenue"),
    heroBottles: document.getElementById("heroBottles"),
    productRows: document.getElementById("productRows"),
    clearProductsBtn: document.getElementById("clearProductsBtn"),
    catalogueTotal: document.getElementById("catalogueTotal"),
    expenseCategoryInput: document.getElementById("expenseCategoryInput"),
    expenseAmountInput: document.getElementById("expenseAmountInput"),
    expenseNoteInput: document.getElementById("expenseNoteInput"),
    addExpenseBtn: document.getElementById("addExpenseBtn"),
    expenseList: document.getElementById("expenseList"),
    saveOldDayBtn: document.getElementById("saveOldDayBtn"),
    oldDayStatus: document.getElementById("oldDayStatus")
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

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value || 0);

  const formatAmount = (value) =>
    Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;

  const formatIsoDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const slugify = (value, fallback = "HIST") =>
    String(value || fallback)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || fallback;

  const setStatus = (message, type = "") => {
    els.oldDayStatus.textContent = message;
    els.oldDayStatus.className = "oldDayStatus";

    if (type) {
      els.oldDayStatus.classList.add(type);
    }
  };

  const setSaving = (isSaving) => {
    state.isSaving = isSaving;

    [
      els.saveOldDayBtn,
      els.clearProductsBtn,
      els.addExpenseBtn
    ].forEach((button) => {
      if (button) button.disabled = isSaving;
    });
  };

  const getReturnUrl = () => {
    const returnUrl = urlParams.get("return_url");

    if (returnUrl && !returnUrl.startsWith("http")) {
      return returnUrl;
    }

    try {
      if (document.referrer) {
        const referrerUrl = new URL(document.referrer);
        const currentUrl = new URL(window.location.href);

        if (
          referrerUrl.origin === currentUrl.origin &&
          referrerUrl.pathname !== currentUrl.pathname
        ) {
          return referrerUrl.href;
        }
      }
    } catch {
      // fallback ci-dessous
    }

    return "./journees-cloturees.html";
  };

  const redirectAfterSave = () => {
    window.setTimeout(() => {
      window.location.href = getReturnUrl();
    }, 850);
  };

  const isValidStatus = (item) => {
    const statut = String(item?.statut || item?.paiement_statut || "valide")
      .trim()
      .toLowerCase();

    return ![
      "annule",
      "annulee",
      "annulé",
      "annulée",
      "refuse",
      "refusé",
      "refusee",
      "refusée"
    ].includes(statut);
  };

  const getJourneeId = (item) =>
    String(item?.journee_id || "").trim();

  const getTransactionId = (item) =>
    String(item?.transaction_id || "").trim();

  const getTransactionAmount = (transaction) =>
    toNumber(
      transaction.total_encaisse_ttc ??
      transaction.total_encaisse ??
      transaction.total_catalogue_ttc ??
      transaction.total_catalogue,
      0
    );

  const getPaymentKey = (transaction) =>
    String(transaction.mode_paiement || transaction.paiement_provider || transaction.source || "")
      .trim()
      .toUpperCase();

  const configureModeLabels = () => {
    if (!state.edit.isEditMode) return;

    if (els.pageTitle) els.pageTitle.textContent = "Modifier historique";
    if (els.heroTitle) els.heroTitle.textContent = "Modifier une journée";
    if (els.heroText) {
      els.heroText.textContent =
        "Complète ou corrige une journée historique existante sans créer de doublons.";
    }
    if (els.finalTitle) els.finalTitle.textContent = "Enregistrer les modifications";
    if (els.saveOldDayBtn) els.saveOldDayBtn.textContent = "Enregistrer les modifications";
  };

  const normalizeProduct = (raw, index) => {
    const code = String(raw.parfum_code || "")
      .trim()
      .toUpperCase();

    const formatCl = toNumber(raw.format_cl, 0);

    return {
      sku_id: String(raw.sku_id || `${code}_${formatCl}`).trim(),
      parfum_code: code,
      parfum_nom: String(raw.parfum_nom || code).trim(),
      format_cl: formatCl,
      gamme_tarif: String(raw.gamme_tarif || "").trim(),
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
      note: String(raw.note || "").trim(),
      image_src: String(raw.image_src || "").trim()
    };
  };

  const getProductImageSrc = (product) =>
    String(product?.image_src || "").trim() ||
    `./assets/parfums/${String(product?.parfum_code || "").toLowerCase()}.webp`;

  const normalizeOffer = (raw, index) => ({
    offre_id: String(raw.offre_id || "").trim(),
    libelle: String(raw.libelle || raw.offre_id || "").trim(),
    type_offre: String(raw.type_offre || "").trim().toLowerCase(),
    format_cl: toNumber(raw.format_cl, 0),
    gamme_tarif: String(raw.gamme_tarif || "").trim(),
    quantite_bouteilles: toNumber(raw.quantite_bouteilles, 0),
    prix_ttc: toNumber(raw.prix_ttc, 0),
    prix_ht: toNumber(raw.prix_ht, toNumber(raw.prix_ttc, 0)),
    taux_tva: toNumber(raw.taux_tva, 0),
    regime_tva: String(raw.regime_tva || "").trim(),
    actif: Object.prototype.hasOwnProperty.call(raw, "actif")
      ? toBoolean(raw.actif, false)
      : true,
    ordre_affichage: toNumber(raw.ordre_affichage, 1000 + index),
    supplement_parfum_code: String(raw.supplement_parfum_code || "").trim().toUpperCase(),
    supplement_unitaire_ttc: toNumber(raw.supplement_unitaire_ttc, 0),
    note: String(raw.note || "").trim()
  });

  const shouldDisplayProductInHistoricalEntry = (product) => {
    if (!product) return false;
    if (product.format_cl !== 50 && product.format_cl !== 20) return false;
    if (!product.vendable_seul && !product.composable_coffret) return false;

    return true;
  };

  const isOldOrHiddenProduct = (product) =>
    !product.actif || product.visible_webapp === false;

  const getGroupedCatalogue = () => {
    const products = state.catalogue
      .filter(shouldDisplayProductInHistoricalEntry)
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
    document.querySelectorAll("[data-old-day-input]").forEach((input) => {
      if (input.dataset.oldDayInput === skuId) {
        input.value = String(getQuantity(skuId));
      }
    });
  };

  const updateAllQuantityInputs = () => {
    document.querySelectorAll("[data-old-day-input]").forEach((input) => {
      input.value = String(getQuantity(input.dataset.oldDayInput));
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

        return String(a.offre_id).localeCompare(String(b.offre_id));
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

  const getUnitPriceForProduct = (product) => {
    if (!product) {
      return {
        ttc: 0,
        ht: 0,
        offer: null,
        typeVente: "HISTORIQUE"
      };
    }

    if (product.format_cl === 50) {
      const offer = findBottleOffer(product);

      return {
        ttc: offer ? offer.prix_ttc : 0,
        ht: offer ? offer.prix_ht : 0,
        offer,
        typeVente: "BOUTEILLE"
      };
    }

    if (product.format_cl === 20) {
      const offer = findBoxOffer();

      if (!offer || !offer.quantite_bouteilles) {
        return {
          ttc: 0,
          ht: 0,
          offer: null,
          typeVente: "COFFRET"
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
        offer,
        typeVente: "COFFRET"
      };
    }

    return {
      ttc: 0,
      ht: 0,
      offer: null,
      typeVente: "HISTORIQUE"
    };
  };

  const getPaymentTotal = () =>
    PAYMENT_ROWS.reduce((sum, row) => {
      const input = document.getElementById(row.inputId);
      return sum + toNumber(input?.value, 0);
    }, 0);

  const getProductLinesDraft = () => {
    const lines = [];

    state.quantities.forEach((quantity, skuId) => {
      if (quantity <= 0) return;

      const product = getProductBySku(skuId);

      if (!product) return;

      const pricing = getUnitPriceForProduct(product);

      lines.push({
        product,
        quantity,
        unit_ttc: pricing.ttc,
        unit_ht: pricing.ht,
        offer: pricing.offer,
        type_vente: pricing.typeVente,
        conditionnement:
          product.format_cl === 50
            ? "BOTTLE_50"
            : "HISTORIQUE_20CL"
      });
    });

    return lines.sort((a, b) => {
      const byFormat = b.product.format_cl - a.product.format_cl;
      if (byFormat !== 0) return byFormat;
      return a.product.parfum_code.localeCompare(b.product.parfum_code);
    });
  };

  const getProductTotal = () =>
    getProductLinesDraft().reduce((sum, line) => (
      sum + line.quantity * line.unit_ttc
    ), 0);

  const getBottleTotal = () =>
    getProductLinesDraft().reduce((sum, line) => sum + line.quantity, 0);

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
      ? `<small class="oldDayHistoricalProductBadge">Ancien</small>`
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
            data-old-day-delta="-1"
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
            value="${qty}"
            data-old-day-input="${escapeAttr(product.sku_id)}"
            aria-label="Quantité ${escapeAttr(label)} ${escapeAttr(product.parfum_code)}"
          />

          <button
            type="button"
            data-old-day-delta="1"
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
    if (!state.dataLoaded && state.catalogue.length === 0) {
      els.productRows.innerHTML = `<p class="oldDayEmpty">Chargement du catalogue…</p>`;
      return;
    }

    const groups = getGroupedCatalogue();

    if (groups.length === 0) {
      els.productRows.innerHTML = `<p class="oldDayEmpty">Aucun produit catalogue trouvé.</p>`;
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
                    ? `<small class="oldDayHistoricalProductLabel">Ancien parfum</small>`
                    : group.hasHistoricalVariant
                      ? `<small class="oldDayHistoricalProductLabel">Format ancien disponible</small>`
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

  const renderExpenses = () => {
    if (state.expenses.length === 0) {
      els.expenseList.innerHTML = `<p class="oldDayEmpty">Aucun frais ajouté.</p>`;
      return;
    }

    els.expenseList.innerHTML = state.expenses
      .map((expense) => `
        <article class="expenseChip">
          <div>
            <strong>${escapeHtml(EXPENSE_LABELS[expense.categorie] || expense.categorie)}</strong>
            <span>${escapeHtml(expense.note || "Sans note")}</span>
          </div>
          <strong>${escapeHtml(formatCurrency(expense.montant))}</strong>
          <button type="button" data-remove-expense="${escapeAttr(expense.id)}" aria-label="Supprimer le frais">×</button>
        </article>
      `)
      .join("");
  };

  const renderTotals = () => {
    const paymentTotal = getPaymentTotal();
    const productTotal = getProductTotal();
    const bottleTotal = getBottleTotal();

    els.paymentTotal.textContent = formatCurrency(paymentTotal);
    els.catalogueTotal.textContent = formatCurrency(productTotal);
    els.heroRevenue.textContent = formatCurrency(paymentTotal);
    els.heroBottles.textContent = String(bottleTotal);
  };

  const renderAll = () => {
    renderProducts();
    renderExpenses();
    renderTotals();
  };

  const deriveBaseIdFromExisting = () => {
    const existingTx = state.edit.existing.transactions
      .map((transaction) => getTransactionId(transaction))
      .find((id) => /^TX_(.+)_(CB|ESP|CHQ|HISTORIQUE)$/.test(id));

    if (existingTx) {
      const match = existingTx.match(/^TX_(.+)_(CB|ESP|CHQ|HISTORIQUE)$/);
      if (match?.[1]) return match[1];
    }

    if (state.edit.journeeId) {
      return state.edit.journeeId.replace(/^J_/, "") || slugify(state.edit.journeeId, "HIST");
    }

    return "";
  };

  const buildIds = () => {
    const date = els.eventDateInput.value;
    const name = els.eventNameInput.value.trim();
    const dayLabel = els.dayLabelInput.value.trim();
    const slug = slugify([name, dayLabel].filter(Boolean).join(" "), "ANCIENNE_JOURNEE");
    const datePart = String(date || "0000-00-00").replaceAll("-", "");

    const generated = {
      eventMissionId: `EVT_HIST_${datePart}_${slug}`,
      stockMissionId: `MST_HIST_${datePart}_${slug}`,
      journeeId: `J_HIST_${datePart}_${slug}`,
      baseId: `HIST_${datePart}_${slug}`
    };

    if (!state.edit.isEditMode || !state.edit.existing.journee) {
      return generated;
    }

    const existingJournee = state.edit.existing.journee;
    const existingMissionStock = state.edit.existing.missionStock;
    const existingMissionVente = state.edit.existing.missionVente;

    return {
      eventMissionId:
        String(existingJournee.evenement_id || existingMissionStock?.evenement_id || existingMissionVente?.mission_id || "").trim() ||
        generated.eventMissionId,
      stockMissionId:
        String(existingJournee.stock_mission_id || existingMissionStock?.mission_id || "").trim() ||
        generated.stockMissionId,
      journeeId: state.edit.journeeId || generated.journeeId,
      baseId: deriveBaseIdFromExisting() || generated.baseId
    };
  };

  const validateForm = () => {
    if (!hasApi()) {
      setStatus("lugdurum-api.js n’est pas chargé : aucune écriture locale directe ne sera faite.", "isError");
      return false;
    }

    if (state.edit.isEditMode && !state.edit.loaded) {
      setStatus("La journée à modifier n’est pas encore chargée.", "isError");
      return false;
    }

    if (!els.eventNameInput.value.trim()) {
      setStatus("Indique le nom de l’évènement.", "isError");
      return false;
    }

    if (!els.eventDateInput.value) {
      setStatus("Indique la date de la journée.", "isError");
      return false;
    }

    if (getPaymentTotal() <= 0 && getBottleTotal() <= 0 && state.expenses.length === 0) {
      setStatus("Saisis au moins un paiement, une vente produit ou un frais.", "isError");
      return false;
    }

    return true;
  };

  const buildMissionRows = () => {
    const ids = buildIds();
    const now = new Date().toISOString();
    const date = els.eventDateInput.value;
    const name = els.eventNameInput.value.trim();
    const type = els.eventTypeInput.value;
    const dayLabel = els.dayLabelInput.value.trim() || "J1";
    const place = els.placeInput.value.trim();
    const city = els.cityInput.value.trim();
    const note = els.noteInput.value.trim();
    const paymentTotal = getPaymentTotal();
    const fraisTotal = state.expenses.reduce((sum, item) => sum + toNumber(item.montant, 0), 0);

    const existingMissionVente = state.edit.existing.missionVente;
    const existingMissionStock = state.edit.existing.missionStock;
    const existingJournee = state.edit.existing.journee;

    const missionVente = {
      ...existingMissionVente,
      mission_id: ids.eventMissionId,
      nom: name,
      date_debut: date,
      date_fin: date,
      lieu: place,
      ville: city,
      type_evenement: type,
      type_evenement_label: EVENT_TYPE_LABELS[type] || type,
      statut: "cloture",
      source: HISTORICAL_SOURCE,
      note,
      created_at: existingMissionVente?.created_at || now,
      updated_at: now
    };

    const missionStock = {
      ...existingMissionStock,
      mission_id: ids.stockMissionId,
      evenement_id: ids.eventMissionId,
      nom: name,
      date_debut: date,
      date_fin: date,
      statut: "cloture",
      stock_prepare: true,
      responsable_user_id: existingMissionStock?.responsable_user_id || CURRENT_USER.user_id,
      journees_count: 1,
      total_bouteilles_preparees: existingMissionStock?.total_bouteilles_preparees || "",
      total_50cl_prepare: existingMissionStock?.total_50cl_prepare || "",
      total_20cl_prepare: existingMissionStock?.total_20cl_prepare || "",
      parfums_prepare_count: existingMissionStock?.parfums_prepare_count || "",
      ca_total_ttc: paymentTotal,
      total_frais_ttc: fraisTotal,
      source: HISTORICAL_SOURCE,
      note,
      created_at: existingMissionStock?.created_at || now,
      updated_at: now,
      closed_at: existingMissionStock?.closed_at || now
    };

    const journee = {
      ...existingJournee,
      journee_id: ids.journeeId,
      evenement_id: ids.eventMissionId,
      mission_id: ids.eventMissionId,
      stock_mission_id: ids.stockMissionId,
      date,
      jour_label: dayLabel,
      statut: "cloture",
      ca_total_ttc: paymentTotal,
      total_frais_ttc: fraisTotal,
      source: HISTORICAL_SOURCE,
      note,
      created_at: existingJournee?.created_at || now,
      updated_at: now,
      started_at: existingJournee?.started_at || now,
      closed_at: existingJournee?.closed_at || now
    };

    return {
      ids,
      missionVente,
      missionStock,
      journee
    };
  };

  const getExistingLineForSku = (skuId) =>
    state.edit.existing.saleLines.find((line) => String(line.sku_id || "").trim() === skuId) || null;

  const getExistingTransactionForPayment = (key, ids) => {
    const expectedId = `TX_${ids.baseId}_${key}`;

    return (
      state.edit.existing.transactions.find((transaction) => getTransactionId(transaction) === expectedId) ||
      state.edit.existing.transactions.find((transaction) => getPaymentKey(transaction) === key) ||
      null
    );
  };

  const buildActiveSaleLines = ({ transactionId, stockMissionId, journeeId, eventMissionId }) =>
    getProductLinesDraft().map((line) => {
      const totalTtc = formatAmount(line.quantity * line.unit_ttc);
      const totalHt = formatAmount(line.quantity * line.unit_ht);
      const now = new Date().toISOString();
      const existingLine = getExistingLineForSku(line.product.sku_id);

      return {
        ...existingLine,
        ligne_id:
          existingLine?.ligne_id ||
          `${transactionId}_${slugify(line.product.sku_id, "SKU")}`,
        transaction_id: transactionId,
        mission_id: stockMissionId,
        stock_mission_id: stockMissionId,
        evenement_id: eventMissionId,
        journee_id: journeeId,
        sku_id: line.product.sku_id,
        parfum_code: line.product.parfum_code,
        parfum_nom: line.product.parfum_nom,
        format_cl: line.product.format_cl,
        quantite: line.quantity,
        type_vente: line.type_vente,
        conditionnement: line.conditionnement,
        offre_id: line.offer?.offre_id || "",
        offre_libelle: line.offer?.libelle || "Saisie historique",
        prix_unitaire_ttc: formatAmount(line.unit_ttc),
        prix_unitaire_ht: formatAmount(line.unit_ht),
        taux_tva: line.offer?.taux_tva || 0,
        montant_tva_ligne: 0,
        total_catalogue_ligne_ttc: totalTtc,
        total_catalogue_ligne_ht: totalHt,
        cout_unitaire: line.product.cout_revient || 0,
        marge_brute_ligne: line.product.cout_revient
          ? formatAmount(totalTtc - line.product.cout_revient * line.quantity)
          : 0,
        source: HISTORICAL_SOURCE,
        statut: "valide",
        note: "Saisie ancienne journée",
        created_at: existingLine?.created_at || now,
        updated_at: now
      };
    });

  const buildCancelledSaleLines = ({ activeLines, transactionId }) => {
    if (!state.edit.isEditMode) return [];

    const now = new Date().toISOString();
    const activeLineIds = new Set(activeLines.map((line) => String(line.ligne_id || "")));
    const activeSkus = new Set(activeLines.map((line) => String(line.sku_id || "")));

    return state.edit.existing.saleLines
      .filter(isValidStatus)
      .filter((line) => {
        const lineId = String(line.ligne_id || "");
        const skuId = String(line.sku_id || "");
        return !activeLineIds.has(lineId) && !activeSkus.has(skuId);
      })
      .map((line) => ({
        ...line,
        transaction_id: transactionId || line.transaction_id || "",
        quantite: 0,
        total_catalogue_ligne_ttc: 0,
        total_catalogue_ligne_ht: 0,
        marge_brute_ligne: 0,
        statut: "annule",
        note: [line.note || "", "Annulé depuis la modification historique"].filter(Boolean).join(" · "),
        updated_at: now
      }));
  };

  const buildTransactions = ({ ids }) => {
    const now = new Date().toISOString();

    const paymentRows = PAYMENT_ROWS
      .map((row) => {
        const input = document.getElementById(row.inputId);

        return {
          ...row,
          amount: formatAmount(toNumber(input?.value, 0))
        };
      })
      .filter((row) => row.amount > 0);

    if (paymentRows.length === 0 && getProductLinesDraft().length > 0) {
      paymentRows.push({
        key: "HISTORIQUE",
        label: "Historique",
        provider: "HISTORIQUE",
        amount: 0
      });
    }

    const currentTransactionMeta = paymentRows.map((row) => {
      const existing = getExistingTransactionForPayment(row.key, ids);

      return {
        row,
        existing,
        transactionId: existing?.transaction_id || `TX_${ids.baseId}_${row.key}`
      };
    });

    const primaryTransactionId =
      currentTransactionMeta[0]?.transactionId ||
      state.edit.existing.saleLines.find((line) => line.transaction_id)?.transaction_id ||
      `TX_${ids.baseId}_HISTORIQUE`;

    const activeLines = buildActiveSaleLines({
      transactionId: primaryTransactionId,
      stockMissionId: ids.stockMissionId,
      journeeId: ids.journeeId,
      eventMissionId: ids.eventMissionId
    });

    const cancelledLines = buildCancelledSaleLines({
      activeLines,
      transactionId: primaryTransactionId
    });

    const allLinesToWrite = [...activeLines, ...cancelledLines];

    const currentTransactions = currentTransactionMeta.map((meta, index) => {
      const { row, existing, transactionId } = meta;
      const isPrimary = index === 0;
      const lines = isPrimary ? allLinesToWrite : [];

      return {
        ...existing,
        transaction_id: transactionId,
        date_heure: existing?.date_heure || now,
        mission_id: ids.stockMissionId,
        stock_mission_id: ids.stockMissionId,
        evenement_id: ids.eventMissionId,
        journee_id: ids.journeeId,
        user_id: existing?.user_id || CURRENT_USER.user_id,
        mode_paiement: row.key,
        mode_paiement_label: row.label,
        paiement_provider: row.provider,
        paiement_statut: "PAYE",
        source: HISTORICAL_SOURCE,
        source_id: ids.baseId,
        total_catalogue_ttc: row.amount,
        total_catalogue_ht: row.amount,
        total_tva: 0,
        total_encaisse_ttc: row.amount,
        remise_totale: 0,
        motif_remise: "",
        statut: "validee",
        note: els.noteInput.value.trim(),
        detail_ticket: JSON.stringify(isPrimary ? activeLines : []),
        created_at: existing?.created_at || now,
        updated_at: now,
        lignes: lines
      };
    });

    const currentIds = new Set(currentTransactions.map((transaction) => transaction.transaction_id));

    const cancelledTransactions = state.edit.isEditMode
      ? state.edit.existing.transactions
          .filter(isValidStatus)
          .filter((transaction) => !currentIds.has(getTransactionId(transaction)))
          .map((transaction) => ({
            ...transaction,
            total_catalogue_ttc: 0,
            total_catalogue_ht: 0,
            total_tva: 0,
            total_encaisse_ttc: 0,
            remise_totale: 0,
            detail_ticket: "[]",
            statut: "annulee",
            note: [transaction.note || "", "Annulé depuis la modification historique"].filter(Boolean).join(" · "),
            updated_at: now,
            lignes: []
          }))
      : [];

    if (currentTransactions.length === 0 && cancelledTransactions.length > 0 && allLinesToWrite.length > 0) {
      cancelledTransactions[0].lignes = allLinesToWrite;
    }

    return [...currentTransactions, ...cancelledTransactions];
  };

  const buildFraisRows = ({ ids }) => {
    const date = els.eventDateInput.value;
    const now = new Date().toISOString();

    const activeRows = state.expenses.map((expense, index) => {
      const existing =
        state.edit.existing.frais.find((item) => item.frais_id === expense.id) ||
        null;

      const fraisId = existing?.frais_id || `FR_${ids.baseId}_${String(index + 1).padStart(2, "0")}`;

      return {
        ...existing,
        frais_id: fraisId,
        date,
        date_heure: existing?.date_heure || now,
        mission_id: ids.stockMissionId,
        stock_mission_id: ids.stockMissionId,
        evenement_id: ids.eventMissionId,
        journee_id: ids.journeeId,
        categorie: expense.categorie,
        categorie_label: EXPENSE_LABELS[expense.categorie] || expense.categorie,
        libelle: expense.note || EXPENSE_LABELS[expense.categorie] || "Frais",
        montant: formatAmount(expense.montant),
        montant_ttc: formatAmount(expense.montant),
        paye_par: existing?.paye_par || CURRENT_USER.user_id,
        paye_par_nom: existing?.paye_par_nom || CURRENT_USER.nom,
        mode_paiement: existing?.mode_paiement || "AUTRE",
        mode_paiement_label: existing?.mode_paiement_label || "Autre",
        justificatif_url: existing?.justificatif_url || "",
        statut: "valide",
        note: expense.note,
        user_id: existing?.user_id || CURRENT_USER.user_id,
        source: HISTORICAL_SOURCE,
        created_at: existing?.created_at || now,
        updated_at: now
      };
    });

    if (!state.edit.isEditMode) return activeRows;

    const activeIds = new Set(activeRows.map((item) => item.frais_id));

    const cancelledRows = state.edit.existing.frais
      .filter(isValidStatus)
      .filter((item) => !activeIds.has(item.frais_id))
      .map((item) => ({
        ...item,
        statut: "annule",
        note: [item.note || "", "Annulé depuis la modification historique"].filter(Boolean).join(" · "),
        updated_at: now
      }));

    return [...activeRows, ...cancelledRows];
  };

  const saveBundleFallback = async ({ rows, transactions, fraisRows }) => {
    if (typeof api().saveMission !== "function") {
      throw new Error("LugdurumAPI.saveMission() est indisponible.");
    }

    if (typeof api().saveMissionStock !== "function") {
      throw new Error("LugdurumAPI.saveMissionStock() est indisponible.");
    }

    if (typeof api().saveJournee !== "function") {
      throw new Error("LugdurumAPI.saveJournee() est indisponible.");
    }

    if (typeof api().saveTransaction !== "function") {
      throw new Error("LugdurumAPI.saveTransaction() est indisponible.");
    }

    await api().saveMission(rows.missionVente);
    await api().saveMissionStock(rows.missionStock);
    await api().saveJournee(rows.journee);

    for (const transaction of transactions) {
      await api().saveTransaction(transaction);
    }

    if (typeof api().saveFrais === "function") {
      for (const frais of fraisRows) {
        await api().saveFrais(frais);
      }
    } else if (fraisRows.length > 0) {
      throw new Error("LugdurumAPI.saveFrais() est indisponible pour enregistrer les frais.");
    }
  };

  const saveOldDay = async () => {
    if (state.isSaving) return;
    if (!validateForm()) return;

    const rows = buildMissionRows();
    const transactions = buildTransactions(rows);
    const fraisRows = buildFraisRows(rows);

    setSaving(true);
    setStatus(
      state.edit.isEditMode
        ? "Enregistrement des modifications…"
        : "Enregistrement…"
    );

    try {
      if (typeof api().saveJourneeHistoriqueBundle === "function") {
        await api().saveJourneeHistoriqueBundle({
          mission: rows.missionVente,
          mission_stock: rows.missionStock,
          journee: rows.journee,
          transactions,
          frais: fraisRows
        });
      } else {
        await saveBundleFallback({
          rows,
          transactions,
          fraisRows
        });
      }

      const pendingCount =
        typeof api().getPendingWritesCount === "function"
          ? api().getPendingWritesCount()
          : 0;

      const successMessage = state.edit.isEditMode
        ? "Journée historique mise à jour."
        : "Journée historique créée.";

      setStatus(
        pendingCount > 0
          ? `${successMessage} · ${pendingCount} écriture(s) en attente de synchronisation.`
          : successMessage,
        pendingCount > 0 ? "isError" : "isSuccess"
      );

      if (pendingCount === 0) {
        redirectAfterSave();
        return;
      }

      if (!state.edit.isEditMode) {
        resetAfterSave();
      } else {
        state.edit.loaded = true;
      }
    } catch (error) {
      setStatus(`Enregistrement impossible : ${error.message}`, "isError");
    } finally {
      setSaving(false);
    }
  };

  const resetAfterSave = () => {
    els.form.reset();
    els.eventDateInput.value = formatIsoDate(new Date());
    state.quantities = new Map();
    state.expenses = [];
    renderAll();
  };

  const addExpense = () => {
    const amount = toNumber(els.expenseAmountInput.value, NaN);

    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus("Indique un montant de frais valide.", "isError");
      return;
    }

    state.expenses.push({
      id: `TMP_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      categorie: els.expenseCategoryInput.value,
      montant: formatAmount(amount),
      note: els.expenseNoteInput.value.trim()
    });

    els.expenseAmountInput.value = "";
    els.expenseNoteInput.value = "";
    setStatus("");
    renderExpenses();
    renderTotals();
  };

  const callArray = async (fnName) => {
    if (!hasApi() || typeof api()[fnName] !== "function") return [];

    const result = await api()[fnName]();
    return Array.isArray(result) ? result : [];
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

  const loadRemoteData = async () => {
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

    state.catalogue = Array.isArray(catalogueRows)
      ? catalogueRows
          .map((row, index) => normalizeProduct(row, index))
          .filter((product) => product.sku_id && product.parfum_code && product.format_cl)
      : [];

    state.offresVente = Array.isArray(offresRows)
      ? offresRows
          .map((row, index) => normalizeOffer(row, index))
          .filter((offer) => offer.offre_id && offer.type_offre && offer.format_cl)
      : [];

    state.dataLoaded = true;

    writeJson(STORAGE_KEYS.catalogueCache, state.catalogue);
    writeJson(STORAGE_KEYS.offresVenteCache, state.offresVente);
  };

  const parseDetailTicketLines = (transaction) => {
    let ticket = [];

    try {
      ticket = Array.isArray(transaction.detail_ticket)
        ? transaction.detail_ticket
        : JSON.parse(transaction.detail_ticket || "[]");
    } catch {
      ticket = [];
    }

    const lines = [];

    ticket.forEach((item) => {
      if (item.type === "bottle") {
        lines.push({
          transaction_id: transaction.transaction_id,
          mission_id: transaction.mission_id,
          stock_mission_id: transaction.stock_mission_id,
          evenement_id: transaction.evenement_id,
          journee_id: transaction.journee_id,
          sku_id: item.sku_id,
          parfum_code: item.parfum_code,
          parfum_nom: item.parfum_nom,
          format_cl: item.format_cl,
          quantite: item.quantite,
          prix_unitaire_ttc: item.prix_unitaire_ttc,
          total_catalogue_ligne_ttc: toNumber(item.quantite, 0) * toNumber(item.prix_unitaire_ttc, 0),
          statut: "valide"
        });
        return;
      }

      if (item.type === "box" && Array.isArray(item.composition)) {
        const unitShare =
          item.composition.length > 0
            ? toNumber(item.prix_ttc, 0) / item.composition.length
            : 0;

        item.composition.forEach((product) => {
          lines.push({
            transaction_id: transaction.transaction_id,
            mission_id: transaction.mission_id,
            stock_mission_id: transaction.stock_mission_id,
            evenement_id: transaction.evenement_id,
            journee_id: transaction.journee_id,
            sku_id: product.sku_id,
            parfum_code: product.parfum_code,
            parfum_nom: product.parfum_nom,
            format_cl: product.format_cl || item.format_cl || 20,
            quantite: 1,
            prix_unitaire_ttc: unitShare,
            total_catalogue_ligne_ttc: unitShare,
            statut: "valide"
          });
        });
      }
    });

    return lines;
  };

  const hydrateQuantitiesFromExisting = () => {
    state.quantities = new Map();

    const activeLines = state.edit.existing.saleLines.filter(isValidStatus);

    if (activeLines.length > 0) {
      activeLines.forEach((line) => {
        const skuId = String(line.sku_id || "").trim();
        if (!skuId) return;

        const current = getQuantity(skuId);
        setQuantity(skuId, current + toNumber(line.quantite, 0));
      });

      return;
    }

    state.edit.existing.transactions
      .filter(isValidStatus)
      .flatMap(parseDetailTicketLines)
      .forEach((line) => {
        const skuId = String(line.sku_id || "").trim();
        if (!skuId) return;

        const current = getQuantity(skuId);
        setQuantity(skuId, current + toNumber(line.quantite, 0));
      });
  };

  const hydratePaymentsFromExisting = () => {
    const totals = {
      CB: 0,
      ESP: 0,
      CHQ: 0
    };

    state.edit.existing.transactions
      .filter(isValidStatus)
      .forEach((transaction) => {
        const key = getPaymentKey(transaction);

        if (!Object.prototype.hasOwnProperty.call(totals, key)) return;

        totals[key] += getTransactionAmount(transaction);
      });

    els.amountCbInput.value = totals.CB > 0 ? String(formatAmount(totals.CB)) : "";
    els.amountCashInput.value = totals.ESP > 0 ? String(formatAmount(totals.ESP)) : "";
    els.amountCheckInput.value = totals.CHQ > 0 ? String(formatAmount(totals.CHQ)) : "";
  };

  const hydrateExpensesFromExisting = () => {
    state.expenses = state.edit.existing.frais
      .filter(isValidStatus)
      .map((frais) => ({
        id: frais.frais_id,
        categorie: frais.categorie || "AUTRE",
        montant: formatAmount(toNumber(frais.montant_ttc ?? frais.montant, 0)),
        note: frais.note || frais.libelle || ""
      }));
  };

  const loadEditData = async () => {
    if (!state.edit.isEditMode) return;

    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    const [
      journees,
      missionsStock,
      missions,
      transactions,
      lignes,
      frais
    ] = await Promise.all([
      callArray("getJournees"),
      callArray("getMissionsStock"),
      callArray("getMissions"),
      callArray("getTransactions"),
      callArray("getVentesLignes"),
      callArray("getFrais")
    ]);

    const journee = journees.find((item) => getJourneeId(item) === state.edit.journeeId) || null;

    if (!journee) {
      throw new Error(`Journée introuvable : ${state.edit.journeeId}`);
    }

    const stockMissionId = String(journee.stock_mission_id || "").trim();
    const eventMissionId = String(journee.evenement_id || journee.mission_id || "").trim();

    const missionStock =
      missionsStock.find((mission) => String(mission.mission_id || "") === stockMissionId) ||
      null;

    const missionVente =
      missions.find((mission) => String(mission.mission_id || "") === eventMissionId) ||
      missions.find((mission) => String(mission.mission_id || "") === String(missionStock?.evenement_id || "")) ||
      null;

    const dayTransactions = transactions.filter((transaction) => getJourneeId(transaction) === state.edit.journeeId);
    const dayLines = lignes.filter((line) => getJourneeId(line) === state.edit.journeeId);
    const dayFrais = frais.filter((item) => getJourneeId(item) === state.edit.journeeId);

    state.edit.existing = {
      journee,
      missionVente,
      missionStock,
      transactions: dayTransactions,
      saleLines: dayLines,
      frais: dayFrais
    };

    els.eventNameInput.value =
      missionStock?.nom ||
      missionVente?.nom ||
      journee.nom ||
      "";

    els.eventDateInput.value =
      String(journee.date || missionStock?.date_debut || missionVente?.date_debut || "").slice(0, 10);

    els.eventTypeInput.value =
      missionVente?.type_evenement ||
      missionStock?.type_evenement ||
      "AUTRE";

    els.cityInput.value =
      missionVente?.ville ||
      missionStock?.ville ||
      journee.ville ||
      "";

    els.placeInput.value =
      missionVente?.lieu ||
      missionStock?.lieu ||
      journee.lieu ||
      "";

    els.dayLabelInput.value = journee.jour_label || "J1";
    els.noteInput.value = journee.note || missionStock?.note || missionVente?.note || "";

    hydratePaymentsFromExisting();
    hydrateQuantitiesFromExisting();
    hydrateExpensesFromExisting();

    state.edit.loaded = true;

    renderAll();
  };

  document.addEventListener("click", (event) => {
    const deltaButton = event.target.closest("[data-old-day-delta]");

    if (deltaButton) {
      const skuId = deltaButton.dataset.sku;
      const delta = toNumber(deltaButton.dataset.oldDayDelta, 0);
      const current = getQuantity(skuId);

      setQuantity(skuId, current + delta);
      updateQuantityInput(skuId);
      setStatus("");
      renderTotals();
      return;
    }

    const removeExpenseButton = event.target.closest("[data-remove-expense]");

    if (removeExpenseButton) {
      state.expenses = state.expenses.filter(
        (expense) => expense.id !== removeExpenseButton.dataset.removeExpense
      );
      renderExpenses();
      renderTotals();
    }
  });

  document.addEventListener("input", (event) => {
    const quantityInput = event.target.closest("[data-old-day-input]");

    if (quantityInput) {
      setQuantity(quantityInput.dataset.oldDayInput, quantityInput.value);
      setStatus("");
      renderTotals();
      return;
    }

    if (
      event.target === els.amountCbInput ||
      event.target === els.amountCashInput ||
      event.target === els.amountCheckInput
    ) {
      setStatus("");
      renderTotals();
    }
  });

  els.clearProductsBtn.addEventListener("click", () => {
    state.quantities = new Map();
    updateAllQuantityInputs();
    setStatus("");
    renderTotals();
  });

  els.addExpenseBtn.addEventListener("click", addExpense);

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveOldDay();
  });

  window.addEventListener("lugdurum:sync-status", (event) => {
    const detail = event.detail || {};
    const pendingCount = Number(detail.pending_count || 0);

    if (pendingCount > 0) {
      setStatus(`${pendingCount} écriture(s) en attente de synchronisation.`, "isError");
    }
  });

  const init = async () => {
    configureModeLabels();

    els.eventDateInput.value = formatIsoDate(new Date());
    renderAll();

    try {
      setStatus("Chargement catalogue…");
      await loadRemoteData();
      setStatus("");
    } catch (error) {
      loadLocalCatalogueFallback();
      setStatus(`Catalogue local affiché : ${error.message}`, "isError");
    }

    renderAll();

    if (state.edit.isEditMode) {
      try {
        setStatus("Chargement de la journée à modifier…");
        await loadEditData();
        setStatus("Mode modification : les prochaines écritures mettront à jour cette journée.", "isSuccess");
      } catch (error) {
        setStatus(`Modification impossible : ${error.message}`, "isError");
      }
    }
  };

  init();
})();