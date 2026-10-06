// Synthetische Testbilder (Farbflächen und Rauschen, keine Personen) und Hilfen.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export const neuerOrdner = (praefix = "eg-test-") => mkdtemp(join(tmpdir(), praefix));

// EXIF-Block ("Exif\0\0" + TIFF, little endian) mit Orientation, Aufnahmezeit, GPS.
export function baueExif({ orientation = 1, zeit = null, versatz = null, gps = null } = {}) {
  const teile = [];
  const tiff = [];
  const u16 = (v) => [v & 255, (v >> 8) & 255];
  const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

  // Layout: Header(8) | IFD0 | ExifIFD | GPSIFD | Daten
  const ifd0Eintraege = 1 + (zeit ? 1 : 0) + (gps ? 1 : 0);
  const exifEintraege = zeit ? (versatz ? 2 : 1) : 0;
  const gpsEintraege = gps ? 4 : 0;
  const ifdGroesse = (n) => (n ? 2 + n * 12 + 4 : 0);
  const ifd0Off = 8;
  const exifOff = ifd0Off + ifdGroesse(ifd0Eintraege);
  const gpsOff = exifOff + ifdGroesse(exifEintraege);
  let datenOff = gpsOff + ifdGroesse(gpsEintraege);
  const daten = [];
  const lege = (bytes) => {
    const o = datenOff;
    daten.push(...bytes);
    datenOff += bytes.length;
    return o;
  };
  const eintrag = (tag, typ, zahl, wert) => [...u16(tag), ...u16(typ), ...u32(zahl), ...wert];
  const ascii = (s) => [...Buffer.from(`${s}\0`, "latin1")];
  const rational = (werte) => werte.flatMap((v) => [...u32(Math.round(v * 1000)), ...u32(1000)]);

  const ifd0 = [eintrag(0x0112, 3, 1, [...u16(orientation), 0, 0])];
  if (zeit) ifd0.push(eintrag(0x8769, 4, 1, u32(exifOff)));
  if (gps) ifd0.push(eintrag(0x8825, 4, 1, u32(gpsOff)));
  tiff.push(..."II".split("").map((c) => c.charCodeAt(0)), ...u16(42), ...u32(ifd0Off));
  tiff.push(...u16(ifd0.length), ...ifd0.flat(), ...u32(0));
  if (zeit) {
    const e = [eintrag(0x9003, 2, zeit.length + 1, u32(lege(ascii(zeit))))];
    if (versatz) e.push(eintrag(0x9011, 2, versatz.length + 1, u32(lege(ascii(versatz)))));
    tiff.push(...u16(e.length), ...e.flat(), ...u32(0));
  }
  if (gps) {
    const g = [
      eintrag(0x0001, 2, 2, [..."N".split("").map((c) => c.charCodeAt(0)), 0, 0, 0]),
      eintrag(0x0002, 5, 3, u32(lege(rational(gps.breite)))),
      eintrag(0x0003, 2, 2, [..."E".split("").map((c) => c.charCodeAt(0)), 0, 0, 0]),
      eintrag(0x0004, 5, 3, u32(lege(rational(gps.laenge)))),
    ];
    tiff.push(...u16(g.length), ...g.flat(), ...u32(0));
  }
  tiff.push(...daten);
  teile.push(Buffer.from("Exif\0\0", "latin1"), Buffer.from(tiff));
  return Buffer.concat(teile);
}

// Setzt einen APP1-EXIF-Block direkt hinter SOI ein.
export function mitExif(jpeg, exif) {
  const laenge = exif.length + 2;
  const kopf = Buffer.from([0xff, 0xe1, (laenge >> 8) & 255, laenge & 255]);
  return Buffer.concat([jpeg.subarray(0, 2), kopf, exif, jpeg.subarray(2)]);
}

export async function flaeche(breite, hoehe, farbe = { r: 40, g: 120, b: 200 }, format = "jpeg") {
  const bild = sharp({ create: { width: breite, height: hoehe, channels: 3, background: farbe } });
  return format === "png" ? bild.png().toBuffer() : bild.jpeg({ quality: 90 }).toBuffer();
}

// Verlauf statt Fläche, damit JPEG-Größen realistischer sind.
export async function verlauf(breite, hoehe, saat = 1) {
  const roh = Buffer.alloc(breite * hoehe * 3);
  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      const i = (y * breite + x) * 3;
      roh[i] = (x * 255) / breite;
      roh[i + 1] = (y * 255) / hoehe;
      roh[i + 2] = (saat * 37 + x + y) & 255;
    }
  }
  return sharp(roh, { raw: { width: breite, height: hoehe, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

// Rauschen als unkomprimiertes PNG: > 25 MiB.
export async function grossesPng(ziel, seite = 3100) {
  await mkdir(join(ziel, ".."), { recursive: true });
  await sharp({ create: { width: seite, height: seite, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } })
    .png({ compressionLevel: 0 })
    .toFile(ziel);
}

export async function schreibe(pfad, inhalt) {
  await mkdir(join(pfad, ".."), { recursive: true });
  await writeFile(pfad, inhalt);
}

// Testmarke im Format von marken/<id>/marke.json.
export async function testMarke(markenDir, id = "testmarke") {
  const ordner = join(markenDir, id);
  await mkdir(ordner, { recursive: true });
  const marke = {
    id,
    name: "Test Marke",
    eventSeite: "https://example.org",
    domain: "fotos.example.org",
    pagesProjekt: "fotos-test",
    farben: {
      grund: "#0E2B2E", flaeche: "#1D373B", text: "#EDE7D7", textLeise: "#C9BFAE",
      akzent: "#C69C7B", akzentText: "#0E2B2E", rahmen: "#244A57",
    },
    schriften: { titel: "Italiana", text: "Open Sans" },
    logo: "logo.png",
    favicon: { ico: "favicon.ico", png32: "favicon-32.png", png192: "favicon-192.png", apple: "apple-touch-icon.png" },
    impressum: "https://example.org/impressum/",
    datenschutz: "https://example.org/datenschutz/",
  };
  await writeFile(join(ordner, "marke.json"), JSON.stringify(marke));
  const png = await flaeche(32, 32, { r: 200, g: 150, b: 120 }, "png");
  for (const d of ["logo.png", "favicon.ico", "favicon-32.png", "favicon-192.png", "apple-touch-icon.png"]) {
    await writeFile(join(ordner, d), png);
  }
  return marke;
}

export async function testVorlage(dir) {
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "index.html"), "<!doctype html><title>Test</title>\n");
  await writeFile(join(dir, "assets", "app.js"), "export {};\n");
  await writeFile(join(dir, "sw.js"), "// sw\n");
}
