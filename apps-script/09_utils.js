/************************************************************
 * 09_utils.gs
 * ----------------------------------------------------------
 * Utilitaires généraux partagés par les fichiers Apps Script.
 *
 * Objectif :
 * - réponses HTTP / JSON / JSONP ;
 * - parsing robuste des requêtes GET / POST ;
 * - helpers dates, nombres, booléens, JSON ;
 * - génération d’identifiants ;
 * - upsert / index / groupement en mémoire ;
 * - verrous Apps Script ;
 * - helpers de diagnostic et compatibilité.
 *
 * Ce fichier ne contient pas de logique métier Lugdurum.
 ************************************************************/

var UTILS_VERSION = "V16_UTILS_SPLIT";

/* ==========================================================
   Réponses HTTP / API
   ========================================================== */

function makeSuccessResponse(data, meta) {
  var payload = {
    ok: true,
    data: data === undefined ? null : data
  };

  if (meta && typeof meta === "object") {
    Object.keys(meta).forEach(function(key) {
      payload[key] = meta[key];
    });
  }

  return payload;
}

function makeErrorResponse(error, extra) {
  var message =
    error && error.message
      ? error.message
      : String(error || "Erreur inconnue");

  var payload = {
    ok: false,
    error: message
  };

  if (error && error.stack) {
    payload.stack = String(error.stack);
  }

  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach(function(key) {
      payload[key] = extra[key];
    });
  }

  return payload;
}

function outputJson(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function outputText(text) {
  return ContentService
    .createTextOutput(String(text || ""))
    .setMimeType(ContentService.MimeType.TEXT);
}

function outputJsonp(callback, payload) {
  var safeCallback = sanitizeJsonpCallback(callback);

  if (!safeCallback) {
    return outputJson(payload);
  }

  return ContentService
    .createTextOutput(
      safeCallback + "(" + JSON.stringify(payload) + ");"
    )
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function sanitizeJsonpCallback(callback) {
  var value = String(callback || "").trim();

  if (!value) return "";

  if (!/^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(value)) {
    return "";
  }

  return value;
}

function respondSuccess(data, meta, callback) {
  var payload = makeSuccessResponse(data, meta);

  return callback
    ? outputJsonp(callback, payload)
    : outputJson(payload);
}

function respondError(error, extra, callback) {
  var payload = makeErrorResponse(error, extra);

  return callback
    ? outputJsonp(callback, payload)
    : outputJson(payload);
}

/* ==========================================================
   Parsing requêtes Apps Script
   ========================================================== */

function getRequestParams(e) {
  if (!e) return {};

  var params = {};

  if (e.parameter && typeof e.parameter === "object") {
    Object.keys(e.parameter).forEach(function(key) {
      params[key] = e.parameter[key];
    });
  }

  return params;
}

function getRequestAction(e) {
  var params = getRequestParams(e);
  var body = parsePostBody(e, {});

  return utilsString(
    params.action ||
    body.action ||
    ""
  );
}

function getRequestCallback(e) {
  var params = getRequestParams(e);

  return utilsString(
    params.callback ||
    params.jsonp ||
    ""
  );
}

function parsePostBody(e, fallback) {
  var safeFallback = fallback === undefined ? {} : fallback;

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return safeFallback;
    }

    var raw = String(e.postData.contents || "").trim();

    if (!raw) return safeFallback;

    return JSON.parse(raw);
  } catch (error) {
    return safeFallback;
  }
}

function parsePostPayload(e) {
  return parsePostBody(e, {});
}

function getParam(e, key, fallback) {
  var params = getRequestParams(e);

  if (params[key] === undefined || params[key] === null || params[key] === "") {
    return fallback === undefined ? "" : fallback;
  }

  return params[key];
}

function getParamArray(e, key) {
  var value = getParam(e, key, "");

  if (Array.isArray(value)) return value;

  return splitCsv(value);
}

function splitCsv(value) {
  if (Array.isArray(value)) return value;

  return String(value || "")
    .split(",")
    .map(function(item) {
      return utilsString(item);
    })
    .filter(Boolean);
}

/* ==========================================================
   Dates / temps
   ========================================================== */

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return formatDateIso(new Date());
}

