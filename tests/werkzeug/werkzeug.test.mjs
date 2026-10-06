// Werkzeug galerie: Bausteine und Gesamtläufe mit nachgebautem gh, gcloud und security
// (tests/werkzeug/attrappen.mjs). Kein echter Lauf, kein Netz außer 127.0.0.1.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { pruefeCode } from "../../functions/_lib/kennwort.js";
import { entschluesseleText } from "../../bau/lib/geheim.mjs";
import { ordnerIdAusLink } from "../../werkzeug/lib/drive.mjs";
import { logAuszug } from "../../werkzeug/lib/github.mjs";
import { PROJEKT_MUSTER, falscherCode, gaesteText, projektName, slug } from "../../werkzeug/lib/galerie-hilfen.mjs";
import { ausZip, baueZip } from "../../werkzeug/lib/zip.mjs";
import { ABLAGE, TEST_SCHLUESSEL, TEST_TOKEN, leseZustand, legeProgrammeAn, neuerZustand, schreibeZustand, starteServer, testBilder } from "./attrappen.mjs";

const GALERIE = fileURLToPath(new URL("../../werkzeug/galerie", import.meta.url));

test("Ordner-ID aus Drive-Links und nackter ID", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  for (const l of [
    `https://drive.google.com/drive/folders/${id}`,
    `https://drive.google.com/drive/folders/${id}?usp=sharing`,
    `https://drive.google.com/drive/u/0/folders/${id}`,
    `https://drive.google.com/open?id=${id}`,
    id,
    `  ${id}\n`,
  ]) assert.equal(ordnerIdAusLink(l), id, l);
  for (const l of ["https://example.org/folders/1AbCdEfGhIjKlMnOpQrS", "kurz", "https://drive.google.com/drive/my-drive", ""]) {
    assert.throws(() => ordnerIdAusLink(l), undefined, l);
  }
});

test("Projektname: ASCII-Kurzname, Umlaute ausgeschrieben, höchstens 40 Zeichen plus 4 Zufallszeichen", () => {
  assert.equal(slug("AMBITION Circle 2026 Test"), "ambition-circle-2026-test");
  assert.equal(slug("Sommerfest Müller & Söhne GmbH, Straße"), "sommerfest-mueller-soehne-gmbh-strasse");
  assert.equal(slug("Café Ølsen"), "cafe-lsen");
  assert.equal(slug("!!!"), "galerie");
  assert.ok(slug("x".repeat(30) + " " + "y".repeat(30)).length <= 40);
  assert.ok(!slug("a".repeat(39) + " b").endsWith("-"));
  for (let i = 0; i < 50; i++) {
    const p = projektName("Ein sehr langer Titel für ein Kunden-Event im Oktober 2026 mit Abendprogramm");
    assert.match(p, PROJEKT_MUSTER);
    assert.match(p, /^fotos-[a-z0-9-]{1,40}-[a-z0-9]{4}$/);
    assert.ok(p.length <= 51);
  }
  assert.notEqual(projektName("A"), projektName("A"));
});

test("Gäste-Text: Du-Form, Link und Code, keine Gedankenstriche", () => {
  const t = gaesteText({ titel: "AMBITION Circle 2026", link: "https://fotos-x-abcd.pages.dev/#c=ABCD2345", code: "ABCD2345" });
  assert.ok(t.includes("https://fotos-x-abcd.pages.dev/#c=ABCD2345") && t.includes("ABCD2345"));
  assert.doesNotMatch(t, /[–—]/);
  assert.doesNotMatch(t, /\b(Sie|Ihre?[mnrs]?|Ihnen)\b/);
  assert.match(t, /\bdu\b|\bdeine\b/);
  assert.notEqual(falscherCode("ABCD2345"), "ABCD2345");
  assert.notEqual(falscherCode("BBCD2345"), "BBCD2345");
});

test("ZIP: gespeichert und deflate, fehlender Eintrag", () => {
  const zip = baueZip([["a.txt", Buffer.from("eins"), "stored"], ["bericht.enc", Buffer.from("v1.abc\n".repeat(50))]]);
  assert.equal(ausZip(zip, "a.txt").toString(), "eins");
  assert.equal(ausZip(zip, "bericht.enc").toString(), "v1.abc\n".repeat(50));
  assert.throws(() => ausZip(zip, "fehlt"), /fehlt/);
  assert.throws(() => ausZip(Buffer.from("kein zip"), "a"), /ZIP/);
});

