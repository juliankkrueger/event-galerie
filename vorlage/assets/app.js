// Event-Galerie: Gäste-Oberfläche. Vanilla JS, ES2020-Module, keine Abhängigkeiten außer client-zip.
import {
  bilderFlach, bildHandy, bildMitSitzung, codeAusHash, codeFormGueltig, codeFormHinweis, codeNormalisieren, datumLang, eventSeiteAusHost,
  fotos, groesse, httpsAdresse, namensVergeber, paketeBilden, retryAfterSekunden, seitenverhaeltnis, wartezeitText,
  sitzungsWert, zahl, zipName, zipTeileBilden, ZIP_MAX_BILDER, ZIP_MAX_BYTES, ZIP_MAX_BYTES_SPEICHER,
} from './werkzeuge.js';
import {
  blobSpeichern, dateiauswahlOeffnen, dienstAnmelden, inDateiSchreiben, kannDateienTeilen, originalAlsBlob,
  paketLaden, speicherWeg, ueberDienstSpeichern, zipEintraege, zipStrom,
} from './sichern.js';
import { ansichtEinrichten } from './ansicht.js';

const $ = (id) => document.getElementById(id);
const ZEILE = 4; // px, Rasterzeile für das Mauerwerk
const LUECKE = 6; // px, muss zu --luecke in app.css passen

const zustand = {
  status: null,
  manifest: null,
  bilder: [],
  nachId: new Map(),
  gewaehlt: new Set(),
  handy: false,
  arbeit: null, // laufender ZIP- oder Teilen-Vorgang
  ansicht: null,
  kacheln: new Map(),
};

// ---------- Netz ----------

async function api(pfad, optionen = {}) {
  return fetch(pfad, { credentials: 'same-origin', cache: 'no-store', ...optionen });
}

// ---------- Marke ----------

// Links aus /assets/marke.json (schreibt der Bau aus marken/<id>/marke.json). Ohne Datei bleiben die
// Links aus index.html stehen und die Event-Seite wird aus der Domain abgeleitet (fotos.x.de -> x.de).
let eventSeite = eventSeiteAusHost(location.hostname);

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
  } catch {
    // Fuß und Event-Link bleiben wie in index.html
  } finally {
    if (eventSeite) {
      $('link-event').href = eventSeite;
      $('link-event').hidden = false;
    }
  }
}

const markeBereit = markeLaden();

// ---------- Zustände ----------

const ZUSTAENDE = ['z-laedt', 'z-code', 'z-meldung', 'galerie'];

