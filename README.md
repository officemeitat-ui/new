# Cleanos Dienstplan

Einsatzplanung für die Gebäudereinigung: Stammplan pflegen, Wochen automatisch einteilen, Vertretungen finden, Arbeitsrecht prüfen (AZG, ARG, KJBG), Wochenzettel im gewohnten Layout veröffentlichen und als PDF an die Mitarbeitenden schicken. Ablage in SharePoint, die ganze Seite nur nach Anmeldung mit dem Firmenkonto (Microsoft 365, keine Gäste), Betrieb auf `app.cleanos.at`.

**Eine App mit den eigenen Werkzeugen:** Dienstplan und Fahrzeuge, dazu die Werkzeuge **Wasserzähler-Ablesung, Objektkontrolle, Objektdoku und Mattenwechsel unverändert** (Ordner `werkzeuge/`), alle mit einer Anmeldung in einer Seitenleiste. **Microsoft-Gruppen** bestimmen, wer welche Bereiche sieht (z. B. Objektmanagement: Einsatzplanung lesen, Objektkontrolle, Objektdoku; Vorarbeiter: nur Wasserzähler; Gruppe Mattenwechsel: Mattenwechsel; office@ und it@: alles). Ohne Gruppe kein Zugriff. Jede Berechtigungsstufe hat in SharePoint einen eigenen Ordner, und die App liest nur die Ordner der eigenen Gruppe. Details: [docs/PLATTFORM.md](docs/PLATTFORM.md).

- **Plattform, Rollen, die eigenen Werkzeuge in der App:** [docs/PLATTFORM.md](docs/PLATTFORM.md), [werkzeuge/LIESMICH.md](werkzeuge/LIESMICH.md)
- **Konzept und Recherche:** [docs/KONZEPT.md](docs/KONZEPT.md)
- **Prüfung nach österreichischem Recht (AZG, ARG, KJBG, KV Reinigung):** [docs/RECHTSPRUEFUNG.md](docs/RECHTSPRUEFUNG.md)
- **Einrichtung** (SharePoint, Entra ID, Domain): [docs/EINRICHTUNG.md](docs/EINRICHTUNG.md)
- **Erweitern** (Regeln, Ansichten, Ablage, Design): [docs/ERWEITERN.md](docs/ERWEITERN.md)