test("Log-Auszug: Fehler mit Umfeld, ohne Zeitstempel, lange Werte geschwärzt", () => {
  const z = logAuszug(["2026-10-06T10:00:00.1Z a", "2026-10-06T10:00:00.2Z b", `2026-10-06T10:00:00.3Z ::error::kaputt ${"Q".repeat(50)}`, "danach"].join("\n"));
  assert.deepEqual(z, ["a", "b", "::error::kaputt <geschwärzt>"]);
});

// Gesamtläufe ---------------------------------------------------------------

let tmp, zustand, server, basis, env, bilder;

function galerie(args, extraEnv = {}) {
  return new Promise((r) => {
    execFile(process.execPath, [GALERIE, ...args], { env: { ...env, ...extraEnv }, timeout: 120000 }, (f, stdout, stderr) => {
      r({ code: f ? f.code : 0, stdout, stderr, alles: stdout + stderr });
    });
  });
}

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), "eg-werkzeug-"));
  zustand = join(tmp, "zustand.json");
  await schreibeZustand(zustand, neuerZustand());
  await legeProgrammeAn(join(tmp, "bin"), zustand);
  bilder = testBilder(4);
  ({ server, basis } = await starteServer(zustand, bilder));
  env = {
    PATH: `${join(tmp, "bin")}:${process.env.PATH}`,
    HOME: join(tmp, "home"),
    EVENT_GALERIE_KONFIG_DIR: join(tmp, "konfig"),
    EVENT_GALERIE_DOWNLOADS: join(tmp, "downloads"),
    EVENT_GALERIE_DRIVE_API: `${basis}/drive`,
    EVENT_GALERIE_TOKENINFO: `${basis}/tokeninfo`,
    EVENT_GALERIE_PAGES_URL: `${basis}/p/{projekt}`,
    EVENT_GALERIE_TAKT_MS: "5",
    EVENT_GALERIE_REPO: "beispiel/event-galerie",
  };
});

after(async () => {
  server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  const z = await leseZustand(zustand);
  await schreibeZustand(zustand, { ...neuerZustand(), projekte: z.projekte, naechsteLaufId: z.naechsteLaufId, drive: z.drive });
});

const ohneGeheimnis = (text) => {
  assert.ok(!text.includes(TEST_SCHLUESSEL), "Schlüssel nie in der Ausgabe");
  assert.ok(!text.includes(TEST_TOKEN), "Google-Token nie in der Ausgabe");
  assert.ok(!/pbkdf2\$/.test(text), "Code-Hash nie in der Ausgabe");
};

