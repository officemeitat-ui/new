# 🚀 MASTER-PROMPT – ME-IT Nexus

### Die KI-Agenten-Plattform, die ME-IT an seine Kunden verkauft

> **So verwenden Sie diesen Prompt**
>
> 1. Passen Sie die Werte in **Abschnitt 0 (Projekt-Variablen)** an: Produktname, Farben, Domain usw.
> 2. Öffnen Sie dieses Repository (oder ein neues, leeres Repository mit dem Ordner `prompts/`) in **Claude Code** – im Terminal, in der Desktop-App oder auf claude.ai/code.
> 3. Kopieren Sie **alles zwischen `PROMPT START` und `PROMPT ENDE`** und senden Sie es als erste Nachricht.
> 4. Claude liefert zuerst Architektur, Roadmap und Rückfragen und **wartet dann auf Ihr OK**. Danach arbeiten Sie die Phasen aus [`01_BUILD_PHASEN.md`](01_BUILD_PHASEN.md) der Reihe nach ab.

---

<!-- ===================== PROMPT START ===================== -->

## 0. Projekt-Variablen

| Variable | Wert |
|---|---|
| PRODUKTNAME | **ME-IT Nexus** (Arbeitstitel) |
| ANBIETER | ME-IT – IT-Dienstleister aus Österreich |
| ZIELMARKT | KMU mit 5–250 Mitarbeitenden in Österreich, Deutschland und der Schweiz |
| UI-SPRACHEN | Deutsch (de-AT, Standard), Englisch |
| ANSPRACHE IN DER UI | Sie-Form |
| HOSTING | ausschließlich EU (z. B. Hetzner in Deutschland/Finnland oder AWS eu-central-1 Frankfurt) |
| PRIMÄRFARBE | `{{#HEX – Markenfarbe ME-IT}}` |
| APP-DOMAIN | `{{app.ihre-domain.at}}` |
| MARKENTON | kompetent, klar, menschlich – kein Buzzword-Bingo |
| DEMO-MANDANT | „Huber Haustechnik GmbH“, Linz – 18 Mitarbeitende, Installateur (Heizung, Sanitär, Wärmepumpen) |

---

## 1. Ihre Rolle

Sie übernehmen gleichzeitig die Rollen **Principal Software Engineer, Product Designer, Security Architect und AI Engineer** mit langjähriger Erfahrung im Bau von B2B-SaaS-Produkten. Sie bauen **produktionsreife Software**, keine Demo und keinen Prototyp. Jede Entscheidung muss sich daran messen lassen, ob ME-IT das Produkt morgen mit gutem Gewissen an einen zahlenden Kunden verkaufen kann.

---

## 2. Kontext und Geschäftsmodell

ME-IT ist ein österreichisches IT-Dienstleistungsunternehmen. ME-IT verkauft {{PRODUKTNAME}} als **Managed Service** an seine Kunden:

- Kunden zahlen eine **Monatsgebühr** (Pakete) und eine **einmalige Einrichtung**. Die KI-Nutzung ist über ein Kontingent inkludiert, Mehrverbrauch wird abgerechnet.
- ME-IT richtet Agenten und Integrationen für Kunden ein, betreut sie und verkauft Erweiterungen: neue Agenten, Integrationen, Schulungen.
- ME-IT kann später eigene **Wiederverkäufer** (Partner) anbinden. Die Architektur muss deshalb die Ebenen *Partner → Mandant (Kunde) → Teams* abbilden.

Daraus folgt: Mandantenfähigkeit, White-Label, Nutzungsmessung, Partner-Konsole und messbarer Kundennutzen (ROI) sind **Kernfunktionen, keine Extras**.

---

## 3. Produktvision

**Elevator-Pitch:**
> „{{PRODUKTNAME}} gibt jedem KMU ein Team aus digitalen Mitarbeitern: KI-Agenten, die E-Mails bearbeiten, Angebote schreiben, Kundenanfragen beantworten und Daten zwischen Ihren Programmen bewegen. Sicher, DSGVO-konform in der EU betrieben und in 10 Minuten startklar.“

**Vier Produktprinzipien.** Wenden Sie sie bei jeder Entscheidung an:

1. **Wert in 10 Minuten.** Ein neuer Kunde hat nach dem Onboarding einen funktionierenden Agenten, der mit echten Daten arbeitet.
2. **Der Mensch behält die Kontrolle.** Alles, was nach außen wirkt (E-Mail senden, Daten ändern, Geld bewegen), läuft standardmäßig über eine Freigabe. Jeder Schritt ist nachvollziehbar.
3. **Der Nutzen ist messbar.** Jede Ausführung fließt in ein ROI-Dashboard ein: gesparte Stunden und gesparte Euro.
4. **Das Produkt passt in die bestehende IT.** Die Plattform verbindet sich mit Microsoft 365, Google Workspace, CRM, Buchhaltung und Co. Der Kunde muss seine IT nicht an die Plattform anpassen.

---

## 4. Nutzerrollen

| Rolle | Ebene | Darf |
|---|---|---|
| Plattform-Admin (ME-IT) | Partner | Partner-Konsole, Pakete, Preise, globale Vorlagen. Zugriff auf Kundendaten **nur** mit freigegebenem Support-Zugriff |
| Partner-Techniker (ME-IT) | Partner | Mandanten einrichten, Agenten und Integrationen konfigurieren (mit Support-Zugriff) |
| Owner | Mandant | Abrechnung, Mitglieder, Sicherheit, alles im Mandanten |
| Admin | Mandant | Agenten, Workflows, Integrationen und Wissen verwalten |
| Mitglied | Mandant | Agenten nutzen, eigene Chats, Freigaben (wenn zugewiesen) |
| Externe Person | extern | über Widget, WhatsApp oder E-Mail mit freigegebenen Agenten sprechen, ohne Login |

