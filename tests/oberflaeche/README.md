# Tests der Gäste-Oberfläche

```bash
cd tests/oberflaeche
npm install
npx playwright install chromium   # einmalig
npm test                          # Unit-Tests (node --test) und Playwright (Desktop, iPhone 13, Pixel 7)
npm run mock                      # Mock zum Ansehen: http://127.0.0.1:8788/#c=GAST2345
```

- `mock-server.mjs` liefert `vorlage/` mit der CSP aus dem Vertrag aus, beantwortet `/api/status`, `/api/zugang`,
  `/api/manifest` wie im Vertrag (inkl. 1 s Verzögerung, 429 ab 5 Fehlversuchen) und erzeugt 40 synthetische Bilder
  (Originale in Teile zu 150 KB zerlegt, doppelte Namen, ein PNG). Steuerung: `POST /__mock`.
- `manifest-beispiel.json`: gekürztes Manifest aus dem Mock. `marke-beispiel.css`: Beispiel für `assets/marke.css`.
- `npm run integration`: echte Baukette (`bau/bau.mjs`, Quelle `ordner:`) und echte Function mit der Oberfläche, ZIP md5 je Datei gegen die Quelle.
- Screenshots landen in `screens/`, ZIP-Dateien und Prüfergebnisse in `.ergebnisse/` (beides nicht im Git).
- `echt.mjs`: Ende-zu-Ende gegen ein laufendes Deployment (`wrangler pages dev` oder pages.dev) mit den großen Testfotos aus `tests/testbilder.mjs`, siehe LIESMICH.md, Abschnitt Tests. Ergebnisse in `tests/ergebnisse/<name>/`.
