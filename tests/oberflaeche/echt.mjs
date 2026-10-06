// Echter Test gegen ein laufendes Deployment (wrangler pages dev oder pages.dev).
// Gibt nie den Zugangscode oder Cookie-Werte aus.
//
//   node echt.mjs --basis http://127.0.0.1:8790 --name lokal
//   node echt.mjs --basis https://<projekt>.pages.dev --name live
//
// Optionen: --quelle <ordner> (Standard ../bilder), --code-datei <datei> (Standard ../.testcode),
//           --nur api|browser, --bremse-max <n> (Standard 15 Fehlversuche)
// Ergebnis: tests/ergebnisse/<name>/ergebnis.json, Screenshots und ZIP-Dateien daneben. Exit 1 bei Fehlern.

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, devices } from '@playwright/test';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    basis: { type: 'string' },
    name: { type: 'string' },
    quelle: { type: 'string' },
    'code-datei': { type: 'string' },
    nur: { type: 'string' },
    'bremse-max': { type: 'string' },
  },
  strict: true,
});
const BASIS = new URL(values.basis || 'http://127.0.0.1:8790').origin;
const HOST = new URL(BASIS).hostname;
const NAME = values.name || 'lokal';
const QUELLE = path.resolve(values.quelle || path.join(HIER, '..', 'bilder'));
const CODE = fs.readFileSync(values['code-datei'] || path.join(HIER, '..', '.testcode'), 'utf8').trim();
const AUS = path.resolve(HIER, '..', 'ergebnisse', NAME);
const SCREENS = path.join(AUS, 'screens');
fs.rmSync(AUS, { recursive: true, force: true });
fs.mkdirSync(SCREENS, { recursive: true });

const ergebnis = { basis: BASIS, zeit: new Date().toISOString(), geraete: {}, api: {}, fehler: [] };
const fehler = (t) => { ergebnis.fehler.push(t); console.log(`FEHLER ${t}`); };
const pruefe = (bedingung, text) => { if (!bedingung) fehler(text); return bedingung; };

// md5 aller Quelldateien, Schlüssel: "Mittwoch · Tag/4S4A1001.jpg"
function quellMd5() {
  const karte = new Map();
  const gehe = (dir, pfad) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) gehe(p, [...pfad, e.name]);
      else karte.set(`${pfad.join(' · ') || 'Alle Fotos'}/${e.name}`, crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'));
    }
  };
  gehe(QUELLE, []);
  return karte;
}
const QUELL_MD5 = quellMd5();

function zipPruefen(datei) {
  const skript = `
import zipfile, hashlib, json, sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps({i.filename: [hashlib.md5(z.read(i)).hexdigest(), i.compress_type, i.file_size] for i in z.infolist()}))`;
  return JSON.parse(execFileSync('python3', ['-c', skript, datei], { maxBuffer: 1 << 26 }).toString());
}

function zipGegenQuelle(datei, gewaehlt) {
  const liste = execFileSync('unzip', ['-l', datei]).toString().trim().split('\n');
  const inhalt = zipPruefen(datei);
  const soll = gewaehlt.map((b) => QUELL_MD5.get(`${b.kapitelTitel}/${b.name}`));
  const ist = Object.values(inhalt).map(([m]) => m);
  const gleich = soll.filter((m, i) => m && m === ist[i]).length;
  return {
    datei: path.relative(path.resolve(HIER, '../..'), datei),
    bytes: fs.statSync(datei).size,
    eintraege: Object.keys(inhalt).length,
    md5GleichQuelle: gleich,
    storeModus: Object.values(inhalt).every(([, art]) => art === 0),
    geteilteDabei: gewaehlt.filter((b) => b.o.teile.length > 1).map((b) => `${b.name} (${b.o.teile.length} Teile)`),
    unzipL: [liste[liste.length - 1].trim()],
    namen: Object.keys(inhalt),
  };
}

