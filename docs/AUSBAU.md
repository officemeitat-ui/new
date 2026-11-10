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

## Zuletzt fertig (9.11.2026)

- Prüfrunde 2, Webspace: Grenzen zählen vor dem Lesen eines Fotos (kein Speicher-Angriff über kaputte Bilder am Aushang), eine falsche Datei verbraucht aber keine Meldung (Vorprüfung des Dateikopfs); Fotos ohne Daten nach dem Bildende; Grenzen je Adresse bei IPv6 je /64-Netz.
- Tempo: Müllplanung im Index (Rentabilität und Kennzahlen mit 12 Monaten schneller).
- Datum in Wien statt UTC bei Angebotsannahme, Abschlüssen im Vertrieb und im Kassenbuch.
- Engpass-Vorschau: Bedarf aus den Einsätzen gegen verfügbare Vertragsstunden für 8 Wochen, Hinweis in „Zu erledigen“ bei „zu knapp“.
- Fehlersuche (10.11.): 43 Fehler behoben (Datum/Zeitzone, Rundung, Webspace, Oberfläche), Objektdoku 2.3 mit 10 Korrekturen, dauerhafte Prüfung gegen tote Knöpfe, Test für die Erstinstallation.
- Urlaubssperren und Höchstzahl gleichzeitig Abwesender: Hinweise beim Urlaubsantrag (Sperrzeit, wer schon weg ist, Resturlaub), Kalender mit Zahl je Tag, Hinweis am Handy.
- Regeln „Standardwerte“ löschen nicht mehr Plan am Handy, Schnee-Alarm und Orte (Fehler behoben).
- Kundenbereich „Stand im Objekt“: zuletzt und als Nächstes gereinigt (mit „erledigt“ aus Zeiterfassung oder Checkliste), Winterdienst, offene Meldungen ohne Text; stündlich aktuell (Idee 15, Rechtsprüfung Punkt 54).
- Wunschzeiten: Wunschfrei, früh/spät, mehr/weniger Stunden; die Automatik berücksichtigt sie weich, danach „erfüllt“ je Wunsch; Eingabe im Büro und am Handy (Plan am Handy, sechs Sprachen).
- Fuhrparkkosten je Fahrzeug: Werkstatt und Eingangsrechnungen mit Fahrzeug (Vorschlag aus dem Kennzeichen auf dem Beleg), km aus dem Fahrtenbuch, Kosten je km, CSV.
- KI-Assistent: Werkzeuge für Rentabilität, Nachkalkulation, Fahrtenbuch, Zusatzleistungen und Checklisten (nur lesen).
- Leistungs-Checkliste am Handy: je Leistung eine Checkliste (Foto nötig, 1× pro Woche, bestimmte Tage; Vorlagen, übersetzt, „Mit KI übersetzen“), abhaken im Plan am Handy mit Foto ohne Ortsdaten oder „nicht möglich“ mit Grund; Abholen mit den Stempelungen, Fotos in SharePoint, „Zu erledigen“, Spalte im Leistungsnachweis (Idee 3, Rechtsprüfung Punkt 50).
- Zusatzleistungen im Kundenbereich anfragen: Wunschtermin, Fläche, Fotos; daraus Angebot, Vertriebsfall, Termin oder Regiebericht, Stand zurück an den Kunden (Idee 7, Rechtsprüfung Punkt 49).
- Barrierefreiheit: Prüfung aller Ansichten mit axe-core (WCAG 2.1 AA) am PC und Handy, alle ernsten Befunde behoben (Teil der Prüfrunde 2).
- Fahrtenbuch je Fahrzeug: Fahrten aus Touren, Winterdienst und Dienstplan bestätigen, km-Stand, Änderungen und Stornos nachvollziehbar, Privat-km im Jahresschnitt, CSV.
- Kalkulation: „Aus Ausschreibung lesen (KI)“ – Leistungsverzeichnis (PDF) → Vorschlag für Bereiche mit Art, m² und Häufigkeit, nur Angehaktes in die Flächen.
- Prüfrunde: Sicherheit am Webspace (5 Befunde behoben), 9 Rechenfehler im Mattenwechsel behoben, Leistung mit großen Datenmengen (Ansichtswechsel unter 0,3 s statt Minuten).
- Datensicherung (ZIP mit Prüfsummen, Prüfen, gezieltes Zurückspielen) und Robustheit.
- Kundenverträge mit Fristen und Preisanpassung nach KV-Lohnerhöhung (Rechtsprüfung Punkt 41).
- Geräte & Maschinen (Inventar mit QR-Etikett, Prüfungen, Reparaturen, Ausgabe; Rechtsprüfung Punkt 42).
- Mitteilungen an Mitarbeitende mit Lesebestätigung, KI-Übersetzung (Rechtsprüfung Punkt 43).
- Vertrieb von der Anfrage bis zum Auftrag mit KI-Besichtigung (Rechtsprüfung Punkt 44).
- Eingangsrechnung gegen Bestellung: Abgleich mit Wareneingang, Vorschlag der passenden Bestellung, Rückfrage vor der Freigabe bei Abweichung (Idee 11).
- Nachkalkulation: kalkulierte gegen geplante und gestempelte Stunden je Objekt, Vorschlag für die Leistungswerte je Raumart (Idee 10).
- Posteingang: E-Mails (.eml), PDFs, Fotos und Text ablegen oder das Microsoft-365-Postfach nur lesend einbinden; Regeln und KI (nur Betreff und gekürzter Text ohne Adressen, Telefon, IBAN; Krankmeldungen und Nachrichten aus dem Team nie) erkennen die Art und öffnen den passenden Dialog vorbefüllt; in SharePoint kein Mailtext (Idee 1, Rechtsprüfung Punkt 46).
- Aushang (QR) im Objekt: Hausbewohner, Hausverwaltung und Mitarbeitende des Kunden melden ohne Anmeldung ein Problem (Foto, Ort, Kontakt freiwillig, Deutsch und Englisch); wird zur Reklamation mit Eingang „Aushang (QR)“, Stand über einen eigenen Statuslink (Idee 2, Rechtsprüfung Punkt 45).
- Tempo: Kennzahlen beim ersten Öffnen 7 / 23 s → 2,1 / 9,5 s (PC / Handy), „Zu erledigen“ rechnet im Hintergrund statt nach jeder Änderung die Bedienung aufzuhalten (Idee 9).
- Rentabilität je Objekt: Deckungsbeitrag mit Ampel, Ist-Stunden aus der Zeiterfassung, Vorperiode, Umsatz für das Ziel und Weg zum Vertrag (Idee 6).
- Wochenbriefing als Bericht in „Berichte automatisch“, auf Wunsch mit KI-Zusammenfassung ohne Namen (Idee 5, Rechtsprüfung Punkt 48).
- KI-Fotoprüfung bei der Qualitätsmessung: Vorschlag je Prüfobjekt aus einem Foto, Übernahme nur per Klick, im Bericht gekennzeichnet (Idee 8, Rechtsprüfung Punkt 51).
- Paket für die Steuerberatung: Zeitraum als ZIP mit CSV-Dateien, Rechnungs-PDFs, Belegen, Kassenbuch, Zahlungen, offenen Posten und Umsatzsteuer-Übersicht, Prüfliste, Übergabe-Vermerk und Nachreichung (Idee 4, Rechtsprüfung Punkt 47).

