# KI-Mitarbeiter-Cockpit

Zwei Produkte in einer Installation:

1. **KI-Mitarbeiter für Betriebe:** Ein **Telefon-Assistent** nimmt Anrufe an, beantwortet Fragen, bucht Termine und notiert Rückrufe.
   Ein **WhatsApp-Assistent** macht dasselbe im Chat. Ein **E-Mail-Assistent** ordnet eingehende E-Mails ein und schreibt Antworten –
   mit Microsoft 365 direkt als Entwurf in Outlook. Die **Belege-Ablage** erkennt Rechnungen im Postfach, liest sie aus und stellt sie
   monatlich gesammelt für die Buchhaltung bereit. Alles läuft im **Cockpit** zusammen, mit Kontakten, Pipeline, Kalender und Monatskennzahlen.
2. **Arbeitsplatz für IT-Dienstleister** (`/app`, am Handy und PC als App installierbar): Heute-Übersicht, Aufgaben statt Microsoft To Do,
   Tickets, Warnungen und Geräte aus **Atera**, Kundenakte mit **Keeper**-Link und ein **KI-Assistent**, dem man per Sprache oder Text sagt,
   was zu tun ist („Termin Donnerstag 14 Uhr bei Huber“, „schreib Frau Huber, dass wir kommen“).

Dazu kommt eine Website mit Potentialanalyse-Funnel für das eigene Angebot.

Pro Kunde gibt es eine Installation. Der Betrieb wird in [`config/business.ts`](config/business.ts) beschrieben,
die Website in [`config/site.ts`](config/site.ts).

Hintergrund, Angebot und Vertrieb: [docs/ki-mitarbeiter-angebot.md](docs/ki-mitarbeiter-angebot.md)

## Funktionen

**Telefon-Assistent (über Vapi)**
- Stellt sich als KI vor (Pflicht nach EU AI Act), spricht österreichisches Deutsch (Azure-Stimme `de-AT`, Spracherkennung `de-AT`)
- Kennt Öffnungszeiten, Leistungen und häufige Fragen aus dem Betriebsprofil und erfindet keine Preise oder Zusagen
- Prüft freie Termine im Kalender und bucht direkt. Zwei Anrufer können nie denselben letzten Platz bekommen.
- Notiert Rückrufwünsche (auch dringende) und informiert das Team per E-Mail; Weiterverbinden optional
- Nach jedem Gespräch landen Zusammenfassung, Transkript und Aufnahme beim Kontakt im Cockpit
- Konfiguration wird bei jedem Anruf frisch erzeugt (aktuelles Datum, aktuelles Profil), kein manuelles Nachpflegen in Vapi

**WhatsApp-Assistent (WhatsApp Cloud API von Meta)**
- Antwortet sofort und kurz, stellt sich als KI vor, kennt das Betriebsprofil.
  Nutzt dieselben Werkzeuge wie der Telefon-Assistent: freie Termine, buchen, Rückruf.
- Übergibt an das Team bei Reklamationen, dringenden Fällen oder wenn der Kunde einen Menschen möchte. Das Team wird per E-Mail benachrichtigt, der Assistent schweigt danach in diesem Gespräch.
- Mehrere kurze Nachrichten hintereinander werden einmal gemeinsam beantwortet. Doppelt zugestellte Webhooks werden erkannt.
- Bilder und Sprachnachrichten bekommen einen freundlichen Hinweis, dass nur Text geht.
- Cockpit → Chats:
  - alle Gespräche, Übernahme durch das Team und Rückgabe an die KI
  - Team-Antworten, aber nur innerhalb des 24-Stunden-Fensters von WhatsApp
  - **Test-Chat** für Vorführungen ohne WhatsApp
- Der Verlauf liegt nur in der eigenen Datenbank. Claude bekommt bei jedem Aufruf den vollständigen Verlauf, Anthropic hält keinen Gesprächszustand.

