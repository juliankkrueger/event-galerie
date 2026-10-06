// Geräte-Matrix: Download-Wege je Umgebung in Chromium, WebKit und Firefox (Projekte g-* in playwright.config.mjs).
// Teilen-Varianten werden über navigator.share/canShare nachgestellt, Netzfehler über page.route,
// eingebaute App-Browser über den User-Agent. Jede Zeile landet in .ergebnisse/geraete/<projekt>.jsonl;
// node matrix.mjs macht daraus die Tabelle.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ERGEBNISSE = path.join(HIER, '.ergebnisse', 'geraete');
const SCREENS = path.join(HIER, 'screens', 'geraete');
fs.mkdirSync(ERGEBNISSE, { recursive: true });
fs.mkdirSync(SCREENS, { recursive: true });
const CODE = 'GAST2345';

const UA_APP = {
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Instagram 351.0.0.41.106 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; de_DE; 646132512)',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 [FBAN/FBIOS;FBAV/490.0.0.39.107;FBBV/700000000;FBDV/iPhone16,1;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3;FBCR/;FBID/phone;FBLC/de_DE;FBOP/5]',
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 Instagram 351.0.0.25.86 (iPhone16,1; iOS 18_6; de_DE; de; scale=3.00; 1179x2556; 652345678)',
};

const istTouchProjekt = (info) => !/desktop/.test(info.project.name);
const engine = (info) => info.project.use.browserName || info.project.use.defaultBrowserType || 'chromium';

function notieren(info, zeile) {
  fs.appendFileSync(path.join(ERGEBNISSE, `${info.project.name}.jsonl`), `${JSON.stringify({ projekt: info.project.name, engine: engine(info), ...zeile })}\n`);
}

test.beforeAll(({}, info) => {
  const datei = path.join(ERGEBNISSE, `${info.project.name}.jsonl`);
  if (info.workerIndex === 0 && fs.existsSync(datei) && !process.env.GERAETE_ANHAENGEN) fs.rmSync(datei);
});

test.beforeEach(async ({ request }) => {
  await request.post('/__mock', { data: { reset: true, marke: 'ambition' } });
});

// Teilen-Varianten als Init-Skript. "echt" lässt den Browser unverändert.
function teilenStub(variante) {
  return ({ variante: v }) => {
    window.__geteilt = [];
    window.__versuche = 0;
    if (v === 'echt') {
      // Echte Umsetzung des Browsers behalten, nur mitzählen
      const original = navigator.share;
      if (typeof original === 'function') {
        const spion = function (d) {
          const aktiv = navigator.userActivation ? navigator.userActivation.isActive : null;
          return original.call(navigator, d).then((r) => {
            window.__geteilt.push({ anzahl: d.files?.length || 0, aktiv, echt: true });
            return r;
          });
        };
        try { Object.defineProperty(Navigator.prototype, 'share', { value: spion, configurable: true, writable: true }); } catch { /* */ }
      }
      return;
    }
    if (v === 'fehlt') {
      for (const k of ['share', 'canShare']) {
        try { Object.defineProperty(Navigator.prototype, k, { value: undefined, configurable: true, writable: true }); } catch { /* */ }
        try { Object.defineProperty(navigator, k, { value: undefined, configurable: true, writable: true }); } catch { /* */ }
      }
      return;
    }
    const mitDateien = v !== 'ohne-dateien';
    const canShare = (d) => {
      if (!d) return false;
      if (Array.isArray(d.files) && d.files.length) return mitDateien && d.files.every((f) => f instanceof File);
      return Boolean(d.url || d.text || d.title);
    };
    const share = (d) => {
      window.__versuche += 1;
      const aktiv = navigator.userActivation ? navigator.userActivation.isActive : null;
      if (v === 'haengt') return new Promise(() => {});
      if (v === 'not-allowed-einmal' && window.__versuche === 1) return Promise.reject(new DOMException('no activation', 'NotAllowedError'));
      if (v === 'abort-einmal' && window.__versuche === 1) return Promise.reject(new DOMException('Share canceled', 'AbortError'));
      if (v === 'kaputt') return Promise.reject(new TypeError('files not supported'));
      if (!mitDateien && d.files) return Promise.reject(new TypeError('files not supported'));
      window.__geteilt.push({ anzahl: d.files.length, aktiv, bytes: d.files.reduce((s, f) => s + f.size, 0) });
      return Promise.resolve();
    };
    for (const [k, f] of [['share', share], ['canShare', canShare]]) {
      try { Object.defineProperty(Navigator.prototype, k, { value: f, configurable: true, writable: true }); } catch { /* */ }
      try { Object.defineProperty(navigator, k, { value: f, configurable: true, writable: true }); } catch { /* */ }
    }
  };
}

