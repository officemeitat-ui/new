# ME-IT Cockpit

**Betriebssystem für deinen IT-Dienstleistungsbetrieb, mit KI-Agenten, die lokal und offline laufen.**

Tickets, Kunden, Geräte und Wissen an einem Ort. Dazu KI-Agenten, die Tickets einordnen, Lösungen
vorschlagen, Angebote schreiben, Monatsberichte erstellen und automatisch Umsatzchancen finden. Alles
läuft auf deinem eigenen PC (Ollama), Kundendaten verlassen das Haus nicht.

> Strategie dahinter: [docs/STRATEGIE-2026-2030.md](docs/STRATEGIE-2026-2030.md) ·
> KI-Mitarbeiter als Produkt: [docs/KI-MITARBEITER.md](docs/KI-MITARBEITER.md) ·
> PC-Empfehlung und Training: [docs/OFFLINE-KI-PC.md](docs/OFFLINE-KI-PC.md) ·
> Outlook/SharePoint/OneDrive: [docs/M365-DOKUMENTENPROZESS.md](docs/M365-DOKUMENTENPROZESS.md) ·
> Zahlungen & Mahnwesen: [docs/ZAHLUNGEN-MAHNWESEN.md](docs/ZAHLUNGEN-MAHNWESEN.md) ·
> Wartungsplan: [docs/WARTUNGSPLAN.md](docs/WARTUNGSPLAN.md) ·
> Atera · Keeper · BookStack: [docs/ATERA-KEEPER-BOOKSTACK.md](docs/ATERA-KEEPER-BOOKSTACK.md) ·
> Rentabilität, Zufriedenheit, App: [docs/RENTABILITAET-ZUFRIEDENHEIT-APP.md](docs/RENTABILITAET-ZUFRIEDENHEIT-APP.md) ·
> E-Mails, Kundenportal, Phishing-Check, Claude: [docs/EMAIL-PORTAL-CLAUDE.md](docs/EMAIL-PORTAL-CLAUDE.md) ·
> Microsoft 365 der Kunden, Ein-/Austritte: [docs/M365-KUNDEN-MITARBEITER.md](docs/M365-KUNDEN-MITARBEITER.md) ·
> Sichere Anbindungen (Zertifikat, Sites.Selected, To Do, BookStack): [docs/SICHERE-ANBINDUNGEN.md](docs/SICHERE-ANBINDUNGEN.md) ·
> Backup-Wächter, Domain-/E-Mail-Check: [docs/BACKUP-DOMAINS.md](docs/BACKUP-DOMAINS.md) ·
> Sicherheitslage, Benachrichtigungen, Protokoll: [docs/SICHERHEITSLAGE-BENACHRICHTIGUNGEN.md](docs/SICHERHEITSLAGE-BENACHRICHTIGUNGEN.md) ·
> Geräte-Check (Inventar-Agent): [docs/GERAETE-CHECK.md](docs/GERAETE-CHECK.md) ·
> Sicherheitsprüfung, 2FA, Erste Schritte: [docs/SICHERHEIT-INBETRIEBNAHME.md](docs/SICHERHEIT-INBETRIEBNAHME.md)

## Funktionen