function ueberwachen(page, befund) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource: the server responded with a status of (401|410|429)/.test(m.text())) return;
    befund.konsole.push(m.text());
  });
  page.on('pageerror', (e) => befund.seite.push(e.message));
  page.on('request', (r) => {
    const u = new URL(r.url());
    befund.anfragen += 1;
    if (['blob:', 'data:'].includes(u.protocol)) return;
    befund.hosts.add(u.hostname);
    if (u.hostname !== HOST) befund.fremd.push(r.url());
    if (u.pathname.startsWith('/b/') && !/^\?s=[0-9a-f]{32}$/.test(u.search)) (befund.fotoOhneSitzung ||= []).push(u.pathname);
  });
}

async function querscrollen(page) {
  return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
}

async function anmelden(page) {
  const antworten = [];
  const merken = (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) antworten.push(`${new URL(r.url()).pathname} ${r.status()}`); };
  page.on('response', merken);
  await page.goto(`${BASIS}/#c=${CODE}`);
  try {
    await page.waitForSelector('#galerie:not([hidden])', { timeout: 30_000 });
  } catch (e) {
    // Zustand für die Fehlersuche festhalten (ohne Code)
    const sichtbar = await page.evaluate(() => document.body.dataset.zustand);
    const meldung = await page.evaluate(() => [document.getElementById('code-meldung')?.textContent, document.getElementById('meldung-titel')?.textContent].filter(Boolean).join(' / '));
    throw new Error(`Galerie nicht sichtbar: Zustand ${sichtbar}, Meldung "${meldung}", API ${antworten.join(', ')}`);
  } finally {
    page.off('response', merken);
  }
  return page.evaluate(() => location.hash);
}

async function bilderAusSeite(page) {
  return page.evaluate(() => {
    const z = window.__galerie.zustand;
    return z.bilder.map((b) => ({ id: b.id, name: b.name, o: b.o, h: b.h, kapitelTitel: z.manifest.kapitel[b.kapitel].titel }));
  });
}

async function waehle(page, ids) {
  for (const id of ids) await page.locator(`.kachel[data-id="${id}"] .kachel-wahl`).click();
}

