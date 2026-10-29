# Prüfung der Regeln nach österreichischem Recht (Stand 29.10.2026, umgesetzt)

Abgeglichen wurden die Prüfungen und Berechnungen der App mit Arbeitszeitgesetz (AZG), Arbeitsruhegesetz (ARG), Kinder- und Jugendlichen-Beschäftigungsgesetz (KJBG), ASVG, EStG und dem Kollektivvertrag für Arbeiter/innen in der Denkmal-, Fassaden- und Gebäudereinigung (KV, gültig ab 1.1.2026). Alle Werte stehen in der App unter **Regeln & Feiertage** und lassen sich dort anpassen.

Das ist keine Rechtsberatung. Die Volltexte von KV und WKO konnten in dieser Prüfung nicht direkt geöffnet werden (Netzwerkfreigabe), die KV-Werte stammen aus Suchauszügen der Fundstellen unten. Die mit „prüfen“ markierten Punkte bitte mit der Lohnverrechnung oder der Wirtschaftskammer abstimmen.

## Stimmt

| Vorgabe | Rechtsgrundlage | App |
|---|---|---|
| Tägliche Ruhezeit 11 h | § 12 AZG | Verstoß unter 11 h, Fahrzeit nach dem letzten Einsatz zählt mit |
| Ruhepause 30 min bei mehr als 6 h | § 11 AZG | Hinweis ohne 30 min Pause oder Lücke |
| Höchstens 12 h am Tag, 60 h in der Woche | § 9 AZG | Verstoß darüber; Warnung über 10 h (nur als Überstunden) |
| Wochenruhe 36 h mit einem ganzen Tag | §§ 3, 4 ARG | Verstoß ohne 36 h und freien Tag |
| Feiertagsarbeit: Feiertagsentgelt **und** Entgelt für die Arbeit | § 9 Abs 1 und 5 ARG | Arbeitsstunden + 100 % Zuschlag (z. B. 1,5 h → 3 h) |
| Mehrarbeit Teilzeit 25 %, zuschlagsfrei bei Ausgleich 1:1 binnen 3 Monaten | § 19d Abs 3a, 3b AZG, KV | Mehrstunden-Konto mit 3-Monats-Frist |
| Überstundenzuschlag 50 % | § 10 AZG, KV | 50 %, Nacht 100 %, Sonntag 150 %, 11./12. Stunde 75 % (Sonntag 175 %) |
| Nachtzuschlag Normalarbeitszeit 21–6 Uhr, 50 % | KV § 10 | so gerechnet |
| Steuerfreie Überstundenzuschläge 2026: 15 Stunden, höchstens 170 € im Monat | § 68 Abs 2 iVm § 124b Z 440 EStG (ab 2027: 10 h, 120 €) | so eingestellt |
| KV-Stundenlöhne ab 1.1.2026 | Lohnordnung DFG 2026 | LG 1 15,12 · LG 2 13,30 · LG 3 12,99 · LG 4 13,03 · LG 5 12,73 · LG 6 12,37 € (die abweichenden 13,54 € für LG 2 sind der Wert ab 2027) |
| Jugendliche: 8 h am Tag, 40 h in der Woche, keine Überstunden | §§ 11, 12 KJBG | Verstoß darüber |
| Jugendliche: Ruhepause 30 min bei mehr als 4,5 h | § 15 KJBG | so geprüft |
| Jugendliche: Ruhezeit 12 h | § 16 KJBG | so geprüft |
| Jugendliche: Nachtruhe 20–6 Uhr, keine Sonn- und Feiertagsarbeit | §§ 17, 18 KJBG | Verstoß |

## Geändert

