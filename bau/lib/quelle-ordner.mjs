// Quelle "ordner:<pfad>": lokaler Ordner, gleiche Kapitellogik wie Drive.

import { open, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { md5Datei } from "./teilen.mjs";
import { parallel } from "./parallel.mjs";

const ENDUNGEN = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif"]);
const STILL = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

// Typ aus den ersten Bytes, nicht aus der Endung.
export async function erkenneTyp(pfad) {
  const h = await open(pfad, "r");
  try {
    const kopf = Buffer.alloc(16);
    const { bytesRead } = await h.read(kopf, 0, 16, 0);
    if (bytesRead >= 3 && kopf[0] === 0xff && kopf[1] === 0xd8 && kopf[2] === 0xff) return "image/jpeg";
    if (bytesRead >= 8 && kopf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (bytesRead >= 12 && kopf.toString("latin1", 4, 8) === "ftyp") {
      const marke = kopf.toString("latin1", 8, 12);
      if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(marke)) return "image/heic";
    }
    return null;
  } finally {
    await h.close();
  }
}

export async function listeLokal(wurzel) {
  const eintraege = [];
  const uebersprungen = [];
  const st = await stat(wurzel).catch(() => null);
  if (!st || !st.isDirectory()) throw new Error(`Quellordner nicht gefunden: ${wurzel}`);

  async function gehe(ordner, pfad) {
    const liste = await readdir(ordner, { withFileTypes: true });
    for (const e of liste) {
      if (e.name.startsWith(".") || STILL.has(e.name)) continue;
      const voll = join(ordner, e.name);
      const anzeige = [...pfad, e.name].join("/");
      if (e.isDirectory()) {
        await gehe(voll, [...pfad, e.name]);
      } else if (e.isFile()) {
        if (!ENDUNGEN.has(extname(e.name).toLowerCase())) {
          uebersprungen.push({ name: anzeige, grund: "kein unterstütztes Bildformat" });
          continue;
        }
        const mime = await erkenneTyp(voll);
        if (!mime) {
          uebersprungen.push({ name: anzeige, grund: "Inhalt ist kein JPEG, PNG oder HEIC" });
          continue;
        }
        eintraege.push({ pfad, name: e.name, mime, lokal: voll, bytes: (await stat(voll)).size });
      }
    }
  }
  await gehe(wurzel, []);
  await parallel(eintraege, 4, async (e) => {
    e.md5 = await md5Datei(e.lokal);
  });
  return { eintraege, uebersprungen };
}
