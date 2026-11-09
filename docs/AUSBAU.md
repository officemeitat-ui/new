# Ausbauplan der Cleanos App

Was als Nächstes gebaut wird, in dieser Reihenfolge. Wird bei jeder Runde nachgeführt (Stand und Status), damit auch nach einer Pause oder in einer neuen Sitzung klar ist, wo es weitergeht. Entscheidungen der Geschäftsführung stehen dabei.

## In Arbeit / zuletzt fertig (Stand 9. November 2026)

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
| KI-Ausbau (Beleg lesen, Regiebericht diktieren, Sicherheitsdatenblatt lesen, Assistent kennt die neuen Module, Texte) | fertig – Auftragsverarbeitung klären (RECHTSPRUEFUNG Punkt 35) |
| Handy: untere Leiste je Rolle, Plätze einzeln tauschbar | fertig |
| Feinschliff (Winterdienst-Preise im Kundenblatt, Leistungszeitraum Saisonpauschale, Anlagen verrechnen, Sprache im Import und Wochenplan-PDF) | fertig |
| Mattenwechsel-Modul (Liegeplätze, Kalender, Tourenplanung, Fahreransicht, Fahrerseite am Webspace, Lieferscheine, Rechnungsentwürfe) | P1–P17 fertig (zuletzt Mattenbestand und Wäscherei, Lieferscheine im Kundenbereich, KI-Werkzeuge, Ergebnisse automatisch übernehmen); Gesamtprüfung nach den sechs Abnahmekriterien grün – **Abnahme durch die Geschäftsführung**, danach „Umstellung auf das Modul“ (docs/MATTENWECHSEL-PLAN.md) |

## Als Nächstes

1. **Mattenwechsel-Modul**: Abnahme durch die Geschäftsführung, danach Umstellung (`#matten` öffnet das Modul, das Werkzeug ist nur noch lesend; jederzeit zurücknehmbar).
2. **Bestätigungs-E-Mail nach Online-Annahme** – wartet auf Entscheidung.
3. **Routing mit echten Fahrzeiten einschalten** (gebaut): OpenRouteService kostenlos ohne Kreditkarte (EINRICHTUNG Schritt 12 A; vorher prüfen, ob die Gratisnutzung für Firmen erlaubt ist – Rechtsprüfung Punkt 40) oder Google mit Tageslimit (Schritt 12 B, Punkt 39). Bis dahin rechnet der eingebaute Anbieter (kostenlos).

## Offen – braucht Entscheidung oder Zuarbeit

- orgaMAX-Strukturdatei (`orgaMAX-Struktur_….json`) für die genaue Spaltenzuordnung der Übernahme.
- Steuerberatung: Buchung Abschlag/Schluss, Kundenskonto- und Kassenkonten, Kennzahlen der Umsatzsteuer-Übersicht, Soll/Ist, durchlaufende Posten (RECHTSPRUEFUNG Punkt 27).
- Geschäftsführung: Winterdienst-Saison Juli–Juni oder anders? Fotos in die Winterdienst-Beilage? Bestätigungs-E-Mail nach Online-Annahme? Intervalle der Anlagen mit der Sicherheitsfachkraft bestätigen (Punkt 28).
- Hausbank: Test von pain.008 (Lastschrift) und pain.001 (Überweisung); USP: ebInterface-Test.
- Rechtliches: § 174 TKG (Werbe-E-Mail), BAO § 131/131b (Kassenbuch), FAGG bei Online-Annahme durch Verbraucher, Prüfintervalle der Anlagen, Aufbewahrung ohne Frist begründen (Punkt 38), Google-Routing (Punkt 39), OpenRouteService (Punkt 40) – siehe docs/RECHTSPRUEFUNG.md.
- Echter Betrieb: Gruppen je Rolle und je Revier einrichten, Rechte prüfen, Pilot mit einem Revier.
