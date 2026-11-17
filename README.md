# KI-Mitarbeiter-Cockpit

Zwei Produkte in einer Installation:

1. **KI-Mitarbeiter für Betriebe:** Ein **Telefon-Assistent** nimmt Anrufe an, beantwortet Fragen, bucht Termine und notiert Rückrufe.
   Ein **WhatsApp-Assistent** macht dasselbe im Chat. Ein **E-Mail-Assistent** ordnet eingehende E-Mails ein und schreibt Antworten –
   mit Microsoft 365 direkt als Entwurf in Outlook. Die **Belege-Ablage** erkennt Rechnungen im Postfach, liest sie aus und stellt sie
   monatlich gesammelt für die Buchhaltung bereit. Alles läuft im **Cockpit** zusammen, mit Kontakten, Pipeline, Kalender und Monatskennzahlen.
2. **Arbeitsplatz für IT-Dienstleister** (`/app`, am Handy und PC als App installierbar): Heute-Übersicht, Aufgaben statt Microsoft To Do,
   Tickets, Warnungen und Geräte aus **Atera**, Kundenakte mit **Keeper**-Link und ein **KI-Assistent**, dem man per Sprache oder Text sagt,
   was zu tun ist („Termin Donnerstag 14 Uhr bei Huber“, „schreib Frau Huber, dass wir kommen“). Dazu **verschlüsselte Kunden-Doku**
   mit Doku-Passwort: Netzwerkplan mit Live-Prüfung der Konfiguration, Patchschränke, Verkabelung, Seiten – Umzug aus BookStack per Klick.
   **Security-Awareness-Plattform** für das eigene Team und Kunden (Schulung KI-Kompetenz nach AI Act Art. 4 mit Nachweis),
   **Wissen & Dateien** aus OneDrive/SharePoint und Anmeldung mit **Microsoft (SSO)** oder Passwort + Einmalcode, mit Rollen und Protokoll.

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
- **Anmeldung & Sicherheit:** eigene Konten statt eines gemeinsamen Passworts. **Mit Microsoft anmelden** (Entra ID, OpenID Connect
  mit PKCE; MFA, Gerätebindung und Standortregeln über Conditional Access) oder mit Passwort + **Einmalcode** (Authenticator-App,
  Pflicht; Wiederherstellungscodes). Rollen **Inhaber/in** (alles) und **Technik** (Arbeitsplatz ohne Büro/Cockpit). Sitzungen
  serverseitig und widerrufbar („Überall abmelden“, Ablauf nach 24 Stunden ohne Nutzung bzw. 7 Tagen), Bremse nach 5 Fehlversuchen,
  **Protokoll** (Anmeldungen, Tresor, Exporte, Benutzerverwaltung), Sicherheits-Header (CSP, HSTS, Frame-Schutz).
- **Wissen & Dateien:** Volltextsuche in OneDrive und SharePoint mit den Rechten der angemeldeten Person, **„Frag die
  Wissensdatenbank“** (Claude antwortet nur aus den Suchauszügen, mit Quellen), Kundenordner in der Kundenakte, Dateisuche im
  Assistenten. Vorschlag für den Aufbau: [docs/sharepoint-wissensdatenbank.md](docs/sharepoint-wissensdatenbank.md).
