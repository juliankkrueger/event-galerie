# Neue Kunden-Marke anlegen (10 Minuten)

Für Kunden, deren Galerie wie ihre eigene Website aussehen soll. Ohne eigene Marke nimmt das Werkzeug `agentur` (neutral, Dunkelblau und Warmgold). Eine Marke ändert nur Farben, Schriften, Logo, Favicon und Fußlinks; Adresse, Code und Ablauf hängen an der Galerie.

## 1. Ordner anlegen (1 Minute)

```bash
cp -R marken/agentur marken/<id>        # id: klein, a-z 0-9 -, z. B. physio-muster
```

In `marken/<id>/marke.json` ändern: `id` (gleich dem Ordnernamen), `name`, `eventSeite` (Website des Kunden), `pagesProjekt` (`fotos-<id>`, nur für den OS-Weg). Kein `domain`.

## 2. Farben von der Kunden-Website (4 Minuten)

Die Website öffnen und die Werte messen statt schätzen, z. B. Seitenquelltext nach `#` durchsuchen:

```bash
curl -sL https://<kundenseite> | grep -Eio '#[0-9a-f]{6}' | sort | uniq -c | sort -rn | head -15
```

| Feld | Was |
|---|---|
| `grund` | dunkler Seitenhintergrund (Fotos wirken auf dunkel am besten; eine dunkle Fassung der Hauptfarbe) |
| `flaeche` | Karten, etwas heller als `grund` |
| `text`, `textLeise` | fast weiß, gedämpft |
| `akzent`, `akzentText` | Knopffarbe und Schrift darauf |
| `rahmen` | Linien |

Pflicht: Kontrast mindestens 4,5:1 für `text`/`grund`, `textLeise`/`flaeche`, `akzent`/`grund`, `akzentText`/`akzent` und jede Farbe in `stil.knopfVerlauf` gegen `akzentText`. `npm test` prüft die Marken `agentur`, `ambition` und `blueprint`; für eine neue Marke den Test in `tests/bau/marke.test.mjs` um die `id` ergänzen.

`stil` (optional) bildet die Knöpfe der Website nach: `knopfEcken` `rund`, `weich` oder `eckig`, `knopfVersal`, `knopfLaufweite`, `knopfGewicht`, `knopfVerlauf`. Freies CSS gibt es nicht.

Schriften: Titel `Cormorant Garamond`, `Italiana` oder `Unbounded`, Text `system-ui` oder `Open Sans` (alle OFL, selbst gehostet). Hat der Kunde eine andere Schrift, die nächstliegende davon nehmen; neue Schriften nur mit freier Lizenz (OFL) unter `marken/schriften/` und einem Eintrag in `marken/marke-css.mjs`.

## 3. Logo und Favicon (4 Minuten)

- `logo.png`: Logo der Website, hell auf transparentem Grund (es steht auf `grund`), 800 px breit.
- `favicon.ico` (32 und 48), `favicon-32.png`, `favicon-192.png`, `apple-touch-icon.png` (180): das **Bildzeichen** der Marke, nicht der Schriftzug (bei 16 px nur ein Fleck), auf deckendem Grund in der Markenfarbe. Vorlage für die Erzeugung mit sharp: so sind die Dateien von `agentur` entstanden (Zeichen auf 82 %, 76 % und 70 % der Fläche).
- Vor dem ersten Einsatz **hinsehen**: Reiter im Browser, iPhone-Startbildschirm.

Logo und Favicon liegen meist unter `wp-content/uploads/…` der Website; die Favicon-Adresse steht im Quelltext (`<link rel="icon" …>`).

## 4. Prüfen und einchecken (1 Minute)

```bash
npm test
node bau/offline.mjs --marke <id> --aus /tmp/marke-probe     # baut die Platzhalterseite, scheitert bei Fehlern
git add marken/<id> && git commit -m "Marke <id>" && git push origin main
```

Danach `galerie neu <link> --titel "…" --marke <id>`. Die Workflows nehmen die Marke aus `main`, also erst nach dem Push bauen.
