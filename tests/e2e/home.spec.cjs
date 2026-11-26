const { test, expect } = require('@playwright/test');

const U = { j: 'U_JEROME', a: 'U_ANTHONY', w: 'U_WILL' };
const E = { c: 'EVT_COMMUNAY', g: 'EVT_GENAS', ch: 'EVT_CHARLY', t: 'EVT_TOUR', shared: 'EVT_SHARED' };
const D = { c: 'J_COMMUNAY', g: 'J_GENAS', ch: 'J_CHARLY', t1: 'J_TOUR_1', t2: 'J_TOUR_2', s1: 'J_SHARED_1', s2: 'J_SHARED_2' };
const auth = (...ids) => JSON.stringify(ids.map(user_id => ({ user_id })));

const events = [
  { mission_id: E.c, nom: 'Marché de Noël de Communay', date_debut: '2026-11-28', date_fin: '2026-11-28', lieu: 'Communay' },
  { mission_id: E.g, nom: 'Marché de Noël de Genas', date_debut: '2026-12-05', date_fin: '2026-12-05', lieu: 'Genas' },
  { mission_id: E.ch, nom: 'Marché de Noël de Charly', date_debut: '2026-11-28', date_fin: '2026-11-28', lieu: 'Charly' },
  { mission_id: E.t, nom: 'Marché de Noël de La Tour de Salvagny', date_debut: '2026-12-05', date_fin: '2026-12-06', lieu: 'La Tour de Salvagny' },
  { mission_id: E.shared, nom: 'Marché partagé', date_debut: '2026-12-12', date_fin: '2026-12-19' }
];
const day = (id, event, date, sellers, stock = '', jour = 'J1', statut = 'prevu') => ({ journee_id: id, mission_id: event, stock_mission_id: stock, date, jour_label: jour, statut, vendeurs_autorises: auth(...sellers) });
const days = [
  day(D.c, E.c, '2026-11-28', [U.j]), day(D.g, E.g, '2026-12-05', [U.j], 'MST_SHARED'),
  day(D.ch, E.ch, '2026-11-28', [U.a]), day(D.t1, E.t, '2026-12-05', [U.a, U.w]), day(D.t2, E.t, '2026-12-06', [U.a]),
  day(D.s1, E.shared, '2026-12-12', [U.j], 'MST_SHARED', 'J1'), day(D.s2, E.g, '2026-12-19', [U.j], 'MST_SHARED', 'J1')
];
const users = [
  { user_id: U.j, nom: 'Jérôme', role: 'admin', actif: true },
  { user_id: U.a, nom: 'Anthony', role: 'vendeur', actif: true },
  { user_id: U.w, nom: 'William', role: 'vendeur', actif: true }
];

async function installFixture(page, { selected = D.ch, offline = false, delayed = false } = {}) {
  await page.addInitScript(({ userId, staleDay, users, events, days, ids, delayed }) => {
    const NativeDate = globalThis.Date;
    const fixedNow = NativeDate.parse('2026-11-26T11:00:00.000Z');
    globalThis.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return fixedNow; }
    };
    localStorage.setItem('lugdurum_current_user_id', userId);
    localStorage.setItem('lugdurum_home_selected_journee:' + userId, staleDay);
    localStorage.setItem('lugdurum_home_selected_journee:' + userId + ':explicit', 'true');
    localStorage.setItem('lugdurum_users_list_cache', JSON.stringify(users));
    const fixtureApi = {
      setCurrentUserId() {},
      getHomeData(params = {}) {
        const activeUser = params.user_id || params.current_user_id || userId;
        const todayIso = params.today || '2026-11-26';
        const authorized = days.filter(d => JSON.parse(d.vendeurs_autorises).some(v => v.user_id === activeUser));
        const today = authorized.filter(d => d.date === todayIso && !/clotur|annul/i.test(d.statut || ''));
        const selected = authorized.find(d => d.journee_id === params.selected_day_id && !/clotur|annul/i.test(d.statut || ''));
        const day = today[0] || selected || authorized.find(d => d.date > todayIso && !/clotur|annul/i.test(d.statut || '')) || null;
        const event = events.find(e => e.mission_id === day?.mission_id) || null;
        const stock = day?.stock_mission_id ? { mission_id: day.stock_mission_id, statut: 'preparee', nom: 'Stock partagé' } : null;
        const context = { user_id: activeUser, journee_id: day?.journee_id || '', mission_id: day?.mission_id || '', stock_mission_id: day?.stock_mission_id || '' };
        const payload = { tables: { inscriptions: [], events, stockMissions: stock ? [stock] : [], journees: days, transactions: [], mouvementsStock: [] }, active: { journee: day, mission: stock, work_context: context, resume: { ca_jour_ttc: day?.journee_id === ids.c ? 125 : 450, nb_transactions: day?.journee_id === ids.c ? 2 : 7, ca_evenement_ttc: day?.journee_id === ids.c ? 125 : 950 } } };
        const respond = () => payload;
        return delayed && params.selected_day_id === ids.g
          ? new Promise(resolve => setTimeout(() => resolve(respond()), 500))
          : Promise.resolve(respond());
      },
      getCoreData() { return { inscriptions: [], missions: events, missionsStock: [], journees: days, transactions: [], mouvementsStock: [] }; }
    };
    globalThis.__LUGDURUM_HOME_FIXTURE__ = fixtureApi.getHomeData;
  }, { userId: U.j, staleDay: selected, users, events, days, ids: D, delayed });
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4173') await route.abort();
    else await route.fallback();
  });
  await page.route('**/home.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({ response, body: `window.LugdurumAPI.getHomeData = window.__LUGDURUM_HOME_FIXTURE__;\n${source}` });
  });
  if (offline) await page.context().setOffline(true);
}

