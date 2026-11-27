const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 15_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173/docs/', trace: 'retain-on-failure' },
  projects: [
    { name: 'webkit-iphone', use: { ...devices['iPhone 14'], browserName: 'webkit' } },
    { name: 'chromium-android', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } }
  ],
  webServer: {
    command: 'npx http-server . -p 4173 -c-1',
    url: 'http://127.0.0.1:4173/docs/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  },
  outputDir: 'test-results'
});
