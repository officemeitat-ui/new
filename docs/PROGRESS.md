# Fortschritt – ME-IT Nexus

Neueste Einträge oben. Jede Session beginnt hier.

## Wissensdatenbank v1 – Dokumente hochladen, durchsuchen, mit Quelle antworten ✅

**Erledigt**

- **Sammlungen** (z. B. „Preise und AGB“, „Personal“) unter „Wissen“; anlegen und löschen mit `knowledge.manage`, lesen mit `knowledge.read`.
- **Upload** per Auswahl oder Drag & Drop: PDF, Word (.docx), Markdown, Text; bis 10 MB je Datei, 10 Dateien auf einmal. Der Typ wird aus Endung und Inhalt geprüft (eine umbenannte Datei wird abgelehnt), Duplikate pro Sammlung erkannt.
- **Verarbeitung im Worker** (neues Paket `packages/knowledge`, Queue `knowledge`): Text seitenweise aus PDFs, aus Word-Dateien und Markdown; Abschnitte mit Überschrift und Seitenzahl. Status „Wird verarbeitet / Bereit / Fehler“ aktualisiert sich von selbst; verständliche Fehlermeldungen (z. B. passwortgeschütztes oder gescanntes PDF).
- **Deutsche Volltextsuche** in Postgres (Stammformen: „Rechnungen“ findet „Rechnung“), Überschriften höher gewichtet, „Suche testen“ mit markierten Treffern.
- **Werkzeug „Wissensdatenbank“** (`wissen_suchen`) ist verfügbar; im Agent Studio wählt man die Sammlungen des Agenten. Antworten zitieren „[Dokument, S. x]“, der Chat zeigt diese Quellen als Links auf die Dokumentansicht (an die richtige Seite).
- **Dokumentansicht** mit dem erkannten Text, Seitenmarken und Überschriften.
- Audit-Einträge für Sammlungen und Dokumente; RLS auf allen vier neuen Tabellen (Meta-Test grün).
- **Tests:** Paket-Tests mit echtem PDF und DOCX, Integrationstests (Suche, Stammformen, Sammlungsfilter, Mandantentrennung, Duplikate, Löschen), Worker-Tests (PDF indexieren, kaputtes PDF, Agent zitiert Seite 2), E2E: hochladen → bereit → Suche → Agent antwortet mit Quelle → Dokumentansicht. Insgesamt 15 Browser-Tests.

**Noch offen**

- Embeddings und hybride Suche (Anbieter mit ME-IT klären, ADR 0007), OCR für Scans, weitere Formate (Excel, PowerPoint, Webseiten)
- Rechte pro Sammlung (z. B. Personal nur für HR), automatischer Abgleich mit SharePoint/Google Drive (Phase 4), „Erneut verarbeiten“-Knopf für fehlgeschlagene Dokumente

## Bessere Funktionen – Agent Studio, Kennzahlen, Freigabe-Inbox mit E-Mail-Versand ✅

**Erledigt**

