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
    "selectSharedSalesContext, loadContext };\n})();"
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
    URL, URLSearchParams, console
  }, { filename: "vente-rapide.js" });

  const api = window.__test;
  api.state.journeeActive = {
    mission_id: "MS_TEST", journee_id: "JV_TEST",
    user_id: "U_TEST", label: "Test", date_label: ""
  };
  // Dans ce groupe de tests unitaires, la journée factice MS_TEST/JV_TEST
  // représente un contexte déjà validé. Les tests du chargement réseau
  // couvrent séparément la phase d'identification de la journée.
  api.state.contextLoaded = true;
  api.state.paymentMode = "ESP";
  api.state.ticketItems = [{
    item_id: "ITEM_1", type: "bottle", sku_id: "SKU_TEST",
    parfum_code: "TEST", parfum_nom: "Produit test", format_cl: 50,
    quantite: 1, prix_unitaire_ttc: 25, prix_unitaire_ht: 25, taux_tva: 0
  }];
  api.els.amountPaidInput.value = "25";
  return { api, calls, store, timers, window };
}

test("contexte local non vérifié : impossible d'encaisser même avec des IDs en cache", async () => {
  const app = setup(async () => ({ ok: true }));
  app.api.state.contextLoaded = false;
  const saved = await app.api.saveTicket();
  assert.equal(saved, false);
  assert.equal(app.calls.length, 0);
  assert.equal(app.api.state.ticketItems.length, 1);
  assert.match(app.api.els.saveStatus.textContent, /Vérification de la journée/);
});

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

const todayIsoLocal = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const gerzatSharedFixture = () => {
  const date = todayIsoLocal();
  const missionsStock = [
    { mission_id: "MST_OLD", nom: "Gerzat (doublon)", statut: "annule",
      total_bouteilles_preparees: 0 },
    { mission_id: "MST_GERZAT", nom: "Gerzat", statut: "pret",
      stock_prepare: true, total_bouteilles_preparees: 152,
      total_50cl_prepare: 92, total_20cl_prepare: 60 }
  ];
  const journees = [
    { journee_id: "J_OLD", stock_mission_id: "MST_OLD", date, statut: "pret" },
    { journee_id: "J_GERZAT", stock_mission_id: "MST_GERZAT",
      mission_id: "EVT_GERZAT", jour_label: "J1", date, statut: "pret" },
    { journee_id: "J_GERZAT_J2", stock_mission_id: "MST_GERZAT",
      mission_id: "EVT_GERZAT", jour_label: "J2", date: "2099-11-12", statut: "pret" }
  ];
  const transactions = [
    { transaction_id: "TX_1", journee_id: "J_GERZAT", montant: 45.99,
      total_encaisse_ttc: 45.99, statut: "validee", paiement_statut: "PAYE" },
    { transaction_id: "TX_2", journee_id: "J_GERZAT",
      total_encaisse_ttc: 31.99, statut: "validee", paiement_statut: "PAYE" }
  ];
  return { missionsStock, journees, transactions };
};

test("2 téléphones : sans contexte local, J1 + stock emporté + CA commun retrouvés", async () => {
  const fixture = gerzatSharedFixture();
  const phones = [setup(async () => ({ ok: true })), setup(async () => ({ ok: true }))];

  await Promise.all(phones.map(async (phone) => {
    phone.window.location.search = "";
    const requestedTables = [];
    phone.window.LugdurumAPI.getCoreData = async (tables) => {
      requestedTables.push([...tables]);
      return { tables: fixture };
    };
    phone.window.LugdurumAPI.getCurrentUserId = () => "U_ANTHO";
    await phone.api.loadContext();

    assert.equal(phone.api.state.contextLoaded, true);
    assert.deepEqual(requestedTables[0], ["missionsStock", "journees"],
      "Les transactions ne doivent pas bloquer la confirmation de la journée");
    // Le CA est intentionnellement lancé après la résolution du contexte,
    // dans une autre promesse (parcours terrain plus rapide).
    await new Promise(setImmediate);

    assert.equal(phone.api.state.journeeActive.mission_id, "MST_GERZAT");
    assert.equal(phone.api.state.journeeActive.journee_id, "J_GERZAT");
    assert.equal(phone.api.state.journeeActive.user_id, "U_ANTHO");
    assert.equal(phone.api.state.sharedStock.total_bouteilles_preparees, 152);
    assert.equal(phone.api.els.stockPreparedTotal.textContent, "152");
    assert.equal(phone.api.els.stockPreparedBreakdown.textContent, "92 × 50 cL · 60 × 20 cL");
    assert.equal(phone.api.state.daySummary.tickets, 2);
    assert.equal(phone.api.state.daySummary.revenue.toFixed(2), "77.98");
    assert.equal(phone.api.els.dayRevenueTotal.textContent.includes("77"), true);
    assert.equal(phone.store.get("lugdurum_active_stock_mission_id"), "MST_GERZAT");
    assert.equal(phone.store.get("lugdurum_active_journee_id"), "J_GERZAT");
  }));
});

