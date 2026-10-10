/*
  03_get_data.gs

  Lectures GET pour l’API Lugdurum.

  Responsabilités :
  - router les actions GET métier ;
  - lire les onglets principaux via 02_sheets_core.gs ;
  - fournir getCoreData ;
  - fournir getHomeData pour l’accueil ;
  - fournir getVenteRapideData pour la page vente rapide ;
  - fournir getRecettesData(view) pour les pages recettes / cuvées / matières.

  Dépendances attendues :
  - 00_config.gs :
    SHEETS, CORE_DATA_TABLES, EMPTY_CORE_TABLES si présents.
  - 02_sheets_core.gs :
    readSheetRows_(), getCoreData_().
*/

/* ==============================
   Dispatcher GET
   ============================== */

function handleGetAction_(action, params) {
  return handleGetDataAction_(action, params || {});
}

function handleGetDataAction_(action, params) {
  const safeAction = String(action || "").trim();

  switch (safeAction) {
    case "ping":
      return getPingData_();

    case "getSpreadsheetInfo":
      return getSpreadsheetInfo_();

    case "getCoreData":
      return getCoreDataFromParams_(params);

    case "getHomeData":
      return getHomeData_(params);

    case "getVenteRapideData":
    case "getSaleData":
    case "getQuickSaleData":
      return getVenteRapideData_(params);

    case "getCatalogue":
      return readTableGetData_("catalogue");

    case "getOffresVente":
      return readTableGetData_("offresVente");

    case "getInscriptionsEvenements":
    case "getInscriptions":
      return readTableGetData_("inscriptions");

    case "getMissions":
      return readTableGetData_("missions");

    case "getMissionsStock":
      return readTableGetData_("missionsStock");

    case "getJournees":
    case "getJourneesVente":
      return readTableGetData_("journees");

    case "getMouvementsStock":
      return readTableGetData_("mouvementsStock");

    case "getTransactions":
      return readTableGetData_("transactions");

    case "getVentesLignes":
      return readTableGetData_("ventesLignes");

    case "getFrais":
      return readTableGetData_("frais");

    case "getClotures":
    case "getCloturesJournees":
      return readTableGetData_("clotures");

    case "getClients":
      return readTableGetData_("clients");

    case "getCommandesPro":
      return readTableGetData_("commandesPro");

    case "getCommandesProLignes":
      return readTableGetData_("commandesProLignes");

    case "getDocuments":
      return readTableGetData_("documents");

    case "getReferentiel":
      return readTableGetData_("referentiel");

    case "getRecettesData":
      return getRecettesData_(params);

    case "getRecettesDashboardData":
      return getRecettesData_({
        ...params,
        view: "dashboard"
      });

    case "getRecettesHistoriqueData":
      return getRecettesData_({
        ...params,
        view: "historique"
      });

    case "getRecettesProductionData":
      return getRecettesData_({
        ...params,
        view: "production"
      });

    case "getRecettesMatieresData":
      return getRecettesData_({
        ...params,
        view: "matieres"
      });

    default:
      throw new Error(`Action GET inconnue : ${safeAction}`);
  }
}

/* ==============================
   GET simples
   ============================== */

function getPingData_() {
  return {
    pong: true,
    app: "Lugdurum",
    api: "Apps Script",
    version:
      typeof APP_VERSION !== "undefined"
        ? APP_VERSION
        : "split-files",
    generated_at: new Date().toISOString()
  };
}

function getSpreadsheetInfo_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  return {
    spreadsheet_id: spreadsheet.getId(),
    name: spreadsheet.getName(),
    url: spreadsheet.getUrl(),
    timezone: spreadsheet.getSpreadsheetTimeZone(),
    sheets: spreadsheet.getSheets().map(function (sheet) {
      return {
        name: sheet.getName(),
        sheet_id: sheet.getSheetId(),
        last_row: sheet.getLastRow(),
        last_column: sheet.getLastColumn()
      };
    }),
    generated_at: new Date().toISOString()
  };
}

function getCoreDataFromParams_(params) {
  const tables =
    params.tables ||
    params.table ||
    params.keys ||
    "";

  return getCoreData_(tables, params);
}

function readTableGetData_(tableKeyOrSheetName) {
  return readSheetRows_(tableKeyOrSheetName);
}

/* ==============================
   Vente rapide : getVenteRapideData
   ============================== */

function getVenteRapideData_(params) {
  const startedAt = Date.now();

  const requestedStockMissionId = String(
    params.stock_mission_id ||
    params.stockMissionId ||
    params.mission_stock_id ||
    params.missionStockId ||
    params.active_stock_mission_id ||
    params.activeStockMissionId ||
    params.mission_id ||
    params.missionId ||
    params.active_mission_id ||
    params.activeMissionId ||
    ""
  ).trim();

  const requestedJourneeId = String(
    params.journee_id ||
    params.journeeId ||
    params.active_journee_id ||
    params.activeJourneeId ||
    ""
  ).trim();

  /*
    Important :
    - On charge catalogue + offres_vente pour afficher la vente.
    - On charge missions_stock + journees pour reconstruire le contexte.
    - On charge transactions uniquement si une journée active est trouvée,
      afin d’afficher le CA jour.
    - On NE charge PAS mouvements_stock ici.
      La sortie stock sera écrite au moment du ticket via le bundle vente.
  */

  const catalogue = readOptionalTableGetData_("catalogue");
  const offresVente = readOptionalTableGetData_("offresVente");
  const missionsStock = readOptionalTableGetData_("missionsStock");
  const journees = readOptionalTableGetData_("journees");

  const context = resolveVenteRapideContextGetData_({
    missionsStock,
    journees,
    stockMissionId: requestedStockMissionId,
    journeeId: requestedJourneeId
  });

  const transactions = context.journee_id
    ? getVenteRapideTransactionsForDayGetData_(context.journee_id)
    : [];

  const resumeJournee = buildVenteRapideResumeGetData_(transactions);

  return {
    api_mode: "getVenteRapideData",
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,

    requested_context: {
      stock_mission_id: requestedStockMissionId,
      mission_id: requestedStockMissionId,
      journee_id: requestedJourneeId
    },

    context_missing: !context.stock_mission_id || !context.journee_id,

    stock_mission_id: context.stock_mission_id,
    mission_id: context.stock_mission_id,
    journee_id: context.journee_id,

    stockMission: context.stockMission,
    stock_mission: context.stockMission,
    missionStock: context.stockMission,
    mission_stock: context.stockMission,

    journee: context.journee,
    activeJournee: context.journee,
    active_journee: context.journee,

    linkedDays: context.linkedDays,
    linked_days: context.linkedDays,

    catalogue,
    offresVente,
    offres_vente: offresVente,

    transactions,
    resume: resumeJournee,
    resume_journee: resumeJournee,

    /*
      Compatibilité volontaire :
      la page peut encore lire tables.catalogue / tables.offresVente.
      mouvementsStock est laissé vide pour éviter tout chargement massif.
    */
    tables: {
      catalogue,
      offresVente,
      offres_vente: offresVente,
      missionsStock: context.stockMission ? [context.stockMission] : [],
      missions_stock: context.stockMission ? [context.stockMission] : [],
      journees: context.linkedDays,
      transactions,
      mouvementsStock: [],
      mouvements_stock: []
    },

    active: {
      mission_id: context.stock_mission_id,
      stock_mission_id: context.stock_mission_id,
      journee_id: context.journee_id,
      stockMission: context.stockMission,
      stock_mission: context.stockMission,
      journee: context.journee,
      activeJournee: context.journee,
      active_journee: context.journee,
      linkedDays: context.linkedDays,
      linked_days: context.linkedDays,
      transactions,
      mouvementsStock: [],
      mouvements_stock: []
    },

    rawCounts: {
      catalogue: catalogue.length,
      offresVente: offresVente.length,
      missionsStock: missionsStock.length,
      journees: journees.length,
      transactions_journee: transactions.length,
      mouvementsStock: 0
    },

    mouvements_stock_loaded: false,
    mouvementsStockLoaded: false
  };
}

