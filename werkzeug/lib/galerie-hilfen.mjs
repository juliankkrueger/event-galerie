// Namen, Adressen, Abnahme gegen die Live-Galerie, QR-Code und Text für die Gäste.

import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WerkzeugFehler, warte } from "./umgebung.mjs";

export const PROJEKT_MUSTER = /^fotos-[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;
const KLEIN = "abcdefghijklmnopqrstuvwxyz0123456789";

/** ASCII-Kurzname aus dem Titel: Umlaute ausgeschrieben, höchstens max Zeichen. */
export function slug(titel, max = 40) {
  const s = String(titel || "")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "galerie";
}

export function zufallsZeichen(n, zufall = randomBytes) {
  let out = "";
  while (out.length < n) {
    for (const b of zufall(n * 2)) if (b < 252 && out.length < n) out += KLEIN[b % 36];
  }
  return out;
}

export function projektName(titel, zufall) {
  const p = `fotos-${slug(titel)}-${zufallsZeichen(4, zufall)}`;
  if (!PROJEKT_MUSTER.test(p)) throw new WerkzeugFehler(`Projektname ${p} ungültig`);
  return p;
}

export const gaesteLink = (projekt, code) => `https://${projekt}.pages.dev/#c=${code}`;
export const basisUrl = (vorlage, projekt) => vorlage.replace("{projekt}", projekt);

async function holen(url, init = {}, { versuche = 3 } = {}) {
  let letzter;
  for (let n = 0; n < versuche; n++) {
    try {
      return await fetch(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(init.zeitMs || 60000) });
    } catch (e) {
      letzter = e;
      await warte(1000 * 2 ** n);
    }
  }
  throw new WerkzeugFehler(`${new URL(url).host} nicht erreichbar (${letzter?.name || "Fehler"})`);
}

/** Antwortet die Galerie (Status 200 mit diesem Titel)? Wartet bis zu wartenMs. */
export async function warteAufStatus(basis, titel, { wartenMs = 180000, taktMs = 5000 } = {}) {
  const ende = Date.now() + wartenMs;
  let zuletzt = "";
  for (;;) {
    try {
      const r = await holen(`${basis}/api/status`, {}, { versuche: 1 });
      zuletzt = `HTTP ${r.status}`;
      if (r.status === 200) {
        const j = await r.json().catch(() => null);
        if (j && j.titel === titel && j.abgelaufen === false) return j;
        zuletzt = `Titel ${JSON.stringify(j?.titel)}, abgelaufen ${j?.abgelaufen}`;
      }
    } catch (e) {
      zuletzt = e.message;
    }
    if (Date.now() > ende) throw new WerkzeugFehler(`/api/status liefert nicht diese Galerie (${zuletzt})`);
    await warte(taktMs);
  }
}

/** Ein falscher Code im gleichen Format, der sicher nicht der richtige ist. */
export function falscherCode(code) {
  const ersatz = code[0] === "A" ? "B" : "A";
  return ersatz + code.slice(1);
}

/**
 * Abnahme gegen die Live-Adresse: Status 200, falscher Code 401, richtiger Code 204, Manifest-Anzahl
 * gleich Bericht, drei Stichproben-Originale mit md5 gleich Manifest.
 */
