// Ende-zu-Ende-Tests der Gäste-Oberfläche gegen mock-server.mjs (Chromium; Desktop, iPhone 13, Pixel 7)
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const SCREENS = path.join(HIER, 'screens');
const ERGEBNISSE = path.join(HIER, '.ergebnisse');
fs.mkdirSync(SCREENS, { recursive: true });
fs.mkdirSync(ERGEBNISSE, { recursive: true });
const CODE = 'GAST2345';

const istDesktop = (info) => info.project.name === 'desktop';

async function mock(request, daten) {
  const r = await request.post('/__mock', { data: daten });
  expect(r.ok()).toBeTruthy();
}

// Sammelt Konsolenfehler, Seitenfehler und Anfragen an fremde Hosts
function ueberwachen(page) {
  const befund = { konsole: [], seite: [], fremd: [], erlaubteFehler: [], fotoOhneSitzung: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') befund.konsole.push(m.text());
  });
  page.on('pageerror', (e) => befund.seite.push(e.message));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (['blob:', 'data:'].includes(u.protocol)) return;
    if (u.hostname !== '127.0.0.1') befund.fremd.push(r.url());
    // Fotos nur mit Zufallswert je Seitenansicht (Edge-Cache von Pages, siehe VERTRAG _headers)
    if (u.pathname.startsWith('/b/') && !/^\?s=[0-9a-f]{32}$/.test(u.search)) befund.fotoOhneSitzung.push(u.pathname + u.search);
  });
  return befund;
}

function sauber(befund) {
  // 401/410/429 der API erscheinen in Chromium als "Failed to load resource" und sind gewollt
  const konsole = befund.konsole.filter((t) => !/Failed to load resource: the server responded with a status of (401|410|429|500)/.test(t));
  expect(konsole, 'Konsolenfehler').toEqual([]);
  expect(befund.seite, 'Seitenfehler').toEqual([]);
  expect(befund.fremd, 'Anfragen an fremde Domains').toEqual([]);
  expect(befund.fotoOhneSitzung, 'Fotoabrufe ohne ?s=').toEqual([]);
}

async function anmelden(page) {
  await page.goto(`/#c=${CODE}`);
  await expect(page.locator('#galerie')).toBeVisible({ timeout: 20_000 });
}

async function bild(page, name, info) {
  await page.screenshot({ path: path.join(SCREENS, `${info.project.name}-${name}.png`) });
}

async function keinQuerscrollen(page) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(m.sw, `scrollWidth ${m.sw} > innerWidth ${m.iw}`).toBeLessThanOrEqual(m.iw);
}

function zipPruefen(datei) {
  const skript = `
import zipfile, hashlib, json, sys
z = zipfile.ZipFile(sys.argv[1])
print(json.dumps({i.filename: [hashlib.md5(z.read(i)).hexdigest(), i.compress_type, i.file_size] for i in z.infolist()}))
assert z.testzip() is None`;
  return JSON.parse(execFileSync('python3', ['-c', skript, datei]).toString());
}

async function manifestAusSeite(page) {
  return page.evaluate(() => window.__galerie.zustand.manifest);
}

test.beforeEach(async ({ request }) => {
  await mock(request, { reset: true, marke: 'ambition' });
});

// ---------- Zugang ----------

test('Code per #c= öffnet die Galerie und entfernt den Hash', async ({ page }, info) => {
  const befund = ueberwachen(page);
  await anmelden(page);
  expect(new URL(page.url()).hash).toBe('');
  await expect(page).toHaveTitle('AMBITION Circle 2026 · Fotos');
  await expect(page.locator('#galerie-titel')).toHaveText('AMBITION Circle 2026');
  await expect(page.locator('#galerie-info')).toHaveText('40 Fotos · 3 Kapitel · online bis 3. Januar 2027');
  await expect(page.locator('.kachel')).toHaveCount(40);
  await expect(page.locator('.kapitel-link')).toHaveCount(3);
  // Raster: lazy und async, Seitenverhältnis gesetzt
  const vorne = await page.locator('.kachel img').first().evaluate((i) => [i.loading, i.decoding]);
  expect(vorne).toEqual(['eager', 'async']);
  const hinten = await page.locator('.kachel img').nth(20).evaluate((i) => [i.loading, i.decoding]);
  expect(hinten).toEqual(['lazy', 'async']);
  await page.waitForTimeout(800);
  await bild(page, 'galerie', info);
  // Neu laden: Cookie trägt, kein Code nötig
  await page.goto('/');
  await expect(page.locator('#galerie')).toBeVisible();
  sauber(befund);
});

