import assert from "node:assert/strict";
import { test } from "node:test";
import { erzeugeCf, produktionsStand } from "../../bau/pages.mjs";

const KONTO = "0123456789abcdef0123456789abcdef";
const TOKEN = "cf-test-token";

function falscheCf({ projekte = {}, domains = {}, deployments = [] }) {
  const aufrufe = [];
  const liste = [...deployments];
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    const u = new URL(url);
    const pfad = u.pathname.replace(`/client/v4/accounts/${KONTO}/pages/projects`, "");
    aufrufe.push(`${init.method} ${pfad}${u.search}`);
    const antwort = (status, koerper) => new Response(JSON.stringify(koerper), { status });
    const [, name, art, id] = pfad.split("/");
    if (!projekte[name]) return antwort(404, { success: false, errors: [{ code: 8000007, message: "Project not found" }] });
    if (!art && init.method === "GET") return antwort(200, { success: true, result: projekte[name] });
    if (art === "domains" && init.method === "GET") return antwort(200, { success: true, result: domains[name] || [] });
    if (art === "domains" && init.method === "POST") {
      const neu = { name: JSON.parse(init.body).name, status: "pending" };
      (domains[name] ||= []).push(neu);
      return antwort(200, { success: true, result: neu });
    }
    if (art === "deployments" && init.method === "GET") {
      const seite = Number(u.searchParams.get("page"));
      const pro = Number(u.searchParams.get("per_page"));
      const teil = liste.slice((seite - 1) * pro, seite * pro);
      return antwort(200, { success: true, result: teil, result_info: { page: seite, per_page: pro, count: teil.length, total_count: liste.length } });
    }
    if (art === "deployments" && init.method === "DELETE") {
      assert.equal(u.searchParams.get("force"), "true");
      return antwort(200, { success: true, result: null });
    }
    return antwort(400, { success: false, errors: [{ code: 1, message: "unerwartet" }] });
  };
  return { fetchImpl, aufrufe };
}

test("projekt: vorhanden und fehlend", async () => {
  const { fetchImpl } = falscheCf({ projekte: { "fotos-a": { name: "fotos-a" } } });
  const cf = erzeugeCf({ token: TOKEN, konto: KONTO, fetchImpl });
  assert.equal((await cf.projekt("fotos-a")).name, "fotos-a");
  assert.equal(await cf.projekt("fotos-b"), null);
  await assert.rejects(cf.projekt("Fotos B; rm"), /ungültig/);
});

test("Domain wird nur angehängt, wenn sie fehlt", async () => {
  const { fetchImpl, aufrufe } = falscheCf({ projekte: { "fotos-a": {} }, domains: { "fotos-a": [{ name: "alt.example.org", status: "active" }] } });
  const cf = erzeugeCf({ token: TOKEN, konto: KONTO, fetchImpl });
  assert.deepEqual(await cf.domainSicherstellen("fotos-a", "fotos.example.org"), { neu: true, status: "pending" });
  assert.deepEqual(await cf.domainSicherstellen("fotos-a", "fotos.example.org"), { neu: false, status: "pending" });
  assert.equal(aufrufe.filter((a) => a.startsWith("POST")).length, 1);
});

test("Alte Deployments: alle Seiten gelesen, alle außer neuestem und Produktion mit force gelöscht", async () => {
  const deployments = Array.from({ length: 60 }, (_, i) => ({
    id: `d${i}`,
    created_on: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
  }));
  const { fetchImpl, aufrufe } = falscheCf({ projekte: { "fotos-a": { canonical_deployment: { id: "d59" } } }, deployments });
  const cf = erzeugeCf({ token: TOKEN, konto: KONTO, fetchImpl });
  const r = await cf.alteDeploymentsLoeschen("fotos-a");
  assert.equal(r.geloescht, 59);
  assert.deepEqual(r.behalten, ["d59"]);
  assert.equal(aufrufe.filter((a) => a.startsWith("GET /fotos-a/deployments")).length, 3);
  assert.ok(!aufrufe.some((a) => a.startsWith("DELETE /fotos-a/deployments/d59")));
});

test("Fehlende Umgebung wird klar gemeldet, Fehlertexte ohne Token", async () => {
  assert.throws(() => erzeugeCf({ token: "", konto: KONTO }), /CLOUDFLARE_API_TOKEN/);
  assert.throws(() => erzeugeCf({ token: TOKEN, konto: "x" }), /CLOUDFLARE_ACCOUNT_ID/);
  const { fetchImpl } = falscheCf({});
  const cf = erzeugeCf({ token: TOKEN, konto: KONTO, fetchImpl });
  await assert.rejects(cf.alteDeploymentsLoeschen("fotos-x"), (e) => !e.message.includes(TOKEN));
  assert.deepEqual(await cf.alteDeploymentsLoeschen("fotos-x", { fallsVorhanden: true }), { behalten: [], geloescht: 0, fehlt: true });
});

const mitNachricht = (commit_message) => ({ canonical_deployment: { id: "d1", deployment_trigger: { metadata: { commit_message } } } });

