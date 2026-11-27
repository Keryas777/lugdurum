const { test, expect } = require('@playwright/test');

const API_TAG = '<script src="./lugdurum-api.js?v=26" defer></script>';

async function bootWriteFixture(page, control = { kind: 'success' }) {
  await page.addInitScript(() => {
    const users = [
      { user_id: 'U_JEROME', nom: 'Jérôme', role: 'admin', actif: true },
      { user_id: 'U_ANTHONY', nom: 'Anthony', role: 'vendeur', actif: true },
      { user_id: 'U_WILL', nom: 'William', role: 'vendeur', actif: true }
    ];
    localStorage.setItem('lugdurum_current_user_id', 'U_JEROME');
    localStorage.setItem('lugdurum_users_list_cache', JSON.stringify(users));
    globalThis.__LUGDURUM_HOME_FIXTURE__ = () => ({
      tables: { inscriptions: [], events: [], stockMissions: [], journees: [], transactions: [], mouvementsStock: [] },
      active: {}
    });
    globalThis.__LUGDURUM_HOME_FIXTURE_CORE__ = () => ({
      inscriptions: [], missions: [], missionsStock: [], journees: [], transactions: [], mouvementsStock: []
    });
  });

  await page.route('**/macros/s/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.abort();
      return;
    }
    let payload = {};
    try { payload = JSON.parse(request.postData() || '{}'); } catch { /* réponse d'erreur ci-dessous */ }
    const action = payload.action || '';
    control.lastAction = action;
    if (control.kind === 'hold') {
      control.entered?.();
      await new Promise((resolve) => { control.release = resolve; });
    } else if (control.kind === 'holdAll') {
      control.started = (control.started || 0) + 1;
      control.entered?.(control.started);
      await control.waitPromise;
    } else if (control.kind === 'slow') {
      control.entered?.();
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    if (control.kind === 'unsupportedBundle' && action === 'saveVenteRapideBundle') {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ ok: false, error: 'Action POST inconnue : saveVenteRapideBundle' })
      });
      return;
    }
    if (control.kind === 'refused' || control.kind === 'validation') {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ ok: false, error: control.kind === 'validation'
          ? 'Champ obligatoire manquant.'
          : 'Accès refusé par le serveur.' })
      });
      return;
    }
    if (control.kind === 'uncertain') {
      await route.abort('failed');
      return;
    }
    const data = action === 'batchActions'
      ? { results: (payload.actions || []).map(item => ({ queue_id: item.queue_id, action: item.action, ok: true })) }
      : { saved: true };
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, GET, OPTIONS',
        'access-control-allow-headers': 'Content-Type'
      },
      body: JSON.stringify({ ok: true, data })
    });
  });

  await page.route((url) => url.href.includes('/docs/index.html'), async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    if (!source.includes(API_TAG)) throw new Error('La page d’accueil réelle ne référence pas LugdurumAPI.');
    await route.fulfill({
      response,
      body: source.replace(API_TAG, `${API_TAG}\n    <script src="../tests/e2e/api-bootstrap.js" defer></script>`)
    });
  });

  await page.goto('./index.html');
  await expect(page.locator('#missionTitle')).toContainText('Aucune journée de vente');
}

test('une écriture serveur lente affiche le voile puis confirme l’enregistrement', async ({ page }) => {
  const control = { kind: 'hold' };
  control.enteredPromise = new Promise((resolve) => { control.entered = resolve; });
  await bootWriteFixture(page, control);

  await page.evaluate(() => {
    window.__writePromise = window.LugdurumAPI.batchUpsert([]);
  });
  await control.enteredPromise;
  await expect(page.locator('.lugdurumWriteOverlay')).toBeVisible();
  await expect(page.locator('.lugdurumWritePanel')).toContainText('Écriture en cours…');
  await expect(page.locator('.lugdurumWritePanel')).toContainText('Merci de patienter.');
  await expect(page.locator('.appShell')).toHaveAttribute('aria-busy', 'true');
  expect(await page.locator('.appShell').evaluate((element) => element.inert)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`ecriture-en-cours-${test.info().project.name}.png`), fullPage: true });

  control.release();
  await expect(page.locator('.lugdurumWriteOverlay')).toBeHidden();
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Enregistrement effectué');
  await page.screenshot({ path: test.info().outputPath(`ecriture-confirmee-${test.info().project.name}.png`), fullPage: true });
});

