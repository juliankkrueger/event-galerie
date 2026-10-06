// Reine Hilfsfunktionen ohne DOM. Werden auch in Node getestet (tests/oberflaeche/werkzeuge.test.mjs).

export const ZIP_MAX_BILDER = 200;
export const ZIP_MAX_BYTES = 2_000_000_000; // Teil-ZIPs bis ca. 2 GB
export const ZIP_MAX_BYTES_SPEICHER = 500_000_000; // Blob-Weg: alles liegt im Arbeitsspeicher
export const PAKET_MAX_DATEIEN = 10;
export const PAKET_MAX_BYTES = 45_000_000; // strikt darunter

const CODE_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

export function codeNormalisieren(roh) {
  return String(roh ?? '').trim().replace(/\s+/g, '').toUpperCase();
}

export function codeFormGueltig(code) {
  return CODE_ALPHABET.test(code);
}

// Hinweis für einen Code mit falscher Form (wird nie an den Server geschickt).
export function codeFormHinweis(code) {
  if (String(code ?? '').length !== 8) return 'Der Code hat 8 Zeichen, zum Beispiel ABCD2345.';
  return 'Dieser Code passt nicht. Er besteht aus Großbuchstaben und Ziffern, 0, 1, I, L und O kommen darin nicht vor.';
}

// Liest #c=CODE aus dem Hash. Gibt null zurück, wenn keiner da ist.
export function codeAusHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h) return null;
  const werte = new URLSearchParams(h);
  const c = werte.get('c');
  return c ? codeNormalisieren(c) : null;
}

// Vertrag: Höhe unter "hoehe", "h" ist die Handy-Fassung. Zur Sicherheit wird auch eine
// Zahl unter "h" als Höhe gelesen; fehlt die Höhe, nimmt das Raster sie aus dem Bild.
export function bildHoehe(b) {
  if (typeof b.h === 'number') return b.h;
  if (typeof b.hoehe === 'number') return b.hoehe;
  return null;
}

export function bildHandy(b) {
  if (b.h && typeof b.h === 'object' && b.h.pfad) return b.h;
  if (b.handy && typeof b.handy === 'object' && b.handy.pfad) return b.handy;
  return null;
}

export function seitenverhaeltnis(b) {
  const h = bildHoehe(b);
  if (b.w > 0 && h > 0) return b.w / h;
  return null;
}

// Bilder des Manifests flach, mit Kapitelbezug und laufender Nummer.
export function bilderFlach(manifest) {
  const liste = [];
  (manifest.kapitel || []).forEach((k, ki) => {
    (k.bilder || []).forEach((b) => {
      liste.push({ ...b, kapitel: ki, nr: liste.length + 1 });
    });
  });
  return liste;
}

// Cloudflare Pages hält abgerufene Dateien im Edge-Cache, auch nach einem neuen Deployment, das
// sie nicht mehr enthält, und unabhängig von Cache-Control (gemessen 05.10.2026 mit private und
// no-store). Der Cache-Schlüssel enthält aber die Query. Darum lädt jede Seitenansicht alle Fotos
// mit einem eigenen Zufallswert: Was dabei im Edge-Cache landet, kann ohne diesen Wert niemand
// abrufen, und die nackte Adresse aus einem alten Manifest liefert nach Offline oder Neubau nichts mehr.
export function sitzungsWert(zufall = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return Array.from(zufall(16), (x) => x.toString(16).padStart(2, '0')).join('');
}

export function mitSitzung(pfad, wert) {
  if (typeof pfad !== 'string' || !pfad.startsWith('/b/')) return pfad;
  return `${pfad}${pfad.includes('?') ? '&' : '?'}s=${wert}`;
}

// Kopie eines Bildes mit Sitzungswert an allen Fotopfaden (r, g, h, o)
export function bildMitSitzung(b, wert) {
  const neu = { ...b, r: mitSitzung(b.r, wert), g: mitSitzung(b.g, wert) };
  const handy = bildHandy(b);
  if (handy) {
    const h = { ...handy, pfad: mitSitzung(handy.pfad, wert) };
    if (b.h && typeof b.h === 'object') neu.h = h;
    else neu.handy = h;
  }
  if (b.o?.teile) neu.o = { ...b.o, teile: b.o.teile.map((t) => mitSitzung(t, wert)) };
  return neu;
}

// Macht Dateinamen eindeutig: "a.jpg", "a (2).jpg", "a (3).jpg". Vergleich ohne Groß/Klein,
// weil Windows und macOS das nicht unterscheiden.
export function namensVergeber() {
  const vergeben = new Set();
  return (name) => {
    const sauber = dateinameSaeubern(name || 'foto.jpg');
    const punkt = sauber.lastIndexOf('.');
    const stamm = punkt > 0 ? sauber.slice(0, punkt) : sauber;
    const endung = punkt > 0 ? sauber.slice(punkt) : '';
    let kandidat = sauber;
    let n = 2;
    while (vergeben.has(kandidat.toLowerCase())) {
      kandidat = `${stamm} (${n})${endung}`;
      n += 1;
    }
    vergeben.add(kandidat.toLowerCase());
    return kandidat;
  };
}

