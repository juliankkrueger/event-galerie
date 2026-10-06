# Event-Galerie

Fotogalerien zu den Events der Agentur Krüger (AMBITION Circle, Blueprint Summit) und zu Kunden-Events, als Ersatz für Pixieset. Jede Galerie hat ihre eigene Adresse `https://<projekt>.pages.dev`, beliebig viele sind gleichzeitig online, keine läuft von selbst ab. Gäste bekommen Link oder Code, sehen die Fotos im Raster, laden einzelne oder viele auf einmal: am Handy direkt in die Fotos-App, am Rechner als ZIP mit Originalen.

Verbindlich für alle Bausteine ist **[VERTRAG.md](VERTRAG.md)**. Wer davon abweicht, ändert zuerst den Vertrag.

| Dokument | Für wen |
|---|---|
| [einrichtung/ANLEITUNG-EINRICHTUNG.md](einrichtung/ANLEITUNG-EINRICHTUNG.md) | Inhaber des Repos, einmalige Einrichtung |
| [einrichtung/NEUES-EVENT.md](einrichtung/NEUES-EVENT.md) | Team, nach jedem Event |
| [einrichtung/NEUE-MARKE.md](einrichtung/NEUE-MARKE.md) | Kunden-Marke in 10 Minuten |
| [einrichtung/DATENSCHUTZ-BAUSTEIN.md](einrichtung/DATENSCHUTZ-BAUSTEIN.md) | Geschäftsführung, Entwurf zur Prüfung |

## Neue Galerie (Hauptweg)

```bash
galerie neu "<drive-link>" --titel "<Titel>" [--marke agentur|ambition|blueprint]
```

Ein Befehl: Ordner prüfen (und bei Bedarf in die Geteilte Ablage kopieren), Code erzeugen, Bau auf GitHub starten und beobachten, verschlüsselten Bericht lesen, die Galerie live abnehmen, Link, Code, QR-Code und Gäste-Text ausgeben. Einzelheiten in [NEUES-EVENT.md](einrichtung/NEUES-EVENT.md), Vertrag im Abschnitt „Werkzeug galerie“. Das Krüger OS bleibt als Zweitweg für die beiden eigenen Marken.

## Architektur

```
 Team                       Google Workspace (agenturkrueger-digital.de)
  │ Fotos hochladen         Geteilte Ablage der Event-Galerie, je Event ein Ordner
  └──────────────────────▶  ▲
                            │ nur lesen: Dienstkonto event-galerie, Rolle Betrachter,
                            │ angemeldet per Workload Identity Federation (kein Schlüssel)
 Werkzeug galerie (Mac)     │
  gh, gcloud, Schlüsselbund │
 oder Krüger OS (Login)     │
  Bauen / Offline ──API──▶ GitHub Actions  juliankkrueger/event-galerie (öffentlich)
  (Code bleibt lokal bzw.   bauen.yml: Hash entschlüsseln, Drive lesen, md5 prüfen,
   im OS, an GitHub nur     verkleinern, Metadaten entfernen, dist/ bauen, deployen,
   der Hash, verschlüsselt) Bericht verschlüsselt zurück
                            offline.yml: Platzhalter deployen, alte Fassungen löschen,
                            auf Wunsch das ganze Projekt löschen
                            │
                            │ wrangler pages deploy (Token nur "Pages Edit")
                            ▼
                         Cloudflare Pages, je Galerie ein Projekt (OS: je Marke eins)
                          https://fotos-<titel>-<4 Zeichen>.pages.dev
                          statisch: /index.html /assets/* /b/<tok>/{r,g,h,o}/...
                          Function: /api/status /api/zugang /api/manifest
                            ▲
 Gäste ─────────────────────┘  Link https://<projekt>.pages.dev/#c=<CODE>
                               (keine Verbindung zu Google, OS oder Dritten)
```

## Ordner

