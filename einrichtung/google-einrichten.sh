#!/usr/bin/env bash
# Event-Galerie: Google Cloud einrichten (einmalig, beliebig oft wiederholbar).
#
# Legt an, was GitHub Actions braucht, um die Fotos aus der Geteilten Ablage
# zu lesen, ganz ohne Schlüsseldatei:
#   Projekt (ohne Abrechnung) > APIs > Dienstkonto ohne Rollen > Workload
#   Identity Pool "github" mit OIDC-Provider > Recht zum Annehmen des
#   Dienstkontos nur für das Repo OWNER/event-galerie.
#
# Aufruf:  ./google-einrichten.sh [OWNER] [PROJEKT]
#   OWNER    GitHub-Konto, dem das Repo gehört, Standard juliankkrueger
#   PROJEKT  Google-Cloud-Projekt-ID, Standard ak-event-galerie
#
# Angenommen wird das Dienstkonto nur, wenn alles zusammenpasst:
#   assertion.repository_id == <numerische Repo-ID>   (überlebt Umbenennen, kein Namensklau)
#   assertion.event_name    == workflow_dispatch      (kein push, kein pull_request)
#   assertion.ref           == refs/heads/main
# Die Repo-ID holt das Skript per gh. Das Repo muss also schon existieren
# (erst ./github-einrichten.sh, dann dieses Skript).
#
# Voraussetzung: gcloud auth login und gh auth login (im eigenen Terminal, Browser).
# Das Skript gibt keine Geheimnisse aus. Es erzeugt keine Schlüssel und
# verknüpft kein Rechnungskonto.
set -euo pipefail

OWNER="juliankkrueger"
PROJEKT="ak-event-galerie"
if [ "$#" -ge 1 ]; then OWNER="$1"; fi
if [ "$#" -ge 2 ]; then PROJEKT="$2"; fi
WORKSPACE_DOMAIN="agenturkrueger-digital.de"
SA_NAME="event-galerie"
POOL="github"
PROVIDER="github"
ISSUER="https://token.actions.githubusercontent.com"
WARTEZEIT="$(printenv WARTEZEIT || echo 10)"   # Tests setzen 0
APIS="drive.googleapis.com iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com"

schritt() { printf '\n== %s\n' "$*"; }
info()    { printf '   %s\n' "$*"; }
warnung() { printf '   ACHTUNG: %s\n' "$*" >&2; }
abbruch() { printf '\nABBRUCH: %s\n' "$*" >&2; exit 1; }

# Wiederholt einen Befehl, solange Google eine frisch angelegte Ressource
# noch nicht überall kennt (IAM braucht dafür meist einige Sekunden).
wiederholen() {
  local versuch=1
  until "$@"; do
    if [ "$versuch" -ge 6 ]; then return 1; fi
    info "noch nicht bereit, neuer Versuch in ${WARTEZEIT} s (${versuch}/5)"
    sleep "$WARTEZEIT"
    versuch=$((versuch + 1))
  done
}

# ---------------------------------------------------------------- Prüfungen
if ! printf '%s' "$OWNER" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'; then
  abbruch "\"$OWNER\" ist kein gültiger GitHub-Kontoname."
fi
if ! printf '%s' "$PROJEKT" | grep -Eq '^[a-z][a-z0-9-]{4,28}[a-z0-9]$'; then
  abbruch "\"$PROJEKT\" ist keine gültige Projekt-ID (6 bis 30 Zeichen, a-z, 0-9, Bindestrich)."
fi
command -v gcloud >/dev/null 2>&1 || abbruch "gcloud fehlt. Installieren: brew install --cask google-cloud-sdk"
command -v gh >/dev/null 2>&1 || abbruch "gh fehlt. Installieren: brew install gh"

REPO="$OWNER/event-galerie"
SA_EMAIL="$SA_NAME@$PROJEKT.iam.gserviceaccount.com"

