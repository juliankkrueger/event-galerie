// Event-Galerie: Gäste-Oberfläche. Vanilla JS, ES2020-Module, keine Abhängigkeiten außer client-zip.
import {
  bilderFlach, bildHandy, bildMitSitzung, codeAusHash, codeFormGueltig, codeFormHinweis, codeNormalisieren, datumLang, eventSeiteAusHost,
  fotos, galerieLink, groesse, httpsAdresse, intentAdresse, namensVergeber, paketeBilden, retryAfterSekunden, seitenverhaeltnis, wartezeitText,
  sitzungsWert, tagDatumText, tageGliedern, zahl, zeilenBilden, zipName, zipTeileBilden, ZIP_MAX_BILDER, ZIP_MAX_BYTES, ZIP_MAX_BYTES_SPEICHER, ZIP_MAX_BYTES_SPEICHER_HANDY,
} from './werkzeuge.js';
import {
  blobSpeichern, dateiauswahlOeffnen, dienstAnmelden, inDateiSchreiben, originalAlsBlob,
  paketLaden, speicherWeg, ueberDienstSpeichern, umgebung, zipEintraege, zipStrom, zipVorladen,
} from './sichern.js';
import { ansichtEinrichten } from './ansicht.js';

const $ = (id) => document.getElementById(id);
const NETZ_WEG = 'Keine Verbindung. Es geht automatisch weiter, sobald du wieder online bist.';

const zustand = {
  status: null,
  manifest: null,
  bilder: [],
  nachId: new Map(),
  gewaehlt: new Set(),
  umgebung: null,
  weg: 'zip', // 'teilen' (Handy-Pakete), 'laden' (Fotos als Dateien), 'zip'
  handy: false, // Teilen-Menü mit Dateien verfügbar
  touch: false,
  code: null, // Code dieser Seitenansicht, nur für "Link kopieren" im App-Hinweis
  arbeit: null, // laufender ZIP-, Teilen- oder Lade-Vorgang
  ansicht: null,
  kacheln: new Map(),
};

// ---------- Netz ----------

async function api(pfad, optionen = {}) {
  return fetch(pfad, { credentials: 'same-origin', cache: 'no-store', ...optionen });
}

// ---------- Farbschema ----------

