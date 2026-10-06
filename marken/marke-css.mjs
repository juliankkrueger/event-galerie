// Erzeugt assets/marke.css aus marken/<id>/marke.json und nennt die Dateien,
// die der Bau aus marken/<id>/ ins Deployment kopiert.
// Benutzung im Bau:
//   import { markeCss, markeDateien } from '../marken/marke-css.mjs';
//   fs.writeFileSync('dist/assets/marke.css', markeCss(marke));
//   for (const [quelle, ziel] of markeDateien(marke)) fs.copyFileSync(`marken/${marke.id}/${quelle}`, `dist/${ziel}`);

const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Feinabstimmung je Titelschrift: Unbounded ist breit und kräftig, Italiana zart und schmal.
// Unbounded und Italiana liegen in vorlage/assets/schriften (app.css). Schriften mit "dateien"
// liegen in marken/schriften/ (SIL OFL) und kommen nur mit der Marke ins Deployment, die sie
// nutzt; das @font-face dafür steht in assets/marke.css.
const TITEL = {
  Unbounded: { stapel: `"Unbounded", ${SYSTEM}`, gewicht: 500, faktor: 0.82, laufweite: '-0.01em' },
  Italiana: { stapel: '"Italiana", "Didot", Georgia, serif', gewicht: 400, faktor: 1.18, laufweite: '0.02em' },
  'Cormorant Garamond': {
    stapel: '"Cormorant Garamond", Garamond, "Times New Roman", serif', gewicht: 600, faktor: 1.12, laufweite: '0.005em',
    dateien: { 500: 'cormorant-garamond-latin-500-normal.woff2', 600: 'cormorant-garamond-latin-600-normal.woff2' },
    lizenz: 'OFL-CormorantGaramond.txt',
  },
};

// Optionaler Block "hintergrund" in marke.json: Bilddateien aus marken/<id>/, die der Bau nach
// /assets/marke/ kopiert (zusammen mit allen anderen Bilddateien des Markenordners, damit
// Varianten mit anderer Endung oder Größe mitkommen).
export const HINTERGRUND_SCHLUESSEL = ['kopf', 'hoch', 'muster'];