Rechte sind **feingranulare Permissions** (z. B. `agent.run`, `agent.edit`, `approval.decide`, `billing.manage`). Rollen sind Bündel davon. Ab dem Business-Paket können Mandanten eigene Rollen anlegen.

---

## 5. Module und Funktionsumfang

> Legende: **[MVP]** = Teil der ersten verkaufsfähigen Version · **[Später]** = in der Roadmap, aber nicht im MVP

### M1 – Mandanten, Partner und White-Label
- [MVP] Hierarchie Partner → Mandant → Teams/Abteilungen.
- [MVP] White-Label pro Partner und Mandant: Logo, Favicon, Produktname, E-Mail-Absender. Aus **einer** Primärfarbe wird automatisch eine barrierefreie Farbpalette erzeugt (Hell- und Dunkelmodus).
- [Später] Eigene Domain pro Mandant (CNAME mit automatischem TLS).
- [MVP] Mandanten-Provisionierung in unter einer Minute aus der Partner-Konsole: Paket, Start-Vorlagen und Einladung an den Owner.
- **Akzeptanz:** Eine automatisierte Testsuite beweist, dass kein Nutzer Daten eines fremden Mandanten lesen oder schreiben kann. Das gilt auf Datenbankebene (Row Level Security) und auf Anwendungsebene.

### M2 – Anmeldung und Kontosicherheit
- [MVP] E-Mail + Passwort, Magic Link, Passkeys, TOTP-2FA (für Admins erzwingbar).
- [MVP] SSO mit Microsoft Entra ID (OIDC) und Google.
- [Später] SAML 2.0 und SCIM-Provisionierung für Enterprise-Kunden.
- [MVP] Sitzungs- und Geräteübersicht, Benachrichtigung bei neuen Anmeldungen, Schutz vor Brute-Force-Angriffen.

### M3 – Agent Studio (No-Code-Baukasten für Agenten)
- [MVP] **„Agent aus Beschreibung“:** Die Nutzerin beschreibt in Alltagssprache, was der Agent tun soll. Ein Meta-Agent (siehe `prompts/02_AGENTEN_BIBLIOTHEK.md`, *Agent-Architekt*) erzeugt einen vollständigen Entwurf: Rolle, Anweisungen, benötigte Integrationen, Freigaberegeln, Testfälle. Die Nutzerin prüft und passt an.
- [MVP] Konfiguration: Name, Avatar, Aufgabe, Anweisungen, Tonalität, Sprache, Modellstufe (*Smart / Ausgewogen / Schnell*), Werkzeuge (aus installierten Integrationen, je Aktion *automatisch / Freigabe / verboten*), Wissenssammlungen, Gedächtnis an/aus, Budget pro Ausführung und pro Monat, Kanäle.
- [MVP] **Testbereich** direkt daneben: live chatten und jeden Schritt sehen (Zusammenfassung des Denkprozesses, Werkzeugaufrufe, Ergebnisse, Kosten). Im **Trockenlauf-Modus** werden schreibende Aktionen nur simuliert.
- [MVP] Versionierung: Entwurf → Veröffentlichen. Diff zwischen Versionen, Rollback mit einem Klick.
- [MVP] Testfälle (Evals) pro Agent: Eingabe + erwartetes Verhalten. Sie laufen vor jeder Veröffentlichung, das Ergebnis erscheint als Ampel.

### M4 – Agent-Runtime
- [MVP] Siehe **Abschnitt 8**. Das ist der technisch wichtigste Teil.

### M5 – Wissensdatenbank (RAG)
- [MVP] Quellen: Upload (PDF, DOCX, XLSX, PPTX, TXT, MD, HTML, E-Mails im Format .eml/.msg, Bilder mit OCR) und Synchronisation aus SharePoint/OneDrive und Google Drive (inkrementell).
- [Später] Website-Crawl (unter Beachtung von robots.txt), Nextcloud.
- [MVP] Pipeline: Parsen → Bereinigen → strukturbewusstes Chunking (Überschriften, Tabellen) → Embeddings in pgvector. Zusätzlich Postgres-Volltextsuche mit der Konfiguration `german`. Beides wird zu einer **Hybrid-Suche** mit Reciprocal Rank Fusion kombiniert, optional mit Reranking.
- [MVP] Antworten mit **Quellenangaben** (Dokument, Seite oder Abschnitt, Link) über die Citations-Funktion der Claude API.
- [MVP] Rechte pro Sammlung (Rollen und Teams). Agenten sehen nur die Sammlungen, die ihnen zugewiesen sind.
- [MVP] Aktualität: Sync-Status und letzte Aktualisierung sind sichtbar. Wird ein Dokument im Quellsystem gelöscht, wird es auch aus dem Index gelöscht.
- **Akzeptanz:** Ein Testset mit mindestens 30 Fragen auf den Demo-Daten. Die Trefferquote der Quellen (Recall@5) und die Antwortqualität erscheinen im Eval-Bericht.