- **Security Awareness** (`/app/awareness`, Lernbereich `/lernen`): Selbstlernkurs „KI sicher nutzen und KI-Angriffe erkennen“
  (6 Einheiten, Übung „Echt oder Angriff?“, Quiz mit 10 Fragen, bestanden ab 80 %), **Teilnahmenachweis** zum Drucken (AI Act Art. 4,
  jährliche Auffrischung), Nachweisliste als CSV, **Impuls des Monats** (12 Texte, als Outlook-Entwurf an alle), Aushang
  **STOPP · PRÜFEN · BESTÄTIGEN** mit den Kontakten des Kunden und **Selbstbewertung** (96 Punkte, Kernfragen, Verlauf).
  Teilnehmende brauchen kein Konto – sie bekommen einen persönlichen Link (Einladung als Outlook-Entwurf oder zum Kopieren).
  Inhalte aus dem eigenen Awareness-Paket (Branch `claude/cybersecurity-ai-attacks-strategy-brtr0l`).
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
- **Kundenakte wie IT Glue/Hudu** (Kundenakte → Dokumentation, mit Navigation nach Bereichen):
  **Ansprechpartner** (wer darf freigeben, VIP), **Standorte** (Zutritt, Technikraum), **Inventar** (Seriennummer, Benutzer,
  Garantie), **WLAN**, **Domains & E-Mail**, **Microsoft 365** (MFA, Conditional Access, Notfallkonto, GDAP), **Lizenzen**,
  **Verträge** (mit Kündigungsfrist), **Anwendungen** (Hersteller-Support), **Datensicherung** (letzter Wiederherstellungstest).
  Felder kommen aus Vorlagen in [`config/records.ts`](config/records.ts) – eigene Felder oder Bereiche dort ergänzen.
  Alles verschlüsselt im Doku-Tresor; Übersicht mit Vollständigkeit, Fristen und Domain-Noten; Suche und Assistent finden alles.
- **Domain-Prüfung** (täglich und auf Knopfdruck): Mailserver, **SPF, DMARC, DKIM** und **Zertifikat** der Website – mit Note A–F
  und konkreten Hinweisen („TXT: v=spf1 include:spf.protection.outlook.com -all“). Prüft nur öffentliche DNS-Daten.
- **Fristen** über alle Kunden: Lizenzen, **spätester Kündigungstermin** von Verträgen, Garantien, Domains, Zertifikate,
  fällige Backup-Tests und Schulungs-Auffrischungen – mit „Als Aufgabe“ (zwei Wochen vorher) und Hinweis auf „Heute“.
- **Checklisten** für Onboarding, Offboarding, neuen PC, Jahreswartung, Neukunden-Übernahme und M365-Grundschutz –
  je Kunde, mit „wer hat wann abgehakt“. Vorlagen in [`config/checklists.ts`](config/checklists.ts).
- **Kunden-Gesundheit** 0–100 je Kunde aus Tickets, Warnungen, Geräten, Fristen, E-Mail-Sicherheit, Datensicherung,
  Schulungsstand und Vollständigkeit der Doku – in der Kundenliste und in der Kundenakte mit Begründung.
- **Vertrieb (aus dem ME-IT Cockpit übernommen):**
  - **Leistungen & Preise:** Katalog mit Managed Workplace, Security, Backup, NIS2, KI-Leistungen usw. (Preise anpassbar),
    je Kunde **Paket, Mitarbeiterzahl, Branche, Vertragsende und gebuchte Leistungen** – daraus der **MRR**.
  - **Umsatz-Radar:** findet regelbasiert Chancen mit €-Wert und Begründung – Support-Ende (Windows 10, Server 2012/2016,
    Exchange, Office), alte Hardware ohne Garantie, kein Managed-Vertrag, fehlendes EDR/Backup/Awareness, schwache Domain
    (SPF/DMARC), NIS2-Betroffenheit, KI-Workshop/KI-Box/KI-Mitarbeiter, Vertragsverlängerung, wiederkehrende Ticket-Themen.
  - **Angebote mit KI in drei Paketen** (Premium als Anker, Einstieg, Empfehlung): Claude wählt Leistungen aus dem Katalog und
    schreibt den Text, **gerechnet wird im Code**. Angebot zum Drucken/PDF, als Outlook-Entwurf (mit Nachfass-Aufgabe), Status;
    bei Annahme werden die laufenden Leistungen gebucht (MRR steigt).
  - **SLA-Tracking:** Reaktions- und Lösungszeiten je Paket und Priorität in Geschäftszeiten (Mo–Fr 8–17, Wien), Ampel je
    Atera-Ticket, Erfüllungsquote – fließt in die Kunden-Gesundheit ein. Zusagen in [`config/services.ts`](config/services.ts).
