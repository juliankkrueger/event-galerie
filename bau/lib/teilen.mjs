// Originale ablegen: byte-gleich, über 25 MiB in Teile ≤ 25.000.000 B geteilt (.1, .2, …).

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, rename, stat, unlink } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const GRENZE_TEILEN = 26214400; // 25 MiB
export const TEIL_MAX = 25000000;

export class Md5Fehler extends Error {
  constructor(name, erwartet, ist) {
    // Ohne Dateinamen: die Meldung landet im öffentlichen Lauf-Log, der Name nur im verschlüsselten Bericht.
    super(`md5 stimmt nicht bei einem Original (erwartet ${erwartet}, ist ${ist})`);
    this.name = "Md5Fehler";
    this.datei = name;
  }
}

export function md5Strom(hash) {
  return new Transform({
    transform(chunk, _enc, weiter) {
      hash.update(chunk);
      weiter(null, chunk);
    },
  });
}

export async function md5Datei(pfad) {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(pfad)) hash.update(chunk);
  return hash.digest("hex");
}

async function verschiebe(von, nach) {
  try {
    await rename(von, nach);
  } catch (e) {
    if (e.code !== "EXDEV") throw e;
    await copyFile(von, nach);
    await unlink(von);
  }
}

// quelle: Datei; zielBasis: Pfad ohne Endung (".<n>" wird angehängt).
// verschieben: Quelle danach entfernen (Arbeitskopie) statt stehen lassen (lokaler Ordner).
// md5Erwartet: wenn gesetzt, wird beim Teilen nachgerechnet; bei Abweichung Md5Fehler.
export async function legeOriginalAb(quelle, zielBasis, { verschieben = false, md5Erwartet = null, name = quelle } = {}) {
  const { size } = await stat(quelle);
  if (size <= GRENZE_TEILEN) {
    const ziel = `${zielBasis}.1`;
    if (verschieben) await verschiebe(quelle, ziel);
    else await copyFile(quelle, ziel);
    return { teile: [ziel], bytes: size, geteilt: false };
  }
  const hash = createHash("md5");
  const teile = [];
  for (let start = 0, n = 1; start < size; start += TEIL_MAX, n++) {
    const ende = Math.min(size, start + TEIL_MAX) - 1;
    const ziel = `${zielBasis}.${n}`;
    await pipeline(createReadStream(quelle, { start, end: ende }), md5Strom(hash), createWriteStream(ziel));
    teile.push(ziel);
  }
  const ist = hash.digest("hex");
  if (md5Erwartet && ist !== md5Erwartet) {
    for (const t of teile) await unlink(t).catch(() => {});
    throw new Md5Fehler(name, md5Erwartet, ist);
  }
  if (verschieben) await unlink(quelle);
  return { teile, bytes: size, geteilt: true, md5: ist };
}

// Für Tests und Kontrolle: md5 über die zusammengesetzten Teile.
export async function md5Teile(teile) {
  const hash = createHash("md5");
  for (const t of teile) for await (const chunk of createReadStream(t)) hash.update(chunk);
  return hash.digest("hex");
}