### M6 – Workflows und Automationen
- [MVP] Visueller Editor (React Flow / `@xyflow/react`) mit diesen Knoten: Trigger, Agent, Aktion, Bedingung, Verzweigung, Schleife über Liste, Warten, Freigabe, Benachrichtigung, Unter-Workflow, Daten-Transformation (JSONata, kein beliebiger Code).
- [MVP] **„Workflow aus Beschreibung“** funktioniert analog zu M3 (Meta-Agent *Workflow-Architekt*).
- [MVP] Trigger: Zeitplan (Cron, Zeitzone `Europe/Vienna`), eingehende E-Mail, Webhook, Formular, Ereignis aus einer Integration (z. B. neuer Deal, neue Datei), manuell, aus dem Chat.
- [MVP] **Dauerhafte Ausführung:** Jeder Schritt wird gespeichert. Nach einem Absturz wird die Ausführung fortgesetzt. Wiederholungen mit Backoff, Idempotenzschlüssel, Zeitlimits.
- [MVP] Ausführungsverlauf mit Schritt-für-Schritt-Ansicht und der Funktion „Ab diesem Schritt erneut ausführen“.

### M7 – Integrationen
- Siehe **Abschnitt 9**.

### M8 – Kanäle
- [MVP] **Chat in der Web-App** (Hauptoberfläche): Streaming, Datei-Upload, Markdown und Tabellen, Quellenangaben, Kopieren und Exportieren, Feedback (👍/👎 + Kommentar).
- [MVP] **Web-Widget** zum Einbetten auf der Kunden-Website mit einer Script-Zeile. Voll gebrandet, mit KI-Hinweis (EU AI Act, Art. 50), Übergabe an einen Menschen, Öffnungszeiten und Lead-Erfassung.
- [MVP] **E-Mail:** Ein Agent kann ein Postfach überwachen oder eine eigene Eingangsadresse bekommen.
- [Später] Microsoft Teams (Bot), WhatsApp Business (Cloud API), Slack – in dieser Reihenfolge.
- [Später] Telefon/Voice: Sprachagent über einen SIP-Anbieter.
- Alle Kanäle landen im **selben Gesprächsmodell** (`conversations` / `messages` / `contacts`).

### M9 – Freigabe-Inbox (Human-in-the-loop)
- [MVP] Zentrale Inbox: Der Agent schlägt eine Aktion vor, z. B. „E-Mail an Kunde X senden“ mit Vorschau. Optionen: *Freigeben*, *Bearbeiten und freigeben*, *Ablehnen mit Begründung*. Die Begründung fließt als Feedback an den Agenten zurück.
- [MVP] Benachrichtigung per Web-Push (PWA) und E-Mail. Mobile Freigabe mit einem Tipp. [Später] Freigabe direkt in Microsoft Teams.
- [MVP] Regeln pro Agent und Aktion: *automatisch*, *Freigabe nötig*, *verboten*. Dazu Schwellenwerte (z. B. Betrag über 500 € oder externe Empfänger), Eskalation nach X Stunden und Vertretungsregeln.
- [Später] **Modus „Vertrauen aufbauen“:** Nach N fehlerfreien Freigaben schlägt das System vor, eine Aktion zu automatisieren. Es stellt **nie** selbst um.

### M10 – Auswertungen und ROI
- [MVP] Dashboard pro Mandant: Ausführungen, Erfolgsquote, Freigabequote, gesparte Stunden und Euro, Kosten, ROI-Faktor, Top-Agenten, Trends.
- [MVP] Berechnung: Pro Agent bzw. Workflow gibt es einen Wert „manuelle Minuten pro Vorgang“ (Vorgabe aus der Vorlage, editierbar). Dieser wird mit der Zahl der erfolgreichen Vorgänge und dem Stundensatz des Mandanten multipliziert.
- [MVP] **Automatischer Monatsreport als PDF** per E-Mail an den Owner, im Branding des Mandanten. Das ist das stärkste Instrument für Kundenbindung und Verkauf.
- [MVP] Qualitätsmetriken: Feedback-Quote, Ablehnungsgründe, Eval-Ergebnisse.

### M11 – Abrechnung und Nutzungsmessung
- [MVP] Jeder Aufruf von LLM, Embeddings, Integration oder Kanal erzeugt ein `UsageEvent`: Mandant, Agent, Modell, Tokens (inkl. Cache-Lese- und Cache-Schreib-Tokens), Einkaufskosten, Verkaufspreis.
- [MVP] Preistabellen (Modellpreise, Aufschläge, Pakete) liegen **in der Datenbank mit Gültigkeitsdatum**, nicht im Code.
- [MVP] Pakete mit inkludiertem KI-Kontingent und Limits (Agenten, Nutzer, Integrationen, Wissensspeicher) sowie Abrechnung des Mehrverbrauchs.
- [MVP] Budget-Warnungen bei 80 % und 100 %, optional harte Limits. Jeder Agent kann ein eigenes Budget haben.
- [MVP] Monatlicher Abrechnungsexport (CSV/XLSX) für die Buchhaltung von ME-IT.
- [Später] Stripe Billing (SEPA-Lastschrift, Karte) mit korrekter USt-Logik (Österreich, Reverse Charge für B2B in der EU).

### M12 – Partner-Konsole (ME-IT)
- [MVP] Übersicht aller Mandanten: Paket, Nutzer, Nutzung, Kosten gegenüber Umsatz (**Marge**), Health-Score (Fehlerquote, Aktivität, Budget), Abwanderungsrisiko.
- [MVP] Mandanten anlegen, Paket wechseln, sperren, exportieren, löschen (mit Schutzfrist).
- [MVP] **Vorlagen-Verteilung:** Vorlagen für Agenten und Workflows zentral pflegen und an Mandanten ausrollen, versioniert. Der Mandant entscheidet, ob er ein Update übernimmt.
- [MVP] **Support-Zugriff:** Der Kunde erteilt einen zeitlich begrenzten Zugriff. Jede Aktion landet im Audit-Log. Solange der Zugriff aktiv ist, zeigt ein Banner „ME-IT-Support ist angemeldet“.
- [Später] In-App-Ankündigungen an Mandanten und Upsell-Hinweise (z. B. „Budget fast verbraucht → Paket-Upgrade“).

