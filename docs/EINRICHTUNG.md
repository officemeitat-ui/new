# Einrichtung: app.cleanos.at mit Ablage in SharePoint

Die Cleanos App (Dienstplan, Zählerstände, Objektkontrolle, Objektmappe, Fahrzeuge) ist eine reine Web-App (HTML/JavaScript). Sie braucht **keinen eigenen Server und keine Datenbank**: Anmeldung nur mit dem Firmenkonto (Microsoft 365, Tenant `a31131f2-4ccf-4eb2-ab3d-49c923c6bede` für cleanos.at / cleanconcept1), Daten als Dateien in der SharePoint-Bibliothek `Cleanos_Daten`, Zugriff über Microsoft Graph. Dauer der Einrichtung: etwa eine Stunde, Administratorrechte für Microsoft 365 und Zugang zur DNS-Verwaltung von cleanos.at nötig.

```
Browser (app.cleanos.at)
   │  1. Seite nur nach Microsoft-Anmeldung mit Firmenkonto (eigener Tenant, keine Gäste)
   │  2. dieselbe Anmeldung holt das Graph-Token (MSAL, ohne zweite Eingabe)
   │  3. Microsoft-Gruppen im Token → Rolle → sichtbare Bereiche und lesbare Ordner
   ▼
Microsoft Graph ──► SharePoint cleanconcept1 → Bibliothek Cleanos_Daten → Plattform/
                         ├─ objekte/objekte.json          Objekte (alle Gruppen lesen)
                         ├─ daten/stammdaten.json         Mitarbeitende, Leistungen, Regeln
                         ├─ daten/plaene/2026/2026-10-26.json   Einteilung + Protokoll je Woche
                         ├─ personal/abwesenheiten.json   Urlaub, Krankenstand (nur Vollzugriff)
                         ├─ lohn/zeitkonto.json           Salden, Löhne (nur Vollzugriff, Lohn)
                         ├─ zaehler/ kontrolle/ objektmappe/ fahrzeuge/   je Modul, mit Fotos
                         └─ exporte/2026/KW44_2026/       Excel- und PDF-Wochenpläne
```