const GERAETE = {
  'desktop-1300': { viewport: { width: 1300, height: 900 } },
  'desktop-1024': { viewport: { width: 1024, height: 768 } },
  'iphone-13': (() => { const { defaultBrowserType: _d, ...g } = devices['iPhone 13']; return g; })(),
  'pixel-7': devices['Pixel 7'],
  'schmal-320': { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const TEILEN_STUB = () => {
  window.__geteilt = [];
  navigator.canShare = (d) => !!d && Array.isArray(d.files) && d.files.length > 0 && d.files.every((f) => f instanceof File);
  navigator.share = async (d) => {
    window.__geteilt.push({
      anzahl: d.files.length,
      bytes: d.files.reduce((s, f) => s + f.size, 0),
      groessen: d.files.map((f) => f.size),
      namen: d.files.map((f) => f.name),
      typen: [...new Set(d.files.map((f) => f.type))],
      aktiv: navigator.userActivation?.isActive ?? null,
    });
  };
};

async function geraetTesten(browser, name) {
  const optionen = { ...GERAETE[name], locale: 'de-DE', timezoneId: 'Europe/Berlin', acceptDownloads: true };
  const kontext = await browser.newContext(optionen);
  const page = await kontext.newPage();
  const befund = { konsole: [], seite: [], fremd: [], hosts: new Set(), anfragen: 0 };
  ueberwachen(page, befund);
  const handy = name !== 'desktop-1300' && name !== 'desktop-1024';
  const r = { screens: [] };
  const bild = async (was) => {
    const datei = path.join(SCREENS, `${name}-${was}.png`);
    await page.screenshot({ path: datei });
    r.screens.push(path.relative(path.resolve(HIER, '../..'), datei));
  };

  let zipBytes = 0;
  let zipDatei = null;
  if (name === 'desktop-1300') {
    // Dateiauswahl-Weg (Chrome/Edge am Rechner): Strom stückweise an Node reichen
    zipDatei = path.join(AUS, `zip-${name}.zip`);
    const fd = fs.openSync(zipDatei, 'w');
    await page.exposeFunction('__zipStueck', (b64) => { const b = Buffer.from(b64, 'base64'); zipBytes += b.length; fs.writeSync(fd, b); });
    await page.exposeFunction('__zipEnde', () => fs.closeSync(fd));
    await page.addInitScript(() => {
      window.showSaveFilePicker = async (o) => {
        window.__dateiname = o.suggestedName;
        return {
          createWritable: async () => new WritableStream({
            async write(c) {
              const u = new Uint8Array(c);
              let s = '';
              for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
              await window.__zipStueck(btoa(s));
            },
            async close() { await window.__zipEnde(); window.__zipFertig = true; },
          }),
        };
      };
    });
  } else if (name === 'desktop-1024') {
    // Service-Worker-Weg (Firefox/Rechner ohne Dateiauswahl)
    await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  } else {
    await page.addInitScript(TEILEN_STUB);
  }

  const start = Date.now();
  r.hashNachAnmeldung = await anmelden(page);
  r.anmeldenMs = Date.now() - start;
  pruefe(r.hashNachAnmeldung === '', `${name}: Hash nach Anmeldung nicht entfernt`);
  r.kacheln = await page.locator('.kachel').count();
  r.kapitel = await page.locator('.kapitel-titel').allTextContents();
  r.info = await page.locator('#galerie-info').textContent();
  pruefe(r.kacheln === 60, `${name}: ${r.kacheln} Kacheln statt 60`);
  await page.waitForTimeout(800);
  await bild('galerie');
  r.querGalerie = await querscrollen(page);

  const bilder = await bilderAusSeite(page);
  if (!handy) {
    // 10 Originale, darunter ein geteiltes
    const geteilt = bilder.filter((b) => b.o.teile.length > 1);
    const einGeteiltes = name === 'desktop-1300' ? geteilt[0] : geteilt[geteilt.length - 1];
    const andere = bilder.filter((b) => b.o.teile.length === 1 && b.kapitelTitel === einGeteiltes.kapitelTitel).slice(0, 9);
    const gewaehlt = [einGeteiltes, ...andere];
    await waehle(page, gewaehlt.map((b) => b.id));
    r.zaehler = await page.locator('#zaehler').textContent();
    await bild('auswahl');
    r.querAuswahl = await querscrollen(page);
    const reihenfolge = bilder.filter((b) => gewaehlt.some((g) => g.id === b.id));
    const t0 = Date.now();
    if (name === 'desktop-1300') {
      await page.click('#aktion-knopf');
      // Fortschrittstext gegen den Balken: kein Stillstand bei 0 %, keine "30 Byte"
      const proben = [];
      for (let i = 0; i < 2400; i += 1) {
        const p = await page.evaluate(() => ({ v: document.getElementById('panel-fortschritt').value, t: document.getElementById('panel-text').textContent, fertig: window.__zipFertig === true }));
        proben.push(p);
        if (p.fertig) break;
        await page.waitForTimeout(250);
      }
      const mitte = proben.filter((p) => p.v >= 5 && p.v <= 95 && /\((\d+) %\)/.test(p.t));
      const abstand = mitte.map((p) => Math.abs(Number(p.t.match(/\((\d+) %\)/)[1]) - p.v));
      r.zipFortschritt = { proben: proben.length, mitProzent: mitte.length, maxAbstandProzent: Math.max(0, ...abstand), beispiele: [...new Set(proben.map((p) => p.t))].slice(0, 6) };
      pruefe(!proben.some((p) => /\d Byte von/.test(p.t)), `${name}: Fortschritt nennt Bytes`);
      pruefe(r.zipFortschritt.maxAbstandProzent <= 3, `${name}: Fortschrittstext hinkt dem Balken ${r.zipFortschritt.maxAbstandProzent} % hinterher`);
      await page.waitForFunction(() => window.__zipFertig === true, null, { timeout: 600_000 });
      await page.locator('#panel-titel').filter({ hasText: 'Fertig' }).waitFor({ timeout: 60_000 });
      r.zipName = await page.evaluate(() => window.__dateiname);
    } else {
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 });
      const download = page.waitForEvent('download', { timeout: 60_000 });
      await page.click('#aktion-knopf');
      const d = await download;
      zipDatei = path.join(AUS, `zip-${name}.zip`);
      await d.saveAs(zipDatei);
      r.zipName = d.suggestedFilename();
      r.zipUrlArt = new URL(d.url()).pathname.replace(/[0-9a-f]{24}$/, '<id>');
      await page.locator('#panel-titel').filter({ hasText: 'Fertig' }).waitFor({ timeout: 120_000 });
    }
    r.zipSek = Math.round((Date.now() - t0) / 100) / 10;
    await bild('zip-fertig');
    r.zip = zipGegenQuelle(zipDatei, reihenfolge);
    pruefe(r.zip.eintraege === 10 && r.zip.md5GleichQuelle === 10, `${name}: ZIP ${r.zip.md5GleichQuelle}/10 md5-gleich`);
    pruefe(r.zip.geteilteDabei.length >= 1, `${name}: kein geteiltes Original im ZIP`);

    // Großansicht: Tastatur, Original eines geteilten Bildes laden
    await page.click('#panel-zu').catch(() => {});
    const index = bilder.findIndex((b) => b.id === geteilt[geteilt.length - 1].id);
    await page.locator('#aufheben-knopf').click();
    await page.locator(`.kachel[data-id="${bilder[index].id}"] .kachel-bild`).click();
    await page.locator('#buehne.geladen').waitFor({ timeout: 20_000 });
    r.ansichtPos = await page.locator('#ansicht-pos').textContent();
    await page.waitForTimeout(600); // Überblendung vom Platzhalter abwarten
    await bild('ansicht');
    await page.keyboard.press('ArrowRight');
    r.ansichtNachPfeil = await page.locator('#ansicht-pos').textContent();
    await page.keyboard.press('ArrowLeft');
    if (name === 'desktop-1300') {
      const download = page.waitForEvent('download', { timeout: 120_000 });
      await page.click('#ansicht-original');
      const d = await download;
      const datei = path.join(AUS, `original-${name}.jpg`);
      await d.saveAs(datei);
      const md5 = crypto.createHash('md5').update(fs.readFileSync(datei)).digest('hex');
      r.originalEinzeln = { name: d.suggestedFilename(), teile: bilder[index].o.teile.length, md5GleichQuelle: md5 === QUELL_MD5.get(`${bilder[index].kapitelTitel}/${bilder[index].name}`) };
      pruefe(r.originalEinzeln.md5GleichQuelle, `${name}: Einzel-Original nicht md5-gleich`);
    }
    await page.keyboard.press('Escape');
    r.ansichtZu = await page.evaluate(() => !document.getElementById('ansicht').open);
  } else {
    // Handy: ein Kapitel auswählen, Pakete teilen
    const kapitel = name === 'schmal-320' ? 'Mittwoch · Tag' : 'Samstag · Abend';
    const ki = r.kapitel.indexOf(kapitel);
    await page.locator('.kapitel-alle').nth(ki).click();
    r.zaehler = await page.locator('#zaehler').textContent();
    await page.waitForTimeout(300);
    await bild('auswahl');
    r.querAuswahl = await querscrollen(page);
    await page.click('#aktion-knopf');
    const knopf = page.locator('#panel-aktion');
    const anzahlPakete = Number((await knopf.textContent()).match(/von (\d+)/)?.[1] || 0);
    r.pakete = anzahlPakete;
    const t0 = Date.now();
    for (let p = 1; p <= anzahlPakete; p += 1) {
      await page.locator('#panel-aktion:not([disabled])').waitFor({ timeout: 120_000 });
      if (p === 1) await bild('paket-bereit');
      await knopf.click();
      await page.waitForFunction((n) => window.__geteilt.length >= n, p, { timeout: 30_000 });
    }
    await page.locator('#panel-titel').filter({ hasText: 'Fertig' }).waitFor({ timeout: 30_000 });
    r.teilenSek = Math.round((Date.now() - t0) / 100) / 10;
    await bild('teilen-fertig');
    const geteilt = await page.evaluate(() => window.__geteilt);
    r.teilen = geteilt.map((g) => ({ anzahl: g.anzahl, mb: Math.round(g.bytes / 1e5) / 10, groessteMb: Math.round(Math.max(...g.groessen) / 1e5) / 10, typen: g.typen, aktiv: g.aktiv }));
    pruefe(geteilt.every((g) => g.anzahl <= 10 && g.bytes < 45e6 && g.aktiv === true), `${name}: Teilen-Paket verletzt Grenzen`);
    const soll = bilder.filter((b) => b.kapitelTitel === kapitel);
    pruefe(geteilt.reduce((s, g) => s + g.anzahl, 0) === soll.length, `${name}: geteilt ${geteilt.length} statt ${soll.length}`);
    pruefe(JSON.stringify(geteilt.flatMap((g) => g.groessen)) === JSON.stringify(soll.map((b) => b.h.bytes)), `${name}: geteilte Größen passen nicht zu h-Fassungen`);
    await page.click('#panel-zu');
    await page.locator('#aufheben-knopf').click();
    // Großansicht antippen, wischen
    await page.locator('.kachel-bild').nth(2).tap();
    await page.locator('#buehne.geladen').waitFor({ timeout: 20_000 });
    r.ansichtPos = await page.locator('#ansicht-pos').textContent();
    r.querAnsicht = await querscrollen(page);
    await page.waitForTimeout(600);
    await bild('ansicht');
    const box = await page.locator('#buehne').boundingBox();
    const cdp = await kontext.newCDPSession(page);
    const y = box.y + box.height / 2;
    const xs = [0.8, 0.65, 0.5, 0.35, 0.2].map((f) => box.x + box.width * f);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: xs[0], y }] });
    for (const x of xs.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    r.ansichtNachWischen = await page.locator('#ansicht-pos').textContent();
    await page.goBack();
    await page.waitForTimeout(300);
    r.ansichtZu = await page.evaluate(() => !document.getElementById('ansicht').open);
  }
  // Ganze Seite einmal durchscrollen, damit alle lazy-Bilder laden, dann Querscrollen messen
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } });
  await page.waitForTimeout(800);
  r.querVoll = await querscrollen(page);
  r.kachelnFehlend = await page.locator('.kachel.fehlt').count();
  for (const k of ['querGalerie', 'querAuswahl', 'querAnsicht', 'querVoll']) {
    if (r[k]) pruefe(r[k].sw <= r[k].iw, `${name}: Querscrollen (${k}) ${r[k].sw} > ${r[k].iw}`);
  }
  pruefe(r.kachelnFehlend === 0, `${name}: ${r.kachelnFehlend} Bilder nicht geladen`);
  pruefe(r.ansichtZu === true, `${name}: Großansicht nicht geschlossen`);
  r.konsolenfehler = befund.konsole;
  r.seitenfehler = befund.seite;
  r.anfragen = befund.anfragen;
  r.hosts = [...befund.hosts];
  r.fremdeAnfragen = befund.fremd;
  pruefe(befund.konsole.length === 0 && befund.seite.length === 0, `${name}: Konsolen-/Seitenfehler ${JSON.stringify([...befund.konsole, ...befund.seite]).slice(0, 300)}`);
  pruefe(befund.fremd.length === 0, `${name}: Anfragen an fremde Domains: ${befund.fremd.slice(0, 5).join(', ')}`);
  r.fotoOhneSitzung = (befund.fotoOhneSitzung || []).length;
  pruefe(r.fotoOhneSitzung === 0, `${name}: ${r.fotoOhneSitzung} Fotoabrufe ohne ?s= (Edge-Cache)`);
  await kontext.close();
  return r;
}