### M13 – Compliance und Governance
- [MVP] **DSGVO:** AVV-Vorlage, Liste der Unterauftragsverarbeiter, Export für das Verarbeitungsverzeichnis, Auskunft/Export/Löschung pro Person, konfigurierbare Aufbewahrungsfristen (Chats, Logs, Dokumente). Optional werden personenbezogene Daten vor dem LLM-Aufruf maskiert.
- [MVP] **EU AI Act:** KI-Kennzeichnung gegenüber Dritten in allen Kanälen (Art. 50) und Kennzeichnung KI-generierter Inhalte. Protokollierung. Pro Agent ein **Agenten-Steckbrief** (Zweck, verwendete Daten, Risiken, Freigaberegeln).
- [MVP] Vorlagen in Hochrisiko-Bereichen (z. B. Personalauswahl, Kreditwürdigkeit) werden blockiert oder nur als Assistenz ohne automatisierte Entscheidung zugelassen. Ein Hinweis erklärt den Grund.
- [Später] Schulungsmodul „KI-Kompetenz“ (Art. 4) mit Teilnahmenachweis.
- [MVP] **Audit-Log:** unveränderlich (append-only mit Hash-Kette), filterbar, exportierbar.
- [MVP] Barrierefreiheit nach WCAG 2.2 AA.

### M14 – Onboarding und Hilfe
- [MVP] Assistent: Branche wählen → passende Agenten-Vorlagen vorschlagen → Microsoft 365 oder Google verbinden → erste Wissensquelle → erster Testlauf → Erfolgserlebnis. Ziel: **unter 10 Minuten**.
- [MVP] **Demo-Mandant** mit realistischen Seed-Daten (siehe DEMO-MANDANT) für Verkaufsgespräche. Per Knopfdruck zurücksetzbar.
- [Später] Hilfe-Agent in der App, der die Plattform erklärt. Seine Wissensbasis ist die eigene Dokumentation.
- [MVP] Command Palette (⌘K / Strg+K) für Navigation und Aktionen.

---

## 6. Technologie-Stack

Der Stack ist verbindlich. Abweichungen nur mit begründetem ADR.

| Bereich | Wahl |
|---|---|
| Monorepo | pnpm Workspaces + Turborepo |
| Sprache | TypeScript (`strict`) überall |
| Web-App | Next.js (App Router, aktuelle stabile Version), React Server Components, Server Actions für UI-Mutationen |
| UI | Tailwind CSS, shadcn/ui (Radix), lucide-react, `@xyflow/react` (Workflows), Recharts (Diagramme), Animationen sparsam |
| i18n | next-intl (de-AT Standard, en) |
| Validierung | Zod als **eine** Schema-Quelle für Formulare, API und Tools |
| Datenbank | PostgreSQL 16+ mit pgvector, Drizzle ORM und Migrationen, Row Level Security |
| Jobs/Queue | BullMQ auf Redis/Valkey, eigener Worker-Prozess `apps/worker`, Zustand dauerhaft in Postgres |
| Auth | Better Auth (Organizations, 2FA, Passkeys, SSO) |
| LLM | Anthropic TypeScript SDK `@anthropic-ai/sdk`; für reine EU-Verarbeitung zusätzlich `@anthropic-ai/bedrock-sdk` und `@anthropic-ai/vertex-sdk` |
| MCP | offizielles `@modelcontextprotocol/sdk` |
| Dateien | S3-kompatibler Objektspeicher in der EU |
| E-Mail | SMTP über einen EU-Anbieter, Templates mit React Email |
| Öffentliche API | REST unter `/api/v1`, OpenAPI 3.1 automatisch aus Zod generiert, API-Keys mit Scopes, ausgehende Webhooks mit HMAC-Signatur |
| Observability | OpenTelemetry, pino (strukturierte Logs), Sentry (EU-Region oder selbst gehostet) |
| Tests | Vitest (Unit/Integration, Testcontainers für Postgres/Redis), Playwright (E2E), eigenes Eval-Framework für Agenten |
| CI/CD | GitHub Actions: Lint, Typecheck, Tests, Build, Evals, Security-Scans (Dependency-Audit, Secret-Scanning) |
| Deployment | Docker-Images, `docker compose` für lokal und Einzelserver, Infrastruktur als Code, Hosting in der EU |

**Ordnerstruktur:**

```
apps/
  web/          Next.js – App, Partner-Konsole, öffentliche API, Widget-Endpunkte
  worker/       Agentenläufe, Workflows, Synchronisationen, Zeitpläne
  widget/       einbettbares Chat-Widget (kleines Bundle, z. B. Preact)
packages/
  db/           Drizzle-Schema, Migrationen, RLS-Policies, Seeds (inkl. Demo-Mandant)
  core/         Domänenlogik, Berechtigungen, Mandanten-Kontext
  agents/       Agent-Runtime, Provider-Abstraktion, Prompts, Evals
  connectors/   Connector-SDK und Konnektoren
  knowledge/    Parsing, Chunking, Embeddings, Suche
  ui/           Designsystem
  config/       ESLint-, TypeScript- und Tailwind-Presets
docs/           ARCHITECTURE.md, adr/, ROADMAP.md, PROGRESS.md, Runbooks, Handbücher
prompts/        diese Prompt-Bibliothek (Quelle für Agenten-Vorlagen)
```

---

## 7. Datenmodell (Kern)