// Helle Marken (Grund mit hoher Leuchtdichte) bekommen color-scheme: light und dunkle Schatten.
function farbschemaSetzen() {
  const wert = getComputedStyle(document.documentElement).getPropertyValue('--grund').trim();
  const m = /^#([0-9a-f]{6})$/i.exec(wert);
  if (!m) return;
  const kanal = (i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * kanal(0) + 0.7152 * kanal(2) + 0.0722 * kanal(4);
  if (l > 0.4) document.documentElement.dataset.hell = '';
}

// ---------- Marke ----------

// Links aus /assets/marke.json (schreibt der Bau aus marken/<id>/marke.json). Ohne Datei bleiben die
// Links aus index.html stehen und die Event-Seite wird aus der Domain abgeleitet (fotos.x.de -> x.de).
let eventSeite = eventSeiteAusHost(location.hostname);
let markenGruss = '';
let dekor = null;
let untertitelText = '';
const DEKOR_DATEI = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const dekorPfad = (f) => (DEKOR_DATEI.test(f || '') ? `/assets/marke/${f}` : '');
function setzeGruss() {
  const el = $('galerie-gruss');
  if (!el) return;
  // Mit Band steht der Dank dort, nicht doppelt im Kopf
  const imBand = Boolean(dekor?.band);
  el.textContent = markenGruss;
  el.hidden = !markenGruss || imBand;
}
function bildSetzen(id, datei) {
  const bild = $(id);
  const pfad = dekorPfad(datei);
  if (!bild || !pfad) return false;
  bild.src = pfad;
  bild.hidden = false;
  return true;
}
function dekorSetzen() {
  if (!dekor) return;
  document.documentElement.classList.add('mit-dekor');
  const band = dekor.band;
  if (band && typeof band.zeile === 'string' && band.zeile.trim()) {
    $('band-zeile').textContent = band.zeile.trim().slice(0, 80);
    bildSetzen('band-zeichen', band.zeichen);
    if ($('band-zeichen').hidden === false) $('band-zeichen').alt = '';
    const zweige = Array.isArray(dekor.zweige) ? dekor.zweige : [];
    bildSetzen('band-zweig-1', zweige[0]);
    bildSetzen('band-zweig-2', zweige[1] || zweige[0]);
    $('band').hidden = false;
  }
  if (bildSetzen('fuss-zeichen', dekor.fusszeichen) || dekor.claim) {
    if (typeof dekor.claim === 'string' && dekor.claim.trim()) {
      $('fuss-claim').textContent = dekor.claim.trim().slice(0, 120);
      $('fuss-claim').hidden = false;
    }
    $('fuss-marke').hidden = false;
  }
  bandOrtSetzen();
  setzeGruss();
}
function bandOrtSetzen() {
  if (!$('band-ort')) return;
  $('band-ort-text').textContent = untertitelText;
  $('band-ort').hidden = !untertitelText;
}

async function markeLaden() {
  try {
    const antwort = await fetch('/assets/marke.json', { credentials: 'same-origin', cache: 'no-cache' });
    if (!antwort.ok) return;
    const m = await antwort.json();
    const impressum = httpsAdresse(m.impressum);
    const datenschutz = httpsAdresse(m.datenschutz);
    if (impressum) $('link-impressum').href = impressum;
    if (datenschutz) $('link-datenschutz').href = datenschutz;
    eventSeite = httpsAdresse(m.eventSeite) || eventSeite;
    if (typeof m.gruss === 'string' && m.gruss.trim()) {
      markenGruss = m.gruss.trim().slice(0, 140);
      setzeGruss();
    }
    if (m.dekor && typeof m.dekor === 'object') {
      dekor = m.dekor;
      dekorSetzen();
    }
  } catch {
    // Fuß und Event-Link bleiben wie in index.html
  } finally {
    if (eventSeite) {
      $('link-event').href = eventSeite;
      $('link-event').hidden = false;
    }
  }
}

// ---------- Bühnenbild ----------

// Marken-Hintergrund für den Kopf kommt als CSS-Variable aus assets/marke.css. Ohne ihn zeigt die
// Galerie ihr erstes Foto, stark abgedunkelt, damit Titel und Text sicher lesbar bleiben.
function hatKopfbild() {
  return /url\(/.test(getComputedStyle(document.documentElement).getPropertyValue('--hintergrund-kopf'));
}

let buehneBeobachter = null;
function buehneMessen() {
  const wurzel = document.documentElement;
  if (document.body.dataset.zustand !== 'galerie') {
    wurzel.style.removeProperty('--buehne-h');
    wurzel.style.removeProperty('--text-oben');
    return;
  }
  const kopf = $('galerie-kopf').getBoundingClientRect();
  const oben = $('galerie-kopf').querySelector('.galerie-oberzeile').getBoundingClientRect();
  const y = window.scrollY;
  wurzel.style.setProperty('--buehne-h', `${Math.round(kopf.bottom + y + 48)}px`);
  wurzel.style.setProperty('--text-oben', `${Math.round(oben.top + y - 16)}px`);
}

// Messen erst im nächsten Bild: Schreibt der Beobachter sofort, meldet WebKit eine
// "ResizeObserver loop"-Warnung als Seitenfehler.
let buehneGeplant = false;
function buehnePlanen() {
  if (buehneGeplant) return;
  buehneGeplant = true;
  requestAnimationFrame(() => {
    buehneGeplant = false;
    buehneMessen();
  });
}

function buehneBeobachten() {
  if (buehneBeobachter || !('ResizeObserver' in window)) return;
  buehneBeobachter = new ResizeObserver(buehnePlanen);
  buehneBeobachter.observe($('galerie-kopf'));
  window.addEventListener('resize', buehnePlanen, { passive: true });
}

function titelbildSetzen(b) {
  const img = $('titelbild');
  if (!b || hatKopfbild()) {
    img.hidden = true;
    img.removeAttribute('src');
    return;
  }
  img.hidden = false;
  img.classList.remove('da');
  // Erst die Rasterfassung (liegt schon im Cache), dann die große, wenn der Bildschirm sie braucht
  img.onload = () => img.classList.add('da');
  img.src = b.r;
  if (img.complete && img.naturalWidth) img.classList.add('da');
  const bedarf = window.innerWidth * (window.devicePixelRatio || 1);
  if (bedarf > 900 && b.g) {
    const gross = new Image();
    gross.decoding = 'async';
    if ('fetchPriority' in gross) gross.fetchPriority = 'low';
    gross.onload = () => { if (img.src.endsWith(b.r.split('/').pop())) img.src = b.g; };
    // Erst laden, wenn die Rasterbilder der ersten Zeilen unterwegs sind
    setTimeout(() => { gross.src = b.g; }, 1200);
  }
}

// ---------- Hinweis für eingebaute App-Browser ----------

function appHinweis() {
  const u = zustand.umgebung;
  const box = $('app-hinweis');
  if (!u?.hinweisApp) {
    box.hidden = true;
    return;
  }
  const app = u.hinweisApp === 'App' ? 'dieser App' : u.hinweisApp;
  const oeffnen = $('app-hinweis-oeffnen');
  if (u.plattform === 'android') {
    $('app-hinweis-text').textContent = `In der Ansicht von ${app} lassen sich Fotos meist nicht speichern. Öffne die Galerie in Chrome oder deinem Standardbrowser, dort klappt es.`;
    const ziel = intentAdresse(location.href);
    oeffnen.hidden = !ziel;
    if (ziel) oeffnen.href = ziel;
  } else if (u.plattform === 'ios') {
    $('app-hinweis-text').textContent = `In der Ansicht von ${app} lassen sich Fotos meist nicht speichern. Tippe oben oder unten auf die drei Punkte bzw. das Teilen-Symbol und wähle „In Safari öffnen“ oder „Im Browser öffnen“.`;
    oeffnen.hidden = true;
  } else {
    $('app-hinweis-text').textContent = `In der Ansicht von ${app} lassen sich Fotos meist nicht speichern. Öffne die Galerie in deinem Browser.`;
    oeffnen.hidden = true;
  }
  appHinweisCode();
  box.hidden = false;
}

function appHinweisCode() {
  const zeile = $('app-hinweis-code');
  if (zustand.code) {
    zeile.textContent = `Dein Zugangscode: ${zustand.code}`;
    zeile.hidden = false;
  } else {
    zeile.textContent = 'Den Zugangscode findest du in der Nachricht mit dem Link.';
    zeile.hidden = false;
  }
  $('app-hinweis-link').value = galerieLink(location.origin, zustand.code);
}

async function linkKopieren() {
  const link = galerieLink(location.origin, zustand.code);
  const status = $('app-hinweis-status');
  try {
    await navigator.clipboard.writeText(link);
    status.textContent = 'Link kopiert. Füge ihn in Safari oder Chrome in die Adresszeile ein.';
  } catch {
    // Kein Zugriff auf die Zwischenablage (häufig in App-Browsern): Feld zum Markieren zeigen
    const feld = $('app-hinweis-link');
    feld.value = link;
    feld.parentElement.hidden = false;
    feld.focus();
    feld.select();
    status.textContent = 'Kopieren ging hier nicht. Der Link ist markiert, kopier ihn von Hand.';
  }
}

// ---------- Zustände ----------

const ZUSTAENDE = ['z-laedt', 'z-code', 'z-meldung', 'galerie'];

function zeige(id) {
  for (const z of ZUSTAENDE) $(z).hidden = z !== id;
  document.body.dataset.zustand = id;
  document.body.classList.remove('mit-event-knopf');
  buehneMessen();
}

function titelSetzen(titel) {
  const t = titel || 'Fotogalerie';
  document.title = `${t} · Fotos`;
  $('code-titel').textContent = t;
}

function meldung({ titel, text, erneut = false, eventLink = false }) {
  $('meldung-titel').textContent = titel;
  $('meldung-text').textContent = text;
  $('meldung-knopf').hidden = !erneut;
  $('meldung-link').hidden = !(eventLink && eventSeite);
  if (eventSeite) $('meldung-link').href = eventSeite;
  zeige('z-meldung');
  // Kein doppelter Knopf: steht "Zur Event-Seite" als Knopf da, entfällt der Link im Fuß.
  document.body.classList.toggle('mit-event-knopf', !$('meldung-link').hidden);
  // Der Titel hat tabindex="-1": Fokus dorthin, damit Screenreader den neuen Zustand vorlesen.
  $('meldung-titel').focus({ preventScroll: false });
}

function zeigeFehler() {
  meldung({
    titel: 'Das hat nicht geklappt',
    text: 'Die Galerie konnte gerade nicht geladen werden. Bitte prüf deine Verbindung und versuch es noch einmal.',
    erneut: true,
  });
}

function zeigeAbgelaufen() {
  meldung({
    titel: 'Diese Galerie ist nicht mehr online',
    text: 'Der Zeitraum zum Herunterladen der Fotos ist vorbei. Bei Fragen melde dich gern beim Veranstalter.',
    eventLink: true,
  });
}

let bremsUhr = null;

const CODE_FALSCH = 'Dieser Code passt nicht. Bitte prüf ihn und versuch es noch einmal.';

function zeigeCode({ falsch = false, meldungText = null, gebremst = null } = {}) {
  zeige('z-code');
  const feld = $('code-feld');
  const knopf = $('code-knopf');
  const text = $('code-meldung');
  const uhr = $('code-uhr');
  clearInterval(bremsUhr);
  knopf.disabled = false;
  knopf.textContent = 'Galerie öffnen';
  feld.removeAttribute('aria-invalid');
  text.textContent = '';
  uhr.hidden = true;
  uhr.textContent = '';
  if (falsch) {
    feld.setAttribute('aria-invalid', 'true');
    text.textContent = meldungText || CODE_FALSCH;
  }
  if (gebremst) {
    // Die Meldung (role=alert) wird nur zu Beginn und am Ende gesetzt. Die Restzeit steht in
    // #code-uhr ohne aria-live, sonst liest ein Screenreader jede Sekunde neu vor.
    let rest = gebremst;
    knopf.disabled = true;
    text.textContent = `Zu viele Versuche. Bitte warte ${wartezeitText(rest)} und versuch es dann noch einmal.`;
    uhr.hidden = false;
    const tick = () => {
      if (rest <= 0) {
        clearInterval(bremsUhr);
        knopf.disabled = false;
        uhr.hidden = true;
        uhr.textContent = '';
        text.textContent = 'Du kannst es jetzt wieder versuchen.';
        return;
      }
      const neu = `Noch ${wartezeitText(rest)}`;
      if (uhr.textContent !== neu) uhr.textContent = neu;
      rest -= 1;
    };
    tick();
    bremsUhr = setInterval(tick, 1000);
  }
  feld.focus();
  if (falsch) feld.select();
}

// ---------- Ablauf ----------

// Code aus #c= wartet hier, bis er an /api/zugang ging. So überlebt er "Erneut versuchen",
// steht aber nie länger als nötig in Adresse und Verlauf.
let wartenderCode = null;

function codeAusAdresseNehmen() {
  const code = codeAusHash(location.hash);
  if (code === null) return;
  wartenderCode = code;
  history.replaceState(history.state, '', location.pathname + location.search);
}

// Status für den Startbildschirm: zuerst /status.json (statisch, kein Function-Aufruf).
// Die Function /api/status fragt die Seite nur, wenn die Datei fehlt oder die Uhr des
// Geräts den Ablauf schon erreicht sieht (falsch gestellte Uhr soll nicht aussperren).
async function statusLaden() {
  try {
    const antwort = await fetch('/status.json', { credentials: 'same-origin', cache: 'no-cache' });
    if (antwort.ok && /json/.test(antwort.headers.get('Content-Type') || '')) {
      const s = await antwort.json();
      // Ohne Schlüssel "ablauf" läuft die Galerie nie ab (VERTRAG: Ablauf optional)
      const ohneAblauf = s && !('ablauf' in s);
      const ablauf = Date.parse(s?.ablauf);
      if (typeof s?.titel === 'string' && (ohneAblauf || (Number.isFinite(ablauf) && Date.now() < ablauf))) {
        return { titel: s.titel, marke: s.marke, abgelaufen: false };
      }
    }
  } catch {
    // weiter mit der Function
  }
  const antwort = await api('/api/status');
  if (!antwort.ok) throw new Error(`status ${antwort.status}`);
  return antwort.json();
}

async function starten() {
  zeige('z-laedt');
  codeAusAdresseNehmen();
  let status;
  try {
    status = await statusLaden();
  } catch {
    zeigeFehler();
    return;
  }
  zustand.status = status;
  titelSetzen(status.titel);
  await markeBereit;
  if (status.abgelaufen) {
    wartenderCode = null;
    zeigeAbgelaufen();
    return;
  }
  if (wartenderCode !== null) {
    const code = wartenderCode;
    wartenderCode = null;
    await zugangSenden(code);
    return;
  }
  await manifestLaden();
}

async function zugangSenden(code) {
  const c = codeNormalisieren(code);
  if (!c) {
    $('code-feld').value = '';
    zeigeCode({ falsch: true, meldungText: 'Bitte gib deinen Zugangscode ein.' });
    return;
  }
  if (!codeFormGueltig(c)) {
    $('code-feld').value = c;
    zeigeCode({ falsch: true, meldungText: codeFormHinweis(c) });
    return;
  }
  const knopf = $('code-knopf');
  $('code-feld').value = c;
  knopf.disabled = true;
  knopf.textContent = 'Wird geprüft …';
  $('code-meldung').textContent = '';
  let antwort;
  try {
    antwort = await api('/api/zugang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: c }),
    });
  } catch {
    knopf.disabled = false;
    zeigeFehler();
    return;
  }
  if (antwort.status === 204 || antwort.ok) {
    zustand.code = c;
    if (zustand.umgebung?.hinweisApp) appHinweisCode();
    await manifestLaden();
  } else if (antwort.status === 401 || antwort.status === 403) {
    zeigeCode({ falsch: true });
  } else if (antwort.status === 429) {
    zeigeCode({ gebremst: retryAfterSekunden(antwort.headers.get('Retry-After')) ?? 600 });
  } else if (antwort.status === 410) {
    zeigeAbgelaufen();
  } else {
    zeigeFehler();
  }
}

async function manifestLaden() {
  zeige('z-laedt');
  let antwort;
  try {
    antwort = await api('/api/manifest');
  } catch {
    zeigeFehler();
    return;
  }
  if (antwort.status === 401 || antwort.status === 403) {
    zeigeCode();
    return;
  }
  if (antwort.status === 410) {
    zeigeAbgelaufen();
    return;
  }
  if (!antwort.ok) {
    zeigeFehler();
    return;
  }
  let manifest;
  try {
    manifest = await antwort.json();
  } catch {
    zeigeFehler();
    return;
  }
  galerieAufbauen(manifest);
}

// ---------- Galerie ----------

// Tagesüberschrift wie auf den Tagesablaufkarten: „Tag 1“, Wochentag groß, Datum, Haarlinie, Zweig.
function tagKopfBauen(tag, zweige) {
  const kopf = el('div', 'tag-kopf');
  if (zweige.length) {
    const z = el('img', `tag-zweig tag-zweig-${tag.tagNr % 2 ? 'rechts' : 'links'}`);
    z.src = zweige[(tag.tagNr - 1) % zweige.length];
    z.alt = '';
    z.decoding = 'async';
    z.loading = 'lazy';
    z.setAttribute('aria-hidden', 'true');
    kopf.append(z);
  }
  const text = el('div', 'tag-kopftext');
  text.append(el('p', 'tag-ober', `Tag ${tag.tagNr}`));
  const h2 = el('h2', 'titel tag-titel', tag.tag);
  text.append(h2);
  const datum = tagDatumText(tag.datum);
  if (datum) text.append(el('p', 'tag-datum', datum));
  kopf.append(text, el('span', 'tag-linie'));
  return kopf;
}
function kapitelLinkText(tag, titel) {
  const tagZahl = tag.datum ? `${Number(tag.datum.slice(8, 10))}.` : '';
  const kurz = `${tag.tag.slice(0, 2)}${tagZahl ? ` ${tagZahl}` : ''}`;
  return tag.teil ? `${kurz} · ${tag.teil}` : kurz || titel || 'Fotos';
}

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text != null) e.textContent = text;
  return e;
}

