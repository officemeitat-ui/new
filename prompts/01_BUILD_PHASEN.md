# 🧱 Build-Phasen – Prompts zum Kopieren

Nach dem [Master-Prompt](00_MASTER_PROMPT.md) bauen Sie die Plattform **Phase für Phase**. Kopieren Sie jeweils den Block einer Phase in Claude Code.

**Tipps**
- Starten Sie für jede Phase am besten eine **neue Session**. `CLAUDE.md`, `docs/ROADMAP.md` und `docs/PROGRESS.md` übertragen den Kontext.
- Prüfen Sie nach jeder Phase selbst: App starten, Abläufe durchklicken, erst dann die nächste Phase.
- Die Reihenfolge ist so gewählt, dass **nach Phase 6 eine verkaufsfähige Demo** steht.

| Phase | Inhalt | Ergebnis |
|---|---|---|
| 0 | Fundament | Monorepo, CI, Docker, Designsystem |
| 1 | Mandanten und Anmeldung | sicheres Multi-Tenant-Grundgerüst |
| 2 | Agent-Runtime und Chat | erster Agent antwortet live |
| 3 | Wissensdatenbank | Antworten mit Quellen aus Firmendokumenten |
| 4 | Integrationen und MCP | Microsoft 365, Google, IMAP, OpenAPI, MCP |
| 5 | Workflows und Freigaben | Automationen mit Human-in-the-loop |
| 6 | Agent Studio und Vorlagen | No-Code-Baukasten, 12 Vorlagen, Evals → **Demo-fähig** |
| 7 | Kanäle | Web-Widget, E-Mail-Agent, PWA-Push |
| 8 | ROI, Abrechnung, Partner-Konsole | Geschäftsmodell läuft |
| 9 | Compliance und Hardening | DSGVO, AI Act, Security-Review |
| 10 | Launch | Demo-Mandant, Doku, Onboarding, Release |

---

## Phase 0 – Fundament

```text
Setzen Sie Phase 0 aus docs/ROADMAP.md um: das technische Fundament.

Umfang:
- pnpm-Monorepo mit Turborepo gemäß Ordnerstruktur im Master-Prompt (apps/web, apps/worker, packages/*).
- TypeScript strict, ESLint, Prettier, gemeinsame Presets in packages/config.
- docker-compose.yml für Postgres (mit pgvector), Redis/Valkey, S3-kompatiblen Speicher (MinIO), Mail-Testserver (z. B. Mailpit).
- packages/db mit Drizzle, erster Migration, Mechanismus für Mandanten-Kontext + RLS (noch ohne Fachtabellen).
- packages/ui: Designsystem-Grundlage (Tokens, Hell/Dunkel, Palette aus einer Primärfarbe, Basiskomponenten mit shadcn/ui), Inter oder Geist.
- App-Shell in apps/web: Navigation, Command Palette (Strg+K), i18n mit next-intl (de-AT, en), Fehler- und Ladezustände.
- Logging (pino), OpenTelemetry-Grundsetup, Healthchecks.
- GitHub Actions: lint, typecheck, test, build.
- .env.example vollständig dokumentiert; keine Secrets im Repository.

Akzeptanzkriterien:
- `docker compose up` + `pnpm dev` starten alles; die App-Shell ist erreichbar.
- CI ist grün.
- README beschreibt Setup in maximal 5 Schritten.

Zum Schluss: PROGRESS.md aktualisieren, committen, kurze Anleitung „So probieren Sie es aus“.
```

---

## Phase 1 – Mandanten, Anmeldung und Rechte

```text
Setzen Sie Phase 1 um: Module M1 und M2 aus dem Master-Prompt.

Umfang:
- Tabellen partners, tenants, teams, users, memberships, roles, permissions, invitations, api_keys, audit_logs (Hash-Kette), support_access_grants.
- RLS-Policies für alle mandantenbezogenen Tabellen + Middleware, die den Mandanten-Kontext pro Request/Job setzt.
- Better Auth: E-Mail/Passwort, Magic Link, Passkeys, TOTP-2FA (für Admins erzwingbar), SSO mit Microsoft Entra ID und Google.
- Permission-System (feingranulare Rechte, Rollen als Bündel), serverseitig durchgesetzt; UI blendet nur aus.
- Einladungen, Mandantenwechsel für Nutzer mit mehreren Mandanten, Sitzungsübersicht.
- White-Label-Grundlage: Branding pro Partner/Mandant (Logo, Farbe, Name, E-Mail-Absender).
- Minimale Partner-Konsole: Mandant anlegen (inkl. Einladung an Owner), Liste der Mandanten.
- Support-Zugriff: Kunde erteilt zeitlich begrenzten Zugriff, Banner + Audit-Log.

Akzeptanzkriterien:
- Eigene Testsuite „tenant-isolation“: Versuche, über API, Server Actions und direkte DB-Abfragen auf fremde Mandanten zuzugreifen, schlagen alle fehl.
- E2E: Registrierung → Mandant → Einladung → Login als Mitglied → Rechte greifen.
- Jede sicherheitsrelevante Aktion erzeugt einen Audit-Log-Eintrag.
```