schritt "GitHub-Repo $REPO"
gh auth status >/dev/null 2>&1 || abbruch "gh ist nicht angemeldet. Erst im eigenen Terminal: gh auth login"
REPO_ID="$(gh api "repos/$REPO" --jq .id 2>/dev/null || true)"
if ! printf '%s' "$REPO_ID" | grep -Eq '^[0-9]{1,15}$'; then
  abbruch "Repo $REPO nicht gefunden. Erst ./github-einrichten.sh $OWNER, dann dieses Skript."
fi
info "Repo-ID $REPO_ID (an diese Zahl bindet Google, nicht an den Namen)"

schritt "Anmeldung"
KONTO="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n 1)"
if [ -z "$KONTO" ]; then
  abbruch "gcloud ist nicht angemeldet. Erst im eigenen Terminal: gcloud auth login"
fi
info "angemeldet als $KONTO"
case "$KONTO" in
  *"@$WORKSPACE_DOMAIN") ;;
  *) warnung "Das ist kein Konto von $WORKSPACE_DOMAIN. Das Projekt landet dann nicht in der Agentur-Organisation." ;;
esac

# ---------------------------------------------------------------- Organisation
schritt "Google-Cloud-Organisation"
ORG_ID="$(gcloud organizations list --filter="displayName=$WORKSPACE_DOMAIN" --format='value(name.basename())' 2>/dev/null | head -n 1 || true)"
if [ -z "$ORG_ID" ]; then
  ORG_ID="$(gcloud organizations list --format='value(name.basename())' 2>/dev/null | head -n 1 || true)"
fi
if [ -n "$ORG_ID" ]; then
  info "Organisation $ORG_ID gefunden, das Projekt kommt darunter."
else
  warnung "Keine Organisation sichtbar. Das Projekt wird ohne Organisation angelegt."
fi

# ---------------------------------------------------------------- Projekt
schritt "Projekt $PROJEKT"
ZUSTAND="$(gcloud projects describe "$PROJEKT" --format='value(lifecycleState)' 2>/dev/null || true)"
case "$ZUSTAND" in
  ACTIVE)
    info "existiert bereits" ;;
  DELETE_REQUESTED)
    info "war zum Löschen vorgemerkt, wird wiederhergestellt"
    gcloud projects undelete "$PROJEKT" --quiet ;;
  "")
    info "wird angelegt (ohne Rechnungskonto)"
    if [ -n "$ORG_ID" ]; then
      ANLEGEN_OK=1
      gcloud projects create "$PROJEKT" --name="AK Event-Galerie" --organization="$ORG_ID" --quiet || ANLEGEN_OK=0
    else
      ANLEGEN_OK=1
      gcloud projects create "$PROJEKT" --name="AK Event-Galerie" --quiet || ANLEGEN_OK=0
    fi
    if [ "$ANLEGEN_OK" -ne 1 ]; then
      abbruch "Projekt ließ sich nicht anlegen. Häufigste Gründe:
  1. Die ID $PROJEKT ist weltweit schon vergeben. Dann mit anderer ID: ./google-einrichten.sh $OWNER ak-event-galerie-2
  2. Die Nutzungsbedingungen von Google Cloud sind noch nicht bestätigt. Einmal https://console.cloud.google.com öffnen, bestätigen, Skript neu starten.
  3. Dem Konto fehlt die Rolle Projektersteller in der Organisation (IAM der Organisation in der Cloud Console)."
    fi ;;
  *)
    abbruch "Projekt $PROJEKT steht auf \"$ZUSTAND\"." ;;
esac

PROJEKT_NR="$(gcloud projects describe "$PROJEKT" --format='value(projectNumber)')"
[ -n "$PROJEKT_NR" ] || abbruch "Projektnummer nicht lesbar."
info "Projektnummer $PROJEKT_NR"
if [ -n "$ORG_ID" ]; then
  ELTERN="$(gcloud projects describe "$PROJEKT" --format='value(parent.id)' 2>/dev/null || true)"
  if [ "$ELTERN" != "$ORG_ID" ]; then
    if [ -z "$ELTERN" ]; then ELTERN="keine"; fi
    warnung "Das Projekt hängt nicht unter der Organisation $ORG_ID (sondern: \"$ELTERN\"). Die Domänenbeschränkung kann dann die Freigabe für GitHub blockieren."
  fi
fi

