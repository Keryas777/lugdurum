(() => {
  if (!window.LugdurumAPI || typeof window.__LUGDURUM_HOME_FIXTURE__ !== 'function' ||
      typeof window.__LUGDURUM_HOME_FIXTURE_CORE__ !== 'function') {
    throw new Error('Le mock Playwright ne peut pas se greffer sur l’API réelle.');
  }
  window.LugdurumAPI.getHomeData = window.__LUGDURUM_HOME_FIXTURE__;
  window.LugdurumAPI.getCoreData = window.__LUGDURUM_HOME_FIXTURE_CORE__;
  window.LugdurumAPI.getCollectiveGoal = typeof window.__LUGDURUM_FIXTURE_COLLECTIVE_GOAL__ === 'function'
    ? window.__LUGDURUM_FIXTURE_COLLECTIVE_GOAL__
    : async () => ({ available: true, goal_id: 'noel-2026', target: 14000, amount: 0, eligible_day_count: 21 });
  if (typeof window.__LUGDURUM_FIXTURE_VENTE_RAPIDE__ === 'function') {
    window.LugdurumAPI.getVenteRapideData = window.__LUGDURUM_FIXTURE_VENTE_RAPIDE__;
  }
})();
