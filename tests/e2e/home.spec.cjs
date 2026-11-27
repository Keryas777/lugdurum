const { test, expect } = require('@playwright/test');

const U = { j: 'U_JEROME', a: 'U_ANTHONY', w: 'U_WILL' };
const E = { c: 'EVT_COMMUNAY', g: 'EVT_GENAS', ch: 'EVT_CHARLY', t: 'EVT_TOUR', shared: 'EVT_SHARED' };
const D = { c: 'J_COMMUNAY', g: 'J_GENAS', ch: 'J_CHARLY', t1: 'J_TOUR_1', t2: 'J_TOUR_2', s1: 'J_SHARED_1', s2: 'J_SHARED_2', noStock: 'J_NO_STOCK', unprepared: 'J_UNPREPARED' };
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
  day(D.ch, E.ch, '2026-11-28', [U.a]),
  day(D.t1, E.t, '2026-12-05', [U.a, U.w], 'MST_SHARED', 'J1', 'cloture'),
  day(D.t2, E.t, '2026-12-06', [U.a, U.w], 'MST_SHARED', 'J2'),
  day(D.s1, E.shared, '2026-12-12', [U.j], 'MST_SHARED', 'J1', 'cloture'),
  day(D.s2, E.shared, '2026-12-13', [U.j], 'MST_SHARED', 'J2'),
  day(D.noStock, E.shared, '2026-12-20', [U.j]),
  day(D.unprepared, E.shared, '2026-12-21', [U.j], 'MST_UNPREPARED')
];
const users = [
  { user_id: U.j, nom: 'Jérôme', role: 'admin', actif: true },
  { user_id: U.a, nom: 'Anthony', role: 'vendeur', actif: true },
  { user_id: U.w, nom: 'William', role: 'vendeur', actif: true }
];

