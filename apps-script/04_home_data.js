/*
  04_home_data.gs

  Données optimisées pour l’accueil Lugdurum.

  Responsabilités :
  - construire le sélecteur d’évènements à venir ;
  - choisir l’évènement affiché par défaut ;
  - calculer le résumé accueil ;
  - calculer la progression métier :
    inscription → mission → stock → vente → clôture ;
  - éviter de charger toute la base côté frontend quand ce n’est pas nécessaire.

  Dépendances attendues :
  - 00_config.gs :
    SHEETS
  - 02_sheets_core.gs :
    readSheetRows_()
*/

/* ==============================
   Entrée principale
   ============================== */

function getHomeData_(params) {
  const startedAt = Date.now();

  const safeParams = params || {};
  const today = String(safeParams.today || getTodayIsoHomeData_()).slice(0, 10);

  const userId = String(
    safeParams.user_id ||
    safeParams.current_user_id ||
    safeParams.responsable_user_id ||
    ""
  ).trim();

  const selectedType = normalizeKeyHomeData_(
    safeParams.selected_type ||
    safeParams.selectedType ||
    safeParams.item_type ||
    ""
  );

  const selectedId = String(
    safeParams.selected_id ||
    safeParams.selectedId ||
    safeParams.item_id ||
    safeParams.event_id ||
    safeParams.evenement_id ||
    safeParams.mission_id ||
    safeParams.inscription_id ||
    ""
  ).trim();

  const tables = loadHomeTablesHomeData_();

  const upcomingItems = buildUpcomingItemsHomeData_(tables, {
    today,
    userId
  });

  const selectedItem = resolveSelectedItemHomeData_(upcomingItems, {
    selectedType,
    selectedId,
    userId
  });

  const selectedContext = getSelectedContextHomeData_(selectedItem);
  const active = buildActiveContextHomeData_(tables, selectedItem);
  const resume = buildResumeHomeData_(active);
  const progress = buildProgressHomeData_(selectedItem, active);
  const selectedSummary = buildSelectedSummaryHomeData_(selectedItem, active, resume);
  const ui = buildUiStateHomeData_(selectedItem, active);
  const nextAction = buildNextActionHomeData_(ui);

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

      // Pour l’accueil, on renvoie surtout les données utiles au contexte actif.
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

    watchItems: buildHomeWatchItemsHomeData_(tables, selectedItem, active, resume)
  };
}

/* ==============================
   Chargement tables
   ============================== */

function loadHomeTablesHomeData_() {
  return {
    inscriptions: readOptionalHomeTableHomeData_("inscriptions"),
    events: readOptionalHomeTableHomeData_("missions"),
    stockMissions: readOptionalHomeTableHomeData_("missionsStock"),
    journees: readOptionalHomeTableHomeData_("journees"),
    transactions: readOptionalHomeTableHomeData_("transactions"),
    mouvementsStock: readOptionalHomeTableHomeData_("mouvementsStock")
  };
}

function readOptionalHomeTableHomeData_(tableKeyOrSheetName) {
  try {
    return readSheetRows_(tableKeyOrSheetName);
  } catch (error) {
    return [];
  }
}

/* ==============================
   Sélecteur évènements à venir
   ============================== */