| Bereich | Was es macht |
|---|---|
| **Übersicht** | MRR, offene/dringende Tickets, Geräte ohne Herstellersupport, Umsatzpotenzial, auslaufende Verträge |
| **Tickets + Triage-Agent** | Jedes neue Ticket wird automatisch eingeordnet: Kategorie, Priorität, Lösungsschritte (aus Wissensdatenbank und ähnlichen gelösten Tickets), Antwortentwurf an den Kunden, Hinweis auf Verkaufschance |
| **Rentabilität & Preise** | Deckungsbeitrag und **effektiver Stundensatz je Kunde** (Rechnungen − Arbeitszeit × Kostensatz − Lizenz-Einkauf, inkl. ungebuchter Fernwartung) mit Empfehlungen. **Wertsicherung (VPI 2020)**: Schwelle, Vorschlag, Anpassung zum Stichtag (im Rechnungslauf), Ankündigungsschreiben als PDF/Mail. |
| **Kundenzufriedenheit** | Nach jedem gelösten Ticket 1-Klick-Bewertung (5 Smileys per Mail oder im Portal); schlechte Bewertung → sofort Rückruf-Ticket. Ø-Bewertung in Dashboard, Health Score, Monatsbericht und QBR. |
| **Stoppuhr & App** | Stoppuhr am Ticket/Kunden (läuft sichtbar mit, Stopp bucht Zeit). Cockpit als **App am Handy** installierbar (PWA, ohne Zwischenspeichern von Kundendaten). |
| **Wartungsplan** | Wiederkehrende Prüfungen je Kunde (Backup-Restore-Test, Patch-Status, Security, Firewall, USV …), passend zu den gebuchten Leistungen vorgeschlagen. Fällige Prüfungen werden automatisch zu Tickets, Abschluss mit Checkliste und Ergebnis. **Nachweis** im Monatsbericht, QBR, Kundenportal und als Wartungsprotokoll-PDF; fließt in den Health Score ein, zählt nicht in die SLA. |
| **Kunden & Geräte** | Stammdaten, Pakete, gebuchte Leistungen, Geräte mit automatischer Support-Ende-Erkennung (Windows 10, Server 2012/2016/2019, Exchange, Office) |
| **Wissensdatenbank (RAG)** | Semantische Suche mit lokalem Embedding-Modell, ohne KI als Stichwortsuche. Gelöste Tickets lassen sich per Klick übernehmen. |
| **KI-Assistent** | Chat mit Werkzeugen auf deine echten Daten: „Welche Kunden haben noch Windows 10?“, „Leg für Huber ein Ticket an …“ |
| **Umsatz-Radar** | Findet regelbasiert Chancen mit €-Wert: Managed-Vertrag, Security, Backup, NIS2, Lifecycle, KI, Vertragsverlängerungen, wiederkehrende Probleme |
| **Angebots-Agent** | Aus Gesprächsnotizen ein fertiges Angebot. Die KI wählt Leistungen aus dem Katalog, **gerechnet wird im Code**. Angenommene Angebote erhöhen automatisch den MRR. |
| **Security- & NIS2-Check** | 15 Fragen nach NIS2 Art. 21 / NISG 2026 → Score, priorisierte Maßnahmen, Bericht für die Geschäftsführung, passendes Angebot |
| **Monatsbericht-Agent** | Kundenbericht mit Kennzahlen, Erledigtem und Empfehlungen (Kundenbindung) |
| **KI-Mitarbeiter: Posteingang** | Sortiert E-Mails, Formularanfragen und Telefonnotizen (Support · Anfrage · Termin · Beleg · Info). Daraus entstehen Ticket, Lead oder Beleg, dazu ein Antwortentwurf. Modus je Art: **Entwurf + Freigabe** oder **Autopilot**. IMAP/SMTP-Anbindung. |
| **Sprachnotizen** | Anruf kurz einsprechen oder Voicemail hochladen → lokal mit Whisper in Text (optional `requirements-voice.txt`, Audio wird sofort gelöscht) → Posteingang, KI-Mitarbeiter ordnet ein |
| **Leads & Pipeline** | Lead-Score, Qualifizierung, Phasen Erstgespräch → Pitch → Angebotsbesprechung, automatisches Nachfassen |
| **Sicherheitslage je Kunde** | Eine Note aus Microsoft 365, Geräte-Check, Datensicherung, E-Mail-Domain und Security-Check mit Verlauf, Abdeckung („was ist bei wem angebunden?“) und Maßnahmenplan. **IT-Sicherheitsbericht als PDF** im ME-IT-Design, **Angebot aus den Maßnahmen** mit einem Klick, Karte „Ihre IT-Sicherheit“ im Kundenportal. |
| **Benachrichtigungen** | Glocke im Cockpit, E-Mail und Microsoft Teams bei dringenden Tickets (inkl. Backup-Fehler, Weiterleitungen, Phishing), Portal-Nachrichten und Sicherheitsereignissen; täglicher „Tagesstart“ per Mail. |
| **Sicherheitsprotokoll** | Anmeldungen (mit Fehlversuchen), Änderungen, Exporte und Löschungen mit Zeit, Person und Adresse – Suche, CSV, 400 Tage. |
| **Geräte-Check (eigener Agent)** | Schlanker Inventar-Agent für Windows, **nur lesend** (kein Befehlskanal): BitLocker, Virenschutz, Firewall, Updates, Speicherplatz, Admin-Rechte, Software, Windows-11-Tauglichkeit. Befunde mit Punktzahl, Ticket, Radar-Chance, Schutz-Spalte im Kundenportal. Registrierung je Kunde mit befristetem Schlüssel, eigenes Token je Gerät. |
| **Erste Schritte** | Inbetriebnahme als Checkliste mit Live-Status und „wo stelle ich das ein“, Übersicht „Wo finde ich was?“, Demodaten sauber entfernen. |
| **Zwei-Faktor-Anmeldung** | TOTP (Authenticator-App) fürs Cockpit mit Wiederherstellungscodes; dazu Größenlimits, Content-Security-Policy und weitere Härtung aus der Sicherheitsprüfung. |
| **Backup-Wächter** | Sicherungsberichte (Veeam, Synology, Acronis, Datto, Windows …) aus dem Postfach automatisch erkannt und dem Kunden zugeordnet: **Ampel der letzten 14 Tage**, Ticket nur bei Fehler, automatisches Schließen nach erfolgreicher Folgesicherung, **„Bericht fehlt“-Alarm**, Quote im Monatsbericht/QBR, Ampel im Kundenportal. |
| **Domains & E-Mail** | Je Kundendomain SPF, DKIM, DMARC, MX, MTA-STS und Website-Zertifikat – „Kann man im Namen des Kunden Mails fälschen?“. Punkte 0–100, Befunde → Ticket, Chance „E-Mail-Absicherung“ im Radar, Schutzstatus im Monatsbericht, wöchentlich automatisch. |
| **Verbindungen & Sicherheit** | Alle Anbindungen auf einen Blick mit Live-Test: liest die **tatsächlich erteilten Microsoft-Rechte** aus dem Token und markiert zu weitreichende rot (z. B. Zugriff auf alle SharePoint-Seiten oder alle Postfächer), prüft BookStack-Token auf Admin-Rechte, HTTPS, Cockpit-Login, Datensicherung. **Zertifikat statt Geheimnis** mit einem Klick erzeugen und aktivieren, **SharePoint nur für eine Site** (Sites.Selected) freigeben, Anleitung für Postfach-Beschränkung per Exchange-RBAC. |
| **Microsoft To Do** | Jeder Mitarbeiter verbindet seine eigenen Aufgaben (delegiert, Anmeldung per Code, Token verschlüsselt). Tickets und Ein-/Austritte landen in der Liste „ME-IT Cockpit“ – am Handy abgehakte Checklisten-Schritte werden im Cockpit übernommen und umgekehrt. |
| **Microsoft 365 der Kunden** | Einmalige Zustimmung des Kunden-Admins (Link, nur Leserechte, kein GDAP), dann täglicher Check: **externe Weiterleitungen** (→ sofort Ticket), Admins/Benutzer ohne MFA, fehlende MFA-Pflicht, zu viele Admins, gesperrte/ungenutzte Konten mit Lizenz, inaktive Gäste, **Secure Score** mit Verlauf. **Lizenzabgleich**: zugewiesen vs. verrechnet je Produkt, Nachverrechnung mit einem Klick, Einsparungen für den Kunden. Fließt in Radar, Monatsbericht und QBR ein. |
| **Ein- & Austritte** | Neue/ausscheidende Mitarbeiter beim Kunden als Checkliste mit Ticket (Konto, Lizenz, MFA, Gerät, Keeper, Postfach, Datenübergabe …), Vorlagen anpassbar. Beim Abschluss werden **Lizenzanzahl (→ Rechnung)** und Mitarbeiterzahl angepasst. Kunden melden Ein-/Austritte im Portal und sehen den Fortschritt. |
| **E-Mails & Anhänge** | Mails aus Outlook (**.msg**) oder Outlook im Web (**.eml**) per Drag & Drop in den Posteingang oder direkt ins Ticket. Anhänge (Screenshots, PDFs) landen am Ticket, Belege in der Buchhaltung. **Antworten des Kunden landen im bestehenden Ticket** (In-Reply-To bzw. „[#123]“ im Betreff) und öffnen es wieder. Ticket-Verlauf mit Antworten per Mail, nur im Portal oder als interne Notiz. Ausführbare Dateien werden abgelehnt. |
| **Phishing-Check** | Verdächtige Mail hochladen → Bewertung mit Begründung: SPF/DKIM/DMARC, gefälschte Absender und Marken, Links (Kurz-URLs, IP-Adressen, Punycode, Linktext ≠ Ziel), gefährliche Anhänge, Drucktaktiken. Im Cockpit und für Kunden im Portal (dort entsteht automatisch ein Ticket mit Priorität). Gefährliche Mails erzeugen im Posteingang keine Tickets/Leads. Läuft komplett lokal. |
| **Claude (Cloud-KI)** | Optional zur lokalen KI: je Aufgabe **lokal / auto / Claude** (z. B. Angebote mit Claude, Kundenportal immer lokal), Modell (Opus/Sonnet/Haiku 5.5), Denktiefe je Aufgabe, **Monatsbudget** mit Kostenanzeige, **Pseudonymisierung** von E-Mail-Adressen, Telefonnummern und IBANs vor dem Versand (Antwort wird zurückübersetzt), Passwörter werden immer geschwärzt. **Belege-PDFs mit Claude lesen** (auch Scans) mit strukturierter Ausgabe. |
| **Belege** | Rechnungen aus dem Posteingang mit Betrag, Nummer und Datum, PDF automatisch in `Buchhaltung/Eingangsrechnungen`, Scans per Upload, CSV-Export für den Steuerberater |
| **Zahlungen & Mahnwesen** | **QR-Code „Zahlen mit Code“** auf jeder Rechnung (EPC, alle österreichischen Banking-Apps). **Kontoauszug-Import** (George/ELBA-CSV, CAMT.053, MT940) mit automatischem Abgleich: Rechnungsnummer im Verwendungszweck → bezahlt (auch Teil- und Sammelzahlungen), sonst Vorschlag über IBAN/Kunde + Betrag. **Ausgaben ohne Beleg** für den Steuerberater. **Mahnwesen** in 3 Stufen als PDF im CD mit QR-Code, Versand per Outlook, Spesen/Verzugszinsen optional, Freigabe oder Autopilot. **SEPA-Lastschrift** (CORE/B2B): Mandat-PDF, Vormerkung beim Stellen mit Vorabankündigung auf der Rechnung, Einzugsdatei pain.008 (schemageprüft), Gutschrift und Rücklastschrift werden beim Kontoauszug erkannt. Altersstruktur und Zahlungsdauer (DSO). |
| **Dokumente (Microsoft 365)** | Rechnungen, Angebote, Monatsberichte, QBR und Security-Checks als **PDF im ME-IT-Design**, automatisch abgelegt (lokal + **SharePoint/OneDrive** über Microsoft Graph, mit Ordnervorlagen je Kunde/Jahr). **Versand per Outlook** mit PDF und E-Rechnung im Anhang, Mail im Corporate Design. Fehlgeschlagene Uploads per Klick wiederholen. |
| **Anfrageformular** | `/anfrage` für die Website: öffentlich, mit Spamschutz und Rate-Limit, Anfragen landen direkt im Posteingang |
| **Lizenzen & Verträge** | Pro Kunde: M365, Virenschutz, Domains, Zertifikate, Wartung. Verlängerung, Kündigungsfrist, Einkauf/Verkauf/Marge, Abgleich der Lizenzanzahl mit den Mitarbeitern. Läuft automatisch im Rechnungslauf mit (monatlich bzw. im Verlängerungsmonat), Fristen und Unterlizenzierung erscheinen im Radar. |
| **SLA-Tracking** | Reaktions- und Lösungszeiten je Paket und Priorität in Geschäftszeiten (konfigurierbar). Ampel je Ticket, Erfüllungsquote je Kunde, fließt in Health Score, Monatsbericht und QBR ein. |
| **Customer Success** | Health Score je Kunde, QBR-Agent („Plan → erreicht → nächster Hebel“), NRR, Anteil wiederkehrender Umsatz, Aktivitäten-Kaskade, 10-Punkte-Selbst-Check |
| **ROI-Rechner** | Für das Verkaufsgespräch: Zeitgewinn, Wert, Amortisation, ROI im ersten Jahr |
| **3-Stufen-Angebote** | Premium als Anker, dann Einstieg, dann Empfehlung. Beim Annehmen wird das gewählte Paket übernommen. |
| **Benutzer & Rollen** | Login (sobald der erste Admin angelegt ist), Rollen Admin, Technik und Vertrieb. Tickets und Leads haben Verantwortliche, Filter „Meine“. |
| **Automatische Zuweisung** | Tickets gehen nach der KI-Einordnung an die zuständige Person (Regel je Kategorie oder Pool), jeweils an die mit den wenigsten offenen Tickets |
| **Wochenrhythmus** | Montag Ziele, Freitag Abgleich: Ist-Werte zählt das Cockpit automatisch (Pitches, Angebote, QBRs, gelöste Tickets) plus erfasste Anrufe. Dazu ein Top-10-Deal-Review mit nächstem Schritt und Risiko. |
| **Wochenbriefing-Agent** | Die Woche auf einer Seite für die Geschäftsführung: Zahlen, Risiken, 3 Prioritäten, optional per Mail |
| **Kundenportal** | `/portal`: Kunden sehen Tickets, Geräte (inkl. Support-Ende), Security-Score, Angebote (online annehmen, auch Paketwahl) und Rechnungen. Tickets anlegen mit Triage und Dateien, **Verlauf mit Antworten und Kommentaren**, Screenshots hochladen, **verdächtige E-Mails prüfen lassen**, **Ein-/Austritte melden** und Microsoft-365-Konten samt MFA-Status sehen, KI-Hilfe nur aus freigegebenen Anleitungen. Eigene Zugänge, strikt pro Kunde getrennt. |
| **Abrechnung** | Zeiterfassung pro Ticket/Kunde (Managed = Flatrate, sonst verrechenbar), monatlicher Rechnungslauf (Pauschale + Stunden im Viertelstundentakt + Projekte), lückenlose Nummern beim Stellen, Rechnung nach § 11 UStG als PDF im Corporate Design (Versand per Outlook), Storno, Rechnungsausgangsbuch als CSV, **E-Rechnung ebInterface 6.1** (gegen das offizielle Schema geprüft; mit Auftragsreferenz und Lieferantennummer für den Bund) |
| **Atera (RMM + Splashtop)** | Kunden und Geräte inkl. Link zur Atera-Geräteseite, Alarme → Tickets. **Splashtop-Sitzungsprotokoll** importieren: Sitzungen werden Gerät → Kunde → Wartung zugeordnet und erscheinen als protokollierter Nachweis im Wartungsprotokoll, Portal und Wiki; Sitzungen ohne Zeitbuchung mit einem Klick buchen. |
| **Keeper & Passwort-Wächter** | Keeper-Links je Kunde und Gerät statt Passwörtern im Cockpit. Scanner findet Klartext-Zugangsdaten in Tickets, Wissen, Notizen und E-Mails (Schwärzen per Klick); vor BookStack-Export und Cloud-KI wird automatisch geschwärzt. |
| **BookStack** | Je Kunde ein automatisch aktuelles IT-Doku-Buch (Übersicht, Geräte mit Atera-/Keeper-Links, Lizenzen, Wartungsnachweise), Wissensartikel im Wiki, Wiki-Anleitungen als Wissen für KI-Triage, Assistent und Kundenportal. |
| **NinjaOne (RMM)** | Organisationen → Kunden, Geräte inkl. Betriebssystem/Seriennummer/zuletzt gesehen (automatisch oder per Knopf), Alarme optional als Tickets |
| **Terminvorschläge** | Bei Microsoft 365 (`GRAPH_CALENDAR=true`): Antworten auf Anfragen und Rückrufbitten enthalten 3 freie Termine aus dem Kalender |
| **Import & Sicherung** | CSV-Import für Kunden und Geräte (erkennt deutsche/englische Spalten und RMM-Exporte, mit Vorschau). Automatische Datensicherung mit Aufbewahrung (inkl. Spiegel des Dokumentenarchivs), Download per Klick. |
| **KI-Training** | Export pseudonymisierter Trainingsdaten (JSONL) und LoRA-Skript für ein eigenes „ME-IT-Modell“ |
| **Protokoll** | Jeder Agentenlauf wird protokolliert (Nachvollziehbarkeit, AI Act) |

**Ohne KI funktioniert alles weiter.** Triage, Suche und Angebote fallen dann auf Regeln bzw.
Stichworte zurück.

## Schnellstart

### Windows
1. Python 3.11+ installieren (python.org, Haken bei „Add to PATH“)
2. Optional, aber empfohlen: [Ollama](https://ollama.com/download) installieren
3. Im Projektordner `start.ps1` ausführen (Rechtsklick → *Mit PowerShell ausführen*)
4. Browser öffnet http://localhost:8080

### Linux / macOS / WSL
```bash
./start.sh
```

### Docker (inkl. Ollama mit GPU)
```bash
docker compose up -d
docker compose exec ollama ollama pull qwen3:14b
docker compose exec ollama ollama pull bge-m3
```

Beim ersten Start werden **Demodaten** angelegt (5 fiktive Kunden), damit du alles sofort ausprobieren
kannst. Für den echten Betrieb: in `.env` `MEIT_SEED_DEMO=false` setzen und `data/meit.db` löschen.

## Konfiguration (`.env`)

Vorlage: [.env.example](.env.example). Die wichtigsten Werte:

| Variable | Standard | Bedeutung |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` (offline) · `openai` (LM Studio, llama.cpp, vLLM) · `anthropic` (Claude, Cloud) · `none` |
| `OLLAMA_MODEL` | `qwen3:14b` | Chat-/Agentenmodell (`qwen3:8b` für schwache PCs, `qwen3:32b` für RTX 5090) |
| `EMBED_MODEL` | `bge-m3` | Modell für die semantische Suche |
| `ANTHROPIC_API_KEY` | leer | Schlüssel für Claude. Alles Weitere (je Aufgabe, Budget, Datenschutz) unter Steuerung → Claude |
| `ALLOW_CLOUD_FALLBACK` | `false` | Startwert für den Cloud-Schalter (danach im Cockpit unter Steuerung → Claude) |
| `MEIT_PASSWORD` | leer | Zusätzlicher Passwortschutz (HTTP Basic) vor allem anderen. Für Teams besser: unter Einstellungen Benutzer anlegen (Login mit Rollen). |
| `MEIT_HOST` | `127.0.0.1` | `0.0.0.0` für Zugriff aus dem LAN |
| `MAIL_PROVIDER` | `imap` | `graph` für Microsoft 365 (mit `GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET/MAILBOX`) |
| `MAIL_IMAP_*`, `MAIL_SMTP_*`, `MAIL_FROM` | leer | Postfach per IMAP/SMTP (Details: docs/KI-MITARBEITER.md) |
| `MAIL_POLL_MINUTES` | `0` | Postfach automatisch alle X Minuten abrufen |
| `BOOKING_URL` | leer | Terminbuchungs-Link für Antworten an Interessenten |
| `PUBLIC_FORM_ENABLED` / `PUBLIC_FORM_ORIGINS` | `true` / leer | Anfrageformular an/aus, Websites, die es einbinden dürfen |
| `GRAPH_CERT_FILE` | leer | Zertifikat (PEM) statt `GRAPH_CLIENT_SECRET` – einfacher: im Cockpit unter Verbindungen erzeugen/aktivieren |
| `TODO_CLIENT_ID`, `TODO_SYNC_MINUTES` | leer, `10` | Microsoft To Do je Benutzer (leer = `GRAPH_CLIENT_ID`) |
| `MEIT_SECRET_KEY` | leer | Schlüssel für gespeicherte Anmeldungen (leer = Datei `data/tresor.key`) |
| `M365_CLIENT_ID` / `M365_CLIENT_SECRET` | leer | Mandantenfähige App für das Microsoft 365 der Kunden (nur lesend), `M365_SYNC_HOURS` (24) |
| `PUBLIC_URL` | leer | Öffentliche Adresse des Cockpits (Links in Mails, z. B. Zufriedenheits-Umfrage) |
| `ARCHIVE_DIR` | leer (`data/archiv`) | Dokumentenarchiv (PDFs). Tipp: OneDrive-synchronisierter Ordner. SharePoint/OneDrive-Upload: Einstellungen → Dokumentenablage |

## Architektur

```
Browser (Vanilla JS, kein Build)  ──►  FastAPI (meit/main.py)  ──►  SQLite (data/meit.db)
                                             │
                    ┌────────────────────────┼─────────────────────────┐
                    ▼                        ▼                         ▼
             KI-Agenten (meit/agents)   Umsatz-Radar / NIS2-Check   Wissensdatenbank (RAG)
                    │                   (regelbasiert, testbar)     Hybrid: Embeddings + BM25
                    ▼
          Router (meit/llm.py): Ollama ─► OpenAI-kompatibel ─► Claude (nur wenn erlaubt)
```

- **Agenten-Protokoll:** einfache JSON-Werkzeugschleife statt providerspezifischem Function Calling.
  Dadurch funktioniert sie mit kleinen lokalen Modellen genauso wie mit Claude.
- **Zahlen nie von der KI:** Preise, Summen, Scores und Radar-Werte werden im Code berechnet. Die KI
  formuliert und wählt aus.
- **Keine schweren Abhängigkeiten:** FastAPI, httpx, SQLite. Das Training läuft separat (`requirements-training.txt`).

## Betrieb im Unternehmen

| Aufgabe | Vorlage |
|---|---|
| **Windows-Dienst** (startet mit Windows) | `deploy/install-windows-service.ps1` (mit NSSM) |
| **Linux-Dienst** (systemd, gehärtet) | `deploy/meit.service` |
| **Von außen erreichbar** (nur Formular + Portal, HTTPS) | `deploy/Caddyfile`. Das Cockpit selbst bleibt im LAN/VPN. |
| **Benutzer** | Einstellungen → Benutzer & Rollen (ab dem ersten Admin gilt Login-Pflicht) |
| **Sicherung** | automatisch täglich in `data/backups/`. Den Ordner zusätzlich ins Offsite-Backup aufnehmen. |
| **Update** | `git pull` → `pip install -r requirements.txt` → Dienst neu starten. Die Datenbank wird automatisch ergänzt. |

Hinter einem Reverse-Proxy auf demselben Rechner erkennt die App die echte Besucher-IP
(Rate-Limits) und HTTPS (sichere Cookies) automatisch.

## Entwicklung & Tests

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt pytest
pytest
```
Die Tests laufen ohne GPU: Eine simulierte KI (`tests/conftest.py`) prüft die Agentenlogik, die
HTTP-Formate von Ollama und LM Studio werden gemockt.

API-Dokumentation (automatisch): http://localhost:8080/docs

## Projektstruktur

```
meit/
  main.py          API + Weboberfläche
  llm.py           KI-Provider (Ollama, OpenAI-kompatibel, Claude) + Router
  ai_control.py    Claude-Steuerung: je Aufgabe lokal/auto/Claude, Budget, Kosten, Belege per Claude
  emails.py        .eml/.msg lesen, Phishing-Prüfung (Regeln + KI-Zweitmeinung)
  attachments.py   Anhänge, Mail-Upload, Ticket-Verlauf, Antworten, Zuordnung von Kundenantworten
  m365.py          Microsoft 365 der Kunden: Zustimmung, Abruf, Befunde, Lizenzabgleich
  staff.py         Ein-/Austritte von Mitarbeitern beim Kunden (Checkliste, Ticket, Lizenzanzahl)
  msauth.py        Microsoft-Anmeldung: Zertifikat (PS256) bzw. Geheimnis, Gerätecode, Rechte aus dem Token
  vault.py         Tresor für gespeicherte Anmeldungen (verschlüsselt, Schlüssel außerhalb der DB)
  todo.py          Microsoft To Do je Benutzer (Tickets, Ein-/Austritte mit Checkliste, beidseitig)
  connections.py   Verbindungs-Center: Status, Live-Test, Rechte-Prüfung, Zertifikat
  backups.py       Backup-Wächter: Sicherungsberichte erkennen, Ampel, Tickets, „Bericht fehlt“
  domaincheck.py   Domain- & E-Mail-Sicherheit: SPF, DKIM, DMARC, MTA-STS, Zertifikat
  inventory.py     Geräte-Check: Registrierung, Meldungen des Inventar-Agenten, Befunde
  posture.py       Sicherheitslage je Kunde: Gesamtnote, Verlauf, Bericht, Angebot aus Maßnahmen
  notify.py        Benachrichtigungen: Glocke, E-Mail, Teams, Tagesstart
  audit.py         Sicherheitsprotokoll (Anmeldungen, Änderungen, Exporte)
  hardening.py     Größenlimits, Content-Security-Policy, CSV-Schutz, TOTP
  setup.py         Erste Schritte (Inbetriebnahme mit Live-Status), Demodaten entfernen
  agents/          Triage, Assistent (Werkzeuge), Angebot, Monatsbericht, Security,
                   Posteingang/KI-Mitarbeiter (inbox.py), Quartalsgespräch (qbr.py)
  mitarbeiter_api.py  API für Posteingang, Leads, Belege, Anfrageformular
  mail.py          IMAP-Abruf und SMTP-Versand (Standardbibliothek)
  growth.py        Health Score, NRR, wiederkehrender Anteil, Aktivitäten-Kaskade
  team.py          Benutzer, Login, Rollen, Aktivitäten, Wochenziele
  data_tools.py    CSV-Import (Kunden, Geräte, RMM) und Datensicherung
  billing.py       Zeiterfassung, Rechnungslauf, Rechnungen, Export
  portal.py        Kundenportal (eigene Zugänge, KI-Hilfe, Angebotsannahme)
  sla.py           SLA-Zusagen, Geschäftszeiten, Ampel, Quoten
  einvoice.py      E-Rechnung ebInterface 6.1
  pdf.py           PDFs im Corporate Design (Rechnung, Angebot, Berichte)
  documents.py     Archiv, SharePoint/OneDrive (Graph), Versand per Outlook
  payments.py      Kontoauszug-Import, Zahlungsabgleich, Belegabgleich, Mahnwesen
  maintenance.py   Wartungsplan: Vorlagen, Fälligkeit → Ticket, Nachweise
  sepa.py          SEPA-Lastschrift: Mandate, pain.008-Einzugsdatei, Bankarbeitstage
  atera.py         Atera-API (Kunden, Geräte, Alarme) + Splashtop-Sitzungsprotokolle
  bookstack.py     BookStack: Kunden-IT-Doku, Wissen in beide Richtungen
  secrets_guard.py Passwort-Wächter (Keeper statt Klartext, Schutz vor Cloud-KI)
  profitability.py Rentabilität je Kunde, Wertsicherung (VPI)
  csat.py          Kundenzufriedenheit nach gelösten Tickets
  mobile.py        Stoppuhr, Web-App-Manifest, Service Worker
  branding.py      Corporate Design (Logo, Farben, Schrift)
  rmm.py           NinjaOne-Abgleich (Kunden, Geräte, Alarme)
  subscriptions.py Lizenzen & Verträge (Fristen, Marge, Rechnungslauf)
  speech.py        Sprachnotizen lokal in Text (faster-whisper, optional)
  radar.py         Umsatz-Radar (Lifecycle, Security, NIS2, KI, Verträge)
  security.py      NIS2-/Security-Fragebogen und Bewertung
  knowledge.py     Wissenssuche (Embeddings + BM25)
  training.py      Export pseudonymisierter Trainingsdaten
  seed.py          Leistungskatalog (Beispielpreise) + Demodaten
  static/          Weboberfläche
training/finetune_lora.py   LoRA/QLoRA-Feintuning → GGUF → Ollama
docs/                       Strategie 2026–2030, KI-PC-Empfehlung, M365-Dokumentenprozess
```

## Nächste Ausbaustufen (Vorschläge)

- Weitere RMM-Anbindungen (Datto, Atera, N-able)
- Direkter BMD/RZL-Buchungsexport