**E-Mail-Assistent**
- Liest das Postfach per **Microsoft 365 (Outlook)** oder IMAP. Lese-Status bleibt unverändert, jede E-Mail wird nur einmal verarbeitet.
- Mit Microsoft 365:
  - Antwortentwürfe liegen **direkt in Outlook**, im Verlauf der Kunden-E-Mail. Geprüft und gesendet wird dort.
    Der Assistent hat bewusst kein Recht zum Senden (`Mail.Send`) – er kann technisch nichts selbst verschicken.
  - Der bisherige Verlauf (auch eigene gesendete E-Mails) fließt in die Antwort ein.
  - Jede ausgewertete E-Mail bekommt eine Outlook-Kategorie („KI: Angebotsanfrage“, „KI: Dringend“ …).
    Rechnungen, Lieferanten-E-Mails und Werbung werden in Ordner abgelegt (`emailAssistant.filing`).
  - Das Cockpit erkennt, wenn ein Entwurf in Outlook gesendet oder gelöscht wurde.
- Nie an die KI gehen: in Outlook als „Privat“ oder „Vertraulich“ markierte E-Mails, Absender auf der Ausnahmeliste
  (`emailAssistant.excludeSenders`, z. B. Bank, Steuerberatung) und automatische E-Mails, die nicht nach Rechnung aussehen.
- Ordnet ein (Terminanfrage, Frage, Angebot, Reklamation, Beleg, Werbung …), erkennt Dringendes und ordnet den Kontakt zu
- Schreibt Antwortentwürfe mit echten freien Terminen. Freigabe per Klick, Entwürfe lassen sich bearbeiten.
- Modus „Entwurf“ (alles zur Freigabe) oder „autonom“: Routinefälle gehen direkt raus, Dringendes nie
- Antwortet nie auf automatische Absender oder die eigene Adresse (keine Antwort-Schleifen)
- „Test-E-Mail simulieren“ im Cockpit für Vorführungen ohne echtes Postfach

**Belege-Ablage**
- Erkennt Rechnungen im Postfach – auch von „noreply“-Absendern – und liest PDF, Foto oder E-Rechnung (XML) mit Claude aus:
  Lieferant, Rechnungsnummer, Datum, Brutto/Netto/USt, Fälligkeit, ob schon bezahlt.
- AGB, Lieferscheine und Ähnliches werden nicht abgelegt, doppelte Dateien erkannt, gleiche Rechnungsnummern zur Prüfung markiert.
- Rechnungen, die nur als Link kommen („Ihre Rechnung liegt im Kundenportal“), stehen als **„Datei fehlt“** in der Liste –
  herunterladen und im Cockpit nachreichen. Mahnungen werden zur Prüfung markiert.
- Cockpit → Belege: Monatsübersicht, Korrektur mit PDF-Vorschau, Upload weiterer Belege (z. B. Tankbeleg als Foto).
- **Monatspaket:** ZIP mit allen Belegen des Monats, sprechend benannt (`2026-11-16_Lieferant_Nummer_Betrag.pdf`),
  plus Liste als CSV für Excel. Einmal in FreeFinance bzw. der Buchhaltung hochladen, dann „als übergeben“ markieren.
- Dateien übergebener Belege werden nach einer Frist gelöscht (`receipts.keepFilesDaysAfterExport`, Standard 90 Tage);
  aufbewahrt wird in der Buchhaltung.

**Arbeitsplatz für IT-Dienstleister** (`/app`)
- **Heute:** Termine aus Outlook, fällige und überfällige Aufgaben, Tickets im Fokus (kritisch, hoch, „wartet auf dich“),
  Warnungen aus Atera, offene E-Mail-Entwürfe und Belege – auf einen Blick, am Handy wie am PC.
- **Aufgaben** statt Microsoft To Do: Listen, Fälligkeit mit Uhrzeit, Priorität, Kunde, Ticketbezug, Wiederholung
  (täglich, wöchentlich, monatlich – die nächste wird beim Abhaken angelegt). Offene To-Do-Aufgaben lassen sich einmalig übernehmen.
