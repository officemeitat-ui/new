# Die eigenen Werkzeuge in der Cleanos App

| Ordner | Werkzeug | Fassung | Ansicht in der App | Rolle (Modul) |
|---|---|---|---|---|
| `wasserzaehler/` | Wasserzähler-Ablesung | 1.15 | `#wasserzaehler` | `zaehler` |
| `objektkontrolle/` | Objektkontrolle (Prüfprotokoll, Schnellversion) | 2.11 | `#objektkontrolle` | `kontrolle` |
| `objektdoku/` | Objektdokumentation (Leistungsverzeichnis) | 2.2 | `#objektdoku` | `objektmappe` |
| `mattenwechsel/` | Mattenwechsel | 2.5 | `#matten` | `matten` |

Jede `index.html` ist **genau die Datei aus dem Webspace-Paket** des Werkzeugs, unverändert.

## Datum des Tages (Stand 10.11.2026)

Wasserzähler 1.15, Objektkontrolle 2.11 und Mattenwechsel 2.5 nehmen für „heute“ den Kalendertag am Gerät. Bisher war es der Tag in UTC: zwischen Mitternacht und 1 Uhr (im Sommer 2 Uhr) war es damit noch gestern – eine Kontrolle oder Ablesung landete im Ordner des Vortags, in der Silvesternacht im alten Quartal. Der Wasserzähler zeigt Zeitstempel kurz nach Mitternacht jetzt auch mit dem richtigen Tag. Sonst ändert sich nichts. Die geänderten Einzeldateien liegen im Paket `Werkzeuge-Quellen_2026-11-10.zip`; bitte in die eigenen Werkzeug-Ordner übernehmen (in `bauteile/` ist es je die Funktion `heute()`).

## Ablage je Revier (Stand 06.11.2026)

Wasserzähler 1.14, Objektkontrolle 2.10 und Objektdoku 2.2 legen ihre Daten je Revier in einem eigenen Unterordner ab, damit Leute vor Ort nur ihre Objekte sehen. Die Rechte vergibt SharePoint je Revier-Ordner (eine Gruppe je Revier).

| Werkzeug | Ablage je Revier |
|---|---|
| Wasserzähler | `Wasserzähler - Ablesung/Revier <Name>/[EBG/]<Ort>/…` |
| Objektkontrolle | `Objektpruefprotokolle/Objekte/Revier <Name>/<Objekt>/<Datum_Q>/…`, Objektliste des Reviers `…/Revier <Name>/Stammdaten/Objekte.json` |
| Objektdoku | `Objektdoku/Revier <Name>/<Objekt>/…` |

- **Name des Ordners:** `Revier ` und der bereinigte Name, in allen drei Werkzeugen und in der App gleich (Sonderzeichen weg, Leerzeichen zu Bindestrich: „Salzburg Stadt“ → `Revier Salzburg-Stadt`; `src/core/reviere.js`, `revierName`).
- **Lesen:** Ein Ordner `Revier …` direkt im Grundordner ist ein Revier; seine Daten bekommen dieses Revier (der Ordner gilt). Ordner ohne Rechte (anderes Revier) werden übersprungen, der Abgleich läuft weiter. Alte Daten ohne Revier bleiben am alten Ort lesbar und werden dort gespeichert.
- **Neu anlegen:** Gibt es Reviere zur Auswahl (von der App über die Brücke, `CLEANOS_APP.reviere`, oder aus den sichtbaren Revier-Ordnern), braucht ein neuer Eintrag ein Revier: bei nur einem ist es vorgewählt, sonst „Revier wählen …“. Bis dahin bleibt er auf dem Gerät („Bitte zuerst das Revier wählen – erst dann wird in SharePoint gespeichert.“). Nach dem ersten Ablegen ist das Revier fest; verschoben wird zentral in der App (**Verwaltung → Berechtigungen → Alte Werkzeug-Ordner in Reviere verschieben**).
- **Objektdoku 2.2 behebt zwei Fehler:** Bei Konten, die nur einzelne Ordner freigegeben haben, findet sie die Bibliothek jetzt über die Ordner-Adresse (`/shares`) statt im Zweifel die erste Bibliothek der Website zu nehmen. Und `Objektdoku/Stammdaten/Vorlagen.json` wird nicht mehr bei jedem Abgleich als leeres Objekt eingelesen.
- **Bleibt gemeinsam:** Kundenstamm (`Stammdaten/Kunden.json`, `Objektpruefprotokolle/Stammdaten/Kunden.json`) und die bisherige Gesamt-Objektliste der Objektkontrolle (nach dem Umzug nur noch Objekte ohne Revier). Der Mattenwechsel wird nicht getrennt.
- **Randfall:** Ein Protokoll der Objektkontrolle, das vor der Umstellung offline abgeschlossen und nie hochgeladen wurde, geht wie bisher an den alten Ort; ohne Recht dort meldet das Werkzeug „Nicht alles ist in SharePoint gelandet“ – dann vom Büro ablegen lassen.

