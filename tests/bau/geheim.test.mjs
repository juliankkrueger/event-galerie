import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { erzeugeCodeHash, pruefeCode } from "../../functions/_lib/kennwort.js";
import { eingabe } from "../../bau/geheim.mjs";
import { GeheimFehler, entschluessele, entschluesseleText, istFormat, leseSchluessel, verschluessele } from "../../bau/lib/geheim.mjs";
import { neuerOrdner } from "./hilfen.mjs";

const lauf = promisify(execFile);
const CLI = fileURLToPath(new URL("../../bau/geheim.mjs", import.meta.url));
const neuerSchluessel = () => randomBytes(32).toString("base64");

// Fester Testvektor, auch für das OS-Modul (VERTRAG.md). Gegengeprüft mit Python cryptography (AESGCM).
const VEKTOR = {
  schluessel: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  iv: Buffer.from("a0a1a2a3a4a5a6a7a8a9aaab", "hex"),
  galerie: "galerie-test-1",
  klar: "pbkdf2$sha256$100000$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=$ERERERERERERERERERERERERERERERERERERERERERE=",
  geheim:
    "v1.oKGio6Slpqeoqaqr.lnoXSSP5JswKBLXmMV7x7kCcaSC29gMt3U9nxz7qNECTNwa-7mMSfB7dRYlIO8K4BloHCSORWz8AH0of5THE8YmYwD1196GysbC6SsqcieiIWe72gJPcKKsne8j0yAjGytZu-Ub8ysnbiUMCwLU.mu__XTUcDzXv_ZItr26PTw",
};

test("Geheim: Roundtrip für Text, Bytes, leeren Text und Umlaute", () => {
  const k = neuerSchluessel();
  for (const klar of ["pbkdf2$sha256$100000$abc$def", "", "Grüße · Mittwoch, Tag 🎉 ÄÖÜß", "x".repeat(100000)]) {
    const g = verschluessele(klar, k, "gal-1");
    assert.equal(entschluesseleText(g, k, "gal-1"), klar);
  }
  const bytes = randomBytes(1000);
  assert.deepEqual(entschluessele(verschluessele(bytes, k, "gal-1"), k, "gal-1"), bytes);
});

test("Geheim: fester Testvektor (Interop mit dem OS)", () => {
  assert.equal(verschluessele(VEKTOR.klar, VEKTOR.schluessel, VEKTOR.galerie, { iv: VEKTOR.iv }), VEKTOR.geheim);
  assert.equal(entschluesseleText(VEKTOR.geheim, VEKTOR.schluessel, VEKTOR.galerie), VEKTOR.klar);
});

test("Geheim: Format v1.<iv>.<ct>.<tag>, base64url ohne Padding, IV 12 und Tag 16 Byte, IV je Aufruf neu", () => {
  const k = neuerSchluessel();
  const a = verschluessele("hallo", k, "g");
  const b = verschluessele("hallo", k, "g");
  assert.notEqual(a, b, "gleicher Klartext ergibt verschiedenen Geheimtext");
  for (const g of [a, b]) {
    assert.match(g, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$/);
    const [, iv, ct, tag] = g.split(".");
    assert.equal(Buffer.from(iv, "base64url").length, 12);
    assert.equal(Buffer.from(tag, "base64url").length, 16);
    assert.equal(Buffer.from(ct, "base64url").length, 5, "GCM: Geheimtext so lang wie der Klartext");
    assert.ok(istFormat(g));
  }
});

test("Geheim: falsche AAD (galerie_id) scheitert", () => {
  const k = neuerSchluessel();
  const g = verschluessele("pbkdf2$x", k, "galerie-a");
  assert.throws(() => entschluessele(g, k, "galerie-b"), GeheimFehler);
  assert.throws(() => entschluessele(g, k, "galerie-A"), GeheimFehler);
  assert.throws(() => entschluessele(g, k, ""), GeheimFehler);
  assert.throws(() => entschluessele(VEKTOR.geheim, VEKTOR.schluessel, "galerie-test-2"), GeheimFehler);
});

test("Geheim: falscher Schlüssel scheitert, Meldung ohne Schlüssel und Klartext", () => {
  const k1 = neuerSchluessel();
  const k2 = neuerSchluessel();
  const g = verschluessele("GEHEIMER-KLARTEXT", k1, "g");
  try {
    entschluessele(g, k2, "g");
    assert.fail("hätte scheitern müssen");
  } catch (e) {
    assert.ok(e instanceof GeheimFehler);
    for (const s of [k1, k2, "GEHEIMER-KLARTEXT"]) assert.ok(!e.message.includes(s));
  }
});

