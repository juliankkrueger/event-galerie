import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { erzeugeDrive } from "../../bau/lib/quelle-drive.mjs";
import { Md5Fehler } from "../../bau/lib/teilen.mjs";
import { neuerOrdner } from "./hilfen.mjs";

const TOKEN = "geheim-test-token";
const md5 = (b) => createHash("md5").update(b).digest("hex");
const ORDNER = "application/vnd.google-apps.folder";
const ROOT = "ROOT_ORDNER_0123";

function json(status, koerper, kopf = {}) {
  return new Response(JSON.stringify(koerper), { status, headers: { "Content-Type": "application/json", ...kopf } });
}

// Nachgebaute Drive API. baum: parentId -> Liste von Dateien; inhalte: id -> Buffer.
function falscheDrive({ baum, inhalte, stoerungen = {} }) {
  const aufrufe = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    aufrufe.push(u.pathname + u.search);
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    if (u.pathname === "/drive/v3/files") {
      assert.equal(u.searchParams.get("supportsAllDrives"), "true");
      assert.equal(u.searchParams.get("includeItemsFromAllDrives"), "true");
      assert.equal(u.searchParams.get("corpora"), "allDrives");
      const m = /^'([^']+)' in parents and trashed=false$/.exec(u.searchParams.get("q"));
      assert.ok(m, "q mit trashed=false");
      const alle = baum[m[1]] || [];
      // Seiten zu je 2 Einträgen, um die Paginierung zu prüfen.
      const start = Number(u.searchParams.get("pageToken") || 0);
      const seite = alle.slice(start, start + 2);
      return json(200, { files: seite, ...(start + 2 < alle.length ? { nextPageToken: String(start + 2) } : {}) });
    }
    const id = u.pathname.split("/").pop();
    if (u.searchParams.get("alt") === "media") {
      const liste = stoerungen[id];
      if (liste && liste.length) {
        const s = liste.shift();
        if (s === "netz") throw new TypeError("fetch failed");
        if (s === "quota") return json(403, { error: { message: "quota", errors: [{ reason: "downloadQuotaExceeded" }] } });
        if (s === "verboten") return json(403, { error: { message: "keine Rechte", errors: [{ reason: "forbidden" }] } });
        if (s === "falsch") return new Response(Buffer.from("anderer Inhalt"));
        return json(s, { error: { message: `Status ${s}` } }, s === 429 ? { "Retry-After": "2" } : {});
      }
      if (!inhalte[id]) return json(404, { error: { message: "File not found" } });
      return new Response(inhalte[id]);
    }
    if (id === ROOT) return json(200, { id, name: "Event", mimeType: ORDNER, trashed: false });
    return json(404, { error: { message: "File not found" } });
  };
  return { fetchImpl, aufrufe };
}

const datei = (id, name, inhalt, extra = {}) => ({
  id,
  name,
  mimeType: "image/jpeg",
  size: String(inhalt.length),
  md5Checksum: md5(inhalt),
  ...extra,
});

test("Drive-Liste: rekursiv, alle Seiten, Typfilter, Verknüpfungen, GPS aus imageMediaMetadata", async () => {
  const a = Buffer.from("a");
  const baum = {
    [ROOT]: [
      datei("f1", "1.jpg", a),
      { id: "dirTag", name: "Tag", mimeType: ORDNER },
      { id: "v1", name: "video.mp4", mimeType: "video/mp4", size: "9" },
      { id: "s1", name: "link", mimeType: "application/vnd.google-apps.shortcut" },
      datei("f2", "2.heic", Buffer.from("b"), { mimeType: "image/heif" }),
    ],
    dirTag: [
      datei("f3", "3.jpg", Buffer.from("c"), {
        imageMediaMetadata: { time: "2026:10:01 10:00:00", location: { latitude: 48.1, longitude: 11.5 } },
      }),
      { id: "dirAbend", name: "Abend", mimeType: ORDNER },
    ],
    dirAbend: [datei("f4", "4.png", Buffer.from("d"), { mimeType: "image/png" })],
  };
  const { fetchImpl, aufrufe } = falscheDrive({ baum, inhalte: {} });
  const drive = erzeugeDrive({ token: async () => TOKEN, fetchImpl, warte: async () => {} });
  const { eintraege, uebersprungen } = await drive.listeBaum(ROOT);
  assert.deepEqual(
    eintraege.map((e) => [e.pfad.join("/"), e.name, e.mime]),
    [
      ["", "1.jpg", "image/jpeg"],
      ["", "2.heic", "image/heic"],
      ["Tag", "3.jpg", "image/jpeg"],
      ["Tag/Abend", "4.png", "image/png"],
    ],
  );
  const drei = eintraege.find((e) => e.name === "3.jpg");
  assert.equal(drei.driveGps, true);
  assert.equal(drei.driveZeit, "2026-10-01T10:00:00");
  assert.deepEqual(uebersprungen.map((u) => u.name).sort(), ["link", "video.mp4"]);
  assert.ok(aufrufe.filter((a) => a.includes("pageToken=")).length >= 2, "mehrere Seiten abgerufen");
});