**Regeln:** Jede mandantenbezogene Tabelle hat eine `tenant_id` (NOT NULL, indexiert) und eine RLS-Policy. Der Mandanten-Kontext wird pro Request bzw. Job gesetzt (z. B. `SET LOCAL app.tenant_id`). IDs sind UUIDv7. Jede Tabelle hat `created_at` und `updated_at`. Soft-Delete nur dort, wo Wiederherstellung nötig ist. Harte Löschjobs setzen die DSGVO-Fristen um.

| Bereich | Entitäten |
|---|---|
| Organisation | `partners`, `tenants` (Paket, Branding, Einstellungen, Datenregion, LLM-Provider), `teams` |
| Identität | `users`, `memberships`, `roles`, `permissions`, `invitations`, `sessions`, `api_keys`, `support_access_grants` |
| Agenten | `agent_templates` (global/Partner), `agents`, `agent_versions` (Konfiguration als JSON, `published_at`), `agent_memories` |
| Integrationen | `connector_catalog`, `connections` (Installation pro Mandant), `credentials` (verschlüsselt), `action_policies` |
| Wissen | `knowledge_collections`, `documents`, `document_chunks` (Embedding-Vektor + `tsvector`), `sync_jobs` |
| Gespräche | `channels`, `contacts`, `conversations`, `messages`, `attachments` |
| Ausführung | `runs`, `run_steps`, `approvals`, `notifications` |
| Workflows | `workflows`, `workflow_versions`, `triggers`, `schedules`, `workflow_runs`, `workflow_step_runs` |
| Geld und Nutzen | `usage_events`, `price_tables`, `plans`, `subscriptions`, `budgets`, `billing_exports`, `roi_events` |
| Qualität | `eval_cases`, `eval_runs`, `eval_results`, `feedback` |
| Compliance | `audit_logs` (Hash-Kette), `data_subject_requests`, `retention_policies` |

---

## 8. Agent-Runtime – technische Spezifikation

### 8.1 Modelle und Routing

Der Code kennt nur **Modellstufen**. Die Zuordnung von Stufe zu Modell ist pro Partner/Mandant in der Datenbank konfigurierbar.

| Stufe | Standardmodell | Einsatz |
|---|---|---|
| **Smart** (Standard für neue Agenten) | `claude-opus-5-5` | komplexe mehrstufige Aufgaben, Orchestrator, Agent- und Workflow-Architekt |
| **Ausgewogen** | `claude-sonnet-5-5` | Alltagsagenten mit hohem Volumen, Chat |
| **Schnell** | `claude-haiku-5-5` | Klassifizieren, Routing, Extraktion, Zusammenfassungen in großer Menge |

- Kosten werden **zuerst über `effort` gesteuert** (`low` / `medium` / `high` / `xhigh` / `max`), erst danach über einen Modellwechsel. Neue Modell- oder Effort-Einstellungen werden mit den Evals gemessen, bevor sie zum Standard werden.
- Modell-IDs werden exakt so verwendet wie angegeben, ohne Datums-Suffix. Neue Modelle werden über die Konfiguration eingeführt, nicht über eine Code-Änderung.

### 8.2 Regeln für die Claude API

Stand November 2026. **Vor der Implementierung gegen die aktuelle offizielle Dokumentation prüfen.**

- Verwenden Sie das offizielle SDK. Kein eigener HTTP-Client, keine OpenAI-kompatiblen Shims. Nutzen Sie die SDK-Typen (`Anthropic.MessageParam`, `Anthropic.Tool` …) statt eigener Duplikate.
- **Thinking:** `thinking: { type: "adaptive" }`. Die Tiefe steuert `output_config.effort`; setzen Sie Effort immer explizit (bei `claude-opus-5-5` ist der Standard `medium`). Kein `budget_tokens`, kein `type: "disabled"` (beides führt bei aktuellen Modellen zu einem 400-Fehler).
- Keine Sampling-Parameter (`temperature`, `top_p`, `top_k`) senden.
- **Kein Assistant-Prefill.** Für strukturierte Ausgaben verwenden Sie Structured Outputs (`output_config.format` bzw. `client.messages.parse()`).
- **`tool_choice`** nur `auto` (oder `none`). Erzwungene Tool-Wahl (`any`/`tool`) wird von den aktuellen Modellen abgelehnt. Die Werkzeugnutzung steuern Sie über Anweisungen; definieren Sie Werkzeuge mit `strict: true`.
- **Streaming** für alle Chat- und Agentenläufe. Wird nur das Endergebnis gebraucht, nutzen Sie `stream.finalMessage()`. `max_tokens` großzügig wählen (beim Streaming etwa 64k).
- Wenn Sie `eager_input_streaming: true` nutzen, validieren Sie jede Tool-Eingabe vor der Ausführung gegen das Zod-Schema.
- **Agentenschleife:** Tool Runner des SDK (`client.beta.messages.toolRunner` mit `betaZodTool`) oder eine eigene Schleife, wenn Pausieren für Freigaben das erfordert. Die Entscheidung kommt in ein ADR. Parallele Tool-Aufrufe werden gemeinsam ausgeführt, und **alle** Ergebnisse gehen in **einer** User-Nachricht zurück. Fehler gehen als `tool_result` mit `is_error: true` zurück.
- Prüfen Sie **immer `stop_reason`** (`end_turn`, `tool_use`, `max_tokens`, `pause_turn`, `refusal`), bevor Sie Inhalte lesen. Bei `refusal` wird `stop_details` geloggt, und der Nutzer bekommt eine verständliche Antwort. Auf der Anthropic API werden serverseitige Fallbacks aktiviert (`fallbacks: "default"` mit Beta `server-side-fallback-2026-07-01`). Auf anderen Providern übernimmt die Refusal-Fallback-Middleware des SDK diese Aufgabe.
- **Prompt Caching:** Die Reihenfolge ist `tools` → `system` → `messages`. Stabile Teile kommen zuerst und bleiben unverändert: Basis-Systemprompt der Plattform, Agenten-Anweisungen, sortierte Tool-Liste. Veränderliche Werte (Datum, Uhrzeit, Nutzername, Request-IDs) kommen **nie** in den gecachten Prefix, sondern in die Nachrichten. Die Cache-Trefferquote (`usage.cache_read_input_tokens`) wird im Tracing überwacht.
- **Lange Gespräche:** serverseitige Compaction (Beta) bzw. Context Editing. Hängen Sie `response.content` vollständig an die Historie an, nicht nur den Text. Die Historie wird **nur angehängt, nie nachträglich bearbeitet**, denn Thinking-Blöcke sind an das jeweilige Gespräch gebunden.
- Tool-Eingaben immer mit `JSON.parse` und Zod parsen, nie per String-Vergleich.
- **Fehlerbehandlung:** spezifische SDK-Fehlerklassen (z. B. `RateLimitError`, `APIConnectionError`). Retries mit Backoff für 429/5xx; 400er werden nicht wiederholt.
- **Massenverarbeitung** (z. B. 2.000 Belege) über die Message Batches API (50 % günstiger, nur auf der Anthropic API). Auf anderen Providern über die eigene Queue.
- **RAG:** Dokument-Blöcke mit `citations: { enabled: true }`, damit die Antworten Quellenangaben enthalten.

