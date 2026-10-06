# Event-Galerie: Vertrag zwischen den Bausteinen

Stand 06.10.2026 (Repo öffentlich, Verschlüsselung zwischen OS und GitHub). Verbindlich für Baukette (`bau/`, `functions/`, `.github/`), Oberfläche (`vorlage/`, `marken/`) und Krüger-OS-Modul. Wer davon abweicht, ändert zuerst diese Datei.

## Grundsätze
- Gäste sprechen nur mit `fotos.<eventdomain>` (Cloudflare Pages). Nie mit Google, nie mit Krüger OS, keine Drittanbieter (Schriften, Skripte, Bilder liegen alle selbst gehostet im Deployment).
- Keine Inline-Skripte und keine Inline-Styles (CSP). Keine Gedankenstriche (– —) als Satzzeichen in sichtbaren Texten, Bis-Striche in Spannen erlaubt. Gäste werden geduzt, wie auf den Event-Seiten (blueprint-summit.de und ambition-circle.de duzen, gemessen 05.10.2026).
- Kosten 0 EUR: Bilder sind statische Dateien (frei, unbegrenzt). Pages Functions laufen nur auf `/api/*`.
- Originale byte-gleich (md5 = Drive md5Checksum). Vorschauen und Handy-Fassung ohne EXIF/GPS.

## Marken und Pages-Projekte
Je Marke ein Pages-Projekt mit fester Domain. Je Marke ist höchstens **eine** Galerie gleichzeitig online (das OS erzwingt das). Neue Marke = neuer Ordner `marken/<id>/` plus einmal CNAME bei ALL-INKL.

| marke | Projekt | Domain | Event-Seite |
|---|---|---|---|
| `blueprint` | `fotos-blueprint-summit` | `fotos.blueprint-summit.de` | https://blueprint-summit.de |
| `ambition` | `fotos-ambition-circle` | `fotos.ambition-circle.de` | https://ambition-circle.de |

`marken/<id>/marke.json`:
```json
{ "id": "ambition", "name": "AMBITION Circle", "eventSeite": "https://ambition-circle.de",
  "domain": "fotos.ambition-circle.de", "pagesProjekt": "fotos-ambition-circle",
  "farben": { "grund": "#0E2B2E", "flaeche": "#1D373B", "text": "#EDE7D7", "textLeise": "#C9BFAE",
              "akzent": "#C69C7B", "akzentText": "#0E2B2E", "rahmen": "#244A57" },
  "schriften": { "titel": "Italiana", "text": "Open Sans" },
  "stil": { "knopfEcken": "eckig", "knopfVersal": true, "knopfLaufweite": "0.04em", "knopfGewicht": 500,
            "knopfVerlauf": ["#F4CFC0", "#C69C7B", "#B9836A"], "titelVerlauf": ["#F4CFC0", "#C69C7B", "#B9836A"] },
  "logo": "logo.png", "favicon": { "ico": "favicon.ico", "png32": "favicon-32.png", "png192": "favicon-192.png", "apple": "apple-touch-icon.png" },
  "impressum": "https://agenturkrueger-digital.de/impressum/", "datenschutz": "https://agenturkrueger-digital.de/datenschutz/" }
```
Schriften liegen als woff2 unter `vorlage/assets/schriften/` (OFL, aus @fontsource). Blueprint: Unbounded (200 und 500) + Systemschrift (RNS Sisma nicht, Lizenz ungeklärt). AMBITION: Italiana + Open Sans (400, 500, 600).

`stil` ist optional und bildet die Event-Seite nach: `knopfEcken` (`rund` | `weich` | `eckig`), `knopfVersal` (bool), `knopfLaufweite` (`0.06em` oder `1px`), `knopfGewicht` und `titelGewicht` (200, 400, 500, 600), `titelVersal` (bool), `knopfVerlauf` und `titelVerlauf` (2 bis 4 Farben `#RRGGBB`, 135°). Jede Verlaufsfarbe muss mit `akzentText` bzw. auf `grund` mindestens 4,5:1 erreichen. Andere Schlüssel lehnt der Bau ab, freier CSS-Text kommt nie aus der Markendatei. Blueprint: eckig, Versal, `1px`, 600, Titel Versal 200. AMBITION: eckig, Versal, Kupferverlauf auf Knöpfen und Titeln.

