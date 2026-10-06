// Liest eine Datei aus einem ZIP (Artefakte von GitHub Actions). Nur „gespeichert“ (0) und
// „deflate“ (8), Größen und Versatz aus dem zentralen Verzeichnis.

import { deflateRawSync, inflateRawSync } from "node:zlib";

export function ausZip(puffer, name) {
  const b = Buffer.from(puffer);
  let ende = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      ende = i;
      break;
    }
  }
  if (ende < 0) throw new Error("Kein gültiges ZIP");
  const anzahl = b.readUInt16LE(ende + 10);
  let p = b.readUInt32LE(ende + 16);
  for (let n = 0; n < anzahl; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("ZIP-Verzeichnis beschädigt");
    const methode = b.readUInt16LE(p + 10);
    const gepackt = b.readUInt32LE(p + 20);
    const nameLaenge = b.readUInt16LE(p + 28);
    const extraLaenge = b.readUInt16LE(p + 30);
    const kommentarLaenge = b.readUInt16LE(p + 32);
    const lokal = b.readUInt32LE(p + 42);
    const eintrag = b.subarray(p + 46, p + 46 + nameLaenge).toString("utf8");
    p += 46 + nameLaenge + extraLaenge + kommentarLaenge;
    if (eintrag !== name) continue;
    if (b.readUInt32LE(lokal) !== 0x04034b50) throw new Error("ZIP-Eintrag beschädigt");
    const start = lokal + 30 + b.readUInt16LE(lokal + 26) + b.readUInt16LE(lokal + 28);
    const daten = b.subarray(start, start + gepackt);
    if (methode === 0) return Buffer.from(daten);
    if (methode === 8) return inflateRawSync(daten);
    throw new Error(`ZIP-Methode ${methode} nicht unterstützt`);
  }
  throw new Error(`${name} fehlt im ZIP`);
}

/** Baut ein ZIP (für Tests). eintraege: [[name, Buffer, "deflate"|"stored"]] */
export function baueZip(eintraege) {
  const lokal = [];
  const zentral = [];
  let versatz = 0;
  for (const [name, inhalt, art = "deflate"] of eintraege) {
    const n = Buffer.from(name, "utf8");
    const roh = Buffer.from(inhalt);
    const methode = art === "deflate" ? 8 : 0;
    const daten = methode === 8 ? deflateRawSync(roh) : roh;
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0);
    kopf.writeUInt16LE(20, 4);
    kopf.writeUInt16LE(methode, 8);
    kopf.writeUInt32LE(0, 14);
    kopf.writeUInt32LE(daten.length, 18);
    kopf.writeUInt32LE(roh.length, 22);
    kopf.writeUInt16LE(n.length, 26);
    lokal.push(kopf, n, daten);
    const z = Buffer.alloc(46);
    z.writeUInt32LE(0x02014b50, 0);
    z.writeUInt16LE(20, 4);
    z.writeUInt16LE(20, 6);
    z.writeUInt16LE(methode, 10);
    z.writeUInt32LE(daten.length, 20);
    z.writeUInt32LE(roh.length, 24);
    z.writeUInt16LE(n.length, 28);
    z.writeUInt32LE(versatz, 42);
    zentral.push(z, n);
    versatz += 30 + n.length + daten.length;
  }
  const zBuf = Buffer.concat(zentral);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(eintraege.length, 8);
  ende.writeUInt16LE(eintraege.length, 10);
  ende.writeUInt32LE(zBuf.length, 12);
  ende.writeUInt32LE(versatz, 16);
  return Buffer.concat([...lokal, zBuf, ende]);
}