- **Demo-Daten** (Einstellungen, nur Inhaber/in): drei Beispielkunden mit allem – zum Ausprobieren und Vorführen, per Klick wieder weg.
- **Dokumentation je Kunde** (Kundenakte → Dokumentation, Suche über alle Kunden unter „Doku“):
  - **Doku-Tresor:** Die gesamte Dokumentation liegt verschlüsselt in der Datenbank (AES-256-GCM) und öffnet sich nur mit einem
    eigenen Doku-Passwort – zusätzlich zur Anmeldung. Beim Einrichten gibt es einen **Wiederherstellungsschlüssel** (einmalig
    angezeigt); ohne Passwort und ohne diesen Schlüssel sind die Daten nicht mehr lesbar. Nach 30 Minuten (`vault.unlockMinutes`)
    oder mit „Jetzt sperren“ ist die Doku wieder zu. Ein Datenbank-Backup allein verrät nichts über die Netze der Kunden.
  - **Netzwerk:** Geräte aus einer Bibliothek (UniFi, Securepoint, HPE/Aruba, HP, TERRA, Lenovo, Synology, QNAP, APC, AVM, LANCOM …
    mit ihren Ports) oder eigene, Netze/VLANs mit DHCP und DNS, Internetanschluss (feste IP, DHCP, PPPoE) und Verbindungen mit
    Ports, Kabelart und VLANs (untagged/tagged). Daraus entsteht automatisch ein **grafischer Plan** (Internet → Firewall → Switches
    → Geräte). Die **Prüfung läuft beim Eintippen mit**, ähnlich wie im Packet Tracer: Gateway außerhalb des WAN-Netzes, doppeltes
    NAT oder CGNAT, überschneidende Netze, doppelte VLANs, Gateway oder feste IPs im DHCP-Bereich, doppelte IPs, Geräte im falschen
    Netz, falsches VLAN am Switchport, VLAN fehlt am Uplink, doppelt belegte Ports, Geräte ohne Weg zur Firewall.
    **Weg testen** zeigt im Plan, wie ein Gerät ins Internet oder zu einem anderen Gerät kommt – und wo es scheitert
    (inkl. Hinweis auf nötige Firewall-Regel zwischen VLANs). Geräte aus Atera lassen sich übernehmen.
    **VLAN-Übersicht** je Verbindung (U/T wie Port-Profile im Switch), per Klick änderbar – die Prüfung läuft sofort mit.
  - **Patchschrank:** Schränke mit Höheneinheiten und grafischer Ansicht; Geräte mit Art, Modell, IP, Notiz; Überschneidungen werden verhindert.
  - **Verkabelung:** Patchliste (Patchfeld, Port, Dose, Raum, Switch, Switchport, VLAN, Gerät, Kabel, Notiz) mit Sofortsuche,
    **Übernahme bestehender Excel-Listen** (CSV, Spalten werden an den Überschriften erkannt) und Export als CSV.
  - **Seiten** in Markdown mit Vorlagen (Netzwerk, Server und Dienste, Datensicherung, Ansprechpartner, Notfallplan) und Vorschau.
    Hinweis, wenn eine Seite nach Passwort aussieht – Zugangsdaten gehören in Keeper.
  - **Umzug aus BookStack:** unter „Doku“ mit einem Klick alle Bücher übernehmen (Zuordnung über den Kundennamen), oder je Kunde
    ein Buch verknüpfen. Übernommene Seiten werden – wie alles andere – verschlüsselt gespeichert. Für die Übergangszeit kann die
    Verkabelung weiter nach BookStack veröffentlicht werden.
  - Der Assistent beantwortet Fragen wie „Wo hängt der Drucker bei Huber?“ aus Patchliste, Schränken, Netzwerk und Seiten und
    prüft auf Zuruf das Netz eines Kunden („Passt das Netz bei Huber?“). Ist die Doku gesperrt, sagt er das.
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

