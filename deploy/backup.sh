#!/usr/bin/env bash
# Nächtliche Sicherung der Datenbank (konsistente Kopie im laufenden Betrieb), 14 Tage aufbewahrt.
set -euo pipefail

db="${COCKPIT_DB:-/var/lib/cockpit/app.db}"
target="${COCKPIT_BACKUP_DIR:-/var/backups/cockpit}"
keep_days="${COCKPIT_BACKUP_DAYS:-14}"

[[ -f "$db" ]] || exit 0
mkdir -p "$target"
file="$target/app-$(date +%F-%H%M).db"
sqlite3 "$db" ".backup '$file'"
gzip -f "$file"
find "$target" -name 'app-*.db.gz' -mtime "+$keep_days" -delete
