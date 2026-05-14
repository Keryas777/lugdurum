(() => {
  "use strict";

  const API_URL = "COLLE_ICI_TON_URL_APPS_SCRIPT_EXEC";

  const requestGet = async (action) => {
    if (!API_URL) {
      throw new Error("API_URL manquante dans lugdurum-api.js");
    }

    const url = new URL(API_URL);
    url.searchParams.set("action", action);

    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Erreur API ${response.status}`);
    }

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || `Erreur API sur ${action}`);
    }

    return result.data;
  };

  const requestPost = async (action, payload = {}) => {
    if (!API_URL) {
      throw new Error("API_URL manquante dans lugdurum-api.js");
    }

    const response = await fetch(API_URL, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        action,
        ...payload
      })
    });

    if (!response.ok) {
      throw new Error(`Erreur API ${response.status}`);
    }

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || `Erreur API sur ${action}`);
    }

    return result.data;
  };

  window.LugdurumAPI = {
    ping() {
      return requestGet("ping");
    },

    getSpreadsheetInfo() {
      return requestGet("getSpreadsheetInfo");
    },

    getCatalogue() {
      return requestGet("getCatalogue");
    },

    getOffresVente() {
      return requestGet("getOffresVente");
    },

    getInscriptionsEvenements() {
      return requestGet("getInscriptionsEvenements");
    },

    getInscriptions() {
      return requestGet("getInscriptionsEvenements");
    },

    saveInscriptionEvenement(inscription) {
      return requestPost("upsertInscriptionEvenement", {
        inscription
      });
    },

    cancelInscriptionEvenement(inscriptionId) {
      return requestPost("cancelInscriptionEvenement", {
        inscription_id: inscriptionId
      });
    },

    saveInscriptionEventBundle({ inscription, event, mission, journees }) {
      return requestPost("saveInscriptionEventBundle", {
        inscription,
        event,
        mission,
        journees
      });
    },

    getMissions() {
      return requestGet("getMissions");
    },

    saveMission(mission) {
      return requestPost("upsertMission", {
        mission
      });
    },

    getMissionsStock() {
      return requestGet("getMissionsStock");
    },

    saveMissionStock(mission) {
      return requestPost("upsertMissionStock", {
        mission
      });
    },

    saveMissionStockBundle({ mission, mission_stock, journees }) {
      return requestPost("saveMissionStockBundle", {
        mission,
        mission_stock,
        journees
      });
    },

    getJournees() {
      return requestGet("getJournees");
    },

    getJourneesVente() {
      return requestGet("getJournees");
    },

    saveJournee(journee) {
      return requestPost("upsertJournee", {
        journee
      });
    },

    getTransactions() {
      return requestGet("getTransactions");
    },

    getVentesLignes() {
      return requestGet("getVentesLignes");
    },

    saveTransaction(transaction) {
      return requestPost("saveTransaction", {
        transaction
      });
    },

    getFrais() {
      return requestGet("getFrais");
    },

    saveFrais(frais) {
      return requestPost("upsertFrais", {
        frais
      });
    },

    batchUpsert(operations) {
      return requestPost("batchUpsert", {
        operations
      });
    }
  };
})();