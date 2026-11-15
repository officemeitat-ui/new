# KI-Mitarbeiter: für ME-IT selbst und als Produkt für Kunden

> Anlass: In Oberösterreich und Salzburg wird „ein individueller KI-Mitarbeiter, vor Ort eingerichtet“
> bereits aktiv an KMU beworben (z. B. diekibetreuer.com: Posteingang, Anfragen ins CRM,
> Antwortentwürfe, Belege für den Steuerberater, Nachfassen, Termine). Die Nachfrage ist also da.
> ME-IT kann das besser anbieten, weil IT-Betreuung, Sicherheit und KI aus einer Hand kommen und alles lokal läuft.

## Was der KI-Mitarbeiter im Cockpit macht

| Rolle | Aufgabe | Wo im Cockpit |
|---|---|---|
| **Praktikant (Organisation)** | Posteingang sortieren: Support · Anfrage · Termin · Beleg · Info/Spam | Posteingang |
| | Neue Anfragen landen als **Lead im CRM**, mit Begrüßung und Qualifizierungsfragen | Leads & Pipeline |
| | **Rechnungen erkennen**, Betrag, Nummer und Datum auslesen, als CSV für den Steuerberater | Belege |
| **Sachbearbeiter (Kommunikation)** | Support-Mails → **Ticket mit Triage** und Antwortentwurf | Tickets |
| | Interessenten qualifizieren (Mitarbeiter, Zeitrahmen, Budget, Lead-Score 0–100) | Leads |
| **Kundenmanager (Bindung)** | **Angebote und Leads nachfassen**, sobald nach X Tagen nichts zurückkommt | Posteingang → „Nachfassen prüfen“ |
| | **Webformular rund um die Uhr**: Anfrage um 22 Uhr, Antwortentwurf liegt am Morgen bereit | `/anfrage` |
| | Quartalsgespräche (QBR) mit Health Score und nächstem Hebel | Customer Success |
| **Abteilungsleiter (Steuerung)** | Übersicht: was erledigt wurde, was auf Freigabe wartet, geschätzte Zeitersparnis | Steuerung |
| | Protokoll jedes Agentenlaufs (Nachvollziehbarkeit, AI Act) | Einstellungen |

### Vertrauen aufbauen: erst Entwurf, dann Autopilot

Jede Nachrichtenart hat einen eigenen Modus:

- **Entwurf + Freigabe** (Standard): Der KI-Mitarbeiter bereitet alles vor, ein Mensch gibt mit einem Klick frei.
- **Autopilot**: Der KI-Mitarbeiter versendet bzw. legt automatisch ab. Das empfiehlt sich erst, wenn die Entwürfe einige Wochen gepasst haben.

Newsletter und Werbung („Info“) laufen von Anfang an im Autopilot. Sie werden nur abgelegt und nie beantwortet.

## Einrichtung

In `.env` eintragen und die App neu starten:

```
MAIL_IMAP_HOST=imap.dein-provider.at
MAIL_IMAP_USER=office@deine-firma.at
MAIL_IMAP_PASSWORD=App-Kennwort
MAIL_SMTP_HOST=smtp.dein-provider.at
MAIL_SMTP_PORT=587
MAIL_FROM=office@deine-firma.at
MAIL_POLL_MINUTES=5          # automatisch alle 5 Minuten abrufen (0 = nur per Knopf)
BOOKING_URL=https://…        # optional: Terminbuchungs-Link für Interessenten
FOLLOWUP_DAYS=5              # nach wie vielen Tagen nachgefasst wird
PUBLIC_FORM_ORIGINS=https://www.deine-firma.at   # Website, die das Formular per JS einbinden darf
```

### Microsoft 365 (empfohlen bei M365-Postfächern)
Microsoft hat die Anmeldung per Passwort für IMAP/SMTP in Exchange Online abgeschaltet. Der KI-Mitarbeiter
spricht deshalb direkt mit **Microsoft Graph**:

1. **Entra Admin Center → App-Registrierungen → Neue Registrierung** (Name z. B. „ME-IT KI-Mitarbeiter“, nur dieser Mandant).
2. **API-Berechtigungen → Microsoft Graph → Anwendungsberechtigungen:** `Mail.ReadWrite` und `Mail.Send`
   hinzufügen, dann **Administratorzustimmung erteilen**.
3. **Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel.** Wert sofort kopieren und das Ablaufdatum notieren.
4. **Zugriff auf das eine Postfach beschränken** (wichtig!). Sonst darf die App alle Postfächer lesen.
   Das geht in Exchange Online über „RBAC für Anwendungen“ (früher Application Access Policy).
5. In `.env`:
   ```
   MAIL_PROVIDER=graph
   GRAPH_TENANT_ID=<Verzeichnis-ID>
   GRAPH_CLIENT_ID=<Anwendungs-ID>
   GRAPH_CLIENT_SECRET=<geheimer Schlüssel>
   GRAPH_MAILBOX=office@deine-firma.at
   MAIL_POLL_MINUTES=5
   ```
