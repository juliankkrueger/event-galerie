// Speichern: ZIP (client-zip), Teilen aufs Handy (Web Share mit Dateien), Einzel-Original.
import { downloadZip, predictLength } from './client-zip.js';
import { bildHandy, endungTauschen, namensVergeber } from './werkzeuge.js';

const VERSUCHE = 3;

async function holen(pfad, signal) {
  let fehler;
  for (let v = 0; v < VERSUCHE; v += 1) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Abgebrochen', 'AbortError');
    try {
      const antwort = await fetch(pfad, { signal, credentials: 'same-origin' });
      if (antwort.ok) return antwort;
      fehler = new Error(`HTTP ${antwort.status} bei ${pfad}`);
      if (antwort.status < 500 && antwort.status !== 429) break;
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      fehler = e;
    }
    await new Promise((r) => setTimeout(r, 400 * (v + 1)));
  }
  throw fehler;
}

// Setzt die Teile eines Originals zu einem Strom zusammen. Prüft die Gesamtlänge.
export function originalStrom(bild, signal, beiBytes) {
  const teile = bild.o?.teile || [];
  let i = 0;
  let leser = null;
  let gelesen = 0;
  return new ReadableStream({
    async pull(steuerung) {
      for (;;) {
        if (!leser) {
          if (i >= teile.length) {
            if (bild.o?.bytes && gelesen !== bild.o.bytes) {
              steuerung.error(new Error(`Original ${bild.name} unvollständig (${gelesen} von ${bild.o.bytes} Byte)`));
              return;
            }
            steuerung.close();
            return;
          }
          const antwort = await holen(teile[i], signal);
          i += 1;
          leser = antwort.body.getReader();
        }
        const { done, value } = await leser.read();
        if (done) {
          leser = null;
          continue;
        }
        gelesen += value.byteLength;
        beiBytes?.(value.byteLength);
        steuerung.enqueue(value);
        return;
      }
    },
    cancel(grund) {
      leser?.cancel(grund).catch(() => {});
    },
  });
}

export async function originalAlsBlob(bild, signal, beiBytes) {
  const strom = originalStrom(bild, signal, beiBytes);
  const blob = await new Response(strom).blob();
  return new Blob([blob], { type: bild.o?.typ || 'application/octet-stream' });
}

export function blobSpeichern(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.className = 'versteckt';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- ZIP ----------

export function zipEintraege(bilder, erstellt) {
  const vergeben = namensVergeber();
  return bilder.map((b) => ({
    bild: b,
    name: vergeben(b.name),
    size: b.o?.bytes || 0,
    lastModified: new Date(b.aufnahme || erstellt || Date.now()),
  }));
}

export function zipLaenge(eintraege) {
  return Number(predictLength(eintraege.map(({ name, size, lastModified }) => ({ name, size, lastModified }))));
}

// Liefert einen Strom mit der fertigen ZIP-Datei. Originale werden erst geladen, wenn
// client-zip sie braucht, darum bleibt der Speicherbedarf klein.
export function zipStrom(eintraege, signal, beiBytes) {
  async function* quelle() {
    for (const e of eintraege) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Abgebrochen', 'AbortError');
      yield { name: e.name, size: e.size, lastModified: e.lastModified, input: originalStrom(e.bild, signal) };
    }
  }
  const laenge = zipLaenge(eintraege);
  const antwort = downloadZip(quelle(), { length: laenge });
  let gezaehlt = 0;
  const zaehler = new TransformStream({
    transform(stueck, steuerung) {
      gezaehlt += stueck.byteLength;
      beiBytes?.(gezaehlt, laenge);
      steuerung.enqueue(stueck);
    },
  });
  return { strom: antwort.body.pipeThrough(zaehler, { signal }), laenge };
}

export function speicherWeg() {
  if (typeof window.showSaveFilePicker === 'function') return 'dateiauswahl';
  if (navigator.serviceWorker && !istSafari()) return 'dienst';
  return 'speicher';
}

function istSafari() {
  const ua = navigator.userAgent;
  return /Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR)\//.test(ua);
}

// Muss als ERSTES im Klick laufen (Nutzeraktivierung).
export async function dateiauswahlOeffnen(name) {
  return window.showSaveFilePicker({
    suggestedName: name,
    types: [{ description: 'ZIP-Archiv', accept: { 'application/zip': ['.zip'] } }],
  });
}

