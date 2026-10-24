# Konzept: Automatische Einsatzplanung für die Gebäudereinigung

Stand: Oktober 2026 · Grundlage: österreichisches Arbeitsrecht (AZG, ARG, KJBG)

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

## 4. Was der Prototyp schon kann

Der Prototyp in diesem Repository (`index.html`) zeigt das Konzept vollständig mit erfundenen Beispieldaten aus dem Raum Salzburg (KW 44/2026 mit Nationalfeiertag und Allerheiligen):

- Wochenübersicht (Mitarbeitende × Tage) mit offenen Einsätzen, Markierungen und Saldo
- Wochenzettel je Person im Excel-Layout, inkl. Kopieren für Excel
- Objektplan (Objekte × Tage) und Prüfbericht
- „Wer kann einspringen?“ mit Begründung je Person
- Einzeländerungen „nur diese Woche“ (Zeit, Tag, entfällt, Notiz)
- Stammdaten-Pflege, Regeln, betriebsfreie Tage, Datensicherung

Grenzen des Prototyps: Die Daten liegen nur im Browser, es gibt keine Benutzer, und die Fahrzeit ist pauschal.

## 5. Weg zum echten Tool

| Stufe | Inhalt |
|---|---|
| **1. Echtdaten-Test** (1–2 Wochen) | Bestehende Excel-Pläne einlesen (Objekte, Leistungen, Stammkräfte), eine echte Woche parallel planen, Regeln mit KV und Lohnverrechnung abgleichen |
| **2. Mehrbenutzer** | Server + Datenbank, Anmeldung für Disposition/Objektleitung, Änderungsprotokoll, Zeitkonto über Wochen hinweg (Saldo-Übertrag, 17-Wochen-Durchschnitt) |
| **3. Mitarbeiter-App** | Wochenplan am Handy (PWA), Push bei Änderungen, Krankmeldung/Urlaubsantrag, optional Zeiterfassung per Objekt-QR-Code |
| **4. Anbindungen** | Fahrzeiten aus echten Entfernungen, Export für die Lohnverrechnung (z. B. BMD, RZL, DPW), SharePoint/Teams |

Zu klären vor Stufe 2:

- **Kollektivvertrag** (Denkmal-, Fassaden- und Gebäudereinigung): genaue Zuschläge (Nacht, Sonntag, Mehrarbeit), Durchrechnungsmodelle
- **Fahrzeit**: Wann zählt sie als Arbeitszeit (zwischen Objekten immer, von zu Hause zum ersten Objekt?)
- **Feiertagsgutschrift**: Ausfallprinzip mit oder ohne Sonderleistungen
- **Betriebsrat**: Ein elektronisches Planungs-/Zeiterfassungssystem braucht in Österreich ggf. eine Betriebsvereinbarung (§ 96a ArbVG)
- **Datenschutz** (DSGVO): Krankenstände nur als „abwesend“ für die Disposition sichtbar

## 6. Bauen oder kaufen?

Allgemeine Dienstplan-Software (auch österreichische Anbieter) kann Schichten und Zeiterfassung, ist aber meist auf Schichtbetriebe ausgelegt (Gastro, Handel, Pflege). Die Reinigungs-Logik mit Stammobjekten, 14-tägigen Leistungen, Feiertagsregeln je Objekt, Vertretungen und dem Excel-Wochenzettel muss man dort oft mühsam nachbauen. Der Prototyp hilft in beiden Fällen: Entweder er wird weiterentwickelt, oder er dient als genaue Anforderungsliste für einen Anbietervergleich.