0. **KI-Zugang:** entweder `ANTHROPIC_API_KEY` (direkt bei Anthropic) oder **Claude über Azure**: in Microsoft Foundry die
   Claude-Modelle bereitstellen (Bereitstellungsname = Modellname, z. B. `claude-opus-5-5`, sonst die `*_MODEL`-Variablen
   anpassen), dann `AI_PROVIDER=azure`, `ANTHROPIC_FOUNDRY_RESOURCE` und `ANTHROPIC_FOUNDRY_API_KEY` setzen. Abrechnung und
   Vertrag laufen dann über das Azure-Abo. Verfügbare Regionen und den Datenverarbeitungsort in Foundry prüfen.
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
   0. **Ersteinrichtung:** `/admin/login` öffnen, mit `ADMIN_PASSWORD` bestätigen, eigenes Inhaber-Konto anlegen, Einmalcode
      einrichten (QR-Code mit Microsoft Authenticator scannen) und die Wiederherstellungscodes in Keeper ablegen.
      **Microsoft-Anmeldung** (empfohlen): in Entra ID eine eigene App-Registrierung „Arbeitsplatz-Anmeldung“ (Web, nur dieser Mandant),
      Redirect-URI `https://<PUBLIC_URL>/api/auth/microsoft/callback`, Client-Secret anlegen, delegierte Berechtigungen `openid`,
      `profile`, `email`, `offline_access`, `User.Read`, `Files.Read.All`, `Sites.Read.All` (Administratorzustimmung erteilen),
      `AUTH_MS_CLIENT_ID`, `AUTH_MS_CLIENT_SECRET`, `AUTH_MS_TENANT_ID` setzen. Dann eine **Conditional-Access-Richtlinie** für
      diese App: MFA (am besten phishing-resistent: Passkey/FIDO2 oder Authenticator mit Nummernabgleich), optional nur konforme Geräte.
      Mitarbeitende unter Einstellungen → Benutzer mit ihrer Microsoft-365-Adresse anlegen – erst dann kommen sie hinein.
   1. In Atera unter Admin → API einen API-Schlüssel erzeugen und als `ATERA_API_KEY` setzen.
   2. `/api/cron/atera` alle 5 Minuten aufrufen. Der erste Abgleich legt die Kunden an.
   3. Outlook: dieselbe App-Registrierung wie beim E-Mail-Assistenten. Für Termine `Application Calendars.ReadWrite`, für Entwürfe
      `Application Mail.ReadWrite` (beides per RBAC für Anwendungen nur auf das eigene Postfach). Für die einmalige Übernahme aus
      Microsoft To Do zusätzlich `Tasks.Read.All` (gilt mandantenweit – danach wieder entfernen).
   4. **Doku-Tresor:** beim ersten Öffnen von „Doku“ ein Doku-Passwort (mind. 12 Zeichen) festlegen. Den angezeigten
      Wiederherstellungsschlüssel ausdrucken oder in Keeper ablegen – er ist der einzige Weg zurück, wenn das Passwort fehlt.
      Bereits vorhandene Doku wird dabei verschlüsselt. `SESSION_SECRET` danach nicht mehr ändern (sonst nur neu entsperren nötig,
      die Daten bleiben lesbar).
   5. Umzug aus BookStack: im BookStack-Profil einen API-Token anlegen (Rolle mit „Zugriff auf die System-API“) und
      `BOOKSTACK_URL`, `BOOKSTACK_TOKEN_ID`, `BOOKSTACK_TOKEN_SECRET` setzen. Dann unter „Doku“ → „Alles aus BookStack übernehmen“
      (Bücher müssen wie der Kunde heißen) oder je Kunde unter Dokumentation → BookStack das Buch verknüpfen.
   6. `config/workspace.ts` anpassen: Name, Aufgabenlisten, Atera-Ticket-Link, ob der Ticketstatus geändert werden darf,
      Startmonat des Awareness-Jahresplans, Adresse der SharePoint-Wissensdatenbank.
   7. Pro Kunde im Arbeitsplatz E-Mail, Adresse, E-Mail-Domains und den Keeper-Link (geteilter Ordner) hinterlegen.
   8. Feldnamen der Atera-API sind nach Atera-Doku v3 umgesetzt und gegen eine nachgebaute API getestet –
      beim ersten echten Abgleich kurz prüfen, ob Tickets, Warnungen und Geräte vollständig ankommen.