export async function inDateiSchreiben(griff, strom, signal) {
  const ziel = await griff.createWritable();
  await strom.pipeTo(ziel, { signal });
}

// Service-Worker-Weg: Die Seite reicht den Strom stückweise über einen MessageChannel an
// /sw.js, der ihn als Download unter /zip-download/<id> ausliefert.
export async function ueberDienstSpeichern(strom, name, laenge, signal) {
  const steuerer = await dienstSteuerer();
  if (!steuerer) throw new Error('kein-dienst');
  const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, '0')).join('');
  const kanal = new MessageChannel();
  const leser = strom.getReader();
  let rahmen = null;

  const fertig = new Promise((aufloesen, ablehnen) => {
    const beenden = (fehler) => {
      kanal.port1.onmessage = null;
      setTimeout(() => rahmen?.remove(), 30_000);
      if (fehler) ablehnen(fehler);
      else aufloesen();
    };
    signal?.addEventListener('abort', () => {
      kanal.port1.postMessage({ typ: 'fehler' });
      leser.cancel().catch(() => {});
      beenden(new DOMException('Abgebrochen', 'AbortError'));
    }, { once: true });
    kanal.port1.onmessage = async (ereignis) => {
      const d = ereignis.data || {};
      if (d.typ === 'bereit') {
        rahmen = document.createElement('iframe');
        rahmen.className = 'versteckt';
        rahmen.title = 'Download';
        rahmen.src = `/zip-download/${id}`;
        document.body.append(rahmen);
      } else if (d.typ === 'pull') {
        try {
          const { done, value } = await leser.read();
          if (done) {
            kanal.port1.postMessage({ typ: 'ende' });
            beenden();
          } else {
            // Ohne Transfer-Liste: client-zip kann Ansichten auf gemeinsame Puffer liefern
            kanal.port1.postMessage({ typ: 'stueck', stueck: value });
          }
        } catch (e) {
          kanal.port1.postMessage({ typ: 'fehler' });
          beenden(e);
        }
      } else if (d.typ === 'abbruch') {
        leser.cancel().catch(() => {});
        beenden(new DOMException('Download im Browser abgebrochen', 'AbortError'));
      }
    };
  });
  steuerer.postMessage({ typ: 'zip', id, name, laenge }, [kanal.port2]);
  return fertig;
}

async function dienstSteuerer() {
  if (!navigator.serviceWorker) return null;
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
  try {
    await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 3000))]);
  } catch {
    return null;
  }
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
  // Nach clients.claim() kommt der Steuerer kurz darauf
  await new Promise((r) => setTimeout(r, 300));
  return navigator.serviceWorker.controller || null;
}

export function dienstAnmelden() {
  if (!navigator.serviceWorker) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

// ---------- Teilen aufs Handy ----------

// Nur auf Touch-Geräten (Handy, Tablet). Chrome am Mac kann auch Dateien teilen, dort ist die
// ZIP mit Originalen aber das Richtige.
export function kannDateienTeilen() {
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    if (!window.matchMedia('(hover: none) and (pointer: coarse)').matches) return false;
    const probe = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'probe.jpg', { type: 'image/jpeg' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

// Lädt die Handy-Fassungen eines Pakets als File-Objekte (vor dem Tippen!).
export async function paketLaden(paket, vergeben, signal, beiDatei) {
  const dateien = new Array(paket.bilder.length);
  let fertig = 0;
  let naechstes = 0;
  const arbeiter = async () => {
    while (naechstes < paket.bilder.length) {
      const i = naechstes;
      naechstes += 1;
      const b = paket.bilder[i];
      const handy = bildHandy(b);
      const pfad = handy?.pfad || b.g;
      const antwort = await holen(pfad, signal);
      const blob = await antwort.blob();
      dateien[i] = { b, blob };
      fertig += 1;
      beiDatei?.(fertig, paket.bilder.length);
    }
  };
  await Promise.all([arbeiter(), arbeiter(), arbeiter()]);
  // Namen in fester Reihenfolge vergeben, damit sie stabil bleiben
  return dateien.map(({ b, blob }) => new File([blob], vergeben(endungTauschen(b.name || 'foto', '.jpg')), {
    type: 'image/jpeg',
    lastModified: new Date(b.aufnahme || Date.now()).getTime() || Date.now(),
  }));
}