function zeige(id) {
  for (const z of ZUSTAENDE) $(z).hidden = z !== id;
  document.body.dataset.zustand = id;
  document.body.classList.remove('mit-event-knopf');
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
      const ablauf = Date.parse(s?.ablauf);
      if (typeof s?.titel === 'string' && Number.isFinite(ablauf) && Date.now() < ablauf) {
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

function galerieAufbauen(manifest) {
  zustand.manifest = manifest;
  // Je Seitenansicht ein Zufallswert an allen Fotopfaden (siehe mitSitzung in werkzeuge.js)
  const sitzung = sitzungsWert();
  zustand.bilder = bilderFlach(manifest).map((b) => bildMitSitzung(b, sitzung));
  zustand.nachId = new Map(zustand.bilder.map((b) => [b.id, b]));
  zustand.handy = kannDateienTeilen();
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
  $('galerie-tipp').textContent = zustand.handy
    ? 'Tippe auf den Kreis, um Fotos auszuwählen.'
    : 'Klick auf den Kreis oben rechts, um ein Foto auszuwählen.';
  const kapitelMitBildern = (manifest.kapitel || []).filter((k) => k.bilder?.length);
  const info = [fotos(zustand.bilder.length)];
  if (kapitelMitBildern.length > 1) info.push(`${kapitelMitBildern.length} Kapitel`);
  const bis = datumLang(manifest.ablauf);
  if (bis) info.push(`online bis ${bis}`);
  $('galerie-info').textContent = info.join(' · ');

  const liste = $('kapitelliste');
  const behaelter = $('kapitel');
  liste.replaceChildren();
  behaelter.replaceChildren();
  zustand.kacheln.clear();

  (manifest.kapitel || []).forEach((k, ki) => {
    if (!k.bilder?.length) return;
    const bilderK = zustand.bilder.filter((b) => b.kapitel === ki);
    const abschnitt = el('section', 'kapitel');
    abschnitt.id = `kapitel-${ki + 1}`;
    abschnitt.setAttribute('aria-labelledby', `kapitel-${ki + 1}-titel`);
    const kopf = el('div', 'kapitel-kopf');
    const h2 = el('h2', 'titel kapitel-titel', k.titel || 'Fotos');
    h2.id = `kapitel-${ki + 1}-titel`;
    const anzahl = el('span', 'kapitel-anzahl', fotos(bilderK.length));
    const kopfText = el('div', 'kapitel-kopftext');
    kopfText.append(h2, anzahl);
    const alle = el('button', 'knopf knopf-leise knopf-klein kapitel-alle', 'Kapitel auswählen');
    alle.type = 'button';
    alle.dataset.kapitel = String(ki);
    alle.setAttribute('aria-describedby', h2.id);
    kopf.append(kopfText, alle);
    const raster = el('div', 'raster');
    raster.setAttribute('role', 'list');
    raster.setAttribute('aria-label', `Fotos: ${k.titel || 'Fotos'}. Pfeiltasten wechseln das Foto, Leertaste wählt aus, Enter öffnet es groß.`);
    bilderK.forEach((b, i) => raster.append(kachelBauen(b, b.nr <= 6, i === 0)));
    abschnitt.append(kopf, raster);
    behaelter.append(abschnitt);

    const li = el('li');
    const a = el('a', 'kapitel-link', k.titel || 'Fotos');
    a.href = `#kapitel-${ki + 1}`;
    li.append(a);
    liste.append(li);
  });
  $('kapitelleiste').hidden = kapitelMitBildern.length < 2;

  zustand.ansicht = ansichtEinrichten({
    bilder: zustand.bilder,
    kapitelTitel: (ki) => (kapitelMitBildern.length > 1 ? manifest.kapitel[ki]?.titel : ''),
    istGewaehlt: (id) => zustand.gewaehlt.has(id),
    umschalten: (id) => auswahlSetzen([id], !zustand.gewaehlt.has(id)),
    originalLaden: originalEinzeln,
    handy: zustand.handy,
    handyDateiLaden: handyDateiLaden,
    kachelFokus: (id) => {
      const k = zustand.kacheln.get(id);
      if (!k) return;
      rovingSetzen(id);
      k.oeffnen.focus({ preventScroll: true });
      k.wurzel.scrollIntoView({ block: 'nearest' });
    },
  });

  zeige('galerie');
  mauerwerkBeobachten();
  kapitelBeobachten();
  leisteBeobachten();
  auswahlAnzeigen();
  if (!zustand.handy) dienstAnmelden();
  // Fokus auf den Titel (tabindex="-1") und Ansage, damit auch ohne Bildschirm klar ist, dass es weitergeht
  $('galerie-titel').focus({ preventScroll: true });
  ansagen(`${fotos(zustand.bilder.length)} geladen.`);
}

function kachelBauen(b, vorne = false, tabstopp = false) {
  const wurzel = el('div', 'kachel');
  wurzel.setAttribute('role', 'listitem');
  wurzel.dataset.id = b.id;
  const v = seitenverhaeltnis(b) || 1.5;
  wurzel.style.setProperty('--v', String(v));

  // Roving tabindex: je Raster genau ein Tabstopp, Pfeiltasten wandern zwischen den Fotos.
  const oeffnen = el('button', 'kachel-bild');
  oeffnen.type = 'button';
  oeffnen.tabIndex = tabstopp ? 0 : -1;
  oeffnen.setAttribute('aria-label', `Foto ${b.nr} ansehen`);
  const img = el('img');
  img.alt = '';
  // Die ersten Fotos sofort laden (größtes sichtbares Element), den Rest erst beim Scrollen
  img.loading = vorne ? 'eager' : 'lazy';
  img.decoding = 'async';
  if (vorne && b.nr <= 2) img.fetchPriority = 'high';
  img.width = 600;
  img.height = Math.round(600 / v);
  img.src = b.r;
  if (!seitenverhaeltnis(b)) {
    img.addEventListener('load', () => {
      if (img.naturalWidth && img.naturalHeight) {
        wurzel.style.setProperty('--v', String(img.naturalWidth / img.naturalHeight));
        zeilenSetzen(wurzel);
      }
    }, { once: true });
  }
  img.addEventListener('error', () => wurzel.classList.add('fehlt'), { once: true });
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
  zustand.kacheln.set(b.id, { wurzel, oeffnen, wahl, nr: b.nr, v: () => Number(wurzel.style.getPropertyValue('--v')) || v });
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

function spaltenZahl(raster) {
  return getComputedStyle(raster).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
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
  else if (e.key === 'ArrowDown') ziel = i + spaltenZahl(raster);
  else if (e.key === 'ArrowUp') ziel = i - spaltenZahl(raster);
  else if (e.key === 'Home') ziel = 0;
  else if (e.key === 'End') ziel = kacheln.length - 1;
  else return;
  e.preventDefault();
  ziel = Math.max(0, Math.min(kacheln.length - 1, ziel));
  const neu = kacheln[ziel];
  rovingSetzen(neu.dataset.id);
  neu.querySelector('.kachel-bild').focus();
}

// Mauerwerk mit CSS Grid: jede Kachel spannt so viele 4-px-Zeilen, wie ihr Seitenverhältnis braucht.
let spaltenBreite = 0;

function zeilenSetzen(wurzel) {
  if (!spaltenBreite) return;
  const k = zustand.kacheln.get(wurzel.dataset.id);
  const v = k ? k.v() : 1.5;
  const hoehe = spaltenBreite / v;
  wurzel.style.gridRowEnd = `span ${Math.max(1, Math.round((hoehe + LUECKE) / ZEILE))}`;
}

function mauerwerkBeobachten() {
  const raster = document.querySelector('.raster');
  if (!raster) return;
  const messen = () => {
    const spalten = getComputedStyle(raster).gridTemplateColumns.split(' ').filter(Boolean);
    const breite = parseFloat(spalten[0]) || 0;
    if (!breite || Math.abs(breite - spaltenBreite) < 0.5) return;
    spaltenBreite = breite;
    for (const { wurzel } of zustand.kacheln.values()) zeilenSetzen(wurzel);
  };
  messen();
  new ResizeObserver(messen).observe(raster);
}

// Zeigt an den Rändern einen Verlauf, solange die Kapitelleiste dort weiterläuft.
function kapitelRaender() {
  const liste = $('kapitelliste');
  const leiste = $('kapitelleiste');
  const rest = liste.scrollWidth - liste.clientWidth - liste.scrollLeft;
  leiste.classList.toggle('mehr-links', liste.scrollLeft > 2);
  leiste.classList.toggle('mehr-rechts', rest > 2);
}

function kapitelBeobachten() {
  $('kapitelliste').addEventListener('scroll', kapitelRaender, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(kapitelRaender).observe($('kapitelliste'));
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
        const links = a.offsetLeft - liste.offsetLeft;
        if (links < liste.scrollLeft || links + a.offsetWidth > liste.scrollLeft + liste.clientWidth) {
          liste.scrollTo({ left: Math.max(0, links - 24) });
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
    const bytes = zustand.handy
      ? gewaehlt.reduce((s, b) => s + (bildHandy(b)?.bytes || 0), 0)
      : gewaehlt.reduce((s, b) => s + (b.o?.bytes || 0), 0);
    const zahlText = el('strong', 'zaehler-zahl', `${fotos(anzahl)} `);
    zahlText.append(el('span', 'zaehler-wort', 'ausgewählt'));
    zeile.append(zahlText);
    // Trenner " · " vor dem Rest setzt app.css (am Handy steht der Rest in einer eigenen Zeile)
    let rest = groesse(bytes);
    if (!zustand.handy) {
      const teile = zipTeileBilden(gewaehlt, zipGrenze()).length;
      rest += teile > 1 ? ` · ${zahl(teile)} ZIP-Dateien (je max. ${ZIP_MAX_BILDER} Fotos)` : ` · max. ${ZIP_MAX_BILDER} je ZIP`;
    }
    zeile.append(el('span', 'zaehler-rest', rest));
  }
  knopfBeschriften($('aktion-knopf'), zustand.handy ? ['In Fotos sichern', 'Sichern'] : ['Als ZIP laden', 'ZIP laden']);
  zustand.ansicht?.aktualisieren();
  if (zustand.arbeit && zustand.arbeit.art === 'teilen' && !zustand.arbeit.laeuft) {
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
  leisteBeobachter = new ResizeObserver(() => {
    const h = $('leiste').hidden ? 0 : Math.ceil($('leiste').getBoundingClientRect().height);
    document.documentElement.style.setProperty('--leiste-hoehe', `${h}px`);
  });
  leisteBeobachter.observe($('leiste'));
}

function gewaehlteBilder() {
  return zustand.bilder.filter((b) => zustand.gewaehlt.has(b.id));
}

function zipGrenze() {
  return speicherWeg() === 'speicher' ? ZIP_MAX_BYTES_SPEICHER : ZIP_MAX_BYTES;
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

// Läuft ein ZIP, gibt es „Abbrechen“, sonst nur das Schließen-Kreuz.
function panelLaeuft(laeuft) {
  $('panel-zu').hidden = laeuft;
  $('panel-abbrechen').hidden = !laeuft;
}

function arbeitBeenden() {
  zustand.arbeit?.abbruch?.abort();
  arbeitSetzen(null);
  $('panel').hidden = true;
  $('panel-liste').replaceChildren();
  $('panel-aktion').hidden = true;
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
  const teile = zipTeileBilden(bilder, zipGrenze());
  // Namen über alle Teile hinweg eindeutig
  const eintraege = zipEintraege(bilder, zustand.manifest.erstellt);
  const nachBild = new Map(eintraege.map((e) => [e.bild.id, e]));
  const arbeit = {
    art: 'zip', weg, laeuft: false, abbruch: null,
    teile: teile.map((t, i) => ({ nr: i + 1, eintraege: t.bilder.map((b) => nachBild.get(b.id)), bytes: t.bytes, fertig: false })),
  };
  arbeitSetzen(arbeit);
  const titel = zustand.manifest.titel;
  const hinweis = weg === 'speicher'
    ? `Dein Browser baut die ZIP im Arbeitsspeicher, darum höchstens ${groesse(ZIP_MAX_BYTES_SPEICHER)} je Datei. Am Rechner mit Chrome oder Edge geht es schneller.`
    : '';

  if (teile.length === 1) {
    // Direkt im Klick starten (Dateiauswahl braucht die Nutzeraktivierung)
    zipTeilLaden(arbeit, arbeit.teile[0], zipName(titel, 1, 1), hinweis);
    return;
  }
  panelZeigen({
    titel: `${zahl(teile.length)} ZIP-Dateien`,
    text: `Deine Auswahl wird in ${zahl(teile.length)} ZIP-Dateien aufgeteilt (je höchstens ${ZIP_MAX_BILDER} Fotos und ${groesse(zipGrenze())}). Lade sie nacheinander. ${hinweis}`.trim(),
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
  let zuletztText = { prozent: -1, zeit: 0 };
  const { strom, laenge } = zipStrom(teil.eintraege, signal, (bytes, gesamt) => {
    const anteil = gesamt ? bytes / gesamt : 0;
    panelFortschritt(anteil);
    panelText(zipFortschrittText(vorsilbe, bytes, gesamt, zuletztText));
    // Vorlesen nur in 10-%-Schritten
    const zehner = Math.floor(anteil * 10) * 10;
    if (zehner !== zuletztAnsage) {
      zuletztAnsage = zehner;
      if (zehner > 0 && zehner < 100) ansagen(`${zehner} Prozent`);
    }
  });
  try {
    if (griff) {
      await inDateiSchreiben(griff, strom, signal);
    } else if (arbeit.weg === 'dienst') {
      try {
        await ueberDienstSpeichern(strom, name, laenge, signal);
      } catch (e) {
        if (e?.message !== 'kein-dienst') throw e;
        // Kein Service Worker aktiv: über den Arbeitsspeicher, solange es passt
        if (laenge > ZIP_MAX_BYTES_SPEICHER) throw new Error('zu-gross');
        blobSpeichern(await new Response(strom).blob(), name);
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
    if (e?.name === 'AbortError' || signal.aborted) {
      panelZeigen({ titel: 'Abgebrochen', text: 'Der Download wurde abgebrochen. Du kannst ihn jederzeit neu starten.' });
      ansagen('Download abgebrochen.');
    } else if (e?.message === 'zu-gross') {
      panelZeigen({ titel: 'Zu groß für diesen Browser', text: `Bitte wähl weniger Fotos aus (höchstens ${groesse(ZIP_MAX_BYTES_SPEICHER)}) oder nutz Chrome oder Edge am Rechner.` });
    } else {
      panelZeigen({ titel: 'Das hat nicht geklappt', text: 'Beim Laden der Fotos ist ein Fehler aufgetreten. Bitte versuch es noch einmal.' });
      ansagen('Fehler beim Erstellen der ZIP.');
    }
  } finally {
    arbeit.laeuft = false;
    arbeit.abbruch = null;
    panelLaeuft(false);
    if (zustand.arbeit === arbeit) $('panel-zu').focus();
    $('aktion-knopf').disabled = false;
    for (const t of arbeit.teile) if (t.knopf) t.knopf.disabled = t.fertig;
  }
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

// ---------- Teilen aufs Handy ----------

function teilenStarten() {
  const bilder = gewaehlteBilder();
  if (!bilder.length) return;
  const pakete = paketeBilden(bilder).map((p, i) => ({ ...p, nr: i + 1, dateien: null, laden: null, fertig: false }));
  const arbeit = { art: 'teilen', pakete, aktuell: 0, laeuft: false, abbruch: new AbortController(), vergeben: namensVergeber() };
  arbeitSetzen(arbeit);
  panelLaeuft(false);
  $('panel-liste').replaceChildren();
  paketVorbereiten(arbeit, 0);
}

function paketVorbereiten(arbeit, i) {
  const p = arbeit.pakete[i];
  if (!p || p.laden) return p?.laden;
  p.laden = paketLaden(p, arbeit.vergeben, arbeit.abbruch.signal, (fertig, gesamt) => {
    if (arbeit.aktuell === i && zustand.arbeit === arbeit) {
      panelText(`Paket ${p.nr} von ${arbeit.pakete.length} wird vorbereitet: ${fertig} von ${gesamt} Fotos geladen.`);
      panelFortschritt(fertig / gesamt);
    }
  }).then((dateien) => {
    p.dateien = dateien;
    if (arbeit.aktuell === i) paketBereit(arbeit);
    return dateien;
  }).catch((e) => {
    p.laden = null;
    if (zustand.arbeit !== arbeit || arbeit.abbruch.signal.aborted) return null;
    if (arbeit.aktuell === i) {
      panelZeigen({ titel: 'Das hat nicht geklappt', text: `Paket ${p.nr} konnte nicht geladen werden. Bitte prüf deine Verbindung.` });
      const k = $('panel-aktion');
      k.hidden = false;
      k.disabled = false;
      k.textContent = 'Erneut versuchen';
      k.onclick = () => { panelZeigenPaket(arbeit); paketVorbereiten(arbeit, i); };
    }
    return null;
  });
  if (arbeit.aktuell === i) panelZeigenPaket(arbeit);
  return p.laden;
}

function panelZeigenPaket(arbeit) {
  $('zip-neben').hidden = false;
  const p = arbeit.pakete[arbeit.aktuell];
  panelZeigen({
    titel: 'In Fotos sichern',
    text: `Paket ${p.nr} von ${arbeit.pakete.length} wird vorbereitet.`,
    fortschritt: 0,
  });
  const k = $('panel-aktion');
  k.hidden = false;
  k.disabled = true;
  k.textContent = `Paket ${p.nr} von ${arbeit.pakete.length} sichern`;
  k.onclick = () => paketTeilen(arbeit);
}

function paketBereit(arbeit) {
  const p = arbeit.pakete[arbeit.aktuell];
  const gesamt = arbeit.pakete.length;
  panelZeigen({
    titel: 'In Fotos sichern',
    text: `Paket ${p.nr} von ${gesamt} ist bereit (${fotos(p.dateien.length)}). Tippe auf den Knopf und wähle im Teilen-Menü „Bilder sichern“ oder deine Galerie.`,
    fortschritt: 1,
  });
  const k = $('panel-aktion');
  k.hidden = false;
  k.disabled = false;
  k.textContent = `Paket ${p.nr} von ${gesamt} sichern`;
  k.onclick = () => paketTeilen(arbeit);
  ansagen(`Paket ${p.nr} von ${gesamt} ist bereit.`);
  k.focus();
  // Nächstes Paket schon im Hintergrund laden (höchstens eins im Voraus)
  paketVorbereiten(arbeit, arbeit.aktuell + 1);
}

async function paketTeilen(arbeit) {
  const p = arbeit.pakete[arbeit.aktuell];
  if (!p?.dateien || arbeit.laeuft) return;
  const k = $('panel-aktion');
  arbeit.laeuft = true;
  k.disabled = true;
  try {
    // Synchron im Klick aufrufen, sonst ist die Nutzeraktivierung verbraucht
    const daten = { files: p.dateien };
    if (navigator.canShare && !navigator.canShare(daten)) throw new Error('nicht-teilbar');
    await navigator.share(daten);
    p.fertig = true;
    p.dateien = null;
    arbeit.aktuell += 1;
    if (arbeit.aktuell >= arbeit.pakete.length) {
      const anzahl = arbeit.pakete.reduce((s, x) => s + x.bilder.length, 0);
      const text = arbeit.pakete.length === 1
        ? `${fotos(anzahl)} weitergegeben.`
        : `Alle ${zahl(arbeit.pakete.length)} Pakete mit zusammen ${fotos(anzahl)} weitergegeben.`;
      panelZeigen({ titel: 'Fertig', text, fortschritt: 1 });
      k.hidden = true;
      $('zip-neben').hidden = true;
      ansagen('Fertig.');
      $('panel-zu').focus();
    } else {
      const naechstes = arbeit.pakete[arbeit.aktuell];
      if (naechstes.dateien) paketBereit(arbeit);
      else {
        panelZeigenPaket(arbeit);
        paketVorbereiten(arbeit, arbeit.aktuell);
      }
    }
  } catch (e) {
    if (e?.name === 'AbortError') {
      // Nutzer hat das Teilen-Menü geschlossen: ruhig weitermachen
      panelText(`Paket ${p.nr} wurde nicht gesichert. Du kannst es noch einmal versuchen.`);
    } else if (e?.name === 'NotAllowedError') {
      panelText('Bitte tippe noch einmal auf den Knopf.');
    } else {
      panelText('Dein Gerät kann diese Fotos nicht direkt sichern. Lade sie stattdessen als ZIP.');
    }
    k.disabled = false;
  } finally {
    arbeit.laeuft = false;
  }
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
    if (zustand.handy) teilenStarten();
    else zipStarten();
  });

  $('zip-neben').addEventListener('click', () => {
    if (zustand.arbeit?.laeuft) return;
    arbeitBeenden();
    zipStarten();
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
    if (zustand.arbeit?.art === 'teilen') {
      arbeitBeenden();
      ansagen('Abgebrochen.');
    }
  });

  window.addEventListener('hashchange', () => {
    const code = codeAusHash(location.hash);
    if (code !== null) starten();
  });
}

einrichten();
starten();

// Für Tests und Fehlersuche: lesender Zugriff auf den Zustand
Object.defineProperty(window, '__galerie', { value: { zustand }, configurable: false });
