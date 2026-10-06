// Unit-Tests für sichern.js in Node: Wiederholung, Fortsetzen nach Verbindungsabbruch, Wiederverwendung.
import nodeTest from 'node:test';

const test = (name, f) => nodeTest(name, { timeout: 15_000 }, f);
import assert from 'node:assert/strict';

// Wartezeiten im Test verkürzen: setTimeout ruft sofort zurück
const echtesSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (f, _ms, ...a) => echtesSetTimeout(f, 0, ...a);
const s = await import('../../vorlage/assets/sichern.js');

function antwort(bytes, { abbrechenNach = null, typ = 'application/octet-stream', status = 200 } = {}) {
  let gesendet = 0;
  const body = new ReadableStream({
    pull(c) {
      if (abbrechenNach !== null && gesendet >= abbrechenNach) { c.error(new TypeError('network error')); return; }
      const ende = Math.min(bytes.length, gesendet + 1000, abbrechenNach ?? Infinity);
      if (gesendet >= bytes.length) { c.close(); return; }
      c.enqueue(bytes.subarray(gesendet, ende));
      gesendet = ende;
    },
  });
  return new Response(body, { status, headers: { 'Content-Type': typ } });
}

const daten = (n, start = 0) => Uint8Array.from({ length: n }, (_, i) => (i + start) % 251);

test('holen: einmaliger Netzfehler wird wiederholt, 404 nicht, HTML statt Datei ist ein Fehler', async () => {
  let n = 0;
  globalThis.fetch = async () => { n += 1; if (n === 1) throw new TypeError('Failed to fetch'); return antwort(daten(10)); };
  assert.equal((await s.holen('/b/x')).status, 200);
  assert.equal(n, 2);
  n = 0;
  globalThis.fetch = async () => { n += 1; return new Response('weg', { status: 404 }); };
  await assert.rejects(s.holen('/b/x'), /HTTP 404/);
  assert.equal(n, 1, '404 nicht wiederholen');
  n = 0;
  globalThis.fetch = async () => { n += 1; return new Response('x', { status: 503 }); };
  await assert.rejects(s.holen('/b/x'), /HTTP 503/);
  assert.equal(n, 4, '1 Versuch + 3 Wiederholungen');
  globalThis.fetch = async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(s.holen('/b/x'), /html-statt-datei/);
});

test('holen: Abbruch beendet sofort', async () => {
  const a = new AbortController();
  globalThis.fetch = async (_p, o) => new Promise((_r, nein) => {
    if (o.signal.aborted) nein(new DOMException('ab', 'AbortError'));
    o.signal.addEventListener('abort', () => nein(new DOMException('ab', 'AbortError')));
  });
  const v = s.holen('/b/x', { signal: a.signal });
  a.abort();
  await assert.rejects(v, (e) => e.name === 'AbortError');
});

test('originalStrom: Verbindungsabbruch mitten im Teil, Fortsetzen ohne doppelte Bytes', async () => {
  const teil1 = daten(5000);
  const teil2 = daten(4000, 7);
  const abrufe = { '/o.1': 0, '/o.2': 0 };
  globalThis.fetch = async (p) => {
    abrufe[p] += 1;
    if (p === '/o.1') return antwort(teil1, { abbrechenNach: abrufe[p] === 1 ? 2500 : null });
    return antwort(teil2, { abbrechenNach: abrufe[p] <= 2 ? 1000 * abrufe[p] : null });
  };
  const bild = { name: 'a.jpg', o: { teile: ['/o.1', '/o.2'], bytes: 9000 } };
  const blob = await s.originalAlsBlob(bild);
  const ergebnis = new Uint8Array(await blob.arrayBuffer());
  const soll = new Uint8Array([...teil1, ...teil2]);
  assert.equal(ergebnis.length, soll.length);
  assert.deepEqual(ergebnis, soll);
  assert.deepEqual(abrufe, { '/o.1': 2, '/o.2': 3 });
});

test('originalStrom: falsche Gesamtlänge ist ein Fehler', async () => {
  globalThis.fetch = async () => antwort(daten(100));
  await assert.rejects(s.originalAlsBlob({ name: 'a', o: { teile: ['/o.1'], bytes: 101 } }), /unvollständig/);
});

test('paketLaden: ein Fehler hält die anderen nicht auf, Erneut versuchen lädt nur das Fehlende', async () => {
  const abrufe = {};
  let sperren = true;
  globalThis.fetch = async (p) => {
    abrufe[p] = (abrufe[p] || 0) + 1;
    if (p === '/h/3' && sperren) throw new TypeError('offline');
    return antwort(daten(50), { typ: 'image/jpeg' });
  };
  const paket = { bilder: [1, 2, 3, 4, 5].map((i) => ({ name: `IMG_${i}.JPG`, h: { pfad: `/h/${i}`, bytes: 50 } })) };
  const { namensVergeber } = await import('../../vorlage/assets/werkzeuge.js');
  await assert.rejects(s.paketLaden(paket, namensVergeber()), (e) => e.geladen === 4);
  assert.equal(abrufe['/h/3'], 4);
  sperren = false;
  const dateien = await s.paketLaden(paket, namensVergeber());
  assert.equal(dateien.length, 5);
  assert.deepEqual(dateien.map((d) => d.name), ['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg', 'IMG_4.jpg', 'IMG_5.jpg']);
  for (const p of ['/h/1', '/h/2', '/h/4', '/h/5']) assert.equal(abrufe[p], 1, `${p} nicht neu geladen`);
  assert.equal(abrufe['/h/3'], 5);
  assert.equal(paket.blobs, null, 'Zwischenspeicher freigegeben');
});
