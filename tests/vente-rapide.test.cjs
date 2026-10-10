"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Banc de test DOM minimal : aucune connexion au vrai Google Sheets ni a SumUp.
const source = fs.readFileSync(
  path.join(__dirname, "..", "docs", "vente-rapide.js"),
  "utf8"
);
// Le bootstrap évolue avec le mode cache-first et la reprise SumUp.
const startup = source.slice(source.lastIndexOf("  handleSumupCallbackParams();"));

assert.ok(source.includes(startup), "Point d'injection du banc de test introuvable");
const code = source.replace(
  startup,
  "  window.__test = { state, els, saveTicket, confirmSumupSuccess, " +
    "confirmSumupFailure, reopenSumup, buildTransaction, " +
    "showExternalCbConfirm, closeExternalCbConfirm, confirmExternalCbSale, " +
    "loadContext, resolveSharedSalesContext };\n})();"
);

function element() {
  return {
    textContent: "", value: "", innerHTML: "", hidden: true,
    dataset: {}, style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, appendChild() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
}

let nextDevice = 0;

function setup(saveBundle, pendingCount = () => 0) {
  const id = ++nextDevice;
  let seq = 0;
  const calls = [];
  const store = new Map();
  const els = new Map();
  const timers = [];

  const document = {
    title: "Test Lugdurum",
    getElementById(key) {
      if (!els.has(key)) els.set(key, element());
      return els.get(key);
    },
    querySelector: element,
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  const window = {
    location: { href: "https://example.test/vente-rapide.html" },
    history: { replaceState() {} },
    crypto: { randomUUID: () => "device-" + id + "-uuid-" + ++seq },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    addEventListener() {},
    LugdurumAPI: {
      saveVenteRapideBundle(payload) {
        calls.push(payload);
        return saveBundle(payload);
      },
      getPendingWritesCount: pendingCount,
      getTransactions: async () => []
    }
  };
  const localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); }
  };
  vm.runInNewContext(code, {
    window, document, localStorage, navigator: { onLine: true },
    URL, console
  }, { filename: "vente-rapide.js" });

  const api = window.__test;
  api.state.journeeActive = {
    mission_id: "MS_TEST", journee_id: "JV_TEST",
    user_id: "U_TEST", label: "Test", date_label: ""
  };
  api.state.paymentMode = "ESP";
  api.state.ticketItems = [{
    item_id: "ITEM_1", type: "bottle", sku_id: "SKU_TEST",
    parfum_code: "TEST", parfum_nom: "Produit test", format_cl: 50,
    quantite: 1, prix_unitaire_ttc: 25, prix_unitaire_ht: 25, taux_tva: 0
  }];
  api.els.amountPaidInput.value = "25";
  return { api, calls, store, timers, window };
}

test("double clic : une seule ecriture ticket et mouvements de stock", async () => {
  let resolve;
  const app = setup(() => new Promise((done) => { resolve = done; }));
  const first = app.api.saveTicket();
  await app.api.saveTicket();

  assert.equal(app.calls.length, 1);
  assert.equal(app.api.state.saveInProgress, true);
  assert.equal(app.calls[0].mouvements_stock.length, 1);

  resolve({ ok: true });
  await first;
  assert.equal(app.api.state.ticketItems.length, 0);
  assert.equal(app.api.state.saveInProgress, false);
  assert.ok(app.timers.length > 0, "CA differe apres vidage du panier");
});

test("echec incertain : retry avec panier identique = meme transaction_id", async () => {
  let attempt = 0;
  const app = setup(async () => {
    if (++attempt === 1) throw new Error("Reseau incertain");
    return { ok: true };
  });
  await app.api.saveTicket();
  assert.equal(app.api.state.ticketItems.length, 1, "Panier conserve apres erreur");

  await app.api.saveTicket();
  assert.equal(app.calls.length, 2);
  assert.equal(
    app.calls[0].transaction.transaction_id,
    app.calls[1].transaction.transaction_id
  );
  assert.equal(
    app.calls[0].mouvements_stock[0].mouvement_stock_id,
    app.calls[1].mouvements_stock[0].mouvement_stock_id
  );
  assert.equal(app.api.state.ticketItems.length, 0);
});

