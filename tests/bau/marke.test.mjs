import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { markeCss, stilCss } from "../../marken/marke-css.mjs";

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const kontrast = (a, b) => {
  const [h, d] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (h + 0.05) / (d + 0.05);
};

for (const id of ["ambition", "blueprint"]) {
  test(`Marke ${id}: Stil wie die Event-Seite, Verläufe mit Kontrast ≥ 4,5:1`, async () => {
    const m = JSON.parse(await readFile(new URL(`../../marken/${id}/marke.json`, import.meta.url), "utf8"));
    const css = markeCss(m);
    assert.match(css, /--rund: 0;/, "eckige Knöpfe wie auf der Event-Seite");
    assert.match(css, /--knopf-schreibung: uppercase;/);
    for (const f of m.stil.knopfVerlauf || []) assert.ok(kontrast(f, m.farben.akzentText) >= 4.5, `Knopf ${f}: ${kontrast(f, m.farben.akzentText).toFixed(2)}`);
    for (const f of m.stil.titelVerlauf || []) assert.ok(kontrast(f, m.farben.grund) >= 4.5, `Titel ${f}: ${kontrast(f, m.farben.grund).toFixed(2)}`);
    if (id === "blueprint") {
      assert.match(css, /--titel-schreibung: uppercase;/);
      assert.match(css, /--titel-gewicht: 200;\n/);
      const app = await readFile(new URL("../../vorlage/assets/app.css", import.meta.url), "utf8");
      assert.match(app, /unbounded-latin-200-normal\.woff2/, "Unbounded 200 wird mitgeliefert");
    }
    if (id === "ambition") assert.match(css, /background-clip: text/);
  });
}

test("Stil: nur geprüfte Werte, kein freier CSS-Text", () => {
  assert.throws(() => stilCss({ knopfEcken: "0;}body{display:none" }), /knopfEcken/);
  assert.throws(() => stilCss({ knopfLaufweite: "1px;color:red" }), /knopfLaufweite/);
  assert.throws(() => stilCss({ knopfVerlauf: ["#fff", "red"] }), /knopfVerlauf/);
  assert.throws(() => stilCss({ irgendwas: 1 }), /unbekannt/);
  assert.throws(() => stilCss({ titelGewicht: 300 }), /titelGewicht/);
  assert.deepEqual(stilCss(undefined), { zeilen: [], regeln: [] });
});
