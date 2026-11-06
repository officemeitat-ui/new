# Ausbauplan der Cleanos App

Was als Nächstes gebaut wird, in dieser Reihenfolge. Wird bei jeder Runde nachgeführt (Stand und Status), damit auch nach einer Pause oder in einer neuen Sitzung klar ist, wo es weitergeht. Entscheidungen der Geschäftsführung stehen dabei.

## In Arbeit / zuletzt fertig (Stand 6. November 2026)

| Thema | Status |
|---|---|
| Zahlungserinnerung automatisch (Vorschlag mit Freigabe) | fertig |
| Rechnungen im Kundenbereich, Angebot online annehmen | fertig (Link wird zurückgezogen, wenn das Büro selbst entscheidet) |
| Winterdienst abrechnen, Abrechnung nach Ist-Zeiten | fertig (Beilage eingefroren, auch für die Buchhaltung; Winterdienst nicht doppelt) |
| Kosten weiterverrechnen, Umsatzsteuer-Übersicht (UVA) | fertig – Kennzahlen mit der Steuerberatung abstimmen (RECHTSPRUEFUNG Punkt 27) |
| Anlagen & Prüffristen je Objekt (Facility Service) | fertig – Intervalle bestätigen lassen (RECHTSPRUEFUNG Punkt 28) |
| Regiebericht am Handy mit Kundenunterschrift | in Arbeit |
| Qualitätsmessung nach ÖNORM EN 13549 | in Arbeit |

## Als Nächstes

1. **Mehrsprachigkeit für Mitarbeitende** – „Plan am Handy“ (mein-plan.php) und Objektanweisungen auf Bosnisch/Kroatisch/Serbisch, Rumänisch, Türkisch, Ungarisch, Englisch; Sprache je Person.
2. **Arbeitsschutz** – Arbeitsstoffverzeichnis aus den Material-Artikeln (Sicherheitsdatenblatt, Gefahren), Betriebsanweisungen als PDF, Evaluierung nach § 4 ASchG mit Maßnahmen und Fristen; Verbindung zu den Unterweisungen.
3. **Kundenzufriedenheit** – kurze Umfrage im Kundenbereich (vierteljährlich), Auswertung je Objekt und Kunde, Hinweis bei schlechten Werten.
4. **Bewerber, Eintritt, Austritt** – Bewerberliste mit Status, Eintritts-Checkliste (Anmeldung, Unterweisung, Schlüssel, Dienstkleidung, Einschulung im Objekt), Austritts-Checkliste (Schlüssel zurück, Abmeldung, Zeitkonto).
5. **Feinschliff** – Winterdienst-Preise je Objekt im Kundenblatt, Leistungszeitraum der Saisonpauschale, Bestätigungs-E-Mail an den Kunden nach der Online-Annahme; Prüfungen der Anlagen in die Fakturierung übernehmen (Preis steht schon je Prüfung).

## Offen – braucht Entscheidung oder Zuarbeit

- orgaMAX-Strukturdatei (`orgaMAX-Struktur_….json`) für die genaue Spaltenzuordnung der Übernahme.
- Steuerberatung: Buchung Abschlag/Schluss, Kundenskonto- und Kassenkonten, Kennzahlen der Umsatzsteuer-Übersicht, Soll/Ist, durchlaufende Posten (RECHTSPRUEFUNG Punkt 27).
- Geschäftsführung: Winterdienst-Saison Juli–Juni oder anders? Fotos in die Winterdienst-Beilage? Bestätigungs-E-Mail nach Online-Annahme? Intervalle der Anlagen mit der Sicherheitsfachkraft bestätigen (Punkt 28).
- Hausbank: Test von pain.008 (Lastschrift) und pain.001 (Überweisung); USP: ebInterface-Test.
- Rechtliches: § 174 TKG (Werbe-E-Mail), BAO § 131/131b (Kassenbuch), FAGG bei Online-Annahme durch Verbraucher, Prüfintervalle der Anlagen – siehe docs/RECHTSPRUEFUNG.md.
- Echter Betrieb: Gruppen je Rolle und je Revier einrichten, Rechte prüfen, Pilot mit einem Revier.
