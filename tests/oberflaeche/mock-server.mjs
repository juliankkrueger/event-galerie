// Mock für die Gäste-Oberfläche: liefert vorlage/ aus, beantwortet /api/* wie im Vertrag
// und erzeugt synthetische Bilder (r, g, h, o in Teilen). Nur für Tests, nie deployen.
//
//   node tests/oberflaeche/mock-server.mjs [--port 8788] [--marke ambition] [--anzahl 40]
//
// Steuerung für Tests: POST /__mock {"zustand":"normal|leer|abgelaufen|fehler",
//   "variante":"vertrag|ohne-hoehe|ohne-status", "marke":"ambition|blueprint", "reset":true}
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { markeCss, markeDateien } from '../../marken/marke-css.mjs';
import { markeOeffentlich } from '../../bau/lib/marke.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.resolve(HIER, '../..');
const VORLAGE = path.join(WURZEL, 'vorlage');

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : standard;
};
const PORT = Number(arg('port', process.env.PORT || 8788));
const ANZAHL = Number(arg('anzahl', 40));
export const CODE = 'GAST2345';
const TEIL_GROESSE = 150_000; // im Mock klein, damit Originale aus mehreren Teilen bestehen
const TOK = 'k7m2q9x4w8r3t6y1z5c0v2b8n4m6p1qa';

const einstellungen = { zustand: 'normal', variante: 'vertrag', marke: arg('marke', 'ambition') };
const fehlversuche = new Map();
const dateien = new Map(); // Pfad -> { daten, typ }
let bilder = [];

const CSP = "default-src 'self'; img-src 'self' blob: data:; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const SICHERHEIT = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': CSP,
};

const TYPEN = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
};

const FORMATE = [[3, 2], [2, 3], [1, 1], [16, 9], [4, 5], [3, 2], [3, 2], [2, 3]];
const FARBEN = ['#8a5a44', '#2f5d62', '#a47551', '#3d405b', '#6b705c', '#b5838d', '#457b9d', '#9c6644'];

function zufallsId() {
  return crypto.randomBytes(8).toString('hex');
}

