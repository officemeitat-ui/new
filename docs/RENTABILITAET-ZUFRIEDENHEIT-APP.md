# Rentabilität, Wertsicherung, Kundenzufriedenheit, Stoppuhr & App

## Rentabilität je Kunde (*Wachstum → Rentabilität & Preise*)

Die wichtigste Frage für ein Managed-Service-Geschäft: **Welcher Kunde verdient Geld – und welcher kostet welches?**

| Kennzahl | Berechnung (letzte 12 Monate) |
|---|---|
| Umsatz | gestellte Rechnungen netto (gibt es noch keine Rechnungen im Cockpit: Monatspauschale × 12, markiert mit *) |
| Aufwand | gebuchte Zeit **plus Fernwartung ohne Zeitbuchung** aus dem Splashtop-Protokoll (markiert mit °) |
| Kosten | Aufwand × interner Kostensatz (Gehalt, Nebenkosten, Gemeinkosten; Standard 55 €/h) + Lizenz-Einkauf |
| Deckungsbeitrag | Umsatz − Kosten, in € und % |
| Effektiver Stundensatz | (Umsatz − Lizenz-Einkauf) ÷ Stunden – der ehrliche Preis, den der Kunde pro Stunde zahlt |

Bewertung: **kritisch** (DB < 15 % oder Stundensatz < 1,2 × Kostensatz), **ok**, **gut** (DB ≥ 40 %).
Konkrete Empfehlungen: Pauschale anpassen (mit Vorschlag), Ursachen vieler Tickets beheben,
Kunden „auf Zuruf“ mit viel Aufwand auf ein Managed-Paket bringen, ungebuchte Fernwartung nachbuchen.
Kostensatz und Ziel-Stundensatz sind einstellbar.

## Wertsicherung (VPI)

Österreichische Betreuungsverträge enthalten üblicherweise eine Wertsicherungsklausel auf Basis des
**Verbraucherpreisindex (VPI 2020, Statistik Austria)**:

1. Beim Kunden „Wertsicherung vereinbart“ ankreuzen und den **Basismonat** eintragen (Vertragsbeginn bzw.
   letzte Anpassung; optional der Basiswert).
2. Unter *Rentabilität & Preise → Wertsicherung* monatlich den aktuellen VPI-Wert eintragen.
3. Ist die Veränderung ≥ Schwelle (Standard 3 %), steht der Kunde auf „anpassen“ – mit neuer Pauschale.
4. **Anpassung durchführen**: Stichtag (Monatserster) wählen → die neue Pauschale gilt ab diesem Monat im
   Rechnungslauf, das Ankündigungsschreiben entsteht als PDF im ME-IT-Design (Kundenordner/SharePoint)
   und geht optional per Mail hinaus. Neue Basis = erreichter Indexwert; im MRR-Verlauf als
   „indexanpassung“ sichtbar (NRR).

Hinweis: Die Indexwerte werden nicht automatisch abgerufen – bitte von Statistik Austria übernehmen.
Text, Schwelle und Index-Bezeichnung sind anpassbar; die Klausel im Vertrag ist maßgeblich.

## Kundenzufriedenheit (CSAT)

- Wird ein Kundenticket gelöst, bekommt der Ansprechpartner (Absender der ursprünglichen Mail, sonst die
  Kunden-E-Mail) eine kurze Mail im Corporate Design mit **5 Smileys – ein Klick genügt**, kein Login.
  Voraussetzung: Mailversand eingerichtet und `PUBLIC_URL` (öffentliche Adresse des Cockpits) gesetzt.
- Im **Kundenportal** kann jedes erledigte Ticket bewertet werden.
- **Schlechte Bewertung (≤ 2)** → sofort ein Ticket „Kundenfeedback“ mit Priorität hoch: anrufen, klären.
- Wartungs-, RMM- und Feedback-Tickets lösen keine Umfrage aus.
- Kennzahlen: Ø-Bewertung, Anteil zufrieden, Rücklaufquote – im Dashboard, Health Score (±),
  Monatsbericht („Ihre Zufriedenheit“) und QBR.

## Stoppuhr

- Am Ticket bzw. beim Kunden „⏱ Stoppuhr“ – unten rechts läuft die Zeit sichtbar mit (auch am Handy).
- **Stopp** → Tätigkeit, Minuten und Verrechenbarkeit bestätigen → Zeiteintrag (inkl. Ticketzeit).
- Wer eine neue Stoppuhr startet, bucht die laufende automatisch – nichts geht verloren.
- Jede Person hat ihre eigene Stoppuhr.

## Cockpit als App am Handy

Das Cockpit ist eine installierbare Web-App (PWA):
- **Android/Chrome**: Menü → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“
- **iPhone/Safari**: Teilen → „Zum Home-Bildschirm“
- **Windows/Edge**: Adressleiste → „App installieren“

Mit Symbol, eigenem Fenster und Schnellzugriffen (Neues Ticket, Wartung, Posteingang). Gespeichert wird
nur die Oberfläche – Kundendaten (`/api/…`) werden nie auf dem Gerät zwischengespeichert. Voraussetzung
für die Installation ist HTTPS (z. B. über den Caddy-Reverse-Proxy aus `deploy/`).
