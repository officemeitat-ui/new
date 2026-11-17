#!/usr/bin/env bash
# Einrichtung auf einem frischen Linux-Server (z. B. World4You Linux vServer mit Debian 12 oder Ubuntu 24.04).
#
#   sudo bash setup.sh app.firma.at [git-repo] [branch]
#
# Installiert Node.js 22, Caddy (HTTPS mit Let's Encrypt), legt den Benutzer „cockpit“ an, holt den Code,
# baut die App, richtet Dienst, regelmäßige Aufgaben, Datensicherung und Firewall ein. Mehrfach ausführbar.
set -euo pipefail

DOMAIN="${1:-}"
REPO="${2:-git@github.com:officemeitat-ui/new.git}"
BRANCH="${3:-main}"
APP_DIR=/opt/cockpit/app
ENV_FILE=/etc/cockpit.env

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Bitte als root ausführen: sudo bash setup.sh app.firma.at"
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "Aufruf: sudo bash setup.sh app.firma.at [git-repo] [branch]"
command -v apt-get >/dev/null || die "Dieses Skript ist für Debian/Ubuntu gedacht."

say "Systempakete"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git sqlite3 ufw cron debian-keyring debian-archive-keyring apt-transport-https openssl \
  unattended-upgrades # Sicherheitsupdates des Systems automatisch einspielen

say "Node.js 22 (LTS)"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22.* ]]; then
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -y -q nodejs
fi
node -v

say "Caddy (Webserver mit automatischem HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

say "Arbeitsspeicher"
# Das Bauen der App braucht rund 2 GB. Kleine Server bekommen eine Auslagerungsdatei.
if [[ $(awk '/MemTotal/ {print $2}' /proc/meminfo) -lt 3000000 && ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo "2 GB Auslagerungsdatei angelegt"
fi

say "Benutzer und Verzeichnisse"
id cockpit >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/cockpit --shell /bin/bash cockpit
install -d -o cockpit -g cockpit -m 750 /opt/cockpit /var/lib/cockpit /var/backups/cockpit

say "Zugang zum Code (GitHub)"
if [[ ! -d "$APP_DIR/.git" ]]; then
  if [[ "$REPO" == git@* ]]; then
    sudo -u cockpit mkdir -p -m 700 /opt/cockpit/.ssh
    [[ -f /opt/cockpit/.ssh/id_ed25519 ]] || sudo -u cockpit ssh-keygen -q -t ed25519 -N "" -C "cockpit@$DOMAIN" -f /opt/cockpit/.ssh/id_ed25519
    sudo -u cockpit bash -c 'ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null'
    echo
    echo "Diesen Schlüssel im GitHub-Repository unter Settings → Deploy keys hinzufügen (nur Lesezugriff):"
    echo
    cat /opt/cockpit/.ssh/id_ed25519.pub
    echo
    read -r -p "Wenn erledigt, Enter drücken … "
  fi
  sudo -u cockpit git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
else
  sudo -u cockpit git -C "$APP_DIR" fetch origin "$BRANCH"
  sudo -u cockpit git -C "$APP_DIR" checkout "$BRANCH"
  sudo -u cockpit git -C "$APP_DIR" pull --ff-only
fi

say "Konfiguration ($ENV_FILE)"
if [[ ! -f "$ENV_FILE" ]]; then
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  {
    echo "# Konfiguration von Cockpit und Arbeitsplatz. Nach Änderungen: sudo systemctl restart cockpit"
    echo "NODE_ENV=production"
    echo "PUBLIC_URL=https://$DOMAIN"
    echo "DATABASE_URL=file:/var/lib/cockpit/app.db"
    echo "ADMIN_PASSWORD=$ADMIN_PASSWORD"
    echo "SESSION_SECRET=$(openssl rand -hex 32)"
    echo "CRON_SECRET=$(openssl rand -hex 32)"
    echo
    echo "# ── Ab hier eintragen, was genutzt wird (Vorlage mit Erklärungen: $APP_DIR/.env.example) ──"
    echo "ANTHROPIC_API_KEY="
    echo "ATERA_API_KEY="
    echo "MS_TENANT_ID="
    echo "MS_CLIENT_ID="
    echo "MS_CLIENT_SECRET="
    echo "MS_MAILBOX="
    echo "MS_CALENDAR_USER="
  } >"$ENV_FILE"
  echo "Admin-Passwort (jetzt notieren, steht auch in $ENV_FILE): $ADMIN_PASSWORD"
fi
chown root:cockpit "$ENV_FILE"
chmod 640 "$ENV_FILE"

say "App bauen (dauert einige Minuten)"
sudo -u cockpit bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund && npm run build"

say "Dienst, regelmäßige Aufgaben, Webserver"
cp "$APP_DIR/deploy/cockpit.service" /etc/systemd/system/cockpit.service
cp "$APP_DIR/deploy/cockpit.cron" /etc/cron.d/cockpit
chmod 644 /etc/cron.d/cockpit
sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/Caddyfile" >/etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl daemon-reload
systemctl enable --now cockpit
systemctl restart cockpit
systemctl enable --now cron
systemctl reload caddy || systemctl restart caddy

say "Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | head -n 8

say "Prüfung"
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null http://127.0.0.1:3000/admin/login && break
  sleep 1
done
if curl -fsS -o /dev/null http://127.0.0.1:3000/admin/login; then
  echo "App läuft lokal."
else
  echo "App antwortet noch nicht – Log ansehen: journalctl -u cockpit -n 50"
fi

cat <<EOT

Fertig.
  Arbeitsplatz:  https://$DOMAIN/app      (HTTPS-Zertifikat holt Caddy beim ersten Aufruf)
  Cockpit:       https://$DOMAIN/admin
  Konfiguration: $ENV_FILE  →  danach: sudo systemctl restart cockpit
  Update:        sudo $APP_DIR/deploy/update.sh
  Logs:          journalctl -u cockpit -f
  Sicherungen:   /var/backups/cockpit (jede Nacht, 14 Tage)

Voraussetzung für HTTPS: Der DNS-Eintrag (A-Record) für $DOMAIN zeigt auf die IP dieses Servers.
EOT
