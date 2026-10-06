import assert from "node:assert/strict";
import { test } from "node:test";
import { bildeKapitel } from "../../bau/lib/kapitel.mjs";

const e = (pfad, name, md5) => ({ pfad, name, md5 });

test("Unterordner werden Kapitel, Wurzel heißt Alle Fotos, natürliche Sortierung", () => {
  const { kapitel, dubletten } = bildeKapitel([
    e(["Mittwoch", "Tag"], "IMG_10.jpg", "a"),
    e(["Mittwoch", "Tag"], "IMG_9.jpg", "b"),
    e([], "z.jpg", "c"),
    e(["Mittwoch"], "a.jpg", "d"),
    e(["Donnerstag"], "x.jpg", "e"),
    e(["Mittwoch", "Abend"], "y.jpg", "f"),
  ]);
  assert.deepEqual(
    kapitel.map((k) => k.titel),
    ["Alle Fotos", "Donnerstag", "Mittwoch", "Mittwoch · Abend", "Mittwoch · Tag"],
  );
  assert.deepEqual(kapitel[4].bilder.map((b) => b.name), ["IMG_9.jpg", "IMG_10.jpg"]);
  assert.equal(dubletten.length, 0);
});

test("Dubletten mit gleicher md5 zählen einmal, das erste in Sortierreihenfolge bleibt", () => {
  const { kapitel, dubletten } = bildeKapitel([
    e(["B"], "kopie.jpg", "same"),
    e(["A"], "original.jpg", "same"),
    e(["A"], "anders.jpg", "other"),
  ]);
  assert.deepEqual(kapitel.map((k) => k.titel), ["A"]);
  assert.deepEqual(kapitel[0].bilder.map((b) => b.name), ["anders.jpg", "original.jpg"]);
  assert.deepEqual(dubletten, [{ name: "B/kopie.jpg", gleichWie: "A/original.jpg" }]);
});

test("Leere Eingabe ergibt keine Kapitel", () => {
  assert.deepEqual(bildeKapitel([]), { kapitel: [], dubletten: [] });
});

test("Kapitel nach frühester Aufnahme, wenn jedes Kapitel eine Zeit hat", async () => {
  const { ordneKapitel } = await import("../../bau/lib/kapitel.mjs");
  const k = (titel, ...zeiten) => ({ titel, bilder: zeiten.map((aufnahme) => ({ aufnahme })) });
  const namensfolge = [
    k("Donnerstag", "2026-10-02T09:00:00+02:00"),
    k("Mittwoch · Abend", null, "2026-10-01T19:00:00+02:00"),
    k("Mittwoch · Tag", "2026-10-01T10:00:00+02:00", "2026-10-01T09:00:00+02:00"),
    k("Samstag · Abend", "2026-10-03T19:00:00+02:00"),
  ];
  assert.deepEqual(ordneKapitel(namensfolge).map((x) => x.titel), ["Mittwoch · Tag", "Mittwoch · Abend", "Donnerstag", "Samstag · Abend"]);
  // gleiche früheste Zeit: Namensreihenfolge bleibt
  assert.deepEqual(ordneKapitel([k("A", "2026-10-01T09:00:00Z"), k("B", "2026-10-01T09:00:00Z")]).map((x) => x.titel), ["A", "B"]);
});

test("Kapitel ohne Aufnahmezeit: Namensreihenfolge bleibt für alle", async () => {
  const { ordneKapitel } = await import("../../bau/lib/kapitel.mjs");
  const liste = [
    { titel: "1 Mittwoch", bilder: [{ aufnahme: null }] },
    { titel: "2 Donnerstag", bilder: [{ aufnahme: "2026-10-01T09:00:00Z" }] },
  ];
  assert.deepEqual(ordneKapitel(liste).map((x) => x.titel), ["1 Mittwoch", "2 Donnerstag"]);
});
