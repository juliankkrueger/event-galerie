import assert from "node:assert/strict";
import { rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { exifZeit, leseExif } from "../../bau/lib/exif.mjs";
import { BildFehler, erzeugeFassungen } from "../../bau/lib/fassungen.mjs";
import { baueExif, flaeche, mitExif, neuerOrdner, verlauf } from "./hilfen.mjs";

test("EXIF-Leser: GPS, Aufnahmezeit mit Versatz, ohne GPS, kaputte Daten", () => {
  const mit = leseExif(baueExif({ zeit: "2026:10:01 18:30:05", versatz: "+02:00", gps: { breite: [48, 8, 1], laenge: [11, 34, 2] } }));
  assert.deepEqual(mit, { gps: true, aufnahme: "2026-10-01T18:30:05+02:00" });
  const ohne = leseExif(baueExif({ zeit: "2026:10:01 18:30:05" }));
  assert.deepEqual(ohne, { gps: false, aufnahme: "2026-10-01T18:30:05" });
  assert.deepEqual(leseExif(baueExif({ gps: { breite: [0, 0, 0], laenge: [0, 0, 0] } })), { gps: false, aufnahme: null });
  assert.deepEqual(leseExif(Buffer.from("Exif\0\0IIxxxxxxxxxxxxxxxxxx")), { gps: false, aufnahme: null });
  assert.deepEqual(leseExif(undefined), { gps: false, aufnahme: null });
  assert.equal(exifZeit("0000:00:00 00:00:00"), null);
});

test("Fassungen: ausgerichtet, ohne Metadaten, sRGB, Kantenlängen, GPS erkannt", async () => {
  const dir = await neuerOrdner();
  try {
    // 4000x3000 gespeichert, Orientation 6 = 90° gedreht, also hochkant 3000x4000.
    const roh = await verlauf(4000, 3000);
    const exif = baueExif({ orientation: 6, zeit: "2026:10:01 12:00:00", gps: { breite: [48, 1, 2], laenge: [11, 3, 4] } });
    const quelle = join(dir, "q.jpg");
    await writeFile(quelle, mitExif(roh, exif));
    const meta0 = await sharp(quelle).metadata();
    assert.equal(meta0.orientation, 6, "Testbild trägt Orientation 6");

    const ziele = { r: join(dir, "r.jpg"), g: join(dir, "g.jpg"), h: join(dir, "h.jpg") };
    const e = await erzeugeFassungen(quelle, ziele, { mime: "image/jpeg" });
    assert.deepEqual([e.w, e.h], [3000, 4000]);
    assert.equal(e.gps, true);
    assert.equal(e.aufnahme, "2026-10-01T12:00:00");
    const erwartet = { r: [450, 600], g: [1500, 2000], h: [2250, 3000] };
    for (const [k, [w, h]] of Object.entries(erwartet)) {
      const m = await sharp(ziele[k]).metadata();
      assert.deepEqual([m.width, m.height], [w, h], `Maße ${k}`);
      assert.equal(m.format, "jpeg");
      assert.equal(m.exif, undefined, `${k} ohne EXIF`);
      assert.equal(m.icc, undefined, `${k} ohne ICC`);
      assert.ok(!m.orientation || m.orientation === 1, `${k} ohne Drehung`);
      assert.equal(m.space, "srgb");
    }
    assert.equal((await sharp(ziele.r).metadata()).isProgressive, true);
    assert.equal(e.hBytes, (await stat(ziele.h)).size);
    assert.ok(e.hBytes <= 4000000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Kleines Bild wird nicht vergrößert, PNG mit Alpha wird JPEG", async () => {
  const dir = await neuerOrdner();
  try {
    const quelle = join(dir, "a.png");
    await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(quelle);
    const ziele = { r: join(dir, "r.jpg"), g: join(dir, "g.jpg"), h: join(dir, "h.jpg") };
    const e = await erzeugeFassungen(quelle, ziele, { mime: "image/png" });
    assert.deepEqual([e.w, e.h], [400, 300]);
    const m = await sharp(ziele.g).metadata();
    assert.deepEqual([m.width, m.height, m.format, m.channels], [400, 300, "jpeg", 3]);
    const { data } = await sharp(ziele.g).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[0] > 240, "Transparenz auf Weiß");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("h-Fassung wird unter 4 MB gedrückt (Qualität sinkt bei Rauschen)", async () => {
  const dir = await neuerOrdner();
  try {
    const quelle = join(dir, "n.png");
    await sharp({ create: { width: 3000, height: 2000, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 90 } } }).png().toFile(quelle);
    const ziele = { r: join(dir, "r.jpg"), g: join(dir, "g.jpg"), h: join(dir, "h.jpg") };
    const e = await erzeugeFassungen(quelle, ziele, { mime: "image/png" });
    const q85 = await sharp(quelle).jpeg({ quality: 85 }).toBuffer();
    assert.ok(q85.length > 4000000, `Ausgangslage über 4 MB (${q85.length})`);
    assert.ok(e.hBytes <= 4000000, `h ${e.hBytes} B`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Unlesbares Bild ergibt BildFehler", async () => {
  const dir = await neuerOrdner();
  try {
    const quelle = join(dir, "kaputt.jpg");
    const echt = await flaeche(200, 200);
    await writeFile(quelle, echt.subarray(0, 300));
    const ziele = { r: join(dir, "r.jpg"), g: join(dir, "g.jpg"), h: join(dir, "h.jpg") };
    await assert.rejects(erzeugeFassungen(quelle, ziele, { mime: "image/jpeg" }), (e) => e instanceof BildFehler);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Eingebettetes Farbprofil (Display P3) wird nach sRGB umgerechnet und entfernt", async () => {
  const dir = await neuerOrdner();
  try {
    const quelle = join(dir, "p3.jpg");
    await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 100, b: 50 } } })
      .withIccProfile("p3")
      .jpeg({ quality: 95 })
      .toFile(quelle);
    assert.ok((await sharp(quelle).metadata()).icc, "Testbild hat ICC");
    const ziele = { r: join(dir, "r.jpg"), g: join(dir, "g.jpg"), h: join(dir, "h.jpg") };
    await erzeugeFassungen(quelle, ziele, { mime: "image/jpeg" });
    const m = await sharp(ziele.g).metadata();
    assert.equal(m.icc, undefined);
    const { data } = await sharp(ziele.g).raw().toBuffer({ resolveWithObject: true });
    // sharp speichert sRGB (200,100,50) als P3-Werte (187,105,62). Ohne Umrechnung käme 187 heraus.
    const nah = (a, b) => Math.abs(a - b) <= 4;
    assert.ok(nah(data[0], 200) && nah(data[1], 100) && nah(data[2], 50), `Pixel ${data[0]},${data[1]},${data[2]}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("HEIC: über libheif-Werkzeug oder sips gewandelt, Original bleibt HEIC", { skip: process.platform !== "darwin" && "nur macOS (sips erzeugt das Testbild)" }, async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = await neuerOrdner();
  try {
    const jpg = join(dir, "q.jpg");
    await writeFile(jpg, await verlauf(1200, 800));
    const heic = join(dir, "q.heic");
    execFileSync("sips", ["-s", "format", "heic", jpg, "--out", heic], { stdio: "ignore" });
    await assert.rejects(sharp(heic).raw().toBuffer(), "vorgebautes sharp dekodiert kein HEVC-HEIC");
    const ziele = { r: join(dir, "r.jpg"), g: join(dir, "g.jpg"), h: join(dir, "h.jpg") };
    const e = await erzeugeFassungen(heic, ziele, { mime: "image/heic", arbeitsPfad: join(dir, "arbeit") });
    assert.deepEqual([e.w, e.h], [1200, 800]);
    assert.equal((await sharp(ziele.g).metadata()).format, "jpeg");
    await assert.rejects(stat(join(dir, "arbeit.heic.jpg")), "Zwischenbild entfernt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
