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


/**
 * Diagnostic privé, exécutable UNIQUEMENT depuis l'éditeur Apps Script.
 * Aucun routeur HTTP n'appelle cette fonction.
 *
 * Propriétés temporaires à renseigner dans le projet Apps Script :
 * - SUMUP_DIAG_TRANSACTION_CODE : code natif de la transaction SumUp
 * - SUMUP_DIAG_FOREIGN_ID : référence externe Lugdurum attendue
 * - SUMUP_DIAG_EXPECTED_AMOUNT : montant attendu en EUR (ex. 33.99)
 *
 * Cette fonction ne crée, ne modifie et ne rembourse aucune transaction.
 * Son journal contient uniquement des statuts/booleens : ni clé, ni
 * référence réelle, ni coordonnées bancaires, ni réponse brute SumUp.
 */
function lugdurumDiagnoseSumupCorrelation() {
  const props = PropertiesService.getScriptProperties();
  const transactionCode = String(props.getProperty("SUMUP_DIAG_TRANSACTION_CODE") || "").trim().toUpperCase();
  const foreignId = String(props.getProperty("SUMUP_DIAG_FOREIGN_ID") || "").trim();
  const expectedAmount = Number(String(props.getProperty("SUMUP_DIAG_EXPECTED_AMOUNT") || "").replace(",", "."));
  const apiKey = props.getProperty("SUMUP_API_KEY");
  const merchant = String(props.getProperty("SUMUP_MERCHANT_CODE") || "").trim();

  // Empêche d'interroger un compte ou une référence non validée par l'opérateur.
  if (!/^[A-Z0-9]{8,20}$/.test(transactionCode) ||
      !/^LUG_[0-9]{13}_[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(foreignId) ||
      !Number.isFinite(expectedAmount) || expectedAmount <= 0 ||
      Math.abs(expectedAmount * 100 - Math.round(expectedAmount * 100)) > 0.00001 ||
      !apiKey || !/^[a-zA-Z0-9_-]{4,32}$/.test(merchant)) {
    throw new Error("Paramètres du diagnostic SumUp manquants ou invalides.");
  }

  const baseUrl = "https://api.sumup.com/v2.1/merchants/" +
    encodeURIComponent(merchant) + "/transactions?";
  const query = (parameter, value) => {
    let response;
    try {
      response = UrlFetchApp.fetch(baseUrl + parameter + "=" + encodeURIComponent(value), {
        method: "get",
        timeoutSeconds: 6,
        followRedirects: false,
        muteHttpExceptions: true,
        headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" }
      });
    } catch (_error) {
      return { http_status: 0, found: false, error: "NETWORK_ERROR" };
    }

    const status = response.getResponseCode();
    if (status !== 200) {
      return { http_status: status, found: false };
    }

    let tx;
    try {
      tx = JSON.parse(response.getContentText());
    } catch (_error) {
      return { http_status: 200, found: false, error: "INVALID_JSON" };
    }
    if (!tx || typeof tx !== "object" || Array.isArray(tx)) {
      return { http_status: 200, found: false, error: "INVALID_RESPONSE" };
    }

    return {
      http_status: 200,
      found: true,
      code_matches: String(tx.transaction_code || "").toUpperCase() === transactionCode,
      foreign_id_present: Boolean(String(tx.foreign_transaction_id || "").trim()),
      foreign_id_matches: String(tx.foreign_transaction_id || "") === foreignId,
      merchant_matches: String(tx.merchant_code || "") === merchant,
      amount_matches: Number.isFinite(Number(tx.amount)) &&
        Math.round(Number(tx.amount) * 100) === Math.round(expectedAmount * 100),
      currency_matches: String(tx.currency || "").toUpperCase() === "EUR",
      status: String(tx.status || "").toUpperCase(),
      simple_status: String(tx.simple_status || "").toUpperCase()
    };
  };

  const byCode = query("transaction_code", transactionCode);
  const byForeignId = query("foreign_transaction_id", foreignId);
  const result = {
    diagnostic: "SUMUP_CORRELATION_READ_ONLY",
    by_transaction_code: byCode,
    by_foreign_transaction_id: byForeignId
  };
  Logger.log(JSON.stringify(result));
  return result;
}
