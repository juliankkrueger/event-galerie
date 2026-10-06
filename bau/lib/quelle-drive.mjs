// Quelle "drive:<ordnerId>": Drive API v3, nur lesend (drive.readonly), ADC.
// Fehlertexte enthalten nie Header oder Token.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { exifZeit } from "./exif.mjs";
import { Md5Fehler, md5Strom } from "./teilen.mjs";

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const ORDNER = "application/vnd.google-apps.folder";
const VERKNUEPFUNG = "application/vnd.google-apps.shortcut";
const TYPEN = { "image/jpeg": "image/jpeg", "image/png": "image/png", "image/heic": "image/heic", "image/heif": "image/heic" };
const FELDER =
  "nextPageToken,files(id,name,mimeType,size,md5Checksum,parents,imageMediaMetadata(time,location,width,height,rotation))";
const WIEDERHOLBAR_403 = /downloadQuotaExceeded|userRateLimitExceeded|rateLimitExceeded|sharingRateLimitExceeded/;
export const ID_MUSTER = /^[A-Za-z0-9_-]{10,100}$/;

export class DriveFehler extends Error {
  constructor(status, text) {
    super(`Drive ${status}: ${text}`);
    this.name = "DriveFehler";
    this.status = status;
  }
}

export async function adcToken() {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({ scopes: [SCOPE] });
  return async () => {
    const t = await auth.getAccessToken();
    if (!t) throw new Error("Google-Anmeldung lieferte kein Zugriffstoken (ADC prüfen)");
    return t;
  };
}

const standardWarte = (ms) => new Promise((r) => setTimeout(r, ms));

export function schwaerze(text) {
  return String(text || "")
    .replace(/ya29\.[\w.-]+/g, "[geschwärzt]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[geschwärzt]")
    .replace(/[A-Za-z0-9_+/=-]{40,}/g, "[geschwärzt]")
    .slice(0, 300);
}

async function kurztext(res) {
  try {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      const fehler = j.error || {};
      const grund = fehler.errors?.[0]?.reason;
      return [fehler.message, grund].filter(Boolean).join(" / ").slice(0, 200) || t.slice(0, 200);
    } catch {
      return t.slice(0, 200);
    }
  } catch {
    return "";
  }
}

