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

// ---------- Umgebung (06.10.2026) ----------

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
  ipadOs: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  pixel: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0',
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Instagram 351.0.0.41.106 Android',
  webviewAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S921B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 [FBAN/FBIOS;FBAV/490.0]',
  wkwebview: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
};

test('Umgebung: Weg kommt aus den Feature-Tests, nicht aus dem User-Agent', () => {
  // Gleicher User-Agent, andere Features: anderer Weg
  assert.equal(w.umgebungBewerten({ ua: UA.iphone, teilenDateien: true, touch: true }).weg, 'teilen');
  assert.equal(w.umgebungBewerten({ ua: UA.iphone, teilenDateien: false, touch: true }).weg, 'zip');
  assert.equal(w.umgebungBewerten({ ua: UA.pixel, teilenDateien: true, touch: false }).weg, 'zip');
  // Ein Android-UA allein schaltet nichts um
  assert.equal(w.umgebungBewerten({ ua: UA.pixel }).weg, 'zip');
  assert.equal(w.umgebungBewerten({ ua: UA.firefoxAndroid, teilenDateien: false, touch: true }).plattform, 'android');
  assert.equal(w.plattform(UA.ipadOs, { touchPunkte: 5 }), 'ios');
  assert.equal(w.plattform(UA.ipadOs, { touchPunkte: 0 }), 'andere');
  assert.equal(w.plattform(UA.chromeIos), 'ios');
});

test('App-Browser: erkannt, Hinweis nur ohne Teilen', () => {
  assert.equal(w.inAppName(UA.instagramAndroid), 'Instagram');
  assert.equal(w.inAppName(UA.facebookIos), 'Facebook');
  assert.equal(w.inAppName(UA.webviewAndroid), 'App');
  assert.equal(w.inAppName(UA.wkwebview), 'App');
  for (const ua of [UA.iphone, UA.chromeIos, UA.pixel, UA.firefoxAndroid, UA.desktop]) assert.equal(w.inAppName(ua), null, ua);
  assert.equal(w.umgebungBewerten({ ua: UA.instagramAndroid, teilenDateien: false, touch: true }).hinweisApp, 'Instagram');
  // Kann die App Dateien teilen, klappt das Sichern auch dort: kein Hinweis
  assert.equal(w.umgebungBewerten({ ua: UA.facebookIos, teilenDateien: true, touch: true }).hinweisApp, null);
});

test('Intent-Link und Galerie-Link', () => {
  assert.equal(w.intentAdresse('https://fotos.ambition-circle.de/'), 'intent://fotos.ambition-circle.de/#Intent;scheme=https;action=android.intent.action.VIEW;end');
  assert.equal(w.intentAdresse('javascript:alert(1)'), null);
  assert.equal(w.intentAdresse('kaputt'), null);
  assert.equal(w.galerieLink('https://fotos.x.de', 'GAST2345'), 'https://fotos.x.de/#c=GAST2345');
  assert.equal(w.galerieLink('https://fotos.x.de/', null), 'https://fotos.x.de/');
  assert.equal(w.galerieLink('https://fotos.x.de', 'falsch'), 'https://fotos.x.de/');
});

test('Wartezeiten: drei Wiederholungen mit wachsender Pause und Streuung', () => {
  assert.equal(w.WIEDERHOLUNGEN.length, 3);
  assert.deepEqual([0, 1, 2].map((v) => w.wartezeit(v, () => 0.5)), w.WIEDERHOLUNGEN);
  assert.ok(w.wartezeit(0, () => 0) >= w.WIEDERHOLUNGEN[0] * 0.8);
  assert.ok(w.wartezeit(2, () => 0.999) <= w.WIEDERHOLUNGEN[2] * 1.2);
});

test('Blocksatz: Zeilen füllen die Breite, Höhen nah am Ziel, letzte Zeile ungestreckt', () => {
  const vs = [1.5, 0.667, 1, 1.778, 0.8, 1.5, 1.5, 0.667, 1.5, 0.667, 1, 1.778, 3.2, 0.5];
  for (const [breite, luecke, ziel] of [[1190, 8, 236], [288, 4, 103], [358, 4, 128], [720, 6, 190]]) {
    const zeilen = w.zeilenBilden(vs, breite, luecke, ziel);
    assert.equal(zeilen[0][0], 0);
    assert.equal(zeilen.at(-1)[1], vs.length - 1);
    for (let i = 1; i < zeilen.length; i += 1) assert.equal(zeilen[i][0], zeilen[i - 1][1] + 1, 'lückenlos');
    for (const [a, b, summe, letzte] of zeilen) {
      assert.ok(Math.abs(summe - vs.slice(a, b + 1).reduce((s, v) => s + v, 0)) < 1e-9);
      if (letzte) continue;
      const h = (breite - luecke * (b - a)) / summe;
      // Einzelne Panoramen dürfen niedriger sein, sonst bleibt jede Zeile in 0,5 bis 1,8 der Zielhöhe
      if (b > a) assert.ok(h > ziel * 0.5 && h < ziel * 1.8, `Höhe ${h.toFixed(0)} bei Ziel ${ziel}`);
    }
  }
  assert.deepEqual(w.zeilenBilden([], 1000, 8, 200), []);
  assert.deepEqual(w.zeilenBilden([5], 300, 8, 200), [[0, 0, 5, false]]);
});

test('Texte der Oberfläche ohne Gedankenstriche', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const datei of ['index.html', 'assets/app.js', 'assets/ansicht.js', 'assets/sichern.js', 'assets/werkzeuge.js']) {
    const text = await readFile(new URL(`../../vorlage/${datei}`, import.meta.url), 'utf8');
    // Nur Zeichenketten und HTML-Text prüfen, Kommentare dürfen alles
    const ohneKommentare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(ohneKommentare, /[–—]/, datei);
  }
});
