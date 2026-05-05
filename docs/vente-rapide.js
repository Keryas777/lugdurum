(() => {
  "use strict";

  /*
    V3 terrain :
    - 50 cL vendu à l’unité.
    - 20 cL vendu uniquement en coffrets 3×20 ou 6×20.
    - Un même parfum peut apparaître plusieurs fois dans un coffret.
    - Supplément PE : +1 € par coffret si au moins un PE est présent.
    - Les parfums du coffret peuvent être retirés un par un depuis la composition.
  */

  const JOURNEE_ACTIVE = {
    journee_id: "JOUR_SALAGNON_2026_05_04",
    mission_id: "MISSION_SALAGNON_2026",
    label: "Salagnon — J2",
    date_label: "lundi 04 mai 2026",
    user_id: "U_JEROME",
    vendeur: "Jérôme"
  };

  const PERFUMES = [
    { parfum_code: "PE", parfum_nom: "Punch Exotique", ordre: 10 },
    { parfum_code: "VB", parfum_nom: "Vanille Bleue", ordre: 20 },
    { parfum_code: "VT", parfum_nom: "Vanille Tonka", ordre: 30 },
    { parfum_code: "FP", parfum_nom: "Fraise Passion", ordre: 40 },
    { parfum_code: "LP", parfum_nom: "Litchi Passion", ordre: 50 },
    { parfum_code: "PR", parfum_nom: "Pomelo Romarin", ordre: 60 },
    { parfum_code: "OC", parfum_nom: "Orange Café", ordre: 70 },
    { parfum_code: "AT", parfum_nom: "Ananas Tonka", ordre: 80 },
    { parfum_code: "CG", parfum_nom: "Citron Gingembre", ordre: 90 },
    { parfum_code: "MV", parfum_nom: "Mangue Vanille", ordre: 100 },
    { parfum_code: "FF", parfum_nom: "Fève Fumée", ordre: 110, only20: true }
  ];

  const SALE_MODES = {
    BOTTLE_50: {
      label: "50 cL",
      kind: "bottle",
      format_cl: 50,
      unit_price: 30
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
    draftPack: []
  };

  const els = {
    productGrid: document.getElementById("productGrid"),
    ticketLines: document.getElementById("ticketLines"),
    ticketTotal: document.getElementById("ticketTotal"),
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

  const getMode = () => SALE_MODES[state.selectedMode];

  const isBoxMode = () => getMode().kind === "box";

  const getVisiblePerfumes = () => {
    const mode = getMode();

    return PERFUMES
      .filter((perfume) => mode.format_cl === 20 || !perfume.only20)
      .sort((a, b) => a.ordre - b.ordre);
  };

  const getPackPrice = (composition, mode = getMode()) => {
    const hasPE = composition.some((item) => item.parfum_code === "PE");
    return mode.base_price + (hasPE ? mode.pe_surcharge : 0);
  };

  const getItemTotal = (item) => {
    if (item.type === "bottle") return item.quantite * item.prix_unitaire_ttc;
    if (item.type === "box") return item.prix_ttc;
    return 0;
  };

  const getTicketTotal = () =>
    state.ticketItems.reduce((sum, item) => sum + getItemTotal(item), 0);

  const getDraftCounts = () => {
    return state.draftPack.reduce((map, perfume) => {
      map.set(perfume.parfum_code, (map.get(perfume.parfum_code) || 0) + 1);
      return map;
    }, new Map());
  };

  const removeOneDraftPerfume = (parfumCode) => {
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
    const mode = getMode();
    const draftCounts = getDraftCounts();

    els.productGrid.innerHTML = getVisiblePerfumes()
      .map((perfume) => {
        const skuId = `${perfume.parfum_code}_${mode.format_cl}`;
        const qty = isBoxMode()
          ? draftCounts.get(perfume.parfum_code) || 0
          : getTicketBottleQty(skuId);

        const meta = isBoxMode()
          ? `${mode.format_cl} cL · dans le coffret`
          : `${mode.format_cl} cL · ${formatCurrency(mode.unit_price)}`;

        return `
          <button class="productBtn ${qty > 0 ? "hasQty" : ""}" type="button" data-parfum="${perfume.parfum_code}">
            <span class="productCode">${perfume.parfum_code}</span>
            <span class="productName">${perfume.parfum_nom}</span>
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
        const perfume = PERFUMES.find((item) => item.parfum_code === code);
        return { ...perfume, qty };
      })
      .sort((a, b) => a.ordre - b.ordre);

    els.draftPackList.innerHTML = `
      <div class="draftChips">
        ${lines
          .map((line) => `
            <button
              class="draftChip"
              type="button"
              data-remove-draft-code="${line.parfum_code}"
              aria-label="Retirer un ${line.parfum_code} du coffret"
            >
              <span>${line.parfum_code}${line.qty > 1 ? ` ×${line.qty}` : ""}</span>
              <span class="draftChipMinus" aria-hidden="true">−</span>
            </button>
          `)
          .join("")}
      </div>
      <p class="packHint">
        ${state.draftPack.some((item) => item.parfum_code === "PE")
          ? "Supplément PE appliqué : +1 €"
          : "Aucun supplément PE pour ce coffret."}
      </p>
    `;
  };

  const renderCart = () => {
    const total = getTicketTotal();
    els.ticketTotal.textContent = formatCurrency(total);

    if (state.ticketItems.length === 0) {
      els.ticketLines.innerHTML = `<p class="emptyTicket">Aucun produit ajouté.</p>`;
      els.amountPaidInput.value = "";
      return;
    }

    els.ticketLines.innerHTML = state.ticketItems
      .map((item) => {
        if (item.type === "box") {
          const counts = item.composition.reduce((map, perfume) => {
            map.set(perfume.parfum_code, (map.get(perfume.parfum_code) || 0) + 1);
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

  const findPerfume = (code) => PERFUMES.find((perfume) => perfume.parfum_code === code);

  const addBottle50 = (perfume) => {
    const skuId = `${perfume.parfum_code}_50`;
    const existing = state.ticketItems.find((item) => item.type === "bottle" && item.sku_id === skuId);

    if (existing) {
      existing.quantite += 1;
    } else {
      state.ticketItems.push({
        item_id: `ITEM_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        type: "bottle",
        sku_id: skuId,
        parfum_code: perfume.parfum_code,
        parfum_nom: perfume.parfum_nom,
        format_cl: 50,
        quantite: 1,
        prix_unitaire_ttc: SALE_MODES.BOTTLE_50.unit_price,
        prix_unitaire_ht: SALE_MODES.BOTTLE_50.unit_price
      });
    }
  };

  const addPerfumeToDraftPack = (perfume) => {
    const mode = getMode();

    if (state.draftPack.length >= mode.box_size) {
      els.saveStatus.textContent = "Le coffret est complet. Ajoute-le au ticket ou vide la composition.";
      els.saveStatus.className = "saveStatus isError";
      return;
    }

    state.draftPack.push(perfume);
  };

  const addPackToTicket = () => {
    const mode = getMode();

    if (!isBoxMode() || state.draftPack.length !== mode.box_size) return;

    const composition = state.draftPack.map((perfume) => ({ ...perfume }));
    const price = getPackPrice(composition, mode);

    state.ticketItems.push({
      item_id: `BOX_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type: "box",
      label: mode.label,
      conditionnement: state.selectedMode,
      format_cl: 20,
      box_size: mode.box_size,
      prix_ttc: price,
      prix_ht: price,
      base_price: mode.base_price,
      supplement_pe_ttc: composition.some((item) => item.parfum_code === "PE")
        ? mode.pe_surcharge
        : 0,
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
        const counts = item.composition.reduce((map, perfume) => {
          map.set(perfume.parfum_code, (map.get(perfume.parfum_code) || 0) + 1);
          return map;
        }, new Map());

        const peCount = counts.get("PE") || 0;
        const baseUnitPrice = item.base_price / item.box_size;
        const surchargePerPE = peCount > 0 ? item.supplement_pe_ttc / peCount : 0;

        [...counts.entries()].forEach(([code, qty]) => {
          const unitPrice = baseUnitPrice + (code === "PE" ? surchargePerPE : 0);
          const totalLine = unitPrice * qty;

          lines.push({
            ligne_id: `${transactionId}_L${String(lines.length + 1).padStart(2, "0")}`,
            transaction_id: transactionId,
            mission_id: JOURNEE_ACTIVE.mission_id,
            journee_id: JOURNEE_ACTIVE.journee_id,
            sku_id: `${code}_20`,
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
    renderAll();
  };

  document.addEventListener("click", (event) => {
    const draftRemoveButton = event.target.closest("[data-remove-draft-code]");
    if (draftRemoveButton) {
      removeOneDraftPerfume(draftRemoveButton.dataset.removeDraftCode);
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
      const perfume = findPerfume(productButton.dataset.parfum);
      if (!perfume) return;

      if (isBoxMode()) {
        addPerfumeToDraftPack(perfume);
      } else {
        addBottle50(perfume);
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