function resolveVenteRapideContextGetData_(payload) {
  const missionsStock = Array.isArray(payload.missionsStock)
    ? payload.missionsStock
    : [];

  const journees = Array.isArray(payload.journees)
    ? payload.journees
    : [];

  let stockMissionId = String(payload.stockMissionId || "").trim();
  let journeeId = String(payload.journeeId || "").trim();

  let journee = journeeId
    ? journees.find(function (item) {
        return String(item.journee_id || "").trim() === journeeId;
      }) || null
    : null;

  if (!stockMissionId && journee) {
    stockMissionId = String(
      journee.stock_mission_id ||
      journee.mission_stock_id ||
      ""
    ).trim();
  }

  let stockMission = stockMissionId
    ? findStockMissionForStockOrEventIdGetData_(stockMissionId, missionsStock)
    : null;

  if (!stockMission && journee) {
    const possibleIds = [
      journee.stock_mission_id,
      journee.mission_stock_id,
      journee.mission_id,
      journee.evenement_id
    ]
      .map(function (value) {
        return String(value || "").trim();
      })
      .filter(Boolean);

    for (let index = 0; index < possibleIds.length; index += 1) {
      stockMission = findStockMissionForStockOrEventIdGetData_(
        possibleIds[index],
        missionsStock
      );

      if (stockMission) break;
    }
  }

  if (stockMission) {
    stockMissionId = getStockMissionIdGetData_(stockMission);
  }

  const linkedDays = stockMission
    ? getMissionJourneesGetData_(stockMission, journees)
    : journee
      ? [journee]
      : [];

  if (!journee && linkedDays.length > 0) {
    journee =
      linkedDays.find(function (day) {
        return normalizeStatusGetData_(day.statut) === "en_cours";
      }) ||
      linkedDays.find(function (day) {
        return (
          !isClosedStatusGetData_(day) &&
          !isCancelledStatusGetData_(day)
        );
      }) ||
      linkedDays[0] ||
      null;

    journeeId = journee ? String(journee.journee_id || "").trim() : "";
  }

  if (journee && !journeeId) {
    journeeId = String(journee.journee_id || "").trim();
  }

  return {
    stock_mission_id: stockMissionId,
    mission_id: stockMissionId,
    journee_id: journeeId,
    stockMission,
    journee,
    linkedDays
  };
}

function findStockMissionForStockOrEventIdGetData_(id, missionsStock) {
  const safeId = String(id || "").trim();

  if (!safeId) return null;

  return (
    missionsStock.find(function (mission) {
      return getStockMissionIdGetData_(mission) === safeId;
    }) ||
    missionsStock.find(function (mission) {
      return getStockMissionEventIdGetData_(mission) === safeId;
    }) ||
    null
  );
}

function getVenteRapideTransactionsForDayGetData_(journeeId) {
  const safeJourneeId = String(journeeId || "").trim();

  if (!safeJourneeId) return [];

  return readOptionalTableGetData_("transactions")
    .filter(function (transaction) {
      return String(transaction.journee_id || "").trim() === safeJourneeId;
    })
    .filter(isValidPaidTransactionForVenteRapideGetData_);
}

function isValidPaidTransactionForVenteRapideGetData_(transaction) {
  if (!transaction || isCancelledStatusGetData_(transaction)) return false;

  const statut = normalizeStatusGetData_(transaction.statut);
  const paiementStatut = normalizeStatusGetData_(transaction.paiement_statut);

  if (
    [
      "paiement_en_attente",
      "sumup_lance",
      "en_attente",
      "attente"
    ].indexOf(statut) >= 0
  ) {
    return false;
  }

  if (
    [
      "sumup_lance",
      "paiement_en_attente",
      "en_attente",
      "attente"
    ].indexOf(paiementStatut) >= 0
  ) {
    return false;
  }

  if (
    [
      "validee",
      "valide",
      "validée",
      "validé",
      "cloture",
      "cloturee",
      "clôture",
      "clôturée"
    ].indexOf(statut) >= 0
  ) {
    return true;
  }

  if (
    [
      "paye",
      "payee",
      "payé",
      "payée"
    ].indexOf(paiementStatut) >= 0
  ) {
    return true;
  }

  return false;
}

