// Meldet sich mit dem Testcode an und speichert das Manifest. Gibt nie Code oder Cookie aus.
//   node tests/live/manifest-holen.mjs --basis https://<hash>.<projekt>.pages.dev --aus <datei>
import fs from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { basis: { type: 'string' }, aus: { type: 'string' }, 'code-datei': { type: 'string' } }, strict: true });
const basis = new URL(values.basis).origin;
const code = fs.readFileSync(values['code-datei'] || new URL('../.testcode', import.meta.url), 'utf8').trim();
const z = await fetch(`${basis}/api/zugang`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
const keks = (z.headers.get('set-cookie') || '').split(';')[0];
const m = await fetch(`${basis}/api/manifest`, { headers: { Cookie: keks } });
const ergebnis = { basis, zugang: z.status, manifest: m.status };
if (m.ok) {
  const man = await m.json();
  fs.writeFileSync(values.aus, JSON.stringify(man));
  Object.assign(ergebnis, { galerie: man.galerie, anzahl: man.anzahl, tok: man.kapitel[0].bilder[0].r.split('/')[2].slice(0, 6) + '…' });
}
console.log(JSON.stringify(ergebnis));