// Dateiauswahl (Chromium am Rechner) als Speicher im Test, sonst würde ein echter Dialog aufgehen
function dateiauswahlStub() {
  if (typeof window.showSaveFilePicker !== 'function') return;
  window.showSaveFilePicker = async (o) => {
    window.__dateiname = o.suggestedName;
    const teile = [];
    return {
      createWritable: async () => new WritableStream({
        write(c) { teile.push(new Uint8Array(c)); },
        close() { window.__zip = new Blob(teile); },
        abort() { window.__zipAbgebrochen = true; },
      }),
    };
  };
}

async function vorbereiten(page, variante) {
  await page.addInitScript(teilenStub(variante), { variante });
  await page.addInitScript(dateiauswahlStub);
}

async function anmelden(page) {
  await page.goto(`/#c=${CODE}`);
  await expect(page.locator('#galerie')).toBeVisible({ timeout: 20_000 });
}

async function waehlen(page, anzahl) {
  const kreise = page.locator('.kachel-wahl');
  for (let i = 0; i < anzahl; i += 1) await kreise.nth(i).click();
  await expect(page.locator('#zaehler')).toContainText(`${anzahl} Foto`);
}

async function umgebungLesen(page) {
  return page.evaluate(() => {
    const z = window.__galerie.zustand;
    return { weg: z.weg, plattform: z.umgebung.plattform, touch: z.touch, inApp: z.umgebung.inApp, hinweis: z.umgebung.hinweisApp };
  });
}

function zipPruefen(datei) {
  const skript = `
import zipfile, hashlib, json, sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps(sorted(hashlib.md5(z.read(i)).hexdigest() for i in z.infolist())))`;
  return JSON.parse(execFileSync('python3', ['-c', skript, datei]).toString());
}

// Führt den Hauptweg mit der aktuellen Auswahl bis zum Ende aus. Gibt eine Kurzbeschreibung zurück.
async function wegDurchfuehren(page, info, { erwarteteDateien }) {
  const u = await umgebungLesen(page);
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  await page.click('#aktion-knopf');
  if (u.weg === 'zip') {
    await expect(page.locator('#panel-titel')).toHaveText('Fertig', { timeout: 45_000 });
    const auswahl = await page.evaluate(() => typeof window.showSaveFilePicker === 'function');
    let datei = path.join(ERGEBNISSE, `${info.project.name}.zip`);
    if (auswahl) {
      const b64 = await page.evaluate(async () => new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(window.__zip); }));
      fs.writeFileSync(datei, Buffer.from(b64, 'base64'));
    } else {
      await expect.poll(() => downloads.length, { timeout: 30_000 }).toBeGreaterThan(0);
      await downloads[0].saveAs(datei);
    }
    const md5 = zipPruefen(datei);
    const soll = await page.evaluate(() => {
      const z = window.__galerie.zustand;
      return z.bilder.filter((b) => z.gewaehlt.has(b.id)).map((b) => b.o.md5).sort();
    });
    expect(md5).toEqual(soll);
    const wie = auswahl ? 'Dateiauswahl' : (downloads[0].url().startsWith('blob:') ? 'Arbeitsspeicher' : 'Service Worker');
    return `ZIP über ${wie}, md5 ${md5.length}/${soll.length} gleich`;
  }
  // Pakete: teilen oder laden
  const knopf = page.locator('#panel-aktion');
  let pakete = 0;
  for (let runde = 0; runde < 10; runde += 1) {
    if (await page.locator('#panel-titel').textContent() === 'Fertig') break;
    await expect(knopf).toBeEnabled({ timeout: 30_000 });
    await knopf.click();
    pakete += 1;
    await expect.poll(async () => {
      const t = await page.locator('#panel-titel').textContent();
      const tx = await page.locator('#panel-text').textContent();
      return t === 'Fertig' || /ist bereit|wird vorbereitet|nicht gesichert|noch einmal|stattdessen/.test(tx);
    }, { timeout: 30_000 }).toBe(true);
    const text = await page.locator('#panel-text').textContent();
    if (/nicht gesichert|noch einmal/.test(text)) continue; // Abbruch oder fehlende Aktivierung: noch einmal tippen
  }
  await expect(page.locator('#panel-titel')).toHaveText('Fertig', { timeout: 30_000 });
  const weg = await page.evaluate(() => window.__galerie.zustand.weg);
  if (weg === 'teilen') {
    const geteilt = await page.evaluate(() => window.__geteilt);
    const summe = geteilt.reduce((s, g) => s + g.anzahl, 0);
    expect(summe).toBe(erwarteteDateien);
    const aktiv = geteilt.map((g) => g.aktiv).filter((a) => a !== null);
    expect(aktiv.every(Boolean), 'Teilen nur mit Nutzeraktivierung').toBe(true);
    return `Teilen-Menü, ${geteilt.length} Pakete, ${summe} Fotos${aktiv.length ? ', Aktivierung ja' : ''}`;
  }
  await expect.poll(() => downloads.length, { timeout: 20_000 }).toBe(erwarteteDateien);
  const namen = downloads.map((d) => d.suggestedFilename());
  expect(namen.every((n) => n.endsWith('.jpg'))).toBe(true);
  return `Einzeldateien in Downloads, ${downloads.length} Fotos in ${pakete} Paketen`;
}