function formatDateIso(value) {
  var date = toDate(value);

  if (!date) return "";

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  );
}

function formatDateTimeIso(value) {
  var date = toDate(value);

  if (!date) return "";

  return date.toISOString();
}

function toDate(value) {
  if (!value) return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value;
  }

  var raw = String(value || "").trim();

  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    var parts = raw.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  }

  var date = new Date(raw);

  return isNaN(date.getTime()) ? null : date;
}

function addDays(dateValue, days) {
  var date = toDate(dateValue);

  if (!date) return null;

  var copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + Number(days || 0));

  return copy;
}

function getDateRangeIso(startIso, endIso, maxDays) {
  var start = toDate(startIso);
  var end = toDate(endIso || startIso);
  var limit = Number(maxDays || 31);

  if (!start || !end || end < start) return [];

  var dates = [];
  var cursor = new Date(start.getTime());

  while (cursor <= end && dates.length < limit) {
    dates.push(formatDateIso(cursor));
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

/* ==========================================================
   Types / conversions
   ========================================================== */

function utilsString(value) {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value).trim();
}

function utilsNumber(value, fallback) {
  var safeFallback =
    fallback === undefined || fallback === null
      ? 0
      : fallback;

  if (typeof value === "number" && isFinite(value)) {
    return value;
  }

  var normalized = String(value === null || value === undefined ? "" : value)
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");

  if (!normalized) return safeFallback;

  var number = Number(normalized);

  return isFinite(number) ? number : safeFallback;
}

function utilsBoolean(value, fallback) {
  var safeFallback =
    fallback === undefined || fallback === null
      ? false
      : fallback;

  if (value === true) return true;
  if (value === false) return false;

  if (typeof value === "number") {
    return value !== 0;
  }

  var normalized = utilsString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (!normalized) return safeFallback;

  if (
    [
      "true",
      "vrai",
      "oui",
      "yes",
      "1",
      "x",
      "actif",
      "active",
      "valide",
      "validee",
      "ok"
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
      "inactif",
      "inactive",
      "annule",
      "annulee"
    ].indexOf(normalized) >= 0
  ) {
    return false;
  }

  return safeFallback;
}

function utilsArray(value) {
  return Array.isArray(value) ? value : [];
}

function utilsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function coalesce() {
  for (var i = 0; i < arguments.length; i += 1) {
    var value = arguments[i];

    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  return "";
}

/* ==========================================================
   JSON cellules Sheets
   ========================================================== */

function parseJson(value, fallback) {
  var safeFallback = fallback === undefined ? null : fallback;

  if (value === null || value === undefined || value === "") {
    return safeFallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (error) {
    return safeFallback;
  }
}

function parseJsonArray(value) {
  var parsed = parseJson(value, []);

  return Array.isArray(parsed) ? parsed : [];
}

function parseJsonObject(value) {
  var parsed = parseJson(value, null);

  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : {};
}

function stringifyJsonCell(value) {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") return value;

  return JSON.stringify(value);
}

/* ==========================================================
   Textes / clés / IDs
   ========================================================== */

function normalizeText(value) {
  return utilsString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(value) {
  return normalizeText(value)
    .replace(/[-\s]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "");
}

function slugify(value, fallback, maxLength) {
  var safeFallback = fallback || "ITEM";
  var limit = maxLength || 40;

  var slug = utilsString(value || safeFallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, limit);

  return slug || safeFallback;
}

function generateId(prefix, parts) {
  var safePrefix = slugify(prefix || "ID", "ID", 16);
  var safeParts = utilsArray(parts)
    .map(function(part) {
      return slugify(part, "", 28);
    })
    .filter(Boolean);

  safeParts.push(
    Utilities.getUuid()
      .replace(/-/g, "")
      .slice(0, 10)
      .toUpperCase()
  );

  return [safePrefix].concat(safeParts).join("_");
}

function generateTimestampId(prefix, parts) {
  var safePrefix = slugify(prefix || "ID", "ID", 16);
  var safeParts = utilsArray(parts)
    .map(function(part) {
      return slugify(part, "", 28);
    })
    .filter(Boolean);

  safeParts.push(String(Date.now()));

  return [safePrefix].concat(safeParts).join("_");
}

/* ==========================================================
   Collections / mémoire
   ========================================================== */

function indexBy(items, keyField) {
  var map = {};

  utilsArray(items).forEach(function(item) {
    var key = utilsString(item && item[keyField]);

    if (key) {
      map[key] = item;
    }
  });

  return map;
}

function groupBy(items, getKey) {
  var groups = {};

  utilsArray(items).forEach(function(item) {
    var key =
      typeof getKey === "function"
        ? utilsString(getKey(item))
        : utilsString(item && item[getKey]);

    if (!key) key = "_";

    if (!groups[key]) {
      groups[key] = [];
    }

    groups[key].push(item);
  });

  return groups;
}

function uniqueBy(items, getKey) {
  var map = {};

  utilsArray(items).forEach(function(item, index) {
    var key =
      typeof getKey === "function"
        ? utilsString(getKey(item))
        : utilsString(item && item[getKey]);

    if (!key) {
      key = "__INDEX_" + index;
    }

    map[key] = item;
  });

  return Object.keys(map).map(function(key) {
    return map[key];
  });
}

function mergeByKey(primaryItems, secondaryItems, keyField) {
  var map = {};

  utilsArray(secondaryItems).forEach(function(item) {
    var key = utilsString(item && item[keyField]);
    if (key) map[key] = item;
  });

  utilsArray(primaryItems).forEach(function(item) {
    var key = utilsString(item && item[keyField]);
    if (key) map[key] = item;
  });

  return Object.keys(map).map(function(key) {
    return map[key];
  });
}

function chunkArray(items, size) {
  var list = utilsArray(items);
  var chunkSize = Math.max(1, Number(size || 50));
  var chunks = [];

  for (var i = 0; i < list.length; i += chunkSize) {
    chunks.push(list.slice(i, i + chunkSize));
  }

  return chunks;
}

function sumBy(items, getValue) {
  return utilsArray(items).reduce(function(sum, item) {
    var value =
      typeof getValue === "function"
        ? getValue(item)
        : item && item[getValue];

    return sum + utilsNumber(value, 0);
  }, 0);
}

/* ==========================================================
   Objets / nettoyage
   ========================================================== */

function cleanObject(object) {
  var output = {};

  Object.keys(object || {}).forEach(function(key) {
    var value = object[key];

    if (value === undefined) return;

    output[key] = value;
  });

  return output;
}

function removeEmptyKeys(object) {
  var output = {};

  Object.keys(object || {}).forEach(function(key) {
    var value = object[key];

    if (value === undefined || value === null || value === "") return;

    output[key] = value;
  });

  return output;
}

function pickKeys(object, keys) {
  var output = {};

  utilsArray(keys).forEach(function(key) {
    if (hasOwn(object, key)) {
      output[key] = object[key];
    }
  });

  return output;
}

function omitKeys(object, keys) {
  var skip = {};

  utilsArray(keys).forEach(function(key) {
    skip[key] = true;
  });

  var output = {};

  Object.keys(object || {}).forEach(function(key) {
    if (!skip[key]) {
      output[key] = object[key];
    }
  });

  return output;
}

function shallowClone(object) {
  var output = {};

  Object.keys(object || {}).forEach(function(key) {
    output[key] = object[key];
  });

  return output;
}

/* ==========================================================
   Verrous / sécurité écriture
   ========================================================== */

function withScriptLock(callback, timeoutMs) {
  var lock = LockService.getScriptLock();
  var waitMs = timeoutMs || 30000;

  lock.waitLock(waitMs);

  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function withDocumentLock(callback, timeoutMs) {
  var lock = LockService.getDocumentLock();
  var waitMs = timeoutMs || 30000;

  lock.waitLock(waitMs);

  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

/* ==========================================================
   Logs / diagnostics
   ========================================================== */

function logInfo(label, data) {
  try {
    console.log(
      "[LUGDURUM]",
      label,
      data === undefined ? "" : JSON.stringify(data)
    );
  } catch (error) {
    console.log("[LUGDURUM]", label);
  }
}

function logError(label, error) {
  try {
    console.error(
      "[LUGDURUM ERROR]",
      label,
      error && error.stack ? error.stack : error
    );
  } catch (ignored) {
    console.error("[LUGDURUM ERROR]", label);
  }
}

function buildDebugInfo(extra) {
  var info = {
    ok: true,
    generated_at: nowIso(),
    script_timezone: Session.getScriptTimeZone(),
    utils_version: UTILS_VERSION
  };

  if (typeof CONFIG_VERSION !== "undefined") {
    info.config_version = CONFIG_VERSION;
  }

  if (typeof HTTP_ROUTER_VERSION !== "undefined") {
    info.http_router_version = HTTP_ROUTER_VERSION;
  }

  if (typeof SHEETS_CORE_VERSION !== "undefined") {
    info.sheets_core_version = SHEETS_CORE_VERSION;
  }

  if (typeof GET_DATA_VERSION !== "undefined") {
    info.get_data_version = GET_DATA_VERSION;
  }

  if (typeof HOME_DATA_VERSION !== "undefined") {
    info.home_data_version = HOME_DATA_VERSION;
  }

  if (typeof RECETTES_DATA_VERSION !== "undefined") {
    info.recettes_data_version = RECETTES_DATA_VERSION;
  }

  if (typeof WRITE_BUNDLES_VENTE_VERSION !== "undefined") {
    info.write_bundles_vente_version = WRITE_BUNDLES_VENTE_VERSION;
  }

  if (typeof WRITE_BUNDLES_METIER_VERSION !== "undefined") {
    info.write_bundles_metier_version = WRITE_BUNDLES_METIER_VERSION;
  }

  if (typeof NORMALIZERS_VERSION !== "undefined") {
    info.normalizers_version = NORMALIZERS_VERSION;
  }

  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach(function(key) {
      info[key] = extra[key];
    });
  }

  return info;
}

/* ==========================================================
   Compatibilité anciens noms du code.gs monolithique
   ========================================================== */

function ok_(data, meta) {
  return makeSuccessResponse(data, meta);
}

function error_(error, extra) {
  return makeErrorResponse(error, extra);
}

function json_(payload) {
  return outputJson(payload);
}

function jsonp_(callback, payload) {
  return outputJsonp(callback, payload);
}

function successResponse_(data, meta) {
  return makeSuccessResponse(data, meta);
}

function errorResponse_(error, extra) {
  return makeErrorResponse(error, extra);
}

function toArray_(value) {
  return utilsArray(value);
}

function toObject_(value) {
  return utilsObject(value);
}

function toString_(value) {
  return utilsString(value);
}

function toNumber_(value, fallback) {
  return utilsNumber(value, fallback);
}

function toBoolean_(value, fallback) {
  return utilsBoolean(value, fallback);
}

function parseJson_(value, fallback) {
  return parseJson(value, fallback);
}

function parseJsonArray_(value) {
  return parseJsonArray(value);
}

function parseJsonObject_(value) {
  return parseJsonObject(value);
}

function nowIso_() {
  return nowIso();
}

function todayIso_() {
  return todayIso();
}

function formatDateIso_(value) {
  return formatDateIso(value);
}

function formatDateTimeIso_(value) {
  return formatDateTimeIso(value);
}

function normalizeKey_(value) {
  return normalizeKey(value);
}

function slugify_(value, fallback, maxLength) {
  return slugify(value, fallback, maxLength);
}

function generateId_(prefix, parts) {
  return generateId(prefix, parts);
}

function chunkArray_(items, size) {
  return chunkArray(items, size);
}

function indexBy_(items, keyField) {
  return indexBy(items, keyField);
}

function groupBy_(items, getKey) {
  return groupBy(items, getKey);
}

function uniqueBy_(items, getKey) {
  return uniqueBy(items, getKey);
}

function cleanObject_(object) {
  return cleanObject(object);
}

function removeEmptyKeys_(object) {
  return removeEmptyKeys(object);
}

function withScriptLock_(callback, timeoutMs) {
  return withScriptLock(callback, timeoutMs);
}

function withDocumentLock_(callback, timeoutMs) {
  return withDocumentLock(callback, timeoutMs);
}