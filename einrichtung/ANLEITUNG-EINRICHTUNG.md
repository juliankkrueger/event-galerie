# Event-Galerie einrichten

Einmalige Einrichtung, Reihenfolge einhalten. Gesamtzeit etwa 45 Minuten, dazu Wartezeit bei Google (bis zu 24 Stunden, meist Minuten).

Alles läuft in **deinem eigenen Terminal**. Kein Wert aus den Schritten A, D oder E gehört in eine Datei, in einen Chat oder in eine Mail.

Das Repo liegt **öffentlich** im Benutzerkonto `juliankkrueger` (`juliankkrueger/event-galerie`), ohne Organisation. Öffentliche Repos haben unbegrenzte kostenlose Actions-Minuten. Was geheim bleiben muss, liegt als Secret oder geht verschlüsselt (siehe LIESMICH, Sicherheitsmodell).

| Schritt | Was | Zeit |
|---|---|---|
| A | `./github-einrichten.sh`: Repo öffentlich anlegen, Actions absichern, Galerie-Schlüssel ins OS | 5 min |
| B | `gcloud auth login` und `./google-einrichten.sh` | 10 min |
| C | Dienstkonto in die Geteilte Ablage | 5 min (plus Wartezeit Google) |
| D | Cloudflare-Token und Account-ID als GitHub-Secrets | 5 min |
| E | GitHub-Token und Repo im Krüger OS (nur für den Zweitweg über das OS) | 10 min |
| F | Werkzeug `galerie` auf dem Rechner | 5 min |

Voraussetzung: `gh auth login` mit dem Konto `juliankkrueger`, `gcloud` installiert (`brew install --cask google-cloud-sdk`), im Krüger OS gibt es unter Integrationen den Eintrag „Event-Galerie Schlüssel“.

---

## A. Repo anlegen, Actions absichern, Galerie-Schlüssel

```bash
cd einrichtung                     # im Stamm dieses Repos
./github-einrichten.sh
```

Das Skript
- prüft, dass `gh` als `juliankkrueger` angemeldet ist,
- bricht ab, wenn in `main` eine Geheimnis-Datei, `dist/`, ein Bericht oder Testergebnisse liegen, und lässt gitleaks über `main` laufen (falls installiert, `brew install gitleaks`),
- fragt **ausdrücklich mit j/n**, bevor es `juliankkrueger/event-galerie` öffentlich anlegt, und lädt dann nur den Zweig `main` hoch (die alte Historie im lokalen Zweig `historie-intern` geht nie hinaus, ein pre-push-Hook sperrt sie),
- erlaubt in Actions nur GitHub-eigene Actions und `google-github-actions/auth`, beide nur auf Commit-SHA,
- stellt das Workflow-Token auf „nur Lesen“ und verlangt für Workflows aus Fork-PRs immer eine Freigabe,
- erzeugt den **Galerie-Schlüssel** (`GALERIE_SCHLUESSEL`, 32 Byte), setzt ihn als GitHub-Secret, legt ihn in die Schlüsselbundverwaltung (`webwerkstatt:agentur:event-galerie-schluessel`) und in die Zwischenablage. Angezeigt wird er nie.

Wenn das Skript sagt „Jetzt im Krüger OS unter Integrationen bei Event-Galerie Schlüssel einfügen“: Krüger OS > Integrationen > „Event-Galerie Schlüssel“ (`event_galerie_schluessel`) > einfügen > Speichern. Dann im Terminal Enter, das Skript leert die Zwischenablage.

Es kann gefahrlos noch einmal laufen; einen vorhandenen Schlüssel lässt es in Ruhe. Neuer Schlüssel (Rotation): `./github-einrichten.sh --neuer-schluessel`, danach im OS ersetzen.

## B. Google Cloud einrichten

```bash
gcloud auth login
```
Der Browser öffnet sich. Mit deinem Konto der Agentur-Domain anmelden und zulassen. Danach:

```bash
./google-einrichten.sh
```