async function installFixture(page, { selected = D.ch, offline = false, delayed = false, legacy = false } = {}) {
  await page.addInitScript(({ userId, staleDay, users, events, days, ids, delayed, legacy }) => {
    const NativeDate = globalThis.Date;
    let fixedNow = NativeDate.parse(`${localStorage.getItem('__lugdurum_e2e_today') || '2026-11-26'}T11:00:00.000Z`);
    globalThis.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return fixedNow; }
    };
    localStorage.setItem('lugdurum_current_user_id', userId);
    const selectedDayKey = 'lugdurum_home_selected_journee:' + userId;
    if (localStorage.getItem(selectedDayKey) === null) {
      localStorage.setItem(selectedDayKey, staleDay);
      localStorage.setItem(selectedDayKey + ':explicit', 'true');
    }
    localStorage.setItem('lugdurum_users_list_cache', JSON.stringify(users));
    const fixtureState = {
      events: structuredClone(events), days: structuredClone(days), users: structuredClone(users),
      stockMissions: [
        { mission_id: 'MST_SHARED', nom: 'Stock partagé', statut: 'preparee', stock_prepare: true },
        { mission_id: 'MST_UNPREPARED', nom: 'Stock à préparer', statut: 'a_preparer', stock_prepare: false }
      ],
      calls: [], coreDataCalls: 0
    };
    globalThis.__LUGDURUM_FIXTURE_STATE__ = fixtureState;
    globalThis.__LUGDURUM_FIXTURE_CONTROL__ = {
      setToday(value) {
        fixedNow = NativeDate.parse(`${value}T11:00:00.000Z`);
        localStorage.setItem('__lugdurum_e2e_today', value);
      },
      setDayStatus(id, status) {
        const target = fixtureState.days.find(item => item.journee_id === id);
        if (target) target.statut = status;
      },
      setDaySellers(id, sellerIds) {
        const target = fixtureState.days.find(item => item.journee_id === id);
        if (target) target.vendeurs_autorises = JSON.stringify(sellerIds.map(user_id => ({ user_id })));
      }
    };
    const fixtureApi = {
      setCurrentUserId() {},
      getHomeData(params = {}) {
        fixtureState.calls.push(structuredClone(params));
        const activeUser = params.user_id || params.current_user_id || userId;
        const todayIso = params.today || new NativeDate(fixedNow).toISOString().slice(0, 10);
        const authorized = fixtureState.days
          .filter(d => JSON.parse(d.vendeurs_autorises).some(v => v.user_id === activeUser))
          .filter(d => !/clotur|annul/i.test(d.statut || ''))
          .sort((a, b) => a.date.localeCompare(b.date) || a.journee_id.localeCompare(b.journee_id));
        const today = authorized.filter(d => d.date === todayIso);
        const selected = authorized.find(d => d.journee_id === params.selected_day_id);
        const day = today.length
          ? (today.find(d => d.journee_id === params.selected_day_id) || (today.length === 1 ? today[0] : null))
          : (selected || authorized.find(d => d.date > todayIso) || null);
        const event = fixtureState.events.find(e => e.mission_id === day?.mission_id) || null;
        const stock = fixtureState.stockMissions.find(m => m.mission_id === day?.stock_mission_id) || null;
        const context = { user_id: activeUser, journee_id: day?.journee_id || '', mission_id: day?.mission_id || '', stock_mission_id: day?.stock_mission_id || '' };
        const revenue = day?.journee_id === ids.c ? 125 : day?.journee_id === ids.g ? 450 : day?.journee_id?.includes('TOUR') ? 650 : 777;
        const payload = { tables: { inscriptions: [], events: fixtureState.events, stockMissions: fixtureState.stockMissions, journees: fixtureState.days, transactions: [], mouvementsStock: [] }, active: { journee: day, mission: stock, work_context: context, resume: { ca_jour_ttc: revenue, nb_transactions: day?.journee_id === ids.c ? 2 : 7, ca_evenement_ttc: revenue } } };
        if (legacy) {
          return Promise.resolve({
            tables: payload.tables,
            active: { journee: fixtureState.days.find(item => item.journee_id === ids.t1) || null },
            upcomingItems: fixtureState.events,
            selected: { type: 'mission', id: ids.t }
          });
        }
        const respond = () => payload;
        return delayed && params.selected_day_id === ids.g
          ? new Promise(resolve => setTimeout(() => resolve(respond()), 1200))
          : Promise.resolve(respond());
      },
      getCoreData() {
        fixtureState.coreDataCalls += 1;
        return { inscriptions: [], missions: fixtureState.events, missionsStock: fixtureState.stockMissions, journees: fixtureState.days, transactions: [], mouvementsStock: [] };
      }
    };
    globalThis.__LUGDURUM_HOME_FIXTURE__ = fixtureApi.getHomeData;
    globalThis.__LUGDURUM_HOME_FIXTURE_CORE__ = fixtureApi.getCoreData;
  }, { userId: U.j, staleDay: selected, users, events, days, ids: D, delayed, legacy });
  page.__fixtureExternalRequests = [];
  page.on('request', request => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4173') page.__fixtureExternalRequests.push(request.url());
  });
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4173') {
      page.__fixtureExternalRequests.push(route.request().url());
      await route.abort();
    }
    else await route.fallback();
  });
  await page.route(url => url.href.includes('/docs/index.html'), async route => {
    const response = await route.fetch();
    const source = await response.text();
    const apiTag = '<script src="./lugdurum-api.js?v=24" defer></script>';
    if (!source.includes(apiTag)) throw new Error('La page réelle ne contient pas la balise LugdurumAPI attendue.');
    await route.fulfill({
      response,
      body: source.replace(apiTag, `${apiTag}\n    <script src="../tests/e2e/api-bootstrap.js" defer></script>`)
    });
  });
  if (offline) await page.context().setOffline(true);
}

test.beforeEach(async ({ page }, testInfo) => installFixture(page, {
  delayed: testInfo.title.includes('réseau retardée') || testInfo.title.includes('réponse retardée'),
  legacy: testInfo.title.includes('ancien Apps Script')
}));

test.afterEach(async ({ page }) => {
  const pages = new Set([page, ...page.context().pages()]);
  const externalRequests = [...pages].flatMap(currentPage => currentPage.__fixtureExternalRequests || []);
  expect(externalRequests, 'aucune requête vers API ou service externe ne doit sortir du mock').toEqual([]);
});

