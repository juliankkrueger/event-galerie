#!/usr/bin/env node
// Cloudflare-Pages-Verwaltung für die Workflows (nur API, Token aus der Umgebung).
// Gibt nie Token oder Header aus.
//
// node bau/pages.mjs projekt-pruefen --projekt <name>             Exit 0 = vorhanden, 3 = fehlt
// node bau/pages.mjs domain-sicherstellen --projekt <name> --domain <host>
// node bau/pages.mjs alte-deployments-loeschen --projekt <name> [--falls-vorhanden]
//      behält nur das neueste (und das Produktions-)Deployment; mit --falls-vorhanden
//      ist ein fehlendes Projekt kein Fehler (offline.yml, wenn nie etwas online war)
// node bau/pages.mjs galerie-pruefen --projekt <name> --galerie <id>
//      Exit 0 = die Produktion zeigt genau diese Galerie (abschalten),
//      Exit 4 = diese Galerie ist dort nicht online (nichts tun),
//      Exit 1 = Zuordnung unklar (abbrechen, nichts abschalten)
// node bau/pages.mjs loeschen-pruefen --projekt <name> --galerie <id>
//      Darf offline.yml (aktion loeschen) das ganze Projekt löschen?
//      Exit 0 = Produktion zeigt diese Galerie, Exit 5 = Produktion zeigt die Offline-Seite
//      dieser Galerie, Exit 6 = Projekt ohne Produktions-Deployment, Exit 3 = Projekt fehlt
//      (nichts zu tun), Exit 1 = gehört einer anderen Galerie oder unklar (nichts löschen)
// node bau/pages.mjs projekt-loeschen --projekt <name>
//      löscht das Projekt und prüft danach, dass die API es nicht mehr kennt
//
// Umgebung: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const CF_API = "https://api.cloudflare.com/client/v4";
const PROJEKT = /^[a-z0-9][a-z0-9-]{0,57}$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const KONTO = /^[0-9a-f]{32}$/;
const GALERIE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Wem gehört das Produktions-Deployment? bauen.yml deployt mit der
 * Commit-Nachricht „galerie <id>", offline.yml mit „offline <id>". Nur daran
 * erkennt offline.yml, ob es die richtige Galerie abschaltet: je Marke gibt es
 * ein Pages-Projekt, und das Projekt kann längst die Galerie eines anderen
 * Events ausliefern.
 * @returns {{ stand: "leer" | "galerie" | "offline" | "unbekannt", galerie: string | null }}
 */
export function produktionsStand(projekt) {
  const d = projekt?.canonical_deployment;
  if (!d) return { stand: "leer", galerie: null };
  const nachricht = String(d.deployment_trigger?.metadata?.commit_message ?? "").trim();
  const g = /^galerie ([A-Za-z0-9_-]{1,64})$/.exec(nachricht);
  if (g) return { stand: "galerie", galerie: g[1] };
  if (/^offline [A-Za-z0-9_-]{1,64}$/.test(nachricht)) return { stand: "offline", galerie: null, offlineVon: nachricht.slice(8) };
  return { stand: "unbekannt", galerie: null };
}

