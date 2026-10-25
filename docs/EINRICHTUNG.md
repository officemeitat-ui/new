# Einrichtung: dienstplan.cleanos.at mit Ablage in SharePoint

Der Dienstplan ist eine reine Web-App (HTML/JavaScript). Sie braucht **keinen eigenen Server und keine Datenbank**: Anmeldung über Microsoft 365, Daten als Dateien in einer SharePoint-Bibliothek. Dauer der Einrichtung: etwa eine Stunde, Administratorrechte für Microsoft 365 und Zugang zur DNS-Verwaltung von cleanos.at nötig.

```
Browser (dienstplan.cleanos.at)
   │  1. Seite nur nach Microsoft-Anmeldung (Azure Static Web Apps, eigener Tenant)
   │  2. dieselbe Anmeldung holt das Graph-Token (MSAL, ohne zweite Eingabe)
   ▼
Microsoft Graph ──► SharePoint-Website „Dienstplan“
                     └─ Dokumente/Dienstplan-App/
                         ├─ daten/stammdaten.json        Mitarbeitende, Objekte, Leistungen, Regeln
                         ├─ daten/abwesenheiten.json     Urlaub, Krankenstand, …
                         ├─ daten/zeitkonto.json         veröffentlichte Wochen mit Salden
                         ├─ daten/plaene/2026/2026-10-26.json   Einteilung + Protokoll je Woche
                         └─ exporte/2026/KW44_2026/      Excel- und PDF-Wochenpläne (gesamt + je Person)
```

SharePoint führt für jede Datei einen **Versionsverlauf**. Jede frühere Fassung lässt sich dort wiederherstellen.

## 1. SharePoint-Website vorbereiten

1. In SharePoint eine Teamwebsite anlegen, z. B. **Dienstplan** → Adresse `https://cleanos.sharepoint.com/sites/Dienstplan` (der Tenant-Name kann abweichen).
2. Berechtigungen: Disponent:innen und Objektleitung **Bearbeiten**. Andere Mitarbeitende bekommen **keinen** Zugriff auf diese Website, weil dort auch Krankenstände stehen.
3. Die Bibliothek **Dokumente** reicht. Den Ordner `Dienstplan-App` legt die App beim ersten Speichern selbst an.

## 2. App in Entra ID registrieren