export function erzeugeDrive({ token, fetchImpl = fetch, warte = standardWarte, versuche = 8, basisMs = 1000, protokoll = () => {} }) {
  // Führt eine Anfrage mit Wiederholung aus. verarbeite(res) darf selbst werfen;
  // Fehler mit .wiederholbar = true werden wiederholt.
  async function mitWiederholung(url, verarbeite, was) {
    let letzter;
    for (let n = 0; n < versuche; n++) {
      let res;
      let zugriff;
      try {
        zugriff = await token();
      } catch (e) {
        // Anmeldefehler werden nicht wiederholt; Text ohne Token- oder Schlüsselreste.
        throw new Error(`Google-Anmeldung fehlgeschlagen: ${schwaerze(e.message)}`);
      }
      try {
        res = await fetchImpl(url, { headers: { Authorization: `Bearer ${zugriff}` } });
      } catch (e) {
        letzter = new Error(`Netzwerkfehler bei ${was}: ${e.cause?.code || e.message}`);
        letzter.wiederholbar = true;
      }
      if (res) {
        if (res.ok) {
          try {
            return await verarbeite(res);
          } catch (e) {
            if (!e.wiederholbar) throw e;
            letzter = e;
          }
        } else {
          const text = await kurztext(res);
          const wiederholbar = res.status === 429 || res.status >= 500 || (res.status === 403 && WIEDERHOLBAR_403.test(text));
          letzter = new DriveFehler(res.status, `${was}: ${text}`);
          if (!wiederholbar) throw letzter;
          letzter.wiederholbar = true;
          const nach = Number(res.headers.get("Retry-After"));
          if (Number.isFinite(nach) && nach > 0) letzter.mindestensMs = Math.min(120000, nach * 1000);
        }
      }
      if (n === versuche - 1) break;
      const ms = Math.max(letzter.mindestensMs || 0, Math.min(64000, basisMs * 2 ** n) + Math.floor(Math.random() * basisMs));
      protokoll(`  Wiederholung ${n + 1}/${versuche - 1} für ${was} in ${Math.round(ms / 1000)} s (${letzter.message})`);
      await warte(ms);
    }
    throw letzter;
  }

  const json = (url, was) => mitWiederholung(url, (res) => res.json(), was);

  async function pruefeOrdner(ordnerId) {
    if (!ID_MUSTER.test(ordnerId)) throw new Error("Ordner-ID ungültig");
    const url = `${DRIVE_API}/files/${ordnerId}?fields=id,name,mimeType,trashed&supportsAllDrives=true`;
    let info;
    try {
      info = await json(url, "Ordner prüfen");
    } catch (e) {
      if (e.status === 404) throw new Error("Drive-Ordner nicht gefunden oder Dienstkonto ohne Zugriff (404)");
      throw e;
    }
    if (info.mimeType !== ORDNER) throw new Error("Drive-ID ist kein Ordner");
    if (info.trashed) throw new Error("Drive-Ordner liegt im Papierkorb");
    return info;
  }

  async function kinder(ordnerId) {
    const alle = [];
    let seite = null;
    let runden = 0;
    do {
      const p = new URLSearchParams({
        q: `'${ordnerId}' in parents and trashed=false`,
        fields: FELDER,
        pageSize: "1000",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        corpora: "allDrives",
      });
      if (seite) p.set("pageToken", seite);
      const antwort = await json(`${DRIVE_API}/files?${p}`, "Liste");
      alle.push(...(antwort.files || []));
      seite = antwort.nextPageToken || null;
      if (++runden > 10000) throw new Error("Zu viele Seiten in der Drive-Liste");
    } while (seite);
    return alle;
  }

  // Ergebnis wie listeLokal: { eintraege, uebersprungen }
  async function listeBaum(ordnerId) {
    await pruefeOrdner(ordnerId);
    const eintraege = [];
    const uebersprungen = [];
    const besucht = new Set([ordnerId]);
    const offen = [{ id: ordnerId, pfad: [] }];
    while (offen.length) {
      const { id, pfad } = offen.shift();
      for (const f of await kinder(id)) {
        const anzeige = [...pfad, f.name].join("/");
        if (f.mimeType === ORDNER) {
          if (!besucht.has(f.id)) {
            besucht.add(f.id);
            offen.push({ id: f.id, pfad: [...pfad, f.name] });
          }
          continue;
        }
        if (f.mimeType === VERKNUEPFUNG) {
          uebersprungen.push({ name: anzeige, grund: "Verknüpfung, nicht übernommen" });
          continue;
        }
        const mime = TYPEN[f.mimeType];
        if (!mime) {
          uebersprungen.push({ name: anzeige, grund: `Dateityp ${f.mimeType} nicht übernommen` });
          continue;
        }
        if (!/^[0-9a-f]{32}$/.test(f.md5Checksum || "")) {
          uebersprungen.push({ name: anzeige, grund: "ohne md5 in Drive" });
          continue;
        }
        const ort = f.imageMediaMetadata?.location;
        eintraege.push({
          pfad,
          name: f.name,
          mime,
          bytes: Number(f.size || 0),
          md5: f.md5Checksum,
          driveId: f.id,
          driveGps: !!ort && (Number(ort.latitude) !== 0 || Number(ort.longitude) !== 0),
          driveZeit: exifZeit(f.imageMediaMetadata?.time),
        });
      }
    }
    return { eintraege, uebersprungen };
  }

  // Lädt eine Datei gestreamt nach ziel und prüft md5 im Strom.
  async function lade(eintrag, ziel) {
    if (!ID_MUSTER.test(eintrag.driveId)) throw new Error("Datei-ID ungültig");
    const url = `${DRIVE_API}/files/${eintrag.driveId}?alt=media&supportsAllDrives=true`;
    // Ohne Datei- und Ordnernamen: Meldungen und Wiederholungen landen im öffentlichen Lauf-Log.
    const was = "Download";
    const teil = `${ziel}.teil`;
    let md5Runden = 0;
    for (;;) {
      const ergebnis = await mitWiederholung(
        url,
        async (res) => {
          const hash = createHash("md5");
          try {
            await pipeline(Readable.fromWeb(res.body), md5Strom(hash), createWriteStream(teil));
          } catch (e) {
            await unlink(teil).catch(() => {});
            const f = new Error(`Abbruch beim Laden: ${e.code || e.message}`);
            f.wiederholbar = true;
            throw f;
          }
          return hash.digest("hex");
        },
        was,
      );
      if (ergebnis === eintrag.md5) {
        await rename(teil, ziel);
        return { md5: ergebnis };
      }
      await unlink(teil).catch(() => {});
      if (++md5Runden >= 2) throw new Md5Fehler([...eintrag.pfad, eintrag.name].join("/"), eintrag.md5, ergebnis);
      protokoll("  md5 weicht ab, lade erneut");
    }
  }

  return { listeBaum, lade, pruefeOrdner };
}