# ---------------------------------------------------------------- APIs
schritt "APIs einschalten"
# shellcheck disable=SC2086
gcloud services enable $APIS --project="$PROJEKT" --quiet
info "aktiv: $APIS"

# ---------------------------------------------------------------- Dienstkonto
schritt "Dienstkonto $SA_EMAIL"
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJEKT" >/dev/null 2>&1; then
  info "existiert bereits"
else
  gcloud iam service-accounts create "$SA_NAME" --project="$PROJEKT" \
    --display-name="Event-Galerie (liest Fotos)" \
    --description="Liest die Geteilte Ablage der Event-Galerie. Keine Rollen, keine Schlüssel, Zugang nur über GitHub Actions." \
    --quiet
  info "angelegt"
fi
wiederholen gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJEKT" --format='value(email)' >/dev/null \
  || abbruch "Dienstkonto ist nach dem Anlegen nicht sichtbar."

SCHLUESSEL="$(gcloud iam service-accounts keys list --iam-account="$SA_EMAIL" --project="$PROJEKT" --managed-by=user --format='value(name.basename())' 2>/dev/null || true)"
if [ -n "$SCHLUESSEL" ]; then
  warnung "Das Dienstkonto hat selbst erzeugte Schlüssel. Die gehören hier nicht hin. Löschen mit:"
  for k in $SCHLUESSEL; do
    info "gcloud iam service-accounts keys delete $k --iam-account=$SA_EMAIL --project=$PROJEKT"
  done
else
  info "keine Schlüssel (so soll es sein)"
fi

ROLLEN="$(gcloud projects get-iam-policy "$PROJEKT" --flatten='bindings[].members' \
  --filter="bindings.members:serviceAccount:$SA_EMAIL" --format='value(bindings.role)' 2>/dev/null || true)"
if [ -n "$ROLLEN" ]; then
  warnung "Das Dienstkonto hat Projektrollen, es braucht keine: $(printf '%s' "$ROLLEN" | tr '\n' ' ')"
else
  info "keine Projektrollen (so soll es sein)"
fi

# ---------------------------------------------------------------- Pool
schritt "Workload Identity Pool $POOL"
POOL_ZUSTAND="$(gcloud iam workload-identity-pools describe "$POOL" --project="$PROJEKT" --location=global --format='value(state)' 2>/dev/null || true)"
case "$POOL_ZUSTAND" in
  ACTIVE) info "existiert bereits" ;;
  DELETED)
    info "war gelöscht, wird wiederhergestellt"
    gcloud iam workload-identity-pools undelete "$POOL" --project="$PROJEKT" --location=global --quiet ;;
  "")
    gcloud iam workload-identity-pools create "$POOL" --project="$PROJEKT" --location=global \
      --display-name="GitHub Actions" \
      --description="Anmeldung der Event-Galerie-Workflows" --quiet
    info "angelegt" ;;
  *) abbruch "Pool steht auf \"$POOL_ZUSTAND\"." ;;
esac

# ---------------------------------------------------------------- Provider
schritt "OIDC-Provider $PROVIDER (nur Repo $REPO)"
# attribute.repository bleibt nur zur Anzeige in Google-Protokollen; berechtigt wird über repository_id.
ZUORDNUNG="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository=assertion.repository"
BEDINGUNG="assertion.repository_id=='$REPO_ID' && assertion.event_name=='workflow_dispatch' && assertion.ref=='refs/heads/main'"
PROV_ZUSTAND="$(gcloud iam workload-identity-pools providers describe "$PROVIDER" --project="$PROJEKT" --location=global \
  --workload-identity-pool="$POOL" --format='value(state)' 2>/dev/null || true)"
if [ "$PROV_ZUSTAND" = "DELETED" ]; then
  info "war gelöscht, wird wiederhergestellt"
  gcloud iam workload-identity-pools providers undelete "$PROVIDER" --project="$PROJEKT" --location=global \
    --workload-identity-pool="$POOL" --quiet
  PROV_ZUSTAND="ACTIVE"