// ---------- 1. Erkennung und Hauptweg je Teilen-Variante ----------

for (const variante of ['echt', 'mit-dateien', 'ohne-dateien', 'fehlt', 'abort-einmal', 'not-allowed-einmal', 'kaputt']) {
  test(`Hauptweg: navigator.share ${variante}`, async ({ page }, info) => {
    const desktop = !istTouchProjekt(info);
    test.skip(desktop && !['echt', 'mit-dateien'].includes(variante), 'am Rechner ist Teilen nicht der Weg');
    await vorbereiten(page, variante);
    const fehler = [];
    page.on('pageerror', (e) => fehler.push(e.message));
    await anmelden(page);
    const u = await umgebungLesen(page);
    // Erwartung aus den Features: Touch + Teilen mit Dateien = teilen; Touch ohne = laden; sonst ZIP
    const teilbar = ['mit-dateien', 'abort-einmal', 'not-allowed-einmal', 'kaputt'].includes(variante);
    if (variante !== 'echt') expect(u.weg).toBe(desktop ? 'zip' : (teilbar ? 'teilen' : 'laden'));
    const anzahl = desktop ? 6 : 12;
    await waehlen(page, anzahl);
    const name = await page.locator('#aktion-knopf').getAttribute('aria-label');
    const ergebnis = await wegDurchfuehren(page, info, { erwarteteDateien: anzahl });
    if (variante === 'kaputt') expect(await page.evaluate(() => window.__galerie.zustand.weg)).toBe('laden');
    expect(fehler).toEqual([]);
    const breite = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(breite, 'kein Querscrollen').toBe(true);
    await page.screenshot({ path: path.join(SCREENS, `${info.project.name}-${variante}.png`) });
    notieren(info, { pruefung: 'Hauptweg', variante, weg: u.weg, plattform: u.plattform, knopf: name, ergebnis });
  });
}

// ---------- 2. Netzfehler bei Handy-Paketen: Wiederholung und Wiederverwendung ----------

