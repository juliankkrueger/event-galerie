import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pbkdf2Sync } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CODE_ALPHABET,
  SALZ_BYTES,
  erzeugeCodeHash,
  gleichKonstant,
  normalisiereCode,
  pruefeCode,
  zerlegeCodeHash,
  zufallsCode,
} from "../../functions/_lib/kennwort.js";

const CLI = fileURLToPath(new URL("../../bau/code-hash.mjs", import.meta.url));

test("Code: 8 Zeichen aus dem Vertragsalphabet, ohne 0 O 1 I L", () => {
  assert.equal(CODE_ALPHABET, "ABCDEFGHJKMNPQRSTUVWXYZ23456789");
  for (let i = 0; i < 200; i++) assert.match(zufallsCode(), /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
});

test("Hash-Format pbkdf2$sha256$100000$salz$hash, 32 Byte, unabhängig nachgerechnet", async () => {
  const h = await erzeugeCodeHash("abcd2345");
  const [art, algo, iter, salz, hash] = h.split("$");
  assert.deepEqual([art, algo, iter], ["pbkdf2", "sha256", "100000"]);
  assert.equal(Buffer.from(hash, "base64").length, 32);
  assert.equal(SALZ_BYTES, 32);
  assert.equal(Buffer.from(salz, "base64").length, 32, "Salz laut Vertrag 32 Byte");
  const nach = pbkdf2Sync("ABCD2345", Buffer.from(salz, "base64"), 100000, 32, "sha256").toString("base64");
  assert.equal(hash, nach);
});

test("Prüfung: getrimmt und großgeschrieben, falscher Code und kaputter Hash ergeben false", async () => {
  const h = await erzeugeCodeHash("ABCD2345");
  assert.equal(await pruefeCode("  abcd2345 ", h), true);
  assert.equal(await pruefeCode("ABCD2346", h), false);
  assert.equal(await pruefeCode("", h), false);
  assert.equal(await pruefeCode(null, h), false);
  assert.equal(await pruefeCode("ABCD2345", "pbkdf2$sha256$100001$AAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAA=="), false);
  assert.equal(await pruefeCode("ABCD2345", "kaputt"), false);
  assert.equal(normalisiereCode(" xy "), "XY");
});

test("zerlegeCodeHash lehnt zu viele Iterationen ab (Workers-Grenze 100000)", () => {
  assert.equal(zerlegeCodeHash("pbkdf2$sha256$200000$AAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAA=="), null);
  assert.ok(zerlegeCodeHash("pbkdf2$sha256$1000$AAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAA=="));
});

test("gleichKonstant", () => {
  assert.equal(gleichKonstant(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(gleichKonstant(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
  assert.equal(gleichKonstant(new Uint8Array([1]), new Uint8Array([1, 2])), false);
});

test("CLI bau/code-hash.mjs: Erzeugen und Prüfen", () => {
  const { code, codeHash } = JSON.parse(execFileSync(process.execPath, [CLI]).toString());
  assert.match(code, /^[A-Z2-9]{8}$/);
  assert.equal(execFileSync(process.execPath, [CLI, "--pruefen", code.toLowerCase(), "--hash", codeHash]).toString().trim(), "passt");
  assert.throws(() => execFileSync(process.execPath, [CLI, "--pruefen", "XXXXXXXX", "--hash", codeHash], { stdio: "pipe" }));
  assert.equal(Buffer.from(codeHash.split("$")[3], "base64").length, 32, "CLI-Salz laut Vertrag 32 Byte");
  const vorgegeben = JSON.parse(execFileSync(process.execPath, [CLI, "--code", "abcd2345"]).toString());
  assert.equal(vorgegeben.code, "ABCD2345");
  assert.equal(Buffer.from(vorgegeben.codeHash.split("$")[3], "base64").length, 32);
});

test("Gegenprobe zum OS: dessen Referenz-Hash (Salz 0x01..0x20) wird erkannt und nachgerechnet", async () => {
  // Fest verdrahtet im Test des OS-Moduls (REFERENZ).
  const os = "pbkdf2$sha256$100000$AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=$+WqMXanI055NhMnSyOix18UiMShE1raHOZzSftFDgfo=";
  assert.equal(await pruefeCode("ABCD2345", os), true);
  assert.equal(await pruefeCode("ABCD2346", os), false);
  const salz = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));
  assert.equal(await erzeugeCodeHash("ABCD2345", { salz }), os);
});

test("älteres 16-Byte-Salz wird weiter geprüft (von Hand gebaute Galerien)", async () => {
  const salz = new Uint8Array(16).fill(7);
  const h = await erzeugeCodeHash("ABCD2345", { salz });
  assert.equal(await pruefeCode("ABCD2345", h), true);
});