test('falscher Code, dann richtiger Code über das Formular', async ({ page }, info) => {
  const befund = ueberwachen(page);
  const zugang = page.waitForResponse((r) => r.url().endsWith('/api/zugang'));
  await page.goto('/#c=WXYZ2345');
  expect((await zugang).status()).toBe(401);
  await expect(page.locator('#code-feld')).toHaveValue('WXYZ2345');
  await expect(page.locator('#z-code')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#code-meldung')).toHaveText('Dieser Code passt nicht. Bitte prüf ihn und versuch es noch einmal.');
  await expect(page.locator('#code-feld')).toHaveAttribute('aria-invalid', 'true');
  expect(new URL(page.url()).hash).toBe('');
  await bild(page, 'code-falsch', info);
  await page.fill('#code-feld', ' gast2345 ');
  await page.click('#code-knopf');
  await expect(page.locator('#galerie')).toBeVisible({ timeout: 10_000 });
  sauber(befund);
});

test('ohne Code: Eingabefeld; formal ungültiger Code wird ohne Anfrage abgelehnt', async ({ page }, info) => {
  const befund = ueberwachen(page);
  let anfragen = 0;
  page.on('request', (r) => { if (r.url().endsWith('/api/zugang')) anfragen += 1; });
  await page.goto('/');
  await expect(page.locator('#z-code')).toBeVisible();
  await expect(page.locator('#code-feld')).toBeFocused();
  await page.fill('#code-feld', 'FALSCH01');
  await page.click('#code-knopf');
  await expect(page.locator('#code-meldung')).toContainText('passt nicht');
  await page.fill('#code-feld', '');
  await page.click('#code-knopf');
  await expect(page.locator('#code-meldung')).toHaveText('Bitte gib deinen Zugangscode ein.');
  await page.fill('#code-feld', 'abc');
  await page.click('#code-knopf');
  await expect(page.locator('#code-meldung')).toHaveText('Der Code hat 8 Zeichen, zum Beispiel ABCD2345.');
  expect(anfragen).toBe(0);
  await page.fill('#code-feld', '');
  await bild(page, 'code', info);
  sauber(befund);
});

test('gebremst nach 5 Fehlversuchen zeigt die Wartezeit', async ({ page }, info) => {
  test.skip(!istDesktop(info), 'einmal reicht');
  const befund = ueberwachen(page);
  await page.goto('/');
  for (let i = 0; i < 5; i += 1) {
    await page.fill('#code-feld', 'WXYZ2345');
    await page.click('#code-knopf');
    await expect(page.locator('#code-meldung')).toContainText('passt nicht', { timeout: 5000 });
    await expect(page.locator('#code-knopf')).toHaveText('Galerie öffnen');
  }
  await page.fill('#code-feld', CODE);
  await page.click('#code-knopf');
  await expect(page.locator('#code-meldung')).toContainText('Zu viele Versuche. Bitte warte 10 Minuten');
  await expect(page.locator('#code-knopf')).toBeDisabled();
  // Die Ansage (role=alert) bleibt stehen; der Countdown läuft in #code-uhr ohne aria-live
  const vorher = await page.locator('#code-meldung').textContent();
  const aenderungen = await page.evaluate(() => new Promise((r) => {
    let n = 0;
    const b = new MutationObserver((l) => { n += l.length; });
    b.observe(document.getElementById('code-meldung'), { childList: true, characterData: true, subtree: true });
    setTimeout(() => { b.disconnect(); r(n); }, 2300);
  }));
  expect(aenderungen).toBe(0);
  expect(await page.locator('#code-meldung').textContent()).toBe(vorher);
  await expect(page.locator('#code-uhr')).toHaveText(/^Noch \d+ Minuten$/);
  expect(await page.locator('#code-uhr').getAttribute('aria-live')).toBeNull();
  await bild(page, 'gebremst', info);
  sauber(befund);
});

for (const [zustand, erwartet] of [
  ['leer', 'In dieser Galerie sind noch keine Fotos.'],
  ['abgelaufen', 'Diese Galerie ist nicht mehr online'],
  ['fehler', 'Das hat nicht geklappt'],
]) {
  test(`Zustand ${zustand}`, async ({ page, request }, info) => {
    const befund = ueberwachen(page);
    await mock(request, { zustand });
    await page.goto(`/#c=${CODE}`);
    await expect(page.locator('#z-meldung')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#z-meldung')).toContainText(erwartet);
    // Links aus /assets/marke.json, auch ohne fotos.<domain> als Host
    await expect(page.locator('#link-event')).toHaveAttribute('href', 'https://ambition-circle.de/');
    await expect(page.locator('#link-impressum')).toHaveAttribute('href', 'https://agenturkrueger-digital.de/impressum/');
    if (zustand === 'abgelaufen') {
      await expect(page.locator('#meldung-link')).toHaveAttribute('href', 'https://ambition-circle.de/');
      // kein zweiter "Zur Event-Seite" im Fuß, solange der Knopf da ist
      await expect(page.locator('#link-event')).toBeHidden();
      // der Code steht nicht mehr in Adresse und Verlauf
      expect(new URL(page.url()).hash).toBe('');
    } else {
      await expect(page.locator('#link-event')).toBeVisible();
    }
    // Fokus auf dem Titel, damit Screenreader den Zustand vorlesen
    await expect(page.locator('#meldung-titel')).toBeFocused();
    await bild(page, `zustand-${zustand}`, info);
    await keinQuerscrollen(page);
    sauber(befund);
  });
}

// ---------- Auswahl ----------

test('Auswahl, Zähler, alle im Kapitel, alle gesamt', async ({ page }, info) => {
  const befund = ueberwachen(page);
  await anmelden(page);
  await expect(page.locator('#leiste')).toBeHidden();
  await page.locator('.kachel-wahl').nth(0).click();
  await page.locator('.kachel-wahl').nth(1).click();
  await page.locator('.kachel-wahl').nth(2).click();
  await expect(page.locator('#leiste')).toBeVisible();
  await expect(page.locator('#zaehler')).toContainText('3 Fotos ausgewählt');
  await expect(page.locator('#zaehler')).toContainText(/\d+(,\d)? MB/);
  if (istDesktop(info)) await expect(page.locator('#zaehler')).toContainText('max. 200 je ZIP');
  await expect(page.locator('.kachel-wahl').nth(0)).toHaveAttribute('aria-pressed', 'true');
  // Im Auswahlmodus schaltet Antippen des Fotos die Auswahl
  await page.locator('.kachel-bild').nth(4).click();
  await expect(page.locator('#zaehler')).toContainText('4 Fotos ausgewählt');
  await expect(page.locator('#ansicht')).not.toHaveAttribute('open', '');
  // MB stimmen mit dem Manifest
  const m = await manifestAusSeite(page);
  const b = m.kapitel[0].bilder.slice(0, 3).concat([m.kapitel[0].bilder[4]]);
  const handy = await page.evaluate(() => window.__galerie.zustand.weg !== 'zip');
  const summe = b.reduce((s, x) => s + (handy ? x.h.bytes : x.o.bytes), 0);
  const text = (summe / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  await expect(page.locator('#zaehler')).toContainText(`${text} MB`);
  await bild(page, 'auswahl', info);
  await keinQuerscrollen(page);
  // Kapitel komplett
  await page.locator('.kapitel-alle').nth(1).click();
  await expect(page.locator('#zaehler')).toContainText('16 Fotos ausgewählt');
  await expect(page.locator('.kapitel-alle').nth(1)).toHaveText('Kapitel abwählen');
  await expect(page.locator('#alle-knopf')).toHaveText('Alle 40 Fotos auswählen');
  // Gesamt
  await page.click('#alle-knopf');
  await expect(page.locator('#zaehler')).toContainText('40 Fotos ausgewählt');
  await page.click('#alle-knopf');
  await expect(page.locator('#leiste')).toBeHidden();
  sauber(befund);
});

// ---------- ZIP ----------

const ZIP_INDIZES = [0, 3, 5, 6, 20, 21]; // mehrteilig, doppelte Namen, PNG

async function zipAuswahl(page) {
  const kacheln = page.locator('.kachel-wahl');
  for (const i of ZIP_INDIZES) await kacheln.nth(i).click();
  await expect(page.locator('#zaehler')).toContainText(`${ZIP_INDIZES.length} Fotos ausgewählt`);
}

function zipGegenManifest(inhalt, manifest) {
  const bilder = manifest.kapitel.flatMap((k) => k.bilder);
  const gewaehlt = ZIP_INDIZES.map((i) => bilder[i]);
  const namen = Object.keys(inhalt);
  expect(namen.length).toBe(gewaehlt.length);
  expect(new Set(namen.map((n) => n.toLowerCase())).size).toBe(namen.length);
  expect(namen).toContain('IMG_0001.jpg');
  expect(namen).toContain('IMG_0001 (2).jpg');
  expect(namen).toContain('img_0001 (3).JPG');
  expect(namen).toContain('Gruppenbild.png');
  const md5Zip = Object.values(inhalt).map(([md5]) => md5).sort();
  const md5Soll = gewaehlt.map((b) => b.o.md5).sort();
  expect(md5Zip).toEqual(md5Soll);
  expect(Object.values(inhalt).every(([, art]) => art === 0)).toBe(true); // Store-Modus
  expect(gewaehlt.some((b) => b.o.teile.length > 1)).toBe(true);
}

test('ZIP über showSaveFilePicker: Inhalt md5-gleich', async ({ page }, info) => {
  test.skip(!istDesktop(info), 'ZIP-Weg am Rechner');
  await page.addInitScript(() => {
    window.showSaveFilePicker = async (o) => {
      window.__dateiname = o.suggestedName;
      window.__aktivBeiAuswahl = navigator.userActivation?.isActive;
      const teile = [];
      return {
        createWritable: async () => new WritableStream({
          write(c) { teile.push(new Uint8Array(c)); },
          close() { window.__zip = new Blob(teile); },
        }),
      };
    };
  });
  const befund = ueberwachen(page);
  await anmelden(page);
  await zipAuswahl(page);
  await page.click('#aktion-knopf');
  await expect(page.locator('#panel-titel')).toHaveText('Fertig', { timeout: 30_000 });
  await bild(page, 'zip-fertig', info);
  const daten = await page.evaluate(async () => {
    const url = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(window.__zip); });
    return { name: window.__dateiname, aktiv: window.__aktivBeiAuswahl, b64: url.split(',')[1] };
  });
  expect(daten.name).toBe('AMBITION Circle 2026 Fotos.zip');
  expect(daten.aktiv).toBe(true);
  const datei = path.join(ERGEBNISSE, 'zip-dateiauswahl.zip');
  fs.writeFileSync(datei, Buffer.from(daten.b64, 'base64'));
  const inhalt = zipPruefen(datei);
  fs.writeFileSync(path.join(ERGEBNISSE, 'zip-dateiauswahl.json'), JSON.stringify(inhalt, null, 1));
  zipGegenManifest(inhalt, await manifestAusSeite(page));
  sauber(befund);
});

test('ZIP über Service Worker (ohne Dateiauswahl): Inhalt md5-gleich', async ({ page }, info) => {
  test.skip(!istDesktop(info), 'ZIP-Weg am Rechner');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  const befund = ueberwachen(page);
  await anmelden(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10_000 });
  await zipAuswahl(page);
  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.click('#aktion-knopf');
  const d = await download;
  expect(d.url()).toMatch(/\/zip-download\/[0-9a-f]{24}$/);
  expect(d.suggestedFilename()).toBe('AMBITION Circle 2026 Fotos.zip');
  const datei = path.join(ERGEBNISSE, 'zip-dienst.zip');
  await d.saveAs(datei);
  await expect(page.locator('#panel-titel')).toHaveText('Fertig', { timeout: 30_000 });
  zipGegenManifest(zipPruefen(datei), await manifestAusSeite(page));
  sauber(befund);
});

