(() => {
  "use strict";

  /*
    Facturation Pro Hub V2
    - Page d’orientation vers les parcours pro :
      1) Commande ferme + facture
      2) Réapprovisionnement + facture
      3) Saisie historique pro
    - Aucun appel API.
    - Aucune création de facture.
  */

  const statusTitle = document.getElementById("facturationProStatusTitle");
  const statusText = document.getElementById("facturationProStatusText");
  const statusDot = document.getElementById("facturationProStatusDot");
  const flowTiles = Array.from(document.querySelectorAll("[data-flow]"));

  const STATUS_MESSAGES = {
    idle: {
      title: "Choisir une opération",
      text: "Commande ferme, dépôt-vente ou rattrapage d’anciennes factures."
    },
    "commande-ferme": {
      title: "Commande ferme",
      text: "Ouverture du formulaire de commande ferme et de facturation."
    },
    "historique-pro": {
      title: "Saisie historique pro",
      text: "Ouverture du rattrapage des anciennes commandes déjà facturées."
    },
    reappro: {
      title: "Réapprovisionnement à créer",
      text: "Ce parcours sera branché ensuite : bon de réapprovisionnement, suivi dépôt-vente, puis facture."
    },
    unavailable: {
      title: "Parcours indisponible",
      text: "Cette page n’est pas encore disponible."
    }
  };

  const setStatus = (type, messageKey) => {
    const message = STATUS_MESSAGES[messageKey] || STATUS_MESSAGES.idle;

    if (statusTitle) {
      statusTitle.textContent = message.title;
    }

    if (statusText) {
      statusText.textContent = message.text;
    }

    if (!statusDot) return;

    statusDot.classList.remove("isIdle", "isOnline", "isWarning");

    if (type === "warning") {
      statusDot.classList.add("isWarning");
      return;
    }

    if (type === "online") {
      statusDot.classList.add("isOnline");
      return;
    }

    statusDot.classList.add("isIdle");
  };

  const bindTiles = () => {
    flowTiles.forEach((tile) => {
      tile.addEventListener("click", (event) => {
        const ready = tile.dataset.ready === "true";
        const flow = tile.dataset.flow || "";

        if (ready) {
          setStatus("online", flow);
          return;
        }

        event.preventDefault();

        if (flow === "reappro") {
          setStatus("warning", "reappro");
          return;
        }

        setStatus("warning", "unavailable");
      });
    });
  };

  const init = () => {
    bindTiles();
    setStatus("idle", "idle");
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();