10. **Regelmäßige Aufgaben** (alle mit `Authorization: Bearer $CRON_SECRET`, z. B. per Server-Cron oder Vercel Cron):

   | Route | Rhythmus | Zweck |
   |---|---|---|
   | `/api/cron/mail` | alle 5 Minuten | Postfach abrufen, Belege ablegen, Outlook-Entwürfe abgleichen |
   | `/api/cron/atera` | alle 5 Minuten | Kunden, Tickets, Warnungen und Geräte aus Atera |
   | `/api/cron/reminders` | stündlich | Terminerinnerungen |
   | `/api/cron/followups` | täglich morgens | Nachfass-Entwürfe |
   | `/api/cron/report` | am 1. des Monats | Monatsbericht an `REPORT_EMAIL` (sonst `TEAM_NOTIFY_EMAIL`) |
   | `/api/cron/checks` | täglich morgens | Domains der Kunden prüfen (SPF, DMARC, DKIM, Zertifikat) |

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
- [ ] Arbeitsplatz: Ticketverläufe und Kundennotizen gehen für Zusammenfassungen an Anthropic bzw. Azure – Auftragsverarbeitung prüfen,
      in Notizen keine Zugangsdaten ablegen (dafür ist Keeper da).
- [ ] **GitHub-Repository auf „privat“ stellen** (Settings → General → Danger Zone → Change visibility). Es enthält keine
      Zugangsdaten, aber Aufbau und Sicherheitsmechanismen des Arbeitsplatzes.
- [ ] Ersteinrichtung erledigt, Einmalcode und Wiederherstellungscodes gesichert; Microsoft-Anmeldung mit Conditional Access (MFA).
- [ ] Awareness für Kunden: Namen und E-Mail-Adressen der Teilnehmenden und Lernstände werden im Auftrag des Kunden verarbeitet –
      Auftragsverarbeitungsvertrag mit dem Kunden; beim eigenen Team ggf. Betriebsrat informieren (Lernstände sind Leistungsdaten).
- [ ] Doku-Tresor eingerichtet, Wiederherstellungsschlüssel sicher abgelegt (nicht auf demselben Server). Doku-Inhalte gehen nur an
      die KI, wenn der Assistent danach gefragt wird und die Doku entsperrt ist.

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
lib/users.ts, lib/auth.ts  Konten, Rollen, Sitzungen, Einmalcodes (TOTP), Anmeldebremse, Protokoll
lib/entra.ts             Anmeldung mit Microsoft (OpenID Connect, PKCE) und delegierte Token
lib/m365.ts              OneDrive/SharePoint mit den Rechten der angemeldeten Person (Suche, Ordner)
lib/awareness/           Security Awareness: Inhalte (aus dem Awareness-Paket), Lernende, Fortschritt, Quiz, Selbstbewertung
app/lernen/              Lernbereich für Teilnehmende (persönlicher Link, ohne Konto)
lib/workspace/vault.ts   Doku-Tresor: Schlüsselableitung (scrypt), Verschlüsselung (AES-256-GCM), Entsperren
config/records.ts        Feldvorlagen der Kundenakte (Ansprechpartner, Inventar, Domains, Lizenzen, Verträge …)
config/checklists.ts     Checklisten-Vorlagen (Onboarding, Offboarding, Wartung …)
lib/workspace/records.ts Einträge der Kundenakte (verschlüsselt), Fristen
lib/checks/              Domain-Prüfung (DNS, TLS)
lib/workspace/health.ts  Kunden-Gesundheit
config/services.ts       Leistungskatalog (Startwerte), Pakete, SLA-Zusagen
lib/workspace/catalog.ts Katalog, gebuchte Leistungen, MRR
lib/workspace/quotes.ts  Angebots-Agent, drei Pakete
lib/radar.ts             Umsatz-Radar
lib/sla.ts               SLA in Geschäftszeiten
lib/lifecycle.ts         Support-Ende von Windows, Server, Exchange, Office
lib/demo.ts              Demo-Daten
lib/network/             Netzwerkdokumentation: IP-Rechnen, Gerätebibliothek, Prüfung, Wegverfolgung, Plan-Anordnung
lib/ai-client.ts         Claude-Zugang direkt bei Anthropic oder über Azure (Microsoft Foundry)
lib/bookstack.ts         BookStack-API (Bücher, Seiten, Suche)
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