## Schnellstart

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm ci
npm start        # http://localhost:8080 – Demo mit 35 Mitarbeitenden, Daten im Browser
npm test         # 176 Tests: Feiertage, Regeln, Fahrten, Rhythmen, Müllplan, Überstunden, Abwesenheit, Automatik, Wochenzettel, PDF, E-Mail, Kalender, Excel, SharePoint, Offline, Rollen, Reifenwechsel, Service & Pickerl, Rechte je Gruppe, Werkzeuge (Anmeldebrücke), Webspace (.htaccess), Einrichtung, Hochladen
npm run build    # dist/ zum Hochladen: gebündelt, minimiert, mit Anmeldeschutz
npm run hochladen # baut und lädt per FTP(S) auf den Webspace (World4You), config.json am Server bleibt
```

Ob die App im Browser oder in SharePoint speichert, legt `config.json` fest (`"storage": "local"` oder `"sharepoint"`). Die Datei kann am Server ohne neuen Build geändert werden.

## Funktionen

| Planung | Auswertung | Stammdaten |
|---|---|---|
| Ablauf-Leiste: Einteilen → Offene → Prüfen → Veröffentlichen → Versenden | Objekt-Controlling: Budget gegen Plan je Objekt | Mitarbeitende inkl. Import aus Excel, Lohngruppe, Stundenlohn |
| Wochenübersicht mit Revier-Filter, Saldo und Zeitkonto; Einsätze per Ziehen umverteilen | Überstunden & Auszahlung: Mehrarbeit, Überstunden, Zuschläge in €, Monatsabschluss, Versand | Zuweisung: Reinigungsplan → feste Person je Leistung, mit Vorschlägen und Auslastung |
| Zeitlinie je Tag: Einsätze und Fahrten als Balken | | |
| Wochenzettel wie bisher (PDF, Excel, Druck) | Monatsauswertung für die Lohnverrechnung (CSV), Export ins Lohnprogramm (BMD, RZL) mit Lohnarten | Objekte & Leistungen, Objektinfo, Schlüssel, Budget |
| Versand: PDF je Person per E-Mail, Teilen (WhatsApp) oder ZIP, mit Versandstand | | |
| Objektplan | | Abwesenheiten mit Kalender und Resturlaub |
| Vertretungs-Cockpit mit Vorschlägen | Nachträgliche Korrekturen für die Lohnverrechnung | Regeln, Regelkatalog, Fahrzeiten, Feiertage |
| Periodische Leistungen (14-tägig, monatlich, quartalsweise) mit Frist | | |
| Müllplan: wer stellt wann die Tonnen raus und rein | | Müllplan je Objekt, Abfuhrkalender einlesen (.ics) |
| Prüfbericht | | |

Fahrten sind planbar: Nach jedem Einsatz lässt sich die Fahrt mit Dauer und eigener Notiz eintragen, für diese Woche oder als Standard der Leistung. Ohne Eintrag gilt die eingetragene Strecke, sonst eine **Schätzung aus den Adressen** (Koordinaten je Objekt, über OpenStreetMap gesucht oder von Hand; Luftlinie × 1,35, Durchschnittsgeschwindigkeit, Zuschlag fürs Parken), sonst die Pauschale. Passt eine Fahrt nicht bis zum nächsten Einsatz, wird sie rot markiert.

**Urlaub und Krankenstand:** Wird eine Abwesenheit eingetragen (auch rückwirkend, auch direkt im Einsatz mit „Abwesend“), öffnet sich sofort der Assistent. Er zeigt, welche Einsätze und wie viele Stunden neu zu planen sind, übergibt die Fixobjekte gesammelt an eine Person (sortiert nach: wer übernimmt die meisten Stunden regelkonform, mit wie vielen Mehrstunden), verteilt automatisch oder schlägt je Einsatz eine Vertretung vor. Betrifft die Abwesenheit schon veröffentlichte Wochen, wird dort die Korrektur gebucht: Zeitkonto und Monatsauswertung („Nachträgliche Korrekturen“) stimmen danach.

**Zu erledigen:** Die Glocke in der Kopfzeile zählt, was zugeteilt werden muss: Abwesenheiten mit offenen Stunden, periodische Leistungen ohne Besetzung (spätestens 7 Tage vorher, einstellbar) und veröffentlichte Wochen mit späteren Änderungen. Gibt es Neues, öffnet sich die Liste beim Start von selbst.

**Kennzahlen:** Stunden, Besetzung, Krankenstand, Auslastung, Plus-Stunden, Reklamationen, Umsatz, offene Posten, Material und Deckungsbeitrag auf einer Seite, mit Trend und Tabellenansicht, je Rolle nur, was sie sieht ([mehr](docs/PLATTFORM.md#kennzahlen)).

**Einfach planen:** Einsätze lassen sich in der Wochenübersicht auf eine andere Person ziehen. Beim Ziehen zeigt jede Zelle sofort, ob die Person passt (grün), geprüft werden sollte (gelb) oder gegen eine Regel verstößt (rot). Jede Planänderung lässt sich mit „Rückgängig“ oder Strg+Z zurücknehmen. Vorschläge sind begründet, z. B. „noch 6 h frei laut Vertrag · kennt das Objekt (4×) · Zeitkonto −8 h: gleicht Minusstunden aus“. Die Automatik bevorzugt Stammkräfte, Personen mit freien Vertragsstunden oder Minusstunden, das eigene Revier und wer das Objekt schon kennt.

**PDF und Versand:** Je Person eine A4-Seite im gewohnten Layout (Feiertagsarbeit mit Zuschlag, Entfallenes durchgestrichen, Vertretungen rot, Sonderleistungen grün), mit Objektadressen, Hinweisen für Vertretungen, Saldo und Zeitkonto. Nach dem Veröffentlichen öffnet sich der Versand: E-Mail mit PDF-Anhang über Microsoft 365, „Teilen“ am Handy (z. B. WhatsApp), Sammel-PDF zum Drucken oder ZIP. Wird ein Plan nach dem Versand geändert, steht die Person wieder auf „zu versenden“.

**Feiertage:** An gesetzlichen Feiertagen wird gearbeitet: die Einsätze finden statt, mit Feiertagszuschlag (ARG § 9: Feiertagsentgelt + Entgelt für die Arbeit, 100 %, einstellbar). Der Zuschlag steht im Wochenzettel („inkl. 100 % Feiertagszuschlag“, z. B. 2 h → 4 h), in der Monatsauswertung und in „Überstunden & Auszahlung“ (als Zeitgutschrift oder in Geld). Nur wenn ein Kunde an Feiertagen geschlossen hat, wird bei der Leistung „entfällt (Kunde geschlossen)“ oder „verschieben“ eingestellt. Betriebsfreie Tage (selbst eingetragen) schließen den Betrieb; einzelne Einsätze lassen sich dann mit „Trotzdem stattfinden“ einplanen. Jugendliche (KJBG) werden an Sonn- und Feiertagen nicht eingeteilt.

**Müllplan:** Je Objekt die Abfuhrtage der Tonnen eintragen (Restmüll, Bio, Papier, Gelbe Tonne …): als Rhythmus (wöchentlich, 14-tägig, 4-wöchentlich, monatlich) oder als Termine aus dem Abfuhrkalender der Gemeinde, als Kalenderdatei (.ics) oder eingefügte Liste. Die Automatik plant das Raus- und Reinstellen mit: Ist am Vorabend (bzw. in der Früh) jemand ohnehin im Objekt, erledigt diese Person es mit, die Minuten werden angerechnet und stehen im Wochenzettel („Müll rausstellen: Restmüll, Altpapier (+10 min)“). Sonst entsteht ein kurzer eigener Gang (z. B. 18:00–18:10), den „Woche planen“ besetzt, bevorzugt mit einer verfügbaren Stammkraft des Objekts oder mit jemandem, der an dem Tag schon dort ist. Fällt die Abfuhr laut Rhythmus auf einen Feiertag, rückt sie auf den nächsten Werktag. Die Ansicht „Müllplan“ zeigt für die Woche je Objekt jeden Gang mit Zeit und Person.

**Reinigungsplan und Zuweisung:** Unter „Objekte & Leistungen“ steht der Reinigungsplan: welches Objekt wann, wie oft (wöchentlich, 14-tägig, monatlich …) und wie lange gereinigt wird, mit wie vielen Personen. In der Ansicht „Zuweisung“ bekommt jede Leistung ihre feste Person (Stammkraft). Je Leistung steht ein begründeter Vorschlag: passt zeitlich (Verfügbarkeit, keine Überschneidung, Fahrzeit reicht), hat die Qualifikation, hat noch Vertragsstunden frei, ist im Revier, kennt das Objekt oder ist direkt davor in der Nähe. Zuweisen per Klick, eine andere Person aus der Liste wählen (mit Grund, warum jemand nicht passt), Vorschläge für ein ganzes Objekt oder alle offenen Leistungen auf einmal übernehmen, ohne Doppelbelegung. Ist niemand frei, steht das dabei. Die Auslastung zeigt je Person Vertrag gegen Stammplan. Danach teilt „Woche planen“ jede Woche automatisch ein und sucht bei Abwesenheit Vertretungen.

**Dienstplan je Person:** Ein Klick auf einen Namen (Wochenübersicht, Zeitlinie, Mitarbeitende, Zuweisung, Handy-Tagesliste) öffnet den Dienstplan dieser Person: ihre Woche Tag für Tag, ihre festen Objekte (Stammplan) mit Stunden gegen den Vertrag und eine Auswahl aller Objekte (nach Revier). Nach der Wahl eines Objekts stehen dessen Leistungen mit Zeiten da und ob sie für die Person passen (Verfügbarkeit, Qualifikation, Überschneidung, Fahrzeit, Stunden). Zuweisen: dauerhaft als Stammkraft, „statt“ der bisherigen Person oder nur für die angezeigte Woche (fixiert, mit Hinweis auf Regelverstöße); alle passenden Leistungen eines Objekts auf einmal. Feste Objekte lassen sich dort auch wieder entfernen.

**Überstunden & Auszahlung:** Aus dem Dienstplan berechnet der Dienstplan je Person und Monat, was nach AZG und Kollektivvertrag (Denkmal-, Fassaden- und Gebäudereinigung, Arbeiter/innen, ab 1.1.2026) anfällt:

- **Mehrarbeit** (Teilzeit, zwischen Vertrag und 40 h/Woche): zuschlagsfrei, wenn sie binnen 3 Monaten 1:1 durch Zeitausgleich ausgeglichen wird; sonst +25 %. Ein Mehrstunden-Konto zeigt je Stunde, bis wann sie ausgeglichen sein muss.
- **Überstunden** (über 9 h am Tag oder 40 h in der Woche): +50 %, Nacht +100 %, Sonntag +150 % (Sonntag Nacht +175 %), Feiertag +100 %, angeordnete 11./12. Stunde +75 %.
- **Durchrechnung** (KV, je Person mit Vereinbarung): 35–45 h je Woche sind Normalarbeitszeit, im Schnitt höchstens 40 h; ein Guthaben am Ende des Zeitraums wird als Überstunden (+50 %) abgerechnet.
- **Zuschläge auf Normalstunden:** Nacht (Mo–Sa 21–6 Uhr) +50 %, Sonntag 6–21 Uhr +100 %, Sonntag Nacht +150 %, Feiertag +100 %; Sonn-/Feiertag wie bisher als Zeitgutschrift im Wochenzettel oder wahlweise in Geld.
- **Behandlung je Person:** auszahlen, Zeitausgleich 1:1,5 oder Zeitausgleich 1:1 mit Zuschlag in Geld (§ 10 AZG). Beträge brutto mit dem KV-Stundenlohn der Lohngruppe oder einem eigenen Stundenlohn.
- **Monatsabschluss:** bucht ausbezahlte Stunden aus dem Zeitkonto (Zeitausgleich-Zuschläge hinein), sperrt den Monat und lässt sich aufheben. CSV mit Lohnarten für BMD/RZL.
- **Auszahlungen versenden:** gesammelt an die Lohnverrechnung (eine E-Mail mit „wer bekommt wie viel“ im Text, Übersicht mit Einzelaufstellung als PDF und CSV im Anhang, mehrere Empfänger möglich) und einzeln an jede Person (eigene Aufstellung als PDF). Über Microsoft 365 direkt aus dem Dienstplan, sonst im eigenen E-Mail-Programm, als PDF/ZIP oder „Teilen“ am Handy. Versandstand je Empfänger, „geändert seit Versand“, die Adresse der Lohnverrechnung wird gemerkt.
- **Hinweis Steuer:** Überstundenzuschläge, die nach § 68 Abs. 2 EStG steuerfrei sein können (2026: 15 Überstunden, max. 170 €); Mehrarbeitszuschläge sind steuerpflichtig.

Alle Sätze, Grenzen und Stundenlöhne stehen unter „Regeln“ und lassen sich anpassen. Die Automatik meidet Einteilungen, die Überstunden auslösen. Zeitausgleich wird jetzt korrekt aus dem Zeitkonto genommen (vorher wie Urlaub angerechnet). Die endgültige Abrechnung macht die Lohnverrechnung.

**Die eigenen Werkzeuge:** Wasserzähler-Ablesung, Objektkontrolle (Prüfprotokoll), Objektdoku (Leistungsverzeichnis) und Mattenwechsel laufen genau so, wie sie gebaut sind, im Rahmen der App. Sie bekommen die Microsoft-Anmeldung der App (keine eigene Anmeldemaske) und speichern wie bisher in ihren SharePoint-Ordnern; ohne Netz arbeiten sie weiter wie gewohnt. Eine neue Fassung wird einfach nach `werkzeuge/<name>/` kopiert. Details: [werkzeuge/LIESMICH.md](werkzeuge/LIESMICH.md).

**Fahrzeuge & Reifen:** Firmenfahrzeuge mit Fahrer/in, Reifensätzen, Lagerort und Profiltiefe. Je Saison der Reifenwechsel (Winter bis 31. Oktober, Sommer ab 16. April): Termine werden neben den Diensten der Fahrer/innen vorgeschlagen, die Fahrer/innen bekommen eine E-Mail mit Kalendertermin, die Werkstatt eine Sammelliste. Erledigt mit km-Stand und Profil; Reifen unter dem Mindestprofil (Winter 4 mm, Lkw über 3,5 t 5 mm) stehen in „Zu erledigen“. Dazu **Service und Pickerl**: Pickerl nach §57a (Pkw 3-2-1, ab 19. Mai 2027 4-2-2-2-1; Lkw und Kastenwagen jährlich) mit Fenster und Nachfrist, Service nach Datum oder km mit Hochrechnung aus den km-Ständen, weitere Fälligkeiten wie Tachograph oder Leasingende. Werkstatttermine erledigen mehrere Aufgaben auf einmal, auch zusammen mit dem Reifenwechsel.

**Ohne Netz:** Im Keller ohne Netz geht die Arbeit weiter: Erfasstes wartet im Gerät und wird gespeichert und zusammengeführt, sobald wieder Netz da ist (die Werkzeuge mit ihrem eigenen Offline-Speicher).

**Wetter & Winterdienst:** Vorhersage und amtliche Warnungen von GeoSphere Austria je Revier, grafisch wie in Wetter-Apps: Stundenverlauf, Tageskarten, „Regen in 20 Min.“ je Ort und ein Niederschlagsradar auf der Karte (letzte Stunden, Nowcast, Modell) mit Zeitregler. Objekte mit Winterdienst (§ 93 StVO, fertig bis 6 Uhr): bei Schnee oder Glätte legt ein Klick die Einsätze an und teilt das Winterdienst-Team ein; „Zu erledigen“ erinnert. Leistungen „im Freien“ bekommen bei Hitzewarnung den Hinweis auf den Hitzeschutzplan (Hitzeschutzverordnung) und bei Sturm einen Hinweis für Arbeit in der Höhe. **Schnee-Alarm:** Der Webspace prüft alle 10 Minuten je Ort (z. B. Salzburg, Hallein, Obertrum) und weckt das Team per Push aufs Handy (ntfy, Knopf „Bin wach“), sobald es zu schneien beginnt oder Glätte droht. Ohne Bestätigung geht der Alarm nach 15 Minuten an Stufe 2. Die Bereitschaft kann wöchentlich wechseln. **Winterdienst-Protokoll** als Nachweis: am Handy über den Knopf „Protokoll“ (ohne Anmeldung, mit Fotos) oder in der App, gespeichert in SharePoint, PDF je Monat; fehlende Protokolle stehen unter „Zu erledigen“. Details: [docs/PLATTFORM.md](docs/PLATTFORM.md#wetter--winterdienst).

**Kalkulation je Objekt:** Flächen mit Art, m², Häufigkeit und Leistungswert → Stunden im Monat, Verrechnungssatz über Zuschläge (Lohn, Lohnnebenkosten, Material, Verwaltung, Gewinn), Monatspreis und Preis je m²; Vergleich mit Budget und Reinigungsplan, „Als Budget übernehmen“, Angebot als PDF.

**Systemcheck für die Inbetriebnahme:** prüft HTTPS, `.htaccess`, gesperrten Ordner `privat/`, PHP 8, Einrichtungsdateien, Schlüssel, Cronjobs und SharePoint, mit Hinweis je Punkt.

**Digitale Mitarbeiter:** Disponent, Buchhaltung, Lager und Fristen gehen die Daten laufend durch und bereiten fertige Schritte vor: Vertretungen verteilen, offene Einsätze besetzen, Woche veröffentlichen, Daueraufträge abrechnen, Mahnungen, Bestellungen unter Mindestbestand, Schulungstermine für ablaufende Unterweisungen, Werkstatt, überfällige Reklamationen. Ausführen mit einem Klick, später oder ablehnen; der KI-Assistent kann mitreden.

**Termine mit Outlook:** Kundentermine, Begehungen, Schulungen und Werkstatt im Kalender der App; Teilnehmende aus dem Dienstplan, dem Firmenverzeichnis oder per E-Mail bekommen eine Outlook-Einladung und haben den Termin im eigenen Kalender. Serientermine, Frei/Belegt, Antworten, Teams, Konflikte mit Einsätzen; Termine auch in der Zeitlinie und am Handy. Mitarbeitende können ihren Plan samt Terminen als **Kalender abonnieren** (Outlook, Google, iPhone).

**Schnell und übersichtlich:** Start mit dem Stand im Gerät, SharePoint gebündelt im Hintergrund; Abgleich alle 20 Sekunden, solange jemand arbeitet, zwischen offenen Fenstern sofort, Speichern beim Wechsel in den Hintergrund; Ansichten zeichnen nur Geändertes neu. Menü in sechs Abschnitten, einklappbar, mit angehefteten Bereichen und „Springen zu …“; **„+ Neu“** und Tastenkürzel (T Termin, A Abwesenheit, Z Zeit, R Reklamation, M Material, F Rechnung, ← → Woche, ? Übersicht).

**KI-Assistent:** schreiben oder sprechen, was zu tun ist („Termin morgen 12 Uhr in Salzburg mit Herrn Maier“, „Elif ist bis Freitag krank, bitte Vertretung organisieren“): schlägt im Plan, bei Personen, Objekten, Lager und Kalender nach, legt Outlook-Termine an, trägt Abwesenheiten ein, verteilt Vertretungen, teilt ein, erfasst Reklamationen, fordert Material an, schreibt E-Mails. Jede Änderung erst nach „Ausführen“, mit den Rechten der Person. Claude-API über `ki.php` (Schlüssel nur am Webspace), Tageslimits und Kostenanzeige.

**Fakturierung:** Angebote, Auftragsbestätigungen und Rechnungen mit allen Angaben nach § 11 UStG, fortlaufende Nummern, festgeschrieben und unveränderlich (Storno und Korrektur als eigene Belege), Reverse Charge für Bauleistungen, Daueraufträge je Objekt mit Wertsicherung (Monatslauf), Übernahme aus Leistungsnachweis und Kalkulation, offene Posten mit Teilzahlungen, Mahnstufen mit Verzugszinsen und 40-€-Pauschale, PDF mit Zahlungs-QR-Code, Versand per E-Mail, Ablage in SharePoint, CSV-Export für die Steuerberatung. **Bankabgleich:** Kontoauszug als camt.053/052 (XML) oder CSV (George, ELBA, Bank Austria, BAWAG, jede CSV mit Spaltenzuordnung) einlesen; Eingänge werden über Rechnungsnummer, Betrag, IBAN oder Namen zugeordnet (sicher/wahrscheinlich/unsicher mit Begründung, Teilzahlung, Sammelzahlung, Überzahlung, storniert erkannt), nach Bestätigung als Zahlung gebucht; doppelt eingelesene Buchungen werden erkannt.

**Schlüsselbuch:** wer welchen Schlüssel hat, Ausgabe und Rückgabe mit Unterschrift am Tablet und Quittung (PDF), Verlustmeldung für den Kunden, Hinweise beim Austritt, Übergaben laut Plan; die Prüfregel „Schlüsselübergabe nötig“ liest das Buch.

**Leistungsnachweis für Kunden:** je Objekt und Monat die Einsätze laut Plan mit Status, gestempelten Zeiten und Winterdienst, wahlweise mit Namen; PDF, alle als ZIP, Versand per E-Mail mit Vermerk.

**Unterweisungen & Fristen:** Sicherheitsunterweisung, Reinigungsmittel, Erste Hilfe, Führerscheinkontrolle, Aufenthaltstitel mit Ampel je Person; Unterweisung für viele mit Unterschrift am Tablet und Teilnehmerliste (PDF); abgelaufene Arbeitserlaubnis sperrt im Plan.

**Material & Lager:** Bestand je Lager, Ausgabe an Objekte und Personen, Inventur, Bestellvorschlag je Lieferant, Bestellung per E-Mail mit PDF, Wareneingang auch in Teilen, Anforderungen aus den Objekten (auch „Material fehlt?“ am Handy), Verbrauch je Objekt mit Materialbudget aus der Kalkulation.

**Reklamationen je Objekt:** erfassen (auch aus dem Einsatz-Dialog), wer laut Plan dort war, Maßnahme mit Frist, erledigen mit Ergebnis, PDF für den Kunden ohne Namen, Häufungen je Objekt, überfällige unter „Zu erledigen“.

**Plan am Handy (Mein Dienstplan):** Jede Person bekommt einen persönlichen Link (per WhatsApp oder E-Mail, ohne Anmeldung) und sieht ihre veröffentlichten Wochen mit Zeiten, Objekten, Adressen, Hinweisen, Stunden und Zeitkonto. Beim Veröffentlichen gehen die Pläne automatisch mit, Push (ntfy) bei neuen oder geänderten Wochen. Vom Handy aus: Urlaub, Zeitausgleich oder Pflegefreistellung beantragen und sich krank melden; im Büro unter „Zu erledigen“ eintragen (öffnet den Abwesenheits-Assistenten), genehmigen oder mit Begründung ablehnen. **Einsatzbörse:** Offene Einsätze erscheinen bei allen, die sie laut Regeln übernehmen dürfen; „Ich übernehme“ → im Büro „Einteilen“ (prüft, teilt ein, veröffentlicht die Woche neu, Push an die Person). **Dienst abgeben/tauschen:** „Abgeben“ am Handy → im Büro „In die Börse“ → Kolleg:in übernimmt → „Einteilen“ tauscht, beide bekommen Bescheid. **Zeiterfassung im Objekt:** QR-Aushang je Objekt (PDF aus der App), am Handy „Kommen“/„Gehen“ mit Serverzeit; Ansicht „Zeiterfassung“ (Plan gegen Ist, Nachtragen und Korrigieren mit Grund, Pausen, Ruhepausen-Hinweis nach § 11 AZG, Woche freigeben, Monat je Person mit Arbeitszeitaufzeichnung als PDF, CSV), „Nicht eingestempelt“ unter „Zu erledigen“ und per Push ans Büro. Details: [docs/PLATTFORM.md](docs/PLATTFORM.md#plan-am-handy-mein-dienstplan).

**Rollen und Suche:** Jede Rolle sieht nur ihre Bereiche und Werkzeuge. Strg+K, „Springen zu …“ oder die Lupe sucht Personen, Objekte, Fahrzeuge und Bereiche (auch unter Alltagswörtern wie „Urlaub“ oder „Rechnung“).

**Auf allen Geräten:** PC, Tablet und Handy haben den vollen Funktionsumfang, die Daten liegen zentral in SharePoint. Am Handy gibt es eine eigene Ansicht: Tagesliste statt Wochentabelle (offene Einsätze oben, Wischen wechselt den Tag), Leiste unten (Woche, Vertretung, **＋ Abwesend**, Wochenzettel, Menü), Dialoge als Blatt von unten und Tabellen als Karten. Auf Touch-Geräten ersetzt „Statt Ana“ im Einsatz das Ziehen. Der Dienstplan lässt sich als App auf den Startbildschirm legen (Android, iPhone, Windows, Mac), startet schneller und gleicht sich beim Zurückwechseln sofort ab.

**Geschützt:** Die Daten gibt es nur nach der Microsoft-Anmeldung mit dem Firmenkonto und nur, soweit das Konto in SharePoint lesen darf; Gastkonten werden abgewiesen. Auf dem World4You-Webspace setzt die mitgebaute `.htaccess` dieselben Sicherheitsregeln wie auf Azure. Auf Azure Static Web Apps wird zusätzlich jede Datei erst nach der Anmeldung ausgeliefert (docs/EINRICHTUNG.md, Schritt 4).

Dazu kommen: Veröffentlichen mit Excel- und PDF-Export nach SharePoint, Markierung späterer Änderungen, Änderungsprotokoll, Leserechte für Nicht-Disponent:innen und automatisches Zusammenführen, wenn zwei Personen gleichzeitig planen.

## Corporate Design und Darstellung

**Aufbau („Klar & hell“):** Die Cleanos App hat links eine Seitenleiste mit allen Bereichen, die die eigene Gruppe sehen darf (Planung, Einsätze & Zeiten, Objekte & Kunden, Material & Fuhrpark, Finanzen, Verwaltung; einklappbar, mit Anheften), mit Symbolen und Zählern. Oben steht eine schlanke Kopfleiste mit Titel und Wochenwahl, Suche, „Zu erledigen“, „Woche planen“ und dem Menü „⋯“ (Veröffentlichen, Neu planen, Versenden, Daten, Darstellung, Abmelden). Der Inhalt besteht aus ruhigen Karten statt Rahmen, offene Einsätze sind rot gestrichelt umrandet und Feiertage nur leicht getönt. Auf Tablets zeigt die Seitenleiste nur Symbole, am Handy gibt es Kopfzeile und Leiste unten.

Das Cleanos-Design folgt den Gestaltungsregeln von www.cleanos.at:

| | Farbe | wofür |
|---|---|---|
| Cleanos-Blau | `#0C6CB4` | Knöpfe, Links, aktiver Bereich in der Seitenleiste |
| Cleanos-Grün | `#9CC654` | nur auf Dunkel (Markierung in der Nachtblau-Seitenleiste, Erfolg im Dunkelmodus); Grün auf Weiß ist als Schrift nicht lesbar |
| Nachtblau | `#0E2433` | Seitenleiste „Cleanos Nachtblau“, Flächen im Dunkelmodus |
| Text / Text leise | `#13232F` / `#4B5B67` | Schrift |
| Grün dunkel auf Hellgrün | `#4E7A1E` / `#EEF6E2` | „in Ordnung“, erledigt |
| Grauton / Linie | `#F3F6F8` / `#DDE5EA` | Hintergrund, Rahmen |

