# CLAUDE.md – Projektregeln für ME-IT Nexus

Diese Datei lesen Claude-Code-Sessions automatisch. Sie fasst die verbindlichen Regeln zusammen; die vollständige Spezifikation steht in `prompts/00_MASTER_PROMPT.md`.

## Orientierung

- Spezifikation: `prompts/00_MASTER_PROMPT.md` · Phasen: `prompts/01_BUILD_PHASEN.md` · Agenten-Vorlagen: `prompts/02_AGENTEN_BIBLIOTHEK.md`
- Architektur: `docs/ARCHITECTURE.md` · Entscheidungen: `docs/adr/` · Stand: `docs/PROGRESS.md` · Plan: `docs/ROADMAP.md`
- Sicherheit: `docs/SECURITY.md` (bei sicherheitsrelevanten Änderungen aktualisieren) · Rechtliches (Entwürfe): `docs/legal/`
- Zu Beginn einer Session: `docs/PROGRESS.md` lesen und dort weitermachen.

## Befehle

- `pnpm install` – Abhängigkeiten
- `docker compose up -d` – Postgres (pgvector), Valkey, Mailpit
- `pnpm db:migrate` / `pnpm db:seed` – Schema und Demo-Mandant
- `pnpm dev` – Web-App (http://localhost:3000) und Worker
- `pnpm lint && pnpm typecheck && pnpm test` – muss vor jedem Commit grün sein
- `pnpm build` – Produktions-Build

## Regeln

- **Mandanten-Isolation:** Jede neue mandantenbezogene Tabelle bekommt `tenant_id`, RLS (`ENABLE` + `FORCE`) und eine Policy in einer SQL-Migration. Datenzugriffe nur über `withTenant` / `withPartner` / `withSystem` aus `@nexus/db`.
- **Berechtigungen** im Server prüfen (`requirePermission`), nie nur in der UI.
- **Claude API:** offizielles SDK `@anthropic-ai/sdk`; Modellstufen statt Modell-IDs im Code; adaptive Thinking und expliziter Effort; kein `temperature`/`top_p`/`top_k`, kein Prefill, `tool_choice` nur `auto`; jeden `stop_reason` behandeln; stabiler Prefix für Prompt-Caching (veränderliche Werte in die Nachrichten). Vor neuem SDK-Code die aktuelle Doku prüfen.
- **Externe APIs:** keine Endpunkte erfinden; Link zur Herstellerdoku im Code.
- **Datenschutz:** Neue personenbezogene Daten in Export (`exportPersonData`), Löschung (`erasePerson`), Fristen und im Verzeichnis (`getProcessingRegister`) berücksichtigen.
- **Kein Fake:** keine Platzhalter-Implementierungen in fertigen Features. Was später kommt: Feature-Flag + Eintrag in `docs/ROADMAP.md`.
- **Tests gehören dazu:** Unit, Integration (echte Postgres-DB), E2E für Hauptabläufe.
- **UI-Texte:** österreichisches Deutsch, Sie-Form, über `next-intl` (`apps/web/messages/*.json`), Formate `de-AT`.
- **Code:** TypeScript strict, Bezeichner und Kommentare auf Englisch, Zod als einzige Schema-Quelle.
- Nach jeder Phase `docs/PROGRESS.md` aktualisieren.
