// Kapitellogik: Unterordner werden Kapitel (Pfad mit " · " verbunden),
// Bilder direkt im Event-Ordner bilden "Alle Fotos". Dubletten (gleiche md5) zählen einmal.

export const KAPITEL_WURZEL = "Alle Fotos";
export const KAPITEL_TRENNER = " · ";
export const BILD_TYPEN = new Set(["image/jpeg", "image/png", "image/heic"]);

const sortierer = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

export function vergleicheNamen(a, b) {
  return sortierer.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

function vergleichePfade(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = vergleicheNamen(a[i], b[i]);
    if (c) return c;
  }
  return a.length - b.length;
}

export const kapitelTitel = (pfad) => (pfad.length ? pfad.join(KAPITEL_TRENNER) : KAPITEL_WURZEL);
export const anzeigeName = (eintrag) => [...eintrag.pfad, eintrag.name].join("/");

// eintraege: [{ pfad: string[], name, md5, ... }]
// Ergebnis: { kapitel: [{ titel, pfad, bilder }], dubletten: [{ name, gleichWie }] }
export function bildeKapitel(eintraege) {
  const sortiert = [...eintraege].sort(
    (a, b) => vergleichePfade(a.pfad, b.pfad) || vergleicheNamen(a.name, b.name),
  );
  const gesehen = new Map();
  const dubletten = [];
  const kapitel = [];
  let aktuell = null;
  for (const e of sortiert) {
    if (e.md5) {
      const erster = gesehen.get(e.md5);
      if (erster) {
        dubletten.push({ name: anzeigeName(e), gleichWie: anzeigeName(erster) });
        continue;
      }
      gesehen.set(e.md5, e);
    }
    const titel = kapitelTitel(e.pfad);
    if (!aktuell || aktuell.titel !== titel) {
      aktuell = { titel, pfad: e.pfad, bilder: [] };
      kapitel.push(aktuell);
    }
    aktuell.bilder.push(e);
  }
  return { kapitel, dubletten };
}

// Reihenfolge der Kapitel im Manifest. Nach Namen stünde "Mittwoch · Abend" vor "Mittwoch · Tag"
// und "Donnerstag" vor "Mittwoch". Darum: Hat jedes Kapitel mindestens eine Aufnahmezeit, gilt die
// früheste Aufnahme je Kapitel (gleich früh: Namensreihenfolge). Fehlt sie irgendwo, bleibt es bei
// den Namen, damit nummerierte Ordner ("1 Mittwoch") das Team steuern können.
// kapitel: [{ titel, bilder: [{ aufnahme }] }] in Namensreihenfolge.
export function ordneKapitel(kapitel) {
  const frueheste = kapitel.map((k) => {
    const zeiten = k.bilder.map((b) => Date.parse(b.aufnahme)).filter(Number.isFinite);
    return zeiten.length ? Math.min(...zeiten) : null;
  });
  if (frueheste.some((z) => z === null)) return [...kapitel];
  return kapitel
    .map((k, i) => ({ k, i, z: frueheste[i] }))
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map((x) => x.k);
}