Die vier Werkzeuge bekommen beim Bauen dieselben Farben (ihre Dateien bleiben unverändert, siehe `werkzeuge/LIESMICH.md`). Schrift ist die Systemschrift (Segoe UI), Knöpfe haben 8 px Ecken und sind fett, Karten 12 px; Überschriften und Beschriftungen nie in Großbuchstaben oder gesperrt. Alle Textfarben sind auf Lesbarkeit geprüft (mindestens 4,5:1). Werte in `themes/cleanos.css`, Logo und PDF-Farben in `config.json` (brand).

**Darstellung je Person:** Über das Paletten-Symbol unten in der Seitenleiste oder „⋯ → Darstellung“ (am Handy „Mehr → Darstellung“) wählt jede Person für ihr Gerät:

- **Farbschema:** Cleanos (helle Seitenleiste wie die Website), Cleanos Nachtblau (Seitenleiste in Nachtblau), Cleanos Kontrast (kräftige Rahmen und dunklere Schrift, für Sonne am Handy). Es ist eine interne Cleanos App: Andere Farbschemata gibt es nicht (`brand.builtinThemes: false`); wer früher „Standard“, „Ruhig“ oder „Hoher Kontrast“ gewählt hatte, sieht wieder Cleanos.
- **Stil:** *Modern* (Voreinstellung): klar und ruhig wie ein gutes Web-Werkzeug – weiße Flächen, feine Linien, Cleanos-Blau als einzige Akzentfarbe, Bereiche mit eigener Symbolfarbe, Reiter als Umschalter, keine Verläufe oder Leuchteffekte; die Übersicht beginnt mit Cleo, dem Maskottchen, und den wichtigsten Zahlen. *Schlicht*: wie bisher. Beim Kontrast-Schema immer schlicht; bei „Bewegung reduzieren“ ohne Animation. Regeln der Website bleiben: keine Großbuchstaben oder Sperrschrift, Schrift mindestens 4,5:1.
- **Hell, dunkel oder wie das Gerät.**
- **Schriftgröße:** normal oder groß.

