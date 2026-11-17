#!/usr/bin/env bash
# Ruft eine Cron-Route des Cockpits auf, z. B. „cron.sh mail“. Nicht eingerichtete Funktionen (HTTP 503) bleiben still.
set -euo pipefail

route="${1:?Aufruf: cron.sh <mail|atera|reminders|followups|report>}"
env_file="${COCKPIT_ENV_FILE:-/etc/cockpit.env}"
base_url="${COCKPIT_URL:-http://127.0.0.1:3000}"

secret="$(grep -E '^CRON_SECRET=' "$env_file" | head -n1 | cut -d= -f2- | tr -d '"'"'")"
if [[ -z "$secret" ]]; then
  logger -t cockpit-cron "CRON_SECRET fehlt in $env_file"
  exit 1
fi

out="$(mktemp)"
trap 'rm -f "$out"' EXIT
status="$(curl -sS -o "$out" -w '%{http_code}' -m 290 \
  -H "Authorization: Bearer $secret" "$base_url/api/cron/$route" || echo "000")"
body="$(cat "$out" 2>/dev/null || true)"

case "$status" in
  2??) ;;
  503) ;; # Funktion nicht eingerichtet (z. B. kein Atera-Schlüssel)
  *) logger -t cockpit-cron "/api/cron/$route: HTTP $status ${body:0:300}" ;;
esac
