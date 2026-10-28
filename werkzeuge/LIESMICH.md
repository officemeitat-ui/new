# Die eigenen Werkzeuge in der Cleanos App

| Ordner | Werkzeug | Ansicht in der App | Rolle (Modul) |
|---|---|---|---|
| `wasserzaehler/` | Wasserzähler-Ablesung | `#wasserzaehler` | `zaehler` |
| `objektkontrolle/` | Objektkontrolle (Prüfprotokoll, Schnellversion) | `#objektkontrolle` | `kontrolle` |
| `objektdoku/` | Objektdokumentation (Leistungsverzeichnis) | `#objektdoku` | `objektmappe` |
| `mattenwechsel/` | Mattenwechsel | `#matten` | `matten` |

Jede `index.html` ist **genau die Datei aus dem Webspace-Paket** des Werkzeugs, unverändert. Gepflegt und gebaut werden die Werkzeuge wie bisher aus ihren eigenen Quellen (`bau.js`, `bauteile/` usw.). Hier liegt nur das fertige Ergebnis. Kundendaten (Kunden.json, Standortlisten, Import-JSON) gehören nicht hierher: Die Werkzeuge lesen sie aus SharePoint.

## Neue Fassung einspielen

1. Das Werkzeug wie gewohnt bauen und prüfen (z. B. `node bau.js`, `node webspace-pruefen.js`).
2. Die fertige HTML-Datei nach `werkzeuge/<ordner>/index.html` kopieren (Wasserzähler: `Wasserablesung.html`, Objektkontrolle: `Objektpruefprotokoll-Schnell.html`, Mattenwechsel: `Mattenwechsel.html`).
3. `npm test && npm run build`, dann `dist/` hochladen (oder pushen, die Pipeline macht das).

`npm run build` prüft jede Datei. Passt eine neue Fassung nicht mehr zur Anmeldebrücke (siehe unten), bricht der Bau mit einer Meldung ab, statt ein Werkzeug auszuliefern, das in der App stumm bleibt.

## Anmeldung: eine für alles (`bruecke.js`)

Auf dem Webspace meldet sich jedes Werkzeug selbst bei Microsoft an (PKCE, eigene App-Registrierung). Im Rahmen der App geht das nicht: Microsoft lässt seine Anmeldeseite nicht einbetten. Deshalb setzt der Bau `werkzeuge/bruecke.js` als erstes Skript ein (nur in `dist/`, die Datei hier bleibt unverändert):

- Die Werkzeuge merken sich ihre Anmeldung unter `cleanos.<werkzeug>.graph.tok` und tauschen sie beim Token-Endpunkt von Microsoft (`…/oauth2/v2.0/token`) gegen ein Zugriffstoken.
- Läuft ein Werkzeug in der App, beantwortet die Brücke genau diese zwei Stellen: Das Werkzeug gilt als angemeldet, und das Zugriffstoken kommt von der Anmeldung der App (MSAL, `window.werkzeugBruecke.token`). Gespeichert wird dabei nichts.
- Alles andere macht das Werkzeug selbst wie immer: SharePoint, Fotos, PDF, Versand, offline.
- „Anmelden“ im Werkzeug führt zur Anmeldung der App (ganze Seite), nicht in den Rahmen.
- Allein geöffnet (Knopf „Eigenes Fenster“ oder direkt `app.cleanos.at/werkzeuge/<ordner>/`) tut die Brücke nichts: Das Werkzeug meldet sich wie auf dem Webspace selbst an. Dafür braucht seine App-Registrierung die Umleitungsadresse `https://app.cleanos.at/werkzeuge/<ordner>/`.

Die Rechte für die Werkzeuge kommen damit aus der Registrierung der Cleanos App: **User.Read, Sites.ReadWrite.All, Mail.Send**; für den Termin der Nachkontrolle **Calendars.ReadWrite**; für die Routen im Mattenwechsel **Azure Maps / user_impersonation**. Fehlt die Zustimmung zu Mail.Send oder zum Kalender, laufen die Werkzeuge ohne Direktversand bzw. Termin weiter. Fehlt die Anmeldung ganz (z. B. abgelaufen), arbeiten sie am Gerät weiter, und die App zeigt „Neu anmelden“.

## Wer sieht was, wer darf was

- **Sehen** (Seitenleiste): nach Rolle, also nach Microsoft-Gruppe (`src/core/access.js`, Module oben in der Tabelle).
- **Lesen und Schreiben**: wie bisher über die SharePoint-Rechte auf die Ordner der Werkzeuge (`Wasserzähler - Ablesung`, `Objektpruefprotokolle`, `Objektdoku`, `Mattenwechsel`, `Stammdaten`). Vorschlag je Gruppe in der App unter **Stammdaten → Berechtigungen** und in `docs/PLATTFORM.md`.

## Ein weiteres Werkzeug aufnehmen

1. Ordner `werkzeuge/<name>/` mit der `index.html` anlegen.
2. In `scripts/werkzeuge.js` (`WERKZEUGE`) eintragen.
3. In `src/ui/views/tools.js` (`TOOLS`) eintragen: Ansicht, Bezeichnung, Modul. Neues Modul in `src/core/access.js` (`MODULES`, Rollen).
4. Ordner in `src/storage/data-service.js` (`TOOL_FOLDERS`) für die Berechtigungen-Übersicht.
