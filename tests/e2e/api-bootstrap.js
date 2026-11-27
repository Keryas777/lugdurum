(() => {
  if (!window.LugdurumAPI || typeof window.__LUGDURUM_HOME_FIXTURE__ !== 'function' ||
      typeof window.__LUGDURUM_HOME_FIXTURE_CORE__ !== 'function') {
    throw new Error('Le mock Playwright ne peut pas se greffer sur l’API réelle.');
  }
  window.LugdurumAPI.getHomeData = window.__LUGDURUM_HOME_FIXTURE__;
  window.LugdurumAPI.getCoreData = window.__LUGDURUM_HOME_FIXTURE_CORE__;
  if (typeof window.__LUGDURUM_FIXTURE_COLLECTIVE_GOAL__ === 'function') {
    window.LugdurumAPI.getCollectiveGoal = window.__LUGDURUM_FIXTURE_COLLECTIVE_GOAL__;
  }
  if (typeof window.__LUGDURUM_FIXTURE_VENTE_RAPIDE__ === 'function') {
    window.LugdurumAPI.getVenteRapideData = window.__LUGDURUM_FIXTURE_VENTE_RAPIDE__;
  }
})();
