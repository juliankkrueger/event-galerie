// Gesamtlauf der Baukette mit Quelle ordner: und synthetischen Bildern.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { erzeugeCodeHash } from "../../functions/_lib/kennwort.js";
import { HEADERS } from "../../bau/lib/ausgabe.mjs";
import { baueOffline } from "../../bau/offline.mjs";
import { md5Datei, md5Teile } from "../../bau/lib/teilen.mjs";
import { baueExif, flaeche, grossesPng, mitExif, neuerOrdner, schreibe, testMarke, testVorlage, verlauf } from "./hilfen.mjs";

const run = promisify(execFile);
const BAU = fileURLToPath(new URL("../../bau/bau.mjs", import.meta.url));
const ABLAUF = new Date(Date.now() + 30 * 864e5).toISOString().replace(/\.\d+Z$/, "Z");

let tmp, quelle, dist, codeHash, ergebnis, daten;

async function baue(extra = [], aus = dist) {
  const args = [
    BAU,
    "--quelle", `ordner:${quelle}`,
    "--marke", "testmarke",
    "--titel", "Test Galerie 2026",
    "--galerie", "test-1",
    "--ablauf", ABLAUF,
    "--code-hash", codeHash,
    "--aus", aus,
    "--marken", join(tmp, "marken"),
    "--vorlage", join(tmp, "vorlage"),
    ...extra,
  ];
  try {
    const r = await run(process.execPath, args, { maxBuffer: 10e6 });
    return { code: 0, ...r };
  } catch (e) {
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

before(async () => {
  tmp = await neuerOrdner("eg-bau-");
  quelle = join(tmp, "quelle");
  dist = join(tmp, "dist");
  codeHash = await erzeugeCodeHash("ABCD2345", { iter: 1000 });
  await testMarke(join(tmp, "marken"));
  await testVorlage(join(tmp, "vorlage"));

  const a = await verlauf(1200, 800, 1);
  await schreibe(join(quelle, "a.jpg"), a);
  await schreibe(join(quelle, "b.png"), await flaeche(500, 400, { r: 10, g: 200, b: 90 }, "png"));
  await schreibe(join(quelle, ".DS_Store"), "x");
  const c = mitExif(await verlauf(1600, 1200, 2), baueExif({ orientation: 6, zeit: "2026:10:01 18:00:00", gps: { breite: [48, 1, 1], laenge: [11, 2, 2] } }));
  await schreibe(join(quelle, "1 Mittwoch", "Tag", "c.jpg"), c);
  await schreibe(join(quelle, "1 Mittwoch", "Tag", "d-kopie.jpg"), a);
  await schreibe(join(quelle, "1 Mittwoch", "e.jpg"), await verlauf(900, 900, 3));
  await grossesPng(join(quelle, "2 Donnerstag", "gross.png"));
  await schreibe(join(quelle, "2 Donnerstag", "notizen.txt"), "Text");
  await schreibe(join(quelle, "2 Donnerstag", "kaputt.jpg"), (await verlauf(300, 300, 4)).subarray(0, 400));
  await schreibe(join(quelle, "2 Donnerstag", "falsch.jpg"), "kein Bild");
  await schreibe(join(quelle, "leer", ".keep"), "");

  ergebnis = await baue();
  if (ergebnis.code === 0) daten = await import(pathToFileURL(join(dist, "functions", "_daten.js")).href);
});

after(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

test("Bau läuft durch und schreibt bericht.json neben dist", async () => {
  assert.equal(ergebnis.code, 0, ergebnis.stderr);
  const bericht = JSON.parse(await readFile(join(tmp, "bericht.json"), "utf8"));
  for (const k of ["galerie", "marke", "anzahl", "dubletten", "bytesOriginale", "bytesGesamt", "geteilteOriginale", "gpsFunde", "md5Fehler", "uebersprungen", "dauerSek"]) {
    assert.ok(k in bericht, `bericht.${k}`);
  }
  assert.equal(bericht.galerie, "test-1");
  assert.equal(bericht.anzahl, 5);
  assert.equal(bericht.dubletten, 1);
  assert.deepEqual(bericht.geteilteOriginale, ["2 Donnerstag/gross.png"]);
  assert.deepEqual(bericht.gpsFunde, ["1 Mittwoch/Tag/c.jpg"]);
  assert.deepEqual(bericht.md5Fehler, []);
  assert.deepEqual(
    bericht.uebersprungen.map((u) => u.name).sort(),
    ["2 Donnerstag/falsch.jpg", "2 Donnerstag/kaputt.jpg", "2 Donnerstag/notizen.txt"],
  );
  assert.ok(bericht.bytesGesamt > bericht.bytesOriginale);
});

test("Manifest: Kapitel, Felder, Pfade, Maße nach Ausrichtung", async () => {
  const m = daten.manifest;
  assert.equal(m.galerie, "test-1");
  assert.equal(m.marke, "testmarke");
  assert.equal(m.titel, "Test Galerie 2026");
  assert.equal(m.ablauf, ABLAUF);
  assert.ok(!Number.isNaN(Date.parse(m.erstellt)));
  assert.equal(m.anzahl, 5);
  assert.deepEqual(m.kapitel.map((k) => k.titel), ["Alle Fotos", "1 Mittwoch", "1 Mittwoch · Tag", "2 Donnerstag"]);
  assert.deepEqual(m.kapitel.map((k) => k.bilder.map((b) => b.name)), [["a.jpg", "b.png"], ["e.jpg"], ["c.jpg"], ["gross.png"]]);
  const alle = m.kapitel.flatMap((k) => k.bilder);
  const tok = alle[0].r.split("/")[2];
  assert.match(tok, /^[a-z2-7]{26}$/);
  let summe = 0;
  for (const b of alle) {
    assert.match(b.id, /^[0-9a-f]{16}$/);
    assert.equal(b.r, `/b/${tok}/r/${b.id}.jpg`);
    assert.equal(b.g, `/b/${tok}/g/${b.id}.jpg`);
    assert.equal(b.h.pfad, `/b/${tok}/h/${b.id}.jpg`);
    assert.equal(b.h.bytes, (await stat(join(dist, b.h.pfad))).size);
    b.o.teile.forEach((t, i) => assert.equal(t, `/b/${tok}/o/${b.id}.${i + 1}`));
    for (const p of [b.r, b.g, b.h.pfad, ...b.o.teile]) assert.ok((await stat(join(dist, p))).isFile(), p);
    assert.equal(await md5Teile(b.o.teile.map((t) => join(dist, t))), b.o.md5, `md5 ${b.name}`);
    summe += b.o.bytes;
  }
  assert.equal(m.bytesOriginale, summe);
  const c = alle.find((b) => b.name === "c.jpg");
  assert.deepEqual([c.w, c.hoehe], [1200, 1600]);
  assert.equal(typeof c.h, "object", "h ist die Handy-Fassung");
  assert.equal(c.aufnahme, "2026-10-01T18:00:00");
  assert.equal(c.o.typ, "image/jpeg");
  assert.equal(alle.find((b) => b.name === "b.png").o.typ, "image/png");
  assert.equal(alle.find((b) => b.name === "a.jpg").aufnahme, null);
  const gross = alle.find((b) => b.name === "gross.png");
  assert.equal(gross.o.teile.length, 2);
  assert.equal(gross.o.md5, await md5Datei(join(quelle, "2 Donnerstag", "gross.png")));
  for (const t of gross.o.teile) assert.ok((await stat(join(dist, t))).size <= 25000000);
});

test("Fassungen im Deployment tragen keine Metadaten, Originale sind byte-gleich", async () => {
  const c = daten.manifest.kapitel.flatMap((k) => k.bilder).find((b) => b.name === "c.jpg");
  for (const p of [c.r, c.g, c.h.pfad]) {
    const meta = await sharp(join(dist, p)).metadata();
    assert.equal(meta.exif, undefined, p);
  }
  const original = await readFile(join(quelle, "1 Mittwoch", "Tag", "c.jpg"));
  assert.ok((await readFile(join(dist, c.o.teile[0]))).equals(original));
  assert.ok((await stat(join(quelle, "1 Mittwoch", "Tag", "c.jpg"))).isFile(), "Quelle bleibt unangetastet");
});

test("Deployment: Vorlage, Marke, _headers und _routes.json exakt, Function samt _daten.js", async () => {
  assert.equal(await readFile(join(dist, "_headers"), "utf8"), HEADERS);
  // Fotos nur privat cachen (kein gemeinsamer Zwischenspeicher). Den Edge-Cache von Pages
  // umgeht die Oberfläche mit einem Zufallswert je Seitenansicht (werkzeuge.test.mjs).
  const regeln = Object.fromEntries(HEADERS.split(/\n(?=\S)/).map((b) => [b.split("\n")[0].trim(), b]));
  assert.match(regeln["/b/*"], /Cache-Control: private, max-age=31536000, immutable/);
  assert.doesNotMatch(regeln["/b/*"], /public/);
  assert.match(regeln["/status.json"], /Cache-Control: no-cache/);
  assert.deepEqual(JSON.parse(await readFile(join(dist, "status.json"), "utf8")), { titel: "Test Galerie 2026", marke: "testmarke", ablauf: ABLAUF });
  assert.deepEqual(JSON.parse(await readFile(join(dist, "_routes.json"), "utf8")), { version: 1, include: ["/api/*"], exclude: [] });
  for (const p of ["index.html", "sw.js", "assets/app.js", "assets/marke.css", "assets/logo.png", "favicon.ico", "apple-touch-icon.png", "assets/favicon-32.png", "assets/favicon-192.png", "functions/api/[[pfad]].js", "functions/_lib/zugang.js", "functions/_lib/kennwort.js", "functions/_daten.js"]) {
    assert.ok((await stat(join(dist, p))).isFile(), p);
  }
  const css = await readFile(join(dist, "assets", "marke.css"), "utf8");
  assert.match(css, /--grund: #0E2B2E;/);
  assert.equal(daten.galerie, "test-1");
  assert.equal(daten.codeHash, codeHash);
  assert.equal(Buffer.from(daten.cookieSchluessel, "base64").length, 32);
  assert.equal(daten.ablauf, ABLAUF);
  // Originalnamen stehen nur im Manifest, nie in Dateipfaden.
  const namen = [];
  const gehe = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await gehe(join(d, e.name));
      else namen.push(join(d, e.name));
    }
  };
  await gehe(join(dist, "b"));
  const rel = namen.map((n) => n.slice(join(dist, "b").length));
  assert.ok(rel.length > 0);
  for (const r of rel) assert.match(r, /^\/[a-z2-7]{26}\/(r|g|h)\/[0-9a-f]{16}\.jpg$|^\/[a-z2-7]{26}\/o\/[0-9a-f]{16}\.\d+$/, r);
  assert.ok(!(await readdir(tmp)).some((n) => n.endsWith(".arbeit")), "Arbeitsordner aufgeräumt");
});

test("Erzeugte Function aus dist: Zugang mit Code, Manifest mit Cookie", async () => {
  const { onRequest } = await import(pathToFileURL(join(dist, "functions", "api", "[[pfad]].js")).href);
  const basis = "https://fotos.example.org";
  const status = await onRequest({ request: new Request(`${basis}/api/status`) });
  assert.deepEqual(await status.json(), { titel: "Test Galerie 2026", marke: "testmarke", abgelaufen: false });
  const z = await onRequest({
    request: new Request(`${basis}/api/zugang`, { method: "POST", body: JSON.stringify({ code: "abcd2345" }), headers: { "CF-Connecting-IP": "203.0.113.5" } }),
  });
  assert.equal(z.status, 204);
  const cookie = z.headers.get("Set-Cookie").split(";")[0];
  const m = await onRequest({ request: new Request(`${basis}/api/manifest`, { headers: { Cookie: cookie } }) });
  assert.equal(m.status, 200);
  assert.equal((await m.json()).anzahl, 5);
});

test("Zweiter Bau ersetzt dist, neuer tok und neuer Cookie-Schlüssel", async () => {
  const vorher = daten.manifest.kapitel[0].bilder[0].r.split("/")[2];
  const r = await baue();
  assert.equal(r.code, 0, r.stderr);
  const neu = await import(`${pathToFileURL(join(dist, "functions", "_daten.js")).href}?zwei`);
  assert.notEqual(neu.manifest.kapitel[0].bilder[0].r.split("/")[2], vorher);
  assert.notEqual(neu.cookieSchluessel, daten.cookieSchluessel);
  assert.deepEqual(await readdir(join(dist, "b")), [neu.manifest.kapitel[0].bilder[0].r.split("/")[2]]);
});

test("Ohne Ablauf (nie, leer oder weggelassen): status.json und Manifest ohne ablauf, Function nie abgelaufen", async () => {
  for (const [i, extra] of [["--ablauf", "nie"], ["--ablauf", ""], null].entries()) {
    const aus = join(tmp, `ohne-ablauf-${i}`, "dist");
    const args = [
      BAU, "--quelle", `ordner:${join(quelle, "1 Mittwoch")}`, "--marke", "testmarke", "--titel", "Ohne Ablauf",
      "--galerie", "test-nie", "--code-hash", codeHash, "--aus", aus, "--marken", join(tmp, "marken"), "--vorlage", join(tmp, "vorlage"),
      ...(extra || []),
    ];
    await run(process.execPath, args, { maxBuffer: 10e6 });
    assert.deepEqual(JSON.parse(await readFile(join(aus, "status.json"), "utf8")), { titel: "Ohne Ablauf", marke: "testmarke" });
    const d = await import(`${pathToFileURL(join(aus, "functions", "_daten.js")).href}?nie${i}`);
    assert.equal(d.ablauf, null);
    assert.ok(!("ablauf" in d.manifest), "Manifest ohne ablauf");
    const { onRequest } = await import(`${pathToFileURL(join(aus, "functions", "api", "[[pfad]].js")).href}?nie${i}`);
    const st = await onRequest({ request: new Request("https://fotos.example.org/api/status") });
    assert.equal((await st.json()).abgelaufen, false);
  }
});

test("Ungültige Eingaben: Exit 2, nichts gebaut; fremder nicht leerer Ordner wird nicht gelöscht", async () => {
  for (const [schalter, wert] of [
    ["--galerie", "a b"],
    ["--ablauf", "2020-01-01T00:00:00Z"],
    ["--ablauf", "2027-01-03"],
    ["--ablauf", "niemals"],
    ["--code-hash", "klartext"],
    ["--marke", "../x"],
  ]) {
    const r = await baue([schalter, wert], join(tmp, "nie"));
    assert.equal(r.code, 2, `${schalter} ${wert}`);
  }
  await assert.rejects(stat(join(tmp, "nie")));
  // Fehler mitten im Bau (Quelle fehlt): kein halbes dist bleibt liegen.
  const halb = join(tmp, "halb");
  const r0 = await run(process.execPath, [BAU, "--quelle", `ordner:${join(tmp, "gibtsnicht")}`, "--marke", "testmarke", "--titel", "T", "--galerie", "g", "--ablauf", ABLAUF, "--code-hash", codeHash, "--aus", halb, "--marken", join(tmp, "marken"), "--vorlage", join(tmp, "vorlage")]).catch((e) => e);
  assert.equal(r0.code, 1);
  await assert.rejects(stat(halb));
  const fremd = join(tmp, "fremd");
  await schreibe(join(fremd, "wichtig.txt"), "bleibt");
  const r = await baue([], fremd);
  assert.equal(r.code, 1);
  assert.equal(await readFile(join(fremd, "wichtig.txt"), "utf8"), "bleibt");
});

test("Offline-Seite: Marke, Fuß, noindex, keine Function, kein Gedankenstrich", async () => {
  const aus = join(tmp, "dist-offline");
  const vorlage = join(tmp, "vorlage");
  await schreibe(join(vorlage, "assets", "schriften", "x.woff2"), "w");
  const r = await baueOffline({ marke: "testmarke", aus, marken: join(tmp, "marken"), vorlage });
  assert.deepEqual(r, { projekt: "fotos-test", domain: "fotos.example.org" });
  const html = await readFile(join(aus, "index.html"), "utf8");
  assert.ok(html.includes("Für diese Adresse ist gerade keine Galerie online."));
  assert.ok(html.includes('href="https://example.org/impressum/"'));
  assert.ok(html.includes('href="https://example.org/datenschutz/"'));
  assert.ok(html.includes('href="https://example.org"'));
  assert.ok(!/\{\{|\}\}/.test(html));
  assert.ok(!/<script|style=/.test(html), "keine Inline-Skripte oder -Styles");
  assert.ok(!/[–—]/.test(html));
  // Gäste werden geduzt (VERTRAG.md, Grundsätze)
  assert.ok(!/\b(Sie|Ihre?[mnrs]?|Ihnen)\b/.test(html.replace(/<[^>]+>/g, " ")), "keine Sie-Anrede");
  assert.ok(html.includes("Wenn du einen Link"));
  const kopf = await readFile(join(aus, "_headers"), "utf8");
  assert.match(kopf, /X-Robots-Tag: noindex, nofollow/);
  const inhalt = await readdir(aus);
  assert.ok(!inhalt.includes("functions") && !inhalt.includes("_routes.json"));
  for (const p of ["404.html", "sw.js", "assets/offline.css", "assets/marke.css", "assets/logo.png", "favicon.ico", "assets/schriften/x.woff2"]) {
    assert.ok((await stat(join(aus, p))).isFile(), p);
  }
  await writeFile(join(aus, "zusatz.txt"), "alt");
  await baueOffline({ marke: "testmarke", aus, marken: join(tmp, "marken"), vorlage });
  await assert.rejects(stat(join(aus, "zusatz.txt")), "neu gebaut statt ergänzt");
});
