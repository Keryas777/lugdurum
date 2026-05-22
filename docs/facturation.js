(() => {
  "use strict";

  /*
    Facturation Lugdurum V1
    - Page dédiée clients pros / commandes pros / factures.
    - Ne modifie pas lugdurum-api.js.
    - Utilise LugdurumAPI pour Google Sheets quand disponible.
    - Utilise LugdurumFacturation pour communiquer avec le Worker Cloudflare.
    - Aucune file d'attente offline pour la création de facture, afin d'éviter les doublons.
  */

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme"
  };

  const SHEET_KEYS = {
    clients: "clients",
    commandesPro: "commandesPro",
    commandesLignes: "commandesLignes",
    documents: "documents"
  };

  const STORAGE_KEYS = {
    localClients: "lugdurum_facturation_clients_cache",
    localProducts: "lugdurum_facturation_products_cache",
    lastDraft: "lugdurum_facturation_last_draft"
  };

  const TVA_RATE = 0;
  const DEFAULT_PAYMENT_DAYS = 14;
  const TVA_MENTION = "TVA non applicable, art. 293 B du CGI";

  const state = {
    clients: [],
    products: [],
    lines: [],
    currentInvoice: null,
    currentClientId: "",
    currentCommandeId: "",
    isBusy: false
  };

  const els = {};

  const nowIso = () => new Date().toISOString();

  const todayIso = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const addDaysIso = (dateIso, days) => {
    const date = dateIso ? new Date(`${dateIso}T00:00:00`) : new Date();
    date.setDate(date.getDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  };

  const safeLocalGet = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const safeLocalSet = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // localStorage peut être indisponible.
    }
  };

  const readJson = (key, fallback) => {
    try {
      const raw = safeLocalGet(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    safeLocalSet(key, JSON.stringify(value));
  };

  const toArray = (value) => (Array.isArray(value) ? value : []);

  const cleanString = (value) => String(value ?? "").trim();

  const parseNumber = (value, fallback = 0) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const normalized = String(value ?? "")
      .replace(/\s/g, "")
      .replace(",", ".");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : fallback;
  };

  const roundMoney = (value) => Math.round((parseNumber(value) + Number.EPSILON) * 100) / 100;

  const formatMoney = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR"
    }).format(roundMoney(value));

  const slugify = (value) =>
    cleanString(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 42);

  const buildId = (prefix, seed = "") => {
    const random =
      window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID().slice(0, 8).toUpperCase()
        : Math.random().toString(36).slice(2, 10).toUpperCase();

    const slug = slugify(seed) || "LUGDURUM";
    return `${prefix}_${Date.now()}_${slug}_${random}`;
  };

  const get = (id) => document.getElementById(id);

  const cacheElements = () => {
    [
      "facturationStatusTitle",
      "facturationStatusText",
      "facturationStatusDot",
      "connectionToggle",
      "connectionBody",
      "workerUrlInput",
      "accessKeyInput",
      "saveConnectionButton",
      "clearConnectionButton",
      "clientSelect",
      "clientTypeInput",
      "clientStatusInput",
      "clientCommercialNameInput",
      "clientLegalNameInput",
      "clientSiretInput",
      "clientSirenInput",
      "clientEmailInput",
      "clientAddressInput",
      "clientZipInput",
      "clientCityInput",
      "clientPhoneInput",
      "clientContactInput",
      "clientNoteInput",
      "saveClientButton",
      "resetClientButton",
      "issueDateInput",
      "paymentToInput",
      "orderStatusInput",
      "paymentStatusInput",
      "orderNoteInput",
      "invoiceDescriptionInput",
      "productSearchInput",
      "reloadProductsButton",
      "productGrid",
      "manualLineNameInput",
      "manualLineQtyInput",
      "manualLinePriceInput",
      "addManualLineButton",
      "invoiceLines",
      "summaryTotal",
      "summaryMeta",
      "saveDraftButton",
      "createInvoiceButton",
      "openPdfButton",
      "sendEmailButton",
      "resultPanel",
      "resultNumber",
      "resultProviderId",
      "resultAmount"
    ].forEach((id) => {
      els[id] = get(id);
    });
  };

  const setBusy = (busy, message = "") => {
    state.isBusy = Boolean(busy);

    [
      els.saveClientButton,
      els.saveDraftButton,
      els.createInvoiceButton,
      els.sendEmailButton,
      els.saveConnectionButton,
      els.reloadProductsButton,
      els.addManualLineButton
    ].forEach((button) => {
      if (button) button.disabled = state.isBusy;
    });

    if (state.currentInvoice?.id && !state.isBusy) {
      if (els.openPdfButton) els.openPdfButton.disabled = false;
      if (els.sendEmailButton) els.sendEmailButton.disabled = false;
    }

    if (busy) {
      setStatus("loading", message || "Traitement en cours…");
    }
  };

  const setStatus = (status, message = "") => {
    const statusMap = {
      idle: {
        title: "Brouillon local",
        dot: "isIdle"
      },
      loading: {
        title: "Traitement en cours",
        dot: "isLoading"
      },
      online: {
        title: "Facturation prête",
        dot: "isOnline"
      },
      error: {
        title: "Erreur facturation",
        dot: "isError"
      },
      offline: {
        title: "Hors ligne",
        dot: "isOffline"
      }
    };

    const config = statusMap[status] || statusMap.idle;

    if (els.facturationStatusTitle) {
      els.facturationStatusTitle.textContent = config.title;
    }

    if (els.facturationStatusText) {
      els.facturationStatusText.textContent = message || "Prépare une commande pro puis génère la facture via le Worker sécurisé.";
    }

    if (els.facturationStatusDot) {
      els.facturationStatusDot.className = `statusDot ${config.dot}`;
    }
  };

  const dispatchPageEvent = (name, detail = {}) => {
    window.dispatchEvent(
      new CustomEvent(`lugdurum:facturation-page:${name}`, {
        detail
      })
    );
  };

  const normalizeClient = (client = {}) => {
    const nomCommercial = cleanString(client.nom_commercial || client.nom || client.name || client.buyer_name);
    const raisonSociale = cleanString(client.raison_sociale || client.legal_name || client.company_name || nomCommercial);
    const siret = cleanString(client.siret || client.buyer_tax_no);

    return {
      client_id: cleanString(client.client_id || client.id) || buildId("CLI", raisonSociale || nomCommercial),
      type_client: cleanString(client.type_client) || "caviste",
      nom_commercial: nomCommercial,
      raison_sociale: raisonSociale,
      siren: cleanString(client.siren) || siret.slice(0, 9),
      siret,
      email: cleanString(client.email || client.buyer_email),
      telephone: cleanString(client.telephone || client.phone),
      adresse: cleanString(client.adresse || client.buyer_street),
      code_postal: cleanString(client.code_postal || client.buyer_post_code),
      ville: cleanString(client.ville || client.buyer_city),
      contact_nom: cleanString(client.contact_nom || client.contact),
      statut: cleanString(client.statut) || "client_actif",
      conditions_paiement: cleanString(client.conditions_paiement) || `${DEFAULT_PAYMENT_DAYS} jours`,
      remise_habituelle: cleanString(client.remise_habituelle),
      source_contact: cleanString(client.source_contact),
      note: cleanString(client.note),
      created_at: cleanString(client.created_at) || nowIso(),
      updated_at: nowIso()
    };
  };

  const normalizeProduct = (product = {}, index = 0) => {
    const sku = cleanString(product.sku_id || product.sku || product.produit_id || product.article_id || product.id);
    const format = cleanString(product.format || product.contenance || product.volume || product.conditionnement);
    const parfum = cleanString(product.parfum || product.nom_parfum || product.flavour || product.saveur);
    const label = cleanString(
      product.nom ||
      product.name ||
      product.libelle ||
      product.label ||
      ["Rhum arrangé", parfum, format].filter(Boolean).join(" ")
    );

    const rawPrice =
      product.prix_unitaire_ttc ??
      product.prix_ttc ??
      product.price_ttc ??
      product.prix ??
      product.price ??
      product.total_price_gross ??
      0;

    return {
      sku_id: sku || `MANUAL_${index}`,
      nom: label || `Produit ${index + 1}`,
      parfum,
      format,
      prix_unitaire_ttc: roundMoney(rawPrice),
      prix_unitaire_ht: roundMoney(rawPrice),
      taux_tva: TVA_RATE,
      categorie: cleanString(product.categorie || product.category || "catalogue"),
      actif: product.actif ?? product.active ?? true
    };
  };

  const collectCoreTables = (data = {}) => {
    if (!data || typeof data !== "object") return;

    state.clients = toArray(
      data.clients ||
      data.Clients ||
      data[SHEET_KEYS.clients]
    ).map(normalizeClient);

    const products = [
      ...toArray(data.catalogue),
      ...toArray(data.produits),
      ...toArray(data.offresVente),
      ...toArray(data.offres_vente),
      ...toArray(data.offres)
    ];

    if (products.length > 0) {
      state.products = products.map(normalizeProduct);
    }
  };

  const loadData = async () => {
    setStatus("loading", "Chargement des clients et produits…");

    state.clients = readJson(STORAGE_KEYS.localClients, []).map(normalizeClient);
    state.products = readJson(STORAGE_KEYS.localProducts, []).map(normalizeProduct);

    try {
      if (window.LugdurumAPI?.getCoreData) {
        const core = await window.LugdurumAPI.getCoreData([
          "clients",
          "commandes_pro",
          "commandes_lignes",
          "documents",
          "catalogue",
          "offres_vente"
        ]);
        collectCoreTables(core);
      }

      if (window.LugdurumAPI?.getCatalogue) {
        const catalogue = await window.LugdurumAPI.getCatalogue();
        if (toArray(catalogue).length > 0) {
          state.products = toArray(catalogue).map(normalizeProduct);
        }
      }

      if (window.LugdurumAPI?.getOffresVente) {
        const offres = await window.LugdurumAPI.getOffresVente();
        if (toArray(offres).length > 0) {
          state.products = toArray(offres).map(normalizeProduct);
        }
      }

      writeJson(STORAGE_KEYS.localClients, state.clients);
      writeJson(STORAGE_KEYS.localProducts, state.products);

      setStatus("online", "Données chargées.");
    } catch (error) {
      console.warn("Chargement facturation en mode local.", error);
      setStatus("idle", "Données locales affichées. Les onglets Sheets facturation sont peut-être encore à créer.");
    }

    renderClients();
    renderProducts();
    renderLines();
  };

  const renderClients = () => {
    if (!els.clientSelect) return;

    const selected = state.currentClientId || els.clientSelect.value;

    els.clientSelect.innerHTML = `
      <option value="">Nouveau client ou sélection manuelle</option>
      ${state.clients
        .slice()
        .sort((a, b) => cleanString(a.nom_commercial || a.raison_sociale).localeCompare(cleanString(b.nom_commercial || b.raison_sociale), "fr"))
        .map((client) => {
          const label = cleanString(client.nom_commercial || client.raison_sociale || client.client_id);
          return `<option value="${escapeHtml(client.client_id)}">${escapeHtml(label)}</option>`;
        })
        .join("")}
    `;

    els.clientSelect.value = selected;
  };

  const renderProducts = () => {
    if (!els.productGrid) return;

    const query = cleanString(els.productSearchInput?.value).toLowerCase();
    const products = state.products
      .filter((product) => product.actif !== false && product.actif !== "FALSE")
      .filter((product) => {
        if (!query) return true;
        return [product.nom, product.parfum, product.format, product.sku_id, product.categorie]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 24);

    if (products.length === 0) {
      els.productGrid.innerHTML = `
        <div class="emptyState">
          Aucun produit trouvé. Tu peux ajouter une ligne manuelle en dessous.
        </div>
      `;
      return;
    }

    els.productGrid.innerHTML = products
      .map((product) => `
        <article class="productCard">
          <div>
            <h3>${escapeHtml(product.nom)}</h3>
            <p class="productMeta">${escapeHtml([product.format, product.sku_id].filter(Boolean).join(" · "))}</p>
          </div>
          <p class="productPrice">${formatMoney(product.prix_unitaire_ttc)}</p>
          <button class="ghostButton" type="button" data-add-product="${escapeHtml(product.sku_id)}">Ajouter</button>
        </article>
      `)
      .join("");
  };

  const renderLines = () => {
    if (!els.invoiceLines) return;

    if (state.lines.length === 0) {
      els.invoiceLines.innerHTML = `
        <div class="emptyState">
          Aucune ligne pour l’instant. Ajoute des produits comme dans Vente rapide, ou crée une ligne manuelle.
        </div>
      `;
    } else {
      els.invoiceLines.innerHTML = state.lines
        .map((line) => `
          <article class="invoiceLineCard">
            <div>
              <p class="invoiceLineTitle">${escapeHtml(line.nom_produit)}</p>
              <p class="invoiceLineSub">${formatMoney(line.prix_unitaire_ttc)} / unité · TVA ${line.taux_tva || 0}%</p>
            </div>
            <div class="lineControls">
              <button class="qtyButton" type="button" data-line-minus="${escapeHtml(line.commande_ligne_id)}" aria-label="Réduire">−</button>
              <span class="qtyValue">${line.quantite}</span>
              <button class="qtyButton" type="button" data-line-plus="${escapeHtml(line.commande_ligne_id)}" aria-label="Ajouter">+</button>
              <button class="removeLineButton" type="button" data-line-remove="${escapeHtml(line.commande_ligne_id)}" aria-label="Supprimer">×</button>
            </div>
            <p class="lineTotal">${formatMoney(line.total_ligne_ttc)}</p>
          </article>
        `)
        .join("");
    }

    renderSummary();
    persistDraftLocally();
  };

  const renderSummary = () => {
    const totals = computeTotals();

    if (els.summaryTotal) {
      els.summaryTotal.textContent = formatMoney(totals.ttc);
    }

    if (els.summaryMeta) {
      const lineLabel = `${state.lines.length} ligne${state.lines.length > 1 ? "s" : ""}`;
      els.summaryMeta.textContent = `${lineLabel} · TVA ${formatMoney(totals.tva)} · Franchise en base`;
    }
  };

  const renderInvoiceResult = (invoice = {}) => {
    if (!els.resultPanel) return;

    const providerId = cleanString(invoice.id || invoice.provider_id || invoice.prestataire_document_id);
    const number = cleanString(invoice.number || invoice.numero_document || invoice.no);
    const amount = invoice.price_gross ?? invoice.total_price_gross ?? invoice.montant_ttc ?? computeTotals().ttc;

    els.resultPanel.hidden = false;
    els.resultNumber.textContent = number || "—";
    els.resultProviderId.textContent = providerId || "—";
    els.resultAmount.textContent = formatMoney(amount);

    if (els.openPdfButton) els.openPdfButton.disabled = !providerId;
    if (els.sendEmailButton) els.sendEmailButton.disabled = !providerId;
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const fillClientForm = (client = {}) => {
    state.currentClientId = cleanString(client.client_id);

    els.clientTypeInput.value = cleanString(client.type_client) || "caviste";
    els.clientStatusInput.value = cleanString(client.statut) || "client_actif";
    els.clientCommercialNameInput.value = cleanString(client.nom_commercial);
    els.clientLegalNameInput.value = cleanString(client.raison_sociale);
    els.clientSiretInput.value = cleanString(client.siret);
    els.clientSirenInput.value = cleanString(client.siren);
    els.clientEmailInput.value = cleanString(client.email);
    els.clientAddressInput.value = cleanString(client.adresse);
    els.clientZipInput.value = cleanString(client.code_postal);
    els.clientCityInput.value = cleanString(client.ville);
    els.clientPhoneInput.value = cleanString(client.telephone);
    els.clientContactInput.value = cleanString(client.contact_nom);
    els.clientNoteInput.value = cleanString(client.note);
  };

  const resetClientForm = () => {
    state.currentClientId = "";
    if (els.clientSelect) els.clientSelect.value = "";
    fillClientForm({
      type_client: "caviste",
      statut: "client_actif"
    });
  };

  const collectClientForm = () => {
    const nomCommercial = cleanString(els.clientCommercialNameInput.value);
    const raisonSociale = cleanString(els.clientLegalNameInput.value) || nomCommercial;

    return normalizeClient({
      client_id: state.currentClientId || buildId("CLI", raisonSociale || nomCommercial),
      type_client: els.clientTypeInput.value,
      nom_commercial: nomCommercial,
      raison_sociale: raisonSociale,
      siren: cleanString(els.clientSirenInput.value),
      siret: cleanString(els.clientSiretInput.value),
      email: cleanString(els.clientEmailInput.value),
      telephone: cleanString(els.clientPhoneInput.value),
      adresse: cleanString(els.clientAddressInput.value),
      code_postal: cleanString(els.clientZipInput.value),
      ville: cleanString(els.clientCityInput.value),
      contact_nom: cleanString(els.clientContactInput.value),
      statut: els.clientStatusInput.value,
      conditions_paiement: `${DEFAULT_PAYMENT_DAYS} jours`,
      note: cleanString(els.clientNoteInput.value)
    });
  };

  const validateClient = (client) => {
    if (!cleanString(client.nom_commercial || client.raison_sociale)) {
      throw new Error("Le nom du client est obligatoire.");
    }

    if (!cleanString(client.email)) {
      throw new Error("L’email de facturation est obligatoire pour envoyer la facture.");
    }

    return true;
  };

  const upsertLocalClient = (client) => {
    const existingIndex = state.clients.findIndex((item) => item.client_id === client.client_id);

    if (existingIndex >= 0) {
      state.clients.splice(existingIndex, 1, client);
    } else {
      state.clients.push(client);
    }

    state.currentClientId = client.client_id;
    writeJson(STORAGE_KEYS.localClients, state.clients);
    renderClients();

    if (els.clientSelect) {
      els.clientSelect.value = client.client_id;
    }

    return client;
  };

  const saveClient = async () => {
    const client = collectClientForm();
    validateClient(client);

    setBusy(true, "Enregistrement du client…");

    try {
      upsertLocalClient(client);

      if (window.LugdurumAPI?.batchUpsert) {
        await window.LugdurumAPI.batchUpsert([
          {
            sheetKey: SHEET_KEYS.clients,
            data: client
          }
        ]);
      }

      setStatus("online", "Client enregistré.");
      dispatchPageEvent("client-saved", { client });
      return client;
    } catch (error) {
      setStatus("error", error.message);
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const addProductLine = (product) => {
    const existing = state.lines.find((line) => line.sku_id && line.sku_id === product.sku_id);

    if (existing) {
      existing.quantite += 1;
      refreshLineTotals(existing);
      renderLines();
      return existing;
    }

    const line = refreshLineTotals({
      commande_ligne_id: buildId("CLPRO", product.sku_id || product.nom),
      commande_id: state.currentCommandeId,
      sku_id: product.sku_id,
      nom_produit: product.nom,
      quantite: 1,
      prix_unitaire_ttc: roundMoney(product.prix_unitaire_ttc),
      prix_unitaire_ht: roundMoney(product.prix_unitaire_ht || product.prix_unitaire_ttc),
      taux_tva: TVA_RATE,
      note: "",
      created_at: nowIso(),
      updated_at: nowIso()
    });

    state.lines.push(line);
    renderLines();
    return line;
  };

  const addManualLine = () => {
    const name = cleanString(els.manualLineNameInput.value);
    const quantity = Math.max(1, Math.round(parseNumber(els.manualLineQtyInput.value, 1)));
    const unitPrice = roundMoney(els.manualLinePriceInput.value);

    if (!name) {
      setStatus("error", "Le libellé de la ligne manuelle est obligatoire.");
      return;
    }

    if (unitPrice <= 0) {
      setStatus("error", "Le prix de la ligne manuelle doit être supérieur à 0 €.");
      return;
    }

    const line = refreshLineTotals({
      commande_ligne_id: buildId("CLPRO", name),
      commande_id: state.currentCommandeId,
      sku_id: "",
      nom_produit: name,
      quantite: quantity,
      prix_unitaire_ttc: unitPrice,
      prix_unitaire_ht: unitPrice,
      taux_tva: TVA_RATE,
      note: "ligne_manuelle",
      created_at: nowIso(),
      updated_at: nowIso()
    });

    state.lines.push(line);
    els.manualLineNameInput.value = "";
    els.manualLineQtyInput.value = "1";
    els.manualLinePriceInput.value = "";
    renderLines();
  };

  const refreshLineTotals = (line) => {
    const quantity = Math.max(1, Math.round(parseNumber(line.quantite, 1)));
    const unitTtc = roundMoney(line.prix_unitaire_ttc);
    const totalTtc = roundMoney(quantity * unitTtc);

    line.quantite = quantity;
    line.prix_unitaire_ttc = unitTtc;
    line.prix_unitaire_ht = roundMoney(line.prix_unitaire_ht || unitTtc);
    line.total_ligne_ttc = totalTtc;
    line.total_ligne_ht = totalTtc;
    line.taux_tva = TVA_RATE;
    line.updated_at = nowIso();

    return line;
  };

  const updateLineQuantity = (lineId, delta) => {
    const line = state.lines.find((item) => item.commande_ligne_id === lineId);
    if (!line) return;

    line.quantite = Math.max(1, Number(line.quantite || 1) + delta);
    refreshLineTotals(line);
    renderLines();
  };

  const removeLine = (lineId) => {
    state.lines = state.lines.filter((line) => line.commande_ligne_id !== lineId);
    renderLines();
  };

  const computeTotals = () => {
    const ttc = roundMoney(state.lines.reduce((sum, line) => sum + parseNumber(line.total_ligne_ttc), 0));

    return {
      ht: ttc,
      tva: 0,
      ttc
    };
  };

  const collectCommande = (client) => {
    const totals = computeTotals();
    const dateCommande = cleanString(els.issueDateInput.value) || todayIso();

    if (!state.currentCommandeId) {
      state.currentCommandeId = buildId("CMDPRO", client.nom_commercial || client.raison_sociale || "CLIENT");
    }

    return {
      commande_id: state.currentCommandeId,
      client_id: client.client_id,
      date_commande: dateCommande,
      date_livraison_prevue: "",
      statut: cleanString(els.orderStatusInput.value) || "brouillon",
      montant_total_ttc: totals.ttc,
      montant_total_ht: totals.ht,
      taux_tva: TVA_RATE,
      montant_tva: totals.tva,
      mode_paiement: "",
      paiement_statut: cleanString(els.paymentStatusInput.value) || "non_paye",
      note: cleanString(els.orderNoteInput.value),
      created_at: nowIso(),
      updated_at: nowIso()
    };
  };

  const collectLinesForSave = (commandeId) =>
    state.lines.map((line) => ({
      ...refreshLineTotals(line),
      commande_id: commandeId,
      updated_at: nowIso()
    }));

  const validateDraft = () => {
    const client = collectClientForm();
    validateClient(client);

    if (state.lines.length === 0) {
      throw new Error("Ajoute au moins une ligne produit avant de créer la facture.");
    }

    return {
      client,
      commande: collectCommande(client),
      lignes: collectLinesForSave(state.currentCommandeId)
    };
  };

  const saveDraft = async (options = {}) => {
    const { client, commande, lignes } = validateDraft();

    setBusy(true, options.message || "Enregistrement du brouillon…");

    try {
      upsertLocalClient(client);

      const operations = [
        {
          sheetKey: SHEET_KEYS.clients,
          data: client
        },
        {
          sheetKey: SHEET_KEYS.commandesPro,
          data: commande
        },
        ...lignes.map((line) => ({
          sheetKey: SHEET_KEYS.commandesLignes,
          data: line
        }))
      ];

      if (window.LugdurumAPI?.batchUpsert) {
        await window.LugdurumAPI.batchUpsert(operations);
        setStatus("online", "Brouillon enregistré dans Sheets.");
      } else {
        setStatus("idle", "Brouillon conservé localement. LugdurumAPI indisponible.");
      }

      persistDraftLocally();
      dispatchPageEvent("draft-saved", { client, commande, lignes });

      return {
        client,
        commande,
        lignes
      };
    } catch (error) {
      setStatus("error", error.message);
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const buildVosFacturesPayload = ({ client, commande, lignes }) => ({
    invoice: {
      kind: "vat",
      number: null,
      oid: commande.commande_id,
      sell_date: commande.date_commande,
      issue_date: commande.date_commande,
      payment_to: cleanString(els.paymentToInput.value) || commande.date_commande,

      buyer_name: cleanString(client.raison_sociale || client.nom_commercial),
      buyer_tax_no: cleanString(client.siret || client.siren),
      buyer_email: cleanString(client.email),
      buyer_street: cleanString(client.adresse),
      buyer_post_code: cleanString(client.code_postal),
      buyer_city: cleanString(client.ville),

      positions: lignes.map((line) => ({
        name: cleanString(line.nom_produit),
        quantity: Number(line.quantite || 1),
        tax: TVA_RATE,
        total_price_gross: roundMoney(line.total_ligne_ttc)
      })),

      description: cleanString(els.invoiceDescriptionInput.value) || TVA_MENTION
    }
  });

  const createInvoice = async () => {
    if (!window.LugdurumFacturation?.createInvoice) {
      setStatus("error", "Le fichier lugdurum-facturation-client.js est absent ou non chargé.");
      return;
    }

    let saved;

    try {
      saved = await saveDraft({ message: "Préparation de la facture…" });
    } catch (error) {
      setStatus("error", error.message);
      return;
    }

    setBusy(true, "Création de la facture VosFactures…");

    try {
      const payload = buildVosFacturesPayload(saved);
      const invoice = await window.LugdurumFacturation.createInvoice(payload);
      const normalizedInvoice = normalizeProviderInvoice(invoice);

      state.currentInvoice = normalizedInvoice;
      renderInvoiceResult(normalizedInvoice);

      await saveDocumentAfterInvoice(saved, normalizedInvoice);

      setStatus("online", `Facture créée${normalizedInvoice.number ? ` : ${normalizedInvoice.number}` : ""}.`);
      dispatchPageEvent("invoice-created", {
        invoice: normalizedInvoice,
        payload
      });
    } catch (error) {
      setStatus("error", error.message);
      console.error("Création facture impossible", error);
    } finally {
      setBusy(false);
    }
  };

  const normalizeProviderInvoice = (invoice = {}) => {
    const raw = invoice.invoice || invoice.data || invoice;

    return {
      ...raw,
      id: cleanString(raw.id || raw.invoice_id || raw.provider_id),
      number: cleanString(raw.number || raw.no || raw.numero_document),
      price_gross: roundMoney(raw.price_gross ?? raw.total_price_gross ?? raw.montant_ttc ?? computeTotals().ttc),
      issue_date: cleanString(raw.issue_date || raw.sell_date || els.issueDateInput.value),
      status: cleanString(raw.status || raw.payment_status || "facture_creee")
    };
  };

  const saveDocumentAfterInvoice = async ({ client, commande }, invoice) => {
    const providerId = cleanString(invoice.id);
    const documentId = `DOC_${commande.commande_id}`;
    const totals = computeTotals();

    const documentRow = {
      document_id: documentId,
      type_document: "facture",
      client_id: client.client_id,
      commande_id: commande.commande_id,
      numero_document: cleanString(invoice.number),
      date_document: cleanString(invoice.issue_date || commande.date_commande),
      date_echeance: cleanString(els.paymentToInput.value),
      statut: "facture_creee",
      prestataire: "vosfactures",
      prestataire_document_id: providerId,
      pdf_url: providerId ? `worker:/invoices/${providerId}/pdf` : "",
      montant_ttc: totals.ttc,
      montant_ht: totals.ht,
      taux_tva: TVA_RATE,
      montant_tva: totals.tva,
      note: cleanString(els.orderNoteInput.value),
      email_envoye_at: "",
      prestataire_payload_json: JSON.stringify(invoice),
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const commandeRow = {
      ...commande,
      statut: "facturee",
      updated_at: nowIso()
    };

    if (window.LugdurumAPI?.batchUpsert) {
      await window.LugdurumAPI.batchUpsert([
        {
          sheetKey: SHEET_KEYS.documents,
          data: documentRow
        },
        {
          sheetKey: SHEET_KEYS.commandesPro,
          data: commandeRow
        }
      ]);
    }

    return documentRow;
  };

  const openCurrentPdf = async () => {
    const id = cleanString(state.currentInvoice?.id);

    if (!id) {
      setStatus("error", "Aucune facture VosFactures à ouvrir.");
      return;
    }

    try {
      setBusy(true, "Ouverture du PDF…");
      await window.LugdurumFacturation.openInvoicePdf(id);
      setStatus("online", "PDF ouvert.");
    } catch (error) {
      setStatus("error", error.message);
    } finally {
      setBusy(false);
    }
  };

  const sendCurrentInvoiceByEmail = async () => {
    const id = cleanString(state.currentInvoice?.id);

    if (!id) {
      setStatus("error", "Aucune facture VosFactures à envoyer.");
      return;
    }

    try {
      setBusy(true, "Envoi de la facture par email…");
      const result = await window.LugdurumFacturation.sendInvoiceByEmail(id);
      setStatus("online", "Facture envoyée par email.");
      dispatchPageEvent("invoice-sent", { invoice: state.currentInvoice, result });
    } catch (error) {
      setStatus("error", error.message);
    } finally {
      setBusy(false);
    }
  };

  const loadConnectionConfig = () => {
    if (!window.LugdurumFacturation?.getConfig) return;

    const config = window.LugdurumFacturation.getConfig();

    if (els.workerUrlInput) {
      els.workerUrlInput.value = cleanString(config.worker_url);
    }

    if (els.accessKeyInput) {
      els.accessKeyInput.value = config.has_access_key ? "••••••••" : "";
      els.accessKeyInput.dataset.placeholderSecret = config.has_access_key ? "1" : "";
    }
  };

  const saveConnectionConfig = () => {
    if (!window.LugdurumFacturation?.configure) {
      setStatus("error", "Le client facturation n’est pas chargé.");
      return;
    }

    const workerUrl = cleanString(els.workerUrlInput.value);
    const accessKeyValue = cleanString(els.accessKeyInput.value);
    const accessKey = accessKeyValue === "••••••••" ? undefined : accessKeyValue;

    window.LugdurumFacturation.configure({
      workerUrl,
      ...(accessKey !== undefined ? { accessKey } : {})
    });

    setStatus("online", "Connexion facturation enregistrée.");
    loadConnectionConfig();
  };

  const clearConnectionConfig = () => {
    if (!window.LugdurumFacturation?.configure) return;

    window.LugdurumFacturation.configure({
      workerUrl: "",
      accessKey: ""
    });

    if (els.workerUrlInput) els.workerUrlInput.value = "";
    if (els.accessKeyInput) els.accessKeyInput.value = "";

    setStatus("idle", "Connexion facturation effacée.");
  };

  const persistDraftLocally = () => {
    const draft = {
      currentClientId: state.currentClientId,
      currentCommandeId: state.currentCommandeId,
      client: collectClientFormSafe(),
      lines: state.lines,
      issue_date: cleanString(els.issueDateInput?.value),
      payment_to: cleanString(els.paymentToInput?.value),
      order_status: cleanString(els.orderStatusInput?.value),
      payment_status: cleanString(els.paymentStatusInput?.value),
      order_note: cleanString(els.orderNoteInput?.value),
      invoice_description: cleanString(els.invoiceDescriptionInput?.value),
      updated_at: nowIso()
    };

    writeJson(STORAGE_KEYS.lastDraft, draft);
  };

  const collectClientFormSafe = () => {
    try {
      return collectClientForm();
    } catch {
      return {};
    }
  };

  const restoreDraft = () => {
    const draft = readJson(STORAGE_KEYS.lastDraft, null);

    if (!draft || typeof draft !== "object") return;

    state.currentCommandeId = cleanString(draft.currentCommandeId);
    state.currentClientId = cleanString(draft.currentClientId);
    state.lines = toArray(draft.lines).map(refreshLineTotals);

    if (draft.client) fillClientForm(draft.client);
    if (els.issueDateInput && draft.issue_date) els.issueDateInput.value = draft.issue_date;
    if (els.paymentToInput && draft.payment_to) els.paymentToInput.value = draft.payment_to;
    if (els.orderStatusInput && draft.order_status) els.orderStatusInput.value = draft.order_status;
    if (els.paymentStatusInput && draft.payment_status) els.paymentStatusInput.value = draft.payment_status;
    if (els.orderNoteInput) els.orderNoteInput.value = cleanString(draft.order_note);
    if (els.invoiceDescriptionInput) els.invoiceDescriptionInput.value = cleanString(draft.invoice_description) || TVA_MENTION;
  };

  const bindEvents = () => {
    els.connectionToggle?.addEventListener("click", () => {
      const expanded = els.connectionToggle.getAttribute("aria-expanded") === "true";
      els.connectionToggle.setAttribute("aria-expanded", String(!expanded));
      els.connectionBody?.classList.toggle("isCollapsed", expanded);
    });

    els.saveConnectionButton?.addEventListener("click", saveConnectionConfig);
    els.clearConnectionButton?.addEventListener("click", clearConnectionConfig);

    els.clientSelect?.addEventListener("change", () => {
      const client = state.clients.find((item) => item.client_id === els.clientSelect.value);
      if (client) fillClientForm(client);
    });

    els.saveClientButton?.addEventListener("click", () => {
      saveClient().catch((error) => console.warn(error));
    });

    els.resetClientButton?.addEventListener("click", resetClientForm);

    els.productSearchInput?.addEventListener("input", renderProducts);
    els.reloadProductsButton?.addEventListener("click", loadData);

    els.productGrid?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-add-product]");
      if (!button) return;

      const sku = button.getAttribute("data-add-product");
      const product = state.products.find((item) => item.sku_id === sku);
      if (product) addProductLine(product);
    });

    els.addManualLineButton?.addEventListener("click", addManualLine);

    els.invoiceLines?.addEventListener("click", (event) => {
      const minus = event.target.closest("[data-line-minus]");
      const plus = event.target.closest("[data-line-plus]");
      const remove = event.target.closest("[data-line-remove]");

      if (minus) updateLineQuantity(minus.getAttribute("data-line-minus"), -1);
      if (plus) updateLineQuantity(plus.getAttribute("data-line-plus"), 1);
      if (remove) removeLine(remove.getAttribute("data-line-remove"));
    });

    [
      els.clientTypeInput,
      els.clientStatusInput,
      els.clientCommercialNameInput,
      els.clientLegalNameInput,
      els.clientSiretInput,
      els.clientSirenInput,
      els.clientEmailInput,
      els.clientAddressInput,
      els.clientZipInput,
      els.clientCityInput,
      els.clientPhoneInput,
      els.clientContactInput,
      els.clientNoteInput,
      els.issueDateInput,
      els.paymentToInput,
      els.orderStatusInput,
      els.paymentStatusInput,
      els.orderNoteInput,
      els.invoiceDescriptionInput
    ].forEach((input) => {
      input?.addEventListener("input", persistDraftLocally);
      input?.addEventListener("change", persistDraftLocally);
    });

    els.saveDraftButton?.addEventListener("click", () => {
      saveDraft().catch((error) => console.warn(error));
    });

    els.createInvoiceButton?.addEventListener("click", createInvoice);
    els.openPdfButton?.addEventListener("click", openCurrentPdf);
    els.sendEmailButton?.addEventListener("click", sendCurrentInvoiceByEmail);

    window.addEventListener("lugdurum:facturation-status", (event) => {
      const detail = event.detail || {};
      if (detail.status === "loading") setStatus("loading", detail.message || detail.label);
      if (detail.status === "online") setStatus("online", detail.message || detail.label);
      if (detail.status === "error") setStatus("error", detail.message || detail.label);
      if (detail.status === "offline") setStatus("offline", detail.message || detail.label);
    });
  };

  const initDates = () => {
    const today = todayIso();

    if (els.issueDateInput && !els.issueDateInput.value) {
      els.issueDateInput.value = today;
    }

    if (els.paymentToInput && !els.paymentToInput.value) {
      els.paymentToInput.value = addDaysIso(today, DEFAULT_PAYMENT_DAYS);
    }
  };

  const init = async () => {
    cacheElements();
    bindEvents();
    initDates();
    loadConnectionConfig();
    restoreDraft();
    renderLines();
    await loadData();

    if (state.currentClientId && els.clientSelect) {
      els.clientSelect.value = state.currentClientId;
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
      console.error("Initialisation facturation impossible", error);
      setStatus("error", error.message || "Initialisation impossible.");
    });
  });
})();