function buildVenteRapideResumeGetData_(transactions) {
  const safeTransactions = Array.isArray(transactions)
    ? transactions
    : [];

  const caJourTtc = safeTransactions.reduce(function (sum, transaction) {
    return sum + getTransactionAmountGetData_(transaction);
  }, 0);

  const byPayment = safeTransactions.reduce(function (acc, transaction) {
    const key = String(transaction.mode_paiement || "AUTRE")
      .trim()
      .toUpperCase() || "AUTRE";

    acc[key] = roundAmountGetData_(
      toNumberGetData_(acc[key], 0) +
      getTransactionAmountGetData_(transaction)
    );

    return acc;
  }, {});

  return {
    ca_jour_ttc: roundAmountGetData_(caJourTtc),
    ca_total_ttc: roundAmountGetData_(caJourTtc),
    total_encaisse_ttc: roundAmountGetData_(caJourTtc),
    nb_transactions: safeTransactions.length,
    tickets_count: safeTransactions.length,
    by_payment: byPayment,
    ventes_en_attente_sync: 0,
    total_pending_sync: 0
  };
}

/* ==============================
   Accueil : getHomeData
   ============================== */

function getHomeData_(params) {
  const startedAt = Date.now();
  const today = String(params.today || getTodayIsoGetData_()).slice(0, 10);

  const userId = String(
    params.user_id ||
    params.current_user_id ||
    params.responsable_user_id ||
    ""
  ).trim();

  const selectedType = normalizeKeyGetData_(
    params.selected_type ||
    params.selectedType ||
    params.item_type ||
    ""
  );

  const selectedId = String(
    params.selected_id ||
    params.selectedId ||
    params.item_id ||
    params.event_id ||
    params.evenement_id ||
    params.mission_id ||
    params.inscription_id ||
    ""
  ).trim();

  const tables = loadHomeTablesGetData_();

  const upcomingItems = buildUpcomingItemsGetData_(tables, {
    today,
    userId
  });

  const selectedItem = resolveSelectedItemGetData_(upcomingItems, {
    selectedType,
    selectedId,
    userId
  });

  const selectedContext = getSelectedContextGetData_(selectedItem);

  const active = buildActiveContextGetData_(tables, selectedItem);
  const resume = buildResumeGetData_(tables, active);
  const progress = buildProgressGetData_(selectedItem, active);
  const selectedSummary = buildSelectedSummaryGetData_(selectedItem, active, resume);
  const ui = buildUiStateGetData_(selectedItem, active);
  const nextAction = buildNextActionGetData_(ui);

  const transactionIds = tables.transactions
    .map(function (transaction) {
      return String(transaction.transaction_id || transaction.id || "").trim();
    })
    .filter(Boolean);

  return {
    api_mode: "getHomeData",
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,

    selected_type: selectedContext.type,
    selected_id: selectedContext.id,

    rawCounts: {
      inscriptions: tables.inscriptions.length,
      events: tables.events.length,
      missions: tables.events.length,
      stockMissions: tables.stockMissions.length,
      missionsStock: tables.stockMissions.length,
      journees: tables.journees.length,
      transactions: tables.transactions.length,
      mouvementsStock: tables.mouvementsStock.length
    },

    tables: {
      inscriptions: tables.inscriptions,
      events: tables.events,
      missions: tables.events,
      stockMissions: tables.stockMissions,
      missionsStock: tables.stockMissions,
      journees: tables.journees,
      transactions: active.transactions,
      mouvementsStock: active.mouvementsStock
    },

    upcomingItems,
    selectedItem,
    selectedSummary,
    progress,
    nextAction,
    ui,
    active,
    resume,

    transactionIds,
    transaction_ids: transactionIds,
    transaction_ids_complete: true,
    remote_transaction_index_complete: true,

    watchItems: buildHomeWatchItemsGetData_(tables, selectedItem, active, resume)
  };
}

function loadHomeTablesGetData_() {
  return {
    inscriptions: readOptionalTableGetData_("inscriptions"),
    events: readOptionalTableGetData_("missions"),
    stockMissions: readOptionalTableGetData_("missionsStock"),
    journees: readOptionalTableGetData_("journees"),
    transactions: readOptionalTableGetData_("transactions"),
    mouvementsStock: readOptionalTableGetData_("mouvementsStock")
  };
}

function buildUpcomingItemsGetData_(tables, context) {
  const today = String(context.today || getTodayIsoGetData_()).slice(0, 10);
  const userId = String(context.userId || "").trim();

  const eventIds = new Set(
    tables.events
      .map(getEventIdGetData_)
      .filter(Boolean)
  );

  const missionItems = tables.events
    .filter(function (eventItem) {
      return !isHistoricalEventGetData_(eventItem);
    })
    .filter(function (eventItem) {
      return !isCancelledStatusGetData_(eventItem);
    })
    .filter(function (eventItem) {
      return isUpcomingOrCurrentGetData_(eventItem, today);
    })
    .map(function (eventItem) {
      const eventId = getEventIdGetData_(eventItem);
      const stockMission = findStockMissionForEventGetData_(
        eventId,
        tables.stockMissions, tables.journees
      );

      return {
        ...eventItem,
        id: eventId,
        selected_id: eventId,
        selected_type: "mission",
        item_id: eventId,
        item_type: "mission",
        type: "mission",
        stock_mission_id: stockMission ? getStockMissionIdGetData_(stockMission) : "",
        status_label: stockMission
          ? getStockMissionStatusLabelGetData_(stockMission)
          : "Mission à préparer",
        is_user_related: isItemRelatedToUserGetData_(eventItem, userId)
      };
    });

  const inscriptionItems = tables.inscriptions
    .filter(function (inscription) {
      return !isCancelledStatusGetData_(inscription);
    })
    .filter(function (inscription) {
      return !isAcceptedInscriptionGetData_(inscription);
    })
    .filter(function (inscription) {
      return isUpcomingOrCurrentGetData_(inscription, today);
    })
    .filter(function (inscription) {
      const linkedEventId = String(inscription.evenement_id || "").trim();
      return !linkedEventId || !eventIds.has(linkedEventId);
    })
    .map(function (inscription) {
      const inscriptionId = String(inscription.inscription_id || "").trim();

      return {
        ...inscription,
        id: inscriptionId,
        selected_id: inscriptionId,
        selected_type: "inscription",
        item_id: inscriptionId,
        item_type: "inscription",
        type: "inscription",
        status_label: getInscriptionStatusLabelGetData_(inscription),
        is_user_related: isItemRelatedToUserGetData_(inscription, userId)
      };
    });

  return missionItems
    .concat(inscriptionItems)
    .filter(function (item) {
      return getSelectedItemIdGetData_(item);
    })
    .sort(function (a, b) {
      const byUser =
        Number(Boolean(b.is_user_related)) -
        Number(Boolean(a.is_user_related));

      if (byUser !== 0) return byUser;

      const byDate = String(a.date_debut || a.date || "")
        .localeCompare(String(b.date_debut || b.date || ""));

      if (byDate !== 0) return byDate;

      return getSelectedItemTitleGetData_(a)
        .localeCompare(getSelectedItemTitleGetData_(b), "fr");
    });
}