- **Tickets** aus Atera: Filter „wartet auf mich“ (letzte Nachricht kam vom Kunden), Verlauf, Status ändern, in Atera öffnen,
  als Aufgabe merken und **KI-Zusammenfassung** mit nächsten Schritten, Rückfragen und Antwortvorschlag zum Kopieren.
- **Kunden:** Kundenakte mit Tickets, Warnungen, Geräten (online/offline), Aufgaben, Notizen und Knopf „Zugänge in Keeper“.
  Passwörter liegen nie im Arbeitsplatz und gehen nie an die KI.
- **Stunden** (eigener Menüpunkt): vorab bezahlte Stundenpakete je Kunde gutschreiben (mit Betrag und Rechnungsnummer),
  Zeiten buchen – vom Paket abziehen, separat verrechnen oder intern – und jederzeit den Reststand sehen.
  Knappe und überzogene Pakete erscheinen auf „Heute“ und im Menü. Zeit lässt sich auch direkt am Ticket buchen.
  Je Kunde und Monat gibt es den **Leistungsnachweis als CSV** (mit Summen und Reststand).
  Optional Aufrunden im 15-Minuten-Takt (`hours.roundToMinutes` in `config/workspace.ts`).
- **KI-Assistent** per Text oder Sprache (Mikrofon im Browser, am Handy auch Diktieren über die Tastatur):
  - legt Aufgaben an und hakt sie ab, trägt Termine in den eigenen Outlook-Kalender ein (ohne Einladungen),
  - schreibt E-Mails als **Entwurf** in Outlook an die hinterlegte Kundenadresse – gesendet wird nie automatisch,
  - bucht Zeiten („1,5 Stunden bei Huber, Drucker eingerichtet“), schreibt gekaufte Stunden gut und nennt den Reststand,
  - beantwortet „Was steht heute an?“, „Wie ist der Stand bei Huber?“, „Welche Tickets warten auf mich?“.
  - Ohne Outlook werden Termine zu Aufgaben mit Uhrzeit und E-Mails zum Link ins Mailprogramm.
- **Als App installieren:** iPhone/iPad in Safari → Teilen → „Zum Home-Bildschirm“; Android in Chrome → „App installieren“;
  Windows in Edge oder Chrome → Symbol „App installieren“ in der Adressleiste. Start direkt im Arbeitsplatz, Kurzbefehle für
  Assistent, Aufgaben und Tickets.

**Kalender**
- Interner Kalender, oder angebunden an **Google Kalender** bzw. **Microsoft 365 / Outlook**: Einträge dort (auch ganztägige wie Urlaub) zählen als belegt,
  neue Buchungen werden eingetragen, Stornos gelöscht
- Ist der externe Kalender nicht erreichbar, wird nicht gebucht. Der Telefon-Assistent bietet dann einen Rückruf an, es gibt keine Doppelbuchung.
- Übertragungsfehler sind im Cockpit markiert und lassen sich per Klick nachholen. Mit „Verbindung testen“ lässt sich die Anbindung prüfen.

**Terminbestätigung und -erinnerung**
- Nach jeder Buchung bekommt der Kunde eine Bestätigung, rund 24 Stunden vorher eine Erinnerung.
  Das geht per SMS an Mobilnummern (Twilio), sonst per E-Mail. Bei einem SMS-Fehler wird automatisch die E-Mail genommen.
- Versand nur tagsüber (Standard 8–20 Uhr). Wer erst innerhalb der letzten 24 Stunden vor dem Termin bucht, bekommt nur die Bestätigung, keine zweite Nachricht.
- Im Cockpit steht pro Termin, ob und wie bestätigt bzw. erinnert wurde.

**Nachfass-Assistent**
- Erkennt Anfragen (Termin- oder Angebotsanfragen), die wir beantwortet haben und auf die nach 3 Tagen nichts kam:
  keine E-Mail, kein Anruf, kein Termin, Kontakt nicht abgeschlossen.
