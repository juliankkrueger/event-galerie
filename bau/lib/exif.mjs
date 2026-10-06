// Kleiner EXIF-Leser: nur GPS-Erkennung und Aufnahmezeit. Keine Abhängigkeiten.

const TYP_BYTES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function leser(buf, tiff, le) {
  const u16 = (o) => (le ? buf.readUInt16LE(tiff + o) : buf.readUInt16BE(tiff + o));
  const u32 = (o) => (le ? buf.readUInt32LE(tiff + o) : buf.readUInt32BE(tiff + o));
  const imBereich = (o, n) => o >= 0 && tiff + o + n <= buf.length;

  function ifd(offset) {
    const eintraege = new Map();
    if (!imBereich(offset, 2)) return eintraege;
    const anzahl = u16(offset);
    for (let i = 0; i < anzahl && i < 512; i++) {
      const e = offset + 2 + i * 12;
      if (!imBereich(e, 12)) break;
      const tag = u16(e);
      const typ = u16(e + 2);
      const zahl = u32(e + 4);
      const groesse = (TYP_BYTES[typ] || 0) * zahl;
      const wertOffset = groesse <= 4 ? e + 8 : u32(e + 8);
      eintraege.set(tag, { typ, zahl, wertOffset, groesse });
    }
    return eintraege;
  }

  function text(eintrag) {
    if (!eintrag || eintrag.typ !== 2 || !imBereich(eintrag.wertOffset, eintrag.groesse)) return null;
    const s = buf.toString("latin1", tiff + eintrag.wertOffset, tiff + eintrag.wertOffset + eintrag.groesse);
    return s.replace(/\0[\s\S]*$/, "").trim();
  }

  function rationale(eintrag) {
    if (!eintrag || (eintrag.typ !== 5 && eintrag.typ !== 10)) return [];
    if (!imBereich(eintrag.wertOffset, eintrag.groesse)) return [];
    const out = [];
    for (let i = 0; i < eintrag.zahl && i < 8; i++) {
      const z = u32(eintrag.wertOffset + i * 8);
      const n = u32(eintrag.wertOffset + i * 8 + 4);
      out.push(n ? z / n : 0);
    }
    return out;
  }

  const zeiger = (eintrag) => (eintrag && (eintrag.typ === 4 || eintrag.typ === 13) ? u32(eintrag.wertOffset) : null);

  return { u32, ifd, text, rationale, zeiger };
}

export function exifZeit(roh, versatz) {
  if (typeof roh !== "string") return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(roh.trim());
  if (!m) return null;
  const [, j, mo, t, h, mi, s] = m;
  if (j === "0000" || mo === "00" || t === "00" || Number(mo) > 12 || Number(t) > 31) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 60) return null;
  const zone = typeof versatz === "string" && /^[+-]\d{2}:\d{2}$/.test(versatz.trim()) ? versatz.trim() : "";
  return `${j}-${mo}-${t}T${h}:${mi}:${s}${zone}`;
}

// buf: EXIF-Block wie von sharp().metadata().exif (mit oder ohne "Exif\0\0").
export function leseExif(buf) {
  const leer = { gps: false, aufnahme: null };
  if (!buf || buf.length < 14) return leer;
  try {
    const tiff = buf.subarray(0, 6).toString("latin1") === "Exif\0\0" ? 6 : 0;
    const ordnung = buf.toString("latin1", tiff, tiff + 2);
    if (ordnung !== "II" && ordnung !== "MM") return leer;
    const r = leser(buf, tiff, ordnung === "II");
    const ifd0 = r.ifd(r.u32(4));

    let gps = false;
    const gpsZeiger = r.zeiger(ifd0.get(0x8825));
    if (gpsZeiger) {
      const g = r.ifd(gpsZeiger);
      const breite = r.rationale(g.get(0x0002));
      const laenge = r.rationale(g.get(0x0004));
      gps = [...breite, ...laenge].some((v) => v !== 0);
    }

    let aufnahme = null;
    const exifZeiger = r.zeiger(ifd0.get(0x8769));
    if (exifZeiger) {
      const e = r.ifd(exifZeiger);
      aufnahme = exifZeit(r.text(e.get(0x9003)), r.text(e.get(0x9011)));
    }
    if (!aufnahme) aufnahme = exifZeit(r.text(ifd0.get(0x0132)));
    return { gps, aufnahme };
  } catch {
    return leer;
  }
}
