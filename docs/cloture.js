(() => {
  "use strict";

  /*
    Clôture V2 :
    - Fonctionne en localStorage tant que Sheets n’est pas connecté.
    - Masque complètement le bloc de validation si aucune journée active n’existe.
    - Lit la mission de stock active + la journée active.
    - Lit les tickets locaux enregistrés par vente-rapide.
    - Calcule CA, paiements, quantités vendues.
    - Lit une préparation de stock locale si disponible.
    - Permet de compter le stock restant.
    - Enregistre une clôture locale.
    - Marque la journée comme clôturée.
    - Prépare un report de stock vers la journée suivante si elle existe.
  */

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme"
  };

  const STORAGE_KEYS = {
    events: "lugdurum_evenements",
    stockMissions: "lugdurum_missions_stock",
    journees: "lugdurum_journees",
    activeMissionId: "lugdurum_active_mission_id",
    activeStockMissionId: "lugdurum_active_stock_mission_id",
    activeJourneeId: "lugdurum_active_journee_id",
    preparationContext: "lugdurum_preparation_context",
    pendingTransactions: "lugdurum_pending_transactions",
    stockPreparations: "lugdurum_stock_preparations",
    stockPreparationLines: "lugdurum_stock_preparation_lignes",
    stockCarryovers: "lugdurum_stock_carryovers",
    clotures: "lugdurum_clotures",
    frais: "lugdurum_frais"
  };

  const PAYMENT_LABELS = {
    ESP: "Espèces",
    CHQ: "Chèque",
    CB: "Carte bancaire",
    WEBAPP_ESPECES: "Espèces",
    WEBAPP_CHEQUE: "Chèque",
    WEBAPP_CB_MANUEL: "CB manuel",
    MANUEL: "Manuel"
  };

  const state = {
    mission: null,
    journee: null,
    eventItem: null,
    linkedDays: [],
    nextDay: null,
    transactions: [],
    stockRows: [],
    counts: new Map(),
    existingClosure: null,
    frais: []
  };

  const els = {
    closeStatusLabel: document.getElementById("closeStatusLabel"),
    closeHeroTitle: document.getElementById("closeHeroTitle"),
    closeMissionMeta: document.getElementById("closeMissionMeta"),
    closeRevenue: document.getElementById("closeRevenue"),
    closeTickets: document.getElementById("closeTickets"),
    closeStockGap: document.getElementById("closeStockGap"),

    noContextPanel: document.getElementById("noContextPanel"),
    salesPanel: document.getElementById("salesPanel"),
    stockPanel: document.getElementById("stockPanel"),
    feesPanel: document.getElementById("feesPanel"),
    finalPanel: document.getElementById("finalPanel"),

    paymentSummary: document.getElementById("paymentSummary"),
    stockInitialTotal: document.getElementById("stockInitialTotal"),
    stockSoldTotal: document.getElementById("stockSoldTotal"),
    stockTheoryTotal: document.getElementById("stockTheoryTotal"),
    stockCountedTotal: document.getElementById("stockCountedTotal"),
    stockCloseRows: document.getElementById("stockCloseRows"),
    feesSummary: document.getElementById("feesSummary"),

    fillTheoreticalBtn: document.getElementById("fillTheoreticalBtn"),
    clearCountsBtn: document.getElementById("clearCountsBtn"),
    saveDraftBtn: document.getElementById("saveDraftBtn"),
    closeDayBtn: document.getElementById("closeDayBtn"),
    carryNextDayBtn: document.getElementById("carryNextDayBtn"),
    closeNoteInput: document.getElementById("closeNoteInput"),
    closeStatus: document.getElementById("closeStatus")
  };

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(Number(value || 0));

  const formatDate = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

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

  const getArray = (key) => {
    const value = readJson(key, []);
    return Array.isArray(value) ? value : [];
  };

  const getObject = (key) => {
    const value = readJson(key, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  };

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

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const escapeAttr = (value) =>
    escapeHtml(value).replaceAll("`", "&#096;");

  const parseLocalDate = (value) => {
    if (!value) return null;
    return new Date(`${value}T12:00:00`);
  };

  const formatDisplayDate = (isoDate) => {
    const date = parseLocalDate(isoDate);
    if (!date) return "Date inconnue";
    return formatDate.format(date);
  };

  const getActiveIds = () => {
    const context = getObject(STORAGE_KEYS.preparationContext);

    return {
      missionId:
        localStorage.getItem(STORAGE_KEYS.activeStockMissionId) ||
        context.stock_mission_id ||
        context.mission_id ||
        localStorage.getItem(STORAGE_KEYS.activeMissionId) ||
        "",
      journeeId:
        localStorage.getItem(STORAGE_KEYS.activeJourneeId) ||
        context.journee_id ||
        ""
    };
  };

  const getMissionJournees = (missionId) =>
    getArray(STORAGE_KEYS.journees)
      .filter((journee) => {
        return journee.mission_id === missionId || journee.stock_mission_id === missionId;
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const getEventById = (eventId) =>
    getArray(STORAGE_KEYS.events).find((eventItem) => eventItem.evenement_id === eventId) || null;

  const getDayTitle = (journee) => {
    if (!journee) return "Journée inconnue";

    const eventItem = getEventById(journee.evenement_id);

    if (!eventItem) return journee.jour_label || "Journée";

    if (eventItem.date_debut === eventItem.date_fin) {
      return eventItem.nom;
    }

    return `${eventItem.nom} — ${journee.jour_label || "Journée"}`;
  };

  const getExistingClosure = (journeeId) =>
    getArray(STORAGE_KEYS.clotures).find((cloture) => cloture.journee_id === journeeId) || null;

  const getTransactionsForDay = (journeeId) =>
    getArray(STORAGE_KEYS.pendingTransactions).filter((transaction) => {
      return transaction.journee_id === journeeId;
    });

  const getTransactionTotal = (transaction) =>
    toNumber(transaction.total_encaisse_ttc, toNumber(transaction.total_catalogue_ttc, 0));

  const getPaymentKey = (transaction) =>
    String(transaction.mode_paiement || transaction.source || "MANUEL").trim().toUpperCase();

  const getPaymentSummary = () => {
    return state.transactions.reduce((map, transaction) => {
      const key = getPaymentKey(transaction);
      const current = map.get(key) || {
        key,
        label: PAYMENT_LABELS[key] || key,
        total: 0,
        count: 0
      };

      current.total += getTransactionTotal(transaction);
      current.count += 1;

      map.set(key, current);
      return map;
    }, new Map());
  };

  const addSoldQuantity = (map, rawLine) => {
    const skuId = String(rawLine.sku_id || rawLine.sku || "").trim();

    if (!skuId) return;

    const current = map.get(skuId) || {
      sku_id: skuId,
      parfum_code: String(rawLine.parfum_code || skuId.split("_")[0] || "").trim().toUpperCase(),
      parfum_nom: String(rawLine.parfum_nom || rawLine.nom || rawLine.name || "").trim(),
      format_cl: toNumber(rawLine.format_cl, toNumber(String(skuId).split("_")[1], 0)),
      quantite_vendue: 0
    };

    current.quantite_vendue += toNumber(rawLine.quantite, rawLine.qty || 0);

    map.set(skuId, current);
  };

  const getSoldMap = () => {
    const map = new Map();

    state.transactions.forEach((transaction) => {
      if (Array.isArray(transaction.lignes)) {
        transaction.lignes.forEach((line) => addSoldQuantity(map, line));
        return;
      }

      if (Array.isArray(transaction.detail_ticket)) {
        transaction.detail_ticket.forEach((item) => {
          if (item.type === "bottle") {
            addSoldQuantity(map, item);
            return;
          }

          if (item.type === "box" && Array.isArray(item.composition)) {
            item.composition.forEach((product) => {
              addSoldQuantity(map, {
                ...product,
                quantite: 1
              });
            });
          }
        });
      }
    });

    return map;
  };

  const getStockPreparationForMission = (missionId) => {
    const items = getArray(STORAGE_KEYS.stockPreparations);

    return (
      items
        .filter((item) => {
          return item.mission_id === missionId || item.stock_mission_id === missionId;
        })
        .sort((a, b) =>
          String(b.updated_at || b.created_at || "").localeCompare(
            String(a.updated_at || a.created_at || "")
          )
        )[0] || null
    );
  };

  const getRawPreparationLines = (preparation, missionId) => {
    if (!preparation) return [];

    const embedded =
      preparation.lignes ||
      preparation.lines ||
      preparation.stock_lignes ||
      preparation.detail_stock ||
      preparation.stock ||
      [];

    if (Array.isArray(embedded) && embedded.length > 0) {
      return embedded;
    }

    return getArray(STORAGE_KEYS.stockPreparationLines).filter((line) => {
      return (
        line.preparation_id === preparation.preparation_id ||
        line.stock_preparation_id === preparation.preparation_id ||
        line.mission_id === missionId ||
        line.stock_mission_id === missionId
      );
    });
  };

  const normalizePreparationLine = (line, index) => {
    const skuId = String(line.sku_id || line.sku || "").trim();
    const parfumCode = String(
      line.parfum_code ||
      line.code ||
      (skuId ? skuId.split("_")[0] : "")
    ).trim().toUpperCase();

    const formatCl = toNumber(
      line.format_cl,
      skuId && skuId.includes("_") ? toNumber(skuId.split("_")[1], 0) : 0
    );

    return {
      sku_id: skuId || `${parfumCode}_${formatCl || index + 1}`,
      parfum_code: parfumCode,
      parfum_nom: String(line.parfum_nom || line.nom || line.name || parfumCode).trim(),
      format_cl: formatCl,
      ordre_affichage: toNumber(line.ordre_affichage, 1000 + index),
      stock_initial: toNumber(
        line.stock_initial,
        toNumber(
          line.quantite_emportee,
          toNumber(line.quantite, toNumber(line.quantity, toNumber(line.qty, 0)))
        )
      ),
      reappro: toNumber(line.reappro, toNumber(line.reapprovisionnement, 0))
    };
  };

  const getPreparationLines = (missionId) => {
    const preparation = getStockPreparationForMission(missionId);
    const rawLines = getRawPreparationLines(preparation, missionId);

    return rawLines
      .map((line, index) => normalizePreparationLine(line, index))
      .filter((line) => line.sku_id && line.parfum_code);
  };

  const buildStockRows = () => {
    if (!state.mission) return [];

    const soldMap = getSoldMap();
    const prepLines = getPreparationLines(state.mission.mission_id);
    const rowsBySku = new Map();

    prepLines.forEach((line) => {
      const sold = soldMap.get(line.sku_id);

      rowsBySku.set(line.sku_id, {
        ...line,
        quantite_vendue: sold ? sold.quantite_vendue : 0
      });
    });

    soldMap.forEach((sold, skuId) => {
      if (rowsBySku.has(skuId)) return;

      rowsBySku.set(skuId, {
        sku_id: skuId,
        parfum_code: sold.parfum_code,
        parfum_nom: sold.parfum_nom || sold.parfum_code,
        format_cl: sold.format_cl,
        ordre_affichage: 9999,
        stock_initial: 0,
        reappro: 0,
        quantite_vendue: sold.quantite_vendue
      });
    });

    return [...rowsBySku.values()]
      .map((row) => {
        const stockTheorique = row.stock_initial + row.reappro - row.quantite_vendue;

        return {
          ...row,
          stock_theorique: stockTheorique
        };
      })
      .sort((a, b) => {
        const byFormat = b.format_cl - a.format_cl;
        if (byFormat !== 0) return byFormat;

        const byOrder = a.ordre_affichage - b.ordre_affichage;
        if (byOrder !== 0) return byOrder;

        return String(a.parfum_code).localeCompare(String(b.parfum_code));
      });
  };

  const restoreExistingCounts = () => {
    state.counts = new Map();

    if (!state.existingClosure || !Array.isArray(state.existingClosure.stock_lignes)) {
      return;
    }

    state.existingClosure.stock_lignes.forEach((line) => {
      if (!line.sku_id) return;

      const value = toNumber(line.stock_compte, NaN);

      if (Number.isFinite(value)) {
        state.counts.set(line.sku_id, value);
      }
    });

    if (state.existingClosure.note) {
      els.closeNoteInput.value = state.existingClosure.note;
    }
  };

  const getCountedValue = (skuId) => {
    if (!state.counts.has(skuId)) return "";
    return state.counts.get(skuId);
  };

  const getStockTotals = () => {
    return state.stockRows.reduce(
      (totals, row) => {
        const counted = getCountedValue(row.sku_id);

        totals.initial += row.stock_initial;
        totals.sold += row.quantite_vendue;
        totals.theory += row.stock_theorique;

        if (counted !== "") {
          totals.counted += Number(counted);
          totals.hasCounted += 1;
          totals.gap += Number(counted) - row.stock_theorique;
        }

        return totals;
      },
      {
        initial: 0,
        sold: 0,
        theory: 0,
        counted: 0,
        hasCounted: 0,
        gap: 0
      }
    );
  };

  const getFraisForContext = () => {
    if (!state.mission) return [];

    return getArray(STORAGE_KEYS.frais).filter((item) => {
      const missionMatch =
        item.mission_id === state.mission.mission_id ||
        item.stock_mission_id === state.mission.mission_id;

      const dayMatch =
        !item.journee_id ||
        item.journee_id === state.journee?.journee_id;

      return missionMatch && dayMatch;
    });
  };

  const getFraisTotal = () =>
    state.frais.reduce((sum, item) => {
      return sum + toNumber(item.montant_ttc, toNumber(item.montant, toNumber(item.prix, 0)));
    }, 0);

  const setStatus = (message, type = "") => {
    els.closeStatus.textContent = message;
    els.closeStatus.className = "closeStatus";

    if (type) {
      els.closeStatus.classList.add(type);
    }
  };

  const renderNoContext = () => {
    const hasContext = Boolean(state.mission && state.journee);

    els.noContextPanel.hidden = hasContext;
    els.salesPanel.hidden = !hasContext;
    els.stockPanel.hidden = !hasContext;
    els.feesPanel.hidden = !hasContext;
    els.finalPanel.hidden = !hasContext;

    els.saveDraftBtn.disabled = !hasContext;
    els.closeDayBtn.disabled = !hasContext;
    els.fillTheoreticalBtn.disabled = !hasContext;
    els.clearCountsBtn.disabled = !hasContext;

    if (hasContext) return;

    els.closeStatusLabel.textContent = "Aucune journée active";
    els.closeHeroTitle.textContent = "Rien à clôturer";
    els.closeMissionMeta.textContent =
      "Crée ou reprends une mission de stock avant de clôturer une journée.";

    els.closeRevenue.textContent = "—";
    els.closeTickets.textContent = "—";
    els.closeStockGap.textContent = "—";
  };

  const renderHero = () => {
    if (!state.mission || !state.journee) {
      renderNoContext();
      return;
    }

    const revenue = state.transactions.reduce((sum, transaction) => {
      return sum + getTransactionTotal(transaction);
    }, 0);

    const totals = getStockTotals();
    const eventLabel = getDayTitle(state.journee);

    els.closeStatusLabel.textContent =
      state.journee.statut === "cloture" ? "Journée déjà clôturée" : "Journée active";

    els.closeHeroTitle.textContent = eventLabel;

    els.closeMissionMeta.textContent =
      `${state.mission.nom || "Mission de stock"} · ${formatDisplayDate(state.journee.date)}`;

    els.closeRevenue.textContent = formatCurrency(revenue);
    els.closeTickets.textContent = String(state.transactions.length);

    els.closeStockGap.textContent =
      totals.hasCounted > 0
        ? `${totals.gap > 0 ? "+" : ""}${totals.gap}`
        : "—";

    els.carryNextDayBtn.hidden = !state.nextDay;
  };

  const renderPayments = () => {
    const payments = [...getPaymentSummary().values()];

    if (payments.length === 0) {
      els.paymentSummary.innerHTML =
        `<p class="closeEmpty">Aucune vente trouvée pour cette journée.</p>`;
      return;
    }

    const total = payments.reduce((sum, payment) => sum + payment.total, 0);

    els.paymentSummary.innerHTML = `
      <div class="paymentCards">
        ${payments
          .map((payment) => `
            <article class="paymentCard">
              <span>${escapeHtml(payment.label)}</span>
              <strong>${formatCurrency(payment.total)}</strong>
              <small>${payment.count} ticket${payment.count > 1 ? "s" : ""}</small>
            </article>
          `)
          .join("")}
      </div>

      <div class="closeTotalLine">
        <span>Total encaissé</span>
        <strong>${formatCurrency(total)}</strong>
      </div>
    `;
  };

  const renderStockRows = () => {
    const totals = getStockTotals();

    els.stockInitialTotal.textContent = String(totals.initial);
    els.stockSoldTotal.textContent = String(totals.sold);
    els.stockTheoryTotal.textContent = String(totals.theory);
    els.stockCountedTotal.textContent =
      totals.hasCounted > 0 ? String(totals.counted) : "—";

    if (state.stockRows.length === 0) {
      els.stockCloseRows.innerHTML =
        `<p class="closeEmpty">Aucune préparation stock ni vente locale trouvée pour cette journée.</p>`;
      return;
    }

    els.stockCloseRows.innerHTML = state.stockRows
      .map((row) => {
        const counted = getCountedValue(row.sku_id);
        const gap = counted === "" ? null : Number(counted) - row.stock_theorique;
        const gapClass =
          gap === null
            ? ""
            : gap === 0
              ? "isOk"
              : "isAlert";

        return `
          <article class="stockCloseRow" data-stock-row="${escapeAttr(row.sku_id)}">
            <div class="stockCloseMain">
              <strong>${escapeHtml(row.parfum_code)} ${escapeHtml(row.format_cl)} cL</strong>
              <span>${escapeHtml(row.parfum_nom || row.parfum_code)}</span>
            </div>

            <div class="stockCloseNumbers">
              <span>
                Initial
                <strong>${row.stock_initial}</strong>
              </span>

              <span>
                Vendu
                <strong>${row.quantite_vendue}</strong>
              </span>

              <span>
                Théorique
                <strong>${row.stock_theorique}</strong>
              </span>
            </div>

            <label class="stockCountField">
              <span>Compté</span>
              <input
                type="number"
                inputmode="numeric"
                min="0"
                step="1"
                value="${escapeAttr(counted)}"
                data-count-sku="${escapeAttr(row.sku_id)}"
              />
            </label>

            <div class="stockGap ${gapClass}">
              <span>Écart</span>
              <strong>${gap === null ? "—" : `${gap > 0 ? "+" : ""}${gap}`}</strong>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const renderFees = () => {
    if (state.frais.length === 0) {
      els.feesSummary.innerHTML =
        `<p class="closeEmpty">Aucun frais local trouvé pour cette journée ou mission.</p>`;
      return;
    }

    const total = getFraisTotal();

    els.feesSummary.innerHTML = `
      <div class="feesCards">
        ${state.frais
          .map((item) => {
            const amount = toNumber(item.montant_ttc, toNumber(item.montant, toNumber(item.prix, 0)));
            return `
              <article class="feesCard">
                <span>${escapeHtml(item.categorie || item.type || "Frais")}</span>
                <strong>${formatCurrency(amount)}</strong>
                ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
              </article>
            `;
          })
          .join("")}
      </div>

      <div class="closeTotalLine">
        <span>Total frais</span>
        <strong>${formatCurrency(total)}</strong>
      </div>
    `;
  };

  const renderAll = () => {
    renderNoContext();

    if (!state.mission || !state.journee) return;

    renderHero();
    renderPayments();
    renderStockRows();
    renderFees();
  };

  const buildClosure = (status) => {
    const now = new Date().toISOString();
    const totals = getStockTotals();

    const revenue = state.transactions.reduce((sum, transaction) => {
      return sum + getTransactionTotal(transaction);
    }, 0);

    const paymentSummary = [...getPaymentSummary().values()].map((payment) => ({
      mode_paiement: payment.key,
      libelle: payment.label,
      total_ttc: payment.total,
      nb_transactions: payment.count
    }));

    const existingId = state.existingClosure?.cloture_id || "";
    const clotureId =
      existingId ||
      `CLOT_${state.journee.date.replaceAll("-", "")}_${Date.now().toString(36).toUpperCase()}`;

    return {
      cloture_id: clotureId,
      mission_id: state.mission.mission_id,
      stock_mission_id: state.mission.mission_id,
      journee_id: state.journee.journee_id,
      evenement_id: state.journee.evenement_id || "",
      user_id: CURRENT_USER.user_id,
      statut: status,
      date_cloture: now,
      ca_total_ttc: revenue,
      nb_transactions: state.transactions.length,
      paiements: paymentSummary,
      total_frais_ttc: getFraisTotal(),
      stock_initial_total: totals.initial,
      stock_vendu_total: totals.sold,
      stock_theorique_total: totals.theory,
      stock_compte_total: totals.hasCounted > 0 ? totals.counted : "",
      stock_ecart_total: totals.hasCounted > 0 ? totals.gap : "",
      stock_lignes: state.stockRows.map((row) => {
        const counted = getCountedValue(row.sku_id);
        const hasCount = counted !== "";
        const stockCompte = hasCount ? Number(counted) : "";

        return {
          sku_id: row.sku_id,
          parfum_code: row.parfum_code,
          parfum_nom: row.parfum_nom,
          format_cl: row.format_cl,
          stock_initial: row.stock_initial,
          reappro: row.reappro,
          quantite_vendue: row.quantite_vendue,
          stock_theorique: row.stock_theorique,
          stock_compte: stockCompte,
          ecart: hasCount ? stockCompte - row.stock_theorique : ""
        };
      }),
      note: els.closeNoteInput.value.trim(),
      created_at: state.existingClosure?.created_at || now,
      updated_at: now
    };
  };

  const upsertClosure = (closure) => {
    const items = getArray(STORAGE_KEYS.clotures);
    const index = items.findIndex((item) => item.cloture_id === closure.cloture_id);

    if (index >= 0) {
      items[index] = closure;
    } else {
      items.push(closure);
    }

    writeJson(STORAGE_KEYS.clotures, items);
    state.existingClosure = closure;
  };

  const validateCountsBeforeClose = () => {
    if (state.stockRows.length === 0) return true;

    const missing = state.stockRows.filter((row) => !state.counts.has(row.sku_id));

    if (missing.length === 0) return true;

    setStatus(
      "Renseigne tous les stocks comptés ou utilise “Remplir avec le stock théorique”.",
      "isError"
    );

    return false;
  };

  const updateDayAndMissionAfterClose = (closure) => {
    const now = new Date().toISOString();

    const journees = getArray(STORAGE_KEYS.journees).map((journee) => {
      if (journee.journee_id !== state.journee.journee_id) return journee;

      return {
        ...journee,
        statut: "cloture",
        cloture_id: closure.cloture_id,
        closed_at: now,
        updated_at: now
      };
    });

    writeJson(STORAGE_KEYS.journees, journees);

    const linkedAfterClose = journees.filter((journee) => {
      return (
        journee.mission_id === state.mission.mission_id ||
        journee.stock_mission_id === state.mission.mission_id
      );
    });

    const allClosed =
      linkedAfterClose.length > 0 &&
      linkedAfterClose.every((journee) => {
        return journee.statut === "cloture" || journee.statut === "annule";
      });

    const stockMissions = getArray(STORAGE_KEYS.stockMissions).map((mission) => {
      if (mission.mission_id !== state.mission.mission_id) return mission;

      return {
        ...mission,
        statut: allClosed ? "cloture" : "en_cours",
        updated_at: now,
        closed_at: allClosed ? now : mission.closed_at || ""
      };
    });

    writeJson(STORAGE_KEYS.stockMissions, stockMissions);

    if (allClosed) {
      localStorage.removeItem(STORAGE_KEYS.activeJourneeId);
      localStorage.removeItem(STORAGE_KEYS.activeMissionId);
      localStorage.removeItem(STORAGE_KEYS.activeStockMissionId);

      writeJson(STORAGE_KEYS.preparationContext, {
        mission_id: state.mission.mission_id,
        stock_mission_id: state.mission.mission_id,
        journee_id: "",
        step: "mission_cloturee",
        updated_at: now
      });
    }

    state.journee =
      journees.find((journee) => journee.journee_id === state.journee.journee_id) ||
      state.journee;

    state.mission =
      stockMissions.find((mission) => mission.mission_id === state.mission.mission_id) ||
      state.mission;

    state.linkedDays = linkedAfterClose;
  };

  const saveDraft = () => {
    if (!state.mission || !state.journee) return;

    const closure = buildClosure("brouillon");
    upsertClosure(closure);

    setStatus("Brouillon de clôture enregistré en local.", "isSuccess");
    renderAll();
  };

  const closeDay = () => {
    if (!state.mission || !state.journee) return;

    if (!validateCountsBeforeClose()) return;

    const closure = buildClosure("cloturee");
    upsertClosure(closure);
    updateDayAndMissionAfterClose(closure);

    setStatus(
      state.nextDay
        ? "Journée clôturée. Tu peux reporter le stock vers la prochaine journée."
        : "Journée clôturée. Mission terminée si toutes les journées sont clôturées.",
      "isSuccess"
    );

    renderAll();
  };

  const carryStockToNextDay = () => {
    if (!state.nextDay || !state.existingClosure) {
      setStatus("Aucune prochaine journée disponible pour le report.", "isError");
      return;
    }

    const ok = window.confirm(
      `Reporter le stock compté vers ${getDayTitle(state.nextDay)} ?`
    );

    if (!ok) return;

    const now = new Date().toISOString();

    const carryover = {
      carryover_id: `CARRY_${Date.now().toString(36).toUpperCase()}`,
      mission_id: state.mission.mission_id,
      stock_mission_id: state.mission.mission_id,
      from_journee_id: state.journee.journee_id,
      to_journee_id: state.nextDay.journee_id,
      source_cloture_id: state.existingClosure.cloture_id,
      lignes: state.existingClosure.stock_lignes.map((line) => ({
        sku_id: line.sku_id,
        parfum_code: line.parfum_code,
        parfum_nom: line.parfum_nom,
        format_cl: line.format_cl,
        stock_initial: toNumber(line.stock_compte, 0),
        source: "REPORT_CLOTURE"
      })),
      created_at: now,
      updated_at: now
    };

    const carryovers = getArray(STORAGE_KEYS.stockCarryovers);
    carryovers.push(carryover);
    writeJson(STORAGE_KEYS.stockCarryovers, carryovers);

    localStorage.setItem(STORAGE_KEYS.activeMissionId, state.mission.mission_id);
    localStorage.setItem(STORAGE_KEYS.activeStockMissionId, state.mission.mission_id);
    localStorage.setItem(STORAGE_KEYS.activeJourneeId, state.nextDay.journee_id);

    writeJson(STORAGE_KEYS.preparationContext, {
      mission_id: state.mission.mission_id,
      stock_mission_id: state.mission.mission_id,
      journee_id: state.nextDay.journee_id,
      step: "stock_reporte",
      source: "cloture",
      carryover_id: carryover.carryover_id,
      updated_at: now
    });

    setStatus("Stock reporté vers la prochaine journée en local.", "isSuccess");
  };

  const fillTheoreticalCounts = () => {
    state.stockRows.forEach((row) => {
      state.counts.set(row.sku_id, Math.max(0, row.stock_theorique));
    });

    setStatus("");
    renderAll();
  };

  const clearCounts = () => {
    state.counts = new Map();
    setStatus("");
    renderAll();
  };

  const loadContext = () => {
    const active = getActiveIds();
    const stockMissions = getArray(STORAGE_KEYS.stockMissions);
    const journees = getArray(STORAGE_KEYS.journees);

    state.mission =
      stockMissions.find((mission) => mission.mission_id === active.missionId) ||
      null;

    state.journee =
      journees.find((journee) => journee.journee_id === active.journeeId) ||
      null;

    if (!state.mission || !state.journee) {
      state.mission = null;
      state.journee = null;
      state.eventItem = null;
      state.linkedDays = [];
      state.nextDay = null;
      state.transactions = [];
      state.stockRows = [];
      state.frais = [];
      state.existingClosure = null;
      state.counts = new Map();
      return;
    }

    state.eventItem = getEventById(state.journee.evenement_id);
    state.linkedDays = getMissionJournees(state.mission.mission_id);

    state.nextDay =
      state.linkedDays.find((journee) => {
        return (
          String(journee.date).localeCompare(String(state.journee.date)) > 0 &&
          journee.statut !== "cloture" &&
          journee.statut !== "annule"
        );
      }) || null;

    state.transactions = getTransactionsForDay(state.journee.journee_id);
    state.existingClosure = getExistingClosure(state.journee.journee_id);
    state.stockRows = buildStockRows();
    state.frais = getFraisForContext();

    restoreExistingCounts();
  };

  document.addEventListener("input", (event) => {
    const input = event.target.closest("[data-count-sku]");
    if (!input) return;

    const skuId = input.dataset.countSku;

    if (input.value.trim() === "") {
      state.counts.delete(skuId);
    } else {
      state.counts.set(skuId, toNumber(input.value, 0));
    }

    setStatus("");
    renderAll();
  });

  els.fillTheoreticalBtn.addEventListener("click", fillTheoreticalCounts);
  els.clearCountsBtn.addEventListener("click", clearCounts);
  els.saveDraftBtn.addEventListener("click", saveDraft);
  els.closeDayBtn.addEventListener("click", closeDay);
  els.carryNextDayBtn.addEventListener("click", carryStockToNextDay);

  loadContext();
  renderAll();
})();