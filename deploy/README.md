# Betrieb auf einem World4You Linux vServer

Cockpit und Arbeitsplatz sind eine Node.js-Anwendung, die dauerhaft läuft (Datenbank, KI-Aufrufe, regelmäßiger
Abgleich mit Atera und Outlook). Ein **Webspace-Paket** ist dafür nicht gedacht – dort laufen PHP-Seiten. Die eigene
Website kann auf dem Webspace bleiben; der Arbeitsplatz bekommt eine Subdomain (z. B. `app.firma.at`) auf einem
**Linux vServer**. Das geht bei World4You genauso wie bei jedem anderen Anbieter mit Debian oder Ubuntu.

## Was du brauchst

- **Linux vServer** mit Debian 12 oder Ubuntu 24.04. Empfehlung: Größe M (genug Arbeitsspeicher zum Bauen der App).
  Bei Größe S legt das Skript automatisch eine Auslagerungsdatei an.
- **Subdomain**, z. B. `app.firma.at`: In der DNS-Verwaltung der Domain einen **A-Record** `app` auf die IP-Adresse
  des vServers setzen. Bis der Eintrag weltweit gilt, kann es etwas dauern.
- **Zugriff auf das GitHub-Repository** (das Skript erzeugt dafür einen Schlüssel, siehe unten).
- Unter Windows zum Verbinden: **Windows-Terminal** (`ssh root@IP-ADRESSE`) und zum Kopieren von Dateien **WinSCP**.

## Einrichtung (einmalig, ca. 15 Minuten)

1. `deploy/setup.sh` auf den Server kopieren (z. B. mit WinSCP nach `/root/`).
2. Per SSH verbinden und ausführen:

   ```bash
   sudo bash setup.sh app.firma.at git@github.com:officemeitat-ui/new.git main
   ```

   Solange der aktuelle Stand noch nicht im Hauptzweig liegt, statt `main` den Arbeitszweig angeben
   (`claude/justclose-de-analysis-4mvy40`).

3. Das Skript zeigt einen **Deploy-Key** an. Im GitHub-Repository unter **Settings → Deploy keys → Add deploy key**
   eintragen (ohne Schreibrecht), dann im Terminal Enter drücken.
4. Am Ende steht das **Einrichtungspasswort** (`ADMIN_PASSWORD`) im Terminal (und in `/etc/cockpit.env`). Damit im Browser unter
   `/admin/login` das eigene Inhaber-Konto anlegen und den Einmalcode einrichten – danach meldet sich jede Person mit eigenem Konto an.
5. Zugangsdaten eintragen und neu starten:

   ```bash
   sudo nano /etc/cockpit.env      # ANTHROPIC_API_KEY, ATERA_API_KEY, MS_* …
   sudo systemctl restart cockpit
   ```

   Welche Werte es gibt und wofür, steht in `.env.example` im Projekt.

6. Im Browser `https://app.firma.at/app` öffnen, anmelden – fertig. Am Handy dann „Zum Home-Bildschirm“ bzw. „App installieren“.

## Was das Skript einrichtet

| Teil                         | Wo                                                                     |
| ---------------------------- | ---------------------------------------------------------------------- |
| Node.js 22, Caddy, Firewall  | Caddy holt und erneuert das HTTPS-Zertifikat selbst (Let's Encrypt)    |
| App                          | `/opt/cockpit/app`, läuft als Benutzer `cockpit`, nur lokal auf Port 3000 |
| Dienst                       | `cockpit.service` (startet bei Absturz und nach Neustart automatisch)  |
| Datenbank                    | `/var/lib/cockpit/app.db`                                              |
| Konfiguration und Geheimnisse | `/etc/cockpit.env` (nur für root und den Dienst lesbar)               |
| Regelmäßige Aufgaben         | `/etc/cron.d/cockpit`: Postfach und Atera alle 5 Minuten, Erinnerungen, Nachfassen, Monatsbericht |
| Datensicherung               | jede Nacht nach `/var/backups/cockpit`, 14 Tage                        |
| Sicherheitsupdates           | automatisch (unattended-upgrades)                                      |

Nach außen offen sind nur SSH, HTTP (Weiterleitung auf HTTPS) und HTTPS.

## Alltag

- **Neue Version einspielen:** `sudo /opt/cockpit/app/deploy/update.sh` (sichert vorher die Datenbank).
- **Logs ansehen:** `journalctl -u cockpit -f`, Fehler der regelmäßigen Aufgaben: `journalctl -t cockpit-cron`.
- **Sicherung zurückspielen:**

  ```bash
  sudo systemctl stop cockpit
  gunzip -c /var/backups/cockpit/app-JJJJ-MM-TT-HHMM.db.gz | sudo -u cockpit tee /var/lib/cockpit/app.db >/dev/null
  sudo systemctl start cockpit
  ```

- **Sicherungen außer Haus:** `/var/backups/cockpit` zusätzlich regelmäßig auf ein NAS oder einen Cloud-Speicher kopieren
  (oder die Snapshot-Funktion des Anbieters nutzen) – eine Sicherung auf demselben Server schützt nicht vor dessen Ausfall.

## Sicherheit

- SSH möglichst nur mit Schlüssel und ohne Passwort-Login betreiben.
- Anmeldung nur mit eigenem Konto: Microsoft (MFA über Conditional Access) oder Passwort + Einmalcode. Das Einrichtungspasswort
  wirkt nur, solange es noch kein Konto gibt.
- Am Handy eine Bildschirmsperre verwenden; die Anmeldung gilt 7 Tage.
