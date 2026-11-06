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
| Regiebericht am Handy mit Kundenunterschrift, PDF, Rechnungsentwurf mit einem Klick | fertig – Rechtsfragen in RECHTSPRUEFUNG Punkt 29 |
| Qualitätsmessung in Anlehnung an ÖNORM EN 13549 (Stichprobe, Kennzahl, Verlauf, Bericht) | fertig – Tabellen gegen den Normtext prüfen (RECHTSPRUEFUNG Punkt 30) |
| Mehrsprachigkeit für Mitarbeitende (Plan am Handy in sechs Sprachen, Objektanweisungen übersetzt) | fertig – Übersetzungen gegenlesen lassen (RECHTSPRUEFUNG Punkt 31) |
| Arbeitsschutz (Arbeitsstoffverzeichnis, Betriebsanweisungen, Evaluierung nach § 4 ASchG) | fertig – mit Sicherheitsfachkraft bestätigen (RECHTSPRUEFUNG Punkt 32) |
| Kundenzufriedenheit (Umfrage im Kundenbereich, NPS, Hinweise) | fertig – Einladung per E-Mail klären (RECHTSPRUEFUNG Punkt 33) |
| Bewerber, Eintritt, Austritt (neue Rolle Personalverwaltung) | fertig – Fristen und Datenschutz bestätigen (RECHTSPRUEFUNG Punkt 34) |
| KI-Ausbau (Beleg lesen, Regiebericht diktieren, Assistent kennt die neuen Module, Texte) | in Arbeit |
| Handy: untere Leiste je Rolle und selbst anpassbar | in Arbeit |
| Feinschliff (siehe unten) | in Arbeit |

## Als Nächstes

1. **Feinschliff** – Winterdienst-Preise je Objekt im Kundenblatt, Leistungszeitraum der Saisonpauschale, Prüfungen der Anlagen in die Fakturierung übernehmen (Preis steht schon je Prüfung), Spalte „Sprache“ beim Excel-Import der Mitarbeitenden, Wochenplan-PDF in der Sprache der Person; Bestätigungs-E-Mail nach der Online-Annahme (wartet auf Entscheidung).

## Offen – braucht Entscheidung oder Zuarbeit

- orgaMAX-Strukturdatei (`orgaMAX-Struktur_….json`) für die genaue Spaltenzuordnung der Übernahme.
- Steuerberatung: Buchung Abschlag/Schluss, Kundenskonto- und Kassenkonten, Kennzahlen der Umsatzsteuer-Übersicht, Soll/Ist, durchlaufende Posten (RECHTSPRUEFUNG Punkt 27).
- Geschäftsführung: Winterdienst-Saison Juli–Juni oder anders? Fotos in die Winterdienst-Beilage? Bestätigungs-E-Mail nach Online-Annahme? Intervalle der Anlagen mit der Sicherheitsfachkraft bestätigen (Punkt 28).
- Hausbank: Test von pain.008 (Lastschrift) und pain.001 (Überweisung); USP: ebInterface-Test.
- Rechtliches: § 174 TKG (Werbe-E-Mail), BAO § 131/131b (Kassenbuch), FAGG bei Online-Annahme durch Verbraucher, Prüfintervalle der Anlagen – siehe docs/RECHTSPRUEFUNG.md.
- Echter Betrieb: Gruppen je Rolle und je Revier einrichten, Rechte prüfen, Pilot mit einem Revier.
