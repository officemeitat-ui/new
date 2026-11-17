# Dokumentenprozess mit Microsoft 365 (Outlook · SharePoint · OneDrive)

Ziel: **Kein Dokument wird mehr händisch gespeichert, umbenannt oder weitergeleitet.**
Rechnungen, Angebote, Berichte und Eingangsbelege entstehen bzw. landen automatisch im ME-IT-Design
im richtigen Ordner – lokal, in SharePoint und über den OneDrive-Client im Explorer von dir und deinem
Steuerberater.

## Der Ablauf

```
 Eingang                          ME-IT Cockpit                          Ablage
 ───────                          ─────────────                          ──────
 Outlook-Postfach ──► KI-Mitarbeiter erkennt „Rechnung“ ──► Beleg (Lieferant, Nr., Betrag)
 (Lieferanten-PDF)        │                                   │
                          └──────────── PDF ─────────────────►│ Buchhaltung/Eingangsrechnungen/2026/11-November
 Beleg-Upload (Scan) ─────────────────────────────────────────┘

 Ausgang
 ───────
 Rechnungslauf ──► Entwurf ──► „Stellen“ ──► PDF im ME-IT-Design ──► Buchhaltung/Ausgangsrechnungen/2026
                                   │                              └► Kunden/<Kunde>/Rechnungen/2026
                                   └► „Senden“ ──► Outlook (PDF + ebInterface-XML, Mail im CD) ─► Gesendete Elemente
 Angebot (KI) ──► PDF ──► „Senden“ ──► Status „versendet“ + Nachfass-Automatik ──► Kunden/<Kunde>/Angebote/2026
 Monatsbericht · QBR · Security-Check ──► „Als PDF ablegen“ ──► Kunden/<Kunde>/Berichte/2026

                         SharePoint-Bibliothek „ME-IT“ ◄── Upload über Microsoft Graph
                                   │
                                   └── OneDrive-Client „Synchronisieren“ → Explorer (du + Steuerberater)
```

| Schritt | Was passiert automatisch | Wo |
|---|---|---|
| Eingangsrechnung per Mail | Kategorie „Beleg“, Daten ausgelesen, PDF abgelegt | Belege, Dokumente |
| Papierrechnung / Scan | „PDF hochladen“ unter Belege → wie oben | Belege |
| Rechnung stellen | fortlaufende Nummer, PDF erzeugt, abgelegt (Buchhaltung + Kunde) | Abrechnung → Rechnungen |
| Rechnung senden | Mail über dein Postfach, PDF + E-Rechnung im Anhang, Kopie an Buchhaltung möglich | Abrechnung → „Senden“ |
| Angebot senden | PDF + Mail, Status „versendet“, KI bereitet nach `FOLLOWUP_DAYS` (Standard 5) Tagen das Nachfassen vor | Angebote → „Senden“ |
| Bericht / QBR / Security-Check | PDF im CD in den Kundenordner | Kunde → Buttons im Bericht |
| Upload fehlgeschlagen | lokale Kopie bleibt gültig, ein Klick wiederholt | Dokumente → „Upload-Fehler ↻“ |

## Ordnerstruktur (Standard, in den Einstellungen änderbar)

```
ME-IT/
├── Buchhaltung/
│   ├── Ausgangsrechnungen/2026/Rechnung_2026-0001_Tischlerei_Huber_GmbH.pdf
│   └── Eingangsrechnungen/2026/11-November/2026-11-03_A1_Telekom_2026-4711.pdf
└── Kunden/
    └── Tischlerei Huber GmbH/
        ├── Angebote/2026/Angebot_A-0001_Managed_Firewall.pdf
        ├── Berichte/2026/2026-11-17_Monatsbericht_2026-10_–_Tischlerei_Huber_GmbH.pdf
        └── Rechnungen/2026/Rechnung_2026-0001_Tischlerei_Huber_GmbH.pdf
```

Platzhalter: `{kunde}`, `{jahr}`, `{monat}` (z. B. `11-November`). Ungültige Zeichen für SharePoint/Windows
(`" * : < > ? / \ | # %`) werden automatisch entfernt. Einen Ordner leer lassen = diese Kopie nicht anlegen
(z. B. die Rechnungskopie im Kundenordner).

## Einrichtung in 15 Minuten

### Variante A – nur lokal / OneDrive-Client (ohne Admin-Rechte)
1. In der `.env` `ARCHIVE_DIR` auf einen synchronisierten OneDrive-Ordner zeigen lassen, z. B.
   `ARCHIVE_DIR=C:\Users\office\OneDrive - ME-IT\Archiv`
2. App neu starten. Fertig – alle PDFs landen über den OneDrive-Client in der Cloud.

