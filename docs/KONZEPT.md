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

- **Feiertag**: Einsätze in geschlossenen Objekten werden durchgestrichen, die Stunden trotzdem angerechnet (Ausfallprinzip).
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
- Feiertagsregel: *entfällt* · *findet statt (mit Zuschlag)* · *auf nächsten Werktag verschieben*

**Mitarbeitende**: Beschäftigungsart (Vollzeit, Teilzeit, geringfügig, Lehrling), Wochenstunden (Soll), Monatslimit bei Geringfügigen, unter 18 (KJBG), Qualifikationen, eingeschult in Objekten, Verfügbarkeit je Wochentag.

**Abwesenheiten**: Urlaub, Krankenstand, Zeitausgleich, Pflegefreistellung.

**Kalender**: Gesetzliche Feiertage werden berechnet (inkl. Ostern, Pfingsten, Fronleichnam). Betriebsfreie Tage (24.12., 31.12., Hl. Rupert) lassen sich ergänzen.

### 3.2 Automatische Wochenplanung

1. **Einsätze erzeugen**: aus allen Leistungen für die Woche, inkl. 14-tägig und einmalig.
2. **Feiertage anwenden**: entfällt / findet statt / verschoben.
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

- **Durchgestrichen**: entfällt (Feiertag, Urlaub, Krankenstand). Die Stunden werden angerechnet, Sonderleistungen wahlweise nicht (wie bisher: 4 + 4 = 8 h statt 8,5 h).
- **Rot**: Vertretung oder verschoben. **Grün**: Sonderleistung.
- **Zuschlag**: Sonn-/Feiertag 100 % (einstellbar).
- **Fahrzeit**: 30 min zwischen zwei Objekten am selben Tag (einstellbar).
- **Gesamt**: Soll, Arbeitszeit, Fahrzeit, Saldo.

Export als Tabelle für Excel (Kopieren und Einfügen), später direkt als PDF oder in die Lohnverrechnung.

## 4. Was andere Tools bieten (Recherche Oktober 2026)

Untersucht wurden Branchenlösungen für Gebäudereiniger (PlanD, Profacilo, MR.Clean, A.S.E., CleanManager, cleaning pro, Miele MOVE Clean+, KleanApp, iQTrust), internationale Reinigungssoftware (Swept, Janitorial Manager, Aspire) und allgemeine Dienstplan-Tools (TimeTac, Aplano, Papershift, Shiftbase, Planday, Staffomatic, Quinyx, Connecteam, Microsoft Teams Shifts). Grundlage waren Herstellerseiten und Vergleichsportale. Die Angaben stammen von den Anbietern selbst und wurden nicht im Detail geprüft.

| Funktion | Wer bietet es | Im Dienstplan |
|---|---|---|
| Plan veröffentlichen, Änderungen markieren und mitteilen | Teams Shifts, TimeTac, Connecteam, PlanD | ✔ Veröffentlichen, „geändert“-Markierung, Änderungstexte zum Versenden |
| Vertretungs-Cockpit | PlanD | ✔ Ansicht „Vertretungen“ mit Vorschlägen, Abwesenheits-Assistent mit Sammelübergabe |
| Intervall-Leistungen (Grundreinigung, Glas, Teppich) | MR.Clean, Profacilo, PlanD | ✔ 14-tägig bis jährlich, mit Frist und Erinnerung |
| Soll-/Ist-Stunden je Objekt (Budget gegen Plan) | Profacilo, Janitorial Manager, Aspire, MR.Clean | ✔ Objekt-Controlling |
| Laufendes Zeitkonto, Resturlaub | Staffomatic, Shiftbase, TimeTac | ✔ Zeitkonto aus veröffentlichten Wochen, Urlaubsanspruch |
| Lohnexport (BMD, RZL) | TimeTac (BMD-Schnittstelle) | ✔ Monatsauswertung als CSV; Lohnarten-Zuordnung beim Import |
| Objektmappe (Anweisungen für Springer) | Swept, PlanD | ✔ im Einsatz-Dialog |
| Schlüsselverwaltung | MR.Clean, Profacilo, CleanManager, Miele | ✔ Schlüssel je Objekt, Regel „Schlüsselübergabe nötig“ |
| Tourenplanung / Fahrzeiten | MR.Clean, Profacilo, Swept | ✔ Fahrten je Einsatz planbar (Dauer + Notiz), Fahrzeit-Matrix, Zeitlinie je Tag (noch ohne Karte) |
| Prüfung nach österreichischem Arbeitsrecht | bei keinem Anbieter belegt | ✔ AZG, ARG, KJBG, Geringfügigkeit |
| Zeiterfassung im Objekt (NFC, QR, Geofence) | TimeTac, Miele, Swept, Connecteam | Ausbaustufe 2 |
| Alarm bei Nichterscheinen | Swept | Ausbaustufe 2 (setzt Zeiterfassung voraus) |
| Qualitätskontrolle, Reklamationen | KleanApp, iQTrust, Miele, Janitorial Manager | Ausbaustufe 3 |
| Mitarbeiter-App: offene Einsätze, Tausch | Teams Shifts, Papershift, Shiftbase, Planday | Ausbaustufe 2 |
| Objektkalkulation (m² × Leistungswert) | A.S.E., MR.Clean, Janitorial Manager | Ausbaustufe 3 |