function buildUpcomingItemsHomeData_(tables, context) {
  const today = String(context.today || getTodayIsoHomeData_()).slice(0, 10);
  const userId = String(context.userId || "").trim();

  const eventIds = new Set(
    tables.events
      .map(getEventIdHomeData_)
      .filter(Boolean)
  );

  const missionItems = tables.events
    .filter(function (eventItem) {
      return !isHistoricalEventHomeData_(eventItem);
    })
    .filter(function (eventItem) {
      return !isCancelledStatusHomeData_(eventItem);
    })
    .filter(function (eventItem) {
      return isUpcomingOrCurrentHomeData_(eventItem, today);
    })
    .map(function (eventItem) {
      const eventId = getEventIdHomeData_(eventItem);
      const stockMission = findStockMissionForEventHomeData_(
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
        stock_mission_id: stockMission ? getStockMissionIdHomeData_(stockMission) : "",
        status_label: stockMission
          ? getStockMissionStatusLabelHomeData_(stockMission)
          : "Mission à préparer",
        is_user_related: isItemRelatedToUserHomeData_(eventItem, userId)
      };
    });

  const inscriptionItems = tables.inscriptions
    .filter(function (inscription) {
      return !isCancelledStatusHomeData_(inscription);
    })
    .filter(function (inscription) {
      return !isAcceptedInscriptionHomeData_(inscription);
    })
    .filter(function (inscription) {
      return isUpcomingOrCurrentHomeData_(inscription, today);
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
        status_label: getInscriptionStatusLabelHomeData_(inscription),
        is_user_related: isItemRelatedToUserHomeData_(inscription, userId)
      };
    });

  return missionItems
    .concat(inscriptionItems)
    .filter(function (item) {
      return getSelectedItemIdHomeData_(item);
    })
    .sort(function (a, b) {
      const byUser =
        Number(Boolean(b.is_user_related)) -
        Number(Boolean(a.is_user_related));

      if (byUser !== 0) return byUser;

      const byDate = String(a.date_debut || a.date || "")
        .localeCompare(String(b.date_debut || b.date || ""));

      if (byDate !== 0) return byDate;

      return getSelectedItemTitleHomeData_(a)
        .localeCompare(getSelectedItemTitleHomeData_(b), "fr");
    });
}

function resolveSelectedItemHomeData_(upcomingItems, selection) {
  const selectedId = String(selection.selectedId || "").trim();
  const selectedType = normalizeKeyHomeData_(selection.selectedType || "");
  const userId = String(selection.userId || "").trim();

  if (selectedId) {
    const exact = upcomingItems.find(function (item) {
      const itemId = getSelectedItemIdHomeData_(item);
      const itemType = getSelectedItemTypeHomeData_(item);

      return (
        itemId === selectedId &&
        (!selectedType || itemType === selectedType)
      );
    });

    if (exact) return exact;

    const byId = upcomingItems.find(function (item) {
      return getSelectedItemIdHomeData_(item) === selectedId;
    });

    if (byId) return byId;
  }

  if (userId) {
    const userItem = upcomingItems.find(function (item) {
      return Boolean(item.is_user_related);
    });

    if (userItem) return userItem;
  }

  return upcomingItems[0] || null;
}

function getSelectedContextHomeData_(item) {
  if (!item) {
    return {
      type: "",
      id: ""
    };
  }

  return {
    type: getSelectedItemTypeHomeData_(item),
    id: getSelectedItemIdHomeData_(item)
  };
}

/* ==============================
   Contexte actif
   ============================== */

