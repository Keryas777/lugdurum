(() => {
  "use strict";

  /*
    Journées clôturées V3 :
    - API Google Sheets prioritaire.
    - Aucun rendu local avant la réponse API.
    - Cache/localStorage uniquement si l’API est indisponible.
    - Affiche CA, paiements, frais, produits vendus 50 cL / 20 cL par journée.
    - Ajoute un détail consultable par journée.
    - Ajoute un lien Modifier / compléter vers saisie-ancienne-journee.html?mode=edit&journee_id=...
    - Ignore les transactions, lignes et frais annulés.
  */

  const CACHE_KEYS = {
    transactions: "lugdurum_transactions_cache",
    ventesLignes: "lugdurum_ventes_lignes_cache",
    frais: "lugdurum_frais_cache",
    journees: "lugdurum_journees_cache",
    missionsStock: "lugdurum_missions_stock_cache",
    missions: "lugdurum_missions_vente_cache",
    catalogue: "lugdurum_catalogue_cache"
  };

  const LEGACY_KEYS = {
    transactions: [
      "lugdurum_transactions_cache",
      "lugdurum_transactions_backup",
      "lugdurum_pending_transactions"
    ],
    ventesLignes: [
      "lugdurum_ventes_lignes_cache",
      "lugdurum_ventes_lignes"
    ],
    frais: [
      "lugdurum_frais_cache",
      "lugdurum_frais"
    ],
    journees: [
      "lugdurum_journees_cache",
      "lugdurum_journees"
    ],
    missionsStock: [
      "lugdurum_missions_stock_cache",
      "lugdurum_missions_stock"
    ],
    missions: [
      "lugdurum_missions_vente_cache",
      "lugdurum_evenements"
    ],
    catalogue: [
      "lugdurum_catalogue_cache"
    ]
  };

  const PAYMENT_LABELS = {
    ESP: "Espèces",
    CHQ: "Chèque",
    CB: "CB",
    SUMUP: "SumUp",
    HISTORIQUE: "Historique",
    WEBAPP_ESPECES: "Espèces",
    WEBAPP_CHEQUE: "Chèque",
    WEBAPP_CB_MANUEL: "CB manuel",
    MANUEL: "Manuel"
  };

  const state = {
    source: "loading",
    transactions: [],
    lignes: [],
    frais: [],
    journees: [],
    missionsStock: [],
    missions: [],
    catalogue: [],
    filters: {
      year: "ALL",
      search: ""
    }
  };

  const $ = (...ids) =>
    ids.map((id) => document.getElementById(id)).find(Boolean) || null;

  const els = {
    year: $(
      "closedYearSelect",
      "closedDaysYearInput",
      "journeesClotureesYearInput",
      "closedYearFilter",
      "yearFilter"
    ),
    search: $(
      "closedSearch",
      "closedDaysSearchInput",
      "journeesClotureesSearchInput",
      "closedSearchInput",
      "searchInput"
    ),
    revenue: $(
      "closedDaysRevenue",
      "journeesClotureesRevenue",
      "closedRevenue"
    ),
    count: $(
      "closedDaysCount",
      "journeesClotureesCount",
      "closedCount"
    ),
    average: $(
      "closedDaysAverage",
      "journeesClotureesAverage",
      "closedAverage"
    ),
    tickets: $(
      "closedDaysTickets",
      "journeesClotureesTickets",
      "closedTickets"
    ),
    list: $(
      "closedDaysList",
      "journeesClotureesList",
      "closedList",
      "daysList",
      "statsList"
    ),
    status: $(
      "closedDaysStatus",
      "journeesClotureesStatus",
      "closedStatus",
      "statsStatus"
    ),

    detailPanel: $("dayDetailPanel"),
    detailTitle: $("dayDetailTitle"),
    detailMeta: $("dayDetailMeta"),
    detailRevenue: $("detailRevenue"),
    detailTickets: $("detailTickets"),
    detailPayment: $("detailPayment"),
    detailSales: $("detailSales"),
    detailFees: $("detailFees"),
    detailStock: $("detailStock"),
    detailEditLink: $("dayDetailEditLink")
  };

  const api = () => window.LugdurumAPI || null;

  const readJsonNullable = (key) => {
    const raw = localStorage.getItem(key);

    if (raw === null) return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const readFirstArray = (keys) => {
    for (const key of keys) {
      const value = readJsonNullable(key);

      if (Array.isArray(value)) return value;
    }

    return [];
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

  const normalizeText = (value) =>
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

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value || 0);

  const parseLocalDate = (value) => {
    if (!value) return null;

    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);

    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatDisplayDate = (value) => {
    const date = parseLocalDate(value);

    if (!date) return "Date inconnue";

    return new Intl.DateTimeFormat("fr-FR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  };

  const getYearFromDate = (value) => {
    const text = String(value || "");
    const match = text.match(/^(\d{4})/);

    return match ? match[1] : "";
  };

  const setText = (element, value) => {
    if (element) element.textContent = value;
  };

  const setStatus = (message, type = "") => {
    if (!els.status) return;

    els.status.textContent = message;
    els.status.className = "statsStatus closedDaysStatus";

    if (type) {
      els.status.classList.add(type);
    }
  };

  const isValidStatus = (item) => {
    const statut = String(item?.statut || item?.paiement_statut || "validee")
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

  const getMissionId = (item) =>
    String(item?.stock_mission_id || item?.mission_id || item?.evenement_id || "")
      .trim();

  const getJourneeId = (item) =>
    String(item?.journee_id || item?.day_id || "").trim();

  const getTransactionId = (transaction) =>
    String(transaction?.transaction_id || transaction?.id || "").trim();

  const getTransactionAmount = (transaction) =>
    toNumber(
      transaction?.total_encaisse_ttc ??
      transaction?.total_encaisse ??
      transaction?.total_catalogue_ttc ??
      transaction?.total_catalogue,
      0
    );

  const getFraisAmount = (item) =>
    toNumber(item?.montant_ttc ?? item?.montant ?? item?.prix ?? item?.amount, 0);

  const getPaymentKey = (transaction) =>
    String(
      transaction?.mode_paiement ||
      transaction?.paiement_provider ||
      transaction?.source ||
      "MANUEL"
    )
      .trim()
      .toUpperCase();

  const parseDetailTicket = (transaction) => {
    const raw = transaction?.detail_ticket;

    if (Array.isArray(raw)) return raw;
    if (typeof raw !== "string" || !raw.trim()) return [];

    try {
      const value = JSON.parse(raw);

      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };

  const parseSku = (skuId) => {
    const parts = String(skuId || "").split("_");

    return {
      parfum_code: String(parts[0] || "").toUpperCase(),
      format_cl: toNumber(parts[1], 0)
    };
  };

  const getCatalogueBySku = () =>
    state.catalogue.reduce((map, item) => {
      const skuId = String(item.sku_id || "").trim();

      if (skuId) {
        map.set(skuId, item);
      }

      return map;
    }, new Map());

  const getMissionMap = () => {
    const map = new Map();

    [...state.missions, ...state.missionsStock].forEach((mission) => {
      const id = getMissionId(mission);

      if (id) {
        map.set(id, mission);
      }
    });

    return map;
  };

  const getJourneeMap = () =>
    state.journees.reduce((map, journee) => {
      const id = getJourneeId(journee);

      if (id) {
        map.set(id, journee);
      }

      return map;
    }, new Map());

  const getTransactionMap = () =>
    state.transactions.reduce((map, transaction) => {
      const id = getTransactionId(transaction);

      if (id) {
        map.set(id, transaction);
      }

      return map;
    }, new Map());

  const buildLinesFromTransactions = () => {
    const lines = [];

    state.transactions
      .filter(isValidStatus)
      .forEach((transaction) => {
        const ticket = parseDetailTicket(transaction);
        const transactionId = getTransactionId(transaction);
        const total = getTransactionAmount(transaction);

        ticket.forEach((item) => {
          if (item.type === "bottle") {
            lines.push({
              transaction_id: transactionId,
              mission_id: getMissionId(transaction),
              journee_id: getJourneeId(transaction),
              sku_id: item.sku_id,
              parfum_code: item.parfum_code,
              parfum_nom: item.parfum_nom,
              format_cl: item.format_cl,
              quantite: toNumber(item.quantite, 0),
              total_catalogue_ligne_ttc:
                toNumber(item.quantite, 0) * toNumber(item.prix_unitaire_ttc, 0),
              statut: "valide"
            });

            return;
          }

          if (item.type === "box" && Array.isArray(item.composition)) {
            const unitShare =
              item.composition.length > 0
                ? toNumber(item.prix_ttc, total) / item.composition.length
                : 0;

            item.composition.forEach((product) => {
              lines.push({
                transaction_id: transactionId,
                mission_id: getMissionId(transaction),
                journee_id: getJourneeId(transaction),
                sku_id: product.sku_id,
                parfum_code: product.parfum_code,
                parfum_nom: product.parfum_nom,
                format_cl: product.format_cl || item.format_cl || 20,
                quantite: 1,
                total_catalogue_ligne_ttc: unitShare,
                statut: "valide"
              });
            });
          }
        });
      });

    return lines;
  };

  const isLineLinkedToValidTransaction = (line, transactionMap) => {
    const transactionId = String(line.transaction_id || "").trim();

    if (!transactionId) return true;

    const transaction = transactionMap.get(transactionId);

    if (!transaction) return true;

    return isValidStatus(transaction);
  };

  const getNormalizedLines = () => {
    const catalogueMap = getCatalogueBySku();
    const transactionMap = getTransactionMap();

    const baseLines =
      state.lignes.length > 0
        ? state.lignes
        : buildLinesFromTransactions();

    return baseLines
      .filter(isValidStatus)
      .filter((line) => isLineLinkedToValidTransaction(line, transactionMap))
      .map((line) => {
        const transaction =
          transactionMap.get(String(line.transaction_id || "")) || null;

        const skuId = String(line.sku_id || line.sku || "").trim();
        const catalogue = catalogueMap.get(skuId) || null;
        const parsed = parseSku(skuId);
        const quantity = toNumber(line.quantite ?? line.qty ?? line.quantity, 0);
        const unitPrice = toNumber(line.prix_unitaire_ttc ?? line.prix ?? line.unit_price, 0);

        return {
          transaction_id: String(line.transaction_id || "").trim(),
          mission_id: getMissionId(line) || getMissionId(transaction || {}),
          journee_id: getJourneeId(line) || getJourneeId(transaction || {}),
          sku_id: skuId,
          parfum_code: String(
            line.parfum_code ||
            catalogue?.parfum_code ||
            parsed.parfum_code ||
            "?"
          ).toUpperCase(),
          parfum_nom: String(
            line.parfum_nom ||
            catalogue?.parfum_nom ||
            parsed.parfum_code ||
            "Produit"
          ),
          format_cl: toNumber(
            line.format_cl,
            toNumber(catalogue?.format_cl, parsed.format_cl)
          ),
          quantite: quantity,
          total_ttc: toNumber(
            line.total_catalogue_ligne_ttc ??
            line.total_ligne_ttc ??
            line.total_ttc,
            quantity * unitPrice
          )
        };
      })
      .filter((line) => line.quantite > 0);
  };

  const addPayment = (summary, transaction) => {
    const key = getPaymentKey(transaction);

    const current = summary.paiements.get(key) || {
      key,
      label: PAYMENT_LABELS[key] || key,
      total: 0,
      count: 0
    };

    current.total += getTransactionAmount(transaction);
    current.count += 1;

    summary.paiements.set(key, current);
  };

  const addProduct = (summary, line) => {
    const key = line.sku_id || `${line.parfum_code}_${line.format_cl}`;

    const current = summary.products.get(key) || {
      key,
      sku_id: line.sku_id,
      parfum_code: line.parfum_code,
      parfum_nom: line.parfum_nom,
      format_cl: line.format_cl,
      quantite: 0,
      ca: 0
    };

    current.quantite += line.quantite;
    current.ca += line.total_ttc;

    summary.products.set(key, current);
  };

  const addFrais = (summary, item) => {
    const amount = getFraisAmount(item);

    summary.frais += amount;

    summary.fraisItems.push({
      frais_id: String(item.frais_id || "").trim(),
      categorie: String(item.categorie_label || item.categorie || "Frais").trim(),
      libelle: String(item.libelle || item.note || "").trim(),
      montant: amount,
      date: String(item.date || item.date_heure || item.created_at || "").slice(0, 10)
    });
  };

  const buildDaySummaries = () => {
    const missionMap = getMissionMap();
    const journeeMap = getJourneeMap();
    const map = new Map();

    const getOrCreate = ({ journeeId = "", missionId = "", date = "" }) => {
      const key = journeeId || `${missionId || "NO_MISSION"}_${date || "NO_DATE"}`;
      const journee = journeeId ? journeeMap.get(journeeId) : null;
      const resolvedMissionId = missionId || getMissionId(journee || {});
      const mission = missionMap.get(resolvedMissionId) || null;
      const resolvedDate = date || journee?.date || "";

      if (!map.has(key)) {
        map.set(key, {
          key,
          journee_id: journeeId,
          mission_id: resolvedMissionId,
          date: resolvedDate,
          year: getYearFromDate(resolvedDate),
          label: [
            mission?.nom ||
              journee?.nom ||
              journee?.evenement ||
              "Journée",
            journee?.jour_label || ""
          ]
            .filter(Boolean)
            .join(" — "),
          ville: mission?.ville || journee?.ville || "",
          statut: journee?.statut || "",
          ca: 0,
          frais: 0,
          fraisItems: [],
          tickets: 0,
          paiements: new Map(),
          products: new Map()
        });
      }

      return map.get(key);
    };

    state.transactions
      .filter(isValidStatus)
      .forEach((transaction) => {
        const journeeId = getJourneeId(transaction);
        const missionId = getMissionId(transaction);
        const date = String(
          transaction.date_heure ||
          transaction.date ||
          transaction.created_at ||
          ""
        ).slice(0, 10);

        const summary = getOrCreate({
          journeeId,
          missionId,
          date
        });

        summary.ca += getTransactionAmount(transaction);
        summary.tickets += 1;

        addPayment(summary, transaction);

        if (!summary.year) {
          summary.year = getYearFromDate(date);
        }

        if (!summary.date) {
          summary.date = date;
        }
      });

    state.frais
      .filter(isValidStatus)
      .forEach((item) => {
        const journeeId = getJourneeId(item);
        const missionId = getMissionId(item);
        const date = String(
          item.date ||
          item.date_heure ||
          item.created_at ||
          ""
        ).slice(0, 10);

        const summary = getOrCreate({
          journeeId,
          missionId,
          date
        });

        addFrais(summary, item);

        if (!summary.year) {
          summary.year = getYearFromDate(date);
        }

        if (!summary.date) {
          summary.date = date;
        }
      });

    getNormalizedLines().forEach((line) => {
      const summary = getOrCreate({
        journeeId: line.journee_id,
        missionId: line.mission_id,
        date: ""
      });

      addProduct(summary, line);
    });

    state.journees
      .filter((journee) => String(journee.statut || "").toLowerCase() === "cloture")
      .forEach((journee) => {
        getOrCreate({
          journeeId: getJourneeId(journee),
          missionId: getMissionId(journee),
          date: journee.date || ""
        });
      });

    return [...map.values()]
      .filter((summary) => (
        String(summary.statut || "").toLowerCase() === "cloture" ||
        summary.ca > 0 ||
        summary.tickets > 0 ||
        summary.products.size > 0 ||
        summary.frais > 0
      ))
      .map((summary) => ({
        ...summary,
        paiements: [...summary.paiements.values()].sort((a, b) => b.total - a.total),
        products: [...summary.products.values()].sort((a, b) => {
          const byFormat = b.format_cl - a.format_cl;
          if (byFormat !== 0) return byFormat;

          const byQty = b.quantite - a.quantite;
          if (byQty !== 0) return byQty;

          return String(a.parfum_code).localeCompare(String(b.parfum_code));
        }),
        fraisItems: summary.fraisItems.sort((a, b) => {
          const byDate = String(b.date || "").localeCompare(String(a.date || ""));
          if (byDate !== 0) return byDate;

          return String(a.categorie || "").localeCompare(String(b.categorie || ""));
        })
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  };

  const getAvailableYears = () => {
    const years = new Set();

    buildDaySummaries().forEach((day) => {
      if (day.year) {
        years.add(day.year);
      }
    });

    return [...years].sort((a, b) => b.localeCompare(a));
  };

  const syncYearFilter = () => {
    if (!els.year) return;

    const current = els.year.value || state.filters.year;
    const years = getAvailableYears();

    els.year.innerHTML = `
      <option value="ALL">Toutes</option>
      ${years.map((year) => `<option value="${escapeAttr(year)}">${escapeHtml(year)}</option>`).join("")}
    `;

    if (current === "ALL" || years.includes(current)) {
      els.year.value = current;
      state.filters.year = current;
    } else if (years.length > 0) {
      els.year.value = years[0];
      state.filters.year = years[0];
    } else {
      els.year.value = "ALL";
      state.filters.year = "ALL";
    }
  };

  const getFilteredDays = () => {
    const query = normalizeText(state.filters.search);

    return buildDaySummaries()
      .filter((day) => {
        if (state.filters.year === "ALL") return true;
        return day.year === state.filters.year;
      })
      .filter((day) => {
        if (!query) return true;

        return normalizeText(`${day.label} ${day.ville}`).includes(query);
      });
  };

  const compute = () => {
    const days = getFilteredDays();
    const ca = days.reduce((sum, day) => sum + day.ca, 0);
    const tickets = days.reduce((sum, day) => sum + day.tickets, 0);
    const activeDays = days.filter((day) => day.ca > 0 || day.tickets > 0).length;

    return {
      days,
      ca,
      tickets,
      activeDays,
      average: activeDays > 0 ? ca / activeDays : 0
    };
  };

  const renderProducts = (products) => {
    if (!products.length) {
      return `<p class="statsEmpty compact">Aucun produit vendu renseigné.</p>`;
    }

    return `
      <div class="closedProductsGrid">
        ${products.map((product) => `
          <span class="closedProductChip">
            <strong>${escapeHtml(product.parfum_code)} ${escapeHtml(product.format_cl)} cL</strong>
            ${escapeHtml(String(product.quantite))}
          </span>
        `).join("")}
      </div>
    `;
  };

  const renderPayments = (payments) => {
    if (!payments.length) {
      return `<span>Aucun paiement</span>`;
    }

    return payments.map((payment) => `
      <span>${escapeHtml(payment.label)} · ${escapeHtml(formatCurrency(payment.total))}</span>
    `).join("");
  };

  const renderDetailPayments = (payments) => {
    if (!payments.length) {
      return `<p class="statsEmpty compact">Aucun paiement renseigné.</p>`;
    }

    return payments.map((payment) => `
      <p>
        <strong>${escapeHtml(payment.label)}</strong>
        <span>${escapeHtml(formatCurrency(payment.total))}</span>
      </p>
    `).join("");
  };

  const renderDetailProducts = (products) => {
    if (!products.length) {
      return `<p class="statsEmpty compact">Aucun produit vendu renseigné.</p>`;
    }

    return products.map((product) => `
      <p>
        <strong>${escapeHtml(product.parfum_code)} ${escapeHtml(product.format_cl)} cL</strong>
        <span>
          ${escapeHtml(String(product.quantite))}
          ·
          ${escapeHtml(formatCurrency(product.ca))}
        </span>
      </p>
    `).join("");
  };

  const renderDetailFees = (day) => {
    if (!day.fraisItems.length) {
      return `
        <p>
          <strong>Total frais</strong>
          <span>${escapeHtml(formatCurrency(day.frais))}</span>
        </p>
        <p class="statsEmpty compact">Aucun détail de frais renseigné.</p>
      `;
    }

    return `
      <p>
        <strong>Total frais</strong>
        <span>${escapeHtml(formatCurrency(day.frais))}</span>
      </p>

      ${day.fraisItems.map((item) => `
        <p>
          <strong>${escapeHtml(item.categorie || "Frais")}</strong>
          <span>
            ${escapeHtml(formatCurrency(item.montant))}
            ${item.libelle ? `· ${escapeHtml(item.libelle)}` : ""}
          </span>
        </p>
      `).join("")}
    `;
  };

  const renderDayDetail = (day) => {
    if (!els.detailPanel) return;

    els.detailPanel.hidden = false;

    setText(els.detailTitle, day.label || "Journée");

    setText(
      els.detailMeta,
      `${formatDisplayDate(day.date)}${day.ville ? ` · ${day.ville}` : ""}`
    );

    setText(els.detailRevenue, formatCurrency(day.ca));
    setText(els.detailTickets, String(day.tickets));

    if (els.detailEditLink) {
      if (day.journee_id) {
        els.detailEditLink.hidden = false;
        els.detailEditLink.href =
          `./saisie-ancienne-journee.html?mode=edit&journee_id=${encodeURIComponent(day.journee_id)}`;
      } else {
        els.detailEditLink.hidden = true;
        els.detailEditLink.removeAttribute("href");
      }
    }

    if (els.detailPayment) {
      els.detailPayment.innerHTML = renderDetailPayments(day.paiements);
    }

    if (els.detailSales) {
      els.detailSales.innerHTML = renderDetailProducts(day.products);
    }

    if (els.detailFees) {
      els.detailFees.innerHTML = renderDetailFees(day);
    }

    if (els.detailStock) {
      els.detailStock.innerHTML =
        `<p class="statsEmpty compact">Stock détaillé à connecter plus tard.</p>`;
    }

    els.detailPanel.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const renderDayCard = (day) => {
    const editLink = day.journee_id
      ? `
        <a
          class="secondaryBtn"
          href="./saisie-ancienne-journee.html?mode=edit&journee_id=${encodeURIComponent(day.journee_id)}"
        >
          Modifier / compléter
        </a>
      `
      : "";

    return `
      <article class="statsCard closedDayCard">
        <div class="statsCardHeader">
          <div class="statsCardTitle">
            <strong>${escapeHtml(day.label || "Journée")}</strong>
            <span>
              ${escapeHtml(formatDisplayDate(day.date))}
              ${day.ville ? ` · ${escapeHtml(day.ville)}` : ""}
            </span>
          </div>

          <strong class="statsAmount">${escapeHtml(formatCurrency(day.ca))}</strong>
        </div>

        <div class="statsMeta closedPayments">
          ${renderPayments(day.paiements)}
        </div>

        ${renderProducts(day.products)}

        <div class="statsMeta">
          <span>${escapeHtml(String(day.tickets))} ticket${day.tickets > 1 ? "s" : ""}</span>
          <span>Frais ${escapeHtml(formatCurrency(day.frais))}</span>
          <span>Net ${escapeHtml(formatCurrency(day.ca - day.frais))}</span>
        </div>

        <div class="closedDayActions">
          <button
            class="secondaryBtn"
            type="button"
            data-show-day="${escapeAttr(day.key)}"
          >
            Voir détail
          </button>

          ${editLink}
        </div>
      </article>
    `;
  };

  const render = () => {
    syncYearFilter();

    const stats = compute();

    setText(els.revenue, formatCurrency(stats.ca));
    setText(els.count, String(stats.activeDays));
    setText(els.average, formatCurrency(stats.average));
    setText(els.tickets, String(stats.tickets));

    if (!els.list) return;

    if (stats.days.length === 0) {
      els.list.innerHTML = `<p class="statsEmpty">Aucune journée clôturée à afficher.</p>`;

      if (els.detailPanel) {
        els.detailPanel.hidden = true;
      }

      return;
    }

    els.list.innerHTML = stats.days.map(renderDayCard).join("");
  };

  const callArray = async (fnName) => {
    if (!api() || typeof api()[fnName] !== "function") return [];

    const result = await api()[fnName]();

    return Array.isArray(result) ? result : [];
  };

  const loadRemote = async () => {
    if (!api()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    const [
      transactions,
      lignes,
      frais,
      journees,
      missionsStock,
      missions,
      catalogue
    ] = await Promise.all([
      callArray("getTransactions"),
      callArray("getVentesLignes"),
      callArray("getFrais"),
      callArray("getJournees"),
      callArray("getMissionsStock"),
      callArray("getMissions"),
      callArray("getCatalogue")
    ]);

    state.transactions = transactions;
    state.lignes = lignes;
    state.frais = frais;
    state.journees = journees;
    state.missionsStock = missionsStock;
    state.missions = missions;
    state.catalogue = catalogue;
    state.source = "api";

    writeJson(CACHE_KEYS.transactions, transactions);
    writeJson(CACHE_KEYS.ventesLignes, lignes);
    writeJson(CACHE_KEYS.frais, frais);
    writeJson(CACHE_KEYS.journees, journees);
    writeJson(CACHE_KEYS.missionsStock, missionsStock);
    writeJson(CACHE_KEYS.missions, missions);
    writeJson(CACHE_KEYS.catalogue, catalogue);
  };

  const loadLocalFallback = () => {
    state.transactions = readFirstArray(LEGACY_KEYS.transactions);
    state.lignes = readFirstArray(LEGACY_KEYS.ventesLignes);
    state.frais = readFirstArray(LEGACY_KEYS.frais);
    state.journees = readFirstArray(LEGACY_KEYS.journees);
    state.missionsStock = readFirstArray(LEGACY_KEYS.missionsStock);
    state.missions = readFirstArray(LEGACY_KEYS.missions);
    state.catalogue = readFirstArray(LEGACY_KEYS.catalogue);
    state.source = "local";
  };

  const bindEvents = () => {
    if (els.year) {
      els.year.addEventListener("change", () => {
        state.filters.year = els.year.value || "ALL";
        render();
      });
    }

    if (els.search) {
      els.search.addEventListener("input", () => {
        state.filters.search = els.search.value || "";
        render();
      });
    }

    document.addEventListener("click", (event) => {
      const detailButton = event.target.closest("[data-show-day]");

      if (!detailButton) return;

      const dayKey = detailButton.dataset.showDay;
      const day = buildDaySummaries().find((item) => item.key === dayKey);

      if (!day) return;

      renderDayDetail(day);
    });
  };

  const init = async () => {
    bindEvents();

    if (els.list) {
      els.list.innerHTML = `<p class="statsEmpty">Chargement depuis Google Sheets…</p>`;
    }

    if (els.detailPanel) {
      els.detailPanel.hidden = true;
    }

    setStatus("Chargement depuis Google Sheets...");

    try {
      await loadRemote();
      render();
      setStatus("");
    } catch (error) {
      loadLocalFallback();
      render();
      setStatus(`API indisponible. Données locales affichées : ${error.message}`, "isError");
    }
  };

  init();
})();