function resolveSelectedItemGetData_(upcomingItems, selection) {
  const selectedId = String(selection.selectedId || "").trim();
  const selectedType = normalizeKeyGetData_(selection.selectedType || "");

  if (selectedId) {
    const exact = upcomingItems.find(function (item) {
      const itemId = getSelectedItemIdGetData_(item);
      const itemType = getSelectedItemTypeGetData_(item);

      return (
        itemId === selectedId &&
        (!selectedType || itemType === selectedType)
      );
    });

    if (exact) return exact;

    const byId = upcomingItems.find(function (item) {
      return getSelectedItemIdGetData_(item) === selectedId;
    });

    if (byId) return byId;
  }

  const userId = String(selection.userId || "").trim();

  if (userId) {
    const userItem = upcomingItems.find(function (item) {
      return Boolean(item.is_user_related);
    });

    if (userItem) return userItem;
  }

  return upcomingItems[0] || null;
}

function buildActiveContextGetData_(tables, selectedItem) {
  const selectedType = getSelectedItemTypeGetData_(selectedItem);
  const selectedId = getSelectedItemIdGetData_(selectedItem);

  let eventItem = null;
  let stockMission = null;
  let journee = null;

  if (selectedType === "mission" || selectedType === "event" || selectedType === "evenement") {
    eventItem = tables.events.find(function (item) {
      return getEventIdGetData_(item) === selectedId;
    }) || null;

    stockMission = findStockMissionForEventGetData_(
      selectedId,
      tables.stockMissions, tables.journees
    );
  }

  if (selectedType === "stock") {
    stockMission = tables.stockMissions.find(function (item) {
      return getStockMissionIdGetData_(item) === selectedId;
    }) || null;

    if (stockMission) {
      eventItem = tables.events.find(function (item) {
        return getEventIdGetData_(item) === getStockMissionEventIdGetData_(stockMission);
      }) || null;
    }
  }

  if (!eventItem && selectedItem) {
    const eventId = String(
      selectedItem.evenement_id ||
      selectedItem.event_id ||
      selectedItem.mission_id ||
      ""
    ).trim();

    if (eventId) {
      eventItem = tables.events.find(function (item) {
        return getEventIdGetData_(item) === eventId;
      }) || null;
    }
  }

  if (!stockMission && eventItem) {
    stockMission = findStockMissionForEventGetData_(
      getEventIdGetData_(eventItem),
      tables.stockMissions, tables.journees
    );
  }

  if (!stockMission && selectedItem && selectedItem.stock_mission_id) {
    stockMission = tables.stockMissions.find(function (item) {
      return getStockMissionIdGetData_(item) === String(selectedItem.stock_mission_id || "").trim();
    }) || null;
  }

  const linkedDays = stockMission
    ? getMissionJourneesGetData_(stockMission, tables.journees)
    : [];

  journee =
    linkedDays.find(function (day) {
      return !isClosedStatusGetData_(day) && !isCancelledStatusGetData_(day);
    }) ||
    linkedDays[0] ||
    null;

  const dayId = journee ? String(journee.journee_id || "").trim() : "";
  const stockMissionId = stockMission ? getStockMissionIdGetData_(stockMission) : "";

  const transactions = dayId
    ? tables.transactions.filter(function (transaction) {
        return (
          String(transaction.journee_id || "").trim() === dayId &&
          !isCancelledStatusGetData_(transaction)
        );
      })
    : [];

  const mouvementsStock = stockMissionId
    ? tables.mouvementsStock.filter(function (movement) {
        return (
          getMovementMissionIdGetData_(movement) === stockMissionId ||
          String(movement.journee_id || "").trim() === dayId
        );
      })
    : [];

  return {
    selectedItem,
    event: eventItem,
    eventItem,
    missionVente: eventItem,
    mission_vente: eventItem,
    mission: stockMission,
    stockMission,
    stock_mission: stockMission,
    journee,
    activeJournee: journee,
    active_journee: journee,
    linkedDays,
    linked_days: linkedDays,
    transactions,
    mouvementsStock,
    mouvements_stock: mouvementsStock
  };
}

function buildResumeGetData_(tables, active) {
  const transactions = Array.isArray(active.transactions)
    ? active.transactions
    : [];

  const caJourTtc = transactions.reduce(function (sum, transaction) {
    return sum + getTransactionAmountGetData_(transaction);
  }, 0);

  return {
    ca_jour_ttc: roundAmountGetData_(caJourTtc),
    nb_transactions: transactions.length,
    ventes_en_attente_sync: 0,
    total_pending_sync: 0
  };
}