fi
if [ -z "$PROV_ZUSTAND" ]; then
  wiederholen gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --project="$PROJEKT" --location=global \
    --workload-identity-pool="$POOL" \
    --display-name="GitHub event-galerie" \
    --issuer-uri="$ISSUER" \
    --attribute-mapping="$ZUORDNUNG" \
    --attribute-condition="$BEDINGUNG" --quiet \
    || abbruch "Provider ließ sich nicht anlegen."
  info "angelegt"
else
  # Bei jedem Lauf auf den Sollstand bringen, falls jemand von Hand etwas verstellt hat.
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" --project="$PROJEKT" --location=global \
    --workload-identity-pool="$POOL" \
    --issuer-uri="$ISSUER" \
    --attribute-mapping="$ZUORDNUNG" \
    --attribute-condition="$BEDINGUNG" --quiet >/dev/null
  info "existiert, Zuordnung und Bedingung auf Sollstand gesetzt"
fi
info "Bedingung: $BEDINGUNG"

# ---------------------------------------------------------------- Bindung
schritt "Nur $REPO (ID $REPO_ID) darf das Dienstkonto annehmen"
POOL_PFAD="principalSet://iam.googleapis.com/projects/$PROJEKT_NR/locations/global/workloadIdentityPools/$POOL"
MITGLIED="$POOL_PFAD/attribute.repository_id/$REPO_ID"
wiederholen gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project="$PROJEKT" \
  --role="roles/iam.workloadIdentityUser" \
  --member="$MITGLIED" --quiet >/dev/null \
  || abbruch "Bindung ließ sich nicht setzen. Steht das Projekt unter der Organisation? (siehe Warnung oben)"
info "roles/iam.workloadIdentityUser für $MITGLIED"

# Frühere Bindungen an den Repo-NAMEN (attribute.repository/...) oder an andere Repo-IDs entfernen.
ALTE="$(gcloud iam service-accounts get-iam-policy "$SA_EMAIL" --project="$PROJEKT" --flatten='bindings[].members' \
  --filter="bindings.role:roles/iam.workloadIdentityUser" --format='value(bindings.members)' 2>/dev/null \
  | grep -F "$POOL_PFAD/" | grep -v -x -F "$MITGLIED" || true)"
for alt in $ALTE; do
  if gcloud iam service-accounts remove-iam-policy-binding "$SA_EMAIL" --project="$PROJEKT" \
    --role="roles/iam.workloadIdentityUser" --member="$alt" --quiet >/dev/null; then
    info "alte Bindung entfernt: $alt"
  else
    warnung "alte Bindung ließ sich nicht entfernen: $alt"
  fi
done

FREMDE="$(gcloud iam service-accounts get-iam-policy "$SA_EMAIL" --project="$PROJEKT" --flatten='bindings[].members' \
  --format='value(bindings.members)' 2>/dev/null | grep -v -x -F "$MITGLIED" || true)"
if [ -n "$FREMDE" ]; then
  warnung "Weitere Berechtigte am Dienstkonto, bitte prüfen: $(printf '%s' "$FREMDE" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------- Ergebnis
WIF_PROVIDER="projects/$PROJEKT_NR/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"

schritt "Ergebnis (keine Geheimnisse, nur Adressen)"
info "GCP_WIF_PROVIDER = $WIF_PROVIDER"
info "GCP_SA_EMAIL     = $SA_EMAIL"

if command -v gh >/dev/null 2>&1 && gh repo view "$REPO" >/dev/null 2>&1; then
  gh variable set GCP_WIF_PROVIDER -R "$REPO" --body "$WIF_PROVIDER"
  gh variable set GCP_SA_EMAIL -R "$REPO" --body "$SA_EMAIL"
  info "als Repo-Variablen in $REPO gesetzt"
else
  warnung "Repo $REPO nicht gefunden. Erst ./github-einrichten.sh $OWNER, dann dieses Skript noch einmal."
fi

schritt "Jetzt von Hand"
info "In Google Drive die Geteilte Ablage öffnen > Mitglieder verwalten > $SA_EMAIL als Betrachter hinzufügen."
info "Benachrichtigung abwählen. Details: ANLEITUNG-EINRICHTUNG.md, Schritt C."
