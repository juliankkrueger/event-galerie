import { randomBytes } from "node:crypto";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export function base32(bytes) {
  let bits = 0;
  let wert = 0;
  let out = "";
  for (const b of bytes) {
    wert = (wert << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(wert >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(wert << (5 - bits)) & 31];
  return out;
}

// 128 Bit, base32 klein, 26 Zeichen.
export const neuerTok = () => base32(randomBytes(16));

// 16 Hex-Zeichen, eindeutig innerhalb eines Baus.
export function bildIdGeber() {
  const vergeben = new Set();
  return () => {
    for (;;) {
      const id = randomBytes(8).toString("hex");
      if (!vergeben.has(id)) {
        vergeben.add(id);
        return id;
      }
    }
  };
}

export const neuerCookieSchluessel = () => randomBytes(32).toString("base64");