## Ideen für die nächsten Runden (Reihenfolge = Vorschlag)

1. **(fertig)** KI-Posteingang: Kunden-E-Mails (Reklamation, Zusatzauftrag, Terminwunsch, Kündigung) und Eingangsrechnungen aus einem Postfach erkennen und als Entwurf anlegen – immer mit Freigabe.
2. **(fertig)** Objekt-QR zum Aushängen: Kunden und Hausbewohner melden ohne Anmeldung (Foto, Text) – wird zur Reklamation des Objekts, Status über den Link.
3. **(fertig)** Leistungs-Checkliste am Handy: je Einsatz die Leistungen aus dem Leistungsverzeichnis abhaken (Foto bei Bedarf) – ergibt den Leistungsnachweis für den Kunden.
4. **(fertig: Paket für die Steuerberatung)** Buchhaltungs-Export für die Steuerberatung: Ausgangs- und Eingangsrechnungen, Zahlungen und Kassenbuch als Buchungsstapel (BMD, RZL oder DATEV-Format).
5. **(fertig)** KI-Wochenbriefing: Montag früh je Rolle eine kurze Zusammenfassung (Umsatz, offene Posten, Reklamationen, Krankenstände, Fristen, Lücken im Plan) per E-Mail oder Push.
6. **(fertig)** Rentabilität je Objekt: Ist-Stunden und Kosten gegen Umsatz mit Ampel und Vorschlag zur Preisanpassung (an die Kundenverträge angebunden).
7. **(fertig)** Kunden-Self-Service: im Kundenbereich Zusatzleistungen anfragen (Grundreinigung, Glas) → Angebot oder Regieauftrag.
8. **(fertig, bei der Qualitätsmessung)** KI-Fotoprüfung bei der Objektkontrolle: Vorschlag zur Bewertung je Foto (nur Hinweis, die Person entscheidet).
9. **(fertig)** Tempo Kennzahlen und „Zu erledigen“: Kennzahlen rechnen beim ersten Öffnen den Plan von 12 Monaten neu (bei großen Datenmengen 7 s am PC, 23 s am Handy); „Zu erledigen“ rechnet nach jeder Änderung alle Quellen neu (am Handy rund 2 s) – Zwischenspeicher je Quelle.

### Nächste Runde (Vorschläge vom 9.11.2026)

