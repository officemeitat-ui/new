# KI-Mitarbeiter: Angebot, Vertrieb, Fahrplan

Grundlage sind die Analyse von diekibetreuer.com (Website, AGB, AVV, Impressum, Stand November 2026)
und der „Skalierungs-Blueprint“ (Schröder Sales Solutions). Preisangaben Dritter stammen aus Anbieter-Blogs
und sind nur zur Orientierung gedacht.

## 1. Das Vorbild: Die KI Betreuer

| | |
|---|---|
| Firma | DIE KI-MA Betreuer GmbH, Wien (Unternehmensberatung, WKO-Fachgruppe IT-Beratung) |
| Angebot | „Individueller KI-Mitarbeiter, direkt bei dir vor Ort programmiert“, für regionale Kleinbetriebe |
| Stufen | KI-Praktikant (Anfragen ins CRM, E-Mails sortieren, Belege) · KI-Sachbearbeiter (E-Mail/Chat-Support, Interessenten qualifizieren, Unterlagen vor Terminen) · KI-Kundenmanager (24/7-Telefon, Termine, Bestandskunden anrufen, Angebote nachfassen) · KI-Abteilungsleiter (Recherche, Prozessberatung, Überwachung) |
| Vertrauen | Zuerst Entwürfe mit 1-Klick-Freigabe, später selbstständig |
| Vertrieb | Instagram/Facebook-Anzeigen → Video → kostenlose Potentialanalyse → Strategiegespräch → Einrichtung vor Ort |
| Abrechnung | Monatsabo für „CRM- und KI-Infrastruktur“ (SaaS), monatlich kündbar, über CopeCart/Stripe/GoHighLevel |
| Technik (laut AVV) | GoHighLevel (US), Vapi + ElevenLabs + Twilio (Telefon, US), Make/Zapier/n8n, Apollo.io. Ein KI-Anbieter fehlt in der AVV-Liste. |

**Schlussfolgerung:** Die Technik besteht aus Standard-Bausteinen. Der Wert liegt in Vertrieb, persönlicher Einrichtung
und laufender Betreuung. Angreifbar sind sie bei Datenschutz (fast alles auf US-Servern), Transparenz
(keine Preise) und rechtlich heiklen Funktionen (Anrufe bei Bestandskunden, Kaltakquise mit Apollo).

## 2. Unser Produkt

| KI-Mitarbeiter | Stand im Code | Nutzen für den Betrieb |
|---|---|---|
| Telefon-Assistent | fertig (Vapi-Anbindung, Terminbuchung, Rückrufe, Protokoll) | keine verpassten Anrufe, Termine rund um die Uhr |
| E-Mail-Assistent | fertig (Microsoft 365 mit Entwürfen direkt in Outlook, oder IMAP/SMTP; Einordnung, Ablage, Ausnahmen) | Postfach in Minuten statt Stunden |
| Belege-Ablage | fertig (Rechnungen aus dem Postfach erkennen und auslesen, Monatspaket für FreeFinance/Buchhaltung) | Monatsabschluss in Minuten, keine verlorenen Belege |
| Cockpit mit Wirkungszahlen | fertig | Kontrolle im Alltag |
| Monatsbericht (Seite, PDF, E-Mail) | fertig | Grundlage für Quartalsgespräch, Verlängerung und Ausbau |
| Kalender-Sync Google/Microsoft 365 | fertig | Assistent bucht direkt im Kalender, den der Betrieb schon nutzt |
| Terminbestätigung und -erinnerung (SMS/E-Mail) | fertig | weniger Kunden, die nicht erscheinen, weniger Rückfragen |
| Nachfass-Assistent (offene Anfragen) | fertig, Entwürfe zur Freigabe | mehr Abschlüsse aus bestehenden Anfragen |
| Bewertungsanfragen nach dem Termin | bewusst offen | nur mit Einwilligung zulässig; braucht einen Einwilligungs-Schritt bei der Buchung |
| WhatsApp-Assistent | fertig (Cloud API von Meta, Übergabe ans Team, Test-Chat) | bevorzugter Kanal vieler Kunden, sofortige Antworten |

**Abgrenzung zum Vorbild:** Preise transparent, Datenschutz offen dokumentiert, keine Werbeanrufe.
Das Cockpit zeigt dem Kunden jeden Monat schwarz auf weiß, was der KI-Mitarbeiter geleistet hat.

## 3. Preislogik (nach Blueprint: Preis nach Wirkung, wiederkehrender Umsatz)

- **Einrichtung + Monatspauschale**, kein Stundensatz. Wichtigste Kennzahl ist der monatlich wiederkehrende Umsatz (MRR).
- **Drei Pakete, zuerst das große als Anker zeigen:**
  - *Rundum*: Telefon + E-Mail + Nachfassen + CRM-Anbindung + monatliches Strategiegespräch
  - *Telefon*: Einstieg
  - *Telefon + Postfach*: die Mitte, die meist gewählt wird
