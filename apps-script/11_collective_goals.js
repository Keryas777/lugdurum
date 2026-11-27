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
    var dayId = String(row && row.journee_id || "").trim();
    var transactionId = String(row && (row.transaction_id || row.id) || "").trim();
    if (!dayIds[dayId] || !transactionId) return;

    var existing = latestById[transactionId];
    var updatedAt = String(row.updated_at || row.created_at || "");
    var existingUpdatedAt = existing ? String(existing.updated_at || existing.created_at || "") : "";
    if (!existing || updatedAt >= existingUpdatedAt) latestById[transactionId] = row;
  });

  var transactions = Object.keys(latestById).map(function (id) { return latestById[id]; });
  var eligible = transactions.filter(isCollectiveGoalTransactionEligible_);
  var amount = eligible.reduce(function (total, transaction) {
    return total + collectiveGoalToNumber_(
      transaction.total_encaisse_ttc != null && transaction.total_encaisse_ttc !== ""
        ? transaction.total_encaisse_ttc
        : transaction.total_encaisse != null && transaction.total_encaisse !== ""
          ? transaction.total_encaisse
          : transaction.total_catalogue_ttc != null && transaction.total_catalogue_ttc !== ""
            ? transaction.total_catalogue_ttc
            : transaction.total_catalogue,
      0
    );
  }, 0);
  amount = Math.round((amount + Number.EPSILON) * 100) / 100;

  return {
    available: true,
    goal_id: goal.id,
    title: goal.title,
    starts_on: goal.starts_on,
    ends_on: goal.ends_on,
    target: goal.target,
    amount: amount,
    percent: Math.floor(amount / goal.target * 100),
    remaining: Math.max(0, Math.round((goal.target - amount + Number.EPSILON) * 100) / 100),
    eligible_day_count: goal.journee_ids.length,
    transaction_count: eligible.length,
    updated_at: new Date().toISOString()
  };
}

function isCollectiveGoalTransactionEligible_(transaction) {
  if (!transaction || typeof transaction !== "object") return false;
  var status = collectiveGoalNormalizeStatus_(transaction.statut);
  var paymentStatus = collectiveGoalNormalizeStatus_(transaction.paiement_statut);
  var excluded = ["annule", "annulee", "refuse", "refusee", "paiement_en_attente", "sumup_lance", "en_attente", "attente"];
  if (excluded.indexOf(status) >= 0 || excluded.indexOf(paymentStatus) >= 0) return false;

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
