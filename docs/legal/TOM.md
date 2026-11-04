# Technische und organisatorische Maßnahmen (Art. 32 DSGVO) – ENTWURF

> **Entwurf zur rechtlichen Prüfung.** ✅ = in der Software umgesetzt und getestet · 🟡 = teilweise · ⬜ = vom Betrieb (ME-IT/Hosting) noch festzulegen.

## Vertraulichkeit

| Maßnahme                       | Umsetzung                                                                                                                               | Status |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Zutrittskontrolle              | Rechenzentrum des Hosting-Anbieters (Zertifizierung, z. B. ISO 27001, im AVV nennen)                                                    | ⬜     |
| Zugangskontrolle               | Anmeldung mit Passwort (gehasht), Zwei-Faktor-Anmeldung (TOTP), 2FA-Pflicht für Admins per Richtlinie, Rate-Limits gegen Ratenangriffe  | ✅     |
| Zugriffskontrolle              | Rollen und feingranulare Rechte, serverseitig geprüft; Datenbank-Zeilenschutz (Row Level Security, erzwungen) pro Mandant               | ✅     |
| Trennungskontrolle             | Jede Mandantentabelle mit `tenant_id`, RLS-Policy und automatischem Test, der fehlende Policies erkennt                                 | ✅     |
| Pseudonymisierung              | Audit-Log enthält Personen-IDs statt Namen; Kostenzahlen ohne Bezug zu Inhalten                                                         | ✅     |
| Datenminimierung               | Öffentliche Mängelmeldungen ohne Pflicht zu personenbezogenen Daten; E-Mail optional und mit Erledigung gelöscht; Agenten sehen sie nie | ✅     |
| Verschlüsselung (Transport)    | TLS für alle Verbindungen; HSTS; Content Security Policy mit Nonce                                                                      | ✅     |
| Verschlüsselung (ruhend)       | Datenträgerverschlüsselung beim Hosting-Anbieter                                                                                        | ⬜     |
| Verschlüsselung (Zugangsdaten) | API-Schlüssel angebundener Systeme (BookStack, Atera) AES-256-GCM-verschlüsselt, Schlüssel getrennt in der Konfiguration                | ✅     |

## Integrität

| Maßnahme              | Umsetzung                                                                                                                                               | Status |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Eingabekontrolle      | Unveränderliches Audit-Log mit Hash-Kette, Prüfung in der App, Export als CSV inkl. Hashes                                                              | ✅     |
| Weitergabekontrolle   | Aktionen nach außen (E-Mail, Geräteaktionen) standardmäßig nur nach Freigabe durch eine Person; Gerätename und ID werden vor der Ausführung abgeglichen | ✅     |
| Schutz vor KI-Risiken | Inhalte aus Werkzeugen gelten als Daten, nicht als Anweisungen; keine Bilder/HTML aus Modellantworten; Schritt- und Kostenlimits pro Agent              | ✅     |

## Verfügbarkeit und Belastbarkeit

| Maßnahme                           | Umsetzung                                                                                                                                 | Status |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Backups mit Point-in-Time-Recovery | beim Betrieb einzurichten, Restore-Test dokumentieren                                                                                     | ⬜     |
| Wiederherstellbarkeit              | Hintergrundjobs idempotent; Zustand in Postgres, nicht in Redis; Reparatur-Job alle 5 Minuten für hängende Läufe, Dokumente und Abgleiche | ✅     |
| Belastbarkeit                      | Timeouts für alle externen Aufrufe (KI, Datenbank, E-Mail, Microsoft), Begrenzung von Live-Verbindungen und öffentlichen Meldungen        | ✅     |
| Überwachung                        | Health-Checks für Web und Worker                                                                                                          | 🟡     |

## Verfahren zur regelmäßigen Überprüfung

| Maßnahme                                | Umsetzung                                                                         | Status |
| --------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| Automatisierte Tests                    | Unit-, Integrations- (echte Datenbank) und Browser-Tests bei jeder Änderung (CI)  | ✅     |
| Abhängigkeiten                          | `pnpm audit` regelmäßig, Ergebnisse in docs/SECURITY.md                           | ✅     |
| Datenschutzfreundliche Voreinstellungen | Freigabepflicht für Aktionen nach außen, keine Datenweitergabe ohne Konfiguration | ✅     |
| Penetrationstest                        | vor Go-live durch externe Stelle                                                  | ⬜     |
