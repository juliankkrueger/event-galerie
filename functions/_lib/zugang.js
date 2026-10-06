// Handler für /api/* der Event-Galerie (Cloudflare Pages Functions).
// Wird von functions/api/[[pfad]].js mit den Baudaten aus functions/_daten.js erzeugt.

import {
  base64ZuBytes,
  bytesZuBase64Url,
  gleichKonstant,
  normalisiereCode,
  pruefeCode,
} from "./kennwort.js";

export const COOKIE_NAME = "eg";
export const COOKIE_MAX_AGE = 2592000; // 30 Tage
export const BREMSE_FENSTER_MS = 10 * 60 * 1000;
export const BREMSE_MAX_FEHLER = 5;
const BREMSE_MAX_EINTRAEGE = 10000;
const FEHLER_VERZOEGERUNG_MS = 1000;
const BODY_MAX_BYTES = 1024;

const GRUND_HEADER = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function antwort(status, koerper, extra = {}) {
  const headers = new Headers(GRUND_HEADER);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  if (koerper === null) return new Response(null, { status, headers });
  headers.set("Content-Type", "application/json; charset=utf-8");
  const text = typeof koerper === "string" ? koerper : JSON.stringify(koerper);
  return new Response(text, { status, headers });
}

function leseCookie(request, name) {
  const kopf = request.headers.get("Cookie");
  if (!kopf) return null;
  for (const teil of kopf.split(";")) {
    const i = teil.indexOf("=");
    if (i < 0) continue;
    if (teil.slice(0, i).trim() === name) return teil.slice(i + 1).trim();
  }
  return null;
}

// Fehlversuche je IP im Speicher des Isolates (nicht global, bewusst einfach).
// Jeder Versuch wird VOR der Codeprüfung belegt (synchron, ohne await dazwischen) und erst
// bei richtigem Code wieder freigegeben. So kommen auch parallele Anfragen nicht an der
// Grenze vorbei: höchstens maxFehler Prüfungen je IP und Fenster, gleichzeitig oder nicht.
export function erzeugeBremse({ fensterMs = BREMSE_FENSTER_MS, maxFehler = BREMSE_MAX_FEHLER } = {}) {
  const eintraege = new Map(); // ip -> [{ t }]
  function aktuelle(ip, jetzt) {
    const liste = (eintraege.get(ip) || []).filter((e) => jetzt - e.t < fensterMs);
    if (liste.length) eintraege.set(ip, liste);
    else eintraege.delete(ip);
    return liste;
  }
  function sperre(liste, jetzt) {
    if (liste.length < maxFehler) return 0;
    const frei = liste[liste.length - maxFehler].t + fensterMs;
    return Math.max(1, Math.ceil((frei - jetzt) / 1000));
  }
  return {
    // Sekunden bis zum nächsten erlaubten Versuch, 0 = frei. Nur lesend.
    gesperrtFuer(ip, jetzt) {
      return sperre(aktuelle(ip, jetzt), jetzt);
    },
    // Prüft und belegt in einem Schritt. Ergebnis { sperre } oder { eintrag } (für freigeben).
    belegen(ip, jetzt) {
      const liste = aktuelle(ip, jetzt);
      const s = sperre(liste, jetzt);
      if (s > 0) return { sperre: s };
      const eintrag = { t: jetzt };
      liste.push(eintrag);
      eintraege.delete(ip);
      eintraege.set(ip, liste);
      // Älteste Einträge verwerfen, damit der Speicher begrenzt bleibt.
      while (eintraege.size > BREMSE_MAX_EINTRAEGE) {
        eintraege.delete(eintraege.keys().next().value);
      }
      return { sperre: 0, eintrag };
    },
    // Richtiger Code: der belegte Versuch zählt nicht als Fehler.
    freigeben(ip, eintrag) {
      const liste = eintraege.get(ip);
      if (!liste) return;
      const i = liste.indexOf(eintrag);
      if (i >= 0) liste.splice(i, 1);
      if (!liste.length) eintraege.delete(ip);
    },
    groesse: () => eintraege.size,
  };
}

const standardWarte = (ms) => new Promise((r) => setTimeout(r, ms));

