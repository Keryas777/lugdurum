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

  const startMs = Date.now();
  let sumupFetchMs = null;
  // Ne renvoyer que des durées, jamais la clé, le code marchand ni la réponse SumUp.
  const respond_ = (result) => ({
    ...result,
    timing: {
      apps_script_ms: Date.now() - startMs,
      sumup_fetch_ms: sumupFetchMs
    }
  });


  // Références historiques de 6 caractères NON admises en vérification API.
  // LUG_<timestamp>_<UUID> (une capacité imprévisible par paiement).
  if (!/^LUG_[0-9]{13}_[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(id)) {
    return respond_({ verified: false, status: "UNSUPPORTED_ID" });
  }

  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0 || expectedAmount > 10000 ||
      Math.abs(expectedAmount * 100 - Math.round(expectedAmount * 100)) > 0.00001) {
    return respond_({ verified: false, status: "INVALID_REQUEST" });
  }
  if (currency !== "EUR") return respond_({ verified: false, status: "INVALID_REQUEST" });

  const properties = PropertiesService.getScriptProperties();
  const secret = properties.getProperty("SUMUP_API_KEY");
  const merchantCode = properties.getProperty("SUMUP_MERCHANT_CODE");
  if (!secret || !merchantCode || !/^[a-zA-Z0-9_-]{4,32}$/.test(merchantCode)) {
    return respond_({ verified: false, status: "NOT_CONFIGURED" });
  }

  const apiUrl =
    "https://api.sumup.com/v2.1/merchants/" +
    encodeURIComponent(merchantCode) +
    "/transactions?foreign_transaction_id=" +
    encodeURIComponent(id);

  const fetchStartMs = Date.now();
  let response;
  try {
    response = UrlFetchApp.fetch(apiUrl, {
      // Le client PWA abandonne après 10 s. Sans limite explicite, UrlFetch
      // peut poursuivre très longtemps après la disparition du callback JSONP.
      timeoutSeconds: 6,
      method: "get",
      followRedirects: false,
      muteHttpExceptions: true,
      headers: {
        Authorization: "Bearer " + secret,
        Accept: "application/json"
      }
    });
  } catch (_error) {
    sumupFetchMs = Date.now() - fetchStartMs;
    return respond_({ verified: false, status: "UNAVAILABLE", retryable: true });
  }

  sumupFetchMs = Date.now() - fetchStartMs;
  const code = response.getResponseCode();
  // Une transaction peut mettre un peu de temps à apparaître dans l'API.
  if (code === 404) return respond_({ verified: false, status: "NOT_FOUND", retryable: true });
  if (code === 401 || code === 403) return respond_({ verified: false, status: "NOT_AUTHORIZED" });
  if (code !== 200) return respond_({ verified: false, status: "UNAVAILABLE", retryable: code >= 500 });

  let tx;
  try {
    tx = JSON.parse(response.getContentText());
  } catch (_error) {
    return respond_({ verified: false, status: "UNAVAILABLE" });
  }

  if (!tx || typeof tx !== "object") {
    return respond_({ verified: false, status: "UNAVAILABLE" });
  }

  // Contrôles indépendants : référence, compte, montant ET devise.
  if (String(tx.foreign_transaction_id || "") !== id ||
      String(tx.merchant_code || "") !== merchantCode ||
      String(tx.currency || "").toUpperCase() !== currency ||
      !Number.isFinite(Number(tx.amount)) ||
      Math.round(Number(tx.amount) * 100) !== Math.round(expectedAmount * 100)) {
    return respond_({ verified: false, status: "MISMATCH" });
  }

  const paymentStatus = String(tx.status || "").toUpperCase();
  const simpleStatus = String(tx.simple_status || "").toUpperCase();

  // Remboursement / chargeback prevaut toujours sur un ancien succes.
  const invalidStatuses = ["REFUNDED", "CHARGEBACK", "CHARGE_BACK", "CANCELLED", "FAILED", "NON_COLLECTION"];
  if (invalidStatuses.includes(simpleStatus) || invalidStatuses.includes(paymentStatus)) {
    return respond_({ verified: false,
      status: invalidStatuses.includes(simpleStatus) ? simpleStatus : paymentStatus });
  }

  if (paymentStatus === "SUCCESSFUL" &&
      (!simpleStatus || simpleStatus === "SUCCESSFUL" || simpleStatus === "PAID_OUT")) {
    return respond_({
      verified: true,
      status: "SUCCESSFUL",
      foreign_tx_id: id,
      transaction_code: String(tx.transaction_code || "")
    });
  }

  return respond_({ verified: false, status: paymentStatus || simpleStatus || "PENDING",
    retryable: paymentStatus === "PENDING" || simpleStatus === "PENDING" });
}
