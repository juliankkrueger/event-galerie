// Fasst .ergebnisse/geraete/*.jsonl (aus geraete.spec.mjs) zu einer Markdown-Tabelle zusammen.
//   node matrix.mjs > .ergebnisse/geraete-matrix.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ORDNER = path.join(HIER, '.ergebnisse', 'geraete');
const zeilen = fs.existsSync(ORDNER)
  ? fs.readdirSync(ORDNER).filter((d) => d.endsWith('.jsonl')).sort()
    .flatMap((d) => fs.readFileSync(path.join(ORDNER, d), 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z)))
  : [];
const zelle = (t) => String(t ?? '').replace(/\|/g, '/');
const ausgabe = ['| Gerät (Engine) | Prüfung | Variante | erkannter Weg | Ergebnis |', '|---|---|---|---|---|'];
for (const z of zeilen) {
  ausgabe.push(`| ${zelle(z.projekt.replace(/^g-/, ''))} (${z.engine}) | ${zelle(z.pruefung)} | ${zelle(z.variante)} | ${zelle(z.weg ? `${z.weg}${z.knopf ? `, „${z.knopf}“` : ''}` : '')} | ${zelle(z.ergebnis)} |`);
}
const text = `${ausgabe.join('\n')}\n`;
fs.writeFileSync(path.join(HIER, '.ergebnisse', 'geraete-matrix.md'), text);
process.stdout.write(text);
