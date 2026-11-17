# E-Mails ins Cockpit und Kundenportal · Phishing-Check · Claude

Drei Bausteine, die zusammengehören: Mails kommen dorthin, wo gearbeitet wird (Ticket), Kunden reden im
Portal mit, verdächtige Mails werden in Sekunden bewertet, und Claude hilft dort, wo es sich lohnt –
mit Kostendeckel und ohne Klardaten.

---

## 1. E-Mails aus Outlook ins Cockpit

| Weg | So geht's | Was passiert |
|---|---|---|
| **Postfach-Abruf** (IMAP oder Microsoft 365) | automatisch (`MAIL_POLL_MINUTES`) oder „Postfach abrufen“ | KI-Mitarbeiter sortiert; Anhänge (PDF, Screenshots, Dokumente) werden am Ticket gespeichert, Belege in der Buchhaltung |
| **Drag & Drop in den Posteingang** | Posteingang → Ablagefeld „E-Mails aus Outlook hier ablegen“ | wie beim Abruf, inkl. Phishing-Bewertung |
| **Drag & Drop ins Ticket** | Ticket öffnen → Verlauf → „Dateien oder E-Mails hierher ziehen“ | die Mail wird Teil des Ticket-Verlaufs, ihre Anhänge hängen am Ticket |

**Woher kommt die Datei?**

- **Outlook (Windows, klassisch):** Mail mit der Maus auf den Desktop ziehen → `.msg`-Datei → ins Cockpit ziehen.
- **Outlook im Web / neues Outlook:** Mail öffnen → „…“ → „Herunterladen“ → `.eml`.
- Mehrere Mails auf einmal ablegen geht; doppelt abgelegte Mails werden erkannt (Message-ID).

### Antworten landen im richtigen Ticket

