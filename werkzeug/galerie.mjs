// galerie: Fotogalerien der Event-Galerie anlegen, neu bauen, prüfen, abschalten und löschen.
// Aufruf über werkzeug/galerie (siehe galerie hilfe). Vertrag: VERTRAG.md
//
// Geheimnisse (Galerie-Schlüssel aus dem Schlüsselbund, Google-Token von gcloud) bleiben im
// Speicher dieses Prozesses und erscheinen nie in einer Ausgabe.

import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CODE_ALPHABET, SALZ_BYTES, erzeugeCodeHash, zufallsCode } from "../functions/_lib/kennwort.js";
import { entschluesseleText, leseSchluessel, verschluessele } from "../bau/lib/geheim.mjs";
import { erzeugeDriveWerkzeug, ordnerIdAusLink } from "./lib/drive.mjs";
import { erzeugeGithub } from "./lib/github.mjs";
import { PROJEKT_MUSTER, abnahme, basisUrl, gaesteLink, projektName, schreibeAusgabe, slug } from "./lib/galerie-hilfen.mjs";
import {
  WerkzeugFehler,
  eintragFinden,
  eintragSetzen,
  einstellungen,
  erzeugeGoogleToken,
  fuehreAus,
  googleScopes,
  ladeKonfig,
  ladeRegister,
  leseKonfigRoh,
  leseSchluesselAusSchluesselbund,
  schluesselVorhanden,
} from "./lib/umgebung.mjs";

const WURZEL = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ABLAUF = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const log = (...a) => console.log(...a);

const HILFE = `galerie: Fotogalerien der Event-Galerie

  galerie neu <drive-link-oder-id> --titel "..." [--marke agentur|ambition|blueprint] [--projekt fotos-...] [--ablauf <ISO>]
      Ordner prüfen (liegt er nicht in der Geteilten Ablage, wird er dorthin kopiert), Code erzeugen,
      bauen lassen, Lauf beobachten, Bericht lesen, live abnehmen. Gibt Link, Code, QR und Text aus.
      Ohne --ablauf läuft die Galerie nie ab. Standardmarke: agentur.
  galerie neu-bauen <projekt> [--titel "..."]   gleicher Code, gleiche Adresse (z. B. neue Fotos)
  galerie liste                                  alle Galerien aus dem Register, mit Live-Stand
  galerie status <projekt>                       Register und Live-Stand einer Galerie
  galerie offline <projekt>                      Platzhalter statt Galerie, Adresse bleibt
  galerie loeschen <projekt> [--ja]              Pages-Projekt ganz löschen (fragt nach, außer --ja)
  galerie pruefen                                Vorbedingungen prüfen, Konfiguration anlegen

  Allgemein: --zeitlimit <min> (Standard 200)

Einmal verlinken:  ln -s "${join(WURZEL, "werkzeug", "galerie")}" /usr/local/bin/galerie
Abhängigkeit:      cd "${join(WURZEL, "werkzeug")}" && npm ci
`;

