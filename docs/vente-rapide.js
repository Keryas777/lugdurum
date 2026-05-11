(() => {
  "use strict";

  /*
    V12 terrain :
    - Catalogue chargé depuis Google Sheets via lugdurum-api.js.
    - Offres de vente chargées depuis Google Sheets via lugdurum-api.js.
    - Fallback sur le dernier catalogue + les dernières offres chargées en localStorage si l’API est indisponible.
    - catalogue = produits physiques / SKU.
    - offres_vente = prix, gammes, coffrets, suppléments.
    - 50 cL vendu à l’unité via offres_vente :
      produit.gamme_tarif → offre type bouteille + format 50 + même gamme_tarif.
    - 20 cL vendu uniquement en coffrets 3×20 ou 6×20 via offres_vente.
    - Les modes coffrets affichent les SKU actifs / composables en format 20.
    - VB existe uniquement en 50 cL, donc n'apparaît pas en coffret si aucun SKU VB_20 n’existe dans le Sheet.
    - FF et VK restent au catalogue mais ne sont pas visibles si actif = false.
    - Supplément PE : géré depuis offres_vente.
    - Les parfums du coffret peuvent être retirés un par un depuis la composition.
    - Les visuels de boutons sont chargés depuis ./assets/parfums/{code}.webp.
    - Le montant encaissé se remplit automatiquement avec le total du ticket.
    - Le montant encaissé reste modifiable manuellement.
    - LP reçoit une classe spéciale pour mieux gérer son nom long.
    - MV et PE reçoivent une classe spéciale pour texte clair sur fond sombre.
    - Optimisation rendu : la grille produits n’est plus reconstruite à chaque ajout.
      Seules les pastilles quantité sont mises à jour.
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

  const STORAGE_KEY = "lugdurum_pending_transactions";
  const LAST_TICKET_KEY = "lugdurum_last_ticket";
  const CATALOGUE_CACHE_KEY = "lugdurum_catalogue_cache";
  const OFFRES_VENTE_CACHE_KEY = "lugdurum_offres_vente_cache";

  const state = {
    selectedMode: "BOTTLE_50",
    paymentMode: "ESP",
    ticketItems: [],
    draftPack: [],
    amountManuallyEdited: false,
    catalogue: [],
    offresVente: [],
    dataLoaded: false
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

    if (["true", "vrai", "oui", "yes", "1", "x", "actif"].includes(normalized)) {
      return true;
    }

    if (["false", "faux", "non", "no", "0", "inactif"].includes(normalized)) {
      return false;
    }

    return fallback;
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
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };

  const writeCachedArray = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
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
            ${qty > 0 ? `<strong class="productQty">×${qty}</strong>` : ""}
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

      let badge = button.querySelector(".productQty");

      if (qty > 0) {
        if (!badge) {
          badge = document.createElement("strong");
          badge.className = "productQty";
          button.appendChild(badge);
        }

        badge.textContent = `×${qty}`;
      } else if (badge) {
        badge.remove();
      }
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

  const renderAll = ({ refreshProducts = false } = {}) => {
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
      setStatus(
        "Le coffret est complet. Ajoute-le au ticket ou vide la composition.",
        "isError"
      );
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
          taux_tva: item.taux_tva || 0,
          montant_tva_ligne: 0,
          total_catalogue_ligne_ttc: item.quantite * item.prix_unitaire_ttc,
          total_catalogue_ligne_ht: item.quantite * item.prix_unitaire_ht,
          source: getSourceForPayment(),
          note: item.offre_id ? `Offre : ${item.offre_id}` : ""
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
            mission_id: JOURNEE_ACTIVE.mission_id,
            journee_id: JOURNEE_ACTIVE.journee_id,
            sku_id: product.sku_id,
            quantite: qty,
            prix_unitaire_ttc: unitPriceTtc,
            prix_unitaire_ht: unitPriceHt,
            taux_tva: item.taux_tva || 0,
            montant_tva_ligne: 0,
            total_catalogue_ligne_ttc: totalLineTtc,
            total_catalogue_ligne_ht: totalLineHt,
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

  const loadData = async () => {
    renderProducts();

    try {
      if (!window.LugdurumAPI) {
        throw new Error("lugdurum-api.js n’est pas chargé.");
      }

      if (typeof window.LugdurumAPI.getCatalogue !== "function") {
        throw new Error("getCatalogue() est introuvable dans lugdurum-api.js.");
      }

      if (typeof window.LugdurumAPI.getOffresVente !== "function") {
        throw new Error("getOffresVente() est introuvable dans lugdurum-api.js.");
      }

      const [catalogueRows, offresRows] = await Promise.all([
        window.LugdurumAPI.getCatalogue(),
        window.LugdurumAPI.getOffresVente()
      ]);

      state.catalogue = catalogueRows
        .map((row, index) => normalizeProduct(row, index))
        .filter((product) => product.sku_id && product.parfum_code && product.format_cl);

      state.offresVente = offresRows
        .map((row, index) => normalizeOffer(row, index))
        .filter((offer) => offer.offre_id && offer.type_offre && offer.format_cl);

      state.dataLoaded = true;

      writeCachedArray(CATALOGUE_CACHE_KEY, state.catalogue);
      writeCachedArray(OFFRES_VENTE_CACHE_KEY, state.offresVente);

      if (state.offresVente.length === 0) {
        setStatus("Catalogue chargé, mais aucune offre de vente active trouvée.", "isError");
      } else {
        setStatus("");
      }

      renderAll({ refreshProducts: true });
    } catch (error) {
      const cachedCatalogue = readCachedArray(CATALOGUE_CACHE_KEY);
      const cachedOffres = readCachedArray(OFFRES_VENTE_CACHE_KEY);

      if (cachedCatalogue.length > 0 || cachedOffres.length > 0) {
        state.catalogue = cachedCatalogue.map((row, index) => normalizeProduct(row, index));
        state.offresVente = cachedOffres.map((row, index) => normalizeOffer(row, index));
        state.dataLoaded = true;

        setStatus("Données chargées depuis le cache local.", "isError");
        renderAll({ refreshProducts: true });
        return;
      }

      state.dataLoaded = true;
      state.catalogue = [];
      state.offresVente = [];

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

  renderAll();
  loadData();
})();