| Ordner | Inhalt |
|---|---|
| `bau/` | Baukette `bau.mjs` (Node 22), `code-hash.mjs` (Code und Hash erzeugen), `geheim.mjs` (Ver- und Entschlüsseln zwischen OS und GitHub), `offline.mjs`, `pages.mjs` (Cloudflare-Verwaltung der Workflows) |
| `werkzeug/` | Kommandozeile `galerie` (Hauptweg), eigene `package.json` nur mit `qrcode` |
| `functions/` | Pages Function für `/api/*`, `_daten.js` erzeugt der Bau je Galerie |
| `vorlage/` | Oberfläche der Galerie: HTML, CSS, JS, Schriften, Service Worker |
| `marken/<id>/` | `marke.json`, Logo, Favicons je Marke; `marken/schriften/` Schriften einzelner Marken |
| `.github/workflows/` | `bauen.yml`, `offline.yml` |
| `einrichtung/` | Einrichtungsskripte und Anleitungen |
| `tests/` | Tests der Baukette und der Oberfläche |

## Lokaler Testbau

Ohne Google und ohne Cloudflare, mit einem Ordner voller Testfotos:

```bash
cd event-galerie                            # Stamm des Repos
npm ci
npm run -s code -- --code ABCD2345          # gibt {"code":"ABCD2345","codeHash":"pbkdf2$..."} aus
node bau/bau.mjs --quelle ordner:/pfad/zu/testfotos \
  --marke ambition --titel "Testgalerie" --galerie test-1 \
  --ablauf 2026-12-31T23:59:59+01:00 \
  --code-hash 'pbkdf2$sha256$100000$...' --aus /tmp/eg-test/dist
```

Unterordner werden zu Kapiteln. Ergebnis: `/tmp/eg-test/dist/` und `/tmp/eg-test/bericht.json`. Im Code nur das Alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (kein I, L, O, 0, 1).

Ansehen:
```bash
cd /tmp/eg-test/dist && npx --no-install wrangler pages dev . --port 8788
```
Dann http://localhost:8788/#c=ABCD2345 öffnen.

Den verschlüsselten Weg wie im Workflow lokal durchspielen (mit einem Wegwerf-Schlüssel, nie mit dem echten):
```bash
export GALERIE_SCHLUESSEL="$(openssl rand -base64 32)"
hash="$(npm run -s code -- --code ABCD2345 | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.parse(d).codeHash))')"
enc="$(printf '%s' "$hash" | node bau/geheim.mjs verschluesseln --galerie test-1)"
printf '{"inputs":{"galerie_id":"test-1","code_hash_enc":"%s"}}' "$enc" > /tmp/eg-test/event.json
node bau/geheim.mjs eingabe --ereignis /tmp/eg-test/event.json --aus /tmp/eg-test/code-hash   # gibt nur ::add-mask:: aus
node bau/bau.mjs --quelle ordner:/pfad/zu/testfotos --marke ambition --titel "Testgalerie" --galerie test-1 \
  --ablauf 2026-12-31T23:59:59+01:00 --code-hash "$(cat /tmp/eg-test/code-hash)" --aus /tmp/eg-test/dist
node bau/geheim.mjs bericht --galerie test-1 --ein /tmp/eg-test/bericht.json --aus /tmp/eg-test/bericht.enc
```

**Zwei Fallen beim Ausliefern (gemessen mit wrangler 4.127):**
- `wrangler pages deploy` übersetzt die Function aus `./functions` **im aktuellen Arbeitsverzeichnis**, nicht aus dem hochgeladenen Ordner. Deployen also immer aus `dist` heraus: `cd dist && npx wrangler pages deploy . --project-name <projekt> --branch main`. Aus dem Repo-Stamm mit `deploy dist` fehlt `_daten.js`.
- `wrangler pages deploy` lädt den Ordner `functions/` nicht als Datei hoch. `wrangler pages dev` dagegen liefert `dist/functions/_daten.js` als Datei aus, samt Code-Hash und Cookie-Schlüssel. Lokal egal, aber die Vorschau nie über einen Tunnel nach außen geben.

## Tests

Node 22 (wrangler 4.127 verlangt es; wrangler liegt fest in `devDependencies`, aufrufen mit `npx --no-install wrangler`).