- **Agent Studio:** Galerie mit den 12 Vorlagen aus `prompts/02_AGENTEN_BIBLIOTHEK.md` (Filter nach Branche, Suche, ROI je Aufgabe), „Vorlage übernehmen“ mit vorausgefüllten Firmendaten, Editor (Anweisungen mit Hinweis auf offene Platzhalter, Modellstufe, Effort, Werkzeuge je _aus / automatisch / mit Freigabe_, Schritt- und Kostenlimit, Minuten je Aufgabe), unveränderliche Versionen mit Wiederherstellen, Archivieren. Im Chat lässt sich der Agent für ein neues Gespräch wählen (`/chat?agent=<id>`).
- **Startseite mit echten Kennzahlen:** offene Freigaben (Kachel führt zur Inbox), Läufe heute, gesparte Stunden und Euro (Woche/Monat, Stundensatz pro Firma unter Einstellungen → Allgemein), KI-Kosten im Monat, Balkendiagramm der letzten 7 Tage, letzte Aktivitäten, Systemstatus.
- **Freigabe-Inbox (M9):** Werkzeuge im Modus „mit Freigabe“ pausieren den Lauf; für jeden offenen Werkzeugaufruf entsteht ein Eintrag in `approvals` (RLS). Die Inbox zeigt die E-Mail-Vorschau mit _Freigeben_, _Bearbeiten und freigeben_ und _Ablehnen mit Begründung_. Nach der letzten Entscheidung läuft der Agent dort weiter, wo er pausiert hat; eine Ablehnung bekommt er samt Begründung als Werkzeug-Fehler zurück. Entscheidungen stehen im Audit-Log.
- **Sichtbarkeit:** Owner und Admins sehen alle Freigaben der Firma, Mitglieder nur die aus ihren eigenen Gesprächen (geprüft in der Abfrage, nicht nur in der UI).
- **Werkzeug „E-Mail senden“:** höchstens 5 Empfänger, Absendername = Firma, Fußzeile mit KI-Kennzeichnung (EU AI Act Art. 50), Message-ID aus dem Idempotenzschlüssel (kein Doppelversand bei Wiederholung). Standardmodus: mit Freigabe.
- **Chat:** Hinweis „Der Agent wartet auf eine Freigabe. Zur Freigabe“, Eingabe gesperrt bis zur Entscheidung (auch serverseitig), der Chat aktualisiert sich selbst, wenn anderswo (z. B. am Handy) entschieden wurde. Der Live-Stream eines fortgesetzten Laufs springt nicht mehr beim alten Pausen-Ereignis ab.
- **Navigation:** „Freigaben“ mit Zähler; am Handy eine Leiste unten (Start, Chat, Freigaben, Agenten).
- **Tests:** Worker-Tests mit echtem SMTP-Server (pausieren → geändert freigeben → gesendet und weiter; ablehnen → nichts gesendet; Sichtbarkeit; gesperrte Folgenachricht). E2E: 14 Browser-Tests, neu u. a. beide Freigabe-Abläufe. Ein SMTP-Auffangserver (`apps/web/e2e/smtp-sink.mjs`) nimmt alle E-Mails der E2E-Läufe an; die Einladungs-Tests lesen den Link jetzt aus der E-Mail und werden nicht mehr übersprungen.

**Noch offen**

- Benachrichtigung über neue Freigaben per Web-Push und E-Mail (M9), Schwellenwerte (z. B. nur externe Empfänger), Eskalation nach X Stunden, Vertretungen
- Evals/Testfälle der Vorlagen im Studio ausführen, „Agent aus Beschreibung“ (Agent-Architekt)
- E-Mail-Versand über das Postfach des Kunden (Microsoft 365/Google) statt über das Plattform-SMTP – kommt mit den Integrationen (Phase 4)

## Abschluss Phase 1 und 2 – Branding, 2FA, Euro-Kosten, Trace, Support-Zugriff ✅

**Erledigt**

- **Branding pro Mandant:** Einstellungen → Branding mit Farbwahl, Vorschlägen und Live-Vorschau hell/dunkel. Schwer lesbare Farben werden automatisch angepasst (WCAG). Ohne eigene Farbe gilt die des Partners; der Produktname kommt vom Partner.
- **Zwei-Faktor-Anmeldung (TOTP):** Seite „Konto und Sicherheit“ mit QR-Code, manuellem Schlüssel und 10 Backup-Codes; Login mit zweitem Schritt (App-Code oder Backup-Code, Gerät 30 Tage vertrauen).
- **2FA-Pflicht für Owner und Admins** als Firmen-Richtlinie (Einstellungen → Sicherheit) mit Übersicht, wer 2FA hat; ohne Einrichtung leitet die App auf die Kontoseite um.
- **Preise in der Datenbank:** Tabelle `price_tables` mit Gültigkeitsdatum (Seed: Preisliste 2026-10); der Worker lädt sie alle fünf Minuten.
- **Kosten in Euro:** ME-IT legt in der Partner-Konsole den Kurs Euro je US-Dollar fest; Kunden sehen Kosten in Euro (ohne Kurs in US-Dollar).
- **Trace im Chat:** „Details anzeigen“ unter jeder Antwort zeigt Modellaufrufe (Ende-Grund, Tokens, Cache, Dauer, Kosten), Überlegungen und Werkzeug-Ein-/Ausgaben.
- **Support-Zugriff:** Der Owner gibt ME-IT für 1, 4, 24 oder 72 Stunden Zugriff; die Partner-Konsole zeigt „Support bis …“ und „Öffnen“. Während der Sitzung sehen alle ein Banner, Support hat eingeschränkte Rechte (keine Personen, keine Sicherheit, keine Freigaben). Beginn und Ende stehen im Audit-Log; mit Ablauf oder Widerruf endet die Sitzung von selbst.
- **Audit-Einträge mit IP-Adresse und Browser** (aus `X-Forwarded-For`, der Reverse-Proxy muss den Header setzen).
- **Rate-Limits** pro IP und Minute statt 3 pro 10 Sekunden (Büros hinter einer gemeinsamen IP): Anmelden, Registrieren und 2FA je 10/Minute, Magic Link 5/Minute.
- **E2E:** 10 Browser-Tests (u. a. Branding, 2FA mit echten TOTP-Codes, Euro-Anzeige, Trace, Support-Sitzung); die Suite meldet sich einmal an und nutzt die Sitzung weiter.

