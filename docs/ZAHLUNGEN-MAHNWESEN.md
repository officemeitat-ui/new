# Zahlungen & Mahnwesen – der Geldkreislauf

Ziel: **Geld schneller am Konto, ohne Excel-Liste und ohne peinliche Mahnung an Kunden, die längst
bezahlt haben.**

```
Rechnung stellen ──► PDF mit QR-Code ──► Versand per Outlook
        │
        ▼
Kunde scannt QR in der Banking-App (Betrag + Rechnungsnummer vorausgefüllt)
        │
        ▼
Kontoauszug importieren (CSV / CAMT.053 / MT940)
        │
        ├─► Rechnungsnummer erkannt ─────────────► Rechnung „bezahlt“ (auch Teil-/Sammelzahlung)
        ├─► bekannte IBAN + exakter Betrag ──────► Rechnung „bezahlt“
        ├─► Kundenname + exakter Betrag ─────────► Vorschlag (1 Klick)
        └─► Abbuchung ──► Beleg gefunden? ── nein ─► „Ausgaben ohne Beleg“ (für den Steuerberater)
        
Fällig + Kulanz ──► Zahlungserinnerung ──► 1. Mahnung ──► Letzte Mahnung ──► Anruf / Inkasso
                    (PDF + Rechnung, per Outlook, Ablage in Buchhaltung/Mahnungen)
```

## 1. QR-Code „Zahlen mit Code“

Jede gestellte Rechnung und jede Mahnung enthält einen **EPC-QR-Code** (Standard des European Payments
Council, in Österreich „Zahlen mit Code“ – George, Raiffeisen, Bank Austria, BAWAG, Volksbank, N26 …).
Der Kunde scannt ihn mit der Banking-App, IBAN, Empfänger, Betrag und Verwendungszweck sind ausgefüllt.

- Voraussetzung: gültige IBAN unter *Abrechnung → Firmendaten* (wird mit Prüfziffer kontrolliert).
- Verwendungszweck = „Rechnung 2026-0001“ → der Zahlungseingang wird später automatisch zugeordnet.

## 2. Kontoauszug importieren

*Abrechnung → Zahlungen & Mahnwesen → Kontoauszug importieren* (mehrere Dateien möglich, Doppelte werden
erkannt – du kannst also einfach immer „letzte 30 Tage“ exportieren).

| Bank / Format | Export |
|---|---|
| **George (Erste/Sparkasse)** | Umsätze → Export → CSV, bei George Business auch CAMT.053 |
| **Raiffeisen ELBA** | Umsätze → Export → CSV (auch ohne Kopfzeile) oder CAMT.053 / MT940 |
| **Bank Austria, BAWAG, Volksbank, Oberbank** | CSV oder CAMT.053 (ISO 20022) |
| **Alle Banken mit Business-Banking** | CAMT.053 (XML) – das genaueste Format (Auftraggeber, IBAN, Referenz) |

Erkannt werden Datum, Betrag (deutsches und englisches Zahlenformat, Vorzeichen vorne/hinten),
Auftraggeber, IBAN, Verwendungszweck/Zahlungsreferenz. Sammelbuchungen in CAMT werden aufgeteilt.

### Regeln für den Abgleich

| Situation | Ergebnis |
|---|---|
| Rechnungsnummer im Text (auch „RE 2026-0001“, „20260001“) | automatisch bezahlt; weniger = Teilzahlung, mehr = Hinweis „Überzahlung“ |
| mehrere Nummern, Summe passt | Sammelzahlung, alle bezahlt |
| bekannte IBAN (aus früheren Zuordnungen gelernt) + exakter Betrag | automatisch bezahlt |
| Kundenname im Auftraggeber + exakter Betrag | **Vorschlag** → „Übernehmen“ |
| Nummer einer bereits bezahlten Rechnung | Hinweis „Doppelzahlung?“ |
| nichts davon | „Zu prüfen“ → *Zuordnen* (Kunde wird vorausgewählt) oder *Ignorieren* |

Falsch zugeordnet? *Lösen* – die Rechnung ist wieder offen.

### Ausgaben ohne Beleg

Abbuchungen werden mit den Belegen (aus dem Postfach oder hochgeladen) verglichen: gleicher Betrag,
Datum ± 75 Tage, Lieferantenname bevorzugt. Was übrig bleibt, steht unter **„Ausgaben ohne Beleg“** –
die Liste, die der Steuerberater sonst am Quartalsende schickt. Abgaben (Finanzamt, SVS/ÖGK), Gehälter
und Bankspesen werden automatisch als „kein Beleg nötig“ markiert. Kommt der Beleg später, findet
*Neu abgleichen* (oder der nächste Import) ihn automatisch.

## 3. Mahnwesen

| Stufe | Standard | Inhalt |
|---|---|---|
| Zahlungserinnerung | 7 Tage nach Fälligkeit | freundlich, Rechnung nochmals im Anhang |
| 1. Mahnung | 21 Tage | klare Frist, Angebot zur Klärung |
| Letzte Mahnung | 35 Tage | Ankündigung weiterer Schritte |
| danach | – | Liste „alle Stufen ausgeschöpft“ → persönlich anrufen bzw. Inkasso |

- Zwischen zwei Stufen liegen mindestens 10 Tage (einstellbar).
- Jede Mahnung: **PDF im ME-IT-Design** mit Aufstellung (Rechnung, bereits bezahlt, Spesen, Zinsen) und
  QR-Code über den Gesamtbetrag, dazu die Original-Rechnung. Versand über dein Outlook-Postfach,
  Ablage in `Buchhaltung/Mahnungen/<Jahr>` (und SharePoint), Eintrag in den Aktivitäten.
