# Fortschritt – ME-IT Nexus

Neueste Einträge oben. Jede Session beginnt hier.

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