| Vorgabe | Rechtsgrundlage | vorher | jetzt |
|---|---|---|---|
| **Wochenfreizeit Jugendlicher:** zwei zusammenhängende freie Kalendertage, in die der Sonntag fällt (der Teil mit dem Sonntag mind. 43 h) | § 19 KJBG | nur die 36 h der Erwachsenen | eigene Prüfung: Samstag + Sonntag oder Sonntag + Montag frei, sonst Verstoß |
| **Nachtzuschlag-Hinweis** | KV § 10, § 12a AZG | zeigte 22–5 Uhr (AZG), Zuschlag gilt laut KV ab 21 Uhr | Hinweis und Wochenzettel mit 21–6 Uhr; ab 3 h zwischen 22 und 5 Uhr zusätzlich der Hinweis auf Nachtarbeitnehmer:innen (§ 12a AZG: regelmäßig an 48 Nächten im Jahr, dann Anspruch auf Untersuchung) |
| **Geringfügigkeitsgrenze in Euro** | § 5 Abs 2 ASVG: 2026 551,10 € im Monat | nur ein Stundenlimit je Person (falls eingetragen) | zusätzlich für „Geringfügig“: Stunden × Stundenlohn über 551,10 € = Verstoß (dann vollversichert). Grenze unter Regeln änderbar |
| **Mattenwechsel pro Gruppe** | – | nur Vollzugriff | eigene Rolle `mattenwechsel` über eine Microsoft-Gruppe; SharePoint „Bearbeiten“ auf `Mattenwechsel` und `Stammdaten` (Kundenstamm) |
| **Durchrechnung der Normalarbeitszeit** | KV (flexible Arbeitszeit): Betriebsvereinbarung oder schriftliche Vereinbarung; 35–45 h je Woche, Schnitt höchstens 40 h; bis 52 Wochen (Lohngruppe 2), sonst bis 26; Plan 2 Wochen vor Beginn bekannt; Zeitguthaben am Ende = Überstunden mit 50 % | jede Woche über 40 h = Überstunden | je Person (Vollzeit) unter *Mitarbeitende*: „Durchrechnung ab“ und „Wochen je Zeitraum“ (Zeiträume folgen lückenlos). Stunden bis 45 h bleiben Normalarbeitszeit; am Ende des Zeitraums wird ein Guthaben in *Überstunden & Auszahlung* als Überstunden (+50 %) abgerechnet, ein Minus bleibt im Zeitkonto. Planung: Hinweis aufs Guthaben, unter 35 h Hinweis auf die Bandbreite, über 45 h Überstunden-Warnung, Zeitraum länger als laut KV = Warnung |
| **Sonntagszuschlag 6–21 Uhr, Sonntag Nacht eigener Satz** | KV § 10 (Anhang A): Sonntagszuschläge für 6–21 Uhr; Sonntagsnacht Normalstunden 150 %, Überstunden 175 % | ganzer Sonntag 100 % | Sonntag 6–21 Uhr 100 %, davor und danach „Sonntag Nacht“ 150 % (Überstunden 175 %). Der Wochenzettel schreibt wie bisher 100 % als Zeit gut, der Rest der Sonntagsnacht kommt in Geld. Alle Zeiten und Sätze unter Regeln änderbar |
| **48 h im Schnitt über 17 Wochen** | § 9 Abs 4 AZG | nur Warnung über 48 h in einer Woche | echter Schnitt über 17 Wochen: geplante Wochen + veröffentlichte Vorwochen (das Veröffentlichen merkt sich ab jetzt die gearbeiteten Stunden). Unbekannte Wochen zählen mit 0, ein Verstoß wird also nie geraten |
| **Sonntagsarbeit nur mit Ausnahme** | § 3 ARG (Wochenendruhe ab Samstag 13 Uhr, unbedingt nötige Reinigung 15 Uhr), §§ 10–18 ARG, ARG-Verordnung, KV, Betriebsvereinbarung | Hinweis bei jedem Sonntagseinsatz | Grundlage einmal unter *Regeln* („Sonntagsarbeit erlaubt aufgrund“) oder je Objekt eintragen; ohne Grundlage Warnung bei jedem Sonntagseinsatz |

## Offen: bitte prüfen oder entscheiden

1. **Sonntag: Grundlage eintragen.** Unter *Regeln & Feiertage* bei „Sonntagsarbeit erlaubt aufgrund“ die Ausnahme eintragen, auf die ihr euch stützt (oder je Objekt). Bis dahin warnt die App bei jedem Sonntagseinsatz. Eine Betriebsvereinbarung nach § 12a ARG erlaubt Sonntagsarbeit höchstens an 4 Wochenenden im Jahr, nicht an 4 aufeinanderfolgenden.
2. **Durchrechnung eintragen**, wo es eine Vereinbarung gibt (bei der Person). Ohne Vereinbarung bleibt alles wie bisher.
3. **Feiertagsarbeit über die vereinbarte Tagesarbeitszeit hinaus:** In der KV-Fassung 2017 gab es dafür 50 % Zuschlag. Ob das 2026 noch gilt, ließ sich ohne den Volltext nicht bestätigen; nicht eingebaut.
4. **Lohngruppe 3 (Hotelreinigung):** Für sie nennt der KV eigene Sonntagssätze (ab 2027 Lohngruppe 3a/3b). Die App rechnet für alle Lohngruppen dieselben Sätze; falls ihr Hotelreinigung habt, bitte Bescheid geben.
5. **KV-Löhne 2027:** Ab 1.1.2027 neue Löhne und die Teilung der Lohngruppe 3 in 3a/3b (z. B. LG 1 15,76 €, LG 2 13,54 €). Im Jänner unter *Regeln* nachtragen.
6. **Monats-Soll für Wochenend-Kräfte:** Rechtlich muss bei Teilzeit Ausmaß und Lage vereinbart sein (§ 19d AZG); bei ungleicher Verteilung zählt der Schnitt. Monate mit fünf Wochenenden ergeben mehr Stunden: Die App führt das als Mehrarbeit im Mehrstunden-Konto (zuschlagsfrei, wenn binnen 3 Monaten ausgeglichen). Soll stattdessen ein festes Monats-Soll gelten, braucht es eine entsprechende Vereinbarung.
7. **Bewusst streng:** Die Pause muss in der App am Stück 30 min sein (das AZG erlaubt bei Bedarf 2 × 15 oder 3 × 10 min). Jugendliche dürfen in der App nie über 8 h (das KJBG erlaubt bei anderer Verteilung bis 9 h). Für Jugendliche unter 15 gelten 14 h Ruhezeit (nicht eingebaut, da nicht beschäftigt).
8. **Mängelfristen** in der Objektkontrolle sind kein Recht, sondern eure Vorgabe.
9. **Wörtliche Gegenprüfung:** Die KV-Sätze stammen aus Suchauszügen (WKO-, vida- und kollektivvertrag.at-Seiten waren in dieser Arbeitsumgebung nicht direkt abrufbar). Bitte die Werte unter *Regeln* einmal mit der Lohnverrechnung gegen den KV-Text halten.