function buildProgressGetData_(selectedItem, active) {
  const selectedType = getSelectedItemTypeGetData_(selectedItem);
  const hasEvent = Boolean(active.event);
  const hasStockMission = Boolean(active.stockMission);
  const hasJournee = Boolean(active.journee);
  const stockPrepared = hasStockMission && isStockPreparedGetData_(active.stockMission, active.mouvementsStock);

  const journeeClosed = hasJournee && isClosedStatusGetData_(active.journee);

  if (selectedType === "inscription") {
    return [
      buildProgressRowGetData_("inscriptions", "active"),
      buildProgressRowGetData_("missions", "upcoming"),
      buildProgressRowGetData_("stock", "upcoming"),
      buildProgressRowGetData_("vente", "upcoming"),
      buildProgressRowGetData_("cloture", "upcoming")
    ];
  }

  if (journeeClosed) {
    return [
      buildProgressRowGetData_("inscriptions", "done"),
      buildProgressRowGetData_("missions", "done"),
      buildProgressRowGetData_("stock", "done"),
      buildProgressRowGetData_("vente", "done"),
      buildProgressRowGetData_("cloture", "active")
    ];
  }

  if (stockPrepared && hasJournee) {
    return [
      buildProgressRowGetData_("inscriptions", "done"),
      buildProgressRowGetData_("missions", "done"),
      buildProgressRowGetData_("stock", "done"),
      buildProgressRowGetData_("vente", "active"),
      buildProgressRowGetData_("cloture", "upcoming")
    ];
  }

  if (hasStockMission) {
    return [
      buildProgressRowGetData_("inscriptions", "done"),
      buildProgressRowGetData_("missions", "done"),
      buildProgressRowGetData_("stock", "active"),
      buildProgressRowGetData_("vente", "upcoming"),
      buildProgressRowGetData_("cloture", "upcoming")
    ];
  }

  if (hasEvent) {
    return [
      buildProgressRowGetData_("inscriptions", "done"),
      buildProgressRowGetData_("missions", "active"),
      buildProgressRowGetData_("stock", "upcoming"),
      buildProgressRowGetData_("vente", "upcoming"),
      buildProgressRowGetData_("cloture", "upcoming")
    ];
  }

  return [
    buildProgressRowGetData_("inscriptions", "active"),
    buildProgressRowGetData_("missions", "upcoming"),
    buildProgressRowGetData_("stock", "upcoming"),
    buildProgressRowGetData_("vente", "upcoming"),
    buildProgressRowGetData_("cloture", "upcoming")
  ];
}

function buildProgressRowGetData_(step, status) {
  return {
    step,
    status
  };
}

function buildSelectedSummaryGetData_(selectedItem, active, resume) {
  const selectedType = getSelectedItemTypeGetData_(selectedItem);

  if (!selectedItem) {
    return {
      statOneLabel: "Inscriptions",
      statOneValue: "—",
      statTwoLabel: "Évènements",
      statTwoValue: "—",
      statThreeLabel: "À synchro",
      statThreeValue: "0"
    };
  }

  if (selectedType === "inscription") {
    return {
      statOneLabel: "Dossier",
      statOneValue: getInscriptionStatusLabelGetData_(selectedItem),
      statTwoLabel: "Date",
      statTwoValue: formatShortDateGetData_(selectedItem.date_debut || selectedItem.date || ""),
      statThreeLabel: "À synchro",
      statThreeValue: "0"
    };
  }

  const stockMission = active.stockMission;
  const stockPrepared = stockMission && isStockPreparedGetData_(stockMission, active.mouvementsStock);

  if (stockMission && !stockPrepared) {
    return {
      statOneLabel: "Journées",
      statOneValue: String(active.linkedDays.length || 1),
      statTwoLabel: "Stock",
      statTwoValue: "À faire",
      statThreeLabel: "À synchro",
      statThreeValue: "0"
    };
  }

  if (active.journee) {
    return {
      statOneLabel: "CA jour",
      statOneValue: formatCurrencyGetData_(resume.ca_jour_ttc || 0),
      statTwoLabel: "Tickets",
      statTwoValue: String(resume.nb_transactions || 0),
      statThreeLabel: "À synchro",
      statThreeValue: "0"
    };
  }

  return {
    statOneLabel: "Journées",
    statOneValue: String(active.linkedDays.length || 0),
    statTwoLabel: "Mission",
    statTwoValue: stockMission ? "À préparer" : "À créer",
    statThreeLabel: "À synchro",
    statThreeValue: "0"
  };
}

function buildUiStateGetData_(selectedItem, active) {
  const selectedType = getSelectedItemTypeGetData_(selectedItem);

  if (selectedItem && selectedType === "inscription") {
    return {
      code: "event_planning",
      step: "inscriptions",
      label: getInscriptionStatusLabelGetData_(selectedItem),
      title: getSelectedItemTitleGetData_(selectedItem),
      meta: buildMetaGetData_(selectedItem),
      primaryText: "Gérer l’inscription",
      primary_text: "Gérer l’inscription",
      primaryHref: "./inscriptions-evenements.html",
      primary_href: "./inscriptions-evenements.html",
      secondaryText: "Préparation mission",
      secondary_text: "Préparation mission",
      secondaryHref: "./missions.html",
      secondary_href: "./missions.html"
    };
  }

  if (selectedItem && !active.stockMission) {
    return {
      code: "mission_to_prepare",
      step: "missions",
      label: "Mission à préparer",
      title: getSelectedItemTitleGetData_(active.event || selectedItem),
      meta: buildMetaGetData_(active.event || selectedItem),
      primaryText: "Préparation mission",
      primary_text: "Préparation mission",
      primaryHref: "./missions.html",
      primary_href: "./missions.html",
      secondaryText: "Voir les inscriptions",
      secondary_text: "Voir les inscriptions",
      secondaryHref: "./inscriptions-evenements.html",
      secondary_href: "./inscriptions-evenements.html"
    };
  }

  if (!active.stockMission || !active.journee) {
    return {
      code: "no_mission",
      step: "inscriptions",
      label: "Aucune mission active",
      title: "Commencer par les inscriptions",
      meta: "Crée ou valide un évènement, puis prépare une mission de stock.",
      primaryText: "Gérer les inscriptions",
      primary_text: "Gérer les inscriptions",
      primaryHref: "./inscriptions-evenements.html",
      primary_href: "./inscriptions-evenements.html",
      secondaryText: "Préparation mission",
      secondary_text: "Préparation mission",
      secondaryHref: "./missions.html",
      secondary_href: "./missions.html"
    };
  }

  const stockPrepared = isStockPreparedGetData_(
    active.stockMission,
    active.mouvementsStock
  );

  if (!stockPrepared) {
    return {
      code: "stock_to_prepare",
      step: "stock",
      label: "Stock à préparer",
      title: active.stockMission.nom || getSelectedItemTitleGetData_(selectedItem),
      meta: buildMissionStockMetaGetData_(active.stockMission, active.linkedDays),
      primaryText: "Préparer le stock",
      primary_text: "Préparer le stock",
      primaryHref: "./preparation-stock.html",
      primary_href: "./preparation-stock.html",
      secondaryText: "Préparation mission",
      secondary_text: "Préparation mission",
      secondaryHref: "./missions.html",
      secondary_href: "./missions.html"
    };
  }

  if (isClosedStatusGetData_(active.journee)) {
    return {
      code: "closed",
      step: "cloture",
      label: "Journée clôturée",
      title: getDayTitleGetData_(active),
      meta: buildDayMetaGetData_(active),
      primaryText: "Voir le dashboard",
      primary_text: "Voir le dashboard",
      primaryHref: "./dashboard.html",
      primary_href: "./dashboard.html",
      secondaryText: "Préparation mission",
      secondary_text: "Préparation mission",
      secondaryHref: "./missions.html",
      secondary_href: "./missions.html"
    };
  }

  return {
    code: "selling",
    step: "vente",
    label: normalizeStatusGetData_(active.journee.statut) === "en_cours"
      ? "Journée en cours"
      : "Stock prêt",
    title: getDayTitleGetData_(active),
    meta: buildDayMetaGetData_(active),
    primaryText: "+ Nouvelle vente",
    primary_text: "+ Nouvelle vente",
    primaryHref: "./vente-rapide.html",
    primary_href: "./vente-rapide.html",
    secondaryText: "Clôturer la journée",
    secondary_text: "Clôturer la journée",
    secondaryHref: "./cloture.html",
    secondary_href: "./cloture.html"
  };
}

