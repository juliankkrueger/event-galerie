// Erzeugt assets/marke.css aus marken/<id>/marke.json und nennt die Dateien,
// die der Bau aus marken/<id>/ ins Deployment kopiert.
// Benutzung im Bau:
//   import { markeCss, markeDateien } from '../marken/marke-css.mjs';
//   fs.writeFileSync('dist/assets/marke.css', markeCss(marke));
//   for (const [quelle, ziel] of markeDateien(marke)) fs.copyFileSync(`marken/${marke.id}/${quelle}`, `dist/${ziel}`);

const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Feinabstimmung je Titelschrift: Unbounded ist breit und kräftig, Italiana zart und schmal.
const TITEL = {
  Unbounded: { stapel: `"Unbounded", ${SYSTEM}`, gewicht: 500, faktor: 0.82, laufweite: '-0.01em' },
  Italiana: { stapel: '"Italiana", "Didot", Georgia, serif', gewicht: 400, faktor: 1.18, laufweite: '0.02em' },
};
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

export function markeCss(marke) {
  const zeilen = [];
  for (const [schluessel, variable] of Object.entries(FARBEN)) {
    const wert = marke.farben?.[schluessel];
    if (!HEX.test(wert || '')) throw new Error(`marke.json: farben.${schluessel} fehlt oder ist kein #RRGGBB`);
    zeilen.push(`  ${variable}: ${wert};`);
  }
  const titel = TITEL[marke.schriften?.titel];
  const text = TEXT[marke.schriften?.text];
  if (!titel) throw new Error(`marke.json: Titelschrift "${marke.schriften?.titel}" ist nicht in vorlage/assets/schriften`);
  if (!text) throw new Error(`marke.json: Textschrift "${marke.schriften?.text}" ist nicht in vorlage/assets/schriften`);
  zeilen.push(`  --schrift-titel: ${titel.stapel};`);
  zeilen.push(`  --schrift-text: ${text};`);
  zeilen.push(`  --titel-gewicht: ${titel.gewicht};`);
  zeilen.push(`  --titel-faktor: ${titel.faktor};`);
  zeilen.push(`  --titel-laufweite: ${titel.laufweite};`);
  const stil = stilCss(marke.stil);
  zeilen.push(...stil.zeilen);
  return `/* erzeugt aus marken/${marke.id}/marke.json */\n:root {\n${zeilen.join('\n')}\n}\n${stil.regeln.join('')}`;
}

// [Quelldatei in marken/<id>/, Zielpfad im Deployment]
export function markeDateien(marke) {
  return [
    [marke.logo, 'assets/logo.png'],
    [marke.favicon.ico, 'favicon.ico'],
    [marke.favicon.apple, 'apple-touch-icon.png'],
    [marke.favicon.png32, 'assets/favicon-32.png'],
    [marke.favicon.png192, 'assets/favicon-192.png'],
  ];
}