---

## Phase 2 – Agent-Runtime und Chat

```text
Setzen Sie Phase 2 um: Abschnitt 8 (Agent-Runtime) und den Web-Chat aus M8.

Bevor Sie Code gegen die Claude API schreiben: Lesen Sie die aktuelle offizielle Doku bzw. nutzen Sie die claude-api-Skill und halten Sie sich an Abschnitt 8.2 des Master-Prompts.

Umfang:
- packages/agents: LlmProvider-Interface (anthropic, bedrock, vertex) mit Capability-Matrix; Modellstufen aus der DB.
- Agentenschleife mit Streaming, adaptive Thinking, explizitem effort, Werkzeugen (zunächst interne Demo-Werkzeuge wie „aktuelle Uhrzeit“, „Taschenrechner“), Behandlung aller stop_reasons inkl. refusal, Refusal-Fallbacks, Retry-Logik.
- Prompt-Caching nach Abschnitt 8.2 (stabiler Prefix, Variables in die Nachrichten); Cache-Treffer im Tracing sichtbar.
- Basis-Systemprompt aus prompts/02_AGENTEN_BIBLIOTHEK.md übernehmen.
- Tabellen agents, agent_versions, conversations, messages, runs, run_steps, usage_events, price_tables.
- Ausführung im Worker (BullMQ), Fortschritt per SSE an die UI.
- Chat-UI: Streaming, Markdown, Tabellen, Datei-Upload (PDF/Bild an Claude), Schritt-Anzeige („Agent arbeitet …“), Abbrechen, Feedback 👍/👎.
- Run-Detailansicht (Trace): jeder Schritt mit Tokens, Cache-Treffern, Kosten in €, Dauer.
- Budgets: max. Schritte, Zeitlimit, Kostenlimit pro Lauf.

Akzeptanzkriterien:
- Ein Agent beantwortet live im Chat Fragen und nutzt Werkzeuge; der Trace zeigt jeden Schritt.
- Unit-Tests für Schleife, stop_reason-Behandlung und Kostenberechnung (mit aufgezeichneten Antworten, ohne echte API-Aufrufe in der CI).
- Ein Integrationstest beweist, dass der gecachte Prefix zwischen zwei Läufen byte-identisch bleibt.
```

---

## Phase 3 – Wissensdatenbank (RAG)

```text
Setzen Sie Phase 3 um: Modul M5.

Umfang:
- packages/knowledge: Parser für PDF, DOCX, XLSX, PPTX, TXT, MD, HTML, EML/MSG, Bilder (OCR); strukturbewusstes Chunking; Embedding-Interface (austauschbar); Speicherung in pgvector + tsvector (german).
- Hybrid-Suche (Vektor + Volltext, Reciprocal Rank Fusion), optional Reranking.
- Sammlungen mit Rechten (Rollen/Teams), Zuweisung an Agenten.
- Werkzeug `wissen.suchen` für Agenten; Antworten mit Citations (Dokument, Seite, Link).
- UI: Sammlungen, Upload mit Fortschritt, Dokumentvorschau, Sync-Status, Löschen.
- Hintergrund-Jobs für Verarbeitung und Re-Embedding.

Akzeptanzkriterien:
- Demo-Daten des Demo-Mandanten (Preisliste, AGB, Produktdatenblätter, Wartungsverträge, FAQ) sind indexiert.
- Eval mit ≥ 30 Fragen: Recall@5 und Antwortqualität werden berichtet; Zielwerte in ROADMAP.md festhalten.
- Ein Agent ohne Zugriff auf eine Sammlung findet deren Inhalte nachweislich nicht.
```

---

## Phase 4 – Integrationen und MCP

