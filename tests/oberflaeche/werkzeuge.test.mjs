// Unit-Tests der reinen Hilfsfunktionen (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as w from '../../vorlage/assets/werkzeuge.js';

test('Code aus Hash, getrimmt und großgeschrieben', () => {
  assert.equal(w.codeAusHash('#c=gast2345'), 'GAST2345');
  assert.equal(w.codeAusHash('#c=%20ab cd2345 '), 'ABCD2345');
  assert.equal(w.codeAusHash(''), null);
  assert.equal(w.codeAusHash('#kapitel-2'), null);
  assert.equal(w.codeFormGueltig('GAST2345'), true);
  assert.equal(w.codeFormGueltig('GAST2340'), false); // 0 nicht im Alphabet
  assert.equal(w.codeFormGueltig('GAST234'), false);
});

test('Namen eindeutig: name (2).jpg, ohne Groß/Klein', () => {
  const v = w.namensVergeber();
  assert.deepEqual(['IMG_0001.jpg', 'IMG_0001.jpg', 'img_0001.JPG', 'IMG_0001 (2).jpg', 'a/b.jpg', 'ohne'].map(v),
    ['IMG_0001.jpg', 'IMG_0001 (2).jpg', 'img_0001 (3).JPG', 'IMG_0001 (2) (2).jpg', 'a_b.jpg', 'ohne']);
});

test('Pakete: höchstens 10 Dateien und unter 45 MB', () => {
  const bild = (mb) => ({ h: { pfad: '/x', bytes: mb * 1e6 } });
  const p1 = w.paketeBilden(Array.from({ length: 23 }, () => bild(1)));
  assert.deepEqual(p1.map((p) => p.bilder.length), [10, 10, 3]);
  const p2 = w.paketeBilden(Array.from({ length: 12 }, () => bild(4)));
  assert.deepEqual(p2.map((p) => p.bilder.length), [10, 2]);
  const p3 = w.paketeBilden(Array.from({ length: 12 }, () => bild(5)));
  assert.ok(p3.every((p) => p.bytes < 45e6), 'jedes Paket unter 45 MB');
  assert.deepEqual(p3.map((p) => p.bilder.length), [8, 4]);
  // Handy-Fassung unter "handy" (Vorschlag) wird ebenso gelesen
  const p4 = w.paketeBilden(Array.from({ length: 3 }, () => ({ handy: { pfad: '/x', bytes: 30e6 } })));
  assert.deepEqual(p4.map((p) => p.bilder.length), [1, 1, 1]);
});

test('ZIP-Teile: höchstens 200 Bilder und ca. 2 GB', () => {
  const bild = (mb) => ({ o: { bytes: mb * 1e6 } });
  const t1 = w.zipTeileBilden(Array.from({ length: 450 }, () => bild(1)));
  assert.deepEqual(t1.map((t) => t.bilder.length), [200, 200, 50]);
  const t2 = w.zipTeileBilden(Array.from({ length: 150 }, () => bild(30)));
  assert.ok(t2.every((t) => t.bytes <= 2e9));
  assert.deepEqual(t2.map((t) => t.bilder.length), [66, 66, 18]);
  const t3 = w.zipTeileBilden(Array.from({ length: 30 }, () => bild(30)), w.ZIP_MAX_BYTES_SPEICHER);
  assert.ok(t3.every((t) => t.bytes <= 5e8));
});

test('Manifest mit doppeltem "h": Höhe und Handy-Fassung', () => {
  assert.equal(w.bildHoehe({ w: 6000, h: 4000 }), 4000);
  assert.equal(w.bildHoehe({ w: 6000, h: { pfad: '/x', bytes: 1 } }), null);
  assert.equal(w.seitenverhaeltnis({ w: 6000, h: 4000 }), 1.5);
  assert.equal(w.bildHandy({ h: { pfad: '/x', bytes: 2 } }).bytes, 2);
  assert.equal(w.bildHandy({ h: 4000, handy: { pfad: '/y', bytes: 3 } }).bytes, 3);
});

test('Formatierung deutsch', () => {
  assert.equal(w.groesse(1_840_000), '1,8 MB');
  assert.equal(w.groesse(2_300_000_000), '2,3 GB');
  assert.equal(w.fotos(1), '1 Foto');
  assert.equal(w.fotos(1200), '1.200 Fotos');
  assert.equal(w.datumLang('2027-01-03T23:59:59+01:00'), '3. Januar 2027');
  assert.equal(w.wartezeitText(600), '10 Minuten');
  assert.equal(w.wartezeitText(45), '45 Sekunden');
  assert.equal(w.retryAfterSekunden('600'), 600);
  assert.equal(w.retryAfterSekunden(new Date(Date.now() + 30_000).toUTCString()) <= 30, true);
});

test('Event-Seite aus Domain', () => {
  assert.equal(w.eventSeiteAusHost('fotos.ambition-circle.de'), 'https://ambition-circle.de');
  assert.equal(w.eventSeiteAusHost('fotos.blueprint-summit.de'), 'https://blueprint-summit.de');
  assert.equal(w.eventSeiteAusHost('127.0.0.1'), null);
  assert.equal(w.eventSeiteAusHost('fotos-ambition-circle.pages.dev'), null);
});

