// GitHub über die gh-Kommandozeile (Julians Anmeldung): Workflow starten, Lauf finden und
// beobachten, Log-Auszug bei Fehlern, Artefakt bericht laden. Das gh-Token sieht dieses
// Werkzeug nie.

import { WerkzeugFehler, fuehreAus, mitWiederholung, warte } from "./umgebung.mjs";
import { ausZip } from "./zip.mjs";

const NETZ = /HTTP 5\d\d|timeout|timed out|connection|ECONNRESET|EOF|TLS|Bad Gateway|Service Unavailable|i\/o/i;

export function erzeugeGithub({ repo, protokoll = () => {}, taktMs = 15000, ausfuehren = fuehreAus }) {
  async function api(pfad, { methode = "GET", stdin, binaer = false, wiederholen = methode === "GET" } = {}) {
    const args = ["api", "--method", methode, "-H", "Accept: application/vnd.github+json", pfad];
    if (stdin !== undefined) args.push("--input", "-");
    return mitWiederholung(
      async () => {
        const r = await ausfuehren("gh", args, { stdin, binaer, zeitMs: 180000 });
        if (r.code !== 0) {
          const text = (binaer ? Buffer.from(r.stdout).toString("utf8") : r.stdout).slice(0, 500) + r.stderr.slice(0, 500);
          const f = new WerkzeugFehler(`GitHub ${methode} ${pfad.split("?")[0]}: ${text.replace(/\s+/g, " ").trim() || `Exit ${r.code}`}`);
          f.netz = NETZ.test(text);
          throw f;
        }
        if (binaer) return r.stdout;
        const t = r.stdout.trim();
        return t ? JSON.parse(t) : null;
      },
      { versuche: wiederholen ? 4 : 1, wiederholbar: (e) => e.netz, protokoll },
    );
  }

  async function angemeldet() {
    const r = await ausfuehren("gh", ["auth", "status", "--hostname", "github.com"], { zeitMs: 30000 });
    return r.code === 0;
  }

  const runsPfad = (workflow) => `repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=30`;

  async function findeLauf(workflow, titel, seitMs) {
    const r = await api(runsPfad(workflow));
    return (r?.workflow_runs || []).find((x) => x.display_title === titel && Date.parse(x.created_at) >= seitMs - 120000) || null;
  }

  /**
   * Startet den Workflow und liefert die Lauf-ID. Mit return_run_details antwortet GitHub direkt
   * mit der ID; sonst sucht das Werkzeug den Lauf über den run-name (titel).
   */
  async function starte(workflow, inputs, titel) {
    const seit = Date.now();
    const koerper = JSON.stringify({ ref: "main", inputs, return_run_details: true });
    let antwort = null;
    try {
      antwort = await api(`repos/${repo}/actions/workflows/${workflow}/dispatches`, { methode: "POST", stdin: koerper, wiederholen: false });
    } catch (e) {
      // Schon angekommen? Dann nicht doppelt starten.
      await warte(Math.min(taktMs, 5000));
      const da = await findeLauf(workflow, titel, seit).catch(() => null);
      if (da) return da.id;
      if (/return_run_details/.test(e.message)) {
        antwort = await api(`repos/${repo}/actions/workflows/${workflow}/dispatches`, { methode: "POST", stdin: JSON.stringify({ ref: "main", inputs }), wiederholen: false });
      } else throw e;
    }
    const id = antwort?.workflow_run_id ?? antwort?.id;
    if (Number.isFinite(Number(id)) && Number(id) > 0) return Number(id);
    for (let n = 0; n < 24; n++) {
      await warte(Math.min(taktMs, 5000));
      const lauf = await findeLauf(workflow, titel, seit);
      if (lauf) return lauf.id;
    }
    throw new WerkzeugFehler(`Lauf „${titel}“ nach dem Start nicht gefunden`, { hinweis: `https://github.com/${repo}/actions` });
  }

  const lauf = (id) => api(`repos/${repo}/actions/runs/${id}`);
  const jobs = async (id) => (await api(`repos/${repo}/actions/runs/${id}/jobs?per_page=30`))?.jobs || [];

  /** Wartet bis zum Ende, meldet knapp jeden neuen Schritt. */
  async function beobachte(id, { zeitlimitMs = 200 * 60000 } = {}) {
    const beginn = Date.now();
    let zuletzt = "";
    for (;;) {
      const r = await lauf(id);
      if (r.status === "completed") return r;
      if (Date.now() - beginn > zeitlimitMs) {
        throw new WerkzeugFehler(`Zeitlimit erreicht, Lauf noch ${r.status}`, { hinweis: r.html_url });
      }
      const js = await jobs(id).catch(() => []);
      const schritt = js.flatMap((j) => j.steps || []).find((s) => s.status === "in_progress");
      const stand = r.status === "queued" ? "wartet auf einen Läufer" : schritt ? schritt.name : r.status;
      if (stand !== zuletzt) {
        const min = Math.round((Date.now() - beginn) / 60000);
        protokoll(`  ${String(min).padStart(3)} min  ${stand}`);
        zuletzt = stand;
      }
      await warte(taktMs);
    }
  }

  /** Fehlgeschlagener Schritt und die letzten Zeilen davor, ohne lange Zeichenketten. */
  async function fehlerAuszug(id) {
    const js = await jobs(id).catch(() => []);
    const job = js.find((j) => j.conclusion === "failure") || js[0];
    if (!job) return { schritt: null, zeilen: [] };
    const schritt = (job.steps || []).find((s) => s.conclusion === "failure")?.name || null;
    let text = "";
    try {
      text = Buffer.from(await api(`repos/${repo}/actions/jobs/${job.id}/logs`, { binaer: true })).toString("utf8");
    } catch {
      return { schritt, zeilen: [] };
    }
    return { schritt, zeilen: logAuszug(text) };
  }

  /** bericht.enc aus dem Artefakt bericht des Laufs (Text) oder null. */
  async function berichtEnc(id) {
    const r = await api(`repos/${repo}/actions/runs/${id}/artifacts`);
    const a = (r?.artifacts || []).find((x) => x.name === "bericht" && !x.expired);
    if (!a) return null;
    const zip = await api(`repos/${repo}/actions/artifacts/${a.id}/zip`, { binaer: true });
    return ausZip(zip, "bericht.enc").toString("utf8").trim();
  }

  return { api, angemeldet, starte, findeLauf, lauf, jobs, beobachte, fehlerAuszug, berichtEnc };
}

/** Fehlerzeilen und Umfeld aus einem Job-Log, Zeitstempel weg, lange Werte geschwärzt. */
export function logAuszug(text, { davor = 12 } = {}) {
  const zeilen = String(text)
    .split(/\r?\n/)
    .map((z) => z.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ""))
    .map((z) => z.replace(/[A-Za-z0-9+/_=.-]{40,}/g, "<geschwärzt>"));
  const fehler = zeilen.findIndex((z) => /##\[error\]|::error::|Error:|Bau abgebrochen/.test(z));
  if (fehler < 0) return zeilen.filter(Boolean).slice(-davor);
  const ende = zeilen.findIndex((z, i) => i > fehler && /##\[error\]Process completed/.test(z));
  return zeilen.slice(Math.max(0, fehler - davor), (ende < 0 ? fehler : ende) + 1).filter(Boolean);
}
