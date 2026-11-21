# Inbetriebnahme im Büro – Windows-Rechner, feste IP, DNS bei World4You

Diese Anleitung gilt für genau diesen Aufbau:

- ein **Windows-Rechner im Büro**, der rund um die Uhr läuft,
- das Büro hat eine **feste öffentliche IP-Adresse**,
- die Domain **meit.at** liegt bei **World4You**.

Am Ende läuft das Cockpit im Büronetz, und von außen sind nur Kundenportal, Anfrageformular,
Freigabe-Links und Kalender-Abo erreichbar – verschlüsselt unter `https://portal.meit.at`.

> **Stand der Prüfung:** Die Schritte sind aus dem Projekt und den Anleitungen der Hersteller
> zusammengestellt. Auf einem echten Windows-Rechner sind sie in dieser Form noch nicht
> durchgelaufen. Rechne beim ersten Mal mit Kleinigkeiten – und nimm dir etwa zwei Stunden Zeit.

## Übersicht

| Schritt | Was | Dauer |
| --- | --- | --- |
| 1 | Rechner vorbereiten | 15 min |
| 2 | Programme installieren | 15 min |
| 3 | Cockpit holen und einstellen | 15 min |
| 4 | Als Dienst starten, ersten Benutzer anlegen | 15 min |
| 5 | Adresse bei World4You eintragen | 5 min + Wartezeit |
| 6 | Router und Firewall öffnen | 10 min |
| 7 | Caddy einrichten (HTTPS) | 15 min |
| 8 | Prüfen – von außen und von innen | 10 min |
| 9 | Datensicherung und Betrieb | 15 min |

Bis einschließlich Schritt 4 ist nichts von außen erreichbar. Du kannst dort jederzeit aufhören
und erst einmal im Büro arbeiten.

## 1. Rechner vorbereiten

- **Feste Adresse im Büronetz:** Im Router eine DHCP-Reservierung für den Rechner anlegen
  (zum Beispiel `192.168.1.50`). Darauf zeigt später die Portweiterleitung.
- **Energiesparen aus:** Einstellungen → System → Netzbetrieb: Standbymodus „Nie“.
- **Windows-Updates:** aktiv lassen, Neustarts auf die Nacht legen.
- **Strom:** wenn möglich an eine USV hängen.
- **Zeitzone:** Europe/Vienna (für Termine und Kalenderdateien wichtig).

## 2. Programme installieren