## Quelle
Geteilte Ablage der Agentur (die ID steht nur im Krüger OS, nicht im öffentlichen Repo). Je Event ein Ordner. Unterordner werden zu Kapiteln (Pfad mit „ · “ verbunden, z. B. „Mittwoch · Tag“), Bilder direkt im Event-Ordner bilden das Kapitel „Alle Fotos“. Bilder im Kapitel nach Dateinamen (natürlich sortiert). Kapitel nach der frühesten Aufnahmezeit (EXIF), wenn jedes Kapitel mindestens eine hat, sonst nach Ordnernamen (so steht „Mittwoch · Tag“ vor „Mittwoch · Abend“ und „Mittwoch“ vor „Donnerstag“). Nur `image/jpeg`, `image/png`, `image/heic` werden übernommen, nichts aus dem Papierkorb, alle Seiten der Paginierung, `supportsAllDrives/includeItemsFromAllDrives`. Dubletten (gleiche md5) zählen einmal.

## Baukette (`bau/bau.mjs`, Node 22, ESM)
```
node bau/bau.mjs --quelle drive:<ordnerId> | ordner:<pfad>
                 --marke <id> --titel "<Text>" --galerie <galerieId>
                 --ablauf <ISO-Datum> --code-hash "<pbkdf2$...>" --aus dist
```
Erzeugt `dist/` und `bericht.json` neben `dist/`. Deployt wird **aus `dist` heraus** (`cd dist && wrangler pages deploy . --project-name <pagesProjekt> --branch main`): wrangler sucht den Ordner `functions` im Arbeitsverzeichnis, nicht im Upload-Ordner. Von `dist/` aus aufgerufen bündelt es `dist/functions` (mit `_daten.js`) und lädt den Ordner `functions` nie als statische Datei hoch (Ignorierliste von wrangler, live nachgemessen).

### Fassungen je Bild
| Schlüssel | Kante lang | Format | Zweck |
|---|---|---|---|
| `r` | 600 px | JPEG q78, progressiv | Raster |
| `g` | 2000 px | JPEG q82 | Großansicht |
| `h` | 3000 px | JPEG q85 | Handy „In Fotos sichern“ (Ziel ≤ 4 MB) |
| `o` | Original | unverändert | Rechner/ZIP, Einzel-Download |

Alle außer `o`: autoOrient, Metadaten entfernt, sRGB. Originale > 25 MiB (26.214.400 B) werden in Teile ≤ 25.000.000 B geteilt (`.1`, `.2`, …).

### Pfade im Deployment
```
/index.html, /assets/*, /sw.js, /status.json, /_headers, /_routes.json, /functions/... (vom Bau erzeugt)
/b/<tok>/r/<bildId>.jpg   /b/<tok>/g/<bildId>.jpg   /b/<tok>/h/<bildId>.jpg   /b/<tok>/o/<bildId>.<n>
```
`/status.json` = `{ "titel", "marke", "ablauf" }` (statisch, für den Startbildschirm ohne Function-Aufruf).
`<tok>` = 128 Bit Zufall (base32, klein), je Bau neu. `<bildId>` = 16 Hex-Zeichen Zufall je Bild. Originalnamen stehen nur im Manifest.