// Reservierte Gerätenamen unter Windows, auch mit Endung (CON.jpg) nicht anlegbar.
const WINDOWS_RESERVIERT = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

export function dateinameSaeubern(name) {
  let s = String(name)
    // Pfadtrenner, unter Windows verbotene Zeichen, Steuerzeichen samt DEL
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    // Bidi-Steuerzeichen (z. B. U+202E dreht "gpj.exe" optisch zu "exe.jpg")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '_')
    .trim()
    // erst nach trim: " .x" darf nicht zur versteckten Datei ".x" werden
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  if (!s) return 'foto';
  // "....jpg" wäre sonst "jpg" ohne Endung
  if (!s.includes('.') && /^\.+/.test(String(name).trim()) && /^[a-z0-9]{2,5}$/i.test(s)) s = `foto.${s}`;
  if (WINDOWS_RESERVIERT.test(s)) s = `_${s}`;
  return s;
}

export function endungTauschen(name, neu) {
  const punkt = name.lastIndexOf('.');
  const stamm = punkt > 0 ? name.slice(0, punkt) : name;
  return `${stamm}${neu}`;
}

// Teilt die Auswahl in ZIP-Teile: höchstens 200 Bilder und höchstens maxBytes je Teil.
// Ein einzelnes Bild über maxBytes bekommt einen eigenen Teil.
export function zipTeileBilden(bilder, maxBytes = ZIP_MAX_BYTES, maxBilder = ZIP_MAX_BILDER) {
  const teile = [];
  let aktuell = { bilder: [], bytes: 0 };
  for (const b of bilder) {
    const groesse = b.o?.bytes || 0;
    if (aktuell.bilder.length && (aktuell.bilder.length >= maxBilder || aktuell.bytes + groesse > maxBytes)) {
      teile.push(aktuell);
      aktuell = { bilder: [], bytes: 0 };
    }
    aktuell.bilder.push(b);
    aktuell.bytes += groesse;
  }
  if (aktuell.bilder.length) teile.push(aktuell);
  return teile;
}

// Pakete für navigator.share: höchstens 10 Dateien und zusammen unter 45 MB.
export function paketeBilden(bilder, maxDateien = PAKET_MAX_DATEIEN, maxBytes = PAKET_MAX_BYTES) {
  const pakete = [];
  let aktuell = { bilder: [], bytes: 0 };
  for (const b of bilder) {
    const groesse = bildHandy(b)?.bytes || 0;
    if (aktuell.bilder.length && (aktuell.bilder.length >= maxDateien || aktuell.bytes + groesse >= maxBytes)) {
      pakete.push(aktuell);
      aktuell = { bilder: [], bytes: 0 };
    }
    aktuell.bilder.push(b);
    aktuell.bytes += groesse;
  }
  if (aktuell.bilder.length) pakete.push(aktuell);
  return pakete;
}

const ZAHL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const GANZ = new Intl.NumberFormat('de-DE');

export function zahl(n) {
  return GANZ.format(n);
}

// Dezimale Einheiten wie im Finder: 1 MB = 1.000.000 Byte.
export function groesse(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1e9) return `${ZAHL.format(b / 1e9)} GB`;
  if (b >= 1e6) return `${ZAHL.format(b / 1e6)} MB`;
  if (b >= 1e3) return `${GANZ.format(Math.round(b / 1e3))} KB`;
  return `${GANZ.format(b)} Byte`;
}

export function fotos(n) {
  return n === 1 ? '1 Foto' : `${zahl(n)} Fotos`;
}

export function datumLang(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }).format(d);
}

// Retry-After: Sekunden oder HTTP-Datum. Ergebnis in Sekunden (mindestens 1).
export function retryAfterSekunden(wert, jetzt = Date.now()) {
  if (wert == null || wert === '') return null;
  const s = Number(wert);
  if (Number.isFinite(s)) return Math.max(1, Math.ceil(s));
  const d = Date.parse(wert);
  if (Number.isFinite(d)) return Math.max(1, Math.ceil((d - jetzt) / 1000));
  return null;
}

export function wartezeitText(sekunden) {
  if (sekunden >= 90) {
    const m = Math.ceil(sekunden / 60);
    return `${m} Minuten`;
  }
  if (sekunden >= 60) return '1 Minute';
  return sekunden === 1 ? '1 Sekunde' : `${sekunden} Sekunden`;
}

// Nur https-Adressen ohne Zugangsdaten übernehmen (Links aus /assets/marke.json). Sonst null.
export function httpsAdresse(wert) {
  try {
    const u = new URL(String(wert ?? ''));
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

// Event-Seite aus der eigenen Domain ableiten: fotos.ambition-circle.de -> https://ambition-circle.de
export function eventSeiteAusHost(host) {
  const h = String(host || '').toLowerCase();
  if (!/^fotos\.[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return null;
  return `https://${h.slice('fotos.'.length)}`;
}

export function zipName(titel, teil, teileGesamt) {
  const basis = dateinameSaeubern(`${titel || 'Galerie'} Fotos`);
  return teileGesamt > 1 ? `${basis} Teil ${teil} von ${teileGesamt}.zip` : `${basis}.zip`;
}