test('une erreur de validation est distincte d’un refus serveur', async ({ page }) => {
  await bootWriteFixture(page, { kind: 'validation' });
  await page.evaluate(() => window.LugdurumAPI.batchUpsert([]).catch(() => null));
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Enregistrement non confirmé');
  await expect(page.locator('.lugdurumWriteToast')).toContainText('champ obligatoire manquant');
  await expect(page.locator('.lugdurumWriteDiagnostic')).toBeHidden();
  await expect(page.locator('.appShell')).not.toHaveAttribute('aria-busy', 'true');
});

test('une écriture refusée affiche un retour compréhensible et libère la page', async ({ page }) => {
  await bootWriteFixture(page, { kind: 'refused' });
  await page.evaluate(() => window.LugdurumAPI.batchUpsert([]).catch(() => null));
  await expect(page.locator('.lugdurumWriteOverlay')).toBeHidden();
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Enregistrement non confirmé');
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Le serveur a refusé');
  await expect(page.locator('.appShell')).not.toHaveAttribute('aria-busy', 'true');
  await page.screenshot({ path: test.info().outputPath(`ecriture-erreur-${test.info().project.name}.png`), fullPage: true });
});

test('une exception JavaScript ne laisse pas le voile bloqué', async ({ page }) => {
  await bootWriteFixture(page);
  const message = await page.evaluate(async () => {
    try {
      await window.LugdurumAPI.runUserWrite(() => { throw new Error('champ obligatoire manquant'); });
    } catch (error) {
      return error.message;
    }
    return '';
  });
  expect(message).toContain('obligatoire');
  await expect(page.locator('.lugdurumWriteOverlay')).toBeHidden();
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Enregistrement non confirmé');
  await expect(page.locator('.appShell')).not.toHaveAttribute('aria-busy', 'true');
});

test('une perte de réseau conserve l’écriture sans annoncer une confirmation serveur', async ({ page }) => {
  await bootWriteFixture(page, { kind: 'uncertain' });
  await page.evaluate(() => window.LugdurumAPI.batchUpsert([]));
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Enregistrement non confirmé');
  await expect(page.locator('.lugdurumWriteToast')).toContainText('interrompue pendant l’envoi');
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('lugdurum_pending_writes') || '[]'));
  expect(queued).toHaveLength(1);
  await expect(page.locator('.lugdurumWriteOverlay')).toBeHidden();
  await page.screenshot({ path: test.info().outputPath(`ecriture-incertaine-${test.info().project.name}.png`), fullPage: true });
});

test('hors ligne, une écriture confirmée dans la file locale affiche son état exact', async ({ page, context }) => {
  await bootWriteFixture(page);
  await context.setOffline(true);
  await page.evaluate(() => window.LugdurumAPI.batchUpsert([]));
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Enregistré sur cet appareil');
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Les données seront synchronisées');
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('lugdurum_pending_writes') || '[]'));
  expect(queued).toHaveLength(1);
  await page.screenshot({ path: test.info().outputPath(`ecriture-hors-ligne-${test.info().project.name}.png`), fullPage: true });
  await context.setOffline(false);
});

test('un échec de stockage local ne prétend pas avoir enregistré l’opération', async ({ page, context }) => {
  await bootWriteFixture(page);
  await context.setOffline(true);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'lugdurum_pending_writes') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.evaluate(() => window.LugdurumAPI.batchUpsert([]).catch(() => null));
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Échec de l’enregistrement local');
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Ne ferme pas cette page');
  await expect(page.locator('.lugdurumWriteDiagnostic')).toBeVisible();
  await expect(page.locator('.lugdurumWriteOverlay')).toBeHidden();
  await expect(page.locator('.appShell')).not.toHaveAttribute('aria-busy', 'true');
  await context.setOffline(false);
});