Die Voreinstellung für alle ist `brand.theme` in `config.json`; die Marken-Farbschemata und ihre Vorschau stehen in `brand.themes`.

**Überall im Cleanos-Design:** App, Einrichtungsseite, die vier Werkzeuge (Farben beim Bauen angeglichen), PDF-Wochenpläne und Auszahlungen (Tagesbänder in Cleanos-Blau getönt, Sonderleistungen in Cleanos-Grün dunkel, `brand.colors` mit `accentText` und `muted`), Schnee-Alarm (Seite „Bin wach“ mit Logo und Cleanos-Blau, Push mit dem App-Symbol, E-Mails als „Cleanos App – Winterdienst“). Rot für Vertretungen und die gelbe Summenzeile bleiben, weil sie eine feste Bedeutung haben. Der Name oben links und am Startbildschirm ist `brand.app` („Cleanos App“).

**Andere Marke:** `npm run theme -- https://www.firma.at` (oder `--logo … --primary … --accent …`) erzeugt `themes/<name>.css` mit einem wählbaren Farbschema und trägt es in `config.json` ein. Achtung: Mit dem Namen `cleanos` würde das von Hand nach den Gestaltungsregeln abgestimmte Cleanos-Theme überschrieben; zum Ausprobieren `--name test` verwenden.

## Technik

Reines HTML/JavaScript (ES-Module), ohne Framework und ohne eigenen Server. `npm start` liefert den Quellcode direkt aus. `npm run build` bündelt ihn mit esbuild zu wenigen minimierten Dateien mit Inhalts-Hash (4 statt rund 50 Anfragen, dauerhaft cachebar). Bibliotheken werden erst bei Bedarf geladen: MSAL.js (Anmeldung), ExcelJS (Excel), pdfmake (PDF) und JSZip (ZIP).