function buildNextActionGetData_(ui) {
  return {
    label: ui.primaryText || ui.primary_text || "Continuer",
    href: ui.primaryHref || ui.primary_href || "./index.html"
  };
}

function buildHomeWatchItemsGetData_(tables, selectedItem, active, resume) {
  const items = [];

  items.push("Source active confirmée : API en ligne.");

  if (selectedItem) {
    items.push(`Évènement sélectionné : ${getSelectedItemTitleGetData_(selectedItem)}.`);
  }

  items.push(
    `Brut Sheets : ${tables.inscriptions.length} inscription(s), ${tables.events.length} évènement(s), ${tables.stockMissions.length} mission(s) stock, ${tables.journees.length} journée(s), ${tables.mouvementsStock.length} mouvement(s) stock.`
  );

  if (active.stockMission) {
    items.push(
      `${active.linkedDays.length || 1} journée(s) liée(s) à la mission “${active.stockMission.nom || "Mission"}”.`
    );
  }

  if (active.journee) {
    items.push(
      `CA journée détecté : ${formatCurrencyGetData_(resume.ca_jour_ttc || 0)} pour ${resume.nb_transactions || 0} ticket(s).`
    );
  }

  return items;
}

/* ==============================
   Recettes : getRecettesData(view)
   ============================== */

function getRecettesData_(params) {
  const startedAt = Date.now();
  const view = normalizeKeyGetData_(params.view || params.vue || "dashboard") || "dashboard";

  const viewTables = getRecettesViewTablesGetData_(view);
  const tables = {};

  viewTables.forEach(function (tableKey) {
    tables[tableKey] = readOptionalTableGetData_(tableKey);
  });

  return {
    api_mode: "getRecettesData",
    view,
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    tables,
    counts: Object.keys(tables).reduce(function (acc, key) {
      acc[key] = Array.isArray(tables[key]) ? tables[key].length : 0;
      return acc;
    }, {})
  };
}

function getRecettesViewTablesGetData_(view) {
  switch (view) {
    case "historique":
      return [
        "recettes",
        "recettesIngredients",
        "ingredients",
        "cuvees",
        "cuveesIngredientsReels"
      ];

    case "production":
      return [
        "recettes",
        "recettesIngredients",
        "ingredients",
        "cuvees",
        "cuveesIngredientsReels",
        "matieresPremieres",
        "matieresLots"
      ];

    case "matieres":
      return [
        "ingredients",
        "matieresPremieres",
        "matieresLots",
        "mouvementsMatieres",
        "cuveesMatieresConsommees"
      ];

    case "dashboard":
    default:
      return [
        "recettes",
        "recettesIngredients",
        "ingredients",
        "cuvees",
        "matieresPremieres",
        "matieresLots"
      ];
  }
}

/* ==============================
   Helpers lecture
   ============================== */

function readOptionalTableGetData_(tableKeyOrSheetName) {
  try {
    return readSheetRows_(tableKeyOrSheetName);
  } catch (error) {
    return [];
  }
}

function getSelectedContextGetData_(item) {
  if (!item) {
    return {
      type: "",
      id: ""
    };
  }

  return {
    type: getSelectedItemTypeGetData_(item),
    id: getSelectedItemIdGetData_(item)
  };
}

function getSelectedItemIdGetData_(item) {
  return String(
    item &&
    (
      item.selected_id ||
      item.item_id ||
      item.id ||
      item.mission_id ||
      item.evenement_id ||
      item.inscription_id ||
      ""
    )
  ).trim();
}

function getSelectedItemTypeGetData_(item) {
  return normalizeKeyGetData_(
    item &&
    (
      item.selected_type ||
      item.item_type ||
      item.type ||
      inferTypeFromIdGetData_(getSelectedItemIdGetData_(item))
    )
  );
}

function inferTypeFromIdGetData_(id) {
  const value = String(id || "").trim().toUpperCase();

  if (value.startsWith("INS_")) return "inscription";
  if (value.startsWith("EVT_")) return "mission";
  if (value.startsWith("MIS_")) return "mission";
  if (value.startsWith("MST_")) return "stock";

  return "";
}

function getSelectedItemTitleGetData_(item) {
  return String(
    item &&
    (
      item.nom ||
      item.title ||
      item.label ||
      item.name ||
      "Évènement"
    )
  ).trim();
}

function getEventIdGetData_(eventItem) {
  return String(
    eventItem &&
    (
      eventItem.mission_id ||
      eventItem.evenement_id ||
      eventItem.event_id ||
      ""
    )
  ).trim();
}

function getStockMissionIdGetData_(mission) {
  return String(
    mission &&
    (
      mission.mission_id ||
      mission.stock_mission_id ||
      mission.mission_stock_id ||
      ""
    )
  ).trim();
}

