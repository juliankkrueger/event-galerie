// Code-Hash und Prüfung, gemeinsam für Function (Workers) und Baukette (Node 20).
// Nur WebCrypto, keine Abhängigkeiten.

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LAENGE = 8;
export const PBKDF2_ITER = 100000;
// Cloudflare Workers erlauben höchstens 100000 Iterationen.
const ITER_MAX = 100000;
const HASH_BYTES = 32;
// Vertrag (VERTRAG.md, Function): Salz und Hash je 32 Byte, wie im OS
// (backend/src/utils/eventGalerie.js, PBKDF2_BYTES). Die Prüfung nimmt weiter
// jedes Salz ab 8 Byte, damit von Hand gebaute Galerien mit älterem 16-Byte-Salz
// nicht ausgesperrt werden.
export const SALZ_BYTES = 32;

const HASH_MUSTER = /^pbkdf2\$sha256\$(\d{1,6})\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

export function normalisiereCode(eingabe) {
  if (typeof eingabe !== "string") return "";
  return eingabe.trim().toUpperCase();
}

export function bytesZuBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function base64ZuBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function bytesZuBase64Url(bytes) {
  return bytesZuBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Vergleich in konstanter Zeit (bezogen auf den Inhalt; Länge ist öffentlich).
export function gleichKonstant(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(code, salz, iter, laenge) {
  const schluessel = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salz, iterations: iter },
    schluessel,
    laenge * 8,
  );
  return new Uint8Array(bits);
}

export function zerlegeCodeHash(codeHash) {
  const m = typeof codeHash === "string" ? HASH_MUSTER.exec(codeHash) : null;
  if (!m) return null;
  const iter = Number(m[1]);
  if (!Number.isInteger(iter) || iter < 1 || iter > ITER_MAX) return null;
  let salz, hash;
  try {
    salz = base64ZuBytes(m[2]);
    hash = base64ZuBytes(m[3]);
  } catch {
    return null;
  }
  if (salz.length < 8 || hash.length < 16) return null;
  return { iter, salz, hash };
}

export async function erzeugeCodeHash(code, { iter = PBKDF2_ITER, salz } = {}) {
  const c = normalisiereCode(code);
  if (!c) throw new Error("Leerer Code");
  const s = salz ?? crypto.getRandomValues(new Uint8Array(SALZ_BYTES));
  const h = await pbkdf2(c, s, iter, HASH_BYTES);
  return `pbkdf2$sha256$${iter}$${bytesZuBase64(s)}$${bytesZuBase64(h)}`;
}

// Prüft eine Eingabe gegen den gespeicherten Hash. Ungültiges Hash-Format ergibt false.
export async function pruefeCode(eingabe, codeHash) {
  const teile = zerlegeCodeHash(codeHash);
  if (!teile) return false;
  const c = normalisiereCode(eingabe);
  if (!c || c.length > 64) return false;
  const h = await pbkdf2(c, teile.salz, teile.iter, teile.hash.length);
  return gleichKonstant(h, teile.hash);
}

const webZufall = (n) => crypto.getRandomValues(new Uint8Array(n));

// zufall(n) liefert n Zufallsbytes (in Node: crypto.randomBytes).
export function zufallsCode(laenge = CODE_LAENGE, zufall = webZufall) {
  // Gleichverteilt per Verwerfen (256 ist kein Vielfaches von 31).
  const n = CODE_ALPHABET.length;
  const grenze = 256 - (256 % n);
  let out = "";
  while (out.length < laenge) {
    const puffer = zufall(laenge * 2);
    for (const b of puffer) {
      if (b < grenze && out.length < laenge) out += CODE_ALPHABET[b % n];
    }
  }
  return out;
}