function svgHaken() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
  svg.append(p);
  return svg;
}

const zweistellig = (n) => String(n).padStart(2, '0');

function galerieAufbauen(manifest) {
  zustand.manifest = manifest;
  // Je Seitenansicht ein Zufallswert an allen Fotopfaden (siehe mitSitzung in werkzeuge.js)
  const sitzung = sitzungsWert();
  zustand.bilder = bilderFlach(manifest).map((b) => bildMitSitzung(b, sitzung));
  zustand.nachId = new Map(zustand.bilder.map((b) => [b.id, b]));
  titelSetzen(manifest.titel || zustand.status?.titel);
  document.body.classList.toggle('handy', zustand.handy);

  if (!zustand.bilder.length) {
    meldung({
      titel: manifest.titel || 'Fotogalerie',
      text: 'In dieser Galerie sind noch keine Fotos. Schau bald noch einmal vorbei.',
      erneut: true,
    });
    return;
  }

  $('galerie-titel').textContent = manifest.titel || 'Fotogalerie';
  const untertitel = typeof manifest.untertitel === 'string' ? manifest.untertitel.trim().slice(0, 120) : '';
  $('galerie-oberzeile').textContent = untertitel || 'Fotogalerie';
  untertitelText = untertitel;
  bandOrtSetzen();
  setzeGruss();
  $('galerie-tipp').textContent = zustand.touch
    ? 'Tippe auf den Kreis, um Fotos auszuwählen.'
    : 'Klick auf den Kreis oben rechts, um ein Foto auszuwählen.';
  const kapitelMitBildern = (manifest.kapitel || []).filter((k) => k.bilder?.length);
  const info = [fotos(zustand.bilder.length)];
  if (kapitelMitBildern.length > 1) info.push(`${kapitelMitBildern.length} Kapitel`);
  const bis = datumLang(manifest.ablauf);
  if (bis) info.push(`online bis ${bis}`);
  const infoZeile = $('galerie-info');
  infoZeile.replaceChildren();
  info.forEach((teil, i) => {
    if (i) infoZeile.append(' · ');
    infoZeile.append(el('span', null, teil));
  });

  const liste = $('kapitelliste');
  const behaelter = $('kapitel');
  liste.replaceChildren();
  behaelter.replaceChildren();
  zustand.kacheln.clear();
  const gliederung = kapitelMitBildern.length > 1 ? tageGliedern(manifest.kapitel || []) : null;
  const nummern = kapitelMitBildern.length > 1 && !gliederung;
  const zweige = Array.isArray(dekor?.zweige) ? dekor.zweige.map(dekorPfad).filter(Boolean) : [];

  let lfd = 0;
  (manifest.kapitel || []).forEach((k, ki) => {
    if (!k.bilder?.length) return;
    lfd += 1;
    const tag = gliederung?.[ki] || null;
    if (tag?.neuerTag) behaelter.append(tagKopfBauen(tag, zweige));
    const bilderK = zustand.bilder.filter((b) => b.kapitel === ki);
    const abschnitt = el('section', tag ? 'kapitel kapitel-teil' : 'kapitel');
    abschnitt.id = `kapitel-${ki + 1}`;
    abschnitt.setAttribute('aria-labelledby', `kapitel-${ki + 1}-titel`);
    const kopf = el('div', 'kapitel-kopf');
    const h2 = tag
      ? el('h3', 'kapitel-titel kapitel-teiltitel', tag.teilText || tag.tag)
      : el('h2', 'titel kapitel-titel', k.titel || 'Fotos');
    h2.id = `kapitel-${ki + 1}-titel`;
    if (tag) h2.setAttribute('aria-label', [tag.tag, tag.teilText].filter(Boolean).join(', '));
    const anzahl = el('span', 'kapitel-anzahl', fotos(bilderK.length));
    const kopfText = el('div', 'kapitel-kopftext');
    if (nummern) {
      const nr = el('span', 'kapitel-nr', zweistellig(lfd));
      nr.setAttribute('aria-hidden', 'true');
      kopfText.append(nr);
    }
    kopfText.append(h2, anzahl);
    const alle = el('button', 'knopf knopf-leise knopf-klein kapitel-alle', 'Kapitel auswählen');
    alle.type = 'button';
    alle.dataset.kapitel = String(ki);
    alle.setAttribute('aria-describedby', h2.id);
    kopf.append(kopfText, alle);
    const raster = el('div', 'raster');
    raster.setAttribute('role', 'list');
    raster.setAttribute('aria-label', `Fotos: ${k.titel || 'Fotos'}. Pfeiltasten wechseln das Foto, Leertaste wählt aus, Enter öffnet es groß.`);
    const teil = document.createDocumentFragment();
    bilderK.forEach((b, i) => teil.append(kachelBauen(b, b.nr <= 4, i === 0)));
    raster.append(teil);
    abschnitt.append(kopf, raster);
    behaelter.append(abschnitt);

    const li = el('li');
    const a = el('a', 'kapitel-link');
    a.href = `#kapitel-${ki + 1}`;
    if (nummern) {
      const nr = el('span', 'kapitel-link-nr', zweistellig(lfd));
      nr.setAttribute('aria-hidden', 'true');
      a.append(nr);
    }
    a.append(document.createTextNode(tag ? kapitelLinkText(tag, k.titel) : k.titel || 'Fotos'));
    li.append(a);
    liste.append(li);
  });
  $('kapitelleiste').hidden = kapitelMitBildern.length < 2;

  zustand.ansicht = ansichtEinrichten({
    bilder: zustand.bilder,
    kapitelTitel: (ki) => (kapitelMitBildern.length > 1 ? manifest.kapitel[ki]?.titel : ''),
    istGewaehlt: (id) => zustand.gewaehlt.has(id),
    umschalten: (id) => auswahlSetzen([id], !zustand.gewaehlt.has(id)),
    // Touch ohne Teilen: die Handy-Fassung als Datei (Originale sind fürs Handy unnötig groß)
    originalLaden: zustand.touch && !zustand.handy ? handyEinzelnLaden : originalEinzeln,
    handy: zustand.handy,
    touch: zustand.touch,
    handyDateiLaden,
    kachelFokus: (id) => {
      const k = zustand.kacheln.get(id);
      if (!k) return;
      rovingSetzen(id);
      k.oeffnen.focus({ preventScroll: true });
      k.wurzel.scrollIntoView({ block: 'nearest' });
    },
  });

  zeige('galerie');
  blocksatzBeobachten();
  titelbildSetzen(zustand.bilder[0]);
  buehneBeobachten();
  kapitelBeobachten();
  leisteBeobachten();
  auswahlAnzeigen();
  // Service Worker für den ZIP-Weg (auch als Nebenweg am Handy); WebKit braucht ihn nicht
  dienstAnmelden();
  // ZIP-Bibliothek in einer ruhigen Minute vorladen, damit der Klick sofort startet
  (window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(() => zipVorladen().catch(() => {}));
  // Fokus auf den Titel (tabindex="-1") und Ansage, damit auch ohne Bildschirm klar ist, dass es weitergeht
  $('galerie-titel').focus({ preventScroll: true });
  ansagen(`${fotos(zustand.bilder.length)} geladen.`);
}

const bildBeobachter = 'IntersectionObserver' in window
  ? new IntersectionObserver((eintraege, beobachter) => {
    for (const e of eintraege) {
      if (!e.isIntersecting) continue;
      const img = e.target;
      beobachter.unobserve(img);
      img.src = img.dataset.src;
      delete img.dataset.src;
    }
  }, { rootMargin: '400px 0px' })
  : null;

function kachelBauen(b, vorne = false, tabstopp = false) {
  const wurzel = el('div', 'kachel');
  wurzel.setAttribute('role', 'listitem');
  wurzel.dataset.id = b.id;
  const v = seitenverhaeltnis(b) || 1.5;
  wurzel.style.setProperty('--v', String(Math.round(v * 10000) / 10000));

  // Roving tabindex: je Raster genau ein Tabstopp, Pfeiltasten wandern zwischen den Fotos.
  const oeffnen = el('button', 'kachel-bild');
  oeffnen.type = 'button';
  oeffnen.tabIndex = tabstopp ? 0 : -1;
  oeffnen.setAttribute('aria-label', `Foto ${b.nr} ansehen`);
  const img = el('img');
  img.alt = '';
  // Die ersten Fotos sofort laden, den Rest erst kurz bevor sie ins Bild kommen
  img.loading = vorne ? 'eager' : 'lazy';
  img.decoding = 'async';
  if (vorne && b.nr <= 2) img.fetchPriority = 'high';
  img.width = 600;
  img.height = Math.round(600 / v);
  const da = () => wurzel.classList.add('da');
  img.addEventListener('load', () => {
    da();
    if (!seitenverhaeltnis(b) && img.naturalWidth && img.naturalHeight) {
      wurzel.style.setProperty('--v', String(Math.round((img.naturalWidth / img.naturalHeight) * 10000) / 10000));
      blocksatzPlanen();
    }
  }, { once: true });
  img.addEventListener('error', () => wurzel.classList.add('fehlt', 'da'), { once: true });
  if (vorne || !bildBeobachter) {
    img.src = b.r;
    if (img.complete && img.naturalWidth) da();
  } else {
    // Erst kurz vor dem Sichtbarwerden laden. Der Browser-eigene Lazy-Abstand ist am Handy oft
    // über 1.000 px und lädt 20 Fotos auf Vorrat, die die ersten sichtbaren ausbremsen.
    img.dataset.src = b.r;
    bildBeobachter.observe(img);
  }
  oeffnen.append(img);

  // Kreis nur für Zeiger und Touch; mit Tastatur wählt die Leertaste auf dem Foto aus.
  const wahl = el('button', 'kachel-wahl');
  wahl.type = 'button';
  wahl.tabIndex = -1;
  wahl.setAttribute('aria-pressed', 'false');
  wahl.setAttribute('aria-label', `Foto ${b.nr} auswählen`);
  const kreis = el('span', 'kachel-kreis');
  kreis.append(svgHaken());
  wahl.append(kreis);

  wurzel.append(oeffnen, wahl);
  zustand.kacheln.set(b.id, { wurzel, oeffnen, wahl, nr: b.nr });
  return wurzel;
}

// ---------- Tastatur im Raster ----------

function rovingSetzen(id) {
  const k = zustand.kacheln.get(id);
  if (!k) return;
  const raster = k.wurzel.parentElement;
  for (const knopf of raster.querySelectorAll('.kachel-bild[tabindex="0"]')) knopf.tabIndex = -1;
  k.oeffnen.tabIndex = 0;
}

// Zeilen im Blocksatz-Raster sind unterschiedlich lang: Pfeil hoch/runter sucht in der Nachbarzeile
// das Foto, dessen Mitte der aktuellen am nächsten liegt.
function nachbarZeile(kacheln, i, richtung) {
  const jetzt = kacheln[i].getBoundingClientRect();
  const mitte = jetzt.left + jetzt.width / 2;
  let zeileOben = null;
  let bestes = -1;
  let abstand = Infinity;
  for (let j = i + richtung; j >= 0 && j < kacheln.length; j += richtung) {
    const r = kacheln[j].getBoundingClientRect();
    const andereZeile = richtung > 0 ? r.top > jetzt.top + 2 : r.top < jetzt.top - 2;
    if (!andereZeile) continue;
    if (zeileOben === null) zeileOben = r.top;
    if (Math.abs(r.top - zeileOben) > 2) break; // übernächste Zeile erreicht
    const d = Math.abs(r.left + r.width / 2 - mitte);
    if (d < abstand) { abstand = d; bestes = j; }
  }
  return bestes < 0 ? i : bestes;
}

function rasterTaste(e) {
  const oeffnen = e.target.closest?.('.kachel-bild');
  if (!oeffnen || e.altKey || e.ctrlKey || e.metaKey) return;
  const wurzel = oeffnen.closest('.kachel');
  const id = wurzel.dataset.id;
  if (e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault();
    if (e.type !== 'keydown' || e.repeat) return;
    const an = !zustand.gewaehlt.has(id);
    auswahlSetzen([id], an);
    ansagen(`Foto ${zustand.kacheln.get(id).nr} ${an ? 'ausgewählt' : 'abgewählt'}, ${fotos(zustand.gewaehlt.size)} insgesamt.`);
    return;
  }
  if (e.type !== 'keydown') return;
  const raster = wurzel.parentElement;
  const kacheln = [...raster.children];
  const i = kacheln.indexOf(wurzel);
  let ziel = null;
  if (e.key === 'ArrowRight') ziel = i + 1;
  else if (e.key === 'ArrowLeft') ziel = i - 1;
  else if (e.key === 'ArrowDown') ziel = nachbarZeile(kacheln, i, 1);
  else if (e.key === 'ArrowUp') ziel = nachbarZeile(kacheln, i, -1);
  else if (e.key === 'Home') ziel = 0;
  else if (e.key === 'End') ziel = kacheln.length - 1;
  else return;
  e.preventDefault();
  ziel = Math.max(0, Math.min(kacheln.length - 1, ziel));
  const neu = kacheln[ziel];
  rovingSetzen(neu.dataset.id);
  neu.querySelector('.kachel-bild').focus();
}

// ---------- Blocksatz-Raster ----------

// Zielhöhe einer Zeile je Rasterbreite (passt zu --zeile in app.css)
function zielHoehe(breite) {
  const w = window.innerWidth;
  if (w >= 1500) return 280;
  if (w >= 1000) return 236;
  if (w >= 600) return 190;
  return breite / 2.8;
}

let blocksatzGeplant = false;
function blocksatzPlanen() {
  if (blocksatzGeplant) return;
  blocksatzGeplant = true;
  requestAnimationFrame(() => {
    blocksatzGeplant = false;
    blocksatz();
  });
}

function blocksatz() {
  for (const raster of document.querySelectorAll('.raster')) {
    // Bruchteile beachten, sonst bricht eine Zeile wegen eines halben Pixels um
    const breite = raster.getBoundingClientRect().width - 0.5;
    if (breite <= 0) continue;
    const luecke = parseFloat(getComputedStyle(raster).columnGap) || 0;
    const hoehe = zielHoehe(breite);
    const kacheln = [...raster.children];
    const vs = kacheln.map((k) => Number(k.style.getPropertyValue('--v')) || 1.5);
    for (const [a, b, summe, letzte] of zeilenBilden(vs, breite, luecke, hoehe)) {
      const n = b - a + 1;
      let h = (breite - luecke * (n - 1)) / summe;
      const voll = !letzte || h <= hoehe * 1.2;
      if (!voll) h = hoehe;
      for (let i = a; i <= b; i += 1) {
        kacheln[i].style.setProperty('--w', `${Math.floor(vs[i] * h * 100) / 100}px`);
        kacheln[i].classList.toggle('zeilenende', voll && i === b);
      }
    }
    raster.classList.add('blocksatz');
  }
}

let blocksatzBeobachter = null;
function blocksatzBeobachten() {
  blocksatz();
  if (blocksatzBeobachter || !('ResizeObserver' in window)) return;
  let breite = 0;
  blocksatzBeobachter = new ResizeObserver(([e]) => {
    const neu = Math.round(e.contentRect.width);
    if (neu === breite) return;
    breite = neu;
    blocksatzPlanen();
  });
  blocksatzBeobachter.observe($('kapitel'));
}

// Zeigt an den Rändern einen Verlauf, solange die Kapitelleiste dort weiterläuft.
function kapitelRaender() {
  const liste = $('kapitelliste');
  const leiste = $('kapitelleiste');
  const rest = liste.scrollWidth - liste.clientWidth - liste.scrollLeft;
  leiste.classList.toggle('mehr-links', liste.scrollLeft > 2);
  leiste.classList.toggle('mehr-rechts', rest > 2);
}

let kapitelBeobachtet = false;
function kapitelBeobachten() {
  if (!kapitelBeobachtet) {
    $('kapitelliste').addEventListener('scroll', kapitelRaender, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(() => requestAnimationFrame(kapitelRaender)).observe($('kapitelliste'));
    kapitelBeobachtet = true;
  }
  kapitelRaender();
  const links = new Map([...document.querySelectorAll('.kapitel-link')].map((a) => [a.getAttribute('href').slice(1), a]));
  if (links.size < 2 || !('IntersectionObserver' in window)) return;
  const beobachter = new IntersectionObserver((eintraege) => {
    for (const e of eintraege) {
      if (!e.isIntersecting) continue;
      for (const a of links.values()) a.removeAttribute('aria-current');
      const a = links.get(e.target.id);
      if (a) {
        a.setAttribute('aria-current', 'true');
        const liste = $('kapitelliste');
        const x = a.offsetLeft - liste.offsetLeft;
        if (x < liste.scrollLeft || x + a.offsetWidth > liste.scrollLeft + liste.clientWidth) {
          liste.scrollTo({ left: Math.max(0, x - 24) });
        }
      }
    }
  }, { rootMargin: '-30% 0px -65% 0px' });
  for (const id of links.keys()) beobachter.observe($(id));
}

// ---------- Auswahl ----------

function auswahlSetzen(ids, an) {
  for (const id of ids) {
    if (an) zustand.gewaehlt.add(id);
    else zustand.gewaehlt.delete(id);
  }
  auswahlAnzeigen();
}

const AKTION = {
  teilen: ['In Fotos sichern', 'Sichern'],
  laden: ['Fotos laden', 'Laden'],
  zip: ['Als ZIP laden', 'ZIP laden'],
};

function auswahlAnzeigen() {
  const anzahl = zustand.gewaehlt.size;
  for (const [id, k] of zustand.kacheln) {
    const an = zustand.gewaehlt.has(id);
    if (k.wurzel.classList.contains('gewaehlt') !== an) {
      k.wurzel.classList.toggle('gewaehlt', an);
      k.wahl.setAttribute('aria-pressed', String(an));
      k.oeffnen.setAttribute('aria-label', `Foto ${k.nr} ansehen${an ? ', ausgewählt' : ''}`);
    }
  }
  document.body.classList.toggle('waehlt', anzahl > 0);

  const alleIds = zustand.bilder.map((b) => b.id);
  const alleAn = anzahl > 0 && anzahl === alleIds.length;
  $('alle-knopf').textContent = alleAn ? 'Alle abwählen' : `Alle ${fotos(alleIds.length)} auswählen`;
  for (const knopf of document.querySelectorAll('.kapitel-alle')) {
    const ki = Number(knopf.dataset.kapitel);
    const ids = zustand.bilder.filter((b) => b.kapitel === ki).map((b) => b.id);
    const an = ids.every((id) => zustand.gewaehlt.has(id));
    knopf.textContent = an ? 'Kapitel abwählen' : 'Kapitel auswählen';
  }

  const leiste = $('leiste');
  leiste.hidden = anzahl === 0 && !zustand.arbeit;
  document.body.classList.toggle('mit-leiste', !leiste.hidden);
  const gewaehlt = gewaehlteBilder();
  const zeile = $('zaehler');
  zeile.replaceChildren();
  if (anzahl) {
    const bytes = zustand.weg === 'zip'
      ? gewaehlt.reduce((s, b) => s + (b.o?.bytes || 0), 0)
      : gewaehlt.reduce((s, b) => s + (bildHandy(b)?.bytes || 0), 0);
    const zahlText = el('strong', 'zaehler-zahl', `${fotos(anzahl)} `);
    zahlText.append(el('span', 'zaehler-wort', 'ausgewählt'));
    zeile.append(zahlText);
    // Trenner " · " vor dem Rest setzt app.css (am Handy steht der Rest in einer eigenen Zeile)
    let rest = groesse(bytes);
    if (zustand.weg === 'zip' && !zustand.touch) {
      const teile = zipTeileBilden(gewaehlt, zipGrenze()).length;
      rest += teile > 1 ? ` · ${zahl(teile)} ZIP-Dateien (je max. ${ZIP_MAX_BILDER} Fotos)` : ` · max. ${ZIP_MAX_BILDER} je ZIP`;
    }
    zeile.append(el('span', 'zaehler-rest', rest));
  }
  knopfBeschriften($('aktion-knopf'), AKTION[zustand.weg]);
  zustand.ansicht?.aktualisieren();
  if (zustand.arbeit && zustand.arbeit.art !== 'zip' && !zustand.arbeit.laeuft) {
    // Auswahl hat sich geändert: vorbereitete Pakete passen nicht mehr
    arbeitBeenden();
  }
}

// Langer Text als Name (aria-label), kurzer nur sichtbar auf schmalen Bildschirmen.
function knopfBeschriften(knopf, [lang, kurz]) {
  knopf.setAttribute('aria-label', lang);
  knopf.querySelector('.text-lang').textContent = lang;
  knopf.querySelector('.text-kurz').textContent = kurz;
}

// Die Leiste ist fest unten; der Seitenfuß bekommt genau ihre Höhe als Abstand.
let leisteBeobachter = null;
function leisteBeobachten() {
  if (leisteBeobachter || !('ResizeObserver' in window)) return;
  let geplant = false;
  leisteBeobachter = new ResizeObserver(() => {
    if (geplant) return;
    geplant = true;
    requestAnimationFrame(() => {
      geplant = false;
      const h = $('leiste').hidden ? 0 : Math.ceil($('leiste').getBoundingClientRect().height);
      document.documentElement.style.setProperty('--leiste-hoehe', `${h}px`);
    });
  });
  leisteBeobachter.observe($('leiste'));
}

function gewaehlteBilder() {
  return zustand.bilder.filter((b) => zustand.gewaehlt.has(b.id));
}

function zipGrenze() {
  if (speicherWeg() !== 'speicher') return ZIP_MAX_BYTES;
  return zustand.touch ? ZIP_MAX_BYTES_SPEICHER_HANDY : ZIP_MAX_BYTES_SPEICHER;
}

function ansagen(text) {
  const a = $('ansage');
  a.textContent = '';
  setTimeout(() => { a.textContent = text; }, 30);
}

// ---------- Panel über der Leiste ----------

function panelZeigen({ titel, text = '', fortschritt = null }) {
  $('panel').hidden = false;
  $('panel-titel').textContent = titel;
  $('panel-text').textContent = text;
  const p = $('panel-fortschritt');
  p.hidden = fortschritt == null;
  if (fortschritt != null) p.value = Math.round(fortschritt * 100);
}

function panelText(text) {
  $('panel-text').textContent = text;
}

function panelFortschritt(anteil) {
  const p = $('panel-fortschritt');
  p.hidden = false;
  p.value = Math.round(Math.min(1, Math.max(0, anteil)) * 100);
}

// Während ein Panel offen ist, trägt es die Knöpfe; die Leiste zeigt nur den Zähler.
function arbeitSetzen(arbeit) {
  zustand.arbeit = arbeit;
  $('leiste').classList.toggle('arbeitet', Boolean(arbeit));
}

// Läuft ein Vorgang, gibt es „Abbrechen“, sonst nur das Schließen-Kreuz.
function panelLaeuft(laeuft) {
  $('panel-zu').hidden = laeuft;
  $('panel-abbrechen').hidden = !laeuft;
}

// Der eine Nebenweg im Fenster: iPhone und iPad "Originale als ZIP", Android "in Downloads laden".
function nebenwegZeigen(an) {
  const k = $('zip-neben');
  if (!an) { k.hidden = true; return; }
  const android = zustand.umgebung?.plattform === 'android';
  if (zustand.weg === 'teilen' && android) {
    k.textContent = 'Stattdessen in Downloads laden';
    k.dataset.weg = 'laden';
  } else {
    k.textContent = 'Originale stattdessen als ZIP laden';
    k.dataset.weg = 'zip';
  }
  k.hidden = false;
}

function aktionKnopf({ text, an = true, klick = null }) {
  const k = $('panel-aktion');
  k.hidden = false;
  k.disabled = !an;
  k.textContent = text;
  k.onclick = klick;
  return k;
}

function arbeitBeenden() {
  const a = zustand.arbeit;
  a?.abbruch?.abort();
  // Vorbereitete Dateien freigeben (Speicher am Handy)
  if (a?.pakete) for (const p of a.pakete) { p.dateien = null; p.blobs = null; }
  clearTimeout(a?.haenger);
  arbeitSetzen(null);
  $('panel').hidden = true;
  $('panel-liste').replaceChildren();
  $('panel-aktion').hidden = true;
  $('panel-aktion').onclick = null;
  $('zip-neben').hidden = true;
  panelLaeuft(false);
  $('aktion-knopf').disabled = false;
  $('leiste').hidden = zustand.gewaehlt.size === 0;
  document.body.classList.toggle('mit-leiste', !$('leiste').hidden);
}

// ---------- ZIP ----------

function zipStarten() {
  const bilder = gewaehlteBilder();
  if (!bilder.length) return;
  const weg = speicherWeg();
  const grenze = zipGrenze();
  const teile = zipTeileBilden(bilder, grenze);
  // Namen über alle Teile hinweg eindeutig
  const eintraege = zipEintraege(bilder, zustand.manifest.erstellt);
  const nachBild = new Map(eintraege.map((e) => [e.bild.id, e]));
  const arbeit = {
    art: 'zip', weg, laeuft: false, abbruch: null,
    teile: teile.map((t, i) => ({ nr: i + 1, eintraege: t.bilder.map((b) => nachBild.get(b.id)), bytes: t.bytes, fertig: false })),
  };
  arbeitSetzen(arbeit);
  const titel = zustand.manifest.titel;
  const hinweise = [];
  if (weg === 'speicher') {
    hinweise.push(zustand.touch
      ? `Dein Browser baut die ZIP im Arbeitsspeicher, darum höchstens ${groesse(grenze)} je Datei.`
      : `Dein Browser baut die ZIP im Arbeitsspeicher, darum höchstens ${groesse(grenze)} je Datei. Am Rechner mit Chrome oder Edge geht es schneller.`);
  }
  if (zustand.touch) hinweise.push('Die ZIP landet in deinen Downloads. Öffne sie dort, um die Fotos zu entpacken.');
  const hinweis = hinweise.join(' ');

  if (teile.length === 1) {
    // Direkt im Klick starten (Dateiauswahl braucht die Nutzeraktivierung)
    zipTeilLaden(arbeit, arbeit.teile[0], zipName(titel, 1, 1), hinweis);
    return;
  }
  panelZeigen({
    titel: `${zahl(teile.length)} ZIP-Dateien`,
    text: `Deine Auswahl wird in ${zahl(teile.length)} ZIP-Dateien aufgeteilt (je höchstens ${ZIP_MAX_BILDER} Fotos und ${groesse(grenze)}). Lade sie nacheinander. ${hinweis}`.trim(),
  });
  const liste = $('panel-liste');
  liste.replaceChildren();
  for (const t of arbeit.teile) {
    const li = el('li', 'panel-eintrag');
    li.append(el('span', 'panel-eintrag-text', `Teil ${t.nr} · ${fotos(t.eintraege.length)} · ${groesse(t.bytes)}`));
    const k = el('button', 'knopf knopf-leise knopf-klein', `Teil ${t.nr} laden`);
    k.type = 'button';
    k.addEventListener('click', () => zipTeilLaden(arbeit, t, zipName(titel, t.nr, teile.length), hinweis, k));
    t.knopf = k;
    li.append(k);
    liste.append(li);
  }
  panelLaeuft(false);
  arbeit.teile[0].knopf.focus();
}

async function zipTeilLaden(arbeit, teil, name, hinweis, knopf) {
  if (arbeit.laeuft) return;
  $('panel-aktion').hidden = true;
  let griff = null;
  if (arbeit.weg === 'dateiauswahl') {
    try {
      griff = await dateiauswahlOeffnen(name);
    } catch (e) {
      if (e?.name === 'AbortError') {
        if (arbeit.teile.length === 1) arbeitBeenden();
        return;
      }
      arbeit.weg = 'dienst';
    }
  }
  arbeit.laeuft = true;
  arbeit.abbruch = new AbortController();
  const signal = arbeit.abbruch.signal;
  for (const t of arbeit.teile) if (t.knopf) t.knopf.disabled = true;
  $('aktion-knopf').disabled = true;
  const vorsilbe = arbeit.teile.length > 1 ? `Teil ${teil.nr} von ${arbeit.teile.length}: ` : '';
  panelZeigen({ titel: 'ZIP wird erstellt', text: `${vorsilbe}${fotos(teil.eintraege.length)} werden geladen. ${hinweis}`.trim(), fortschritt: 0 });
  panelLaeuft(true);
  $('panel-abbrechen').focus();
  ansagen(`ZIP wird erstellt, ${fotos(teil.eintraege.length)}.`);
  let zuletztAnsage = -1;
  const zuletztText = { prozent: -1, zeit: 0 };
  let offline = false;
  const beiWarten = (an) => {
    offline = an;
    if (an) panelText(NETZ_WEG);
  };
  const beiBytes = (bytes, gesamt) => {
    const anteil = gesamt ? bytes / gesamt : 0;
    panelFortschritt(anteil);
    if (!offline) panelText(zipFortschrittText(vorsilbe, bytes, gesamt, zuletztText));
    // Vorlesen nur in 10-%-Schritten
    const zehner = Math.floor(anteil * 10) * 10;
    if (zehner !== zuletztAnsage) {
      zuletztAnsage = zehner;
      if (zehner > 0 && zehner < 100) ansagen(`${zehner} Prozent`);
    }
  };
  try {
    const { strom, laenge } = await zipStrom(teil.eintraege, signal, beiBytes, beiWarten);
    if (griff) {
      await inDateiSchreiben(griff, strom, signal);
    } else if (arbeit.weg === 'dienst') {
      try {
        await ueberDienstSpeichern(strom, name, laenge, signal);
      } catch (e) {
        if (e?.message !== 'kein-dienst') throw e;
        // Kein Service Worker aktiv: über den Arbeitsspeicher, solange es passt
        if (laenge > zipGrenzeSpeicher()) throw new Error('zu-gross');
        arbeit.weg = 'speicher';
        blobSpeichern(await new Response((await zipStrom(teil.eintraege, signal, beiBytes, beiWarten)).strom).blob(), name);
      }
    } else {
      blobSpeichern(await new Response(strom).blob(), name);
    }
    teil.fertig = true;
    panelFortschritt(1);
    const offen = arbeit.teile.filter((t) => !t.fertig).length;
    const text = offen
      ? `Teil ${teil.nr} ist gespeichert. Noch ${zahl(offen)} ${offen === 1 ? 'Teil' : 'Teile'} offen.`
      : `Fertig. ${arbeit.teile.length > 1 ? 'Alle ZIP-Dateien sind' : 'Die ZIP-Datei ist'} gespeichert.`;
    panelZeigen({ titel: offen ? 'ZIP gespeichert' : 'Fertig', text, fortschritt: offen ? null : 1 });
    ansagen(text);
    if (knopf) knopf.textContent = `Teil ${teil.nr} gespeichert`;
  } catch (e) {
    zustand.letzterFehler = `${e?.name || ''} ${e?.message || e}`.trim(); // nur für Fehlersuche (window.__galerie)
    if (e?.name === 'AbortError' || signal.aborted) {
      panelZeigen({ titel: 'Abgebrochen', text: 'Der Download wurde abgebrochen. Du kannst ihn jederzeit neu starten.' });
      ansagen('Download abgebrochen.');
    } else if (e?.message === 'zu-gross') {
      panelZeigen({ titel: 'Zu groß für diesen Browser', text: `Bitte wähl weniger Fotos aus (höchstens ${groesse(zipGrenzeSpeicher())}) oder nutz Chrome oder Edge am Rechner.` });
    } else {
      const fertige = arbeit.teile.filter((t) => t.fertig).length;
      panelZeigen({
        titel: 'Das hat nicht geklappt',
        text: `Beim Laden der Fotos ist die Verbindung mehrfach abgerissen. Prüf deine Verbindung und tippe auf „Erneut versuchen“.${fertige ? ' Bereits gespeicherte Teile bleiben gespeichert.' : ''}`,
      });
      ansagen('Fehler beim Erstellen der ZIP.');
      // Neuer Klick = neue Nutzeraktivierung (Dateiauswahl braucht sie)
      aktionKnopf({ text: 'Erneut versuchen', klick: () => zipTeilLaden(arbeit, teil, name, hinweis, knopf) });
    }
  } finally {
    arbeit.laeuft = false;
    arbeit.abbruch = null;
    panelLaeuft(false);
    if (zustand.arbeit === arbeit) {
      if (!$('panel-aktion').hidden) $('panel-aktion').focus();
      else $('panel-zu').focus();
    }
    $('aktion-knopf').disabled = false;
    for (const t of arbeit.teile) if (t.knopf) t.knopf.disabled = t.fertig;
  }
}

function zipGrenzeSpeicher() {
  return zustand.touch ? ZIP_MAX_BYTES_SPEICHER_HANDY : ZIP_MAX_BYTES_SPEICHER;
}

// Text bei jedem vollen Prozent, sonst höchstens alle 500 ms neu. Unter 1 MB noch keine Bytezahl.
function zipFortschrittText(vorsilbe, bytes, gesamt, zuletzt) {
  const prozent = gesamt ? Math.floor((bytes / gesamt) * 100) : 0;
  const jetzt = performance.now();
  if (prozent === zuletzt.prozent && jetzt - zuletzt.zeit < 500 && zuletzt.text) return zuletzt.text;
  zuletzt.prozent = prozent;
  zuletzt.zeit = jetzt;
  zuletzt.text = bytes < 1e6
    ? `${vorsilbe}ZIP wird gestartet …`
    : `${vorsilbe}${groesse(bytes)} von ${groesse(gesamt)} (${prozent} %)`;
  return zuletzt.text;
}

// ---------- Handy: Pakete teilen (iPhone, Android) oder als Dateien laden ----------

// Pakete zu höchstens 10 Fotos werden VOR dem Tippen geladen; das Teilen-Menü bzw. der Download
// startet synchron im Klick, damit die Nutzeraktivierung gilt. Höchstens das aktuelle und das
// nächste Paket liegen im Speicher.
const PAKET = {
  teilen: { titel: 'In Fotos sichern', verb: 'sichern', fertig: 'weitergegeben' },
  laden: { titel: 'Fotos laden', verb: 'laden', fertig: 'geladen' },
};

function paketeStarten(art) {
  const bilder = gewaehlteBilder();
  if (!bilder.length) return;
  const pakete = paketeBilden(bilder).map((p, i) => ({ ...p, nr: i + 1, dateien: null, blobs: null, laden: null, fertig: false }));
  const arbeit = {
    art, pakete, aktuell: 0, laeuft: false, abbruch: new AbortController(), vergeben: namensVergeber(), versuchNr: 0, haenger: null,
  };
  arbeitSetzen(arbeit);
  panelLaeuft(false);
  $('panel-liste').replaceChildren();
  paketVorbereiten(arbeit, 0);
}

function paketKnopfText(arbeit) {
  const p = arbeit.pakete[arbeit.aktuell];
  return `Paket ${p.nr} von ${arbeit.pakete.length} ${PAKET[arbeit.art].verb}`;
}

function bisherText(arbeit) {
  const gesichert = arbeit.pakete.filter((x) => x.fertig).reduce((s, x) => s + x.bilder.length, 0);
  if (!gesichert) return '';
  const gesamt = arbeit.pakete.reduce((s, x) => s + x.bilder.length, 0);
  return ` Bisher ${zahl(gesichert)} von ${fotos(gesamt)} ${PAKET[arbeit.art].fertig}.`;
}

function paketVorbereiten(arbeit, i) {
  const p = arbeit.pakete[i];
  if (!p || p.fertig || p.dateien) return p?.laden;
  if (p.laden) {
    if (arbeit.aktuell === i) panelZeigenPaket(arbeit);
    return p.laden;
  }
  let offline = false;
  p.laden = paketLaden(p, arbeit.vergeben, arbeit.abbruch.signal, (fertig, gesamt) => {
    if (arbeit.aktuell === i && zustand.arbeit === arbeit && !offline) {
      panelText(`Paket ${p.nr} von ${arbeit.pakete.length} wird vorbereitet: ${fertig} von ${gesamt} Fotos geladen.`);
      panelFortschritt(fertig / gesamt);
    }
  }, (an) => {
    offline = an;
    if (an && arbeit.aktuell === i && zustand.arbeit === arbeit) panelText(NETZ_WEG);
  }).then((dateien) => {
    p.laden = null;
    if (zustand.arbeit !== arbeit) return null;
    p.dateien = dateien;
    if (arbeit.aktuell === i) paketBereit(arbeit);
    return dateien;
  }).catch((e) => {
    p.laden = null;
    if (zustand.arbeit !== arbeit || arbeit.abbruch.signal.aborted) return null;
    if (arbeit.aktuell === i) {
      const geladen = e?.geladen ?? 0;
      panelZeigen({
        titel: 'Das hat nicht geklappt',
        text: `Paket ${p.nr} konnte nicht vollständig geladen werden (${geladen} von ${fotos(p.bilder.length)}). Prüf deine Verbindung und tippe auf „Erneut versuchen“. Schon geladene Fotos bleiben erhalten.`,
        fortschritt: geladen / p.bilder.length,
      });
      ansagen(`Paket ${p.nr} konnte nicht geladen werden.`);
      aktionKnopf({ text: 'Erneut versuchen', klick: () => { panelZeigenPaket(arbeit); paketVorbereiten(arbeit, i); } }).focus();
    }
    return null;
  });
  if (arbeit.aktuell === i) panelZeigenPaket(arbeit);
  return p.laden;
}

function panelZeigenPaket(arbeit) {
  nebenwegZeigen(true);
  const p = arbeit.pakete[arbeit.aktuell];
  const geladen = p.blobs ? p.blobs.filter(Boolean).length : 0;
  panelZeigen({
    titel: PAKET[arbeit.art].titel,
    text: `Paket ${p.nr} von ${arbeit.pakete.length} wird vorbereitet.`,
    fortschritt: geladen / p.bilder.length,
  });
  aktionKnopf({ text: paketKnopfText(arbeit), an: false, klick: () => paketAusfuehren(arbeit) });
}

function paketBereit(arbeit) {
  const p = arbeit.pakete[arbeit.aktuell];
  const gesamt = arbeit.pakete.length;
  const anleitung = arbeit.art === 'teilen'
    ? 'Tippe auf den Knopf und wähle im Teilen-Menü „Bilder sichern“ oder deine Galerie.'
    : 'Tippe auf den Knopf. Die Fotos landen in deinen Downloads und erscheinen von dort auch in deiner Galerie. Fragt dein Browser, ob die Seite mehrere Dateien laden darf, tippe auf „Zulassen“.';
  const viele = gesamt > 5 && p.nr === 1 ? ' Bei sehr vielen Fotos geht es am Rechner schneller, dort lädst du alles als ZIP.' : '';
  panelZeigen({
    titel: PAKET[arbeit.art].titel,
    text: `Paket ${p.nr} von ${gesamt} ist bereit (${fotos(p.dateien.length)}). ${anleitung}${bisherText(arbeit)}${viele}`,
    fortschritt: 1,
  });
  const k = aktionKnopf({ text: paketKnopfText(arbeit), klick: () => paketAusfuehren(arbeit) });
  ansagen(`Paket ${p.nr} von ${gesamt} ist bereit.`);
  // Chromium verwirft eine zweite Gruppe Downloads, die gut eine Sekunde nach der ersten startet
  // (gemessen: 0,8 s verworfen, 1,2 s angenommen). Darum kurz sperren statt still zu verlieren.
  const rest = (arbeit.sperreBis || 0) - Date.now();
  if (rest > 0) {
    k.disabled = true;
    setTimeout(() => { if (zustand.arbeit === arbeit && arbeit.pakete[arbeit.aktuell] === p) k.disabled = false; }, rest);
  }
  k.focus();
  // Nächstes Paket schon im Hintergrund laden (höchstens eins im Voraus)
  paketVorbereiten(arbeit, arbeit.aktuell + 1);
}

function paketAusfuehren(arbeit) {
  if (arbeit.art === 'laden') paketHerunterladen(arbeit);
  else paketTeilen(arbeit);
}

// Ein Paket ist erledigt: Speicher freigeben, weiter zum nächsten oder fertig.
function paketErledigt(arbeit) {
  const p = arbeit.pakete[arbeit.aktuell];
  clearTimeout(arbeit.haenger);
  p.fertig = true;
  p.dateien = null;
  p.blobs = null;
  arbeit.aktuell += 1;
  if (arbeit.aktuell >= arbeit.pakete.length) {
    const anzahl = arbeit.pakete.reduce((s, x) => s + x.bilder.length, 0);
    const verb = PAKET[arbeit.art].fertig;
    const text = arbeit.pakete.length === 1
      ? `${fotos(anzahl)} ${verb}.`
      : `Alle ${zahl(arbeit.pakete.length)} Pakete mit zusammen ${fotos(anzahl)} ${verb}.`;
    panelZeigen({ titel: 'Fertig', text, fortschritt: 1 });
    $('panel-aktion').hidden = true;
    $('zip-neben').hidden = true;
    ansagen('Fertig.');
    $('panel-zu').focus();
    return;
  }
  const naechstes = arbeit.pakete[arbeit.aktuell];
  if (naechstes.dateien) paketBereit(arbeit);
  else paketVorbereiten(arbeit, arbeit.aktuell);
}

function paketTeilen(arbeit) {
  const p = arbeit.pakete[arbeit.aktuell];
  if (!p?.dateien || arbeit.laeuft) return;
  const k = $('panel-aktion');
  arbeit.laeuft = true;
  k.disabled = true;
  const nr = ++arbeit.versuchNr;
  const gilt = () => arbeit.versuchNr === nr && zustand.arbeit === arbeit;
  // Einige iOS-Versionen melden das Ende des Teilen-Menüs nie zurück. Damit niemand hängen bleibt,
  // bietet das Fenster nach 15 s "Weiter" an.
  clearTimeout(arbeit.haenger);
  arbeit.haenger = setTimeout(() => {
    if (!gilt() || !arbeit.laeuft) return;
    const letztes = arbeit.aktuell + 1 >= arbeit.pakete.length;
    panelText(`Ist das Teilen-Menü schon zu? Dann tippe auf „${letztes ? 'Fertig' : 'Weiter'}“.`);
    aktionKnopf({
      text: letztes ? 'Fertig' : `Weiter mit Paket ${p.nr + 1}`,
      klick: () => { arbeit.versuchNr += 1; arbeit.laeuft = false; paketErledigt(arbeit); },
    });
  }, 15_000);
  let versprechen;
  try {
    // Synchron im Klick aufrufen, sonst ist die Nutzeraktivierung verbraucht
    const daten = { files: p.dateien };
    if (navigator.canShare && !navigator.canShare(daten)) throw new Error('nicht-teilbar');
    versprechen = navigator.share(daten);
  } catch (e) {
    versprechen = Promise.reject(e);
  }
  Promise.resolve(versprechen).then(() => {
    if (!gilt()) return;
    arbeit.laeuft = false;
    paketErledigt(arbeit);
  }, (e) => {
    if (!gilt()) return;
    clearTimeout(arbeit.haenger);
    arbeit.laeuft = false;
    k.textContent = paketKnopfText(arbeit);
    k.onclick = () => paketAusfuehren(arbeit);
    k.disabled = false;
    if (e?.name === 'AbortError') {
      // Nutzer hat das Teilen-Menü geschlossen: ruhig weitermachen
      panelText(`Paket ${p.nr} wurde nicht gesichert. Du kannst es noch einmal versuchen.`);
    } else if (e?.name === 'NotAllowedError') {
      panelText('Bitte tippe noch einmal auf den Knopf.');
    } else {
      // Teilen klappt hier gar nicht: auf Dateien umschalten, ohne die geladenen Fotos zu verwerfen
      arbeit.art = 'laden';
      zustand.weg = 'laden';
      knopfBeschriften($('aktion-knopf'), AKTION.laden);
      panelZeigen({
        titel: PAKET.laden.titel,
        text: `Dein Gerät kann diese Fotos nicht über das Teilen-Menü sichern. Lade sie stattdessen als Dateien, sie landen in deinen Downloads.${bisherText(arbeit)}`,
        fortschritt: 1,
      });
      nebenwegZeigen(true);
      aktionKnopf({ text: paketKnopfText(arbeit), klick: () => paketAusfuehren(arbeit) }).focus();
    }
  });
}

function paketHerunterladen(arbeit) {
  const p = arbeit.pakete[arbeit.aktuell];
  if (!p?.dateien || arbeit.laeuft) return;
  // Alle Downloads im selben Klick auslösen (Nutzeraktivierung). Chrome fragt beim ersten Mal,
  // ob die Seite mehrere Dateien laden darf.
  for (const datei of p.dateien) blobSpeichern(datei, datei.name);
  arbeit.sperreBis = Date.now() + 1800;
  ansagen(`Paket ${p.nr} wird geladen.`);
  paketErledigt(arbeit);
}

// ---------- Einzelnes Original ----------

async function originalEinzeln(b, beiAnteil) {
  let geladen = 0;
  const blob = await originalAlsBlob(b, undefined, (n) => {
    geladen += n;
    if (b.o?.bytes) beiAnteil(geladen / b.o.bytes);
  });
  blobSpeichern(blob, namensVergeber()(b.name || 'foto.jpg'));
}

// Handy-Fassung eines Fotos als Datei (für "In Fotos sichern" in der Großansicht)
async function handyDateiLaden(b, signal, beiAnteil) {
  const [datei] = await paketLaden({ bilder: [b] }, namensVergeber(), signal, (fertig, gesamt) => beiAnteil?.(fertig / gesamt));
  return datei;
}

async function handyEinzelnLaden(b, beiAnteil) {
  const datei = await handyDateiLaden(b, undefined, beiAnteil);
  blobSpeichern(datei, datei.name);
}

// ---------- Ereignisse ----------

function einrichten() {
  $('code-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('code-knopf').disabled) return;
    zugangSenden($('code-feld').value);
  });
  $('code-feld').addEventListener('input', () => {
    $('code-feld').removeAttribute('aria-invalid');
  });
  $('meldung-knopf').addEventListener('click', () => starten());
  $('app-hinweis-kopieren').addEventListener('click', linkKopieren);

  $('kapitel').addEventListener('click', (e) => {
    const wahl = e.target.closest('.kachel-wahl');
    const oeffnen = e.target.closest('.kachel-bild');
    const kachel = e.target.closest('.kachel');
    if (!kachel) return;
    const id = kachel.dataset.id;
    if (wahl) {
      auswahlSetzen([id], !zustand.gewaehlt.has(id));
      return;
    }
    if (oeffnen) {
      // Mit Zeiger im Auswahlmodus: Antippen schaltet die Auswahl. Mit Tastatur (detail 0) immer öffnen.
      if (zustand.gewaehlt.size > 0 && e.detail > 0) {
        auswahlSetzen([id], !zustand.gewaehlt.has(id));
        return;
      }
      const index = zustand.bilder.findIndex((b) => b.id === id);
      zustand.ansicht?.oeffnen(index);
    }
  });

  $('kapitel').addEventListener('keydown', rasterTaste);
  $('kapitel').addEventListener('keyup', rasterTaste);
  $('kapitel').addEventListener('focusin', (e) => {
    const k = e.target.closest?.('.kachel');
    if (k && e.target.classList.contains('kachel-bild')) rovingSetzen(k.dataset.id);
  });

  $('kapitel').addEventListener('click', (e) => {
    const knopf = e.target.closest('.kapitel-alle');
    if (!knopf) return;
    const ki = Number(knopf.dataset.kapitel);
    const ids = zustand.bilder.filter((b) => b.kapitel === ki).map((b) => b.id);
    const alleAn = ids.every((id) => zustand.gewaehlt.has(id));
    auswahlSetzen(ids, !alleAn);
    ansagen(alleAn ? 'Auswahl im Kapitel aufgehoben.' : `${fotos(ids.length)} im Kapitel ausgewählt.`);
  });

  $('alle-knopf').addEventListener('click', () => {
    const ids = zustand.bilder.map((b) => b.id);
    const alleAn = zustand.gewaehlt.size === ids.length;
    auswahlSetzen(ids, !alleAn);
    ansagen(alleAn ? 'Auswahl aufgehoben.' : `Alle ${fotos(ids.length)} ausgewählt.`);
  });

  $('aufheben-knopf').addEventListener('click', () => {
    if (zustand.arbeit?.laeuft) return;
    arbeitBeenden();
    auswahlSetzen([...zustand.gewaehlt], false);
    ansagen('Auswahl aufgehoben.');
    $('alle-knopf').focus();
  });

  $('aktion-knopf').addEventListener('click', () => {
    if (zustand.arbeit?.laeuft) return;
    arbeitBeenden();
    if (zustand.weg === 'zip') zipStarten();
    else paketeStarten(zustand.weg);
  });

  $('zip-neben').addEventListener('click', (e) => {
    if (zustand.arbeit?.laeuft) return;
    const weg = e.currentTarget.dataset.weg;
    arbeitBeenden();
    if (weg === 'laden') paketeStarten('laden');
    else zipStarten();
  });

  $('panel-zu').addEventListener('click', () => {
    if (zustand.arbeit?.laeuft && zustand.arbeit.art === 'zip') {
      zustand.arbeit.abbruch?.abort();
      return;
    }
    arbeitBeenden();
    $('aktion-knopf').focus();
  });

  $('panel-abbrechen').addEventListener('click', () => {
    zustand.arbeit?.abbruch?.abort();
    if (zustand.arbeit && zustand.arbeit.art !== 'zip') {
      arbeitBeenden();
      ansagen('Abgebrochen.');
    }
  });

  window.addEventListener('hashchange', () => {
    const code = codeAusHash(location.hash);
    if (code !== null) starten();
  });
}

// Umgebung einmal je Seitenansicht feststellen (Feature-Tests, User-Agent nur als Hinweis)
farbschemaSetzen();
zustand.umgebung = umgebung();
zustand.handy = zustand.umgebung.weg === 'teilen';
zustand.touch = zustand.umgebung.touch;
// Touch ohne Teilen-Menü (Firefox Android, App-Browser): Fotos als Dateien statt ZIP
zustand.weg = zustand.handy ? 'teilen' : (zustand.touch ? 'laden' : 'zip');
document.documentElement.classList.toggle('mit-kopfbild', hatKopfbild());
const markeBereit = markeLaden();
appHinweis();
einrichten();
starten();

// Für Tests und Fehlersuche: lesender Zugriff auf den Zustand
Object.defineProperty(window, '__galerie', { value: { zustand }, configurable: false });