test('ZIP-Name ohne Gedankenstrich', () => {
  assert.equal(w.zipName('AMBITION Circle 2026', 1, 1), 'AMBITION Circle 2026 Fotos.zip');
  assert.equal(w.zipName('A/B', 2, 3), 'A_B Fotos Teil 2 von 3.zip');
  assert.doesNotMatch(w.zipName('x', 1, 2), /[–—]/);
});

test('httpsAdresse: nur https ohne Zugangsdaten', () => {
  assert.equal(w.httpsAdresse('https://ambition-circle.de'), 'https://ambition-circle.de/');
  assert.equal(w.httpsAdresse('https://agenturkrueger-digital.de/impressum/'), 'https://agenturkrueger-digital.de/impressum/');
  assert.equal(w.httpsAdresse('http://ambition-circle.de'), null);
  assert.equal(w.httpsAdresse('javascript:alert(1)'), null);
  assert.equal(w.httpsAdresse('https://a:b@x.de'), null);
  assert.equal(w.httpsAdresse(undefined), null);
});

test('Dateinamen: keine versteckten Dateien, keine Bidi-Tricks, keine Windows-Gerätenamen', () => {
  const s = w.dateinameSaeubern;
  assert.equal(s(' .. /x.jpg'), '_x.jpg'); // vorher ".. _x.jpg" (versteckt nach dem Entpacken)
  assert.equal(s('foto‮gpj.exe'), 'foto_gpj.exe'); // U+202E
  for (const z of ['‎', '‏', '‪', '‭', '⁦', '⁩', '\u007f']) assert.ok(!s(`a${z}b.jpg`).includes(z));
  assert.equal(s('CON.jpg'), '_CON.jpg');
  assert.equal(s('lpt1'), '_lpt1');
  assert.equal(s('Console.jpg'), 'Console.jpg');
  assert.equal(s('....jpg'), 'foto.jpg'); // vorher "jpg" ohne Endung
  assert.equal(s('bild. '), 'bild');
  assert.equal(s('../../etc/passwd.jpg'), '_.._etc_passwd.jpg');
  assert.equal(s('..'), 'foto');
  assert.ok(!s('  .versteckt.jpg').startsWith('.'));
});

test('Hinweise zum Code: leer, falsche Länge, falsche Zeichen', () => {
  assert.match(w.codeFormHinweis('ABC'), /8 Zeichen/);
  assert.match(w.codeFormHinweis('FALSCH01'), /passt nicht.*0, 1, I, L und O/);
  assert.doesNotMatch(w.codeFormHinweis('ABC') + w.codeFormHinweis('FALSCH01'), /[–—]/);
});

test('app.css: jede :hover-Regel steht in @media (hover: hover)', async () => {
  const { readFile } = await import('node:fs/promises');
  let css = await readFile(new URL('../../vorlage/assets/app.css', import.meta.url), 'utf8');
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Blöcke @media (hover: hover) ... { ... } mit Klammerzählung herausnehmen
  for (;;) {
    const i = css.search(/@media\s*\(hover:\s*hover\)[^{]*\{/);
    if (i < 0) break;
    let j = css.indexOf('{', i) + 1;
    for (let tiefe = 1; tiefe > 0; j += 1) {
      if (css[j] === '{') tiefe += 1;
      else if (css[j] === '}') tiefe -= 1;
    }
    css = css.slice(0, i) + css.slice(j);
  }
  // prefers-reduced-motion setzt nur den Hover-Zoom zurück, das ist erlaubt
  const rest = css.match(/[^{}]*:hover[^{]*\{/g) || [];
  assert.deepEqual(rest.map((r) => r.trim()).filter((r) => !/^\.kachel:hover \.kachel-bild img \{$/.test(r)), []);
});

test('Fotopfade bekommen je Seitenansicht einen Zufallswert (Edge-Cache von Pages)', () => {
  const s = w.sitzungsWert();
  assert.match(s, /^[0-9a-f]{32}$/);
  assert.notEqual(s, w.sitzungsWert());
  const b = { id: 'x', r: '/b/t/r/x.jpg', g: '/b/t/g/x.jpg', h: { pfad: '/b/t/h/x.jpg', bytes: 5 }, o: { teile: ['/b/t/o/x.1', '/b/t/o/x.2'], bytes: 9, md5: 'm' } };
  const m = w.bildMitSitzung(b, s);
  assert.equal(m.r, `/b/t/r/x.jpg?s=${s}`);
  assert.equal(m.g, `/b/t/g/x.jpg?s=${s}`);
  assert.deepEqual(m.h, { pfad: `/b/t/h/x.jpg?s=${s}`, bytes: 5 });
  assert.deepEqual(m.o.teile, [`/b/t/o/x.1?s=${s}`, `/b/t/o/x.2?s=${s}`]);
  assert.equal(m.o.md5, 'm');
  assert.equal(b.r, '/b/t/r/x.jpg', 'Manifest bleibt unverändert');
  assert.equal(w.mitSitzung('/assets/logo.png', s), '/assets/logo.png');
  assert.equal(w.bildMitSitzung({ handy: { pfad: '/b/t/h/y.jpg', bytes: 1 }, h: 400 }, s).handy.pfad, `/b/t/h/y.jpg?s=${s}`);
});
