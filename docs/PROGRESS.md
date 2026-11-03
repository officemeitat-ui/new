# Fortschritt – ME-IT Nexus

Neueste Einträge oben. Jede Session beginnt hier.

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
4. **Selbstregistrierung:** Mandanten werden von ME-IT über die Partner-Konsole angelegt; Kunden registrieren sich nicht selbst. Passt das?
5. **Domain:** Unter welcher Domain soll die App laufen (für SSO-Redirects und E-Mail-Absender)?
