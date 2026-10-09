# Neues Event: Galerie in einem Schritt

Nach jedem Event, für eigene Events (AMBITION Circle, Blueprint Summit) und für Kunden-Events. Jede Galerie bekommt ihre eigene Adresse `https://<projekt>.pages.dev`, beliebig viele können gleichzeitig online sein. Galerien laufen **nicht** von selbst ab, offline gehen sie nur auf ausdrücklichen Wunsch.

## Hauptweg: Werkzeug `galerie`

Gebraucht werden nur der Link zum Drive-Ordner mit den Fotos und ein Titel. Einmalige Einrichtung: [ANLEITUNG-EINRICHTUNG.md](ANLEITUNG-EINRICHTUNG.md), Schritt F.

```bash
galerie neu "https://drive.google.com/drive/folders/<ordner>" --titel "Sommerfest Muster GmbH 2026"
galerie neu "<link>" --titel "AMBITION Circle 2026" --marke ambition
```

| Schalter | Bedeutung |
|---|---|
| `--marke` | `agentur` (Standard, neutral für Kunden-Events), `ambition`, `blueprint` oder eine eigene Kunden-Marke ([NEUE-MARKE.md](NEUE-MARKE.md)) |
| `--projekt` | eigener Projektname `fotos-…`; sonst `fotos-<titel>-<4 Zeichen>` |
| `--ablauf` | nur wenn die Galerie wirklich ablaufen soll, ISO mit Zeitzone, z. B. `2027-01-31T23:59:59+01:00` |

Was das Werkzeug tut, ohne Klick:
1. Prüft `gh`, `gcloud` (mit Drive-Recht) und den Galerie-Schlüssel im Schlüsselbund. Fehlt etwas, sagt es, mit welchem Befehl man es behebt.
2. Liegt der Ordner nicht in der Geteilten Ablage „01 | Krüger OS - Intern“, kopiert es ihn dorthin nach „Events“ (in Drive, ohne Download; ein zweiter Aufruf kopiert nichts doppelt). Am besten gleich dort ablegen: Events › <Event> › <Jahr> › FOTOS. Dann gibt es dem Dienstkonto Leserecht auf genau diesen Ordner.
3. Erzeugt Galerie-ID, Projektname und Code, startet den Bau auf GitHub und zeigt den Fortschritt.
4. Liest den verschlüsselten Bericht: Anzahl Fotos, Größe, übersprungene Dateien, **Fotos mit Standortdaten** (die Vorschauen sind bereinigt, die Originale nicht).
5. Prüft die fertige Galerie live: Startseite, falscher Code abgewiesen, richtiger Code angenommen, Anzahl stimmt, drei Originale byte-gleich.
6. Gibt Link, Code, QR-Code (PNG und SVG) und einen fertigen Text für die Gäste aus. Die Dateien liegen in `~/Downloads/Galerie-<titel>/`.

Fotos in Drive: JPG, PNG und HEIC, andere Dateien werden übergangen. **Kapitel** entstehen aus Unterordnern (`Mittwoch/Tag` wird „Mittwoch · Tag“). Höchstens etwa 4.900 Fotos je Galerie, doppelte zählen einmal. Dauer: 670 Fotos mit 8,9 GB brauchten 5 Minuten Bau.

## Danach

| Fall | Befehl |
|---|---|
| Fotos kamen dazu oder eines muss raus | in Drive ändern, dann `galerie neu-bauen <projekt>` (Link und Code bleiben) |
| Alle Galerien und ihr Stand | `galerie liste` |
| Link und Code wiederfinden | `galerie status <projekt>` |
| Vom Netz nehmen, Adresse behalten | `galerie offline <projekt>` |
| Ganz löschen | `galerie loeschen <projekt>` (fragt nach) |

**Ein Gast möchte ein Foto entfernt haben:** Foto in der Geteilten Ablage löschen (Papierkorb reicht), `galerie neu-bauen <projekt>`, dem Gast kurz bestätigen. Gleicher Link und Code, die Gäste merken nur, dass das Foto fehlt. Bitte am selben Tag erledigen.

Die Galerie ist nicht über Google auffindbar. Wer Link oder Code hat, sieht alle Fotos.

## Zweitweg: Krüger OS

Für AMBITION Circle und Blueprint Summit geht es weiter im Browser: Krüger OS > Events > Event > Reiter **Fotogalerie**, Drive-Link einfügen, Ablauf wählen (oder „nie“), **Bauen**. Das OS nutzt je Marke ein festes Projekt (`fotos-ambition-circle.pages.dev`, `fotos-blueprint-summit.pages.dev`), dort ist je Marke immer nur **eine** Galerie online; eine neue ersetzt die alte. Link mit Code und QR-Code gibt es im OS, in Teilnehmer-Nachrichten über „Galerie-Link einsetzen“.

## Wenn etwas hakt

- **Bau rot:** Das Werkzeug zeigt den Schritt, den Fehler aus dem Bericht und einen Auszug aus dem Log. Häufig: Ordner nicht freigegeben oder leer.
- **„Vorbedingungen fehlen“:** den angezeigten Befehl ausführen (z. B. `gh auth login` oder `gcloud auth login --enable-gdrive-access`).
- **„Zu viele Versuche“ bei Gästen:** zehn Minuten warten, dann geht die Eingabe wieder.
