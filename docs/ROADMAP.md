# Roadmap – ME-IT Nexus

Die Phasen folgen [`prompts/01_BUILD_PHASEN.md`](../prompts/01_BUILD_PHASEN.md). Status: ✅ fertig · 🟡 in Arbeit · ⬜ offen.

| Phase | Inhalt                                                                        | Status                                                                                      |
| ----- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 0     | Fundament: Monorepo, CI, Docker, Datenbank-Grundlage, Designsystem, App-Shell | siehe [PROGRESS](PROGRESS.md)                                                               |
| 1     | Mandanten, Anmeldung, Rechte, Audit-Log, Partner-Konsole (Grundgerüst)        | siehe [PROGRESS](PROGRESS.md)                                                               |
| 2     | Agent-Runtime und Chat                                                        | siehe [PROGRESS](PROGRESS.md)                                                               |
| 3     | Wissensdatenbank (RAG)                                                        | 🟡 Volltext; SharePoint, BookStack, Atera; Artikel, Unternehmensgedächtnis, Markdown-Export |
| 4     | Integrationen und MCP                                                         | 🟡 Microsoft 365: Intune, SharePoint                                                        |
| 5     | Workflows und Freigabe-Inbox                                                  | 🟡 Freigabe-Inbox fertig                                                                    |
| 6     | Agent Studio, Vorlagen, Evals → **demo-fähig**                                | 🟡 Studio und Vorlagen fertig                                                               |
| 7     | Kanäle: Web-Widget, E-Mail-Agent, PWA-Push                                    | ⬜                                                                                          |
| 8     | ROI, Abrechnung, Partner-Konsole vollständig                                  | 🟡 Agenten-Pakete (Rollout)                                                                 |
| 9     | Compliance, Sicherheit, Hardening                                             | 🟡 DSGVO-Werkzeuge, Steckbriefe, CSP                                                        |
| 10    | Launch: Onboarding, Doku, Release 1.0                                         | ⬜                                                                                          |

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

| Funktion                                             | Geplant für                                 |
| ---------------------------------------------------- | ------------------------------------------- |
| SAML 2.0, SCIM                                       | Phase 9 / Enterprise                        |
| Eigene Domain pro Mandant                            | Phase 8                                     |
| Stripe Billing                                       | nach Phase 8                                |
| Teams-, WhatsApp-, Slack-Kanal                       | nach Phase 7                                |
| Telefon/Voice                                        | Phase 3 der Konnektoren-Roadmap             |
| Embeddings und hybride Suche                         | Phase 3, nach Wahl des Anbieters (ADR 0007) |
| OCR für gescannte PDFs                               | Phase 3                                     |
| Intune: Gerät zurücksetzen/löschen (wipe, retire)    | mit Vier-Augen-Freigabe (ADR 0008)          |
| Microsoft 365 delegiert: Postfach, Kalender          | Phase 4                                     |
| PII-Maskierung vor KI-Aufrufen                       | Phase 9                                     |
| Firma löschen per Knopf (Partner-Konsole)            | Phase 9                                     |
| Datei-Ablage in S3                                   | mit dem Deployment (ADR 0007)               |
| SharePoint: Webhooks statt stündlichem Abgleich      | Phase 4                                     |
| Atera: Abgleich mit echtem Schlüssel verifizieren    | vor Go-live (ADR 0010)                      |
| Atera: Tickets pro Kunde (Partner-gesteuert)         | Phase 4                                     |
| SharePoint: Berechtigungen pro Datei übernehmen      | Phase 4 (ADR 0008)                          |
| Dateiverarbeitung in eigenem Prozess (Speicherlimit) | Phase 9 (Sicherheits-Review, Befund 12)     |
| Reinigung: Qualitätskontrolle (EN 13549) am Handy    | Branchenpaket Gebäudereinigung, Stufe 2     |
| Reinigung: Revierpläne, Zeiterfassung pro Objekt     | Branchenpaket Gebäudereinigung, Stufe 2     |