```text
Setzen Sie Phase 4 um: Abschnitt 9 (Integrations-Framework).

Umfang:
- packages/connectors: Connector-SDK (defineConnector/defineAction/defineTrigger), Risikoklassen, automatische Umwandlung in Claude-Tools (strict), verschlüsselte Credentials (Envelope Encryption), OAuth-Flows mit Token-Refresh.
- Konnektoren MVP: Microsoft 365 (Mail, Kalender, Teams-Nachrichten, SharePoint/OneDrive), Google Workspace (Gmail, Calendar, Drive), IMAP/SMTP, Webhooks (ein/aus mit HMAC), HTTP mit OpenAPI-Import.
- MCP-Client (Streamable HTTP, Auth, Tool-Allowlist, Risikoklassen) und MCP-Server der Plattform.
- Action-Policies pro Agent: automatisch / Freigabe / verboten (Freigabe-UI kommt in Phase 5 – bis dahin werden Freigabe-Aktionen blockiert und protokolliert).
- UI: Integrations-Katalog (Karten mit Logo, Status), Verbinden-Assistent, Verbindungsstatus, „Verbindung erneuern“.
- SSRF-Schutz und Domain-Allowlist für HTTP/OpenAPI/MCP.

Regel: Nur dokumentierte, offizielle API-Endpunkte verwenden. Quellen-Links zur Herstellerdoku in jedem Konnektor als Kommentar.

Akzeptanzkriterien:
- Contract-Tests mit Mocks für jeden Konnektor; dokumentierte Anleitung für Live-Tests mit Sandbox-Konten (Entra-App-Registrierung, Google-OAuth-Client).
- Ein Agent liest im Demo-Mandanten Mails und erstellt einen Kalendereintrag (gegen Mock oder Sandbox).
- Sicherheitstests: interne IPs/Metadaten-Endpunkte werden blockiert.
```

---

## Phase 5 – Workflows und Freigabe-Inbox

```text
Setzen Sie Phase 5 um: Module M6 und M9.

Umfang:
- Workflow-Engine im Worker: dauerhafte Ausführung (Zustand in Postgres), Retries mit Backoff, Idempotenzschlüssel, Zeitlimits, Fortsetzen nach Neustart, faire Queue pro Mandant.
- Knoten: Trigger, Agent, Aktion, Bedingung, Verzweigung, Schleife, Warten, Freigabe, Benachrichtigung, Unter-Workflow, JSONata-Transformation.
- Trigger: Cron (Europe/Vienna), E-Mail-Eingang, Webhook, Formular, Integrations-Ereignis, manuell, aus dem Chat.
- Visueller Editor mit @xyflow/react: Drag & Drop, Validierung, Testlauf mit Beispieldaten, Versionierung.
- „Workflow aus Beschreibung“ mit dem Workflow-Architekten aus prompts/02_AGENTEN_BIBLIOTHEK.md (Structured Outputs).
- Freigabe-Inbox: Vorschau (z. B. gerenderte E-Mail), Freigeben / Bearbeiten und freigeben / Ablehnen mit Begründung; Regeln, Schwellenwerte, Eskalation, Vertretung; Pausieren und Fortsetzen von Agentenläufen.
- Benachrichtigungen: In-App, E-Mail, Web-Push (PWA).
- Ausführungsverlauf mit „ab diesem Schritt erneut ausführen“.

Akzeptanzkriterien:
- E2E: Webhook → Agent erstellt E-Mail-Entwurf → Freigabe auf dem Handy-Viewport → E-Mail wird (gegen Mock) gesendet → Verlauf vollständig.
- Chaos-Test: Worker wird mitten im Workflow beendet; nach Neustart läuft der Workflow ohne doppelte Aktionen weiter.
```

---

## Phase 6 – Agent Studio, Vorlagen und Evals (→ Demo-fähig)

```text
Setzen Sie Phase 6 um: Modul M3 + Abschnitt 8.8 + Import der Vorlagen.

Umfang:
- Agent Studio: Konfiguration links, Testbereich rechts (Live-Chat mit Trace), Trockenlauf-Modus, Versionierung mit Diff und Rollback.
- „Agent aus Beschreibung“ mit dem Agent-Architekten aus prompts/02_AGENTEN_BIBLIOTHEK.md (Structured Outputs, danach Review durch den Nutzer).
- Vorlagen-Galerie mit Filter nach Branche und Aufgabe; alle 12 Vorlagen aus prompts/02_AGENTEN_BIBLIOTHEK.md importieren (Systemprompt, Werkzeuge, Freigaberegeln, ROI-Minuten, Testfälle).
- Eval-Framework: Testfälle pro Agent (normal, Grenzfall, Angriff), regelbasierte Checks + LLM-als-Richter mit Rubrik; Ampel vor Veröffentlichung; CI-Modus mit Fixtures, nächtlicher Live-Modus mit Kostenlimit.
- Red-Team-Testset (Prompt-Injection per E-Mail/PDF, Datenabfluss über Links) für alle Vorlagen.
- Agenten-Steckbrief (Zweck, Daten, Risiken, Freigaberegeln) automatisch generiert.
- Demo-Mandant „Huber Haustechnik GmbH“ mit realistischen Seed-Daten (Mails, Kunden, Preisliste, Termine) und Reset-Knopf.

Akzeptanzkriterien:
- Die drei Wow-Momente aus sales/VERKAUFSSKRIPT.md (Agent in 60 Sekunden, Posteingang in 2 Minuten, ROI-Ansicht als Vorschau) funktionieren im Demo-Mandanten.
- Alle 12 Vorlagen bestehen ihre Evals inkl. Red-Team-Fälle.
```