Jeder Ordner bekommt in SharePoint die Rechte der passenden Microsoft-Gruppe (Schritt 1). Wer welche Bereiche sieht, steht in [PLATTFORM.md](PLATTFORM.md#rollen).

SharePoint führt für jede Datei einen **Versionsverlauf**. Jede frühere Fassung lässt sich dort wiederherstellen.

## 1. SharePoint-Website vorbereiten

1. Die vorhandene Ablage der bisherigen Werkzeuge wird weiter genutzt: `https://cleanconcept1.sharepoint.com`, Bibliothek **Cleanos_Daten**. Den Ordner `Plattform` mit seinen Unterordnern legt die App beim ersten Start mit Vollzugriff selbst an.
2. **Microsoft-Gruppen anlegen** (Entra ID → Gruppen, Typ Sicherheit): „App Cleanos – Vollzugriff“, „App Cleanos – Objektmanagement“, „App Cleanos – Vorarbeiter“, Mitglieder eintragen. Objekt-IDs notieren (Schritt 3).
3. **Ordnerrechte setzen** (Schritt 1): nach dem ersten Start je Unterordner von `Plattform` die Vererbung beenden und nur die Gruppen laut Tabelle in [PLATTFORM.md](PLATTFORM.md#daten-wirklich-trennen-sharepoint-rechte-je-ordner) eintragen. Die App zeigt dieselbe Tabelle unter **Stammdaten → Berechtigungen**.

Ohne passende SharePoint-Rechte kommt niemand an die Daten, auch nicht mit einem anderen Programm. Die App selbst fragt zusätzlich nur die Ordner an, die die eigene Gruppe braucht.

## 2. App in Entra ID registrieren

Im [Microsoft Entra Admin Center](https://entra.microsoft.com) → *Identität → Anwendungen → App-Registrierungen → Neue Registrierung*:

| Feld | Wert |
|---|---|
| Name | Cleanos App |
| Unterstützte Kontotypen | Nur Konten in diesem Organisationsverzeichnis (einzelner Mandant) |
| Umleitungs-URI | Plattform **Single-Page-Anwendung (SPA)**: `https://app.cleanos.at/` |

Danach:

1. Unter *Authentifizierung* eine zweite SPA-URI für Tests ergänzen: `http://localhost:8080/`
2. Ebenfalls unter *Authentifizierung*: Plattform **Web** hinzufügen mit der Umleitungs-URI `https://app.cleanos.at/.auth/login/aad/callback` und **ID-Token** aktivieren. Das ist die Anmeldung, die die ganze Seite schützt (Schritt 4).
3. Unter *Zertifikate & Geheimnisse*: einen **geheimen Clientschlüssel** anlegen (für den Seitenschutz in Azure Static Web Apps).
4. Unter *API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → Delegierte Berechtigungen*: **User.Read** und **Sites.ReadWrite.All**, für den E-Mail-Versand zusätzlich **Mail.Send** (oder **Mail.Send.Shared** für ein gemeinsames Postfach, siehe unten), für Nachkontrollen direkt im Outlook-Kalender **Calendars.ReadWrite** (nur mit `features.calendar`). Anschließend **Administratorzustimmung erteilen**.
5. Unter *Tokenkonfiguration → Gruppenanspruch hinzufügen*: **Sicherheitsgruppen**, beim ID-Token „Gruppen-ID“. Damit kommen die Microsoft-Gruppen ins Token und die App weiß, wer was darf.
6. Von der *Übersicht* die **Anwendungs-ID (Client)** notieren. Die Verzeichnis-ID ist schon eingetragen (`a31131f2-4ccf-4eb2-ab3d-49c923c6bede`).
7. Empfohlen: unter *Unternehmensanwendungen → Cleanos App → Eigenschaften* **Zuweisung erforderlich = Ja** und unter *Benutzer und Gruppen* die drei Gruppen zuweisen (Gruppen zuweisen braucht Entra ID P1, sonst die Personen einzeln). Dann kann sich niemand sonst aus dem Tenant überhaupt anmelden. Wer angemeldet ist, aber keiner Gruppe angehört, sieht in der App nichts und lädt keine Daten.
8. Alternativ zu den Gruppen-IDs: App-Rollen anlegen (`disposition`, `objektmanagement`, `vorarbeiter`, …) und den Gruppen zuweisen, siehe [PLATTFORM.md](PLATTFORM.md#variante-mit-app-rollen-entra-id-p1-z-b-microsoft-365-business-premium).

Delegiert heißt: Die App darf nur, was die angemeldete Person in SharePoint ohnehin darf. Wer keinen Zugriff auf die Dienstplan-Website hat, sieht auch in der App nichts.

> Strengere Variante: Statt *Sites.ReadWrite.All* lässt sich *Sites.Selected* verwenden. Dann wird der App per Graph nur genau die Dienstplan-Website freigegeben. Das ist etwas aufwändiger und braucht ein PowerShell- oder Graph-Skript.

## 3. config.production.json ausfüllen

`config.json` enthält alles Gemeinsame (Marke, SharePoint-Adresse, Tenant). `config.production.json` enthält, was nur im Betrieb auf app.cleanos.at gilt; `npm run build` legt beides zusammen nach `dist/config.json`. Einzutragen ist nur noch die Anwendungs-ID und die Gruppen:

```json
{
  "storage": "sharepoint",
  "demo": false,
  "migrateLegacy": false,
  "sharepoint": { "clientId": "ANWENDUNGS-ID", "allowGuests": false },
  "access": {
    "planners": ["office@cleanos.at", "it@cleanos.at"],
    "groups": {
      "disposition": ["Objekt-ID Gruppe Vollzugriff"],
      "objektmanagement": ["Objekt-ID Gruppe Objektmanagement"],
      "vorarbeiter": ["Objekt-ID Gruppe Vorarbeiter"]
    }
  }
}
```

Aus `config.json` gelten dazu: `"tenantId": "a31131f2-4ccf-4eb2-ab3d-49c923c6bede"`, `"siteUrl": "https://cleanconcept1.sharepoint.com"`, `"library": "Cleanos_Daten"`, `"folder": "Plattform"`.

- `sharepoint.allowGuests`: `false` = nur Konten aus dem eigenen Tenant; Gastkonten (B2B) und fremde Konten sehen „Anmeldung nicht möglich“.
- `access.groups`: je Rolle die Objekt-IDs der Microsoft-Gruppen. Wer in keiner Gruppe ist und nicht in `planners` steht, bekommt keinen Zugriff.
- Statt in die Datei kann die Anwendungs-ID auch als Umgebungsvariable `ENTRA_CLIENT_ID` kommen (GitHub: *Settings → Secrets and variables → Actions → Variables*).
- Zum Ausprobieren mit Beispieldaten ohne SharePoint: `DIENSTPLAN_DEMO=1 npm run build`.
- `access.planners`: E-Mail-Adressen mit Vollzugriff (Rolle `disposition`), auch ohne Gruppe. Im Betrieb sieht, wer weder hier steht noch einer Gruppe angehört, nichts.
- `access.members`, `access.roles`: Rollen per E-Mail-Liste und eigene Rollen, siehe [PLATTFORM.md](PLATTFORM.md). Rollen aus Entra ID (App-Rollen) wirken ohne Eintrag hier.
- Ablage gemeinsam mit den bisherigen Werkzeugen: `"siteUrl": "https://cleanconcept1.sharepoint.com"`, `"library": "Cleanos_Daten"`, `"folder": "Plattform"`. Ein Unterordner je Berechtigung (`objekte/`, `daten/`, `personal/`, `lohn/`, `zaehler/`, `kontrolle/`, `objektmappe/`, `fahrzeuge/`, `exporte/`), jeder mit eigenen SharePoint-Rechten.
- `refreshSeconds`: wie oft die App prüft, ob jemand anderes gespeichert hat. Ohne Netz Erfasstes wird zusätzlich sofort gespeichert, sobald wieder Netz da ist.
- `sharepoint.sources`: Ordner der bisherigen Werkzeuge in derselben Bibliothek, für **Daten → Bisherige Werkzeuge → In SharePoint suchen** (siehe [PLATTFORM.md](PLATTFORM.md)). Nur ändern, wenn die Ordner anders heißen.
- `features.pdf`: PDF-Wochenpläne (Download, Teilen, beim Veröffentlichen nach SharePoint in den Ordner `PDF`).
- `features.mail`: Wochenpläne per E-Mail mit PDF-Anhang direkt aus dem Dienstplan. Gesendet wird aus dem Postfach der angemeldeten Person. Mit `mail.from` (z. B. `dienstplan@cleanos.at`) aus einem freigegebenen Postfach: dafür braucht die Disposition dort die Berechtigung „Senden als“ und die App **Mail.Send.Shared**. Die E-Mail-Adressen stehen bei den Mitarbeitenden.
- `features.calendar`: Nachkontrollen mit einem Klick in den eigenen Outlook-Kalender (ganztägig, Erinnerung am Vortag). Braucht **Calendars.ReadWrite** mit Administratorzustimmung, sonst scheitert die Anmeldung; deshalb standardmäßig aus. Ohne diese Einstellung gibt es den Termin als .ics-Datei, die sich ebenfalls in Outlook öffnet.
- `brand.contact`: Satz unten auf jedem PDF, z. B. „Fragen zum Dienstplan: Disposition, Tel. …“.
- `brand.colors`, `brand.logoOnLight`: Markenfarben und Logo für die PDFs (Cleanos-Blau `#0c6cb4`, Grün `#9cc654`).
- `brand.theme`, `brand.themes`: Farbschema für alle und die wählbaren Marken-Farbschemata (`cleanos`, `cleanos-nacht`). Jede Person kann unter „Darstellung“ für ihr Gerät ein anderes Schema, hell/dunkel und die Schriftgröße wählen (siehe README, Corporate Design und Darstellung).
- `dist/config.json` kann jederzeit am Server geändert werden (z. B. eine neue Gruppen-ID), ohne neuen Build.

## 4. Hosting auf app.cleanos.at

Erst `npm ci && npm run build` ausführen. Der Ordner `dist/` enthält dann alles, was auf den Server muss.

### Variante A: Azure Static Web Apps (empfohlen)

1. Im Azure-Portal eine *Static Web App* anlegen (Tarif **Standard**, Region Westeuropa). Als Quelle „Andere“ wählen. Der Standard-Tarif (rund 9 USD im Monat) ist nötig, damit sich **nur Konten aus dem eigenen Tenant** anmelden können.
2. Unter *Umgebungsvariablen* zwei Werte anlegen: **AZURE_CLIENT_ID** = Anwendungs-ID aus Schritt 2, **AZURE_CLIENT_SECRET** = der geheime Clientschlüssel.
3. Unter *Bereitstellungstoken verwalten* den Token kopieren und im GitHub-Repository als Secret **AZURE_STATIC_WEB_APPS_API_TOKEN** speichern, die Verzeichnis-ID als Variable **ENTRA_TENANT_ID** (*Settings → Secrets and variables → Actions → Variables*). Ab dann veröffentlicht `.github/workflows/ci.yml` jeden Stand auf `main` automatisch, nachdem die Tests grün sind.
4. Unter *Benutzerdefinierte Domänen*: `app.cleanos.at` hinzufügen. Beim DNS-Anbieter von cleanos.at einen **CNAME** `app` → `<name>.azurestaticapps.net` anlegen. Azure stellt das HTTPS-Zertifikat selbst aus.
5. Optional: die alten Adressen weiterleiten, z. B. `wasserzaehler.cleanos.at` → `https://app.cleanos.at/#zaehler`, `pruefprotokoll.cleanos.at` → `#kontrolle`, `objektdoku.cleanos.at` → `#objektmappe`.
6. `staticwebapp.config.json` setzt Sicherheitsheader (Content-Security-Policy) und den Seitenschutz. Diese sind mit dem Build getestet.

**So ist die Seite geschützt:** Jede Datei (auch `index.html`, `config.json` und der Programmcode) wird erst nach der Microsoft-Anmeldung ausgeliefert. `npm run build` trägt die Tenant-ID aus `config.json` (oder `ENTRA_TENANT_ID`) ein, damit lassen nur Konten des eigenen Tenants die Seite überhaupt laden. Danach meldet die App dieselbe Person ohne zweite Eingabe bei Microsoft Graph an und prüft noch einmal: Gastkonten und fremde Konten werden abgewiesen. Abmelden: Knopf „Abmelden“ (löscht auch die Kopie der Daten im Gerät) oder `https://app.cleanos.at/logout`.

- Nur für eine öffentliche Demo mit Beispieldaten: `DIENSTPLAN_PUBLIC=1 npm run build`.

### Variante B: vorhandener Webspace

`dist/` per FTP/SFTP in das Verzeichnis der Subdomain `app.cleanos.at` laden. Voraussetzungen: **HTTPS** (z. B. Let's Encrypt). Ohne HTTPS funktioniert die Microsoft-Anmeldung nicht. `config.json` und `index.html` dürfen nicht im Cache liegen, die Dateien unter `app/` dürfen dauerhaft gecacht werden (Name enthält einen Hash). Die Sicherheitsheader aus `staticwebapp.config.json` sollten sinngemäß in `.htaccess` oder der Serverkonfiguration gesetzt werden.

Auf einem normalen Webspace ist der Programmcode öffentlich abrufbar; die **Daten** sind trotzdem nur nach Microsoft-Anmeldung und nur für Konten mit Zugriff auf die SharePoint-Website lesbar. Wer auch den Code hinter die Anmeldung legen will, nimmt Variante A (oder Azure App Service mit „Authentifizierung“).

## 5. Erster Start

1. `https://app.cleanos.at` öffnen und mit office@ oder it@ (Vollzugriff) anmelden. Die App legt die Ordner unter `Plattform/` an; danach die Ordnerrechte setzen (Schritt 1).
2. Die Ablage ist leer, die App zeigt „Willkommen“. Daten aus den bisherigen Werkzeugen: **Daten → Bisherige Werkzeuge → In SharePoint suchen** ([PLATTFORM.md](PLATTFORM.md#übernahme-aus-den-bisherigen-werkzeugen)).
   - **Mitarbeitende einfügen:** In Excel die Liste mit Überschrift kopieren (Name, Beschäftigung, Wochenstunden, Team, Qualifikationen, Tage, Von, Bis) und einfügen.
   - **Objekte & Leistungen einfügen:** Objekt, Adresse, Revier, Leistung, Tage, Von, Bis, Personen, Stammkraft, Intervall („wöchentlich“, „14-tägig“, „monatlich“, „quartalsweise“, „halbjährlich“, „jährlich“; monatliche Leistungen finden am ersten genannten Wochentag im Monat statt und lassen sich danach unter „Objekte & Leistungen“ genauer einstellen), An Feiertagen (leer = findet statt mit Feiertagszuschlag; „entfällt“, wenn der Kunde geschlossen hat; „verschieben“), optional Fahrzeit danach (z. B. „0,5“ oder „30 min“) und Fahrtnotiz.
   - Mit „Vorlage kopieren“ bekommt man die Überschriften für Excel.
   - **Zuweisen:** Unter *Zuweisung* jeder Leistung ohne Stammkraft eine feste Person geben (Vorschlag übernehmen oder „Alle Vorschläge übernehmen“). Die Auslastung zeigt, wer noch Stunden frei hat. Oder von der Person aus: auf den Namen klicken, Objekt aus der Liste wählen, Leistungen zuweisen.
3. **Müllpläne:** Unter *Objekte & Leistungen* beim Objekt „Objekt bearbeiten“ → *Müllplan*. Abfuhrtage als Rhythmus eintragen (Tonne, z. B. „14-tägig“, und ein bekannter Abfuhrtermin) oder den Abfuhrkalender einlesen: Die meisten Gemeinden und Entsorger bieten ihn online als Kalenderdatei (.ics, „in Kalender exportieren“) an. Datei wählen oder die Termine einfügen (eine Zeile je Termin, z. B. „03.11.2026 Restmüll“). Dazu einstellen, ob die Tonnen am Vorabend oder in der Früh rausgestellt werden und ob jemand sie wieder reinstellt. „Woche planen“ teilt die Gänge danach mit ein, die Ansicht *Müllplan* zeigt, wer wann zuständig ist. Abfuhrkalender gelten meist für ein Jahr: im Dezember den neuen einlesen.
4. **Löhne und Überstunden:** Unter *Mitarbeitende* je Person die Lohngruppe (oder einen eigenen Stundenlohn) eintragen und, falls abweichend, wie Überstunden und Mehrarbeit behandelt werden. Unter *Regeln* die KV-Stundenlöhne und Zuschlagssätze mit der Lohnverrechnung abstimmen. Am Monatsende unter *Überstunden & Auszahlung* prüfen, je Person auszahlen oder Zeitausgleich wählen, „Monat abschließen“. Danach öffnet sich „Auszahlungen versenden“: einmal die Adresse der Lohnverrechnung eintragen (wird gemerkt), Sammel-E-Mail mit PDF und CSV senden und auf Wunsch jeder Person ihre Aufstellung schicken (Mail.Send wie beim Versand der Wochenpläne).
5. Unter *Regeln & Feiertage* Werte aus dem Kollektivvertrag prüfen (Zuschläge, Fahrzeit, Mehrstunden für Vertretungen) und betriebsfreie Tage eintragen, an denen der Betrieb geschlossen ist. An gesetzlichen Feiertagen wird gearbeitet; Leistungen, die früher auf „entfällt“ standen, stellt ein Knopf unter „Gesetzliche Feiertage“ auf einmal auf „findet statt“ um.
6. Die Leiste oben führt durch die Woche: *Einteilen* → *Offene Einsätze* → *Prüfen* → *Veröffentlichen* → *Versenden*. Excel- und PDF-Wochenpläne liegen danach in `Plattform/exporte/…`, der Versand-Dialog schickt jeder Person ihr PDF (E-Mail, am Handy „Teilen“ z. B. per WhatsApp, oder als ZIP/Sammel-PDF zum Ausdrucken).

## 6. Am Handy und Tablet

`https://app.cleanos.at` im Browser öffnen und mit dem Firmenkonto anmelden. Als App auf den Startbildschirm legen:

- **iPhone/iPad:** in Safari „Teilen“ → „Zum Home-Bildschirm“
- **Android:** im Chrome-Menü „App installieren“ (oder im Dienstplan unter „Mehr“ → „Als App installieren“)
- **Windows/Mac:** in Edge oder Chrome das Installieren-Symbol in der Adressleiste

Alle Geräte arbeiten mit denselben Daten in SharePoint. Ändert jemand am PC, sieht man es am Handy beim nächsten Öffnen der App sofort. Im Betrieb steht deshalb `"storage": "sharepoint"` in `config.production.json`; im Browser-Modus (`"local"`, nur zum Ausprobieren) bleiben die Daten auf dem jeweiligen Gerät.

## 7. Testen ohne SharePoint

`npm start` und `http://localhost:8080` öffnen. `config.json` allein speichert im Browser und startet mit Beispieldaten (35 Mitarbeitende, 4 veröffentlichte Wochen). Oben „Ansicht als …“ zeigt, was Objektmanagement, Vorarbeiter usw. sehen.

## Datenschutz und Betriebsrat

- Krankenstände sind Gesundheitsdaten. Die App speichert nur „Krankenstand von–bis“, keine Diagnosen, im eigenen Ordner `personal/`, den nur Vollzugriff öffnen darf.
- Ein elektronisches System zur Planung und Auswertung von Arbeitszeiten kann in Österreich eine **Betriebsvereinbarung** erfordern (§ 96a ArbVG), sofern es einen Betriebsrat gibt.
- Keine Alarmcodes oder Passwörter in die Objektmappe schreiben.
