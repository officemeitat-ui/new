# Konzept: Automatische Einsatzplanung für die Gebäudereinigung

Stand: Oktober 2026 · Version 1.0 · Grundlage: österreichisches Arbeitsrecht (AZG, ARG, KJBG)

## 1. Ausgangslage

Heute wird pro Mitarbeiter:in und Woche ein Excel-Wochenplan geführt (SharePoint):

| Zeit | Objekt | Soll | Arbeitszeit | Fahrzeit |
|---|---|---|---|---|
| 08:30 - 12:30 | Objekt: … | | 4 | |
| … | | | | |
| **GESAMT** | Saldo | 40 | 39,5 | 0 |

Darin stecken bereits feste Regeln, die heute im Kopf und von Hand umgesetzt werden:

- **Feiertag**: Es wird gearbeitet, mit Feiertagszuschlag. Nur Einsätze in Objekten, die am Feiertag geschlossen sind, werden durchgestrichen, die Stunden trotzdem angerechnet (Ausfallprinzip).
- **Verschieben**: Ein Einsatz vom Feiertag wird auf den nächsten Tag gelegt (rot markiert).
- **Sonn-/Feiertagsarbeit** (z. B. Tankstelle) zählt mit 100 % Zuschlag: 1,5 h → 3 h.
- **Sonderleistungen** wie „Blumen gießen“ sind grün.
- **14-tägige Leistungen** fallen jede zweite Woche weg.
- **Vertretungen** bei Urlaub/Krankenstand werden rot eingetragen.
- **Fahrzeit** zwischen Objekten (meist 0,5 h) und **Pause** bei langen Einsätzen (10–16 Uhr = 5,5 h).
- Am Ende: **Soll** laut Vertrag, **Ist** (Arbeitszeit + Fahrzeit) und **Saldo**.

Das Problem: Jede Woche wird jeder Zettel neu kopiert und angepasst. Ruhezeiten, Höchstarbeitszeiten oder die Geringfügigkeitsgrenze prüft niemand systematisch, und Vertretungen sucht man im Kopf.

## 2. Die Idee in einem Satz

Einmal den **Stammplan** pflegen (welches Objekt, welche Leistung, wann, wer ist Stammkraft). Das Tool erzeugt daraus jede Woche automatisch alle Wochenzettel, berücksichtigt Feiertage, Urlaub und Krankenstand, sucht Vertretungen, die alle Regeln einhalten, und **markiert alles, was gegen Gesetz, Kollektivvertrag oder Vertrag verstößt**.

## 3. Bausteine

### 3.1 Stammdaten

**Objekte**: Name, Adresse, Farbe, „nur eingeschultes Personal“ (Schlüssel, Alarm, Hygiene).

**Leistungen** je Objekt (der eigentliche Stammplan):

- Bezeichnung und Art (Reinigung oder Sonderleistung)
- Rhythmus: Wochentage, jede/2./3./4. Woche, oder einmalig (Grundreinigung, Fenster)
- Uhrzeit, Anzahl Personen, benötigte Qualifikation
- Stammkraft (eine oder mehrere Personen)
- Feiertagsregel: *findet statt (mit Feiertagszuschlag)*, Standard · *auf nächsten Werktag verschieben* · *entfällt (Kunde geschlossen)*

**Mitarbeitende**: Beschäftigungsart (Vollzeit, Teilzeit, geringfügig, Lehrling), Wochenstunden (Soll), Monatslimit bei Geringfügigen, unter 18 (KJBG), Qualifikationen, eingeschult in Objekten, Verfügbarkeit je Wochentag.

**Abwesenheiten**: Urlaub, Krankenstand, Zeitausgleich, Pflegefreistellung.

**Kalender**: Gesetzliche Feiertage werden berechnet (inkl. Ostern, Pfingsten, Fronleichnam). Betriebsfreie Tage (24.12., 31.12., Hl. Rupert) lassen sich ergänzen.

### 3.2 Automatische Wochenplanung