test("deux vendeurs : transaction_id distincts", async () => {
  const a = setup(async () => ({ ok: true }));
  const b = setup(async () => ({ ok: true }));
  await Promise.all([a.api.saveTicket(), b.api.saveTicket()]);
  assert.notEqual(
    a.calls[0].transaction.transaction_id,
    b.calls[0].transaction.transaction_id
  );
});

test("ecriture hors ligne mise en file : le ticket suivant reste disponible", async () => {
  const app = setup(async () => ({ queued: true }), () => 1);
  await app.api.saveTicket();
  assert.equal(app.calls.length, 1);
  assert.equal(app.api.state.ticketItems.length, 0);
  assert.equal(JSON.parse(app.store.get("lugdurum_transactions_backup")).length, 1);
});

test("SumUp : boutons annuler / retour bloques durant la sauvegarde", async () => {
  let resolve;
  const app = setup(() => new Promise((done) => { resolve = done; }));
  app.api.state.paymentMode = "CB";

  const foreignId = "LUG_123456789";
  const transaction = app.api.buildTransaction({
    provider: "SUMUP", paymentStatus: "SUMUP_LANCE",
    status: "paiement_en_attente", foreignTxId: foreignId
  });
  app.store.set("lugdurum_pending_sumup_ticket", JSON.stringify({
    foreign_tx_id: foreignId,
    sumup_url: "sumupmerchant://pay",
    transaction
  }));

  const saving = app.api.confirmSumupSuccess();
  assert.equal(app.api.state.saveInProgress, true);
  assert.equal(app.api.els.sumupConfirmFailBtn.disabled, true);
  assert.equal(app.api.els.sumupReturnBtn.disabled, true);

  app.api.confirmSumupFailure();
  app.api.reopenSumup();
  assert.ok(app.store.has("lugdurum_pending_sumup_ticket"));
  assert.equal(app.window.location.href, "https://example.test/vente-rapide.html");

  resolve({ ok: true });
  await saving;
  assert.equal(app.api.state.saveInProgress, false);
  assert.equal(app.store.has("lugdurum_pending_sumup_ticket"), false);
});

test("CB externe : confirmation volontaire, aucun appel SumUp, ticket CB et stock", async () => {
  const app = setup(async () => ({ ok: true }));
  app.api.state.paymentMode = "CB";
  app.api.showExternalCbConfirm();
  assert.equal(app.api.els.externalCbOverlay.hidden, false);
  assert.match(app.api.els.externalCbAmount.textContent, /25\s*€/u);
  assert.equal(app.calls.length, 0, "L'ouverture n'enregistre rien");

  await app.api.confirmExternalCbSale();

  assert.equal(app.calls.length, 1);
  const payload = app.calls[0];
  assert.equal(payload.transaction.mode_paiement, "CB");
  assert.equal(payload.transaction.paiement_provider, "EXTERNE");
  assert.equal(payload.transaction.source, "WEBAPP_CB_MANUEL");
  assert.equal(payload.transaction.paiement_statut, "PAYE");
  assert.equal(payload.transaction.statut, "validee");
  assert.equal(payload.transaction.sumup_foreign_tx_id, "");
  assert.match(payload.transaction.note, /confirmee manuellement/);
  assert.equal(payload.transaction.total_encaisse_ttc, 25);
  assert.equal(payload.transaction.lignes.length, 1);
  assert.equal(payload.mouvements_stock.length, 1);
  assert.equal(payload.mouvements_stock[0].sku_id, "SKU_TEST");
  assert.equal(app.window.location.href, "https://example.test/vente-rapide.html");
  assert.equal(app.api.els.externalCbOverlay.hidden, true);
  assert.equal(app.api.state.ticketItems.length, 0);
  assert.equal(JSON.parse(app.store.get("lugdurum_transactions_backup")).length, 1);
});

test("CB externe : annuler ne sauvegarde rien et conserve le panier", async () => {
  const app = setup(async () => ({ ok: true }));
  app.api.state.paymentMode = "CB";
  app.api.showExternalCbConfirm();
  app.api.closeExternalCbConfirm();
  await app.api.confirmExternalCbSale();

  assert.equal(app.api.els.externalCbOverlay.hidden, true);
  assert.equal(app.calls.length, 0);
  assert.equal(app.api.state.ticketItems.length, 1);
});

