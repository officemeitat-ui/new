# Roadmap – ME-IT Nexus

Die Phasen folgen [`prompts/01_BUILD_PHASEN.md`](../prompts/01_BUILD_PHASEN.md). Status: ✅ fertig · 🟡 in Arbeit · ⬜ offen.

| Phase | Inhalt                                                                        | Status                        |
| ----- | ----------------------------------------------------------------------------- | ----------------------------- |
| 0     | Fundament: Monorepo, CI, Docker, Datenbank-Grundlage, Designsystem, App-Shell | siehe [PROGRESS](PROGRESS.md) |
| 1     | Mandanten, Anmeldung, Rechte, Audit-Log, Partner-Konsole (Grundgerüst)        | siehe [PROGRESS](PROGRESS.md) |
| 2     | Agent-Runtime und Chat                                                        | siehe [PROGRESS](PROGRESS.md) |
| 3     | Wissensdatenbank (RAG)                                                        | ⬜                            |
| 4     | Integrationen und MCP                                                         | ⬜                            |
| 5     | Workflows und Freigabe-Inbox                                                  | ⬜                            |
| 6     | Agent Studio, Vorlagen, Evals → **demo-fähig**                                | ⬜                            |
| 7     | Kanäle: Web-Widget, E-Mail-Agent, PWA-Push                                    | ⬜                            |
| 8     | ROI, Abrechnung, Partner-Konsole vollständig                                  | ⬜                            |
| 9     | Compliance, Sicherheit, Hardening                                             | ⬜                            |
| 10    | Launch: Onboarding, Doku, Release 1.0                                         | ⬜                            |

## Akzeptanzkriterien je Phase

### Phase 0 – Fundament

- `docker compose up -d` und `pnpm dev` starten alles; die App-Shell ist erreichbar.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` sind grün, auch in der CI.
- README beschreibt das Setup in höchstens fünf Schritten.

### Phase 1 – Mandanten und Anmeldung

- Testsuite „tenant-isolation“: Zugriffe auf fremde Mandanten schlagen auf Datenbankebene fehl.
- Meta-Test: Jede Tabelle mit `tenant_id` hat erzwungene RLS und eine Policy.
- Anmeldung mit E-Mail/Passwort, Einladung annehmen, Mandantenwechsel.
- Jede sicherheitsrelevante Aktion erzeugt einen Audit-Log-Eintrag mit Hash-Kette.

### Phase 2 – Agent-Runtime und Chat

- Ein Agent antwortet live im Chat und nutzt Werkzeuge; der Trace zeigt jeden Schritt mit Tokens und Kosten.
- Unit-Tests für Schleife, `stop_reason`-Behandlung, Policy-Pausen und Kostenberechnung laufen ohne echte API-Aufrufe.
- Ein Test beweist, dass der gecachte Prefix zwischen zwei Läufen byte-identisch bleibt.

### Phasen 3–10

Siehe Akzeptanzkriterien in [`prompts/01_BUILD_PHASEN.md`](../prompts/01_BUILD_PHASEN.md).

## Bewusst später (Feature-Flags)

| Funktion                       | Geplant für                     |
| ------------------------------ | ------------------------------- |
| SAML 2.0, SCIM                 | Phase 9 / Enterprise            |
| Eigene Domain pro Mandant      | Phase 8                         |
| Stripe Billing                 | nach Phase 8                    |
| Teams-, WhatsApp-, Slack-Kanal | nach Phase 7                    |
| Telefon/Voice                  | Phase 3 der Konnektoren-Roadmap |
