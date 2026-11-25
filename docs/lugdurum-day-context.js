(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LugdurumDayContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FRANCE_TIME_ZONE = "Europe/Paris";
  const CLOSED = new Set(["cloture", "cloturee", "annule", "annulee", "archive", "archivee"]);

  const parisDateIso = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: FRANCE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return values.year + "-" + values.month + "-" + values.day;
  };

  const statusKey = (value) => String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

  const parseAuthorizations = (value) => {
    if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
    } catch (_error) {
      return [];
    }
  };

  const getDayId = (day) => String(day?.journee_id || "").trim();
  // journees_vente.mission_id is the event; stock_mission_id is a separate relation.
  const getDayEventId = (day) => String(day?.mission_id || day?.evenement_id || day?.mission_vente_id || "").trim();
  const getDayStockMissionId = (day) => String(day?.stock_mission_id || day?.mission_stock_id || "").trim();
  const isValidDate = (day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day?.date || "").slice(0, 10));

  const isAuthorized = (day, userId) => {
    const id = String(userId || "").trim();
    if (!day || !id) return false;
    return parseAuthorizations(day.vendeurs_autorises)
      .some((vendor) => String(vendor.user_id || "").trim() === id);
  };

  const isOpen = (day) => {
    const status = statusKey(day?.statut);
    return Boolean(day && !String(day.closed_at || "").trim() &&
      !CLOSED.has(status) && !status.includes("annul") && !status.includes("clotur"));
  };

  const authorizedDaysFor = (days, userId) => (Array.isArray(days) ? days : [])
    .filter((day) => isAuthorized(day, userId) && isValidDate(day) && getDayId(day))
    .map((day) => ({ ...day, date: String(day.date).slice(0, 10) }))
    .sort((a, b) => a.date.localeCompare(b.date) || getDayId(a).localeCompare(getDayId(b)));

  const openAuthorizedDaysFor = (days, userId) => authorizedDaysFor(days, userId).filter(isOpen);

  const selectionForPriorityGroup = (days, selectedId, allowRememberedChoice = false) => {
    const selected = allowRememberedChoice
      ? days.find((day) => getDayId(day) === String(selectedId || "").trim())
      : null;
    return selected || (days.length === 1 ? days[0] : null);
  };

  const scheduleFor = (days, userId, today = parisDateIso()) => {
    const open = openAuthorizedDaysFor(days, userId);
    const currentDate = String(today || parisDateIso()).slice(0, 10);
    const todayDays = open.filter((day) => day.date === currentDate);
    if (todayDays.length) return { mode: todayDays.length === 1 ? "today" : "choose_today", days: todayDays };

    const futureDays = open.filter((day) => day.date > currentDate);
    if (!futureDays.length) return { mode: "empty", days: [] };
    const nextDate = futureDays[0].date;
    const nextDays = futureDays.filter((day) => day.date === nextDate);
    return { mode: nextDays.length === 1 ? "next" : "choose_next", days: nextDays };
  };

  const preferredDay = (days, userId, selectedId = "", today = parisDateIso(), forceSelection = false, manualOverride = false) => {
    const open = openAuthorizedDaysFor(days, userId);
    const persisted = open.find((day) => getDayId(day) === String(selectedId || "").trim());
    const schedule = scheduleFor(open, userId, today);
    // Un choix effectué pendant cette session reste immédiat, y compris parmi
    // plusieurs journées aujourd'hui.
    if (manualOverride && persisted) return persisted;
    // Une journée affectée aujourd'hui reprend la priorité sur une ancienne
    // préférence mémorisée à une date antérieure.
    if (schedule.mode === "today" || schedule.mode === "choose_today") {
      return selectionForPriorityGroup(schedule.days, selectedId, forceSelection);
    }
    // En dehors d'aujourd'hui, un choix manuel reste mémorisé tant qu'il est
    // encore affecté et ouvert, même si une autre journée arrive avant.
    if (forceSelection && persisted) return persisted;
    if (schedule.mode === "empty") return null;
    return selectionForPriorityGroup(schedule.days, selectedId, forceSelection);
  };

  const resolveWorkContext = ({
    days = [], events = [], stockMissions = [], userId = "", selectedDayId = "",
    today = parisDateIso(), forceSelection = false, manualOverride = false
  } = {}) => {
    const safeUserId = String(userId || "").trim();
    const authorizedDays = authorizedDaysFor(days, safeUserId);
    const openDays = authorizedDays.filter(isOpen);
    const schedule = scheduleFor(openDays, safeUserId, today);
    const day = preferredDay(openDays, safeUserId, selectedDayId, today, forceSelection, manualOverride);
    const eventId = getDayEventId(day);
    const stockMissionId = getDayStockMissionId(day);
    const event = eventId
      ? (Array.isArray(events) ? events : []).find((item) => String(item?.mission_id || item?.evenement_id || "").trim() === eventId) || null
      : null;
    const stockMission = stockMissionId
      ? (Array.isArray(stockMissions) ? stockMissions : []).find((item) => String(item?.mission_id || "").trim() === stockMissionId) || null
      : null;
    const linkedDays = stockMissionId
      ? (Array.isArray(days) ? days : []).filter((item) =>
          getDayStockMissionId(item) === stockMissionId && isOpen(item))
      : [];
    const context = {
      user_id: safeUserId,
      journee_id: getDayId(day),
      mission_id: eventId,
      stock_mission_id: stockMissionId
    };

    return {
      userId: safeUserId,
      day,
      event,
      stockMission,
      linkedDays,
      context,
      authorizedDays,
      selectableDays: openDays,
      schedule,
      selectionRequired: !day && schedule.days.length > 1,
      stockMissionMissing: Boolean(stockMissionId && !stockMission),
      selectedDayWasInvalid: Boolean(selectedDayId && !openDays.some((item) => getDayId(item) === String(selectedDayId).trim()))
    };
  };

  const canSell = (day, userId, stockMission, today = parisDateIso()) => {
    if (!day || !isAuthorized(day, userId)) return { allowed: false, reason: "unauthorized" };
    if (!isOpen(day)) return { allowed: false, reason: "closed" };
    if (String(day.date || "").slice(0, 10) !== today) return { allowed: false, reason: "not_today" };
    if (!getDayStockMissionId(day)) return { allowed: false, reason: "stock_missing" };
    if (!stockMission || String(stockMission.mission_id || "").trim() !== getDayStockMissionId(day)) {
      return { allowed: false, reason: "stock_missing" };
    }
    const stockStatus = statusKey(stockMission.statut);
    if (stockStatus.includes("clotur") || stockStatus.includes("annul")) return { allowed: false, reason: "stock_closed" };
    const prepared = stockMission.stock_prepare === true ||
      ["true", "1", "oui"].includes(String(stockMission.stock_prepare || "").trim().toLowerCase()) ||
      ["pret", "en_cours"].includes(stockStatus);
    if (!prepared) return { allowed: false, reason: "stock_not_prepared" };
    return { allowed: true, reason: "" };
  };

  return {
    FRANCE_TIME_ZONE,
    parisDateIso,
    parseAuthorizations,
    getDayId,
    getDayEventId,
    getDayStockMissionId,
    isAuthorized,
    isOpen,
    authorizedDaysFor,
    openAuthorizedDaysFor,
    preferredDay,
    scheduleFor,
    resolveWorkContext,
    canSell
  };
});