### 8.3 Provider-Abstraktion und Datenverarbeitung in der EU

- Ein Interface `LlmProvider` mit drei Implementierungen:
  - `anthropic`: Claude API, Standard.
  - `bedrock`: Amazon Bedrock in einer EU-Region, Client `AnthropicBedrockMantle`, Modell-IDs mit Präfix `anthropic.`.
  - `vertex`: Google Vertex AI, Client `AnthropicVertex`, Region `eu`.
- Der Provider ist pro Mandant wählbar. Enterprise-Option: „Datenverarbeitung ausschließlich in der EU“. Vor dem Go-live wird geprüft, ob die Modelle in der jeweiligen Region verfügbar sind.
- **Capability-Matrix im Code:** MCP-Connector, Files API, Batches, Web-Suche und serverseitige Fallbacks gibt es nicht auf jedem Provider. Die Plattform implementiert deshalb MCP-Client, Datei-Handling und Hintergrundverarbeitung **selbst**. So läuft jeder Agent auf jedem Provider.
- Embeddings laufen über ein eigenes Interface (z. B. Voyage AI oder ein selbst gehostetes, mehrsprachiges Modell wie `bge-m3` für vollständigen EU-Betrieb). Die Dimension steht in der Konfiguration. Bei einem Wechsel des Embedding-Modells läuft ein Re-Embedding-Job.

### 8.4 Ablauf eines Agentenlaufs

1. Ein Auslöser (Chat, Workflow, Kanal, Zeitplan) erzeugt einen `Run` mit Mandanten-Kontext, Agentenversion und Budget.
2. **Kontext aufbauen:** Basis-Systemprompt + Agenten-Anweisungen + Werkzeugdefinitionen bilden den gecachten Teil. Danach folgen als Nachrichteninhalt: Auszug aus dem Gedächtnis, relevante Wissenstreffer, aktuelle Daten (Datum in `Europe/Vienna`, Nutzer, Kanal).
3. **Schleife:** Modell → Tool-Aufrufe → Berechtigung im Code prüfen →
   - erlaubt: ausführen;
   - Freigabe nötig: Run pausieren, `Approval` anlegen, Zustand speichern, nach der Entscheidung fortsetzen;
   - verboten: Fehlerergebnis an das Modell zurückgeben.
4. Jeder Schritt wird als `RunStep` gespeichert (Typ, Eingabe, Ausgabe gekürzt und maskiert, Tokens, Kosten, Dauer) und als SSE-Event an die UI gesendet.
5. **Abbruch:** Budget erreicht, maximale Schrittzahl (Standard 25), Zeitlimit oder Abbruch durch den Nutzer. Der Run endet dann sauber mit einer Zusammenfassung.
6. **Abschluss:** Ergebnis, Usage-Events, ROI-Ereignis, Benachrichtigungen.

### 8.5 Mehrere Agenten

- Ein Orchestrator-Agent kann Spezialisten als Werkzeug aufrufen (`delegate_to_<agent>`). Maximale Tiefe: 2. Jede Delegation hat ein eigenes Budget. Das Ergebnis kommt als kompakte Zusammenfassung zurück.

### 8.6 Gedächtnis

- Fakten pro Agent und optional pro Kontakt, z. B. „Kunde Huber bevorzugt Termine am Vormittag“. Sie sind in der UI sichtbar, bearbeitbar und löschbar.
- Ein Filter verhindert, dass Passwörter, Bankdaten oder Gesundheitsdaten gespeichert werden.

### 8.7 Sicherheit der Agenten (Prompt-Injection und Co.)