async function expectActionContext(page, locator, { user, day, event, stock = '' }) {
  const href = await locator.getAttribute('href');
  expect(href, 'l’action doit rester un lien réellement activé').toBeTruthy();
  const url = new URL(href, page.url());
  expect(url.searchParams.get('user_id')).toBe(user);
  expect(url.searchParams.get('journee_id')).toBe(day);
  expect(url.searchParams.get('mission_id')).toBe(event);
  expect(url.searchParams.get('event_id')).toBe(event);
  expect(url.searchParams.get('stock_mission_id') || '').toBe(stock);
}

test('Jérôme voit Communay, Genas comme autre journée, et aucun marché d’un autre vendeur', async ({ page }) => {
  await page.goto('./index.html');
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  const selector = page.locator('#homeDaySelect');
  const optionTexts = await selector.locator('option').allTextContents();
  expect(optionTexts.join(' ')).toContain('Genas');
  expect(optionTexts.join(' ')).not.toContain('Charly');
  expect(optionTexts.join(' ')).not.toContain('Salvagny');
  await expect(page.locator('.homeWorkflow')).not.toContainText('16 événements');
  await expect(page.locator('#watchList')).not.toContainText('Charly');
  await expect(page.locator('#watchList')).not.toContainText('Salvagny');
  await expect(page.locator('body')).not.toContainText('Marché de Noël de Charly');
  await expect(page.locator('body')).not.toContainText('La Tour de Salvagny');
  await expect(page.locator('#todayRevenue')).toContainText('125');
  await expect(page.locator('#homeEventRevenueTotal')).toContainText('125');
  const homeCall = await page.evaluate(() => window.__LUGDURUM_FIXTURE_STATE__.calls[0]);
  expect(homeCall.user_id).toBe(U.j);
  expect(homeCall.selected_day_id).toBe(D.ch);
  expect(homeCall.work_context).toBe(true);
  expect(homeCall.ignore_legacy_context).toBe(true);
  await expectActionContext(page, page.locator('#primaryAction'), { user: U.j, day: D.c, event: E.c });
  await expect(page.locator('.lugdurumDataStateBadgeText')).toContainText('en ligne');
  await page.screenshot({ path: test.info().outputPath(`accueil-${test.info().project.name}.png`), fullPage: true });
});

test('les anciens paramètres URL ne remplacent pas la journée personnelle', async ({ page }) => {
  await page.goto('./index.html?selected_type=mission&selected_id=EVT_CHARLY&journee_id=J_CHARLY&mission_id=EVT_TOUR&stock_mission_id=MST_SHARED');
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await expect(page.locator('body')).not.toContainText('Marché de Noël de Charly');
  await expect(page.locator('body')).not.toContainText('La Tour de Salvagny');
  await expectActionContext(page, page.locator('#primaryAction'), { user: U.j, day: D.c, event: E.c });
});

test('le changement de journée actualise le contexte et le retour sans rechargement', async ({ page }) => {
  await page.goto('./index.html');
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  const selector = page.locator('#homeDaySelect');
  await selector.selectOption(D.g);
  await expect(page.locator('#missionTitle')).toContainText('Genas');
  const genasCall = await page.evaluate(id => window.__LUGDURUM_FIXTURE_STATE__.calls.find(call => call.selected_day_id === id), D.g);
  expect(genasCall.user_id).toBe(U.j);
  expect(genasCall.selected_day_id).toBe(D.g);
  expect(genasCall.work_context).toBe(true);
  await expect(page.locator('#todayRevenue')).toContainText('450');
  await expect(page.locator('#homeEventRevenueTotal')).toContainText('450');
  await expectActionContext(page, page.locator('#primaryAction'), { user: U.j, day: D.g, event: E.g, stock: 'MST_SHARED' });
  await expectActionContext(page, page.locator('#feesToolLink'), { user: U.j, day: D.g, event: E.g, stock: 'MST_SHARED' });
  await expectActionContext(page, page.locator('.workflowGrid [data-step="vente"]'), { user: U.j, day: D.g, event: E.g, stock: 'MST_SHARED' });
  await selector.selectOption(D.c);
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await expect(page.locator('#todayRevenue')).toContainText('125');
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
});

