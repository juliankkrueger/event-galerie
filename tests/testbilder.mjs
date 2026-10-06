#!/usr/bin/env node
// Erzeugt synthetische Testfotos wie bei einem echten Event (keine Personen, nur Verläufe und Rauschen).
//
//   node tests/testbilder.mjs [--aus tests/bilder]
//
// Ergebnis (tests/bilder/ ist gitignored):
//   Mittwoch/Tag 24, Mittwoch/Abend 20, Samstag/Abend 16 = 60 Bilder 6000x4000 JPEG, 8 bis 20 MB
//   davon 2 über 25 MiB (werden geteilt), 1 Hochformat mit EXIF-Orientation 6,
//   2 mit EXIF-GPS, dazu 1 Dublette (byte-gleiche Kopie unter anderem Namen).
//   quelle.json: Name, Bytes und md5 jeder Datei (für die Prüfung der Originale).

import { createHash, randomFillSync } from "node:crypto";
import { mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";

const { values } = parseArgs({ options: { aus: { type: "string" } }, strict: true });
const AUS = resolve(values.aus || "tests/bilder");
const B = 6000;
const H = 4000;
const MB = 1e6;
const GRENZE_TEILEN = 26214400;

// ---------- EXIF (TIFF, little endian) ----------
const TYP = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5 };
const GROESSE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };

function wert(typ, inhalt) {
  if (typ === TYP.ASCII) {
    const b = Buffer.from(`${inhalt}\0`, "latin1");
    return { anzahl: b.length, daten: b };
  }
  const liste = Array.isArray(inhalt) ? inhalt : [inhalt];
  const b = Buffer.alloc(liste.length * GROESSE[typ]);
  liste.forEach((v, i) => {
    if (typ === TYP.BYTE) b.writeUInt8(v, i);
    else if (typ === TYP.SHORT) b.writeUInt16LE(v, i * 2);
    else if (typ === TYP.LONG) b.writeUInt32LE(v, i * 4);
    else if (typ === TYP.RATIONAL) {
      b.writeUInt32LE(v[0], i * 8);
      b.writeUInt32LE(v[1], i * 8 + 4);
    }
  });
  return { anzahl: liste.length, daten: b };
}

function ifdGroesse(eintraege) {
  let n = 2 + eintraege.length * 12 + 4;
  for (const e of eintraege) {
    const { daten } = wert(e.typ, e.inhalt);
    if (daten.length > 4) n += daten.length + (daten.length % 2);
  }
  return n;
}

function ifdBauen(eintraege, start) {
  const sortiert = [...eintraege].sort((a, b) => a.tag - b.tag);
  const kopf = Buffer.alloc(2 + sortiert.length * 12 + 4);
  kopf.writeUInt16LE(sortiert.length, 0);
  const extra = [];
  let datenOffset = start + kopf.length;
  sortiert.forEach((e, i) => {
    const o = 2 + i * 12;
    const { anzahl, daten } = wert(e.typ, e.inhalt);
    kopf.writeUInt16LE(e.tag, o);
    kopf.writeUInt16LE(e.typ, o + 2);
    kopf.writeUInt32LE(anzahl, o + 4);
    if (daten.length <= 4) daten.copy(kopf, o + 8);
    else {
      kopf.writeUInt32LE(datenOffset, o + 8);
      const gepolstert = daten.length % 2 ? Buffer.concat([daten, Buffer.alloc(1)]) : daten;
      extra.push(gepolstert);
      datenOffset += gepolstert.length;
    }
  });
  return Buffer.concat([kopf, ...extra]);
}

const grad = (g) => {
  const ganz = Math.floor(g);
  const min = Math.floor((g - ganz) * 60);
  const sek = Math.round(((g - ganz) * 60 - min) * 60 * 100);
  return [[ganz, 1], [min, 1], [sek, 100]];
};

