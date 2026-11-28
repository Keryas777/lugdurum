const { test, expect } = require('@playwright/test');

const U = { j: 'U_JEROME', a: 'U_ANTHONY', w: 'U_WILL' };
const E = { c: 'EVT_COMMUNAY', g: 'EVT_GENAS', ch: 'EVT_CHARLY', t: 'EVT_TOUR', col: 'EVT_COLOMBIER', shared: 'EVT_SHARED' };
const D = { c: 'J_COMMUNAY', g: 'J_GENAS_J1', g2: 'J_GENAS_J2', ch: 'J_CHARLY', t1: 'J_TOUR_1', t2: 'J_TOUR_2', col1: 'J_COLOMBIER_J1', col2: 'J_COLOMBIER_J2', s1: 'J_SHARED_1', s2: 'J_SHARED_2', noStock: 'J_NO_STOCK', unprepared: 'J_UNPREPARED' };
const auth = (...ids) => JSON.stringify(ids.map(user_id => ({ user_id })));

const events = [
  { mission_id: E.c, nom: 'Marché de Noël de Communay', date_debut: '2026-11-28', date_fin: '2026-11-28', ville: 'Communay', adresse: 'Place de la Mairie, 69360 Communay', horaires: 'Samedi 11h - 19h', mise_en_place: 'Samedi 9h - 10h30' },
  { mission_id: E.g, nom: 'Marché de Noël de Genas', date_debut: '2026-12-05', date_fin: '2026-12-06', ville: 'Genas', lieu: 'Place Ronshausen', horaires: 'Samedi 10h - 18h Dimanche 10h - 17h', mise_en_place: 'Samedi 8h - 9h Dimanche 8h30 - 9h30' },
  { mission_id: E.ch, nom: 'Marché de Noël de Charly', date_debut: '2026-11-28', date_fin: '2026-11-28', ville: 'Charly' },
  { mission_id: E.t, nom: 'Marché de Noël de La Tour de Salvagny', date_debut: '2026-12-05', date_fin: '2026-12-06', lieu: 'La Tour de Salvagny' },
  { mission_id: E.col, nom: 'Marché de Noël de Colombier-Saugnieu', date_debut: '2026-11-28', date_fin: '2026-11-29', ville: 'Colombier-Saugnieu', lieu: 'Salle Dauphinoise', adresse: '2 route de Pont de Chéruy, 69124 Colombier-Saugnieu', horaires: 'Samedi 11h - 19h Dimanche 10h - 18h', mise_en_place: 'Samedi 9h - 10h30' },
  { mission_id: E.shared, nom: 'Marché partagé', date_debut: '2026-12-12', date_fin: '2026-12-19' }
];
const day = (id, event, date, sellers, stock = '', jour = 'J1', statut = 'prevu', extra = {}) => ({ journee_id: id, mission_id: event, stock_mission_id: stock, date, jour_label: jour, statut, vendeurs_autorises: auth(...sellers), ...extra });
const days = [
  day(D.c, E.c, '2026-11-28', [U.j]),
  day(D.g, E.g, '2026-12-05', [U.j], 'MST_SHARED', 'J1'),
  day(D.g2, E.g, '2026-12-06', [U.j], 'MST_SHARED', 'J2'),
  day(D.ch, E.ch, '2026-11-28', [U.a]),
  day(D.t1, E.t, '2026-12-05', [U.a, U.w], '', 'J1'),
  day(D.t2, E.t, '2026-12-06', [U.a, U.w], '', 'J2'),
  day(D.col1, E.col, '2026-11-28', [U.w], 'MST_COLOMBIER', 'J1', 'prevu', { note: 'Ouverture au public : Samedi 11h - 19h Mise en place : Samedi 9h - 10h30' }),
  day(D.col2, E.col, '2026-11-29', [U.w], 'MST_COLOMBIER', 'J2', 'prevu', { note: 'Ouverture au public : Dimanche 10h - 18h' }),
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

async function installFixture(page, { selected = D.ch, offline = false, delayed = false, legacy = false, today = '2026-11-26' } = {}) {
  await page.addInitScript(({ userId, staleDay, users, events, days, ids, delayed, legacy, today }) => {
    const NativeDate = globalThis.Date;
    let fixedNow = NativeDate.parse(`${localStorage.getItem('__lugdurum_e2e_today') || today}T11:00:00.000Z`);
    globalThis.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return fixedNow; }
    };
    if (localStorage.getItem('lugdurum_current_user_id') === null) {
      localStorage.setItem('lugdurum_current_user_id', userId);
    }
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
        { mission_id: 'MST_COLOMBIER', nom: 'Stock Colombier', statut: 'preparee', stock_prepare: true },
        { mission_id: 'MST_UNPREPARED', nom: 'Stock à préparer', statut: 'a_preparer', stock_prepare: false }
      ],
      calls: [], coreDataCalls: 0, collectiveGoalAmount: 0, collectiveGoalUnavailable: false, collectiveGoalCalls: 0, collectiveGoalRequestsInFlight: 0, sellerDetailsCalls: []
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
        const revenue = day?.journee_id === ids.c ? 125 : day?.journee_id === ids.g ? 450 : day?.journee_id === ids.g2 ? 350 : day?.journee_id?.includes('TOUR') ? 650 : 777;
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
      getCollectiveGoal() {
        fixtureState.collectiveGoalCalls += 1;
        fixtureState.collectiveGoalRequestsInFlight += 1;
        return Promise.resolve().then(() => {
          if (fixtureState.collectiveGoalUnavailable) throw new Error('Serveur collectif indisponible');
          return {
          available: true,
          goal_id: 'noel-2026',
          target: 14000,
          amount: fixtureState.collectiveGoalAmount,
          contributions: { U_ANTHONY: 463.86, U_JEROME: 125.96, U_WILL: 999.72 },
          daily_contributions: { U_ANTHONY: 46.12, U_JEROME: 0, U_WILL: 91.5 },
          daily_date: '2026-11-28',
          eligible_day_count: 21,
          updated_at: new NativeDate(fixedNow).toISOString()
          };
        }).finally(() => { fixtureState.collectiveGoalRequestsInFlight -= 1; });
      },
      getCollectiveGoalSellerDetails({ seller_id }) {
        fixtureState.sellerDetailsCalls.push(seller_id);
        return Promise.resolve({ available:true, seller_id, daily_date:'2026-11-28', periods:{
          total:{revenue:12345.67,card:11234.56,cash:1111.11,other:0,bottles:{'50':10,'20':8},products:[
            {format_cl:50,code:'VB',name:'Vanille Bleue',quantity:2},
            {format_cl:50,code:'MV',name:'Mirabelle Vanille',quantity:1},
            {format_cl:50,code:'VT',name:'Vanille Tonka',quantity:1},
            {format_cl:50,code:'CG',name:'Citron Gingembre',quantity:1},
            {format_cl:50,code:'AT',name:'Abricot Tonka',quantity:1},
            {format_cl:50,code:'PR',name:'Pomelo Romarin',quantity:1},
            {format_cl:50,code:'LP',name:'Litchi Poivre de Sichuan',quantity:1},
            {format_cl:50,code:'FP',name:'Framboise Passion',quantity:1},
            {format_cl:50,code:'PE',name:'Pain d’Épices',quantity:1},
            {format_cl:50,code:'OC',name:'Orange Cannelle',quantity:1},
            {format_cl:20,code:'FP',name:'Framboise Passion',quantity:3},
            {format_cl:20,code:'LP',name:'Litchi Poivre de Sichuan',quantity:2},
            {format_cl:20,code:'PR',name:'Pomelo Romarin',quantity:1},
            {format_cl:20,code:'OC',name:'Orange Cannelle',quantity:1},
            {format_cl:20,code:'VB',name:'Vanille Bleue',quantity:1}
          ]},
          daily:{revenue:46.12,card:40,cash:6.12,other:0,bottles:{'50':1,'20':0},products:[{format_cl:50,code:'VB',name:'Vanille Bleue',quantity:1}]}
        }});
      },
      getCoreData() {
        fixtureState.coreDataCalls += 1;
        return { inscriptions: [], missions: fixtureState.events, missionsStock: fixtureState.stockMissions, journees: fixtureState.days, transactions: [], mouvementsStock: [] };
      },
      getVenteRapideData() {
        return { catalogue: [], offresVente: [], tables: { catalogue: [], offresVente: [] } };
      }
    };
    globalThis.__LUGDURUM_HOME_FIXTURE__ = fixtureApi.getHomeData;
    globalThis.__LUGDURUM_HOME_FIXTURE_CORE__ = fixtureApi.getCoreData;
    globalThis.__LUGDURUM_FIXTURE_VENTE_RAPIDE__ = fixtureApi.getVenteRapideData;
    globalThis.__LUGDURUM_FIXTURE_COLLECTIVE_GOAL__ = fixtureApi.getCollectiveGoal;
    globalThis.__LUGDURUM_FIXTURE_SELLER_DETAILS__ = fixtureApi.getCollectiveGoalSellerDetails;
  }, { userId: U.j, staleDay: selected, users, events, days, ids: D, delayed, legacy, today });
  page.__fixtureExternalRequests = [];
  page.on('request', request => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== 'http://127.0.0.1:4173') {
      page.__fixtureExternalRequests.push(request.url());
      const safeParams = {};
      for (const key of ['action', 'goal_id', 'view', 'mode']) {
        if (requestUrl.searchParams.has(key)) safeParams[key] = requestUrl.searchParams.get(key);
      }
      const details = {
        method: request.method(),
        action: safeParams.action || '(absent)',
        params: safeParams,
        at: new Date().toISOString(),
        context: request.frame()?.url() || page.url()
      };
      page.evaluate(() => ({
        online: navigator.onLine,
        pendingWrites: (() => {
          try { return JSON.parse(localStorage.getItem('lugdurum_pending_writes') || '[]').length; }
          catch { return 'unreadable'; }
        })()
      })).then(state => console.log('[E2E external API request]', JSON.stringify({ ...details, ...state })))
        .catch(() => console.log('[E2E external API request]', JSON.stringify({ ...details, online: 'page-unavailable' })));
    }
  });
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4173') {
      page.__fixtureExternalRequests.push(route.request().url());
      await route.abort();
    }
    else await route.fallback();
  });
  await page.route(url => url.origin === 'http://127.0.0.1:4173' &&
    url.pathname.startsWith('/docs/') && url.pathname.endsWith('.html'), async route => {
    const response = await route.fetch();
    const source = await response.text();
    const apiTag = /<script src="\.\/lugdurum-api\.js\?v=\d+" defer><\/script>/;
    if (!apiTag.test(source)) {
      await route.fulfill({ response, body: source });
      return;
    }
    await route.fulfill({
      response,
      body: source.replace(apiTag, tag => `${tag}\n    <script src="../tests/e2e/api-bootstrap.js" defer></script>`)
    });
  });
  if (offline) await page.context().setOffline(true);
}