1. **Einsätze erzeugen**: aus allen Leistungen für die Woche, inkl. 14-tägig und einmalig.
2. **Feiertage anwenden**: findet statt mit Zuschlag (Standard) / verschoben / entfällt, wenn der Kunde geschlossen hat. Betriebsfreie Tage schließen den Betrieb (einzelne Einsätze „trotzdem“).
3. **Stammkräfte einteilen**, sofern keine Regel verletzt wird.
4. **Vertretungen suchen**: Einsätze, deren Stammkraft fehlt, und Einsätze ohne Stammkraft. Die schwierigsten zuerst (z. B. wenn nur zwei Leute die Qualifikation „Hygienebereich“ haben). Bewertet wird nach Wochenstunden (wer hat noch Luft), Einschulung im Objekt, Nähe zu anderen Einsätzen am selben Tag und fairer Verteilung von Sonn- und Feiertagen.
5. **Reparatur**: Bleibt etwas offen, versucht das Tool, jemanden von einem anderen Einsatz freizuspielen.
6. Was danach noch offen ist, bleibt **rot offen**. Die Disposition entscheidet, das Tool zeigt mit „Wer kann einspringen?“ jede Person und die genauen Gründe.

Händische Entscheidungen werden **fixiert** und von der Automatik nicht mehr verändert.

### 3.3 Prüfregeln und Markierungen

| Farbe | Bedeutung | Beispiele |
|---|---|---|
| Rot | Verstoß | Ruhezeit < 11 h, > 12 h/Tag, > 60 h/Woche, keine 36 h Wochenruhe, Überschneidung, abwesend, Qualifikation fehlt, Geringfügigkeitsgrenze überschritten, Jugendliche nach 20 Uhr, Einsatz unbesetzt |
| Gelb | Prüfen | > 10 h/Tag, > 48 h/Woche, Mehr-/Überstunden über Vertrag, außerhalb der Verfügbarkeit, nicht eingeschult, Fahrzeit reicht nicht |
| Violett | Hinweis | Nacht-, Sonn- oder Feiertagsarbeit (Zuschläge) |

Rechtsgrundlagen (alle Werte änderbar):

- **Tägliche Ruhezeit** 11 h (§ 12 AZG). Geteilte Dienste (früh + abends) sind am selben Tag erlaubt, aber Abenddienst bis 21:30 und Frühdienst um 6:00 am nächsten Tag ergibt nur 8,5 h Ruhe und wird markiert. Das ist in der Reinigung der häufigste Fehler.
- **Höchstarbeitszeit** 12 h/Tag, 60 h/Woche, im Schnitt 48 h über 17 Wochen (§ 9 AZG). Fahrzeit zählt mit.
- **Ruhepause** 30 min ab mehr als 6 h (§ 11 AZG), wird automatisch abgezogen.
- **Wochenruhe** 36 h inkl. eines ganzen Tages (§§ 3, 4 ARG).
- **Nachtarbeit** 22–5 Uhr (§ 12a AZG).
- **Jugendliche** (KJBG): max. 8 h/Tag, 40 h/Woche, 12 h Ruhezeit, keine Arbeit 20–6 Uhr, keine Sonn-/Feiertage.
- **Teilzeit-Mehrstunden**: Hinweis auf den möglichen 25-%-Zuschlag (§ 19d AZG).
- **Geringfügig**: Monatslimit in Stunden je Person (aus Stundenlohn und aktueller Geringfügigkeitsgrenze).

### 3.4 Wochenzettel und Saldo

Der Wochenzettel sieht aus wie der bisherige Excel-Plan:

- **Durchgestrichen**: entfällt (Urlaub, Krankenstand, Kunde am Feiertag geschlossen). Die Stunden werden angerechnet, Sonderleistungen wahlweise nicht (wie bisher: 4 + 4 = 8 h statt 8,5 h).
- **Rot**: Vertretung oder verschoben. **Grün**: Sonderleistung.
- **Zuschlag**: Sonn-/Feiertag 100 % (einstellbar): Feiertagsarbeit = Feiertagsentgelt + Entgelt für die Arbeit (ARG § 9).
- **Fahrzeit**: 30 min zwischen zwei Objekten am selben Tag (einstellbar).
- **Gesamt**: Soll, Arbeitszeit, Fahrzeit, Saldo.

