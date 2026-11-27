(() => {
  if (!window.LugdurumAPI || typeof window.__LUGDURUM_HOME_FIXTURE__ !== 'function') {
    throw new Error('Le mock Playwright ne peut pas se greffer sur l’API réelle.');
  }
  window.LugdurumAPI.getHomeData = window.__LUGDURUM_HOME_FIXTURE__;
})();
