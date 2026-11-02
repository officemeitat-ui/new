# Einrichtung: app.cleanos.at mit Ablage in SharePoint

Die Cleanos App (Einsatzplanung, Fahrzeuge und eure Werkzeuge Wasserzähler, Objektkontrolle, Objektdoku, Mattenwechsel) ist eine reine Web-App (HTML/JavaScript). Sie braucht **keinen eigenen Server und keine Datenbank**: Anmeldung nur mit dem Firmenkonto (Microsoft 365, Tenant `a31131f2-4ccf-4eb2-ab3d-49c923c6bede` für cleanos.at / cleanconcept1), Daten als Dateien in der SharePoint-Bibliothek `Cleanos_Daten`, Zugriff über Microsoft Graph. Dauer der Einrichtung: etwa eine Stunde, Administratorrechte für Microsoft 365 und Zugang zur DNS-Verwaltung von cleanos.at nötig.

```
Browser (app.cleanos.at)
   │  1. Seite nur nach Microsoft-Anmeldung mit Firmenkonto (eigener Tenant, keine Gäste)
   │  2. dieselbe Anmeldung holt das Graph-Token (MSAL, ohne zweite Eingabe)
   │  3. Microsoft-Gruppen im Token → Rolle → sichtbare Bereiche und lesbare Ordner
   ▼
Microsoft Graph ──► SharePoint cleanconcept1 → Bibliothek Cleanos_Daten → Plattform/
                         ├─ objekte/objekte.json          Objekte (alle Gruppen lesen)
                         ├─ daten/stammdaten.json         Mitarbeitende, Leistungen, Regeln
                         ├─ plaene/2026/2026-10-26.json   Einteilung + Protokoll je Woche
                         ├─ personal/abwesenheiten.json   Urlaub, Krankenstand (nur Vollzugriff)
                         ├─ lohn/zeitkonto.json           Salden, Löhne (nur Vollzugriff, Lohn)
                         ├─ fahrzeuge/                    Fahrzeuge, Reifen, Service
                         ├─ reklamationen/                Reklamationen je Objekt
                         └─ exporte/2026/KW44_2026/       Excel- und PDF-Wochenpläne
```

