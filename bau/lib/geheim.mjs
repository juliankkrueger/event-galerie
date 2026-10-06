// Verschlüsselung zwischen Krüger OS und dem öffentlichen Repo. Vertrag: VERTRAG.md, Abschnitt „Verschlüsselung“.
//
// Format:  v1.<iv>.<ct>.<tag>   base64url ohne Padding, AES-256-GCM, IV 12 Byte, Tag 16 Byte,
//          AAD = UTF-8 der galerie_id. Schlüssel: 32 Byte, gespeichert als Standard-Base64.
//
// Fehlermeldungen enthalten nie Schlüssel, Klartext oder Geheimtext.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const VERSION = "v1";
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const SCHLUESSEL_BYTES = 32;

const B64_SCHLUESSEL = /^[A-Za-z0-9+/]{43}=$/;
const B64URL = /^[A-Za-z0-9_-]*$/;

export class GeheimFehler extends Error {
  constructor(meldung) {
    super(meldung);
    this.name = "GeheimFehler";
  }
}

/** Liest den Schlüssel (Standard-Base64, 32 Byte). Leerraum am Rand wird ignoriert. */
export function leseSchluessel(text) {
  if (Buffer.isBuffer(text) || text instanceof Uint8Array) {
    if (text.length !== SCHLUESSEL_BYTES) throw new GeheimFehler(`Schlüssel muss ${SCHLUESSEL_BYTES} Byte lang sein`);
    return Buffer.from(text);
  }
  const t = String(text ?? "").trim();
  if (!t) throw new GeheimFehler("Schlüssel fehlt");
  if (!B64_SCHLUESSEL.test(t)) throw new GeheimFehler(`Schlüssel muss ${SCHLUESSEL_BYTES} Byte als Standard-Base64 sein`);
  const k = Buffer.from(t, "base64");
  if (k.length !== SCHLUESSEL_BYTES || k.toString("base64") !== t) {
    throw new GeheimFehler(`Schlüssel muss ${SCHLUESSEL_BYTES} Byte als Standard-Base64 sein`);
  }
  return k;
}

function aad(galerie) {
  if (typeof galerie !== "string" || galerie.length === 0) throw new GeheimFehler("galerie_id (AAD) fehlt");
  return Buffer.from(galerie, "utf8");
}

function b64urlTeil(teil, was, laenge) {
  if (!B64URL.test(teil)) throw new GeheimFehler(`Format ungültig (${was})`);
  const b = Buffer.from(teil, "base64url");
  // Nur kanonische Kodierung ohne Padding, sonst gäbe es mehrere Schreibweisen desselben Werts.
  if (b.toString("base64url") !== teil) throw new GeheimFehler(`Format ungültig (${was})`);
  if (laenge !== undefined && b.length !== laenge) throw new GeheimFehler(`Format ungültig (${was})`);
  return b;
}

/** Verschlüsselt Text (UTF-8) oder Bytes. iv nur für Testvektoren vorgeben. */
export function verschluessele(klartext, schluessel, galerie, { iv } = {}) {
  const k = leseSchluessel(schluessel);
  const nonce = iv === undefined ? randomBytes(IV_BYTES) : Buffer.from(iv);
  if (nonce.length !== IV_BYTES) throw new GeheimFehler(`IV muss ${IV_BYTES} Byte lang sein`);
  const daten = typeof klartext === "string" ? Buffer.from(klartext, "utf8") : Buffer.from(klartext);
  const c = createCipheriv("aes-256-gcm", k, nonce, { authTagLength: TAG_BYTES });
  c.setAAD(aad(galerie));
  const ct = Buffer.concat([c.update(daten), c.final()]);
  const tag = c.getAuthTag();
  return [VERSION, nonce.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

/** Prüft nur die äußere Form (ohne Schlüssel). */
export function istFormat(text) {
  try {
    zerlege(text);
    return true;
  } catch {
    return false;
  }
}

function zerlege(text) {
  if (typeof text !== "string") throw new GeheimFehler("Format ungültig");
  const teile = text.trim().split(".");
  if (teile.length !== 4) throw new GeheimFehler("Format ungültig (erwartet v1.<iv>.<ct>.<tag>)");
  const [version, iv, ct, tag] = teile;
  if (version !== VERSION) throw new GeheimFehler("Format ungültig (Version)");
  return {
    iv: b64urlTeil(iv, "iv", IV_BYTES),
    ct: b64urlTeil(ct, "ct"),
    tag: b64urlTeil(tag, "tag", TAG_BYTES),
  };
}

/** Entschlüsselt zu Bytes. Scheitert bei falschem Schlüssel, falscher galerie_id oder verändertem Text. */
export function entschluessele(text, schluessel, galerie) {
  const k = leseSchluessel(schluessel);
  const { iv, ct, tag } = zerlege(text);
  const d = createDecipheriv("aes-256-gcm", k, iv, { authTagLength: TAG_BYTES });
  d.setAAD(aad(galerie));
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(ct), d.final()]);
  } catch {
    throw new GeheimFehler("Entschlüsselung fehlgeschlagen (falscher Schlüssel, falsche galerie_id oder verändert)");
  }
}

/** Entschlüsselt zu Text, nur gültiges UTF-8. */
export function entschluesseleText(text, schluessel, galerie) {
  const bytes = entschluessele(text, schluessel, galerie);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GeheimFehler("Klartext ist kein gültiges UTF-8");
  }
}
