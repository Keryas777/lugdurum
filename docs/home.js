(() => {
  "use strict";

  /*
    Accueil V8 :
    - L'accueil lit le parcours localStorage.
    - Stats dynamiques :
      - sans journée active : inscriptions / acceptées / missions stock
      - stock à préparer : journées / stock / à synchroniser
      - vente ou clôture : CA jour / tickets / à synchroniser
    - Parcours principal visuel en étapes.
  */

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme",
    role: "admin"
  };

  const STORAGE_KEYS = {
    inscriptions: "lugdurum_inscriptions_evenements",
    events: "lugdurum_evenements",
    stockMissions: "lugdurum_missions_stock",
    journees: "lugdurum_journees",
    activeMissionId: "lugdurum_active_mission_id",
    activeStockMissionId: "lugdurum_active_stock_mission_id",
    activeJourneeId: "lugdurum_active_journee_id",
    preparationContext: "lugdurum_preparation_context",
    pendingTransactions: "lugdurum_pending_transactions",
    stockPreparations: "lugdurum_stock_preparations"
  };

  const STEP_ORDER = ["inscriptions", "missions", "stock", "vente", "cloture"];

  const formatEuro = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  });

  const formatDate = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

  const qs = (selector) => document.querySelector(selector);

  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  };

  const getArray = (key) => {
    const value = readJson(key, []);
    return Array.isArray(value) ? value : [];
  };

  const getObject = (key) => {
    const value = readJson(key, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  };

  const parseDate = (isoDate) => {
    if (!isoDate) return null;
    return new Date(`${isoDate}T12:00:00`);
  };

  const formatDisplayDate = (isoDate) => {
    const date = parseDate(isoDate);
    if (!date) return "date inconnue";
    return formatDate.format(date);
  };

  const getDateLabel = (item) => {
    if (!item?.date_debut) return "Date inconnue";

    if (!item.date_fin || item.date_debut === item.date_fin) {
      return formatDisplayDate(item.date_debut);
    }

    return `${formatDisplayDate(item.date_debut)} → ${formatDisplayDate(item.date_fin)}`;
  };

  const getActiveIds = () => {
    const context = getObject(STORAGE_KEYS.preparationContext);

    return {
      stockMissionId:
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

  const getMissionJournees = (missionId, journees) => {
    return journees
      .filter((journee) => {
        return (
          journee.mission_id === missionId ||
          journee.stock_mission_id === missionId
        );
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  };

  const getFirstOpenDay = (missionId, journees) => {
    const linkedDays = getMissionJournees(missionId, journees);

    return (
      linkedDays.find((journee) => {
        return journee.statut !== "cloture" && journee.statut !== "annule";
      }) ||
      linkedDays[0] ||
      null
    );
  };

  const findFallbackActiveMission = (stockMissions) => {
    const candidates = stockMissions
      .filter((mission) => mission.statut !== "annule")
      .filter((mission) => mission.statut !== "cloture")
      .sort((a, b) => {
        const byDate = String(a.date_debut).localeCompare(String(b.date_debut));
        if (byDate !== 0) return byDate;
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });

    return candidates[0] || null;
  };

  const getStockPreparationForMission = (missionId) => {
    return getArray(STORAGE_KEYS.stockPreparations).find((item) => {
      return (
        item.mission_id === missionId ||
        item.stock_mission_id === missionId
      );
    });
  };

  const isStockPrepared = (mission) => {
    if (!mission) return false;

    if (mission.stock_prepare === true) return true;

    if (["pret", "en_cours", "termine", "cloture"].includes(mission.statut)) {
      return true;
    }

    const preparation = getStockPreparationForMission(mission.mission_id);

    return Boolean(
      preparation &&
      ["valide", "validé", "pret", "prêt"].includes(
        String(preparation.statut || "").toLowerCase()
      )
    );
  };

  const getDayTransactions = (journeeId) => {
    if (!journeeId) return [];

    return getArray(STORAGE_KEYS.pendingTransactions).filter((transaction) => {
      return transaction.journee_id === journeeId;
    });
  };

  const getRevenueForTransactions = (transactions) => {
    return transactions.reduce((sum, transaction) => {
      return sum + Number(transaction.total_encaisse_ttc || transaction.total_catalogue_ttc || 0);
    }, 0);
  };

  const getEventById = (eventId, events) => {
    return events.find((eventItem) => eventItem.evenement_id === eventId) || null;
  };

  const getDayReadableTitle = (journee, events) => {
    if (!journee) return "Aucune journée";

    const eventItem = getEventById(journee.evenement_id, events);

    if (!eventItem) {
      return journee.jour_label || "Journée";
    }

    if (eventItem.date_debut === eventItem.date_fin) {
      return eventItem.nom;
    }

    return `${eventItem.nom} — ${journee.jour_label || "Journée"}`;
  };

  const getActiveInscriptions = (inscriptions) => {
    return inscriptions.filter((item) => item.statut !== "ANNULE");
  };

  const getAcceptedInscriptions = (inscriptions) => {
    return inscriptions.filter((item) => {
      return item.statut === "ACCEPTE" || item.acceptation === true;
    });
  };

  const buildHomeState = () => {
    const inscriptions = getArray(STORAGE_KEYS.inscriptions);
    const events = getArray(STORAGE_KEYS.events);
    const stockMissions = getArray(STORAGE_KEYS.stockMissions);
    const journees = getArray(STORAGE_KEYS.journees);
    const pendingTransactions = getArray(STORAGE_KEYS.pendingTransactions);

    const activeIds = getActiveIds();

    let mission = activeIds.stockMissionId
      ? stockMissions.find((item) => item.mission_id === activeIds.stockMissionId) || null
      : null;

    if (!mission) {
      mission = findFallbackActiveMission(stockMissions);
    }

    let journee = null;

    if (mission) {
      journee = activeIds.journeeId
        ? journees.find((item) => item.journee_id === activeIds.journeeId) || null
        : null;

      if (!journee) {
        journee = getFirstOpenDay(mission.mission_id, journees);
      }
    }

    const linkedDays = mission ? getMissionJournees(mission.mission_id, journees) : [];
    const dayTransactions = getDayTransactions(journee?.journee_id || "");
    const revenue = getRevenueForTransactions(dayTransactions);
    const stockPrepared = isStockPrepared(mission);

    return {
      user: CURRENT_USER,
      inscriptions,
      activeInscriptions: getActiveInscriptions(inscriptions),
      acceptedInscriptions: getAcceptedInscriptions(inscriptions),
      events,
      stockMissions,
      journees,
      linkedDays,
      mission,
      journee,
      stockPrepared,
      dayTransactions,
      resume: {
        ca_jour_ttc: revenue,
        nb_transactions: dayTransactions.length,
        ventes_en_attente_sync: pendingTransactions.length,
        total_pending_transactions: pendingTransactions.length
      }
    };
  };

  const getUiState = (homeState) => {
    const { mission, journee, stockPrepared } = homeState;

    if (!mission || !journee) {
      return {
        code: "no_mission",
        step: "inscriptions",
        label: "Aucune mission active",
        title: "Commencer par les inscriptions",
        meta: "Crée ou valide un évènement, puis prépare une mission de stock.",
        primaryText: "Gérer les inscriptions",
        primaryHref: "./inscriptions-evenements.html",
        secondaryText: "Missions stock",
        secondaryHref: "./missions.html"
      };
    }

    if (!stockPrepared || mission.statut === "stock_a_preparer") {
      return {
        code: "stock_to_prepare",
        step: "stock",
        label: "Stock à préparer",
        title: mission.nom || "Mission de stock",
        meta: `${getDateLabel(mission)} · ${homeState.linkedDays.length || 1} journée(s) liée(s)`,
        primaryText: "Préparer le stock",
        primaryHref: "./preparation-stock.html",
        secondaryText: "Missions stock",
        secondaryHref: "./missions.html"
      };
    }

    if (journee.statut === "cloture") {
      return {
        code: "closed",
        step: "cloture",
        label: "Journée clôturée",
        title: getDayReadableTitle(journee, homeState.events),
        meta: `${mission.nom || "Mission"} · ${formatDisplayDate(journee.date)}`,
        primaryText: "Voir le dashboard",
        primaryHref: "./dashboard.html",
        secondaryText: "Missions stock",
        secondaryHref: "./missions.html"
      };
    }

    return {
      code: "selling",
      step: "vente",
      label: journee.statut === "en_cours" ? "Journée en cours" : "Stock prêt",
      title: getDayReadableTitle(journee, homeState.events),
      meta: `${mission.nom || "Mission"} · ${formatDisplayDate(journee.date)}`,
      primaryText: "+ Nouvelle vente",
      primaryHref: "./vente-rapide.html",
      secondaryText: "Clôturer la journée",
      secondaryHref: "./cloture.html"
    };
  };

  const setText = (selector, value) => {
    const el = qs(selector);
    if (el) el.textContent = value;
  };

  const setLink = (selector, text, href) => {
    const el = qs(selector);
    if (!el) return;

    el.textContent = text;
    el.href = href;
  };

  const renderStats = (homeState, uiState) => {
    const syncCard = qs("#syncStatCard");

    syncCard?.classList.remove("hasWarning");

    if (uiState.code === "no_mission") {
      setText("#statOneLabel", "Inscriptions");
      setText("#todayRevenue", String(homeState.activeInscriptions.length));

      setText("#statTwoLabel", "Acceptées");
      setText("#todayTickets", String(homeState.acceptedInscriptions.length));

      setText("#statThreeLabel", "Missions stock");
      setText("#pendingSync", String(homeState.stockMissions.length));

      return;
    }

    if (uiState.code === "stock_to_prepare") {
      setText("#statOneLabel", "Journées");
      setText("#todayRevenue", String(homeState.linkedDays.length || 1));

      setText("#statTwoLabel", "Stock");
      setText("#todayTickets", homeState.stockPrepared ? "OK" : "À faire");

      setText("#statThreeLabel", "À synchroniser");
      setText("#pendingSync", String(homeState.resume.total_pending_transactions || 0));

      syncCard?.classList.toggle(
        "hasWarning",
        Number(homeState.resume.total_pending_transactions || 0) > 0
      );

      return;
    }

    setText("#statOneLabel", "CA jour");
    setText("#todayRevenue", formatEuro.format(Number(homeState.resume.ca_jour_ttc || 0)));

    setText("#statTwoLabel", "Tickets");
    setText("#todayTickets", String(homeState.resume.nb_transactions || 0));

    setText("#statThreeLabel", "À synchroniser");
    setText("#pendingSync", String(homeState.resume.total_pending_transactions || 0));

    syncCard?.classList.toggle(
      "hasWarning",
      Number(homeState.resume.total_pending_transactions || 0) > 0
    );
  };

  const renderHero = (homeState, uiState) => {
    const statusHero = qs("#statusHero");
    const liveDot = qs("#liveDot");

    statusHero.classList.remove(
      "isNoMission",
      "isStockToPrepare",
      "isSelling",
      "isClosed"
    );

    liveDot.classList.remove(
      "isNoMission",
      "isStockToPrepare",
      "isSelling",
      "isClosed"
    );

    const stateClass = {
      no_mission: "isNoMission",
      stock_to_prepare: "isStockToPrepare",
      selling: "isSelling",
      closed: "isClosed"
    }[uiState.code];

    if (stateClass) {
      statusHero.classList.add(stateClass);
      liveDot.classList.add(stateClass);
    }

    setText("#currentUserName", homeState.user.nom || "Utilisateur");
    setText("#activeStatusLabel", uiState.label);
    setText("#missionTitle", uiState.title);
    setText("#missionMeta", uiState.meta);

    renderStats(homeState, uiState);

    setLink("#primaryAction", uiState.primaryText, uiState.primaryHref);
    setLink("#secondaryAction", uiState.secondaryText, uiState.secondaryHref);
  };

  const renderWorkflow = (uiState) => {
    const currentIndex = STEP_ORDER.indexOf(uiState.step);

    document.querySelectorAll("[data-step]").forEach((card) => {
      const step = card.dataset.step;
      const index = STEP_ORDER.indexOf(step);

      card.classList.remove("isDone", "isActive", "isUpcoming");

      if (currentIndex < 0) {
        card.classList.add("isUpcoming");
        return;
      }

      if (index < currentIndex) {
        card.classList.add("isDone");
      } else if (index === currentIndex) {
        card.classList.add("isActive");
      } else {
        card.classList.add("isUpcoming");
      }
    });
  };

  const buildWatchItems = (homeState, uiState) => {
    const items = [];

    if (!homeState.mission || !homeState.journee) {
      items.push("Aucune mission de stock active pour le moment.");

      if (homeState.activeInscriptions.length > 0) {
        items.push(`${homeState.activeInscriptions.length} inscription(s) suivie(s), dont ${homeState.acceptedInscriptions.length} acceptée(s).`);
      } else {
        items.push("Commence par créer ou accepter une inscription, puis crée l’évènement.");
      }

      items.push("Les données sont encore locales : Chrome, Safari et WebApp ne partagent pas encore les mêmes informations.");
      return items;
    }

    items.push(
      `${homeState.linkedDays.length || 1} journée(s) liée(s) à la mission “${homeState.mission.nom}”.`
    );

    if (uiState.code === "stock_to_prepare") {
      items.push("Le stock initial n’est pas encore validé pour cette mission.");
    }

    if (uiState.code === "selling") {
      items.push("La vente rapide est disponible pour la journée active.");
    }

    if (Number(homeState.resume.total_pending_transactions || 0) > 0) {
      items.push(`${homeState.resume.total_pending_transactions} ticket(s) en attente de synchronisation.`);
    } else {
      items.push("Aucun ticket en attente de synchronisation locale.");
    }

    if (uiState.code !== "closed") {
      items.push("Pense à saisir les frais avant la clôture si besoin.");
    } else {
      items.push("La journée active semble clôturée.");
    }

    return items;
  };

  const renderWatchList = (items) => {
    const list = qs("#watchList");

    if (!list) return;

    list.innerHTML = "";

    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
  };

  const initHome = () => {
    const homeState = buildHomeState();
    const uiState = getUiState(homeState);

    renderHero(homeState, uiState);
    renderWorkflow(uiState);
    renderWatchList(buildWatchItems(homeState, uiState));
  };

  initHome();
})();