Microsoft Teams Shifts lässt sich über die Graph-Shifts-API anbinden. Da der Dienstplan schon Microsoft Graph nutzt, ist das eine naheliegende nächste Erweiterung.

## 5. Was gebaut ist (Version 1.0)

- **Ablage in SharePoint** über Microsoft Graph, Anmeldung mit dem Microsoft-365-Konto. Daten als lesbare JSON-Dateien je Bereich und Woche, mit Versionsverlauf, Schutz vor gegenseitigem Überschreiben (eTag) und automatischem Zusammenführen.
- **Hosting** als statische Web-App auf `dienstplan.cleanos.at` (Azure Static Web Apps oder eigener Webspace), Anleitung in [EINRICHTUNG.md](EINRICHTUNG.md).
- **Ausgelegt für 35+ Mitarbeitende**: Reviere/Teams, Filter und Suche. Die Automatik plant rund 230 Einsätze in einer Zehntelsekunde.
- **Ansichten**:
  - Planung: Wochenübersicht, Zeitlinie, Wochenzettel, Objektplan, Vertretungen, Periodische Leistungen, Prüfbericht
  - Auswertung: Objekt-Controlling, Monatsauswertung
  - Stammdaten: Mitarbeitende, Objekte & Leistungen, Abwesenheiten (Kalender, Resturlaub), Regeln & Feiertage