test("Produktionsstand: Galerie, Offline-Seite, leer und unbekannt", () => {
  assert.deepEqual(produktionsStand(mitNachricht("galerie 1b2c-AA_x")), { stand: "galerie", galerie: "1b2c-AA_x" });
  assert.deepEqual(produktionsStand(mitNachricht(" galerie g1 ")), { stand: "galerie", galerie: "g1" });
  assert.equal(produktionsStand(mitNachricht("offline g1")).stand, "offline");
  assert.equal(produktionsStand({}).stand, "leer");
  assert.equal(produktionsStand(mitNachricht("")).stand, "unbekannt");
  assert.equal(produktionsStand(mitNachricht("galerie g1; rm -rf")).stand, "unbekannt");
  assert.equal(produktionsStand({ canonical_deployment: { id: "d1" } }).stand, "unbekannt");
});

test("Offline schaltet nur die eigene Galerie ab, nie die eines anderen Events derselben Marke", async () => {
  const projekte = { "fotos-a": mitNachricht("galerie B") };
  const { fetchImpl, aufrufe } = falscheCf({ projekte });
  const cf = erzeugeCf({ token: TOKEN, konto: KONTO, fetchImpl });
  const fremd = await cf.galeriePruefen("fotos-a", "A");
  assert.equal(fremd.abschalten, false);
  assert.match(fremd.grund, /andere Galerie \(B\)/);
  assert.equal((await cf.galeriePruefen("fotos-a", "B")).abschalten, true);
  assert.ok(aufrufe.every((a) => a.startsWith("GET")), "Prüfen darf nichts verändern");
});

test("Offline-Prüfung: schon offline, leer, fehlendes Projekt = nichts tun; unklar = Abbruch", async () => {
  const projekte = { off: mitNachricht("offline A"), leer: {}, komisch: mitNachricht("manuell hochgeladen") };
  const { fetchImpl } = falscheCf({ projekte });
  const cf = erzeugeCf({ token: TOKEN, konto: KONTO, fetchImpl });
  assert.equal((await cf.galeriePruefen("off", "A")).abschalten, false);
  assert.equal((await cf.galeriePruefen("leer", "A")).abschalten, false);
  assert.equal((await cf.galeriePruefen("fehlt", "A")).abschalten, false);
  await assert.rejects(cf.galeriePruefen("komisch", "A"), /nichts abgeschaltet/);
  await assert.rejects(cf.galeriePruefen("off", "A B"), /Galerie-ID ungültig/);
});

test("Andere Galerie in Produktion: offline löscht trotzdem alle Nicht-Produktions-Deployments", async () => {
  // A wurde von B ersetzt; A steht noch unter ihrer Hash-Adresse. offline A darf B nicht
  // abschalten, muss A aber entfernen (offline.yml ruft danach alte-deployments-loeschen).
  const deployments = [
    { id: "a1", created_on: "2026-10-01T10:00:00Z" },
    { id: "a2", created_on: "2026-10-02T10:00:00Z" },
    { id: "b1", created_on: "2026-10-03T10:00:00Z" },
  ];
  const projekte = { "fotos-a": { canonical_deployment: { id: "b1", deployment_trigger: { metadata: { commit_message: "galerie B" } } } } };
  const { fetchImpl, aufrufe } = falscheCf({ projekte, deployments });
  const cf = erzeugeCf({ token: TOKEN, konto: KONTO, fetchImpl });
  assert.equal((await cf.galeriePruefen("fotos-a", "A")).abschalten, false);
  const r = await cf.alteDeploymentsLoeschen("fotos-a");
  assert.equal(r.geloescht, 2);
  assert.deepEqual(r.behalten, ["b1"]);
  assert.deepEqual(aufrufe.filter((a) => a.startsWith("DELETE")).map((a) => a.split("?")[0]), ["DELETE /fotos-a/deployments/a1", "DELETE /fotos-a/deployments/a2"]);
});

test("Workflows: bauen.yml und offline.yml löschen ältere Deployments, wrangler fest aus dem Lockfile", async () => {
  const { readFile } = await import("node:fs/promises");
  const bauen = await readFile(new URL("../../.github/workflows/bauen.yml", import.meta.url), "utf8");
  const offline = await readFile(new URL("../../.github/workflows/offline.yml", import.meta.url), "utf8");
  for (const [name, text] of [["bauen.yml", bauen], ["offline.yml", offline]]) {
    assert.doesNotMatch(text, /npx --yes|wrangler@/, `${name}: wrangler nie ungepinnt nachladen`);
    assert.match(text, /alte-deployments-loeschen/, `${name}: ältere Deployments löschen`);
  }
  // bauen.yml: erst nach erfolgreicher Prüfung löschen
  assert.ok(bauen.indexOf("alte-deployments-loeschen") > bauen.indexOf("name: Deployment prüfen"));
  // offline.yml: auch wenn eine andere Galerie in Produktion ist (da=nein), nur bei unklarer Zuordnung nicht
  assert.match(offline, /alte-deployments-loeschen --projekt "\$PAGES_PROJEKT" --falls-vorhanden/);
  // Code-Hash nie im Job-env (GitHub zeigt den env-Block im Log jedes Schritts)
  const jobEnv = bauen.slice(bauen.indexOf("jobs:"), bauen.indexOf("steps:"));
  assert.doesNotMatch(jobEnv, /CODE_HASH/);
  assert.doesNotMatch(bauen, /\$\{\{\s*inputs\.code_hash/, "code_hash nie über ${{ }} in den Lauf");
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.match(pkg.devDependencies?.wrangler || "", /^\d+\.\d+\.\d+$/, "wrangler mit fester Version");
});
