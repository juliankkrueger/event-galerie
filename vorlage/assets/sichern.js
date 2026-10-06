// Speichern: ZIP (client-zip), Teilen aufs Handy (Web Share mit Dateien), Einzel-Original.
// Jeder Abruf wiederholt sich bis zu dreimal mit wachsender Pause und wartet, solange das Gerät
// offline ist. Bricht eine Verbindung mitten in einem Teil ab, lädt die Seite den Teil neu und
// überspringt, was schon geliefert war.
import { bildHandy, endungTauschen, namensVergeber, umgebungBewerten, wartezeit, WIEDERHOLUNGEN } from './werkzeuge.js';

const OFFLINE_GEDULD = 120_000; // so lange wartet ein Abruf auf die Rückkehr des Netzes

function abbruchFehler(signal) {
  const g = signal?.reason;
  return g instanceof DOMException && g.name === 'AbortError' ? g : new DOMException('Abgebrochen', 'AbortError');
}

function pruefen(signal) {
  if (signal?.aborted) throw abbruchFehler(signal);
}

function warten(ms, signal) {
  return new Promise((aufloesen, ablehnen) => {
    if (signal?.aborted) { ablehnen(abbruchFehler(signal)); return; }
    const uhr = setTimeout(() => { signal?.removeEventListener('abort', weg); aufloesen(); }, ms);
    const weg = () => { clearTimeout(uhr); ablehnen(abbruchFehler(signal)); };
    signal?.addEventListener('abort', weg, { once: true });
  });
}

// Offline: auf das Ereignis "online" warten (höchstens OFFLINE_GEDULD), abbrechbar.
function aufNetzWarten(signal, beiWarten) {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve();
  beiWarten?.(true);
  return new Promise((aufloesen, ablehnen) => {
    const fertig = (fehler) => {
      clearTimeout(uhr);
      window.removeEventListener('online', ok);
      signal?.removeEventListener('abort', weg);
      beiWarten?.(false);
      if (fehler) ablehnen(fehler);
      else aufloesen();
    };
    const ok = () => fertig();
    const weg = () => fertig(abbruchFehler(signal));
    const uhr = setTimeout(ok, OFFLINE_GEDULD);
    window.addEventListener('online', ok, { once: true });
    signal?.addEventListener('abort', weg, { once: true });
  });
}

// Ein Abruf mit bis zu drei Wiederholungen. Dauerhafte Fehler (404, 403, HTML statt Datei)
// werden nicht wiederholt. Pages liefert für unbekannte Pfade die Startseite mit 200 aus,
// darum gilt eine HTML-Antwort als Fehler.
export async function holen(pfad, { signal, beiWarten, versuche = WIEDERHOLUNGEN.length } = {}) {
  let fehler = null;
  for (let v = 0; v <= versuche; v += 1) {
    pruefen(signal);
    if (v > 0) await warten(wartezeit(v - 1), signal);
    await aufNetzWarten(signal, beiWarten);
    pruefen(signal);
    try {
      const antwort = await fetch(pfad, { signal, credentials: 'same-origin' });
      const typ = antwort.headers.get('Content-Type') || '';
      if (antwort.ok && !/text\/html/i.test(typ)) return antwort;
      fehler = new Error(antwort.ok ? 'html-statt-datei' : `HTTP ${antwort.status}`);
      fehler.dauerhaft = antwort.ok || (antwort.status >= 400 && antwort.status < 500 && ![408, 425, 429].includes(antwort.status));
      antwort.body?.cancel().catch(() => {});
      if (fehler.dauerhaft) break;
    } catch (e) {
      if (signal?.aborted || e?.name === 'AbortError') throw abbruchFehler(signal);
      fehler = e;
    }
  }
  throw fehler || new Error('abruf');
}