```bash
(cd werkzeug && npm ci)                    # einmal, für die Werkzeug-Tests (qrcode)
npm test                                   # Baukette, Function, Verschlüsselung, Workflows, Marken, Werkzeug (node --test)
cd tests/oberflaeche && npm ci && npm test # Oberfläche gegen den Mock (Playwright)
npm run integration                        # (in tests/oberflaeche) echte Baukette + Function + Browser
```

Echter Test mit großen Fotos (tests/bilder/ und tests/ergebnisse/ sind nicht im Git):

```bash
node tests/testbilder.mjs                  # 60 synthetische 24-MP-Fotos, 8 bis 20 MB, 2 über 25 MiB,
                                           # 1 Hochformat mit Orientation 6, 2 mit GPS, 1 Dublette
node bau/bau.mjs --quelle ordner:tests/bilder --marke ambition ... --aus dist
node tests/pruefe-dist.mjs --dist dist --quelle tests/bilder --code-datei tests/.testcode
cd dist && npx wrangler pages dev . --port 8790     # zweites Terminal
cd tests/oberflaeche && node echt.mjs --basis http://127.0.0.1:8790 --name lokal
```

`echt.mjs` prüft auf fünf Geräten (1300, 1024, iPhone 13, Pixel 7, 320 px) Code per `#c=`, ZIP mit 10 Originalen
(md5 jedes Eintrags gegen die Quelle), Teilen-Pakete, Großansicht, Querscrollen, Konsolenfehler und jede Anfrage
auf fremde Domains, dazu Header, Cookie, 401/429 und mit `--nur abgelaufen` den Ablauf. Achtung: Der Bremsen-Test
am Ende sperrt die eigene IP für 10 Minuten (auch für den richtigen Code), bis zum nächsten Deployment.

Gemessen am 05.10.2026 (MacBook, 60 Fotos, 891,5 MB Originale): Bau 6,8 s, Speicherspitze 637 MB (RSS),
Deployment 997,6 MB in 272 Dateien, Upload 142 s; ZIP mit 10 Originalen (159 MB) von pages.dev in 22 s.

## Kosten: 0 EUR

| Dienst | Warum kostenlos |
|---|---|
| Cloudflare Pages | Statische Dateien sind im Free-Plan unbegrenzt in Anfragen und Datenmenge. Nur `/api/*` läuft als Function (`_routes.json`), Fotos laufen nie durch die Function. |
| Pages Functions | 100.000 Aufrufe am Tag kontoweit frei. Ein Gast braucht zwei (Zugang, Manifest), wer schon angemeldet ist einen. Den Status liest die Seite aus der statischen `status.json`. |
| GitHub | Öffentliches Repo im Benutzerkonto: Actions-Minuten auf den Standard-Läufern sind für öffentliche Repos unbegrenzt kostenlos. |
| Google Cloud | Projekt ohne Rechnungskonto. Drive API, IAM, STS und IAM Credentials kosten nichts. |
| Google Workspace | Ist ohnehin da, die Fotos liegen in einer Geteilten Ablage. |

Ein Projekt ohne Rechnungskonto kann gar nichts Kostenpflichtiges starten. Bei Cloudflare und GitHub gibt es im Free-Plan keine Überziehung, nur eine Sperre bis zum nächsten Tag bzw. Monat.

## Grenzen