test('ZIP über Arbeitsspeicher (ohne Dateiauswahl und Service Worker)', async ({ page }, info) => {
  test.skip(!istDesktop(info), 'ZIP-Weg am Rechner');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => undefined, configurable: true });
  });
  const befund = ueberwachen(page);
  await anmelden(page);
  await zipAuswahl(page);
  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.click('#aktion-knopf');
  const d = await download;
  const datei = path.join(ERGEBNISSE, 'zip-speicher.zip');
  await d.saveAs(datei);
  expect(d.url()).toMatch(/^blob:/);
  await expect(page.locator('#panel-titel')).toHaveText('Fertig');
  zipGegenManifest(zipPruefen(datei), await manifestAusSeite(page));
  sauber(befund);
});

// ---------- Handy: Teilen ----------

test('Handy: In Fotos sichern teilt Pakete mit Dateien', async ({ page }, info) => {
  test.skip(istDesktop(info), 'nur Handy');
  await page.addInitScript(() => {
    window.__geteilt = [];
    window.__abbrechenEinmal = true;
    navigator.canShare = (d) => !!d && Array.isArray(d.files) && d.files.length > 0 && d.files.every((f) => f instanceof File);
    navigator.share = async (d) => {
      window.__geteilt.push({
        anzahl: d.files.length,
        namen: d.files.map((f) => f.name),
        typen: [...new Set(d.files.map((f) => f.type))],
        groessen: d.files.map((f) => f.size),
        aktiv: navigator.userActivation?.isActive ?? null,
      });
      if (window.__abbrechenEinmal) {
        window.__abbrechenEinmal = false;
        throw new DOMException('Share canceled', 'AbortError');
      }
    };
  });
  const befund = ueberwachen(page);
  await anmelden(page);
  await expect(page.locator('#galerie-tipp')).toBeVisible();
  // 23 Fotos: ganzes erstes Kapitel (18) und 5 aus dem zweiten
  await page.locator('.kapitel-alle').nth(0).click();
  for (let i = 18; i < 23; i += 1) await page.locator('.kachel-wahl').nth(i).click();
  await expect(page.locator('#zaehler')).toContainText('23 Fotos ausgewählt');
  await expect(page.locator('#aktion-knopf')).toHaveAccessibleName('In Fotos sichern');
  // Der ZIP-Nebenlink steht erst im Teilen-Fenster (spart Höhe in der Leiste)
  await expect(page.locator('#zip-neben')).toBeHidden();
  await bild(page, 'handy-auswahl', info);
  await keinQuerscrollen(page);
  await page.click('#aktion-knopf');
  const knopf = page.locator('#panel-aktion');
  await expect(knopf).toHaveText('Paket 1 von 3 sichern');
  await expect(knopf).toBeEnabled({ timeout: 20_000 });
  // Keine doppelten Knöpfe: solange das Panel offen ist, ist die Leiste nur Zähler
  await expect(page.locator('#aktion-knopf')).toBeHidden();
  // Der ZIP-Weg steht als einziger Nebenlink im Fenster
  await expect(page.locator('#panel #zip-neben')).toBeVisible();
  await expect(page.locator('#panel-abbrechen')).toBeHidden();
  await page.waitForTimeout(400);
  await bild(page, 'handy-paket-bereit', info);
  // Erster Versuch: Nutzer bricht ab
  await knopf.click();
  await expect(page.locator('#panel-text')).toContainText('Paket 1 wurde nicht gesichert');
  await expect(knopf).toBeEnabled();
  await knopf.click();
  await expect(knopf).toHaveText('Paket 2 von 3 sichern');
  await expect(knopf).toBeEnabled({ timeout: 20_000 });
  await knopf.click();
  await expect(knopf).toHaveText('Paket 3 von 3 sichern');
  await expect(knopf).toBeEnabled({ timeout: 20_000 });
  await knopf.click();
  await expect(page.locator('#panel-titel')).toHaveText('Fertig');
  await expect(page.locator('#panel-text')).toHaveText('Alle 3 Pakete mit zusammen 23 Fotos weitergegeben.');
  await bild(page, 'handy-fertig', info);
  const geteilt = await page.evaluate(() => window.__geteilt);
  fs.writeFileSync(path.join(ERGEBNISSE, `teilen-${info.project.name}.json`), JSON.stringify(geteilt, null, 1));
  expect(geteilt.map((g) => g.anzahl)).toEqual([10, 10, 10, 3]);
  expect(geteilt.every((g) => g.aktiv === true)).toBe(true);
  expect(geteilt.every((g) => g.typen.length === 1 && g.typen[0] === 'image/jpeg')).toBe(true);
  expect(geteilt.every((g) => g.groessen.reduce((s, x) => s + x, 0) < 45e6)).toBe(true);
  const m = await manifestAusSeite(page);
  const soll = m.kapitel[0].bilder.concat(m.kapitel[1].bilder.slice(0, 5)).map((b) => b.h.bytes);
  expect(geteilt.slice(1).flatMap((g) => g.groessen)).toEqual(soll);
  const namen = geteilt.slice(1).flatMap((g) => g.namen);
  expect(namen.every((n) => n.endsWith('.jpg'))).toBe(true);
  expect(new Set(namen.map((n) => n.toLowerCase())).size).toBe(23);
  expect(namen).toContain('Gruppenbild.jpg');
  sauber(befund);
});