test('Netzfehler im Paket: Wiederholung, dann Erneut versuchen ohne Neuladen', async ({ page }, info) => {
  test.skip(!istTouchProjekt(info), 'Handy-Pakete');
  test.setTimeout(120_000);
  await vorbereiten(page, 'mit-dateien');
  await anmelden(page);
  await waehlen(page, 10);
  const ids = await page.evaluate(() => {
    const z = window.__galerie.zustand;
    return z.bilder.filter((b) => z.gewaehlt.has(b.id)).map((b) => new URL((b.h || b.handy).pfad, location.href).pathname);
  });
  const abrufe = new Map();
  let einmal = ids[1];
  const dauerhaft = ids[4];
  let sperren = true;
  await page.route('**/b/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    abrufe.set(p, (abrufe.get(p) || 0) + 1);
    if (p === einmal) { einmal = null; return route.abort('connectionreset'); }
    if (p === dauerhaft && sperren) return route.abort('internetdisconnected');
    return route.continue();
  });
  await page.click('#aktion-knopf');
  await expect(page.locator('#panel-titel')).toHaveText('Das hat nicht geklappt', { timeout: 60_000 });
  await expect(page.locator('#panel-text')).toContainText('9 von 10 Fotos');
  await expect(page.locator('#panel-aktion')).toHaveText('Erneut versuchen');
  await page.screenshot({ path: path.join(SCREENS, `${info.project.name}-netzfehler.png`) });
  const vorher = Object.fromEntries(abrufe);
  expect(vorher[ids[1]], 'einmaliger Fehler wird wiederholt').toBe(2);
  expect(vorher[dauerhaft], 'dauerhafter Fehler: 1 + 3 Wiederholungen').toBe(4);
  sperren = false;
  await page.click('#panel-aktion');
  await expect(page.locator('#panel-aktion')).toHaveText('Paket 1 von 1 sichern', { timeout: 30_000 });
  await expect(page.locator('#panel-aktion')).toBeEnabled({ timeout: 30_000 });
  const nachher = Object.fromEntries(abrufe);
  const neuGeladen = ids.filter((p) => p !== dauerhaft && nachher[p] !== vorher[p]);
  expect(neuGeladen, 'schon geladene Fotos werden nicht neu geholt').toEqual([]);
  expect(nachher[dauerhaft]).toBe(5);
  await page.click('#panel-aktion');
  await expect(page.locator('#panel-titel')).toHaveText('Fertig');
  notieren(info, { pruefung: 'Netzfehler Paket', ergebnis: `1 Abbruch wiederholt (2 Abrufe), 1 Foto dauerhaft weg: 4 Versuche, Meldung mit „Erneut versuchen“, danach nur dieses Foto neu geladen` });
});

// ---------- 3. Netzfehler im ZIP (Rechner) ----------

test('Netzfehler im ZIP: einmaliger Abbruch wird wiederholt, dauerhafter mit Erneut versuchen', async ({ page }, info) => {
  test.skip(istTouchProjekt(info), 'ZIP am Rechner');
  test.setTimeout(120_000);
  await vorbereiten(page, 'echt');
  await anmelden(page);
  // Fotos 0 und 3 bestehen aus mehreren Teilen
  for (const i of [0, 3, 6]) await page.locator('.kachel-wahl').nth(i).click();
  const teile = await page.evaluate(() => {
    const z = window.__galerie.zustand;
    return z.bilder.filter((b) => z.gewaehlt.has(b.id)).flatMap((b) => b.o.teile.map((t) => new URL(t, location.href).pathname));
  });
  let einmal = teile[1];
  let sperren = teile[teile.length - 1];
  await page.route('**/b/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === einmal) { einmal = null; return route.abort('connectionreset'); }
    if (p === sperren) return route.abort('connectionfailed');
    return route.continue();
  });
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  await page.click('#aktion-knopf');
  await expect(page.locator('#panel-titel')).toHaveText('Das hat nicht geklappt', { timeout: 60_000 });
  await expect(page.locator('#panel-aktion')).toHaveText('Erneut versuchen');
  await page.screenshot({ path: path.join(SCREENS, `${info.project.name}-zip-fehler.png`) });
  const ersterFehler = await page.evaluate(() => window.__galerie.zustand.letzterFehler);
  sperren = null;
  // Playwright-Firefox: ein abgebrochener Service-Worker-Download bleibt dort für immer "läuft" und
  // schluckt danach jede Mauseingabe der Seite (gemessen: kein pointerdown mehr, download.failure()
  // kehrt nie zurück). Das betrifft nur das Testwerkzeug, darum hier der Klick über das DOM.
  if (engine(info) === 'firefox') await page.locator('#panel-aktion').evaluate((k) => k.click());
  else await page.click('#panel-aktion');
  await expect.poll(() => page.locator('#panel-titel').textContent(), { timeout: 60_000 }).toMatch(/Fertig|nicht geklappt/);
  const titel = await page.locator('#panel-titel').textContent();
  expect(titel, `zweiter Versuch: ${await page.evaluate(() => window.__galerie.zustand.letzterFehler)} (erster: ${ersterFehler})`).toBe('Fertig');
  const datei = path.join(ERGEBNISSE, `${info.project.name}-netz.zip`);
  const auswahl = await page.evaluate(() => typeof window.showSaveFilePicker === 'function');
  if (auswahl) {
    const b64 = await page.evaluate(async () => new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(window.__zip); }));
    fs.writeFileSync(datei, Buffer.from(b64, 'base64'));
  } else {
    await expect.poll(() => downloads.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await downloads[downloads.length - 1].saveAs(datei);
  }
  const soll = await page.evaluate(() => {
    const z = window.__galerie.zustand;
    return z.bilder.filter((b) => z.gewaehlt.has(b.id)).map((b) => b.o.md5).sort();
  });
  expect(zipPruefen(datei)).toEqual(soll);
  notieren(info, { pruefung: 'Netzfehler ZIP', ergebnis: (engine(info) === 'firefox' ? '(2. Klick per DOM, siehe Test) ' : '') + 'einmaliger Abbruch unsichtbar wiederholt; dauerhafter Fehler: Meldung, „Erneut versuchen“, danach ZIP md5-gleich' });
});