export function erzeugeHandler(daten, optionen = {}) {
  const jetzt = optionen.jetzt || (() => Date.now());
  const warte = optionen.warte || standardWarte;
  const bremse = optionen.bremse || erzeugeBremse();

  const ablaufMs = Date.parse(daten.ablauf);
  const manifestText = JSON.stringify(daten.manifest);
  const titel = daten.manifest && daten.manifest.titel;
  const marke = daten.manifest && daten.manifest.marke;
  let hmacSchluessel = null;
  // SHA-256 eines bereits als richtig geprüften Codes; spart PBKDF2-Rechenzeit.
  let bekannterCode = null;

  const abgelaufen = () => !(jetzt() < ablaufMs);

  function schluessel() {
    if (!hmacSchluessel) {
      hmacSchluessel = crypto.subtle.importKey(
        "raw",
        base64ZuBytes(daten.cookieSchluessel),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
    }
    return hmacSchluessel;
  }

  async function signatur(exp) {
    const nachricht = new TextEncoder().encode(`${daten.galerie}.${exp}`);
    const sig = await crypto.subtle.sign("HMAC", await schluessel(), nachricht);
    return new Uint8Array(sig);
  }

  async function cookieGueltig(request) {
    const wert = leseCookie(request, COOKIE_NAME);
    if (!wert) return false;
    const m = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(wert);
    if (!m) return false;
    const exp = Number(m[1]);
    if (!(exp * 1000 > jetzt())) return false;
    const erwartet = new TextEncoder().encode(bytesZuBase64Url(await signatur(exp)));
    return gleichKonstant(erwartet, new TextEncoder().encode(m[2]));
  }

  async function codeRichtig(code) {
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)),
    );
    if (bekannterCode && gleichKonstant(digest, bekannterCode)) return true;
    const ok = await pruefeCode(code, daten.codeHash);
    if (ok) bekannterCode = digest;
    return ok;
  }

  async function leseCode(request) {
    const laenge = Number(request.headers.get("Content-Length") || "0");
    if (laenge > BODY_MAX_BYTES) return null;
    let text;
    try {
      text = await request.text();
    } catch {
      return null;
    }
    if (text.length > BODY_MAX_BYTES) return null;
    try {
      const json = JSON.parse(text);
      return json && typeof json.code === "string" ? normalisiereCode(json.code) : null;
    } catch {
      return null;
    }
  }

  async function zugang(request) {
    if (abgelaufen()) return antwort(410, { abgelaufen: true });
    const herkunft = request.headers.get("Origin");
    if (herkunft && herkunft !== new URL(request.url).origin) {
      return antwort(403, { fehler: "herkunft" });
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unbekannt";
    // Zwischen Prüfen und Belegen darf kein await liegen (sonst kommen parallele Anfragen durch).
    const versuch = bremse.belegen(ip, jetzt());
    if (versuch.sperre > 0) {
      return antwort(429, { fehler: "gebremst", wiederInSek: versuch.sperre }, { "Retry-After": String(versuch.sperre) });
    }
    const code = await leseCode(request);
    const ok = code && /^[A-Z0-9]{1,64}$/.test(code) ? await codeRichtig(code) : false;
    if (!ok) {
      await warte(FEHLER_VERZOEGERUNG_MS);
      return antwort(401, { fehler: "code" });
    }
    bremse.freigeben(ip, versuch.eintrag);
    const exp = Math.floor(jetzt() / 1000) + COOKIE_MAX_AGE;
    const wert = `${exp}.${bytesZuBase64Url(await signatur(exp))}`;
    return antwort(204, null, {
      "Set-Cookie": `${COOKIE_NAME}=${wert}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`,
    });
  }

  return async function onRequest(context) {
    const request = context.request;
    const pfad = new URL(request.url).pathname.replace(/\/+$/, "");
    const methode = request.method.toUpperCase();
    try {
      if (pfad === "/api/status") {
        if (methode !== "GET" && methode !== "HEAD") return antwort(405, { fehler: "methode" }, { Allow: "GET, HEAD" });
        return antwort(200, { titel, marke, abgelaufen: abgelaufen() });
      }
      if (pfad === "/api/zugang") {
        if (methode !== "POST") return antwort(405, { fehler: "methode" }, { Allow: "POST" });
        return await zugang(request);
      }
      if (pfad === "/api/manifest") {
        if (methode !== "GET" && methode !== "HEAD") return antwort(405, { fehler: "methode" }, { Allow: "GET, HEAD" });
        if (abgelaufen()) return antwort(410, { abgelaufen: true });
        if (!(await cookieGueltig(request))) return antwort(401, { fehler: "zugang" });
        return antwort(200, manifestText);
      }
      return antwort(404, { fehler: "unbekannt" });
    } catch {
      return antwort(500, { fehler: "intern" });
    }
  };
}
