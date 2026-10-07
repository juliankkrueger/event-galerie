// Abnahme gegen eine nachgebaute Galerie: Stichproben überstehen die Verteilverzögerung von
// Cloudflare (erst Startseite mit 200 text/html, dann das echte Original), eine bleibende
// Abweichung bleibt ein Fehler.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { abnahme } from "../../werkzeug/lib/galerie-hilfen.mjs";

const ORIGINAL = Buffer.from("echtes-original-".repeat(64));
const MD5 = createHash("md5").update(ORIGINAL).digest("hex");

function galerie({ falschBis = 1, immerFalsch = false } = {}) {
  let abrufe = 0;
  const server = http.createServer((req, res) => {
    const pfad = req.url.split("?")[0];
    if (pfad === "/api/status") return res.end(JSON.stringify({ titel: "Test", abgelaufen: false }));
    if (pfad === "/api/zugang") {
      let roh = "";
      req.on("data", (d) => { roh += d; });
      req.on("end", () => {
        const { code } = JSON.parse(roh);
        if (code !== "ABCD2345") { res.statusCode = 401; return res.end(); }
        res.statusCode = 204;
        res.setHeader("set-cookie", "eg=1.abc; Path=/; HttpOnly");
        res.end();
      });
      return undefined;
    }
    if (pfad === "/api/manifest") {
      return res.end(JSON.stringify({ anzahl: 1, kapitel: [{ titel: "A", bilder: [{ o: { teile: ["/b/x/o/a.1"], bytes: ORIGINAL.length, md5: MD5 } }] }] }));
    }
    if (pfad === "/b/x/o/a.1") {
      abrufe += 1;
      if (immerFalsch || abrufe <= falschBis) {
        res.setHeader("content-type", "text/html; charset=utf-8");
        return res.end("<!doctype html><title>Startseite</title>");
      }
      res.setHeader("content-type", "application/octet-stream");
      return res.end(ORIGINAL);
    }
    res.statusCode = 404;
    return res.end();
  });
  return new Promise((fertig) => server.listen(0, "127.0.0.1", () => fertig({ server, basis: `http://127.0.0.1:${server.address().port}`, abrufe: () => abrufe })));
}

test("Abnahme: Stichprobe noch nicht verteilt, zweiter Versuch stimmt", async () => {
  const { server, basis, abrufe } = await galerie({ falschBis: 1 });
  try {
    const zeilen = [];
    const e = await abnahme({ basis, titel: "Test", code: "ABCD2345", erwarteteAnzahl: 1, stichproben: 1, warteMs: 5, protokoll: (z) => zeilen.push(z) });
    assert.equal(e.stichproben[0].md5, true);
    assert.equal(abrufe(), 2);
    assert.ok(zeilen.some((z) => z.includes("noch nicht verteilt")));
  } finally {
    server.close();
  }
});

test("Abnahme: bleibende Abweichung ist ein Fehler, nach 4 Versuchen", async () => {
  const { server, basis, abrufe } = await galerie({ immerFalsch: true });
  try {
    await assert.rejects(
      abnahme({ basis, titel: "Test", code: "ABCD2345", erwarteteAnzahl: 1, stichproben: 1, warteMs: 5 }),
      /weicht vom Manifest ab .*text\/html.*4 Versuchen/,
    );
    assert.equal(abrufe(), 4);
  } finally {
    server.close();
  }
});