// ---------- 4. Abbrechen ----------

test('Abbrechen: Vorgang stoppt, keine weiteren Abrufe', async ({ page }, info) => {
  await vorbereiten(page, istTouchProjekt(info) ? 'mit-dateien' : 'echt');
  await anmelden(page);
  await waehlen(page, istTouchProjekt(info) ? 10 : 6);
  let abrufe = 0;
  await page.route('**/b/**', async (route) => {
    abrufe += 1;
    await new Promise((r) => setTimeout(r, 400));
    return route.continue().catch(() => {});
  });
  await page.click('#aktion-knopf');
  await expect(page.locator('#panel')).toBeVisible();
  await page.waitForTimeout(500);
  const touch = istTouchProjekt(info);
  if (touch) await page.click('#panel-zu');
  else await page.click('#panel-abbrechen');
  await page.waitForTimeout(300);
  const stand = abrufe;
  await page.waitForTimeout(1500);
  expect(abrufe - stand, 'nach dem Abbruch keine neuen Abrufe').toBeLessThanOrEqual(touch ? 0 : 1);
  if (touch) await expect(page.locator('#panel')).toBeHidden();
  else await expect(page.locator('#panel-titel')).toHaveText('Abgebrochen');
  await expect(page.locator('#aktion-knopf')).toBeEnabled();
  notieren(info, { pruefung: 'Abbrechen', ergebnis: touch ? 'Fenster zu, Laden gestoppt' : '„Abgebrochen“, Laden gestoppt' });
});

// ---------- 5. Teilen-Menü meldet sich nicht zurück ----------

test('Teilen hängt: nach 15 s „Weiter“ statt Stillstand', async ({ page }, info) => {
  test.skip(!/iphone-15-webkit|pixel-7/.test(info.project.name), 'zwei Geräte reichen');
  test.setTimeout(90_000);
  await vorbereiten(page, 'haengt');
  await anmelden(page);
  await waehlen(page, 12);
  await page.click('#aktion-knopf');
  const knopf = page.locator('#panel-aktion');
  await expect(knopf).toBeEnabled({ timeout: 30_000 });
  await knopf.click();
  await expect(knopf).toHaveText('Weiter mit Paket 2', { timeout: 20_000 });
  await knopf.click();
  await expect(knopf).toHaveText('Paket 2 von 2 sichern', { timeout: 20_000 });
  notieren(info, { pruefung: 'Teilen hängt', ergebnis: 'nach 15 s „Weiter mit Paket 2“, weiter ohne Neuladen' });
});

// ---------- 6. Eingebaute App-Browser ----------

