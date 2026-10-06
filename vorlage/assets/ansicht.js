// Großansicht: g-Fassung mit r als Platzhalter, Wischen, Pfeiltasten, Esc, Fokusfalle.
import { fotos } from './werkzeuge.js';

const $ = (id) => document.getElementById(id);

export function ansichtEinrichten({ bilder, kapitelTitel, istGewaehlt, umschalten, originalLaden, kachelFokus, handy = false, handyDateiLaden }) {
  const dialog = $('ansicht');
  const bild = $('ansicht-bild');
  const platz = $('ansicht-platz');
  const buehne = $('buehne');
  const pos = $('ansicht-pos');
  const kapitel = $('ansicht-kapitel');
  const wahl = $('ansicht-wahl');
  const wahlText = $('ansicht-wahl-text');
  const original = $('ansicht-original');
  const zurueck = $('ansicht-zurueck');
  const vor = $('ansicht-vor');
  const status = $('ansicht-status');
  let index = -1;
  let ladeNr = 0;
  let mitVerlauf = false;
  const vorgeladen = new Map();
  // Am Handy: "In Fotos sichern" (Handy-Fassung über das Teilen-Menü), am Rechner das Original.
  const ORIGINAL = handy ? 'In Fotos sichern' : 'Original laden';
  let sichern = null; // { b, datei, laden, abbruch }

  function vorladen(i) {
    const b = bilder[i];
    if (!b || vorgeladen.has(b.id)) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = b.g;
    vorgeladen.set(b.id, img);
    if (vorgeladen.size > 8) vorgeladen.delete(vorgeladen.keys().next().value);
  }

  function wahlZeigen() {
    const b = bilder[index];
    const an = istGewaehlt(b.id);
    wahl.setAttribute('aria-pressed', String(an));
    wahlText.textContent = an ? 'Ausgewählt' : 'Auswählen';
  }

  function zeigen(i) {
    if (!bilder.length) return;
    index = (i + bilder.length) % bilder.length;
    const b = bilder[index];
    const nr = ++ladeNr;
    buehne.classList.remove('geladen');
    platz.src = b.r;
    bild.removeAttribute('src');
    bild.alt = `Foto ${b.nr} von ${bilder.length}${b.name ? `, ${b.name}` : ''}`;
    bild.onload = () => { if (nr === ladeNr) buehne.classList.add('geladen'); };
    bild.onerror = () => { if (nr === ladeNr) status.textContent = 'Die Großansicht konnte nicht geladen werden.'; };
    bild.src = b.g;
    pos.textContent = `${b.nr} / ${bilder.length}`;
    const kt = kapitelTitel(b.kapitel);
    kapitel.textContent = kt ? ` · ${kt}` : '';
    status.textContent = `Foto ${b.nr} von ${bilder.length}`;
    sichernVerwerfen();
    original.disabled = false;
    original.textContent = ORIGINAL;
    wahlZeigen();
    vorladen(index + 1);
    vorladen(index - 1);
  }

  function oeffnen(i) {
    if (!dialog.open) {
      dialog.showModal();
      document.documentElement.classList.add('ansicht-offen');
      if (history.state?.ansicht !== true) {
        history.pushState({ ansicht: true }, '');
        mitVerlauf = true;
      }
    }
    zeigen(i);
    zu.focus({ preventScroll: true });
  }

  const zu = $('ansicht-zu');

  function schliessen() {
    if (!dialog.open) return;
    dialog.close();
  }

  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('ansicht-offen');
    if (mitVerlauf && history.state?.ansicht === true) {
      mitVerlauf = false;
      history.back();
    }
    mitVerlauf = false;
    platz.removeAttribute('src');
    bild.removeAttribute('src');
    sichernVerwerfen();
    if (index >= 0) kachelFokus(bilder[index].id);
  });

  window.addEventListener('popstate', () => {
    if (dialog.open) {
      mitVerlauf = false;
      dialog.close();
    }
  });

  zu.addEventListener('click', () => schliessen());
  zurueck.addEventListener('click', () => zeigen(index - 1));
  vor.addEventListener('click', () => zeigen(index + 1));
  wahl.addEventListener('click', () => {
    umschalten(bilder[index].id);
    wahlZeigen();
    status.textContent = istGewaehlt(bilder[index].id) ? 'Foto ausgewählt' : 'Auswahl entfernt';
  });
  function sichernVerwerfen() {
    sichern?.abbruch.abort();
    sichern = null;
  }

  async function teilen(b, datei) {
    try {
      await navigator.share({ files: [datei] });
      status.textContent = 'Foto weitergegeben.';
      original.textContent = ORIGINAL;
      sichernVerwerfen();
    } catch (e) {
      if (e?.name === 'NotAllowedError') {
        // Laden hat zu lange gedauert, der Browser verlangt ein neues Antippen
        original.textContent = 'Jetzt sichern';
        status.textContent = 'Das Foto ist bereit. Tippe noch einmal auf „Jetzt sichern“.';
      } else if (e?.name === 'AbortError') {
        original.textContent = 'Jetzt sichern';
        status.textContent = 'Nicht gesichert. Du kannst es noch einmal versuchen.';
      } else {
        original.textContent = ORIGINAL;
        status.textContent = 'Dein Gerät kann dieses Foto nicht direkt sichern.';
        sichernVerwerfen();
      }
    }
  }

  async function handySichern() {
    const b = bilder[index];
    // Schon geladen: sofort im Antippen teilen (Nutzeraktivierung)
    if (sichern?.b === b && sichern.datei) {
      await teilen(b, sichern.datei);
      return;
    }
    if (sichern?.b === b) return; // lädt noch
    sichernVerwerfen();
    const abbruch = new AbortController();
    sichern = { b, datei: null, abbruch };
    original.disabled = true;
    original.textContent = 'Wird vorbereitet …';
    try {
      const datei = await handyDateiLaden(b, abbruch.signal);
      if (sichern?.b !== b) return;
      sichern.datei = datei;
      original.disabled = false;
      await teilen(b, datei);
    } catch {
      if (sichern?.b !== b) return;
      sichernVerwerfen();
      original.disabled = false;
      original.textContent = ORIGINAL;
      status.textContent = 'Das Foto konnte nicht geladen werden. Bitte versuch es noch einmal.';
    }
  }

  original.addEventListener('click', async () => {
    if (handy && handyDateiLaden) {
      await handySichern();
      return;
    }
    const b = bilder[index];
    original.disabled = true;
    original.textContent = 'Lädt …';
    try {
      await originalLaden(b, (anteil) => {
        if (bilder[index] === b) original.textContent = `Lädt ${Math.round(anteil * 100)} %`;
      });
      if (bilder[index] === b) {
        original.textContent = 'Original geladen';
        status.textContent = 'Original wurde gespeichert.';
      }
    } catch (e) {
      if (bilder[index] === b) {
        original.textContent = ORIGINAL;
        status.textContent = 'Das Original konnte nicht geladen werden. Bitte versuch es noch einmal.';
      }
    } finally {
      if (bilder[index] === b) original.disabled = false;
    }
  });

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); zeigen(index + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); zeigen(index - 1); }
    else if (e.key === 'Tab') fokusFalle(e);
  });

  function fokusFalle(e) {
    const ziele = [...dialog.querySelectorAll('button:not([disabled])')].filter((el) => el.offsetParent !== null);
    if (!ziele.length) return;
    const erstes = ziele[0];
    const letztes = ziele[ziele.length - 1];
    if (e.shiftKey && (document.activeElement === erstes || !dialog.contains(document.activeElement))) {
      e.preventDefault();
      letztes.focus();
    } else if (!e.shiftKey && (document.activeElement === letztes || !dialog.contains(document.activeElement))) {
      e.preventDefault();
      erstes.focus();
    }
  }

  // Wischen mit Pointer Events
  let start = null;
  buehne.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button > 0) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    buehne.setPointerCapture(e.pointerId);
  });
  buehne.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    buehne.style.setProperty('--wisch', `${dx}px`);
    buehne.classList.add('wischt');
  });
  const ende = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    buehne.classList.remove('wischt');
    buehne.style.setProperty('--wisch', '0px');
    if (e.type === 'pointerup' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      zeigen(dx < 0 ? index + 1 : index - 1);
    } else if (e.type === 'pointerup' && dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      schliessen();
    }
  };
  buehne.addEventListener('pointerup', ende);
  buehne.addEventListener('pointercancel', ende);

  return {
    oeffnen,
    aktualisieren() { if (dialog.open) wahlZeigen(); },
    anzahlText() { return fotos(bilder.length); },
  };
}
