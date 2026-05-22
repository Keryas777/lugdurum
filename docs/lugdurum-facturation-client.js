(() => {
  "use strict";

  /*
    Lugdurum Facturation Client V1
    - Communication Webapp Lugdurum → Cloudflare Worker facturation.
    - Ne communique jamais directement avec VosFactures.
    - Ne stocke jamais le token API VosFactures.
    - Pas de file d’attente offline pour éviter les doublons de factures.
    - Utilise commande_id comme oid externe pour limiter les doublons côté VosFactures.
    - Expose window.LugdurumFacturation.
  */

  const DEFAULT_WORKER_URL = "";
  const DEFAULT_ALLOWED_ORIGIN = "https://keryas777.github.io";

  const STORAGE_KEYS = {
    workerUrl: "lugdurum_facturation_worker_url",
    accessKey: "lugdurum_facturation_access_key",
    lastState: "lugdurum_facturation_state"
  };

  const STATUS_LABELS = {
    idle: "Facturation prête",
    loading: "Facturation en cours",
    online: "Facturation OK",
    error: "Erreur facturation",
    offline: "Hors ligne"
  };

  const nowIso = () => new Date().toISOString();

  const safeLocalGet = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const safeLocalSet = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // localStorage peut être indisponible.
    }
  };

  const safeLocalRemove = (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // localStorage peut être indisponible.
    }
  };

  const readJson = (key, fallback) => {
    try {
      const raw = safeLocalGet(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    safeLocalSet(key, JSON.stringify(value));
  };

  const toArray = (value) => (Array.isArray(value) ? value : []);

  const isOnline = () => navigator.onLine !== false;

  const cleanString = (value) => String(value ?? "").trim();

  const getWorkerUrl = () =>
    cleanString(safeLocalGet(STORAGE_KEYS.workerUrl) || DEFAULT_WORKER_URL)
      .replace(/\/+$/, "");

  const getAccessKey = () =>
    cleanString(safeLocalGet(STORAGE_KEYS.accessKey));

  const setState = (status, details = {}) => {
    const safeStatus = STATUS_LABELS[status] ? status : "idle";

    const state = {
      ...details,
      status: safeStatus,
      label: details.label || STATUS_LABELS[safeStatus],
      message: cleanString(details.message),
      updated_at: nowIso()
    };

    writeJson(STORAGE_KEYS.lastState, state);

    window.dispatchEvent(
      new CustomEvent("lugdurum:facturation-status", {
        detail: state
      })
    );

    return state;
  };

  const getState = () =>
    readJson(STORAGE_KEYS.lastState, {
      status: "idle",
      label: STATUS_LABELS.idle,
      message: "",
      updated_at: ""
    });

  const configure = ({ workerUrl, accessKey } = {}) => {
    if (workerUrl !== undefined) {
      const url = cleanString(workerUrl);

      if (url) {
        safeLocalSet(STORAGE_KEYS.workerUrl, url);
      } else {
        safeLocalRemove(STORAGE_KEYS.workerUrl);
      }
    }

    if (accessKey !== undefined) {
      const key = cleanString(accessKey);

      if (key) {
        safeLocalSet(STORAGE_KEYS.accessKey, key);
      } else {
        safeLocalRemove(STORAGE_KEYS.accessKey);
      }
    }

    setState("idle", {
      message: "Configuration facturation mise à jour."
    });

    return getConfig();
  };

  const getConfig = () => ({
    worker_url: getWorkerUrl(),
    has_access_key: Boolean(getAccessKey()),
    allowed_origin: DEFAULT_ALLOWED_ORIGIN
  });

  const buildUrl = (path = "") => {
    const base = getWorkerUrl();

    if (!base) {
      throw new Error("URL du Worker facturation manquante.");
    }

    const cleanPath = String(path || "").startsWith("/")
      ? String(path || "")
      : `/${path || ""}`;

    return `${base}${cleanPath}`;
  };

  const parseJsonResponse = async (response, action) => {
    let result = null;

    try {
      result = await response.json();
    } catch {
      throw new Error(`Réponse JSON illisible sur ${action}.`);
    }

    if (!response.ok || !result?.ok) {
      const message =
        result?.error ||
        result?.message ||
        `Erreur HTTP ${response.status} sur ${action}.`;

      const error = new Error(message);
      error.status = response.status;
      error.result = result;
      throw error;
    }

    return Object.prototype.hasOwnProperty.call(result, "data")
      ? result.data
      : result;
  };

  const requestJson = async (path, options = {}) => {
    const action = options.action || path;

    if (!isOnline()) {
      setState("offline", {
        message: "Connexion indisponible."
      });

      throw new Error("Impossible de contacter la facturation hors ligne.");
    }

    const accessKey = getAccessKey();

    if (!accessKey) {
      throw new Error("Clé interne facturation manquante.");
    }

    setState("loading", {
      message: action
    });

    let response;

    try {
      response = await fetch(buildUrl(path), {
        method: options.method || "GET",
        cache: "no-store",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-Lugdurum-Key": accessKey
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch (error) {
      setState("error", {
        message: error.message,
        last_action: action
      });

      throw new Error(`Worker facturation inaccessible : ${error.message}`);
    }

    try {
      const data = await parseJsonResponse(response, action);

      setState("online", {
        message: action,
        last_action: action
      });

      return data;
    } catch (error) {
      setState("error", {
        message: error.message,
        last_action: action
      });

      throw error;
    }
  };

  const fetchBlob = async (path, options = {}) => {
    const action = options.action || path;

    if (!isOnline()) {
      setState("offline", {
        message: "Connexion indisponible."
      });

      throw new Error("Impossible de télécharger un PDF hors ligne.");
    }

    const accessKey = getAccessKey();

    if (!accessKey) {
      throw new Error("Clé interne facturation manquante.");
    }

    setState("loading", {
      message: action
    });

    const response = await fetch(buildUrl(path), {
      method: options.method || "GET",
      cache: "no-store",
      headers: {
        "X-Lugdurum-Key": accessKey
      }
    });

    if (!response.ok) {
      let message = `Erreur HTTP ${response.status} sur ${action}.`;

      try {
        const result = await response.json();
        message = result?.error || result?.message || message;
      } catch {
        // Réponse non JSON.
      }

      setState("error", {
        message,
        last_action: action
      });

      throw new Error(message);
    }

    const blob = await response.blob();

    setState("online", {
      message: action,
      last_action: action
    });

    return blob;
  };

  const normalizeInvoicePayload = (payload = {}) => {
    const invoice = payload.invoice || payload;

    if (!invoice || typeof invoice !== "object") {
      throw new Error("Payload facture invalide.");
    }

    const buyerName = cleanString(invoice.buyer_name);
    const positions = toArray(invoice.positions).filter(Boolean);

    if (!buyerName) {
      throw new Error("Le nom du client est obligatoire.");
    }

    if (positions.length === 0) {
      throw new Error("La facture doit contenir au moins une ligne.");
    }

    return {
      invoice: {
        ...invoice,
        kind: cleanString(invoice.kind || "vat"),
        number: invoice.number ?? null,
        positions
      }
    };
  };

  const createInvoice = (payload = {}) =>
    requestJson("/invoices", {
      method: "POST",
      action: "createInvoice",
      body: normalizeInvoicePayload(payload)
    });

  const getInvoice = (invoiceId) => {
    const id = cleanString(invoiceId);

    if (!id) {
      throw new Error("ID facture manquant.");
    }

    return requestJson(`/invoices/${encodeURIComponent(id)}`, {
      action: "getInvoice"
    });
  };

  const sendInvoiceByEmail = (invoiceId) => {
    const id = cleanString(invoiceId);

    if (!id) {
      throw new Error("ID facture manquant.");
    }

    return requestJson(`/invoices/${encodeURIComponent(id)}/send`, {
      method: "POST",
      action: "sendInvoiceByEmail"
    });
  };

  const getInvoicePdfBlob = (invoiceId) => {
    const id = cleanString(invoiceId);

    if (!id) {
      throw new Error("ID facture manquant.");
    }

    return fetchBlob(`/invoices/${encodeURIComponent(id)}/pdf`, {
      action: "getInvoicePdf"
    });
  };

  const openInvoicePdf = async (invoiceId) => {
    const blob = await getInvoicePdfBlob(invoiceId);
    const url = URL.createObjectURL(blob);

    window.open(url, "_blank", "noopener,noreferrer");

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60_000);

    return {
      ok: true
    };
  };

  const buildInvoiceFromDraft = ({
    client,
    commande,
    lignes,
    options = {}
  } = {}) => {
    const safeClient = client || {};
    const safeCommande = commande || {};
    const safeLignes = toArray(lignes);

    const issueDate =
      cleanString(options.issue_date) ||
      cleanString(safeCommande.date_commande) ||
      new Date().toISOString().slice(0, 10);

    const paymentTo =
      cleanString(options.payment_to) ||
      cleanString(safeCommande.date_echeance) ||
      issueDate;

    const commandeId =
      cleanString(safeCommande.commande_id) ||
      cleanString(options.commande_id);

    const positions = safeLignes.map((line) => ({
      name: cleanString(
        line.nom_produit ||
        line.produit_nom ||
        line.libelle ||
        line.name
      ),
      quantity: Number(line.quantite || line.quantity || 1),
      tax: Number(line.taux_tva ?? line.tax ?? 0),
      total_price_gross: Number(
        line.total_ligne_ttc ??
        line.total_ttc ??
        line.total_price_gross ??
        0
      )
    }));

    return normalizeInvoicePayload({
      invoice: {
        kind: "vat",
        number: null,

        oid: commandeId || undefined,

        sell_date: issueDate,
        issue_date: issueDate,
        payment_to: paymentTo,

        buyer_name: cleanString(
          safeClient.raison_sociale ||
          safeClient.nom_commercial ||
          safeClient.nom ||
          safeClient.buyer_name
        ),
        buyer_tax_no: cleanString(
          safeClient.siret ||
          safeClient.siren ||
          safeClient.buyer_tax_no
        ),
        buyer_email: cleanString(safeClient.email),
        buyer_street: cleanString(safeClient.adresse || safeClient.buyer_street),
        buyer_post_code: cleanString(safeClient.code_postal || safeClient.buyer_post_code),
        buyer_city: cleanString(safeClient.ville || safeClient.buyer_city),

        positions,

        description:
          cleanString(options.description) ||
          "TVA non applicable, art. 293 B du CGI"
      }
    });
  };

  window.LugdurumFacturation = {
    configure,
    getConfig,
    getState,
    setState,

    createInvoice,
    getInvoice,
    sendInvoiceByEmail,
    getInvoicePdfBlob,
    openInvoicePdf,

    buildInvoiceFromDraft,

    isOnline
  };

  window.addEventListener("online", () => {
    setState("idle", {
      message: "Connexion retrouvée."
    });
  });

  window.addEventListener("offline", () => {
    setState("offline", {
      message: "Connexion perdue."
    });
  });

  setState(getState().status || "idle", {
    ...getState(),
    message: getState().message || ""
  });
})();
