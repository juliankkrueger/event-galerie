#!/usr/bin/env node
// Baut die Seite "Für diese Adresse ist gerade keine Galerie online." für eine Marke.
// Ohne Function, ohne _routes.json.
//
// node bau/offline.mjs --marke <id> --aus dist-offline [--marken <dir>] [--vorlage <dir>]

import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { kopiereVerzeichnis } from "./lib/ausgabe.mjs";
import { ladeMarke, schreibeMarke } from "./lib/marke.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, "..");

export const OFFLINE_HEADERS = `/*
  X-Robots-Tag: noindex, nofollow
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  Cache-Control: no-cache
`;

const ersetzeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z]);

export async function baueOffline({ marke: id, aus, marken, vorlage }) {
  const m = await ladeMarke(marken, id);
  const st = await stat(aus).catch(() => null);
  if (st) {
    const inhalt = await readdir(aus);
    if (inhalt.length && !inhalt.includes("_headers")) throw new Error(`--aus ist nicht leer: ${aus}`);
    await rm(aus, { recursive: true, force: true });
  }
  await mkdir(join(aus, "assets"), { recursive: true });

  const werte = {
    NAME: m.marke.name,
    EVENT: m.marke.eventSeite,
    IMPRESSUM: m.marke.impressum,
    DATENSCHUTZ: m.marke.datenschutz,
  };
  const html = (await readFile(join(HIER, "offline-vorlage", "index.html"), "utf8")).replace(
    /\{\{([A-Z]+)\}\}/g,
    (_, k) => {
      if (!(k in werte)) throw new Error(`Platzhalter {{${k}}} unbekannt`);
      return ersetzeHtml(werte[k]);
    },
  );
  await writeFile(join(aus, "index.html"), html);
  await writeFile(join(aus, "404.html"), html);
  await copyFile(join(HIER, "offline-vorlage", "sw.js"), join(aus, "sw.js"));
  await copyFile(join(HIER, "offline-vorlage", "assets", "offline.css"), join(aus, "assets", "offline.css"));
  const schriften = join(vorlage, "assets", "schriften");
  if (await stat(schriften).catch(() => null)) {
    await kopiereVerzeichnis(schriften, join(aus, "assets", "schriften"));
  }
  await schreibeMarke(aus, m);
  await writeFile(join(aus, "_headers"), OFFLINE_HEADERS);
  return { projekt: m.marke.pagesProjekt, domain: m.marke.domain };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        marke: { type: "string" },
        aus: { type: "string" },
        marken: { type: "string" },
        vorlage: { type: "string" },
      },
      strict: true,
    });
    if (!values.aus) throw new Error("--aus fehlt");
    const ergebnis = await baueOffline({
      marke: values.marke,
      aus: resolve(values.aus),
      marken: resolve(values.marken || join(WURZEL, "marken")),
      vorlage: resolve(values.vorlage || join(WURZEL, "vorlage")),
    });
    console.log(`Offline-Seite für ${ergebnis.projekt} gebaut: ${resolve(values.aus)}`);
  } catch (e) {
    console.error(`Offline-Bau abgebrochen: ${e.message}`);
    process.exitCode = 1;
  }
}