async function bildErzeugen(i) {
  const [fw, fh] = FORMATE[i % FORMATE.length];
  const lang = 2400;
  const w = fw >= fh ? lang : Math.round((lang * fw) / fh);
  const h = fw >= fh ? Math.round((lang * fh) / fw) : lang;
  const farbe = FARBEN[i % FARBEN.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${farbe}"/><stop offset="1" stop-color="#111"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${w * 0.7}" cy="${h * 0.35}" r="${Math.min(w, h) * 0.22}" fill="#fff" fill-opacity="0.18"/>
    <text x="50%" y="55%" font-family="Helvetica, Arial" font-size="${Math.min(w, h) * 0.28}" fill="#fff" text-anchor="middle">${i + 1}</text></svg>`;
  let basis = sharp(Buffer.from(svg));
  // Jedes dritte Bild bekommt Rauschen, damit das Original groß wird und in Teile zerfällt
  if (i % 3 === 0) {
    const rauschen = await sharp({ create: { width: w, height: h, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
      .png().toBuffer();
    basis = sharp(Buffer.from(svg)).composite([{ input: rauschen, blend: 'overlay' }]);
  }
  const voll = await basis.jpeg({ quality: 90 }).toBuffer();
  const o = i === 5
    ? await sharp(voll).png({ compressionLevel: 6 }).toBuffer() // ein PNG-Original
    : voll;
  const r = await sharp(voll).resize(600, 600, { fit: 'inside' }).jpeg({ quality: 78, progressive: true }).toBuffer();
  const g = await sharp(voll).resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer();
  const hf = await sharp(voll).resize(2400, 2400, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
  return { w, h, o, r, g, hf, png: i === 5 };
}

async function bilderErzeugen() {
  const liste = [];
  for (let i = 0; i < ANZAHL; i += 1) {
    const id = zufallsId();
    const e = await bildErzeugen(i);
    let name = `4S4A${String(1000 + i)}.jpg`;
    if (i === 3 || i === 20) name = 'IMG_0001.jpg'; // doppelter Name in zwei Kapiteln
    if (i === 21) name = 'img_0001.JPG'; // gleicher Name, andere Schreibung
    if (e.png) name = 'Gruppenbild.png';
    const teile = [];
    for (let s = 0, n = 1; s < e.o.length; s += TEIL_GROESSE, n += 1) {
      const pfad = `/b/${TOK}/o/${id}.${n}`;
      dateien.set(pfad, { daten: e.o.subarray(s, s + TEIL_GROESSE), typ: 'application/octet-stream' });
      teile.push(pfad);
    }
    dateien.set(`/b/${TOK}/r/${id}.jpg`, { daten: e.r, typ: 'image/jpeg' });
    dateien.set(`/b/${TOK}/g/${id}.jpg`, { daten: e.g, typ: 'image/jpeg' });
    dateien.set(`/b/${TOK}/h/${id}.jpg`, { daten: e.hf, typ: 'image/jpeg' });
    liste.push({
      kapitel: i < Math.ceil(ANZAHL * 0.45) ? 0 : i < Math.ceil(ANZAHL * 0.75) ? 1 : 2,
      id, name, w: e.w, hoehe: e.h,
      aufnahme: new Date(Date.UTC(2026, 9, 1, 9, i)).toISOString(),
      r: `/b/${TOK}/r/${id}.jpg`, g: `/b/${TOK}/g/${id}.jpg`,
      handy: { pfad: `/b/${TOK}/h/${id}.jpg`, bytes: e.hf.length },
      o: { teile, bytes: e.o.length, md5: crypto.createHash('md5').update(e.o).digest('hex'), typ: e.png ? 'image/png' : 'image/jpeg' },
    });
  }
  bilder = liste;
}

function manifest() {
  const namen = ['Mittwoch · Tag', 'Mittwoch · Abend', 'Alle Fotos'];
  const leer = einstellungen.zustand === 'leer';
  const kapitel = namen.map((titel, k) => ({
    titel,
    bilder: leer ? [] : bilder.filter((b) => b.kapitel === k).map((b) => {
      // Wie im Vertrag: Höhe unter "hoehe", "h" ist die Handy-Fassung.
      // Variante "ohne-hoehe" prüft, dass die Oberfläche das Seitenverhältnis notfalls aus dem Bild nimmt.
      const basis = { id: b.id, name: b.name, w: b.w, hoehe: b.hoehe };
      if (einstellungen.variante === 'ohne-hoehe') delete basis.hoehe;
      return Object.assign(basis, { aufnahme: b.aufnahme, r: b.r, g: b.g, h: b.handy, o: b.o });
    }),
  }));
  return {
    galerie: 'test-galerie', marke: einstellungen.marke,
    titel: einstellungen.marke === 'blueprint' ? 'Blueprint Summit 2026' : 'AMBITION Circle 2026',
    ablauf: '2027-01-03T23:59:59+01:00', erstellt: new Date().toISOString(),
    anzahl: leer ? 0 : bilder.length,
    bytesOriginale: leer ? 0 : bilder.reduce((s, b) => s + b.o.bytes, 0),
    kapitel,
  };
}

function api(res, status, koerper, extra = {}) {
  const kopf = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store', ...extra };
  if (koerper === null) {
    res.writeHead(status, kopf);
    res.end();
    return;
  }
  res.writeHead(status, { ...kopf, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(koerper));
}

function koerperLesen(req) {
  return new Promise((r) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => r(s));
  });
}

function hatCookie(req) {
  return /(?:^|;\s*)eg=ok(?:;|$)/.test(req.headers.cookie || '');
}

async function apiAntworten(req, res, pfad) {
  if (einstellungen.zustand === 'fehler') return api(res, 500, { fehler: true });
  const abgelaufen = einstellungen.zustand === 'abgelaufen';
  if (pfad === '/api/status' && req.method === 'GET') {
    const m = manifest();
    return api(res, 200, { titel: m.titel, marke: m.marke, abgelaufen });
  }
  if (pfad === '/api/zugang' && req.method === 'POST') {
    const ip = req.socket.remoteAddress;
    const jetzt = Date.now();
    const liste = (fehlversuche.get(ip) || []).filter((t) => jetzt - t < 600_000);
    if (liste.length >= 5) return api(res, 429, { gebremst: true }, { 'Retry-After': String(Math.ceil((liste[0] + 600_000 - jetzt) / 1000)) });
    let code = '';
    try { code = String(JSON.parse(await koerperLesen(req)).code || '').trim().toUpperCase(); } catch { /* leer */ }
    if (code === CODE) {
      return api(res, 204, null, { 'Set-Cookie': 'eg=ok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000' });
    }
    liste.push(jetzt);
    fehlversuche.set(ip, liste);
    await new Promise((r) => setTimeout(r, 1000));
    return api(res, 401, { falsch: true });
  }
  if (pfad === '/api/manifest' && req.method === 'GET') {
    if (abgelaufen) return api(res, 410, { abgelaufen: true });
    if (!hatCookie(req)) return api(res, 401, { anmelden: true });
    return api(res, 200, manifest());
  }
  return api(res, 404, { fehler: 'unbekannt' });
}

function statisch(res, datei, typ, extra = {}) {
  fs.readFile(datei, (fehler, daten) => {
    if (fehler) {
      res.writeHead(404, { ...SICHERHEIT, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('nicht gefunden');
      return;
    }
    res.writeHead(200, { ...SICHERHEIT, 'Content-Type': typ || TYPEN[path.extname(datei)] || 'application/octet-stream', ...extra });
    res.end(daten);
  });
}

async function steuern(req, res) {
  const d = JSON.parse((await koerperLesen(req)) || '{}');
  for (const k of ['zustand', 'variante', 'marke']) if (d[k]) einstellungen[k] = d[k];
  if (d.reset) {
    fehlversuche.clear();
    Object.assign(einstellungen, { zustand: 'normal', variante: 'vertrag' });
  }
  api(res, 200, einstellungen);
}

export async function mockStarten(port = PORT) {
  await bilderErzeugen();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pfad = decodeURIComponent(url.pathname);
    try {
      if (pfad === '/__mock' && req.method === 'POST') return steuern(req, res);
      if (pfad.startsWith('/api/')) return apiAntworten(req, res, pfad);
      if (pfad.startsWith('/b/')) {
        const f = dateien.get(pfad);
        if (!f) { res.writeHead(404, SICHERHEIT); res.end(); return; }
        res.writeHead(200, { ...SICHERHEIT, 'Content-Type': f.typ, 'Content-Length': f.daten.length, 'Cache-Control': 'private, max-age=31536000, immutable' });
        res.end(f.daten);
        return;
      }
      const marke = JSON.parse(fs.readFileSync(path.join(WURZEL, 'marken', einstellungen.marke, 'marke.json'), 'utf8'));
      if (pfad === '/status.json') {
        // Wie vom Bau geschrieben; "ohne-status" prüft den Rückfall auf /api/status
        if (einstellungen.variante === 'ohne-status') { res.writeHead(404, SICHERHEIT); res.end(); return; }
        const m = manifest();
        const ablauf = einstellungen.zustand === 'abgelaufen' ? '2026-01-01T00:00:00+01:00' : m.ablauf;
        res.writeHead(200, { ...SICHERHEIT, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ titel: m.titel, marke: m.marke, ablauf }));
        return;
      }
      if (pfad === '/assets/marke.json') {
        res.writeHead(200, { ...SICHERHEIT, 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(markeOeffentlich(marke)));
        return;
      }
      if (pfad === '/assets/marke.css') {
        res.writeHead(200, { ...SICHERHEIT, 'Content-Type': 'text/css; charset=utf-8' });
        res.end(markeCss(marke));
        return;
      }
      const markeDatei = markeDateien(marke).find(([, ziel]) => `/${ziel}` === pfad);
      if (markeDatei) return statisch(res, path.join(WURZEL, 'marken', marke.id, markeDatei[0]));
      if (pfad === '/' || pfad === '/index.html') return statisch(res, path.join(VORLAGE, 'index.html'));
      if (pfad === '/sw.js') return statisch(res, path.join(VORLAGE, 'sw.js'));
      if (pfad.startsWith('/assets/')) {
        const ziel = path.join(VORLAGE, path.normalize(pfad).replace(/^\/+/, ''));
        if (!ziel.startsWith(path.join(VORLAGE, 'assets'))) { res.writeHead(403); res.end(); return; }
        return statisch(res, ziel, undefined, { 'Cache-Control': 'no-store' });
      }
      res.writeHead(404, { ...SICHERHEIT, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('nicht gefunden');
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const beginn = Date.now();
  await mockStarten();
  console.log(`Mock läuft auf http://127.0.0.1:${PORT}/#c=${CODE} (${ANZAHL} Bilder, ${Date.now() - beginn} ms)`);
}
