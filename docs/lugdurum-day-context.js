(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LugdurumDayContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FRANCE_TIME_ZONE = "Europe/Paris";
  const CLOSED = new Set(["cloture", "cloturee", "annule", "annulee", "archive", "archivé"]);

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

  const isAuthorized = (day, userId) => {
    const id = String(userId || "").trim();
    if (!day || !id) return false;
    return parseAuthorizations(day.vendeurs_autorises)
      .some((vendor) => String(vendor.user_id || "").trim() === id);
  };

  const isOpen = (day) => {
    const status = statusKey(day?.statut);
    return Boolean(day && !CLOSED.has(status) && !status.includes("annul") && !status.includes("clotur"));
  };

  const scheduleFor = (days, userId, today = parisDateIso()) => {
    const allowed = (Array.isArray(days) ? days : [])
      .filter((day) => isAuthorized(day, userId) && isOpen(day))
      .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day.date || "").slice(0, 10)))
      .map((day) => ({ ...day, date: String(day.date).slice(0, 10) }))
      .sort((a, b) => a.date.localeCompare(b.date) ||
        String(a.journee_id || "").localeCompare(String(b.journee_id || "")));
    const todayDays = allowed.filter((day) => day.date === today);
    if (todayDays.length) return { mode: todayDays.length === 1 ? "today" : "choose_today", days: todayDays };
    const future = allowed.find((day) => day.date > today);
    return future
      ? { mode: "next", days: allowed.filter((day) => day.date === future.date) }
      : { mode: "empty", days: [] };
  };

  const canSell = (day, userId, stockMission, today = parisDateIso()) => {
    if (!day || !isAuthorized(day, userId)) return { allowed: false, reason: "unauthorized" };
    if (String(day.date || "").slice(0, 10) !== today) return { allowed: false, reason: "not_today" };
    if (!isOpen(day)) return { allowed: false, reason: "closed" };
    const stockId = String(day.stock_mission_id || day.mission_stock_id || "").trim();
    if (!stockId || !stockMission || String(stockMission.mission_id || "").trim() !== stockId) {
      return { allowed: false, reason: "stock_missing" };
    }
    if (statusKey(stockMission.statut).includes("clotur") || statusKey(stockMission.statut).includes("annul")) {
      return { allowed: false, reason: "stock_closed" };
    }
    return { allowed: true, reason: "" };
  };

  return { FRANCE_TIME_ZONE, parisDateIso, parseAuthorizations, isAuthorized, isOpen, scheduleFor, canSell };
});
