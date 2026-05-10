/* /docs/lugdurum-api.js */

(() => {
  "use strict";

  const API_URL = "COLLE_ICI_TON_URL_APPS_SCRIPT_EXEC";

  const buildUrl = (action, params = {}) => {
    const url = new URL(API_URL);

    url.searchParams.set("action", action);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });

    return url.toString();
  };

  const request = async (action, params = {}) => {
    const response = await fetch(buildUrl(action, params), {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Erreur API ${response.status}`);
    }

    const payload = await response.json();

    if (!payload.ok) {
      throw new Error(payload.error || "Erreur API inconnue");
    }

    return payload.data ?? payload;
  };

  const getCatalogue = () => request("getCatalogue");

  const getMissions = () => request("getMissions");

  const ping = () => request("ping");

  window.LugdurumAPI = {
    ping,
    getCatalogue,
    getMissions
  };
})();
