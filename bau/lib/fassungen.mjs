// Fassungen r/g/h mit sharp: ausgerichtet, ohne Metadaten, sRGB.

import { execFile } from "node:child_process";
import { cpus } from "node:os";
import { unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import { leseExif } from "./exif.mjs";

const execFileP = promisify(execFile);

export const FASSUNGEN = {
  r: { kante: 600, qualitaet: 78, progressiv: true },
  g: { kante: 2000, qualitaet: 82, progressiv: false },
  h: { kante: 3000, qualitaet: 85, progressiv: false, zielBytes: 4000000, stufen: [85, 80, 75, 70, 65] },
};

export function richteSharpEin({ threads } = {}) {
  sharp.cache(false);
  sharp.concurrency(threads ?? Math.max(1, Math.min(4, cpus().length)));
}

export class BildFehler extends Error {
  constructor(grund) {
    super(grund);
    this.name = "BildFehler";
    this.grund = grund;
  }
}

const EINGABE = { failOn: "error", limitInputPixels: 268402689 };

// HEIC (HEVC) kann das vorgebaute sharp nicht lesen. Dann über libheif-Werkzeuge
// (CI: libheif-examples) oder sips (macOS) in ein Zwischen-JPEG wandeln.
export async function heicZuJpeg(quelle, ziel) {
  const versuche = [
    ["heif-dec", [quelle, ziel]],
    ["heif-convert", ["-q", "95", quelle, ziel]],
  ];
  if (process.platform === "darwin") versuche.push(["sips", ["-s", "format", "jpeg", quelle, "--out", ziel]]);
  for (const [befehl, argumente] of versuche) {
    try {
      await execFileP(befehl, argumente, { timeout: 120000 });
      await sharp(ziel).metadata();
      return true;
    } catch {
      await unlink(ziel).catch(() => {});
    }
  }
  return false;
}

async function leseMeta(pfad) {
  const meta = await sharp(pfad, EINGABE).metadata();
  if (!meta.width || !meta.height) throw new Error("ohne Maße");
  const gedreht = (meta.orientation || 1) >= 5;
  return {
    w: gedreht ? meta.height : meta.width,
    h: gedreht ? meta.width : meta.height,
    exif: leseExif(meta.exif),
  };
}

async function jpeg(roh, info, kante, qualitaet, progressiv) {
  let bild = sharp(roh, { raw: { width: info.width, height: info.height, channels: info.channels } });
  if (Math.max(info.width, info.height) > kante) {
    bild = bild.resize({ width: kante, height: kante, fit: "inside", withoutEnlargement: true });
  }
  return bild.jpeg({ quality: qualitaet, progressive: progressiv, chromaSubsampling: "4:2:0" }).toBuffer();
}

function dekodiere(pfad) {
  return sharp(pfad, EINGABE)
    .autoOrient()
    .resize({ width: FASSUNGEN.h.kante, height: FASSUNGEN.h.kante, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });
}

const kurz = (e) => String(e?.message || e).split("\n")[0].slice(0, 80);

// quelle: Datei; ziele: { r, g, h } Zielpfade. arbeitsPfad: Platz für ein HEIC-Zwischenbild.
// Ergebnis: { w, h, hBytes, gps, aufnahme }
export async function erzeugeFassungen(quelle, ziele, { mime, arbeitsPfad } = {}) {
  let zwischen = null;
  let meta;
  let roh;
  try {
    try {
      meta = await leseMeta(quelle);
      roh = await dekodiere(quelle);
    } catch (e) {
      // sharp liest den HEIF-Kopf, aber ohne HEVC-Decoder nicht die Pixel.
      if (mime !== "image/heic" || !arbeitsPfad) throw new BildFehler(`Bild nicht lesbar (${kurz(e)})`);
      zwischen = `${arbeitsPfad}.heic.jpg`;
      if (!(await heicZuJpeg(quelle, zwischen))) throw new BildFehler("HEIC nicht lesbar (libheif fehlt)");
      try {
        const original = meta;
        meta = await leseMeta(zwischen);
        if (original?.exif?.gps) meta.exif.gps = true;
        if (original?.exif?.aufnahme && !meta.exif.aufnahme) meta.exif.aufnahme = original.exif.aufnahme;
        roh = await dekodiere(zwischen);
      } catch (f) {
        throw new BildFehler(`HEIC nicht lesbar (${kurz(f)})`);
      }
    }
    const { data, info } = roh;
    // Ab hier sind Fehler echte Baufehler (z. B. Platte voll) und brechen den Bau ab.
    let hBuf;
    for (const q of FASSUNGEN.h.stufen) {
      hBuf = await jpeg(data, info, FASSUNGEN.h.kante, q, false);
      if (hBuf.length <= FASSUNGEN.h.zielBytes) break;
    }
    const gBuf = await jpeg(data, info, FASSUNGEN.g.kante, FASSUNGEN.g.qualitaet, false);
    const rBuf = await jpeg(data, info, FASSUNGEN.r.kante, FASSUNGEN.r.qualitaet, true);
    await Promise.all([writeFile(ziele.h, hBuf), writeFile(ziele.g, gBuf), writeFile(ziele.r, rBuf)]);
    return { w: meta.w, h: meta.h, hBytes: hBuf.length, gps: meta.exif.gps, aufnahme: meta.exif.aufnahme };
  } finally {
    if (zwischen) await unlink(zwischen).catch(() => {});
  }
}