Antworten gehen als echte Antwort im Outlook-Verlauf raus und landen in „Gesendete Elemente“.
Abgerufene Mails werden als gelesen markiert.

> Für Kundeninstallationen: Pro Kunde eine eigene App-Registrierung im Kunden-Mandanten anlegen. Das
> Geheimnis gehört ins Passwort-Management, nicht in Tickets oder Mails.

Ohne Mail-Anbindung funktioniert alles andere trotzdem: Formular, manuelle Erfassung, Entwürfe kopieren und
als „manuell erledigt“ markieren.

**Anfrageformular:** `http://<server>:8080/anfrage`. Es braucht kein Passwort, hat Spamschutz (Honeypot) und ist auf 5 Anfragen
pro 10 Minuten und IP begrenzt. Für die Website: Reverse-Proxy mit HTTPS davor und **nur** `/anfrage` und
`/api/public/` nach außen freigeben. Den Einbettungscode gibt es unter *KI-Mitarbeiter → Steuerung*.

---

## Als Produkt verkaufen

### Positionierung
> „Ihr KI-Mitarbeiter: Er läuft auf Ihrem eigenen Server, von Ihrem IT-Betreuer eingerichtet und abgesichert.“

| | Typischer KI-Agentur-Ansatz | ME-IT |
|---|---|---|
| Betrieb | oft Cloud-Dienste und Automatisierungsplattformen | **lokal beim Kunden** (Private KI-Box) oder auf EU-Server |
| Datenschutz | „absolut sicher“ als Versprechen | **nachweisbar**: Daten verlassen das Haus nicht, Protokoll jedes Laufs |
| IT-Integration | Schnittstellen zu Fremdsystemen | ME-IT betreut bereits Postfach, Firewall, Backup und Benutzer |
| Sicherheit/NIS2 | meist kein Thema | im Security-Paket mitgedacht (Zugriffe, Protokoll, Notfallplan) |
| Langfristig | Projekt | **Betriebsvertrag** mit monatlichem Wirkungsbericht |

### Pakete (Beispielpreise im Leistungskatalog, bitte anpassen)

| Stufe | Inhalt | Preis |
|---|---|---|
| **Potenzialanalyse** | Halbtag vor Ort: Abläufe aufnehmen, ROI berechnen | 490 € (bei Auftrag angerechnet) |
| **Einrichtung** | KI-Mitarbeiter für 1–2 Bereiche (z. B. Posteingang + Belege), Schulung | 3.900 € |
| **Betrieb & Optimierung** | Monitoring, Anpassungen, neue Abläufe, Wirkungsbericht | 249 €/Monat |
| Optional: **Private KI-Box** | Lokaler KI-Server (Hardware + Einrichtung) | ab 4.900 € + Hardware |

**Preislogik:** Erst die Wirkung, dann der Preis. Nimm den **ROI-Rechner** (Steuerung) im Gespräch.
Beispiel: 3 Personen mit je 6 Routine-Stunden pro Woche, davon 50 % automatisierbar, interne Kosten 45 €/h.
Das ergibt rund 39 Stunden und rund 1.750 € Wert pro Monat. Die Einrichtung ist damit nach rund 2,6 Monaten amortisiert.

### Ablauf beim Kunden
1. **Erstgespräch (Diagnose):** Wo geht Zeit verloren? Was kostet es, wenn alles bleibt, wie es ist?
2. **Potenzialanalyse vor Ort:** ROI gemeinsam ausrechnen und Pilotbereich festlegen.
3. **Einrichtung im Entwurfs-Modus:** 2–4 Wochen lang gibt der Kunde jede Antwort frei.
4. **Autopilot für passende Bereiche** und monatlicher Wirkungsbericht (Zeitersparnis aus der Steuerung).
5. **Land & Expand:** nach 3 Monaten im QBR den nächsten Bereich vorschlagen.

### Für ME-IT selbst zuerst
Setze den KI-Mitarbeiter **zuerst im eigenen Betrieb** ein: Postfach office@, Anfrageformular auf der Website,
Belege. Nach 4 Wochen hast du echte Zahlen (Zeitersparnis, Antwortzeit) und eine glaubwürdige Demo für Kunden.

## Ausbaustufen (Vorschläge)
- Microsoft-365-Kalender (Graph) für echte Terminvorschläge statt Buchungslink
- Telefon-Assistent (Anrufannahme, Rückrufnotiz), lokal mit Spracherkennung
- WhatsApp Business (offizielle API) als weiterer Kanal
- Belege per OCR aus Scans/Fotos, Export direkt im BMD/RZL-Format
- Mandantenfähigkeit: eine Installation pro Kunde zentral verwalten
