(() => {
  "use strict";

  /*
    V10 terrain :
    - Catalogue chargé depuis Google Sheets via lugdurum-api.js.
    - Fallback sur le dernier catalogue chargé en localStorage si l’API est indisponible.
    - 50 cL vendu à l’unité.
    - 20 cL vendu uniquement en coffrets 3×20 ou 6×20.
    - Le mode 50 cL affiche les SKU actifs / visibles en format 50.
    - Les modes coffrets affichent les SKU actifs / visibles en format 20.
    - VB existe uniquement en 50 cL, donc n'apparaît pas en coffret si aucun SKU VB_20 n’existe dans le Sheet.
    - FF et VK restent au catalogue mais ne sont pas visibles si actif = false.
    - Supplément PE : +1 € par PE dans le coffret.
    - Les parfums du coffret peuvent être retirés un par un depuis la composition.
    - Les visuels de boutons sont chargés depuis ./assets/parfums/{code}.webp.
    - Le montant encaissé se remplit automatiquement avec le total du ticket.
    - Le montant encaissé reste modifiable manuellement.
    - LP reçoit une classe spéciale pour mieux gérer son nom long.
    - MV et PE reçoivent une classe spéciale pour texte clair sur fond sombre.
  */

  const JOURNEE_ACTIVE = {
    journee_id: "JOUR_SALAGNON_2026_05_04",
    mission_id: "MISSION_SALAGNON_2026",
    label: "Salagnon — J2",
    date_label: "lundi 04 mai 2026",
    user_id: "U_JEROME",
    vendeur: "Jérôme"
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
  const CATALOGUE_CACHE_KEY = "lugdurum_catalogue_cache";

  const state = {
    selectedMode: "BOTTLE_50",
    paymentMode: "ESP",
    ticketItems: [],
    draftPack: [],
    amountManuallyEdited: false,
    catalogue: [],
    catalogueLoaded: false
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

  const getFallbackProductPrice = (product) => {
    if (product.format_cl === 50 && product.parfum_code === "PE") return 31;
    if (product.format_cl === 50) return 30;
    return 0;
  };

  const normalizeProduct = (rawProduct, index) => {
    const parfumCode = String(rawProduct.parfum_code || "")
      .trim()
      .toUpperCase();

    const formatCl = toNumber(rawProduct.format_cl, 0);
    const fallbackPrice = getFallbackProductPrice({
      parfum_code: parfumCode,
      format_cl: formatCl
    });

    const hasVisibleWebappColumn = Object.prototype.hasOwnProperty.call(
      rawProduct,
      "visible_webapp"
    );

    return {
      sku_id: String(rawProduct.sku_id || `${parfumCode}_${formatCl}`).trim(),
      parfum_code: parfumCode,
      parfum_nom: String(rawProduct.parfum_nom || parfumCode).trim(),
      format_cl: formatCl,
      categorie: String(rawProduct.categorie || "bouteille").trim(),
      prix_ttc: toNumber(rawProduct.prix_ttc, fallbackPrice),
      prix_ht: toNumber(rawProduct.prix_ht, toNumber(rawProduct.prix_ttc, fallbackPrice)),
      taux_tva: toNumber(rawProduct.taux_tva, 0),
      regime_tva: String(rawProduct.regime_tva || "").trim(),
      cout_revient: toNumber(rawProduct.cout_revient, 0),
      marge_unitaire: toNumber(rawProduct.marge_unitaire, 0),
      actif: toBoolean(rawProduct.actif, false),
      visible_webapp: hasVisibleWebappColumn
        ? toBoolean(rawProduct.visible_webapp, true)
        : true,
      ordre_affichage: toNumber(rawProduct.ordre_affichage, 1000 + index),
      note: String(rawProduct.note || "").trim(),
      image_src: String(rawProduct.image_src || "").trim()
    };
  };

  const readCachedCatalogue = () => {
    try {
      return JSON.parse(localStorage.getItem(CATALOGUE_CACHE_KEY) || "[]");
    } catch {
      return [];
    }
  };

  const writeCachedCatalogue = (catalogue) => {
    localStorage.setItem(CATALOGUE_CACHE_KEY, JSON.stringify(catalogue));
  };

  const setStatus = (message, type = "") => {
    if (!els.saveStatus) return;

    els.saveStatus.textContent = message;
    els.saveStatus.className = "saveStatus";

    if (type) {
      els.saveStatus.classList.add(type);
    }
  };

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

    return state.catalogue
      .filter((product) => product.actif)
      .filter((product) => product.visible_webapp !== false)
      .filter((product) => product.format_cl === mode.format_cl)
      .sort((a, b) => {
        const byOrder = a.ordre_affichage - b.ordre_affichage;
        if (byOrder !== 0) return byOrder;

        return String(a.parfum_code).localeCompare(String(b.parfum_code));
      });
  };

  const findProductBySku = (skuId) =>
    state.catalogue.find((product) => product.sku_id === skuId);

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

    if (!state.catalogueLoaded && state.catalogue.length === 0) {
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

        const meta = isBoxMode()
          ? `${product.format_cl} cL · dans le coffret`
          : `${product.format_cl} cL · ${formatCurrency(product.prix_ttc)}`;

        const buttonClasses = [
          "productBtn",
          qty > 0 ? "hasQty" : "",
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
          peCount > 0
            ? `Supplément PE appliqué : +${formatCurrency(peSurchargeTotal)}`
            : "Aucun supplément PE pour ce coffret."
        }
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
      setStatus("Le coffret est complet. Ajoute-le au ticket ou vide la composition.", "isError");
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
    setStatus(`${mode.label} ajouté au ticket.`, "isSuccess");
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
    const totalEncaisse =
      Number.isFinite(amountInput) && amountInput > 0 ? amountInput : totalCatalogue;

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
      setStatus("Ajoute au moins un produit avant d’enregistrer.", "isError");
      return;
    }

    if (state.draftPack.length > 0) {
      setStatus("Tu as un coffret en cours non ajouté au ticket.", "isError");
      return;
    }

    const transaction = buildTransaction();
    savePendingTransaction(transaction);

    setStatus(
      `Ticket enregistré en local · ${formatCurrency(transaction.total_encaisse_ttc)} · ${transaction.mode_paiement}`,
      "isSuccess"
    );

    state.ticketItems = [];
    state.draftPack = [];
    els.amountPaidInput.value = "";
    state.amountManuallyEdited = false;
    renderAll();
  };

  const loadCatalogue = async () => {
    renderProducts();

    try {
      if (!window.LugdurumAPI || typeof window.LugdurumAPI.getCatalogue !== "function") {
        throw new Error("lugdurum-api.js n’est pas chargé.");
      }

      const rows = await window.LugdurumAPI.getCatalogue();

      state.catalogue = rows
        .map((row, index) => normalizeProduct(row, index))
        .filter((product) => product.sku_id && product.parfum_code && product.format_cl);

      state.catalogueLoaded = true;
      writeCachedCatalogue(state.catalogue);

      setStatus("");
      renderAll();
    } catch (error) {
      const cached = readCachedCatalogue();

      if (cached.length > 0) {
        state.catalogue = cached.map((row, index) => normalizeProduct(row, index));
        state.catalogueLoaded = true;

        setStatus("Catalogue chargé depuis le cache local.", "isError");
        renderAll();
        return;
      }

      state.catalogueLoaded = true;
      state.catalogue = [];

      setStatus(`Impossible de charger le catalogue : ${error.message}`, "isError");
      renderAll();
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

      setStatus("");
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

  renderAll();
  loadCatalogue();
})();