Export als Tabelle für Excel (Kopieren und Einfügen), später direkt als PDF oder in die Lohnverrechnung.

## 4. Was andere Tools bieten (Recherche Oktober 2026)

Untersucht wurden Branchenlösungen für Gebäudereiniger (PlanD, Profacilo, MR.Clean, A.S.E., CleanManager, cleaning pro, Miele MOVE Clean+, KleanApp, iQTrust), internationale Reinigungssoftware (Swept, Janitorial Manager, Aspire) und allgemeine Dienstplan-Tools (TimeTac, Aplano, Papershift, Shiftbase, Planday, Staffomatic, Quinyx, Connecteam, Microsoft Teams Shifts). Grundlage waren Herstellerseiten und Vergleichsportale. Die Angaben stammen von den Anbietern selbst und wurden nicht im Detail geprüft.

| Funktion | Wer bietet es | Im Dienstplan |
|---|---|---|
| Plan veröffentlichen, Änderungen markieren und mitteilen | Teams Shifts, TimeTac, Connecteam, PlanD | ✔ Veröffentlichen, „geändert“-Markierung, PDF je Person per E-Mail/WhatsApp mit Versandstand |
| Drag & Drop im Plan mit Konfliktanzeige | Planday, Shiftbase, Papershift | ✔ Ziehen mit Ampel, Rückgängig; am Handy Tauschen per Fingertipp |
| Planen am Handy (App) | Planday, Shiftbase, Papershift, Teams Shifts | ✔ eigene Handy-Ansicht, installierbar als App |
| Vertretungs-Cockpit | PlanD | ✔ Ansicht „Vertretungen“ mit Vorschlägen, Abwesenheits-Assistent mit Sammelübergabe |
| Intervall-Leistungen (Grundreinigung, Glas, Teppich) | MR.Clean, Profacilo, PlanD | ✔ 14-tägig bis jährlich, mit Frist und Erinnerung |
| Soll-/Ist-Stunden je Objekt (Budget gegen Plan) | Profacilo, Janitorial Manager, Aspire, MR.Clean | ✔ Objekt-Controlling |
| Laufendes Zeitkonto, Resturlaub | Staffomatic, Shiftbase, TimeTac | ✔ Zeitkonto aus veröffentlichten Wochen, Urlaubsanspruch |
| Lohnexport (BMD, RZL) | TimeTac (BMD-Schnittstelle) | ✔ Monatsauswertung als CSV; Lohnarten-Zuordnung beim Import |
| Objektinfo (Anweisungen für Springer) | Swept, PlanD | ✔ im Einsatz-Dialog |
| Schlüsselverwaltung | MR.Clean, Profacilo, CleanManager, Miele | ✔ Schlüssel je Objekt, Regel „Schlüsselübergabe nötig“ |
| Tourenplanung / Fahrzeiten | MR.Clean, Profacilo, Swept | ✔ Fahrten je Einsatz planbar (Dauer + Notiz), Fahrzeit-Matrix, Zeitlinie je Tag (noch ohne Karte) |
| Prüfung nach österreichischem Arbeitsrecht | bei keinem Anbieter belegt | ✔ AZG, ARG, KJBG, Geringfügigkeit |
| Zeiterfassung im Objekt (NFC, QR, Geofence) | TimeTac, Miele, Swept, Connecteam | umgesetzt mit QR-Code bzw. NFC (ohne Geofence) |
| Alarm bei Nichterscheinen | Swept | umgesetzt (Push ans Büro und an die Person) |
| Qualitätskontrolle, Reklamationen | KleanApp, iQTrust, Miele, Janitorial Manager | Ausbaustufe 3 |
| Mitarbeiter-App: eigener Plan, Anträge, Krankmeldung | Teams Shifts, Papershift, Shiftbase, Planday | umgesetzt (Plan am Handy) |
| Mitarbeiter-App: offene Einsätze übernehmen (Einsatzbörse) | Teams Shifts, Papershift, Shiftbase, Planday | umgesetzt (Plan am Handy) |
| Mitarbeiter-App: Tausch | Teams Shifts, Papershift, Shiftbase, Planday | Ausbaustufe 2 |
| Objektkalkulation (m² × Leistungswert) | A.S.E., MR.Clean, Janitorial Manager | Ausbaustufe 3 |