test('la sélection manuelle valide est restaurée après fermeture et réouverture', async ({ page }) => {
  await page.goto('./index.html');
  await page.locator('#homeDaySelect').selectOption(D.g);
  await expect(page.locator('#missionTitle')).toContainText('Genas');
  const context = page.context();
  await page.close();
  const reopenedPage = await context.newPage();
  await installFixture(reopenedPage);
  await reopenedPage.goto('./index.html');
  await expect(reopenedPage.locator('#missionTitle')).toContainText('Genas');
  await expect(reopenedPage.locator('#generalPlanning')).toBeVisible();
  await expect(reopenedPage.locator('#generalPlanning')).toContainText('Planning général Lugdurum');
  await expect(reopenedPage.locator('#missionTitle')).not.toContainText('Charly');
  await expect(reopenedPage.locator('#missionTitle')).not.toContainText('Salvagny');
});

test('les identités ne réutilisent pas une journée mémorisée d’un autre profil', async ({ page }) => {
  await page.goto('./index.html');
  await page.locator('.userPill').click({ force: true });
  await page.getByRole('button', { name: /Anthony/ }).click();
  await expect(page.locator('#missionTitle')).toContainText('Charly');
  await expect(page.locator('#generalPlanning')).toBeVisible();
  await page.locator('.userPill').click({ force: true });
  await page.getByRole('button', { name: /William/ }).click();
  await expect(page.locator('#missionTitle')).toContainText('La Tour de Salvagny');
  await expect(page.locator('.workflowGrid [data-step="vente"]')).toBeVisible();
  await expect(page.locator('.workflowGrid [data-step="cloture"]')).toBeVisible();
  await expect(page.locator('.workflowGrid [data-step="stock"]')).toHaveCount(0);
  await expectActionContext(page, page.locator('.workflowGrid [data-step="vente"]'), { user: U.w, day: D.t2, event: E.t, stock: 'MST_SHARED' });
  await page.locator('.userPill').click({ force: true });
  await page.getByRole('button', { name: /Jérôme/ }).click();
  await expect(page.locator('#missionTitle')).toContainText('Communay');
});

test('la clôture J1 laisse le stock partagé disponible pour J2 et un autre évènement', async ({ page }) => {
  await page.goto('./index.html');
  const options = await page.locator('#homeDaySelect option').evaluateAll(nodes => nodes.map(node => node.value));
  expect(options).not.toContain(D.s1);
  await page.locator('#homeDaySelect').selectOption(D.g);
  await expect(page.locator('#missionTitle')).toContainText('Genas');
  await expect(page.locator('.workflowGrid')).toContainText('journée(s) partagent cette mission de stock');
  await expectActionContext(page, page.locator('.workflowGrid [data-step="vente"]'), { user: U.j, day: D.g, event: E.g, stock: 'MST_SHARED' });
  await page.locator('#homeDaySelect').selectOption(D.s2);
  await expect(page.locator('#missionTitle')).toContainText('Marché partagé');
  await expect(page.locator('#homeEventRevenue')).toBeVisible();
  await expectActionContext(page, page.locator('#feesToolLink'), { user: U.j, day: D.s2, event: E.shared, stock: 'MST_SHARED' });
});

test('les écritures locales restent intactes hors ligne et après le retour du réseau', async ({ page }) => {
  await page.goto('./index.html');
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await page.context().setOffline(true);
  const queued = await page.evaluate(() => window.LugdurumAPI.enqueueAction('upsertTransaction', {
    transaction_id: 'E2E_OFFLINE_TX', user_id: 'U_JEROME', journee_id: 'J_COMMUNAY',
    mission_id: 'EVT_COMMUNAY', stock_mission_id: ''
  }));
  expect(queued.queued).toBe(true);
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await expect.poll(() => page.evaluate(() => window.LugdurumAPI.getPendingWrites().some(item => item.payload?.transaction_id === 'E2E_OFFLINE_TX'))).toBe(true);
});