// ---------- API und Header (Node, ohne Browser) ----------

const kopfAuszug = (res, namen) => Object.fromEntries(namen.map((n) => [n, res.headers.get(n)]).filter(([, v]) => v !== null));
const KOPF = ['content-type', 'cache-control', 'x-robots-tag', 'content-security-policy', 'referrer-policy', 'x-content-type-options', 'permissions-policy', 'cf-cache-status', 'etag', 'retry-after', 'age'];

async function apiTesten() {
  const a = {};
  const html = await fetch(`${BASIS}/`);
  a.html = { status: html.status, ...kopfAuszug(html, KOPF) };
  pruefe(/noindex/.test(a.html['x-robots-tag'] || ''), 'HTML ohne X-Robots-Tag noindex');
  pruefe(/default-src 'self'/.test(a.html['content-security-policy'] || ''), 'HTML ohne CSP');
  const status = await fetch(`${BASIS}/api/status`);
  a.status = { status: status.status, body: await status.json(), ...kopfAuszug(status, KOPF) };
  pruefe(/noindex/.test(a.status['x-robots-tag'] || '') && a.status['cache-control'] === 'no-store', '/api/status Header');
  const ohne = await fetch(`${BASIS}/api/manifest`);
  a.manifestOhneCookie = { status: ohne.status, body: await ohne.text(), ...kopfAuszug(ohne, KOPF) };
  pruefe(ohne.status === 401, `/api/manifest ohne Cookie ${ohne.status}`);

  const t = Date.now();
  const zugang = await fetch(`${BASIS}/api/zugang`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: ` ${CODE.toLowerCase()} ` }) });
  const cookie = zugang.headers.get('set-cookie') || '';
  a.zugangRichtig = {
    status: zugang.status,
    ms: Date.now() - t,
    cookieAttribute: cookie.split(';').slice(1).map((s) => s.trim()),
    cookieForm: /^eg=\d+\.[A-Za-z0-9_-]{43}$/.test(cookie.split(';')[0]),
    hinweis: 'Code klein geschrieben und mit Leerzeichen gesendet',
  };
  pruefe(zugang.status === 204 && a.zugangRichtig.cookieForm, `/api/zugang richtig: ${zugang.status}`);
  pruefe(!/domain=/i.test(cookie) && /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Lax/.test(cookie) && /Max-Age=2592000/.test(cookie), 'Cookie-Attribute');
  const mit = await fetch(`${BASIS}/api/manifest`, { headers: { Cookie: cookie.split(';')[0] } });
  const manifest = await mit.json();
  a.manifestMitCookie = { status: mit.status, anzahl: manifest.anzahl, kapitel: manifest.kapitel.map((k) => `${k.titel} (${k.bilder.length})`), ...kopfAuszug(mit, KOPF) };
  pruefe(mit.status === 200 && manifest.anzahl === 60, `/api/manifest mit Cookie ${mit.status}`);

  const bild = manifest.kapitel[0].bilder[0];
  for (const [k, p] of [['bildR', bild.r], ['bildH', bild.h.pfad], ['original', bild.o.teile[0]]]) {
    await fetch(`${BASIS}${p}`).then((r) => r.arrayBuffer()); // erster Abruf füllt den Cache
    const res = await fetch(`${BASIS}${p}`);
    await res.arrayBuffer();
    a[k] = { status: res.status, ...kopfAuszug(res, KOPF) };
    pruefe(/immutable/.test(a[k]['cache-control'] || '') && /noindex/.test(a[k]['x-robots-tag'] || ''), `${k}: Cache-Control/X-Robots-Tag`);
    // Fotos nie im gemeinsamen Edge-Cache (sonst überleben sie Offline, Neubau und Löschwunsch)
    pruefe(/private/.test(a[k]['cache-control'] || '') && !/public/.test(a[k]['cache-control'] || ''), `${k}: Cache-Control nicht private`);
    pruefe(a[k]['cf-cache-status'] !== 'HIT', `${k}: Edge-Cache HIT trotz private`);
  }
  // Function nur auf /api/*: andere Pfade sind statisch
  const nichtApi = await fetch(`${BASIS}/apix/status`);
  a.nichtApi = { pfad: '/apix/status', status: nichtApi.status, ...kopfAuszug(nichtApi, ['content-type', 'cache-control', 'cf-cache-status', 'etag']) };
  const apiUnbekannt = await fetch(`${BASIS}/api/gibtsnicht`);
  a.apiUnbekannt = { status: apiUnbekannt.status, body: await apiUnbekannt.text(), ...kopfAuszug(apiUnbekannt, ['content-type', 'cache-control']) };
  pruefe(apiUnbekannt.status === 404 && /json/.test(a.apiUnbekannt['content-type'] || ''), '/api/gibtsnicht kommt nicht von der Function');
  pruefe(/text\/html/.test(a.nichtApi['content-type'] || '') && a.nichtApi['cache-control'] !== 'no-store', '/apix/status läuft durch die Function');
  // Function-Quellen und Steuerdateien dürfen nicht abrufbar sein
  a.quellenOeffentlich = {};
  for (const p of ['/functions/_daten.js', '/functions/_lib/zugang.js', '/functions/api/%5B%5Bpfad%5D%5D.js', '/_routes.json', '/_headers']) {
    const res = await fetch(`${BASIS}${p}`);
    const text = await res.text();
    const leck = /cookieSchluessel|codeHash|erzeugeHandler|"include"|X-Robots-Tag/.test(text);
    a.quellenOeffentlich[p] = { status: res.status, typ: res.headers.get('content-type'), leck };
    // wrangler pages dev liefert den Arbeitsordner samt functions/ aus; zählt nur auf dem echten Deployment
    if (!['127.0.0.1', 'localhost'].includes(HOST)) pruefe(!leck, `${p} ist öffentlich abrufbar`);
  }
  return { a, cookie: cookie.split(';')[0] };
}