**Noch offen**

- Passkeys (eigenes Better-Auth-Paket), SAML/SCIM für Enterprise
- Konto-Sperre nach wiederholten falschen Passwörtern (derzeit nur Rate-Limit pro IP); Rate-Limit-Speicher in Redis statt im Prozess, sobald mehrere Web-Instanzen laufen
- Partner-Audit-Log (z. B. Kursänderungen; derzeit nur im Server-Log)
- Wechselkurs automatisch von der EZB (die EZB-API war aus der Entwicklungsumgebung nicht erreichbar und ist daher nicht eingebaut)
- Datei-Upload im Chat, faire Warteschlange pro Mandant, Compaction langer Gespräche

## Phase 2 – Agent-Runtime und Chat ✅ (Kern)

**Erledigt**

- **`packages/agents` – eigene Agentenschleife** über das offizielle Anthropic-SDK (ADR 0003): Streaming, alle `stop_reason`-Werte, parallele Werkzeugaufrufe mit gemeinsamem Ergebnis-Turn, Fehler als `is_error`, Verlauf nur angehängt (Thinking-Blöcke bleiben erhalten)
- **Freigabe-Logik im Code:** pro Werkzeug „automatisch / Freigabe / verboten“; der Lauf pausiert vor freigabepflichtigen Aktionen und setzt mit der Entscheidung fort (auch bearbeitet oder abgelehnt). Die Inbox dazu kommt in Phase 5.
- **Aktuelle API-Regeln:** adaptive Thinking mit Zusammenfassung, Effort immer explizit, keine Sampling-Parameter, kein Prefill, `tool_choice` automatisch, `strict`-Werkzeuge plus Zod-Prüfung, serverseitige Fallbacks bei Ablehnungen (nur auf der Claude API)
- **Prompt-Caching:** stabiler Präfix (sortierte Werkzeuge → Basis-Systemprompt → Agenten-Anweisungen), Datum/Nutzer im `<kontext>`-Block der ersten Nachricht; ein Test beweist, dass der Präfix byte-identisch bleibt
- **Provider:** Claude API, Amazon Bedrock (EU) und Google Vertex AI über eine gemeinsame Schnittstelle mit Capability-Matrix; Modellstufen `smart` / `balanced` / `fast` → `claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-5-5`
- **Kosten und Limits:** Kosten pro Aufruf inklusive Cache-Tokens, Schritt- und Kostenlimit pro Lauf, Abbruch
- **Datenmodell mit RLS:** Agenten mit Versionen, Gespräche, Nachrichten (nur anhängen), Läufe, Trace-Schritte, Nutzungsereignisse (Partner sehen nur Nutzungszahlen ihrer Mandanten, keine Inhalte)
- **Worker-Job:** führt Läufe aus, speichert jeden Schritt, meldet Ereignisse live in einen Redis-Stream; idempotent, ohne automatische Wiederholung (keine doppelten Aktionen), verständliche Fehlermeldungen
- **Chat-Oberfläche:** Gesprächsliste, Beispiel-Prompts, Live-Antworten per Server-Sent Events mit Status („Denkt nach …“, „Verwendet Rechner …“), Markdown ohne HTML-Injektion, Werkzeug-Chips, Modell/Schritte/Tokens/Cache/Kosten pro Antwort, Hinweis bei Ablehnung oder Limit, Warnung wenn kein KI-Anbieter eingerichtet ist
- **Standard-Agent „Assistent“** pro Mandant mit den Werkzeugen „Datum und Uhrzeit“ und „Rechner“ (sicherer Parser, kein `eval`)
- **Tests:** 33 Runtime-Tests ohne Netzwerk, 6 Worker-Integrationstests gegen die echte Datenbank, E2E-Chat über die gesamte Kette (Web → Queue → Worker → SDK → Live-Stream → Datenbank) mit einem Mock der Claude API – im Produktivcode gibt es keine Attrappen

