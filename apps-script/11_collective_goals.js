/**
 * Objectifs collectifs réutilisables calculés côté serveur.
 * Le périmètre Noël 2026 référence les 21 journees_id existants dans journees_vente.
 */
var COLLECTIVE_GOALS_CONFIG_ = {
  "noel-2026": {
    id: "noel-2026",
    title: "Objectif Noël 2026",
    starts_on: "2026-11-28",
    ends_on: "2026-12-13",
    target: 14000,
    journee_ids: [
  "J_NOEL_2026_20261128_CHARLY",
  "J_NOEL_2026_20261128_COLOMBIER_SAUGNIEU",
  "J_NOEL_2026_20261128_COMMUNAY",
  "J_NOEL_2026_20261129_COLOMBIER_SAUGNIEU",
  "J_NOEL_2026_20261129_LUZINAY",
  "J_NOEL_2026_20261129_VILLETTE_D_ANTHON",
  "J_NOEL_2026_20261204_PONT_DE_CHERUY",
  "J_NOEL_2026_20261205_GENAS",
  "J_NOEL_2026_20261205_LA_TOUR_DE_SALVAGNY",
  "J_NOEL_2026_20261206_GENAS",
  "J_NOEL_2026_20261206_LA_TOUR_DE_SALVAGNY",
  "J_NOEL_2026_20261206_VERNAISON",
  "J_NOEL_2026_20261208_CREMIEU",
  "J_NOEL_2026_20261208_CHAPONOST",
  "J_NOEL_2026_20261211_L_ARBRESLE",
  "J_NOEL_2026_20261212_L_ARBRESLE",
  "J_NOEL_2026_20261212_SAINT_LAURENT_DE_MURE",
  "J_NOEL_2026_20261212_ARNAS",
  "J_NOEL_2026_20261213_L_ARBRESLE",
  "J_NOEL_2026_20261213_SAINT_LAURENT_DE_MURE",
  "J_NOEL_2026_20261213_SOUCIEU_EN_JARREST"
]
  }
};

function getCollectiveGoal_(params) {
  var goalId = String(params && (params.goal_id || params.goalId) || "").trim();
  var goal = COLLECTIVE_GOALS_CONFIG_[goalId];
  if (!goal) throw new Error("Objectif collectif inconnu.");

  var dayIds = {};
  goal.journee_ids.forEach(function (id) { dayIds[id] = true; });

  // La feuille reste côté serveur : seules les lignes correspondant aux 21 jours
  // sont agrégées et renvoyées au client sous forme d'un total compact.
  var rows = readSheetRows_("transactions");
  var latestById = {};
  rows.forEach(function (row) {
    var transactionId = String(row && (row.transaction_id || row.id) || "").trim();
    if (!transactionId) return;

    var existing = latestById[transactionId];
    var updatedAt = String(row.updated_at || row.created_at || "");
    var existingUpdatedAt = existing ? String(existing.updated_at || existing.created_at || "") : "";
    if (!existing || updatedAt >= existingUpdatedAt) latestById[transactionId] = row;
  });

  var transactions = Object.keys(latestById).map(function (id) { return latestById[id]; })
    .filter(function (row) {
      return Boolean(dayIds[String(row && row.journee_id || "").trim()]);
    });
  var eligible = transactions.filter(isCollectiveGoalTransactionEligible_);
  var contributions = { U_ANTHONY: 0, U_JEROME: 0, U_WILL: 0 };
  var today = collectiveGoalToday_();
  var todayDays = {};
  readSheetRows_("journees_vente").forEach(function (day) {
    var id = String(day && day.journee_id || "").trim();
    if (dayIds[id] && String(day.date || "").slice(0, 10) === today) todayDays[id] = true;
  });
  var dailyContributions = { U_ANTHONY: 0, U_JEROME: 0, U_WILL: 0 };
  var amount = eligible.reduce(function (total, transaction) {
    var value = collectiveGoalTransactionAmount_(transaction);
    var userId = String(transaction.user_id || "").trim();
    if (Object.prototype.hasOwnProperty.call(contributions, userId)) contributions[userId] += value;
    if (todayDays[String(transaction.journee_id || "").trim()] &&
        Object.prototype.hasOwnProperty.call(dailyContributions, userId)) dailyContributions[userId] += value;
    return total + value;
  }, 0);
  Object.keys(contributions).forEach(function (id) {
    contributions[id] = Math.round((contributions[id] + Number.EPSILON) * 100) / 100;
    dailyContributions[id] = Math.round((dailyContributions[id] + Number.EPSILON) * 100) / 100;
  });
  amount = Math.round((amount + Number.EPSILON) * 100) / 100;

  return {
    available: true,
    goal_id: goal.id,
    title: goal.title,
    starts_on: goal.starts_on,
    ends_on: goal.ends_on,
    target: goal.target,
    amount: amount,
    contributions: contributions,
    daily_contributions: dailyContributions,
    daily_date: today,
    percent: Math.floor(amount / goal.target * 100),
    remaining: Math.max(0, Math.round((goal.target - amount + Number.EPSILON) * 100) / 100),
    eligible_day_count: goal.journee_ids.length,
    transaction_count: eligible.length,
    updated_at: new Date().toISOString()
  };
}