Jeder Ordner bekommt in SharePoint die Rechte der passenden Microsoft-Gruppe (Schritt 1). Wer welche Bereiche sieht, steht in [PLATTFORM.md](PLATTFORM.md#rollen).

SharePoint führt für jede Datei einen **Versionsverlauf**. Jede frühere Fassung lässt sich dort wiederherstellen.

## 1. SharePoint-Website vorbereiten

1. Die vorhandene Ablage der bisherigen Werkzeuge wird weiter genutzt: `https://cleanconcept1.sharepoint.com`, Bibliothek **Cleanos_Daten**. Den Ordner `Plattform` mit seinen Unterordnern legt die App beim ersten Start mit Vollzugriff selbst an.
2. **Microsoft-Gruppen anlegen** (Entra ID → Gruppen, Typ Sicherheit): „App Cleanos – Vollzugriff“, „App Cleanos – Objektmanagement“, „App Cleanos – Vorarbeiter“, „App Cleanos – Mattenwechsel“, Mitglieder eintragen. Objekt-IDs notieren (Schritt 3).
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
2. Nur für Azure (Schritt 4, Variante B): unter *Authentifizierung* Plattform **Web** hinzufügen mit der Umleitungs-URI `https://app.cleanos.at/.auth/login/aad/callback` und **ID-Token** aktivieren. Das ist die Anmeldung, die dort die ganze Seite schützt. Auf dem World4You-Webspace (Variante A) entfällt das.
3. Nur für Azure: unter *Zertifikate & Geheimnisse* einen **geheimen Clientschlüssel** anlegen (für den Seitenschutz in Azure Static Web Apps).
4. Unter *API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → Delegierte Berechtigungen*: **User.Read**, **Sites.ReadWrite.All** und **Mail.Send** (Versand aus dem Dienstplan und aus den Werkzeugen: Wasserzähler-Bericht, Objektblatt, Lieferschein; für ein gemeinsames Postfach zusätzlich **Mail.Send.Shared**, siehe unten). Für den Termin der Nachkontrolle im Werkzeug Objektkontrolle zusätzlich **Calendars.ReadWrite**; für die Routen im Mattenwechsel *Azure Maps → user_impersonation*. Anschließend **Administratorzustimmung erteilen**. Die Werkzeuge in der App nutzen diese Registrierung (eine Anmeldung für alles); fehlt die Zustimmung zu Mail.Send oder Kalender, laufen sie ohne Direktversand bzw. Termin weiter.
5a. Nur wenn die Werkzeuge auch **allein** geöffnet werden sollen („Eigenes Fenster“): in den bisherigen Registrierungen der Werkzeuge je eine SPA-Umleitungs-URI ergänzen, z. B. `https://app.cleanos.at/werkzeuge/wasserzaehler/`, `…/objektkontrolle/`, `…/objektdoku/`, `…/mattenwechsel/`. In der App selbst braucht es das nicht.
5. Unter *Tokenkonfiguration → Gruppenanspruch hinzufügen*: **Sicherheitsgruppen**, beim ID-Token „Gruppen-ID“. Damit kommen die Microsoft-Gruppen ins Token und die App weiß, wer was darf.
6. Von der *Übersicht* die **Anwendungs-ID (Client)** notieren. Die Verzeichnis-ID ist schon eingetragen (`a31131f2-4ccf-4eb2-ab3d-49c923c6bede`).
7. Empfohlen: unter *Unternehmensanwendungen → Cleanos App → Eigenschaften* **Zuweisung erforderlich = Ja** und unter *Benutzer und Gruppen* die Gruppen zuweisen (Gruppen zuweisen braucht Entra ID P1, sonst die Personen einzeln). Dann kann sich niemand sonst aus dem Tenant überhaupt anmelden. Wer angemeldet ist, aber keiner Gruppe angehört, sieht in der App nichts und lädt keine Daten.
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
      "vorarbeiter": ["Objekt-ID Gruppe Vorarbeiter"],
      "mattenwechsel": ["Objekt-ID Gruppe Mattenwechsel"]
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
- Ablage gemeinsam mit den bisherigen Werkzeugen: `"siteUrl": "https://cleanconcept1.sharepoint.com"`, `"library": "Cleanos_Daten"`, `"folder": "Plattform"`. Ein Unterordner je Berechtigung (`objekte/`, `daten/`, `plaene/`, `personal/`, `lohn/`, `fahrzeuge/`, `reklamationen/`, `exporte/`), jeder mit eigenen SharePoint-Rechten. Die Werkzeuge speichern wie bisher in ihren eigenen Ordnern derselben Bibliothek (`Wasserzähler - Ablesung`, `Objektpruefprotokolle`, `Objektdoku`, `Mattenwechsel`).
- `refreshSeconds`: wie oft die App prüft, ob jemand anderes gespeichert hat. Ohne Netz Erfasstes wird zusätzlich sofort gespeichert, sobald wieder Netz da ist.
- `tools`: `false` blendet die Werkzeuge aus (z. B. für eine Vorschau ohne Firmendaten); Standard: eingeblendet.
- `weather`: `false` blendet *Wetter & Winterdienst* aus; Standard: eingeblendet (Daten von GeoSphere Austria, Orte je Revier unter *Regeln & Feiertage*).
- `features.pdf`: PDF-Wochenpläne (Download, Teilen, beim Veröffentlichen nach SharePoint in den Ordner `PDF`).
- `features.mail`: Wochenpläne per E-Mail mit PDF-Anhang direkt aus dem Dienstplan. Gesendet wird aus dem Postfach der angemeldeten Person. Mit `mail.from` (z. B. `dienstplan@cleanos.at`) aus einem freigegebenen Postfach: dafür braucht die Disposition dort die Berechtigung „Senden als“ und die App **Mail.Send.Shared**. Die E-Mail-Adressen stehen bei den Mitarbeitenden.
- `brand.contact`: Satz unten auf jedem PDF, z. B. „Fragen zum Dienstplan: Disposition, Tel. …“.
- `brand.colors`, `brand.logoOnLight`: Markenfarben und Logo für die PDFs (Cleanos-Blau `#0c6cb4`, Grün `#9cc654`).
- `brand.theme`, `brand.themes`: Farbschema für alle und die wählbaren Marken-Farbschemata (`cleanos`, `cleanos-nacht`). Jede Person kann unter „Darstellung“ für ihr Gerät ein anderes Schema, hell/dunkel und die Schriftgröße wählen (siehe README, Corporate Design und Darstellung).
- `dist/config.json` kann jederzeit am Server geändert werden (z. B. eine neue Gruppen-ID), ohne neuen Build.

## 4. Hosting auf app.cleanos.at

Erst `npm ci && npm run build` ausführen (oder das fertige Paket `cleanos-app-webserver.zip` nehmen). Der Ordner `dist/` enthält dann alles, was auf den Server muss. Die Daten liegen nie auf dem Webserver, sondern immer in SharePoint (Microsoft Graph).

### Variante A: World4You-Webspace (für Cleanos, ohne GitHub)

1. Im World4You-Kundenbereich die Subdomain **app.cleanos.at** anlegen, mit eigenem Ordner (z. B. `/app`).
2. Für die Subdomain **HTTPS** einschalten: das SSL-Zertifikat aktivieren (Let's Encrypt, sofern im Paket enthalten, sonst ein Zertifikat bei World4You dazunehmen) und, wenn angeboten, die Weiterleitung von http auf https. Ohne HTTPS geht die Microsoft-Anmeldung nicht. Wer doch `http://` aufruft, wird von der App selbst auf https umgeleitet.
3. Den **Inhalt** von `dist/` (bzw. des entpackten Pakets) per FTP in den Ordner der Subdomain laden, mit `npm run hochladen` (siehe unten) oder z. B. mit FileZilla (FTP-Zugangsdaten im World4You-Kundenbereich). Wichtig: die drei Dateien **`.htaccess`** (im Hauptordner, in `app/` und in `werkzeuge/`) mit hochladen. Sie beginnen mit einem Punkt und sind manchmal versteckt; in FileZilla unter *Server → Anzeigen versteckter Dateien erzwingen*.
4. Prüfen: `https://app.cleanos.at` öffnen, es kommt die Microsoft-Anmeldung. Fehlt in `config.json` noch die Anwendungs-ID, zeigt die App stattdessen die Einrichtungsschritte mit den genauen Werten für diese Adresse (Umleitungs-URI, Verzeichnis-ID, Berechtigungen). Dort die Anwendungs-ID einfügen, „config.json erstellen“, die Datei hochladen und die Seite neu laden. In den Entwicklertools des Browsers (F12 → Netzwerk → `index.html` → Antwort-Header) steht `Content-Security-Policy`. Fehlt der Header, ist die `.htaccess` nicht angekommen oder das Apache-Modul *mod_headers* ist aus: beim World4You-Support nachfragen. Die App läuft auch dann, nur ohne diese zusätzliche Absicherung.
5. **Wetter:** `wetter.php` liegt mit im Paket. Die App holt Vorhersage und Warnungen zuerst direkt bei GeoSphere Austria; nur wenn der Browser das nicht darf, fragt sie über diese Datei am Webspace (World4You-Webspaces können PHP, nichts einzustellen). Prüfen: `https://app.cleanos.at/wetter.php?art=warnungen&lat=47.8095&lon=13.055` zeigt JSON. Kommt stattdessen der PHP-Text, ist PHP für die Subdomain aus.
6. **Schnee-Alarm** (optional, weckt das Winterdienst-Team; siehe [PLATTFORM.md](PLATTFORM.md#schnee-alarm-das-team-wecken)):
   - In der App unter *Wetter & Winterdienst → Alarm einrichten* Orte und Personen wählen, dann **„Alarm-Datei herunterladen“**. Die Datei `wetter-alarm.json` per FTP in den Ordner **`privat/`** der App laden (liegt im Paket, die `.htaccess` dort sperrt ihn für den Browser). PHP muss in `privat/` schreiben dürfen (Stand der Alarme; bei World4You ist das so, sonst Ordnerrechte 755 bzw. 775 setzen).
   - **Cronjob alle 10 Minuten:** Bietet das World4You-Paket Cronjobs an (Kundenbereich), dort `php wetter-alarm.php` im Ordner der App bzw. die Adresse aus dem Dialog eintragen. Sonst einen Cron-Dienst im Internet (z. B. cron-job.org) die Adresse `https://app.cleanos.at/wetter-alarm.php?aktion=pruefen&schluessel=…` alle 10 Minuten aufrufen lassen. Die genaue Adresse mit Prüfschlüssel steht im Dialog. Der Prüfschlüssel erlaubt nur das Prüfen, nichts anderes.
   - Prüfen: In der App „Testalarm senden“, auf dem Handy „Bin wach“ tippen; die Karte zeigt danach „wach: …“ und „Webspace prüfte zuletzt …“. Über den Knopf „Protokoll“ einmal ein Probe-Protokoll mit Foto eintragen (Testalarme werden nicht in die App übernommen).
   - Das Winterdienst-Protokoll speichert Einträge und Fotos in `privat/winterdienst/`; dafür muss PHP dort schreiben dürfen (wie für den Stand der Alarme). Fotos kommen verkleinert an (rund 0,3 MB); lehnt der Webspace sie trotzdem ab, bei World4You die PHP-Einstellung `upload_max_filesize` auf mindestens 8 MB setzen.
   - Ab jetzt überträgt „Speichern und übertragen“ jede Änderung direkt. Ein neues Paket hochzuladen lässt `privat/wetter-alarm.json` stehen.
7. **Plan am Handy** (optional, Mitarbeitende sehen ihren Plan über einen persönlichen Link und schicken Anträge; siehe [PLATTFORM.md](PLATTFORM.md#plan-am-handy-mein-dienstplan)):
   - In der App unter *Mitarbeitende → Plan am Handy* einschalten, Büro-Handy (Push) bzw. E-Mail für neue Anträge eintragen, dann **„Einrichtungs-Datei herunterladen“** und `mitarbeiter.json` per FTP nach **`privat/`** laden. PHP muss dort schreiben dürfen (Ordner `privat/mitarbeiter/` legt es selbst an).
   - **„Speichern und übertragen“** schickt die veröffentlichten Wochen ab der Vorwoche. Prüfen: einen Link (Knopf „Link“) am Handy öffnen; es kommt „Mein Dienstplan“ mit Namen und Woche. Danach den Personen ihren Link schicken (WhatsApp oder E-Mail aus dem Dialog).
   - Ein neues Paket hochzuladen lässt `privat/mitarbeiter.json` und die Pläne stehen.
   - **Zeiterfassung** (optional, vorher mit dem Betriebsrat bzw. schriftlich regeln): im selben Dialog „Zeiterfassung ein“, „QR-Aushänge (PDF)“ drucken und je Objekt aufhängen, „Speichern und übertragen“. Für den Alarm bei Nichterscheinen einen **zweiten Cronjob alle 5 bis 10 Minuten**: `php mein-plan.php pruefen` im Ordner der App oder die Adresse aus dem Dialog (`mein-plan.php?aktion=pruefen&schluessel=…`) bei cron-job.org. Prüfen: einen Aushang mit dem eigenen Handy scannen (vorher den eigenen Link öffnen), „Kommen“ und „Gehen“ erfassen, in der App unter „Ist-Zeiten“ „Jetzt abrufen“.
8. Optional: die alten Adressen der Werkzeuge im World4You-Kundenbereich weiterleiten, z. B. `wasserzaehler.cleanos.at` → `https://app.cleanos.at/#wasserzaehler`, `pruefprotokoll.cleanos.at` → `#objektkontrolle`, `objektdoku.cleanos.at` → `#objektdoku`, Mattenwechsel → `#matten`. Oder die alten Adressen einfach weiterlaufen lassen: Allein geöffnet melden sich die Werkzeuge wie bisher selbst an.

**Neue Fassung einspielen:** neues Paket bauen und den Inhalt hochladen (vorhandene Dateien ersetzen; alte Dateien in `app/` stören nicht), **aber `config.json` am Server nicht überschreiben**: Dort steht die Anwendungs-ID aus der Einrichtung, und im Paket fehlt sie, solange sie nicht in `config.production.json` eingetragen ist. Am besten die Anwendungs-ID nach der Einrichtung auch in `config.production.json` eintragen; dann bringt jedes Paket sie mit. Handys, Tablets und PCs holen sich die neue Fassung beim nächsten Öffnen von selbst.

**Bequemer: `npm run hochladen`.** Baut und lädt per FTP hoch, in sicherer Reihenfolge (`index.html` und `sw.js` zuletzt, damit niemand eine halbe App bekommt), samt `.htaccess`, und lässt `config.json` am Server stehen, wenn es sie schon gibt. Einmalig im Projektordner eine Datei `hochladen.json` anlegen (sie kommt nicht ins Repository; die Werte stehen im World4You-Kundenbereich bei den FTP-Zugängen):

```json
{ "host": "FTP-Server laut World4You", "benutzer": "FTP-Benutzer", "ordner": "/app", "sicher": true }
```

Das Passwort fragt der Befehl jedes Mal ab (oder Umgebungsvariable `FTP_PASSWORT`); gespeichert wird es nirgends. Verbunden wird verschlüsselt (FTPS); geht das nicht, bricht der Befehl mit Erklärung ab, statt das Passwort offen zu schicken. `"sicher": false` nur, wenn der Anbieter wirklich kein FTPS kann. Weitere Schalter: `node scripts/hochladen.js --probe` (nur anmelden und Ordner zeigen), `--aufraeumen` (alte Bündel in `app/` löschen), `--config` (auch `config.json` ersetzen). Ein Bau mit Beispieldaten (ohne `config.production.json`) wird nicht hochgeladen.

**Was die `.htaccess` tut:** `npm run build` erzeugt sie aus `staticwebapp.config.json` (`scripts/htaccess.js`), also mit genau denselben Sicherheitsregeln wie auf Azure: Content-Security-Policy (die App lädt nur eigenen Code und spricht nur mit Microsoft, für das Wetter mit GeoSphere Austria und für die Suche von Objektadressen mit OpenStreetMap), keine Einbettung fremder Seiten, die Werkzeuge mit ihren eigenen Regeln im Rahmen der App, kein Verzeichnis-Listing, `config.json` und `index.html` nie aus dem Zwischenspeicher, `staticwebapp.config.json` und der Ordner `privat/` (Schnee-Alarm, Plan am Handy) gesperrt, Suchmaschinen ausgeschlossen (`noindex`). Mit Apache getestet, alles in `<IfModule>`: Fehlt ein Modul, gibt es keinen „500 Internal Server Error“.

**So ist die Seite geschützt:** Auf dem Webspace ist der Programmcode ohne Anmeldung abrufbar, ebenso `config.json` (Tenant-ID, Anwendungs-ID, Gruppen-IDs, die Adressen mit Vollzugriff). Das sind keine Geheimnisse und keine Kundendaten. Die **Daten** gibt es nur nach der Microsoft-Anmeldung mit dem Firmenkonto und nur, soweit das Konto in SharePoint lesen darf; Gastkonten und fremde Konten weist die App ab. Wer auch den Code hinter die Anmeldung legen will, nimmt Variante B.

**Sicherung ohne GitHub:** Die Pakete `cleanos-app-quellcode.zip` und `cleanos-app.bundle` (vollständiger Verlauf) in SharePoint in einen Ordner legen, den nur Büro und IT öffnen dürfen, nicht unter `Plattform/`. Zum Weiterentwickeln mit Claude: in einer neuen Sitzung `cleanos-app.bundle` hochladen.

### Variante B: Azure Static Web Apps (ganze Seite hinter der Anmeldung, mit GitHub)

1. Im Azure-Portal eine *Static Web App* anlegen (Tarif **Standard**, Region Westeuropa). Als Quelle „Andere“ wählen. Der Standard-Tarif (rund 9 USD im Monat) ist nötig, damit sich **nur Konten aus dem eigenen Tenant** anmelden können.
2. Unter *Umgebungsvariablen* zwei Werte anlegen: **AZURE_CLIENT_ID** = Anwendungs-ID aus Schritt 2, **AZURE_CLIENT_SECRET** = der geheime Clientschlüssel.
3. Unter *Bereitstellungstoken verwalten* den Token kopieren und im GitHub-Repository als Secret **AZURE_STATIC_WEB_APPS_API_TOKEN** speichern, die Verzeichnis-ID als Variable **ENTRA_TENANT_ID** (*Settings → Secrets and variables → Actions → Variables*). Ab dann veröffentlicht `.github/workflows/ci.yml` jeden Stand auf `main` automatisch, nachdem die Tests grün sind.
4. Unter *Benutzerdefinierte Domänen*: `app.cleanos.at` hinzufügen. Beim DNS-Anbieter von cleanos.at (World4You) einen **CNAME** `app` → `<name>.azurestaticapps.net` anlegen. Azure stellt das HTTPS-Zertifikat selbst aus.
5. Optional: die alten Adressen weiterleiten wie in Variante A, Schritt 8. (Azure führt kein PHP aus: Erlaubt der Browser GeoSphere nicht direkt, bleibt das Wetter dort leer, und Schnee-Alarm und Plan am Handy brauchen dann einen eigenen Webspace mit PHP.)
6. `staticwebapp.config.json` setzt Sicherheitsheader (Content-Security-Policy) und den Seitenschutz. Diese sind mit dem Build getestet. Die Werkzeuge unter `/werkzeuge/` bekommen dieselben Regeln wie auf dem Webspace, nur dürfen sie im Rahmen der App laufen.

**So ist die Seite geschützt:** Jede Datei (auch `index.html`, `config.json` und der Programmcode) wird erst nach der Microsoft-Anmeldung ausgeliefert. `npm run build` trägt die Tenant-ID aus `config.json` (oder `ENTRA_TENANT_ID`) ein, damit lassen nur Konten des eigenen Tenants die Seite überhaupt laden. Danach meldet die App dieselbe Person ohne zweite Eingabe bei Microsoft Graph an und prüft noch einmal: Gastkonten und fremde Konten werden abgewiesen. Abmelden: Knopf „Abmelden“ (löscht auch die Kopie der Daten im Gerät) oder `https://app.cleanos.at/logout`.

- Nur für eine öffentliche Demo mit Beispieldaten: `DIENSTPLAN_PUBLIC=1 npm run build`.

## 5. Erster Start

1. `https://app.cleanos.at` öffnen und mit office@ oder it@ (Vollzugriff) anmelden. Die App legt die Ordner unter `Plattform/` an; danach die Ordnerrechte setzen (Schritt 1).
2. Die Ablage ist leer, die App zeigt „Willkommen“. Wasserzähler, Objektkontrolle, Objektdoku und Mattenwechsel brauchen nichts: Sie arbeiten mit ihren vorhandenen Daten in SharePoint weiter ([PLATTFORM.md](PLATTFORM.md#die-eigenen-werkzeuge-in-der-app)).
   - **Mitarbeitende einfügen:** In Excel die Liste mit Überschrift kopieren (Name, Beschäftigung, Wochenstunden, Team, Qualifikationen, Tage, Von, Bis) und einfügen.
   - **Objekte & Leistungen einfügen:** Objekt, Adresse, Revier, Leistung, Tage, Von, Bis, Personen, Stammkraft, Intervall („wöchentlich“, „14-tägig“, „monatlich“, „quartalsweise“, „halbjährlich“, „jährlich“; monatliche Leistungen finden am ersten genannten Wochentag im Monat statt und lassen sich danach unter „Objekte & Leistungen“ genauer einstellen), An Feiertagen (leer = findet statt mit Feiertagszuschlag; „entfällt“, wenn der Kunde geschlossen hat; „verschieben“), optional Fahrzeit danach (z. B. „0,5“ oder „30 min“) und Fahrtnotiz.
   - Mit „Vorlage kopieren“ bekommt man die Überschriften für Excel.
   - **Zuweisen:** Unter *Zuweisung* jeder Leistung ohne Stammkraft eine feste Person geben (Vorschlag übernehmen oder „Alle Vorschläge übernehmen“). Die Auslastung zeigt, wer noch Stunden frei hat. Oder von der Person aus: auf den Namen klicken, Objekt aus der Liste wählen, Leistungen zuweisen.
3. **Müllpläne:** Unter *Objekte & Leistungen* beim Objekt „Objekt bearbeiten“ → *Müllplan*. Abfuhrtage als Rhythmus eintragen (Tonne, z. B. „14-tägig“, und ein bekannter Abfuhrtermin) oder den Abfuhrkalender einlesen: Die meisten Gemeinden und Entsorger bieten ihn online als Kalenderdatei (.ics, „in Kalender exportieren“) an. Datei wählen oder die Termine einfügen (eine Zeile je Termin, z. B. „03.11.2026 Restmüll“). Dazu einstellen, ob die Tonnen am Vorabend oder in der Früh rausgestellt werden und ob jemand sie wieder reinstellt. „Woche planen“ teilt die Gänge danach mit ein, die Ansicht *Müllplan* zeigt, wer wann zuständig ist. Abfuhrkalender gelten meist für ein Jahr: im Dezember den neuen einlesen.
4. **Löhne und Überstunden:** Unter *Mitarbeitende* je Person die Lohngruppe (oder einen eigenen Stundenlohn) eintragen und, falls abweichend, wie Überstunden und Mehrarbeit behandelt werden. Unter *Regeln* die KV-Stundenlöhne und Zuschlagssätze mit der Lohnverrechnung abstimmen. Am Monatsende unter *Überstunden & Auszahlung* prüfen, je Person auszahlen oder Zeitausgleich wählen, „Monat abschließen“. Für das Lohnprogramm (BMD, RZL): einmal unter „Export Lohnprogramm“ mit der Lohnverrechnung die Lohnart-Nummern und das Dateiformat eintragen, danach jeden Monat die Datei herunterladen und einlesen. Danach öffnet sich „Auszahlungen versenden“: einmal die Adresse der Lohnverrechnung eintragen (wird gemerkt), Sammel-E-Mail mit PDF und CSV senden und auf Wunsch jeder Person ihre Aufstellung schicken (Mail.Send wie beim Versand der Wochenpläne).
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
- Keine Alarmcodes oder Passwörter in die Objektinfo (Objekte & Leistungen) schreiben.
- **Schnee-Alarm:** `privat/wetter-alarm.json` am Webspace enthält Namen, ntfy-Themen und gegebenenfalls E-Mail-Adressen der Personen in Stufe 1 und 2 (Ordner gesperrt). Die Push-Nachrichten gehen über den Dienst ntfy.sh: Ort, Wetterlage und die Namen der Objekte mit Winterdienst. Wer das nicht über einen fremden Dienst schicken will, betreibt einen eigenen ntfy-Server (Feld „ntfy-Server“ im Dialog). Wer in Stufe 1 steht, ist in Rufbereitschaft (§ 20a AZG): mit dem Betriebsrat bzw. schriftlich regeln.
- **Zeiterfassung (QR-Code):** ist ein Kontrollsystem. Mit Betriebsrat braucht es in der Regel eine Betriebsvereinbarung (§ 96 Abs 1 Z 3 ArbVG), ohne Betriebsrat die Zustimmung der einzelnen Personen (§ 10 AVRAG), sofern die Menschenwürde berührt ist; im Zweifel schriftlich vereinbaren. Erfasst werden nur Kommen und Gehen je Objekt (kein Ort, kein GPS, keine Fotos). Am Webspace 62 Tage, in SharePoint je Woche wie der Plan.
- **Plan am Handy:** Am Webspace liegen je Person Name und ihre veröffentlichten Wochen (Einsätze, Adressen der Objekte, Stunden, Zeitkonto), unter dem Hashwert ihres Links; die Links selbst, Lohndaten und Krankenstandsgründe nicht. Pläne älter als 8 Wochen fallen weg, entschiedene Anträge nach 120 Tagen; die Notiz einer Krankmeldung wird beim Eintragen gelöscht (das Formular bittet ohnehin, keine Diagnose zu schreiben). Push-Nachrichten (ntfy) nennen nur „Plan für KW … ist da/geändert“ bzw. die Entscheidung über einen Antrag. Wer den Link hat, sieht den Plan: deshalb „nicht weitergeben“ und bei Verlust „Neuer Link“. Die Mitarbeitenden darüber informieren (Art. 13 DSGVO), den Link freiwillig anbieten (Papier oder PDF bleibt möglich) und, falls es einen Betriebsrat gibt, in die Betriebsvereinbarung aufnehmen.
