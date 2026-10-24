# Einrichtung: dienstplan.cleanos.at mit Ablage in SharePoint

Der Dienstplan ist eine reine Web-App (HTML/JavaScript). Sie braucht **keinen eigenen Server und keine Datenbank**: Anmeldung über Microsoft 365, Daten als Dateien in einer SharePoint-Bibliothek. Dauer der Einrichtung: etwa eine Stunde, Administratorrechte für Microsoft 365 und Zugang zur DNS-Verwaltung von cleanos.at nötig.

```
Browser (dienstplan.cleanos.at)
   │  Anmeldung mit Microsoft-365-Konto (MSAL, Entra ID)
   ▼
Microsoft Graph ──► SharePoint-Website „Dienstplan“
                     └─ Dokumente/Dienstplan-App/
                         ├─ daten/stammdaten.json        Mitarbeitende, Objekte, Leistungen, Regeln
                         ├─ daten/abwesenheiten.json     Urlaub, Krankenstand, …
                         ├─ daten/zeitkonto.json         veröffentlichte Wochen mit Salden
                         ├─ daten/plaene/2026/2026-10-26.json   Einteilung + Protokoll je Woche
                         └─ exporte/2026/KW44_2026/      Excel-Wochenpläne (gesamt + je Person)
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
2. Unter *API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → Delegierte Berechtigungen*: **User.Read** und **Sites.ReadWrite.All**. Anschließend **Administratorzustimmung erteilen**.
3. Von der *Übersicht* notieren: **Verzeichnis-ID (Mandant)** und **Anwendungs-ID (Client)**.

Delegiert heißt: Die App darf nur, was die angemeldete Person in SharePoint ohnehin darf. Wer keinen Zugriff auf die Dienstplan-Website hat, sieht auch in der App nichts.

> Strengere Variante: Statt *Sites.ReadWrite.All* lässt sich *Sites.Selected* verwenden. Dann wird der App per Graph nur genau die Dienstplan-Website freigegeben. Das ist etwas aufwändiger und braucht ein PowerShell- oder Graph-Skript.

## 3. config.json ausfüllen

```json
{
  "brand": { "name": "Cleanos", "product": "Dienstplan", "tagline": "Einsatzplanung Gebäudereinigung", "logo": "assets/cleanos-logo.svg", "theme": "cleanos" },
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
  "features": { "excel": true, "download": true, "print": true }
}
```

- `access.planners`: E-Mail-Adressen, die planen dürfen. Alle anderen angemeldeten Personen mit Zugriff auf die Website sehen den Plan **nur lesend**. Eine leere Liste bedeutet: alle dürfen planen.
- `refreshSeconds`: wie oft die App prüft, ob jemand anderes gespeichert hat.
- Die Datei kann jederzeit am Server geändert werden, ohne neuen Build.

## 4. Hosting auf dienstplan.cleanos.at

Erst `npm ci && npm run build` ausführen. Der Ordner `dist/` enthält dann alles, was auf den Server muss.

### Variante A: Azure Static Web Apps (empfohlen, Free-Tarif reicht)

1. Im Azure-Portal eine *Static Web App* anlegen (Tarif Free, Region Westeuropa). Als Quelle „Andere“ wählen.
2. Unter *Bereitstellungstoken verwalten* den Token kopieren und im GitHub-Repository als Secret **AZURE_STATIC_WEB_APPS_API_TOKEN** speichern. Ab dann veröffentlicht `.github/workflows/ci.yml` jeden Stand auf `main` automatisch, nachdem die Tests grün sind.
3. Unter *Benutzerdefinierte Domänen*: `dienstplan.cleanos.at` hinzufügen. Beim DNS-Anbieter von cleanos.at einen **CNAME** `dienstplan` → `<name>.azurestaticapps.net` anlegen. Azure stellt das HTTPS-Zertifikat selbst aus.
4. `staticwebapp.config.json` setzt Sicherheitsheader (Content-Security-Policy). Diese sind mit dem Build getestet.

### Variante B: vorhandener Webspace

`dist/` per FTP/SFTP in das Verzeichnis der Subdomain `dienstplan.cleanos.at` laden. Voraussetzungen: **HTTPS** (z. B. Let's Encrypt). Ohne HTTPS funktioniert die Microsoft-Anmeldung nicht. `config.json` darf nicht im Cache liegen. Die Sicherheitsheader aus `staticwebapp.config.json` sollten sinngemäß in `.htaccess` oder der Serverkonfiguration gesetzt werden.

## 5. Erster Start

1. `https://dienstplan.cleanos.at` öffnen und mit dem Microsoft-365-Konto anmelden.
2. Die Ablage ist leer, die App zeigt „Willkommen“.
   - **Mitarbeitende einfügen:** In Excel die Liste mit Überschrift kopieren (Name, Beschäftigung, Wochenstunden, Team, Qualifikationen, Tage, Von, Bis) und einfügen.
   - **Objekte & Leistungen einfügen:** Objekt, Adresse, Revier, Leistung, Tage, Von, Bis, Personen, Stammkraft, Intervall („wöchentlich“, „14-tägig“, „monatlich“, „quartalsweise“, „halbjährlich“, „jährlich“; monatliche Leistungen finden am ersten genannten Wochentag im Monat statt und lassen sich danach unter „Objekte & Leistungen“ genauer einstellen), An Feiertagen, optional Fahrzeit danach (z. B. „0,5“ oder „30 min“) und Fahrtnotiz.
   - Mit „Vorlage kopieren“ bekommt man die Überschriften für Excel.
3. Unter *Regeln & Feiertage* Werte aus dem Kollektivvertrag prüfen (Zuschläge, Fahrzeit, Mehrstunden für Vertretungen) und betriebsfreie Tage eintragen (z. B. 24.12., 31.12., Hl. Rupert).
4. *Woche planen* → prüfen → *Veröffentlichen*. Die Excel-Wochenpläne liegen danach in `Dienstplan-App/exporte/…`.

## 6. Testen ohne SharePoint

`npm start` und `http://localhost:8080` öffnen. Mit `"storage": "local"` speichert die App im Browser, mit `"demo": true` startet sie mit Beispieldaten (35 Mitarbeitende, 4 veröffentlichte Wochen).

## Datenschutz und Betriebsrat

- Krankenstände sind Gesundheitsdaten. Die App speichert nur „Krankenstand von–bis“, keine Diagnosen. Den Zugriff auf die SharePoint-Website auf die Disposition beschränken.
- Ein elektronisches System zur Planung und Auswertung von Arbeitszeiten kann in Österreich eine **Betriebsvereinbarung** erfordern (§ 96a ArbVG), sofern es einen Betriebsrat gibt.
- Keine Alarmcodes oder Passwörter in die Objektmappe schreiben.