export function exifSegment({ orientation = 1, datum, gps = null }) {
  const ifd0 = [
    { tag: 0x010f, typ: TYP.ASCII, inhalt: "Testkamera" },
    { tag: 0x0110, typ: TYP.ASCII, inhalt: "Synthetisch 1" },
    { tag: 0x0112, typ: TYP.SHORT, inhalt: orientation },
    { tag: 0x0132, typ: TYP.ASCII, inhalt: datum },
    { tag: 0x8769, typ: TYP.LONG, inhalt: 0 },
  ];
  if (gps) ifd0.push({ tag: 0x8825, typ: TYP.LONG, inhalt: 0 });
  const exif = [
    { tag: 0x9003, typ: TYP.ASCII, inhalt: datum },
    { tag: 0x9011, typ: TYP.ASCII, inhalt: "+02:00" },
  ];
  const gpsIfd = gps
    ? [
        { tag: 0x0000, typ: TYP.BYTE, inhalt: [2, 3, 0, 0] },
        { tag: 0x0001, typ: TYP.ASCII, inhalt: "N" },
        { tag: 0x0002, typ: TYP.RATIONAL, inhalt: grad(gps.breite) },
        { tag: 0x0003, typ: TYP.ASCII, inhalt: "E" },
        { tag: 0x0004, typ: TYP.RATIONAL, inhalt: grad(gps.laenge) },
      ]
    : [];
  const start0 = 8;
  const startExif = start0 + ifdGroesse(ifd0);
  const startGps = startExif + ifdGroesse(exif);
  ifd0.find((e) => e.tag === 0x8769).inhalt = startExif;
  if (gps) ifd0.find((e) => e.tag === 0x8825).inhalt = startGps;
  const tiff = Buffer.concat([
    Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
    ifdBauen(ifd0, start0),
    ifdBauen(exif, startExif),
    ...(gps ? [ifdBauen(gpsIfd, startGps)] : []),
  ]);
  const nutz = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffe1, 0);
  marker.writeUInt16BE(nutz.length + 2, 2);
  return Buffer.concat([marker, nutz]);
}

// APP1 hinter SOI und ggf. APP0 (JFIF) einsetzen.
function mitExif(jpeg, segment) {
  let pos = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) pos = 4 + jpeg.readUInt16BE(4);
  return Buffer.concat([jpeg.subarray(0, pos), segment, jpeg.subarray(pos)]);
}

// ---------- Pixel ----------
const rauschen = Buffer.alloc(B * H * 3);

function pixel(nr, staerke, { markeOben = false } = {}) {
  randomFillSync(rauschen);
  const buf = Buffer.alloc(B * H * 3);
  const r0 = (nr * 37) % 256;
  const g0 = (nr * 91) % 256;
  const b0 = (nr * 53) % 256;
  for (let y = 0; y < H; y++) {
    const gy = (y * 160) / H;
    const oben = markeOben && y < 500;
    for (let x = 0; x < B; x++) {
      const i = (y * B + x) * 3;
      const gx = (x * 200) / B;
      let r = (r0 + gx) % 256;
      let g = (g0 + gy) % 256;
      let b = (b0 + (gx + gy) / 2) % 256;
      if (oben) {
        r = 230;
        g = 20;
        b = 20;
      }
      const n = (k) => ((rauschen[i + k] - 128) * staerke) >> 7;
      buf[i] = Math.max(0, Math.min(255, r + n(0)));
      buf[i + 1] = Math.max(0, Math.min(255, g + n(1)));
      buf[i + 2] = Math.max(0, Math.min(255, b + n(2)));
    }
  }
  return buf;
}

async function kodiere(roh, qualitaet, voll) {
  return sharp(roh, { raw: { width: B, height: H, channels: 3 } })
    .jpeg({ quality: qualitaet, chromaSubsampling: voll ? "4:4:4" : "4:2:0" })
    .toBuffer();
}

// Sucht eine Rauschstärke, mit der die Datei im Zielbereich landet.
async function bildImBereich(nr, minB, maxB, { qualitaet = 92, voll = false, start = 30, markeOben = false } = {}) {
  let staerke = start;
  let unten = 1;
  let oben = 255;
  for (let v = 0; v < 8; v++) {
    const daten = await kodiere(pixel(nr, staerke, { markeOben }), qualitaet, voll);
    if (daten.length >= minB && daten.length <= maxB) return daten;
    if (daten.length < minB) unten = staerke;
    else oben = staerke;
    staerke = Math.round((unten + oben) / 2);
  }
  throw new Error(`Bild ${nr}: Zielgröße ${minB}-${maxB} nicht erreicht`);
}