10. **(fertig)** Nachkalkulation: Kalkulierte Stunden je Objekt gegen geplante und gestempelte Stunden; Vorschlag, die Leistungswerte (m² je Stunde) je Raumart aus den Ist-Zeiten anzupassen – die Kalkulation lernt aus der Praxis.
11. **(fertig)** Eingangsrechnung gegen Bestellung prüfen: Menge und Preis der Eingangsrechnung mit der Bestellung aus Material & Lager vergleichen, Abweichungen vor der Freigabe zeigen.
12. **(fertig)** Einsatzplanung mit Wunschzeiten: Mitarbeitende geben am Handy Verfügbarkeit und Wünsche für die nächsten Wochen an; die Automatik berücksichtigt sie und zeigt, wessen Wünsche erfüllt sind.
13. **(fertig)** KI-Angebotstext aus einer Ausschreibung: Leistungsverzeichnis einer Ausschreibung (PDF) lesen, Räume und Häufigkeiten in die Kalkulation übernehmen (wie die Besichtigung im Vertrieb).
14. **(fertig)** Fahrtenbuch aus den Touren: Für Fahrzeuge im Mattenwechsel und Winterdienst Fahrten aus den Touren vorschlagen (Datum, Strecke, Kilometer, Zweck) – zum Bestätigen statt Abschreiben.
15. **(fertig)** **Kunden-Statusseite je Objekt:** ein Link für die Hausverwaltung mit allen offenen Meldungen, Terminen und dem letzten Leistungsnachweis eines Objekts (Kundenbereich je Objekt statt je Kunde).
16. **(fertig)** **Prüfrunde 2:** Sicherheit der neuen Webspace-Seiten (Aushang, Zusatzleistungen, Checkliste), Leistung mit großen Datenmengen für Rentabilität und Steuerberatungs-Paket, Barrierefreiheit (Tastatur, Bildschirmleser) der neuen Dialoge.

## Offen – braucht Entscheidung oder Zuarbeit

- orgaMAX-Strukturdatei (`orgaMAX-Struktur_….json`) für die genaue Spaltenzuordnung der Übernahme.
- Steuerberatung: Buchung Abschlag/Schluss, Kundenskonto- und Kassenkonten, Kennzahlen der Umsatzsteuer-Übersicht, Soll/Ist, durchlaufende Posten (RECHTSPRUEFUNG Punkt 27).
- Geschäftsführung: Winterdienst-Saison Juli–Juni oder anders? Fotos in die Winterdienst-Beilage? Bestätigungs-E-Mail nach Online-Annahme? Intervalle der Anlagen mit der Sicherheitsfachkraft bestätigen (Punkt 28).
- Posteingang (Punkt 46): eingebaute Rolle „Sekretariat“ statt nur Vollzugriff? Bewerbungen von der KI ausnehmen? Aufräumfrist 180 Tage? Sammelpostfach mit Mail.Read.Shared empfohlen (Administratorzustimmung).
- Neu (9.11.): Aushang – Weiterleitung an die Hausverwaltung, Datenschutzerklärung im Kundenbereich eintragen, Frist für Kontaktdaten Dritter (Vorschlag 1 Jahr nach „erledigt“), Grenzen 10 je Aushang / 5 je Adresse am Tag (Punkt 45). Paket für die Steuerberatung – Übertragungsweg und CSV-Format mit der Steuerberatung klären (Punkt 47). Wochenbriefing – dürfen Kunden- und Objektnamen an Anthropic (Punkt 48)? Rentabilität – Ziel-Deckungsbeitrag festlegen (Vorgabe 25 %).
- Neu (9.11.): Checkliste am Handy (Punkt 50) – Zeitfenster am Handy (1 h vor Beginn bis 24 h nach Ende) und Grenzen (150 Speichervorgänge, 40 Fotos je Person und Tag) passend? „1× pro Woche“ = beim ersten Einsatz der Woche; Betriebsvereinbarung bzw. Zustimmung (§ 96/96a ArbVG); Aufbewahrungsfrist der Fotos in SharePoint;
- Neu (9.11.): Zusatzleistungen (Punkt 49) – Sprachwahl Deutsch/Englisch für den Kundenbereich? Vorbelegte Ansprechperson für alle mit dem Link sichtbar in Ordnung? Löschfrist für Anfragen ohne Auftrag (Vorschlag 3 Jahre)? Reichen 5 Anfragen je Link und Tag?
- Neu (9.11.): Fahrtenbuch (Punkt 52) – mit der Steuerberatung abstimmen, ob das Fahrtenbuch aus der App reicht und welche Fahrzeuge eines brauchen (Sachbezug); Abstellort je Fahrzeug eintragen.
- Hausbank: Test von pain.008 (Lastschrift) und pain.001 (Überweisung); USP: ebInterface-Test.
- Rechtliches: § 174 TKG (Werbe-E-Mail), BAO § 131/131b (Kassenbuch), FAGG bei Online-Annahme durch Verbraucher, Prüfintervalle der Anlagen, Aufbewahrung ohne Frist begründen (Punkt 38), Google-Routing (Punkt 39), OpenRouteService (Punkt 40) – siehe docs/RECHTSPRUEFUNG.md.
- Echter Betrieb: Gruppen je Rolle und je Revier einrichten, Rechte prüfen, Pilot mit einem Revier.
