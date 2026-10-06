import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;
const ohneEngine = (d) => {
  const { defaultBrowserType: _e, ...rest } = d;
  return rest;
};
const iphone13 = ohneEngine(devices['iPhone 13']);

// User-Agents echter Geräte, für die Playwright kein Profil hat (Stand 2026)
const UA = {
  firefoxAndroid: 'Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
  ios15: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
};

// geraete.spec.mjs läuft in allen drei Engines auf typischen Geräten. Firefox kennt in Playwright
// kein isMobile, darum dort nur Breite, Touch und User-Agent.
const GERAETE = [
  { name: 'g-desktop-chromium', use: { browserName: 'chromium', viewport: { width: 1300, height: 900 } } },
  { name: 'g-desktop-firefox', use: { browserName: 'firefox', viewport: { width: 1300, height: 900 } } },
  { name: 'g-desktop-webkit', use: { browserName: 'webkit', viewport: { width: 1300, height: 900 } } },
  { name: 'g-iphone-15-webkit', use: { ...devices['iPhone 15'] } },
  { name: 'g-iphone-se-webkit', use: { ...devices['iPhone SE'], userAgent: UA.ios15 } },
  { name: 'g-iphone-15-chrome-ios', use: { ...devices['iPhone 15'], userAgent: UA.chromeIos } },
  { name: 'g-ipad-webkit', use: { ...devices['iPad (gen 7)'] } },
  { name: 'g-pixel-7-chromium', use: { ...devices['Pixel 7'] } },
  { name: 'g-galaxy-s9-samsung', use: { ...devices['Galaxy S9+'], userAgent: UA.samsung } },
  { name: 'g-android-firefox', use: { browserName: 'firefox', viewport: { width: 412, height: 839 }, hasTouch: true, userAgent: UA.firefoxAndroid } },
].map((p) => ({ ...p, testMatch: /geraete\.spec\.mjs/ }));

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
    { name: 'desktop', testMatch: /oberflaeche\.spec\.mjs/, use: { browserName: 'chromium', viewport: { width: 1300, height: 900 } } },
    { name: 'iphone-13', testMatch: /oberflaeche\.spec\.mjs/, use: { ...iphone13, browserName: 'chromium' } },
    { name: 'pixel-7', testMatch: /oberflaeche\.spec\.mjs/, use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    ...GERAETE,
  ],
  webServer: {
    command: `node mock-server.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/status`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