test("Geheim: veränderter Geheimtext, IV oder Tag scheitern", () => {
  const k = neuerSchluessel();
  const g = verschluessele("pbkdf2$sha256$1$a$b", k, "g");
  const [v, iv, ct, tag] = g.split(".");
  const kippe = (s) => {
    const b = Buffer.from(s, "base64url");
    b[0] ^= 1;
    return b.toString("base64url");
  };
  for (const kaputt of [[v, kippe(iv), ct, tag], [v, iv, kippe(ct), tag], [v, iv, ct, kippe(tag)]]) {
    assert.throws(() => entschluessele(kaputt.join("."), k, "g"), GeheimFehler);
  }
});

test("Geheim: Formatfehler werden erkannt", () => {
  const k = neuerSchluessel();
  const g = verschluessele("abc", k, "g");
  const [, iv, ct, tag] = g.split(".");
  const falsch = [
    "",
    "v1",
    `v2.${iv}.${ct}.${tag}`,
    `${iv}.${ct}.${tag}`,
    `v1.${iv}.${ct}.${tag}.x`,
    `v1.${iv}=.${ct}.${tag}`, // Padding
    `v1.${iv.slice(1)}.${ct}.${tag}`, // IV zu kurz
    `v1.${iv}.${ct}.${tag.slice(0, 20)}`, // Tag zu kurz
    `v1.${iv.replace(/^./, "+")}.${ct}.${tag}`, // Standard-Base64 statt base64url
    `v1.${iv}.${ct}.${tag.slice(0, -1)}x`, // nicht kanonisch oder falsch
  ];
  for (const f of falsch) assert.throws(() => entschluessele(f, k, "g"), GeheimFehler, f);
  for (const f of falsch.slice(0, 9)) assert.equal(istFormat(f), false, f);
});

test("Geheim: Schlüssel nur als 32 Byte Standard-Base64", () => {
  const k = neuerSchluessel();
  assert.equal(leseSchluessel(k).length, 32);
  assert.equal(leseSchluessel(`${k}\n`).length, 32, "Zeilenende aus openssl rand wird ignoriert");
  for (const falsch of ["", "abc", randomBytes(16).toString("base64"), randomBytes(33).toString("base64"), randomBytes(32).toString("base64url"), randomBytes(32).toString("hex")]) {
    assert.throws(() => leseSchluessel(falsch), GeheimFehler);
  }
  assert.throws(() => verschluessele("x", randomBytes(16).toString("base64"), "g"), GeheimFehler);
});

test("Workflow-Schritt eingabe: entschlüsselt, maskiert, schreibt 600, gibt den Klartext sonst nie aus", async () => {
  const ordner = await neuerOrdner();
  const k = neuerSchluessel();
  const codeHash = await erzeugeCodeHash("ABCD2345", { salz: new Uint8Array(randomBytes(32)) });
  const ereignis = join(ordner, "event.json");
  const aus = join(ordner, "code-hash");
  await writeFile(ereignis, JSON.stringify({ inputs: { galerie_id: "gal-7", code_hash_enc: verschluessele(codeHash, k, "gal-7") } }));

  // Wie in bauen.yml: eigener Prozess, Schlüssel nur in der Umgebung.
  const { stdout, stderr } = await lauf(process.execPath, [CLI, "eingabe", "--ereignis", ereignis, "--aus", aus], {
    env: { PATH: process.env.PATH, GALERIE_SCHLUESSEL: k },
  });
  assert.equal(stdout, `::add-mask::${codeHash}\n`, "einzige Ausgabe ist die Maske");
  assert.equal(stderr, "");
  assert.equal(await readFile(aus, "utf8"), codeHash);
  assert.equal((await stat(aus)).mode & 0o777, 0o600);
  assert.ok(await pruefeCode("ABCD2345", await readFile(aus, "utf8")));
  // Zweiter Lauf überschreibt sauber.
  await eingabe({ ereignis, aus, env: { GALERIE_SCHLUESSEL: k }, schreibe: () => {} });
  assert.equal(await readFile(aus, "utf8"), codeHash);
});

