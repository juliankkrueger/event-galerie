// marken/<id>/marke.json lesen, prüfen und ins Deployment schreiben
// (assets/marke.css, Logo, Favicons). CSS und Zielpfade kommen aus marken/marke-css.mjs.

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { markeCss, markeDateien } from "../../marken/marke-css.mjs";

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DATEI = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
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
  if (!DOMAIN.test(marke.domain || "")) fehler.push("domain ungültig");
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
  if (fehler.length) throw new Error(`marken/${id}/marke.json: ${fehler.join("; ")}`);
  return { marke, ordner };
}

// Öffentliche Angaben für die Oberfläche (keine Geheimnisse).
export function markeOeffentlich(marke) {
  const { id, name, eventSeite, domain, impressum, datenschutz } = marke;
  return { id, name, eventSeite, domain, impressum, datenschutz };
}

export async function schreibeMarke(ziel, { marke, ordner }) {
  await mkdir(join(ziel, "assets"), { recursive: true });
  await writeFile(join(ziel, "assets", "marke.css"), markeCss(marke));
  await writeFile(join(ziel, "assets", "marke.json"), `${JSON.stringify(markeOeffentlich(marke), null, 2)}\n`);
  for (const [quelle, zielPfad] of markeDateien(marke)) {
    const nach = join(ziel, zielPfad);
    await mkdir(dirname(nach), { recursive: true });
    await copyFile(join(ordner, quelle), nach);
  }
}