// ---------- Großansicht ----------

test('Großansicht mit Tastatur: Enter, Pfeile, Fokusfalle, Esc', async ({ page }, info) => {
  test.skip(!istDesktop(info), 'Tastatur am Rechner');
  const befund = ueberwachen(page);
  await anmelden(page);
  await page.locator('.kachel-bild').first().focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('#ansicht');
  await expect(dialog).toHaveAttribute('open', '');
  await expect(page.locator('#ansicht-zu')).toBeFocused();
  await expect(page.locator('#ansicht-pos')).toHaveText('1 / 40');
  await expect(page.locator('#buehne')).toHaveClass(/geladen/, { timeout: 10_000 });
  await bild(page, 'ansicht', info);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#ansicht-pos')).toHaveText('2 / 40');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#ansicht-pos')).toHaveText('40 / 40');
  await page.keyboard.press('ArrowRight');
  // Fokusfalle: 12 x Tab bleibt im Dialog
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press(i % 4 === 3 ? 'Shift+Tab' : 'Tab');
    expect(await page.evaluate(() => document.getElementById('ansicht').contains(document.activeElement))).toBe(true);
  }
  // Auswahl umschalten
  await page.locator('#ansicht-wahl').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ansicht-wahl')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#zaehler')).toContainText('1 Foto ausgewählt');
  // Vor/Zurück-Knöpfe
  await page.click('#ansicht-vor');
  await expect(page.locator('#ansicht-pos')).toHaveText('2 / 40');
  await page.click('#ansicht-zurueck');
  await expect(page.locator('#ansicht-pos')).toHaveText('1 / 40');
  // Wischen mit der Maus (Pointer Events)
  const box = await page.locator('#buehne').boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('#ansicht-pos')).toHaveText('2 / 40');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(page.locator('.kachel-bild').nth(1)).toBeFocused();
  sauber(befund);
});