test("CA retardé : J2 est utilisable sans attendre les statistiques", async () => {
  const phone = setup(async () => ({ ok: true }));
  const fixture = gerzatSharedFixture();
  let resolveTransactions;
  const tablesRequested = [];
  phone.window.LugdurumAPI.getCoreData = (tables) => {
    tablesRequested.push([...tables]);
    if (tables.includes("transactions")) {
      return new Promise((resolve) => { resolveTransactions = resolve; });
    }
    return Promise.resolve({ tables: fixture });
  };

  await phone.api.loadContext();
  assert.equal(phone.api.state.contextLoaded, true);
  assert.equal(phone.api.state.journeeActive.journee_id, "J_GERZAT");
  assert.equal(phone.api.state.daySummary.isLoading, true);
  assert.equal(phone.api.state.daySummary.isLoaded, false);
  assert.deepEqual(tablesRequested, [
    ["missionsStock", "journees"],
    ["transactions"]
  ]);

  // Les tickets partagés arrivent plus tard, sans cacher le bon contexte.
  resolveTransactions({ tables: { transactions: fixture.transactions } });
  await new Promise(setImmediate);
  assert.equal(phone.api.state.daySummary.tickets, 2);
  assert.equal(phone.api.state.daySummary.revenue.toFixed(2), "77.98");
});

test("Ancien cache J2 : priorité à la journée du jour sur la même mission", () => {
  const phone = setup(async () => ({ ok: true }));
  const fixture = gerzatSharedFixture();
  const result = phone.api.selectSharedSalesContext(
    fixture.missionsStock, fixture.journees,
    { stockMissionId: "MST_GERZAT", journeeId: "J_GERZAT_J2" }
  );
  assert.equal(result.journee.journee_id, "J_GERZAT");
});

test("URL explicite d'un événement : prioritaire sur un cache local obsolète", async () => {
  const phone = setup(async () => ({ ok: true }));
  const fixture = gerzatSharedFixture();
  phone.store.set("lugdurum_preparation_context", JSON.stringify({
    mission_id: "MST_OTHER", stock_mission_id: "MST_OTHER", journee_id: "J_OTHER"
  }));
  phone.window.location.search = "?stock_mission_id=MST_GERZAT&journee_id=J_GERZAT";
  phone.window.LugdurumAPI.getCoreData = async () => ({ tables: fixture });
  await phone.api.loadContext();
  assert.equal(phone.api.state.journeeActive.journee_id, "J_GERZAT");
  assert.equal(phone.api.state.journeeActive.mission_id, "MST_GERZAT");
});

test("Plusieurs journées aujourd'hui : aucune mission sélectionnée au hasard", () => {
  const phone = setup(async () => ({ ok: true }));
  const fixture = gerzatSharedFixture();
  fixture.missionsStock.push({ mission_id: "MST_OTHER", statut: "pret" });
  fixture.journees.push({
    journee_id: "J_OTHER", stock_mission_id: "MST_OTHER",
    date: todayIsoLocal(), statut: "pret"
  });
  const result = phone.api.selectSharedSalesContext(
    fixture.missionsStock, fixture.journees, {}
  );
  assert.equal(result, null);
});

test("Une journée annulée ou un stock annulé ne peut être choisi", () => {
  const phone = setup(async () => ({ ok: true }));
  const fixture = gerzatSharedFixture();
  const forbidden = phone.api.selectSharedSalesContext(
    fixture.missionsStock, fixture.journees,
    { stockMissionId: "MST_OLD", journeeId: "J_OLD", explicitUrl: true }
  );
  assert.equal(forbidden.mission.mission_id, "MST_GERZAT");
});

test("vendeur absent : impossible d'enregistrer un ticket par erreur sous Jérôme", async () => {
  const phone = setup(async () => ({ ok: true }));
  phone.api.state.journeeActive.user_id = "";
  await phone.api.saveTicket();
  assert.equal(phone.calls.length, 0);
  assert.match(phone.api.els.saveStatus.textContent, /Choisis d'abord le vendeur/);
  assert.equal(phone.api.state.ticketItems.length, 1);
});

test("vendeurs distincts : l'ID de chaque ticket conserve son auteur propre", async () => {
  const jerome = setup(async () => ({ ok: true }));
  const anthony = setup(async () => ({ ok: true }));
  jerome.api.state.journeeActive.user_id = "U_JEROME";
  anthony.api.state.journeeActive.user_id = "U_ANTHONY";
  await Promise.all([jerome.api.saveTicket(), anthony.api.saveTicket()]);
  assert.equal(jerome.calls[0].transaction.user_id, "U_JEROME");
  assert.equal(anthony.calls[0].transaction.user_id, "U_ANTHONY");
  assert.notEqual(jerome.calls[0].transaction.transaction_id, anthony.calls[0].transaction.transaction_id);
});

test("Ventes de la journée : un seul bouton Fermer, modale accessible au clavier", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "docs", "vente-rapide.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "docs", "vente-rapide.css"), "utf8");
  const modal = html.split('id="dayDetailsOverlay"')[1]?.split('id="externalCbOverlay"')[0] || "";
  assert.match(modal, /id="closeDayDetailsBtn"/);
  assert.equal((modal.match(/class="saleDetailsClose"/g) || []).length, 1);
  assert.doesNotMatch(modal, /closeDayDetailsFooterBtn|saleDetailsFooter/);
  assert.doesNotMatch(source, /closeDayDetailsFooterBtn/);
  assert.doesNotMatch(css, /saleDetailsFooter/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key === "Tab" && els\.closeDayDetailsBtn/);
});
