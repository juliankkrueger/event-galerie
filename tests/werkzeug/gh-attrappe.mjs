// Nachgebautes gh für die Werkzeug-Tests (aufgerufen von bin/gh). Spielt die GitHub-API der
// Workflows bauen.yml und offline.yml: Start, Lauf, Jobs, Artefakt bericht, Job-Log.
import { readFileSync, writeFileSync } from "node:fs";
import { entschluesseleText, verschluessele } from "../../bau/lib/geheim.mjs";
import { baueZip } from "../../werkzeug/lib/zip.mjs";
import { TEST_SCHLUESSEL } from "./attrappen.mjs";

export async function gh(args, datei) {
  const z = JSON.parse(readFileSync(datei, "utf8"));
  const speichern = () => writeFileSync(datei, JSON.stringify(z, null, 1));
  const aus = (k) => process.stdout.write(typeof k === "string" || Buffer.isBuffer(k) ? k : JSON.stringify(k));
  if (args[0] === "auth") process.exit(z.ghAngemeldet ? 0 : 1);
  if (args[0] !== "api") process.exit(2);
  const methode = args[args.indexOf("--method") + 1];
  const pfad = args.find((a) => a.startsWith("repos/"));
  const r = /^repos\/[^/]+\/[^/]+\/actions\/(.*)$/.exec(pfad)[1];

  const start = /^workflows\/(bauen|offline)\.yml\/dispatches$/.exec(r);
  if (start && methode === "POST") {
    let text = "";
    for await (const t of process.stdin) text += t;
    const k = JSON.parse(text);
    if (z.ohneRunDetails && "return_run_details" in k) {
      process.stderr.write("gh: Invalid request. return_run_details is not a permitted key. (HTTP 422)\n");
      process.exit(1);
    }
    const i = k.inputs;
    const id = z.naechsteLaufId++;
    z.dispatches.push({ workflow: start[1], inputs: i, laufId: id });
    const titel = start[1] === "bauen" ? `bauen ${i.galerie_id}` : `${i.aktion} ${i.galerie_id}`;
    z.laeufe[id] = { id, workflow: start[1], titel, inputs: i, abfragen: 0, erstellt: new Date().toISOString() };
    if (start[1] === "bauen") {
      const hash = entschluesseleText(i.code_hash_enc, TEST_SCHLUESSEL, i.galerie_id);
      z.laeufe[id].codeHash = hash;
    }
    speichern();
    if (!("return_run_details" in k)) return; // 204
    return aus({ workflow_run_id: id, run_url: `https://api.github.com/x/${id}`, html_url: `https://github.com/x/actions/runs/${id}` });
  }
  if (/^workflows\/[a-z]+\.yml\/runs/.test(r)) {
    return aus({ workflow_runs: Object.values(z.laeufe).map((l) => ({ id: l.id, display_title: l.titel, created_at: l.erstellt })) });
  }
  const lauf = /^runs\/(\d+)(\/(jobs|artifacts))?/.exec(r);
  if (lauf) {
    const l = z.laeufe[lauf[1]];
    if (!lauf[2]) {
      l.abfragen++;
      const fertig = l.abfragen > 2;
      if (fertig && !l.wirkung) {
        l.wirkung = true;
        const ok = z.ergebnis === "success";
        if (ok && l.workflow === "bauen") {
          z.projekte[l.inputs.projekt] = { titel: l.inputs.titel, marke: l.inputs.marke, galerie: l.inputs.galerie_id, codeHash: l.codeHash };
        }
        if (ok && l.workflow === "offline" && z.projekte[l.inputs.projekt]) {
          if (l.inputs.aktion === "loeschen") z.projekte[l.inputs.projekt].geloescht = true;
          else z.projekte[l.inputs.projekt].offline = true;
        }
      }
      speichern();
      return aus({
        id: l.id,
        status: fertig ? "completed" : l.abfragen === 1 ? "queued" : "in_progress",
        conclusion: fertig ? z.ergebnis : null,
        html_url: `https://github.com/x/actions/runs/${l.id}`,
        created_at: l.erstellt,
        run_started_at: l.erstellt,
        updated_at: new Date(Date.parse(l.erstellt) + 125000).toISOString(),
      });
    }
    if (lauf[3] === "jobs") {
      const ok = z.ergebnis === "success";
      const namen = l.workflow === "bauen" ? ["Galerie bauen", "Deployen"] : ["Offline-Seite deployen", "Ältere Deployments löschen", "Projekt löschen"];
      return aus({
        jobs: [{
          id: 55,
          conclusion: l.abfragen > 2 ? (ok ? "success" : "failure") : null,
          steps: namen.map((name, i) => ({
            name,
            status: l.abfragen > 2 ? "completed" : i === 0 ? "in_progress" : "queued",
            conclusion: l.abfragen > 2 ? (ok || i > 0 ? (name === "Projekt löschen" && l.inputs.aktion !== "loeschen" ? "skipped" : "success") : "failure") : null,
          })),
        }],
      });
    }
    if (lauf[3] === "artifacts") return aus({ artifacts: [{ id: 77, name: "bericht", expired: false }] });
  }
  if (/^artifacts\/77\/zip$/.test(r)) {
    const l = Object.values(z.laeufe).filter((x) => x.workflow === "bauen").at(-1);
    const bericht = {
      galerie: l.inputs.galerie_id, marke: l.inputs.marke, anzahl: z.berichtAnzahl ?? 4, dubletten: 0,
      bytesOriginale: 4040, bytesGesamt: 9000, dateien: 30, geteilteOriginale: [], gpsFunde: z.ergebnis === "success" ? ["foto-1.jpg"] : [],
      md5Fehler: [], uebersprungen: [], dauerSek: 3, ...(z.ergebnis === "success" ? {} : { fehler: "Drive-Ordner nicht gefunden" }),
    };
    const enc = verschluessele(JSON.stringify(bericht), TEST_SCHLUESSEL, l.inputs.galerie_id);
    return aus(baueZip([["bericht.enc", Buffer.from(`${enc}\n`)]]));
  }
  if (/^jobs\/55\/logs$/.test(r)) {
    return aus([
      "2026-10-06T10:00:00.0000000Z ##[group]Run node bau/bau.mjs",
      "2026-10-06T10:00:01.0000000Z Quelle Drive lesen",
      `2026-10-06T10:00:02.0000000Z Bau abgebrochen: Drive-Ordner nicht gefunden ${"x".repeat(60)}`,
      "2026-10-06T10:00:02.1000000Z ##[error]Process completed with exit code 1.",
    ].join("\n"));
  }
  process.stderr.write(`gh-Attrappe: unbekannt ${methode} ${pfad} (HTTP 404)\n`);
  process.exit(1);
}
