// Feste Ausgabedateien des Deployments und Dateihilfen.

import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Exakt wie im Vertrag (VERTRAG.md, Abschnitt _headers).
// /b/*: private, damit kein gemeinsamer Zwischenspeicher die Fotos hält. Den Edge-Cache von Pages
// selbst steuert kein Header (gemessen 05.10.2026: auch mit private und no-store HIT nach dem
// Ersetzen). Dagegen hilft der Zufallswert je Seitenansicht in der Oberfläche (werkzeuge.js,
// mitSitzung): der Cache-Schlüssel enthält die Query.
export const HEADERS = `/*
  X-Robots-Tag: noindex, nofollow
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
/b/*
  Cache-Control: private, max-age=31536000, immutable
/status.json
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=3600
`;

export const ROUTES = { version: 1, include: ["/api/*"], exclude: [] };

export function datenModul({ manifest, codeHash, cookieSchluessel, ablauf, galerie }) {
  const j = (w) => JSON.stringify(w);
  return [
    "// Vom Bau erzeugt (bau/bau.mjs). Nicht bearbeiten, nicht einchecken.",
    `export const galerie = ${j(galerie)};`,
    `export const ablauf = ${j(ablauf ?? null)};`,
    `export const codeHash = ${j(codeHash)};`,
    `export const cookieSchluessel = ${j(cookieSchluessel)};`,
    `export const manifest = ${j(manifest)};`,
    "",
  ].join("\n");
}

// Statischer Status für den Startbildschirm. Spart je Besuch einen Function-Aufruf
// (kontoweites Kontingent). "abgelaufen" rechnet die Seite aus "ablauf"; im Zweifel
// fragt sie /api/status, die Function bleibt die verbindliche Prüfung. Ohne Ablauf fehlt
// der Schlüssel "ablauf" (die Galerie läuft nie ab).
export function statusInhalt({ titel, marke, ablauf }) {
  return `${JSON.stringify(ablauf ? { titel, marke, ablauf } : { titel, marke })}\n`;
}

export async function schreibeFesteDateien(ziel) {
  await writeFile(join(ziel, "_headers"), HEADERS);
  await writeFile(join(ziel, "_routes.json"), `${JSON.stringify(ROUTES)}\n`);
}

const IGNORIEREN = new Set([".DS_Store", "Thumbs.db", ".git"]);

export async function kopiereVerzeichnis(von, nach, { auslassen = () => false } = {}) {
  await mkdir(nach, { recursive: true });
  for (const e of await readdir(von, { withFileTypes: true })) {
    if (IGNORIEREN.has(e.name) || auslassen(e.name)) continue;
    const a = join(von, e.name);
    const b = join(nach, e.name);
    if (e.isDirectory()) await kopiereVerzeichnis(a, b, { auslassen });
    else if (e.isFile()) await copyFile(a, b);
  }
}

export async function groesseVerzeichnis(pfad) {
  let summe = 0;
  let dateien = 0;
  for (const e of await readdir(pfad, { withFileTypes: true })) {
    const p = join(pfad, e.name);
    if (e.isDirectory()) {
      const u = await groesseVerzeichnis(p);
      summe += u.bytes;
      dateien += u.dateien;
    } else if (e.isFile()) {
      summe += (await stat(p)).size;
      dateien++;
    }
  }
  return { bytes: summe, dateien };
}
