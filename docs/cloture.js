(() => {
  "use strict";

  /*
    Clôture V3 :
    - Fonctionne en localStorage si l’API / Sheets est indisponible.
    - Charge missions_stock, missions_vente, journees_vente, transactions,
      ventes_lignes, frais, mouvements_stock et clotures si l’API les expose.
    - Utilise la file d’attente gérée par lugdurum-api.js quand les méthodes API existent.
    - Masque complètement la validation si aucune journée active n’existe.
    - Lit la mission de stock active + la journée active.
    - Calcule CA, paiements, tickets, quantités vendues.
    - Lit le stock préparé depuis mouvements_stock :
      PREPARATION / REPORT_CLOTURE / REAPPRO.
    - Fallback compatible avec l’ancien localStorage stock_preparations si présent.
    - Permet de compter le stock restant.
    - Enregistre une clôture locale.
    - Envoie la clôture + les lignes de clôture en mouvements_stock si API disponible.
    - Marque la journée comme clôturée.
    - Met à jour la mission de stock.
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
    transactionsCache: "lugdurum_transactions_cache",
    ventesLignes: "lugdurum_ventes_lignes",

    frais: "lugdurum_frais",
    mouvementsStock: "lugdurum_mouvements_stock",
    clotures: "lugdurum_clotures",

    stockCarryovers: "lugdurum_stock_carryovers",

    legacyStockPreparations: "lugdurum_stock_preparations",
    legacyStockPreparationLines: "lugdurum_stock_preparation_lignes"
  };

  const MOVEMENT_TYPES = {
    PREPARATION: "PREPARATION",
    REAPPRO: "REAPPRO",
    REPORT_CLOTURE: "REPORT_CLOTURE",
    CLOTURE_COMPTE: "CLOTURE_COMPTE"
  };

  const PAYMENT_LABELS = {
    ESP: "Espèces",
    CHQ: "Chèque",
    CB: "Carte bancaire",
    WEBAPP_ESPECES: "Espèces",
    WEBAPP_CHEQUE: "Chèque",
    WEBAPP_CB_MANUEL: "CB manuel",
    SUMUP: "SumUp",
    MANUEL: "Manuel"
  };

  const state = {
    mission: null,
    journee: null,
    eventItem: null,
    linkedDays: [],
    nextDay: null,

    events: [],
    stockMissions: [],
    journees: [],
    allTransactions: [],
    ventesLignes: [],
    transactions: [],
    frais: [],
    mouvementsStock: [],
    clotures: [],

    stockRows: [],
    counts: new Map(),
    existingClosure: null,

    isSaving: false,
    dataLoaded: false
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

  const api = () => window.LugdurumAPI || null;

  const hasApi = () => Boolean(api());

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: Number(value || 0) % 1 === 0 ? 0 : 2,
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

  const parseLocalDate = (value) => {
    if (!value) return null;
    return new Date(`${value}T12:00:00`);
  };

  const formatDisplayDate = (isoDate) => {
    const date = parseLocalDate(isoDate);
    if (!date) return "Date inconnue";
    return formatDate.format(date);
  };

  const normalizeStatus = (value) =>
    String(value || "").trim().toLowerCase();

  const normalizeMovementType = (value) =>
    String(value || "").trim().toUpperCase();

  const normalizeSkuId = (line) =>
    String(line.sku_id || line.sku || "").trim();

  const normalizeParfumCode = (line, skuId = "") =>
    String(
      line.parfum_code ||
      line.code ||
      (skuId ? skuId.split("_")[0] : "")
    )
      .trim()
      .toUpperCase();

  const normalizeFormatCl = (line, skuId = "") =>
    toNumber(
      line.format_cl,
      skuId && skuId.includes("_") ? toNumber(skuId.split("_")[1], 0) : 0
    );

  const mergeById = (arrays, idKey) => {
    const map = new Map();

    arrays.flat().forEach((item) => {
      if (!item || typeof item !== "object") return;

      const id = String(item[idKey] || "").trim();
      if (!id) return;

      const existing = map.get(id);

      if (!existing) {
        map.set(id, item);
        return;
      }

      const existingUpdated = String(existing.updated_at || existing.created_at || "");
      const itemUpdated = String(item.updated_at || item.created_at || "");

      if (itemUpdated >= existingUpdated) {
        map.set(id, item);
      }
    });

    return [...map.values()];
  };

  const setStatus = (message, type = "") => {
    if (!els.closeStatus) return;

    els.closeStatus.textContent = message;
    els.closeStatus.className = "closeStatus";

    if (type) {
      els.closeStatus.classList.add(type);
    }
  };

  const setSaving = (isSaving) => {
    state.isSaving = isSaving;

    [
      els.fillTheoreticalBtn,
      els.clearCountsBtn,
      els.saveDraftBtn,
      els.closeDayBtn,
      els.carryNextDayBtn
    ].forEach((button) => {
      if (button) button.disabled = isSaving;
    });
  };

  const getPendingWritesCount = () => {
    if (hasApi() && typeof api().getPendingWritesCount === "function") {
      return api().getPendingWritesCount();
    }

    return 0;
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

  const getEventId = (eventItem) =>
    String(eventItem?.evenement_id || eventItem?.mission_id || "").trim();

  const getDayEventId = (journee) =>
    String(journee?.evenement_id || journee?.mission_vente_id || "").trim();

  const getEventById = (eventId) =>
    state.events.find((eventItem) => getEventId(eventItem) === String(eventId || "")) ||
    null;

  const getDayTitle = (journee) => {
    if (!journee) return "Journée inconnue";

    const eventItem = getEventById(getDayEventId(journee));

    if (!eventItem) return journee.jour_label || "Journée";

    if (eventItem.date_debut === eventItem.date_fin) {
      return eventItem.nom;
    }

    return `${eventItem.nom} — ${journee.jour_label || "Journée"}`;
  };

  const getMissionJournees = (missionId) =>
    state.journees
      .filter((journee) => {
        return (
          String(journee.mission_id || "") === missionId ||
          String(journee.stock_mission_id || "") === missionId
        );
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const getExistingClosure = (journeeId) =>
    state.clotures.find((cloture) => String(cloture.journee_id || "") === journeeId) ||
    null;

  const getTransactionsForDay = (journeeId) =>
    state.allTransactions.filter((transaction) => {
      const status = normalizeStatus(transaction.statut || "validee");

      return (
        String(transaction.journee_id || "") === journeeId &&
        status !== "annule" &&
        status !== "annulee" &&
        status !== "rembourse"
      );
    });

  const getTransactionTotal = (transaction) =>
    toNumber(
      transaction.total_encaisse_ttc,
      toNumber(transaction.total_encaisse, toNumber(transaction.total_catalogue_ttc, 0))
    );

  const getPaymentKey = (transaction) =>
    String(
      transaction.paiement_provider ||
      transaction.mode_paiement ||
      transaction.source ||
      "MANUEL"
    )
      .trim()
      .toUpperCase();

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

  const getTransactionLineIdsForDay = () =>
    new Set(state.transactions.map((transaction) => transaction.transaction_id).filter(Boolean));

  const getRemoteSaleLinesForDay = () => {
    const transactionIds = getTransactionLineIdsForDay();

    return state.ventesLignes.filter((line) => {
      const lineDayId = String(line.journee_id || "").trim();
      const transactionId = String(line.transaction_id || "").trim();

      return (
        lineDayId === String(state.journee?.journee_id || "") ||
        (transactionId && transactionIds.has(transactionId))
      );
    });
  };

  const addSoldQuantity = (map, rawLine) => {
    const skuId = normalizeSkuId(rawLine);

    if (!skuId) return;

    const parfumCode = normalizeParfumCode(rawLine, skuId);
    const formatCl = normalizeFormatCl(rawLine, skuId);

    const current = map.get(skuId) || {
      sku_id: skuId,
      parfum_code: parfumCode,
      parfum_nom: String(rawLine.parfum_nom || rawLine.nom || rawLine.name || parfumCode).trim(),
      format_cl: formatCl,
      quantite_vendue: 0
    };

    current.quantite_vendue += toNumber(rawLine.quantite, toNumber(rawLine.qty, 0));

    map.set(skuId, current);
  };

  const getSoldMap = () => {
    const map = new Map();
    const remoteLines = getRemoteSaleLinesForDay();
    const remoteTransactionIds = new Set(
      remoteLines.map((line) => String(line.transaction_id || "").trim()).filter(Boolean)
    );

    remoteLines.forEach((line) => addSoldQuantity(map, line));

    state.transactions.forEach((transaction) => {
      if (
        transaction.transaction_id &&
        remoteTransactionIds.has(String(transaction.transaction_id))
      ) {
        return;
      }

      if (Array.isArray(transaction.lignes) && transaction.lignes.length > 0) {
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

  const getMovementQuantity = (movement) =>
    toNumber(
      movement.quantite,
      toNumber(
        movement.quantite_preparee,
        toNumber(movement.stock_initial, toNumber(movement.quantity, toNumber(movement.qty, 0)))
      )
    );

  const addStockLineToMap = (map, rawLine, quantityField) => {
    const skuId = normalizeSkuId(rawLine);

    if (!skuId) return;

    const parfumCode = normalizeParfumCode(rawLine, skuId);
    const formatCl = normalizeFormatCl(rawLine, skuId);
    const quantity =
      quantityField === "stock_initial"
        ? toNumber(rawLine.stock_initial, getMovementQuantity(rawLine))
        : getMovementQuantity(rawLine);

    const current = map.get(skuId) || {
      sku_id: skuId,
      parfum_code: parfumCode,
      parfum_nom: String(rawLine.parfum_nom || rawLine.nom || rawLine.name || parfumCode).trim(),
      format_cl: formatCl,
      ordre_affichage: toNumber(rawLine.ordre_affichage, 9999),
      stock_initial: 0,
      reappro: 0
    };

    current[quantityField] += quantity;
    current.ordre_affichage = Math.min(
      current.ordre_affichage,
      toNumber(rawLine.ordre_affichage, current.ordre_affichage)
    );

    map.set(skuId, current);
  };

  const getCurrentDayReportMovements = () => {
    const missionId = String(state.mission?.mission_id || "");
    const journeeId = String(state.journee?.journee_id || "");

    return state.mouvementsStock.filter((movement) => {
      const type = normalizeMovementType(movement.type_mouvement || movement.type);
      const movementMissionId = String(movement.stock_mission_id || movement.mission_id || "");
      const movementJourneeId = String(movement.journee_id || "");
      const toJourneeId = String(movement.to_journee_id || movement.journee_destination_id || "");

      return (
        movementMissionId === missionId &&
        [MOVEMENT_TYPES.REPORT_CLOTURE, "REPORT", "STOCK_REPORT"].includes(type) &&
        (toJourneeId === journeeId || movementJourneeId === journeeId)
      );
    });
  };

  const getPreparationMovements = () => {
    const missionId = String(state.mission?.mission_id || "");
    const journeeId = String(state.journee?.journee_id || "");

    return state.mouvementsStock.filter((movement) => {
      const type = normalizeMovementType(movement.type_mouvement || movement.type);
      const movementMissionId = String(movement.stock_mission_id || movement.mission_id || "");
      const movementJourneeId = String(movement.journee_id || "");

      return (
        movementMissionId === missionId &&
        type === MOVEMENT_TYPES.PREPARATION &&
        (!movementJourneeId || movementJourneeId === journeeId)
      );
    });
  };

  const getReapproMovements = () => {
    const missionId = String(state.mission?.mission_id || "");
    const journeeId = String(state.journee?.journee_id || "");

    return state.mouvementsStock.filter((movement) => {
      const type = normalizeMovementType(movement.type_mouvement || movement.type);
      const movementMissionId = String(movement.stock_mission_id || movement.mission_id || "");
      const movementJourneeId = String(movement.journee_id || "");

      return (
        movementMissionId === missionId &&
        ["REAPPRO", "REAPPROVISIONNEMENT"].includes(type) &&
        (!movementJourneeId || movementJourneeId === journeeId)
      );
    });
  };

  const getLegacyPreparationLines = () => {
    const missionId = String(state.mission?.mission_id || "");
    const preparations = getArray(STORAGE_KEYS.legacyStockPreparations);
    const lines = getArray(STORAGE_KEYS.legacyStockPreparationLines);

    const preparation =
      preparations
        .filter((item) => item.mission_id === missionId || item.stock_mission_id === missionId)
        .sort((a, b) =>
          String(b.updated_at || b.created_at || "").localeCompare(
            String(a.updated_at || a.created_at || "")
          )
        )[0] || null;

    if (!preparation) return [];

    if (Array.isArray(preparation.lignes) && preparation.lignes.length > 0) {
      return preparation.lignes;
    }

    return lines.filter((line) => {
      return (
        line.stock_preparation_id === preparation.stock_preparation_id ||
        line.mission_id === missionId ||
        line.stock_mission_id === missionId
      );
    });
  };

  const getLegacyCarryoverLines = () => {
    if (!state.journee) return [];

    const journeeId = state.journee.journee_id;

    return getArray(STORAGE_KEYS.stockCarryovers)
      .filter((item) => item.to_journee_id === journeeId)
      .flatMap((item) => Array.isArray(item.lignes) ? item.lignes : []);
  };

  const buildInitialStockMap = () => {
    const map = new Map();

    const reportMovements = getCurrentDayReportMovements();

    if (reportMovements.length > 0) {
      reportMovements.forEach((movement) => {
        addStockLineToMap(map, movement, "stock_initial");
      });
    } else {
      const preparationMovements = getPreparationMovements();

      if (preparationMovements.length > 0) {
        preparationMovements.forEach((movement) => {
          addStockLineToMap(map, movement, "stock_initial");
        });
      } else {
        getLegacyPreparationLines().forEach((line) => {
          addStockLineToMap(
            map,
            {
              ...line,
              quantite:
                line.quantite_preparee ??
                line.quantite_emportee ??
                line.quantite ??
                line.quantity ??
                line.qty
            },
            "stock_initial"
          );
        });
      }

      getLegacyCarryoverLines().forEach((line) => {
        addStockLineToMap(
          map,
          {
            ...line,
            quantite: line.stock_initial ?? line.quantite ?? line.qty
          },
          "stock_initial"
        );
      });
    }

    getReapproMovements().forEach((movement) => {
      addStockLineToMap(map, movement, "reappro");
    });

    return map;
  };

  const buildStockRows = () => {
    if (!state.mission) return [];

    const soldMap = getSoldMap();
    const stockMap = buildInitialStockMap();
    const rowsBySku = new Map();

    stockMap.forEach((line, skuId) => {
      const sold = soldMap.get(skuId);

      rowsBySku.set(skuId, {
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

    if (!state.existingClosure) {
      return;
    }

    const stockLines = Array.isArray(state.existingClosure.stock_lignes)
      ? state.existingClosure.stock_lignes
      : [];

    stockLines.forEach((line) => {
      if (!line.sku_id) return;

      const value = toNumber(line.stock_compte, NaN);

      if (Number.isFinite(value)) {
        state.counts.set(line.sku_id, value);
      }
    });

    if (state.existingClosure.note && els.closeNoteInput) {
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

    return state.frais.filter((item) => {
      const status = normalizeStatus(item.statut || "valide");

      if (status === "annule") return false;

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
    getFraisForContext().reduce((sum, item) => {
      return sum + toNumber(item.montant_ttc, toNumber(item.montant, toNumber(item.prix, 0)));
    }, 0);

  const setPanelHidden = (element, hidden) => {
    if (element) element.hidden = hidden;
  };

  const renderNoContext = () => {
    const hasContext = Boolean(state.mission && state.journee);

    setPanelHidden(els.noContextPanel, hasContext);
    setPanelHidden(els.salesPanel, !hasContext);
    setPanelHidden(els.stockPanel, !hasContext);
    setPanelHidden(els.feesPanel, !hasContext);
    setPanelHidden(els.finalPanel, !hasContext);

    [
      els.saveDraftBtn,
      els.closeDayBtn,
      els.fillTheoreticalBtn,
      els.clearCountsBtn,
      els.carryNextDayBtn
    ].forEach((button) => {
      if (button) button.disabled = !hasContext || state.isSaving;
    });

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

    if (els.carryNextDayBtn) {
      els.carryNextDayBtn.hidden = !state.nextDay;
    }
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
        `<p class="closeEmpty">Aucune préparation stock ni vente trouvée pour cette journée.</p>`;
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
    const frais = getFraisForContext();

    if (frais.length === 0) {
      els.feesSummary.innerHTML =
        `<p class="closeEmpty">Aucun frais trouvé pour cette journée ou mission.</p>`;
      return;
    }

    const total = getFraisTotal();

    els.feesSummary.innerHTML = `
      <div class="feesCards">
        ${frais
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
      evenement_id: getDayEventId(state.journee),
      user_id: CURRENT_USER.user_id,
      user_nom: CURRENT_USER.nom,
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

  const buildClosureMovements = (closure) => {
    if (!closure || !Array.isArray(closure.stock_lignes)) return [];

    return closure.stock_lignes
      .filter((line) => line.stock_compte !== "")
      .map((line) => ({
        mouvement_id: `MVT_CLOT_${closure.cloture_id}_${line.sku_id}`,
        type_mouvement: MOVEMENT_TYPES.CLOTURE_COMPTE,
        mission_id: closure.mission_id,
        stock_mission_id: closure.stock_mission_id,
        journee_id: closure.journee_id,
        source_id: closure.cloture_id,
        source_type: "CLOTURE",
        sku_id: line.sku_id,
        parfum_code: line.parfum_code,
        parfum_nom: line.parfum_nom,
        format_cl: line.format_cl,
        quantite: line.stock_compte,
        quantite_theorique: line.stock_theorique,
        ecart: line.ecart,
        statut: closure.statut,
        note: closure.note,
        created_at: closure.created_at,
        updated_at: closure.updated_at
      }));
  };

  const upsertLocalById = (items, item, idKey) => {
    const index = items.findIndex((existing) => existing[idKey] === item[idKey]);

    if (index >= 0) {
      items[index] = item;
    } else {
      items.push(item);
    }

    return items;
  };

  const upsertClosureLocal = (closure) => {
    state.clotures = upsertLocalById(state.clotures, closure, "cloture_id");
    writeJson(STORAGE_KEYS.clotures, state.clotures);
    state.existingClosure = closure;
  };

  const upsertMovementsLocal = (movements) => {
    movements.forEach((movement) => {
      state.mouvementsStock = upsertLocalById(
        state.mouvementsStock,
        movement,
        "mouvement_id"
      );
    });

    writeJson(STORAGE_KEYS.mouvementsStock, state.mouvementsStock);
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

  const buildDayAndMissionPatchAfterClose = (closure) => {
    const now = new Date().toISOString();

    const updatedJournee = {
      ...state.journee,
      statut: "cloture",
      cloture_id: closure.cloture_id,
      closed_at: now,
      updated_at: now
    };

    const linkedAfterClose = state.linkedDays.map((journee) => {
      if (journee.journee_id !== updatedJournee.journee_id) return journee;
      return updatedJournee;
    });

    const allClosed =
      linkedAfterClose.length > 0 &&
      linkedAfterClose.every((journee) => {
        return journee.statut === "cloture" || journee.statut === "annule";
      });

    const updatedMission = {
      ...state.mission,
      statut: allClosed ? "cloture" : "en_cours",
      ca_total_ttc: toNumber(state.mission.ca_total_ttc, 0) + toNumber(closure.ca_total_ttc, 0),
      total_frais_ttc: toNumber(state.mission.total_frais_ttc, 0) + toNumber(closure.total_frais_ttc, 0),
      stock_initial_total: closure.stock_initial_total,
      stock_vendu_total: closure.stock_vendu_total,
      stock_theorique_total: closure.stock_theorique_total,
      stock_compte_total: closure.stock_compte_total,
      stock_ecart_total: closure.stock_ecart_total,
      updated_at: now,
      closed_at: allClosed ? now : state.mission.closed_at || ""
    };

    return {
      updatedJournee,
      updatedMission,
      linkedAfterClose,
      allClosed
    };
  };

  const applyDayAndMissionPatchLocal = (patch) => {
    state.journees = state.journees.map((journee) => {
      if (journee.journee_id !== patch.updatedJournee.journee_id) return journee;
      return patch.updatedJournee;
    });

    state.stockMissions = state.stockMissions.map((mission) => {
      if (mission.mission_id !== patch.updatedMission.mission_id) return mission;
      return patch.updatedMission;
    });

    writeJson(STORAGE_KEYS.journees, state.journees);
    writeJson(STORAGE_KEYS.stockMissions, state.stockMissions);

    state.journee = patch.updatedJournee;
    state.mission = patch.updatedMission;
    state.linkedDays = patch.linkedAfterClose;

    if (patch.allClosed) {
      localStorage.removeItem(STORAGE_KEYS.activeJourneeId);
      localStorage.removeItem(STORAGE_KEYS.activeMissionId);
      localStorage.removeItem(STORAGE_KEYS.activeStockMissionId);

      writeJson(STORAGE_KEYS.preparationContext, {
        mission_id: state.mission.mission_id,
        stock_mission_id: state.mission.mission_id,
        journee_id: "",
        step: "mission_cloturee",
        updated_at: new Date().toISOString()
      });
    }
  };

  const buildBatchOperation = (sheetKey, data) => ({
    sheetKey,
    data
  });

  const saveClosureToApi = async ({ closure, movements, patch }) => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    if (typeof api().saveCloture === "function") {
      await api().saveCloture(closure);
    } else if (typeof api().batchUpsert === "function") {
      await api().batchUpsert([
        buildBatchOperation("clotures", closure)
      ]);
    } else {
      throw new Error("Aucune méthode API disponible pour écrire la clôture.");
    }

    if (movements.length > 0) {
      if (typeof api().saveMouvementStock === "function") {
        for (const movement of movements) {
          await api().saveMouvementStock(movement);
        }
      } else if (typeof api().batchUpsert === "function") {
        await api().batchUpsert(
          movements.map((movement) => buildBatchOperation("mouvementsStock", movement))
        );
      }
    }

    if (patch) {
      if (typeof api().saveJournee === "function") {
        await api().saveJournee(patch.updatedJournee);
      }

      if (typeof api().saveMissionStock === "function") {
        await api().saveMissionStock(patch.updatedMission);
      }

      if (
        typeof api().saveJournee !== "function" &&
        typeof api().saveMissionStock !== "function" &&
        typeof api().batchUpsert === "function"
      ) {
        await api().batchUpsert([
          buildBatchOperation("journees", patch.updatedJournee),
          buildBatchOperation("missionsStock", patch.updatedMission)
        ]);
      }
    }
  };

  const saveClosure = async (status) => {
    if (!state.mission || !state.journee || state.isSaving) return null;

    if (status === "cloturee" && !validateCountsBeforeClose()) return null;

    const closure = buildClosure(status);
    const movements = status === "cloturee" ? buildClosureMovements(closure) : [];
    const patch = status === "cloturee" ? buildDayAndMissionPatchAfterClose(closure) : null;

    upsertClosureLocal(closure);
    upsertMovementsLocal(movements);

    if (patch) {
      applyDayAndMissionPatchLocal(patch);
    }

    setSaving(true);
    setStatus(
      status === "cloturee"
        ? "Enregistrement de la clôture..."
        : "Enregistrement du brouillon..."
    );

    try {
      await saveClosureToApi({
        closure,
        movements,
        patch
      });

      const pendingCount = getPendingWritesCount();

      setStatus(
        pendingCount > 0
          ? `${status === "cloturee" ? "Journée clôturée" : "Brouillon enregistré"} · ${pendingCount} écriture(s) en attente de synchronisation.`
          : status === "cloturee"
            ? state.nextDay
              ? "Journée clôturée. Tu peux reporter le stock vers la prochaine journée."
              : "Journée clôturée."
            : "Brouillon de clôture enregistré.",
        pendingCount > 0 ? "isError" : "isSuccess"
      );

      renderAll();
      return closure;
    } catch (error) {
      setStatus(
        `${status === "cloturee" ? "Clôture gardée en local" : "Brouillon gardé en local"} · API à synchroniser : ${error.message}`,
        "isError"
      );

      renderAll();
      return closure;
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = () => {
    saveClosure("brouillon");
  };

  const closeDay = () => {
    saveClosure("cloturee");
  };

  const buildCarryoverMovements = (carryover) => {
    if (!carryover || !Array.isArray(carryover.lignes)) return [];

    return carryover.lignes.map((line) => ({
      mouvement_id: `MVT_REPORT_${carryover.carryover_id}_${line.sku_id}`,
      type_mouvement: MOVEMENT_TYPES.REPORT_CLOTURE,
      mission_id: carryover.mission_id,
      stock_mission_id: carryover.stock_mission_id,
      journee_id: carryover.to_journee_id,
      from_journee_id: carryover.from_journee_id,
      to_journee_id: carryover.to_journee_id,
      source_id: carryover.source_cloture_id,
      source_type: "REPORT_CLOTURE",
      sku_id: line.sku_id,
      parfum_code: line.parfum_code,
      parfum_nom: line.parfum_nom,
      format_cl: line.format_cl,
      quantite: line.stock_initial,
      statut: "valide",
      note: "Report de stock depuis clôture",
      created_at: carryover.created_at,
      updated_at: carryover.updated_at
    }));
  };

  const saveCarryoverToApi = async ({ carryover, movements }) => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    if (typeof api().saveCarryoverStock === "function") {
      await api().saveCarryoverStock(carryover);
    }

    if (movements.length > 0) {
      if (typeof api().saveMouvementStock === "function") {
        for (const movement of movements) {
          await api().saveMouvementStock(movement);
        }
        return;
      }

      if (typeof api().batchUpsert === "function") {
        await api().batchUpsert(
          movements.map((movement) => buildBatchOperation("mouvementsStock", movement))
        );
        return;
      }
    }

    if (typeof api().saveCarryoverStock !== "function" && movements.length === 0) {
      throw new Error("Aucune méthode API disponible pour le report de stock.");
    }
  };

  const carryStockToNextDay = async () => {
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
      lignes: state.existingClosure.stock_lignes
        .filter((line) => line.stock_compte !== "")
        .map((line) => ({
          sku_id: line.sku_id,
          parfum_code: line.parfum_code,
          parfum_nom: line.parfum_nom,
          format_cl: line.format_cl,
          stock_initial: Math.max(0, toNumber(line.stock_compte, 0)),
          source: "REPORT_CLOTURE"
        })),
      created_at: now,
      updated_at: now
    };

    const carryovers = getArray(STORAGE_KEYS.stockCarryovers);
    carryovers.push(carryover);
    writeJson(STORAGE_KEYS.stockCarryovers, carryovers);

    const movements = buildCarryoverMovements(carryover);
    upsertMovementsLocal(movements);

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

    setSaving(true);
    setStatus("Report du stock...");

    try {
      await saveCarryoverToApi({
        carryover,
        movements
      });

      const pendingCount = getPendingWritesCount();

      setStatus(
        pendingCount > 0
          ? `Stock reporté · ${pendingCount} écriture(s) en attente de synchronisation.`
          : "Stock reporté vers la prochaine journée.",
        pendingCount > 0 ? "isError" : "isSuccess"
      );
    } catch (error) {
      setStatus(
        `Stock reporté en local · API à synchroniser : ${error.message}`,
        "isError"
      );
    } finally {
      setSaving(false);
    }
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

  const cacheCoreData = () => {
    writeJson(STORAGE_KEYS.events, state.events);
    writeJson(STORAGE_KEYS.stockMissions, state.stockMissions);
    writeJson(STORAGE_KEYS.journees, state.journees);
    writeJson(STORAGE_KEYS.ventesLignes, state.ventesLignes);
    writeJson(STORAGE_KEYS.frais, state.frais);
    writeJson(STORAGE_KEYS.mouvementsStock, state.mouvementsStock);
    writeJson(STORAGE_KEYS.clotures, state.clotures);
    writeJson(STORAGE_KEYS.transactionsCache, state.allTransactions);
  };

  const loadLocalData = () => {
    const localTransactions = getArray(STORAGE_KEYS.pendingTransactions);
    const cachedTransactions = getArray(STORAGE_KEYS.transactionsCache);

    state.events = getArray(STORAGE_KEYS.events);
    state.stockMissions = getArray(STORAGE_KEYS.stockMissions);
    state.journees = getArray(STORAGE_KEYS.journees);
    state.allTransactions = mergeById([cachedTransactions, localTransactions], "transaction_id");
    state.ventesLignes = getArray(STORAGE_KEYS.ventesLignes);
    state.frais = getArray(STORAGE_KEYS.frais);
    state.mouvementsStock = getArray(STORAGE_KEYS.mouvementsStock);
    state.clotures = getArray(STORAGE_KEYS.clotures);
  };

  const optionalApiArray = async (fnName, fallback = []) => {
    if (!hasApi() || typeof api()[fnName] !== "function") return fallback;

    try {
      const result = await api()[fnName]();
      return Array.isArray(result) ? result : fallback;
    } catch {
      return fallback;
    }
  };

  const loadRemoteData = async () => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    const [
      events,
      stockMissions,
      journees,
      transactions,
      ventesLignes,
      frais,
      mouvementsStock,
      clotures
    ] = await Promise.all([
      optionalApiArray("getMissions", state.events),
      optionalApiArray("getMissionsStock", state.stockMissions),
      optionalApiArray("getJournees", state.journees),
      optionalApiArray("getTransactions", []),
      optionalApiArray("getVentesLignes", state.ventesLignes),
      optionalApiArray("getFrais", state.frais),
      optionalApiArray("getMouvementsStock", state.mouvementsStock),
      optionalApiArray("getClotures", state.clotures)
    ]);

    const localTransactions = getArray(STORAGE_KEYS.pendingTransactions);

    state.events = events;
    state.stockMissions = stockMissions;
    state.journees = journees;
    state.allTransactions = mergeById([transactions, localTransactions], "transaction_id");
    state.ventesLignes = ventesLignes;
    state.frais = frais;
    state.mouvementsStock = mouvementsStock;
    state.clotures = clotures;

    state.dataLoaded = true;
    cacheCoreData();
  };

  const loadContext = () => {
    const active = getActiveIds();
    const missionId = String(active.missionId || "").trim();
    const journeeId = String(active.journeeId || "").trim();

    state.mission =
      state.stockMissions.find((mission) => String(mission.mission_id || "") === missionId) ||
      null;

    state.journee =
      state.journees.find((journee) => String(journee.journee_id || "") === journeeId) ||
      null;

    if (!state.mission || !state.journee) {
      state.mission = null;
      state.journee = null;
      state.eventItem = null;
      state.linkedDays = [];
      state.nextDay = null;
      state.transactions = [];
      state.stockRows = [];
      state.existingClosure = null;
      state.counts = new Map();
      return false;
    }

    state.eventItem = getEventById(getDayEventId(state.journee));
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

    restoreExistingCounts();

    return true;
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
    renderHero();
    renderStockRows();
  });

  els.fillTheoreticalBtn.addEventListener("click", fillTheoreticalCounts);
  els.clearCountsBtn.addEventListener("click", clearCounts);
  els.saveDraftBtn.addEventListener("click", saveDraft);
  els.closeDayBtn.addEventListener("click", closeDay);
  els.carryNextDayBtn.addEventListener("click", carryStockToNextDay);

  window.addEventListener("lugdurum:sync-status", (event) => {
    const detail = event.detail || {};
    const pendingCount = Number(detail.pending_count || detail.pendingCount || 0);

    if (pendingCount > 0) {
      setStatus(`${pendingCount} écriture(s) en attente de synchronisation.`, "isError");
    }
  });

  const init = async () => {
    loadLocalData();
    loadContext();
    renderAll();

    try {
      setStatus("Chargement depuis Google Sheets...");
      await loadRemoteData();

      loadContext();
      renderAll();
      setStatus("");
    } catch (error) {
      setStatus(
        `Lecture Sheets impossible. Données locales affichées : ${error.message}`,
        "isError"
      );
      renderAll();
    }
  };

  init();
})();