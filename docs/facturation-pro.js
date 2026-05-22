(() => {
  "use strict";

  /*
    Facturation Pro Hub V1
    - Page d’orientation vers les deux parcours pro :
      1) Réapprovisionnement + facture
      2) Commande ferme + facture
    - Aucun appel API.
    - Aucune création de facture.
  */

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme"
  };

  const statusTitle = document.getElementById("facturationProStatusTitle");
  const statusText = document.getElementById("facturationProStatusText");
  const statusDot = document.getElementById("facturationProStatusDot");
  const userName = document.getElementById("currentUserName");
  const flowTiles = Array.from(document.querySelectorAll("[data-flow]"));

  const setStatus = (type, title, text) => {
    if (statusTitle) statusTitle.textContent = title;
    if (statusText) statusText.textContent = text;

    if (!statusDot) return;

    statusDot.classList.remove("isIdle", "isOnline", "isWarning");

    if (type === "warning") {
      statusDot.classList.add("isWarning");
    } else if (type === "online") {
      statusDot.classList.add("isOnline");
    } else {
      statusDot.classList.add("isIdle");
    }
  };

  const initUser = () => {
    if (!userName) return;
    userName.textContent = CURRENT_USER.nom;
  };

  const bindTiles = () => {
    flowTiles.forEach((tile) => {
      tile.addEventListener("click", (event) => {
        const ready = tile.dataset.ready === "true";
        const flow = tile.dataset.flow || "";

        if (ready) {
          setStatus(
            "online",
            "Ouverture du parcours",
            "Tu passes sur le formulaire de commande ferme et de facturation."
          );
          return;
        }

        event.preventDefault();

        if (flow === "reappro") {
          setStatus(
            "warning",
            "Réapprovisionnement à créer",
            "Ce parcours sera branché ensuite : bon de réapprovisionnement, suivi des ventes dépôt, puis facture sur les quantités vendues."
          );
          return;
        }

        setStatus(
          "warning",
          "Parcours indisponible",
          "Cette page n’est pas encore disponible."
        );
      });
    });
  };

  const init = () => {
    initUser();
    bindTiles();

    setStatus(
      "idle",
      "Choisis le type d’opération",
      "Prépare un dépôt/réassort ou une commande ferme, puis génère une facture uniquement au bon moment."
    );
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
