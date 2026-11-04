# Auftragsverarbeitungsvertrag (AVV) nach Art. 28 DSGVO – ENTWURF

> **Entwurf zur rechtlichen Prüfung.** Platzhalter stehen in `[eckigen Klammern]`.

zwischen **[Kunde, Anschrift]** („Verantwortlicher“) und **ME-IT [Rechtsform, Anschrift, FN]** („Auftragsverarbeiter“)

## 1. Gegenstand und Dauer

1.1 Der Auftragsverarbeiter stellt dem Verantwortlichen die Plattform „[Produktname]“ bereit: KI-Agenten, Chat, Wissensdatenbank, Freigaben, Integrationen (z. B. Microsoft 365/Intune) und Auswertungen.
1.2 Der Vertrag gilt für die Dauer des Hauptvertrags vom [Datum].

## 2. Art und Zweck der Verarbeitung, Datenarten, Betroffene

| Verarbeitung                       | Datenarten                                                                           | Betroffene                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| Benutzerkonten, Rechte, Anmeldung  | Name, E-Mail, Rolle, Anmeldedaten, Sitzungen (IP-Adresse, Browser)                   | Mitarbeitende des Verantwortlichen           |
| Chat und Agenten                   | Inhalte von Gesprächen, Ergebnisse von Werkzeugen, E-Mail-Adressen von Empfängern    | Mitarbeitende; in Inhalten genannte Personen |
| Wissensdatenbank                   | Inhalte hochgeladener Dokumente                                                      | in Dokumenten genannte Personen              |
| Geräteverwaltung (falls verbunden) | Gerätedaten aus Intune inkl. zugeordneter Person (wird abgefragt, nicht gespeichert) | Mitarbeitende mit verwalteten Geräten        |
| Audit-Log                          | Personen-ID, Aktion, Zeitpunkt, IP-Adresse, Browser                                  | Mitarbeitende, Support von ME-IT             |

Das Verzeichnis von Verarbeitungstätigkeiten in der App (Einstellungen → Datenschutz) konkretisiert dies je Agent.

## 3. Weisungen

3.1 Der Auftragsverarbeiter verarbeitet Daten nur auf dokumentierte Weisung des Verantwortlichen; die Konfiguration in der Plattform (Agenten, Werkzeuge, Freigaberegeln, Aufbewahrungsfristen) gilt als Weisung.
3.2 Hält der Auftragsverarbeiter eine Weisung für rechtswidrig, informiert er den Verantwortlichen unverzüglich.

## 4. Vertraulichkeit

Personen mit Zugriff sind zur Vertraulichkeit verpflichtet. Support-Zugriff auf Daten des Verantwortlichen erfolgt nur nach dessen Freigabe in der Plattform, zeitlich begrenzt, sichtbar für alle Nutzer und protokolliert.

## 5. Technische und organisatorische Maßnahmen

Es gelten die Maßnahmen in Anlage 1 ([TOM.md](TOM.md)). Der Auftragsverarbeiter darf sie weiterentwickeln, ohne das Schutzniveau zu senken.

## 6. Unterauftragsverarbeiter

6.1 Der Verantwortliche stimmt den Unterauftragsverarbeitern in Anlage 2 ([UNTERAUFTRAGSVERARBEITER.md](UNTERAUFTRAGSVERARBEITER.md)) zu.
6.2 Neue oder geänderte Unterauftragsverarbeiter kündigt der Auftragsverarbeiter mindestens [30] Tage vorher an; der Verantwortliche kann aus wichtigem datenschutzrechtlichem Grund widersprechen.
6.3 Bei Übermittlungen in Drittländer stellt der Auftragsverarbeiter geeignete Garantien nach Art. 44 ff. DSGVO sicher (z. B. Standardvertragsklauseln). Auf Wunsch des Verantwortlichen werden KI-Modelle ausschließlich in der EU betrieben (Amazon Bedrock oder Google Vertex AI in EU-Regionen).

## 7. Unterstützung bei Betroffenenrechten

Die Plattform bietet dem Verantwortlichen selbst: Datenauskunft und -export pro Person (Art. 15, 20), Löschung pro Person (Art. 17) und Aufbewahrungsfristen. Darüber hinaus unterstützt der Auftragsverarbeiter auf Anfrage innerhalb von [5] Werktagen.

## 8. Meldung von Datenschutzverletzungen

Der Auftragsverarbeiter meldet Verletzungen des Schutzes personenbezogener Daten unverzüglich, spätestens innerhalb von [24] Stunden nach Kenntnis, und unterstützt bei Meldungen nach Art. 33 und 34 DSGVO.

## 9. Löschung und Rückgabe

Nach Vertragsende exportiert der Verantwortliche seine Daten selbst oder erhält sie auf Wunsch als Export. Danach löscht der Auftragsverarbeiter alle Daten innerhalb von [30] Tagen; Backups werden im regulären Zyklus von [x] Tagen überschrieben (siehe [LOESCHKONZEPT.md](LOESCHKONZEPT.md)).

## 10. Nachweise und Kontrollen

Der Auftragsverarbeiter stellt die zur Nachweisführung nötigen Informationen bereit (u. a. TOM, Audit-Log-Export mit Hash-Kette) und ermöglicht Überprüfungen nach vorheriger Abstimmung.

## 11. Haftung, Schlussbestimmungen

[nach Hauptvertrag; Gerichtsstand, anwendbares Recht: österreichisches Recht]

Anlagen: 1 – TOM · 2 – Unterauftragsverarbeiter