- **Einstieg und Ausbau („Land & Expand“):** mit einem KI-Mitarbeiter starten, nach dem ersten Monatsbericht erweitern.
- **Orientierung am Markt** (Anbieterangaben): Telefon-Agent etwa 1.800–8.000 € Einrichtung, 100–300 €/Monat.
- **Unsere laufenden Kosten pro Kunde:**
  - Telefon: laut Vergleichen grob 0,08–0,40 $ pro Gesprächsminute, inklusive Telefonie, Spracherkennung, Stimme und KI.
  - E-Mail-Auswertung über Claude: wenige Cent je E-Mail. Im Pilotbetrieb messen.
- **ROI-Rechnung für das Angebotsgespräch** (Werte vom Kunden erfragen):
  verpasste Anrufe pro Woche × Anteil davon, der ein Auftrag geworden wäre × durchschnittlicher Auftragswert × 4,3
  plus eingesparte Stunden × Stundensatz. Das ergibt den monatlichen Nutzen, der mit der Pauschale verglichen wird.

## 4. Vertriebsprozess

1. **Leadkanal:** regionale Meta-Anzeigen auf die Potentialanalyse (`/termin`), dazu Netzwerk und Empfehlungen.
   Keine Kaltakquise per Telefon oder E-Mail ohne Einwilligung: § 174 TKG 2021 gilt auch für Firmen.
2. **Potentialanalyse (Diagnose, 15–30 Min.):** Anrufvolumen, verpasste Anrufe, E-Mail-Last, Terminprozess, Ziel.
   „Warum etwas ändern?“
3. **Vorführung (30–45 Min.):** Vorher das Betriebsprofil des Interessenten in `config/business.ts` eintragen.
   Im Termin ruft er **seinen eigenen** KI-Mitarbeiter an und bucht einen Termin. Das ist der Aha-Moment.
   Danach im Cockpit zeigen, was angekommen ist. „Warum wir?“
4. **Angebot (5–15 Min.):** Referenz → ROI-Rechnung → Timing → erst ganz am Ende der Preis. „Warum jetzt?“

## 5. Kundenbetreuung

- **Monatsbericht** (Cockpit → Bericht, automatisch per E-Mail am Monatsanfang): Anrufe, Termine, Rückrufwünsche, E-Mails,
  geschätzte Zeitersparnis, jeweils mit Vergleich zum Vormonat.
- **Quartalsgespräch** mit dem Inhaber: Was hat es gebracht, was ist der nächste KI-Mitarbeiter? Hier entsteht der Zusatzverkauf.
- **Warnsignale:** wenig Anrufe oder E-Mails, viele verworfene Entwürfe, viele Rückrufwünsche. Dann früh nachjustieren.

## 6. Rechtliches

- AI Act: Der KI-Mitarbeiter gibt sich am Telefon und im Chat als KI zu erkennen. Ist umgesetzt.
- DSGVO: AVV mit jedem Kunden. Dienstleister offenlegen (Anthropic, Vapi, Telefonie, Sprachdienst, Hosting).
  Drittlandtransfer prüfen. Die Datenschutzerklärung des Kunden muss den Telefon- und E-Mail-Assistenten nennen.
- Gesundheitsdaten (Praxen) nur nach gesonderter Prüfung.
- Gewerbe: mit der WKO klären, welche Berechtigung passt (IT-Dienstleistung oder Unternehmensberatung).
- AGB: Haftung begrenzen, KI-Fehler und Kontrollpflicht des Kunden regeln. Von einer Anwältin oder einem Anwalt erstellen lassen.

## 7. Fahrplan

| Wann | Was |
|---|---|
| Woche 1 | Konten anlegen (Vapi, Nummer, Anthropic, Hosting), Cockpit für den **eigenen Betrieb** live schalten und selbst nutzen |
| Woche 2 | Vorführ-Betriebsprofile für 2–3 Zielbranchen, Leitfaden für Potentialanalyse und ROI-Rechnung, AGB/AVV beauftragen |
| Woche 3–4 | 2–3 Pilotkunden zum Vorzugspreis gegen Video-Referenz, deren Google- oder Microsoft-Kalender anbinden |
| Monat 2–3 | Meta-Anzeigen starten, Preise schärfen, Bewertungsanfragen mit Einwilligung |

## Zweites Produkt: Arbeitsplatz für IT-Dienstleister

Entstanden aus dem eigenen Bedarf (Atera, Keeper, Microsoft 365, Windows): eine App für Handy und PC, die den Tag strukturiert –
Heute-Übersicht, Aufgaben statt To Do, Tickets mit KI-Zusammenfassung, Kundenakte und ein Assistent für Termine und E-Mail-Entwürfe.

- Zuerst im eigenen Betrieb einsetzen und messen (Zeit pro Ticket, offene Tickets, „wartet auf mich“).
- Laut Recherche ist KI-gestützte Ticket-Triage bei MSPs der häufigste Nutzen; genau das ist der nächste Ausbauschritt
  (automatische Einordnung neuer Tickets, Antwortentwürfe direkt in Atera, Wissensbasis aus gelösten Tickets).
- Danach als Paket für andere kleine IT-Dienstleister anbieten (gleiche Technik, eigene Installation je Kunde).