| Grenze | Wert | Folge |
|---|---|---|
| Dateigröße bei Pages | 25 MiB je Datei | Größere Originale werden in Teile ≤ 25.000.000 Byte geteilt und im Browser wieder zusammengesetzt |
| Dateien je Deployment | 20.000 | Vier Fassungen je Foto plus feste Dateien, also **ca. 4.900 Fotos je Galerie**. Der Bau bricht ab 19.900 Dateien ab |
| Function-Aufrufe | 100.000 am Tag, kontoweit | Reicht für zehntausende Gäste am Tag; darüber antwortet `/api/*` bis Mitternacht UTC mit Fehler, für alle Marken und alle anderen Workers des Kontos (siehe Bekannte Schwächen) |
| Teilen am Handy (Chrome) | 10 Dateien, 50 MB je Teilen | Deshalb Pakete zu höchstens 10 Fotos und unter 45 MB |
| Plattenplatz im GitHub-Läufer | ca. 14 GB frei, nach Aufräumen vorinstallierter Werkzeuge mehr | Originale plus Fassungen müssen hineinpassen |
| Actions-Laufzeit | unbegrenzte Minuten (öffentliches Repo), je Lauf höchstens 6 h, `bauen.yml` bricht nach 180 min ab | Dauer je Bau hängt an der Fotomenge |
| ZIP am Rechner | höchstens 200 Bilder je ZIP, Teil-ZIPs bis ca. 2 GB | Steht im Zähler |
| Galerien gleichzeitig | beliebig viele (je Galerie ein Pages-Projekt); auf dem OS-Weg eine je Marke | Cloudflare erlaubt **100 Pages-Projekte je Konto**, die Grenze wird laut Doku nicht angehoben. Die Galerien teilen sich das Konto mit allen anderen Pages-Projekten der Agentur (gemessen 06.10.2026: 62 belegt, also Platz für rund 38 Galerien). Nicht mehr gebrauchte Galerien mit `galerie loeschen` entfernen; auf Dauer ein eigenes, kostenloses Cloudflare-Konto für die Galerien (siehe Bekannte Schwächen) |

## Sicherheitsmodell

**Öffentliches Repo, verschlüsselte Übergabe**
- Warum öffentlich: Öffentliche Repos haben unbegrenzte kostenlose Actions-Minuten, eine Organisation oder ein bezahlter Plan ist nicht nötig. Die Sicherheit hängt nicht am versteckten Code: Wer den Code kennt, kommt trotzdem nicht an Fotos, Code oder Zugänge.
- Öffentlich sind damit Code, Workflows, Lauf-Logs, Job-Zusammenfassungen und Artefakte (Artefakte für jeden angemeldeten GitHub-Nutzer). Darum:
  - Der Code-Hash geht nur verschlüsselt an GitHub (`code_hash_enc`, AES-256-GCM, Schlüssel `GALERIE_SCHLUESSEL`, gebunden an die `galerie_id`). Der Workflow entschlüsselt ihn im ersten Schritt nach dem Checkout, maskiert ihn und reicht ihn nur über eine Datei mit Rechten 600 weiter.
  - Der Bericht (Dateinamen, GPS-Funde, Deployment-Adresse) geht nur verschlüsselt hinaus (`bericht.enc`). `dist/` wird nie als Artefakt hochgeladen.
  - Log und Zusammenfassung nennen nur Status und Anzahlen. Die Ordner-ID wird maskiert, Hash-Adressen der Deployments werden geschwärzt.
  - Öffentlich sichtbar bleiben `galerie_id`, Titel, Marke und Ablauf eines Laufs. Der Titel steht ohnehin auf der Galerie.
- Starten kann die Workflows nur der Inhaber: nur `workflow_dispatch`, nur auf `main`, der erste Schritt bricht für jeden anderen Akteur ab. Workflows aus Fork-PRs brauchen immer eine Freigabe, und es gibt keinen Workflow, der auf Pull Requests reagiert.
- Die interne Entwicklungshistorie liegt nur lokal im Zweig `historie-intern`; nach GitHub geht nur `main` (ein pre-push-Hook sperrt alles andere).