test("Workflow-Schritt eingabe: falscher Schlüssel, fremde Galerie, Klartext statt Geheimtext und kein pbkdf2 scheitern ohne Werte im Log", async () => {
  const ordner = await neuerOrdner();
  const k = neuerSchluessel();
  const codeHash = await erzeugeCodeHash("ABCD2345", { salz: new Uint8Array(randomBytes(32)) });
  const faelle = [
    { name: "falscher Schlüssel", inputs: { galerie_id: "gal-7", code_hash_enc: verschluessele(codeHash, neuerSchluessel(), "gal-7") } },
    { name: "fremde Galerie", inputs: { galerie_id: "gal-8", code_hash_enc: verschluessele(codeHash, k, "gal-7") } },
    { name: "Klartext", inputs: { galerie_id: "gal-7", code_hash_enc: codeHash } },
    { name: "kein pbkdf2", inputs: { galerie_id: "gal-7", code_hash_enc: verschluessele("pbkdf2$sha256$1$a\nb$c", k, "gal-7") } },
    { name: "altes Feld code_hash", inputs: { galerie_id: "gal-7", code_hash: codeHash } },
    { name: "galerie_id ungültig", inputs: { galerie_id: "../x", code_hash_enc: verschluessele(codeHash, k, "../x") } },
  ];
  for (const f of faelle) {
    const ereignis = join(ordner, "event.json");
    const aus = join(ordner, "code-hash");
    await writeFile(ereignis, JSON.stringify({ inputs: f.inputs }));
    await assert.rejects(
      lauf(process.execPath, [CLI, "eingabe", "--ereignis", ereignis, "--aus", aus], { env: { PATH: process.env.PATH, GALERIE_SCHLUESSEL: k } }),
      (e) => {
        assert.equal(e.code, 1, f.name);
        assert.equal(e.stdout, "", `${f.name}: keine Maske, keine Ausgabe`);
        assert.match(e.stderr, /^::error::/, f.name);
        for (const s of [k, codeHash, "ABCD2345"]) assert.ok(!e.stderr.includes(s), `${f.name}: kein Wert im Log`);
        return true;
      },
    );
    await assert.rejects(stat(aus), { code: "ENOENT" }, `${f.name}: keine Datei`);
  }
  // Ohne Schlüssel
  await writeFile(join(ordner, "event.json"), JSON.stringify({ inputs: { galerie_id: "gal-7", code_hash_enc: verschluessele(codeHash, k, "gal-7") } }));
  await assert.rejects(lauf(process.execPath, [CLI, "eingabe", "--ereignis", join(ordner, "event.json"), "--aus", join(ordner, "code-hash")], { env: { PATH: process.env.PATH } }), (e) =>
    /GALERIE_SCHLUESSEL fehlt/.test(e.stderr),
  );
});

test("Bericht: verschlüsselt mit AAD galerie_id, nur mit Schlüssel und richtiger Galerie lesbar", async () => {
  const ordner = await neuerOrdner();
  const k = neuerSchluessel();
  const inhalt = `${JSON.stringify({ galerie: "gal-7", anzahl: 3, gpsFunde: ["IMG_0001.jpg"], uebersprungen: [{ name: "a.txt", grund: "kein Bild" }] }, null, 2)}\n`;
  await writeFile(join(ordner, "bericht.json"), inhalt);
  await lauf(process.execPath, [CLI, "bericht", "--galerie", "gal-7", "--ein", join(ordner, "bericht.json"), "--aus", join(ordner, "bericht.enc")], {
    env: { PATH: process.env.PATH, GALERIE_SCHLUESSEL: k },
  });
  const enc = await readFile(join(ordner, "bericht.enc"), "utf8");
  assert.ok(!enc.includes("IMG_0001"));
  assert.ok(istFormat(enc.trim()));
  assert.equal(entschluesseleText(enc.trim(), k, "gal-7"), inhalt);
  assert.throws(() => entschluessele(enc.trim(), k, "gal-8"), GeheimFehler);
  // Gegenrichtung über die Kommandozeile (so liest man einen Bericht am eigenen Rechner).
  const kind = execFile(process.execPath, [CLI, "entschluesseln", "--galerie", "gal-7"], { env: { PATH: process.env.PATH, GALERIE_SCHLUESSEL: k } });
  const ausgabe = new Promise((ok, nein) => {
    let s = "";
    kind.stdout.on("data", (d) => (s += d));
    kind.on("close", (c) => (c === 0 ? ok(s) : nein(new Error(`rc ${c}`))));
  });
  kind.stdin.end(enc);
  assert.equal(await ausgabe, inhalt);
});