| Programm | Wozu | Hinweis |
| --- | --- | --- |
| [Python 3.11 oder neuer](https://www.python.org/downloads/) | das Cockpit selbst | beim Installieren den Haken **„Add python.exe to PATH“** setzen |
| [Git für Windows](https://git-scm.com/download/win) | Cockpit holen und aktualisieren | Standardeinstellungen |
| [NSSM](https://nssm.cc) | startet Cockpit und Caddy als Windows-Dienst | `nssm.exe` (64 Bit) später in den Ordner `deploy` legen |
| [Caddy](https://caddyserver.com/download) | HTTPS und Schutz nach außen | `caddy.exe` nach `C:\caddy\` legen |

## 3. Cockpit holen und einstellen

PowerShell öffnen:

```powershell
cd C:\
git clone https://github.com/officemeitat-ui/new.git meit-cockpit
cd C:\meit-cockpit
git checkout claude/me-it-app-ki-agenten-n9ca4t
Copy-Item .env.example .env
notepad .env
```

Das Projekt ist privat – Git fragt beim ersten Mal nach der Anmeldung bei GitHub.
Der aktuelle Stand liegt derzeit auf dem Zweig `claude/me-it-app-ki-agenten-n9ca4t`; sobald er
in `main` zusammengeführt ist, entfällt die Zeile mit `git checkout`.

In der `.env` diese Zeilen anpassen, alles andere bleibt zunächst wie es ist:

```ini
MEIT_COMPANY=ME-IT
MEIT_SEED_DEMO=false
LLM_PROVIDER=none
PUBLIC_URL=https://portal.meit.at
```

| Zeile | Bedeutung |
| --- | --- |
| `MEIT_SEED_DEMO=false` | keine Demo-Kunden – du startest mit einer leeren Datenbank |
| `LLM_PROVIDER=none` | erst einmal ohne KI. Später `ollama` (lokal) oder Claude, siehe [OFFLINE-KI-PC.md](OFFLINE-KI-PC.md) |
| `PUBLIC_URL` | die Adresse, die in E-Mails, Freigabe-Links und im Kalender-Abo steht |
| `MEIT_HOST=127.0.0.1` | **so lassen** – das Cockpit ist dann nur über Caddy erreichbar |

Wer sich zuerst mit Beispieldaten umsehen will, lässt `MEIT_SEED_DEMO=true` und löscht die
Demo-Daten später unter **Erste Schritte**.

## 4. Als Dienst starten, ersten Benutzer anlegen

`nssm.exe` in den Ordner `C:\meit-cockpit\deploy` kopieren. Dann eine PowerShell
**als Administrator** öffnen:

```powershell
cd C:\meit-cockpit
powershell -ExecutionPolicy Bypass -File .\deploy\install-windows-service.ps1
```

Das Skript richtet alles ein und startet den Dienst „ME-IT Cockpit“. Er startet künftig mit Windows.

Am Rechner selbst im Browser `http://localhost:8080` öffnen und **in dieser Reihenfolge**:

1. **Einstellungen → Benutzer & Rollen:** den ersten Benutzer als Admin anlegen. Ab jetzt ist
   die Anmeldung Pflicht.
2. **Zwei-Faktor-Anmeldung** für diesen Benutzer einschalten und die Wiederherstellungs-Codes
   sicher ablegen.
3. **Erste Schritte** durchgehen: Firmendaten, Logo, Kunden importieren.

Erst danach geht es nach außen.

## 5. Adresse bei World4You eintragen

Im World4You-Kundenbereich bei der Domain `meit.at` die DNS-Einträge öffnen und einen neuen
Eintrag anlegen:

| Feld | Wert |
| --- | --- |
| Typ | `A` |
| Name / Subdomain | `portal` |
| Ziel / IP-Adresse | die feste öffentliche IP-Adresse des Büros |

Die Website `www.meit.at` bleibt davon unberührt. Die genaue Bezeichnung des Menüs bei World4You
konnte ich nicht prüfen; gesucht ist die Stelle, an der sich A-Einträge für Subdomains anlegen
lassen.

Prüfen, ob der Eintrag angekommen ist (kann bis zu einigen Stunden dauern):

```powershell
nslookup portal.meit.at
```

Es muss die feste IP-Adresse des Büros erscheinen.

## 6. Router und Firewall öffnen

**Am Router** zwei Portweiterleitungen auf die feste interne Adresse des Rechners:

| Von außen | Protokoll | An |
| --- | --- | --- |
| Port 80 | TCP | `192.168.1.50`, Port 80 |
| Port 443 | TCP | `192.168.1.50`, Port 443 |

Port 80 wird für das Ausstellen des Zertifikats gebraucht und leitet sonst nur auf HTTPS um.
**Port 8080 nicht weiterleiten.**

**Am Rechner** die Windows-Firewall öffnen (PowerShell als Administrator):

```powershell
New-NetFirewallRule -DisplayName "Cockpit HTTPS (Caddy)" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow
```

## 7. Caddy einrichten (HTTPS)

```powershell
Copy-Item C:\meit-cockpit\deploy\Caddyfile C:\caddy\Caddyfile
notepad C:\caddy\Caddyfile
```

In der Datei zwei Stellen ersetzen:

| Suchen | Ersetzen durch |
| --- | --- |
| `portal.deine-firma.at` | `portal.meit.at` |
| `https://www.deine-firma.at` | `https://www.meit.at` |

Zuerst von Hand testen:

```powershell
cd C:\caddy
.\caddy.exe run --config C:\caddy\Caddyfile
```

Caddy holt sich jetzt selbst ein Zertifikat. Erscheint keine Fehlermeldung zum Zertifikat, mit
`Strg+C` beenden und Caddy als Dienst einrichten (PowerShell als Administrator):

```powershell
C:\meit-cockpit\deploy\nssm.exe install Caddy C:\caddy\caddy.exe run --config C:\caddy\Caddyfile
C:\meit-cockpit\deploy\nssm.exe set Caddy AppDirectory C:\caddy
C:\meit-cockpit\deploy\nssm.exe set Caddy Start SERVICE_AUTO_START
C:\meit-cockpit\deploy\nssm.exe start Caddy
```

Was die mitgelieferte Caddy-Datei bewirkt:

- **Von überall erreichbar:** Kundenportal (`/portal`), Anfrageformular (`/anfrage`),
  Bewertung, Freigabe-Links (`/s`), Kalender-Abo.
- **Nur aus dem Büronetz und VPN:** alles andere – also das Cockpit selbst.

## 8. Prüfen

**Von außen** – am Handy mit ausgeschaltetem WLAN:

| Adresse | Erwartet |
| --- | --- |
| `https://portal.meit.at/portal` | Anmeldeseite des Kundenportals, Schloss-Symbol im Browser |
| `https://portal.meit.at/anfrage` | Anfrageformular |
| `https://portal.meit.at/` | „Nicht verfügbar“ – **das ist richtig**, das Cockpit ist von außen gesperrt |

**Von innen** – an einem Rechner im Büro:

| Adresse | Erwartet |
| --- | --- |
| `https://portal.meit.at/` | Anmeldung des Cockpits |

Kommt im Büro „Nicht verfügbar“, schickt der Router die Anfragen mit der öffentlichen Adresse
zurück. Dann am Router (lokales DNS) oder ersatzweise in der Datei
`C:\Windows\System32\drivers\etc\hosts` der Büro-Rechner eintragen:

```
192.168.1.50   portal.meit.at
```

Zum Schluss im Cockpit unter **Verbindungen & Sicherheit** nachsehen, ob dort etwas rot ist.

## 9. Datensicherung und Betrieb

**Sichern – das ist nicht optional.** Alles Wichtige liegt in `C:\meit-cockpit\data`:

| Inhalt | Bedeutung |
| --- | --- |
| `meit.db` | die Datenbank |
| `backups\` | automatische tägliche Sicherung der Datenbank |
| `anhaenge\`, Archivordner | Dateien, PDFs, Arbeitsberichte |
| `tresor.key` | Schlüssel für gespeicherte Anmeldungen. **Ohne ihn sind diese nicht mehr lesbar.** |

Den ganzen Ordner `data` in eure normale Datensicherung aufnehmen, mit einer Kopie außer Haus.
Zusätzlich die Datei `.env` und `C:\caddy\Caddyfile`.

**Aktualisieren:**

```powershell
cd C:\meit-cockpit
git pull
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\deploy\nssm.exe restart MEIT-Cockpit
```

Die Datenbank wird dabei automatisch ergänzt. Vor einem Update den Ordner `data` kopieren.

**Nach Änderungen an der `.env`:** `.\deploy\nssm.exe restart MEIT-Cockpit`

**Protokoll bei Problemen:** `C:\meit-cockpit\data\logs\meit.log`

## Unterwegs arbeiten

Das Cockpit ist von außen absichtlich gesperrt. Techniker, die am Handy „Mein Tag“ öffnen oder
beim Kunden einen Arbeitsbericht unterschreiben lassen wollen, brauchen eine **VPN-Verbindung
ins Büro**. Die Caddy-Datei lässt die üblichen privaten Netze zu (`10.x`, `172.16–31.x`,
`192.168.x`); nutzt euer VPN einen anderen Bereich, in der Zeile `@intern` ergänzen.

Das Cockpit ohne VPN ins Internet zu stellen ist möglich, aber nicht empfohlen – dann hängt alles
an Passwort und Zwei-Faktor-Anmeldung.

## Danach: Anbindungen einzeln einschalten

In dieser Reihenfolge, jeweils erst prüfen, dann die nächste:

| Anbindung | Anleitung |
| --- | --- |
| E-Mail (Postfach, Versand) | [KI-MITARBEITER.md](KI-MITARBEITER.md), [EMAIL-PORTAL-CLAUDE.md](EMAIL-PORTAL-CLAUDE.md) |
| Microsoft 365, SharePoint, To Do | [SICHERE-ANBINDUNGEN.md](SICHERE-ANBINDUNGEN.md), [M365-DOKUMENTENPROZESS.md](M365-DOKUMENTENPROZESS.md) |
| Microsoft 365 der Kunden | [M365-KUNDEN-MITARBEITER.md](M365-KUNDEN-MITARBEITER.md) |
| Sicherungsberichte, Domains | [BACKUP-DOMAINS.md](BACKUP-DOMAINS.md) |
| Überwachung | [UEBERWACHUNG.md](UEBERWACHUNG.md) |
| Geräte-Check | [GERAETE-CHECK.md](GERAETE-CHECK.md) – zuerst auf einem eigenen Test-PC |
| Office im Browser | [OFFICE.md](OFFICE.md) |
| Atera, BookStack | [ATERA-KEEPER-BOOKSTACK.md](ATERA-KEEPER-BOOKSTACK.md) |

## Wenn etwas nicht geht

| Anzeichen | Ursache und Abhilfe |
| --- | --- |
| `http://localhost:8080` lädt nicht | Dienst läuft nicht: `.\deploy\nssm.exe status MEIT-Cockpit`, dann ins Protokoll `data\logs\meit.log` sehen. |
| Caddy meldet einen Fehler beim Zertifikat | DNS zeigt noch nicht aufs Büro (`nslookup`), oder Port 80/443 kommt nicht an (Router, Firewall). |
| Von außen keine Verbindung | Portweiterleitung zeigt auf die falsche interne Adresse, oder der Rechner hat seine Adresse gewechselt (DHCP-Reservierung). |
| Im Büro „Nicht verfügbar“ | siehe Schritt 8, Eintrag im lokalen DNS oder in der `hosts`-Datei. |
| Links in E-Mails zeigen auf `localhost` | `PUBLIC_URL` in der `.env` fehlt; eintragen und Dienst neu starten. |
| Nach Neustart des Rechners läuft nichts | In „Dienste“ prüfen, ob „ME-IT Cockpit“ und „Caddy“ auf „Automatisch“ stehen. |
