/**
 * Lugdurum — module serveur SumUp (pilote, désactivé côté PWA).
 * Versionné dans apps-script/ ; route GET dans 01_http_router.js.
 * Nécessite SUMUP_API_KEY et SUMUP_MERCHANT_CODE dans les propriétés DU SCRIPT.
 * Aucun secret SumUp dans le dépôt ou dans le navigateur.
 *
 * Ne jamais renvoyer la clé ni la réponse brute de SumUp au navigateur.
 * GET JSONP = publiquement accessible dans le déploiement actuel :
 * les références nouvelles doivent être cryptographiquement aléatoires.
 */

function lugdurumGetSumupPaymentStatus(params) {
  const id = String(params.foreign_tx_id || "").trim();
  const currency = String(params.currency || "").trim().toUpperCase();
  const expectedAmount = Number(String(params.amount || "").replace(",", "."));

  // Références historiques de 6 caractères NON admises en vérification API.
  // LUG_<timestamp>_<UUID> (une capacité imprévisible par paiement).
  if (!/^LUG_[0-9]{13}_[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(id)) {
    return { verified: false, status: "UNSUPPORTED_ID" };
  }

  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0 || expectedAmount > 10000 ||
      Math.abs(expectedAmount * 100 - Math.round(expectedAmount * 100)) > 0.00001) {
    return { verified: false, status: "INVALID_REQUEST" };
  }
  if (currency !== "EUR") return { verified: false, status: "INVALID_REQUEST" };

  const properties = PropertiesService.getScriptProperties();
  const secret = properties.getProperty("SUMUP_API_KEY");
  const merchantCode = properties.getProperty("SUMUP_MERCHANT_CODE");
  if (!secret || !merchantCode || !/^[a-zA-Z0-9_-]{4,32}$/.test(merchantCode)) {
    return { verified: false, status: "NOT_CONFIGURED" };
  }

  const apiUrl =
    "https://api.sumup.com/v2.1/merchants/" +
    encodeURIComponent(merchantCode) +
    "/transactions?foreign_transaction_id=" +
    encodeURIComponent(id);

  let response;
  try {
    response = UrlFetchApp.fetch(apiUrl, {
      method: "get",
      followRedirects: false,
      muteHttpExceptions: true,
      headers: {
        Authorization: "Bearer " + secret,
        Accept: "application/json"
      }
    });
  } catch (_error) {
    return { verified: false, status: "UNAVAILABLE" };
  }

  const code = response.getResponseCode();
  // Une transaction peut mettre un peu de temps à apparaître dans l'API.
  if (code === 404) return { verified: false, status: "NOT_FOUND", retryable: true };
  if (code === 401 || code === 403) return { verified: false, status: "NOT_AUTHORIZED" };
  if (code !== 200) return { verified: false, status: "UNAVAILABLE", retryable: code >= 500 };

  let tx;
  try {
    tx = JSON.parse(response.getContentText());
  } catch (_error) {
    return { verified: false, status: "UNAVAILABLE" };
  }

  if (!tx || typeof tx !== "object") {
    return { verified: false, status: "UNAVAILABLE" };
  }

  // Contrôles indépendants : référence, compte, montant ET devise.
  if (String(tx.foreign_transaction_id || "") !== id ||
      String(tx.merchant_code || "") !== merchantCode ||
      String(tx.currency || "").toUpperCase() !== currency ||
      !Number.isFinite(Number(tx.amount)) ||
      Math.round(Number(tx.amount) * 100) !== Math.round(expectedAmount * 100)) {
    return { verified: false, status: "MISMATCH" };
  }

  const paymentStatus = String(tx.status || "").toUpperCase();
  const simpleStatus = String(tx.simple_status || "").toUpperCase();

  // Remboursement / chargeback prevaut toujours sur un ancien succes.
  const invalidStatuses = ["REFUNDED", "CHARGEBACK", "CHARGE_BACK", "CANCELLED", "FAILED", "NON_COLLECTION"];
  if (invalidStatuses.includes(simpleStatus) || invalidStatuses.includes(paymentStatus)) {
    return { verified: false,
      status: invalidStatuses.includes(simpleStatus) ? simpleStatus : paymentStatus };
  }

  if (paymentStatus === "SUCCESSFUL" &&
      (!simpleStatus || simpleStatus === "SUCCESSFUL" || simpleStatus === "PAID_OUT")) {
    return {
      verified: true,
      status: "SUCCESSFUL",
      foreign_tx_id: id,
      transaction_code: String(tx.transaction_code || "")
    };
  }

  return { verified: false, status: paymentStatus || simpleStatus || "PENDING",
    retryable: paymentStatus === "PENDING" || simpleStatus === "PENDING" };
}