Die geänderten Quellen liegen im Paket `Werkzeuge-Quellen_2026-11-06.zip` (Objektdoku: geänderte `bauteile/`, Wasserzähler und Objektkontrolle: die Einzeldatei). Bitte in die eigenen Werkzeug-Ordner übernehmen.

## Abschließen: alles nach SharePoint, auch ohne Netz (Stand 28.10.2026)

Seit diesen Fassungen legt „Abschließen“ in jedem Werkzeug automatisch alles in SharePoint ab, samt PDF. Geht das gerade nicht (kein Netz, Anmeldung abgelaufen), merkt sich das Gerät die offenen Schritte und holt sie von selbst nach (wieder Netz, nächster Start, Werkzeug wieder im Vordergrund).

- **Wasserzähler 1.13:** Das PDF des Quartals wird nachgeholt; bisher nur Liste und Fotos, und die Statusleiste zeigte fälschlich „Alles in SharePoint“.
- **Objektkontrolle 2.9:** Die Ablage der Fotos (einzelne Bilddateien) war seit 2.7 verloren gegangen. Jeder Abschluss meldete „Nicht alles ist in SharePoint gelandet“. Sie ist wieder da, und ohne Netz geht nichts mehr verloren.
- **Objektdoku 2.1:** Neuer Knopf „Abschließen“ unten in der Leiste: Fassung festhalten, Blatt setzen, Akte, Fotos und Blatt ablegen. Ohne Netz wartet das fertige Blatt im Gerät.
- **Mattenwechsel 2.4:** Holt Offenes jetzt auch nach, wenn das Netz wiederkommt, während das Werkzeug offen ist (bisher erst beim nächsten Abgleich), und lädt nichts doppelt hoch.

Die geänderten Quellen (`bauteile/` bzw. die Einzeldatei) liegen im Paket `Werkzeuge-Quellen_2026-10-28.zip`. Bitte in die eigenen Werkzeug-Ordner übernehmen, sonst baut der nächste `node bau.js` die alte Fassung. `npm test` prüft, dass keine ältere Fassung ohne diese Ablage in die App kommt. Gepflegt und gebaut werden die Werkzeuge wie bisher aus ihren eigenen Quellen (`bau.js`, `bauteile/` usw.). Hier liegt nur das fertige Ergebnis. Kundendaten (Kunden.json, Standortlisten, Import-JSON) gehören nicht hierher: Die Werkzeuge lesen sie aus SharePoint.

## Neue Fassung einspielen

1. Das Werkzeug wie gewohnt bauen und prüfen (z. B. `node bau.js`, `node webspace-pruefen.js`).
2. Die fertige HTML-Datei nach `werkzeuge/<ordner>/index.html` kopieren (Wasserzähler: `Wasserablesung.html`, Objektkontrolle: `Objektpruefprotokoll-Schnell.html`, Mattenwechsel: `Mattenwechsel.html`).
3. `npm test && npm run build`, dann den Inhalt von `dist/` per FTP auf den Webspace laden (samt `.htaccess`, siehe `docs/EINRICHTUNG.md`, Schritt 4).

`npm run build` prüft jede Datei. Passt eine neue Fassung nicht mehr zur Anmeldebrücke (siehe unten), bricht der Bau mit einer Meldung ab, statt ein Werkzeug auszuliefern, das in der App stumm bleibt.

## Anmeldung: eine für alles (`bruecke.js`)

