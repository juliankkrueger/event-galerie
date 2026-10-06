import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { erzeugeCodeHash } from "../../functions/_lib/kennwort.js";
import { erzeugeHandler } from "../../functions/_lib/zugang.js";

const ABLAUF = "2027-01-03T23:59:59+01:00";
const VOR_ABLAUF = Date.parse("2026-10-05T12:00:00Z");
const BASIS = "https://fotos.example.org";

async function aufbau({ jetzt = VOR_ABLAUF } = {}) {
  const uhr = { t: jetzt };
  const pausen = [];
  const daten = {
    galerie: "g1",
    ablauf: ABLAUF,
    codeHash: await erzeugeCodeHash("ABCD2345", { iter: 1000 }),
    cookieSchluessel: randomBytes(32).toString("base64"),
    manifest: { galerie: "g1", marke: "testmarke", titel: "Test 2026", kapitel: [], anzahl: 0 },
  };
  const handler = erzeugeHandler(daten, { jetzt: () => uhr.t, warte: async (ms) => pausen.push(ms) });
  const rufe = (pfad, { methode = "GET", koerper, kopf = {} } = {}) =>
    handler({ request: new Request(BASIS + pfad, { method: methode, body: koerper, headers: kopf }) });
  const anmelden = (code, ip = "203.0.113.1", kopf = {}) =>
    rufe("/api/zugang", {
      methode: "POST",
      koerper: JSON.stringify({ code }),
      kopf: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...kopf },
    });
  return { daten, handler, uhr, pausen, rufe, anmelden };
}

function pruefeKopf(res) {
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  if (res.status !== 204) assert.equal(res.headers.get("Content-Type"), "application/json; charset=utf-8");
}

const keks = (res) => res.headers.get("Set-Cookie").split(";")[0];

test("status ohne Cookie", async () => {
  const { rufe } = await aufbau();
  const res = await rufe("/api/status");
  pruefeKopf(res);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { titel: "Test 2026", marke: "testmarke", abgelaufen: false });
});

