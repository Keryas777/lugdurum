(() => {
  "use strict";

  /*
    Facturation Pro Hub V4
    - Page d’orientation vers les parcours pro :
      1) Commande ferme + facture
      2) Réapprovisionnement + facture
      3) Saisie historique pro
      4) Liste des factures pro
    - Aucun appel API.
    - Aucune création de facture.
    - Pas d’indicateur de statut visuel : cette page est un hub simple.
  */

  const statusTitle = document.getElementById("facturationProStatusTitle");
  const statusText = document.getElementById("facturationProStatusText");
  const flowTiles = Array.from(document.querySelectorAll("[data-flow]"));

  const STATUS_MESSAGES = {
    idle: {
      title: "Choisir une opération",
      text: "Commande ferme, dépôt-vente, historique ou consultation des factures."
    },
    "commande-ferme": {
      title: "Commande ferme",
      text: "Ouverture du formulaire de commande ferme et de facturation."
    },
    "historique-pro": {
      title: "Saisie historique pro",
      text: "Ouverture du rattrapage des anciennes commandes déjà facturées."
    },
    "factures-pro": {
      title: "Liste des factures",
      text: "Ouverture du tableau des factures pro et de leurs détails."
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

  const setStatus = (messageKey) => {
    const message = STATUS_MESSAGES[messageKey] || STATUS_MESSAGES.idle;

    if (statusTitle) {
      statusTitle.textContent = message.title;
    }

    if (statusText) {
      statusText.textContent = message.text;
    }
  };

  const bindTiles = () => {
    flowTiles.forEach((tile) => {
      tile.addEventListener("click", (event) => {
        const ready = tile.dataset.ready === "true";
        const flow = tile.dataset.flow || "";

        if (ready) {
          setStatus(flow);
          return;
        }

        event.preventDefault();

        if (flow === "reappro") {
          setStatus("reappro");
          return;
        }

        setStatus("unavailable");
      });
    });
  };

  const init = () => {
    bindTiles();
    setStatus("idle");
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();