Das Skript legt unter der Workspace-Organisation das Projekt `ak-event-galerie` an, **ohne Rechnungskonto**, schaltet vier kostenlose APIs ein (Drive, IAM, IAM Credentials, Security Token Service), legt das Dienstkonto `event-galerie@ak-event-galerie.iam.gserviceaccount.com` an (keine Rollen, kein Schlüssel) und erlaubt nur Läufen aus `juliankkrueger/event-galerie`, dieses Konto anzunehmen, und auch denen nur, wenn sie per `workflow_dispatch` auf `main` gestartet wurden. Gebunden wird an die numerische Repo-ID (holt das Skript per `gh`), nicht an den Namen. Am Ende setzt es die Repo-Variablen `GCP_WIF_PROVIDER` und `GCP_SA_EMAIL`. Beides sind Adressen, keine Geheimnisse.

Wenn es abbricht:
- **Repo nicht gefunden:** erst Schritt A.
- **ID schon vergeben:** Projekt-IDs sind weltweit eindeutig. Mit anderer ID neu starten: `./google-einrichten.sh juliankkrueger ak-event-galerie-2`
- **Nutzungsbedingungen:** einmal https://console.cloud.google.com öffnen, bestätigen, Skript neu starten.
- **Bindung schlägt fehl:** Organisationen ab Mai 2024 erlauben IAM-Freigaben nur für die eigene Domain. Projekte *in* der Organisation sind davon ausgenommen, deshalb muss das Projekt unter der Organisation hängen. Das Skript warnt, wenn das nicht so ist.

## C. Dienstkonto in die Geteilte Ablage

Das Dienstkonto ist für Google eine Adresse **außerhalb** von agenturkrueger-digital.de. Darum zuerst die Admin-Einstellung prüfen, dann hinzufügen.