test("neu: Ordner außerhalb der Ablage wird kopiert, Bau gestartet, Bericht gelesen, live abgenommen, Link, QR und Text", async () => {
  const r = await galerie(["neu", "https://drive.google.com/drive/folders/QuelleOrdner12345?usp=sharing", "--titel", "Sommerfest Müller 2026", "--marke", "ambition"]);
  ohneGeheimnis(r.alles);
  assert.equal(r.code, 0, r.alles);
  const z = await leseZustand(zustand);
  assert.equal(z.drive.kopien, 3, "drei Bilder kopiert, die Textdatei nicht");
  const d = z.dispatches.at(-1);
  assert.equal(d.workflow, "bauen");
  assert.match(d.inputs.projekt, /^fotos-sommerfest-mueller-2026-[a-z0-9]{4}$/);
  assert.equal(d.inputs.ablauf, "nie");
  assert.equal(d.inputs.marke, "ambition");
  assert.match(d.inputs.ordner_id, /^Ordner/, "gebaut wird aus der Kopie in der Ablage");
  assert.match(d.inputs.galerie_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(d.inputs).sort(), ["ablauf", "code_hash_enc", "galerie_id", "marke", "ordner_id", "projekt", "titel"]);
  const hash = entschluesseleText(d.inputs.code_hash_enc, TEST_SCHLUESSEL, d.inputs.galerie_id);
  const konfig = JSON.parse(await readFile(join(tmp, "konfig", "konfig.json"), "utf8"));
  assert.equal(konfig.ablage, ABLAGE, "Ablage beim ersten Lauf gefunden und gespeichert");
  const reg = JSON.parse(await readFile(join(tmp, "konfig", "galerien.json"), "utf8"));
  const g = reg.galerien.find((x) => x.projekt === d.inputs.projekt);
  assert.ok(await pruefeCode(g.code, hash), "Code passt zum Hash");
  assert.match(g.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  assert.equal(g.status, "online");
  assert.equal(g.quelle, "QuelleOrdner12345");
  assert.equal((await stat(join(tmp, "konfig", "galerien.json"))).mode & 0o777, 0o600);
  assert.equal((await stat(join(tmp, "konfig"))).mode & 0o777, 0o700);
  const link = `https://${d.inputs.projekt}.pages.dev/#c=${g.code}`;
  assert.ok(r.stdout.includes(`Link für die Gäste: ${link}`));
  assert.ok(r.stdout.includes(`Code:               ${g.code}`));
  assert.match(r.stdout, /4 Fotos/);
  assert.match(r.stdout, /1 Originale enthalten den Aufnahmeort/);
  assert.match(r.stdout, /falscher Code 401/);
  assert.match(r.stdout, /3 Stichproben-Originale md5 = Manifest/);
  const ordner = join(tmp, "downloads", "Galerie-sommerfest-mueller-2026");
  assert.deepEqual((await readFile(join(ordner, "qr-code.png"))).subarray(1, 4).toString(), "PNG");
  assert.match(await readFile(join(ordner, "qr-code.svg"), "utf8"), /^<svg/);
  const text = await readFile(join(ordner, "text-fuer-gaeste.txt"), "utf8");
  assert.ok(text.includes(link));
  assert.doesNotMatch(r.stdout + text, /[–—]/);
  // Zweiter Lauf derselben Quelle kopiert nichts doppelt
  const r2 = await galerie(["neu", "QuelleOrdner12345", "--titel", "Sommerfest Müller 2026", "--marke", "ambition"]);
  assert.equal(r2.code, 0, r2.alles);
  assert.equal((await leseZustand(zustand)).drive.kopien, 3);
  assert.match(r2.stdout, /0 kopiert, 3 schon da/);
});

test("neu: Ordner in der Ablage wird nicht kopiert, Projekt vorgegeben, Rückfall ohne return_run_details", async () => {
  const z0 = await leseZustand(zustand);
  await schreibeZustand(zustand, { ...z0, ohneRunDetails: true });
  const r = await galerie(["neu", "AblageOrdner1234", "--titel", "Kunde X", "--projekt", "fotos-kunde-x"]);
  assert.equal(r.code, 0, r.alles);
  const z = await leseZustand(zustand);
  assert.equal(z.drive.kopien, 3, "nichts kopiert");
  const d = z.dispatches.at(-1);
  assert.equal(d.inputs.ordner_id, "AblageOrdner1234");
  assert.equal(d.inputs.projekt, "fotos-kunde-x");
  assert.equal(d.inputs.marke, "agentur", "Standardmarke");
  assert.match(r.stdout, /liegt in der Geteilten Ablage/);
  // Gleiches Projekt noch einmal: abgelehnt
  const doppelt = await galerie(["neu", "AblageOrdner1234", "--titel", "Kunde X", "--projekt", "fotos-kunde-x"]);
  assert.equal(doppelt.code, 1);
  assert.match(doppelt.stderr, /gibt es schon[\s\S]*galerie neu-bauen fotos-kunde-x/);
});

test("neu-bauen: gleiche ID, gleicher Code, gleiches Projekt", async () => {
  const vorher = JSON.parse(await readFile(join(tmp, "konfig", "galerien.json"), "utf8")).galerien.find((g) => g.projekt === "fotos-kunde-x");
  const r = await galerie(["neu-bauen", "fotos-kunde-x"]);
  assert.equal(r.code, 0, r.alles);
  ohneGeheimnis(r.alles);
  const d = (await leseZustand(zustand)).dispatches.at(-1);
  assert.equal(d.inputs.galerie_id, vorher.id);
  assert.equal(d.inputs.projekt, "fotos-kunde-x");
  assert.ok(await pruefeCode(vorher.code, entschluesseleText(d.inputs.code_hash_enc, TEST_SCHLUESSEL, vorher.id)));
  assert.ok(r.stdout.includes(vorher.link));
});

test("Fehlgeschlagener Bau: Schritt, Bericht-Fehler und Log-Auszug, ohne Geheimnisse", async () => {
  const z0 = await leseZustand(zustand);
  await schreibeZustand(zustand, { ...z0, ergebnis: "failure" });
  const r = await galerie(["neu", "AblageOrdner1234", "--titel", "Kaputt", "--projekt", "fotos-kaputt"]);
  assert.equal(r.code, 1);
  ohneGeheimnis(r.alles);
  assert.match(r.stderr, /Bau failure im Schritt „Galerie bauen“/);
  assert.match(r.stderr, /Bericht: Drive-Ordner nicht gefunden/);
  assert.match(r.stderr, /Bau abgebrochen: Drive-Ordner nicht gefunden <geschwärzt>/);
  assert.match(r.stderr, /Hinweis: https:\/\/github\.com\//);
  const g = JSON.parse(await readFile(join(tmp, "konfig", "galerien.json"), "utf8")).galerien.find((x) => x.projekt === "fotos-kaputt");
  assert.equal(g.status, "fehlgeschlagen");
});

test("Abnahme schlägt an: Manifest-Anzahl weicht vom Bericht ab, Original mit falscher md5", async () => {
  const z0 = await leseZustand(zustand);
  await schreibeZustand(zustand, { ...z0, berichtAnzahl: 5 });
  const r = await galerie(["neu-bauen", "fotos-kunde-x"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Manifest hat 4 Bilder, der Bericht 5/);
  await schreibeZustand(zustand, { ...(await leseZustand(zustand)), berichtAnzahl: 4, originalKaputt: true });
  const r2 = await galerie(["neu-bauen", "fotos-kunde-x"]);
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /md5 oder Größe des Originals weicht/);
});

test("Vorbedingungen: gh abgemeldet, Schlüssel fehlt, gcloud ohne Drive-Recht, mit verständlicher Meldung", async () => {
  await schreibeZustand(zustand, { ...(await leseZustand(zustand)), ghAngemeldet: false, schluesselDa: false, scope: "openid https://www.googleapis.com/auth/cloud-platform" });
  const r = await galerie(["neu", "AblageOrdner1234", "--titel", "Nie gebaut"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /gh ist nicht angemeldet \(gh auth login\)/);
  assert.match(r.stderr, /Galerie-Schlüssel fehlt im Schlüsselbund/);
  assert.match(r.stderr, /ohne Drive-Recht \(gcloud auth login --enable-gdrive-access\)/);
  assert.equal((await leseZustand(zustand)).dispatches.length, 0, "nichts gestartet");
  const falsch = await galerie(["neu", "https://example.org/x", "--titel", "T"]);
  assert.equal(falsch.code, 1);
  assert.match(falsch.stderr, /Kein Google-Drive-Link/);
  const marke = await galerie(["neu", "AblageOrdner1234", "--titel", "T", "--marke", "gibtsnicht"]);
  assert.match(marke.stderr, /Marke gibtsnicht gibt es nicht/);
  const markenprojekt = await galerie(["neu", "AblageOrdner1234", "--titel", "T", "--projekt", "fotos-ambition-circle"]);
  assert.match(markenprojekt.stderr, /Projekt einer Marke/);
});

test("pruefen: Vorbedingungen und Ablage", async () => {
  const r = await galerie(["pruefen"]);
  assert.equal(r.code, 0, r.alles);
  ohneGeheimnis(r.alles);
  assert.match(r.stdout, /Geteilte Ablage: Event-Galerie/);
});

test("liste und status zeigen Live-Stand", async () => {
  const l = await galerie(["liste"]);
  assert.equal(l.code, 0, l.alles);
  assert.match(l.stdout, /fotos-kunde-x\s+online/);
  const s = await galerie(["status", "fotos-kunde-x"]);
  assert.match(s.stdout, /Live:\s+online/);
  assert.match(s.stdout, /Ablauf:\s+nie/);
  assert.equal((await galerie(["status", "fotos-gibtsnicht"])).code, 1);
});

test("offline und loeschen: richtige Inputs, Bestätigung nötig, Register danach ohne Code", async () => {
  const off = await galerie(["offline", "fotos-kunde-x"]);
  assert.equal(off.code, 0, off.alles);
  let d = (await leseZustand(zustand)).dispatches.at(-1);
  assert.equal(d.workflow, "offline");
  assert.equal(d.inputs.aktion, "offline");
  assert.equal(d.inputs.projekt, "fotos-kunde-x");
  assert.match(off.stdout, /Platzhalter deployt, live jetzt: offline/);
  const ohneJa = await galerie(["loeschen", "fotos-kunde-x"]);
  assert.equal(ohneJa.code, 1);
  assert.match(ohneJa.stderr, /Bestätigung[\s\S]*--ja/);
  assert.equal((await leseZustand(zustand)).dispatches.length, 1, "ohne --ja nichts gestartet");
  const weg = await galerie(["loeschen", "fotos-kunde-x", "--ja"]);
  assert.equal(weg.code, 0, weg.alles);
  d = (await leseZustand(zustand)).dispatches.at(-1);
  assert.equal(d.inputs.aktion, "loeschen");
  assert.match(weg.stdout, /Pages-Projekt gelöscht/);
  const g = JSON.parse(await readFile(join(tmp, "konfig", "galerien.json"), "utf8")).galerien.find((x) => x.projekt === "fotos-kunde-x");
  assert.equal(g.status, "geloescht");
  assert.ok(!("code" in g) && !("link" in g));
});
