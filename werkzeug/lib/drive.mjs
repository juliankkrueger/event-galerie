// Drive für das Werkzeug: Ordner-ID aus dem Link, Lage prüfen, Bilder zählen und einen Ordner
// serverseitig (files.copy) in die Geteilte Ablage kopieren. Wiederholbar: Dateien mit gleichem
// Namen und gleicher Größe im Ziel werden übersprungen. Das Token kommt von holeToken() und
// steht nie in Meldungen.

import { WerkzeugFehler, warte } from "./umgebung.mjs";

export const ORDNER = "application/vnd.google-apps.folder";
const ID = /^[A-Za-z0-9_-]{10,100}$/;
// Was der Bau übernimmt (VERTRAG.md, Quelle).
export const BILDTYPEN = new Set(["image/jpeg", "image/png", "image/heic"]);

/** Ordner-ID aus einem Drive-Link oder einer nackten ID. */
export function ordnerIdAusLink(eingabe) {
  const t = String(eingabe || "").trim();
  if (ID.test(t)) return t;
  let u;
  try {
    u = new URL(t);
  } catch {
    throw new WerkzeugFehler("Drive-Link oder Ordner-ID nicht erkannt");
  }
  if (!/(^|\.)google\.com$/.test(u.hostname)) throw new WerkzeugFehler("Kein Google-Drive-Link");
  const m = /\/folders\/([A-Za-z0-9_-]{10,100})/.exec(u.pathname);
  const id = m ? m[1] : u.searchParams.get("id");
  if (!id || !ID.test(id)) throw new WerkzeugFehler("Im Link steht keine Ordner-ID");
  return id;
}

export function erzeugeDriveWerkzeug({ api, holeToken, fetchImpl = fetch, parallel = 6, protokoll = () => {}, pauseMs = 1000 }) {
  async function rufe(pfad, { method = "GET", body } = {}, versuch = 0) {
    let res;
    try {
      res = await fetchImpl(api + pfad, {
        method,
        headers: { Authorization: `Bearer ${await holeToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60000),
      });
    } catch (e) {
      if (versuch < 6) {
        await warte(pauseMs * 2 ** versuch);
        return rufe(pfad, { method, body }, versuch + 1);
      }
      throw new WerkzeugFehler(`Drive nicht erreichbar (${e.name})`);
    }
    if ((res.status === 429 || res.status >= 500 || res.status === 403) && versuch < 6) {
      const text = await res.text();
      if (res.status !== 403 || /rate|quota|userRateLimit/i.test(text)) {
        await warte(pauseMs * 2 ** versuch);
        return rufe(pfad, { method, body }, versuch + 1);
      }
      throw Object.assign(new WerkzeugFehler(`Drive verweigert den Zugriff (403) bei ${pfad.split("?")[0].replace(/[A-Za-z0-9_-]{20,}/g, "<id>")}`), { status: 403 });
    }
    if (!res.ok) {
      throw Object.assign(new WerkzeugFehler(`Drive HTTP ${res.status} bei ${pfad.split("?")[0].replace(/[A-Za-z0-9_-]{20,}/g, "<id>")}`), { status: res.status });
    }
    return res.json();
  }

  const q = (s) => encodeURIComponent(s);
  const ALLE = "supportsAllDrives=true&includeItemsFromAllDrives=true";

  async function info(id) {
    try {
      return await rufe(`/files/${id}?supportsAllDrives=true&fields=${q("id,name,mimeType,driveId,trashed")}`);
    } catch (e) {
      if (e.status === 404) throw new WerkzeugFehler("Drive-Ordner nicht gefunden oder kein Zugriff (404)");
      throw e;
    }
  }

  async function kinder(ordner) {
    const out = [];
    let seite = "";
    do {
      const r = await rufe(
        `/files?q=${q(`'${ordner}' in parents and trashed=false`)}&${ALLE}&corpora=allDrives&pageSize=1000&fields=${q("nextPageToken,files(id,name,mimeType,size)")}${seite ? `&pageToken=${q(seite)}` : ""}`,
      );
      out.push(...(r.files || []));
      seite = r.nextPageToken || "";
    } while (seite);
    return out;
  }

  /** Bilder (wie der Bau sie nimmt) und Bytes im ganzen Baum. */
  async function zaehle(ordner) {
    let bilder = 0;
    let bytes = 0;
    const offen = [ordner];
    while (offen.length) {
      for (const f of await kinder(offen.shift())) {
        if (f.mimeType === ORDNER) offen.push(f.id);
        else if (BILDTYPEN.has(f.mimeType)) {
          bilder++;
          bytes += Number(f.size || 0);
        }
      }
    }
    return { bilder, bytes };
  }

  async function ablagen() {
    const r = await rufe(`/drives?pageSize=100&fields=${q("drives(id,name)")}`);
    return r.drives || [];
  }

  async function ordnerIn(eltern, name) {
    const da = (await kinder(eltern)).find((f) => f.mimeType === ORDNER && f.name === name);
    if (da) return da.id;
    const r = await rufe(`/files?supportsAllDrives=true&fields=id`, { method: "POST", body: { name, mimeType: ORDNER, parents: [eltern] } });
    return r.id;
  }

  /** Kopiert den Baum von quelle nach ziel (beides Ordner-IDs). */
  async function kopiereBaum(quelle, ziel) {
    const stand = { kopiert: 0, schonDa: 0, fehler: 0 };
    async function baum(von, nach) {
      const [inhalt, vorhanden] = await Promise.all([kinder(von), kinder(nach)]);
      const schon = new Set(vorhanden.map((f) => `${f.name}|${f.size ?? ""}`));
      const dateien = inhalt.filter((f) => BILDTYPEN.has(f.mimeType));
      let i = 0;
      await Promise.all(
        Array.from({ length: parallel }, async () => {
          while (i < dateien.length) {
            const f = dateien[i++];
            if (schon.has(`${f.name}|${f.size ?? ""}`)) {
              stand.schonDa++;
              continue;
            }
            try {
              await rufe(`/files/${f.id}/copy?supportsAllDrives=true&fields=id`, { method: "POST", body: { name: f.name, parents: [nach] } });
              stand.kopiert++;
            } catch {
              stand.fehler++;
            }
            const n = stand.kopiert + stand.schonDa;
            if (n % 50 === 0) protokoll(`  ${stand.kopiert} kopiert, ${stand.schonDa} schon da`);
          }
        }),
      );
      for (const o of inhalt.filter((f) => f.mimeType === ORDNER)) await baum(o.id, await ordnerIn(nach, o.name));
    }
    await baum(quelle, ziel);
    return stand;
  }

  return { info, kinder, zaehle, ablagen, ordnerIn, kopiereBaum };
}
