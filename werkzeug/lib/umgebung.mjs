// Umgebung des Werkzeugs: Prozesse starten, Konfiguration und Register lesen und schreiben,
// Schlüssel aus dem Schlüsselbund und Google-Zugriffstoken holen.
//
// Geheimnisse (Galerie-Schlüssel, Google-Token) bleiben im Speicher dieses Prozesses. Sie gehen
// nie in Ausgaben, Fehlermeldungen, Dateien oder Argumente anderer Prozesse.

import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const SCHLUESSEL_DIENST = "webwerkstatt:agentur:event-galerie-schluessel";

export class WerkzeugFehler extends Error {
  constructor(meldung, { hinweis } = {}) {
    super(meldung);
    this.name = "WerkzeugFehler";
    this.hinweis = hinweis;
  }
}

/** Einstellungen aus der Umgebung (für Tests umlenkbar). */
export function einstellungen(env = process.env) {
  const konfigDir = env.EVENT_GALERIE_KONFIG_DIR || join(homedir(), ".config", "event-galerie");
  return {
    konfigDir,
    konfigDatei: join(konfigDir, "konfig.json"),
    registerDatei: join(konfigDir, "galerien.json"),
    downloads: env.EVENT_GALERIE_DOWNLOADS || join(homedir(), "Downloads"),
    driveApi: env.EVENT_GALERIE_DRIVE_API || "https://www.googleapis.com/drive/v3",
    tokeninfo: env.EVENT_GALERIE_TOKENINFO || "https://oauth2.googleapis.com/tokeninfo",
    pagesUrl: env.EVENT_GALERIE_PAGES_URL || "https://{projekt}.pages.dev",
    taktMs: Number(env.EVENT_GALERIE_TAKT_MS || 15000),
    ablageAusUmgebung: env.EVENT_GALERIE_ABLAGE || "",
    repoAusUmgebung: env.EVENT_GALERIE_REPO || "",
    konto: env.EVENT_GALERIE_KONTO || "julian",
  };
}

/**
 * Startet ein Programm ohne Shell. Ergebnis { code, stdout, stderr }; wirft nur, wenn das
 * Programm fehlt oder das Zeitlimit greift. stdin optional (Text oder Buffer).
 */
export function fuehreAus(programm, args, { stdin, zeitMs = 120000, binaer = false, env } = {}) {
  return new Promise((aufloesen, ablehnen) => {
    const kind = execFile(
      programm,
      args,
      { encoding: binaer ? "buffer" : "utf8", maxBuffer: 512 * 1024 * 1024, timeout: zeitMs, env: env || process.env },
      (fehler, stdout, stderr) => {
        if (fehler && (fehler.code === "ENOENT" || fehler.killed)) {
          const f = new WerkzeugFehler(fehler.code === "ENOENT" ? `${programm} ist nicht installiert` : `${programm} antwortet nicht (Zeitlimit)`);
          f.fehlt = fehler.code === "ENOENT";
          ablehnen(f);
          return;
        }
        aufloesen({ code: fehler ? (typeof fehler.code === "number" ? fehler.code : 1) : 0, stdout, stderr: String(stderr || "") });
      },
    );
    if (stdin !== undefined) kind.stdin.end(stdin);
    else kind.stdin.end();
  });
}

export const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wiederholt fn bei Fehlern (Netz, 5xx), mit wachsender Pause. */
export async function mitWiederholung(fn, { versuche = 4, basisMs = 1500, wiederholbar = () => true, protokoll = () => {} } = {}) {
  let letzter;
  for (let n = 0; n < versuche; n++) {
    try {
      return await fn(n);
    } catch (e) {
      letzter = e;
      if (!wiederholbar(e) || n === versuche - 1) break;
      const ms = basisMs * 2 ** n;
      protokoll(`  Wiederholung in ${Math.round(ms / 1000)} s (${e.message})`);
      await warte(ms);
    }
  }
  throw letzter;
}

async function schreibeGeschuetzt(datei, inhalt, dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  const tmp = `${datei}.neu-${process.pid}`;
  await writeFile(tmp, inhalt, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, datei);
}

