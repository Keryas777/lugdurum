(() => {
  "use strict";

  /*
    Factures Pro Liste V1
    - Liste triable allégée des factures / commandes pro.
    - Lecture via LugdurumAPI.getCoreData().
    - Clic sur une ligne → facture-detail.html?commande_id=...
    - Ne crée ni ne modifie aucune donnée.
  */

  const CORE_TABLES = [
    "clients",
    "commandesPro",
    "commandes_pro",
    "documents",
    "commandesLignes",
    "commandes_lignes",
    "commandesProLignes",
    "commandes_pro_lignes"
  ].join(",");

  const state = {
    clients: [],
    commandes: [],
    documents: [],
    rows: [],
    filteredRows: [],
    sortKey: "date",
    sortDirection: "desc",
    search: "",
    loading: false
  };

  const els = {
    heroTotalAmount: document.getElementById("heroTotalAmount"),
    heroInvoiceCount: document.getElementById("heroInvoiceCount"),
    tableBody: document.getElementById("invoicesTableBody"),
    searchInput: document.getElementById("invoiceSearchInput"),
    reloadBtn: document.getElementById("reloadInvoicesBtn"),
    status: document.getElementById("facturesStatus")
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
    return `${day}/${month}/${year.slice(2)}`;
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
    els.status.className = "facturesStatus";

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

  const getClientById = (clientId) =>
    state.clients.find((client) => getClientId(client) === clientId) || null;

  const getDocumentByCommandeId = (commandeId) => {
    const docs = state.documents
      .filter((document) => getDocumentCommandeId(document) === commandeId)
      .sort((a, b) => cleanString(b.created_at).localeCompare(cleanString(a.created_at)));

    return docs[0] || null;
  };

  const getRowSearchText = (row) =>
    normalizeText([
      row.client_name,
      row.numero_document,
      row.commande_id,
      row.document_id,
      row.status_label,
      row.date_display,
      row.amount,
      row.has_pdf ? "pdf" : "sans pdf"
    ].join(" "));

  const buildRows = () => {
    state.rows = state.commandes
      .filter((commande) => getCommandeId(commande))
      .map((commande) => {
        const commandeId = getCommandeId(commande);
        const document = getDocumentByCommandeId(commandeId);
        const client = getClientById(cleanString(commande.client_id || document?.client_id));
        const clientName = getClientName(client) || cleanString(commande.client_nom) || "Client inconnu";
        const date = getCommandeDate(commande, document);
        const numeroDocument = getNumeroDocument(commande, document);
        const amount = getMontant(commande, document);
        const statusLabel = getStatusLabel(commande, document);
        const pdfUrl = cleanString(document?.pdf_url);

        return {
          commande,
          document,
          client,
          commande_id: commandeId,
          document_id: getDocumentId(document),
          date,
          date_display: formatDisplayDate(date),
          client_name: clientName,
          numero_document: numeroDocument,
          amount,
          status_label: statusLabel,
          status_class: getStatusClass(commande, document),
          has_pdf: Boolean(pdfUrl),
          href: `./facture-detail.html?commande_id=${encodeURIComponent(commandeId)}`
        };
      });
  };

  const applyFiltersAndSort = () => {
    const needle = normalizeText(state.search);

    state.filteredRows = state.rows.filter((row) => {
      if (!needle) return true;
      return getRowSearchText(row).includes(needle);
    });

    state.filteredRows.sort((a, b) => {
      let result = 0;

      if (state.sortKey === "date") {
        result = cleanString(a.date).localeCompare(cleanString(b.date));
      } else if (state.sortKey === "client") {
        result = normalizeText(a.client_name).localeCompare(normalizeText(b.client_name));
      } else if (state.sortKey === "amount") {
        result = a.amount - b.amount;
      } else if (state.sortKey === "status") {
        result = normalizeText(a.status_label).localeCompare(normalizeText(b.status_label));
      }

      return state.sortDirection === "asc" ? result : -result;
    });
  };

  const renderStats = () => {
    const total = state.filteredRows.reduce((sum, row) => sum + row.amount, 0);

    if (els.heroTotalAmount) els.heroTotalAmount.textContent = formatCurrency(total);
    if (els.heroInvoiceCount) els.heroInvoiceCount.textContent = String(state.filteredRows.length);
  };

  const renderTable = () => {
    if (!els.tableBody) return;

    if (state.loading) {
      els.tableBody.innerHTML = `
        <tr>
          <td colspan="4" class="facturesEmptyCell">Chargement des factures…</td>
        </tr>
      `;
      return;
    }

    if (state.filteredRows.length === 0) {
      els.tableBody.innerHTML = `
        <tr>
          <td colspan="4" class="facturesEmptyCell">Aucune facture trouvée.</td>
        </tr>
      `;
      return;
    }

    els.tableBody.innerHTML = state.filteredRows
      .map((row) => {
        const secondary = row.numero_document
          ? `${row.numero_document} · ${row.commande_id}`
          : row.commande_id;

        const pdfBadge = row.has_pdf ? " · PDF" : "";

        return `
          <tr class="invoiceRow" tabindex="0" data-href="${escapeAttr(row.href)}">
            <td><span class="invoiceDate">${escapeHtml(row.date_display)}</span></td>
            <td class="invoiceClientCell">
              <span class="invoiceClientName">${escapeHtml(row.client_name)}</span>
              <span class="invoiceNumber">${escapeHtml(secondary)}${pdfBadge}</span>
            </td>
            <td class="isAmount"><span class="invoiceAmount">${escapeHtml(formatCurrency(row.amount))}</span></td>
            <td><span class="statusChip ${escapeAttr(row.status_class)}">${escapeHtml(row.status_label)}</span></td>
          </tr>
        `;
      })
      .join("");
  };

  const renderAll = () => {
    applyFiltersAndSort();
    renderStats();
    renderTable();
  };

  const setLoading = (loading) => {
    state.loading = loading;

    if (els.reloadBtn) {
      els.reloadBtn.disabled = loading;
    }

    renderTable();
  };

  const loadData = async () => {
    if (!hasApi() || typeof api().getCoreData !== "function") {
      throw new Error("LugdurumAPI.getCoreData() est indisponible.");
    }

    setLoading(true);
    setStatus("Chargement des factures…");

    try {
      const coreData = await api().getCoreData(CORE_TABLES);

      state.clients = getCoreArray(coreData, ["clients"]);
      state.commandes = getCoreArray(coreData, ["commandesPro", "commandes_pro"]);
      state.documents = getCoreArray(coreData, ["documents"]);

      buildRows();
      renderAll();

      setStatus(
        state.rows.length > 0
          ? `${state.rows.length} facture(s) chargée(s).`
          : "Aucune facture pro trouvée.",
        state.rows.length > 0 ? "isSuccess" : ""
      );
    } finally {
      setLoading(false);
    }
  };

  const bindEvents = () => {
    document.addEventListener("click", (event) => {
      const sortButton = event.target.closest("[data-sort]");

      if (sortButton) {
        const nextSortKey = sortButton.dataset.sort || "date";

        if (state.sortKey === nextSortKey) {
          state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = nextSortKey;
          state.sortDirection = nextSortKey === "date" || nextSortKey === "amount" ? "desc" : "asc";
        }

        renderAll();
        return;
      }

      const row = event.target.closest(".invoiceRow[data-href]");

      if (row) {
        window.location.href = row.dataset.href;
      }
    });

    document.addEventListener("keydown", (event) => {
      const row = event.target.closest?.(".invoiceRow[data-href]");

      if (!row) return;

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        window.location.href = row.dataset.href;
      }
    });

    if (els.searchInput) {
      els.searchInput.addEventListener("input", () => {
        state.search = els.searchInput.value;
        setStatus("");
        renderAll();
      });
    }

    if (els.reloadBtn) {
      els.reloadBtn.addEventListener("click", () => {
        loadData().catch((error) => {
          setStatus(`Chargement impossible : ${error.message}`, "isError");
        });
      });
    }
  };

  const init = () => {
    bindEvents();
    loadData().catch((error) => {
      setStatus(`Chargement impossible : ${error.message}`, "isError");
      setLoading(false);
      renderAll();
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