- Texte, Fristen, Mahnspesen und Verzugszinsen pro Stufe in *Einstellungen Mahnwesen*.
- **Freigabe-Modus** (Standard): Vorschläge prüfen → *Senden* oder *Alle senden*.
- **Autopilot**: täglich ab 8 Uhr. Er läuft **nur**, wenn der letzte Kontoauszug höchstens 7 Tage alt ist
  und keine Zahlungseingänge ungeklärt sind – damit niemand gemahnt wird, der bezahlt hat.

### Rechtlicher Rahmen (Österreich, Stand 2026 – kein Rechtsrat)

- **B2B**: Verzugszinsen 9,2 Prozentpunkte über dem Basiszinssatz (§ 456 UGB), zusätzlich
  Pauschalentschädigung € 40 für Betreibungskosten (§ 458 UGB).
- **Verbraucher**: gesetzliche Zinsen 4 % p. a. (§ 1000 ABGB); Mahnspesen nur, wenn vereinbart und angemessen.
- Am besten Zahlungsbedingungen und Mahnspesen in den AGB/Rahmenvertrag aufnehmen.

## Kennzahlen

- **Offene Forderungen** und **Altersstruktur** (nicht fällig, 1–30, 31–60, > 60 Tage)
- **DSO** (Days Sales Outstanding): durchschnittliche Tage von Rechnung bis Zahlungseingang, letzte 180 Tage.
  Ziel für Managed-Services: unter 20 Tagen. Hebel: QR-Code, Versand am Monatsersten, SEPA-Lastschrift
  für Pauschalen.

## 4. SEPA-Lastschrift – Pauschalen pünktlich am Konto

Für Managed-Pauschalen und Lizenzen der beste Hebel gegen offene Posten: **kein Mahnen, kein Nachlaufen.**

```
Mandat (PDF aus dem Cockpit, vom Kunden unterschrieben) ──► im Kunden erfassen
        │
Rechnung stellen ──► „wird am TT.MM. per SEPA-Lastschrift eingezogen“ (= Vorabankündigung)
        │
Abrechnung → Zahlungen → „Einzugsdatei erstellen“ ──► pain.008-XML im Business-Banking hochladen
        │
Kontoauszug-Import: Sammel- oder Einzelgutschrift ──► Rechnungen „bezahlt“
        └─ Rücklastschrift (z. B. AM04 mangels Deckung, MD06 Widerspruch) ──► Rechnung wieder offen,
           Zahlungsart Überweisung (QR-Code), Mahnwesen übernimmt – oder „Erneut einziehen“
```

**Einmalig einrichten**
1. **Gläubiger-ID (Creditor Identifier)** kostenlos bei der Oesterreichischen Nationalbank beantragen
   (Format `AT..ZZZ...`), unter *Abrechnung → Firmendaten* eintragen (Prüfziffer wird kontrolliert).
2. Bei der Hausbank die **Lastschrift-Einreichung** für das Business-Banking freischalten lassen
   (George Business, ELBA, BusinessNet …) – inkl. Rahmen/Limit.
3. *Vorabankündigung (Tage)*: ohne Vereinbarung 14 Tage; in AGB/Mandat kann eine kürzere Frist
   (z. B. 5 Tage) vereinbart werden.
4. Dateiformat: **pain.008.001.08** (aktueller ISO-20022-Standard 2019), für ältere Banking-Software
   pain.008.001.02.

**Pro Kunde**
- *Mandatsformular (PDF)* drucken/senden – vorausgefüllt mit Gläubiger-ID und Mandatsreferenz,
  **CORE** (Basislastschrift, Kunde kann 8 Wochen widersprechen) oder **B2B** (Firmenlastschrift,
  kein Widerspruch, der Kunde muss das Mandat seiner Bank bestätigen).
- Nach Unterschrift *Mandat erfassen* (IBAN wird geprüft). Ab dann werden neue Rechnungen dieses Kunden
  automatisch zur Lastschrift vorgemerkt; ein neues Mandat ersetzt das alte, *Widerrufen* macht
  vorgemerkte Rechnungen wieder zu Überweisungsrechnungen.
- Original bzw. Scan des Mandats aufbewahren (Nachweispflicht des Zahlungsempfängers).

**Technik**
- Einzugstermin = Rechnungsdatum + Vorabankündigung, auf den nächsten TARGET2-Bankarbeitstag
  (Wochenende, Neujahr, Karfreitag, Ostermontag, 1. Mai, 25./26. Dezember werden übersprungen).
- Je Verfahren (CORE/B2B) und Sequenz (wiederkehrend `RCUR` / einmalig `OOFF`) ein Zahlungsblock;
  Namen und Texte werden auf den SEPA-Zeichensatz umgesetzt (ä → ae, & → +).
- Die Datei wurde gegen die offiziellen ISO-20022-Schemas pain.008.001.08 und .02 geprüft
  (Tests: `PAIN008_XSD=…/pain.008.001.08.xsd pytest tests/test_sepa.py`).
- E-Rechnung (ebInterface) enthält bei Lastschrift die Zahlungsart *SEPADirectDebit* mit Mandat und
  Einzugstermin.
- Solange eine Lastschrift vorgemerkt oder eingereicht ist, wird die Rechnung **nicht gemahnt**.
