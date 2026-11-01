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
    "selectSharedSalesContext, loadContext, computeEventSummaryFromTransactions, " +
    "addBottle, offerOneBottle, renderProducts };\n})();"
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
  const queuedSales = [];
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
      queueSumupSale(payload) {
        queuedSales.push(payload);
        return { queued: true, pending_count: 1 };
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
  return { api, calls, queuedSales, store, timers, window };
}


const bottle20 = (code, order = 1) => ({
  sku_id: code + "_20",
  parfum_code: code,
  parfum_nom: code === "PE" ? "Pain d'Épices" : "Vanille Tonka",
  format_cl: 20,
  gamme_tarif: "classique",
  vendable_seul: false,
  composable_coffret: true,
  actif: true,
  visible_webapp: true,
  ordre_affichage: order
});

test("20 cL à l'unité : 15 € par défaut, sauf PE à 16 €, sans offres Sheets", () => {
  const app = setup(async () => ({ ok: true }));
  app.api.state.selectedMode = "BOTTLE_20";
  app.api.state.ticketItems = [];
  app.api.state.catalogue = [bottle20("VT"), bottle20("PE", 2)];
  app.api.state.offresVente = [];
  app.api.state.dataLoaded = true;

  app.api.renderProducts();
  const tiles = app.api.els.productGrid.innerHTML;
  assert.match(tiles, /20 cL · 15\s*€/u);
  assert.match(tiles, /20 cL · 16\s*€/u);
  assert.doesNotMatch(tiles, /prix à saisir au ticket/);

  app.api.addBottle(app.api.state.catalogue[0]);
  app.api.addBottle(app.api.state.catalogue[1]);
  assert.deepEqual(app.api.state.ticketItems.map((item) => item.prix_unitaire_ttc), [15, 16]);
  assert.deepEqual(app.api.state.ticketItems.map((item) => item.prix_unitaire_ht), [15, 16]);
});

test("20 cL offert parmi les achats : 0 € uniquement pour la ligne cadeau et sortie stock", async () => {
  const app = setup(async () => ({ ok: true }));
  const vt = bottle20("VT");
  const pe = bottle20("PE", 2);
  app.api.state.selectedMode = "BOTTLE_20";
  app.api.state.catalogue = [vt, pe];
  app.api.state.offresVente = [];
  app.api.state.ticketItems = [];
  app.api.addBottle(vt);
  app.api.addBottle(pe);
  app.api.addBottle(pe);

  const peLine = app.api.state.ticketItems.find((item) => item.parfum_code === "PE");
  app.api.offerOneBottle(peLine.item_id);
  const peItems = app.api.state.ticketItems.filter((item) => item.parfum_code === "PE");
  assert.equal(peItems.length, 2);
  assert.equal(peItems.find((item) => item.offert).prix_unitaire_ttc, 0);
  assert.equal(peItems.find((item) => !item.offert).prix_unitaire_ttc, 16);
  assert.match(app.api.els.ticketLines.innerHTML, /Offrir 1 bouteille/);

  app.api.els.amountPaidInput.value = "";
  await app.api.saveTicket();
  assert.equal(app.calls.length, 1);
  const saved = app.calls[0];
  assert.equal(saved.transaction.total_encaisse_ttc, 31);
  assert.equal(saved.transaction.lignes.length, 3);
  assert.ok(saved.transaction.lignes.some((line) =>
    line.parfum_code === "PE" && line.prix_unitaire_ttc === 0 && /Cadeau/.test(line.note)
  ));
  assert.equal(saved.mouvements_stock.length, 3);
  assert.equal(saved.mouvements_stock.reduce((sum, m) => sum + m.quantite, 0), 3);
  assert.equal(saved.mouvements_stock.filter((m) => m.sku_id === "PE_20").length, 2);
});

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