test('plusieurs écritures groupées conservent un seul voile jusqu’à la dernière réponse', async ({ page }) => {
  const control = { kind: 'holdAll' };
  control.allEntered = new Promise((resolve) => { control.entered = (count) => { if (count === 2) resolve(); }; });
  control.waitPromise = new Promise((resolve) => { control.release = resolve; });
  await bootWriteFixture(page, control);

  await page.evaluate(() => {
    window.__writePromise = Promise.all([
      window.LugdurumAPI.batchUpsert([]),
      window.LugdurumAPI.batchUpsert([])
    ]);
  });
  await control.allEntered;
  await expect(page.locator('.lugdurumWriteOverlay')).toBeVisible();
  control.release();
  await page.evaluate(() => window.__writePromise);
  await expect(page.locator('.lugdurumWriteOverlay')).toBeHidden();
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Enregistrement effectué');
});

test('le fallback d’un ancien Apps Script ne montre pas un faux refus et libère le voile', async ({ page }) => {
  await bootWriteFixture(page, { kind: 'unsupportedBundle' });
  await page.evaluate(() => window.LugdurumAPI.saveVenteRapideBundle({
    transaction: { transaction_id: 'TX_FALLBACK_E2E', lignes: [] },
    mouvements_stock: []
  }));
  await expect(page.locator('.lugdurumWriteOverlay')).toBeHidden();
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Enregistrement effectué');
  await expect(page.locator('.lugdurumWriteToast')).not.toContainText('refusé');
  await expect(page.locator('.appShell')).not.toHaveAttribute('aria-busy', 'true');
});

test('la synchronisation automatique en arrière-plan ne couvre pas l’interface', async ({ page, context }) => {
  const control = { kind: 'hold' };
  control.enteredPromise = new Promise((resolve) => { control.entered = resolve; });
  await bootWriteFixture(page, control);
  await context.setOffline(true);
  await page.evaluate(() => window.LugdurumAPI.batchUpsert([]));
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Enregistré sur cet appareil');
  await context.setOffline(false);
  await page.evaluate(() => {
    window.__flushPromise = window.LugdurumAPI.flushPendingWrites();
  });
  await control.enteredPromise;
  await expect(page.locator('.lugdurumWriteOverlay')).toBeHidden();
  await expect(page.locator('.appShell')).not.toHaveAttribute('aria-busy', 'true');
  control.release();
  await page.evaluate(() => window.__flushPromise);
  await expect.poll(() => page.evaluate(() => window.LugdurumAPI.getPendingWritesCount())).toBe(0);
});

test('après fermeture et réouverture, la file locale reste intacte sans voile bloqué', async ({ page, context }) => {
  await bootWriteFixture(page);
  await context.setOffline(true);
  await page.evaluate(() => window.LugdurumAPI.batchUpsert([]));
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Enregistré sur cet appareil');
  await page.close();

  const reopened = await context.newPage();
  await bootWriteFixture(reopened);
  await expect(reopened.locator('.lugdurumWriteOverlay')).toBeHidden();
  await expect.poll(() => reopened.evaluate(() => window.LugdurumAPI.getPendingWritesCount())).toBe(1);
  await context.setOffline(false);
});

test('une vente SumUp reste sur son chemin local rapide, sans voile réseau', async ({ page, context }) => {
  await bootWriteFixture(page);
  await context.setOffline(true);
  await page.evaluate(() => {
    const transaction = {
      transaction_id: 'TX_SUMUP_E2E', sumup_foreign_tx_id: 'TX_SUMUP_E2E',
      paiement_provider: 'SUMUP', mode_paiement: 'CB', statut: 'validee',
      paiement_statut: 'PAYE', total_encaisse_ttc: 42
    };
    const result = window.LugdurumAPI.queueSumupSale({ transaction, mouvements_stock: [] });
    window.LugdurumAPI.showWriteResult(result);
  });
  await expect(page.locator('.lugdurumWriteOverlay')).toBeHidden();
  await expect(page.locator('.lugdurumWriteToast')).toContainText('Enregistré sur cet appareil');
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('lugdurum_pending_writes') || '[]'));
  expect(queued).toHaveLength(1);
});