## Fundstellen

- Kollektivvertrag und Lohnordnung DFG 2026: [WKO, Kollektivvertrag 2026](https://www.wko.at/kollektivvertrag/kollektivvertrag-denkmal-fassaden-gebaeudereinigung-2026), [WKO, Lohnordnung 2026](https://www.wko.at/kollektivvertrag/lohnordnung-denkmal-fassaden-gebaeudereinigung-2026), [WKO, flexible Arbeitszeit](https://www.wko.at/kollektivvertrag/flexible-arbeitszeit-denkmal-fassaden-gebaeudereinigung), [kollektivvertrag.at, Rahmen](https://www.kollektivvertrag.at/volltext?doc-set-id=SI-2111_de), [vida, Rahmen-KV 2026 (PDF)](https://www.vida.at/content/dam/vida/downloads/kv-vertr%C3%A4ge/geb%C3%A4udemanagement/2026/dfg/KV-Gebaeudemanagement-DFG-Rahmen-2026.pdf), [vida, Lohnvereinbarung 2026 (PDF)](https://www.vida.at/content/dam/vida/downloads/kv-vertr%C3%A4ge/geb%C3%A4udemanagement/LV-gebaeudemanagement-DFG-2026.pdf), [KV-Fassung 2017 (Nachtzuschlag)](https://wko.at/service/kollektivvertrag/denkmal-fassaden-gebaeudereiniger-arbeiter-2017.html), [KV 2025 (Sonntag 6–21 Uhr)](https://www.wko.at/kollektivvertrag/kollektivvertrag-denkmal-fassaden-gebaeudereinigung-2025), [KV 2022 (Sonntagsnacht)](https://www.wko.at/kollektivvertrag/kollektivvertrag-denkmal-fassaden-gebaeudereiniger-2022), [WKO, Bandbreite Gebäudereinigung](https://www.wko.at/arbeitszeit/arbeitszeit-denkmal-fassaden-gebaeudereinigung)
- KJBG: [§ 19 Wochenfreizeit](https://gesetzefinden.at/bundesrecht/bundesgesetze/kjbg/para-19), [§ 15 Ruhepausen](https://www.jusline.at/gesetz/kjbg/paragraf/15.pdf), [WKO Vorarlberg, Beschäftigung Jugendlicher](https://www.wko.at/vlbg/tourismus-freizeitwirtschaft/beschaeftigungjugendliche-3.pdf), [WKO, Jugendbeschäftigung](https://www.wko.at/oe/fitnessbetriebe/jugendbeschaeftigung-fitnessbetriebe.pdf)
- ARG: [§ 9 (RIS)](https://www.ris.bka.gv.at/eli/bgbl/1983/144/P9/NOR40243257), [USP, Arbeiten während der Wochenend- und Feiertagsruhe](https://www.usp.gv.at/mitarbeiter-und-gesundheit/urlaub-und-arbeitszeit/weitere-informationen-zu-urlaub-und-arbeitszeit/arbeiten-waehrend-der-wochenend-und-feiertagsruhe.html), [WKO, Ausnahmen von der Wochenendruhe](https://www.wko.at/arbeitszeit/arbeiten-wochenende-ausnahmen-wochenendruhe), [OGH 9 ObA 138/07w](https://gesetzefinden.at/judikatur/ogh/jjt_20080410_ogh0002_009oba00138_07w0000_000)
- Steuerfreie Überstunden 2026: [Forvis Mazars](https://www.forvismazars.com/at/de/unsere-expertise/outsourcing2/hr-payroll/blog-beitraege-personalverrechnung-arbeitsrecht/hoechstgrenze-fuer-steuerfreie-ueberstundenzuschlaege), [WKO](https://www.wko.at/steuern/steuerfreiheit-ueberstundenzuschlaege)
- Geringfügigkeitsgrenze 2026: [oesterreich.gv.at](https://www.oesterreich.gv.at/de/lexicon/G/Seite.990119), [AMS](https://www.ams.at/arbeitsuchende/topicliste/geringfuegigkeitsgrenze)
