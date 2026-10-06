// Nachgebaute gh, gcloud und security für die Werkzeug-Tests, dazu ein Server, der Drive,
// Google-Tokeninfo und die Live-Galerie (<basis>/p/<projekt>/...) spielt. Kein echter Lauf.
// gh und der Server teilen sich den Zustand über eine JSON-Datei.

import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pruefeCode } from "../../functions/_lib/kennwort.js";

export const TEST_SCHLUESSEL = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
export const TEST_TOKEN = "test-zugriffstoken-nie-ausgeben-0123456789";
export const ABLAGE = "0ATestAblage1234567";
const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

export async function leseZustand(datei) {
  return JSON.parse(await readFile(datei, "utf8"));
}
export async function schreibeZustand(datei, z) {
  await writeFile(datei, JSON.stringify(z, null, 1));
}

/** Legt bin/gh, bin/gcloud, bin/security an. */
export async function legeProgrammeAn(dir, zustandDatei) {
  await mkdir(dir, { recursive: true });
  const kopf = `#!/usr/bin/env node
const ZUSTAND = ${JSON.stringify(zustandDatei)};
const fs = require("node:fs");
const lies = () => JSON.parse(fs.readFileSync(ZUSTAND, "utf8"));
const schreib = (z) => fs.writeFileSync(ZUSTAND, JSON.stringify(z, null, 1));
const args = process.argv.slice(2);
const z0 = lies(); z0.aufrufe.push([require("node:path").basename(process.argv[1]), ...args.filter((a) => !a.startsWith("Accept"))]); schreib(z0);
`;
  await writeFile(
    join(dir, "gcloud"),
    `${kopf}if (args.join(" ") === "auth print-access-token") { process.stdout.write(${JSON.stringify(TEST_TOKEN)} + "\\n"); } else process.exit(1);\n`,
  );
  await writeFile(
    join(dir, "security"),
    `${kopf}const z = lies(); if (!z.schluesselDa || args[0] !== "find-generic-password") process.exit(44);
if (args.includes("-w")) process.stdout.write(${JSON.stringify(TEST_SCHLUESSEL)} + "\\n"); else process.stdout.write("keychain: metadaten\\n");\n`,
  );
  await writeFile(join(dir, "gh"), `${kopf}import(${JSON.stringify(join(WURZEL, "tests", "werkzeug", "gh-attrappe.mjs"))}).then((m) => m.gh(args, ZUSTAND));\n`);
  for (const n of ["gh", "gcloud", "security"]) await chmod(join(dir, n), 0o755);
}

export function neuerZustand(extra = {}) {
  return {
    aufrufe: [],
    schluesselDa: true,
    ghAngemeldet: true,
    ergebnis: "success",
    naechsteLaufId: 1000,
    laeufe: {},
    dispatches: [],
    projekte: {},
    drive: {
      // Quelle außerhalb der Ablage: zwei Bilder oben, ein Unterordner mit einem Bild
      dateien: {
        QuelleOrdner12345: { id: "QuelleOrdner12345", name: "Event Fotos", mimeType: "application/vnd.google-apps.folder", driveId: null, eltern: null },
        BildA12345678901: { id: "BildA12345678901", name: "a.jpg", mimeType: "image/jpeg", size: "100", eltern: "QuelleOrdner12345" },
        BildB12345678901: { id: "BildB12345678901", name: "b.png", mimeType: "image/png", size: "200", eltern: "QuelleOrdner12345" },
        NotizN1234567890: { id: "NotizN1234567890", name: "liesmich.txt", mimeType: "text/plain", size: "5", eltern: "QuelleOrdner12345" },
        UnterU1234567890: { id: "UnterU1234567890", name: "Abend", mimeType: "application/vnd.google-apps.folder", eltern: "QuelleOrdner12345" },
        BildC12345678901: { id: "BildC12345678901", name: "c.heic", mimeType: "image/heic", size: "300", eltern: "UnterU1234567890" },
        AblageOrdner1234: { id: "AblageOrdner1234", name: "Schon da", mimeType: "application/vnd.google-apps.folder", driveId: ABLAGE, eltern: ABLAGE },
        BildD12345678901: { id: "BildD12345678901", name: "d.jpg", mimeType: "image/jpeg", size: "400", eltern: "AblageOrdner1234", driveId: ABLAGE },
      },
      kopien: 0,
      zaehler: 0,
    },
    ...extra,
  };
}

/** Bilder einer Testgalerie: Originale, Manifest. */
export function testBilder(n = 4) {
  const bilder = [];
  for (let i = 0; i < n; i++) {
    const inhalt = randomBytes(1000 + i * 10);
    const id = randomBytes(8).toString("hex");
    bilder.push({
      inhalt,
      eintrag: {
        id,
        name: `foto-${i}.jpg`,
        w: 100,
        hoehe: 80,
        r: `/b/tok/r/${id}.jpg`,
        g: `/b/tok/g/${id}.jpg`,
        h: { pfad: `/b/tok/h/${id}.jpg`, bytes: 10 },
        o: { teile: [`/b/tok/o/${id}.1`], bytes: inhalt.length, md5: createHash("md5").update(inhalt).digest("hex"), typ: "image/jpeg" },
      },
    });
  }
  return bilder;
}

