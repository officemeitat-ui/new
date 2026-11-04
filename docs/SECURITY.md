# Sicherheit – Checkliste und Status

Stand: 2026-11-04. ✅ umgesetzt und getestet · 🟡 teilweise · ⬜ offen. Grundlage: OWASP ASVS 4 Level 2 (Auszug) und OWASP Top 10 for LLM Applications. Kritische oder hohe Findings: **keine offen** (Stand dieses Reviews).

## Anwendung (ASVS-Auszug)

| Bereich           | Maßnahme                                                                                                                                                                                     | Status        | Nachweis                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------- |
| Authentifizierung | Better Auth: Passwörter gehasht (Standard der Bibliothek), E-Mail-Bestätigung über Einladungen, Magic Link 10 Minuten gültig                                                                 | ✅            | `apps/web/src/lib/auth.ts`                                          |
|                   | Zwei-Faktor (TOTP, Backup-Codes), 2FA-Pflicht für Owner/Admins per Richtlinie                                                                                                                | ✅            | E2E `two-factor.spec.ts`                                            |
|                   | Rate-Limits pro IP: Anmelden/Registrieren/2FA 10/min, Magic Link 5/min                                                                                                                       | ✅            | `auth.ts` customRules                                               |
|                   | Registrierung nur mit gültiger Einladung                                                                                                                                                     | ✅            | `databaseHooks`                                                     |
| Sitzungen         | Cookies httpOnly, SameSite=Lax, Secure bei HTTPS (Better Auth)                                                                                                                               | ✅            |                                                                     |
| Zugriffskontrolle | Rechte serverseitig in jeder Action/Route (`requirePermission`)                                                                                                                              | ✅            |                                                                     |
|                   | Mandantentrennung in der Datenbank: RLS `ENABLE` + `FORCE`, App-Rolle ohne `BYPASSRLS`; Meta-Test für jede Tabelle                                                                           | ✅            | `packages/db/test/rls-coverage.test.ts`                             |
|                   | Mitglieder sehen nur Freigaben aus eigenen Gesprächen                                                                                                                                        | ✅            | Worker-Test `approvals.test.ts`                                     |
| Eingaben          | Zod an allen Grenzen; Uploads: Typ aus Inhalt (Magic Bytes), 10 MB, Duplikate                                                                                                                | ✅            | `packages/knowledge` Tests                                          |
| Ausgaben          | React escapt; kein HTML und keine Bilder aus Modellantworten; `javascript:`-Links gefiltert                                                                                                  | ✅            | `apps/web/test/markdown.test.ts`                                    |
|                   | CSV-Export neutralisiert Tabellen-Formeln (CSV-Injection)                                                                                                                                    | ✅            | Domain-Test „audit export“                                          |
| Header            | CSP mit Nonce pro Request (`script-src 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`), HSTS, nosniff, Referrer-Policy, Permissions-Policy | ✅            | `apps/web/src/proxy.ts`, E2E `privacy.spec.ts` (keine CSP-Verstöße) |
|                   | `style-src 'unsafe-inline'` bleibt erlaubt (Markenfarben, berechnete Größen; kein Skript)                                                                                                    | 🟡 akzeptiert |                                                                     |
| CSRF              | Server Actions mit Origin-Prüfung (Next.js); OAuth-`state` HMAC-signiert, 15 min, an Person und Firma gebunden                                                                               | ✅            | Domain-Test „consent state“                                         |
| SSRF              | Keine Abrufe nutzergesteuerter URLs; Graph-Folgelinks nur zu Graph selbst                                                                                                                    | ✅            | Connector-Test                                                      |
| Geheimnisse       | Umgebungsvariablen mit Zod geprüft; Logger schwärzt Secrets; Graph-Tokens nur im Speicher; keine Kunden-Secrets gespeichert (ADR 0008)                                                       | ✅            | `packages/core/src/logger.ts`                                       |
| Protokollierung   | Audit-Log mit Hash-Kette, IP und Browser; Prüfung in der App; CSV-Export inkl. Hashes                                                                                                        | ✅            |                                                                     |
| Datenschutz       | Löschfristen, Auskunft/Export, Löschung pro Person, Verzeichnis, Steckbriefe                                                                                                                 | ✅            | `docs/legal/`, Domain-Tests `privacy.test.ts`                       |

## KI-spezifisch (OWASP Top 10 for LLM Applications)

| Risiko                                                            | Maßnahme                                                                                                                                                       | Status                                            |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| LLM01 Prompt Injection                                            | Werkzeug-Ergebnisse, Dokumente und Gerätedaten werden als Daten markiert; Berechtigungen prüft der Code, nie das Modell; Aktionen nach außen nur nach Freigabe | ✅                                                |
| LLM02 Offenlegung sensibler Daten                                 | Mandantentrennung per RLS auch für Suche und Werkzeuge; keine externen Bilder (CSP + Markdown) gegen Datenabfluss über URLs                                    | ✅                                                |
| LLM05 Unsichere Ausgabeverarbeitung                               | Kein HTML, keine Bilder, gefilterte Links; Werkzeug-Eingaben mit Zod geprüft                                                                                   | ✅                                                |
| LLM06 Übermäßige Handlungsfreiheit                                | Werkzeug-Modi (automatisch/Freigabe/verboten), Gerätename+ID-Abgleich, Schritt- und Kostenlimit pro Agent                                                      | ✅                                                |
| LLM07 System-Prompt-Leak                                          | System-Prompt enthält keine Geheimnisse                                                                                                                        | ✅                                                |
| LLM10 Unbegrenzter Verbrauch                                      | Schritt- und Kostenlimit pro Lauf                                                                                                                              | 🟡 Limits pro Mandant/Monat und faire Queue offen |
| Red-Team-Testset (Injection-E-Mails, manipulierte PDFs) in der CI |                                                                                                                                                                | ⬜                                                |

## Abhängigkeiten (`pnpm audit`, 2026-11-04)

| Paket                                    | Schwere | Pfad                                               | Bewertung                                                                                                                  |
| ---------------------------------------- | ------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| esbuild ≤ 0.24.2 (GHSA-67mh-4wv8-2f99)   | mittel  | better-auth › drizzle-kit › @esbuild-kit › esbuild | Betrifft nur den esbuild-Entwicklungsserver, der nie gestartet wird. Akzeptiert, bei Update von Better Auth erneut prüfen. |
| minimatch < 11.0.1 (GHSA-g3hv-75wg-m249) | mittel  | eslint › minimatch                                 | Nur Entwicklungswerkzeug, Muster aus eigener Konfiguration. Akzeptiert.                                                    |

## Offen bis Go-live

- ⬜ Backups mit Point-in-Time-Recovery, Restore-Test-Skript, Runbooks (Deployment, Backup/Restore, Incident, Schlüsselrotation)
- ⬜ Verschlüsselung ruhender Daten beim Hosting bestätigen
- ⬜ Externer Penetrationstest
- ⬜ Last-/Performancetest (500 Mandanten), faire Queue pro Mandant, Verbrauchslimits pro Mandant
- ⬜ Red-Team-Evals in der CI, optionale PII-Maskierung vor KI-Aufrufen
- ⬜ Automatisierte Barrierefreiheits-Prüfung (axe) in den E2E-Tests
- ⬜ Konto-Sperre nach wiederholten Fehlversuchen, Rate-Limit-Speicher in Redis (mehrere Web-Instanzen)
