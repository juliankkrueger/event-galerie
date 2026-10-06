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

test("Marke agentur: ohne Domain, eigene Serif aus marken/schriften mit @font-face, Kontraste ≥ 4,5:1", async () => {
  const { ladeMarke, schreibeMarke } = await import("../../bau/lib/marke.mjs");
  const { mkdtemp, rm, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const marken = fileURLToPath(new URL("../../marken/", import.meta.url));
  const geladen = await ladeMarke(marken, "agentur");
  const m = geladen.marke;
  assert.ok(!("domain" in m), "Kunden-Events laufen unter <projekt>.pages.dev");
  const f = m.farben;
  for (const [a, b] of [[f.text, f.grund], [f.text, f.flaeche], [f.textLeise, f.flaeche], [f.textLeise, f.grund], [f.akzent, f.grund], [f.akzentText, f.akzent]]) {
    assert.ok(kontrast(a, b) >= 4.5, `${a} auf ${b}: ${kontrast(a, b).toFixed(2)}`);
  }
  for (const v of m.stil.knopfVerlauf) assert.ok(kontrast(v, f.akzentText) >= 4.5, `Knopf ${v}`);
  const css = markeCss(m);
  assert.match(css, /@font-face \{[^}]*font-family: "Cormorant Garamond";[^}]*font-weight: 600;[^}]*url\("\/assets\/schriften\/cormorant-garamond-latin-600-normal\.woff2"\)/);
  assert.match(css, /--schrift-titel: "Cormorant Garamond"/);
  const tmp = await mkdtemp(join(tmpdir(), "eg-agentur-"));
  try {
    await schreibeMarke(tmp, geladen);
    for (const p of ["assets/schriften/cormorant-garamond-latin-600-normal.woff2", "assets/schriften/OFL-CormorantGaramond.txt", "assets/logo.png", "favicon.ico", "apple-touch-icon.png"]) {
      assert.ok((await stat(join(tmp, p))).isFile(), p);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

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

test("Marke ohne Domain ist gültig, Hintergrund wird geprüft und mit allen Bildern nach /assets/marke/ kopiert", async () => {
  const { mkdtemp, writeFile: schreibe, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { testMarke } = await import("./hilfen.mjs");
  const { ladeMarke, schreibeMarke } = await import("../../bau/lib/marke.mjs");
  const tmp = await mkdtemp(join(tmpdir(), "eg-marke-"));
  try {
    const m = await testMarke(join(tmp, "marken"));
    delete m.domain;
    m.hintergrund = { kopf: "kopf.webp", muster: "muster.png" };
    const ordner = join(tmp, "marken", "testmarke");
    await schreibe(join(ordner, "marke.json"), JSON.stringify(m));
    await assert.rejects(ladeMarke(join(tmp, "marken"), "testmarke"), /hintergrund\.kopf: Datei kopf\.webp fehlt/);
    for (const d of ["kopf.webp", "kopf-1600.jpg", "muster.png", "notiz.txt"]) await schreibe(join(ordner, d), "x");
    const geladen = await ladeMarke(join(tmp, "marken"), "testmarke");
    await schreibeMarke(join(tmp, "dist"), geladen);
    const kopiert = (await readdir(join(tmp, "dist", "assets", "marke"))).sort();
    assert.ok(kopiert.includes("kopf.webp") && kopiert.includes("kopf-1600.jpg") && kopiert.includes("muster.png"));
    assert.ok(!kopiert.includes("notiz.txt") && !kopiert.includes("marke.json"));
    const css = markeCss(m);
    assert.match(css, /--hintergrund-kopf: url\("\/assets\/marke\/kopf\.webp"\);/);
    assert.throws(() => markeCss({ ...m, hintergrund: { kopf: "../x.png" } }), /hintergrund\.kopf/);
    assert.throws(() => markeCss({ ...m, hintergrund: { video: "x.mp4" } }), /unbekannt/);
    const oeffentlich = JSON.parse(await readFile(join(tmp, "dist", "assets", "marke.json"), "utf8"));
    assert.deepEqual(oeffentlich.hintergrund, m.hintergrund);
    assert.ok(!("domain" in oeffentlich));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("Hintergrund-Varianten: kleines WebP und JPEG gleicher Größe", async () => {
  const { hintergrundVarianten } = await import("../../marken/marke-css.mjs");
  const dateien = ["hintergrund-kopf-900.webp", "hintergrund-kopf-1600.webp", "hintergrund-kopf-2560.webp", "hintergrund-kopf-900.jpg", "hintergrund-kopf-2560.jpg", "hintergrund-muster-900.webp", "logo.png"];
  assert.deepEqual(hintergrundVarianten("hintergrund-kopf-2560.webp", dateien), { klein: "hintergrund-kopf-900.webp", jpg: "hintergrund-kopf-2560.jpg" });
  assert.deepEqual(hintergrundVarianten("hintergrund-kopf-2560.webp", []), {});
  assert.deepEqual(hintergrundVarianten("hintergrund-muster-900.webp", dateien), {});
  const m = JSON.parse(await readFile(new URL("../../marken/ambition/marke.json", import.meta.url), "utf8"));
  if (m.hintergrund) {
    const { readdir } = await import("node:fs/promises");
    const css = markeCss(m, { dateien: await readdir(new URL("../../marken/ambition/", import.meta.url)) });
    // Gerenderte Prägung (bau/praegung/praegung.mjs): breit fürs Querformat, hoch fürs Handy
    assert.match(css, /--hintergrund-kopf: url\("\/assets\/marke\/hintergrund-kopf-breit-3840\.webp"\);/);
    assert.match(css, /--hintergrund-kopf-klein: url\("\/assets\/marke\/hintergrund-kopf-breit-1920\.webp"\);/);
    assert.match(css, /--hintergrund-kopf-jpg: url\("\/assets\/marke\/hintergrund-kopf-breit-3840\.jpg"\);/);
    assert.match(css, /--hintergrund-hoch: url\("\/assets\/marke\/hintergrund-kopf-hoch-1290\.webp"\);/);
    assert.match(css, /--hintergrund-hoch-klein: url\("\/assets\/marke\/hintergrund-kopf-hoch-860\.webp"\);/);
  }
});