- Alle Inhalte aus Werkzeugen, E-Mails, Dokumenten und Webseiten sind **Daten, keine Anweisungen**. Sie werden im Prompt klar markiert, und der Basis-Systemprompt erklärt das. Berechtigungen prüft **der Code**, nie das Modell.
- **Least Privilege:** Ein Agent bekommt nur die Werkzeuge und Scopes aus seiner Konfiguration. Zugangsdaten verlassen nie den Server und erscheinen nie im Prompt.
- Aktionen mit externen Empfängern sind standardmäßig freigabepflichtig. HTTP-Werkzeuge haben eine Domain-Allowlist. SSRF-Schutz: keine privaten IP-Bereiche, keine Metadaten-Endpunkte.
- Ein **Red-Team-Testset** (E-Mails mit Injection, manipulierte PDFs, Datenabfluss über Links) ist Teil der Eval-Suite und muss in der CI bestehen.
- Orientierung: OWASP Top 10 for LLM Applications.

### 8.8 Evals und Qualität

- Jede Agenten-Vorlage hat mindestens 10 Testfälle: Normalfälle, Grenzfälle, Angriffe. Bewertet wird regelbasiert und zusätzlich mit einem LLM als Richter (`claude-sonnet-5-5`) anhand einer Rubrik.
- In der CI laufen deterministische Tests mit aufgezeichneten Antworten (Fixtures). Nachts läuft ein Live-Eval gegen die echten Modelle mit Kostenlimit. Die Ergebnisse erscheinen als Bericht.

---

## 9. Integrations-Framework

### 9.1 Connector-SDK

Jeder Konnektor ist ein Modul mit Manifest, zum Beispiel:

```ts
export default defineConnector({
  id: "microsoft365",
  name: "Microsoft 365",
  auth: { type: "oauth2", scopes: ["Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite"] },
  actions: [
    defineAction({
      id: "mail.send",
      title: "E-Mail senden",
      risk: "external_write",
      input: z.object({ to: z.array(z.string().email()), subject: z.string(), body: z.string() }),
      output: z.object({ messageId: z.string() }),
      handler: async (ctx, input) => { /* … */ },
    }),
  ],
  triggers: [defineTrigger({ id: "mail.received", mode: "webhook" /* oder "polling" */ })],
});
```

- **Risikoklassen:** `read`, `internal_write`, `external_write` (Daten verlassen das Unternehmen), `destructive`, `financial`. Sie bestimmen die Standard-Freigaberegeln.
- Aktionen werden automatisch zu Claude-Tools: Name, Beschreibung, JSON-Schema aus Zod, `strict: true`.
- OAuth-Tokens werden verschlüsselt gespeichert (Envelope Encryption, AES-256-GCM, Schlüssel pro Mandant) und automatisch erneuert. Läuft eine Verbindung ab, zeigt die UI „Verbindung erneuern“.
- Jeder Konnektor hat Contract-Tests mit Mocks und optional einen Live-Test mit Sandbox-Konto.
- **Regel: Erfinden Sie keine API-Endpunkte.** Arbeiten Sie nur mit der offiziellen Dokumentation des Herstellers. Wo es keine öffentliche API gibt, implementieren Sie Datei-Import/-Export oder Webhooks und dokumentieren das.

### 9.2 MCP (Model Context Protocol)

- **Plattform als MCP-Client:** Admins eines Mandanten können MCP-Server per URL (Streamable HTTP) hinzufügen, mit OAuth oder API-Key. Die Tools werden gelistet, einzeln freigeschaltet und bekommen Risikoklassen wie native Aktionen.
- **Plattform als MCP-Server:** Agenten, Wissenssammlungen und Workflows eines Mandanten werden als MCP-Tools bereitgestellt (Auth per API-Key oder OAuth). So können Kunden sie in Claude und anderen MCP-fähigen Anwendungen nutzen.

### 9.3 Generische Konnektoren (MVP)

- **HTTP/REST mit OpenAPI-Import:** Spezifikation hochladen → Aktionen werden automatisch erzeugt, Risikoklassen pro HTTP-Methode werden vorgeschlagen.
- Webhooks ein- und ausgehend (HMAC-Signaturen), E-Mail über IMAP/SMTP, CSV/Excel-Import und -Export.

### 9.4 Roadmap der Konnektoren

| Priorität | Konnektoren |
|---|---|
| **MVP** | Microsoft 365 (Outlook Mail und Kalender, Teams, SharePoint/OneDrive über Microsoft Graph), Google Workspace (Gmail, Calendar, Drive), IMAP/SMTP, Webhooks, HTTP/OpenAPI, MCP |
| **Phase 2** | HubSpot, Pipedrive, Salesforce, WhatsApp Business, Slack, Shopify, WooCommerce, Stripe, Personio, Jira, Asana, Notion, monday.com, Nextcloud |
| **Phase 3** | Buchhaltung und ERP in DACH (z. B. BMD, RZL, DATEV, Lexware Office, sevDesk, Microsoft Dynamics 365 Business Central, SAP Business One). Schnittstellen beim Hersteller prüfen, sonst Datei-Schnittstellen. Telefonie über SIP |

---

## 10. UX und Design

- **Anspruch:** Design-Niveau von Linear, Stripe oder Vercel: ruhig, schnell, hochwertig. Kein „Admin-Template“-Look.
- **Designsystem** in `packages/ui`: Tokens (Farben aus der Markenfarbe, Abstände im 4er-Raster, Radien, Schatten), Hell- und Dunkelmodus, Schrift Inter oder Geist.
- **Navigation:** Start · Chat · Agenten · Workflows · Freigaben (mit Badge) · Wissen · Integrationen · Auswertungen · Einstellungen. Die Partner-Konsole ist ein eigener Bereich.
- **Startseite** („Heute“): offene Freigaben, laufende Agenten, gesparte Zeit diese Woche, Vorschläge für den nächsten Agenten.
- **Listen:** Jede Liste hat Suche, Filter und einen Leerzustand mit klarer nächster Aktion (meist „Vorlage verwenden“). Dazu Skeleton-Loading und optimistische Updates.
- **Live-Gefühl:** Streaming-Antworten und eine Schritt-Anzeige beim Agentenlauf („Liest Posteingang … → Prüft Kalender … → Entwurf erstellt“), Toasts, Badges in Echtzeit.
- **Mobile-first** für Chat und Freigaben. Als PWA installierbar, mit Web-Push.
- **Barrierefreiheit:** WCAG 2.2 AA, vollständig per Tastatur bedienbar, sichtbare Fokus-Zustände, geprüfte Kontraste.
- **Texte:** österreichisches Deutsch, Sie-Form, kurz, ohne Fachchinesisch („Agent“ statt „LLM-Pipeline“). Zahlen, Datum und Währung im Format `de-AT` (€ 1.234,56 · 02.11.2026).

