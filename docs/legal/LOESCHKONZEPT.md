# Löschkonzept – ENTWURF

> **Entwurf zur rechtlichen Prüfung.** Beschreibt das Verhalten der Software (Stand: Code in `packages/domain/src/privacy.ts`).

| Daten                                               | Löschung                                                                                                                                           | Wie                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Gespräche (Nachrichten, Läufe, Schritte, Freigaben) | nach der vom Kunden gewählten Frist (30, 90, 180, 365 oder 730 Tage ohne Aktivität) oder unbegrenzt                                                | nächtlicher Löschlauf (02:30 Uhr Wien), Eintrag im Audit-Log |
| Dokumente der Wissensdatenbank                      | nach der gewählten Frist ab Upload oder unbegrenzt; jederzeit einzeln                                                                              | nächtlicher Löschlauf / manuell, Audit-Log                   |
| Kostenzahlen (Tokens, Kosten)                       | bleiben für Abrechnung und Auswertung, **ohne** Bezug zu Inhalten oder Personen                                                                    | —                                                            |
| Daten einer Person (Art. 17)                        | auf Anforderung: eigene Gespräche, Mitgliedschaft, Verknüpfungen zu erstellten Inhalten; das Konto, wenn die Person zu keiner anderen Firma gehört | Einstellungen → Datenschutz, Audit-Log                       |
| Audit-Log                                           | unveränderlich (Hash-Kette) bis zur Löschung der Firma; enthält Personen-IDs, keine Namen oder Inhalte (Rechenschaftspflicht, Art. 5 Abs. 2)       | —                                                            |
| Gerätedaten aus Intune                              | werden nicht gespeichert, nur abgefragt                                                                                                            | —                                                            |
| Backups                                             | Überschreiben nach [x] Tagen                                                                                                                       | Betrieb, ⬜                                                  |

**Bewusst noch nicht umgesetzt:** Maskierung personenbezogener Daten vor dem KI-Aufruf (optional laut Spezifikation), Löschung einer ganzen Firma per Knopf in der Partner-Konsole (derzeit durch ME-IT in der Datenbank, Kaskade über `tenant_id`).
