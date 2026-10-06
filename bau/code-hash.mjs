#!/usr/bin/env node
// Erzeugt einen Zugangscode und seinen pbkdf2-Hash (gleiche Logik wie die Function).
//
// node bau/code-hash.mjs                 neuer Code, Ausgabe JSON {code, codeHash}
// node bau/code-hash.mjs --code ABCD2345 Hash für einen vorgegebenen Code
// node bau/code-hash.mjs --pruefen ABCD2345 --hash 'pbkdf2$...'   Exit 0 = passt, 1 = passt nicht

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { CODE_ALPHABET, SALZ_BYTES, erzeugeCodeHash, normalisiereCode, pruefeCode, zufallsCode } from "../functions/_lib/kennwort.js";

const { values } = parseArgs({
  options: { code: { type: "string" }, pruefen: { type: "string" }, hash: { type: "string" } },
  strict: true,
});

if (values.pruefen !== undefined) {
  const ok = await pruefeCode(values.pruefen, values.hash || "");
  console.log(ok ? "passt" : "passt nicht");
  process.exitCode = ok ? 0 : 1;
} else {
  const code = values.code !== undefined ? normalisiereCode(values.code) : zufallsCode(8, (n) => randomBytes(n));
  const erlaubt = new RegExp(`^[${CODE_ALPHABET}]{8}$`);
  if (!erlaubt.test(code)) {
    console.error(`Code muss 8 Zeichen aus ${CODE_ALPHABET} haben`);
    process.exitCode = 2;
  } else {
    const codeHash = await erzeugeCodeHash(code, { salz: new Uint8Array(randomBytes(SALZ_BYTES)) });
    console.log(JSON.stringify({ code, codeHash }));
  }
}