---

## 11. Nicht-funktionale Anforderungen

- **Performance:** UI-Interaktionen fühlen sich unter 100 ms an (optimistische Updates). Seiten ohne LLM-Aufruf: p95 unter 300 ms serverseitig. Die Ausgabe wird gestreamt, sobald das Modell liefert. Lighthouse-Score mindestens 90.
- **Skalierung:** 500 Mandanten und 10.000 Nutzer auf einem mittelgroßen Setup. Worker skalieren horizontal. **Faire Queue pro Mandant:** Ein Mandant kann die anderen nicht blockieren.
- **Verfügbarkeit:** Ziel 99,5 %. Backups mit Point-in-Time-Recovery, regelmäßig getesteter Restore, Runbooks.
- **Sicherheit:** OWASP ASVS Level 2, Content Security Policy, Rate-Limits, Secrets nie im Code oder in Logs, Dependency-Scanning, Audit-Log.
- **Datenhaltung:** ausschließlich in der EU.

---

## 12. Arbeitsweise

1. **Erst planen, dann bauen.** Lesen Sie diesen Prompt und `prompts/02_AGENTEN_BIBLIOTHEK.md` vollständig. Liefern Sie zuerst:
   - `docs/ARCHITECTURE.md` (Systemübersicht mit Diagramm, Datenflüsse, Mandanten-Isolation, Agent-Runtime),
   - `docs/adr/0001-…` usw. (die wichtigsten Architekturentscheidungen),
   - `docs/ROADMAP.md` (Phasen gemäß `prompts/01_BUILD_PHASEN.md` mit Akzeptanzkriterien),
   - `CLAUDE.md` (Projektregeln und Befehle für künftige Sessions),
   - Ihre offenen Fragen.

   **Dann halten Sie an und warten auf mein OK.**
2. **Vertikale Scheiben:** Jede Phase liefert lauffähige, getestete Funktionen von der Datenbank bis zur UI.
3. **Kein Fake:** keine Platzhalter-Implementierungen, kein `// TODO: implement` in fertigen Features, keine fest eingebauten Demo-Antworten im Produktivcode. Was bewusst später kommt, bekommt ein Feature-Flag und einen Eintrag in `docs/ROADMAP.md`.
4. **Tests gehören zur Aufgabe:** Unit-Tests für Logik, Integrationstests für Datenbank und Queues, E2E-Tests für die Hauptabläufe, Evals für Agenten. Die Mandanten-Isolation hat eine eigene Testsuite.
5. **Externe APIs** (inklusive Claude API und SDK): Lesen Sie vor dem Schreiben die aktuelle offizielle Dokumentation. Raten Sie nichts aus dem Gedächtnis.
6. **Nach jeder Phase:** `pnpm lint && pnpm typecheck && pnpm test` sind grün. Dazu eine kurze Anleitung „So probieren Sie es aus“, ein Update von `docs/PROGRESS.md` und Commits mit aussagekräftigen Nachrichten.
7. **Bei Unklarheiten mit großer Tragweite** (Kosten, Sicherheit, Datenmodell) fragen Sie kurz nach und geben eine Empfehlung. Kleinigkeiten entscheiden Sie selbst und dokumentieren sie.
8. **Qualität vor Menge:** Lieber fünf Funktionen, die sich wie ein Premiumprodukt anfühlen, als zwanzig halbe.

---

## 13. Lieferumfang (Definition of Done für das Gesamtprodukt)

- [ ] Lauffähig mit `docker compose up`, inklusive Demo-Mandant mit Seed-Daten
- [ ] Alle MVP-Punkte der Module M1–M14 umgesetzt, alle anderen in `docs/ROADMAP.md` eingeplant
- [ ] Die 12 Agenten-Vorlagen aus `prompts/02_AGENTEN_BIBLIOTHEK.md` sind importiert, jede mit Evals
- [ ] Testabdeckung der Kernlogik mindestens 80 %. E2E-Tests für Onboarding, Agent erstellen, Chat, Freigabe, Workflow, Integration verbinden und Abrechnung
- [ ] Sicherheits-Checkliste (Auszug ASVS L2, OWASP LLM Top 10) dokumentiert und erfüllt
- [ ] Dokumentation: Admin-Handbuch, Kundenhandbuch (Deutsch), API-Referenz (OpenAPI), Runbooks (Deployment, Backup/Restore, Incident)
- [ ] Die Verkaufsdemo aus `sales/VERKAUFSSKRIPT.md` läuft vollständig im Demo-Mandanten

---

## 14. Ihr erster Auftrag

Beginnen Sie jetzt mit Schritt 1 der Arbeitsweise. Stellen Sie am Ende Ihres Plans **höchstens fünf gezielte Fragen**, jeweils mit Ihrer Empfehlung.

<!-- ===================== PROMPT ENDE ===================== -->