test('Original aus der Großansicht: byte-gleich', async ({ page }, info) => {
  test.skip(!istDesktop(info), 'einmal reicht');
  const befund = ueberwachen(page);
  await anmelden(page);
  await page.locator('.kachel-bild').first().click();
  await expect(page.locator('#ansicht-pos')).toHaveText('1 / 40');
  const download = page.waitForEvent('download');
  await page.click('#ansicht-original');
  const d = await download;
  expect(d.suggestedFilename()).toBe('4S4A1000.jpg');
  const datei = path.join(ERGEBNISSE, 'original.jpg');
  await d.saveAs(datei);
  const md5 = execFileSync('md5', ['-q', datei]).toString().trim();
  const m = await manifestAusSeite(page);
  expect(m.kapitel[0].bilder[0].o.teile.length).toBeGreaterThan(1);
  expect(md5).toBe(m.kapitel[0].bilder[0].o.md5);
  await expect(page.locator('#ansicht-original')).toHaveText('Original geladen');
  sauber(befund);
});

test('Handy: Großansicht wischen und mit Zurück schließen', async ({ page }, info) => {
  test.skip(istDesktop(info), 'nur Handy');
  const befund = ueberwachen(page);
  await anmelden(page);
  await page.locator('.kachel-bild').nth(2).tap();
  await expect(page.locator('#ansicht-pos')).toHaveText('3 / 40');
  await expect(page.locator('#buehne')).toHaveClass(/geladen/, { timeout: 10_000 });
  await keinQuerscrollen(page);
  await bild(page, 'ansicht', info);
  // Touch-Wischen über CDP
  const box = await page.locator('#buehne').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2;
  const punkte = [0.8, 0.65, 0.5, 0.35, 0.2].map((f) => box.x + box.width * f);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: punkte[0], y }] });
  for (const x of punkte.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#ansicht-pos')).toHaveText('4 / 40');
  await page.goBack();
  await expect(page.locator('#ansicht')).not.toHaveAttribute('open', '');
  await expect(page.locator('#galerie')).toBeVisible();
  sauber(befund);
});

// ---------- Breiten, Marken, Zugänglichkeit ----------

for (const breite of [320, 390, 1024, 1300]) {
  test(`kein Querscrollen bei ${breite} px`, async ({ page }, info) => {
    test.skip(!istDesktop(info), 'Breiten am Desktop-Projekt');
    await page.addInitScript(() => {
      window.showSaveFilePicker = async () => ({ createWritable: async () => new WritableStream({}) });
    });
    const befund = ueberwachen(page);
    await page.setViewportSize({ width: breite, height: 800 });
    await page.goto('/');
    await expect(page.locator('#z-code')).toBeVisible();
    await keinQuerscrollen(page);
    await page.fill('#code-feld', CODE);
    await page.click('#code-knopf');
    await expect(page.locator('#galerie')).toBeVisible();
    await page.waitForTimeout(400);
    await keinQuerscrollen(page);
    for (const i of [0, 7, 19]) await page.locator('.kachel-wahl').nth(i).click();
    await keinQuerscrollen(page);
    await page.click('#aktion-knopf');
    await expect(page.locator('#panel')).toBeVisible();
    await keinQuerscrollen(page);
    await page.screenshot({ path: path.join(SCREENS, `breite-${breite}.png`) });
    await page.screenshot({ path: path.join(SCREENS, `breite-${breite}-voll.png`), fullPage: true });
    sauber(befund);
  });
}

for (const marke of ['blueprint', 'ambition']) {
  test(`Marke ${marke}: Screenshots, Seitenverhältnis aus w/hoehe`, async ({ page, request }, info) => {
    await mock(request, { marke });
    const befund = ueberwachen(page);
    await anmelden(page);
    await page.waitForTimeout(800);
    // Seitenverhältnis kommt direkt aus w/hoehe des Manifests
    const v = await page.locator('.kachel').nth(1).evaluate((k) => k.style.getPropertyValue('--v'));
    expect(Number(v)).toBeCloseTo(2 / 3, 3);
    await bild(page, `marke-${marke}`, info);
    await page.locator('.kachel-wahl').nth(0).click();
    await page.locator('.kachel-wahl').nth(1).click();
    await bild(page, `marke-${marke}-auswahl`, info);
    sauber(befund);
  });
}