async function markenListe() {
  const out = {};
  for (const e of await readdir(join(WURZEL, "marken"), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    try {
      out[e.name] = JSON.parse(await readFile(join(WURZEL, "marken", e.name, "marke.json"), "utf8"));
    } catch {
      // Ordner ohne marke.json (z. B. schriften)
    }
  }
  return out;
}

/** Vorbedingungen mit verständlicher Meldung. Prüft nur, was der Befehl braucht. */
async function vorbedingungen(e, { github = true, google = false, schluessel = false, gh } = {}) {
  const fehlt = [];
  if (Number(process.versions.node.split(".")[0]) < 20) fehlt.push(["Node 20 oder neuer nötig", "brew install node"]);
  if (github) {
    try {
      if (!(await gh.angemeldet())) fehlt.push(["gh ist nicht angemeldet", "gh auth login"]);
    } catch (f) {
      fehlt.push([f.message, "brew install gh && gh auth login"]);
    }
  }
  let holeToken = null;
  if (google) {
    holeToken = erzeugeGoogleToken();
    try {
      const scopes = await googleScopes(e, holeToken);
      if (!scopes.includes("https://www.googleapis.com/auth/drive")) {
        fehlt.push(["gcloud-Anmeldung ohne Drive-Recht", "gcloud auth login --enable-gdrive-access"]);
      }
    } catch (f) {
      fehlt.push([f.message, f.hinweis || "gcloud auth login --enable-gdrive-access"]);
    }
  }
  if (schluessel) {
    try {
      if (!(await schluesselVorhanden(e))) fehlt.push(["Galerie-Schlüssel fehlt im Schlüsselbund", "einrichtung/github-einrichten.sh"]);
    } catch (f) {
      fehlt.push([f.message, "nur auf dem Mac mit Schlüsselbund"]);
    }
  }
  if (fehlt.length) {
    throw new WerkzeugFehler(`Vorbedingungen fehlen:\n${fehlt.map(([a, b]) => `  - ${a} (${b})`).join("\n")}`);
  }
  return { holeToken };
}

async function codeHashEnc(code, galerieId, e) {
  const hash = await erzeugeCodeHash(code, { salz: new Uint8Array(randomBytes(SALZ_BYTES)) });
  let schluessel = await leseSchluesselAusSchluesselbund(e);
  try {
    leseSchluessel(schluessel);
    return { enc: verschluessele(hash, schluessel, galerieId), schluessel };
  } catch {
    schluessel = null;
    throw new WerkzeugFehler("Galerie-Schlüssel im Schlüsselbund hat das falsche Format (32 Byte Base64 erwartet)");
  }
}

/** Startet bauen.yml, beobachtet, liest den Bericht und nimmt die Galerie live ab. */
async function bauenUndAbnehmen({ e, gh, eintrag, code, ablauf, zeitlimitMs }) {
  const { enc, schluessel } = await codeHashEnc(code, eintrag.id, e);
  const inputs = {
    galerie_id: eintrag.id,
    marke: eintrag.marke,
    titel: eintrag.titel,
    ordner_id: eintrag.ordner,
    ablauf: ablauf || "nie",
    code_hash_enc: enc,
    projekt: eintrag.projekt,
  };
  log("Bau starten");
  const laufId = await gh.starte("bauen.yml", inputs, `bauen ${eintrag.id}`);
  const lauf0 = await gh.lauf(laufId);
  log(`  Lauf ${lauf0.html_url}`);
  await eintragSetzen(e, { projekt: eintrag.projekt, lauf: lauf0.html_url, status: "baut" });
  const lauf = await gh.beobachte(laufId, { zeitlimitMs });
  let bericht = null;
  try {
    const benc = await gh.berichtEnc(laufId);
    if (benc) bericht = JSON.parse(entschluesseleText(benc, schluessel, eintrag.id));
  } catch (f) {
    log(`  Bericht nicht lesbar: ${f.message}`);
  }
  if (lauf.conclusion !== "success") {
    const { schritt, zeilen } = await gh.fehlerAuszug(laufId);
    await eintragSetzen(e, { projekt: eintrag.projekt, status: "fehlgeschlagen" });
    const teile = [`Bau ${lauf.conclusion || "fehlgeschlagen"}${schritt ? ` im Schritt „${schritt}“` : ""}`];
    if (bericht?.fehler) teile.push(`Bericht: ${bericht.fehler}${bericht.fehlerDatei ? ` (Datei ${bericht.fehlerDatei})` : ""}`);
    if (bericht?.md5Fehler?.length) teile.push(`md5-Fehler: ${bericht.md5Fehler.join(", ")}`);
    if (zeilen.length) teile.push(`Log-Auszug:\n${zeilen.map((z) => `    ${z}`).join("\n")}`);
    throw new WerkzeugFehler(teile.join("\n"), { hinweis: lauf.html_url });
  }
  if (!bericht) throw new WerkzeugFehler("Lauf erfolgreich, aber kein lesbarer Bericht", { hinweis: lauf.html_url });
  const dauer = Math.round((Date.parse(lauf.updated_at) - Date.parse(lauf.run_started_at || lauf.created_at)) / 1000);
  log(`Bau fertig in ${Math.floor(dauer / 60)} min ${dauer % 60} s`);
  log(`  ${bericht.anzahl} Fotos, ${(bericht.bytesOriginale / 1e9).toFixed(2)} GB Originale, Deployment ${(bericht.bytesGesamt / 1e9).toFixed(2)} GB in ${bericht.dateien ?? "?"} Dateien`);
  log(`  ${bericht.dubletten} Dubletten, ${bericht.uebersprungen.length} übersprungen, ${bericht.geteilteOriginale.length} geteilte Originale`);
  if (bericht.uebersprungen.length) log(`  übersprungen: ${bericht.uebersprungen.slice(0, 10).map((u) => `${u.name} (${u.grund})`).join(", ")}${bericht.uebersprungen.length > 10 ? " …" : ""}`);
  if (bericht.gpsFunde.length) {
    log(`  ACHTUNG: ${bericht.gpsFunde.length} Originale enthalten den Aufnahmeort (GPS) und gehen so an jeden mit Link.`);
    log(`  ${bericht.gpsFunde.slice(0, 10).join(", ")}${bericht.gpsFunde.length > 10 ? " …" : ""}`);
  } else log("  keine GPS-Daten in den Originalen");
  log("Abnahme gegen die Live-Adresse");
  const basis = basisUrl(e.pagesUrl, eintrag.projekt);
  const ab = await abnahme({ basis, titel: eintrag.titel, code, erwarteteAnzahl: bericht.anzahl, protokoll: log });
  return { lauf, bericht, abnahme: ab, dauer };
}

function ausgabeBlock({ link, code, dateien, titel }) {
  log("");
  log(`Link für die Gäste: ${link}`);
  log(`Code:               ${code}`);
  log(`QR-Code:            ${dateien.png}`);
  log(`                    ${dateien.svg}`);
  log(`Text für die Gäste: ${dateien.text}`);
  log("");
  log(`  Die Fotos von ${titel} sind online: ${link}`);
  log(`  Falls die Seite nach einem Code fragt: ${code}`);
}

async function befehlNeu(e, gh, pos, w) {
  if (!pos[0]) throw new WerkzeugFehler("Drive-Link oder Ordner-ID fehlt", { hinweis: "galerie neu <link> --titel \"...\"" });
  const titel = (w.titel || "").trim();
  if (!titel || titel.length > 200 || /[\u0000-\u001f\u007f]/.test(titel)) throw new WerkzeugFehler("--titel fehlt oder ist ungültig");
  const marke = w.marke || "agentur";
  const marken = await markenListe();
  if (!marken[marke]) throw new WerkzeugFehler(`Marke ${marke} gibt es nicht (${Object.keys(marken).join(", ")})`);
  if (w.ablauf && (!ABLAUF.test(w.ablauf) || !(Date.parse(w.ablauf) > Date.now()))) throw new WerkzeugFehler("--ablauf muss ein ISO-Datum mit Zeitzone in der Zukunft sein");
  const quelle = ordnerIdAusLink(pos[0]);
  const projekt = w.projekt || projektName(titel);
  if (!PROJEKT_MUSTER.test(projekt)) throw new WerkzeugFehler("--projekt muss fotos-<a-z0-9-> sein (höchstens 56 Zeichen)");
  if (Object.values(marken).some((m) => m.pagesProjekt === projekt)) throw new WerkzeugFehler(`${projekt} ist das Projekt einer Marke, dafür gibt es das Krüger OS`);
  const register = await ladeRegister(e);
  if (register.galerien.some((g) => g.projekt === projekt && g.status !== "geloescht")) {
    throw new WerkzeugFehler(`Galerie ${projekt} gibt es schon`, { hinweis: `galerie neu-bauen ${projekt}` });
  }

  const { holeToken } = await vorbedingungen(e, { google: true, schluessel: true, gh });
  const drive = erzeugeDriveWerkzeug({ api: e.driveApi, holeToken, protokoll: log });
  const konfig = await ladeKonfig(e, { ablageFinden: () => ablageFinden(drive) });

  // Belegt? Eine fremde Galerie unter derselben Adresse nie überschreiben.
  const belegt = await fetch(`${basisUrl(e.pagesUrl, projekt)}/status.json`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (belegt?.status === 200 && /json/.test(belegt.headers.get("content-type") || "")) {
    throw new WerkzeugFehler(`Unter ${projekt}.pages.dev läuft schon eine Galerie, die nicht im Register steht`);
  }

  log(`Drive-Ordner prüfen`);
  const info = await drive.info(quelle);
  if (info.mimeType !== "application/vnd.google-apps.folder") throw new WerkzeugFehler("Der Link zeigt nicht auf einen Ordner");
  if (info.trashed) throw new WerkzeugFehler("Der Ordner liegt im Papierkorb");
  let ordner = quelle;
  if (info.driveId === konfig.ablage) {
    log("  liegt in der Geteilten Ablage");
  } else {
    const frueher = register.galerien.find((g) => g.quelle === quelle && g.ordner);
    log("  liegt nicht in der Geteilten Ablage, wird serverseitig kopiert");
    ordner = frueher?.ordner || (await drive.ordnerIn(konfig.ablage, titel));
    const stand = await drive.kopiereBaum(quelle, ordner);
    log(`  ${stand.kopiert} kopiert, ${stand.schonDa} schon da, ${stand.fehler} Fehler`);
    if (stand.fehler) throw new WerkzeugFehler(`${stand.fehler} Dateien nicht kopiert`, { hinweis: "Befehl einfach noch einmal ausführen, Kopiertes wird übersprungen" });
  }
  const zahl = await drive.zaehle(ordner);
  log(`  ${zahl.bilder} Fotos, ${(zahl.bytes / 1e9).toFixed(2)} GB`);
  if (!zahl.bilder) throw new WerkzeugFehler("Im Ordner liegen keine Fotos (JPG, PNG, HEIC)");

  const id = randomUUID();
  const code = zufallsCode(8, (n) => randomBytes(n));
  if (!new RegExp(`^[${CODE_ALPHABET}]{8}$`).test(code)) throw new WerkzeugFehler("Code-Erzeugung fehlerhaft");
  const link = gaesteLink(projekt, code);
  const eintrag = await eintragSetzen(e, {
    id, titel, marke, projekt, ordner, quelle: quelle === ordner ? undefined : quelle,
    erstellt: new Date().toISOString(), link, code, ablauf: w.ablauf || null, status: "startet",
  });
  log(`Galerie ${projekt}, ID ${id}`);
  const r = await bauenUndAbnehmen({ e, gh, eintrag, code, ablauf: w.ablauf, zeitlimitMs: w.zeitlimitMs });
  const dateien = await schreibeAusgabe(join(e.downloads, `Galerie-${slug(titel)}`), { titel, link, code });
  await eintragSetzen(e, { projekt, status: "online", anzahl: r.bericht.anzahl, bytes: r.bericht.bytesOriginale, gps: r.bericht.gpsFunde.length });
  ausgabeBlock({ link, code, dateien, titel });
}

async function ablageFinden(drive) {
  const passend = (await drive.ablagen()).filter((d) => /galerie|foto/i.test(d.name));
  if (passend.length === 1) return passend[0].id;
  return null;
}

async function befehlNeuBauen(e, gh, pos, w) {
  const g = await eintragFinden(e, pos[0]);
  if (g.status === "geloescht") throw new WerkzeugFehler("Diese Galerie ist gelöscht");
  if (!g.code || !g.ordner || !g.id) throw new WerkzeugFehler("Im Register fehlen Code, Ordner oder ID");
  await vorbedingungen(e, { schluessel: true, gh });
  const titel = (w.titel || g.titel).trim();
  const eintrag = await eintragSetzen(e, { projekt: g.projekt, titel });
  const r = await bauenUndAbnehmen({ e, gh, eintrag, code: g.code, ablauf: g.ablauf, zeitlimitMs: w.zeitlimitMs });
  const dateien = await schreibeAusgabe(join(e.downloads, `Galerie-${slug(titel)}`), { titel, link: g.link, code: g.code });
  await eintragSetzen(e, { projekt: g.projekt, status: "online", anzahl: r.bericht.anzahl, bytes: r.bericht.bytesOriginale, gps: r.bericht.gpsFunde.length });
  ausgabeBlock({ link: g.link, code: g.code, dateien, titel });
}

async function liveStand(e, projekt) {
  try {
    const r = await fetch(`${basisUrl(e.pagesUrl, projekt)}/api/status`, { signal: AbortSignal.timeout(10000), redirect: "manual" });
    if (r.status === 200 && /json/.test(r.headers.get("content-type") || "")) {
      const j = await r.json();
      return j.abgelaufen ? "abgelaufen" : "online";
    }
    return r.status === 404 ? "offline (Platzhalter)" : `HTTP ${r.status}`;
  } catch {
    return "nicht erreichbar";
  }
}

async function befehlPruefen(e, gh) {
  const { holeToken } = await vorbedingungen(e, { google: true, schluessel: true, gh });
  const drive = erzeugeDriveWerkzeug({ api: e.driveApi, holeToken, protokoll: log });
  const konfig = await ladeKonfig(e, { ablageFinden: () => ablageFinden(drive) });
  const ablage = (await drive.ablagen()).find((d) => d.id === konfig.ablage);
  if (!ablage) throw new WerkzeugFehler("Die konfigurierte Geteilte Ablage ist für dieses Konto nicht sichtbar", { hinweis: e.konfigDatei });
  log("gh angemeldet, gcloud mit Drive-Recht, Galerie-Schlüssel im Schlüsselbund");
  log(`Geteilte Ablage: ${ablage.name}`);
  log(`Repo: ${konfig.repo}`);
  log(`Konfiguration: ${e.konfigDatei}`);
}

async function befehlListe(e) {
  const { galerien } = await ladeRegister(e);
  if (!galerien.length) return log("Noch keine Galerien im Register.");
  const stand = await Promise.all(galerien.map((g) => (g.status === "geloescht" ? "gelöscht" : liveStand(e, g.projekt))));
  for (const [i, g] of galerien.entries()) {
    log(`${g.projekt.padEnd(52)} ${stand[i].padEnd(22)} ${String(g.anzahl ?? "?").padStart(5)} Fotos  ${g.marke.padEnd(9)} ${g.titel}`);
  }
}

async function befehlStatus(e, pos) {
  const g = await eintragFinden(e, pos[0]);
  log(`Titel:    ${g.titel}`);
  log(`Marke:    ${g.marke}`);
  log(`Projekt:  ${g.projekt}`);
  log(`Live:     ${g.status === "geloescht" ? "gelöscht" : await liveStand(e, g.projekt)}`);
  if (g.link && g.status !== "geloescht") log(`Link:     ${g.link}`);
  if (g.code && g.status !== "geloescht") log(`Code:     ${g.code}`);
  log(`Fotos:    ${g.anzahl ?? "?"}${g.bytes ? `, ${(g.bytes / 1e9).toFixed(2)} GB` : ""}${g.gps ? `, ${g.gps} mit GPS` : ""}`);
  log(`Ablauf:   ${g.ablauf || "nie"}`);
  log(`Register: ${g.status}, erstellt ${g.erstellt}, zuletzt ${g.aktualisiert}`);
  if (g.lauf) log(`Lauf:     ${g.lauf}`);
}

async function offlineLauf(e, gh, g, aktion, zeitlimitMs) {
  const laufId = await gh.starte("offline.yml", { galerie_id: g.id, marke: g.marke, projekt: g.projekt, aktion }, `${aktion} ${g.id}`);
  log(`  Lauf ${(await gh.lauf(laufId)).html_url}`);
  const lauf = await gh.beobachte(laufId, { zeitlimitMs });
  if (lauf.conclusion !== "success") {
    const { schritt, zeilen } = await gh.fehlerAuszug(laufId);
    throw new WerkzeugFehler(`${aktion} ${lauf.conclusion}${schritt ? ` im Schritt „${schritt}“` : ""}${zeilen.length ? `\n${zeilen.map((z) => `    ${z}`).join("\n")}` : ""}`, { hinweis: lauf.html_url });
  }
  const schritte = (await gh.jobs(laufId)).flatMap((j) => j.steps || []);
  return { lauf, schritte };
}

async function befehlOffline(e, gh, pos, w) {
  const g = await eintragFinden(e, pos[0]);
  await vorbedingungen(e, { gh });
  log(`Offline nehmen: ${g.projekt}`);
  const { schritte } = await offlineLauf(e, gh, g, "offline", w.zeitlimitMs);
  const deployt = schritte.find((s) => s.name === "Offline-Seite deployen")?.conclusion === "success";
  const live = await liveStand(e, g.projekt);
  log(`  ${deployt ? "Platzhalter deployt" : "nichts abgeschaltet (diese Galerie war dort nicht online)"}, live jetzt: ${live}`);
  if (live === "online") throw new WerkzeugFehler("Die Galerie antwortet noch, bitte in einer Minute galerie status prüfen");
  await eintragSetzen(e, { projekt: g.projekt, status: "offline" });
}

async function befehlLoeschen(e, gh, pos, w) {
  const g = await eintragFinden(e, pos[0]);
  if (!w.ja) {
    if (!process.stdin.isTTY) throw new WerkzeugFehler("Löschen braucht eine Bestätigung", { hinweis: `galerie loeschen ${g.projekt} --ja` });
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const antwort = await rl.question(`${g.projekt} (${g.titel}) samt allen Deployments löschen? Tippe den Projektnamen: `);
    rl.close();
    if (antwort.trim() !== g.projekt) throw new WerkzeugFehler("Abgebrochen, nichts gelöscht");
  }
  await vorbedingungen(e, { gh });
  log(`Löschen: ${g.projekt}`);
  const { schritte } = await offlineLauf(e, gh, g, "loeschen", w.zeitlimitMs);
  const geloescht = schritte.find((s) => s.name === "Projekt löschen")?.conclusion === "success";
  const live = await liveStand(e, g.projekt);
  log(`  ${geloescht ? "Pages-Projekt gelöscht (die Cloudflare-API kennt es nicht mehr)" : "Projekt gab es nicht mehr"}, ${g.projekt}.pages.dev: ${live}`);
  if (live === "online") throw new WerkzeugFehler("Die Adresse liefert noch die Galerie, bitte in ein paar Minuten galerie status prüfen");
  await eintragSetzen(e, { projekt: g.projekt, status: "geloescht", code: undefined, link: undefined, geloescht: new Date().toISOString() });
}

export async function haupt(argv = process.argv.slice(2), env = process.env) {
  let werte;
  let pos;
  try {
    ({ values: werte, positionals: pos } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        titel: { type: "string" },
        marke: { type: "string" },
        projekt: { type: "string" },
        ablauf: { type: "string" },
        ja: { type: "boolean" },
        zeitlimit: { type: "string" },
        hilfe: { type: "boolean", short: "h" },
      },
      strict: true,
    }));
  } catch (f) {
    console.error(`${f.message}\n\n${HILFE}`);
    return 2;
  }
  const [befehl, ...rest] = pos;
  if (!befehl || werte.hilfe || befehl === "hilfe") {
    log(HILFE);
    return befehl || werte.hilfe ? 0 : 2;
  }
  const w = { ...werte, zeitlimitMs: Number(werte.zeitlimit || 200) * 60000 };
  const e = einstellungen(env);
  try {
    const roh = await leseKonfigRoh(e);
    const repo = e.repoAusUmgebung || roh.repo || "juliankkrueger/event-galerie";
    const gh = erzeugeGithub({ repo, protokoll: log, taktMs: e.taktMs, ausfuehren: fuehreAus });
    if (!["neu", "liste", "pruefen"].includes(befehl) && !rest[0]) throw new WerkzeugFehler("Projektname fehlt", { hinweis: "galerie liste" });
    if (befehl === "neu") await befehlNeu(e, gh, rest, w);
    else if (befehl === "neu-bauen") await befehlNeuBauen(e, gh, rest, w);
    else if (befehl === "liste") await befehlListe(e);
    else if (befehl === "pruefen") await befehlPruefen(e, gh);
    else if (befehl === "status") await befehlStatus(e, rest);
    else if (befehl === "offline") await befehlOffline(e, gh, rest, w);
    else if (befehl === "loeschen") await befehlLoeschen(e, gh, rest, w);
    else throw new WerkzeugFehler(`Unbekannter Befehl ${befehl}`, { hinweis: "galerie hilfe" });
    return 0;
  } catch (f) {
    console.error(`\nFehler: ${f.message}`);
    if (f.hinweis) console.error(`Hinweis: ${f.hinweis}`);
    if (!(f instanceof WerkzeugFehler) && env.EVENT_GALERIE_DEBUG) console.error(f.stack);
    return 1;
  }
}