### Variante B – SharePoint/OneDrive über Microsoft Graph (empfohlen)
Es wird **dieselbe App-Registrierung** genutzt wie für das Postfach (siehe `docs/KI-MITARBEITER.md`).

1. **Entra Admin Center → App-Registrierungen → ME-IT Cockpit → API-Berechtigungen**
   - für Mail: `Mail.ReadWrite`, `Mail.Send` (Anwendung) – vorhanden, falls der Posteingang schon läuft
   - für Dokumente **eine** der beiden Varianten (Anwendung, Administratorzustimmung erteilen):
     - **`Sites.Selected`** (empfohlen, Least Privilege) – danach die App für genau *eine* Site freigeben:
       ```powershell
       # PnP.PowerShell, als SharePoint-Admin
       Connect-PnPOnline -Url https://firma.sharepoint.com/sites/ME-IT -Interactive
       Grant-PnPAzureADAppSitePermission -AppId <CLIENT_ID> -DisplayName "ME-IT Cockpit" `
         -Site https://firma.sharepoint.com/sites/ME-IT -Permissions Write
       ```
     - `Files.ReadWrite.All` – einfacher, aber Zugriff auf alle Sites/OneDrives des Tenants.
2. In der `.env`: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` (wie beim Postfach).
3. Im Cockpit: **Einstellungen → Dokumentenablage & Versand**
   - Ablageziel **SharePoint**, Site z. B. `https://firma.sharepoint.com/sites/ME-IT`
     (Bibliothek leer = „Dokumente“) – oder **OneDrive** mit der E-Mail des Besitzers
   - Hauptordner `ME-IT`, Kopie an (z. B. Buchhaltung/Steuerberater)
   - **Speichern & Verbindung testen**
4. In SharePoint die Bibliothek öffnen → **Synchronisieren** (bzw. „Verknüpfung zu Meine Dateien hinzufügen“),
   den Steuerberater als Gast mit *Lesen* auf `Buchhaltung` berechtigen.

### Versand über Outlook
Mit `MAIL_PROVIDER=graph` gehen Rechnungen und Angebote über `sendMail` aus deinem Postfach
(`GRAPH_MAILBOX`) – sie stehen in **Gesendete Elemente**, Antworten des Kunden landen wieder im Posteingang
des Cockpits. Mit IMAP/SMTP funktioniert der Versand genauso.

Die Mail ist im ME-IT-Design (Logo, Farben, Claim „sicher | innovativ | persönlich“, Kontaktdaten).
Betreff und Text sind in den Einstellungen anpassbar, Platzhalter:
`{anrede} {nummer} {betrag} {faellig} {firma} {kunde} {titel}`.

## Technik & Sicherheit

- **PDF-Erzeugung offline** (fpdf2, reines Python) – kein Cloud-Dienst, kein Browser nötig.
  Schrift Roboto eingebettet (Apache-2.0), Logo und Farben aus *Einstellungen → Corporate Design*.
- **Upload**: bis 4 MB direkt, größere Dateien per Upload-Session in 5-MB-Blöcken.
  Gleichnamige Dateien werden ersetzt (z. B. erneut erzeugte Rechnung).
- **Fehlertoleranz**: die lokale Ablage ist immer die Quelle; schlägt der Upload fehl (Netz, Berechtigung),
  wird das Dokument als „Upload-Fehler“ markiert und kann gesammelt wiederholt werden.
- **Datensicherung**: jede Sicherung spiegelt das Archiv inkrementell nach `backups/archiv`
  (es wird dort nie gelöscht).
- **Aufbewahrung**: Rechnungen und Belege 7 Jahre (§ 132 BAO). Empfehlung: in SharePoint für
  `Buchhaltung` eine Aufbewahrungsrichtlinie (Microsoft Purview, 7 Jahre) setzen – dann kann auch
  versehentlich nichts gelöscht werden.
- **E-Rechnung**: ebInterface 6.1 (Pflicht bei Rechnungen an den Bund, Upload über e-rechnung.gv.at oder
  per Mail-Anhang) – das XML hängt automatisch an der Rechnungsmail, sofern die Daten vollständig sind.
- **Datenschutz**: Dokumente bleiben in deinem Microsoft-365-Tenant (EU-Datengrenze) bzw. auf dem ME-IT-PC.
  Die KI liest Belege lokal (Ollama), es geht nichts an Dritte.

## Als Produkt für Kunden

Derselbe Prozess ist ein verkaufbares Paket für deine Kunden (KMU mit M365):
„**Digitale Belegablage**“ – Eingangsrechnungen aus Outlook automatisch in SharePoint, Ordnerstruktur
für den Steuerberater, Aufbewahrungsrichtlinie, Schulung. Einrichtung 1–2 h + monatliche Betreuung.