// Setzt die Teile eines Originals zu einem Strom zusammen. Prüft die Gesamtlänge.
// Reißt die Verbindung innerhalb eines Teils ab, holt sie den Teil neu und überspringt das
// schon Gelieferte (höchstens dreimal je Teil).
export function originalStrom(bild, signal, beiBytes, beiWarten) {
  const teile = bild.o?.teile || [];
  let i = 0;
  let leser = null;
  let gelesen = 0;
  let imTeil = 0; // schon weitergegebene Bytes des aktuellen Teils
  let ueberspringen = 0;
  let neuVersuche = 0;
  return new ReadableStream({
    async pull(steuerung) {
      for (;;) {
        if (!leser) {
          if (i >= teile.length) {
            if (bild.o?.bytes && gelesen !== bild.o.bytes) {
              steuerung.error(new Error(`Original unvollständig (${gelesen} von ${bild.o.bytes} Byte)`));
              return;
            }
            steuerung.close();
            return;
          }
          const antwort = await holen(teile[i], { signal, beiWarten });
          leser = antwort.body.getReader();
        }
        let stueck;
        try {
          stueck = await leser.read();
        } catch (e) {
          if (signal?.aborted || e?.name === 'AbortError') throw abbruchFehler(signal);
          // Verbindung mitten im Teil verloren: Teil neu holen, Gelieferte überspringen
          leser = null;
          neuVersuche += 1;
          if (neuVersuche > WIEDERHOLUNGEN.length) throw e;
          await warten(wartezeit(neuVersuche - 1), signal);
          ueberspringen = imTeil;
          continue;
        }
        const { done, value } = stueck;
        if (done) {
          leser = null;
          i += 1;
          imTeil = 0;
          ueberspringen = 0;
          neuVersuche = 0;
          continue;
        }
        let daten = value;
        if (ueberspringen > 0) {
          const weg = Math.min(ueberspringen, daten.byteLength);
          ueberspringen -= weg;
          daten = daten.subarray(weg);
          if (!daten.byteLength) continue;
        }
        imTeil += daten.byteLength;
        gelesen += daten.byteLength;
        beiBytes?.(daten.byteLength);
        steuerung.enqueue(daten);
        return;
      }
    },
    cancel(grund) {
      leser?.cancel(grund).catch(() => {});
    },
  });
}