### Manifest (nur über `/api/manifest`, steckt im Function-Bundle `functions/_daten.js`)
```json
{ "galerie": "<galerieId>", "marke": "ambition", "titel": "AMBITION Circle 2026", "ablauf": "2027-01-03T23:59:59+01:00",
  "erstellt": "<ISO>", "anzahl": 512, "bytesOriginale": 8123456789,
  "kapitel": [ { "titel": "Mittwoch · Tag", "bilder": [
    { "id": "a1b2…", "name": "4S4A1234.jpg", "w": 6000, "hoehe": 4000, "aufnahme": "<ISO|null>",
      "r": "/b/<tok>/r/a1b2….jpg", "g": "/b/<tok>/g/a1b2….jpg",
      "h": { "pfad": "/b/<tok>/h/a1b2….jpg", "bytes": 2890123 },
      "o": { "teile": ["/b/<tok>/o/a1b2….1"], "bytes": 16234567, "md5": "<hex>", "typ": "image/jpeg" } } ] } ] }
```
`w`/`hoehe` sind die Maße nach Ausrichtung (für Seitenverhältnis im Raster). Die Höhe heißt `hoehe`, weil `h` schon die Handy-Fassung ist (ein JSON-Objekt kann jeden Schlüssel nur einmal tragen).