test('une mission de stock absente propose l’association avec le contexte de la journée', async ({ page }) => {
  await page.goto('./index.html');
  await page.locator('#homeDaySelect').selectOption(D.noStock);
  await expect(page.locator('#missionTitle')).toContainText('Marché partagé');
  await expect(page.locator('#activeStatusLabel')).toContainText('à associer');
  await expect(page.locator('.workflowGrid [data-step="missions"]')).toBeVisible();
  await expectActionContext(page, page.locator('#primaryAction'), { user: U.j, day: D.noStock, event: E.shared });
  await expect(page.locator('.workflowGrid [data-step="vente"]')).toHaveAttribute('aria-disabled', 'true');
});

test('une mission de stock non préparée propose la préparation correspondante', async ({ page }) => {
  await page.goto('./index.html');
  await page.locator('#homeDaySelect').selectOption(D.unprepared);
  await expect(page.locator('#activeStatusLabel')).toContainText('Stock à préparer');
  await expect(page.locator('#primaryAction')).toHaveAttribute('href', /preparation-stock\.html/);
  await expectActionContext(page, page.locator('#primaryAction'), { user: U.j, day: D.unprepared, event: E.shared, stock: 'MST_UNPREPARED' });
  await expect(page.locator('.workflowGrid [data-step="stock"]')).toBeVisible();
});

test('la clôture distante invalide la sélection mémorisée et garde le stock des autres journées', async ({ page }) => {
  await page.goto('./index.html');
  await page.locator('#homeDaySelect').selectOption(D.g);
  await expect(page.locator('#missionTitle')).toContainText('Genas');
  await page.evaluate(id => window.__LUGDURUM_FIXTURE_CONTROL__.setDayStatus(id, 'cloture'), D.g);
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  const values = await page.locator('#homeDaySelect option').evaluateAll(nodes => nodes.map(node => node.value));
  expect(values).not.toContain(D.g);
  expect(values).toContain(D.s2);
  await page.locator('#homeDaySelect').selectOption(D.s2);
  await expect(page.locator('#missionTitle')).toContainText('Marché partagé');
  await expectActionContext(page, page.locator('#feesToolLink'), { user: U.j, day: D.s2, event: E.shared, stock: 'MST_SHARED' });
});

test('une affectation modifiée sur le serveur met à jour le parcours personnel', async ({ page }) => {
  await page.goto('./index.html');
  let optionText = await page.locator('#homeDaySelect').locator('option').allTextContents();
  expect(optionText.join(' ')).not.toContain('Charly');
  await page.evaluate(({ id, user }) => window.__LUGDURUM_FIXTURE_CONTROL__.setDaySellers(id, [user]), { id: D.ch, user: U.j });
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#homeDaySelect')).toContainText('Charly');
  await page.locator('#homeDaySelect').selectOption(D.ch);
  await expect(page.locator('#missionTitle')).toContainText('Charly');
  await page.evaluate(({ id, user }) => window.__LUGDURUM_FIXTURE_CONTROL__.setDaySellers(id, [user]), { id: D.ch, user: U.a });
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  optionText = await page.locator('#homeDaySelect').locator('option').allTextContents();
  expect(optionText.join(' ')).not.toContain('Charly');
});

test('plusieurs journées le même jour demandent un choix explicite', async ({ page }) => {
  await page.goto('./index.html');
  await page.evaluate(({ date, id, event, user }) => {
    const state = window.__LUGDURUM_FIXTURE_STATE__;
    window.__LUGDURUM_FIXTURE_CONTROL__.setToday(date);
    state.days.push({ journee_id: id, mission_id: event, stock_mission_id: 'MST_SHARED', date,
      jour_label: 'J2', statut: 'prevu', vendeurs_autorises: JSON.stringify([{ user_id: user }]) });
  }, { date: '2026-11-28', id: 'J_COMMUNAY_J2', event: E.c, user: U.j });
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#missionTitle')).toContainText('Plusieurs journées aujourd’hui');
  const options = await page.locator('#homeDaySelect option').evaluateAll(nodes => nodes.map(node => node.value));
  expect(options).toContain(D.c);
  expect(options).toContain('J_COMMUNAY_J2');
  await page.locator('#homeDaySelect').selectOption('J_COMMUNAY_J2');
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await expectActionContext(page, page.locator('#primaryAction'), { user: U.j, day: 'J_COMMUNAY_J2', event: E.c, stock: 'MST_SHARED' });
});