test('Zugänglichkeit mit axe-core (WCAG 2.1 AA)', async ({ browser }, info) => {
  test.skip(!istDesktop(info), 'einmal reicht');
  const axePfad = path.join(HIER, 'node_modules/axe-core/axe.min.js');
  const ergebnisse = {};
  for (const marke of ['ambition', 'blueprint']) {
    const ctx = await browser.newContext({ bypassCSP: true, baseURL: 'http://127.0.0.1:8788', viewport: { width: 1300, height: 900 } });
    await ctx.request.post('/__mock', { data: { reset: true, marke } });
    const page = await ctx.newPage();
    const pruefen = async (name) => {
      // Einblendungen (Leiste, Großansicht) erst zu Ende laufen lassen, sonst misst axe Mischfarben
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
      await page.waitForTimeout(300);
      await page.addScriptTag({ path: axePfad });
      const r = await page.evaluate(async () => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }));
      ergebnisse[`${marke}-${name}`] = r.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes.map((n) => `${n.target.join(' ')} ${n.any?.[0]?.message || ''}`).join(' | ')})`);
    };
    await page.goto('/');
    await expect(page.locator('#z-code')).toBeVisible();
    await pruefen('code');
    await page.fill('#code-feld', CODE);
    await page.click('#code-knopf');
    await expect(page.locator('#galerie')).toBeVisible();
    await page.waitForTimeout(500);
    await page.locator('.kachel-wahl').nth(0).click();
    await pruefen('galerie');
    await page.locator('.kachel-bild').nth(3).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#buehne')).toHaveClass(/geladen/, { timeout: 10_000 });
    await pruefen('ansicht');
    await ctx.close();
  }
  fs.writeFileSync(path.join(ERGEBNISSE, 'axe.json'), JSON.stringify(ergebnisse, null, 1));
  for (const [name, verstoesse] of Object.entries(ergebnisse)) expect(verstoesse, name).toEqual([]);
});

test('ohne hoehe im Manifest: Seitenverhältnis aus dem geladenen Bild', async ({ page, request }, info) => {
  test.skip(!istDesktop(info), 'einmal reicht');
  await mock(request, { variante: 'ohne-hoehe' });
  const befund = ueberwachen(page);
  await anmelden(page);
  await expect.poll(() => page.locator('.kachel').nth(1).evaluate((k) => Number(k.style.getPropertyValue('--v')).toFixed(3))).toBe((2 / 3).toFixed(3));
  sauber(befund);
});

// ---------- Tastatur, Fokus, Leiste (Prüfbefunde 05.10.2026) ----------

test('Tastatur: ein Tabstopp je Raster, Pfeile, Leertaste wählt, Leiste vor dem Raster', async ({ page }, info) => {
  test.skip(!istDesktop(info), 'Tastatur am Rechner');
  const befund = ueberwachen(page);
  await anmelden(page);
  await expect(page.locator('#galerie-titel')).toBeFocused();
  // Ganze Seite einmal durchtabben: 40 Fotos dürfen nicht 80 Tabstopps kosten
  const reihe = [];
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const z = await page.evaluate(() => {
      const a = document.activeElement;
      return a.id || a.className || a.tagName;
    });
    if (reihe.includes(z) && z === reihe[0]) break;
    reihe.push(z);
    if (z === 'BODY') break;
  }
  const fotoStopps = reihe.filter((z) => String(z).includes('kachel-bild')).length;
  expect(fotoStopps, reihe.join(' | ')).toBe(3); // je Kapitel ein Tabstopp
  expect(reihe.filter((z) => String(z).includes('kachel-wahl')).length).toBe(0);
  // Erstes Foto per Tastatur: Pfeil rechts, Leertaste wählt aus
  await page.locator('.kachel-bild').first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.kachel-bild').nth(1)).toBeFocused();
  await expect(page.locator('.kachel-bild').nth(1)).toHaveAttribute('tabindex', '0');
  await expect(page.locator('.kachel-bild').nth(0)).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('Space');
  await expect(page.locator('#zaehler')).toContainText('1 Foto ausgewählt');
  await expect(page.locator('#ansicht')).not.toHaveAttribute('open', '');
  await expect(page.locator('.kachel-bild').nth(1)).toHaveAttribute('aria-label', 'Foto 2 ansehen, ausgewählt');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(page.locator('#zaehler')).toContainText('2 Fotos ausgewählt');
  // Vom Foto zurück zur Aktionsleiste: wenige Schritte
  let schritte = 0;
  for (; schritte < 12; schritte += 1) {
    if (await page.evaluate(() => document.activeElement.id === 'aktion-knopf')) break;
    await page.keyboard.press('Shift+Tab');
  }
  expect(schritte, 'Shift+Tab vom Foto bis "Als ZIP laden"').toBeLessThanOrEqual(8);
  fs.writeFileSync(path.join(ERGEBNISSE, 'tastatur.json'), JSON.stringify({ reihe, schritteZurLeiste: schritte }, null, 1));
  // Enter auf einem Foto öffnet die Großansicht
  await page.locator('.kachel-bild').nth(5).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ansicht')).toHaveAttribute('open', '');
  sauber(befund);
});

test('Am Rechner sind die Auswahlkreise ohne Hover sichtbar', async ({ page }, info) => {
  test.skip(!istDesktop(info), 'nur Rechner');
  await anmelden(page);
  await page.mouse.move(5, 5);
  const deckkraft = await page.locator('.kachel-kreis').nth(3).evaluate((k) => Number(getComputedStyle(k).opacity));
  expect(deckkraft).toBeGreaterThanOrEqual(0.7);
  await expect(page.locator('#galerie-tipp')).toHaveText('Klick auf den Kreis oben rechts, um ein Foto auszuwählen.');
});

test('Ohne status.json fragt die Seite /api/status', async ({ page, request }, info) => {
  test.skip(!istDesktop(info), 'einmal reicht');
  await mock(request, { variante: 'ohne-status' });
  let api = 0;
  page.on('request', (r) => { if (r.url().endsWith('/api/status')) api += 1; });
  await anmelden(page);
  expect(api).toBe(1);
});

test('Mit status.json kein Function-Aufruf für den Status', async ({ page }, info) => {
  test.skip(!istDesktop(info), 'einmal reicht');
  let api = 0;
  page.on('request', (r) => { if (r.url().endsWith('/api/status')) api += 1; });
  await anmelden(page);
  expect(api).toBe(0);
});

test('Handy: Leiste in einer Zeile, Großansicht sichert ins Fotos-Menü', async ({ page }, info) => {
  test.skip(istDesktop(info), 'nur Handy');
  await page.addInitScript(() => {
    window.__geteilt = [];
    navigator.canShare = (d) => !!d && Array.isArray(d.files) && d.files.length > 0;
    navigator.share = async (d) => { window.__geteilt.push(d.files.map((f) => [f.name, f.type, f.size])); };
  });
  const befund = ueberwachen(page);
  await anmelden(page);
  // Kapitel-Knopf in derselben Zeile wie die Anzahl, eindeutig beschriftet
  const kopf = await page.locator('.kapitel-kopf').first().evaluate((k) => {
    const t = k.querySelector('.kapitel-anzahl').getBoundingClientRect();
    const b = k.querySelector('.kapitel-alle').getBoundingClientRect();
    return { ueberlappt: b.top < t.bottom && b.bottom > t.top, text: k.querySelector('.kapitel-alle').textContent };
  });
  expect(kopf).toEqual({ ueberlappt: true, text: 'Kapitel auswählen' });
  for (const i of [0, 1, 2]) await page.locator('.kachel-wahl').nth(i).click();
  const hoehe = await page.locator('#leiste').evaluate((l) => l.getBoundingClientRect().height);
  expect(hoehe, 'Höhe der Aktionsleiste').toBeLessThanOrEqual(80);
  await expect(page.locator('#aufheben-knopf')).toHaveAccessibleName('Auswahl aufheben');
  await expect(page.locator('#aktion-knopf')).toHaveAccessibleName('In Fotos sichern');
  await expect(page.locator('#zip-neben')).toBeHidden();
  await bild(page, 'leiste-eine-zeile', info);
  await page.locator('.kachel-bild').nth(4).tap();
  await expect(page.locator('#zaehler')).toContainText('4 Fotos ausgewählt');
  await page.click('#aufheben-knopf');
  await page.locator('.kachel-bild').nth(2).tap();
  const knopf = page.locator('#ansicht-original');
  await expect(knopf).toHaveText('In Fotos sichern');
  await knopf.tap();
  await expect.poll(() => page.evaluate(() => window.__geteilt.length)).toBe(1);
  const geteilt = await page.evaluate(() => window.__geteilt[0]);
  expect(geteilt.length).toBe(1);
  expect(geteilt[0][1]).toBe('image/jpeg');
  await expect(page.locator('#ansicht-status')).toHaveText('Foto weitergegeben.');
  const passt = await knopf.evaluate((k) => k.scrollWidth <= k.clientWidth + 1 && k.getBoundingClientRect().height < 48);
  expect(passt, 'Knopf ohne Umbruch').toBe(true);
  await keinQuerscrollen(page);
  sauber(befund);
});

test('Handy: ZIP-Nebenlink steht im Teilen-Fenster', async ({ page }, info) => {
  test.skip(istDesktop(info), 'nur Handy');
  await page.addInitScript(() => {
    navigator.canShare = (d) => !!d && Array.isArray(d.files) && d.files.length > 0;
    navigator.share = async () => {};
  });
  await anmelden(page);
  await page.locator('.kachel-wahl').nth(0).click();
  await expect(page.locator('#zip-neben')).toBeHidden();
  await page.click('#aktion-knopf');
  await expect(page.locator('#zip-neben')).toBeVisible();
});

test('320 px: Leiste und Großansicht ohne Umbruch und Querscrollen', async ({ page }, info) => {
  test.skip(!istDesktop(info), 'Breite am Desktop-Projekt');
  await page.setViewportSize({ width: 320, height: 640 });
  await anmelden(page);
  for (const i of [0, 1]) await page.locator('.kachel-wahl').nth(i).click();
  const m = await page.evaluate(() => {
    const l = document.getElementById('leiste').getBoundingClientRect().height;
    const knoepfe = [...document.querySelectorAll('#leiste .leiste-knoepfe .knopf')].map((k) => k.getBoundingClientRect().height);
    return { l, knoepfe };
  });
  expect(m.l).toBeLessThanOrEqual(80);
  expect(Math.max(...m.knoepfe)).toBeLessThanOrEqual(50);
  await keinQuerscrollen(page);
  await page.screenshot({ path: path.join(SCREENS, 'w320-leiste.png') });
});

// ---------- Bühnenbild, Kontrast, Marken (06.10.2026) ----------

const lum = ([r, g, b]) => {
  const k = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b);
};
const kontrast = (a, b) => { const [h, d] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (d + 0.05); };
const rgb = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);

// Misst den Kontrast echt am Bild: Text unsichtbar machen, Hintergrund hinter jeder Textbox auslesen
// und den ungünstigsten Pixel gegen die Textfarbe (bzw. jede Verlaufsfarbe des Titels) rechnen.
for (const [marke, variante] of [['blueprint', 'hell'], ['neutral', 'hell'], ['ambition', 'vertrag']]) {
  test(`Kontrast über dem Bühnenbild: ${marke}${variante === 'hell' ? ' mit weißem Titelfoto' : ' mit Marken-Hintergrund'}`, async ({ page, request }, info) => {
    test.skip(!istDesktop(info) && info.project.name !== 'iphone-13', 'Rechner und ein Handy');
    const sharp = (await import('sharp')).default;
    await mock(request, { marke, variante });
    await anmelden(page);
    await expect(page.locator('#titelbild.da, html.mit-kopfbild #titelbild')).toHaveCount(1, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1800); // Einblendung des Titelbilds
    const ziele = ['.galerie-oberzeile', '#galerie-titel', '#galerie-info', '#galerie-tipp', '#alle-knopf', '.kopf-logo'];
    const boxen = await page.evaluate((sel) => sel.map((s) => {
      const e = document.querySelector(s);
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      const verlauf = (cs.backgroundImage.match(/rgb\([^)]+\)/g) || []);
      // Nur die Zeilen mit Schrift messen, nicht die ganze Blockbreite
      const bereich = document.createRange();
      bereich.selectNodeContents(e);
      const zeilen = [...bereich.getClientRects()].filter((z) => z.width > 1).map((z) => ({ x: z.x, y: z.y, w: z.width, h: z.height }));
      return { s, x: r.x, y: r.y, w: r.width, h: r.height, zeilen: zeilen.length ? zeilen : [{ x: r.x, y: r.y, w: r.width, h: r.height }], farbe: cs.color, verlauf, gross: parseFloat(cs.fontSize) >= 24 };
    }), ziele);
    // Ausblenden über das CSSOM (ein <style>-Tag verbietet die CSP, gewollt)
    await page.evaluate(() => {
      for (const e of document.querySelectorAll('.galerie-kopf, .galerie-kopf *, .kopf-logo')) {
        e.style.setProperty('opacity', '0', 'important');
        e.style.setProperty('transition', 'none', 'important');
      }
    });
    await page.waitForTimeout(100);
    const datei = path.join(ERGEBNISSE, `kontrast-${marke}-${info.project.name}.png`);
    await page.screenshot({ path: datei });
    await page.evaluate(() => {
      for (const e of document.querySelectorAll('.galerie-kopf, .galerie-kopf *, .kopf-logo')) { e.style.removeProperty('opacity'); e.style.removeProperty('transition'); }
    });
    const { data, info: bild } = await sharp(datei).raw().toBuffer({ resolveWithObject: true });
    const dpr = bild.width / page.viewportSize().width;
    const ergebnis = {};
    for (const b of boxen.filter((x) => x.s !== '.kopf-logo')) {
      let schlechtester = null;
      let wo = null;
      const stopps = b.verlauf.map(rgb);
      // Verlauf 135°: Farbe am Punkt (dx, dy) liegt bei t = (dx + dy) / (Breite + Höhe)
      const farbeBei = (x, y) => {
        if (!stopps.length) return rgb(b.farbe);
        const t = Math.min(1, Math.max(0, ((x / dpr - b.x) + (y / dpr - b.y)) / (b.w + b.h))) * (stopps.length - 1);
        const i = Math.min(stopps.length - 2, Math.floor(t));
        const f = t - i;
        return stopps[i].map((c, k) => c + (stopps[i + 1][k] - c) * f);
      };
      for (const z of b.zeilen) for (let y = Math.floor(z.y * dpr); y < (z.y + z.h) * dpr; y += 2) {
        for (let x = Math.floor(z.x * dpr); x < (z.x + z.w) * dpr; x += 2) {
          const i = (y * bild.width + x) * bild.channels;
          const px = [data[i], data[i + 1], data[i + 2]];
          for (const f of [farbeBei(x, y)]) {
            const k = kontrast(f, px);
            if (!schlechtester || k < schlechtester) { schlechtester = k; wo = { x: x / dpr, y: y / dpr, px, f: f.map(Math.round) }; }
          }
        }
      }
      ergebnis[b.s] = Math.round(schlechtester * 100) / 100;
      const soll = b.gross ? 3 : 4.5;
      expect(schlechtester, `${b.s}: ${schlechtester.toFixed(2)} (Soll ${soll}) bei ${JSON.stringify(wo)}, Box ${JSON.stringify([b.x, b.y, b.w, b.h].map(Math.round))}`).toBeGreaterThanOrEqual(soll);
    }
    fs.appendFileSync(path.join(ERGEBNISSE, 'kontrast.jsonl'), `${JSON.stringify({ marke, variante, projekt: info.project.name, ergebnis })}\n`);
    await bild_(page, `buehne-${marke}`, info);
  });
}

async function bild_(page, name, info) {
  await page.screenshot({ path: path.join(SCREENS, `${info.project.name}-${name}.png`) });
}

test('700 Fotos: Erstansicht lädt nur sichtbare Rasterbilder, kein Querscrollen, Blocksatz schließt bündig', async ({ page, request }, info) => {
  test.skip(info.project.name === 'iphone-13', 'Rechner und Pixel reichen');
  const geladen = new Set();
  page.on('request', (r) => { if (/\/b\/[^/]+\/r\//.test(r.url())) geladen.add(new URL(r.url()).pathname); });
  await mock(request, { anzahl: 700 });
  await anmelden(page);
  await page.waitForTimeout(1500);
  const n = await page.locator('.kachel').count();
  expect(n).toBe(700);
  expect(geladen.size, `${geladen.size} Rasterbilder sofort geladen`).toBeLessThan(60);
  // Jede volle Zeile endet bündig am rechten Rand
  const raender = await page.evaluate(() => {
    const raster = document.querySelector('.raster');
    const rechts = raster.getBoundingClientRect().right;
    const kacheln = [...raster.children];
    const zeilen = new Map();
    for (const k of kacheln.slice(0, 120)) {
      const r = k.getBoundingClientRect();
      const y = Math.round(r.top);
      zeilen.set(y, Math.max(zeilen.get(y) || 0, r.right));
    }
    const enden = [...zeilen.values()].slice(0, -1);
    return enden.map((x) => Math.round((rechts - x) * 10) / 10);
  });
  expect(Math.max(...raender.map(Math.abs)), `Abstand der Zeilenenden zum Rand: ${raender.join(', ')}`).toBeLessThanOrEqual(1);
  await keinQuerscrollen(page);
  fs.writeFileSync(path.join(ERGEBNISSE, `700-${info.project.name}.json`), JSON.stringify({ kacheln: n, sofortGeladen: geladen.size }, null, 1));
  await mock(request, { anzahl: 40 });
});

test('Ohne Ablauf: kein Function-Aufruf für den Status, kein „online bis“', async ({ page, request }, info) => {
  test.skip(!istDesktop(info), 'einmal reicht');
  await mock(request, { variante: 'ohne-ablauf' });
  let api = 0;
  page.on('request', (r) => { if (r.url().endsWith('/api/status')) api += 1; });
  await anmelden(page);
  expect(api).toBe(0);
  await expect(page.locator('#galerie-info')).toHaveText('40 Fotos · 3 Kapitel');
});

test('Marke agentur (Cormorant Garamond aus marken/schriften) lädt ohne Fehler', async ({ page, request }, info) => {
  test.skip(!istDesktop(info), 'einmal reicht');
  await mock(request, { marke: 'agentur' });
  const befund = ueberwachen(page);
  await anmelden(page);
  await page.waitForTimeout(800);
  const schrift = await page.locator('#galerie-titel').evaluate((t) => getComputedStyle(t).fontFamily);
  expect(schrift).toContain('Cormorant Garamond');
  expect(await page.evaluate(() => document.fonts.check('600 40px "Cormorant Garamond"'))).toBe(true);
  await bild(page, 'marke-agentur', info);
  sauber(befund);
});