function collectiveGoalToday_() {
  return Utilities.formatDate(new Date(), "Europe/Paris", "yyyy-MM-dd");
}

function collectiveGoalTransactionAmount_(transaction) {
  var value = transaction.total_encaisse_ttc != null && transaction.total_encaisse_ttc !== ""
    ? transaction.total_encaisse_ttc
    : transaction.total_encaisse != null && transaction.total_encaisse !== ""
      ? transaction.total_encaisse
      : transaction.total_catalogue_ttc != null && transaction.total_catalogue_ttc !== ""
        ? transaction.total_catalogue_ttc
        : transaction.total_catalogue;
  return collectiveGoalToNumber_(value, 0);
}

function getCollectiveGoalSellerDetails_(params) {
  var goalId = String(params && (params.goal_id || params.goalId) || "").trim();
  var goal = COLLECTIVE_GOALS_CONFIG_[goalId];
  if (!goal) throw new Error("Objectif collectif inconnu.");
  var sellerId = String(params && (params.seller_id || params.sellerId) || "").trim();
  if (["U_ANTHONY", "U_JEROME", "U_WILL"].indexOf(sellerId) < 0) throw new Error("Vendeur invalide.");
  var today = collectiveGoalToday_();
  var allowed = {};
  goal.journee_ids.forEach(function (id) { allowed[id] = true; });
  var dayDates = {};
  readSheetRows_("journees_vente").forEach(function (day) {
    var id = String(day && day.journee_id || "").trim();
    if (allowed[id]) dayDates[id] = String(day.date || "").slice(0, 10);
  });
  var latest = {};
  readSheetRows_("transactions").forEach(function (row) {
    var id = String(row && (row.transaction_id || row.id) || "").trim();
    if (!id) return;
    if (!latest[id] || String(row.updated_at || row.created_at || "") >= String(latest[id].updated_at || latest[id].created_at || "")) latest[id] = row;
  });
  var periods = { total: collectiveGoalSellerPeriod_(), daily: collectiveGoalSellerPeriod_() };
  var catalogueByCode = {};
  readSheetRows_("catalogue").forEach(function (product) {
    var code = String(product.parfum_code || "").trim();
    if (code) catalogueByCode[code] = product;
  });
  Object.keys(latest).forEach(function (id) {
    var tx = latest[id], dayId = String(tx.journee_id || "").trim();
    if (!allowed[dayId] || String(tx.user_id || "").trim() !== sellerId || !isCollectiveGoalTransactionEligible_(tx)) return;
    var amount = collectiveGoalTransactionAmount_(tx);
    var targets = [periods.total];
    if (dayDates[dayId] === today) targets.push(periods.daily);
    targets.forEach(function (period) {
      period.revenue += amount;
      var mode = String(tx.mode_paiement || "").trim().toUpperCase();
      if (mode === "CB") period.card += amount;
      else if (mode === "ESP") period.cash += amount;
      else period.other += amount;
      collectiveGoalSellerItems_(tx.detail_ticket).forEach(function (item) {
        var composition = Array.isArray(item && item.composition) ? item.composition : null;
        if (composition) composition.forEach(function (part) {
          collectiveGoalSellerAddProduct_(period, part, Number(item.format_cl) || 20, 1, catalogueByCode);
        });
        else collectiveGoalSellerAddProduct_(period, item, null, null, catalogueByCode);
      });
    });
  });
  Object.keys(periods).forEach(function (key) {
    var p = periods[key];
    p.revenue = collectiveGoalRoundMoney_(p.revenue);
    p.card = collectiveGoalRoundMoney_(p.card);
    p.cash = collectiveGoalRoundMoney_(p.cash);
    p.other = collectiveGoalRoundMoney_(p.other);
    p.products.sort(function (a, b) {
      return b.quantity - a.quantity || a.name.localeCompare(b.name) || a.code.localeCompare(b.code);
    });
  });
  return { available: true, goal_id: goalId, seller_id: sellerId, daily_date: today, periods: periods };
}

