# ME-IT Cockpit

**Betriebssystem für deinen IT-Dienstleistungsbetrieb, mit KI-Agenten, die lokal und offline laufen.**

Tickets, Kunden, Geräte und Wissen an einem Ort. Dazu KI-Agenten, die Tickets einordnen, Lösungen
vorschlagen, Angebote schreiben, Monatsberichte erstellen und automatisch Umsatzchancen finden. Alles
läuft auf deinem eigenen PC (Ollama), Kundendaten verlassen das Haus nicht.

> Strategie dahinter: [docs/STRATEGIE-2026-2030.md](docs/STRATEGIE-2026-2030.md) ·
> KI-Mitarbeiter als Produkt: [docs/KI-MITARBEITER.md](docs/KI-MITARBEITER.md) ·
> PC-Empfehlung und Training: [docs/OFFLINE-KI-PC.md](docs/OFFLINE-KI-PC.md)

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
| **Leads & Pipeline** | Lead-Score, Qualifizierung, Phasen Erstgespräch → Pitch → Angebotsbesprechung, automatisches Nachfassen |
| **Belege** | Rechnungen aus dem Posteingang mit Betrag, Nummer und Datum, CSV-Export für den Steuerberater |
| **Anfrageformular** | `/anfrage` für die Website: öffentlich, mit Spamschutz und Rate-Limit, Anfragen landen direkt im Posteingang |
| **Customer Success** | Health Score je Kunde, QBR-Agent („Plan → erreicht → nächster Hebel“), NRR, Anteil wiederkehrender Umsatz, Aktivitäten-Kaskade, 10-Punkte-Selbst-Check |
| **ROI-Rechner** | Für das Verkaufsgespräch: Zeitgewinn, Wert, Amortisation, ROI im ersten Jahr |
| **Import & Sicherung** | CSV-Import für Kunden und Geräte (erkennt deutsche/englische Spalten und RMM-Exporte, mit Vorschau). Automatische Datensicherung mit Aufbewahrung, Download per Klick. |
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
| `MEIT_PASSWORD` | leer | Passwortschutz (HTTP Basic), **Pflicht**, wenn die App im Netzwerk erreichbar ist |
| `MEIT_HOST` | `127.0.0.1` | `0.0.0.0` für Zugriff aus dem LAN |
| `MAIL_PROVIDER` | `imap` | `graph` für Microsoft 365 (mit `GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET/MAILBOX`) |
| `MAIL_IMAP_*`, `MAIL_SMTP_*`, `MAIL_FROM` | leer | Postfach per IMAP/SMTP (Details: docs/KI-MITARBEITER.md) |
| `MAIL_POLL_MINUTES` | `0` | Postfach automatisch alle X Minuten abrufen |
| `BOOKING_URL` | leer | Terminbuchungs-Link für Antworten an Interessenten |
| `PUBLIC_FORM_ENABLED` / `PUBLIC_FORM_ORIGINS` | `true` / leer | Anfrageformular an/aus, Websites, die es einbinden dürfen |

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
  radar.py         Umsatz-Radar (Lifecycle, Security, NIS2, KI, Verträge)
  security.py      NIS2-/Security-Fragebogen und Bewertung
  knowledge.py     Wissenssuche (Embeddings + BM25)
  training.py      Export pseudonymisierter Trainingsdaten
  seed.py          Leistungskatalog (Beispielpreise) + Demodaten
  static/          Weboberfläche
training/finetune_lora.py   LoRA/QLoRA-Feintuning → GGUF → Ollama
docs/                       Strategie 2026–2030, KI-PC-Empfehlung
```

## Nächste Ausbaustufen (Vorschläge)

- Direkte API-Anbindung an RMM/PSA (NinjaOne, Datto, Atera) statt CSV-Export
- Kundenportal mit KI-Self-Service (Level-1)
- Zeiterfassung → Rechnungsexport (z. B. BMD, RZL)
- Mehrbenutzer mit Rollen (Techniker, Vertrieb, Geschäftsführung)