export async function originalAlsBlob(bild, signal, beiBytes, beiWarten) {
  const strom = originalStrom(bild, signal, beiBytes, beiWarten);
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

// client-zip erst laden, wenn eine ZIP gebraucht wird (kürzere Ladekette beim Seitenstart)
let zipModul = null;
export function zipVorladen() {
  zipModul = zipModul || import('./client-zip.js');
  return zipModul;
}

export async function zipLaenge(eintraege) {
  const { predictLength } = await zipVorladen();
  return Number(predictLength(eintraege.map(({ name, size, lastModified }) => ({ name, size, lastModified }))));
}

// Liefert einen Strom mit der fertigen ZIP-Datei. Originale werden erst geladen, wenn
// client-zip sie braucht, darum bleibt der Speicherbedarf klein.
export async function zipStrom(eintraege, signal, beiBytes, beiWarten) {
  const { downloadZip } = await zipVorladen();
  async function* quelle() {
    for (const e of eintraege) {
      pruefen(signal);
      yield { name: e.name, size: e.size, lastModified: e.lastModified, input: originalStrom(e.bild, signal, null, beiWarten) };
    }
  }
  const laenge = await zipLaenge(eintraege);
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

// WebKit (Safari am Mac, jeder Browser auf iPhone und iPad) liefert Service-Worker-Ströme nicht
// als Download aus. GestureEvent gibt es nur in WebKit; der User-Agent ist nur die Gegenprobe.
export function istWebKit() {
  if (typeof window.GestureEvent !== 'undefined') return true;
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/(Chrome|Chromium|Android|Edg|OPR)\//.test(ua) && !/Android/.test(ua);
}

export function speicherWeg() {
  if (typeof window.showSaveFilePicker === 'function') return 'dateiauswahl';
  if (navigator.serviceWorker && typeof ReadableStream === 'function' && !istWebKit()) return 'dienst';
  return 'speicher';
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
  try {
    await strom.pipeTo(ziel, { signal });
  } catch (e) {
    // Halbe Datei nicht stehen lassen
    await ziel.abort?.().catch(() => {});
    throw e;
  }
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
  let abgeholt = false;

  const fertig = new Promise((aufloesen, ablehnen) => {
    let erledigt = false;
    const beenden = (fehler) => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(waechter);
      kanal.port1.onmessage = null;
      // Nach einem Fehler den Rahmen sofort entfernen: Firefox hält sonst die fehlgeschlagene
      // Navigation offen, und neue Klicks kommen nicht an (gemessen in Firefox 143)
      if (fehler) rahmen?.remove();
      else setTimeout(() => rahmen?.remove(), 30_000);
      if (fehler) ablehnen(fehler);
      else aufloesen();
    };
    // Holt der Browser den Download nicht ab (z. B. blockiert), nicht ewig warten
    const waechter = setTimeout(() => {
      if (!abgeholt) {
        leser.cancel().catch(() => {});
        beenden(new Error('kein-dienst'));
      }
    }, 20_000);
    signal?.addEventListener('abort', () => {
      kanal.port1.postMessage({ typ: 'fehler' });
      leser.cancel().catch(() => {});
      beenden(abbruchFehler(signal));
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
        abgeholt = true;
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
  if (!navigator.serviceWorker || istWebKit()) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

// ---------- Teilen aufs Handy ----------

export function istTouch() {
  try {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch {
    return false;
  }
}

// Feature-Test: kann das Gerät Bilddateien über das Teilen-Menü weitergeben?
export function kannDateienTeilenTest() {
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    const probe = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'probe.jpg', { type: 'image/jpeg' });
    return navigator.canShare({ files: [probe] }) === true;
  } catch {
    return false;
  }
}

// Gesamtbild aus Feature-Tests und User-Agent-Hinweis (siehe umgebungBewerten in werkzeuge.js).
export function umgebung() {
  return umgebungBewerten({
    ua: navigator.userAgent,
    teilenDateien: kannDateienTeilenTest(),
    touch: istTouch(),
    touchPunkte: navigator.maxTouchPoints || 0,
  });
}

// Nur auf Touch-Geräten (Handy, Tablet). Chrome am Mac kann auch Dateien teilen, dort ist die
// ZIP mit Originalen aber das Richtige.
export function kannDateienTeilen() {
  return umgebung().weg === 'teilen';
}

// Lädt die Handy-Fassungen eines Pakets als File-Objekte (vor dem Tippen!). Schon geladene
// Dateien liegen in paket.blobs und werden bei "Erneut versuchen" nicht noch einmal geholt.
// Ein Fehler bei einem Foto hält die anderen nicht auf; am Ende scheitert das Paket als Ganzes.
export async function paketLaden(paket, vergeben, signal, beiDatei, beiWarten) {
  const n = paket.bilder.length;
  if (!paket.blobs || paket.blobs.length !== n) paket.blobs = new Array(n).fill(null);
  const blobs = paket.blobs;
  let fertig = blobs.filter(Boolean).length;
  beiDatei?.(fertig, n);
  let naechstes = 0;
  let fehler = null;
  const arbeiter = async () => {
    while (naechstes < n) {
      const i = naechstes;
      naechstes += 1;
      if (blobs[i]) continue;
      const b = paket.bilder[i];
      const pfad = bildHandy(b)?.pfad || b.g;
      try {
        const antwort = await holen(pfad, { signal, beiWarten });
        blobs[i] = await antwort.blob();
        fertig += 1;
        beiDatei?.(fertig, n);
      } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') throw abbruchFehler(signal);
        fehler = fehler || e;
      }
    }
  };
  await Promise.all([arbeiter(), arbeiter(), arbeiter()]);
  if (fehler) {
    fehler.geladen = fertig;
    throw fehler;
  }
  // Namen in fester Reihenfolge vergeben, damit sie stabil bleiben
  const dateien = paket.bilder.map((b, i) => new File([blobs[i]], vergeben(endungTauschen(b.name || 'foto', '.jpg')), {
    type: 'image/jpeg',
    lastModified: new Date(b.aufnahme || Date.now()).getTime() || Date.now(),
  }));
  // Die Blobs stecken jetzt in den Dateien; die Liste nicht doppelt halten
  paket.blobs = null;
  return dateien;
}
