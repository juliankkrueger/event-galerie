// Reine Hilfsfunktionen ohne DOM. Werden auch in Node getestet (tests/oberflaeche/werkzeuge.test.mjs).

export const ZIP_MAX_BILDER = 200;
export const ZIP_MAX_BYTES = 2_000_000_000; // Teil-ZIPs bis ca. 2 GB
export const ZIP_MAX_BYTES_SPEICHER = 500_000_000; // Blob-Weg: alles liegt im Arbeitsspeicher
export const ZIP_MAX_BYTES_SPEICHER_HANDY = 250_000_000; // Handy und Tablet haben weniger Speicher je Tab
export const PAKET_MAX_DATEIEN = 10;
export const PAKET_MAX_BYTES = 45_000_000; // strikt darunter
// Wartezeiten vor den drei Wiederholungen eines Abrufs (ms), dazu ±20 % Streuung
export const WIEDERHOLUNGEN = [700, 2000, 5000];

// ---------- Umgebung ----------

// Bekannte Apps mit eingebautem Browser. Der User-Agent ist hier nur ein Hinweis: Den Hinweis
// "Im Browser öffnen" zeigt die Seite erst, wenn zusätzlich der Feature-Test sagt, dass das
// Gerät keine Dateien teilen kann (siehe umgebungBewerten).
const IN_APP = [
  [/Instagram/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A|FBDV/, 'Facebook'],
  [/Messenger/i, 'Messenger'],
  [/WhatsApp/i, 'WhatsApp'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/Snapchat/i, 'Snapchat'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
  [/Pinterest/i, 'Pinterest'],
  [/\bLine\//, 'LINE'],
  [/XING/i, 'XING'],
];

export function plattform(ua, { touchPunkte = 0 } = {}) {
  const s = String(ua || '');
  if (/Android/i.test(s)) return 'android';
  if (/iPhone|iPad|iPod/.test(s)) return 'ios';
  // iPadOS gibt sich als Mac aus; Touchpunkte verraten das Tablet
  if (/Macintosh/.test(s) && touchPunkte > 1) return 'ios';
  return 'andere';
}

// Name der App, deren eingebauter Browser die Seite zeigt, sonst null.
export function inAppName(ua, { touchPunkte = 0 } = {}) {
  const s = String(ua || '');
  for (const [muster, name] of IN_APP) if (muster.test(s)) return name;
  const p = plattform(s, { touchPunkte });
  // Android WebView: "; wv)" im User-Agent
  if (p === 'android' && /;\s*wv\)/.test(s)) return 'App';
  // iOS WKWebView ohne "Safari/": eingebettete Ansicht einer App (Safari, Chrome, Firefox tragen es)
  if (p === 'ios' && /AppleWebKit/.test(s) && !/Safari\//.test(s)) return 'App';
  return null;
}

// Fasst Feature-Tests und den User-Agent-Hinweis zusammen.
//   teilenDateien: navigator.canShare({files}) ist wahr
//   touch: (hover: none) and (pointer: coarse)
// Ergebnis: weg 'teilen' (Handy-Pakete) oder 'zip'; hinweisApp: App-Name, wenn "Im Browser öffnen"
// angezeigt werden soll (nur wenn Teilen fehlt, denn sonst klappt das Sichern auch in der App).
export function umgebungBewerten({ ua, teilenDateien = false, touch = false, touchPunkte = 0 }) {
  const p = plattform(ua, { touchPunkte });
  const app = inAppName(ua, { touchPunkte });
  const weg = teilenDateien && touch ? 'teilen' : 'zip';
  return {
    plattform: p,
    weg,
    touch: Boolean(touch),
    inApp: app,
    hinweisApp: app && weg !== 'teilen' ? app : null,
  };
}

// Android: Seite im Standardbrowser öffnen (Intent ohne festes Paket, das System wählt den Browser).
// Der Code steht nie darin, ein Fragment kann ein Intent-Link nicht weitergeben.
export function intentAdresse(href) {
  try {
    const u = new URL(href);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.slice(0, -1)};action=android.intent.action.VIEW;end`;
  } catch {
    return null;
  }
}

// Link zum Kopieren: mit Code, wenn er in dieser Seitenansicht eingegeben oder mitgebracht wurde.
export function galerieLink(origin, code) {
  const basis = `${String(origin || '').replace(/\/+$/, '')}/`;
  return code && codeFormGueltig(code) ? `${basis}#c=${code}` : basis;
}

// Streuung der Wartezeit, damit viele Geräte nach einer Störung nicht im Gleichtakt anfragen
export function wartezeit(versuch, zufall = Math.random) {
  const basis = WIEDERHOLUNGEN[Math.min(versuch, WIEDERHOLUNGEN.length - 1)];
  return Math.round(basis * (0.8 + zufall() * 0.4));
}

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

// Teilt die Fotos eines Rasters in Zeilen: Wird eine Zeile zu breit, entscheidet die Abweichung von der
// Zielhöhe, ob das nächste Foto noch hineingestaucht oder die Zeile ohne es gestreckt wird. Die letzte
// Zeile wird nur gestreckt, wenn sie fast voll ist. Ergebnis: [start, ende, summeV, letzte]
export function zeilenBilden(vs, breite, luecke, hoehe) {
  const zeilen = [];
  let start = 0;
  let summe = 0;
  for (let i = 0; i < vs.length; i += 1) {
    summe += vs[i];
    const n = i - start + 1;
    if (summe * hoehe + luecke * (n - 1) < breite) continue;
    const mit = (breite - luecke * (n - 1)) / (summe * hoehe);
    const ohne = n > 1 ? (breite - luecke * (n - 2)) / ((summe - vs[i]) * hoehe) : Infinity;
    if (n > 1 && Math.abs(Math.log(ohne)) < Math.abs(Math.log(mit))) {
      zeilen.push([start, i - 1, summe - vs[i], false]);
      start = i;
      summe = vs[i];
      if (summe * hoehe >= breite) {
        zeilen.push([i, i, summe, false]);
        start = i + 1;
        summe = 0;
      }
    } else {
      zeilen.push([start, i, summe, false]);
      start = i + 1;
      summe = 0;
    }
  }
  if (start < vs.length) zeilen.push([start, vs.length - 1, summe, true]);
  return zeilen;
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

// Kapitel nach Tagen gliedern, wenn jeder Kapiteltitel mit einem Wochentag beginnt
// („Mittwoch · Tag“, „Mittwoch · Abend“). Das Datum eines Tages kommt aus den Aufnahmezeiten
// (häufigstes Datum mit passendem Wochentag). Ergebnis je Kapitelindex oder null, wenn nicht gliederbar.
const WOCHENTAGE = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
const TAG_MUSTER = /^\s*(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b\s*(?:[·•\-\u2013\u2014,:|/]\s*)?(.*)$/i;
const TEIL_TEXT = { tag: 'Am Tag', morgen: 'Am Morgen', mittag: 'Am Mittag', nachmittag: 'Am Nachmittag', abend: 'Am Abend', nacht: 'In der Nacht' };
export function tageGliedern(kapitel) {
  if (!Array.isArray(kapitel)) return null;
  const mitBildern = kapitel.map((k, i) => ({ k, i })).filter(({ k }) => k?.bilder?.length);
  if (!mitBildern.length) return null;
  const treffer = mitBildern.map(({ k }) => TAG_MUSTER.exec(k.titel || ''));
  if (treffer.some((m) => !m)) return null;
  const ergebnis = kapitel.map(() => null);
  let vorher = null;
  let nr = 0;
  const tagDaten = new Map();
  mitBildern.forEach(({ k, i }, j) => {
    const wt = treffer[j][1].toLowerCase();
    const teil = treffer[j][2].trim();
    const zaehler = tagDaten.get(wt) || new Map();
    for (const b of k.bilder) {
      const d = typeof b.aufnahme === 'string' ? b.aufnahme.slice(0, 10) : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const [y, m, t] = d.split('-').map(Number);
      if (WOCHENTAGE[new Date(Date.UTC(y, m - 1, t)).getUTCDay()] !== wt) continue;
      zaehler.set(d, (zaehler.get(d) || 0) + 1);
    }
    tagDaten.set(wt, zaehler);
    const neuerTag = wt !== vorher;
    if (neuerTag) nr += 1;
    vorher = wt;
    ergebnis[i] = { tag: wt[0].toUpperCase() + wt.slice(1), teil, teilText: TEIL_TEXT[teil.toLowerCase()] || teil, neuerTag, tagNr: nr };
  });
  for (const e of ergebnis) {
    if (!e) continue;
    const zaehler = tagDaten.get(e.tag.toLowerCase());
    const beste = [...(zaehler || new Map())].sort((a, b) => b[1] - a[1])[0];
    e.datum = beste ? beste[0] : null;
  }
  return ergebnis;
}

// „23. September 2026“ aus „2026-09-23“ (ohne Zeitzonenverschiebung)
export function tagDatumText(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return '';
  const [y, m, t] = d.split('-').map(Number);
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, t)));
}
