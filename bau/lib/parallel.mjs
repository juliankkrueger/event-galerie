// Begrenzte Nebenläufigkeit. Beim ersten Fehler werden keine neuen Aufgaben
// mehr gestartet; laufende werden abgewartet, dann wird der Fehler geworfen.

export async function parallel(liste, anzahl, arbeit) {
  let naechster = 0;
  let fehler = null;
  const ergebnisse = new Array(liste.length);
  async function arbeiter() {
    while (!fehler && naechster < liste.length) {
      const i = naechster++;
      try {
        ergebnisse[i] = await arbeit(liste[i], i);
      } catch (e) {
        fehler ??= e;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(anzahl, liste.length)) }, arbeiter));
  if (fehler) throw fehler;
  return ergebnisse;
}

// Semaphor: höchstens n gleichzeitig.
export function begrenzer(n) {
  let aktiv = 0;
  const warteschlange = [];
  const weiter = () => {
    if (aktiv < n && warteschlange.length) {
      aktiv++;
      warteschlange.shift()();
    }
  };
  return async (fn) => {
    await new Promise((r) => {
      warteschlange.push(r);
      weiter();
    });
    try {
      return await fn();
    } finally {
      aktiv--;
      weiter();
    }
  };
}
