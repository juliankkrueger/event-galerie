#!/usr/bin/env bash
# Event-Galerie: GitHub einrichten (einmalig, beliebig oft wiederholbar).
#
# Aufruf:  ./github-einrichten.sh [OWNER] [--neuer-schluessel]
#   OWNER               GitHub-Konto, Standard juliankkrueger
#   --neuer-schluessel  GALERIE_SCHLUESSEL neu erzeugen (Rotation), auch wenn es ihn gibt
#
# Was passiert:
#   1. Prüft die gh-Anmeldung (muss OWNER sein).
#   2. Prüft den lokalen Zweig main: keine Geheimnis-Dateien, keine Bau- und Testreste,
#      keine Lecks (gitleaks, falls installiert). Nur main geht hinaus; der lokale Zweig
#      historie-intern (alte Historie) wird nie gepusht, ein pre-push-Hook sperrt ihn.
#   3. Legt OWNER/event-galerie ÖFFENTLICH an (nur nach ausdrücklichem j) und pusht main.
#   4. Actions: nur GitHub-eigene Actions plus google-github-actions/auth, nur auf Commit-SHA,
#      Workflow-Token nur Lesen, Workflows aus Fork-PRs brauchen immer Freigabe.
#   5. Erzeugt GALERIE_SCHLUESSEL (32 Byte), setzt ihn als Secret, legt ihn in die
#      Schlüsselbundverwaltung und in die Zwischenablage (fürs Krüger OS). Ausgegeben wird er nie.
#   6. Zeigt, welche Variablen und Secrets noch fehlen.
#
# Die Cloudflare-Secrets setzt dieses Skript NICHT. Die gibst du selbst ein:
#   gh secret set CLOUDFLARE_API_TOKEN -R OWNER/event-galerie
# (gh fragt den Wert verdeckt ab, er landet weder in Datei noch im Verlauf).
set -euo pipefail

OWNER="juliankkrueger"
NEUER_SCHLUESSEL=0
for arg in "$@"; do
  case "$arg" in
    --neuer-schluessel) NEUER_SCHLUESSEL=1 ;;
    -*) printf 'Unbekannte Option %s\n' "$arg" >&2; exit 2 ;;
    *) OWNER="$arg" ;;
  esac
done
HIER="$(cd "$(dirname "$0")" && pwd)"
QUELLE="$(cd "$HIER/.." && pwd)"
KEYCHAIN_DIENST="webwerkstatt:agentur:event-galerie-schluessel"
KEYCHAIN_KONTO="julian"
HOOK_MARKE="# event-galerie: nur main hinaus"

schritt() { printf '\n== %s\n' "$*"; }
info()    { printf '   %s\n' "$*"; }
warnung() { printf '   ACHTUNG: %s\n' "$*" >&2; }
abbruch() { printf '\nABBRUCH: %s\n' "$*" >&2; exit 1; }
frage_jn() {
  # Nur ein ausdrückliches j gilt als Ja.
  local antwort=""
  [ -t 0 ] || abbruch "Rückfrage nötig, aber keine Eingabe möglich. Bitte im eigenen Terminal starten."
  printf '\n   %s (j/n) ' "$1"
  read -r antwort
  [ "$antwort" = "j" ] || [ "$antwort" = "J" ]
}

if ! printf '%s' "$OWNER" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'; then
  abbruch "\"$OWNER\" ist kein gültiger GitHub-Kontoname."
fi
REPO="$OWNER/event-galerie"
for werkzeug in gh git openssl; do
  command -v "$werkzeug" >/dev/null 2>&1 || abbruch "$werkzeug fehlt. Installieren: brew install $werkzeug"
done

# ---------------------------------------------------------------- Konto
schritt "GitHub-Anmeldung"
gh auth status >/dev/null 2>&1 || abbruch "gh ist nicht angemeldet. Erst: gh auth login"
ICH="$(gh api user --jq .login)"
info "angemeldet als $ICH"
if [ "$ICH" != "$OWNER" ]; then
  abbruch "Das Repo gehört $OWNER, angemeldet ist aber $ICH. Erst: gh auth switch, oder OWNER passend angeben."