async function leseJson(datei) {
  try {
    return JSON.parse(await readFile(datei, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw new WerkzeugFehler(`${datei} ist kein gültiges JSON (${e.message})`);
  }
}

/** Gespeicherte Konfiguration ohne Prüfung und ohne Anlegen ({} wenn keine da ist). */
export async function leseKonfigRoh(e) {
  return (await leseJson(e.konfigDatei)) || {};
}

/** Lokale Konfiguration (Ablage-ID, Repo). Legt sie beim ersten Lauf an. */
export async function ladeKonfig(e, { ablageFinden } = {}) {
  const gespeichert = (await leseJson(e.konfigDatei)) || {};
  const konfig = { repo: "juliankkrueger/event-galerie", ...gespeichert };
  if (e.repoAusUmgebung) konfig.repo = e.repoAusUmgebung;
  if (e.ablageAusUmgebung) konfig.ablage = e.ablageAusUmgebung;
  let geaendert = !Object.keys(gespeichert).length;
  if (!konfig.ablage && ablageFinden) {
    konfig.ablage = await ablageFinden();
    geaendert = true;
  }
  if (!konfig.ablage) {
    throw new WerkzeugFehler("Keine Geteilte Ablage konfiguriert", {
      hinweis: `EVENT_GALERIE_ABLAGE setzen oder in ${e.konfigDatei} "ablage": "<ID der Geteilten Ablage>" eintragen`,
    });
  }
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(konfig.ablage)) throw new WerkzeugFehler("Ablage-ID in der Konfiguration ist ungültig");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(konfig.repo)) throw new WerkzeugFehler("Repo in der Konfiguration ist ungültig");
  if (geaendert) await schreibeGeschuetzt(e.konfigDatei, `${JSON.stringify({ ablage: konfig.ablage, repo: konfig.repo }, null, 2)}\n`, e.konfigDir);
  return konfig;
}

/** Register der Galerien (lokal, Rechte 600). Enthält den Code: der geht ohnehin an Gäste. */
export async function ladeRegister(e) {
  const r = (await leseJson(e.registerDatei)) || { galerien: [] };
  if (!Array.isArray(r.galerien)) throw new WerkzeugFehler(`${e.registerDatei}: galerien fehlt`);
  return r;
}

export async function speichereRegister(e, register) {
  await schreibeGeschuetzt(e.registerDatei, `${JSON.stringify(register, null, 2)}\n`, e.konfigDir);
}

export async function eintragSetzen(e, eintrag) {
  const r = await ladeRegister(e);
  const i = r.galerien.findIndex((g) => g.projekt === eintrag.projekt);
  const neu = { ...(i >= 0 ? r.galerien[i] : {}), ...eintrag, aktualisiert: new Date().toISOString() };
  if (i >= 0) r.galerien[i] = neu;
  else r.galerien.push(neu);
  await speichereRegister(e, r);
  return neu;
}

export async function eintragFinden(e, projekt) {
  const r = await ladeRegister(e);
  const g = r.galerien.find((x) => x.projekt === projekt);
  if (!g) throw new WerkzeugFehler(`Galerie ${projekt} steht nicht im Register`, { hinweis: "galerie liste zeigt alle bekannten Galerien" });
  return g;
}

/** Prüft nur, ob der Schlüssel im Schlüsselbund steht (ohne den Wert zu lesen). */
export async function schluesselVorhanden(e) {
  const r = await fuehreAus("security", ["find-generic-password", "-s", SCHLUESSEL_DIENST, "-a", e.konto], { zeitMs: 20000 });
  return r.code === 0;
}

/** Liest den Galerie-Schlüssel. Der Wert bleibt in diesem Prozess. */
export async function leseSchluesselAusSchluesselbund(e) {
  const r = await fuehreAus("security", ["find-generic-password", "-s", SCHLUESSEL_DIENST, "-a", e.konto, "-w"], { zeitMs: 20000 });
  if (r.code !== 0) {
    throw new WerkzeugFehler("Galerie-Schlüssel nicht im Schlüsselbund", {
      hinweis: `Dienst ${SCHLUESSEL_DIENST}, Konto ${e.konto}. Einrichten mit einrichtung/github-einrichten.sh`,
    });
  }
  return r.stdout.trim();
}

/** Google-Zugriffstoken von gcloud, alle 30 Minuten neu. Nie ausgeben. */
export function erzeugeGoogleToken() {
  let token = null;
  let zeit = 0;
  return async function holeToken() {
    if (!token || Date.now() - zeit > 30 * 60 * 1000) {
      const r = await fuehreAus("gcloud", ["auth", "print-access-token"], { zeitMs: 60000 });
      if (r.code !== 0 || !r.stdout.trim()) {
        throw new WerkzeugFehler("gcloud liefert kein Zugriffstoken", {
          hinweis: "gcloud auth login --enable-gdrive-access (mit dem Agentur-Konto)",
        });
      }
      token = r.stdout.trim();
      zeit = Date.now();
    }
    return token;
  };
}

/** Prüft, ob das gcloud-Token Drive (Schreiben, für Kopien) darf. Gibt die Scopes zurück. */
export async function googleScopes(e, holeToken, fetchImpl = fetch) {
  const token = await holeToken();
  const res = await fetchImpl(e.tokeninfo, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: token }).toString(),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new WerkzeugFehler(`Google lehnt das gcloud-Token ab (HTTP ${res.status})`, { hinweis: "gcloud auth login --enable-gdrive-access" });
  const j = await res.json();
  return String(j.scope || "").split(/\s+/).filter(Boolean);
}
