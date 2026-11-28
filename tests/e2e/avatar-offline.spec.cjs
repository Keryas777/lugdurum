const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'allow' });

test('les portraits mis en cache par la PWA restent disponibles hors ligne', async ({ page }) => {
  // WebKit iPhone sur runner GitHub attend parfois plusieurs secondes la stabilité
  // du bouton de profil après l’activation du mode hors ligne.
  test.setTimeout(45_000);
  await page.addInitScript(() => {
    localStorage.setItem('lugdurum_current_user_id', 'U_JEROME');
    localStorage.setItem('lugdurum_users_list_cache', JSON.stringify([
      { user_id: 'U_JEROME', nom: 'Jérôme', role: 'admin', actif: true },
      { user_id: 'U_ANTHONY', nom: 'Anthony', role: 'vendeur', actif: true },
      { user_id: 'U_WILL', nom: 'William', role: 'vendeur', actif: true }
    ]));
    const emptyData = {
      inscriptions: [], events: [], missions: [], stockMissions: [], missionsStock: [],
      journees: [], transactions: [], mouvementsStock: []
    };
    window.__LUGDURUM_HOME_FIXTURE__ = () => Promise.resolve({
      tables: emptyData,
      active: {
        journee: null,
        mission: null,
        work_context: { user_id: 'U_JEROME', journee_id: '', mission_id: '', stock_mission_id: '' },
        resume: { ca_jour_ttc: 0, nb_transactions: 0, ca_evenement_ttc: 0 }
      }
    });
    window.__LUGDURUM_HOME_FIXTURE_CORE__ = () => Promise.resolve(emptyData);
  });

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') {
      await route.abort();
      return;
    }
    await route.fallback();
  });
  await page.route((url) => url.href.includes('/docs/index.html'), async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const apiTag = source.match(/<script src="\.\/lugdurum-api\.js\?v=\d+" defer><\/script>/)?.[0];
    if (!apiTag) throw new Error('Balise API absente de la page réelle.');
    await route.fulfill({
      response,
      body: source.replace(apiTag, `${apiTag}\n    <script src="../tests/e2e/api-bootstrap.js" defer></script>`)
    });
  });

  await page.goto('./index.html');
  await expect(page.locator('#currentUserName')).toHaveText('Jérôme');
  await expect(page.locator('[data-user-avatar] img')).toHaveAttribute('src', './assets/avatars/jerome.webp');

  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.evaluate(async () => {
    const cache = await caches.open('lugdurum-avatars-v1');
    const required = ['william.webp', 'anthony.webp', 'jerome.webp'];
    const urls = await Promise.all(required.map(async (file) => {
      const response = await cache.match(new URL(`./assets/avatars/${file}`, location.href).href);
      return response ? file : '';
    }));
    window.__LUGDURUM_CACHED_AVATARS__ = urls.filter(Boolean);
  });
  await expect.poll(() => page.evaluate(() => window.__LUGDURUM_CACHED_AVATARS__)).toEqual([
    'william.webp', 'anthony.webp', 'jerome.webp'
  ]);

  await page.context().setOffline(true);
  await page.locator('.userPill').click();
  await page.getByRole('button', { name: /Anthony/ }).click();
  await expect(page.locator('#currentUserName')).toHaveText('Anthony');
  await expect(page.locator('[data-user-avatar] img')).toHaveAttribute('src', './assets/avatars/anthony.webp');
  await expect(page.locator('[data-user-avatar] img')).toHaveJSProperty('naturalWidth', 256);
  await page.locator('.userPill').click();
  await page.getByRole('button', { name: /William/ }).click();
  await expect(page.locator('[data-user-avatar] img')).toHaveAttribute('src', './assets/avatars/william.webp');
  await expect(page.locator('[data-user-avatar] img')).toHaveJSProperty('naturalWidth', 256);
  // La page d’accueil est longue en format iPhone ; conserver une capture
  // mobile réellement exploitable sans faire expirer le timeout de capture WebKit.
  await page.screenshot({ path: test.info().outputPath(`profils-hors-ligne-${test.info().project.name}.png`) });
});