- Schreibt einen kurzen Nachfass-Entwurf mit aktuellen freien Terminen, im selben E-Mail-Verlauf.
- Entwürfe gehen **immer** zur Freigabe, auch im autonomen Modus. Pro Verlauf wird höchstens einmal nachgefasst.

**Monatsbericht**
- Cockpit → Bericht: Anrufe, Termine, Rückrufwünsche, E-Mails, Gesprächszeit und geschätzte Zeitersparnis, jeweils im Vergleich zum Vormonat
- Druckbar bzw. als PDF speicherbar. Wird am Monatsanfang automatisch per E-Mail verschickt (`/api/cron/report`).

**Cockpit (`/admin`)**
- Dashboard mit **Wirkung**: angenommene Anrufe, gebuchte Termine, bearbeitete E-Mails, geschätzte Zeitersparnis (Grundlage für den Monatsbericht)
- E-Mails (Freigabe), Anrufe (Zusammenfassung, Transkript, Aufnahme), Termine (Kalender, manuell eintragen, stornieren)
- Pipelines mit Drag & Drop. Kontakte aus Telefon und E-Mail landen in „Anfragen“, Website-Leads in „Vertrieb“.
- Kontakt-Detail mit Verlauf, KI-Gesprächsvorbereitung und KI-Follow-up
- Seite „Telefon-Assistent“: Einrichtungsstatus und Vorschau der Anweisungen an die KI

**Website**
- Landingpage für das KI-Mitarbeiter-Angebot, Potentialanalyse-Funnel mit Bewertung und Terminbuchung, Recruiting-Funnel
- Kampagnen-Zuordnung (UTM), Spam-Schutz, Impressum- und Datenschutz-Vorlage

## Schnellstart

```bash
npm install
cp .env.example .env.local   # mindestens ADMIN_PASSWORD und SESSION_SECRET setzen
npm run dev
```

Cockpit: http://localhost:3000/admin. Die E-Mail-Simulation braucht nur `ANTHROPIC_API_KEY`.

| Befehl | Zweck |
|---|---|
| `npm test` | Unit- und Integrationstests, u. a. gegen nachgebaute APIs von Google, Microsoft, Claude (Werkzeugschleife), Meta (WhatsApp) und Twilio sowie einen lokalen SMTP-Server |
| `npm run typecheck` | TypeScript-Prüfung |
| `npm run build` / `npm start` | Produktions-Build |
| `npm run vapi:connect` | Telefonnummer in Vapi mit dieser Installation verbinden |
| `npm run format` | Code formatieren (Prettier) |

## Einrichtung für einen Kunden

1. **Betriebsprofil** in `config/business.ts`: Öffnungszeiten, Feiertage, Leistungen mit Dauer, Kapazität, häufige Fragen,
   Name und Hinweise für den Assistenten, E-Mail-Signatur und Modus.