function collectiveGoalSellerPeriod_() { return { revenue: 0, card: 0, cash: 0, other: 0, bottles: { "50": 0, "20": 0 }, products: [] }; }
function collectiveGoalRoundMoney_(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function collectiveGoalSellerItems_(value) {
  try { var v = typeof value === "string" ? JSON.parse(value || "[]") : value; return Array.isArray(v) ? v : v && Array.isArray(v.items) ? v.items : []; }
  catch (_error) { return []; }
}
function collectiveGoalSellerAddProduct_(period, item, inheritedFormat, inheritedQty, catalogueByCode) {
  if (typeof item === "string") item = { parfum_code: item };
  if (!item || typeof item !== "object") return;
  var format = Number(inheritedFormat || item.format_cl || 0), qty = Number(inheritedQty || item.quantite || 1);
  var code = String(item.parfum_code || item.sku_id || "").trim();
  var catalogue = catalogueByCode && catalogueByCode[code];
  var name = String(item.parfum_nom || item.label || catalogue && catalogue.parfum_nom || code).trim();
  if ((format !== 20 && format !== 50) || !code || !isFinite(qty) || qty <= 0) return;
  var key = format + "|" + code, found = period.products.filter(function (p) { return p.key === key; })[0];
  if (!found) { found = { key: key, format_cl: format, code: code, name: name, quantity: 0 }; period.products.push(found); }
  found.quantity += qty; period.bottles[String(format)] += qty;
}

function isCollectiveGoalTransactionEligible_(transaction) {
  if (!transaction || typeof transaction !== "object") return false;
  var status = collectiveGoalNormalizeStatus_(transaction.statut);
  var paymentStatus = collectiveGoalNormalizeStatus_(transaction.paiement_statut);
  var excluded = ["annule", "refuse", "rembourse", "sumup_lance", "en_attente", "attente", "lance"];
  if (excluded.some(function (marker) { return status.indexOf(marker) >= 0 || paymentStatus.indexOf(marker) >= 0; })) return false;

  return ["validee", "valide", "cloture", "cloturee"].indexOf(status) >= 0 ||
    ["paye", "payee"].indexOf(paymentStatus) >= 0;
}

function collectiveGoalNormalizeStatus_(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-\s]+/g, "_");
}

function collectiveGoalToNumber_(value, fallback) {
  if (typeof value === "number" && isFinite(value)) return value;
  var normalized = String(value == null ? "" : value).trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return fallback;
  var amount = Number(normalized);
  return isFinite(amount) ? amount : fallback;
}