test.beforeEach(async ({ page }, testInfo) => installFixture(page, { delayed: testInfo.title.includes('réseau retardée') }));

test('Jérôme voit Communay, Genas comme autre journée, et aucun marché d’un autre vendeur', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  const selector = page.locator('#homeDaySelect');
  const optionTexts = await selector.locator('option').allTextContents();
  expect(optionTexts.join(' ')).toContain('Genas');
  expect(optionTexts.join(' ')).not.toContain('Charly');
  expect(optionTexts.join(' ')).not.toContain('Salvagny');
  await expect(page.locator('.homeWorkflow')).not.toContainText('16 événements');
  await expect(page.locator('#watchList')).not.toContainText('Charly');
  await expect(page.locator('#watchList')).not.toContainText('Salvagny');
  await page.screenshot({ path: test.info().outputPath(`accueil-${test.info().project.name}.png`), fullPage: true });
});

test('le changement de journée actualise le contexte et le retour sans rechargement', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  const selector = page.locator('#homeDaySelect');
  await selector.selectOption(D.g);
  await expect(page.locator('#missionTitle')).toContainText('Genas');
  await expect(page.locator('#todayRevenue')).toContainText('450');
  await expect(page.locator('#homeEventRevenueTotal')).toContainText('950');
  await expect(page.locator('#primaryAction')).toHaveAttribute('href', /journee_id=J_GENAS/);
  await selector.selectOption(D.c);
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await expect(page.locator('#todayRevenue')).toContainText('125');
});

test('la sélection manuelle valide est restaurée au rechargement et le planning reste distinct', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#homeDaySelect').selectOption(D.g);
  await expect(page.locator('#missionTitle')).toContainText('Genas');
  await page.reload();
  await expect(page.locator('#missionTitle')).toContainText('Genas');
  await expect(page.locator('#generalPlanning')).toBeVisible();
  await expect(page.locator('#generalPlanning')).toContainText('Planning général Lugdurum');
  await expect(page.locator('#missionTitle')).not.toContainText('Charly');
  await expect(page.locator('#missionTitle')).not.toContainText('Salvagny');
});

test('les identités ne réutilisent pas une journée mémorisée d’un autre profil', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('.userPill').click();
  await page.getByRole('button', { name: 'Anthony', exact: true }).click();
  await expect(page.locator('#missionTitle')).toContainText('Charly');
  await page.locator('.userPill').click();
  await page.getByRole('button', { name: 'William', exact: true }).click();
  await expect(page.locator('#missionTitle')).toContainText('La Tour de Salvagny');
  await page.locator('.userPill').click();
  await page.getByRole('button', { name: 'Jérôme', exact: true }).click();
  await expect(page.locator('#missionTitle')).toContainText('Communay');
});

test('les deux journées conservent le stock partagé et la file locale', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.setItem('lugdurum_pending_writes', JSON.stringify([{ id: 'offline-queue-preserve' }])));
  await page.locator('#homeDaySelect').selectOption(D.s1);
  await expect(page.locator('#missionTitle')).toContainText('Marché partagé');
  await expect(page.locator('.workflowGrid')).toContainText('Ventes');
  await page.locator('#homeDaySelect').selectOption(D.s2);
  await expect(page.locator('#missionTitle')).toContainText('Genas');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('lugdurum_pending_writes')))).toEqual([{ id: 'offline-queue-preserve' }]);
});

test('la file d’attente reste intacte hors ligne et après le retour du réseau', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await page.evaluate(() => localStorage.setItem('lugdurum_pending_writes', JSON.stringify([{ id: 'offline-queue-preserve' }])));
  await page.context().setOffline(true);
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('lugdurum_pending_writes')))).toEqual([{ id: 'offline-queue-preserve' }]);
});

test('une réponse réseau retardée ne rétablit pas une journée précédente', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#homeDaySelect').selectOption(D.g);
  await page.locator('#homeDaySelect').selectOption(D.c);
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await page.waitForTimeout(650);
  await expect(page.locator('#missionTitle')).toContainText('Communay');
});