export function erzeugeCf({ token, konto, fetchImpl = fetch }) {
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN fehlt");
  if (!KONTO.test(konto || "")) throw new Error("CLOUDFLARE_ACCOUNT_ID fehlt oder ungültig");
  const basis = `${CF_API}/accounts/${konto}/pages/projects`;

  async function rufe(methode, pfad, koerper) {
    const res = await fetchImpl(`${basis}${pfad}`, {
      method: methode,
      headers: { Authorization: `Bearer ${token}`, ...(koerper ? { "Content-Type": "application/json" } : {}) },
      body: koerper ? JSON.stringify(koerper) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok || (json && json.success === false)) {
      const meldung = (json?.errors || []).map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${res.status}`;
      const f = new Error(`Cloudflare ${methode} ${pfad.split("?")[0]}: ${meldung}`);
      f.status = res.status;
      throw f;
    }
    return json;
  }

  async function projekt(name) {
    if (!PROJEKT.test(name)) throw new Error("Projektname ungültig");
    try {
      return (await rufe("GET", `/${name}`)).result;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async function domainSicherstellen(name, domain) {
    if (!PROJEKT.test(name)) throw new Error("Projektname ungültig");
    if (!DOMAIN.test(domain)) throw new Error("Domain ungültig");
    const liste = (await rufe("GET", `/${name}/domains`)).result || [];
    const da = liste.find((d) => d.name === domain);
    if (da) return { neu: false, status: da.status };
    const r = (await rufe("POST", `/${name}/domains`, { name: domain })).result;
    return { neu: true, status: r?.status };
  }

  async function alleDeployments(name) {
    const alle = [];
    for (let seite = 1; seite <= 400; seite++) {
      const r = await rufe("GET", `/${name}/deployments?page=${seite}&per_page=25`);
      const teil = r.result || [];
      alle.push(...teil);
      const info = r.result_info || {};
      const gesamt = info.total_count ?? info.count;
      if (!teil.length || (info.total_pages && seite >= info.total_pages) || (gesamt !== undefined && alle.length >= gesamt)) break;
    }
    return alle;
  }

  async function alteDeploymentsLoeschen(name, { protokoll = () => {}, fallsVorhanden = false } = {}) {
    const p = await projekt(name);
    if (!p && fallsVorhanden) return { behalten: [], geloescht: 0, fehlt: true };
    if (!p) throw new Error(`Projekt ${name} gibt es nicht`);
    const liste = await alleDeployments(name);
    if (!liste.length) return { behalten: [], geloescht: 0 };
    const neuestes = [...liste].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
    const behalten = new Set([neuestes.id, p.canonical_deployment?.id].filter(Boolean));
    let geloescht = 0;
    for (const d of liste) {
      if (behalten.has(d.id)) continue;
      await rufe("DELETE", `/${name}/deployments/${encodeURIComponent(d.id)}?force=true`);
      geloescht++;
      if (geloescht % 10 === 0) protokoll(`  ${geloescht} gelöscht`);
    }
    return { behalten: [...behalten], geloescht };
  }

  /** Entscheidet, ob offline.yml für diese Galerie abschalten darf. */
  async function galeriePruefen(name, galerieId) {
    if (!GALERIE.test(galerieId || "")) throw new Error("Galerie-ID ungültig");
    const p = await projekt(name);
    if (!p) return { abschalten: false, grund: "Projekt gibt es nicht, es war nichts online" };
    const s = produktionsStand(p);
    if (s.stand === "galerie" && s.galerie === galerieId) return { abschalten: true, grund: `Produktion zeigt Galerie ${galerieId}` };
    if (s.stand === "galerie") return { abschalten: false, grund: `Produktion zeigt eine andere Galerie (${s.galerie}), sie bleibt online` };
    if (s.stand === "offline") return { abschalten: false, grund: "Produktion zeigt schon die Offline-Seite" };
    if (s.stand === "leer") return { abschalten: false, grund: "Projekt hat kein Produktions-Deployment" };
    throw new Error("Produktions-Deployment ohne erkennbare Galerie-ID, aus Vorsicht wird nichts abgeschaltet");
  }

  /**
   * Gehört das Projekt dieser Galerie? Nur dann darf offline.yml es ganz löschen.
   * @returns {Promise<"galerie" | "offline" | "leer" | "fehlt">}
   */
  async function loeschenPruefen(name, galerieId) {
    if (!GALERIE.test(galerieId || "")) throw new Error("Galerie-ID ungültig");
    const p = await projekt(name);
    if (!p) return "fehlt";
    const s = produktionsStand(p);
    if (s.stand === "galerie" && s.galerie === galerieId) return "galerie";
    if (s.stand === "offline" && s.offlineVon === galerieId) return "offline";
    if (s.stand === "leer") return "leer";
    throw new Error("Projekt gehört einer anderen Galerie oder ist nicht zuzuordnen, es wird nichts gelöscht");
  }

  /** Löscht das ganze Projekt. Ein schon fehlendes Projekt ist kein Fehler. */
  async function projektLoeschen(name) {
    if (!PROJEKT.test(name)) throw new Error("Projektname ungültig");
    try {
      await rufe("DELETE", `/${name}`);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    if (await projekt(name)) throw new Error(`Projekt ${name} ist nach dem Löschen noch da`);
    return { geloescht: true };
  }

  return { projekt, domainSicherstellen, alleDeployments, alteDeploymentsLoeschen, galeriePruefen, loeschenPruefen, projektLoeschen };
}

async function haupt() {
  const [befehl, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      projekt: { type: "string" },
      domain: { type: "string" },
      galerie: { type: "string" },
      "falls-vorhanden": { type: "boolean" },
    },
    strict: true,
  });
  const cf = erzeugeCf({ token: process.env.CLOUDFLARE_API_TOKEN, konto: process.env.CLOUDFLARE_ACCOUNT_ID });
  if (befehl === "projekt-pruefen") {
    const p = await cf.projekt(values.projekt);
    console.log(p ? `Projekt ${values.projekt} vorhanden` : `Projekt ${values.projekt} fehlt`);
    return p ? 0 : 3;
  }
  if (befehl === "domain-sicherstellen") {
    const r = await cf.domainSicherstellen(values.projekt, values.domain);
    console.log(`Domain ${values.domain}: ${r.neu ? "angehängt" : "war schon da"} (Status ${r.status || "unbekannt"})`);
    return 0;
  }
  if (befehl === "alte-deployments-loeschen") {
    const r = await cf.alteDeploymentsLoeschen(values.projekt, { protokoll: console.log, fallsVorhanden: values["falls-vorhanden"] });
    if (r.fehlt) console.log(`Projekt ${values.projekt} gibt es nicht, nichts zu löschen`);
    else console.log(`${r.geloescht} ältere Deployments gelöscht, ${r.behalten.length} behalten`);
    return 0;
  }
  if (befehl === "galerie-pruefen") {
    const r = await cf.galeriePruefen(values.projekt, values.galerie);
    console.log(r.grund);
    return r.abschalten ? 0 : 4;
  }
  if (befehl === "loeschen-pruefen") {
    const r = await cf.loeschenPruefen(values.projekt, values.galerie);
    const text = { galerie: "Produktion zeigt diese Galerie", offline: "Produktion zeigt die Offline-Seite dieser Galerie", leer: "Projekt ohne Produktions-Deployment", fehlt: "Projekt gibt es nicht" }[r];
    console.log(text);
    return { galerie: 0, offline: 5, leer: 6, fehlt: 3 }[r];
  }
  if (befehl === "projekt-loeschen") {
    await cf.projektLoeschen(values.projekt);
    console.log("Projekt gelöscht, die API kennt es nicht mehr");
    return 0;
  }
  console.error("Befehl: projekt-pruefen | domain-sicherstellen | alte-deployments-loeschen | galerie-pruefen | loeschen-pruefen | projekt-loeschen");
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await haupt();
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