Microsoft Teams Shifts lässt sich über die Graph-Shifts-API anbinden. Da der Dienstplan schon Microsoft Graph nutzt, ist das eine naheliegende nächste Erweiterung.

## 5. Was gebaut ist (Version 1.0)

- **Ablage in SharePoint** über Microsoft Graph, Anmeldung mit dem Microsoft-365-Konto. Daten als lesbare JSON-Dateien je Bereich und Woche, mit Versionsverlauf, Schutz vor gegenseitigem Überschreiben (eTag) und automatischem Zusammenführen.
- **Hosting** als statische Web-App auf `app.cleanos.at` (Azure Static Web Apps oder eigener Webspace), Anleitung in [EINRICHTUNG.md](EINRICHTUNG.md).
- **Ausgelegt für 35+ Mitarbeitende**: Reviere/Teams, Filter und Suche. Die Automatik plant rund 230 Einsätze in einer Zehntelsekunde.
- **Ansichten**:
  - Planung: Wochenübersicht, Zeitlinie, Wochenzettel, Objektplan, Vertretungen, Periodische Leistungen, Müllplan, Prüfbericht
  - Auswertung: Objekt-Controlling, Monatsauswertung, Überstunden & Auszahlung
  - Stammdaten: Mitarbeitende, Objekte & Leistungen (Reinigungsplan), Zuweisung (Stammkräfte), Abwesenheiten (Kalender, Resturlaub), Regeln & Feiertage