async function bremseTesten(browser) {
  const b = { versuche: [] };
  // 1. Fehlversuch im Browser: Ansicht "falscher Code"
  const kontext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
  const page = await kontext.newPage();
  const falsch = CODE === 'ABCDEFGH' ? 'HGFEDCBA' : 'ABCDEFGH';
  await page.goto(`${BASIS}/#c=${falsch}`);
  await page.locator('#code-meldung').filter({ hasText: 'passt nicht' }).waitFor({ timeout: 20_000 });
  b.browserFalsch = await page.locator('#code-meldung').textContent();
  await page.screenshot({ path: path.join(SCREENS, 'zustand-falscher-code.png') });
  b.versuche.push({ nr: 1, weg: 'Browser', status: 401 });
  // weitere Fehlversuche per API, bis 429 kommt
  const max = Number(values['bremse-max'] || 15);
  for (let nr = 2; nr <= max; nr += 1) {
    const t = Date.now();
    const res = await fetch(`${BASIS}/api/zugang`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: falsch }) });
    const v = { nr, weg: 'API', status: res.status, ms: Date.now() - t, retryAfter: res.headers.get('retry-after'), robots: res.headers.get('x-robots-tag') };
    b.versuche.push(v);
    if (res.status === 429) break;
  }
  b.erster429 = b.versuche.find((v) => v.status === 429)?.nr ?? null;
  pruefe(b.versuche.filter((v) => v.status === 401 && v.weg === 'API').every((v) => v.ms >= 1000), 'Falscher Code ohne 1 s Verzögerung');
  pruefe(b.erster429 !== null, `kein 429 nach ${max} Fehlversuchen`);
  // Browser im gebremsten Zustand
  await page.goto(`${BASIS}/#c=${falsch}`);
  await page.locator('#code-meldung').filter({ hasText: 'Zu viele Versuche' }).waitFor({ timeout: 20_000 }).catch(() => {});
  b.browserGebremst = await page.locator('#code-meldung').textContent();
  await page.screenshot({ path: path.join(SCREENS, 'zustand-gebremst.png') });
  await kontext.close();
  return b;
}

