const API_HOME_URL = ""; // Plus tard : "/api/home" ou l'URL du Worker/Apps Script.

const fallbackHomeState = {
  user: {
    user_id: "U_JEROME",
    nom: "Jérôme",
    role: "admin"
  },
  mission_active: {
    mission_id: "M202605_SALAGNON",
    nom: "Salagnon",
    ville: "Salagnon",
    date_debut: "2026-05-03",
    date_fin: "2026-05-04",
    statut: "en_cours"
  },
  journee_active: {
    journee_id: "J20260504_SALAGNON",
    date: "2026-05-04",
    jour_label: "J2",
    statut: "en_cours"
  },
  resume_journee: {
    ca_jour_ttc: 0,
    nb_transactions: 0,
    ventes_en_attente_sync: 0,
    stock_non_compte: true,
    frais_non_saisis: false
  }
};

const formatEuro = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0
});

const formatDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric"
});

function qs(selector) {
  return document.querySelector(selector);
}

async function loadHomeState() {
  if (!API_HOME_URL) return fallbackHomeState;

  try {
    const response = await fetch(API_HOME_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Erreur API ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn("Impossible de charger les données réelles, fallback local utilisé.", error);
    return fallbackHomeState;
  }
}

function renderHome(state) {
  const user = state.user || fallbackHomeState.user;
  const mission = state.mission_active;
  const journee = state.journee_active;
  const resume = state.resume_journee || {};

  qs("#currentUserName").textContent = user.nom || "Utilisateur";

  if (!mission || !journee) {
    qs("#activeStatusLabel").textContent = "Aucune mission active";
    qs("#missionTitle").textContent = "Préparer une mission";
    qs("#missionMeta").textContent = "Crée ou choisis une mission avant de saisir les ventes.";
    qs("#todayRevenue").textContent = "—";
    qs("#todayTickets").textContent = "—";
    qs("#pendingSync").textContent = "—";
    renderWatchList(["Aucune journée active pour le moment."]);
    return;
  }

  const dateLabel = journee.date ? formatDate.format(new Date(`${journee.date}T12:00:00`)) : "date non définie";

  qs("#activeStatusLabel").textContent = "Mission active";
  qs("#missionTitle").textContent = `${mission.nom} — ${journee.jour_label || "Journée"}`;
  qs("#missionMeta").textContent = `${mission.ville || "Lieu à définir"} · ${dateLabel}`;
  qs("#todayRevenue").textContent = formatEuro.format(Number(resume.ca_jour_ttc || 0));
  qs("#todayTickets").textContent = String(resume.nb_transactions || 0);
  qs("#pendingSync").textContent = String(resume.ventes_en_attente_sync || 0);

  qs("#syncStatCard").classList.toggle("hasWarning", Number(resume.ventes_en_attente_sync || 0) > 0);

  renderWatchList(buildWatchItems(resume));
}

function buildWatchItems(resume) {
  const items = [];

  if (Number(resume.ventes_en_attente_sync || 0) > 0) {
    items.push(`${resume.ventes_en_attente_sync} vente(s) en attente de synchronisation.`);
  } else {
    items.push("Toutes les ventes semblent synchronisées.");
  }

  if (resume.stock_non_compte) {
    items.push("Stock de fin pas encore compté pour cette journée.");
  } else {
    items.push("Stock de fin déjà renseigné.");
  }

  if (resume.frais_non_saisis) {
    items.push("Pense à saisir les frais de la mission avant clôture.");
  } else {
    items.push("Aucun frais signalé comme manquant.");
  }

  return items;
}

function renderWatchList(items) {
  const list = qs("#watchList");
  list.innerHTML = "";

  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });
}

function setupDisabledTiles() {
  document.querySelectorAll("[data-disabled='true']").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      alert("Module prévu pour une prochaine étape.");
    });
  });
}

async function initHome() {
  setupDisabledTiles();
  const state = await loadHomeState();
  renderHome(state);
}

initHome();
