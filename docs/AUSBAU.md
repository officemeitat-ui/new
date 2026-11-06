# Ausbauplan der Cleanos App

Was als Nächstes gebaut wird, in dieser Reihenfolge. Wird bei jeder Runde nachgeführt (Stand und Status), damit auch nach einer Pause oder in einer neuen Sitzung klar ist, wo es weitergeht. Entscheidungen der Geschäftsführung stehen dabei.

## In Arbeit / zuletzt fertig (November 2026)

| Thema | Status |
|---|---|
| Zahlungserinnerung automatisch (Vorschlag mit Freigabe) | fertig |
| Rechnungen im Kundenbereich, Angebot online annehmen | fertig |
| Winterdienst abrechnen, Abrechnung nach Ist-Zeiten | fertig, Nachbesserung läuft (Beilage für die Buchhaltung, Winterdienst nicht doppelt) |
| Kosten weiterverrechnen, Umsatzsteuer-Übersicht (UVA) | in Arbeit |
| Anlagen & Prüffristen je Objekt (Facility Service) | in Arbeit |

## Als Nächstes

1. **Regiebericht am Handy mit Kundenunterschrift** – Sonderleistungen (Grundreinigung, Wasserschaden, Zusatzarbeiten) vor Ort erfassen: Stunden, Personen, Material, Fotos, Unterschrift von Hausbetreuung oder Kunde; PDF an den Kunden; daraus mit einem Klick ein Rechnungsentwurf.
2. **Qualitätsmessung nach ÖNORM EN 13549** – Stichproben je Objekt und Raumgruppe, Bewertung, Qualitätskennzahl, Verlauf; Bericht für den Kunden; Vorschlag bei schlechter Kennzahl (Nachkontrolle, Reklamationsgefahr).
3. **Mehrsprachigkeit für Mitarbeitende** – „Plan am Handy“ (mein-plan.php) und Objektanweisungen auf Bosnisch/Kroatisch/Serbisch, Rumänisch, Türkisch, Ungarisch, Englisch; Sprache je Person.
4. **Arbeitsschutz** – Arbeitsstoffverzeichnis aus den Material-Artikeln (Sicherheitsdatenblatt, Gefahren), Betriebsanweisungen als PDF, Evaluierung nach § 4 ASchG mit Maßnahmen und Fristen; Verbindung zu den Unterweisungen.
5. **Kundenzufriedenheit** – kurze Umfrage im Kundenbereich (vierteljährlich), Auswertung je Objekt und Kunde, Hinweis bei schlechten Werten.
6. **Bewerber, Eintritt, Austritt** – Bewerberliste mit Status, Eintritts-Checkliste (Anmeldung, Unterweisung, Schlüssel, Dienstkleidung, Einschulung im Objekt), Austritts-Checkliste (Schlüssel zurück, Abmeldung, Zeitkonto).
7. **Feinschliff Fakturierung** – Winterdienst-Preise je Objekt im Kundenblatt, Leistungszeitraum der Saisonpauschale, Bestätigungs-E-Mail an den Kunden nach der Online-Annahme.

## Offen – braucht Entscheidung oder Zuarbeit

- orgaMAX-Strukturdatei (`orgaMAX-Struktur_….json`) für die genaue Spaltenzuordnung der Übernahme.
- Steuerberatung: Buchung Abschlag/Schluss, Kundenskonto- und Kassenkonten, Kennzahlen der Umsatzsteuer-Übersicht.
- Hausbank: Test von pain.008 (Lastschrift) und pain.001 (Überweisung); USP: ebInterface-Test.
- Rechtliches: § 174 TKG (Werbe-E-Mail), BAO § 131/131b (Kassenbuch), FAGG bei Online-Annahme durch Verbraucher, Prüfintervalle der Anlagen – siehe docs/RECHTSPRUEFUNG.md.
- Echter Betrieb: Gruppen je Rolle und je Revier einrichten, Rechte prüfen, Pilot mit einem Revier.