function getStockMissionEventIdGetData_(mission) {
  return String(
    mission &&
    (
      mission.evenement_id ||
      mission.event_id ||
      mission.mission_vente_id ||
      ""
    )
  ).trim();
}

function findStockMissionForEventGetData_(eventId, stockMissions, journees) {
  const id = String(eventId || "").trim();
  if (!id) return null;

  const candidates = (stockMissions || []).filter(function (mission) {
    return !isCancelledStatusGetData_(mission);
  });
  const linkedStockIds = (journees || [])
    .filter(function (day) {
      return (
        String(day.mission_id || day.evenement_id || "").trim() === id &&
        !isCancelledStatusGetData_(day)
      );
    })
    .map(function (day) {
      return String(day.stock_mission_id || day.mission_stock_id || "").trim();
    })
    .filter(Boolean);

  // La relation journees_vente.stock_mission_id prime sur l'ordre des lignes Sheets.
  return (
    candidates.find(function (mission) {
      return linkedStockIds.indexOf(getStockMissionIdGetData_(mission)) >= 0;
    }) ||
    candidates.find(function (mission) {
      return getStockMissionIdGetData_(mission) === id;
    }) ||
    candidates.find(function (mission) {
      return getStockMissionEventIdGetData_(mission) === id;
    }) ||
    null
  );
}

function getMissionJourneesGetData_(mission, journees) {
  const stockMissionId = getStockMissionIdGetData_(mission);
  const eventId = getStockMissionEventIdGetData_(mission);

  return journees
    .filter(function (journee) {
      return !isHistoricalDayGetData_(journee);
    })
    .filter(function (journee) {
      return !isCancelledStatusGetData_(journee);
    })
    .filter(function (journee) {
      return (
        String(journee.stock_mission_id || "").trim() === stockMissionId ||
        String(journee.mission_stock_id || "").trim() === stockMissionId ||
        String(journee.mission_id || "").trim() === stockMissionId ||
        String(journee.evenement_id || "").trim() === stockMissionId ||
        Boolean(eventId && String(journee.mission_id || "").trim() === eventId) ||
        Boolean(eventId && String(journee.evenement_id || "").trim() === eventId)
      );
    })
    .sort(function (a, b) {
      return String(a.date || "").localeCompare(String(b.date || ""));
    });
}

function getMovementMissionIdGetData_(movement) {
  return String(
    movement &&
    (
      movement.stock_mission_id ||
      movement.mission_stock_id ||
      movement.mission_id ||
      ""
    )
  ).trim();
}

function getMovementTypeGetData_(movement) {
  return normalizeStatusGetData_(
    movement &&
    (
      movement.type_mouvement ||
      movement.mouvement_type ||
      movement.type ||
      movement.categorie ||
      ""
    )
  );
}

function getMovementQuantityGetData_(movement) {
  return toNumberGetData_(
    movement &&
    (
      movement.quantite ||
      movement.quantity ||
      movement.qty ||
      0
    ),
    0
  );
}

function isInitialStockMovementGetData_(movement) {
  const type = getMovementTypeGetData_(movement);

  if (!type || isCancelledStatusGetData_(movement)) return false;

  const acceptedTypes = [
    "preparation",
    "preparation_initiale",
    "preparation_stock",
    "stock_initial",
    "initial_stock",
    "entree_initiale"
  ];

  return (
    acceptedTypes.indexOf(type) >= 0 ||
    Boolean(type.indexOf("preparation") >= 0 && type.indexOf("initial") >= 0)
  );
}

function isStockPreparedGetData_(mission, mouvementsStock) {
  if (!mission) return false;

  if (toBooleanGetData_(mission.stock_prepare, false)) return true;

  const statut = normalizeStatusGetData_(mission.statut);

  if (
    [
      "pret",
      "prêt",
      "en_cours",
      "termine",
      "terminee",
      "termine",
      "terminé",
      "terminée",
      "cloture",
      "cloturee",
      "clôture",
      "clôturée"
    ].indexOf(statut) >= 0
  ) {
    return true;
  }

  const missionIds = [
    getStockMissionIdGetData_(mission),
    getStockMissionEventIdGetData_(mission)
  ].filter(Boolean);

  return mouvementsStock.some(function (movement) {
    if (!isInitialStockMovementGetData_(movement)) return false;

    if (missionIds.indexOf(getMovementMissionIdGetData_(movement)) < 0) {
      return false;
    }

    return getMovementQuantityGetData_(movement) !== 0;
  });
}

function getTransactionAmountGetData_(transaction) {
  return toNumberGetData_(
    transaction.total_encaisse_ttc ??
      transaction.total_encaisse ??
      transaction.total_catalogue_ttc ??
      transaction.total_catalogue,
    0
  );
}

function getInscriptionStatusLabelGetData_(item) {
  if (isAcceptedInscriptionGetData_(item)) return "Acceptée";

  const statut = normalizeStatusGetData_(item && item.statut);

  if (statut.indexOf("attente") >= 0) return "En attente";
  if (statut.indexOf("relancer") >= 0) return "À relancer";
  if (statut.indexOf("envoyer") >= 0) return "Dossier à envoyer";
  if (statut.indexOf("envoye") >= 0 || statut.indexOf("envoyé") >= 0) return "Dossier envoyé";

  return "Dossier";
}

function getStockMissionStatusLabelGetData_(mission) {
  const statut = normalizeStatusGetData_(mission && mission.statut);

  if (isClosedStatusGetData_(mission)) return "Clôturé";
  if (isStockPreparedGetData_(mission, [])) return "Stock prêt";
  if (statut === "stock_a_preparer") return "Stock à préparer";
  if (statut === "en_cours") return "En cours";
  if (statut === "pret" || statut === "prêt") return "Stock prêt";

  return "Mission stock";
}

function isAcceptedInscriptionGetData_(item) {
  if (!item || isCancelledStatusGetData_(item)) return false;

  const statut = normalizeStatusGetData_(item.statut);

  return (
    statut === "accepte" ||
    statut === "acceptee" ||
    statut === "accepté" ||
    statut === "acceptée" ||
    toBooleanGetData_(item.acceptation, false)
  );
}