test("CB externe : double appui pendant POST ne duplique ni transaction ni stock", async () => {
  let resolve;
  const app = setup(() => new Promise((done) => { resolve = done; }));
  app.api.state.paymentMode = "CB";
  app.api.showExternalCbConfirm();
  const first = app.api.confirmExternalCbSale();
  await app.api.confirmExternalCbSale();

  assert.equal(app.calls.length, 1);
  assert.equal(app.api.els.externalCbConfirmBtn.disabled, true);
  assert.equal(app.api.els.externalCbCancelBtn.disabled, true);
  assert.equal(app.api.state.saveInProgress, true);
  resolve({ ok: true });
  await first;
  assert.equal(app.api.els.externalCbOverlay.hidden, true);
  assert.equal(app.api.state.saveInProgress, false);
});

test("CB externe : POST incertain puis reprise = mêmes ID transaction et mouvement", async () => {
  let attempts = 0;
  const app = setup(async () => {
    if (++attempts === 1) throw new Error("Perte reseau");
    return { ok: true };
  });
  app.api.state.paymentMode = "CB";
  app.api.showExternalCbConfirm();
  await app.api.confirmExternalCbSale();

  assert.equal(app.calls.length, 1);
  assert.equal(app.api.els.externalCbOverlay.hidden, false);
  assert.equal(app.api.state.ticketItems.length, 1);
  await app.api.confirmExternalCbSale();

  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[0].transaction.transaction_id, app.calls[1].transaction.transaction_id);
  assert.equal(app.calls[0].mouvements_stock[0].mouvement_stock_id,
               app.calls[1].mouvements_stock[0].mouvement_stock_id);
  assert.equal(app.api.els.externalCbOverlay.hidden, true);
});

test("CB externe : interdiction si paiement SumUp encore en attente sur ce téléphone", async () => {
  const app = setup(async () => ({ ok: true }));
  app.api.state.paymentMode = "CB";
  app.store.set("lugdurum_pending_sumup_ticket", JSON.stringify({
    foreign_tx_id: "LUG_PENDING", transaction: { transaction_id: "LUG_PENDING" }
  }));
  app.api.showExternalCbConfirm();
  assert.equal(app.api.els.externalCbOverlay.hidden, true);
  assert.equal(app.calls.length, 0);
});

test("CB externe après refus de SumUp : panier restauré et pas de paiement lancé", async () => {
  const app = setup(async () => ({ ok: true }));
  app.api.state.paymentMode = "CB";
  const pending = app.api.buildTransaction({
    provider: "SUMUP",
    paymentStatus: "SUMUP_LANCE",
    status: "paiement_en_attente",
    foreignTxId: "LUG_PENDING"
  });
  app.store.set("lugdurum_pending_sumup_ticket", JSON.stringify({
    foreign_tx_id: "LUG_PENDING",
    transaction: pending,
    sumup_url: "sumupmerchant://pay"
  }));
  app.api.confirmSumupFailure();
  assert.equal(app.store.has("lugdurum_pending_sumup_ticket"), false);
  app.api.showExternalCbConfirm();
  await app.api.confirmExternalCbSale();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].transaction.paiement_provider, "EXTERNE");
  assert.equal(app.calls[0].transaction.sumup_foreign_tx_id, "");
});