fi

# ---------------------------------------------------------------- Lokales Repo prüfen
schritt "Lokales Repo $QUELLE"
git -C "$QUELLE" rev-parse --git-dir >/dev/null 2>&1 || abbruch "$QUELLE ist kein Git-Repo."
git -C "$QUELLE" rev-parse --verify -q refs/heads/main >/dev/null || abbruch "Es gibt keinen Zweig main."
info "main: $(git -C "$QUELLE" rev-list --count refs/heads/main) Commit(s)"

# Nur Dateinamen prüfen, nie Inhalte lesen.
VERBOTEN="$(git -C "$QUELLE" ls-tree -r --name-only refs/heads/main | grep -Ei '(^|/)(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|config\.secret.*|credentials.*|secrets?\..*|.*\.token|\.npmrc|\.netrc|\.testcode|gha-creds-.*\.json)$|(^|/)(node_modules|dist|dist-[^/]*|\.wrangler|screens|test-results|playwright-report|\.ergebnisse)/|(^|/)tests/(ergebnisse|bilder)/|(^|/)bericht\.(json|enc)$' | grep -Ev '\.example$' || true)"
if [ -n "$VERBOTEN" ]; then
  abbruch "Diese Dateien dürfen nicht ins öffentliche Repo (aus Git entfernen und in .gitignore aufnehmen):
$VERBOTEN"
fi
info "keine Geheimnis-, Bau- oder Testreste in main"

if git -C "$QUELLE" rev-parse --verify -q refs/heads/historie-intern >/dev/null; then
  if [ -n "$(git -C "$QUELLE" merge-base refs/heads/main refs/heads/historie-intern 2>/dev/null || true)" ]; then
    abbruch "main teilt Commits mit historie-intern. Die interne Historie darf nicht hinaus."
  fi
  info "historie-intern bleibt lokal (keine gemeinsamen Commits mit main)"
fi

if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks git "$QUELLE" --log-opts="refs/heads/main" --redact --no-banner --log-level error >/dev/null 2>&1; then
    info "gitleaks: keine Funde in main"
  else
    abbruch "gitleaks meldet Funde in main. Prüfen mit: gitleaks git --log-opts=refs/heads/main --redact"
  fi
else
  warnung "gitleaks nicht installiert (brew install gitleaks), Leckprüfung übersprungen."
fi

if [ -n "$(git -C "$QUELLE" status --porcelain)" ]; then
  warnung "Es gibt nicht committete Änderungen. Hochgeladen wird nur, was in main committet ist."
fi