function isCancelledStatusGetData_(item) {
  const statut = normalizeStatusGetData_(
    item &&
    (
      item.statut ||
      item.paiement_statut ||
      item.status ||
      ""
    )
  );

  return [
    "annule",
    "annulee",
    "annulé",
    "annulée",
    "refuse",
    "refusee",
    "refusé",
    "refusée"
  ].indexOf(statut) >= 0;
}

function isClosedStatusGetData_(item) {
  const statut = normalizeStatusGetData_(item && item.statut);

  return [
    "cloture",
    "cloturee",
    "clôture",
    "clôturée",
    "termine",
    "terminee",
    "terminé",
    "terminée"
  ].indexOf(statut) >= 0;
}

function isHistoricalSourceGetData_(item) {
  return String(item && item.source || "")
    .trim()
    .toUpperCase() === "SAISIE_HISTORIQUE";
}

function isHistoricalEventGetData_(eventItem) {
  const eventId = getEventIdGetData_(eventItem);

  return (
    isHistoricalSourceGetData_(eventItem) ||
    eventId.indexOf("EVT_HIST_") === 0
  );
}

function isHistoricalDayGetData_(journee) {
  const journeeId = String(journee && journee.journee_id || "").trim();
  const eventId = String(journee && (journee.evenement_id || journee.mission_id) || "").trim();
  const stockMissionId = String(journee && (journee.stock_mission_id || journee.mission_stock_id) || "").trim();

  return (
    isHistoricalSourceGetData_(journee) ||
    journeeId.indexOf("J_HIST_") === 0 ||
    eventId.indexOf("EVT_HIST_") === 0 ||
    stockMissionId.indexOf("MST_HIST_") === 0
  );
}

function isUpcomingOrCurrentGetData_(item, today) {
  const end = String(
    item &&
    (
      item.date_fin ||
      item.date_debut ||
      item.date ||
      ""
    )
  ).slice(0, 10);

  if (!end) return true;

  return end >= String(today || getTodayIsoGetData_()).slice(0, 10);
}

function isItemRelatedToUserGetData_(item, userId) {
  const safeUserId = String(userId || "").trim();

  if (!safeUserId) return false;

  if (String(item.responsable_user_id || "").trim() === safeUserId) {
    return true;
  }

  const vendeursPrevus = String(item.vendeurs_prevus || "").trim();

  if (vendeursPrevus.indexOf(safeUserId) >= 0) {
    return true;
  }

  const vendeurId = String(item.user_id || item.vendeur_user_id || "").trim();

  return vendeurId === safeUserId;
}

function buildMetaGetData_(item) {
  const parts = [
    getDateLabelGetData_(item),
    String(item && (item.ville || item.city || "") || "").trim()
  ].filter(Boolean);

  return parts.join(" · ");
}

function buildMissionStockMetaGetData_(mission, linkedDays) {
  const daysCount = Array.isArray(linkedDays) ? linkedDays.length : 0;

  return [
    getDateLabelGetData_(mission),
    `${daysCount || 1} journée(s) liée(s)`
  ].filter(Boolean).join(" · ");
}

function buildDayMetaGetData_(active) {
  const missionName =
    active.stockMission && active.stockMission.nom
      ? active.stockMission.nom
      : "Mission";

  const dayDate =
    active.journee && active.journee.date
      ? formatDisplayDateGetData_(active.journee.date)
      : "";

  return [missionName, dayDate].filter(Boolean).join(" · ");
}

function getDayTitleGetData_(active) {
  if (!active.journee) return "Journée";

  const eventName =
    active.event && active.event.nom
      ? active.event.nom
      : active.stockMission && active.stockMission.nom
        ? active.stockMission.nom
        : "Journée";

  const label = String(active.journee.jour_label || "").trim();

  return label
    ? `${eventName} — ${label}`
    : eventName;
}

function getDateLabelGetData_(item) {
  if (!item) return "";

  const start = String(item.date_debut || item.date || "").slice(0, 10);
  const end = String(item.date_fin || start || "").slice(0, 10);

  if (!start) return "";

  if (!end || start === end) {
    return formatDisplayDateGetData_(start);
  }

  return `${formatDisplayDateGetData_(start)} → ${formatDisplayDateGetData_(end)}`;
}

function formatDisplayDateGetData_(isoDate) {
  const value = String(isoDate || "").slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "date inconnue";
  }

  const parts = value.split("-");
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));

  return Utilities.formatDate(
    date,
    getTimezoneGetData_(),
    "dd/MM/yyyy"
  );
}

function formatShortDateGetData_(isoDate) {
  const value = String(isoDate || "").slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "—";
  }

  const parts = value.split("-");

  return `${parts[2]}/${parts[1]}`;
}

function formatCurrencyGetData_(value) {
  const amount = roundAmountGetData_(value);

  return `${String(amount).replace(".", ",")} €`;
}

function roundAmountGetData_(value) {
  return Math.round((toNumberGetData_(value, 0) + Number.EPSILON) * 100) / 100;
}

function toNumberGetData_(value, fallback) {
  if (typeof value === "number" && isFinite(value)) return value;

  const normalized = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");

  if (!normalized) return fallback;

  const number = Number(normalized);

  return isFinite(number) ? number : fallback;
}

function toBooleanGetData_(value, fallback) {
  if (value === true) return true;
  if (value === false) return false;

  if (typeof value === "number") return value !== 0;

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!normalized) return fallback;

  if (
    [
      "true",
      "vrai",
      "oui",
      "yes",
      "1",
      "x",
      "actif"
    ].indexOf(normalized) >= 0
  ) {
    return true;
  }

  if (
    [
      "false",
      "faux",
      "non",
      "no",
      "0",
      "inactif"
    ].indexOf(normalized) >= 0
  ) {
    return false;
  }

  return fallback;
}

function normalizeStatusGetData_(value) {
  return normalizeKeyGetData_(value);
}

function normalizeKeyGetData_(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-\s]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function getTodayIsoGetData_() {
  return Utilities.formatDate(
    new Date(),
    getTimezoneGetData_(),
    "yyyy-MM-dd"
  );
}

function getTimezoneGetData_() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  } catch {
    return Session.getScriptTimeZone() || "Europe/Paris";
  }
}