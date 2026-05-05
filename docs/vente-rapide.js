(() => {
  "use strict";

  /*
    V1 locale :
    - On garde le modèle transaction + lignes de vente.
    - Les prix ci-dessous sont des valeurs de travail.
    - À terme, ce catalogue viendra de l’API / Google Sheets.
  */

  const JOURNEE_ACTIVE = {
    journee_id: "JOUR_SALAGNON_2026_05_04",
    mission_id: "MISSION_SALAGNON_2026",
    label: "Salagnon — J2",
    date_label: "lundi 04 mai 2026",
    vendeur: "Jérôme"
  };

  const CATALOGUE = [
    { parfum_code: "PE", parfum_nom: "Punch Exotique", format_cl: 50, prix_ttc: 30, actif: true },
    { parfum_code: "VB", parfum_nom: "Vanille Bleue", format_cl: 50, prix_ttc: 30, actif: true },
    { parfum_code: "VT", parfum_nom: "Vanille Tonka", format_cl: 50, prix_ttc: 30, actif: true },
    { parfum_code: "FP", parfum_nom: "Fraise Passion", format_cl: 50, prix_ttc: 30, actif: true },
    { parfum_code: "LP", parfum_nom: "Litchi Passion", format_cl: 50, prix_ttc: 30, actif: true },
    { parfum_code: "PR", parfum_nom: "Pomelo Romarin", format_cl: 50, prix_ttc: 30, actif: true },
    { parfum_code: "OC", parfum_nom: "Orange Café", format_cl: 50, prix_ttc: 30, actif: true },
    { parfum_code: "AT", parfum_nom: "Ananas Tonka", format_cl: 50, prix_ttc: 30, actif: true },
    { parfum_code: "CG", parfum_nom: "Citron Gingembre", format_cl: 50, prix_ttc: 30, actif: true },
    { parfum_code: "MV", parfum_nom: "Mangue Vanille", format_cl: 50, prix_ttc: 30, actif: true },

    { parfum_code: "PE", parfum_nom: "Punch Exotique", format_cl: 20, prix_ttc: 15, actif: true },
    { parfum_code: "VB", parfum_nom: "Vanille Bleue", format_cl: 20, prix_ttc: 15, actif: true },
    { parfum_code: "VT", parfum_nom: "Vanille Tonka", format_cl: 20, prix_ttc: 15, actif: true },
    { parfum_code: "FP", parfum_nom: "Fraise Passion", format_cl: 20, prix_ttc: 15, actif: true },
    { parfum_code: "LP", parfum_nom: "Litchi Passion", format_cl: 20, prix_ttc: 15, actif: true },
    { parfum_code: "PR", parfum_nom: "Pomelo Romarin", format_cl: 20, prix_ttc: 15, actif: true },
    { parfum_code: "OC", parfum_nom: "Orange Café", format_cl: 20, prix_ttc: 15, actif: true },
    { parfum_code: "AT", parfum_nom: "Ananas Tonka", format_cl: 20, prix_ttc: 15, actif: true },
    { parfum_code: "CG", parfum_nom: "Citron Gingembre", format_cl: 20, prix_ttc: 15, actif: true },
    { parfum_code: "MV", parfum_nom: "Mangue Vanille", format_cl: 20, prix_ttc: 15, actif: true },
    { parfum_code: "FF", parfum_nom: "Fève Fumée", format_cl: 20, prix_ttc: 15, actif: true }
  ].map((item) => ({
    ...item,
    sku_id: `${item.parfum_code}_${item.format_cl}`
  }));

  const STORAGE_KEY = "lugdurum_pending_transactions";
  const LAST_TICKET_KEY = "lugdurum_last_ticket";

  const state = {
    selectedFormat: 50,
    paymentMode: "ESP",
    items: new Map()
  };

  const els = {
    productGrid: document.getElementById("productGrid"),
    ticketLines: document.getElementById("ticketLines"),
    ticketTotal: document.getElementById("ticketTotal"),
    clearTicketBtn: document.getElementById("clearTicketBtn"),
    undoBtn: document.getElementById("undoBtn"),
    saveTicketBtn: document.getElementById("saveTicketBtn"),
    amountPaidInput: document.getElementById("amountPaidInput"),
    saveStatus: document.getElementById("saveStatus")
  };

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: value % 1 === 0 ? 0 : 2
    }).format(value || 0);

  const getCartLines = () =>
    [...state.items.values()]
      .filter((line) => line.quantite > 0)
      .sort((a, b) => {
        if (a.format_cl !== b.format_cl) return b.format_cl - a.format_cl;
        return a.parfum_code.localeCompare(b.parfum_code);
      });

  const getTotal = () =>
    getCartLines().reduce(
      (sum, line) => sum + line.quantite * line.prix_ttc,
      0
    );

  const renderProducts = () => {
    const products = CATALOGUE.filter(
      (product) => product.actif && product.format_cl === state.selectedFormat
    );

    els.productGrid.innerHTML = products
      .map((product) => {
        const cartLine = state.items.get(product.sku_id);
        const qty = cartLine?.quantite || 0;

        return `
          <button class="productBtn ${qty > 0 ? "hasQty" : ""}" type="button" data-sku="${product.sku_id}">
            <span class="productCode">${product.parfum_code}</span>
            <span class="productName">${product.parfum_nom}</span>
            <span class="productMeta">${product.format_cl} cL · ${formatCurrency(product.prix_ttc)}</span>
            ${qty > 0 ? `<strong class="productQty">×${qty}</strong>` : ""}
          </button>
        `;
      })
      .join("");
  };

  const renderCart = () => {
    const lines = getCartLines();
    const total = getTotal();

    els.ticketTotal.textContent = formatCurrency(total);

    if (lines.length === 0) {
      els.ticketLines.innerHTML = `<p class="emptyTicket">Aucun produit ajouté.</p>`;
      els.amountPaidInput.value = "";
      return;
    }

    els.ticketLines.innerHTML = lines
      .map((line) => {
        const lineTotal = line.quantite * line.prix_ttc;

        return `
          <article class="ticketLine">
            <div>
              <strong>${line.parfum_code} ${line.format_cl} cL</strong>
              <span>${line.parfum_nom} · ${formatCurrency(line.prix_ttc)}</span>
            </div>

            <div class="qtyControls" aria-label="Quantité ${line.parfum_code}">
              <button type="button" data-action="decrement" data-sku="${line.sku_id}">−</button>
              <span>${line.quantite}</span>
              <button type="button" data-action="increment" data-sku="${line.sku_id}">+</button>
            </div>

            <strong class="lineTotal">${formatCurrency(lineTotal)}</strong>
          </article>
        `;
      })
      .join("");
  };

  const renderPayment = () => {
    document.querySelectorAll(".paymentBtn").forEach((button) => {
      const isActive = button.dataset.payment === state.paymentMode;
      button.classList.toggle("isActive", isActive);
    });
  };

  const renderFormats = () => {
    document.querySelectorAll(".formatTab").forEach((button) => {
      const isActive = Number(button.dataset.format) === state.selectedFormat;
      button.classList.toggle("isActive", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  };

  const renderAll = () => {
    renderFormats();
    renderProducts();
    renderCart();
    renderPayment();
  };

  const addProduct = (skuId) => {
    const product = CATALOGUE.find((item) => item.sku_id === skuId);
    if (!product) return;

    const existing = state.items.get(skuId);

    state.items.set(skuId, {
      ...product,
      quantite: existing ? existing.quantite + 1 : 1
    });

    els.saveStatus.textContent = "";
    renderAll();
  };

  const changeQty = (skuId, delta) => {
    const existing = state.items.get(skuId);
    if (!existing) return;

    const nextQty = existing.quantite + delta;

    if (nextQty <= 0) {
      state.items.delete(skuId);
    } else {
      state.items.set(skuId, { ...existing, quantite: nextQty });
    }

    els.saveStatus.textContent = "";
    renderAll();
  };

  const clearTicket = () => {
    state.items.clear();
    els.amountPaidInput.value = "";
    els.saveStatus.textContent = "";
    renderAll();
  };

  const undoLastLine = () => {
    const lines = getCartLines();
    const last = lines[lines.length - 1];
    if (!last) return;

    changeQty(last.sku_id, -1);
  };

  const readPendingTransactions = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  };

  const savePendingTransaction = (transaction) => {
    const pending = readPendingTransactions();
    pending.push(transaction);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    localStorage.setItem(LAST_TICKET_KEY, JSON.stringify(transaction));
  };

  const buildTransaction = () => {
    const lines = getCartLines();
    const totalCatalogue = getTotal();
    const amountInput = Number(String(els.amountPaidInput.value).replace(",", "."));
    const totalEncaisse = Number.isFinite(amountInput) && amountInput > 0
      ? amountInput
      : totalCatalogue;

    const transactionId = `TX_${Date.now()}`;

    return {
      transaction_id: transactionId,
      journee_id: JOURNEE_ACTIVE.journee_id,
      mission_id: JOURNEE_ACTIVE.mission_id,
      vendeur: JOURNEE_ACTIVE.vendeur,
      date_heure_locale: new Date().toISOString(),
      mode_paiement: state.paymentMode,
      source: "WEBAPP_MANUAL",
      statut_sync: "pending",
      total_catalogue_ttc: totalCatalogue,
      total_catalogue_ht: totalCatalogue,
      total_encaisse_ttc: totalEncaisse,
      total_encaisse_ht: totalEncaisse,
      remise_totale: totalCatalogue - totalEncaisse,
      lignes: lines.map((line, index) => ({
        ligne_id: `${transactionId}_L${String(index + 1).padStart(2, "0")}`,
        transaction_id: transactionId,
        sku_id: line.sku_id,
        parfum_code: line.parfum_code,
        parfum_nom: line.parfum_nom,
        format_cl: line.format_cl,
        quantite: line.quantite,
        prix_unitaire_ttc: line.prix_ttc,
        prix_unitaire_ht: line.prix_ttc,
        total_catalogue_ligne_ttc: line.quantite * line.prix_ttc,
        total_catalogue_ligne_ht: line.quantite * line.prix_ttc
      }))
    };
  };

  const saveTicket = () => {
    const lines = getCartLines();

    if (lines.length === 0) {
      els.saveStatus.textContent = "Ajoute au moins un produit avant d’enregistrer.";
      els.saveStatus.className = "saveStatus isError";
      return;
    }

    const transaction = buildTransaction();
    savePendingTransaction(transaction);

    els.saveStatus.textContent = `Ticket enregistré en local · ${formatCurrency(transaction.total_encaisse_ttc)} · ${transaction.mode_paiement}`;
    els.saveStatus.className = "saveStatus isSuccess";

    state.items.clear();
    els.amountPaidInput.value = "";
    renderAll();
  };

  document.addEventListener("click", (event) => {
    const productBtn = event.target.closest(".productBtn");
    if (productBtn) {
      addProduct(productBtn.dataset.sku);
      return;
    }

    const formatTab = event.target.closest(".formatTab");
    if (formatTab) {
      state.selectedFormat = Number(formatTab.dataset.format);
      renderAll();
      return;
    }

    const paymentBtn = event.target.closest(".paymentBtn");
    if (paymentBtn) {
      state.paymentMode = paymentBtn.dataset.payment;
      els.saveStatus.textContent = "";
      renderPayment();
      return;
    }

    const qtyButton = event.target.closest("[data-action][data-sku]");
    if (qtyButton) {
      const delta = qtyButton.dataset.action === "increment" ? 1 : -1;
      changeQty(qtyButton.dataset.sku, delta);
    }
  });

  els.clearTicketBtn.addEventListener("click", clearTicket);
  els.undoBtn.addEventListener("click", undoLastLine);
  els.saveTicketBtn.addEventListener("click", saveTicket);

  renderAll();
})();