- **Urlaub und Krankenstand mit Assistent**: Beim Eintragen (auch rückwirkend oder direkt aus einem Einsatz mit „Abwesend“) zeigt der Dienstplan sofort die betroffenen Einsätze und Stunden: betroffen, neu zu planen, schon vertreten. Fixobjekte lassen sich gesammelt an eine Person übergeben. Die Liste der Kandidat:innen ist danach sortiert, wer die meisten Stunden regelkonform übernehmen kann, und zeigt die Mehrstunden über den Vertrag. In Wochen, die noch nicht eingeteilt sind, rechnet der Vorschlag die eigenen Fixobjekte der Vertretung schon mit. Alternativ: automatisch verteilen, je Einsatz eine Vertretung wählen oder „entfällt“ (mit dem Kunden vereinbart).
- **Rückwirkende Änderungen**: Wird eine schon veröffentlichte Woche geändert (nachgereichte Krankmeldung, Vertretung nachgetragen), erscheint ein Hinweis „Rückwirkend geändert“. Mit „Korrektur buchen“ werden die neuen Salden ins Zeitkonto übernommen. Die Unterschiede je Person stehen in der Monatsauswertung unter „Nachträgliche Korrekturen“ für die Lohnverrechnung. Die abwesende Person bekommt ihre Stammeinsätze nach dem Ausfallprinzip angerechnet.
- **Periodische Leistungen**: Rhythmen wöchentlich, 14-tägig, alle 3/4 Wochen, monatlich (z. B. „1. Samstag“, „am 15.“, „Monatsletzter“), alle 2 Monate, quartalsweise, halbjährlich, jährlich, einmalig. Die Ansicht „Periodische Leistungen“ zeigt alle Termine nach Kategorie mit Status und Frist („zuteilen bis“). Ohne Stammkraft oder wenn die Stammkraft fehlt, muss der Termin spätestens 7 Tage vorher zugeteilt sein (einstellbar).
- **Zu erledigen**: Glocke mit Zähler und Popup beim Start, sobald es etwas Neues gibt: Abwesenheiten mit offenen Stunden, fällige periodische Leistungen, veröffentlichte Wochen mit Änderungen.
- **Fahrten einplanen**: Nach jedem Einsatz Dauer und eigene Notiz („Firmenauto, Schlüssel im Büro holen“), für diese Woche oder als Standard der Leistung. Ohne Eintrag gilt die Fahrzeit-Matrix bzw. Pauschale. Fahrten zählen als Arbeitszeit, stehen im Wochenzettel und in der Zeitlinie, und zu knappe Fahrten werden markiert.
- **Excel**: Import aus bestehenden Listen (Kopieren/Einfügen), Export der Wochenpläne im bisherigen Layout als .xlsx (gesamt und je Person, beim Veröffentlichen direkt nach SharePoint), Druck/PDF.
- **Rollen**: Disposition (bearbeiten) und Lesezugriff über `config.json`.
- **Erweiterbar**: Regeln, Ansichten, Ablagen und Design sind austauschbare Module, siehe [ERWEITERN.md](ERWEITERN.md).
- **Corporate Design** als Theme. Logo und Farben sind Platzhalter, bis die echten Cleanos-Vorgaben vorliegen.

## 6. Ausbaustufen

| Stufe | Inhalt |
|---|---|
| **1. Einführung** (jetzt) | Einrichtung SharePoint/Entra/Domain, Stammdaten aus Excel übernehmen, zwei Wochen parallel zum Excel planen, Regeln mit KV und Lohnverrechnung abgleichen |
| **2. Mitarbeiter-App** | Eigener Wochenplan am Handy (PWA), Push bei Änderungen, Urlaubsantrag, offene Einsätze übernehmen; Zeiterfassung per QR/NFC im Objekt. Braucht einen kleinen Server für Rechte je Person |
| **3. Qualität & Kalkulation** | Begehungen und Reklamationen, Objektkalkulation aus Flächen und Leistungswerten, Tourenplanung mit Karte |
| **4. Anbindungen** | Teams Shifts, BMD/RZL mit Lohnarten-Mapping, Fahrzeiten aus Adressen |

Zu klären:

- **Kollektivvertrag**: genaue Zuschläge (Nacht, Sonntag, Mehrarbeit), Durchrechnungsmodelle
- **Fahrzeit**: wann sie als Arbeitszeit zählt
- **Feiertagsgutschrift**: mit oder ohne Sonderleistungen
- **Betriebsvereinbarung**: § 96a ArbVG, falls es einen Betriebsrat gibt
- **Datenschutz**: Zugriff auf die SharePoint-Website nur für die Disposition

## Quellen der Recherche

softguide.de (A.S.E., MR.Clean, cleaning pro, PlanD, Profacilo, CleanManager, Tourenplanung), capterra.com.de (PlanD, Staffomatic), ki-syndikat.de (Profacilo, iQTrust, Aplano, Papershift), new.timetac.com (Gebäudereinigung, BMD-Integration), timetac.com (Schichtplanung), miele.de (MOVE Clean+), lexware.de (KleanApp), sweptworks.com, capterra.com (Swept), janitorialmanager.com, youraspire.com, lp.connecteam.com, getapp.de und shiftbase.com (Shiftbase), planday.com, docs.staffomatic.com, quinyx.com, support.microsoft.com und learn.microsoft.com (Teams Shifts, Graph-Shifts-Integration), absentify.com, rzlsoftware.at, whk-controlling.de (Kalkulation Reinigung).
