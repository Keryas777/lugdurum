(() => {
  "use strict";

  /*
    V8 terrain :
    - Catalogue mocké sur la structure Google Sheets, en attendant l'API.
    - 50 cL vendu à l’unité.
    - 20 cL vendu uniquement en coffrets 3×20 ou 6×20.
    - Le mode 50 cL affiche les SKU actifs / visibles en format 50.
    - Les modes coffrets affichent les SKU actifs / visibles en format 20.
    - VB existe uniquement en 50 cL, donc n'apparaît pas en coffret.
    - FF et VK restent au catalogue mais ne sont pas visibles car plus commercialisés.
    - Supplément PE : +1 € par PE dans le coffret.
    - Les parfums du coffret peuvent être retirés un par un depuis la composition.
    - Les visuels de boutons sont chargés depuis ./assets/parfums/{code}.webp.
    - Le montant encaissé se remplit automatiquement avec le total du ticket.
    - Le montant encaissé reste modifiable manuellement.
  */

  const JOURNEE_ACTIVE = {
    journee_id: "JOUR_SALAGNON_2026_05_04",
    mission_id: "MISSION_SALAGNON_2026",
    label: "Salagnon — J2",
    date_label: "lundi 04 mai 2026",
    user_id: "U_JEROME",
    vendeur: "Jérôme"
  };

  const CATALOGUE = [
    {
      sku_id: "FF_50",
      parfum_code: "FF",
      parfum_nom: "Fraise Framboise",
      format_cl: 50,
      categorie: "bouteille",
      prix_ttc: 30,
      prix_ht: 30,
      taux_tva: 0,
      actif: false,
      visible_webapp: false,
      ordre_affichage: 10
    },
    {
      sku_id: "FF_20",
      parfum_code: "FF",
      parfum_nom: "Fraise Framboise",
      format_cl: 20,
      categorie: "bouteille",
      prix_ttc: 0,
      prix_ht: 0,
      taux_tva: 0,
      actif: false,
      visible_webapp: false,
      ordre_affichage: 10
    },
    {
      sku_id: "VK_50",
      parfum_code: "VK",
      parfum_nom: "Vanille Kiwi",
      format_cl: 50,
      categorie: "bouteille",
      prix_ttc: 30,
      prix_ht: 30,
      taux_tva: 0,
      actif: false,
      visible_webapp: false,
      ordre_affichage: 20
    },
    {
      sku_id: "VK_20",
      parfum_code: "VK",
      parfum_nom: "Vanille Kiwi",
      format_cl: 20,
      categorie: "bouteille",
      prix_ttc: 0,
      prix_ht: 0,
      taux_tva: 0,
      actif: false,
      visible_webapp: false,
      ordre_affichage: 20
    },
    {
      sku_id: "AT_50",
      parfum_code: "AT",
      parfum_nom: "Abricot Tonka",
      format_cl: 50,
      categorie: "bouteille",
      prix_ttc: 30,
      prix_ht: 30,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 30
    },
    {
      sku_id: "AT_20",
      parfum_code: "AT",
      parfum_nom: "Abricot Tonka",
      format_cl: 20,
      categorie: "bouteille",
      prix_ttc: 0,
      prix_ht: 0,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 30
    },
    {
      sku_id: "MV_50",
      parfum_code: "MV",
      parfum_nom: "Mirabelle Vanille",
      format_cl: 50,
      categorie: "bouteille",
      prix_ttc: 30,
      prix_ht: 30,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 40
    },
    {
      sku_id: "MV_20",
      parfum_code: "MV",
      parfum_nom: "Mirabelle Vanille",
      format_cl: 20,
      categorie: "bouteille",
      prix_ttc: 0,
      prix_ht: 0,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 40
    },
    {
      sku_id: "CG_50",
      parfum_code: "CG",
      parfum_nom: "Citron Gingembre",
      format_cl: 50,
      categorie: "bouteille",
      prix_ttc: 30,
      prix_ht: 30,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 50
    },
    {
      sku_id: "CG_20",
      parfum_code: "CG",
      parfum_nom: "Citron Gingembre",
      format_cl: 20,
      categorie: "bouteille",
      prix_ttc: 0,
      prix_ht: 0,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 50
    },
    {
      sku_id: "OC_50",
      parfum_code: "OC",
      parfum_nom: "Orange Cannelle",
      format_cl: 50,
      categorie: "bouteille",
      prix_ttc: 30,
      prix_ht: 30,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 60
    },
    {
      sku_id: "OC_20",
      parfum_code: "OC",
      parfum_nom: "Orange Cannelle",
      format_cl: 20,
      categorie: "bouteille",
      prix_ttc: 0,
      prix_ht: 0,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 60
    },
    {
      sku_id: "PR_50",
      parfum_code: "PR",
      parfum_nom: "Pomelo Romarin",
      format_cl: 50,
      categorie: "bouteille",
      prix_ttc: 30,
      prix_ht: 30,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 70
    },
    {
      sku_id: "PR_20",
      parfum_code: "PR",
      parfum_nom: "Pomelo Romarin",
      format_cl: 20,
      categorie: "bouteille",
      prix_ttc: 0,
      prix_ht: 0,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 70
    },
    {
      sku_id: "FP_50",
      parfum_code: "FP",
      parfum_nom: "Framboise Passion",
      format_cl: 50,
      categorie: "bouteille",
      prix_ttc: 30,
      prix_ht: 30,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 80
    },
    {
      sku_id: "FP_20",
      parfum_code: "FP",
      parfum_nom: "Framboise Passion",
      format_cl: 20,
      categorie: "bouteille",
      prix_ttc: 0,
      prix_ht: 0,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 80
    },
    {
      sku_id: "LP_50",
      parfum_code: "LP",
      parfum_nom: "Litchi Poivre de Sichuan",
      format_cl: 50,
      categorie: "bouteille",
      prix_ttc: 30,
      prix_ht: 30,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 90
    },
    {
      sku_id: "LP_20",
      parfum_code: "LP",
      parfum_nom: "Litchi Poivre de Sichuan",
      format_cl: 20,
      categorie: "bouteille",
      prix_ttc: 0,
      prix_ht: 0,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 90
    },
    {
      sku_id: "VT_50",
      parfum_code: "VT",
      parfum_nom: "Vanille Tonka",
      format_cl: 50,
      categorie: "bouteille",
      prix_ttc: 30,
      prix_ht: 30,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 100
    },
    {
      sku_id: "VT_20",
      parfum_code: "VT",
      parfum_nom: "Vanille Tonka",
      format_cl: 20,
      categorie: "bouteille",
      prix_ttc: 0,
      prix_ht: 0,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 100
    },
    {
      sku_id: "PE_50",
      parfum_code: "PE",
      parfum_nom: "Pain d'Épices",
      format_cl: 50,
      categorie: "bouteille",
      prix_ttc: 31,
      prix_ht: 31,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 110
    },
    {
      sku_id: "PE_20",
      parfum_code: "PE",
      parfum_nom: "Pain d'Épices",
      format_cl: 20,
      categorie: "bouteille",
      prix_ttc: 0,
      prix_ht: 0,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 110
    },
    {
      sku_id: "VB_50",
      parfum_code: "VB",
      parfum_nom: "Vanille Bleue",
      format_cl: 50,
      categorie: "bouteille",
      prix_ttc: 30,
      prix_ht: 30,
      taux_tva: 0,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 120
    }
  ];

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
      base_price: 45.99,
      pe_surcharge: 1
    },
    BOX_6_20: {
      label: "Coffret 6×20 cL",
      kind: "box",
      format_cl: 20,
      box_size: 6,
      base_price: 87.99,
      pe_surcharge: 1
    }
  };

  const STORAGE_KEY = "lugdurum_pending_transactions";
  const LAST_TICKET_KEY = "lugdurum_last_ticket";

  const state = {
    selectedMode: "BOTTLE_50",
    paymentMode: "ESP",
    ticketItems: [],
    draftPack: [],
    amountManuallyEdited: false
  };

  const els = {
    productGrid: document.getElementById("productGrid"),
    ticketLines: document.getElementById("ticketLines"),
    ticketTotal: document.getElementById("ticketTotal"),
    ticketPanelTotal: document.getElementById("ticketPanelTotal"),
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
    saveStatus: document.getElementById("saveStatus")
  };

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value || 0);

  const formatAmountInput = (value) =>
    (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);

  const syncAmountPaidInput = (total) => {
    if (state.amountManuallyEdited) return;

    els.amountPaidInput.value = total > 0 ? formatAmountInput(total) : "";
  };

  const getMode = () => SALE_MODES[state.selectedMode];

  const isBoxMode = () => getMode().kind === "box";

  const getProductImageSrc = (product) =>
    product.image_src || `./assets/parfums/${product.parfum_code.toLowerCase()}.webp`;

  const getVisibleProducts = () => {
    const mode = getMode();

    return CATALOGUE
      .filter((product) => product.actif)
      .filter((product) => product.visible_webapp)
      .filter((product) => product.format_cl === mode.format_cl)
      .sort((a, b) => a.ordre_affichage - b.ordre_affichage);
  };

  const findProductBySku = (skuId) =>
    CATALOGUE.find((product) => product.sku_id === skuId);

  const getPeCount = (composition) =>
    composition.filter((item) => item.parfum_code === "PE").length;

  const getPackPrice = (composition, mode = getMode()) => {
    const peCount = getPeCount(composition);
    return mode.base_price + peCount * mode.pe_surcharge;
  };

  const getItemTotal = (item) => {
    if (item.type === "bottle") return item.quantite * item.prix_unitaire_ttc;
    if (item.type === "box") return item.prix_ttc;
    return 0;
  };

  const getTicketTotal = () =>
    state.ticketItems.reduce((sum, item) => sum + getItemTotal(item), 0);

  const getDraftCounts = () => {
    return state.draftPack.reduce((map, product) => {
      map.set(product.parfum_code, (map.get(product.parfum_code) || 0) + 1);
      return map;
    }, new Map());
  };

  const getDraftProductByCode = (parfumCode) =>
    state.draftPack.find((product) => product.parfum_code === parfumCode) ||
    CATALOGUE.find((product) => product.parfum_code === parfumCode && product.format_cl === 20);

  const removeOneDraftProduct = (parfumCode) => {
    for (let i = state.draftPack.length - 1; i >= 0; i -= 1) {
      if (state.draftPack[i].parfum_code === parfumCode) {
        state.draftPack.splice(i, 1);
        break;
      }
    }

    els.saveStatus.textContent = "";
    renderAll();
  };

  const getTicketBottleQty = (skuId) => {
    return state.ticketItems
      .filter((item) => item.type === "bottle" && item.sku_id === skuId)
      .reduce((sum, item) => sum + item.quantite, 0);
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

    els.productGrid.innerHTML = getVisibleProducts()
      .map((product) => {
        const qty = isBoxMode()
          ? draftCounts.get(product.parfum_code) || 0
          : getTicketBottleQty(product.sku_id);

        const meta = isBoxMode()
          ? `${product.format_cl} cL · dans le coffret`
          : `${product.format_cl} cL · ${formatCurrency(product.prix_ttc)}`;

        return `
          <button
            class="productBtn ${qty > 0 ? "hasQty" : ""}"
            type="button"
            data-sku="${product.sku_id}"
            data-parfum="${product.parfum_code}"
            style="--product-bg: url('${getProductImageSrc(product)}')"
          >
            <span class="productCode">${product.parfum_code}</span>
            <span class="productName">${product.parfum_nom}</span>
            <span class="productMeta">${meta}</span>
            ${qty > 0 ? `<strong class="productQty">×${qty}</strong>` : ""}
          </button>
        `;
      })
      .join("");
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
    const peCount = getPeCount(state.draftPack);
    const peSurchargeTotal = peCount * mode.pe_surcharge;
    const price = getPackPrice(state.draftPack, mode);

    els.packProgressLabel.textContent = `${current} / ${max} parfums`;
    els.packPricePreview.textContent = formatCurrency(price);
    els.packProgressBar.max = max;
    els.packProgressBar.value = current;
    els.addPackBtn.disabled = current !== max;

    if (current === 0) {
      els.draftPackList.innerHTML = `<p class="emptyTicket">Choisis les ${max} parfums du coffret.</p>`;
      return;
    }

    const counts = getDraftCounts();
    const lines = [...counts.entries()]
      .map(([code, qty]) => {
        const product = getDraftProductByCode(code);
        return { ...product, qty };
      })
      .sort((a, b) => a.ordre_affichage - b.ordre_affichage);

    els.draftPackList.innerHTML = `
      <div class="draftChips">
        ${lines
          .map((line) => `
            <button
              class="draftChip"
              type="button"
              data-remove-draft-code="${line.parfum_code}"
              aria-label="Retirer un ${line.parfum_code} du coffret"
              title="Toucher pour retirer"
            >
              ${line.parfum_code}${line.qty > 1 ? ` ×${line.qty}` : ""}
            </button>
          `)
          .join("")}
      </div>
      <p class="packHint">
        ${peCount > 0
          ? `Supplément PE appliqué : +${formatCurrency(peSurchargeTotal)}`
          : "Aucun supplément PE pour ce coffret."}
      </p>
    `;
  };

  const renderCart = () => {
    const total = getTicketTotal();

    els.ticketTotal.textContent = formatCurrency(total);

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
            .map(([code, qty]) => `<span class="ticketChip">${code}${qty > 1 ? ` ×${qty}` : ""}</span>`)
            .join("");

          return `
            <article class="ticketLine ticketLineBox">
              <div>
                <strong>${item.label}</strong>
                <span>${chips}</span>
              </div>

              <button class="removeLineBtn" type="button" data-remove-item="${item.item_id}">
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
              <strong>${item.parfum_code} ${item.format_cl} cL</strong>
              <span>${item.parfum_nom} · ${formatCurrency(item.prix_unitaire_ttc)}</span>
            </div>

            <div class="qtyControls" aria-label="Quantité ${item.parfum_code}">
              <button type="button" data-action="decrement" data-item="${item.item_id}">−</button>
              <span>${item.quantite}</span>
              <button type="button" data-action="increment" data-item="${item.item_id}">+</button>
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
  };

  const renderAll = () => {
    renderModes();
    renderPackComposer();
    renderProducts();
    renderCart();
    renderPayment();
  };

  const addBottle = (product) => {
    const existing = state.ticketItems.find(
      (item) => item.type === "bottle" && item.sku_id === product.sku_id
    );

    if (existing) {
      existing.quantite += 1;
    } else {
      state.ticketItems.push({
        item_id: `ITEM_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        type: "bottle",
        sku_id: product.sku_id,
        parfum_code: product.parfum_code,
        parfum_nom: product.parfum_nom,
        format_cl: product.format_cl,
        quantite: 1,
        prix_unitaire_ttc: product.prix_ttc,
        prix_unitaire_ht: product.prix_ht
      });
    }
  };

  const addProductToDraftPack = (product) => {
    const mode = getMode();

    if (state.draftPack.length >= mode.box_size) {
      els.saveStatus.textContent = "Le coffret est complet. Ajoute-le au ticket ou vide la composition.";
      els.saveStatus.className = "saveStatus isError";
      return;
    }

    state.draftPack.push({ ...product });
  };

  const addPackToTicket = () => {
    const mode = getMode();

    if (!isBoxMode() || state.draftPack.length !== mode.box_size) return;

    const composition = state.draftPack.map((product) => ({ ...product }));
    const price = getPackPrice(composition, mode);
    const peCount = getPeCount(composition);

    state.ticketItems.push({
      item_id: `BOX_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type: "box",
      label: mode.label,
      conditionnement: state.selectedMode,
      format_cl: mode.format_cl,
      box_size: mode.box_size,
      prix_ttc: price,
      prix_ht: price,
      base_price: mode.base_price,
      supplement_pe_ttc: peCount * mode.pe_surcharge,
      composition
    });

    state.draftPack = [];
    els.saveStatus.textContent = `${mode.label} ajouté au ticket.`;
    els.saveStatus.className = "saveStatus isSuccess";
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
    els.saveStatus.textContent = "";
    renderAll();
  };

  const undoLast = () => {
    if (state.draftPack.length > 0) {
      state.draftPack.pop();
    } else {
      state.ticketItems.pop();
    }

    els.saveStatus.textContent = "";
    renderAll();
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

  const getSourceForPayment = () => {
    if (state.paymentMode === "ESP") return "WEBAPP_ESPECES";
    if (state.paymentMode === "CHQ") return "WEBAPP_CHEQUE";
    if (state.paymentMode === "CB") return "WEBAPP_CB_MANUEL";
    return "MANUEL";
  };

  const buildSaleLines = (transactionId) => {
    const lines = [];

    state.ticketItems.forEach((item) => {
      if (item.type === "bottle") {
        lines.push({
          ligne_id: `${transactionId}_L${String(lines.length + 1).padStart(2, "0")}`,
          transaction_id: transactionId,
          mission_id: JOURNEE_ACTIVE.mission_id,
          journee_id: JOURNEE_ACTIVE.journee_id,
          sku_id: item.sku_id,
          quantite: item.quantite,
          prix_unitaire_ttc: item.prix_unitaire_ttc,
          prix_unitaire_ht: item.prix_unitaire_ht,
          taux_tva: 0,
          montant_tva_ligne: 0,
          total_catalogue_ligne_ttc: item.quantite * item.prix_unitaire_ttc,
          total_catalogue_ligne_ht: item.quantite * item.prix_unitaire_ht,
          source: getSourceForPayment(),
          note: ""
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

        const peCount = getPeCount(item.composition);
        const baseUnitPrice = item.base_price / item.box_size;
        const surchargePerPE = peCount > 0 ? item.supplement_pe_ttc / peCount : 0;

        [...counts.values()].forEach(({ product, qty }) => {
          const unitPrice =
            baseUnitPrice + (product.parfum_code === "PE" ? surchargePerPE : 0);

          const totalLine = unitPrice * qty;

          lines.push({
            ligne_id: `${transactionId}_L${String(lines.length + 1).padStart(2, "0")}`,
            transaction_id: transactionId,
            mission_id: JOURNEE_ACTIVE.mission_id,
            journee_id: JOURNEE_ACTIVE.journee_id,
            sku_id: product.sku_id,
            quantite: qty,
            prix_unitaire_ttc: unitPrice,
            prix_unitaire_ht: unitPrice,
            taux_tva: 0,
            montant_tva_ligne: 0,
            total_catalogue_ligne_ttc: totalLine,
            total_catalogue_ligne_ht: totalLine,
            source: getSourceForPayment(),
            note: `${item.label} · ${item.composition.map((p) => p.parfum_code).join(" ")}`
          });
        });
      }
    });

    return lines;
  };

  const buildTransaction = () => {
    const transactionId = `TX_${Date.now()}`;
    const totalCatalogue = getTicketTotal();
    const amountInput = Number(String(els.amountPaidInput.value).replace(",", "."));
    const totalEncaisse = Number.isFinite(amountInput) && amountInput > 0
      ? amountInput
      : totalCatalogue;

    return {
      transaction_id: transactionId,
      date_heure: new Date().toISOString(),
      mission_id: JOURNEE_ACTIVE.mission_id,
      journee_id: JOURNEE_ACTIVE.journee_id,
      user_id: JOURNEE_ACTIVE.user_id,
      mode_paiement: state.paymentMode,
      source: getSourceForPayment(),
      source_id: "",
      total_catalogue_ttc: totalCatalogue,
      total_catalogue_ht: totalCatalogue,
      total_tva: 0,
      total_encaisse_ttc: totalEncaisse,
      remise_totale: totalCatalogue - totalEncaisse,
      motif_remise: totalCatalogue !== totalEncaisse ? "Montant encaissé modifié" : "",
      statut: "validee",
      note: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      lignes: buildSaleLines(transactionId),
      detail_ticket: state.ticketItems
    };
  };

  const saveTicket = () => {
    if (state.ticketItems.length === 0) {
      els.saveStatus.textContent = "Ajoute au moins un produit avant d’enregistrer.";
      els.saveStatus.className = "saveStatus isError";
      return;
    }

    if (state.draftPack.length > 0) {
      els.saveStatus.textContent = "Tu as un coffret en cours non ajouté au ticket.";
      els.saveStatus.className = "saveStatus isError";
      return;
    }

    const transaction = buildTransaction();
    savePendingTransaction(transaction);

    els.saveStatus.textContent = `Ticket enregistré en local · ${formatCurrency(transaction.total_encaisse_ttc)} · ${transaction.mode_paiement}`;
    els.saveStatus.className = "saveStatus isSuccess";

    state.ticketItems = [];
    state.draftPack = [];
    els.amountPaidInput.value = "";
    state.amountManuallyEdited = false;
    renderAll();
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
      els.saveStatus.textContent = "";
      renderAll();
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

      els.saveStatus.textContent = "";
      renderAll();
      return;
    }

    const paymentButton = event.target.closest(".paymentBtn");
    if (paymentButton) {
      state.paymentMode = paymentButton.dataset.payment;
      els.saveStatus.textContent = "";
      renderPayment();
      return;
    }

    const qtyButton = event.target.closest("[data-action][data-item]");
    if (qtyButton) {
      const delta = qtyButton.dataset.action === "increment" ? 1 : -1;
      changeBottleQty(qtyButton.dataset.item, delta);
      els.saveStatus.textContent = "";
      renderAll();
      return;
    }

    const removeButton = event.target.closest("[data-remove-item]");
    if (removeButton) {
      removeTicketItem(removeButton.dataset.removeItem);
      els.saveStatus.textContent = "";
      renderAll();
    }
  });

  els.amountPaidInput.addEventListener("input", () => {
    state.amountManuallyEdited = els.amountPaidInput.value.trim() !== "";
  });

  els.clearDraftPackBtn.addEventListener("click", () => {
    state.draftPack = [];
    els.saveStatus.textContent = "";
    renderAll();
  });

  els.addPackBtn.addEventListener("click", addPackToTicket);
  els.clearTicketBtn.addEventListener("click", clearTicket);
  els.undoBtn.addEventListener("click", undoLast);
  els.saveTicketBtn.addEventListener("click", saveTicket);

  renderAll();
})();