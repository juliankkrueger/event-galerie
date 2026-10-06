// Integration: echte Baukette (bau/bau.mjs, Quelle ordner:) + echte Function + Oberfläche.
// Baut aus synthetischen Fotos ein dist/, liefert es mit den _headers aus, leitet /api/* an
// functions/api/[[pfad]].js weiter und prüft im Browser Zugang, Raster und ZIP (md5 je Datei).
//
//   cd tests/oberflaeche && node integration.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { chromium } from '@playwright/test';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.resolve(HIER, '../..');
const ARBEIT = path.join(HIER, '.ergebnisse', 'integration');
const QUELLE = path.join(ARBEIT, 'quelle');
const DIST = path.join(ARBEIT, 'dist');
const PORT = 8791;
const MARKE = process.argv[2] || 'blueprint';

fs.rmSync(ARBEIT, { recursive: true, force: true });
const ordner = { '': 3, 'Mittwoch/Tag': 4, 'Mittwoch/Abend': 3 };
const md5Quelle = new Map();
let n = 0;
for (const [unter, anzahl] of Object.entries(ordner)) {
  const dir = path.join(QUELLE, unter);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < anzahl; i += 1) {
    n += 1;
    const hoch = n % 3 === 0;
    const w = hoch ? 1600 : 2400;
    const h = hoch ? 2400 : 1600;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#${crypto.randomBytes(3).toString('hex')}"/><text x="50%" y="50%" font-size="400" fill="#fff" text-anchor="middle">${n}</text></svg>`;
    const name = i === 0 ? 'IMG_0001.jpg' : `DSC_${1000 + n}.jpg`; // gleicher Name in allen drei Ordnern
    const daten = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).withMetadata({ exif: { IFD0: { Copyright: 'Test' } } }).toBuffer();
    fs.writeFileSync(path.join(dir, name), daten);
    md5Quelle.set(crypto.createHash('md5').update(daten).digest('hex'), `${unter}/${name}`);
  }
}

const { code, codeHash } = JSON.parse(execFileSync('node', ['bau/code-hash.mjs'], { cwd: WURZEL }).toString());
execFileSync('node', ['bau/bau.mjs', '--quelle', `ordner:${QUELLE}`, '--marke', MARKE, '--titel', 'Integrationstest 2026',
  '--galerie', 'int-1', '--ablauf', '2027-01-03T23:59:59+01:00', '--code-hash', codeHash, '--aus', DIST], { cwd: WURZEL, stdio: 'inherit' });

// _headers lesen (nur der Block /* reicht für die Prüfung der CSP)
const kopf = {};
let block = null;
for (const zeile of fs.readFileSync(path.join(DIST, '_headers'), 'utf8').split('\n')) {
  if (!zeile.startsWith(' ') && zeile.trim()) block = zeile.trim();
  else if (block === '/*' && zeile.includes(':')) {
    const [k, ...v] = zeile.trim().split(':');
    kopf[k] = v.join(':').trim();
  }
}
const funktion = await import(pathToFileURL(path.join(DIST, 'functions', 'api', '[[pfad]].js')).href);
const TYPEN = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const koerper = await new Promise((r) => { const t = []; req.on('data', (c) => t.push(c)); req.on('end', () => r(Buffer.concat(t))); });
    const anfrage = new Request(url, { method: req.method, headers: { ...req.headers, 'cf-connecting-ip': '203.0.113.7' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : koerper });
    const antwort = await funktion.onRequest({ request: anfrage, env: {}, params: { pfad: url.pathname.slice(5).split('/') }, waitUntil() {}, next() {} });
    const h = {};
    antwort.headers.forEach((v, k) => { h[k] = v; });
    // Secure-Cookie über http://localhost: Chromium akzeptiert es für localhost
    res.writeHead(antwort.status, h);
    res.end(Buffer.from(await antwort.arrayBuffer()));
    return;
  }
  let datei = path.join(DIST, path.normalize(url.pathname));
  if (url.pathname === '/') datei = path.join(DIST, 'index.html');
  if (!datei.startsWith(DIST) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()) {
    res.writeHead(404, kopf);
    res.end();
    return;
  }
  res.writeHead(200, { ...kopf, 'Content-Type': TYPEN[path.extname(datei)] || 'application/octet-stream' });
  fs.createReadStream(datei).pipe(res);
});
await new Promise((r) => server.listen(PORT, 'localhost', r));

const browser = await chromium.launch();
const fehler = [];
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 401/.test(m.text())) fehler.push(m.text()); });
  page.on('pageerror', (e) => fehler.push(e.message));
  page.on('request', (r) => { const u = new URL(r.url()); if (!['blob:', 'data:'].includes(u.protocol) && u.hostname !== 'localhost') fehler.push(`fremd: ${r.url()}`); });
  await page.addInitScript(() => {
    window.showSaveFilePicker = async () => {
      const teile = [];
      return { createWritable: async () => new WritableStream({ write(c) { teile.push(new Uint8Array(c)); }, close() { window.__zip = new Blob(teile); } }) };
    };
  });
  await page.goto(`http://localhost:${PORT}/#c=${code.toLowerCase()}`);
  await page.waitForSelector('#galerie:not([hidden])', { timeout: 20_000 });
  const kacheln = await page.locator('.kachel').count();
  const kapitel = await page.locator('.kapitel-titel').allTextContents();
  await page.screenshot({ path: path.join(HIER, 'screens', `integration-${MARKE}.png`) });
  await page.click('#alle-knopf');
  await page.click('#aktion-knopf');
  await page.waitForFunction(() => window.__zip, null, { timeout: 30_000 });
  const b64 = await page.evaluate(async () => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(window.__zip); }));
  const zip = path.join(ARBEIT, 'alle.zip');
  fs.writeFileSync(zip, Buffer.from(b64, 'base64'));
  const inhalt = JSON.parse(execFileSync('python3', ['-c', 'import zipfile,hashlib,json,sys\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({i.filename: hashlib.md5(z.read(i)).hexdigest() for i in z.infolist()}))', zip]).toString());
  const namen = Object.keys(inhalt);
  const md5Treffer = Object.values(inhalt).filter((m) => md5Quelle.has(m)).length;
  console.log(JSON.stringify({ marke: MARKE, kacheln, kapitel, zipDateien: namen.length, md5Treffer, quelle: md5Quelle.size, namen, fehler }, null, 1));
  ok = kacheln === md5Quelle.size && md5Treffer === md5Quelle.size && namen.length === md5Quelle.size
    && namen.includes('IMG_0001 (2).jpg') && namen.includes('IMG_0001 (3).jpg') && fehler.length === 0;
} finally {
  await browser.close();
  server.close();
}
console.log(ok ? 'INTEGRATION OK' : 'INTEGRATION FEHLGESCHLAGEN');
process.exitCode = ok ? 0 : 1;