test('une journée qui arrive aujourd’hui reprend la priorité sur le futur mémorisé', async ({ page }) => {
  await page.goto('./index.html');
  await page.locator('#homeDaySelect').selectOption(D.g);
  await expect(page.locator('#missionTitle')).toContainText('Genas');
  await page.evaluate(() => window.__LUGDURUM_FIXTURE_CONTROL__.setToday('2026-11-28'));
  await page.reload();
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lugdurum_home_selected_journee:U_JEROME'))).toBe(D.c);
});

test('sans journée affectée, l’accueil affiche un état vide explicite', async ({ page }) => {
  await page.goto('./index.html');
  await page.evaluate(userId => {
    window.__LUGDURUM_FIXTURE_STATE__.days.forEach(day => {
      day.vendeurs_autorises = JSON.stringify(JSON.parse(day.vendeurs_autorises).filter(user => user.user_id !== userId));
    });
  }, U.j);
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#missionTitle')).toContainText('Aucune journée de vente');
  await expect(page.locator('.workflowEmpty')).toContainText('dès qu’une journée de vente te sera affectée');
  await expect(page.locator('#homeDaySelect')).toBeDisabled();
  await expect(page.locator('#primaryAction')).toBeHidden();
});

test('une réponse retardée de Jérôme ne remplace pas le contexte après changement de profil', async ({ page }) => {
  await page.goto('./index.html');
  await page.locator('#homeDaySelect').selectOption(D.g);
  await page.locator('.userPill').click({ force: true });
  await page.getByRole('button', { name: /Anthony/ }).click();
  await expect(page.locator('#missionTitle')).toContainText('Charly');
  await page.waitForTimeout(1800);
  await expect(page.locator('#missionTitle')).toContainText('Charly');
  await expect(page.locator('#todayRevenue')).toContainText('777');
  await expectActionContext(page, page.locator('#primaryAction'), { user: U.a, day: D.ch, event: E.ch });
  await expect(page.locator('body')).not.toContainText('Genas');
});

test('le nouveau frontend retombe sur les tables complètes avec un ancien Apps Script', async ({ page }) => {
  await page.goto('./index.html');
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await expect(page.locator('body')).not.toContainText('Marché de Noël de Charly');
  await expect(page.locator('body')).not.toContainText('La Tour de Salvagny');
  await expect.poll(() => page.evaluate(() => window.__LUGDURUM_FIXTURE_STATE__.coreDataCalls)).toBeGreaterThan(0);
  await expect(page.locator('#todayRevenue')).toContainText('0');
});

test('le planning général ne modifie pas la journée et une journée étrangère est refusée', async ({ page }) => {
  await page.goto('./index.html');
  await expect(page.locator('#generalPlanning')).toBeVisible();
  const planningHref = await page.locator('#generalPlanning a').first().getAttribute('href');
  expect(new URL(planningHref, page.url()).search).toBe('');
  await page.locator('#homeDaySelect').evaluate((select, id) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = 'Journée étrangère';
    select.append(option);
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, D.ch);
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await expect(page.locator('#eventSelectorHint')).toContainText('n’est plus ouverte ou ne t’est plus affectée');
  await expect(page.locator('.workflowGrid [data-step="vente"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.workflowGrid [data-step="vente"]')).not.toHaveAttribute('href', /./);
  await expectActionContext(page, page.locator('#primaryAction'), { user: U.j, day: D.c, event: E.c });
});

test('une réponse réseau retardée ne rétablit pas une journée précédente', async ({ page }) => {
  await page.goto('./index.html');
  await page.locator('#homeDaySelect').selectOption(D.g);
  await page.locator('#homeDaySelect').selectOption(D.c);
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  await page.waitForTimeout(1400);
  await expect(page.locator('#missionTitle')).toContainText('Communay');
});