test("SumUp : sauvegarde locale immédiate, caisse débloquée sans POST Sheets", async () => {
  const app = setup(() => { throw new Error("POST inattendu pendant SumUp"); });
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

  await app.api.confirmSumupSuccess();

  assert.equal(app.calls.length, 0, "Aucun POST bloquant vers Sheets");
  assert.equal(app.queuedSales.length, 1, "Un seul bundle local");
  assert.equal(app.queuedSales[0].transaction.transaction_id, foreignId);
  assert.equal(app.queuedSales[0].mouvements_stock.length, 1);
  assert.equal(app.api.state.saveInProgress, false);
  assert.equal(app.api.els.sumupConfirmFailBtn.disabled, false);
  assert.equal(app.api.els.sumupReturnBtn.disabled, false);
  assert.equal(app.store.has("lugdurum_pending_sumup_ticket"), false);
  assert.equal(app.api.state.ticketItems.length, 0);
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
  const mouvementsStock = [
    { mouvement_stock_id: "PREP_GERZAT_50", stock_mission_id: "MST_GERZAT",
      journee_id: "J_GERZAT", type_mouvement: "PREPARATION",
      sku_id: "VT_50", format_cl: 50, quantite: 92, statut: "valide" },
    { mouvement_stock_id: "PREP_GERZAT_20", stock_mission_id: "MST_GERZAT",
      journee_id: "J_GERZAT", type_mouvement: "PREPARATION",
      sku_id: "VT_20", format_cl: 20, quantite: 60, statut: "valide" }
  ];
  return { missionsStock, journees, transactions, mouvementsStock };
};

test("2 téléphones : J1, stock disponible depuis mouvements et CA commun retrouvés", async () => {
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
    assert.equal(phone.api.state.stockSummary.source, "preparation");
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
    ["transactions"],
    ["mouvementsStock"]
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

test("CA événement : J1 + J2, deux vendeurs, autre foire sur le même stock", () => {
  const app = setup(async () => ({ ok: true }));
  app.api.state.journeeActive.journee_id = "JV_GERZAT_J2";
  app.api.state.journees = [
    { journee_id: "JV_GERZAT_J1", mission_id: "EV_GERZAT", stock_mission_id: "MS_COMMUN", statut: "cloture" },
    { journee_id: "JV_GERZAT_J2", mission_id: "EV_GERZAT", stock_mission_id: "MS_COMMUN", statut: "en_cours" },
    { journee_id: "JV_AUTRE_J1", mission_id: "EV_AUTRE", stock_mission_id: "MS_COMMUN", statut: "en_cours" },
    { journee_id: "JV_ANNULEE", mission_id: "EV_GERZAT", stock_mission_id: "MS_COMMUN", statut: "annule" }
  ];
  const tx = (id, day, amount, user, status = "validee") => ({
    transaction_id: id, journee_id: day, mission_id: "MS_COMMUN", user_id: user,
    total_encaisse_ttc: amount, statut: status, paiement_statut: "PAYE"
  });
  const transactions = [
    tx("T1", "JV_GERZAT_J1", 75.01, "U_ANTHONY"),
    tx("T2", "JV_GERZAT_J2", 29.99, "U_JEROME"),
    tx("T2", "JV_GERZAT_J2", 29.99, "U_JEROME"),
    tx("T3", "JV_AUTRE_J1", 120, "U_ANTHONY"),
    tx("T4", "JV_GERZAT_J2", 8, "U_JEROME", "annulee"),
    tx("T5", "JV_ANNULEE", 12, "U_JEROME")
  ];
  const result = app.api.computeEventSummaryFromTransactions(transactions);
  assert.equal(result.revenue, 105);
  assert.equal(result.tickets, 2);
});

test("CA événement : pas de total trompeur sans journée liée à un événement", () => {
  const app = setup(async () => ({ ok: true }));
  assert.equal(app.api.computeEventSummaryFromTransactions([]).revenue, null);
});


test("Catalogue de vente rapide : toujours deux colonnes de parfums", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "docs", "vente-rapide.css"), "utf8"
  );
  const rules = [...css.matchAll(/\.productGrid\s*\{([^}]*)\}/g)];
  assert.equal(rules.length, 1, "Aucune media query ne doit modifier la grille des parfums");
  assert.match(rules[0][1], /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.productBtn\s*\{[^}]*min-width:\s*0;/);
});
