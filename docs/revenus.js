(() => {
  "use strict";

  /*
    Revenus V1 anti-404 :
    - Stockage local pour l’instant.
    - L’onglet/API revenus sera officialisé plus tard.
    - Si LugdurumAPI.saveRevenu existe plus tard, elle sera utilisée automatiquement.
  */

  const STORAGE_KEY = "lugdurum_revenus";

  const CHANNEL_LABELS = {
    PRO: "Pro",
    COMMANDE_DIRECTE: "Commande directe",
    ANIMATION: "Animation",
    SITE_WEB: "Site web",
    AUTRE: "Autre"
  };

  const PAYMENT_LABELS = {
    VIR: "Virement",
    CB: "CB",
    ESP: "Espèces",
    CHQ: "Chèque",
    AUTRE: "Autre"
  };

  const STATUS_LABELS = {
    encaisse: "Encaissé",
    attente: "En attente",
    annule: "Annulé"
  };

  const state = {
    revenus: [],
    editingId: "",
    isSaving: false
  };

  const els = {
    total: document.getElementById("revenuesTotal"),
    count: document.getElementById("revenuesCount"),
    form: document.getElementById("revenueForm"),
    formTitle: document.getElementById("revenueFormTitle"),
    revenueIdInput: document.getElementById("revenueIdInput"),
    revenueDateInput: document.getElementById("revenueDateInput"),
    revenueChannelInput: document.getElementById("revenueChannelInput"),
    revenueClientInput: document.getElementById("revenueClientInput"),
    revenueAmountInput: document.getElementById("revenueAmountInput"),
    revenuePaymentInput: document.getElementById("revenuePaymentInput"),
    revenueStatusInput: document.getElementById("revenueStatusInput"),
    revenueNoteInput: document.getElementById("revenueNoteInput"),
    resetRevenueBtn: document.getElementById("resetRevenueBtn"),
    cancelRevenueEditBtn: document.getElementById("cancelRevenueEditBtn"),
    saveRevenueBtn: document.getElementById("saveRevenueBtn"),
    revenueStatus: document.getElementById("revenueStatus"),
    list: document.getElementById("revenuesList")
  };

  const api = () => window.LugdurumAPI || null;

  const readJson = (key, fallback = []) => {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  };

  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  const escapeAttr = (value) => escapeHtml(value).replaceAll("`", "&#096;");

  const toNumber = (value, fallback = 0) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const number = Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
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

  const slugify = (value, fallback = "REVENU") =>
    String(value || fallback)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 26) || fallback;

  const setStatus = (message, type = "") => {
    els.revenueStatus.textContent = message;
    els.revenueStatus.className = "revenusStatus";
    if (type) els.revenueStatus.classList.add(type);
  };

  const setSaving = (isSaving) => {
    state.isSaving = isSaving;
    [els.resetRevenueBtn, els.cancelRevenueEditBtn, els.saveRevenueBtn].forEach((button) => {
      if (button) button.disabled = isSaving;
    });
  };

  const loadLocal = () => {
    state.revenus = readJson(STORAGE_KEY, []);
  };

  const saveLocal = () => {
    writeJson(STORAGE_KEY, state.revenus);
  };

  const getValidRevenus = () => state.revenus.filter((item) => item.statut !== "annule");

  const buildRevenueId = ({ date, channel, amount }) => {
    const slug = slugify(channel || "REVENU");
    const amountPart = String(Math.round(toNumber(amount, 0) * 100));
    const stamp = Date.now().toString(36).toUpperCase();
    return `REV_${date.replaceAll("-", "")}_${slug}_${amountPart}_${stamp}`;
  };

  const buildRevenueFromForm = () => {
    const now = new Date().toISOString();
    const date = els.revenueDateInput.value;
    const channel = els.revenueChannelInput.value;
    const amount = toNumber(els.revenueAmountInput.value, NaN);
    const editingId = els.revenueIdInput.value.trim();

    if (!date) {
      setStatus("Indique une date.", "isError");
      return null;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus("Indique un montant valide.", "isError");
      return null;
    }

    const existing = editingId
      ? state.revenus.find((item) => item.revenu_id === editingId)
      : null;

    const revenuId = editingId || buildRevenueId({ date, channel, amount });

    return {
      revenu_id: revenuId,
      date,
      date_heure: existing?.date_heure || now,
      canal: channel,
      canal_label: CHANNEL_LABELS[channel] || channel,
      client: els.revenueClientInput.value.trim(),
      montant: amount,
      mode_paiement: els.revenuePaymentInput.value,
      mode_paiement_label: PAYMENT_LABELS[els.revenuePaymentInput.value] || els.revenuePaymentInput.value,
      statut: els.revenueStatusInput.value,
      statut_label: STATUS_LABELS[els.revenueStatusInput.value] || els.revenueStatusInput.value,
      note: els.revenueNoteInput.value.trim(),
      created_at: existing?.created_at || now,
      updated_at: now
    };
  };

  const upsertLocalRevenue = (revenue) => {
    const index = state.revenus.findIndex((item) => item.revenu_id === revenue.revenu_id);
    if (index >= 0) state.revenus[index] = revenue;
    else state.revenus.push(revenue);
    saveLocal();
  };

  const saveRevenueToApi = async (revenue) => {
    if (!api() || typeof api().saveRevenu !== "function") return false;
    await api().saveRevenu(revenue);
    return true;
  };

  const saveRevenue = async () => {
    if (state.isSaving) return;

    const revenue = buildRevenueFromForm();
    if (!revenue) return;

    upsertLocalRevenue(revenue);
    renderAll();

    setSaving(true);
    setStatus("Enregistrement du revenu...");

    try {
      const sent = await saveRevenueToApi(revenue);
      resetForm({ keepStatus: true });
      renderAll();
      setStatus(
        sent
          ? "Revenu enregistré."
          : "Revenu enregistré en local. Connexion API à prévoir plus tard.",
        "isSuccess"
      );
    } catch (error) {
      setStatus(`Revenu gardé en local, erreur API : ${error.message}`, "isError");
    } finally {
      setSaving(false);
    }
  };

  const cancelRevenue = async (revenueId) => {
    const existing = state.revenus.find((item) => item.revenu_id === revenueId);
    if (!existing) return;

    const ok = window.confirm(`Annuler ce revenu de ${formatCurrency(toNumber(existing.montant, 0))} ?`);
    if (!ok) return;

    const cancelled = {
      ...existing,
      statut: "annule",
      statut_label: STATUS_LABELS.annule,
      updated_at: new Date().toISOString()
    };

    upsertLocalRevenue(cancelled);
    renderAll();

    try {
      await saveRevenueToApi(cancelled);
      setStatus("Revenu annulé.", "isSuccess");
    } catch (error) {
      setStatus(`Annulation gardée en local, erreur API : ${error.message}`, "isError");
    }
  };

  const fillForm = (revenue) => {
    state.editingId = revenue.revenu_id;

    els.revenueIdInput.value = revenue.revenu_id || "";
    els.revenueDateInput.value = revenue.date || formatIsoDate(new Date());
    els.revenueChannelInput.value = revenue.canal || "AUTRE";
    els.revenueClientInput.value = revenue.client || "";
    els.revenueAmountInput.value = revenue.montant || "";
    els.revenuePaymentInput.value = revenue.mode_paiement || "VIR";
    els.revenueStatusInput.value = revenue.statut || "encaisse";
    els.revenueNoteInput.value = revenue.note || "";

    els.formTitle.textContent = "Modifier un revenu";
    els.saveRevenueBtn.textContent = "Enregistrer les modifications";
    els.cancelRevenueEditBtn.hidden = false;

    setStatus("Revenu chargé pour modification.", "isSuccess");

    els.formTitle.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const resetForm = ({ keepStatus = false } = {}) => {
    state.editingId = "";

    els.form.reset();
    els.revenueIdInput.value = "";
    els.revenueDateInput.value = formatIsoDate(new Date());
    els.revenueChannelInput.value = "PRO";
    els.revenuePaymentInput.value = "VIR";
    els.revenueStatusInput.value = "encaisse";

    els.formTitle.textContent = "Ajouter un revenu";
    els.saveRevenueBtn.textContent = "Enregistrer le revenu";
    els.cancelRevenueEditBtn.hidden = true;

    if (!keepStatus) setStatus("");
  };

  const renderStats = () => {
    const items = getValidRevenus();
    const total = items
      .filter((item) => item.statut === "encaisse")
      .reduce((sum, item) => sum + toNumber(item.montant, 0), 0);

    els.total.textContent = formatCurrency(total);
    els.count.textContent = String(items.length);
  };

  const renderList = () => {
    const items = getValidRevenus().sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || "")) ||
      String(b.created_at || "").localeCompare(String(a.created_at || ""))
    );

    if (!items.length) {
      els.list.innerHTML = `<p class="revenusEmpty">Aucun revenu saisi.</p>`;
      return;
    }

    els.list.innerHTML = items.map((item) => {
      const title = item.client || CHANNEL_LABELS[item.canal] || "Revenu";
      const statusClass = item.statut === "encaisse" ? "isGreen" : "isRed";

      return `
        <article class="revenueCard">
          <div class="revenueCardHeader">
            <div class="revenueCardTitle">
              <strong>${escapeHtml(title)}</strong>
              <span>${escapeHtml(formatDisplayDate(item.date))}</span>
            </div>
            <strong class="revenueAmount">${escapeHtml(formatCurrency(toNumber(item.montant, 0)))}</strong>
          </div>
          <div class="revenueMeta">
            <span>${escapeHtml(CHANNEL_LABELS[item.canal] || item.canal || "Canal")}</span>
            <span>${escapeHtml(PAYMENT_LABELS[item.mode_paiement] || item.mode_paiement || "Paiement")}</span>
            <span class="revenueBadge ${statusClass}">
              ${escapeHtml(STATUS_LABELS[item.statut] || item.statut || "Statut")}
            </span>
          </div>
          ${item.note ? `<p class="revenueNote">${escapeHtml(item.note)}</p>` : ""}
          <div class="revenueCardActions">
            <button class="revenueSmallBtn" type="button" data-edit-revenue="${escapeAttr(item.revenu_id)}">Modifier</button>
            <button class="revenueSmallBtn danger" type="button" data-cancel-revenue="${escapeAttr(item.revenu_id)}">Annuler</button>
          </div>
        </article>
      `;
    }).join("");
  };

  const renderAll = () => {
    renderStats();
    renderList();
  };

  document.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-revenue]");
    if (editButton) {
      const revenue = state.revenus.find((item) => item.revenu_id === editButton.dataset.editRevenue);
      if (revenue) fillForm(revenue);
      return;
    }

    const cancelButton = event.target.closest("[data-cancel-revenue]");
    if (cancelButton) {
      cancelRevenue(cancelButton.dataset.cancelRevenue);
    }
  });

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveRevenue();
  });

  els.resetRevenueBtn.addEventListener("click", () => resetForm());
  els.cancelRevenueEditBtn.addEventListener("click", () => resetForm());

  const init = () => {
    loadLocal();
    resetForm({ keepStatus: true });
    renderAll();
  };

  init();
})();
