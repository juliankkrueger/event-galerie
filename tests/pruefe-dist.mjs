#!/usr/bin/env node
// Prüft einen fertigen Bau gegen die Quelle (Vertrag: VERTRAG.md).
//
//   node tests/pruefe-dist.mjs --dist dist --quelle tests/bilder [--code-datei tests/.testcode]
//
// - Original je Bild: Teile zusammengesetzt, md5 = Quelle = Manifest, Teile <= 25.000.000 B
// - r/g/h: ohne EXIF/GPS/XMP/IPTC, Kante 600/2000/3000, Seitenverhältnis = w/hoehe, h < 4 MB und Bytes wie im Manifest
// - Hochformat mit EXIF-Orientation 6: Fassungen stehen hoch, der rote Balken (oben im gespeicherten Bild) liegt rechts
// - Zugangscode steht nirgends im Deployment, Originalnamen nicht in Pfaden
// Ausgabe: JSON mit Zählern. Exit 1 bei jedem Fehler.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";

const { values } = parseArgs({
  options: { dist: { type: "string" }, quelle: { type: "string" }, "code-datei": { type: "string" } },
  strict: true,
});
const DIST = resolve(values.dist || "dist");
const QUELLE = resolve(values.quelle || "tests/bilder");
const KANTE = { r: 600, g: 2000, h: 3000 };
const fehler = [];

async function md5Dateien(pfade) {
  const h = createHash("md5");
  for (const p of pfade) for await (const c of createReadStream(p)) h.update(c);
  return h.digest("hex");
}

async function alleDateien(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await alleDateien(p)));
    else out.push(p);
  }
  return out;
}

const daten = await import(pathToFileURL(join(DIST, "functions", "_daten.js")).href);
const m = daten.manifest;
const quellDateien = (await alleDateien(QUELLE)).filter((p) => /\.(jpe?g|png|heic)$/i.test(p));
const quelleMd5 = new Map();
for (const p of quellDateien) quelleMd5.set(relative(QUELLE, p), await md5Dateien([p]));

const z = { bilder: 0, md5Gleich: 0, geteilt: 0, teileMax: 0, hMaxBytes: 0, hUnter4MB: 0, ohneMetadaten: 0, hochformat: [], gedrehtRichtig: null };
for (const k of m.kapitel) {
  const ordner = k.titel === "Alle Fotos" ? "" : k.titel.split(" · ").join("/");
  for (const b of k.bilder) {
    z.bilder++;
    const rel = ordner ? `${ordner}/${b.name}` : b.name;
    const soll = quelleMd5.get(rel);
    const teile = b.o.teile.map((t) => join(DIST, t));
    const groessen = await Promise.all(teile.map(async (t) => (await stat(t)).size));
    z.teileMax = Math.max(z.teileMax, ...groessen);
    if (groessen.some((g) => g > 25000000)) fehler.push(`${rel}: Teil über 25.000.000 B`);
    if (teile.length > 1) z.geteilt++;
    const summe = groessen.reduce((s, g) => s + g, 0);
    if (summe !== b.o.bytes) fehler.push(`${rel}: Bytes ${summe} statt ${b.o.bytes}`);
    const ist = await md5Dateien(teile);
    if (ist === soll && ist === b.o.md5) z.md5Gleich++;
    else fehler.push(`${rel}: md5 ${ist} / Quelle ${soll} / Manifest ${b.o.md5}`);

    const verhaeltnis = b.w / b.hoehe;
    if (b.hoehe > b.w) z.hochformat.push(rel);
    let ohne = true;
    for (const f of ["r", "g", "h"]) {
      const pfad = join(DIST, f === "h" ? b.h.pfad : b[f]);
      const meta = await sharp(pfad).metadata();
      if (meta.exif || meta.xmp || meta.iptc || (meta.orientation && meta.orientation !== 1)) {
        ohne = false;
        fehler.push(`${rel} ${f}: Metadaten vorhanden`);
      }
      if (Math.max(meta.width, meta.height) !== KANTE[f]) fehler.push(`${rel} ${f}: Kante ${meta.width}x${meta.height}`);
      if (Math.abs(meta.width / meta.height - verhaeltnis) > 0.01) fehler.push(`${rel} ${f}: Seitenverhältnis falsch`);
      if (meta.space !== "srgb") fehler.push(`${rel} ${f}: Farbraum ${meta.space}`);
      if (f === "h") {
        const bytes = (await stat(pfad)).size;
        z.hMaxBytes = Math.max(z.hMaxBytes, bytes);
        if (bytes !== b.h.bytes) fehler.push(`${rel} h: Bytes ${bytes} statt Manifest ${b.h.bytes}`);
        if (bytes < 4000000) z.hUnter4MB++;
        else fehler.push(`${rel} h: ${bytes} B nicht unter 4 MB`);
      }
    }
    if (ohne) z.ohneMetadaten++;

    // Ausrichtung des Testbilds mit Orientation 6
    const quellMeta = await sharp(join(QUELLE, rel)).metadata();
    if (quellMeta.orientation === 6) {
      const { data, info } = await sharp(join(DIST, b.r)).raw().toBuffer({ resolveWithObject: true });
      const rot = (x0, x1) => {
        let r = 0;
        let n = 0;
        for (let y = 0; y < info.height; y += 4) {
          for (let x = x0; x < x1; x++) {
            const i = (y * info.width + x) * info.channels;
            r += data[i] - (data[i + 1] + data[i + 2]) / 2;
            n++;
          }
        }
        return r / n;
      };
      const rechts = rot(info.width - 20, info.width);
      const links = rot(0, 20);
      z.gedrehtRichtig = { rel, breite: info.width, hoehe: info.height, rotRechts: Math.round(rechts), rotLinks: Math.round(links) };
      if (!(info.height > info.width && rechts > 150 && links < 100)) fehler.push(`${rel}: Ausrichtung falsch`);
    }
  }
}

// Zugangscode darf nirgends im Deployment stehen (nur der Hash), Originalnamen nicht in Pfaden.
const dist = await alleDateien(DIST);
if (values["code-datei"]) {
  const code = (await readFile(values["code-datei"], "utf8")).trim();
  for (const p of dist) {
    if (/\/b\/[^/]+\/(o|r|g|h)\//.test(p)) continue; // Bilddaten: binär, Treffer wären Zufall
    if ((await readFile(p)).includes(code)) fehler.push(`Zugangscode steht in ${relative(DIST, p)}`);
  }
  z.codeNichtImDeployment = !fehler.some((f) => f.startsWith("Zugangscode"));
}
const namenInPfaden = dist.filter((p) => /4S4A|\.jpg\.\d|Kopie/i.test(relative(DIST, p)));
if (namenInPfaden.length) fehler.push(`Originalnamen in Pfaden: ${namenInPfaden.length}`);
z.dateienImDeployment = dist.length;
z.quellDateien = quellDateien.length;
z.fehler = fehler;
console.log(JSON.stringify(z, null, 1));
process.exitCode = fehler.length ? 1 : 0;
