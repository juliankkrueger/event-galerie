#!/usr/bin/env node
// Ver- und Entschlüsseln für die Workflows (und zum Nachprüfen am eigenen Rechner).
// Der Schlüssel kommt nur aus der Umgebung (GALERIE_SCHLUESSEL), nie aus Argumenten.
// Ausgegeben wird nie ein Schlüssel und nie ein entschlüsselter Code-Hash. Vertrag: VERTRAG.md
//
// node bau/geheim.mjs eingabe [--ereignis <event.json>] [--aus <datei>]
//     Workflow bauen.yml: liest inputs.code_hash_enc und inputs.galerie_id aus dem Ereignis
//     ($GITHUB_EVENT_PATH), entschlüsselt, prüft das pbkdf2-Format, maskiert den Klartext
//     (::add-mask::) und schreibt ihn mit Rechten 600 nach --aus ($RUNNER_TEMP/code-hash).
// node bau/geheim.mjs bericht --galerie <id> --ein bericht.json --aus bericht.enc
//     Verschlüsselt den Bericht (AAD = galerie_id).
// node bau/geheim.mjs verschluesseln --galerie <id>  < klartext  > geheimtext
// node bau/geheim.mjs entschluesseln --galerie <id>  < geheimtext > klartext

import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { zerlegeCodeHash } from "../functions/_lib/kennwort.js";
import { GeheimFehler, entschluesseleText, verschluessele } from "./lib/geheim.mjs";

export const GALERIE_MUSTER = /^[A-Za-z0-9_-]{1,64}$/;
// Gleiches Muster wie bisher im Workflow: eine Zeile, nur Base64-Zeichen.
export const CODE_HASH_MUSTER = /^pbkdf2\$sha256\$[0-9]{1,6}\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$/;

class Abbruch extends Error {}

function schluessel(env) {
  const s = env.GALERIE_SCHLUESSEL;
  if (!s) throw new Abbruch("GALERIE_SCHLUESSEL fehlt in der Umgebung");
  return s;
}

async function stdinLesen() {
  const teile = [];
  for await (const t of process.stdin) teile.push(t);
  return Buffer.concat(teile).toString("utf8");
}

/** Schritt 1 in bauen.yml. Gibt nur die Maske aus, sonst nichts vom Wert. */
export async function eingabe({ ereignis, aus, env = process.env, schreibe = (t) => process.stdout.write(t) }) {
  if (!ereignis) throw new Abbruch("Ereignisdatei fehlt (GITHUB_EVENT_PATH)");
  if (!aus) throw new Abbruch("Zieldatei fehlt (RUNNER_TEMP)");
  let ev;
  try {
    ev = JSON.parse(await readFile(ereignis, "utf8"));
  } catch {
    throw new Abbruch("Ereignisdatei nicht lesbar");
  }
  const galerie = ev?.inputs?.galerie_id;
  const enc = ev?.inputs?.code_hash_enc;
  if (typeof galerie !== "string" || !GALERIE_MUSTER.test(galerie)) throw new Abbruch("galerie_id ungültig");
  if (typeof enc !== "string" || !enc) throw new Abbruch("code_hash_enc fehlt");
  const klar = entschluesseleText(enc, schluessel(env), galerie);
  // Erst prüfen (gibt nichts aus), dann maskieren: ein mehrzeiliger Wert würde sonst nur in
  // der ersten Zeile maskiert.
  if (!CODE_HASH_MUSTER.test(klar) || !zerlegeCodeHash(klar)) throw new Abbruch("code_hash ungültig (entschlüsselt, aber kein pbkdf2-Hash)");
  schreibe(`::add-mask::${klar}\n`);
  await rm(aus, { force: true });
  await writeFile(aus, klar, { mode: 0o600, flag: "wx" });
}

export async function bericht({ galerie, ein, aus, env = process.env }) {
  if (!GALERIE_MUSTER.test(galerie || "")) throw new Abbruch("--galerie ungültig");
  if (!ein || !aus) throw new Abbruch("--ein und --aus nötig");
  const text = await readFile(ein, "utf8");
  await writeFile(aus, `${verschluessele(text, schluessel(env), galerie)}\n`, { mode: 0o644 });
}

async function haupt(argv) {
  const [befehl, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      ereignis: { type: "string" },
      aus: { type: "string" },
      ein: { type: "string" },
      galerie: { type: "string" },
    },
    strict: true,
  });
  if (befehl === "eingabe") {
    const ereignis = values.ereignis || process.env.GITHUB_EVENT_PATH;
    const aus = values.aus || (process.env.RUNNER_TEMP ? join(process.env.RUNNER_TEMP, "code-hash") : "");
    await eingabe({ ereignis, aus });
    return 0;
  }
  if (befehl === "bericht") {
    await bericht({ galerie: values.galerie, ein: values.ein, aus: values.aus });
    return 0;
  }
  if (befehl === "verschluesseln" || befehl === "entschluesseln") {
    if (!GALERIE_MUSTER.test(values.galerie || "")) throw new Abbruch("--galerie ungültig");
    const ein = await stdinLesen();
    const k = schluessel(process.env);
    const aus = befehl === "verschluesseln" ? verschluessele(ein, k, values.galerie) : entschluesseleText(ein.trim(), k, values.galerie);
    process.stdout.write(befehl === "verschluesseln" ? `${aus}\n` : aus);
    return 0;
  }
  console.error("Befehl: eingabe | bericht | verschluesseln | entschluesseln");
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await haupt(process.argv.slice(2));
  } catch (e) {
    // Nur eigene, geprüfte Meldungen. Alles andere ohne Text, damit nichts Geheimes ins Log rutscht.
    const eigene = e instanceof Abbruch || e instanceof GeheimFehler || e?.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION";
    console.error(`::error::${eigene ? e.message : "geheim.mjs abgebrochen"}`);
    process.exitCode = 1;
  }
}