**So probieren Sie es aus**

1. `ANTHROPIC_API_KEY` in `.env` eintragen (oder `LLM_PROVIDER=bedrock` bzw. `vertex` mit EU-Region)
2. `pnpm db:migrate && pnpm dev`
3. Chat öffnen und z. B. „Berechne 20 % Umsatzsteuer auf 3.480 € netto.“ fragen

**Noch offen in Phase 2** (als Nächstes)

- Trace-Ansicht pro Lauf in der Oberfläche (die Schritte werden bereits gespeichert)
- Datei-Upload im Chat (PDF/Bilder an Claude)
- Preistabelle in der Datenbank (Standardpreise liegen derzeit im Code) und Kosten in Euro
- Faire Warteschlange pro Mandant (derzeit globale Parallelität)
- Lange Gespräche: Compaction bzw. Context Editing

## Phase 1 – Mandanten, Anmeldung und Rechte ✅ (Kern)

**Erledigt**

- **Datenmodell** mit Row Level Security: Partner, Partner-Mitarbeitende, Mandanten, Mitgliedschaften, eigene Rollen, Einladungen, Support-Zugriffe, Audit-Log; Identitätstabellen von Better Auth (`auth_*`)
- **Vier Datenbank-Kontexte:** Mandant, Partner, Benutzer (nur eigene Mitgliedschaften) und System; ohne Kontext liefert jede Abfrage null Zeilen
- **Testsuite „tenant-isolation“** (echte Postgres-Datenbank, Rolle ohne Superuser): fremde Mandanten sind unsichtbar, Schreibversuche scheitern mit RLS-Fehler, Partner sehen ihre Mandantenliste, aber keine Mitglieder oder Inhalte
- **Meta-Test:** Jede Tabelle mit `tenant_id` muss RLS aktiviert, erzwungen und mit Policy haben; sonst schlägt die CI fehl
- **Audit-Log** unveränderbar (keine UPDATE/DELETE-Policies, auch nicht im System-Kontext) mit SHA-256-Hash-Kette pro Mandant; parallele Schreiber werden per Advisory-Lock serialisiert; die Kette wird in der Oberfläche geprüft
- **Anmeldung** mit Better Auth: E-Mail/Passwort, Magic Link, Microsoft- und Google-SSO (aktiv, sobald Zugangsdaten gesetzt sind), Rate-Limits
- **Keine Selbstregistrierung:** Konten entstehen nur für Adressen mit offener Einladung, auch beim ersten SSO-Login (serverseitig erzwungen, E2E-getestet)
- **Einladungen:** Token nur als SHA-256-Hash gespeichert, 7 Tage gültig, nur für die eingeladene Adresse, nur einmal nutzbar; ohne SMTP-Server zeigt die App den Link zum Weitergeben
- **Rollen:** Owner, Admin, Mitglied; nur Owner vergeben die Owner-Rolle; der letzte Owner kann nicht entfernt werden
- **Oberfläche:** Login, Einladung annehmen (mit Kontoanlage), Mandantenwahl, Benutzermenü mit Firmenwechsel und Abmelden, Einstellungen → Mitglieder und Audit-Log, **Partner-Konsole** mit „Mandant anlegen“ (inklusive Owner-Einladung)
- **Seed:** `pnpm db:seed` legt Partner ME-IT, einen Admin und den Demo-Mandanten „Huber Haustechnik GmbH“ an
- **E2E-Tests (Playwright)** im Repo und in der CI: Login-Weiterleitung, falsches Passwort, Mandant anlegen → Owner tritt bei → Audit-Kette geprüft → kein Zugriff auf die Partner-Konsole → Link nicht doppelt nutzbar, Registrierung ohne Einladung wird abgelehnt

**So probieren Sie es aus**