test("Drive: Ordner ohne Zugriff ergibt verständlichen Fehler", async () => {
  const { fetchImpl } = falscheDrive({ baum: {}, inhalte: {} });
  const drive = erzeugeDrive({ token: async () => TOKEN, fetchImpl, warte: async () => {} });
  await assert.rejects(drive.listeBaum("UNBEKANNT_0123456"), /ohne Zugriff/);
  await assert.rejects(drive.listeBaum("x' or '1'='1"), /ungültig/);
});

test("Download: gestreamt, md5 geprüft, Wiederholung bei 429/5xx/downloadQuotaExceeded/Netz mit Backoff", async () => {
  const dir = await neuerOrdner();
  try {
    const inhalt = Buffer.alloc(300000, 3);
    const { fetchImpl } = falscheDrive({
      baum: {},
      inhalte: { abcdefghij1: inhalt },
      stoerungen: { abcdefghij1: [429, 503, "quota", "netz"] },
    });
    const pausen = [];
    const meldungen = [];
    const drive = erzeugeDrive({
      token: async () => TOKEN,
      fetchImpl,
      warte: async (ms) => pausen.push(ms),
      protokoll: (m) => meldungen.push(m),
    });
    const e = { driveId: "abcdefghij1", pfad: ["Tag"], name: "x.jpg", md5: md5(inhalt) };
    const ziel = join(dir, "x");
    await drive.lade(e, ziel);
    assert.ok((await readFile(ziel)).equals(inhalt));
    assert.equal(pausen.length, 4);
    assert.ok(pausen[0] >= 2000, "Retry-After beachtet");
    assert.ok(pausen[3] >= 8000, "exponentiell wachsend");
    assert.ok(!meldungen.join("\n").includes(TOKEN), "Token nie im Protokoll");
    assert.deepEqual(await readdir(dir), ["x"], "keine .teil-Reste");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Download: 403 ohne Quota-Grund wird nicht wiederholt, Fehlertext ohne Token", async () => {
  const dir = await neuerOrdner();
  try {
    const { fetchImpl } = falscheDrive({ baum: {}, inhalte: { abcdefghij2: Buffer.from("x") }, stoerungen: { abcdefghij2: ["verboten"] } });
    const pausen = [];
    const drive = erzeugeDrive({ token: async () => TOKEN, fetchImpl, warte: async (ms) => pausen.push(ms) });
    await assert.rejects(
      drive.lade({ driveId: "abcdefghij2", pfad: [], name: "y.jpg", md5: md5(Buffer.from("x")) }, join(dir, "y")),
      (e) => e.status === 403 && !e.message.includes(TOKEN),
    );
    assert.equal(pausen.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Download: md5 weicht zweimal ab, dann Md5Fehler", async () => {
  const dir = await neuerOrdner();
  try {
    const { fetchImpl } = falscheDrive({
      baum: {},
      inhalte: { abcdefghij3: Buffer.from("echt") },
      stoerungen: { abcdefghij3: ["falsch", "falsch"] },
    });
    const drive = erzeugeDrive({ token: async () => TOKEN, fetchImpl, warte: async () => {} });
    await assert.rejects(
      drive.lade({ driveId: "abcdefghij3", pfad: [], name: "z.jpg", md5: md5(Buffer.from("echt")) }, join(dir, "z")),
      (e) => e instanceof Md5Fehler,
    );
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Download: einmal falsche md5, zweiter Versuch richtig", async () => {
  const dir = await neuerOrdner();
  try {
    const { fetchImpl } = falscheDrive({
      baum: {},
      inhalte: { abcdefghij4: Buffer.from("echt") },
      stoerungen: { abcdefghij4: ["falsch"] },
    });
    const drive = erzeugeDrive({ token: async () => TOKEN, fetchImpl, warte: async () => {} });
    await drive.lade({ driveId: "abcdefghij4", pfad: [], name: "w.jpg", md5: md5(Buffer.from("echt")) }, join(dir, "w"));
    assert.equal((await readFile(join(dir, "w"))).toString(), "echt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Anmeldefehler: sofort abbrechen, keine Wiederholung, keine Tokenreste im Text", async () => {
  const pausen = [];
  const drive = erzeugeDrive({
    token: async () => {
      throw new Error("invalid_grant assertion eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXI ya29.a0Abc-def");
    },
    fetchImpl: async () => {
      throw new Error("darf nicht aufgerufen werden");
    },
    warte: async (ms) => pausen.push(ms),
  });
  await assert.rejects(drive.listeBaum(ROOT), (e) => {
    assert.match(e.message, /^Google-Anmeldung fehlgeschlagen: invalid_grant/);
    assert.ok(!/eyJ|ya29\./.test(e.message), e.message);
    return true;
  });
  assert.equal(pausen.length, 0);
});