---

## Phase 7 – Kanäle

```text
Setzen Sie Phase 7 um: Modul M8 (Web-Widget, E-Mail-Kanal, PWA) – Teams/WhatsApp vorbereiten.

Umfang:
- apps/widget: einbettbares Chat-Widget (eine Script-Zeile), kleines Bundle, voll gebrandet, KI-Hinweis (AI Act Art. 50), Einwilligungshinweis, Übergabe an Menschen, Öffnungszeiten, Lead-Erfassung, Rate-Limits und Bot-Schutz.
- E-Mail-Kanal: Agent überwacht Postfach oder eigene Eingangsadresse; Antworten als Entwurf oder (nach Policy) direkt.
- Einheitliches Gesprächsmodell (contacts, conversations) über alle Kanäle; Übergabe an Mitarbeitende im Chat-Bereich.
- PWA: installierbar, Web-Push für Freigaben und Übergaben.
- Kanal-Adapter-Interface, sodass Teams, WhatsApp Business und Slack als nächste Adapter nur noch implementiert werden müssen (Schnittstellen und Tests vorbereitet).

Akzeptanzkriterien:
- Widget auf einer Beispiel-Website (z. B. /demo-website im Demo-Mandanten) beantwortet Fragen aus der Wissensdatenbank und übergibt an einen Menschen.
- Lighthouse/Bundle-Budget für das Widget eingehalten (Ziel in ROADMAP.md festlegen).
```

---

## Phase 8 – ROI, Abrechnung und Partner-Konsole

```text
Setzen Sie Phase 8 um: Module M10, M11 und M12.

Umfang:
- ROI-Engine: roi_events aus erfolgreichen Vorgängen; Minuten pro Vorgang je Agent/Workflow editierbar; Stundensatz pro Mandant.
- Auswertungs-Dashboard (Recharts): Ausführungen, Erfolgsquote, Freigabequote, gesparte Stunden und €, Kosten, ROI-Faktor, Trends, Top-Agenten.
- Monatsreport als PDF im Branding des Mandanten, automatischer Versand an den Owner.
- Pakete, Limits, KI-Kontingent, Mehrverbrauch, Budget-Warnungen (80/100 %), harte Limits; Preistabellen mit Gültigkeitsdatum in der DB.
- Abrechnungsexport (CSV/XLSX) pro Monat für ME-IT.
- Partner-Konsole vollständig: Mandantenübersicht mit Nutzung, Kosten, Umsatz, Marge, Health-Score; Paketwechsel; Sperren/Export/Löschen mit Schutzfrist; Vorlagen-Verteilung mit Versionierung.

Akzeptanzkriterien:
- Kostenberechnung stimmt in Tests auf den Cent mit den usage-Daten der API-Antworten überein (inkl. Cache-Tokens).
- Monatsreport-PDF sieht professionell aus (Screenshot in docs/).
```

---

## Phase 9 – Compliance, Sicherheit und Hardening

```text
Setzen Sie Phase 9 um: Modul M13 + Abschnitt 11.

Umfang:
- DSGVO-Werkzeuge: Auskunft/Export/Löschung pro Person, Aufbewahrungsfristen mit Löschjobs, optionale PII-Maskierung vor LLM-Aufrufen, Export für das Verarbeitungsverzeichnis, AVV-Vorlage und Liste der Unterauftragsverarbeiter in docs/legal/ (als Entwurf zur rechtlichen Prüfung markiert).
- AI-Act-Funktionen: Kennzeichnung in allen Kanälen, Agenten-Steckbriefe, Sperre/Assistenzmodus für Hochrisiko-Vorlagen.
- Security-Review des gesamten Codes: OWASP ASVS L2 (Auszug), OWASP Top 10 for LLM Applications, CSP, Rate-Limits, Secret-Handling, Abhängigkeiten. Findings beheben, Rest dokumentieren.
- Last- und Performancetests (500 Mandanten simuliert), faire Queue verifizieren.
- Backups mit Point-in-Time-Recovery, Restore-Test-Skript, Runbooks (Deployment, Backup/Restore, Incident, Schlüsselrotation).
- Barrierefreiheits-Prüfung (WCAG 2.2 AA) mit automatisierten Checks (z. B. axe) in den E2E-Tests.

Akzeptanzkriterien:
- docs/SECURITY.md mit Checkliste, Status und offenen Punkten.
- Keine kritischen oder hohen Findings offen.
```