Im [Microsoft Entra Admin Center](https://entra.microsoft.com) → *Identität → Anwendungen → App-Registrierungen → Neue Registrierung*:

| Feld | Wert |
|---|---|
| Name | Cleanos Dienstplan |
| Unterstützte Kontotypen | Nur Konten in diesem Organisationsverzeichnis |
| Umleitungs-URI | Plattform **Single-Page-Anwendung (SPA)**: `https://dienstplan.cleanos.at/` |

Danach:

1. Unter *Authentifizierung* eine zweite SPA-URI für Tests ergänzen: `http://localhost:8080/`
2. Ebenfalls unter *Authentifizierung*: Plattform **Web** hinzufügen mit der Umleitungs-URI `https://dienstplan.cleanos.at/.auth/login/aad/callback` und **ID-Token** aktivieren. Das ist die Anmeldung, die die ganze Seite schützt (Schritt 4).
3. Unter *Zertifikate & Geheimnisse*: einen **geheimen Clientschlüssel** anlegen (für den Seitenschutz in Azure Static Web Apps).
4. Unter *API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → Delegierte Berechtigungen*: **User.Read** und **Sites.ReadWrite.All**, für den E-Mail-Versand zusätzlich **Mail.Send** (oder **Mail.Send.Shared** für ein gemeinsames Postfach, siehe unten). Anschließend **Administratorzustimmung erteilen**.
5. Von der *Übersicht* notieren: **Verzeichnis-ID (Mandant)** und **Anwendungs-ID (Client)**.
6. Optional, empfohlen: unter *Unternehmensanwendungen → Cleanos Dienstplan → Eigenschaften* **Zuweisung erforderlich = Ja** und unter *Benutzer und Gruppen* nur die Disposition zuweisen. Dann kann sich niemand sonst aus dem Tenant anmelden.

Delegiert heißt: Die App darf nur, was die angemeldete Person in SharePoint ohnehin darf. Wer keinen Zugriff auf die Dienstplan-Website hat, sieht auch in der App nichts.

> Strengere Variante: Statt *Sites.ReadWrite.All* lässt sich *Sites.Selected* verwenden. Dann wird der App per Graph nur genau die Dienstplan-Website freigegeben. Das ist etwas aufwändiger und braucht ein PowerShell- oder Graph-Skript.

## 3. config.json ausfüllen

```json
{
  "brand": { "name": "Cleanos", "product": "Dienstplan", "tagline": "Einsatzplanung Gebäudereinigung", "logo": "assets/cleanos-logo.png", "logoOnLight": "assets/cleanos-logo.png", "icon": "assets/cleanos-icon.png", "theme": "cleanos", "colors": { "primary": "#0f70b7", "accent": "#a1c855" } },
  "storage": "sharepoint",
  "demo": false,
  "sharepoint": {
    "tenantId": "VERZEICHNIS-ID",
    "clientId": "ANWENDUNGS-ID",
    "siteUrl": "https://cleanos.sharepoint.com/sites/Dienstplan",
    "library": "Dokumente",
    "folder": "Dienstplan-App",
    "refreshSeconds": 60
  },
  "access": { "planners": ["disposition@cleanos.at"] },
  "features": { "excel": true, "pdf": true, "download": true, "print": true, "mail": true },
  "mail": { "from": "" }
}
```

- `access.planners`: E-Mail-Adressen, die planen dürfen. Alle anderen angemeldeten Personen mit Zugriff auf die Website sehen den Plan **nur lesend**. Eine leere Liste bedeutet: alle dürfen planen.
- `refreshSeconds`: wie oft die App prüft, ob jemand anderes gespeichert hat.
- `features.pdf`: PDF-Wochenpläne (Download, Teilen, beim Veröffentlichen nach SharePoint in den Ordner `PDF`).
- `features.mail`: Wochenpläne per E-Mail mit PDF-Anhang direkt aus dem Dienstplan. Gesendet wird aus dem Postfach der angemeldeten Person. Mit `mail.from` (z. B. `dienstplan@cleanos.at`) aus einem freigegebenen Postfach: dafür braucht die Disposition dort die Berechtigung „Senden als“ und die App **Mail.Send.Shared**. Die E-Mail-Adressen stehen bei den Mitarbeitenden.
- `brand.contact`: Satz unten auf jedem PDF, z. B. „Fragen zum Dienstplan: Disposition, Tel. …“.
- `brand.colors`, `brand.logoOnLight`: Markenfarben und Logo für die PDF-Wochenpläne. Werden von `npm run theme -- https://www.cleanos.at` automatisch gesetzt (siehe README, Corporate Design).
- Die Datei kann jederzeit am Server geändert werden, ohne neuen Build.

## 4. Hosting auf dienstplan.cleanos.at

Erst `npm ci && npm run build` ausführen. Der Ordner `dist/` enthält dann alles, was auf den Server muss.

### Variante A: Azure Static Web Apps (empfohlen)

1. Im Azure-Portal eine *Static Web App* anlegen (Tarif **Standard**, Region Westeuropa). Als Quelle „Andere“ wählen. Der Standard-Tarif (rund 9 USD im Monat) ist nötig, damit sich **nur Konten aus dem eigenen Tenant** anmelden können.
2. Unter *Umgebungsvariablen* zwei Werte anlegen: **AZURE_CLIENT_ID** = Anwendungs-ID aus Schritt 2, **AZURE_CLIENT_SECRET** = der geheime Clientschlüssel.
3. Unter *Bereitstellungstoken verwalten* den Token kopieren und im GitHub-Repository als Secret **AZURE_STATIC_WEB_APPS_API_TOKEN** speichern, die Verzeichnis-ID als Variable **ENTRA_TENANT_ID** (*Settings → Secrets and variables → Actions → Variables*). Ab dann veröffentlicht `.github/workflows/ci.yml` jeden Stand auf `main` automatisch, nachdem die Tests grün sind.
4. Unter *Benutzerdefinierte Domänen*: `dienstplan.cleanos.at` hinzufügen. Beim DNS-Anbieter von cleanos.at einen **CNAME** `dienstplan` → `<name>.azurestaticapps.net` anlegen. Azure stellt das HTTPS-Zertifikat selbst aus.
5. `staticwebapp.config.json` setzt Sicherheitsheader (Content-Security-Policy) und den Seitenschutz. Diese sind mit dem Build getestet.

**So ist die Seite geschützt:** Jede Datei (auch `index.html`, `config.json` und der Programmcode) wird erst nach der Microsoft-Anmeldung ausgeliefert. `npm run build` trägt die Tenant-ID aus `config.json` (oder `ENTRA_TENANT_ID`) ein. Danach meldet die App dieselbe Person ohne zweite Eingabe bei Microsoft Graph an. Abmelden: Knopf „Abmelden“ oder `https://dienstplan.cleanos.at/logout`.

- Ohne Tenant-ID baut der Build trotzdem geschützt, lässt dann aber jedes Microsoft-Konto zur Anmeldung zu (geht auch im Free-Tarif). Die Daten bleiben auch dann geschützt, weil SharePoint nur berechtigte Konten lesen lässt.
- Nur für eine öffentliche Demo: `DIENSTPLAN_PUBLIC=1 npm run build`.

### Variante B: vorhandener Webspace

`dist/` per FTP/SFTP in das Verzeichnis der Subdomain `dienstplan.cleanos.at` laden. Voraussetzungen: **HTTPS** (z. B. Let's Encrypt). Ohne HTTPS funktioniert die Microsoft-Anmeldung nicht. `config.json` und `index.html` dürfen nicht im Cache liegen, die Dateien unter `app/` dürfen dauerhaft gecacht werden (Name enthält einen Hash). Die Sicherheitsheader aus `staticwebapp.config.json` sollten sinngemäß in `.htaccess` oder der Serverkonfiguration gesetzt werden.

Auf einem normalen Webspace ist der Programmcode öffentlich abrufbar; die **Daten** sind trotzdem nur nach Microsoft-Anmeldung und nur für Konten mit Zugriff auf die SharePoint-Website lesbar. Wer auch den Code hinter die Anmeldung legen will, nimmt Variante A (oder Azure App Service mit „Authentifizierung“).

## 5. Erster Start

1. `https://dienstplan.cleanos.at` öffnen und mit dem Microsoft-365-Konto anmelden.
2. Die Ablage ist leer, die App zeigt „Willkommen“.
   - **Mitarbeitende einfügen:** In Excel die Liste mit Überschrift kopieren (Name, Beschäftigung, Wochenstunden, Team, Qualifikationen, Tage, Von, Bis) und einfügen.
   - **Objekte & Leistungen einfügen:** Objekt, Adresse, Revier, Leistung, Tage, Von, Bis, Personen, Stammkraft, Intervall („wöchentlich“, „14-tägig“, „monatlich“, „quartalsweise“, „halbjährlich“, „jährlich“; monatliche Leistungen finden am ersten genannten Wochentag im Monat statt und lassen sich danach unter „Objekte & Leistungen“ genauer einstellen), An Feiertagen, optional Fahrzeit danach (z. B. „0,5“ oder „30 min“) und Fahrtnotiz.
   - Mit „Vorlage kopieren“ bekommt man die Überschriften für Excel.
   - **Zuweisen:** Unter *Zuweisung* jeder Leistung ohne Stammkraft eine feste Person geben (Vorschlag übernehmen oder „Alle Vorschläge übernehmen“). Die Auslastung zeigt, wer noch Stunden frei hat. Oder von der Person aus: auf den Namen klicken, Objekt aus der Liste wählen, Leistungen zuweisen.
3. **Müllpläne:** Unter *Objekte & Leistungen* beim Objekt „Objekt bearbeiten“ → *Müllplan*. Abfuhrtage als Rhythmus eintragen (Tonne, z. B. „14-tägig“, und ein bekannter Abfuhrtermin) oder den Abfuhrkalender einlesen: Die meisten Gemeinden und Entsorger bieten ihn online als Kalenderdatei (.ics, „in Kalender exportieren“) an. Datei wählen oder die Termine einfügen (eine Zeile je Termin, z. B. „03.11.2026 Restmüll“). Dazu einstellen, ob die Tonnen am Vorabend oder in der Früh rausgestellt werden und ob jemand sie wieder reinstellt. „Woche planen“ teilt die Gänge danach mit ein, die Ansicht *Müllplan* zeigt, wer wann zuständig ist. Abfuhrkalender gelten meist für ein Jahr: im Dezember den neuen einlesen.
4. **Löhne und Überstunden:** Unter *Mitarbeitende* je Person die Lohngruppe (oder einen eigenen Stundenlohn) eintragen und, falls abweichend, wie Überstunden und Mehrarbeit behandelt werden. Unter *Regeln* die KV-Stundenlöhne und Zuschlagssätze mit der Lohnverrechnung abstimmen. Am Monatsende unter *Überstunden & Auszahlung* prüfen, je Person auszahlen oder Zeitausgleich wählen, „Monat abschließen“. Danach öffnet sich „Auszahlungen versenden“: einmal die Adresse der Lohnverrechnung eintragen (wird gemerkt), Sammel-E-Mail mit PDF und CSV senden und auf Wunsch jeder Person ihre Aufstellung schicken (Mail.Send wie beim Versand der Wochenpläne).
5. Unter *Regeln & Feiertage* Werte aus dem Kollektivvertrag prüfen (Zuschläge, Fahrzeit, Mehrstunden für Vertretungen) und betriebsfreie Tage eintragen (z. B. 24.12., 31.12., Hl. Rupert).
6. Die Leiste oben führt durch die Woche: *Einteilen* → *Offene Einsätze* → *Prüfen* → *Veröffentlichen* → *Versenden*. Excel- und PDF-Wochenpläne liegen danach in `Dienstplan-App/exporte/…`, der Versand-Dialog schickt jeder Person ihr PDF (E-Mail, am Handy „Teilen“ z. B. per WhatsApp, oder als ZIP/Sammel-PDF zum Ausdrucken).

## 6. Am Handy und Tablet

`https://dienstplan.cleanos.at` im Browser öffnen und anmelden. Als App auf den Startbildschirm legen:

- **iPhone/iPad:** in Safari „Teilen“ → „Zum Home-Bildschirm“
- **Android:** im Chrome-Menü „App installieren“ (oder im Dienstplan unter „Mehr“ → „Als App installieren“)
- **Windows/Mac:** in Edge oder Chrome das Installieren-Symbol in der Adressleiste

Alle Geräte arbeiten mit denselben Daten in SharePoint. Ändert jemand am PC, sieht man es am Handy beim nächsten Öffnen der App sofort. Für den Echtbetrieb ist deshalb `"storage": "sharepoint"` nötig; im Browser-Modus (`"local"`) bleiben die Daten auf dem jeweiligen Gerät.

## 7. Testen ohne SharePoint

`npm start` und `http://localhost:8080` öffnen. Mit `"storage": "local"` speichert die App im Browser, mit `"demo": true` startet sie mit Beispieldaten (35 Mitarbeitende, 4 veröffentlichte Wochen).

## Datenschutz und Betriebsrat

- Krankenstände sind Gesundheitsdaten. Die App speichert nur „Krankenstand von–bis“, keine Diagnosen. Den Zugriff auf die SharePoint-Website auf die Disposition beschränken.
- Ein elektronisches System zur Planung und Auswertung von Arbeitszeiten kann in Österreich eine **Betriebsvereinbarung** erfordern (§ 96a ArbVG), sofern es einen Betriebsrat gibt.
- Keine Alarmcodes oder Passwörter in die Objektmappe schreiben.