test('App-Browser: Hinweis „Im Browser öffnen“ nur wenn Teilen fehlt', async ({ browser }, info) => {
  test.skip(!/pixel-7|iphone-15-webkit/.test(info.project.name), 'je Plattform ein Gerät');
  const android = /pixel/.test(info.project.name);
  const faelle = android
    ? [['Instagram Android', UA_APP.instagramAndroid, 'fehlt', true]]
    : [['Facebook iOS', UA_APP.facebookIos, 'fehlt', true], ['Instagram iOS mit Teilen', UA_APP.instagramIos, 'mit-dateien', false]];
  for (const [name, ua, variante, hinweis] of faelle) {
    const { userAgent: _u, defaultBrowserType: _d, browserName: _b, ...basis } = info.project.use;
    const ctx = await browser.newContext({ ...basis, userAgent: ua, baseURL: 'http://127.0.0.1:8788', locale: 'de-DE' });
    const page = await ctx.newPage();
    await vorbereiten(page, variante);
    await anmelden(page);
    const box = page.locator('#app-hinweis');
    if (hinweis) {
      await expect(box).toBeVisible();
      await expect(page.locator('#app-hinweis-code')).toHaveText(`Dein Zugangscode: ${CODE}`);
      if (android) {
        const href = await page.locator('#app-hinweis-oeffnen').getAttribute('href');
        expect(href).toMatch(/^intent:\/\/127\.0\.0\.1:8788\/#Intent;scheme=http;action=android\.intent\.action\.VIEW;end$/);
        expect(href).not.toContain(CODE);
      } else {
        await expect(page.locator('#app-hinweis-oeffnen')).toBeHidden();
      }
      await page.click('#app-hinweis-kopieren');
      await expect(page.locator('#app-hinweis-status')).toContainText(/Link kopiert|von Hand/);
      const feld = await page.locator('#app-hinweis-link').inputValue();
      expect(feld).toBe(`http://127.0.0.1:8788/#c=${CODE}`);
      const breite = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(breite).toBe(true);
      await page.screenshot({ path: path.join(SCREENS, `${info.project.name}-app-${name.replace(/\s+/g, '-')}.png`) });
    } else {
      await expect(box).toBeHidden();
    }
    const u = await umgebungLesen(page);
    notieren(info, { pruefung: 'App-Browser', variante: name, weg: u.weg, plattform: u.plattform, ergebnis: hinweis ? `Hinweis sichtbar (${u.inApp}), Code und Link kopierbar${android ? ', Intent-Link' : ''}` : `kein Hinweis, Teilen klappt (${u.inApp})` });
    await ctx.close();
  }
});

// ---------- 7. Schmal im Hochformat ----------

test('320 px Hochformat: Paket-Knopf voll sichtbar und groß genug', async ({ page }, info) => {
  test.skip(!/iphone-se|android-firefox|pixel/.test(info.project.name), 'schmale Geräte');
  await page.setViewportSize({ width: 320, height: 568 });
  await vorbereiten(page, info.project.name.includes('firefox') ? 'echt' : 'mit-dateien');
  await anmelden(page);
  await waehlen(page, 12);
  await page.click('#aktion-knopf');
  const knopf = page.locator('#panel-aktion');
  await expect(knopf).toBeEnabled({ timeout: 30_000 });
  const m = await knopf.evaluate((k) => {
    const r = k.getBoundingClientRect();
    return { oben: r.top, unten: r.bottom, hoehe: r.height, breite: r.width, vh: window.innerHeight, passt: k.scrollWidth <= k.clientWidth + 1, sw: document.documentElement.scrollWidth, iw: window.innerWidth };
  });
  expect(m.unten).toBeLessThanOrEqual(m.vh);
  expect(m.oben).toBeGreaterThanOrEqual(0);
  expect(m.hoehe).toBeGreaterThanOrEqual(48);
  expect(m.passt).toBe(true);
  expect(m.sw).toBeLessThanOrEqual(m.iw);
  await page.screenshot({ path: path.join(SCREENS, `${info.project.name}-320-paket.png`) });
  notieren(info, { pruefung: '320 px', ergebnis: `Knopf ${Math.round(m.breite)}×${Math.round(m.hoehe)} px, ganz im Bild, kein Querscrollen` });
});