// Abgelaufene Galerie: Status meldet abgelaufen, Zugang und Manifest 410, Oberfläche zeigt die Abgelaufen-Ansicht
async function abgelaufenTesten(browser) {
  const r = {};
  const s = await fetch(`${BASIS}/api/status`);
  r.status = [s.status, await s.json()];
  const z = await fetch(`${BASIS}/api/zugang`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: CODE }) });
  r.zugang = [z.status, await z.text(), z.headers.get('set-cookie') ? 'Cookie gesetzt' : 'kein Cookie'];
  const m = await fetch(`${BASIS}/api/manifest`);
  r.manifest = [m.status, await m.text()];
  pruefe(r.status[1].abgelaufen === true && z.status === 410 && m.status === 410 && r.zugang[2] === 'kein Cookie', 'Ablauf: Status/410 falsch');
  for (const [name, geraet] of [['390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['1300', { viewport: { width: 1300, height: 900 } }]]) {
    const kontext = await browser.newContext({ ...geraet, locale: 'de-DE' });
    const page = await kontext.newPage();
    const befund = { konsole: [], seite: [], fremd: [], hosts: new Set(), anfragen: 0 };
    ueberwachen(page, befund);
    await page.goto(`${BASIS}/#c=${CODE}`);
    await page.locator('#meldung-titel').filter({ hasText: 'nicht mehr online' }).waitFor({ timeout: 20_000 });
    r[`ansicht${name}`] = { titel: await page.locator('#meldung-titel').textContent(), text: await page.locator('#meldung-text').textContent(), fremd: befund.fremd.length, fehler: befund.konsole.length + befund.seite.length };
    await page.screenshot({ path: path.join(SCREENS, `abgelaufen-${name}.png`) });
    pruefe(befund.fremd.length === 0 && befund.konsole.length + befund.seite.length === 0, `Abgelaufen ${name}: Fehler oder Fremdanfragen`);
    await kontext.close();
  }
  return r;
}

const browser = await chromium.launch();
try {
  if (values.nur === 'abgelaufen') {
    ergebnis.abgelaufen = await abgelaufenTesten(browser);
  } else if (values.nur !== 'api') {
    for (const g of Object.keys(GERAETE)) {
      const t = Date.now();
      try {
        ergebnis.geraete[g] = await geraetTesten(browser, g);
      } catch (e) {
        fehler(`${g}: ${e.message.split('\n')[0]}`);
        ergebnis.geraete[g] = { abbruch: e.message.split('\n')[0] };
      }
      ergebnis.geraete[g].sek = Math.round((Date.now() - t) / 1000);
      console.log(`${g} fertig (${ergebnis.geraete[g].sek} s)`);
    }
  }
  if (values.nur !== 'browser' && values.nur !== 'abgelaufen') {
    const { a } = await apiTesten();
    ergebnis.api = a;
    ergebnis.bremse = await bremseTesten(browser);
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(AUS, 'ergebnis.json'), `${JSON.stringify(ergebnis, null, 1)}\n`);
console.log(`Ergebnis: ${path.join(AUS, 'ergebnis.json')}`);
console.log(ergebnis.fehler.length ? `${ergebnis.fehler.length} FEHLER` : 'ALLES OK');
process.exitCode = ergebnis.fehler.length ? 1 : 0;