test.beforeEach(async ({ page }, testInfo) => installFixture(page, {
  delayed: testInfo.title.includes('réseau retardée') || testInfo.title.includes('réponse retardée'),
  legacy: testInfo.title.includes('ancien Apps Script'),
  today: /progression collective|modale vendeur/.test(testInfo.title) ? '2026-11-28' : '2026-11-26'
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
  await expect(page.locator('.lugdurumDataStateBadgeText')).toHaveText('Données en ligne');
  await page.screenshot({ path: test.info().outputPath(`accueil-${test.info().project.name}.png`), fullPage: true });
});

test('la tuile regroupe le sélecteur, l’adresse Waze et les horaires exacts de la journée', async ({ page }) => {
  await page.goto('./index.html');
  await expect(page.locator('#homeDaySelect')).toBeVisible();
  await expect(page.locator('#statusHero #homeDaySelect')).toBeVisible();
  await expect(page.locator('#eventSelectorTitle')).toHaveText('Changer de journée');
  await expect(page.locator('body')).not.toContainText('Changer de journée actualise le parcours');
  await expect(page.locator('#homeDayDate')).toContainText('samedi 28 novembre 2026 · J1');
  await expect(page.locator('#homeSetupHours')).toHaveText('9h - 10h30');
  await expect(page.locator('#homePublicHours')).toHaveText('11h - 19h');
  const route = new URL(await page.locator('#homeAddressLink').getAttribute('href'));
  expect(route.hostname).toBe('waze.com');
  expect(decodeURIComponent(route.searchParams.get('q'))).toContain('69360 Communay');
  await page.screenshot({ path: test.info().outputPath(`accueil-pratique-${test.info().project.name}.png`), fullPage: true });

  await page.locator('#homeDaySelect').selectOption(D.g2);
  await expect(page.locator('#homeDayDate')).toContainText('dimanche 06 décembre 2026 · J2');
  await expect(page.locator('#homeSetupHours')).toHaveText('8h30 - 9h30');
  await expect(page.locator('#homePublicHours')).toHaveText('10h - 17h');
  await expect(page.locator('#homePublicHours')).not.toContainText('samedi');
  await page.locator('#homeDaySelect').selectOption(D.g);
  await expect(page.locator('#homeDayDate')).toContainText('samedi 05 décembre 2026 · J1');
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
});

test('William voit Colombier J1 et J2 sans reporter les horaires absents', async ({ page }) => {
  await page.goto('./index.html');
  await page.locator('.userPill').click({ force: true });
  await page.getByRole('button', { name: /William/ }).click({ force: true });
  await expect(page.locator('#missionTitle')).toContainText('Colombier-Saugnieu');
  await expect(page.locator('#homeDayDate')).toContainText('samedi 28 novembre 2026 · J1');
  await expect(page.locator('#homeSetupHours')).toHaveText('9h - 10h30');
  await expect(page.locator('#homePublicHours')).toHaveText('11h - 19h');
  const wazeQuery = new URL(await page.locator('#homeAddressLink').getAttribute('href')).searchParams.get('q');
  expect(decodeURIComponent(wazeQuery)).toContain('2 route de Pont de Chéruy');
  expect(decodeURIComponent(wazeQuery)).toContain('Colombier-Saugnieu');

  await page.locator('#homeDaySelect').selectOption(D.col2);
  await expect(page.locator('#homeDayDate')).toContainText('dimanche 29 novembre 2026 · J2');
  await expect(page.locator('#homeSetupHours')).toHaveText('Non renseigné');
  await expect(page.locator('#homePublicHours')).toHaveText('10h - 18h');
});

test('Anthony conserve Charly comme contexte et une adresse absente reste explicite', async ({ page }) => {
  await page.goto('./index.html');
  await page.locator('.userPill').click({ force: true });
  await page.getByRole('button', { name: /Anthony/ }).click({ force: true });
  await expect(page.locator('#missionTitle')).toContainText('Charly');
  await expect(page.locator('#homeAddressLink')).toBeHidden();
  await expect(page.locator('#homeAddressMissingText')).toContainText('Adresse complète non renseignée');
  await expect(page.locator('#homeSetupHours')).toHaveText('Non renseigné');
  await expect(page.locator('#homePublicHours')).toHaveText('Non renseigné');
});

test('les portraits suivent les profils, persistent au rechargement et dans la vente rapide', async ({ page }) => {
  // Cette séquence parcourt l'accueil, la vente rapide et trois captures.
  // WebKit sur runner GitHub dépasse 15 s sans que l'interface soit bloquée.
  test.setTimeout(45_000);
  const avatarFor = { [U.j]: 'jerome.webp', [U.a]: 'anthony.webp', [U.w]: 'william.webp' };
  await page.goto('./index.html');
  await expect(page.locator('[data-user-avatar] img')).toHaveAttribute('src', `./assets/avatars/${avatarFor[U.j]}`);
  await expect(page.locator('[data-user-avatar] img')).toHaveJSProperty('naturalWidth', 256);

  await page.locator('.userPill').click();
  const options = page.locator('.vendorSelectOption');
  await expect(options).toHaveCount(3);
  for (const [userId, avatar] of Object.entries(avatarFor)) {
    const option = page.locator('.vendorSelectOption').filter({
      hasText: new RegExp(userId === U.j ? 'Jérôme' : userId === U.a ? 'Anthony' : 'William')
    });
    await expect(option.locator('.userAvatar img')).toHaveAttribute('src', `./assets/avatars/${avatar}`);
    await expect(option.locator('.userAvatar img')).toHaveJSProperty('naturalWidth', 256);
  }
  await page.locator('.vendorSelectOption').filter({ hasText: 'Anthony' }).click({ force: true });
  await expect(page.locator('#currentUserName')).toHaveText('Anthony');
  await expect(page.locator('[data-user-avatar] img')).toHaveAttribute('src', './assets/avatars/anthony.webp');
  await expect(page.locator('#missionTitle')).toContainText('Charly');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lugdurum_current_user_id'))).toBe(U.a);
  await page.screenshot({ path: test.info().outputPath(`profil-anthony-${test.info().project.name}.png`) });

  await page.reload();
  await expect(page.locator('#currentUserName')).toHaveText('Anthony');
  await expect(page.locator('[data-user-avatar] img')).toHaveAttribute('src', './assets/avatars/anthony.webp');
  await page.goto('./vente-rapide.html');
  await expect(page.locator('#saleSellerName')).toHaveText('Anthony');
  await expect(page.locator('#saleSellerBtn [data-user-avatar] img')).toHaveAttribute('src', './assets/avatars/anthony.webp');
  await page.locator('.backBtn').click();
  await expect(page.locator('#currentUserName')).toHaveText('Anthony');
  await expect(page.locator('[data-user-avatar] img')).toHaveAttribute('src', './assets/avatars/anthony.webp');

  await page.locator('.userPill').click();
  await page.locator('.vendorSelectOption').filter({ hasText: 'William' }).click({ force: true });
  await expect(page.locator('#currentUserName')).toHaveText('William');
  await expect(page.locator('[data-user-avatar] img')).toHaveAttribute('src', './assets/avatars/william.webp');
  await page.screenshot({ path: test.info().outputPath(`profil-william-${test.info().project.name}.png`) });

  await page.locator('.userPill').click();
  await page.locator('.vendorSelectOption').filter({ hasText: 'Jérôme' }).click({ force: true });
  await expect(page.locator('#currentUserName')).toHaveText('Jérôme');
  await expect(page.locator('[data-user-avatar] img')).toHaveAttribute('src', './assets/avatars/jerome.webp');
  await page.screenshot({ path: test.info().outputPath(`profil-jerome-${test.info().project.name}.png`) });
});

test('un portrait indisponible retombe sur les initiales', async ({ page }) => {
  await page.route('**/assets/avatars/anthony.webp', route => route.abort());
  await page.goto('./index.html');
  await page.locator('.userPill').click();
  await page.getByRole('button', { name: /Anthony/ }).click();
  const avatar = page.locator('[data-user-avatar]');
  await expect(avatar.locator('.userAvatarFallback')).toHaveText('A');
  await page.screenshot({ path: test.info().outputPath(`profil-repli-${test.info().project.name}.png`), fullPage: true });
});

test('les anciens paramètres URL ne remplacent pas la journée personnelle', async ({ page }) => {
  await page.goto('./index.html?selected_type=mission&selected_id=EVT_CHARLY&journee_id=J_CHARLY&mission_id=EVT_TOUR&stock_mission_id=MST_SHARED');
  await expect(page.locator('#missionTitle')).toContainText('Communay');
  const options = await page.locator('#homeDaySelect option').allTextContents();
  expect(options.join(' ')).not.toContain('Charly');
  expect(options.join(' ')).not.toContain('Salvagny');
  for (const personalSurface of ['#statusHero', '.homeWorkflow', '#watchList']) {
    await expect(page.locator(personalSurface)).not.toContainText('Charly');
    await expect(page.locator(personalSurface)).not.toContainText('Salvagny');
  }
  await expect(page.locator('#generalPlanning')).toBeVisible();
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
  await page.getByRole('button', { name: /Anthony/ }).click({ force: true });
  await expect(page.locator('#missionTitle')).toContainText('Charly');
  await expect(page.locator('#generalPlanning')).toBeVisible();
  await expectActionContext(page, page.locator('#primaryAction'), { user: U.a, day: D.ch, event: E.ch });
  await page.locator('.userPill').click({ force: true });
  await page.getByRole('button', { name: /William/ }).click({ force: true });
  await expect(page.locator('#missionTitle')).toContainText('Colombier-Saugnieu');
  await expectActionContext(page, page.locator('#primaryAction'), { user: U.w, day: D.col1, event: E.col, stock: 'MST_COLOMBIER' });
  await expect.poll(() => page.evaluate(user => localStorage.getItem('lugdurum_home_selected_journee:' + user), U.w)).toBe(D.col1);
  await page.locator('#homeDaySelect').selectOption(D.t1);
  await expect(page.locator('#missionTitle')).toContainText('La Tour de Salvagny');
  await expect(page.locator('#primaryAction')).toBeHidden();
  await expect(page.locator('.workflowGrid [data-step="vente"]')).toBeVisible();
  await expect(page.locator('.workflowGrid [data-step="missions"]')).toContainText('responsable');
  await expect.poll(() => page.evaluate(user => localStorage.getItem('lugdurum_home_selected_journee:' + user), U.w)).toBe(D.t1);
  await expect(page.locator('#generalPlanning')).toBeHidden();
  await page.locator('.userPill').click({ force: true });
  await page.getByRole('button', { name: /Jérôme/ }).click({ force: true });
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
  await page.getByRole('button', { name: /Anthony/ }).click({ force: true });
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
  await expect(page.locator('#activeStatusLabel')).toContainText('Journée indisponible');
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


test('la progression collective reste commune, compacte et anime les jalons sans rejouer', async ({ page }) => {
  await page.goto('./index.html');
  await page.waitForFunction(() => window.__LUGDURUM_FIXTURE_STATE__.collectiveGoalCalls > 0 && window.__LUGDURUM_FIXTURE_STATE__.collectiveGoalRequestsInFlight === 0);
  await expect(page.locator('#collectiveGoalAmount')).toContainText('0');
  await expect(page.locator('#collectiveGoalRemaining')).toContainText('14 000');
  await expect(page.locator('#collectiveGoal')).toHaveCount(1);
  await expect(page.locator('#collectiveGoalToggle')).toBeVisible();
  await page.locator('#collectiveGoalToggle').click();
  await expect(page.locator('#collectiveGoalDaily_U_ANTHONY')).toContainText('46,12');
  await expect(page.locator('#collectiveGoalDaily_U_JEROME')).toContainText('0,00');
  await page.locator('#collectiveGoalToggle').click();

  for (const [amount, percent, milestone] of [
    [3500, '25 %', 'is-pulse'],
    [7000, '50 %', 'is-double-shine'],
    [10500, '75 %', 'is-halo'],
    [14000, '100 %', 'is-complete'],
    [15750, '112 %', 'is-complete']
  ]) {
    await page.evaluate(value => {
      const state = window.__LUGDURUM_FIXTURE_STATE__;
      state.collectiveGoalAmount = value;
      window.dispatchEvent(new CustomEvent('lugdurum:sync-status', {
        detail: { status: 'synced', synced_count: 1, pending_count: 0 }
      }));
    }, amount);
    await expect(page.locator('#collectiveGoalPercent')).toHaveText(percent);
    await page.waitForFunction(() => window.__LUGDURUM_FIXTURE_STATE__.collectiveGoalRequestsInFlight === 0);
    await expect(page.locator('#collectiveGoal')).toHaveClass(new RegExp(milestone));
  }

  await expect(page.locator('#collectiveGoalRemaining')).toContainText('Objectif atteint');
  await expect(page.locator('#collectiveGoalProgress')).toHaveAttribute('aria-valuenow', '100');
  await page.reload();
  await expect(page.locator('#collectiveGoalPercent')).toHaveText('0 %');
  await expect(page.locator('#collectiveGoal')).not.toHaveClass(/is-pulse|is-double-shine|is-halo/);
});

test('la modale vendeur reste en lecture seule et bascule entre total et journée', async ({ page }, testInfo) => {
  await page.clock.install();
  await page.goto('./index.html');
  const selectedDayBeforeConsultation = await page.locator('#homeDaySelect').inputValue();
  await page.locator('#collectiveGoalToggle').click();
  await page.locator('[data-seller-id="U_ANTHONY"]').click();
  await expect(page.locator('#sellerGoalOverlay')).toBeVisible();
  await expect(page.locator('#sellerGoalName')).toHaveText('Anthony');
  await expect(page.locator('#sellerGoalContent')).toContainText('12\u202f345,67');
  await expect(page.locator('#sellerGoalContent')).toContainText('Vanille Bleue');

  const layout = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.sellerGoalPayCard')];
    const rows = [...document.querySelectorAll('.sellerGoalProductRow')];
    const list = document.querySelector('.sellerGoalProductList');
    const close = document.querySelector('.sellerGoalClose');
    const box = element => { const r = element.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
    return {
      columns: cards.map(box),
      cardDirection: cards.map(node => getComputedStyle(node).flexDirection),
      labelAndAmount: cards.map(node => [box(node.querySelector('span')), box(node.querySelector('strong'))]),
      amountOverflow: cards.map(node => node.querySelector('strong').scrollWidth > node.querySelector('strong').clientWidth),
      rowColumns: rows.map(node => getComputedStyle(node).gridTemplateColumns.split(' ').length),
      codeWidths: [...document.querySelectorAll('.sellerGoalProductCode')].map(node => box(node).width),
      quantityRights: [...document.querySelectorAll('.sellerGoalProductQuantity')].map(node => box(node).right),
      listStyle: getComputedStyle(list).listStyleType,
      closeColor: getComputedStyle(close).color,
      scroll: { client: document.querySelector('#sellerGoalContent').clientHeight, full: document.querySelector('#sellerGoalContent').scrollHeight },
      header: box(document.querySelector('.sellerGoalHeader')),
      period: box(document.querySelector('.sellerGoalPeriod'))
    };
  });
  expect(layout.cardDirection).toEqual(['column','column']);
  expect(layout.columns[0].right).toBeLessThanOrEqual(layout.columns[1].x + 1);
  expect(layout.labelAndAmount.every(([label, amount]) => amount.y >= label.bottom + 4)).toBe(true);
  expect(layout.amountOverflow).toEqual([false,false]);
  expect(layout.rowColumns.every(columns => columns === 3)).toBe(true);
  expect(new Set(layout.codeWidths).size).toBe(1);
  expect(Math.max(...layout.quantityRights)-Math.min(...layout.quantityRights)).toBeLessThan(1);
  expect(layout.listStyle).toBe('none');
  expect(layout.closeColor).toBe('rgb(138, 90, 43)');
  expect(layout.scroll.full).toBeGreaterThan(layout.scroll.client);

  if (testInfo.project.name === 'webkit-iphone') {
    await page.screenshot({ path:testInfo.outputPath('seller-goal-modal-webkit-iphone.png'), fullPage:false });
  }
  await page.locator('#sellerGoalContent').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect.poll(() => page.locator('#sellerGoalContent').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const headerAfterScroll = await page.locator('.sellerGoalHeader').boundingBox();
  const periodAfterScroll = await page.locator('.sellerGoalPeriod').boundingBox();
  expect(headerAfterScroll).toMatchObject({ x:layout.header.x, y:layout.header.y, width:layout.header.width, height:layout.header.height });
  expect(periodAfterScroll).toMatchObject({ x:layout.period.x, y:layout.period.y, width:layout.period.width, height:layout.period.height });
  await page.locator('[data-period="daily"]').click();
  await expect(page.locator('[data-period="daily"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#sellerGoalContent')).toContainText('Journée du');
  await expect(page.locator('#sellerGoalContent')).toContainText('46,12');
  await page.clock.fastForward(30000);
  await expect(page.locator('[data-period="daily"]')).toHaveAttribute('aria-pressed','true');
  await expect.poll(() => page.evaluate(() => window.__LUGDURUM_FIXTURE_STATE__.sellerDetailsCalls.length)).toBe(2);
  await page.locator('#sellerGoalClose').click();
  await expect(page.locator('#sellerGoalOverlay')).toBeHidden();
  await expect(page.locator('#collectiveGoalDetails')).toBeVisible();
  await page.clock.fastForward(60000);
  expect(await page.evaluate(() => window.__LUGDURUM_FIXTURE_STATE__.sellerDetailsCalls.length)).toBe(2);
  await page.locator('[data-seller-id="U_JEROME"]').click();
  await expect(page.locator('#sellerGoalName')).toHaveText('Jérôme');
  await expect(page.locator('[data-period="total"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#sellerGoalAvatar')).toHaveAttribute('src', /jerome\.webp$/);
  await page.locator('#sellerGoalClose').click();
  await page.locator('[data-seller-id="U_WILL"]').click();
  await expect(page.locator('#sellerGoalName')).toHaveText('William');
  await expect(page.locator('#sellerGoalAvatar')).toHaveAttribute('src', /william\.webp$/);
  await page.locator('#sellerGoalClose').click();
  await expect(page.locator('#collectiveGoal')).toHaveAttribute('aria-labelledby','collectiveGoalTitle');
  await expect(page.locator('#homeDaySelect')).toHaveValue(selectedDayBeforeConsultation);
  expect(await page.evaluate(() => window.__LUGDURUM_FIXTURE_STATE__.sellerDetailsCalls)).toEqual(['U_ANTHONY','U_ANTHONY','U_JEROME','U_WILL']);
});

test('conserve le dernier agrégat hors ligne et signale les ventes en attente de synchronisation', async ({ page, context }) => {
  await page.goto('./index.html');
  await expect(page.locator('#collectiveGoalAmount')).toContainText('0');
  await context.setOffline(true);
  await page.evaluate(() => {
    window.__LUGDURUM_FIXTURE_STATE__.collectiveGoalUnavailable = true;
    window.localStorage.setItem('lugdurum_pending_writes', JSON.stringify([{ id: 'Q_TEST' }]));
    window.dispatchEvent(new CustomEvent('lugdurum:sync-status', {
      detail: { status: 'pending', pending_count: 1 }
    }));
  });
  await expect(page.locator('#collectiveGoalAmount')).toContainText('0');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('lugdurum:sync-status', {
    detail: { status: 'synced', synced_count: 1, pending_count: 1 }
  })));
  await expect(page.locator('#collectiveGoalSyncState')).toContainText('ventes à synchroniser');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#collectiveGoalSyncState')).toContainText('ventes à synchroniser');
});


test('signale une donnée indisponible quand aucun total connu ne peut être conservé', async ({ page }) => {
  await page.goto('./index.html');
  await page.evaluate(() => {
    window.localStorage.removeItem('lugdurum_collective_goal_cache_v1');
    window.__LUGDURUM_FIXTURE_STATE__.collectiveGoalUnavailable = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#collectiveGoalAmount')).toHaveText('—');
  await expect(page.locator('#collectiveGoalRemaining')).toHaveText('Total indisponible');
  await expect(page.locator('#collectiveGoalSyncState')).toHaveText('Serveur indisponible');
});