### Function (`functions/api/[[pfad]].js` + `_daten.js`)
`_daten.js` exportiert `{ manifest, codeHash, cookieSchluessel, ablauf, galerie }`; `cookieSchluessel` = 32 Byte Zufall je Bau.
- `POST /api/zugang` Body `{"code":"…"}` → 204 + `Set-Cookie: eg=<exp>.<hmac>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000` (kein Domain-Attribut). Falsch → 401 nach 1 s Verzögerung. Bremse: je IP (CF-Connecting-IP) im Isolate-Speicher, ab 5 Fehlversuchen in 10 min → 429 mit Retry-After. Jeder Versuch wird **vor** der Codeprüfung gezählt (ohne `await` zwischen Prüfen und Zählen) und nur bei richtigem Code wieder freigegeben, damit auch parallele Anfragen nicht mehr als 5 Prüfungen bekommen.
- `GET /api/manifest` → 200 JSON mit gültigem Cookie, sonst 401. Nach `ablauf` → 410 `{"abgelaufen":true}`.
- `GET /api/status` → `{ "titel", "marke", "abgelaufen": bool }` ohne Cookie. Für `bauen.yml` (Prüfung nach dem Deploy) und als Rückfall der Oberfläche, wenn `/status.json` fehlt oder die Geräteuhr den Ablauf erreicht sieht.
- Jede `/api/*`-Antwort: `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, `Content-Type` korrekt.
- `codeHash` Format: `pbkdf2$sha256$<iter>$<salzB64>$<hashB64>`, iter 100000, Salz und Hash je 32 Byte (die Prüfung nimmt Salz ab 8 Byte, für ältere, von Hand gebaute Galerien). Code-Alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, 8 Zeichen, Eingabe wird getrimmt und großgeschrieben.

### `_routes.json`
```json
{ "version": 1, "include": ["/api/*"], "exclude": [] }
```

### `_headers` (statisch)
```
/*
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
```
Keine robots.txt mit Disallow (hebelt noindex aus). `/b/*` ist `private`. **Pages hält jede abgerufene Datei im Edge-Cache, auch nachdem ein neues Deployment sie nicht mehr enthält, und unabhängig von `Cache-Control`** (gemessen 05.10.2026: `public`, `private` mit `CDN-Cache-Control: no-store` und `no-store` lieferten nach dem Ersetzen alle `cf-cache-status: HIT`, Alter über 80 Minuten). Leeren kann die Agentur diesen Cache bei pages.dev und der CNAME-Domain nicht. Der Cache-Schlüssel enthält aber die Query (gleicher Pfad mit `?x=1` lieferte die Startseite). Darum hängt die Oberfläche an **jeden** Fotopfad `?s=<128 Bit Zufall je Seitenansicht>` an (`mitSitzung` in `werkzeuge.js`); die nackten Pfade aus dem Manifest ruft sie nie ab.

### `bericht.json`
`{ galerie, marke, anzahl, dubletten, bytesOriginale, bytesGesamt, geteilteOriginale:[name], gpsFunde:[name], md5Fehler:[name], uebersprungen:[{name,grund}], dauerSek }`, dazu je nach Lauf `dublettenNamen:[name]`, `dateien`, `fehler` (Text), `fehlerDatei` (name) und `deployment` (Hash-Adresse `https://<hash>.<projekt>.pages.dev`, setzt `bauen.yml` nach dem Deploy). Bei md5-Fehler bricht der Bau ab (Exit ≠ 0). Lauf-Logs nennen nie Datei- oder Ordnernamen, Bildpfade, `<tok>` oder das Manifest; Namen stehen nur im Bericht, und der verlässt den Läufer nur verschlüsselt (`bericht.enc`, siehe Verschlüsselung).

## Oberfläche (`vorlage/`)
Startet mit `/status.json` (Rückfall `/api/status`, siehe oben). Ein Code aus `location.hash` (`#c=CODE`) wird **sofort** gelesen und per `history.replaceState` aus Adresse und Verlauf entfernt (auch wenn die Galerie abgelaufen ist), danach an `/api/zugang` geschickt. Ohne Code: `/api/manifest` mit vorhandenem Cookie, sonst Eingabefeld.
- Alle Fotopfade (`r`, `g`, `h`, `o`) lädt die Seite mit `?s=<Zufall je Seitenansicht>` (siehe `_headers`).
- Raster mit lazy loading (`r`), Kapitel als Abschnitte mit Sprungleiste, Großansicht (`g`) mit Wischen, Pfeiltasten, Esc, Fokusfalle.
- Tastatur: je Kapitel-Raster **ein** Tabstopp (roving tabindex), Pfeiltasten und Pos1/Ende wandern, Leertaste wählt aus, Enter öffnet. Die Auswahlkreise sind für Zeiger und Touch (`tabindex=-1`). Die Aktionsleiste steht im DOM direkt nach dem Galerie-Kopf und ist nur optisch unten fixiert.
- Auswahl per Antippen/Kästchen, „Alle auswählen“ je Kapitel und gesamt, Zähler mit Anzahl und MB.
- Handy (navigator.canShare mit Dateien): „In Fotos sichern“ lädt `h`-Fassungen **vor** dem Tippen in Paketen zu höchstens 10 Dateien und unter 45 MB, dann Knopf „Paket 1 von N sichern“ → `navigator.share({files})`. Fortschritt sichtbar.
- Sonst: „Als ZIP laden“ mit client-zip (Store-Modus), Originale aus den Teilen zusammengesetzt, doppelte Namen eindeutig. Speichern über `showSaveFilePicker` (Chromium) oder Service-Worker-Download (`/sw.js`), Teil-ZIPs bis ca. 2 GB. Obergrenze 200 Bilder je ZIP, im Zähler sichtbar.
- Einzel-Download aus der Großansicht: am Rechner Original (Teile → Blob → `a[download]`), am Handy „In Fotos sichern“ (`h`-Fassung über `navigator.share`).
- Zustände: lädt, Code nötig, falscher Code, gebremst, leer, Fehler, abgelaufen. Fuß: Impressum, Datenschutz, Link zur Event-Seite.
- Barrierefrei (Tastatur, Fokus sichtbar, aria-live für Fortschritt, Kontrast ≥ 4,5:1), ab 320 px ohne Querscrollen, `prefers-reduced-motion`. Zustandswechsel (Fehler, abgelaufen, leer, Galerie geladen) setzen den Fokus auf den Titel (`tabindex=-1`). Countdowns laufen nie in einer Live-Region. Hover-Regeln nur unter `@media (hover: hover) and (pointer: fine)`.
- Marke über CSS-Variablen aus `marke.json`; der Bau schreibt `assets/marke.css` und kopiert Logo/Favicons (beides über `marken/marke-css.mjs`: `/assets/logo.png`, `/favicon.ico`, `/apple-touch-icon.png`, `/assets/favicon-32.png`, `/assets/favicon-192.png`).

## Verschlüsselung (Krüger OS ↔ GitHub)
Das Repo ist öffentlich, also auch Workflow-Eingaben im Ereignis, Lauf-Logs, Zusammenfassungen und Artefakte. Was nicht öffentlich sein darf, wandert verschlüsselt.
- **Schlüssel:** 32 Byte Zufall, gespeichert als Standard-Base64 (44 Zeichen mit `=`). GitHub-Secret `GALERIE_SCHLUESSEL`, im OS Integration `event_galerie_schluessel`, auf dem Rechner des Inhabers im Schlüsselbund `webwerkstatt:agentur:event-galerie-schluessel` (Konto `julian`). Erzeugt von `einrichtung/github-einrichten.sh` (`openssl rand -base64 32`), nie ausgegeben. Leerraum am Rand wird beim Lesen ignoriert.
- **Format:** `v1.<iv>.<ct>.<tag>`, alle drei Teile base64url **ohne** Padding (kanonisch). AES-256-GCM, IV 12 Byte (je Verschlüsselung neu, zufällig), Tag 16 Byte, AAD = UTF-8 der `galerie_id`. `ct` ist so lang wie der Klartext.
- **Code-Hash:** Input `code_hash_enc` = Verschlüsselung des bisherigen `pbkdf2$sha256$…`-Strings (AAD = `galerie_id` desselben Laufs). Ein Klartext-Input `code_hash` gibt es nicht mehr.
- **Bericht:** Artefakt `bericht` enthält nur `bericht.enc` = Verschlüsselung des kompletten `bericht.json`-Inhalts (UTF-8, gleiche AAD), eine Zeile mit Zeilenende. Das OS entschlüsselt und zeigt ihn an.
- Entschlüsselung scheitert bei falschem Schlüssel, anderer `galerie_id`, verändertem Text und jedem Formatfehler (falsche Version, Padding, Standard-Base64 statt base64url, IV ≠ 12 oder Tag ≠ 16 Byte).
- Umsetzung im Repo: `bau/lib/geheim.mjs` (Bibliothek), `bau/geheim.mjs` (Kommandozeile für die Workflows; `verschluesseln`/`entschluesseln` lesen stdin, Schlüssel nur aus der Umgebung `GALERIE_SCHLUESSEL`).
- **Testvektor** (für beide Seiten, gegengeprüft mit Python `cryptography`): Schlüssel `AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=` (Bytes 0 bis 31), IV `a0a1a2a3a4a5a6a7a8a9aaab` (hex), AAD `galerie-test-1`, Klartext `pbkdf2$sha256$100000$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=$ERERERERERERERERERERERERERERERERERERERERERE=` ergibt
  `v1.oKGio6Slpqeoqaqr.lnoXSSP5JswKBLXmMV7x7kCcaSC29gMt3U9nxz7qNECTNwa-7mMSfB7dRYlIO8K4BloHCSORWz8AH0of5THE8YmYwD1196GysbC6SsqcieiIWe72gJPcKKsne8j0yAjGytZu-Ub8ysnbiUMCwLU.mu__XTUcDzXv_ZItr26PTw`

## GitHub Actions (Repo `juliankkrueger/event-galerie`, öffentlich)
- Öffentlich, weil öffentliche Repos unbegrenzte kostenlose Actions-Minuten haben. Keine Organisation. Gepusht wird nur `main` (ein Commit ohne interne Historie); der lokale Zweig `historie-intern` geht nie hinaus.
- Nur `workflow_dispatch` als Auslöser (kein `push`, kein `pull_request`). Erster Schritt jedes Jobs bricht ab, wenn nicht `github.event_name == workflow_dispatch`, `github.ref == refs/heads/main` und `github.actor == github.triggering_actor == github.repository_owner`. Rechte nur auf Job-Ebene (`permissions: {}` oben).
- Alle Actions auf Commit-SHA gepinnt (`actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `google-github-actions/auth`); im Repo sind nur GitHub-eigene Actions und `google-github-actions/auth` erlaubt, SHA-Pinning ist Pflicht.
- Beide Workflows nehmen wrangler fest aus `package-lock.json` (`devDependencies`, exakte Version, `npm ci --ignore-scripts`), nie per `npx wrangler@<bereich>`. Node 22.
- `bauen.yml` (workflow_dispatch). Inputs: `galerie_id`, `marke`, `titel`, `ordner_id`, `ablauf`, `code_hash_enc`. Weder `code_hash_enc` noch `ordner_id` stehen im `env` des Jobs (GitHub zeigt den env-Block im Log jedes Schritts). „Eingaben prüfen“ liest `ordner_id` aus `$GITHUB_EVENT_PATH`, prüft und maskiert sie. „Code-Hash entschlüsseln“ (`node bau/geheim.mjs eingabe`, Secret nur im `env` dieses Schritts) liest `code_hash_enc` aus dem Ereignis, entschlüsselt (AAD = `galerie_id`), prüft das pbkdf2-Format, setzt `::add-mask::` auf den Klartext und legt ihn mit Rechten 600 in `$RUNNER_TEMP/code-hash`; außer der Maske gibt er nichts aus. Nach dem Bau entfernt der Lauf die Google-Zugangsdatei und die Code-Hash-Datei. Die wrangler-Ausgabe geht durch einen Filter, der Hash-Adressen (`<hash>.<projekt>.pages.dev`) schwärzt; die Adresse kommt als `deployment` in den Bericht. Nach erfolgreicher Prüfung des Deployments löscht er alle älteren Deployments des Projekts. Enthalten Originale GPS, meldet er die Anzahl als Warnung (Annotation). Am Ende verschlüsselt er `bericht.json` zu `bericht.enc` und lädt **nur** diese Datei als Artefakt `bericht` hoch (`dist/` nie). Die Job-Zusammenfassung enthält nur Status und Anzahlen, keine Namen, Pfade, Domains oder Adressen. `run-name: bauen ${{ inputs.galerie_id }}`. Google per Workload Identity Federation (`google-github-actions/auth`, Repo-Variablen `GCP_WIF_PROVIDER`, `GCP_SA_EMAIL`), Cloudflare per Secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Legt das Pages-Projekt an, falls es fehlt, und hängt die Domain an, falls sie fehlt.
- Google-Bedingung im OIDC-Provider: `assertion.repository_id=='<Repo-ID>' && assertion.event_name=='workflow_dispatch' && assertion.ref=='refs/heads/main'`; Zuordnung `attribute.repository_id=assertion.repository_id`, Bindung `principalSet://…/attribute.repository_id/<Repo-ID>`. Die Repo-ID holt `einrichtung/google-einrichten.sh` per `gh api repos/<owner>/event-galerie --jq .id`.
- `offline.yml` (workflow_dispatch). Inputs: `galerie_id`, `marke`. Schaltet nur ab, wenn das Produktions-Deployment des Projekts genau diese Galerie trägt (Commit-Nachricht `galerie <galerie_id>`, gesetzt von `bauen.yml`). Dann deployt es die Seite „Keine Galerie online“ (Commit-Nachricht `offline <galerie_id>`) und löscht danach alle älteren Deployments des Projekts (`?force=true`). Zeigt die Produktion eine andere Galerie, schon die Offline-Seite oder nichts, schaltet er nichts ab, löscht aber alle älteren Deployments außer Produktion und neuestem (sonst bliebe eine ersetzte Galerie unter ihrer Hash-Adresse online); ist die Zuordnung unklar, bricht er ab und ändert nichts. Ohne `id-token`-Berechtigung, ohne `GALERIE_SCHLUESSEL`. Zusammenfassung nur mit Status. `run-name: offline ${{ inputs.galerie_id }}`.

## Krüger OS
Verwaltung nur hinter dem Login. Keine öffentliche Route. Das OS ruft GitHub (`POST /repos/{repo}/actions/workflows/{datei}/dispatches`) und liest Läufe/Artefakte. Konfiguration: Integration `github_event_galerie` (fein granulierter Token, verschlüsselt in `integrations`), Integration `event_galerie_schluessel` (der Galerie-Schlüssel, siehe Verschlüsselung) und Env `EVENT_GALLERY_REPO` (`juliankkrueger/event-galerie`). Code-Klartext AES-verschlüsselt in der DB (zum erneuten Anzeigen), an GitHub geht nur `code_hash_enc`. Den Bericht liest das OS aus dem Artefakt `bericht` (`bericht.enc`) und entschlüsselt ihn mit derselben `galerie_id`. Gäste-Link: `https://<domain>/#c=<CODE>`.