function buildActiveContextHomeData_(tables, selectedItem) {
  const selectedType = getSelectedItemTypeHomeData_(selectedItem);
  const selectedId = getSelectedItemIdHomeData_(selectedItem);

  let eventItem = null;
  let stockMission = null;
  let journee = null;

  if (
    selectedType === "mission" ||
    selectedType === "event" ||
    selectedType === "evenement"
  ) {
    eventItem = tables.events.find(function (item) {
      return getEventIdHomeData_(item) === selectedId;
    }) || null;

    stockMission = findStockMissionForEventHomeData_(
      selectedId,
      tables.stockMissions, tables.journees
    );
  }

  if (selectedType === "stock") {
    stockMission = tables.stockMissions.find(function (item) {
      return getStockMissionIdHomeData_(item) === selectedId;
    }) || null;

    if (stockMission) {
      eventItem = tables.events.find(function (item) {
        return getEventIdHomeData_(item) === getStockMissionEventIdHomeData_(stockMission);
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
        return getEventIdHomeData_(item) === eventId;
      }) || null;
    }
  }

  if (!stockMission && eventItem) {
    stockMission = findStockMissionForEventHomeData_(
      getEventIdHomeData_(eventItem),
      tables.stockMissions, tables.journees
    );
  }

  if (!stockMission && selectedItem && selectedItem.stock_mission_id) {
    stockMission = tables.stockMissions.find(function (item) {
      return getStockMissionIdHomeData_(item) === String(selectedItem.stock_mission_id || "").trim();
    }) || null;
  }

  const linkedDays = stockMission
    ? getMissionJourneesHomeData_(stockMission, tables.journees)
    : [];

  journee =
    linkedDays.find(function (day) {
      return !isClosedStatusHomeData_(day) && !isCancelledStatusHomeData_(day);
    }) ||
    linkedDays[0] ||
    null;

  const dayId = journee ? String(journee.journee_id || "").trim() : "";
  const stockMissionId = stockMission ? getStockMissionIdHomeData_(stockMission) : "";

  const transactions = dayId
    ? tables.transactions.filter(function (transaction) {
        return (
          String(transaction.journee_id || "").trim() === dayId &&
          !isCancelledStatusHomeData_(transaction)
        );
      })
    : [];

  const mouvementsStock = stockMissionId
    ? tables.mouvementsStock.filter(function (movement) {
        return (
          getMovementMissionIdHomeData_(movement) === stockMissionId ||
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
    currentTransactions: transactions,
    dayTransactions: transactions,
    transactions_jour: transactions,

    mouvementsStock,
    mouvements_stock: mouvementsStock
  };
}

/* ==============================
   Résumé / stats accueil
   ============================== */

function buildResumeHomeData_(active) {
  const transactions = Array.isArray(active.transactions)
    ? active.transactions
    : [];

  const caJourTtc = transactions.reduce(function (sum, transaction) {
    return sum + getTransactionAmountHomeData_(transaction);
  }, 0);

  return {
    ca_jour_ttc: roundAmountHomeData_(caJourTtc),
    nb_transactions: transactions.length,
    ventes_en_attente_sync: 0,
    total_pending_sync: 0
  };
}

function buildSelectedSummaryHomeData_(selectedItem, active, resume) {
  const selectedType = getSelectedItemTypeHomeData_(selectedItem);

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
      statOneValue: getInscriptionStatusLabelHomeData_(selectedItem),
      statTwoLabel: "Date",
      statTwoValue: formatShortDateHomeData_(selectedItem.date_debut || selectedItem.date || ""),
      statThreeLabel: "À synchro",
      statThreeValue: "0"
    };
  }

  const stockMission = active.stockMission;
  const stockPrepared = stockMission && isStockPreparedHomeData_(
    stockMission,
    active.mouvementsStock
  );

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
      statOneValue: formatCurrencyHomeData_(resume.ca_jour_ttc || 0),
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

/* ==============================
   Progression métier
   ============================== */

function buildProgressHomeData_(selectedItem, active) {
  const selectedType = getSelectedItemTypeHomeData_(selectedItem);
  const hasEvent = Boolean(active.event);
  const hasStockMission = Boolean(active.stockMission);
  const hasJournee = Boolean(active.journee);
  const stockPrepared = hasStockMission && isStockPreparedHomeData_(
    active.stockMission,
    active.mouvementsStock
  );

  const journeeClosed = hasJournee && isClosedStatusHomeData_(active.journee);

  if (selectedType === "inscription") {
    return [
      buildProgressRowHomeData_("inscriptions", "active"),
      buildProgressRowHomeData_("missions", "upcoming"),
      buildProgressRowHomeData_("stock", "upcoming"),
      buildProgressRowHomeData_("vente", "upcoming"),
      buildProgressRowHomeData_("cloture", "upcoming")
    ];
  }

  if (journeeClosed) {
    return [
      buildProgressRowHomeData_("inscriptions", "done"),
      buildProgressRowHomeData_("missions", "done"),
      buildProgressRowHomeData_("stock", "done"),
      buildProgressRowHomeData_("vente", "done"),
      buildProgressRowHomeData_("cloture", "active")
    ];
  }

  if (stockPrepared && hasJournee) {
    return [
      buildProgressRowHomeData_("inscriptions", "done"),
      buildProgressRowHomeData_("missions", "done"),
      buildProgressRowHomeData_("stock", "done"),
      buildProgressRowHomeData_("vente", "active"),
      buildProgressRowHomeData_("cloture", "upcoming")
    ];
  }

  if (hasStockMission) {
    return [
      buildProgressRowHomeData_("inscriptions", "done"),
      buildProgressRowHomeData_("missions", "done"),
      buildProgressRowHomeData_("stock", "active"),
      buildProgressRowHomeData_("vente", "upcoming"),
      buildProgressRowHomeData_("cloture", "upcoming")
    ];
  }

  if (hasEvent) {
    return [
      buildProgressRowHomeData_("inscriptions", "done"),
      buildProgressRowHomeData_("missions", "active"),
      buildProgressRowHomeData_("stock", "upcoming"),
      buildProgressRowHomeData_("vente", "upcoming"),
      buildProgressRowHomeData_("cloture", "upcoming")
    ];
  }

  return [
    buildProgressRowHomeData_("inscriptions", "active"),
    buildProgressRowHomeData_("missions", "upcoming"),
    buildProgressRowHomeData_("stock", "upcoming"),
    buildProgressRowHomeData_("vente", "upcoming"),
    buildProgressRowHomeData_("cloture", "upcoming")
  ];
}

function buildProgressRowHomeData_(step, status) {
  return {
    step,
    status
  };
}

/* ==============================
   UI / prochaine action
   ============================== */

function buildUiStateHomeData_(selectedItem, active) {
  const selectedType = getSelectedItemTypeHomeData_(selectedItem);

  if (selectedItem && selectedType === "inscription") {
    return {
      code: "event_planning",
      step: "inscriptions",
      label: getInscriptionStatusLabelHomeData_(selectedItem),
      title: getSelectedItemTitleHomeData_(selectedItem),
      meta: buildMetaHomeData_(selectedItem),
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
      title: getSelectedItemTitleHomeData_(active.event || selectedItem),
      meta: buildMetaHomeData_(active.event || selectedItem),
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

  const stockPrepared = isStockPreparedHomeData_(
    active.stockMission,
    active.mouvementsStock
  );

  if (!stockPrepared) {
    return {
      code: "stock_to_prepare",
      step: "stock",
      label: "Stock à préparer",
      title: active.stockMission.nom || getSelectedItemTitleHomeData_(selectedItem),
      meta: buildMissionStockMetaHomeData_(active.stockMission, active.linkedDays),
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

  if (isClosedStatusHomeData_(active.journee)) {
    return {
      code: "closed",
      step: "cloture",
      label: "Journée clôturée",
      title: getDayTitleHomeData_(active),
      meta: buildDayMetaHomeData_(active),
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
    label: normalizeStatusHomeData_(active.journee.statut) === "en_cours"
      ? "Journée en cours"
      : "Stock prêt",
    title: getDayTitleHomeData_(active),
    meta: buildDayMetaHomeData_(active),
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

function buildNextActionHomeData_(ui) {
  return {
    label: ui.primaryText || ui.primary_text || "Continuer",
    href: ui.primaryHref || ui.primary_href || "./index.html"
  };
}

function buildHomeWatchItemsHomeData_(tables, selectedItem, active, resume) {
  const items = [];

  items.push("Source active confirmée : API en ligne.");

  if (selectedItem) {
    items.push(`Évènement sélectionné : ${getSelectedItemTitleHomeData_(selectedItem)}.`);
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
      `CA journée détecté : ${formatCurrencyHomeData_(resume.ca_jour_ttc || 0)} pour ${resume.nb_transactions || 0} ticket(s).`
    );
  }

  return items;
}

/* ==============================
   Helpers identifiants
   ============================== */

function getSelectedItemIdHomeData_(item) {
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

function getSelectedItemTypeHomeData_(item) {
  return normalizeKeyHomeData_(
    item &&
    (
      item.selected_type ||
      item.item_type ||
      item.type ||
      inferTypeFromIdHomeData_(getSelectedItemIdHomeData_(item))
    )
  );
}

function inferTypeFromIdHomeData_(id) {
  const value = String(id || "").trim().toUpperCase();

  if (value.startsWith("INS_")) return "inscription";
  if (value.startsWith("EVT_")) return "mission";
  if (value.startsWith("MIS_")) return "mission";
  if (value.startsWith("MST_")) return "stock";

  return "";
}

function getSelectedItemTitleHomeData_(item) {
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

function getEventIdHomeData_(eventItem) {
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

function getStockMissionIdHomeData_(mission) {
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

function getStockMissionEventIdHomeData_(mission) {
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

function findStockMissionForEventHomeData_(eventId, stockMissions, journees) {
  const id = String(eventId || "").trim();
  if (!id) return null;

  const candidates = (stockMissions || []).filter(function (mission) {
    return !isCancelledStatusHomeData_(mission);
  });
  const linkedStockIds = (journees || [])
    .filter(function (day) {
      return (
        String(day.mission_id || day.evenement_id || "").trim() === id &&
        !isCancelledStatusHomeData_(day)
      );
    })
    .map(function (day) {
      return String(day.stock_mission_id || day.mission_stock_id || "").trim();
    })
    .filter(Boolean);

  // La relation journees_vente.stock_mission_id prime sur l'ordre des lignes Sheets.
  return (
    candidates.find(function (mission) {
      return linkedStockIds.indexOf(getStockMissionIdHomeData_(mission)) >= 0;
    }) ||
    candidates.find(function (mission) {
      return getStockMissionIdHomeData_(mission) === id;
    }) ||
    candidates.find(function (mission) {
      return getStockMissionEventIdHomeData_(mission) === id;
    }) ||
    null
  );
}

function getMissionJourneesHomeData_(mission, journees) {
  const stockMissionId = getStockMissionIdHomeData_(mission);
  const eventId = getStockMissionEventIdHomeData_(mission);

  return journees
    .filter(function (journee) {
      return !isHistoricalDayHomeData_(journee);
    })
    .filter(function (journee) {
      return !isCancelledStatusHomeData_(journee);
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

function getMovementMissionIdHomeData_(movement) {
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

/* ==============================
   Helpers métier
   ============================== */

function isAcceptedInscriptionHomeData_(item) {
  if (!item || isCancelledStatusHomeData_(item)) return false;

  const statut = normalizeStatusHomeData_(item.statut);

  return (
    statut === "accepte" ||
    statut === "acceptee" ||
    statut === "accepté" ||
    statut === "acceptée" ||
    toBooleanHomeData_(item.acceptation, false)
  );
}

function isCancelledStatusHomeData_(item) {
  const statut = normalizeStatusHomeData_(
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

function isClosedStatusHomeData_(item) {
  const statut = normalizeStatusHomeData_(item && item.statut);

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

function isHistoricalSourceHomeData_(item) {
  return String(item && item.source || "")
    .trim()
    .toUpperCase() === "SAISIE_HISTORIQUE";
}

function isHistoricalEventHomeData_(eventItem) {
  const eventId = getEventIdHomeData_(eventItem);

  return (
    isHistoricalSourceHomeData_(eventItem) ||
    eventId.indexOf("EVT_HIST_") === 0
  );
}

function isHistoricalDayHomeData_(journee) {
  const journeeId = String(journee && journee.journee_id || "").trim();
  const eventId = String(journee && (journee.evenement_id || journee.mission_id) || "").trim();
  const stockMissionId = String(journee && (journee.stock_mission_id || journee.mission_stock_id) || "").trim();

  return (
    isHistoricalSourceHomeData_(journee) ||
    journeeId.indexOf("J_HIST_") === 0 ||
    eventId.indexOf("EVT_HIST_") === 0 ||
    stockMissionId.indexOf("MST_HIST_") === 0
  );
}

function isUpcomingOrCurrentHomeData_(item, today) {
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

  return end >= String(today || getTodayIsoHomeData_()).slice(0, 10);
}

function isItemRelatedToUserHomeData_(item, userId) {
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

function isStockPreparedHomeData_(mission, mouvementsStock) {
  if (!mission) return false;

  if (toBooleanHomeData_(mission.stock_prepare, false)) return true;

  const statut = normalizeStatusHomeData_(mission.statut);

  if (
    [
      "pret",
      "prêt",
      "en_cours",
      "termine",
      "terminee",
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
    getStockMissionIdHomeData_(mission),
    getStockMissionEventIdHomeData_(mission)
  ].filter(Boolean);

  return mouvementsStock.some(function (movement) {
    if (!isInitialStockMovementHomeData_(movement)) return false;

    if (missionIds.indexOf(getMovementMissionIdHomeData_(movement)) < 0) {
      return false;
    }

    return getMovementQuantityHomeData_(movement) !== 0;
  });
}

function isInitialStockMovementHomeData_(movement) {
  const type = getMovementTypeHomeData_(movement);

  if (!type || isCancelledStatusHomeData_(movement)) return false;

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

function getMovementTypeHomeData_(movement) {
  return normalizeStatusHomeData_(
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

function getMovementQuantityHomeData_(movement) {
  return toNumberHomeData_(
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

function getTransactionAmountHomeData_(transaction) {
  return toNumberHomeData_(
    transaction.total_encaisse_ttc ??
      transaction.total_encaisse ??
      transaction.total_catalogue_ttc ??
      transaction.total_catalogue,
    0
  );
}

/* ==============================
   Helpers libellés
   ============================== */

function getInscriptionStatusLabelHomeData_(item) {
  if (isAcceptedInscriptionHomeData_(item)) return "Acceptée";

  const statut = normalizeStatusHomeData_(item && item.statut);

  if (statut.indexOf("attente") >= 0) return "En attente";
  if (statut.indexOf("relancer") >= 0) return "À relancer";
  if (statut.indexOf("envoyer") >= 0) return "Dossier à envoyer";
  if (statut.indexOf("envoye") >= 0 || statut.indexOf("envoyé") >= 0) return "Dossier envoyé";

  return "Dossier";
}

function getStockMissionStatusLabelHomeData_(mission) {
  const statut = normalizeStatusHomeData_(mission && mission.statut);

  if (isClosedStatusHomeData_(mission)) return "Clôturé";
  if (isStockPreparedHomeData_(mission, [])) return "Stock prêt";
  if (statut === "stock_a_preparer") return "Stock à préparer";
  if (statut === "en_cours") return "En cours";
  if (statut === "pret" || statut === "prêt") return "Stock prêt";

  return "Mission stock";
}

function buildMetaHomeData_(item) {
  const parts = [
    getDateLabelHomeData_(item),
    String(item && (item.ville || item.city || "") || "").trim()
  ].filter(Boolean);

  return parts.join(" · ");
}

function buildMissionStockMetaHomeData_(mission, linkedDays) {
  const daysCount = Array.isArray(linkedDays) ? linkedDays.length : 0;

  return [
    getDateLabelHomeData_(mission),
    `${daysCount || 1} journée(s) liée(s)`
  ].filter(Boolean).join(" · ");
}

function buildDayMetaHomeData_(active) {
  const missionName =
    active.stockMission && active.stockMission.nom
      ? active.stockMission.nom
      : "Mission";

  const dayDate =
    active.journee && active.journee.date
      ? formatDisplayDateHomeData_(active.journee.date)
      : "";

  return [missionName, dayDate].filter(Boolean).join(" · ");
}

function getDayTitleHomeData_(active) {
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

function getDateLabelHomeData_(item) {
  if (!item) return "";

  const start = String(item.date_debut || item.date || "").slice(0, 10);
  const end = String(item.date_fin || start || "").slice(0, 10);

  if (!start) return "";

  if (!end || start === end) {
    return formatDisplayDateHomeData_(start);
  }

  return `${formatDisplayDateHomeData_(start)} → ${formatDisplayDateHomeData_(end)}`;
}

/* ==============================
   Helpers format / normalisation
   ============================== */

function formatDisplayDateHomeData_(isoDate) {
  const value = String(isoDate || "").slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "date inconnue";
  }

  const parts = value.split("-");
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));

  return Utilities.formatDate(
    date,
    getTimezoneHomeData_(),
    "dd/MM/yyyy"
  );
}

function formatShortDateHomeData_(isoDate) {
  const value = String(isoDate || "").slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "—";
  }

  const parts = value.split("-");

  return `${parts[2]}/${parts[1]}`;
}

function formatCurrencyHomeData_(value) {
  const amount = roundAmountHomeData_(value);

  return `${String(amount).replace(".", ",")} €`;
}

function roundAmountHomeData_(value) {
  return Math.round((toNumberHomeData_(value, 0) + Number.EPSILON) * 100) / 100;
}

function toNumberHomeData_(value, fallback) {
  if (typeof value === "number" && isFinite(value)) return value;

  const normalized = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");

  if (!normalized) return fallback;

  const number = Number(normalized);

  return isFinite(number) ? number : fallback;
}

function toBooleanHomeData_(value, fallback) {
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

function normalizeStatusHomeData_(value) {
  return normalizeKeyHomeData_(value);
}

function normalizeKeyHomeData_(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-\s]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function getTodayIsoHomeData_() {
  return Utilities.formatDate(
    new Date(),
    getTimezoneHomeData_(),
    "yyyy-MM-dd"
  );
}

function getTimezoneHomeData_() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  } catch (error) {
    return Session.getScriptTimeZone() || "Europe/Paris";
  }
}