# Sperre gegen versehentliches Pushen anderer Zweige (lokal, nicht im Repo).
HOOK_DIR="$(cd "$QUELLE" && git rev-parse --git-path hooks)"
case "$HOOK_DIR" in /*) ;; *) HOOK_DIR="$QUELLE/$HOOK_DIR" ;; esac
if [ -d "$HOOK_DIR" ]; then HOOK_DIR="$(cd "$HOOK_DIR" && pwd -P)"; fi
HOOK="$HOOK_DIR/pre-push"
GIT_DIR_ABS="$(cd "$(git -C "$QUELLE" rev-parse --absolute-git-dir)" && pwd -P)"
case "$HOOK" in
  "$GIT_DIR_ABS"/*) HOOK_LOKAL=1 ;;
  *) HOOK_LOKAL=0 ;;
esac
if [ "$HOOK_LOKAL" -eq 0 ]; then
  # Gemeinsamer Hook-Ordner (core.hooksPath, z. B. eine Wache für alle Repos): dort nichts ändern.
  info "Hooks kommen aus $(dirname "$HOOK") (core.hooksPath), dort ändert das Skript nichts."
  info "Schutz stattdessen: remote.origin.push nur main, Push nur von main (siehe unten)."
elif [ -f "$HOOK" ] && ! grep -qF "$HOOK_MARKE" "$HOOK"; then
  warnung "Es gibt schon einen eigenen pre-push-Hook, er bleibt. Bitte selbst sicherstellen, dass nur main hinausgeht."
else
  mkdir -p "$(dirname "$HOOK")"
  cat > "$HOOK" <<HOOK_ENDE
#!/bin/sh
$HOOK_MARKE
# Das GitHub-Repo ist öffentlich. Nur main darf hinaus, die interne Historie nie.
while read -r lokal_ref lokal_sha fern_ref fern_sha; do
  case "\$fern_ref" in
    refs/heads/main) ;;
    *) echo "pre-push: nur main darf nach GitHub, nicht \$fern_ref" >&2; exit 1 ;;
  esac
  case "\$lokal_sha" in *[!0]*) ;; *) continue ;; esac
  if git rev-parse -q --verify refs/heads/historie-intern >/dev/null \\
    && [ -n "\$(git merge-base "\$lokal_sha" refs/heads/historie-intern 2>/dev/null)" ]; then
    echo "pre-push: dieser Stand enthält Commits aus historie-intern, abgebrochen" >&2
    exit 1
  fi
done
exit 0
HOOK_ENDE
  chmod +x "$HOOK"
  info "pre-push-Hook gesetzt: nur main geht hinaus"
fi

# ---------------------------------------------------------------- Repo anlegen
schritt "Repo $REPO"
if gh repo view "$REPO" >/dev/null 2>&1; then
  info "existiert bereits, wird nicht neu angelegt"
else
  if git -C "$QUELLE" remote get-url origin >/dev/null 2>&1; then
    abbruch "Das lokale Repo hat schon ein origin ($(git -C "$QUELLE" remote get-url origin)). Bitte prüfen, bevor etwas hochgeladen wird."
  fi
  info "Das Repo wird ÖFFENTLICH: Code, Workflows, Lauf-Logs und Artefakte kann jeder sehen."
  info "Geheim bleibt nur, was verschlüsselt ist oder als Secret liegt (siehe LIESMICH, Sicherheitsmodell)."
  frage_jn "$REPO jetzt öffentlich anlegen und main hochladen?" || abbruch "Nichts angelegt."
  gh repo create "$REPO" --public \
    --description "Event-Galerie der Agentur Krüger: Fotos für Gäste, statisch auf Cloudflare Pages" \
    --disable-wiki >/dev/null
  info "angelegt (öffentlich)"
fi

if ! git -C "$QUELLE" remote get-url origin >/dev/null 2>&1; then
  git -C "$QUELLE" remote add origin "https://github.com/$REPO.git"
fi
case "$(git -C "$QUELLE" remote get-url origin)" in
  "https://github.com/$REPO.git"|"https://github.com/$REPO"|"git@github.com:$REPO.git") ;;
  *) abbruch "origin zeigt auf $(git -C "$QUELLE" remote get-url origin) statt auf $REPO." ;;
esac
# Ein einfaches "git push" schiebt ab jetzt nur main.
git -C "$QUELLE" config remote.origin.push refs/heads/main:refs/heads/main
git -C "$QUELLE" push --no-follow-tags origin refs/heads/main:refs/heads/main
info "main hochgeladen (nur main, keine Tags)"

gh repo edit "$REPO" --default-branch main --enable-wiki=false --enable-projects=false >/dev/null
SICHTBARKEIT="$(gh repo view "$REPO" --json visibility --jq .visibility)"
info "Sichtbarkeit: $SICHTBARKEIT, Wiki und Projekte aus"
if [ "$SICHTBARKEIT" != "PUBLIC" ]; then
  warnung "Das Repo ist nicht öffentlich. Das funktioniert, verbraucht aber Actions-Minuten des Kontos."
fi

FREMDE_ZWEIGE="$(gh api "repos/$REPO/branches" --jq '.[].name' | grep -vx main || true)"
if [ -n "$FREMDE_ZWEIGE" ]; then
  warnung "Auf GitHub liegen weitere Zweige: $(printf '%s' "$FREMDE_ZWEIGE" | tr '\n' ' '). Prüfen und löschen."
fi

# ---------------------------------------------------------------- Actions
schritt "Actions-Berechtigungen"
gh api -X PUT "repos/$REPO/actions/permissions" \
  -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true >/dev/null \
  || abbruch "Actions-Rechte ließen sich nicht setzen."
printf '{"github_owned_allowed":true,"verified_allowed":false,"patterns_allowed":["google-github-actions/auth@*"]}' \
  | gh api -X PUT "repos/$REPO/actions/permissions/selected-actions" --input - >/dev/null
info "erlaubt: GitHub-eigene Actions und google-github-actions/auth, nur auf Commit-SHA gepinnt"
gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false >/dev/null
info "Workflow-Token standardmäßig nur Lesen, darf keine Pull Requests freigeben"
gh api -X PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" \
  -f approval_policy=all_external_contributors >/dev/null \
  || warnung "Freigabepflicht für Fork-PRs ließ sich nicht setzen (Settings > Actions > General > Approval for running fork pull request workflows > Require approval for all external contributors)."
info "Workflows aus Fork-PRs: Freigabe für alle externen Beitragenden nötig"

WORKFLOWS="$(gh api "repos/$REPO/actions/workflows" --jq '.workflows[].path' 2>/dev/null || true)"
for w in bauen.yml offline.yml; do
  if printf '%s\n' "$WORKFLOWS" | grep -q "/$w\$"; then info "Workflow $w vorhanden"; else warnung "Workflow $w fehlt im Repo"; fi
done

# ---------------------------------------------------------------- Galerie-Schlüssel
schritt "GALERIE_SCHLUESSEL (verschlüsselt Code-Hash und Bericht zwischen OS und GitHub)"
SECRETS="$(gh secret list -R "$REPO" --json name --jq '.[].name' 2>/dev/null || true)"
SECRET_DA=0; KEYCHAIN_DA=0
if printf '%s\n' "$SECRETS" | grep -qx GALERIE_SCHLUESSEL; then SECRET_DA=1; fi
# Nur Metadaten prüfen, nie den Wert lesen.
if security find-generic-password -s "$KEYCHAIN_DIENST" -a "$KEYCHAIN_KONTO" >/dev/null 2>&1; then KEYCHAIN_DA=1; fi

ERZEUGEN=0
if [ "$NEUER_SCHLUESSEL" -eq 1 ]; then
  info "Rotation angefordert. Danach muss der neue Schlüssel ins Krüger OS, sonst scheitern alle Bauläufe."
  frage_jn "Neuen Schlüssel erzeugen und den alten ersetzen?" && ERZEUGEN=1
elif [ "$SECRET_DA" -eq 1 ] && [ "$KEYCHAIN_DA" -eq 1 ]; then
  info "Secret und Schlüsselbund-Eintrag vorhanden, bleiben unverändert (Rotation: --neuer-schluessel)"
elif [ "$SECRET_DA" -eq 0 ] && [ "$KEYCHAIN_DA" -eq 0 ]; then
  ERZEUGEN=1
else
  warnung "Nur eins von beiden vorhanden (Secret: $SECRET_DA, Schlüsselbund: $KEYCHAIN_DA). Ein GitHub-Secret lässt sich nicht auslesen."
  frage_jn "Neuen Schlüssel erzeugen (danach auch im Krüger OS ersetzen)?" && ERZEUGEN=1
fi

if [ "$ERZEUGEN" -eq 1 ]; then
  [ -t 0 ] || abbruch "Für den Schlüssel bitte im eigenen Terminal starten (Zwischenablage und Bestätigung)."
  # Der Wert lebt nur in dieser Variablen. printf und security -i lesen ihn über die Standardeingabe,
  # damit er weder in der Prozessliste noch im Shell-Verlauf steht.
  schluessel_wert="$(openssl rand -base64 32)"
  if ! printf '%s' "$schluessel_wert" | grep -Eq '^[A-Za-z0-9+/]{43}=$'; then
    unset schluessel_wert
    abbruch "openssl lieferte keinen 32-Byte-Schlüssel."
  fi
  if ! printf '%s' "$schluessel_wert" | gh secret set GALERIE_SCHLUESSEL -R "$REPO" >/dev/null; then
    unset schluessel_wert
    abbruch "Secret ließ sich nicht setzen. Nichts geändert."
  fi
  info "GitHub-Secret GALERIE_SCHLUESSEL gesetzt"
  if printf 'add-generic-password -U -s %s -a %s -w %s\n' "$KEYCHAIN_DIENST" "$KEYCHAIN_KONTO" "$schluessel_wert" | security -i >/dev/null 2>&1 \
    && security find-generic-password -s "$KEYCHAIN_DIENST" -a "$KEYCHAIN_KONTO" >/dev/null 2>&1; then
    info "Schlüsselbund: $KEYCHAIN_DIENST (Konto $KEYCHAIN_KONTO)"
  else
    warnung "Schlüsselbund-Eintrag ließ sich nicht schreiben. Der Schlüssel steht gleich trotzdem in der Zwischenablage."
  fi
  zwischenablage_leeren() { pbcopy < /dev/null 2>/dev/null || true; }
  # Auch bei Abbruch (Strg+C, Fehler) bleibt der Schlüssel nicht in der Zwischenablage.
  trap zwischenablage_leeren EXIT
  trap 'zwischenablage_leeren; exit 130' INT TERM
  printf '%s' "$schluessel_wert" | pbcopy
  unset schluessel_wert
  info ""
  info "Der Schlüssel liegt jetzt in der Zwischenablage."
  info "Jetzt im Krüger OS unter Integrationen bei Event-Galerie Schlüssel einfügen und speichern."
  printf '\n   Enter drücken, sobald er im OS gespeichert ist. Danach wird die Zwischenablage geleert. '
  read -r _ || true
  zwischenablage_leeren
  trap - EXIT INT TERM
  info "Zwischenablage geleert"
fi

# ---------------------------------------------------------------- Variablen und Secrets
schritt "Variablen (öffentliche Adressen, keine Geheimnisse)"
VARIABLEN="$(gh variable list -R "$REPO" --json name --jq '.[].name' 2>/dev/null || true)"
FEHLT_VAR=0
for v in GCP_WIF_PROVIDER GCP_SA_EMAIL; do
  if printf '%s\n' "$VARIABLEN" | grep -qx "$v"; then info "$v gesetzt"; else info "$v fehlt"; FEHLT_VAR=1; fi
done
if [ "$FEHLT_VAR" -eq 1 ]; then
  info "Die setzt ./google-einrichten.sh $OWNER automatisch."
fi

schritt "Cloudflare-Secrets (setzt du selbst, das Skript liest und schreibt keine)"
SECRETS="$(gh secret list -R "$REPO" --json name --jq '.[].name' 2>/dev/null || true)"
for s in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
  if printf '%s\n' "$SECRETS" | grep -qx "$s"; then
    info "$s gesetzt"
  else
    info "$s fehlt. Im eigenen Terminal (gh fragt den Wert verdeckt ab):"
    info "  gh secret set $s -R $REPO"
  fi
done
info "Wie du beide Werte bekommst: ANLEITUNG-EINRICHTUNG.md, Schritt D."

schritt "Fertig"
info "Repo: https://github.com/$REPO"
info "Nächster Schritt: gcloud auth login, dann ./google-einrichten.sh $OWNER"