const ORDNER = [
  ["Mittwoch/Tag", 24],
  ["Mittwoch/Abend", 20],
  ["Samstag/Abend", 16],
];

await rm(AUS, { recursive: true, force: true });
const liste = [];
let nr = 0;
const beginn = Date.now();
for (const [ordner, anzahl] of ORDNER) {
  await mkdir(join(AUS, ordner), { recursive: true });
  for (let i = 0; i < anzahl; i++) {
    nr += 1;
    const name = `4S4A${String(1000 + nr)}.jpg`;
    const stunde = 9 + Math.floor(nr / 6);
    const datum = `2026:10:0${ordner.startsWith("Samstag") ? 3 : 1} ${String(stunde % 24).padStart(2, "0")}:${String((nr * 7) % 60).padStart(2, "0")}:00`;
    const merkmale = [];
    let daten;
    let exif = { datum };
    if (nr === 5 || nr === 47) {
      // Über 25 MiB: 4:4:4, Qualität 95 bis 100, starkes Rauschen
      const [minB, maxB, q] = nr === 5 ? [28 * MB, 34 * MB, 95] : [52 * MB, 60 * MB, 100];
      daten = await bildImBereich(nr, minB, maxB, { qualitaet: q, voll: true, start: nr === 5 ? 50 : 140 });
      merkmale.push("gross");
    } else if (nr === 30) {
      // Gespeichert quer mit rotem Balken oben; Orientation 6 = 90° im Uhrzeigersinn.
      // Richtig ausgerichtet ist das Bild hoch (4000x6000) und der Balken liegt rechts.
      daten = await bildImBereich(nr, 8 * MB, 20 * MB, { start: 40, markeOben: true });
      exif = { ...exif, orientation: 6 };
      merkmale.push("orientation6");
    } else {
      const ziel = 8 + ((nr * 7) % 12); // 8 bis 19 MB
      daten = await bildImBereich(nr, ziel * MB, (ziel + 1) * MB, { start: 20 + ziel * 3 });
    }
    if (nr === 12 || nr === 51) {
      exif = { ...exif, gps: nr === 12 ? { breite: 52.5163, laenge: 13.3777 } : { breite: 48.1374, laenge: 11.5755 } };
      merkmale.push("gps");
    }
    daten = mitExif(daten, exifSegment(exif));
    await writeFile(join(AUS, ordner, name), daten);
    const md5 = createHash("md5").update(daten).digest("hex");
    liste.push({ pfad: `${ordner}/${name}`, bytes: daten.length, md5, merkmale });
    console.log(`${String(nr).padStart(2)} ${ordner}/${name} ${(daten.length / MB).toFixed(1)} MB ${merkmale.join(" ")}`);
  }
}
// Dublette: byte-gleich, anderer Name, anderes Kapitel
const vorbild = liste.find((e) => e.pfad === "Mittwoch/Tag/4S4A1003.jpg");
await copyFile(join(AUS, vorbild.pfad), join(AUS, "Samstag/Abend/Kopie von 4S4A1003.jpg"));
liste.push({ pfad: "Samstag/Abend/Kopie von 4S4A1003.jpg", bytes: vorbild.bytes, md5: vorbild.md5, merkmale: ["dublette"] });

const normal = liste.filter((e) => !e.merkmale.includes("gross") && !e.merkmale.includes("dublette"));
const zusammen = {
  dateien: liste.length,
  eindeutig: new Set(liste.map((e) => e.md5)).size,
  ueber25MiB: liste.filter((e) => e.bytes > GRENZE_TEILEN).length,
  normalMinMB: Math.min(...normal.map((e) => e.bytes)) / MB,
  normalMaxMB: Math.max(...normal.map((e) => e.bytes)) / MB,
  bytes: liste.reduce((s, e) => s + e.bytes, 0),
  dauerSek: Math.round((Date.now() - beginn) / 1000),
};
await writeFile(join(AUS, "..", "bilder-quelle.json"), `${JSON.stringify({ zusammen, liste }, null, 2)}\n`);
console.log(JSON.stringify(zusammen));