- **Alle Geräte**: PC, Tablet und Handy mit vollem Funktionsumfang. Handy-Ansicht mit Tagesliste, Leiste unten (Woche, Vertretung, ＋ Abwesend, Wochenzettel, Menü), Dialogen als Blatt von unten und Tabellen als Karten. Tauschen per Fingertipp statt Ziehen. Installierbar als App (PWA) mit Symbol aus dem Logo; startet schneller und gleicht beim Zurückwechseln sofort ab.
- **Ablauf-Leiste**: führt durch jede Woche (Einteilen → Offene Einsätze → Prüfen → Veröffentlichen → Versenden) und zeigt immer den nächsten sinnvollen Klick.
- **Ziehen und Ablegen, Rückgängig**: Einsätze in der Wochenübersicht auf eine andere Person ziehen, mit Ampel während des Ziehens. Jede Planänderung lässt sich zurücknehmen (Knopf in der Meldung oder Strg+Z).
- **Begründete Vorschläge**: Die Automatik bewertet jede Person nachvollziehbar: Stammkraft, freie Vertragsstunden, Zeitkonto (Minusstunden zuerst auffüllen), Revier, Einschulung, wer das Objekt aus den letzten Wochen kennt, Anschluss an andere Einsätze. Dieselben Gründe stehen als Text beim Vorschlag.
- **PDF-Wochenpläne und Versand**: je Person eine A4-Seite im Excel-Layout mit Objektadressen, Hinweisen für Vertretungen und Zeitkonto. Versand per E-Mail (Microsoft 365, mit PDF-Anhang), „Teilen“ am Handy (WhatsApp) oder als Sammel-PDF/ZIP; Versandstand je Person, nach Änderungen wieder „zu versenden“.
- **Anmeldeschutz für die ganze Seite**: Auf Azure Static Web Apps wird jede Datei nur nach Microsoft-Anmeldung im eigenen Tenant ausgeliefert. Die App übernimmt die Anmeldung für SharePoint ohne zweite Eingabe.
- **Urlaub und Krankenstand mit Assistent**: Beim Eintragen (auch rückwirkend oder direkt aus einem Einsatz mit „Abwesend“) zeigt der Dienstplan sofort die betroffenen Einsätze und Stunden: betroffen, neu zu planen, schon vertreten. Fixobjekte lassen sich gesammelt an eine Person übergeben. Die Liste der Kandidat:innen ist danach sortiert, wer die meisten Stunden regelkonform übernehmen kann, und zeigt die Mehrstunden über den Vertrag. In Wochen, die noch nicht eingeteilt sind, rechnet der Vorschlag die eigenen Fixobjekte der Vertretung schon mit. Alternativ: automatisch verteilen, je Einsatz eine Vertretung wählen oder „entfällt“ (mit dem Kunden vereinbart).
- **Rückwirkende Änderungen**: Wird eine schon veröffentlichte Woche geändert (nachgereichte Krankmeldung, Vertretung nachgetragen), erscheint ein Hinweis „Rückwirkend geändert“. Mit „Korrektur buchen“ werden die neuen Salden ins Zeitkonto übernommen. Die Unterschiede je Person stehen in der Monatsauswertung unter „Nachträgliche Korrekturen“ für die Lohnverrechnung. Die abwesende Person bekommt ihre Stammeinsätze nach dem Ausfallprinzip angerechnet.
- **Periodische Leistungen**: Rhythmen wöchentlich, 14-tägig, alle 3/4 Wochen, monatlich (z. B. „1. Samstag“, „am 15.“, „Monatsletzter“), alle 2 Monate, quartalsweise, halbjährlich, jährlich, einmalig. Die Ansicht „Periodische Leistungen“ zeigt alle Termine nach Kategorie mit Status und Frist („zuteilen bis“). Ohne Stammkraft oder wenn die Stammkraft fehlt, muss der Termin spätestens 7 Tage vorher zugeteilt sein (einstellbar).
- **Reinigungsplan → Zuweisung**: Der Reinigungsplan je Objekt (Leistung, Rhythmus, Zeit, Personen, Qualifikation) ist die Grundlage. In „Zuweisung“ bekommt jede Leistung ihre Stammkraft. Harte Bedingungen: Verfügbarkeit an allen Tagen der Leistung, Qualifikation, keine Überschneidung mit anderen Stammeinsätzen (14-tägige in verschiedenen Wochen zählen nicht), Fahrzeit zwischen Objekten, Jugendschutz, Geringfügigkeitsgrenze. Danach Rangfolge: freie Vertragsstunden (Durchschnitt pro Woche), keine Überstunden, eigenes Revier, eingeschult, betreut das Objekt schon, Anschluss an einen Einsatz in der Nähe. „Alle Vorschläge übernehmen“ verteilt die offenen Leistungen ohne Doppelbelegung (schwierigste zuerst). Umgekehrt geht es von der Person aus: Klick auf den Namen öffnet ihren Dienstplan mit einer Objekt-Auswahl; Leistungen dauerhaft, statt einer anderen Person oder nur für eine Woche zuweisen. Die Wochenplanung teilt danach die Stammkräfte ein.
- **Müllplanung**: Je Objekt Abfuhrtage der Tonnen als Rhythmus (wöchentlich, 14-tägig, alle 3/4 Wochen, monatlich) oder als Termine aus dem Abfuhrkalender der Gemeinde (.ics-Datei oder eingefügte Liste, die Art der Tonne wird aus dem Text erkannt). Einstellbar: rausstellen am Vorabend oder in der Früh, wieder reinstellen, Minuten je Gang, wer eigene Gänge übernimmt, Hinweis (z. B. Müllraum). Die Automatik hängt jeden Gang an einen Einsatz, der zur passenden Zeit ohnehin im Objekt stattfindet (Vorabend: 12–24 Uhr, Früh: bis 8 Uhr, Reinstellen: ab 9 Uhr; nur Einsätze mit einer Person). Die Person erledigt es mit, Ende und Arbeitszeit verlängern sich um die Minuten. Passt kein Einsatz, entsteht ein eigener kurzer Gang, den die Automatik besetzt (verfügbare Stammkraft des Objekts, sonst bevorzugt, wer an dem Tag schon dort ist). Abfuhrtermine laut Rhythmus, die auf einen Feiertag fallen, rücken auf den nächsten Werktag. Gänge stehen im Wochenzettel und im PDF, eigene Gänge lassen sich wie jeder Einsatz verschieben oder absagen.
- **Überstunden & Auszahlung** (AZG §§ 3, 4, 10, 19d; KV Denkmal-, Fassaden- und Gebäudereinigung, Arbeiter/innen, ab 1.1.2026): Je Woche und Person werden die Stunden eingeordnet. Was über die tägliche Normalarbeitszeit (9 h) hinausgeht, sind Überstunden, ab der 11. Stunde mit eigenem Satz. Der Rest wird chronologisch verteilt, angerechnete Stunden (Urlaub, Krankenstand, Feiertag) zuerst: bis zum Vertrag Normalstunden, bis 40 h Mehrarbeit, darüber Überstunden. Fahrzeit zählt mit. Jede Minute bekommt eine Zeitklasse (Feiertag, Sonntag, Nacht 21–6 Uhr, Tag), daraus ergibt sich der Satz laut KV (Überstunden 50/100/150/100 %, 11./12. Stunde 75/125 %, Nacht 50 %, Mehrarbeit 25 %). Mehrarbeit kommt in ein Mehrstunden-Konto: Minusstunden gleichen sie 1:1 aus (älteste zuerst, nur innerhalb von 3 Monaten), danach ist sie mit 25 % fällig. Je Person und Monat: auszahlen, Zeitausgleich 1:1,5 oder 1:1 + Zuschlag in Geld. Der Monatsabschluss bucht ausbezahlte Stunden aus dem Zeitkonto und hält die Beträge fest. Steuerhinweis § 68 Abs. 2 EStG (2026: 15 h, 170 €). Berücksichtigt werden nur Wochen, die eingeteilt oder veröffentlicht sind. Die Auszahlungen gehen gesammelt per E-Mail an die Lohnverrechnung (wer bekommt wie viel, PDF und CSV) und auf Wunsch einzeln an jede Person, mit Versandstand.
- **Zu erledigen**: Glocke mit Zähler und Popup beim Start, sobald es etwas Neues gibt: Abwesenheiten mit offenen Stunden, fällige periodische Leistungen, veröffentlichte Wochen mit Änderungen.
- **Fahrten einplanen**: Nach jedem Einsatz Dauer und eigene Notiz („Firmenauto, Schlüssel im Büro holen“), für diese Woche oder als Standard der Leistung. Ohne Eintrag gilt die Fahrzeit-Matrix bzw. Pauschale. Fahrten zählen als Arbeitszeit, stehen im Wochenzettel und in der Zeitlinie, und zu knappe Fahrten werden markiert.
- **Excel**: Import aus bestehenden Listen (Kopieren/Einfügen), Export der Wochenpläne im bisherigen Layout als .xlsx (gesamt und je Person, beim Veröffentlichen direkt nach SharePoint), Druck/PDF.
- **Rollen** über Microsoft-Gruppen: jede Gruppe sieht nur ihre Bereiche, SharePoint-Ordner je Berechtigung (siehe [PLATTFORM.md](PLATTFORM.md)).
- **Erweiterbar**: Regeln, Ansichten, Ablagen und Design sind austauschbare Module, siehe [ERWEITERN.md](ERWEITERN.md).
- **Corporate Design**: interne Cleanos App, Farben und Formen nach www.cleanos.at (`themes/cleanos.css`), nur Cleanos-Farbschemata (hell, Nachtblau, Kontrast; je hell und dunkel), auch Werkzeuge, PDFs und Schnee-Alarm.
- **Wetter & Winterdienst**: Vorhersage und Warnungen von GeoSphere Austria, Winterdienst per Klick, Schnee-Alarm (weckt das Team per Push, Eskalation, wöchentlicher Wechsel der Bereitschaft) und Winterdienst-Protokoll als Nachweis (am Handy mit Fotos, PDF je Monat); siehe [PLATTFORM.md](PLATTFORM.md).