// Varianten einer Hintergrunddatei im Markenordner: gleicher Stamm, Größenzusatz -<px>, andere
// Endung. Aus "hintergrund-kopf-2560.webp" und den Dateien hintergrund-kopf-{900,1600,2560}.{webp,jpg}
// werden "klein" (kleinstes WebP, wenn es kleiner als die Hauptdatei ist) und "jpg" (JPEG gleicher
// Größe, sonst das größte JPEG). Ohne Dateiliste gibt es keine Varianten.
export function hintergrundVarianten(datei, dateien = []) {
  const m = /^(.*?)(?:-(\d{2,5}))?\.([a-z0-9]+)$/i.exec(datei);
  if (!m) return {};
  const [, stamm, groesse, endung] = m;
  const varianten = [];
  for (const d of dateien) {
    const v = /^(.*?)(?:-(\d{2,5}))?\.([a-z0-9]+)$/i.exec(d);
    if (v && v[1] === stamm && d !== datei) varianten.push({ datei: d, px: Number(v[2] || 0), endung: v[3].toLowerCase() });
  }
  const ergebnis = {};
  const webp = varianten.filter((v) => v.endung === 'webp' && groesse && v.px > 0 && v.px < Number(groesse)).sort((a, b) => a.px - b.px);
  if (endung.toLowerCase() === 'webp' && webp.length) ergebnis.klein = webp[0].datei;
  const jpg = varianten.filter((v) => v.endung === 'jpg' || v.endung === 'jpeg').sort((a, b) => b.px - a.px);
  const gleich = jpg.find((v) => groesse && v.px === Number(groesse));
  if (gleich || jpg.length) ergebnis.jpg = (gleich || jpg[0]).datei;
  return ergebnis;
}
export const DATEI = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const TEXT = {
  'Open Sans': `"Open Sans", ${SYSTEM}`,
  'system-ui': SYSTEM,
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const FARBEN = {
  grund: '--grund', flaeche: '--flaeche', text: '--text', textLeise: '--text-leise',
  akzent: '--akzent', akzentText: '--akzent-text', rahmen: '--rahmen',
};

// Optionaler Block "stil" in marke.json: Knöpfe und Titel wie auf der Event-Seite.
// Nur geprüfte Werte gelangen ins CSS (kein freier CSS-Text aus der Markendatei).
const LAUFWEITE = /^(0|0?\.\d{1,3}em|[1-3]px)$/;
const GEWICHTE = new Set([200, 400, 500, 600]);
const ECKEN = { rund: '999px', weich: '6px', eckig: '0' };

function verlauf(liste, feld) {
  if (!Array.isArray(liste) || liste.length < 2 || liste.length > 4 || !liste.every((f) => HEX.test(f))) {
    throw new Error(`marke.json: stil.${feld} muss 2 bis 4 Farben #RRGGBB haben`);
  }
  const schritt = 100 / (liste.length - 1);
  return `linear-gradient(135deg, ${liste.map((f, i) => `${f} ${Math.round(i * schritt)}%`).join(', ')})`;
}

export function stilCss(stil = {}) {
  const zeilen = [];
  const regeln = [];
  if (stil == null || typeof stil !== 'object') throw new Error('marke.json: stil muss ein Objekt sein');
  const bekannt = new Set(['knopfEcken', 'knopfVersal', 'knopfLaufweite', 'knopfGewicht', 'knopfVerlauf', 'titelVersal', 'titelGewicht', 'titelVerlauf']);
  for (const k of Object.keys(stil)) if (!bekannt.has(k)) throw new Error(`marke.json: stil.${k} ist unbekannt`);
  if (stil.knopfEcken !== undefined) {
    if (!(stil.knopfEcken in ECKEN)) throw new Error('marke.json: stil.knopfEcken muss rund, weich oder eckig sein');
    zeilen.push(`  --rund: ${ECKEN[stil.knopfEcken]};`);
  }
  if (stil.knopfVersal !== undefined) zeilen.push(`  --knopf-schreibung: ${stil.knopfVersal === true ? 'uppercase' : 'none'};`);
  if (stil.knopfLaufweite !== undefined) {
    if (!LAUFWEITE.test(String(stil.knopfLaufweite))) throw new Error('marke.json: stil.knopfLaufweite ungültig (z. B. 0.06em oder 1px)');
    zeilen.push(`  --knopf-laufweite: ${stil.knopfLaufweite};`);
  }
  if (stil.knopfGewicht !== undefined) {
    if (!GEWICHTE.has(stil.knopfGewicht)) throw new Error('marke.json: stil.knopfGewicht muss 200, 400, 500 oder 600 sein');
    zeilen.push(`  --knopf-gewicht: ${stil.knopfGewicht};`);
  }
  if (stil.knopfVerlauf !== undefined) zeilen.push(`  --knopf-verlauf: ${verlauf(stil.knopfVerlauf, 'knopfVerlauf')};`);
  if (stil.titelVersal !== undefined) zeilen.push(`  --titel-schreibung: ${stil.titelVersal === true ? 'uppercase' : 'none'};`);
  if (stil.titelGewicht !== undefined) {
    if (!GEWICHTE.has(stil.titelGewicht)) throw new Error('marke.json: stil.titelGewicht muss 200, 400, 500 oder 600 sein');
    zeilen.push(`  --titel-gewicht: ${stil.titelGewicht};`);
  }
  if (stil.titelVerlauf !== undefined) {
    regeln.push(`:root .galerie-titel,\n:root .zustand-titel {\n  background-image: ${verlauf(stil.titelVerlauf, 'titelVerlauf')};\n  -webkit-background-clip: text;\n  background-clip: text;\n  -webkit-text-fill-color: transparent;\n  color: transparent;\n}\n@media (forced-colors: active) {\n  :root .galerie-titel,\n  :root .zustand-titel {\n    background-image: none;\n    -webkit-text-fill-color: CanvasText;\n    color: CanvasText;\n  }\n}\n`);
  }
  return { zeilen, regeln };
}

// dateien: Dateinamen im Markenordner (für die Hintergrund-Varianten), optional.
export function markeCss(marke, { dateien = [] } = {}) {
  const zeilen = [];
  for (const [schluessel, variable] of Object.entries(FARBEN)) {
    const wert = marke.farben?.[schluessel];
    if (!HEX.test(wert || '')) throw new Error(`marke.json: farben.${schluessel} fehlt oder ist kein #RRGGBB`);
    zeilen.push(`  ${variable}: ${wert};`);
  }
  const titel = TITEL[marke.schriften?.titel];
  const text = TEXT[marke.schriften?.text];
  if (!titel) throw new Error(`marke.json: Titelschrift "${marke.schriften?.titel}" ist nicht bekannt (vorlage/assets/schriften, marken/schriften)`);
  if (!text) throw new Error(`marke.json: Textschrift "${marke.schriften?.text}" ist nicht in vorlage/assets/schriften`);
  zeilen.push(`  --schrift-titel: ${titel.stapel};`);
  zeilen.push(`  --schrift-text: ${text};`);
  zeilen.push(`  --titel-gewicht: ${titel.gewicht};`);
  zeilen.push(`  --titel-faktor: ${titel.faktor};`);
  zeilen.push(`  --titel-laufweite: ${titel.laufweite};`);
  if (marke.hintergrund !== undefined) {
    const hg = marke.hintergrund;
    if (!hg || typeof hg !== 'object' || Array.isArray(hg)) throw new Error('marke.json: hintergrund muss ein Objekt sein');
    for (const [k, v] of Object.entries(hg)) {
      if (!HINTERGRUND_SCHLUESSEL.includes(k)) throw new Error(`marke.json: hintergrund.${k} ist unbekannt`);
      if (!DATEI.test(v || '')) throw new Error(`marke.json: hintergrund.${k} ist kein gültiger Dateiname`);
      zeilen.push(`  --hintergrund-${k}: url("/assets/marke/${v}");`);
      for (const [art, d] of Object.entries(hintergrundVarianten(v, dateien))) {
        if (DATEI.test(d)) zeilen.push(`  --hintergrund-${k}-${art}: url("/assets/marke/${d}");`);
      }
    }
  }
  const stil = stilCss(marke.stil);
  zeilen.push(...stil.zeilen);
  const schriften = Object.entries(titel.dateien || {}).map(([gewicht, datei]) =>
    `@font-face {\n  font-family: "${marke.schriften.titel}";\n  font-style: normal;\n  font-weight: ${gewicht};\n  font-display: swap;\n  src: url("/assets/schriften/${datei}") format("woff2");\n}\n`);
  return `/* erzeugt aus marken/${marke.id}/marke.json */\n${schriften.join('')}:root {\n${zeilen.join('\n')}\n}\n${stil.regeln.join('')}`;
}

// [Quelldatei relativ zu marken/<id>/, Zielpfad im Deployment]
export function markeDateien(marke) {
  const titel = TITEL[marke.schriften?.titel] || {};
  return [
    [marke.logo, 'assets/logo.png'],
    [marke.favicon.ico, 'favicon.ico'],
    [marke.favicon.apple, 'apple-touch-icon.png'],
    [marke.favicon.png32, 'assets/favicon-32.png'],
    [marke.favicon.png192, 'assets/favicon-192.png'],
    ...Object.values(titel.dateien || {}).map((d) => [`../schriften/${d}`, `assets/schriften/${d}`]),
    ...(titel.lizenz ? [[`../schriften/${titel.lizenz}`, `assets/schriften/${titel.lizenz}`]] : []),
  ];
}
