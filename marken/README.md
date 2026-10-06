# Marken der Event-Galerie

Je Marke ein Ordner mit `marke.json` (Aufbau wie in `VERTRAG.md`), Logo und Favicons.

| Datei in `marken/<id>/` | Ziel im Deployment | Hinweis |
|---|---|---|
| `logo.png` | `/assets/logo.png` | 800 px breit, transparent |
| `favicon.ico` | `/favicon.ico` | 32 + 48 px |
| `apple-touch-icon.png` | `/apple-touch-icon.png` | 180 px |
| `favicon-32.png` | `/assets/favicon-32.png` | |
| `favicon-192.png` | `/assets/favicon-192.png` | |

`vorlage/index.html` verlinkt genau diese Pfade. `marke-css.mjs` liefert beides für den Bau:
`markeCss(marke)` schreibt den Inhalt von `/assets/marke.css`, `markeDateien(marke)` die Kopierliste oben.

## CSS-Variablen in `assets/marke.css`

`--grund --flaeche --text --text-leise --akzent --akzent-text --rahmen` (aus `farben`),
`--schrift-titel --schrift-text` (Schriftstapel), `--titel-gewicht --titel-faktor --titel-laufweite`
(Feinabstimmung je Titelschrift), aus dem optionalen Block `stil` außerdem `--rund --knopf-schreibung
--knopf-laufweite --knopf-gewicht --knopf-verlauf --titel-schreibung` und bei `titelVerlauf` eine Regel für
Kupfertitel (`background-clip: text`). Beispiel: `tests/oberflaeche/marke-beispiel.css`.
Erlaubte Schriften: Titel `Unbounded` (200, 500) oder `Italiana`, Text `Open Sans` (400, 500, 600) oder `system-ui`.

`stil` bildet die Event-Seite nach (gemessen 05.10.2026): blueprint-summit.de hat eckige Knöpfe in Versalien
mit 1px Laufweite und Titel in Unbounded 200 Versal, ambition-circle.de eckige Knöpfe in Versalien mit
Kupferverlauf (`#F4CFC0` bis `#B67F67`) und Kupfertitel. Der dunkle Endton ist hier auf `#B9836A` angehoben,
weil `#B67F67` mit `#0E2B2E` nur 4,43:1 erreicht (`tests/bau/marke.test.mjs` prüft jede Verlaufsfarbe).

## Herkunft (geladen am 05.10.2026 von den Live-Seiten)

- Blueprint: Logo `wp-content/uploads/2026/03/blueprint-summit-logo-variante-1-e1772441729598.png` (weiß),
  Favicon aus dem weißen Bildzeichen `blueprint-summit-favicon-variante-1.png` auf deckendem Grund `#072330`.
  Die Live-Seite nutzt als Favicon die dunkle Variante 2; auf dunklen Reiterleisten verschwindet sie, darum hier hell auf dunkel.
- AMBITION: Logo `wp-content/uploads/2026/01/ambition-circle-logo-e1769605027356.png` (Kupferverlauf, transparent).
  `favicon-192.png` und `apple-touch-icon.png` zeigen das runde Signet links im Logo auf deckendem Grund `#0E2B2E`.
  Für `favicon-32.png` und `favicon.ico` (32 + 48) ist das Signet zu fein (bei 16 px nur ein Fleck), dort steht
  seit 05.10.2026 das „a“ der Wortmarke in Kupfer auf `#0E2B2E`, ausgeschnitten aus `logo.png`.
- Impressum und Datenschutz verlinken beide Live-Seiten auf `agenturkrueger-digital.de/impressum/` und `/datenschutz/`.

## Anrede

Beide Event-Seiten duzen (blueprint-summit.de: 25 Du-Formen gegen 3 Sie-Formen, ambition-circle.de: 13 gegen 2 Sie-Formen,
die sich dort auf die Mentoren beziehen). Die Galerie duzt deshalb, so steht es auch im Vertrag.

## Kontrast (WCAG, gemessen)

| | Text/Grund | Text leise/Fläche | Akzent/Grund | Akzent-Text/Akzent |
|---|---|---|---|---|
| ambition | 12,1 | 6,9 | 6,0 | 6,0 |
| blueprint | 15,2 | 7,5 | 8,6 | 8,6 |
