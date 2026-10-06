import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;
const { defaultBrowserType: _i, ...iphone } = devices['iPhone 13'];

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs/,
  timeout: 60_000,
  workers: 1, // der Mock hat einen gemeinsamen Zustand
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    acceptDownloads: true,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1300, height: 900 } } },
    { name: 'iphone-13', use: { ...iphone, browserName: 'chromium' } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
  ],
  webServer: {
    command: `node mock-server.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/status`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
