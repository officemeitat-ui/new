#!/usr/bin/env bash
# Neue Version einspielen: als root auf dem Server ausführen („sudo /opt/cockpit/app/deploy/update.sh“).
set -euo pipefail

app=/opt/cockpit/app
[[ $EUID -eq 0 ]] || { echo "Bitte mit sudo ausführen." >&2; exit 1; }

sudo -u cockpit /opt/cockpit/app/deploy/backup.sh
sudo -u cockpit git -C "$app" pull --ff-only
sudo -u cockpit bash -c "cd '$app' && npm ci --no-audit --no-fund && npm run build"
cp "$app/deploy/cockpit.service" /etc/systemd/system/cockpit.service
cp "$app/deploy/cockpit.cron" /etc/cron.d/cockpit
systemctl daemon-reload
systemctl restart cockpit
echo "Aktualisiert: $(sudo -u cockpit git -C "$app" log -1 --format='%h %s')"
