(() => {
  "use strict";

  /*
    Facture Detail V1
    - Affiche le détail d’une commande / facture pro.
    - Lecture via LugdurumAPI.getCoreData().
    - Ne crée ni ne modifie aucune donnée.
    - Le PDF n’est proposé que si documents.pdf_url existe.
  */

  const CORE_TABLES = [
    "clients",
    "commandesPro",
    "commandes_pro",
    "documents",
    "commandesLignes",
    "commandes_lignes",
    "commandesProLignes",
    "commandes_pro_lignes",
    "catalogue"
  ].join(",");

  const params = new URLSearchParams(window.location.search);

  const state = {
    clients: [],
    commandes: [],
    documents: [],
    lignes: [],
    catalogue: [],
    commande: null,
    document: null,
    client: null,
    lines: []
  };

  const els = {
    sourceLabel: document.getElementById("detailSourceLabel"),
    clientTitle: document.getElementById("detailClientTitle"),
    invoiceMeta: document.getElementById("detailInvoiceMeta"),
    amount: document.getElementById("detailAmount"),
    paymentStatus: document.getElementById("detailPaymentStatus"),
    documentDetails: document.getElementById("documentDetails"),
    documentActions: document.getElementById("documentActions"),
    clientDetails: document.getElementById("clientDetails"),
    linesList: document.getElementById("invoiceLinesList"),
    technicalDetails: document.getElementById("technicalDetails"),
    status: document.getElementById("factureDetailStatus")
  };

  const api = () => window.LugdurumAPI || null;

  const hasApi = () => Boolean(api());

  const toArray = (value) => (Array.isArray(value) ? value : []);

  const cleanString = (value) => String(value ?? "").trim();

  const normalizeText = (value) =>
    cleanString(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const toNumber = (value, fallback = 0) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;

    const normalized = cleanString(value)
      .replace(/\s/g, "")
      .replace(",", ".");

    if (!normalized) return fallback;

    const number = Number(normalized);

    return Number.isFinite(number) ? number : fallback;
  };

  const formatAmount = (value) =>
    Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(toNumber(value, 0));

  const formatDisplayDate = (value) => {
    const iso = cleanString(value).slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";

    const [year, month, day] = iso.split("-");
    return `${day}/${month}/${year}`;
  };

  const formatPostalCode = (value) => {
    const raw = cleanString(value);

    if (!raw) return "";

    const digits = raw.replace(/\D/g, "");

    if (digits.length > 0 && digits.length < 5) {
      return digits.padStart(5, "0");
    }

    return raw;
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const escapeAttr = (value) => escapeHtml(value).replaceAll("`", "&#096;");

  const setStatus = (message, type = "") => {
    if (!els.status) return;

    els.status.textContent = message;
    els.status.className = "factureDetailStatus";

    if (type) {
      els.status.classList.add(type);
    }
  };

  const getCoreArray = (coreData, keys) => {
    for (const key of keys) {
      if (Array.isArray(coreData?.[key])) {
        return coreData[key];
      }
    }

    return [];
  };

  const getClientId = (client) => cleanString(client?.client_id);

  const getCommandeId = (commande) => cleanString(commande?.commande_id);

  const getDocumentId = (document) => cleanString(document?.document_id);

  const getDocumentCommandeId = (document) => cleanString(document?.commande_id);

  const getLineCommandeId = (line) => cleanString(line?.commande_id);

  const getClientName = (client) =>
    cleanString(
      client?.nom_commercial ||
        client?.raison_sociale ||
        client?.nom ||
        client?.client_nom ||
        ""
    );

  const getCommandeDate = (commande, document) =>
    cleanString(
      document?.date_document ||
        commande?.date_commande ||
        commande?.date_facture ||
        commande?.created_at ||
        document?.created_at ||
        ""
    );

  const getDeliveryDate = (commande) =>
    cleanString(
      commande?.date_livraison_prevue ||
        commande?.["date_livraison_prévue"] ||
        commande?.date_livraison ||
        commande?.date_commande ||
        ""
    );

  const getMontant = (commande, document) =>
    formatAmount(
      commande?.montant_total_ttc ??
        commande?.montant_facture_ttc ??
        document?.montant_ttc ??
        commande?.total_ttc ??
        0
    );

  const getNumeroDocument = (commande, document) =>
    cleanString(
      document?.numero_document ||
        commande?.numero_facture ||
        document?.prestataire_document_id ||
        ""
    );

  const getStatusValue = (commande, document) =>
    normalizeText(
      commande?.paiement_statut ||
        document?.statut ||
        commande?.statut ||
        ""
    );

  const getStatusLabel = (commande, document) => {
    const status = getStatusValue(commande, document);

    if (["paye", "payee", "regle", "reglee"].includes(status)) return "Payée";
    if (["attente", "en_attente", "a_payer", "impaye", "impayee"].includes(status)) return "À payer";
    if (["annule", "annulee"].includes(status)) return "Annulée";
    if (["facturee", "facture_creee", "cree", "creee"].includes(status)) return "Créée";

    return cleanString(commande?.paiement_statut || document?.statut || commande?.statut || "—");
  };

  const getStatusClass = (commande, document) => {
    const status = getStatusValue(commande, document);

    if (["paye", "payee", "regle", "reglee"].includes(status)) return "isPaid";
    if (["attente", "en_attente", "a_payer", "impaye", "impayee"].includes(status)) return "isPending";
    if (["annule", "annulee"].includes(status)) return "isCancelled";

    return "";
  };

  const getProductBySku = (skuId) =>
    state.catalogue.find((product) => cleanString(product.sku_id) === cleanString(skuId)) || null;

  const getProductLabel = (line) => {
    const skuId = cleanString(line?.sku_id);
    const product = getProductBySku(skuId);

    if (product) {
      const code = cleanString(product.parfum_code);
      const name = cleanString(product.parfum_nom);
      const format = cleanString(product.format_cl);

      return [code, name, format ? `${format} cL` : ""].filter(Boolean).join(" · ");
    }

    const note = cleanString(line?.note);

    return note || skuId || "Produit inconnu";
  };

  const getLineQuantity = (line) =>
    toNumber(
      line?.quantite_facturee ??
        line?.quantite_vendue ??
        line?.quantite ??
        line?.quantity,
      0
    );

  const getLineAmount = (line) =>
    formatAmount(line?.total_ligne_ttc ?? line?.total_ttc ?? 0);

  const getLineUnitPrice = (line) =>
    formatAmount(line?.prix_unitaire_ttc ?? line?.prix_ttc ?? 0);

  const getRequestedCommandeId = () => cleanString(params.get("commande_id"));

  const getRequestedDocumentId = () => cleanString(params.get("document_id"));

  const findEntities = () => {
    const requestedCommandeId = getRequestedCommandeId();
    const requestedDocumentId = getRequestedDocumentId();

    if (requestedDocumentId) {
      state.document = state.documents.find((document) => getDocumentId(document) === requestedDocumentId) || null;
      const commandeId = getDocumentCommandeId(state.document);
      state.commande = state.commandes.find((commande) => getCommandeId(commande) === commandeId) || null;
    }

    if (!state.commande && requestedCommandeId) {
      state.commande = state.commandes.find((commande) => getCommandeId(commande) === requestedCommandeId) || null;
      state.document = state.documents.find((document) => getDocumentCommandeId(document) === requestedCommandeId) || null;
    }

    if (!state.commande && state.document) {
      state.commande = state.commandes.find((commande) => getCommandeId(commande) === getDocumentCommandeId(state.document)) || null;
    }

    if (!state.document && state.commande) {
      state.document = state.documents.find((document) => getDocumentCommandeId(document) === getCommandeId(state.commande)) || null;
    }

    const clientId = cleanString(state.commande?.client_id || state.document?.client_id);
    state.client = state.clients.find((client) => getClientId(client) === clientId) || null;

    const commandeId = getCommandeId(state.commande) || getDocumentCommandeId(state.document);

    state.lines = state.lignes.filter((line) => getLineCommandeId(line) === commandeId);
  };

  const detailItem = (label, value, options = {}) => {
    const safeValue = cleanString(value);

    if (!safeValue && !options.showEmpty) return "";

    return `
      <article class="detailItem ${options.wide ? "isWide" : ""}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(safeValue || "—")}</strong>
      </article>
    `;
  };

  const renderHero = () => {
    const clientName = getClientName(state.client) || cleanString(state.commande?.client_nom) || "Client inconnu";
    const invoiceNumber = getNumeroDocument(state.commande, state.document);
    const commandeId = getCommandeId(state.commande) || getDocumentCommandeId(state.document);
    const date = getCommandeDate(state.commande, state.document);
    const amount = getMontant(state.commande, state.document);
    const statusLabel = getStatusLabel(state.commande, state.document);

    if (els.sourceLabel) {
      const isHistorical = normalizeText(state.document?.prestataire || state.commande?.note).includes("historique");
      els.sourceLabel.textContent = isHistorical ? "Facture historique" : "Facture pro";
    }

    if (els.clientTitle) els.clientTitle.textContent = clientName;
    if (els.invoiceMeta) {
      els.invoiceMeta.textContent = [
        invoiceNumber ? `Facture ${invoiceNumber}` : "Facture sans numéro",
        formatDisplayDate(date),
        commandeId
      ].filter(Boolean).join(" · ");
    }
    if (els.amount) els.amount.textContent = formatCurrency(amount);
    if (els.paymentStatus) {
      els.paymentStatus.innerHTML = `<span class="statusChip ${escapeAttr(getStatusClass(state.commande, state.document))}">${escapeHtml(statusLabel)}</span>`;
    }
  };

  const renderDocument = () => {
    const commande = state.commande || {};
    const document = state.document || {};

    if (els.documentDetails) {
      els.documentDetails.innerHTML = [
        detailItem("Numéro", getNumeroDocument(commande, document), { showEmpty: true }),
        detailItem("Date facture", formatDisplayDate(getCommandeDate(commande, document)), { showEmpty: true }),
        detailItem("Échéance", formatDisplayDate(document.date_echeance || getDeliveryDate(commande)), { showEmpty: true }),
        detailItem("Montant TTC", formatCurrency(getMontant(commande, document)), { showEmpty: true }),
        detailItem("Mode paiement", commande.mode_paiement || "—", { showEmpty: true }),
        detailItem("Statut", getStatusLabel(commande, document), { showEmpty: true }),
        detailItem("Prestataire", document.prestataire || "—", { showEmpty: true }),
        detailItem("Référence prestataire", document.prestataire_document_id || "—", { showEmpty: true })
      ].join("");
    }

    if (!els.documentActions) return;

    const pdfUrl = cleanString(document.pdf_url);
    const providerId = cleanString(document.prestataire_document_id);

    if (pdfUrl) {
      els.documentActions.innerHTML = `
        <a class="documentButton" href="${escapeAttr(pdfUrl)}" target="_blank" rel="noopener noreferrer">
          Visualiser le PDF
        </a>
      `;
      return;
    }

    if (providerId) {
      els.documentActions.innerHTML = `
        <span class="documentMutedButton">
          PDF non stocké dans Sheets · référence prestataire présente
        </span>
      `;
      return;
    }

    els.documentActions.innerHTML = `
      <span class="documentMutedButton">
        Aucun PDF enregistré pour cette facture historique
      </span>
    `;
  };

  const renderClient = () => {
    const client = state.client || {};
    const addressLine = [
      client.adresse,
      [formatPostalCode(client.code_postal), client.ville].filter(Boolean).join(" ")
    ].filter(Boolean).join(" · ");

    if (!els.clientDetails) return;

    els.clientDetails.innerHTML = [
      detailItem("Nom commercial", getClientName(client), { showEmpty: true }),
      detailItem("Raison sociale", client.raison_sociale || "—", { showEmpty: true }),
      detailItem("SIRET", client.siret || "—", { showEmpty: true }),
      detailItem("Email", client.email || "—", { showEmpty: true }),
      detailItem("Téléphone", client.telephone || "—", { showEmpty: true }),
      detailItem("Adresse", addressLine || "—", { showEmpty: true, wide: true })
    ].join("");
  };

  const renderLines = () => {
    if (!els.linesList) return;

    if (state.lines.length === 0) {
      els.linesList.innerHTML = `
        <p class="factureDetailEmpty">
          Aucune ligne produit trouvée pour cette commande. Si les lignes existent dans Sheets, vérifie que l’onglet commandes_pro_lignes est bien exposé par l’API.
        </p>
      `;
      return;
    }

    const sortedLines = [...state.lines].sort((a, b) => cleanString(a.sku_id).localeCompare(cleanString(b.sku_id)));

    els.linesList.innerHTML = sortedLines
      .map((line) => {
        const quantity = getLineQuantity(line);
        const amount = getLineAmount(line);
        const unitPrice = getLineUnitPrice(line);
        const skuId = cleanString(line.sku_id);

        return `
          <article class="invoiceLineCard">
            <div class="invoiceLineMain">
              <div class="invoiceLineName">
                <strong>${escapeHtml(getProductLabel(line))}</strong>
                <span>${escapeHtml(skuId || "SKU inconnu")}</span>
              </div>
              <strong class="invoiceLineAmount">${escapeHtml(formatCurrency(amount))}</strong>
            </div>
            <div class="invoiceLineMeta">
              <span>Qté ${escapeHtml(quantity)}</span>
              <span>PU ${escapeHtml(formatCurrency(unitPrice))}</span>
              <span>TVA ${escapeHtml(cleanString(line.taux_tva || 0))}%</span>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const renderTechnical = () => {
    if (!els.technicalDetails) return;

    els.technicalDetails.innerHTML = [
      detailItem("Commande ID", getCommandeId(state.commande) || "—", { showEmpty: true }),
      detailItem("Document ID", getDocumentId(state.document) || "—", { showEmpty: true }),
      detailItem("Client ID", getClientId(state.client) || cleanString(state.commande?.client_id) || "—", { showEmpty: true }),
      detailItem("Type opération", state.commande?.type_operation || state.commande?.commande_type_operation || "—", { showEmpty: true }),
      detailItem("Créé le", state.commande?.created_at || state.document?.created_at || "—", { showEmpty: true }),
      detailItem("Mis à jour", state.commande?.updated_at || state.document?.updated_at || "—", { showEmpty: true })
    ].join("");
  };

  const renderMissing = (message) => {
    if (els.clientTitle) els.clientTitle.textContent = "Facture introuvable";
    if (els.invoiceMeta) els.invoiceMeta.textContent = message;
    if (els.amount) els.amount.textContent = "—";
    if (els.paymentStatus) els.paymentStatus.textContent = "—";

    const empty = `<p class="factureDetailEmpty">${escapeHtml(message)}</p>`;

    if (els.documentDetails) els.documentDetails.innerHTML = empty;
    if (els.documentActions) els.documentActions.innerHTML = "";
    if (els.clientDetails) els.clientDetails.innerHTML = empty;
    if (els.linesList) els.linesList.innerHTML = empty;
    if (els.technicalDetails) els.technicalDetails.innerHTML = empty;
  };

  const renderAll = () => {
    if (!state.commande && !state.document) {
      renderMissing("Impossible de trouver cette facture dans les données chargées.");
      return;
    }

    renderHero();
    renderDocument();
    renderClient();
    renderLines();
    renderTechnical();
  };

  const loadData = async () => {
    if (!hasApi() || typeof api().getCoreData !== "function") {
      throw new Error("LugdurumAPI.getCoreData() est indisponible.");
    }

    const commandeId = getRequestedCommandeId();
    const documentId = getRequestedDocumentId();

    if (!commandeId && !documentId) {
      throw new Error("Aucun identifiant de facture fourni dans l’URL.");
    }

    setStatus("Chargement du détail…");

    const coreData = await api().getCoreData(CORE_TABLES);

    state.clients = getCoreArray(coreData, ["clients"]);
    state.commandes = getCoreArray(coreData, ["commandesPro", "commandes_pro"]);
    state.documents = getCoreArray(coreData, ["documents"]);
    state.lignes = getCoreArray(coreData, [
      "commandesProLignes",
      "commandes_pro_lignes",
      "commandesLignes",
      "commandes_lignes"
    ]);
    state.catalogue = getCoreArray(coreData, ["catalogue"]);

    findEntities();
    renderAll();

    setStatus("Détail chargé.", "isSuccess");
  };

  const init = () => {
    loadData().catch((error) => {
      renderMissing(error.message);
      setStatus(`Chargement impossible : ${error.message}`, "isError");
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