**Gäste**
- Zugang per Code: 8 Zeichen aus 31, also rund 8,5 × 10¹¹ Möglichkeiten. In der Function liegt nur ein PBKDF2-Hash (SHA-256, 100.000 Runden).
- Falscher Code: Antwort erst nach 1 s, ab 5 Fehlversuchen in 10 Minuten je IP gesperrt (429). Jeder Versuch zählt schon **vor** der Prüfung und wird nur bei richtigem Code wieder freigegeben, darum kommen auch 25 gleichzeitige Anfragen nur auf 5 Prüfungen (vorher 20, gemessen 05.10.2026). Die Bremse lebt im Speicher eines Isolates, ist also pro Rechenzentrum und nicht weltweit. Zusammen mit der Codelänge reicht das. Gefälschte IP-Header (`CF-Connecting-IP`, `X-Forwarded-For`, `True-Client-IP`) weist Cloudflare mit 403 ab. Grenze: Bei vielen gleichzeitigen Anfragen verteilt Cloudflare sie auf mehrere Isolates, jedes mit eigener Bremse. Gemessen: 6 gleichzeitig ergeben genau 5 × 401 und 1 × 429 (ein Isolate), 25 gleichzeitig 18 × 401 (mehrere Isolates). Ein gemeinsamer Zähler bräuchte einen Durable Object hinter einem eigenen Worker; bei 8,5 × 10¹¹ möglichen Codes ist das nicht nötig.
- Nach richtigem Code: Cookie `eg` (HttpOnly, Secure, SameSite=Lax, 30 Tage), signiert mit einem Schlüssel, der bei jedem Bau neu entsteht. Neu bauen meldet also alle ab; der Link mit `#c=` meldet wieder an.
- Das Manifest (Namen, Pfade) gibt es nur mit Cookie über `/api/manifest`.
- Die Fotos selbst sind statische Dateien unter `/b/<tok>/`, `Cache-Control: private`. **Achtung Edge-Cache:** Pages hält jede abgerufene Datei unter ihrer genauen Adresse im Cache, auch nach Offline, Neubau oder Löschen des Deployments, und zwar unabhängig von `Cache-Control` (gemessen 05.10.2026 mit `public`, `private` und `no-store`, alle `HIT`, Alter über 80 Minuten und steigend). Leeren kann die Agentur diesen Cache nicht. Der Cache-Schlüssel enthält die Query, darum lädt die Seite jedes Foto mit `?s=<Zufall je Seitenansicht>`. Die nackte Adresse aus einem Manifest landet so nie im Cache und liefert nach dem Ersetzen die Startseite. Was vor dieser Änderung (05.10.2026) nackt abgerufen wurde, und Adressen, die jemand samt `?s=` kopiert und weitergibt, bleiben so lange erreichbar, wie Cloudflare sie hält. Die Fotos sind `<tok>` sind 128 Bit Zufall je Bau, Bild-IDs 64 Bit Zufall. Wer einen Pfad kennt, kann diese eine Datei laden, auch ohne Cookie. Das ist der Preis für 0 EUR: eine Prüfung je Foto bräuchte eine Function je Foto.
- `noindex` auf allen Antworten, keine robots.txt mit Disallow, strenge CSP ohne Inline-Skripte, keine Drittanbieter.
- Vorschau- und Handyfassungen ohne EXIF und GPS. Originale bleiben byte-gleich (md5 gegen Drive geprüft); GPS-Funde stehen im Bericht.

**Zugänge**
- Google: kein Dienstkonto-Schlüssel. GitHub meldet sich per OIDC an. Das Dienstkonto annehmen darf nur ein Lauf, bei dem die numerische **Repo-ID** passt, das Ereignis `workflow_dispatch` ist und der Zweig `refs/heads/main` (Bedingung im Provider, Bindung an `attribute.repository_id`). Ein Fork, ein umbenanntes oder neu angelegtes Repo gleichen Namens und jeder Pull-Request-Lauf scheitern daran. Das Dienstkonto hat keine Projektrollen, nur „Betrachter“ auf der einen Geteilten Ablage.
- Cloudflare: eigenes Token nur mit „Account > Cloudflare Pages > Edit“, als GitHub-Secret. Nicht das Agentur-Token aus der Schlüsselbundverwaltung.
- Krüger OS: fein granuliertes GitHub-Token nur für dieses Repo, nur „Actions: Read and write“ (plus Metadata lesen). Kann Workflows starten und Läufe lesen, aber keinen Code ändern und keine Secrets lesen.
- `GALERIE_SCHLUESSEL`: liegt als GitHub-Secret, im OS (Integration `event_galerie_schluessel`) und im Schlüsselbund des Inhabers. Erzeugt und verteilt von `einrichtung/github-einrichten.sh`, ohne je angezeigt zu werden. Rotation: `./github-einrichten.sh --neuer-schluessel`, danach im OS ersetzen.
- Der Code im Klartext liegt nur verschlüsselt im OS. An GitHub geht nur der verschlüsselte Hash.