test("Antho sans cache : récupère J1 Gerzat, stock partagé et CA des deux vendeurs", async () => {
  const app = setup(async () => ({ ok: true }));
  app.api.state.journeeActive = { mission_id: "", journee_id: "", user_id: "U_ANTHO" };
  const stockId = "MST_GERZAT";
  const dayId = "J_GERZAT_1";
  app.window.LugdurumAPI.getCurrentUserId = () => "U_ANTHO";
  app.window.LugdurumAPI.getCoreData = async (tables) => {
    assert.equal(Array.from(tables).join(","), "missionsStock,journees,transactions");
    return {
      missionsStock: [
        { mission_id: "MST_OLD", statut: "annule", stock_prepare: false },
        {
          mission_id: stockId, nom: "Gerzat", statut: "pret", stock_prepare: true,
          evenement_id: "EVT_GERZAT", total_bouteilles_preparees: 152,
          total_50cl_prepare: 92, total_20cl_prepare: 60
        }
      ],
      journees: [
        { journee_id: dayId, mission_id: "EVT_GERZAT", stock_mission_id: stockId, date: "2026-10-10", statut: "pret", jour_label: "J1" },
        { journee_id: "J_GERZAT_2", mission_id: "EVT_GERZAT", stock_mission_id: stockId, date: "2026-10-11", statut: "pret", jour_label: "J2" }
      ],
      transactions: [
        { transaction_id: "TX_J", journee_id: dayId, user_id: "U_JEROME", statut: "validee", paiement_statut: "PAYE", total_encaisse_ttc: 45.99 },
        { transaction_id: "TX_A", journee_id: dayId, user_id: "U_ANTHO", statut: "validee", paiement_statut: "PAYE", total_encaisse_ttc: 31.99 },
        { transaction_id: "TX_OTHER", journee_id: "J_GERZAT_2", statut: "validee", paiement_statut: "PAYE", total_encaisse_ttc: 100 }
      ]
    };
  };

  await app.api.loadContext();
  assert.equal(app.api.state.journeeActive.mission_id, stockId);
  assert.equal(app.api.state.journeeActive.journee_id, dayId);
  assert.equal(app.api.state.journeeActive.user_id, "U_ANTHO");
  assert.equal(app.api.state.daySummary.revenue, 77.98);
  assert.equal(app.api.state.daySummary.tickets, 2);
  assert.equal(app.api.els.sharedStockLabel.textContent.includes("152 bouteilles"), true);
  assert.equal(app.store.get("lugdurum_active_stock_mission_id"), stockId);
  assert.equal(app.store.get("lugdurum_active_journee_id"), dayId);
});

test("Contexte partagé : privilégie une journée explicitement liée plutôt qu'un ancien cache", () => {
  const app = setup(async () => ({ ok: true }));
  const missions = [
    { mission_id: "M1", statut: "pret", stock_prepare: true },
    { mission_id: "M2", statut: "pret", stock_prepare: true }
  ];
  const days = [
    { journee_id: "J1", date: "2026-10-10", stock_mission_id: "M1", statut: "pret" },
    { journee_id: "J2", date: "2026-10-10", stock_mission_id: "M2", statut: "pret" }
  ];
  const selected = app.api.resolveSharedSalesContext(missions, days, {
    explicitStockId: "M2", explicitDayId: "J2", localStockId: "M1", localDayId: "J1"
  }, "2026-10-10");
  assert.equal(selected.stock.mission_id, "M2");
  assert.equal(selected.day.journee_id, "J2");
});

test("Contexte partagé : deux foires le même jour sans sélection => aucune attribution aléatoire", () => {
  const app = setup(async () => ({ ok: true }));
  const missions = [
    { mission_id: "M1", statut: "pret", stock_prepare: true },
    { mission_id: "M2", statut: "pret", stock_prepare: true }
  ];
  const days = [
    { journee_id: "J1", date: "2026-10-10", stock_mission_id: "M1", statut: "pret" },
    { journee_id: "J2", date: "2026-10-10", stock_mission_id: "M2", statut: "pret" }
  ];
  const selected = app.api.resolveSharedSalesContext(missions, days, {}, "2026-10-10");
  assert.equal(selected, null);
});

test("Contexte partagé : jour du calendrier prioritaire sur l'ancien jour local", () => {
  const app = setup(async () => ({ ok: true }));
  const mission = [{ mission_id: "M1", statut: "pret", stock_prepare: true }];
  const days = [
    { journee_id: "J_OLD", date: "2026-10-09", stock_mission_id: "M1", statut: "pret" },
    { journee_id: "J_TODAY", date: "2026-10-10", stock_mission_id: "M1", statut: "pret" }
  ];
  const selected = app.api.resolveSharedSalesContext(mission, days, {
    localStockId: "M1", localDayId: "J_OLD"
  }, "2026-10-10");
  assert.equal(selected.day.journee_id, "J_TODAY");
});

test("Contexte partagé : ne sélectionne pas une mission annulée", () => {
  const app = setup(async () => ({ ok: true }));
  const selected = app.api.resolveSharedSalesContext(
    [{ mission_id: "M_DELETED", statut: "annule", stock_prepare: true }],
    [{ journee_id: "J1", date: "2026-10-10", stock_mission_id: "M_DELETED", statut: "pret" }],
    { localStockId: "M_DELETED", localDayId: "J1" },
    "2026-10-10"
  );
  assert.equal(selected, null);
});
