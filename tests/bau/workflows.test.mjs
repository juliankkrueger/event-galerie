// Öffentliches Repo: Die Workflows dürfen nichts Geheimes ins Log, in die Zusammenfassung oder in
// Artefakte geben und laufen nur auf workflow_dispatch durch den Inhaber. Vertrag: VERTRAG.md
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const lies = (n) => readFile(new URL(`../../.github/workflows/${n}`, import.meta.url), "utf8");
const schritt = (text, name) => {
  const a = text.indexOf(`- name: ${name}`);
  assert.ok(a >= 0, `Schritt ${name} fehlt`);
  const b = text.indexOf("\n      - ", a + 1);
  return text.slice(a, b < 0 ? undefined : b);
};

test("Workflows: nur workflow_dispatch, Prüfung auf main und Inhaber zuerst, Actions auf Commit-SHA", async () => {
  for (const n of ["bauen.yml", "offline.yml"]) {
    const text = await lies(n);
    const on = text.slice(text.indexOf("\non:"), text.indexOf("\npermissions:"));
    assert.match(on, /^\s+workflow_dispatch:/m, n);
    assert.doesNotMatch(on, /pull_request|push:|schedule:|workflow_run|issue_comment|repository_dispatch/, `${n}: nur workflow_dispatch`);
    assert.match(text, /^permissions: \{\}$/m, `${n}: keine Rechte auf Workflow-Ebene`);
    const ersterSchritt = text.slice(text.indexOf("steps:"));
    assert.match(ersterSchritt, /^steps:\n\s+- name: Auslöser prüfen/, `${n}: Auslöser zuerst prüfen`);
    const pruefung = schritt(text, "Auslöser prüfen");
    for (const t of ["github.event_name", "github.ref", "github.actor", "github.triggering_actor", "github.repository_owner", "refs/heads/main", "exit 1"]) {
      assert.ok(pruefung.includes(t), `${n}: Prüfung nutzt ${t}`);
    }
    for (const m of text.matchAll(/uses:\s*([^\s#]+)/g)) {
      assert.match(m[1], /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${n}: ${m[1]} auf Commit-SHA gepinnt`);
    }
  }
});

test("bauen.yml: code_hash nur verschlüsselt, Entschlüsseln vor jedem Werkzeug, Schlüssel nur in zwei Schritten", async () => {
  const text = await lies("bauen.yml");
  assert.match(text, /^\s+code_hash_enc:/m);
  assert.doesNotMatch(text, /^\s+code_hash:/m, "kein Klartext-Input mehr");
  assert.doesNotMatch(text, /\$\{\{\s*inputs\.(code_hash|ordner_id)/, "weder Code-Hash noch Ordner-ID über ${{ }}");
  const jobEnv = text.slice(text.indexOf("jobs:"), text.indexOf("steps:"));
  assert.doesNotMatch(jobEnv, /CODE_HASH|ORDNER_ID|GALERIE_SCHLUESSEL|secrets\./, "nichts davon im Job-env");
  assert.match(schritt(text, "Code-Hash entschlüsseln und maskieren"), /node bau\/geheim\.mjs eingabe/);
  const reihenfolge = ["Auslöser prüfen", "Eingaben prüfen", "Code-Hash entschlüsseln und maskieren", "Abhängigkeiten", "Bei Google anmelden", "Galerie bauen"];
  const pos = reihenfolge.map((n) => text.indexOf(`- name: ${n}`));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, "Reihenfolge der Schritte");
  const mitSchluessel = [...text.matchAll(/secrets\.GALERIE_SCHLUESSEL/g)].length;
  assert.equal(mitSchluessel, 2, "GALERIE_SCHLUESSEL nur beim Entschlüsseln und beim Bericht");
  assert.match(schritt(text, "Bericht verschlüsseln"), /GALERIE_SCHLUESSEL: \$\{\{ secrets\.GALERIE_SCHLUESSEL \}\}/);
  // Ordner-ID wird maskiert, bevor sie in die Umgebung geht.
  const eingaben = schritt(text, "Eingaben prüfen");
  assert.ok(eingaben.indexOf("::add-mask::$ordner") < eingaben.indexOf("ORDNER_ID=$ordner"));
});

test("bauen.yml: Artefakt nur bericht.enc, nie dist, Zusammenfassung ohne Namen, Pfade oder Adressen", async () => {
  const text = await lies("bauen.yml");
  const uploads = [...text.matchAll(/uses: actions\/upload-artifact@[0-9a-f]{40}[^\n]*\n\s+with:\n((?:\s{10}[^\n]*\n)+)/g)].map((m) => m[1]);
  assert.equal(uploads.length, 1, "genau ein Artefakt");
  assert.match(uploads[0], /name: bericht\n/);
  assert.match(uploads[0], /path: bericht\.enc\n/);
  assert.doesNotMatch(text, /path:\s*(dist|bericht\.json)/);
  assert.ok(text.indexOf("- name: Bericht verschlüsseln") < text.indexOf("- name: Bericht hochladen"));
  const zusammenfassung = schritt(text, "Zusammenfassung");
  for (const verboten of ["DOMAIN", "PAGES_PROJEKT", "ORDNER_ID", "TITEL", ".name", "uebersprungen[", "gpsFunde[", ".fehler", "deployment"]) {
    assert.ok(!zusammenfassung.includes(verboten), `Zusammenfassung ohne ${verboten}`);
  }
  // Die Hash-Adresse des Deployments steht nicht im Log.
  const deploy = schritt(text, "Deployen");
  assert.match(deploy, /> "\$protokoll" 2>&1/);
  assert.match(deploy, /sed -E "s#https:\/\/\[a-z0-9-\]\+/);
});

test("offline.yml: Zusammenfassung nur mit Status, Hash-Adresse geschwärzt, kein id-token", async () => {
  const text = await lies("offline.yml");
  assert.doesNotMatch(text, /id-token:/);
  const zusammenfassung = schritt(text, "Zusammenfassung");
  for (const verboten of ["DOMAIN", "PAGES_PROJEKT", "GRUND", "MARKE"]) assert.ok(!zusammenfassung.includes(verboten), `ohne ${verboten}`);
  assert.match(schritt(text, "Offline-Seite deployen"), /set -o pipefail[\s\S]*\| sed -E/);
});

const inputsVon = (text) => {
  const block = text.slice(text.indexOf("    inputs:\n"), text.indexOf("\npermissions:"));
  return [...block.matchAll(/^ {6}([a-z_]+):\n/gm)].map((m) => m[1]);
};

test("Inputs: höchstens 10 je Workflow, projekt optional mit festem Muster, ablauf optional", async () => {
  const bauen = await lies("bauen.yml");
  const offline = await lies("offline.yml");
  assert.deepEqual(inputsVon(bauen), ["galerie_id", "marke", "titel", "ordner_id", "ablauf", "code_hash_enc", "untertitel", "projekt"]);
  assert.deepEqual(inputsVon(offline), ["galerie_id", "marke", "projekt", "aktion"]);
  for (const [n, t] of [["bauen.yml", bauen], ["offline.yml", offline]]) {
    assert.ok(inputsVon(t).length <= 10, `${n}: GitHub erlaubt höchstens 10 Inputs`);
    const eingaben = schritt(t, "Eingaben prüfen");
    assert.ok(eingaben.includes("re_projekt='^fotos-[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'"), `${n}: Muster für projekt`);
    assert.match(t, /group: pages-\$\{\{ inputs\.projekt \|\| inputs\.marke \}\}/, `${n}: je Projekt nacheinander`);
    assert.match(schritt(t, "Marke lesen"), /if \[\[ -n "\$PROJEKT" \]\]; then\n\s+projekt="\$PROJEKT"/);
  }
  const projektInput = bauen.slice(bauen.indexOf("      projekt:"), bauen.indexOf("\n\n", bauen.indexOf("      projekt:")));
  assert.match(projektInput, /required: false/);
  assert.match(bauen.slice(bauen.indexOf("      ablauf:"), bauen.indexOf("      code_hash_enc:")), /required: false/);
  assert.match(schritt(bauen, "Eingaben prüfen"), /if \[\[ -n "\$ABLAUF" && "\$ABLAUF" != nie \]\]/);
  // Mit projekt keine Domain; der Domain-Schritt läuft nur mit Domain.
  assert.match(schritt(bauen, "Marke lesen"), /projekt="\$PROJEKT"\n\s+domain=""/);
  assert.match(schritt(bauen, "Domain anhängen, falls sie fehlt"), /if: env\.DOMAIN != ''/);
});

test("offline.yml loeschen: nur mit projekt, nie ein Markenprojekt, nur eigene Galerie, erst nach Offline-Seite", async () => {
  const t = await lies("offline.yml");
  assert.match(t, /type: choice\n\s+options:\n\s+- offline\n\s+- loeschen/);
  assert.match(t, /default: offline/);
  assert.match(schritt(t, "Eingaben prüfen"), /AKTION" == loeschen && -z "\$PROJEKT"/);
  assert.match(schritt(t, "Marke lesen"), /jq -r '\.pagesProjekt' marken\/\*\/marke\.json \| grep -qxF "\$projekt"/);
  assert.match(schritt(t, "Zuordnung prüfen"), /loeschen-pruefen/);
  const loeschen = schritt(t, "Projekt löschen");
  assert.match(loeschen, /if: steps\.projekt\.outputs\.loeschen == 'ja'/);
  assert.match(loeschen, /projekt-loeschen --projekt "\$PAGES_PROJEKT"/);
  const pos = ["Zuordnung prüfen", "Offline-Seite deployen", "Ältere Deployments löschen", "Projekt löschen"].map((n) => t.indexOf(`- name: ${n}`));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, "Reihenfolge");
  assert.match(t, /^run-name: \$\{\{ inputs\.aktion \|\| 'offline' \}\} \$\{\{ inputs\.galerie_id \}\}$/m);
});