1. `pnpm db:migrate && SEED_ADMIN_PASSWORD='IhrPasswort' pnpm db:seed`
2. `pnpm dev`, dann http://localhost:3000 öffnen und mit `admin@me-it.local` anmelden
3. Partner-Konsole → Mandant anlegen → Einladungslink (Mailpit: http://localhost:8025) in einem privaten Fenster öffnen

**Noch offen in Phase 1** (als Nächstes)

- Oberfläche für 2FA-Einrichtung (TOTP) und Passkeys; das Datenmodell für 2FA ist schon da
- Oberfläche für Support-Zugriff (Tabelle und Policies sind da) und für eigene Rollen
- Branding pro Mandant in der Oberfläche (Farbe/Logo); die Palette wird bereits aus einer Farbe erzeugt
- IP-Adresse und User-Agent in Audit-Einträgen aus der Web-App befüllen

## Phase 0 – Fundament ✅

**Erledigt**

- Monorepo mit pnpm und Turborepo: `apps/web`, `apps/worker`, `packages/{config,core,db,ui}`
- TypeScript 6 (strict, `noUncheckedIndexedAccess`), ESLint mit typbasierten Regeln (z. B. keine unbehandelten Promises), Prettier
- `packages/core`: Umgebungsvariablen mit Zod (verständliche deutsche Fehlermeldungen), Logger mit Schwärzung von Geheimnissen, Fehlerklassen, UUIDv7, Formatierung `de-AT` mit Zeitzone Wien, Berechtigungen und Systemrollen
- `packages/db`: Drizzle mit node-postgres, Migrationen, Kontext-Helfer `withTenant` / `withPartner` / `withSystem` (transaktionslokal, siehe ADR 0002), Kontextfunktionen für RLS-Policies in SQL
- `packages/ui`: Designsystem für Tailwind CSS 4 mit Hell- und Dunkelmodus; die **Farbpalette wird aus einer Markenfarbe erzeugt und auf WCAG-Kontraste geprüft** (Grundlage für White-Label); Komponenten Button, Card, Badge, Input, EmptyState, Skeleton, Kbd
- `apps/web`: Next.js 16 App-Shell mit Seitenleiste, Befehlspalette (Strg+K), Design-Umschalter, Sprachwechsel Deutsch/Englisch (next-intl), Startseite mit Systemstatus, Health-Check `GET /api/health`, Sicherheits-Header, Fehler- und Ladezustände, mobile Ansicht
- `apps/worker`: BullMQ-Worker mit Health-Check und sauberem Herunterfahren
- `docker-compose.yml` (Postgres mit pgvector, Valkey, Mailpit), `.env.example`, GitHub-Actions-CI (Format, Lint, Typecheck, Tests mit echter Postgres-Datenbank, Build)

**So probieren Sie es aus:** siehe [README → Entwicklung](../README.md#entwicklung). Danach http://localhost:3000 öffnen und Strg+K drücken.

**Bewusst noch nicht enthalten**

- S3-kompatibler Speicher: MinIO veröffentlicht keine Community-Images mehr. Wir entscheiden in Phase 3 (Datei-Uploads) per ADR zwischen Alternativen wie Garage oder SeaweedFS bzw. dem Objektspeicher des Hosters.
- Bereiche aus späteren Phasen sind in der Navigation sichtbar, aber als „Bald“ deaktiviert.

## Offene Fragen an ME-IT

Diese Punkte habe ich mit einer Standardentscheidung umgesetzt. Bitte bestätigen oder korrigieren:

1. **Markenfarbe und Produktname:** Standard ist `#2454d6` und „ME-IT Nexus“ (änderbar über `BRAND_PRIMARY_COLOR` / `BRAND_PRODUCT_NAME`). Bitte die echte ME-IT-Farbe nennen.
2. **Hosting:** Ich plane mit einem Docker-Server in der EU (z. B. Hetzner). Gibt es einen bevorzugten Anbieter?
3. **KI-Anbieter zum Start:** Claude API direkt (`LLM_PROVIDER=anthropic`). Brauchen erste Kunden schon EU-only-Verarbeitung über Bedrock oder Vertex?
4. **Selbstregistrierung:** Mandanten legt ME-IT über die Partner-Konsole an; Kunden registrieren sich nicht selbst (so umgesetzt). Soll es später eine Testphase mit Selbstregistrierung geben?
5. **Domain:** Unter welcher Domain soll die App laufen (für SSO-Redirects und E-Mail-Absender)?
