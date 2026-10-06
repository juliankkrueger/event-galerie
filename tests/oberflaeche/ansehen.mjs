// Screenshots zum Ansehen: je Marke und Breite Startbildschirm, Galerie (oben und Raster) und Auswahl.
//   node ansehen.mjs [--marken ambition,blueprint,neutral] [--breiten 320,390,412,768,1024,1300] [--engine chromium]
// Startet den Mock selbst (Port 8791). Bilder landen in screens/ansehen/.
import { chromium, webkit, firefox } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockStarten } from './mock-server.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, s) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : s; };
const MARKEN = arg('marken', 'ambition,blueprint,neutral').split(',');
const BREITEN = arg('breiten', '320,390,412,768,1024,1300').split(',').map(Number);
const ENGINE = { chromium, webkit, firefox }[arg('engine', 'chromium')];
const PORT = 8791;
const ZIEL = path.join(HIER, 'screens', 'ansehen');
fs.mkdirSync(ZIEL, { recursive: true });

const server = await mockStarten(PORT);
const browser = await ENGINE.launch();
const basis = `http://127.0.0.1:${PORT}`;
const steuern = (d) => fetch(`${basis}/__mock`, { method: 'POST', body: JSON.stringify(d) });

for (const marke of MARKEN) {
  await steuern({ reset: true, marke, variante: arg('variante', 'vertrag') });
  for (const breite of BREITEN) {
    const handy = breite < 760;
    const ctx = await browser.newContext({
      viewport: { width: breite, height: handy ? Math.round(breite * 2.05) : 900 },
      deviceScaleFactor: handy ? 2 : 1,
      hasTouch: handy && ENGINE !== firefox,
      isMobile: handy && ENGINE === chromium,
      locale: 'de-DE',
    });
    const page = await ctx.newPage();
    const name = (teil) => path.join(ZIEL, `${marke}-${breite}-${teil}.png`);
    await page.goto(`${basis}/`);
    await page.locator('#z-code').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: name('1-code') });
    await page.fill('#code-feld', 'GAST2345');
    await page.click('#code-knopf');
    await page.locator('#galerie').waitFor();
    await page.waitForTimeout(1600);
    await page.screenshot({ path: name('2-galerie') });
    await page.evaluate(() => window.scrollTo(0, document.querySelector('.kapitelleiste').getBoundingClientRect().top + window.scrollY - 0));
    await page.waitForTimeout(900);
    await page.screenshot({ path: name('3-raster') });
    for (const i of [0, 2, 5]) await page.locator('.kachel-wahl').nth(i).click({ force: true });
    await page.waitForTimeout(500);
    await page.screenshot({ path: name('4-auswahl') });
    await ctx.close();
  }
}
await browser.close();
server.close();
console.log(`Screenshots in ${ZIEL}`);
