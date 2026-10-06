// marken/<id>/marke.json lesen, prüfen und ins Deployment schreiben
// (assets/marke.css, Logo, Favicons). CSS und Zielpfade kommen aus marken/marke-css.mjs.

import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { DATEI, markeCss, markeDateien } from "../../marken/marke-css.mjs";

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
// Bilddateien des Markenordners, die bei gesetztem "hintergrund" nach /assets/marke/ gehen.
const BILD_ENDUNGEN = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".svg"]);
const PROJEKT = /^[a-z0-9][a-z0-9-]{0,57}$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function https(wert) {
  try {
    const u = new URL(wert);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

export function pruefeMarke(marke, id) {
  const fehler = [];
  if (!marke || typeof marke !== "object") return ["marke.json ist kein Objekt"];
  if (marke.id !== id) fehler.push(`id "${marke.id}" passt nicht zum Ordner "${id}"`);
  if (typeof marke.name !== "string" || !marke.name.trim()) fehler.push("name fehlt");
  if (!https(marke.eventSeite)) fehler.push("eventSeite ist keine https-Adresse");
  if (!https(marke.impressum)) fehler.push("impressum ist keine https-Adresse");
  if (!https(marke.datenschutz)) fehler.push("datenschutz ist keine https-Adresse");
  // domain ist optional: Marken ohne eigene Domain laufen nur unter <projekt>.pages.dev.
  if (marke.domain !== undefined && !DOMAIN.test(marke.domain || "")) fehler.push("domain ungültig");
  if (!PROJEKT.test(marke.pagesProjekt || "")) fehler.push("pagesProjekt ungültig");
  if (!DATEI.test(marke.logo || "")) fehler.push("logo ungültig");
  for (const k of ["ico", "png32", "png192", "apple"]) {
    if (!DATEI.test(marke.favicon?.[k] || "")) fehler.push(`favicon.${k} ungültig`);
  }
  try {
    markeCss(marke);
  } catch (e) {
    fehler.push(e.message);
  }
  return fehler;
}

export async function ladeMarke(markenDir, id) {
  if (!ID.test(id || "")) throw new Error(`Marke "${id}" ungültig`);
  const ordner = join(markenDir, id);
  let marke;
  try {
    marke = JSON.parse(await readFile(join(ordner, "marke.json"), "utf8"));
  } catch (e) {
    throw new Error(`marken/${id}/marke.json nicht lesbar: ${e.message}`);
  }
  const fehler = pruefeMarke(marke, id);
  for (const [quelle] of fehler.length ? [] : markeDateien(marke)) {
    if (!(await stat(join(ordner, quelle)).catch(() => null))?.isFile()) fehler.push(`Datei ${quelle} fehlt`);
  }
  for (const [k, datei] of Object.entries(fehler.length ? {} : marke.hintergrund || {})) {
    if (!(await stat(join(ordner, datei)).catch(() => null))?.isFile()) fehler.push(`hintergrund.${k}: Datei ${datei} fehlt`);
  }
  if (fehler.length) throw new Error(`marken/${id}/marke.json: ${fehler.join("; ")}`);
  return { marke, ordner };
}

// Öffentliche Angaben für die Oberfläche (keine Geheimnisse).
export function markeOeffentlich(marke) {
  const { id, name, eventSeite, domain, impressum, datenschutz, hintergrund } = marke;
  return { id, name, eventSeite, domain, impressum, datenschutz, hintergrund };
}

export async function schreibeMarke(ziel, { marke, ordner }) {
  await mkdir(join(ziel, "assets"), { recursive: true });
  const dateien = marke.hintergrund ? (await readdir(ordner)).filter((n) => DATEI.test(n)) : [];
  await writeFile(join(ziel, "assets", "marke.css"), markeCss(marke, { dateien }));
  await writeFile(join(ziel, "assets", "marke.json"), `${JSON.stringify(markeOeffentlich(marke), null, 2)}\n`);
  for (const [quelle, zielPfad] of markeDateien(marke)) {
    const nach = join(ziel, zielPfad);
    await mkdir(dirname(nach), { recursive: true });
    await copyFile(join(ordner, quelle), nach);
  }
  if (marke.hintergrund) {
    const ziel2 = join(ziel, "assets", "marke");
    await mkdir(ziel2, { recursive: true });
    const schonDa = new Set(markeDateien(marke).map(([q]) => q));
    for (const e of await readdir(ordner, { withFileTypes: true })) {
      if (e.isFile() && !schonDa.has(e.name) && DATEI.test(e.name) && BILD_ENDUNGEN.has(extname(e.name).toLowerCase())) {
        await copyFile(join(ordner, e.name), join(ziel2, e.name));
      }
    }
  }
}