test("zugang mit richtigem Code: 204 und Cookie laut Vertrag, danach manifest 200", async () => {
  const { rufe, anmelden, pausen } = await aufbau();
  const res = await anmelden("  abcd2345 ");
  pruefeKopf(res);
  assert.equal(res.status, 204);
  const sc = res.headers.get("Set-Cookie");
  assert.match(sc, /^eg=\d+\.[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  assert.ok(!/Domain=/i.test(sc));
  assert.equal(pausen.length, 0);
  const m = await rufe("/api/manifest", { kopf: { Cookie: `andere=1; ${keks(res)}` } });
  pruefeKopf(m);
  assert.equal(m.status, 200);
  assert.equal((await m.json()).titel, "Test 2026");
});

test("manifest ohne, mit gefälschtem und mit abgelaufenem Cookie: 401", async () => {
  const { rufe, anmelden, uhr } = await aufbau();
  assert.equal((await rufe("/api/manifest")).status, 401);
  const gut = keks(await anmelden("ABCD2345"));
  const [name, wert] = gut.split("=");
  const [exp, sig] = wert.split(".");
  const falsch = `${name}=${exp}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
  const r1 = await rufe("/api/manifest", { kopf: { Cookie: falsch } });
  pruefeKopf(r1);
  assert.equal(r1.status, 401);
  const verlaengert = `${name}=${Number(exp) + 1000}.${sig}`;
  assert.equal((await rufe("/api/manifest", { kopf: { Cookie: verlaengert } })).status, 401);
  uhr.t += 2592000 * 1000 + 1000; // 30 Tage später, Galerie noch nicht abgelaufen
  assert.equal((await rufe("/api/manifest", { kopf: { Cookie: gut } })).status, 401);
});

test("Cookie einer anderen Galerie oder eines anderen Baus gilt nicht", async () => {
  const a = await aufbau();
  const b = await aufbau();
  const vonA = keks(await a.anmelden("ABCD2345"));
  assert.equal((await b.rufe("/api/manifest", { kopf: { Cookie: vonA } })).status, 401);
});

test("falscher Code: 401 nach 1 s, ab 5 Fehlversuchen in 10 min 429 mit Retry-After, je IP", async () => {
  const { anmelden, pausen, uhr } = await aufbau();
  for (let i = 0; i < 5; i++) {
    const r = await anmelden("ZZZZZZZZ");
    pruefeKopf(r);
    assert.equal(r.status, 401);
  }
  assert.deepEqual(pausen, [1000, 1000, 1000, 1000, 1000]);
  const gebremst = await anmelden("ABCD2345");
  pruefeKopf(gebremst);
  assert.equal(gebremst.status, 429);
  const nach = Number(gebremst.headers.get("Retry-After"));
  assert.ok(nach > 0 && nach <= 600, `Retry-After ${nach}`);
  // Andere IP ist nicht betroffen.
  assert.equal((await anmelden("ABCD2345", "198.51.100.7")).status, 204);
  // Nach Ablauf des Fensters wieder frei.
  uhr.t += 10 * 60 * 1000 + 1;
  assert.equal((await anmelden("ABCD2345")).status, 204);
});

test("Bremse hält auch bei parallelen Anfragen: 25 gleichzeitig falsch = 5 Prüfungen, 20 x 429", async () => {
  const { anmelden, pausen } = await aufbau();
  const ergebnisse = await Promise.all(Array.from({ length: 25 }, () => anmelden("ZZZZZZZZ")));
  const zaehlung = ergebnisse.reduce((z, r) => ((z[r.status] = (z[r.status] || 0) + 1), z), {});
  assert.deepEqual(zaehlung, { 401: 5, 429: 20 });
  assert.equal(pausen.length, 5, "nur 5 echte Codeprüfungen");
  for (const r of ergebnisse.filter((x) => x.status === 429)) assert.ok(Number(r.headers.get("Retry-After")) > 0);
  // Auch danach bleibt die IP gesperrt, eine andere nicht.
  assert.equal((await anmelden("ABCD2345")).status, 429);
  assert.equal((await anmelden("ABCD2345", "198.51.100.8")).status, 204);
});

test("Bremse: richtiger Code gibt seinen Versuch wieder frei, auch parallel zu falschen", async () => {
  const { anmelden } = await aufbau();
  for (let i = 0; i < 8; i++) assert.equal((await anmelden("ABCD2345")).status, 204, `Anmeldung ${i + 1}`);
  const welle = await Promise.all([
    anmelden("ZZZZZZZZ"), anmelden("ZZZZZZZZ"), anmelden("ABCD2345"), anmelden("ZZZZZZZZ"), anmelden("ZZZZZZZZ"),
  ]);
  assert.deepEqual(welle.map((r) => r.status), [401, 401, 204, 401, 401]);
  // 4 Fehlversuche gezählt, der richtige nicht: genau ein weiterer Fehlversuch ist erlaubt.
  assert.equal((await anmelden("ZZZZZZZZ")).status, 401);
  assert.equal((await anmelden("ZZZZZZZZ")).status, 429);
});

test("Kaputter Body, zu großer Body und fremde Herkunft", async () => {
  const { rufe, anmelden } = await aufbau();
  const kaputt = await rufe("/api/zugang", { methode: "POST", koerper: "{nicht json", kopf: { "CF-Connecting-IP": "192.0.2.9" } });
  assert.equal(kaputt.status, 401);
  const gross = await rufe("/api/zugang", { methode: "POST", koerper: JSON.stringify({ code: "A".repeat(5000) }) });
  assert.equal(gross.status, 401);
  const fremd = await anmelden("ABCD2345", "192.0.2.10", { Origin: "https://boese.example" });
  pruefeKopf(fremd);
  assert.equal(fremd.status, 403);
  assert.equal((await anmelden("ABCD2345", "192.0.2.10", { Origin: BASIS })).status, 204);
});

test("Nach Ablauf: manifest und zugang 410 {abgelaufen:true}, status meldet abgelaufen", async () => {
  const { rufe, anmelden, uhr } = await aufbau();
  const gut = keks(await anmelden("ABCD2345"));
  uhr.t = Date.parse(ABLAUF);
  const m = await rufe("/api/manifest", { kopf: { Cookie: gut } });
  pruefeKopf(m);
  assert.equal(m.status, 410);
  assert.deepEqual(await m.json(), { abgelaufen: true });
  assert.equal((await anmelden("ABCD2345")).status, 410);
  assert.equal((await (await rufe("/api/status")).json()).abgelaufen, true);
});

test("Unbekannte Pfade 404, falsche Methoden 405, alle mit Pflicht-Headern", async () => {
  const { rufe } = await aufbau();
  for (const [pfad, methode, status] of [
    ["/api/gibtsnicht", "GET", 404],
    ["/api/", "GET", 404],
    ["/api/zugang", "GET", 405],
    ["/api/manifest", "POST", 405],
    ["/api/status", "DELETE", 405],
  ]) {
    const r = await rufe(pfad, { methode });
    pruefeKopf(r);
    assert.equal(r.status, status, `${methode} ${pfad}`);
  }
});

test("Ungültiges Ablaufdatum gilt als abgelaufen (sicherer Ausfall)", async () => {
  const handler = erzeugeHandler({ galerie: "g", ablauf: "kaputt", codeHash: "x", cookieSchluessel: "AAAA", manifest: {} });
  const r = await handler({ request: new Request(`${BASIS}/api/manifest`) });
  assert.equal(r.status, 410);
});