**Bekannte Schwächen, bewusst in Kauf genommen**
- Wer `GALERIE_SCHLUESSEL` hat, kann künftige Code-Hashes entschlüsseln und offline gegen den Code raten (PBKDF2 mit 100.000 Runden bremst das, 8,5 × 10¹¹ Codes). Der Schlüssel liegt deshalb nur an den drei genannten Stellen und wird bei Verdacht rotiert.
- Ältere Deployments löscht `bauen.yml` direkt nach jedem erfolgreichen Deploy und `offline.yml` bei jedem Lauf (auch wenn inzwischen eine andere Galerie der Marke online ist). Bis dahin bleibt eine Fassung unter ihrer eigenen Adresse (`<hash>.<projekt>.pages.dev`) erreichbar.
- Gelöschte Deployments sind nicht sicher sofort weg. Gemessen 05.10.2026 mit fünf gelöschten Deployments: drei antworteten danach mit 404 (eins nach 5 s), zwei lieferten noch **mehr als 100 Minuten nach dem Löschen** die komplette Galerie samt Function aus (gelöscht gegen 13:14 UTC, `/api/status` antwortete um 15:03 UTC weiter mit 200; ein Ende war nicht absehbar), obwohl die API sie nicht mehr kennt (`deployment delete` meldet „does not exist“). Sie nehmen weiter den alten Code an und geben Manifest und Originale heraus. Ursache unklar, ein Ende ist nicht zugesagt. Die Produktionsadresse und die eigene Domain wechseln dagegen in Sekunden auf die Offline-Seite. Gäste kennen die Hash-Adressen nicht, sie stehen nur im verschlüsselten Bericht (Feld `deployment`), im Lauf-Log sind sie geschwärzt. Ein neuer Code hilft gegen solche Geisterfassungen nicht (sie tragen den alten Hash), er sperrt nur den alten Link für die neue Galerie.
- **Function-Kontingent ist kontoweit.** Nicht ausgelöst, nur abgeschätzt: `/api/zugang`, `/api/manifest` und `/api/status` lassen sich ohne Anmeldung beliebig oft aufrufen, jeder Aufruf zählt. Mit rund 100.000 Anfragen an einem Tag (über wechselnde IPv6-Adressen, die Bremse hilft dann nicht) steht `/api/*` bis Mitternacht UTC still, für alle Marken und für **alle anderen Workers und Functions desselben Cloudflare-Kontos**. Ein Rate Limiting von Cloudflare ist nicht möglich, weil weder pages.dev noch die CNAME-Domain bei ALL-INKL eine eigene Cloudflare-Zone sind. Empfehlung: die Galerie-Projekte in ein eigenes, kostenloses Cloudflare-Konto legen (Entscheidung offen) und im OS den Verbrauch beobachten (Cloudflare GraphQL Analytics für Pages Functions, Datensatz vorher prüfen). Der eigene Anteil ist schon gesenkt: die Seite liest den Status aus `status.json`.
- **Ein kompromittiertes Werkzeug im Bau-Lauf.** Im Job `bauen` gibt es OIDC (Google, Lesen der Geteilten Ablage) und den Cloudflare-Token. wrangler kommt deshalb mit fester Version und Integritäts-Hash aus `package-lock.json`, Install-Skripte laufen nicht, und nach dem Bau verschwindet die Google-Zugangsdatei. Ein OIDC-Token anfordern könnte ein bösartiges Paket im selben Job trotzdem. Ganz trennen ließe es sich nur mit zwei Jobs; dafür müsste `dist` (oft mehrere GB) als Artefakt wandern, das übersteigt den freien Speicher von GitHub (500 MB).
- **GPS in Originalen.** Originale bleiben byte-gleich (Vertrag), also samt Aufnahmeort, und gehen an jeden mit Link. `bauen.yml` meldet GPS-Funde als Warnung im Lauf. Das OS sollte sie vor dem Freischalten anzeigen. GPS nur im Original zu entfernen bräche die md5-Gleichheit und braucht eine Vertragsänderung.
- Die Bremse lebt je Isolate: Jedes neue Deployment beginnt bei null. Umgekehrt sperrt sie alle hinter einer IP, also z. B. das ganze WLAN einer Veranstaltung, sobald dort 5 Fehlversuche in 10 Minuten zusammenkommen, auch für Gäste mit richtigem Link.
- pages.dev setzt auf jede Antwort `NEL`/`Report-To` (Cloudflare Network Error Logging). Bei Netzfehlern meldet der Browser an `a.nel.cloudflare.com`, also an Cloudflare selbst. Ob `_headers` das abschalten kann, ist nicht geprüft.

