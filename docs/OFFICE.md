# Office & Dateien – Word und Excel direkt im Cockpit bearbeiten

Das Cockpit baut kein eigenes Office nach. Es bindet einen **eigenen Office-Server** an
(Collabora Online oder ONLYOFFICE Docs – beide kannst du selbst betreiben) und kümmert sich um das,
was dazugehört: Ablage je Kunde, Vorlagen, frühere Stände, Rechte und Freigabe im Kundenportal.

> **Stand der Prüfung:** Die Anbindung ist gegen einen *simulierten* Office-Server getestet
> (automatische Tests und ein Durchlauf im Browser: öffnen, sperren, speichern, frühere Stände,
> Vorlage ausfüllen, Nur-Lesen). Gegen einen echten Collabora- oder ONLYOFFICE-Server ist sie
> noch **nicht** gelaufen – das ist der erste Schritt bei der Inbetriebnahme (siehe „Fehlersuche“).

## Was du damit machen kannst

| Funktion | Wo |
| --- | --- |
| Dateien je Kunde ablegen (Verträge, Protokolle, Netzwerkpläne) | Kunde → Karte „Dateien“, oder **Office & Dateien** → Kunde wählen |
| Eigene Ablage für Vorlagen und interne Dokumente | **Office & Dateien** → „Eigene Ablage“ |
| Neues Textdokument, neue Tabelle, Brief mit Briefkopf und Anschrift | „+ Neues Dokument“ |
| Im Browser bearbeiten (docx, xlsx, pptx, odt, ods …) | Schaltfläche „Bearbeiten“ |
| PDF und andere Formate nur ansehen | Schaltfläche „Ansehen“ |
| Vorlage für einen Kunden ausfüllen | Vorlage → „Ausfüllen“ |
| Frühere Stände ansehen und wiederherstellen | Datei anklicken → „Frühere Stände“ |
| Datei für den Kunden im Portal freigeben | Datei anklicken → Haken „Im Kundenportal freigeben“ |
| Ticket-Anhänge im Browser öffnen | Ticket → Verlauf → Stift-Symbol an der Datei |

Ohne Office-Server funktioniert alles außer dem Bearbeiten im Browser: ablegen, anlegen,
Vorlagen ausfüllen, herunterladen.

## Was du brauchst

Einen Office-Server, den **dein Browser** und **das Cockpit** erreichen – am einfachsten auf
demselben Server wie das Cockpit, per Docker.

| | Collabora Online (CODE) | ONLYOFFICE Docs (Community) |
| --- | --- | --- |
| Basis | LibreOffice | eigene Entwicklung, sehr nah an Microsoft Office |
| Stärke | OpenDocument und ältere Formate | docx/xlsx/pptx-Treue |
| Einrichtung | läuft sofort mit dieser Anbindung | zusätzlich `WOPI_ENABLED=true` setzen |
| Lizenz | frei nutzbar, Support kostenpflichtig | frei nutzbar, begrenzte gleichzeitige Verbindungen |

Die genauen Lizenzbedingungen und Grenzen bitte beim jeweiligen Hersteller nachlesen – sie ändern sich.

## Einrichtung

### 1. Office-Server starten

Beispiel für Collabora: [`deploy/office-collabora.yml`](../deploy/office-collabora.yml)
(Adresse des Cockpits und Passwort eintragen, dann `docker compose -f deploy/office-collabora.yml up -d`).

Für ONLYOFFICE genügt:

```bash
docker run -d --name onlyoffice --restart unless-stopped -p 127.0.0.1:9981:80 \
  -e WOPI_ENABLED=true onlyoffice/documentserver
```

### 2. Per HTTPS erreichbar machen

Läuft das Cockpit unter `https://`, muss auch der Office-Server unter `https://` laufen –
sonst blockiert der Browser den Editor. In [`deploy/Caddyfile`](../deploy/Caddyfile) steht ein
auskommentierter Block für `office.deine-firma.at`, der nur aus dem Firmennetz/VPN erreichbar ist.

### 3. Im Cockpit eintragen

**Office & Dateien → Office-Server** (nur Admins):

| Feld | Bedeutung |
| --- | --- |
| Adresse des Office-Servers | z. B. `https://office.deine-firma.at` |
| Adresse des Cockpits | so, wie der **Office-Server** das Cockpit erreicht. Leer = die Adresse aus dem Browser. Wichtig bei Docker: `localhost` ist dort der Container selbst. |
| Erlaubte Adressen | IP des Office-Servers (bei Docker das Docker-Netz, z. B. `172.18.0.0/16`). Dann nimmt das Cockpit Dateizugriffe nur von dort an. |

„Speichern & testen“ fragt den Office-Server ab und zeigt, welche Dateitypen er bearbeiten kann.
Der Status steht auch unter **Verbindungen & Sicherheit**.

### 4. Der Office-Server muss das Cockpit erreichen

Der Office-Server holt die Datei beim Cockpit ab und speichert sie dorthin zurück (Adressen unter
`/wopi/…`). Läuft er im selben Netz, ist nichts zu tun. Läuft er woanders, muss `/wopi/*` für
genau diese Adresse freigegeben werden (Hinweis im Caddyfile) – **nicht** für das ganze Internet.

