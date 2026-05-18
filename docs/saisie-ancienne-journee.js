(() => {
  "use strict";

  /*
    Saisie ancienne journée V1 :
    - Crée une journée clôturée historique sans passer par le parcours terrain complet.
    - Charge catalogue + offres depuis Google Sheets.
    - Écrit uniquement via LugdurumAPI : missions_vente, missions_stock, journees_vente,
      transactions, ventes_lignes et frais.
    - Pas d’écriture local-only : le cache local sert uniquement à afficher le catalogue si l’API de lecture échoue.
  */

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme"
  };

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

  const state = {
    catalogue: [],
    offresVente: [],
    quantities: new Map(),
    expenses: [],
    isSaving: false,
    dataLoaded: false
  };

  const els = {
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

    if (["true", "vrai", "oui", "yes", "1", "x", "actif"].includes(normalized)) return true;
    if (["false", "faux", "non", "no", "0", "inactif"].includes(normalized)) return false;

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
      actif: toBoolean(raw.actif, false),
      visible_webapp: Object.prototype.hasOwnProperty.call(raw, "visible_webapp")
        ? toBoolean(raw.visible_webapp, true)
        : true,
      ordre_affichage: toNumber(raw.ordre_affichage, 1000 + index),
      note: String(raw.note || "").trim()
    };
  };

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
    actif: toBoolean(raw.actif, false),
    ordre_affichage: toNumber(raw.ordre_affichage, 1000 + index),
    supplement_parfum_code: String(raw.supplement_parfum_code || "").trim().toUpperCase(),
    supplement_unitaire_ttc: toNumber(raw.supplement_unitaire_ttc, 0),
    note: String(raw.note || "").trim()
  });

  const getGroupedCatalogue = () => {
    const products = state.catalogue
      .filter((product) => product.actif)
      .filter((product) => product.visible_webapp !== false)
      .filter((product) => product.format_cl === 50 || product.format_cl === 20)
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

    return [...groups.values()].sort((a, b) => {
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

  const getActiveOffers = () =>
    state.offresVente.filter((offer) => offer.actif);

  const findBottleOffer = (product) => {
    const productGamme = normalizeKey(product.gamme_tarif);

    return getActiveOffers().find((offer) => {
      return (
        offer.type_offre === "bouteille" &&
        offer.format_cl === product.format_cl &&
        normalizeKey(offer.gamme_tarif) === productGamme
      );
    }) || null;
  };

  const findBoxOffer = () => {
    return (
      getActiveOffers().find((offer) => offer.offre_id === "COFFRET_3_20") ||
      getActiveOffers().find((offer) => offer.offre_id === "COFFRET_6_20") ||
      getActiveOffers().find((offer) => offer.type_offre === "coffret" && offer.format_cl === 20) ||
      null
    );
  };

  const getUnitPriceForProduct = (product) => {
    if (!product) return {
      ttc: 0,
      ht: 0,
      offer: null,
      typeVente: "HISTORIQUE"
    };

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
    getProductLinesDraft().reduce((sum, line) => {
      return sum + line.quantity * line.unit_ttc;
    }, 0);

  const getBottleTotal = () =>
    getProductLinesDraft().reduce((sum, line) => sum + line.quantity, 0);

  const renderProducts = () => {
    if (!state.dataLoaded && state.catalogue.length === 0) {
      els.productRows.innerHTML = `<p class="oldDayEmpty">Chargement du catalogue…</p>`;
      return;
    }

    const groups = getGroupedCatalogue();

    if (groups.length === 0) {
      els.productRows.innerHTML = `<p class="oldDayEmpty">Aucun produit actif trouvé.</p>`;
      return;
    }

    els.productRows.innerHTML = groups
      .map((group) => {
        const product50 = group.products.find((product) => product.format_cl === 50);
        const product20 = group.products.find((product) => product.format_cl === 20);

        return `
          <article class="oldProductRow">
            <div class="oldProductTitle">
              <strong>${escapeHtml(group.parfum_code)}</strong>
              <span>${escapeHtml(group.parfum_nom)}</span>
            </div>

            <div class="oldProductControls">
              ${renderQuantityInput(product50, "50 cL")}
              ${renderQuantityInput(product20, "20 cL")}
            </div>
          </article>
        `;
      })
      .join("");
  };

  const renderQuantityInput = (product, label) => {
    if (!product) {
      return `
        <label class="oldQtyField isUnavailable">
          <span>${escapeHtml(label)}</span>
          <input type="number" value="" disabled />
        </label>
      `;
    }

    return `
      <label class="oldQtyField">
        <span>${escapeHtml(label)}</span>
        <input
          type="number"
          inputmode="numeric"
          min="0"
          step="1"
          value="${escapeAttr(getQuantity(product.sku_id))}"
          data-product-quantity="${escapeAttr(product.sku_id)}"
          aria-label="Quantité ${escapeAttr(label)} ${escapeAttr(product.parfum_code)}"
        />
      </label>
    `;
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

  const buildIds = () => {
    const date = els.eventDateInput.value;
    const name = els.eventNameInput.value.trim();
    const dayLabel = els.dayLabelInput.value.trim();
    const slug = slugify([name, dayLabel].filter(Boolean).join(" "), "ANCIENNE_JOURNEE");
    const datePart = String(date || "0000-00-00").replaceAll("-", "");

    return {
      eventMissionId: `EVT_HIST_${datePart}_${slug}`,
      stockMissionId: `MST_HIST_${datePart}_${slug}`,
      journeeId: `J_HIST_${datePart}_${slug}`,
      baseId: `HIST_${datePart}_${slug}`
    };
  };

  const validateForm = () => {
    if (!hasApi()) {
      setStatus("lugdurum-api.js n’est pas chargé : aucune écriture locale directe ne sera faite.", "isError");
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

    const missionVente = {
      mission_id: ids.eventMissionId,
      nom: name,
      date_debut: date,
      date_fin: date,
      lieu: place,
      ville: city,
      type_evenement: type,
      type_evenement_label: EVENT_TYPE_LABELS[type] || type,
      statut: "cloture",
      source: "SAISIE_HISTORIQUE",
      note,
      created_at: now,
      updated_at: now
    };

    const missionStock = {
      mission_id: ids.stockMissionId,
      evenement_id: ids.eventMissionId,
      nom: name,
      date_debut: date,
      date_fin: date,
      statut: "cloture",
      stock_prepare: true,
      responsable_user_id: CURRENT_USER.user_id,
      journees_count: 1,
      total_bouteilles_preparees: "",
      total_50cl_prepare: "",
      total_20cl_prepare: "",
      parfums_prepare_count: "",
      ca_total_ttc: paymentTotal,
      total_frais_ttc: fraisTotal,
      source: "SAISIE_HISTORIQUE",
      note,
      created_at: now,
      updated_at: now,
      closed_at: now
    };

    const journee = {
      journee_id: ids.journeeId,
      evenement_id: ids.eventMissionId,
      mission_id: ids.eventMissionId,
      stock_mission_id: ids.stockMissionId,
      date,
      jour_label: dayLabel,
      statut: "cloture",
      ca_total_ttc: paymentTotal,
      total_frais_ttc: fraisTotal,
      source: "SAISIE_HISTORIQUE",
      note,
      created_at: now,
      updated_at: now,
      started_at: now,
      closed_at: now
    };

    return {
      ids,
      missionVente,
      missionStock,
      journee
    };
  };

  const buildSaleLines = ({ transactionId, stockMissionId, journeeId, eventMissionId }) => {
    return getProductLinesDraft().map((line, index) => {
      const totalTtc = formatAmount(line.quantity * line.unit_ttc);
      const totalHt = formatAmount(line.quantity * line.unit_ht);
      const now = new Date().toISOString();

      return {
        ligne_id: `${transactionId}_L${String(index + 1).padStart(2, "0")}`,
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
        source: "SAISIE_HISTORIQUE",
        note: "Saisie ancienne journée",
        created_at: now,
        updated_at: now
      };
    });
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

    return paymentRows.map((row, index) => {
      const transactionId = `TX_${ids.baseId}_${row.key}`;
      const isFirstTransaction = index === 0;
      const lines = isFirstTransaction
        ? buildSaleLines({
            transactionId,
            stockMissionId: ids.stockMissionId,
            journeeId: ids.journeeId,
            eventMissionId: ids.eventMissionId
          })
        : [];

      return {
        transaction_id: transactionId,
        date_heure: now,
        mission_id: ids.stockMissionId,
        stock_mission_id: ids.stockMissionId,
        evenement_id: ids.eventMissionId,
        journee_id: ids.journeeId,
        user_id: CURRENT_USER.user_id,
        mode_paiement: row.key,
        mode_paiement_label: row.label,
        paiement_provider: row.provider,
        paiement_statut: "PAYE",
        source: "SAISIE_HISTORIQUE",
        source_id: ids.baseId,
        total_catalogue_ttc: row.amount,
        total_catalogue_ht: row.amount,
        total_tva: 0,
        total_encaisse_ttc: row.amount,
        remise_totale: 0,
        motif_remise: "",
        statut: "validee",
        note: els.noteInput.value.trim(),
        detail_ticket: JSON.stringify(lines),
        created_at: now,
        updated_at: now,
        lignes: lines
      };
    });
  };

  const buildFraisRows = ({ ids }) => {
    const date = els.eventDateInput.value;
    const now = new Date().toISOString();

    return state.expenses.map((expense, index) => ({
      frais_id: `FR_${ids.baseId}_${String(index + 1).padStart(2, "0")}`,
      date,
      date_heure: now,
      mission_id: ids.stockMissionId,
      stock_mission_id: ids.stockMissionId,
      evenement_id: ids.eventMissionId,
      journee_id: ids.journeeId,
      categorie: expense.categorie,
      categorie_label: EXPENSE_LABELS[expense.categorie] || expense.categorie,
      libelle: expense.note || EXPENSE_LABELS[expense.categorie] || "Frais",
      montant: formatAmount(expense.montant),
      montant_ttc: formatAmount(expense.montant),
      paye_par: CURRENT_USER.user_id,
      paye_par_nom: CURRENT_USER.nom,
      mode_paiement: "AUTRE",
      mode_paiement_label: "Autre",
      justificatif_url: "",
      statut: "valide",
      note: expense.note,
      user_id: CURRENT_USER.user_id,
      source: "SAISIE_HISTORIQUE",
      created_at: now,
      updated_at: now
    }));
  };

  const saveOldDay = async () => {
    if (state.isSaving) return;
    if (!validateForm()) return;

    const rows = buildMissionRows();
    const transactions = buildTransactions(rows);
    const fraisRows = buildFraisRows(rows);

    setSaving(true);
    setStatus("Enregistrement dans Google Sheets…");

    try {
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

      const pendingCount =
        typeof api().getPendingWritesCount === "function"
          ? api().getPendingWritesCount()
          : 0;

      setStatus(
        pendingCount > 0
          ? `Journée historique créée · ${pendingCount} écriture(s) en attente de synchronisation.`
          : "Journée historique créée.",
        pendingCount > 0 ? "isError" : "isSuccess"
      );

      resetAfterSave();
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

  document.addEventListener("input", (event) => {
    const quantityInput = event.target.closest("[data-product-quantity]");

    if (quantityInput) {
      setQuantity(quantityInput.dataset.productQuantity, quantityInput.value);
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

  document.addEventListener("click", (event) => {
    const removeExpenseButton = event.target.closest("[data-remove-expense]");

    if (removeExpenseButton) {
      state.expenses = state.expenses.filter(
        (expense) => expense.id !== removeExpenseButton.dataset.removeExpense
      );
      renderExpenses();
      return;
    }
  });

  els.clearProductsBtn.addEventListener("click", () => {
    state.quantities = new Map();
    setStatus("");
    renderProducts();
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
    els.eventDateInput.value = formatIsoDate(new Date());
    renderAll();

    try {
      setStatus("Chargement catalogue depuis Google Sheets…");
      await loadRemoteData();
      setStatus("");
    } catch (error) {
      loadLocalCatalogueFallback();
      setStatus(`Catalogue local affiché : ${error.message}`, "isError");
    }

    renderAll();
  };

  init();
})();
