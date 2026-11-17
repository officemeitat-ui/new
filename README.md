# ME-IT Cockpit

**Betriebssystem für deinen IT-Dienstleistungsbetrieb, mit KI-Agenten, die lokal und offline laufen.**

Tickets, Kunden, Geräte und Wissen an einem Ort. Dazu KI-Agenten, die Tickets einordnen, Lösungen
vorschlagen, Angebote schreiben, Monatsberichte erstellen und automatisch Umsatzchancen finden. Alles
läuft auf deinem eigenen PC (Ollama), Kundendaten verlassen das Haus nicht.

> Strategie dahinter: [docs/STRATEGIE-2026-2030.md](docs/STRATEGIE-2026-2030.md) ·
> KI-Mitarbeiter als Produkt: [docs/KI-MITARBEITER.md](docs/KI-MITARBEITER.md) ·
> PC-Empfehlung und Training: [docs/OFFLINE-KI-PC.md](docs/OFFLINE-KI-PC.md) ·
> Outlook/SharePoint/OneDrive: [docs/M365-DOKUMENTENPROZESS.md](docs/M365-DOKUMENTENPROZESS.md) ·
> Zahlungen & Mahnwesen: [docs/ZAHLUNGEN-MAHNWESEN.md](docs/ZAHLUNGEN-MAHNWESEN.md)

## Funktionen

| Bereich | Was es macht |
|---|---|
| **Übersicht** | MRR, offene/dringende Tickets, Geräte ohne Herstellersupport, Umsatzpotenzial, auslaufende Verträge |
| **Tickets + Triage-Agent** | Jedes neue Ticket wird automatisch eingeordnet: Kategorie, Priorität, Lösungsschritte (aus Wissensdatenbank und ähnlichen gelösten Tickets), Antwortentwurf an den Kunden, Hinweis auf Verkaufschance |
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
| **Belege** | Rechnungen aus dem Posteingang mit Betrag, Nummer und Datum, PDF automatisch in `Buchhaltung/Eingangsrechnungen`, Scans per Upload, CSV-Export für den Steuerberater |
| **Zahlungen & Mahnwesen** | **QR-Code „Zahlen mit Code“** auf jeder Rechnung (EPC, alle österreichischen Banking-Apps). **Kontoauszug-Import** (George/ELBA-CSV, CAMT.053, MT940) mit automatischem Abgleich: Rechnungsnummer im Verwendungszweck → bezahlt (auch Teil- und Sammelzahlungen), sonst Vorschlag über IBAN/Kunde + Betrag. **Ausgaben ohne Beleg** für den Steuerberater. **Mahnwesen** in 3 Stufen als PDF im CD mit QR-Code, Versand per Outlook, Spesen/Verzugszinsen optional, Freigabe oder Autopilot. Altersstruktur und Zahlungsdauer (DSO). |
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
| **Kundenportal** | `/portal`: Kunden sehen Tickets, Geräte (inkl. Support-Ende), Security-Score, Angebote (online annehmen, auch Paketwahl) und Rechnungen. Tickets anlegen mit Triage, KI-Hilfe nur aus freigegebenen Anleitungen. Eigene Zugänge, strikt pro Kunde getrennt. |
| **Abrechnung** | Zeiterfassung pro Ticket/Kunde (Managed = Flatrate, sonst verrechenbar), monatlicher Rechnungslauf (Pauschale + Stunden im Viertelstundentakt + Projekte), lückenlose Nummern beim Stellen, Rechnung nach § 11 UStG als PDF im Corporate Design (Versand per Outlook), Storno, Rechnungsausgangsbuch als CSV, **E-Rechnung ebInterface 6.1** (gegen das offizielle Schema geprüft; mit Auftragsreferenz und Lieferantennummer für den Bund) |
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
| `ALLOW_CLOUD_FALLBACK` | `false` | Nur bei `true` darf Claude einspringen, wenn lokal keine KI läuft |
| `MEIT_PASSWORD` | leer | Zusätzlicher Passwortschutz (HTTP Basic) vor allem anderen. Für Teams besser: unter Einstellungen Benutzer anlegen (Login mit Rollen). |
| `MEIT_HOST` | `127.0.0.1` | `0.0.0.0` für Zugriff aus dem LAN |
| `MAIL_PROVIDER` | `imap` | `graph` für Microsoft 365 (mit `GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET/MAILBOX`) |
| `MAIL_IMAP_*`, `MAIL_SMTP_*`, `MAIL_FROM` | leer | Postfach per IMAP/SMTP (Details: docs/KI-MITARBEITER.md) |
| `MAIL_POLL_MINUTES` | `0` | Postfach automatisch alle X Minuten abrufen |
| `BOOKING_URL` | leer | Terminbuchungs-Link für Antworten an Interessenten |
| `PUBLIC_FORM_ENABLED` / `PUBLIC_FORM_ORIGINS` | `true` / leer | Anfrageformular an/aus, Websites, die es einbinden dürfen |
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