**1. Admin-Konsole** (https://admin.google.com)
Menü > Apps > Google Workspace > Drive und Docs > Freigabeeinstellungen > Freigabeoptionen. Dort muss „Teilen außerhalb von Agentur Krüger“ an sein und die Option **„Nutzer außerhalb meiner Organisation zu geteilten Ablagen hinzufügen“** erlaubt sein.

Ist das Teilen nach außen bisher bewusst aus, nicht für alle einschalten, sondern eng halten:
- Menü > Verzeichnis > Organisationseinheiten: neue Einheit `Event-Galerie` anlegen.
- Menü > Apps > Google Workspace > Drive und Docs > Geteilte Ablagen verwalten: die Ablage der Event-Galerie in diese Einheit verschieben.
- Die Freigabeoptionen oben nur für diese Einheit öffnen (links die Einheit wählen, dann „Überschreiben“).

Änderungen brauchen laut Google bis zu 24 Stunden, meist geht es schneller.

**2. In der Ablage selbst** (https://drive.google.com, Geteilte Ablage der Event-Galerie)
- Rechtsklick auf die Ablage > Einstellungen für geteilte Ablagen: „Zugriff durch Personen außerhalb von Agentur Krüger“ muss erlaubt sein.
- Rechtsklick > Mitglieder verwalten > `event-galerie@ak-event-galerie.iam.gserviceaccount.com` eintragen > Rolle **Betrachter** > „Personen benachrichtigen“ abwählen > Senden.
- Google fragt nach, weil die Adresse extern ist: „Trotzdem teilen“.

Betrachter reicht. Das Dienstkonto kann damit nur lesen, nichts löschen und nichts weiter teilen.

## D. Cloudflare: Token und Account-ID

Für GitHub gibt es ein **eigenes** Token. Das Agentur-Token aus der Schlüsselbundverwaltung wird dafür nicht verwendet.

**Token anlegen**
1. https://dash.cloudflare.com/profile/api-tokens (My Profile > API Tokens) > **Create Token**.
2. Ganz unten **Custom token** > Get started.
3. Token name: `event-galerie GitHub Actions`.
4. Permissions: genau eine Zeile: **Account** | **Cloudflare Pages** | **Edit**.
5. Account Resources: Include | das Agentur-Konto.
6. Client IP Address Filtering leer lassen (GitHub-Läufer haben wechselnde Adressen). TTL nach Wunsch, dann Erinnerung im Kalender setzen.
7. Continue to summary > Create Token. Das Token wird **nur einmal** angezeigt. Kopieren und direkt weiter mit dem nächsten Absatz.

**Als Secret eingeben**, im eigenen Terminal:
```bash
gh secret set CLOUDFLARE_API_TOKEN -R juliankkrueger/event-galerie
```
gh fragt den Wert verdeckt ab. Einfügen, Enter. Danach die Zwischenablage mit irgendeinem anderen Text überschreiben.

**Account-ID**: im Dashboard Workers & Pages öffnen, rechts unter „Account Details“ den Kopier-Knopf neben Account ID drücken (oder überall Cmd+K, „Copy account ID“). Dann:
```bash
gh secret set CLOUDFLARE_ACCOUNT_ID -R juliankkrueger/event-galerie
```

## E. Krüger OS verbinden

**Fein granuliertes GitHub-Token**
1. https://github.com/settings/personal-access-tokens/new
2. Token name `krueger-os event-galerie`, **Resource owner:** `juliankkrueger`.
3. Expiration: höchstens 366 Tage. Ablaufdatum in den Kalender.
4. Repository access: **Only select repositories** > `event-galerie`.
5. Permissions > Repository permissions: **Actions: Read and write**. **Metadata: Read-only** setzt GitHub von selbst. Sonst nichts.
6. Generate token.

**Im OS eintragen**: Krüger OS > Integrationen > Eintrag „Event-Galerie (GitHub)“ (Schlüssel `github_event_galerie`) > Token einfügen > Speichern. Das OS speichert es verschlüsselt.

**Umgebungsvariable des OS-Backends** (beim Hoster des Krüger OS, Dienst Backend > Variables > New Variable):
`EVENT_GALLERY_REPO` = `juliankkrueger/event-galerie` > Deploy bestätigen.

**Galerie-Schlüssel**: steht schon im OS, wenn Schritt A bis zum Ende lief (Integrationen > „Event-Galerie Schlüssel“). Fehlt er dort, Schritt A mit `--neuer-schluessel` wiederholen: ein GitHub-Secret lässt sich nicht auslesen.

**Probe**: im OS bei einem Test-Event Reiter Fotogalerie einen Ordner mit drei Fotos bauen. Danach ist die Galerie unter `https://fotos-ambition-circle.pages.dev` bzw. `https://fotos-blueprint-summit.pages.dev` erreichbar. Die Seite muss den Code abfragen. Im OS muss der Bericht lesbar sein (sonst passt der Galerie-Schlüssel nicht).

## F. Werkzeug `galerie` (Hauptweg für neue Galerien)

Auf dem Rechner, auf dem Schritt A lief (dort liegt der Galerie-Schlüssel im Schlüsselbund):

```bash
cd event-galerie/werkzeug && npm ci                     # einmal, lädt qrcode
ln -s "$PWD/galerie" /usr/local/bin/galerie              # oder ein anderer Ordner im PATH
gcloud auth login --enable-gdrive-access                # Agentur-Konto, Drive-Recht für Prüfen und Kopieren
galerie liste                                           # muss ohne Fehler laufen
```

Beim ersten `galerie neu` legt das Werkzeug `~/.config/event-galerie/konfig.json` an (ID der Geteilten Ablage, Repo). Findet es die Ablage nicht eindeutig (genau eine Geteilte Ablage mit „Foto“ oder „Galerie“ im Namen), einmal `EVENT_GALERIE_ABLAGE=<ID>` setzen oder die ID dort eintragen. Die ID gehört nicht ins Repo.

Eigene Domains und DNS-Einträge sind nicht mehr nötig: jede Galerie läuft unter `https://<projekt>.pages.dev` (Entscheidung 06.10.2026).

---

## Was danach regelmäßig ansteht

- GitHub-Token im OS vor Ablauf erneuern (Schritt E, höchstens 366 Tage).
- Cloudflare-Token erneuern, falls mit TTL angelegt (Schritt D).
- Neue Marke: [NEUE-MARKE.md](NEUE-MARKE.md), kein DNS nötig.
- Galerie-Schlüssel nur bei Verdacht rotieren (Schritt A mit `--neuer-schluessel`).