---

## Phase 10 – Launch

```text
Setzen Sie Phase 10 um: Onboarding (M14) fertigstellen und Release vorbereiten.

Umfang:
- Onboarding-Assistent: Branche → Vorlagen-Vorschläge → Microsoft 365/Google verbinden → erste Wissensquelle → erster Testlauf. Ziel < 10 Minuten (messen und in PROGRESS.md dokumentieren).
- Hilfe-Agent in der App (Wissen = docs/handbuch).
- Kundenhandbuch (Deutsch) und Admin-Handbuch in docs/handbuch, API-Referenz aus OpenAPI.
- Produktions-Deployment-Anleitung für EU-Hosting (Docker Compose auf einem Server + Variante für mehrere Server), Monitoring und Alerting.
- Release-Checkliste, CHANGELOG.md, Version 1.0.0.

Akzeptanzkriterien:
- Komplette Verkaufsdemo aus sales/VERKAUFSSKRIPT.md läuft ohne Fehler.
- Ein frischer Server ist mit der Anleitung in < 60 Minuten produktiv.
```

---

## 🧰 Werkzeugkasten – Prompts für den Alltag

### Weiterarbeiten nach einer Pause
```text
Lesen Sie CLAUDE.md, docs/ROADMAP.md und docs/PROGRESS.md. Fassen Sie in 5 Sätzen zusammen, wo wir stehen, was als Nächstes kommt und welche Risiken offen sind. Dann machen Sie mit dem nächsten offenen Punkt weiter.
```

### Code-Review vor dem Merge
```text
Prüfen Sie alle Änderungen seit dem letzten Release wie ein strenger Senior-Reviewer: Korrektheit, Mandanten-Isolation, Sicherheit (inkl. Prompt-Injection), Fehlerbehandlung, Tests, Performance, UX-Texte. Liefern Sie eine priorisierte Liste mit Datei:Zeile und beheben Sie alles Kritische und Hohe direkt.
```

### Neuen Konnektor bauen
```text
Bauen Sie einen neuen Konnektor für <SYSTEM> mit dem Connector-SDK. Lesen Sie zuerst die offizielle API-Doku von <SYSTEM> und listen Sie die Endpunkte auf, die Sie verwenden (mit Link). Aktionen: <LISTE>. Trigger: <LISTE>. Risikoklassen vorschlagen, Contract-Tests mit Mocks, Eintrag im Integrations-Katalog, kurze Kundendoku.
```

### Neue Agenten-Vorlage
```text
Erstellen Sie eine neue Agenten-Vorlage „<NAME>“ für <BRANCHE/AUFGABE> im Format von prompts/02_AGENTEN_BIBLIOTHEK.md: Zweck, Auslöser, Werkzeuge mit Risikoklassen, Freigaberegeln, ROI-Minuten, Systemprompt, mindestens 10 Testfälle (inkl. 2 Angriffe). Prüfen Sie, ob die Vorlage in einen AI-Act-Hochrisikobereich fällt. Importieren Sie sie und lassen Sie die Evals laufen.
```

### Fehler beheben
```text
Fehlerbild: <BESCHREIBUNG / LOG / SCREENSHOT>. Reproduzieren Sie den Fehler zuerst mit einem fehlschlagenden Test, finden Sie die Ursache (nicht nur das Symptom), beheben Sie sie und zeigen Sie, dass der Test jetzt grün ist. Prüfen Sie, ob derselbe Fehler an anderen Stellen existiert.
```

### Kundendemo vorbereiten
```text
Bereiten Sie den Demo-Mandanten für eine Präsentation bei <KUNDE, BRANCHE> vor: Branding anpassen (Logo/Farbe als Platzhalter), 3 passende Vorlagen aktivieren, Seed-Daten an die Branche anpassen, Demo-Ablauf aus sales/VERKAUFSSKRIPT.md einmal komplett durchspielen und Probleme beheben.
```

### Kosten optimieren
```text
Analysieren Sie die usage_events der letzten 30 Tage: Kosten pro Agent, Cache-Trefferquote, Tokens pro Vorgang, Effort-Einstellungen. Schlagen Sie Maßnahmen vor (zuerst Caching und Effort, dann Modellstufe), messen Sie jede Änderung mit den Evals und setzen Sie nur um, was die Qualität hält.
```