2. **Hosting** auf einem eigenen Linux-Server (z. B. World4You Linux vServer) mit `deploy/setup.sh` – Anleitung in [deploy/README.md](deploy/README.md). Alternativ Vercel mit Turso (`DATABASE_URL`).
3. **Telefon:**
   1. Bei [Vapi](https://vapi.ai) eine Nummer anlegen oder importieren (z. B. Twilio) und dort **keinen** Assistenten zuweisen.
   2. `VAPI_WEBHOOK_SECRET`, `VAPI_API_KEY` und `VAPI_PHONE_NUMBER` setzen, dann `npm run vapi:connect` ausführen.
   3. Die bestehende Firmennummer bei Nichterreichen oder ganz auf die Vapi-Nummer umleiten.
   4. Prüfen unter Cockpit → Telefon-Assistent.
4. **E-Mail:**
   - *Microsoft 365 (empfohlen bei Outlook):*
     1. Im Entra-Admin-Center eine App registrieren und ein Client-Secret anlegen (dieselbe App wie für den Kalender).
     2. Zugriff nur auf das eine Postfach geben, mit „RBAC für Anwendungen“ in Exchange Online – **ohne** `Mail.Send`.
        Die Berechtigung `Mail.ReadWrite` dann nicht zusätzlich mandantenweit in Entra vergeben (die Rechte addieren sich).
        Befehle laut Microsoft-Doku „Role Based Access Control for Applications in Exchange Online“ (vor dem Ausführen dort gegenprüfen):
        ```powershell
        Connect-ExchangeOnline
        New-ServicePrincipal -AppId <Client-ID> -ObjectId <Objekt-ID der Unternehmensanwendung> -DisplayName "KI-Büroassistent"
        New-ManagementScope -Name "KI-Postfach" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'office@firma.at'"
        New-ManagementRoleAssignment -App <Client-ID> -Role "Application Mail.ReadWrite" -CustomResourceScope "KI-Postfach"
        Test-ServicePrincipalAuthorization -Identity <Client-ID> -Resource office@firma.at
        ```
     3. `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_MAILBOX` und `CRON_SECRET` setzen.
     4. Ausnahmen (`excludeSenders`) und Ablage-Ordner (`filing`) unter `emailAssistant` in `config/business.ts` festlegen.
   - *IMAP:* `IMAP_*`, `SMTP_*` und `CRON_SECRET` setzen.
   - `/api/cron/mail` alle 5 Minuten aufrufen:
      `curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/mail`
     (oder per Vercel Cron, der diesen Header bei gesetztem `CRON_SECRET` selbst mitschickt).
   - Bei IMAP zum Start Modus „Entwurf“. Nach ein paar Wochen Vertrauen auf „autonom“ umstellen. Mit Microsoft 365 wird immer in Outlook gesendet.
5. **Kalender** (optional, `CALENDAR_PROVIDER`):
   - *Google:*
     1. In der Google Cloud Console die Google Calendar API aktivieren.
     2. Ein Dienstkonto anlegen und einen JSON-Schlüssel erzeugen. Dessen Inhalt kommt in `GOOGLE_SERVICE_ACCOUNT_JSON`.
     3. Den Kalender des Betriebs in Google Kalender für die `client_email` des Dienstkontos freigeben, mit „Änderungen an Terminen vornehmen“.
     4. `GOOGLE_CALENDAR_ID` aus den Kalendereinstellungen setzen (beim Hauptkalender die E-Mail-Adresse).
   - *Microsoft 365:*
     1. Im Entra-Admin-Center eine App registrieren.
     2. Die Anwendungsberechtigung `Calendars.ReadWrite` mit Administratorzustimmung vergeben und ein Client-Secret anlegen.
     3. Den Zugriff per Application Access Policy auf das eine Postfach beschränken.
     4. `MS_*` setzen.
   - Danach im Cockpit unter Termine auf „Verbindung testen“ klicken.
   - `booking.externalEvents` in `config/business.ts` regelt, ob ein externer Eintrag alle Plätze blockiert (Standard) oder nur einen.
6. **WhatsApp:**
   1. Im Meta-Business-Konto eine App (Typ Business) mit dem Produkt WhatsApp anlegen.
   2. Eine eigene Nummer für die WhatsApp Business Platform registrieren. Diese Nummer kann nicht gleichzeitig in der normalen WhatsApp-App laufen.
   3. `WHATSAPP_PHONE_NUMBER_ID` und das dauerhafte Zugriffstoken eines Systembenutzers (`WHATSAPP_ACCESS_TOKEN`) eintragen.
   4. Das App-Geheimnis kommt in `WHATSAPP_APP_SECRET`. `WHATSAPP_VERIFY_TOKEN` frei wählen.
   5. In der Meta-App den Webhook `https://…/api/whatsapp` mit diesem Verify-Token eintragen und das Feld `messages` abonnieren.
   6. Testen mit einer Nachricht an die Nummer. Das Gespräch erscheint im Cockpit unter Chats.
   7. Kosten und die nötige Unternehmensverifizierung laut aktuellen Meta-Bedingungen prüfen.
7. **Benachrichtigungen:** `TEAM_NOTIFY_EMAIL` für Rückrufwünsche, neue Termine und dringende E-Mails. Optional `WEBHOOK_URL` für CRM oder n8n.
8. **SMS** (optional): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` und `TWILIO_FROM` setzen. Einstellungen unter `reminders` in `config/business.ts`.
9. **Arbeitsplatz** (für den eigenen IT-Betrieb):
   1. In Atera unter Admin → API einen API-Schlüssel erzeugen und als `ATERA_API_KEY` setzen.
   2. `/api/cron/atera` alle 5 Minuten aufrufen. Der erste Abgleich legt die Kunden an.
   3. Outlook: dieselbe App-Registrierung wie beim E-Mail-Assistenten. Für Termine `Application Calendars.ReadWrite`, für Entwürfe
      `Application Mail.ReadWrite` (beides per RBAC für Anwendungen nur auf das eigene Postfach). Für die einmalige Übernahme aus
      Microsoft To Do zusätzlich `Tasks.Read.All` (gilt mandantenweit – danach wieder entfernen).
   4. `config/workspace.ts` anpassen: Name, Aufgabenlisten, Atera-Ticket-Link, ob der Ticketstatus geändert werden darf.
   5. Pro Kunde im Arbeitsplatz E-Mail, Adresse, E-Mail-Domains und den Keeper-Link (geteilter Ordner) hinterlegen.
   6. Feldnamen der Atera-API sind nach Atera-Doku v3 umgesetzt und gegen eine nachgebaute API getestet –
      beim ersten echten Abgleich kurz prüfen, ob Tickets, Warnungen und Geräte vollständig ankommen.
10. **Regelmäßige Aufgaben** (alle mit `Authorization: Bearer $CRON_SECRET`, z. B. per Server-Cron oder Vercel Cron):

   | Route | Rhythmus | Zweck |
   |---|---|---|
   | `/api/cron/mail` | alle 5 Minuten | Postfach abrufen, Belege ablegen, Outlook-Entwürfe abgleichen |
   | `/api/cron/atera` | alle 5 Minuten | Kunden, Tickets, Warnungen und Geräte aus Atera |
   | `/api/cron/reminders` | stündlich | Terminerinnerungen |
   | `/api/cron/followups` | täglich morgens | Nachfass-Entwürfe |
   | `/api/cron/report` | am 1. des Monats | Monatsbericht an `REPORT_EMAIL` (sonst `TEAM_NOTIFY_EMAIL`) |

## Webhook-Ereignisse

Ist `WEBHOOK_URL` gesetzt, wird jedes Ereignis als JSON gesendet (mit `WEBHOOK_SECRET` signiert im Header
`X-Signature: sha256=…`): `lead.created`, `lead.stage_changed`, `appointment.booked`, `callback.requested`,
`call.ended`, `email.received`, `chat.handoff`. Die Felder stehen in [`lib/webhook.ts`](lib/webhook.ts).

## Was vor dem Livegang zu klären ist

- [ ] Platzhalter ersetzen (gelb markiert): Betriebsprofil, Impressum, Kundenstimmen nur echt und mit Einverständnis
- [ ] Datenschutzerklärung des **Kunden** um Telefon-, WhatsApp- und E-Mail-Assistent, SMS-Versand und alle Dienstleister ergänzen
      (WhatsApp: Meta als Auftragsverarbeiter, Drittlandtransfer)
- [ ] Bestätigungen, Erinnerungen und Nachfass-E-Mails beziehen sich nur auf die konkrete Anfrage bzw. den gebuchten Termin.
      Bewertungsanfragen oder Werbung ohne Einwilligung sind bewusst **nicht** eingebaut (§ 174 TKG, § 7 UWG).
- [ ] E-Mail-Assistent: Was an Anthropic geht, sind Text der ausgewerteten E-Mails und Rechnungsanhänge. Kundenverträge mit
      Verschwiegenheitspflichten prüfen und betroffene Absender in `excludeSenders` aufnehmen.
- [ ] Auftragsverarbeitungsverträge: Hosting, Datenbank, Anthropic, Microsoft, Vapi samt Telefonie- und Sprachdienst, ggf. CRM.
      Vapi und Azure verarbeiten Gesprächsdaten, für Drittländer den Datentransfer prüfen.
- [ ] Hinweis auf Gesprächsaufzeichnung bzw. Transkription am Gesprächsbeginn, falls Aufnahmen gespeichert werden
- [ ] Keine Werbeanrufe oder Werbe-E-Mails ohne Einwilligung (§ 174 TKG 2021 bzw. § 7 UWG). Der Assistent nimmt nur Anrufe an.
- [ ] Bei Praxen und Gesundheitsdaten (Art. 9 DSGVO) gesondert prüfen
- [ ] Starkes `ADMIN_PASSWORD`, zufällige Geheimnisse. Der Arbeitsplatz zeigt Kundendaten – nur über HTTPS betreiben,
      am Handy Bildschirmsperre verwenden.
- [ ] Arbeitsplatz: Ticketverläufe und Kundennotizen gehen für Zusammenfassungen an Anthropic – Auftragsverarbeitung prüfen,
      in Notizen keine Zugangsdaten ablegen (dafür ist Keeper da).

## Projektstruktur

```
config/business.ts       Betriebsprofil des Kunden (Wissen, Öffnungszeiten, Leistungen, Assistent)
config/site.ts           Website-Texte, Funnels, Pipelines, Kanäle
lib/calendar.ts          Terminlogik (zeitzonenfest, rein funktional)
lib/appointments.ts      Buchungen mit Kapazitätsprüfung in einer Transaktion, Abgleich mit externem Kalender
lib/calendar-sync/       Google Kalender (Dienstkonto) und Microsoft 365 (Graph)
lib/assistant/           Gemeinsame Werkzeuge und Betriebswissen für Telefon- und Chat-Assistent
lib/voice/               Telefon-Assistent: Vapi-Konfiguration und Webhook-Verarbeitung
lib/chat/                Chat-Assistent: Claude-Werkzeugschleife, Ablauf, Versandwege
lib/whatsapp.ts          WhatsApp Cloud API: Signaturprüfung, Webhook, Versand
lib/conversations.ts     Chat-Gespräche und -Nachrichten
lib/mail/                E-Mail-Assistent: Auswertung (Claude), Postfach (Microsoft 365, IMAP), SMTP, Verarbeitung
lib/receipts/            Belege-Ablage: Erkennen, Auslesen (Claude), Speicher, Monatspaket (ZIP + CSV)
lib/workspace/           Arbeitsplatz: Aufgaben, Kunden, Atera-Abgleich, Outlook (Kalender, Entwürfe, To Do), KI-Assistent
lib/atera.ts             Atera-API v3
config/workspace.ts      Einstellungen des Arbeitsplatzes
lib/graph.ts             Microsoft Graph mit App-Zugang
lib/stats.ts             Kennzahlen zur Wirkung
lib/report.ts            Monatsbericht (Seite und E-Mail-Text)
lib/reminders.ts         Terminbestätigung und -erinnerung (SMS/E-Mail)
lib/followup.ts          Nachfass-Assistent
lib/sms.ts               SMS über Twilio
app/api/voice/vapi/      Webhook für Vapi
app/api/whatsapp/        Webhook für WhatsApp
app/api/cron/mail/       Postfach-Abruf
app/api/cron/report/     Versand des Monatsberichts
app/api/cron/reminders/  Terminerinnerungen
app/api/cron/followups/  Nachfass-Entwürfe
app/admin/               Cockpit
app/app/                 Arbeitsplatz (installierbare App), app/manifest.ts und public/sw.js
app/(site)/              Website und Funnels
scripts/vapi-connect.mjs Telefonnummer verbinden
tests/                   Vitest
```
