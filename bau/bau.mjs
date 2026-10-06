#!/usr/bin/env node
// Baukette der Event-Galerie. Vertrag: VERTRAG.md
//
// node bau/bau.mjs --quelle drive:<ordnerId> | ordner:<pfad>
//                  --marke <id> --titel "<Text>" --galerie <galerieId>
//                  [--ablauf <ISO-Datum> | nie] --code-hash "<pbkdf2$...>" --aus dist
//
// Ohne --ablauf (oder mit "nie" bzw. leer) läuft die Galerie nie ab.
//
// Zusätzlich (für Tests): --marken <dir> (Standard marken/), --vorlage <dir> (Standard vorlage/)
//
// Das Repo ist öffentlich, also auch jedes Lauf-Log: Ausgaben nennen nur Anzahlen, nie
// Datei- oder Ordnernamen, Bildpfade, Token oder Manifest. Namen stehen nur in bericht.json,
// das der Workflow vor dem Hochladen verschlüsselt.

import { mkdir, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { zerlegeCodeHash } from "../functions/_lib/kennwort.js";
import { datenModul, groesseVerzeichnis, kopiereVerzeichnis, schreibeFesteDateien, statusInhalt } from "./lib/ausgabe.mjs";
import { anzeigeName, bildeKapitel, ordneKapitel } from "./lib/kapitel.mjs";
import { BildFehler, erzeugeFassungen, richteSharpEin } from "./lib/fassungen.mjs";
import { ladeMarke, schreibeMarke } from "./lib/marke.mjs";
import { begrenzer, parallel } from "./lib/parallel.mjs";
import { adcToken, erzeugeDrive, ID_MUSTER } from "./lib/quelle-drive.mjs";
import { listeLokal } from "./lib/quelle-ordner.mjs";
import { legeOriginalAb, Md5Fehler } from "./lib/teilen.mjs";
import { bildIdGeber, neuerCookieSchluessel, neuerTok } from "./lib/zufall.mjs";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOWNLOADS_PARALLEL = 6;
const BILDER_PARALLEL = 3;

export const MUSTER = {
  galerie: /^[A-Za-z0-9_-]{1,64}$/,
  marke: /^[a-z0-9][a-z0-9-]{0,39}$/,
  ablauf: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/,
};

const log = (...a) => console.log(...a);

class EingabeFehler extends Error {}

export function pruefeArgumente(werte, jetzt = Date.now()) {
  const fehler = [];
  const quelle = werte.quelle || "";
  let art = null;
  let ort = null;
  if (quelle.startsWith("drive:")) {
    art = "drive";
    ort = quelle.slice(6);
    if (!ID_MUSTER.test(ort)) fehler.push("--quelle drive:<ordnerId> ungültig");
  } else if (quelle.startsWith("ordner:")) {
    art = "ordner";
    ort = resolve(quelle.slice(7));
    if (!quelle.slice(7)) fehler.push("--quelle ordner:<pfad> ohne Pfad");
  } else fehler.push("--quelle muss mit drive: oder ordner: beginnen");
  if (!MUSTER.marke.test(werte.marke || "")) fehler.push("--marke ungültig");
  if (!MUSTER.galerie.test(werte.galerie || "")) fehler.push("--galerie ungültig (A-Z a-z 0-9 _ -, höchstens 64)");
  const titel = (werte.titel || "").trim();
  if (!titel || titel.length > 200 || /[\u0000-\u001f\u007f]/.test(titel)) fehler.push("--titel fehlt oder ungültig");
  const untertitel = (werte.untertitel || "").trim();
  if (untertitel.length > 120 || /[\u0000-\u001f\u007f]/.test(untertitel)) fehler.push("--untertitel ungültig (höchstens 120 Zeichen)");
  // Ohne Ablauf (fehlt, leer oder "nie") bleibt die Galerie online, bis sie jemand abschaltet.
  const ablaufText = (werte.ablauf ?? "").trim();
  const ablauf = ablaufText === "" || ablaufText === "nie" ? null : ablaufText;
  if (ablauf !== null) {
    if (!MUSTER.ablauf.test(ablauf) || Number.isNaN(Date.parse(ablauf))) {
      fehler.push("--ablauf muss ISO mit Zeitzone sein (z. B. 2027-01-03T23:59:59+01:00) oder nie");
    } else if (Date.parse(ablauf) <= jetzt) fehler.push("--ablauf liegt in der Vergangenheit");
  }
  if (!zerlegeCodeHash(werte["code-hash"])) fehler.push("--code-hash ungültig (pbkdf2$sha256$<iter>$<salz>$<hash>)");
  if (!werte.aus) fehler.push("--aus fehlt");
  if (fehler.length) throw new EingabeFehler(fehler.join("\n"));
  return {
    art,
    ort,
    marke: werte.marke,
    galerie: werte.galerie,
    titel,
    untertitel,
    ablauf,
    codeHash: werte["code-hash"],
    aus: resolve(werte.aus),
    marken: resolve(werte.marken || join(WURZEL, "marken")),
    vorlage: resolve(werte.vorlage || join(WURZEL, "vorlage")),
  };
}

async function leereZiel(aus) {
  const st = await stat(aus).catch(() => null);
  if (!st) return;
  if (!st.isDirectory()) throw new EingabeFehler(`--aus ist kein Ordner: ${aus}`);
  const inhalt = await readdir(aus);
  if (inhalt.length && !inhalt.includes("_routes.json")) {
    throw new EingabeFehler(`--aus ist nicht leer und kein früherer Bau: ${aus}`);
  }
  await rm(aus, { recursive: true, force: true });
}

export async function baue(a) {
  const beginn = Date.now();
  const bericht = {
    galerie: a.galerie,
    marke: a.marke,
    anzahl: 0,
    dubletten: 0,
    bytesOriginale: 0,
    bytesGesamt: 0,
    geteilteOriginale: [],
    gpsFunde: [],
    md5Fehler: [],
    uebersprungen: [],
    dauerSek: 0,
  };
  const arbeit = `${a.aus}.arbeit`;
  let zielAngelegt = false;
  try {
    const marke = await ladeMarke(a.marken, a.marke);
    const vorlageDa = await stat(a.vorlage).catch(() => null);
    if (!vorlageDa?.isDirectory()) throw new Error(`Vorlage fehlt: ${a.vorlage}`);

    await leereZiel(a.aus);
    await rm(arbeit, { recursive: true, force: true });
    await mkdir(a.aus, { recursive: true });
    zielAngelegt = true;
    await mkdir(arbeit, { recursive: true });

    log(`Vorlage und Marke ${a.marke}`);
    await kopiereVerzeichnis(a.vorlage, a.aus, { auslassen: (n) => n === "functions" || n === "_headers" || n === "_routes.json" });
    await schreibeMarke(a.aus, marke);

    log(`Quelle ${a.art === "drive" ? "Drive" : "Ordner"} lesen`);
    let drive = null;
    let liste;
    if (a.art === "drive") {
      drive = erzeugeDrive({ token: await adcToken(), protokoll: log });
      liste = await drive.listeBaum(a.ort);
    } else {
      liste = await listeLokal(a.ort);
    }
    bericht.uebersprungen.push(...liste.uebersprungen);
    const { kapitel, dubletten } = bildeKapitel(liste.eintraege);
    bericht.dubletten = dubletten.length;
    bericht.dublettenNamen = dubletten.map((d) => d.name);
    const bilder = kapitel.flatMap((k) => k.bilder);
    log(`${bilder.length} Bilder in ${kapitel.length} Kapiteln, ${dubletten.length} Dubletten, ${liste.uebersprungen.length} übersprungen`);

    // Früh scheitern statt nach Stunden: je Bild mindestens 4 Dateien, Pages erlaubt 20.000.
    if (bilder.length * 4 > 19500) throw new Error(`${bilder.length} Bilder sind zu viele für ein Pages-Deployment (höchstens etwa 4.800)`);

    const tok = neuerTok();
    const basis = join(a.aus, "b", tok);
    for (const f of ["r", "g", "h", "o"]) await mkdir(join(basis, f), { recursive: true });
    const neueId = bildIdGeber();
    const sharpPlatz = begrenzer(BILDER_PARALLEL);
    richteSharpEin();

    let fertig = 0;
    const melde = () => {
      fertig++;
      if (fertig % 25 === 0 || fertig === bilder.length) log(`  ${fertig}/${bilder.length} Bilder`);
    };
    await parallel(bilder, a.art === "drive" ? DOWNLOADS_PARALLEL : BILDER_PARALLEL, async (e) => {
      try {
        await verarbeite(e);
      } finally {
        melde();
      }
    });

    async function verarbeite(e) {
      const id = neueId();
      const name = anzeigeName(e);
      let lokal = e.lokal;
      if (drive) {
        lokal = join(arbeit, id);
        try {
          await drive.lade(e, lokal);
        } catch (f) {
          // Dateinamen nur in den (verschlüsselten) Bericht, nie ins öffentliche Log.
          if (f instanceof Md5Fehler) bericht.md5Fehler.push(name);
          else bericht.fehlerDatei ??= name;
          throw f;
        }
      }
      try {
        const ziele = { r: join(basis, "r", `${id}.jpg`), g: join(basis, "g", `${id}.jpg`), h: join(basis, "h", `${id}.jpg`) };
        let ergebnis;
        try {
          ergebnis = await sharpPlatz(() => erzeugeFassungen(lokal, ziele, { mime: e.mime, arbeitsPfad: join(arbeit, id) }));
        } catch (f) {
          if (!(f instanceof BildFehler)) throw f;
          bericht.uebersprungen.push({ name, grund: f.grund });
          for (const z of Object.values(ziele)) await unlink(z).catch(() => {});
          e.entfernt = true;
          return;
        }
        let ablage;
        try {
          ablage = await legeOriginalAb(lokal, join(basis, "o", id), { verschieben: !!drive, md5Erwartet: e.md5, name });
        } catch (f) {
          if (f instanceof Md5Fehler) bericht.md5Fehler.push(name);
          throw f;
        }
        if (ablage.geteilt) bericht.geteilteOriginale.push(name);
        if (ergebnis.gps || e.driveGps) bericht.gpsFunde.push(name);
        const pfad = (f) => `/b/${tok}/${f}/${id}.jpg`;
        e.manifest = {
          id,
          name: e.name,
          w: ergebnis.w,
          hoehe: ergebnis.h,
          aufnahme: ergebnis.aufnahme || e.driveZeit || null,
          r: pfad("r"),
          g: pfad("g"),
          h: { pfad: pfad("h"), bytes: ergebnis.hBytes },
          o: {
            teile: ablage.teile.map((_, i) => `/b/${tok}/o/${id}.${i + 1}`),
            bytes: ablage.bytes,
            md5: e.md5,
            typ: e.mime,
          },
        };
        bericht.bytesOriginale += ablage.bytes;
      } finally {
        if (drive) await unlink(lokal).catch(() => {});
      }
    }

    const manifestKapitel = ordneKapitel(
      kapitel
        .map((k) => ({ titel: k.titel, bilder: k.bilder.filter((b) => !b.entfernt).map((b) => b.manifest) }))
        .filter((k) => k.bilder.length),
    );
    const anzahl = manifestKapitel.reduce((s, k) => s + k.bilder.length, 0);
    const manifest = {
      galerie: a.galerie,
      marke: a.marke,
      titel: a.titel,
      ...(a.untertitel ? { untertitel: a.untertitel } : {}),
      // Ohne Ablauf fehlt der Schlüssel ganz (die Oberfläche zeigt dann kein „online bis“).
      ...(a.ablauf ? { ablauf: a.ablauf } : {}),
      erstellt: new Date().toISOString(),
      anzahl,
      bytesOriginale: bericht.bytesOriginale,
      kapitel: manifestKapitel,
    };
    bericht.anzahl = anzahl;

    log("Function und feste Dateien");
    await kopiereVerzeichnis(join(WURZEL, "functions"), join(a.aus, "functions"), { auslassen: (n) => n === "_daten.js" });
    await writeFile(
      join(a.aus, "functions", "_daten.js"),
      datenModul({ manifest, codeHash: a.codeHash, cookieSchluessel: neuerCookieSchluessel(), ablauf: a.ablauf, galerie: a.galerie }),
    );
    await schreibeFesteDateien(a.aus);
    await writeFile(join(a.aus, "status.json"), statusInhalt({ titel: a.titel, marke: a.marke, ablauf: a.ablauf }));
    const groesse = await groesseVerzeichnis(a.aus);
    bericht.bytesGesamt = groesse.bytes;
    bericht.dateien = groesse.dateien;
    // Cloudflare Pages: höchstens 20.000 Dateien je Deployment (Free).
    if (groesse.dateien > 19900) throw new Error(`${groesse.dateien} Dateien, Pages erlaubt höchstens 20.000`);
    if (anzahl === 0) log("Achtung: Die Galerie enthält keine Bilder.");
    return bericht;
  } catch (e) {
    bericht.fehler = e.message;
    // Ein halber Bau darf nie deployt werden.
    if (zielAngelegt) await rm(a.aus, { recursive: true, force: true }).catch(() => {});
    throw Object.assign(e, { bericht });
  } finally {
    bericht.dauerSek = Math.round((Date.now() - beginn) / 100) / 10;
    await rm(arbeit, { recursive: true, force: true }).catch(() => {});
  }
}

async function haupt() {
  let werte;
  try {
    ({ values: werte } = parseArgs({
      options: {
        quelle: { type: "string" },
        marke: { type: "string" },
        titel: { type: "string" },
        untertitel: { type: "string" },
        galerie: { type: "string" },
        ablauf: { type: "string" },
        "code-hash": { type: "string" },
        aus: { type: "string" },
        marken: { type: "string" },
        vorlage: { type: "string" },
      },
      strict: true,
    }));
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  let a;
  try {
    a = pruefeArgumente(werte);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const berichtPfad = join(dirname(a.aus), "bericht.json");
  try {
    const bericht = await baue(a);
    await writeFile(berichtPfad, `${JSON.stringify(bericht, null, 2)}\n`);
    log(
      `Fertig: ${bericht.anzahl} Bilder, ${bericht.dubletten} Dubletten, ${bericht.uebersprungen.length} übersprungen, ` +
        `${bericht.gpsFunde.length} mit GPS, ${bericht.geteilteOriginale.length} geteilt, ` +
        `${(bericht.bytesGesamt / 1e6).toFixed(1)} MB in ${bericht.dateien} Dateien, ${bericht.dauerSek} s`,
    );
    log(`Bericht: ${berichtPfad}`);
    return 0;
  } catch (e) {
    if (e.bericht) await writeFile(berichtPfad, `${JSON.stringify(e.bericht, null, 2)}\n`).catch(() => {});
    console.error(`Bau abgebrochen: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await haupt();
}
