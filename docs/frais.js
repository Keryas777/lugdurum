(() => {
  "use strict";

  /*
    Frais V1 :
    - Lit le contexte actif depuis lugdurum_frais_context.
    - Fallback sur lugdurum_preparation_context / activeStockMissionId si besoin.
    - Charge missions_stock, journees_vente et frais depuis Google Sheets si l’API est disponible.
    - Fonctionne en localStorage si l’API n’est pas disponible.
    - Enregistre les frais dans l’onglet frais via LugdurumAPI.saveFrais().
    - La file d’attente offline sera gérée par lugdurum-api.js.
  */

  const CURRENT_USER = {
    user_id: "U_JEROME",
    nom: "Jérôme"
  };

  const OPERATORS = {
    U_JEROME: "Jérôme",
    U_ANTHO: "Antho",
    U_WILL: "Will",
    AUTRE: "Autre"
  };

  const CATEGORY_LABELS = {
    EMPLACEMENT: "Emplacement",
    ESSENCE: "Essence",
    PEAGE: "Péage",
    REPAS: "Repas",
    HEBERGEMENT: "Hébergement",
    MATERIEL: "Matériel",
    COMMUNICATION: "Communication",
    CONSOMMABLES: "Consommables",
    AUTRE: "Autre"
  };

  const PAYMENT_LABELS = {
    CB: "CB",
    ESP: "Espèces",
    CHQ: "Chèque",
    VIR: "Virement",
    AUTRE: "Autre"
  };

  const STORAGE_KEYS = {
    fraisContext: "lugdurum_frais_context",
    preparationContext: "lugdurum_preparation_context",
    activeMissionId: "lugdurum_active_mission_id",
    activeStockMissionId: "lugdurum_active_stock_mission_id",
    activeJourneeId: "lugdurum_active_journee_id",
    stockMissions: "lugdurum_missions_stock",
    journees: "lugdurum_journees",
    frais: "lugdurum_frais"
  };

  const state = {
    context: null,
    stockMission: null,
    missionJournees: [],
    stockMissions: [],
    journees: [],
    frais: [],
    editingId: "",
    isSaving: false
  };

  const els = {
    expensesTitle: document.getElementById("expensesTitle"),
    expensesMissionMeta: document.getElementById("expensesMissionMeta"),
    expensesTotal: document.getElementById("expensesTotal"),
    expensesCount: document.getElementById("expensesCount"),
    expenseDayChips: document.getElementById("expenseDayChips"),

    form: document.getElementById("expenseForm"),
    formTitle: document.getElementById("expenseFormTitle"),
    expenseIdInput: document.getElementById("expenseIdInput"),
    expenseDateInput: document.getElementById("expenseDateInput"),
    expenseDayInput: document.getElementById("expenseDayInput"),
    expenseCategoryInput: document.getElementById("expenseCategoryInput"),
    expenseAmountInput: document.getElementById("expenseAmountInput"),
    expensePaidByInput: document.getElementById("expensePaidByInput"),
    expensePaymentInput: document.getElementById("expensePaymentInput"),
    expenseLabelInput: document.getElementById("expenseLabelInput"),
    expenseNoteInput: document.getElementById("expenseNoteInput"),
    resetExpenseBtn: document.getElementById("resetExpenseBtn"),
    cancelEditBtn: document.getElementById("cancelEditBtn"),
    saveExpenseBtn: document.getElementById("saveExpenseBtn"),
    expenseStatus: document.getElementById("expenseStatus"),

    expensesList: document.getElementById("expensesList")
  };

  const api = () => window.LugdurumAPI || null;

  const hasApi = () => Boolean(api());

  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const escapeAttr = (value) =>
    escapeHtml(value).replaceAll("`", "&#096;");

  const toNumber = (value, fallback = 0) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;

    const normalized = String(value ?? "")
      .trim()
      .replace(/\s/g, "")
      .replace(",", ".");

    if (!normalized) return fallback;

    const number = Number(normalized);

    return Number.isFinite(number) ? number : fallback;
  };

  const parseLocalDate = (value) => {
    if (!value) return null;

    const [year, month, day] = String(value).split("-").map(Number);

    if (!year || !month || !day) return null;

    return new Date(year, month - 1, day);
  };

  const formatIsoDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  };

  const formatDisplayDate = (isoDate) => {
    const date = parseLocalDate(isoDate);

    if (!date) return "Date inconnue";

    return new Intl.DateTimeFormat("fr-FR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  };

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value || 0);

  const slugify = (value, fallback = "FRAIS") =>
    String(value || fallback)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 26) || fallback;

  const setStatus = (message, type = "") => {
    els.expenseStatus.textContent = message;
    els.expenseStatus.className = "expenseStatus";

    if (type) {
      els.expenseStatus.classList.add(type);
    }
  };

  const setSaving = (isSaving) => {
    state.isSaving = isSaving;

    [
      els.resetExpenseBtn,
      els.cancelEditBtn,
      els.saveExpenseBtn
    ].forEach((button) => {
      if (button) button.disabled = isSaving;
    });
  };

  const cacheData = () => {
    writeJson(STORAGE_KEYS.stockMissions, state.stockMissions);
    writeJson(STORAGE_KEYS.journees, state.journees);
    writeJson(STORAGE_KEYS.frais, state.frais);
  };

  const loadLocalCaches = () => {
    state.stockMissions = readJson(STORAGE_KEYS.stockMissions, []);
    state.journees = readJson(STORAGE_KEYS.journees, []);
    state.frais = readJson(STORAGE_KEYS.frais, []);
  };

  const getContextMissionId = () =>
    String(
      state.context?.stock_mission_id ||
      state.context?.mission_id ||
      localStorage.getItem(STORAGE_KEYS.activeStockMissionId) ||
      localStorage.getItem(STORAGE_KEYS.activeMissionId) ||
      ""
    ).trim();

  const getContextJourneeId = () =>
    String(
      state.context?.journee_id ||
      localStorage.getItem(STORAGE_KEYS.activeJourneeId) ||
      ""
    ).trim();

  const refreshContextFromState = () => {
    const missionId = getContextMissionId();

    if (!missionId) {
      state.stockMission = null;
      state.missionJournees = [];
      return false;
    }

    state.stockMission =
      state.stockMissions.find((mission) => String(mission.mission_id || "") === missionId) ||
      null;

    state.missionJournees = state.journees
      .filter((journee) => {
        const stockMissionId = String(journee.stock_mission_id || "").trim();
        const missionIdValue = String(journee.mission_id || "").trim();

        return stockMissionId === missionId || missionIdValue === missionId;
      })
      .filter((journee) => String(journee.statut || "").toLowerCase() !== "annule")
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return Boolean(state.stockMission);
  };

  const loadContext = () => {
    const fraisContext = readJson(STORAGE_KEYS.fraisContext, null);
    const preparationContext = readJson(STORAGE_KEYS.preparationContext, null);

    state.context = fraisContext || preparationContext || null;

    const hasContext = Boolean(
      state.context?.stock_mission_id ||
      state.context?.mission_id ||
      localStorage.getItem(STORAGE_KEYS.activeStockMissionId) ||
      localStorage.getItem(STORAGE_KEYS.activeMissionId)
    );

    if (!hasContext) {
      state.stockMission = null;
      state.missionJournees = [];
      setStatus("Aucune mission active. Retourne dans Missions puis clique sur Ajouter un frais.", "isError");
      return false;
    }

    const ok = refreshContextFromState();

    if (!ok) {
      setStatus("Mission de stock introuvable dans les données locales.", "isError");
      return false;
    }

    return true;
  };

  const getMissionFrais = () => {
    const missionId = getContextMissionId();

    if (!missionId) return [];

    return state.frais
      .filter((item) => {
        const itemMissionId = String(item.stock_mission_id || item.mission_id || "").trim();
        return itemMissionId === missionId;
      })
      .filter((item) => String(item.statut || "valide").toLowerCase() !== "annule")
      .sort((a, b) => {
        const byDate = String(b.date || "").localeCompare(String(a.date || ""));
        if (byDate !== 0) return byDate;

        return String(b.created_at || "").localeCompare(String(a.created_at || ""));
      });
  };

  const getJourneeById = (journeeId) =>
    state.journees.find((journee) => journee.journee_id === journeeId);

  const upsertLocalFrais = (frais) => {
    const index = state.frais.findIndex((item) => item.frais_id === frais.frais_id);

    if (index >= 0) {
      state.frais[index] = frais;
    } else {
      state.frais.push(frais);
    }

    cacheData();
  };

  const getPendingWritesCount = () => {
    if (hasApi() && typeof api().getPendingWritesCount === "function") {
      return api().getPendingWritesCount();
    }

    return 0;
  };

  const buildExpenseId = ({ date, category, amount }) => {
    const missionId = getContextMissionId() || "MISSION";
    const slug = slugify(category || "FRAIS");
    const amountPart = String(Math.round(toNumber(amount, 0) * 100));
    const stamp = Date.now().toString(36).toUpperCase();

    return `FR_${date.replaceAll("-", "")}_${missionId}_${slug}_${amountPart}_${stamp}`;
  };

  const buildExpenseFromForm = () => {
    const missionId = getContextMissionId();
    const now = new Date().toISOString();

    if (!missionId || !state.stockMission) {
      setStatus("Aucune mission active pour rattacher ce frais.", "isError");
      return null;
    }

    const date = els.expenseDateInput.value;
    const category = els.expenseCategoryInput.value;
    const amount = toNumber(els.expenseAmountInput.value, NaN);
    const editingId = els.expenseIdInput.value.trim();

    if (!date) {
      setStatus("Indique une date.", "isError");
      return null;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus("Indique un montant valide.", "isError");
      return null;
    }

    const existing = editingId
      ? state.frais.find((item) => item.frais_id === editingId)
      : null;

    const fraisId =
      editingId ||
      buildExpenseId({
        date,
        category,
        amount
      });

    const journeeId = els.expenseDayInput.value.trim();
    const journee = journeeId ? getJourneeById(journeeId) : null;

    return {
      frais_id: fraisId,
      date,
      date_heure: existing?.date_heure || now,
      mission_id: missionId,
      stock_mission_id: missionId,
      journee_id: journeeId,
      jour_label: journee?.jour_label || "",
      categorie: category,
      categorie_label: CATEGORY_LABELS[category] || category,
      libelle: els.expenseLabelInput.value.trim(),
      montant: amount,
      paye_par: els.expensePaidByInput.value,
      paye_par_nom: OPERATORS[els.expensePaidByInput.value] || els.expensePaidByInput.value,
      mode_paiement: els.expensePaymentInput.value,
      mode_paiement_label:
        PAYMENT_LABELS[els.expensePaymentInput.value] || els.expensePaymentInput.value,
      justificatif_url: existing?.justificatif_url || "",
      statut: "valide",
      note: els.expenseNoteInput.value.trim(),
      user_id: CURRENT_USER.user_id,
      created_at: existing?.created_at || now,
      updated_at: now
    };
  };

  const saveExpenseToApi = async (frais) => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    if (typeof api().saveFrais !== "function") {
      throw new Error("LugdurumAPI.saveFrais() est indisponible.");
    }

    await api().saveFrais(frais);
  };

  const saveExpense = async () => {
    if (state.isSaving) return;

    const frais = buildExpenseFromForm();

    if (!frais) return;

    upsertLocalFrais(frais);
    renderAll();

    setSaving(true);
    setStatus("Enregistrement du frais...");

    try {
      if (hasApi() && typeof api().saveFrais === "function") {
        await saveExpenseToApi(frais);

        const pendingCount = getPendingWritesCount();

        setStatus(
          pendingCount > 0
            ? `Frais enregistré · ${pendingCount} écriture(s) en attente de synchronisation.`
            : "Frais enregistré.",
          pendingCount > 0 ? "isError" : "isSuccess"
        );
      } else {
        setStatus("Frais enregistré en local. Connexion API à finaliser demain.", "isSuccess");
      }

      resetForm({ keepStatus: true });
      renderAll();
    } catch (error) {
      setStatus(`Frais gardé en local, erreur API : ${error.message}`, "isError");
      renderAll();
    } finally {
      setSaving(false);
    }
  };

  const cancelExpense = async (fraisId) => {
    const existing = state.frais.find((item) => item.frais_id === fraisId);

    if (!existing) return;

    const ok = window.confirm(`Annuler ce frais de ${formatCurrency(toNumber(existing.montant, 0))} ?`);

    if (!ok) return;

    const cancelled = {
      ...existing,
      statut: "annule",
      updated_at: new Date().toISOString()
    };

    upsertLocalFrais(cancelled);
    renderAll();

    try {
      if (hasApi() && typeof api().saveFrais === "function") {
        await saveExpenseToApi(cancelled);
        setStatus("Frais annulé.", "isSuccess");
      } else {
        setStatus("Frais annulé en local. Connexion API à finaliser demain.", "isSuccess");
      }
    } catch (error) {
      setStatus(`Annulation gardée en local, erreur API : ${error.message}`, "isError");
    }
  };

  const fillForm = (frais) => {
    state.editingId = frais.frais_id;

    els.expenseIdInput.value = frais.frais_id || "";
    els.expenseDateInput.value = frais.date || formatIsoDate(new Date());
    els.expenseDayInput.value = frais.journee_id || "";
    els.expenseCategoryInput.value = frais.categorie || "AUTRE";
    els.expenseAmountInput.value = frais.montant || "";
    els.expensePaidByInput.value = frais.paye_par || CURRENT_USER.user_id;
    els.expensePaymentInput.value = frais.mode_paiement || "CB";
    els.expenseLabelInput.value = frais.libelle || "";
    els.expenseNoteInput.value = frais.note || "";

    els.formTitle.textContent = "Modifier un frais";
    els.saveExpenseBtn.textContent = "Enregistrer les modifications";
    els.cancelEditBtn.hidden = false;

    setStatus("Frais chargé pour modification.", "isSuccess");

    els.formTitle.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const resetForm = ({ keepStatus = false } = {}) => {
    state.editingId = "";

    els.form.reset();
    els.expenseIdInput.value = "";
    els.expenseDateInput.value = formatIsoDate(new Date());
    els.expensePaidByInput.value = CURRENT_USER.user_id;
    els.expensePaymentInput.value = "CB";

    const activeJourneeId = getContextJourneeId();

    if (
      activeJourneeId &&
      state.missionJournees.some((journee) => journee.journee_id === activeJourneeId)
    ) {
      els.expenseDayInput.value = activeJourneeId;
    } else {
      els.expenseDayInput.value = "";
    }

    els.formTitle.textContent = "Ajouter un frais";
    els.saveExpenseBtn.textContent = "Enregistrer le frais";
    els.cancelEditBtn.hidden = true;

    if (!keepStatus) {
      setStatus("");
    }
  };

  const renderMissionContext = () => {
    if (!state.stockMission) {
      els.expensesTitle.textContent = "Aucune mission active";
      els.expensesMissionMeta.textContent = "Retourne dans Missions pour choisir une mission de stock.";
      return;
    }

    const dateLabel =
      state.stockMission.date_debut === state.stockMission.date_fin
        ? formatDisplayDate(state.stockMission.date_debut)
        : `${formatDisplayDate(state.stockMission.date_debut)} → ${formatDisplayDate(state.stockMission.date_fin)}`;

    els.expensesTitle.textContent = state.stockMission.nom || "Mission de stock";
    els.expensesMissionMeta.textContent = dateLabel;
  };

  const renderDayOptions = () => {
    const currentValue = els.expenseDayInput.value;

    els.expenseDayInput.innerHTML = `
      <option value="">Toute la mission</option>
      ${state.missionJournees
        .map((journee) => `
          <option value="${escapeAttr(journee.journee_id)}">
            ${escapeHtml(journee.jour_label || "Journée")} · ${escapeHtml(formatDisplayDate(journee.date))}
          </option>
        `)
        .join("")}
    `;

    if (
      currentValue &&
      state.missionJournees.some((journee) => journee.journee_id === currentValue)
    ) {
      els.expenseDayInput.value = currentValue;
    }
  };

  const renderDays = () => {
    if (!state.missionJournees.length) {
      els.expenseDayChips.innerHTML =
        `<p class="expenseEmpty">Aucune journée liée à cette mission.</p>`;
      return;
    }

    els.expenseDayChips.innerHTML = state.missionJournees
      .map((journee) => `
        <article class="expenseDayCard">
          <strong>${escapeHtml(journee.jour_label || "Journée")}</strong>
          <span>${escapeHtml(formatDisplayDate(journee.date))}</span>
        </article>
      `)
      .join("");
  };

  const renderStats = () => {
    const items = getMissionFrais();
    const total = items.reduce((sum, item) => sum + toNumber(item.montant, 0), 0);

    els.expensesTotal.textContent = formatCurrency(total);
    els.expensesCount.textContent = String(items.length);
  };

  const renderList = () => {
    const items = getMissionFrais();

    if (items.length === 0) {
      els.expensesList.innerHTML = `<p class="expenseEmpty">Aucun frais saisi pour cette mission.</p>`;
      return;
    }

    els.expensesList.innerHTML = items
      .map((item) => {
        const journee = item.journee_id ? getJourneeById(item.journee_id) : null;
        const dayLabel = journee
          ? `${journee.jour_label || "Journée"} · ${formatDisplayDate(journee.date)}`
          : "Toute la mission";

        const title =
          item.libelle ||
          item.categorie_label ||
          CATEGORY_LABELS[item.categorie] ||
          "Frais";

        return `
          <article class="expenseCard">
            <div class="expenseCardHeader">
              <div class="expenseCardTitle">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(formatDisplayDate(item.date))} · ${escapeHtml(dayLabel)}</span>
              </div>

              <strong class="expenseAmount">${escapeHtml(formatCurrency(toNumber(item.montant, 0)))}</strong>
            </div>

            <div class="expenseMeta">
              <span>${escapeHtml(CATEGORY_LABELS[item.categorie] || item.categorie || "Autre")}</span>
              <span>${escapeHtml(PAYMENT_LABELS[item.mode_paiement] || item.mode_paiement || "Paiement")}</span>
              <span>${escapeHtml(item.paye_par_nom || OPERATORS[item.paye_par] || item.paye_par || "Payé par ?")}</span>
            </div>

            ${item.note ? `<p class="expenseNote">${escapeHtml(item.note)}</p>` : ""}

            <div class="expenseCardActions">
              <button
                class="expenseSmallBtn"
                type="button"
                data-edit-expense="${escapeAttr(item.frais_id)}"
              >
                Modifier
              </button>

              <button
                class="expenseSmallBtn danger"
                type="button"
                data-cancel-expense="${escapeAttr(item.frais_id)}"
              >
                Annuler
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const renderAll = () => {
    renderMissionContext();
    renderDayOptions();
    renderDays();
    renderStats();
    renderList();
  };

  const loadRemoteData = async () => {
    if (!hasApi()) {
      throw new Error("lugdurum-api.js n’est pas chargé.");
    }

    const [
      stockMissions,
      journees,
      frais
    ] = await Promise.all([
      typeof api().getMissionsStock === "function" ? api().getMissionsStock() : [],
      typeof api().getJournees === "function" ? api().getJournees() : [],
      typeof api().getFrais === "function" ? api().getFrais() : []
    ]);

    state.stockMissions = Array.isArray(stockMissions) ? stockMissions : [];
    state.journees = Array.isArray(journees) ? journees : [];
    state.frais = Array.isArray(frais) ? frais : [];

    cacheData();
    refreshContextFromState();
  };

  document.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-expense]");
    if (editButton) {
      const frais = state.frais.find((item) => item.frais_id === editButton.dataset.editExpense);
      if (frais) fillForm(frais);
      return;
    }

    const cancelButton = event.target.closest("[data-cancel-expense]");
    if (cancelButton) {
      cancelExpense(cancelButton.dataset.cancelExpense);
    }
  });

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveExpense();
  });

  els.resetExpenseBtn.addEventListener("click", () => {
    resetForm();
  });

  els.cancelEditBtn.addEventListener("click", () => {
    resetForm();
  });

  window.addEventListener("lugdurum:sync-status", (event) => {
    const detail = event.detail || {};

    if (Number(detail.pending_count || 0) > 0) {
      setStatus(`${detail.pending_count} écriture(s) en attente de synchronisation.`, "isError");
    }
  });

  const init = async () => {
    loadLocalCaches();
    loadContext();
    renderAll();
    resetForm({ keepStatus: true });

    try {
      setStatus("Chargement...");
      await loadRemoteData();

      const hasContext = loadContext();
      renderAll();
      resetForm({ keepStatus: true });

      if (hasContext) {
        setStatus("");
      }
    } catch (error) {
      setStatus(
        `Lecture Sheets impossible. Données locales affichées : ${error.message}`,
        "isError"
      );
      renderAll();
    }
  };

  init();
})();
