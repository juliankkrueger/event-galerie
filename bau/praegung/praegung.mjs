// Rendert eine scharfe Papier-Prägung aus einem Vektor-Logo (Höhenkarte + Licht von links oben).
// Ergebnis ersetzt hochskalierte Mockup-Fotos: gestochen scharf in jeder Auflösung.
//
//   node bau/praegung/praegung.mjs --teile <ordner> --muster "v-a-*,v-blatt-*,v-ring-*" \
//     --aus marken/ambition --grund "#1d373b" --grund-mitte "#244a57"
//
// Erzeugt hintergrund-kopf-{breit,hoch}-{3840|1600,...}.webp und hintergrund-muster-kachel.webp.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";

const { values: a } = parseArgs({
  options: {
    teile: { type: "string" },
    muster: { type: "string", default: "v-a-*,v-blatt-*,v-ring-*" },
    aus: { type: "string" },
    grund: { type: "string", default: "#1d373b" },
    "grund-mitte": { type: "string", default: "#244a57" },
  },
});
if (!a.teile || !a.aus) { console.error("--teile und --aus angeben"); process.exit(2); }

const glob = (name) => a.muster.split(",").some((m) => new RegExp("^" + m.trim().replace(/\./g, "\\.").replace(/\*/g, ".*") + "$").test(name));
const dateien = fs.readdirSync(a.teile).filter((f) => f.endsWith(".svg") && glob(f)).sort();
if (!dateien.length) { console.error("keine Teile gefunden"); process.exit(1); }
const pfade = dateien.flatMap((f) => [...fs.readFileSync(path.join(a.teile, f), "utf8").matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]));
const VB = { w: 3481.77, h: 3086.46 };
console.log(`${dateien.length} Teile, ${pfade.length} Pfade`);

// Begrenzungsrahmen des Medaillons aus den Pfadkoordinaten (grob, reicht für Zentrierung).
const zahlen = pfade.join(" ").match(/-?\d+(\.\d+)?/g).map(Number);
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (let i = 0; i + 1 < zahlen.length; i += 2) {
  const x = zahlen[i], y = zahlen[i + 1];
  if (x < 0 || y < 0 || x > VB.w || y > VB.h) continue;
  x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
}
const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };

// Maske des Medaillons: weiß auf schwarz, Durchmesser d, mittig in einem Feld der Größe w x h an (cx, cy).
async function maske(w, h, d, cx, cy) {
  const s = d / Math.max(box.w, box.h);
  const tx = cx - (box.x + box.w / 2) * s, ty = cy - (box.y + box.h / 2) * s;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="100%" height="100%" fill="#000"/>
    <g transform="translate(${tx} ${ty}) scale(${s})" fill="#fff">${pfade.map((d) => `<path d="${d}"/>`).join("")}</g></svg>`;
  return sharp(Buffer.from(svg), { limitInputPixels: false }).greyscale().raw().toBuffer({ resolveWithObject: true });
}

function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

// Gaußfilter (separabel) auf Float32-Feld.
function blur(src, w, h, sigma) {
  const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
  let s = 0; for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let i = -r; i <= r; i++) { const xx = Math.min(w - 1, Math.max(0, x + i)); v += src[y * w + xx] * k[i + r]; } tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let i = -r; i <= r; i++) { const yy = Math.min(h - 1, Math.max(0, y + i)); v += tmp[yy * w + x] * k[i + r]; } out[y * w + x] = v;
  }
  return out;
}

// Deterministisches Rauschen (für Papierfaser), unabhängig von Math.random-Saat.
function rauschen(w, h, saat = 7) {
  const out = new Float32Array(w * h); let s = saat >>> 0;
  for (let i = 0; i < out.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; out[i] = s / 4294967296 - 0.5; }
  return out;
}

// Rendert Papier mit Prägung. d = Medaillon-Durchmesser in px, Mittelpunkt (cx, cy).
async function papier(w, h, d, cx, cy, { tiefe = 1, korn = 1, flach = false } = {}) {
  const { data: m } = await maske(w, h, d, cx, cy);
  const n = w * h, f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = m[i] / 255;
  const ein = d / 1000;                                    // Maßstab: Bevel skaliert mit dem Medaillon
  // Höhenkarte aus zwei Maßstäben: scharfe Kante (klein) plus kurze, weiche Schulter (mittel)
  const kante = blur(f, w, h, Math.max(0.6, 0.55 * ein));
  const schulter = blur(f, w, h, Math.max(1.0, 1.6 * ein));
  const hoehe = new Float32Array(n);
  for (let i = 0; i < n; i++) hoehe[i] = 0.62 * kante[i] + 0.38 * schulter[i];
  const weit = blur(f, w, h, Math.max(2, 6 * ein));        // breiter Schatten / Aufwölbung
  const fein = blur(rauschen(w, h), w, h, 0.55);             // Papierfaser
  const grob = blur(rauschen(w, h, 99), w, h, 6);           // Wolkigkeit im Karton
  const g0 = hex(a.grund), g1 = hex(a["grund-mitte"]);
  const out = Buffer.alloc(n * 3);
  const lx = -0.62, ly = -0.78;                             // Licht von links oben
  const diag = Math.hypot(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Grundverlauf: hell in der Mitte des Medaillons, Ränder dunkler (wie im Brand Kit)
      const r = Math.min(1, Math.hypot(x - cx, y - cy) / (diag * 0.62));
      const t = flach ? 0.55 : r * r;
      let R = g1[0] + (g0[0] - g1[0]) * t, G = g1[1] + (g0[1] - g1[1]) * t, B = g1[2] + (g0[2] - g1[2]) * t;
      // Normale aus Höhenkarte
      const xm = x > 0 ? hoehe[i - 1] : hoehe[i], xp = x < w - 1 ? hoehe[i + 1] : hoehe[i];
      const ym = y > 0 ? hoehe[i - w] : hoehe[i], yp = y < h - 1 ? hoehe[i + w] : hoehe[i];
      const dx = (xp - xm) * 0.5, dy = (yp - ym) * 0.5;
      const steil = 0.9 * ein * tiefe;
      const nx = -dx * steil * 40, ny = -dy * steil * 40, nz = 1;
      const nl = Math.hypot(nx, ny, nz);
      const licht = (nx * -lx + ny * -ly) / nl;              // >0 zum Licht geneigt
      // Weiter Schatten unten rechts der Prägung, leichte Aufhellung der Fläche
      const wx = x > 2 && x < w - 3 ? weit[i + 2] - weit[i - 2] : 0;
      const wy = y > 2 && y < h - 3 ? weit[i + 2 * w] - weit[i - 2 * w] : 0;
      const breit = (-wx * lx - wy * ly) * 9;
      let k = 1 + licht * 0.34 + breit * 0.10 - hoehe[i] * 0.015;
      // Kanten der Prägung minimal glänzend, Tal dunkler
      k += Math.max(0, licht) ** 2 * 0.12;
      const faser = 1 + (fein[i] * 0.24 + grob[i] * 1.1) * korn;
      R = R * k * faser; G = G * k * faser; B = B * k * faser;
      out[i * 3] = Math.max(0, Math.min(255, R));
      out[i * 3 + 1] = Math.max(0, Math.min(255, G));
      out[i * 3 + 2] = Math.max(0, Math.min(255, B));
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 3 } });
}

async function speichern(bild, name, q = 86) {
  const ziel = path.join(a.aus, name);
  await bild.clone().webp({ quality: q, effort: 6, smartSubsample: true }).toFile(ziel + ".webp");
  await bild.clone().jpeg({ quality: 86, mozjpeg: true, progressive: true }).toFile(ziel + ".jpg");
  const kb = (f) => Math.round(fs.statSync(f).size / 1024);
  console.log(`${name}: webp ${kb(ziel + ".webp")} KB, jpg ${kb(ziel + ".jpg")} KB`);
}

fs.mkdirSync(a.aus, { recursive: true });
const t0 = Date.now();
// Breit (Desktop): Medaillon rechts, leicht angeschnitten wie im Brand Kit
{
  const w = 3840, h = 2160;
  const b = await papier(w, h, 2900, 2960, 980);
  await speichern(b, "hintergrund-kopf-breit-3840");
  await speichern(b.clone().resize(1920), "hintergrund-kopf-breit-1920");
}
// Hoch (Handy): Medaillon oben rechts angeschnitten, unten viel ruhige Fläche für Titel
{
  const w = 1290, h = 2400;
  const b = await papier(w, h, 1500, 1010, 560);
  await speichern(b, "hintergrund-kopf-hoch-1290");
  await speichern(b.clone().resize(860), "hintergrund-kopf-hoch-860");
}
// Muster-Kachel: kleines geprägtes Medaillon, nahtlos kachelbar (Medaillon mittig mit Rand)
{
  const w = 640, h = 640;
  const b = await papier(w, h, 300, 320, 320, { tiefe: 0.55, korn: 0.6, flach: true });
  await speichern(b, "hintergrund-muster-kachel", 80);
}
console.log(`fertig in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