## Betrieb

| Fall | Was tun |
|---|---|
| Neues Event | `galerie neu …`, siehe [NEUES-EVENT.md](einrichtung/NEUES-EVENT.md) |
| Ablauf | Galerien laufen nicht ab (Entscheidung 06.10.2026). Wer doch ein Datum will: `--ablauf` beim Anlegen, im OS das Ablaufdatum. |
| Offline nehmen | `galerie offline <projekt>` bzw. im OS „Offline nehmen“ (`offline.yml`): Platzhalter „Keine Galerie online“, danach alle älteren Deployments des Projekts löschen. Auf dem OS-Weg gilt: ist schon eine andere Galerie der Marke online, bleibt sie online, ältere Deployments werden trotzdem gelöscht. Fotos in Drive bleiben. |
| Ganz löschen | `galerie loeschen <projekt>`: Platzhalter, ältere Deployments löschen, dann das Pages-Projekt selbst (nur eigene Galerie-Projekte, nie ein Markenprojekt). |
| Löschwunsch eines Gastes | Foto in Drive löschen, `galerie neu-bauen <projekt>` bzw. im OS Neu bauen. `bauen.yml` löscht danach die älteren Deployments selbst. Weil gelöschte Deployments noch eine Weile weiterlaufen können (siehe Bekannte Schwächen), die alten Hash-Adressen (Feld `deployment` im Bericht des jeweiligen Laufs, im OS) nach einer Stunde nachmessen: `curl -s -o /dev/null -w '%{http_code}' https://<hash>.<projekt>.pages.dev/api/status` (404 = weg). Die nackten Fotoadressen aus dem alten Manifest liefern danach die Startseite, weil die Galerie Fotos nur mit Zufallswert (`?s=`) abruft (siehe Sicherheitsmodell). Mail kommt an info@agenturkrueger-digital.de. |
| Ablauf erreicht (nur mit gesetztem Datum) | `/api/manifest` antwortet 410, die Seite zeigt „abgelaufen“. Die Dateien liegen weiter bei Cloudflare, bis „Offline nehmen“ läuft. |
| Bau fehlgeschlagen | Das Werkzeug zeigt Schritt, Bericht und Log-Auszug. Im OS: Bericht (entschlüsselt aus dem Artefakt `bericht`): `fehler`, `fehlerDatei`, `md5Fehler`, `uebersprungen`. Im GitHub-Log stehen bewusst keine Dateinamen. Häufig: Ordner liegt nicht in der Geteilten Ablage. |
| Token läuft ab | GitHub-Token im OS spätestens nach 366 Tagen, Cloudflare-Token je nach TTL. |
| Neue Marke | [NEUE-MARKE.md](einrichtung/NEUE-MARKE.md), kein DNS. |
| Schlüssel kompromittiert | `./einrichtung/github-einrichten.sh --neuer-schluessel`, neuen Wert im OS eintragen. Laufende Galerien sind nicht betroffen (der Schlüssel schützt nur die Übergabe). |

Nach jedem ersten Deployment prüfen, dass die Function-Daten nicht als Datei herausgehen (`bauen.yml` prüft es bei jedem Lauf selbst):
```bash
curl -s -o /dev/null -w '%{content_type}\n' https://<projekt>.pages.dev/functions/_daten.js
```
Erwartet: `text/html` (die Startseite als Rückfall), nie `application/javascript`.

## Lizenz

Alle Rechte vorbehalten, Agentur Krüger GmbH (siehe [LICENSE](LICENSE)). Der Quelltext ist öffentlich einsehbar, aber kein Open Source. Eigene Lizenzen behalten client-zip (MIT, `vorlage/assets/client-zip.LICENSE.txt`) und die Schriften (SIL OFL 1.1, `vorlage/assets/schriften/OFL-*.txt`).
