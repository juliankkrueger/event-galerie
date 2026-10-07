// Erzeugt die AMBITION-Dekorelemente für die Galerie aus den Originaldateien der Agentur
// (Logo-SVG, Olivenzweige, Leinen und Blattschatten des Willkommens-Posters).
//
//   node bau/praegung/ambition-dekor.mjs --logo <logo-ambition.svg> --poster <…/Ambition_Willkommen_LivingPoster/src> --aus marken/ambition
//
// Ergebnis: lockup-kupfer.svg, lockup-oliv.svg, zweig-1.webp, zweig-2.webp,
// band-leinen.webp, band-schatten.webp, korn.png
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";

const { values: a } = parseArgs({ options: { logo: { type: "string" }, poster: { type: "string" }, aus: { type: "string" } } });
if (!a.logo || !a.poster || !a.aus) { console.error("--logo, --poster und --aus angeben"); process.exit(2); }
const kb = (f) => `${Math.round(fs.statSync(f).size / 1024)} KB`;
const ziel = (n) => path.join(a.aus, n);

// 1) Logo-Lockup als SVG: Kupfer (Original-Verlauf, helle Schrift) und Oliv (einfarbig, für das Salbei-Band)
const svg = fs.readFileSync(a.logo, "utf8");
const ohneKontur = svg.replace(/stroke:\s*#1d1d1b;/g, "stroke: none;").replace(/stroke-width:\s*5px;/g, "");
fs.writeFileSync(ziel("lockup-kupfer.svg"), ohneKontur.replace(/fill:\s*#1d1d1b;/g, "fill: #d9b39b;"));
const oliv = "#4b5242";
fs.writeFileSync(ziel("lockup-oliv.svg"),
  ohneKontur.replace(/fill:\s*#1d1d1b;/g, `fill: ${oliv};`).replace(/fill:\s*url\([^)]*\);/g, `fill: ${oliv};`).replace(/stop-color="#[0-9a-f]{6}"/gi, `stop-color="${oliv}"`));
console.log("lockup-kupfer.svg", kb(ziel("lockup-kupfer.svg")), "lockup-oliv.svg", kb(ziel("lockup-oliv.svg")));

// 2) Olivenzweige (Strichzeichnung aus dem Poster), freigestellt mit Alpha
const zweige = path.join(a.poster, "el_zweige.png");
for (const [n, r] of [["zweig-1", { left: 0, top: 83, width: 816, height: 788 }], ["zweig-2", { left: 1276, top: 2688, width: 884, height: 988 }]]) {
  await sharp(zweige).extract(r).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(ziel(`${n}.webp`));
  console.log(`${n}.webp`, kb(ziel(`${n}.webp`)));
}

// 3) Leinenpapier für das Salbei-Band (Querstreifen aus der Postertextur)
await sharp(path.join(a.poster, "tex_leinen.png"), { limitInputPixels: false })
  .extract({ left: 0, top: 1300, width: 2160, height: 1215 })
  .webp({ quality: 74, effort: 6 }).toFile(ziel("band-leinen.webp"));
console.log("band-leinen.webp", kb(ziel("band-leinen.webp")));

// 4) Blattschatten (weich, darf klein sein)
await sharp(path.join(a.poster, "schatten_zweig_1.png"), { limitInputPixels: false })
  .resize({ width: 1600 }).webp({ quality: 80, alphaQuality: 90, effort: 6 }).toFile(ziel("band-schatten.webp"));
console.log("band-schatten.webp", kb(ziel("band-schatten.webp")));

// 5) Papierkorn: nahtlose Rauschkachel (reines Pixelrauschen hat keine Nähte)
{
  const w = 240, h = 240, buf = Buffer.alloc(w * h * 2); let s = 12345;
  for (let i = 0; i < w * h; i++) { s = (s * 1664525 + 1013904223) >>> 0; const v = s >>> 24; buf[i * 2] = v > 127 ? 255 : 0; buf[i * 2 + 1] = Math.round(Math.abs(v - 127) * 0.5); }
  await sharp(buf, { raw: { width: w, height: h, channels: 2 } }).png({ compressionLevel: 9 }).toFile(ziel("korn.png"));
  console.log("korn.png", kb(ziel("korn.png")));
}
