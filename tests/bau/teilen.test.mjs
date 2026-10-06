import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { GRENZE_TEILEN, legeOriginalAb, md5Datei, Md5Fehler, md5Teile, TEIL_MAX } from "../../bau/lib/teilen.mjs";
import { neuerOrdner } from "./hilfen.mjs";

test("Original über 25 MiB wird in Teile ≤ 25.000.000 B geteilt und md5-gleich zusammengesetzt", async () => {
  const dir = await neuerOrdner();
  try {
    const quelle = join(dir, "gross.bin");
    const groesse = 2 * TEIL_MAX + 1234567;
    await writeFile(quelle, randomBytes(groesse));
    const md5 = await md5Datei(quelle);
    const r = await legeOriginalAb(quelle, join(dir, "abc"), { verschieben: true, md5Erwartet: md5 });
    assert.equal(r.geteilt, true);
    assert.equal(r.bytes, groesse);
    assert.deepEqual(r.teile.map((t) => t.slice(-6)), ["/abc.1", "/abc.2", "/abc.3"]);
    for (const t of r.teile) assert.ok((await stat(t)).size <= TEIL_MAX);
    assert.equal(await md5Teile(r.teile), md5);
    await assert.rejects(stat(quelle), "Quelle wurde verschoben");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Genau 25 MiB bleibt ein Teil (.1), Quelle bleibt bei verschieben=false stehen", async () => {
  const dir = await neuerOrdner();
  try {
    const quelle = join(dir, "grenze.bin");
    await writeFile(quelle, Buffer.alloc(GRENZE_TEILEN, 7));
    const r = await legeOriginalAb(quelle, join(dir, "x"), { verschieben: false });
    assert.equal(r.geteilt, false);
    assert.equal(r.teile.length, 1);
    assert.ok(r.teile[0].endsWith("x.1"));
    assert.equal((await stat(quelle)).size, GRENZE_TEILEN);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Falsche md5 beim Teilen: Md5Fehler, keine Teile bleiben liegen", async () => {
  const dir = await neuerOrdner();
  try {
    const quelle = join(dir, "q.bin");
    await writeFile(quelle, randomBytes(GRENZE_TEILEN + 10));
    await assert.rejects(
      legeOriginalAb(quelle, join(dir, "y"), { md5Erwartet: "0".repeat(32) }),
      (e) => e instanceof Md5Fehler,
    );
    assert.deepEqual((await readdir(dir)).sort(), ["q.bin"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