Antworten aus dem Ticket gehen mit **„[#123]“ im Betreff** und mit `In-Reply-To` raus. Schreibt der Kunde
zurück, ordnet das Cockpit die Mail dem **bestehenden Ticket** zu (statt ein neues anzulegen) und setzt ein
gelöstes oder wartendes Ticket wieder auf „in Arbeit“. Die Ticketnummer im Betreff wird nur akzeptiert, wenn
die Mail von der Domain des Kunden kommt – Fremde können sich nicht in Tickets einklinken.

### Ticket-Verlauf

Im Ticket siehst du alles chronologisch: eingegangene Mails, Kommentare aus dem Portal, unsere Antworten
und **interne Notizen** (gelb, für den Kunden unsichtbar). Antworten kannst du

- **per E-Mail** (Microsoft 365 oder SMTP; erscheint zusätzlich im Portal),
- **nur im Kundenportal** (funktioniert auch ohne Mailversand) oder
- als **interne Notiz** schreiben,

jeweils optional mit „→ wartet auf Kunde“ oder „→ gelöst“ (startet die Zufriedenheits-Umfrage). Die erste
Antwort setzt die Reaktionszeit für das SLA.

### Dateien

- Ablage im Datenordner (`data/anhaenge/JJJJ/MM/`), max. 20 MB je Datei, Prüfsumme gespeichert.
- **Ausführbare Dateien** (`.exe`, `.js`, `.vbs`, `.ps1`, `.msi`, `.lnk`, …) werden abgelehnt – auch als Mail-Anhang.
- Je Datei: 👁 im Kundenportal sichtbar / 🔒 nur intern. Die Original-Mail (.eml/.msg) ist standardmäßig intern.
- PDFs und Bilder öffnen im Browser, alles andere wird heruntergeladen (keine aktiven Inhalte).

---

## 2. Kundenportal: mitreden statt neu anrufen

- **Verlauf je Ticket**: Antworten von ME-IT und eigene Kommentare, Dateien zum Herunterladen.
- **Kommentar schreiben** → landet im Ticket-Verlauf, öffnet ein gelöstes Ticket wieder, erscheint im Aktivitätenprotokoll.
- **Screenshots/Dateien hochladen** – beim Anlegen eines Tickets oder später.
- **„E-Mail prüfen“**: Kunde lädt eine verdächtige Mail hoch → sofortige Einschätzung mit Handlungsempfehlung,
  gleichzeitig entsteht ein **Ticket „Phishing-Verdacht“** (gefährlich → Priorität kritisch) mit Bericht und Original-Mail.
- Strikt pro Kunde getrennt (fremde Tickets/Dateien → 404), Rate-Limits gegen Missbrauch.

---

## 3. Phishing-Check

Läuft **komplett lokal**, öffnet keine Links und braucht keine KI. Geprüft wird:

| Merkmal | Beispiel |
|---|---|
| SPF / DKIM / DMARC fehlgeschlagen | `Authentication-Results: … dmarc=fail` |
| Anzeigename ≠ Adresse, Reply-To auf fremde Domain | „Microsoft 365“ `<security@micros0ft-support.xyz>` |
| Marke vorgetäuscht | Microsoft, A1, Post, Banken, Finanzamt, DHL … von fremder Domain |
| Links | Kurz-URLs, IP-Adressen, Punycode, riskante Endungen, sichtbarer Link ≠ Ziel, Login-Seite auf fremder Domain |
| Anhänge | ausführbar, Doppelendung (`rechnung.pdf.exe`), HTML-Formulare, Archive |
| Druck/Köder | „Konto wird gesperrt“, „letzte Warnung“, Aufforderung zur Passworteingabe |

Ergebnis: **unauffällig / verdächtig / gefährlich** (Risikowert 0–100) mit Begründung, Linkliste und Empfehlung.
Im Posteingang erzeugt eine **gefährliche** Mail weder Ticket noch Lead noch Beleg – sie wird markiert (⚠).

**KI-Zweitmeinung** (Cockpit → Posteingang → Phishing-Check → „KI-Zweitmeinung einholen“): die KI bewertet Inhalt,
Tonfall und Plausibilität (z. B. CEO-Fraud, geänderte Bankverbindung) und bestätigt oder widerlegt die Regeln.
Welche KI das macht, steuerst du unter **Steuerung → Claude → Phishing-Prüfung**. Die Absender-Domain wird
dabei auch bei aktiver Pseudonymisierung mitgegeben (sie ist das wichtigste Merkmal, aber keine Kundendaten).

---

## 4. Claude (Cloud-KI) – gezielt statt pauschal

`ANTHROPIC_API_KEY` in `.env` eintragen, dann unter **Steuerung → Claude**:

| Einstellung | Bedeutung |
|---|---|
| **Cloud erlaubt** | Hauptschalter. Aus = es geht nie etwas zu Anthropic. |
| **Modell** | Opus 5.5 (Standard, beste Qualität) · Sonnet 5.5 (günstiger) · Haiku 5.5 (am günstigsten, für einfache Aufgaben) |
| **Je Aufgabe: lokal / auto / Claude** | *lokal*: nie Cloud · *auto*: lokale KI, Claude nur wenn lokal aus · *Claude*: immer Claude |
| **Denktiefe je Aufgabe** | low … max (z. B. Angebote/QBR hoch, Triage niedrig) |
| **Monatsbudget (USD)** | bei Erreichen schaltet das Cockpit automatisch auf lokal zurück |
| **Pseudonymisieren** | E-Mail-Adressen, Telefonnummern, IBANs werden vor dem Versand zu `[E-MAIL-1]` usw. und in der Antwort zurückübersetzt |

Immer aktiv: **Passwörter und Zugangsdaten werden geschwärzt**, bevor irgendetwas die Firma verlässt.
Verbrauch (Tokens inkl. Cache, Kosten je Aufgabe) steht in derselben Karte; „Verbindung testen“ prüft den Schlüssel.

Empfehlung für den Start: Kundenportal-Hilfe und Belege **lokal**, Angebote/QBR/Wochenbriefing **Claude**,
der Rest **auto**. Belege-PDFs (auch Scans) kann Claude direkt lesen: Beleg öffnen → „Mit Claude lesen“
oder Aufgabe „Belege lesen“ auf *Claude* stellen, dann passiert es automatisch beim Upload und Postfach-Abruf.