Auf dem Webspace meldet sich jedes Werkzeug selbst bei Microsoft an (PKCE, eigene App-Registrierung). Im Rahmen der App geht das nicht: Microsoft lässt seine Anmeldeseite nicht einbetten. Deshalb setzt der Bau `werkzeuge/bruecke.js` als erstes Skript ein (nur in `dist/`, die Datei hier bleibt unverändert):

- Die Werkzeuge merken sich ihre Anmeldung unter `cleanos.<werkzeug>.graph.tok` und tauschen sie beim Token-Endpunkt von Microsoft (`…/oauth2/v2.0/token`) gegen ein Zugriffstoken.
- Läuft ein Werkzeug in der App, beantwortet die Brücke genau diese zwei Stellen: Das Werkzeug gilt als angemeldet, und das Zugriffstoken kommt von der Anmeldung der App (MSAL, `window.werkzeugBruecke.token`). Gespeichert wird dabei nichts.
- Alles andere macht das Werkzeug selbst wie immer: SharePoint, Fotos, PDF, Versand, offline.
- „Anmelden“ im Werkzeug führt zur Anmeldung der App (ganze Seite), nicht in den Rahmen.
- Allein geöffnet (Knopf „Eigenes Fenster“ oder direkt `app.cleanos.at/werkzeuge/<ordner>/`) tut die Brücke nichts: Das Werkzeug meldet sich wie auf dem Webspace selbst an. Dafür braucht seine App-Registrierung die Umleitungsadresse `https://app.cleanos.at/werkzeuge/<ordner>/`.

Die Rechte für die Werkzeuge kommen damit aus der Registrierung der Cleanos App: **User.Read, Sites.ReadWrite.All, Mail.Send**; für den Termin der Nachkontrolle **Calendars.ReadWrite**; für die Routen im Mattenwechsel **Azure Maps / user_impersonation**. Fehlt die Zustimmung zu Mail.Send oder zum Kalender, laufen die Werkzeuge ohne Direktversand bzw. Termin weiter. Fehlt die Anmeldung ganz (z. B. abgelaufen), arbeiten sie am Gerät weiter, und die App zeigt „Neu anmelden“.

## Farben: wie die App

Die Werkzeuge verwenden fast die Cleanos-Farben, aber leicht andere Töne als die App. Der Bau stellt in der Kopie in `dist/` (und im Entwicklungs-Server) die Farbwerte auf die der App um (`themes/cleanos.css`, nach www.cleanos.at). Das gilt überall in der Datei, also für Oberfläche, Bericht und PDF:

| im Werkzeug | in der App |
|---|---|
| Blau `#0F70B7`, Blau dunkel `#0B5A94` | Cleanos-Blau `#0C6CB4`, `#0A5A96` |
| Grün `#A1C855`, Grün dunkel `#6D9227`, Hellgrün `#F1F7E3` | Cleanos-Grün `#9CC654`, `#4E7A1E` (auf Weiß gut lesbar), `#EEF6E2` |
| Text `#2B2B2B`, Text leise `#595959` | `#13232F`, `#4B5B67` |

Die Dateien hier bleiben unverändert; eine neue Fassung wird genauso umgefärbt. Die Tabelle steht in `scripts/werkzeuge.js` (`APP_FARBEN`).

## Wer sieht was, wer darf was

- **Sehen** (Seitenleiste): nach Rolle, also nach Microsoft-Gruppe (`src/core/access.js`, Module oben in der Tabelle).
- **Lesen und Schreiben**: wie bisher über die SharePoint-Rechte auf die Ordner der Werkzeuge (`Wasserzähler - Ablesung`, `Objektpruefprotokolle`, `Objektdoku`, `Mattenwechsel`, `Stammdaten`). Vorschlag je Gruppe in der App unter **Stammdaten → Berechtigungen** und in `docs/PLATTFORM.md`.

## Ein weiteres Werkzeug aufnehmen

1. Ordner `werkzeuge/<name>/` mit der `index.html` anlegen.
2. In `scripts/werkzeuge.js` (`WERKZEUGE`) eintragen.
3. In `src/ui/views/tools.js` (`TOOLS`) eintragen: Ansicht, Bezeichnung, Modul. Neues Modul in `src/core/access.js` (`MODULES`, Rollen).
4. Ordner in `src/storage/data-service.js` (`TOOL_FOLDERS`) für die Berechtigungen-Übersicht.
