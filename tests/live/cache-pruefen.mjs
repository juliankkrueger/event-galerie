// Ruft Fotopfade eines Manifests ab (je zweimal) und zeigt, ob der Edge-Cache sie hält.
//   node tests/live/cache-pruefen.mjs --basis https://<projekt>.pages.dev --manifest <datei> [--anzahl 4] [--ab 0]
// Für ein ALTES Manifest (ersetztes Deployment) erwartet: kein Foto mehr, sondern die Startseite
// als Rückfall (200 text/html) und nie cf-cache-status HIT.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { basis: { type: 'string' }, manifest: { type: 'string' }, anzahl: { type: 'string' }, ab: { type: 'string' } }, strict: true });
const basis = new URL(values.basis).origin;
const man = JSON.parse(fs.readFileSync(values.manifest, 'utf8'));
const ab = Number(values.ab || 0);
const bilder = man.kapitel.flatMap((k) => k.bilder).slice(ab, ab + Number(values.anzahl || 4));
const zeilen = [];
for (const b of bilder) {
  for (const [art, p] of [['r', b.r], ['g', b.g], ['h', b.h.pfad], ['o', b.o.teile[0]]]) {
    for (const lauf of [1, 2]) {
      const r = await fetch(`${basis}${p}`);
      const buf = Buffer.from(await r.arrayBuffer());
      zeilen.push({
        art, lauf, status: r.status, bytes: buf.length,
        typ: r.headers.get('content-type'),
        cache: r.headers.get('cf-cache-status'), age: r.headers.get('age'),
        cc: r.headers.get('cache-control'),
        md5ok: art === 'o' && b.o.teile.length === 1 ? createHash('md5').update(buf).digest('hex') === b.o.md5 : null,
      });
    }
  }
}
const zaehle = (f) => zeilen.reduce((z, x) => ((z[f(x)] = (z[f(x)] || 0) + 1), z), {});
console.log(JSON.stringify({ basis, galerie: man.galerie, abrufe: zeilen.length, status: zaehle((x) => `${x.status} ${x.typ}`), cfCache: zaehle((x) => x.cache ?? 'kein'), cacheControl: zaehle((x) => x.cc ?? 'kein'), fotoGeliefert: zeilen.filter((x) => /image|octet/.test(x.typ || '')).length }));