## 5a. Plattform mit Modulen

Seit Oktober 2026 laufen Wasserzähler-Ablesung, Objektkontrolle, Objektdokumentation und Mattenwechsel als eigene Werkzeuge unverändert in der App: eine Anmeldung, Rollen aus Entra ID, jedes Werkzeug mit seinen Daten in seinem SharePoint-Ordner. Wie die Rollen eingerichtet werden: [PLATTFORM.md](PLATTFORM.md).

## 6. Ausbaustufen

| Stufe | Inhalt |
|---|---|
| **1. Einführung** (jetzt) | Einrichtung SharePoint/Entra/Domain, Stammdaten aus Excel übernehmen, zwei Wochen parallel zum Excel planen, Regeln mit KV und Lohnverrechnung abgleichen |
| **2. Mitarbeiter-App** | **Seit November 2026:** eigener Wochenplan am Handy über einen persönlichen Link (ohne Anmeldung, `mein-plan.php` am Webspace), Push bei neuen und geänderten Wochen, Urlaubs-, Zeitausgleichs- und Pflegefreistellungsantrag, Krankmeldung; im Büro unter „Zu erledigen“ eintragen, genehmigen oder ablehnen; Einsatzbörse (offene Einsätze an alle, die sie laut Regeln übernehmen dürfen, „Ich übernehme“ → „Einteilen“). Zeiterfassung per QR-Code im Objekt (NFC mit derselben Adresse) mit Ist-Zeiten und Alarm bei Nichterscheinen. Offen: Tausch zwischen Kolleg:innen |
| **3. Qualität & Kalkulation** | Begehungen (eigenes Werkzeug Objektkontrolle), Leistungsverzeichnis (eigenes Werkzeug Objektdoku), Zählerablesung (eigenes Werkzeug Wasserzähler), Mattenwechsel mit Touren (eigenes Werkzeug), alle in der App eingebunden; offen: Reklamationen, Objektkalkulation aus Flächen und Leistungswerten |
| **4. Anbindungen** | Teams Shifts, BMD/RZL mit Lohnarten-Mapping, Fahrzeiten aus Adressen |