## Wie das abgesichert ist

- **Die Dokumente bleiben im Cockpit.** Der Office-Server bekommt eine Datei nur zum Bearbeiten
  und speichert sie zurück; er hat keine eigene Ablage und keinen Zugang zur Datenbank.
- **Ein Zugriffstoken je Datei und Benutzer**, zufällig erzeugt, 10 Stunden gültig. Im Cockpit
  liegt nur die Prüfsumme. Ein Token für Datei A öffnet Datei B nicht.
- **Nur-Lesen ist im Token festgelegt** – ein Lese-Token kann nicht speichern und nicht sperren.
- **Deaktivierte Benutzer:** ihre Token gelten sofort nicht mehr.
- **Erlaubte Adressen:** Dateizugriffe nur von der eingetragenen IP des Office-Servers.
- **Das Token steht nie in der Adresszeile des Browsers** (es wird per Formular übergeben) und
  wird im Zugriffsprotokoll des Cockpits unkenntlich gemacht.
- **Browser-Schutzregel (CSP):** Nur der eingetragene Office-Server darf im Cockpit eingebettet
  werden – und nur dort, nicht im Kundenportal.
- **Sperren:** Solange eine Datei im Editor offen ist, kann kein alter Stand darübergeschrieben
  werden. Hat jemand die Datei zwischenzeitlich geändert, meldet Collabora einen Konflikt statt
  zu überschreiben.
- **Sicherheitsprotokoll:** Änderungen an der Office-Anbindung werden protokolliert.

## Vorlagen und Platzhalter

Ein Dokument in der eigenen Ablage als **Vorlage** markieren (Datei anklicken → Haken setzen).
„Ausfüllen“ erzeugt eine Kopie in der Ablage des Kunden und ersetzt:

| Platzhalter | wird zu |
| --- | --- |
| `{{kunde}}` | Name des Kunden |
| `{{ansprechpartner}}` | Ansprechperson |
| `{{adresse}}` | Adresse des Kunden |
| `{{email}}` | E-Mail des Kunden |
| `{{datum}}` | heutiges Datum |
| `{{firma}}` | eigene Firma |
| `{{firma_adresse}}` | eigene Adresse |

Das funktioniert in Word-, Excel-, PowerPoint- und OpenDocument-Dateien, auch in Kopf- und
Fußzeilen. Unbekannte Platzhalter bleiben stehen, damit nichts stillschweigend verschwindet.

Tipp: Platzhalter in einem Zug tippen. Word zerlegt Text bei nachträglichen Korrekturen intern in
Stücke; das Cockpit setzt solche Stücke wieder zusammen, bei sehr verschachtelter Formatierung
kann ein Platzhalter aber unersetzt bleiben – dann einmal löschen und neu tippen.

## Frühere Stände

Beim Speichern aus dem Editor bleibt der vorherige Stand erhalten: bis zu **10 Stände** je Datei,
höchstens **einer pro Stunde** (automatisches Speichern würde die Liste sonst fluten).
Jeder Stand lässt sich herunterladen oder wiederherstellen; der aktuelle Stand wird dabei selbst
zu einem früheren Stand, es geht also nichts verloren.

## Kundenportal

Dateien eines Kunden sind zunächst **nur intern**. Mit dem Haken „Im Kundenportal freigeben“
erscheint die Datei im Portal unter **Rechnungen & Dokumente** zum Herunterladen. Kunden sehen
nur ihre eigenen, ausdrücklich freigegebenen Dateien; Vorlagen und die eigene Ablage nie.
Bearbeiten können Kunden im Portal nicht.

## Fehlersuche

| Anzeichen | Ursache und Abhilfe |
| --- | --- |
| „Office-Server nicht erreichbar“ | Adresse falsch oder Server aus. Im Browser `…/hosting/discovery` aufrufen – dort muss XML erscheinen. |
| „antwortet mit HTTP 404“ bei ONLYOFFICE | `WOPI_ENABLED=true` fehlt. |
| Editor bleibt weiß | Cockpit unter https, Office-Server unter http → Browser blockiert. Beide unter https betreiben. |
| Editor meldet, er könne das Dokument nicht laden | Der Office-Server erreicht das Cockpit nicht: „Adresse des Cockpits“ prüfen; bei Collabora muss dieselbe Adresse in `aliasgroup1` stehen; „Erlaubte Adressen“ testweise leeren. |
| Speichern schlägt fehl | Datei größer als 20 MB, oder die Sperre ist abgelaufen (Editor neu öffnen). |
| Änderungen erscheinen erst nach einigen Sekunden | ONLYOFFICE speichert kurz nach dem Schließen; Liste neu laden. |

## Was bewusst fehlt

- Kein gemeinsames Bearbeiten mit Kunden im Portal (nur Herunterladen).
- Kein Umbenennen oder „Speichern unter“ aus dem Editor heraus – das geht im Cockpit.
- Keine Volltextsuche in den Dateien.