export async function abnahme({ basis, titel, code, erwarteteAnzahl, stichproben = 3, protokoll = () => {} }) {
  const ergebnis = { status: null, falsch: null, richtig: null, anzahl: null, stichproben: [] };
  await warteAufStatus(basis, titel);
  ergebnis.status = 200;
  protokoll("  /api/status 200 mit diesem Titel");
  const zugang = (c) =>
    holen(`${basis}/api/zugang`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: c }) });
  const falsch = await zugang(falscherCode(code));
  ergebnis.falsch = falsch.status;
  if (falsch.status !== 401) throw new WerkzeugFehler(`Falscher Code liefert ${falsch.status} statt 401`);
  protokoll("  falscher Code 401");
  const richtig = await zugang(code);
  ergebnis.richtig = richtig.status;
  if (richtig.status !== 204) throw new WerkzeugFehler(`Richtiger Code liefert ${richtig.status} statt 204`);
  const keks = (richtig.headers.get("set-cookie") || "").split(";")[0];
  if (!/^eg=/.test(keks)) throw new WerkzeugFehler("Richtiger Code setzt kein Cookie");
  protokoll("  richtiger Code 204 mit Cookie");
  const m = await holen(`${basis}/api/manifest`, { headers: { Cookie: keks } });
  if (m.status !== 200) throw new WerkzeugFehler(`/api/manifest liefert ${m.status} statt 200`);
  const manifest = await m.json();
  const bilder = (manifest.kapitel || []).flatMap((k) => k.bilder || []);
  ergebnis.anzahl = manifest.anzahl;
  if (manifest.anzahl !== bilder.length) throw new WerkzeugFehler(`Manifest: anzahl ${manifest.anzahl}, aber ${bilder.length} Bilder in den Kapiteln`);
  if (erwarteteAnzahl !== undefined && manifest.anzahl !== erwarteteAnzahl) {
    throw new WerkzeugFehler(`Manifest hat ${manifest.anzahl} Bilder, der Bericht ${erwarteteAnzahl}`);
  }
  protokoll(`  Manifest ${manifest.anzahl} Bilder = Bericht`);
  const auswahl = [...bilder].sort(() => Math.random() - 0.5).slice(0, stichproben);
  const sitzung = randomBytes(16).toString("hex");
  for (const b of auswahl) {
    const md5 = createHash("md5");
    let bytes = 0;
    for (const teil of b.o.teile) {
      const r = await holen(`${basis}${teil}?s=${sitzung}`, { zeitMs: 300000 });
      if (r.status !== 200) throw new WerkzeugFehler(`Original-Teil liefert ${r.status}`);
      const daten = Buffer.from(await r.arrayBuffer());
      md5.update(daten);
      bytes += daten.length;
    }
    const ist = md5.digest("hex");
    const ok = ist === b.o.md5 && bytes === b.o.bytes;
    ergebnis.stichproben.push({ md5: ok, bytes });
    if (!ok) throw new WerkzeugFehler(`Stichprobe: md5 oder Größe des Originals weicht vom Manifest ab`);
  }
  protokoll(`  ${auswahl.length} Stichproben-Originale md5 = Manifest (${(ergebnis.stichproben.reduce((s, x) => s + x.bytes, 0) / 1e6).toFixed(1)} MB)`);
  return ergebnis;
}

/** Text für die Gäste: Du-Form wie die Event-Seiten, ohne Gedankenstriche. */
export function gaesteText({ titel, link, code }) {
  return [
    "Hallo zusammen,",
    "",
    `die Fotos von ${titel} sind online:`,
    link,
    "",
    `Der Link öffnet die Galerie direkt. Falls die Seite nach einem Code fragt: ${code}`,
    "",
    "Am Handy sicherst du die Fotos direkt in deine Fotos-App, am Rechner lädst du sie als ZIP in voller Auflösung.",
    "",
    "Viel Freude beim Anschauen!",
    "",
  ].join("\n");
}

/** QR (PNG und SVG) und Gäste-Text in ordner schreiben. */
export async function schreibeAusgabe(ordner, { titel, link, code }) {
  let QR;
  try {
    QR = (await import("qrcode")).default;
  } catch {
    throw new WerkzeugFehler("Bibliothek qrcode fehlt", { hinweis: "cd werkzeug && npm ci" });
  }
  await mkdir(ordner, { recursive: true });
  const optionen = { errorCorrectionLevel: "M", margin: 2 };
  const png = join(ordner, "qr-code.png");
  const svg = join(ordner, "qr-code.svg");
  const text = join(ordner, "text-fuer-gaeste.txt");
  await QR.toFile(png, link, { ...optionen, type: "png", width: 1200 });
  await writeFile(svg, await QR.toString(link, { ...optionen, type: "svg" }));
  await writeFile(text, gaesteText({ titel, link, code }));
  return { png, svg, text };
}