Zu klären:

- **Kollektivvertrag**: Zuschlagssätze sind aus dem KV 2026 vorbelegt; mit der Lohnverrechnung abgleichen, v. a. Sonntag/11.–12. Stunde, Lohngruppe 3 (eigene Sonntagssätze) und ob die tägliche Normalarbeitszeit 9 oder 10 h ist. Die Durchrechnung (flexible Arbeitszeit laut KV) ist je Person einstellbar (siehe [RECHTSPRUEFUNG.md](RECHTSPRUEFUNG.md))
- **Fahrzeit**: wann sie als Arbeitszeit zählt
- **Feiertagsgutschrift**: mit oder ohne Sonderleistungen
- **Betriebsvereinbarung**: § 96a ArbVG, falls es einen Betriebsrat gibt
- **Datenschutz**: Zugriff auf die SharePoint-Website nur für die Disposition; mit den Modulen Rechte je Ordner (siehe [PLATTFORM.md](PLATTFORM.md)), Krankenstände und Stundenlöhne nur für Disposition und Lohnverrechnung

## Quellen der Recherche

softguide.de (A.S.E., MR.Clean, cleaning pro, PlanD, Profacilo, CleanManager, Tourenplanung), capterra.com.de (PlanD, Staffomatic), ki-syndikat.de (Profacilo, iQTrust, Aplano, Papershift), new.timetac.com (Gebäudereinigung, BMD-Integration), timetac.com (Schichtplanung), miele.de (MOVE Clean+), lexware.de (KleanApp), sweptworks.com, capterra.com (Swept), janitorialmanager.com, youraspire.com, lp.connecteam.com, getapp.de und shiftbase.com (Shiftbase), planday.com, docs.staffomatic.com, quinyx.com, support.microsoft.com und learn.microsoft.com (Teams Shifts, Graph-Shifts-Integration), absentify.com, rzlsoftware.at, whk-controlling.de (Kalkulation Reinigung).