/** Server für Drive (/drive), Tokeninfo (/tokeninfo) und Galerien (/p/<projekt>). */
export async function starteServer(zustandDatei, bilder) {
  const json = (res, status, k) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(k));
  };
  const koerper = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
  // Anfragen nacheinander, damit Lesen und Schreiben des Zustands nicht durcheinander geraten.
  let kette = Promise.resolve();
  const server = createServer((req, res) => {
    kette = kette.then(() => bearbeite(req, res)).catch(() => {});
  });
  async function bearbeite(req, res) {
    const u = new URL(req.url, "http://x");
    const z = await leseZustand(zustandDatei);
    try {
      if (u.pathname === "/tokeninfo") {
        const b = new URLSearchParams(await koerper(req));
        if (b.get("access_token") !== TEST_TOKEN) return json(res, 400, { error: "invalid_token" });
        return json(res, 200, { scope: z.scope ?? "openid https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/cloud-platform" });
      }
      if (u.pathname.startsWith("/drive/")) {
        if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) return json(res, 401, {});
        const d = z.drive;
        const pfad = u.pathname.slice("/drive".length);
        if (pfad === "/drives") return json(res, 200, { drives: [{ id: ABLAGE, name: "Event-Galerie" }, { id: "0AAndere", name: "Buchhaltung" }] });
        const kopie = /^\/files\/([^/]+)\/copy$/.exec(pfad);
        if (kopie && req.method === "POST") {
          const b = JSON.parse(await koerper(req));
          const q = d.dateien[kopie[1]];
          const id = `Kopie${String(++d.zaehler).padStart(12, "0")}`;
          d.dateien[id] = { ...q, id, name: b.name, eltern: b.parents[0], driveId: ABLAGE };
          d.kopien++;
          await schreibeZustand(zustandDatei, z);
          return json(res, 200, { id });
        }
        if (pfad === "/files" && req.method === "POST") {
          const b = JSON.parse(await koerper(req));
          const id = `Ordner${String(++d.zaehler).padStart(12, "0")}`;
          d.dateien[id] = { id, name: b.name, mimeType: b.mimeType, eltern: b.parents[0], driveId: ABLAGE };
          await schreibeZustand(zustandDatei, z);
          return json(res, 200, { id });
        }
        if (pfad === "/files") {
          const eltern = /'([^']+)' in parents/.exec(u.searchParams.get("q"))[1];
          return json(res, 200, { files: Object.values(d.dateien).filter((f) => f.eltern === eltern).map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })) });
        }
        const info = /^\/files\/([^/]+)$/.exec(pfad);
        if (info) {
          const f = d.dateien[info[1]];
          if (!f) return json(res, 404, {});
          return json(res, 200, { id: f.id, name: f.name, mimeType: f.mimeType, driveId: f.driveId || undefined, trashed: false });
        }
        return json(res, 400, {});
      }
      const p = /^\/p\/([a-z0-9-]+)(\/.*)$/.exec(u.pathname);
      if (p) {
        const g = z.projekte[p[1]];
        const pfad = p[2];
        if (!g || g.geloescht) return json(res, 530, { fehler: "kein Projekt" });
        if (g.offline) {
          res.writeHead(404, { "Content-Type": "text/html" });
          return res.end("<!doctype html>offline");
        }
        if (pfad === "/status.json") return json(res, 200, { titel: g.titel, marke: g.marke });
        if (pfad === "/api/status") return json(res, 200, { titel: g.titel, marke: g.marke, abgelaufen: false });
        if (pfad === "/api/zugang") {
          const { code } = JSON.parse(await koerper(req));
          if (await pruefeCode(code, g.codeHash)) {
            res.writeHead(204, { "Set-Cookie": "eg=123.sig; Path=/; HttpOnly" });
            return res.end();
          }
          return json(res, 401, { fehler: "code" });
        }
        if (pfad === "/api/manifest") {
          if (!/eg=123\.sig/.test(req.headers.cookie || "")) return json(res, 401, {});
          const b = bilder.map((x) => x.eintrag);
          return json(res, 200, { galerie: g.galerie, titel: g.titel, anzahl: z.manifestAnzahl ?? b.length, kapitel: [{ titel: "Alle Fotos", bilder: b }] });
        }
        const bild = bilder.find((x) => x.eintrag.o.teile[0] === pfad);
        if (bild && u.searchParams.get("s")) {
          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          return res.end(z.originalKaputt ? Buffer.from("anders") : bild.inhalt);
        }
        return json(res, 404, {});
      }
      json(res, 404, {});
    } catch (e) {
      json(res, 500, { fehler: e.message });
    }
  }
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, basis: `http://127.0.0.1:${server.address().port}` };
}
