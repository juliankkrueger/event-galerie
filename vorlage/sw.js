// Service Worker der Event-Galerie. Einzige Aufgabe: ZIP-Downloads als Strom ausliefern,
// wenn der Browser keine Dateiauswahl (showSaveFilePicker) kennt. Kein Cache, kein Offline.
const offen = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.typ !== 'zip' || !e.ports[0] || !/^[0-9a-f]{24}$/.test(d.id || '')) return;
  const port = e.ports[0];
  let warten = null;
  let fertig;
  const lebenszeit = new Promise((r) => { fertig = r; });

  const strom = new ReadableStream({
    pull(steuerung) {
      return new Promise((weiter) => {
        warten = { steuerung, weiter };
        port.postMessage({ typ: 'pull' });
      });
    },
    cancel() {
      port.postMessage({ typ: 'abbruch' });
      fertig();
    },
  }, { highWaterMark: 1 });

  port.onmessage = (m) => {
    const n = m.data || {};
    const w = warten;
    warten = null;
    if (!w) return;
    if (n.typ === 'stueck') w.steuerung.enqueue(n.stueck);
    else if (n.typ === 'ende') { w.steuerung.close(); fertig(); }
    else { w.steuerung.error(new Error('abgebrochen')); fertig(); }
    w.weiter();
  };

  offen.set(d.id, { strom, name: String(d.name || 'Fotos.zip'), laenge: Number(d.laenge) || 0 });
  // Nicht abgeholte Downloads verfallen nach einer Minute
  setTimeout(() => { if (offen.delete(d.id)) fertig(); }, 60_000);
  port.postMessage({ typ: 'bereit' });
  e.waitUntil(lebenszeit);
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/zip-download/')) return;
  const id = url.pathname.slice('/zip-download/'.length);
  const eintrag = offen.get(id);
  if (!eintrag) {
    e.respondWith(new Response('Dieser Download ist nicht mehr verfügbar.', {
      status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    }));
    return;
  }
  offen.delete(id);
  const ascii = eintrag.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const kopf = {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(eintrag.name)}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (eintrag.laenge > 0) kopf['Content-Length'] = String(eintrag.laenge);
  e.respondWith(new Response(eintrag.strom, { headers: kopf }));
});
