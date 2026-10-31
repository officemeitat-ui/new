# Plattform: eine App, deine Werkzeuge, Rollen statt eigener Programme

Alles läuft in einer App unter **app.cleanos.at**: einmal mit dem Firmenkonto anmelden, und alle Bereiche, die die eigene Gruppe darf, stehen in der Seitenleiste (am Handy unter „Mehr“). Direkt zu einem Bereich: `app.cleanos.at/#wasserzaehler`, `#objektkontrolle` (auch `#pruefprotokoll`), `#objektdoku`, `#matten`, `#dienstplan`, z. B. als Lesezeichen oder als Weiterleitung der alten Adressen.

Die **Wasserzähler-Ablesung, die Objektkontrolle, die Objektdoku und der Mattenwechsel sind die eigenen Werkzeuge, unverändert** (Ordner `werkzeuge/`). Sie laufen im Rahmen der App mit derselben Anmeldung und speichern wie bisher selbst in ihren SharePoint-Ordnern. Siehe [Die eigenen Werkzeuge](#die-eigenen-werkzeuge-in-der-app).

| Bereich | Was | Wer arbeitet damit |
|---|---|---|
| **Einsatzplanung** | Dienstplan, Zeitlinie, Wochenzettel, Vertretungen, Müllplan | Disposition; Objektmanagement liest |
| **Auswertung & Lohn** | Controlling, Monatsauswertung, Überstunden & Auszahlung | Disposition, Lohnverrechnung |
| **Stammdaten** | Mitarbeitende, Objekte & Leistungen, Zuweisung, Regeln, Berechtigungen | Disposition |
| **Wasserzähler** | Werkzeug Wasserzähler-Ablesung | Vorarbeiter/innen, Ableser |
| **Objektkontrolle** | Werkzeug Objektkontrolle (Prüfprotokoll) | Objektmanagement, Prüfer/innen |
| **Objektdoku** | Werkzeug Objektdokumentation (Leistungsverzeichnis) | Objektmanagement |
| **Mattenwechsel** | Werkzeug Mattenwechsel | Disposition, Gruppe Mattenwechsel |
| **Fahrzeuge & Reifen** | Reifenwechsel, Service, Pickerl | Disposition, Fuhrpark |

## Rollen

| Rolle (Wert in Entra ID) | sieht | darf ändern |
|---|---|---|
| `disposition` – Vollzugriff (Büro, IT) | alles | alles |
| `objektmanagement` – Objektmanagement | Einsatzplanung (lesen), Objektkontrolle, Objektdoku | Objektkontrolle, Objektdoku |
| `vorarbeiter` – Vorarbeiter/in | Wasserzähler | Wasserzähler |
| `mattenwechsel` – Mattenwechsel | Mattenwechsel | Mattenwechsel |
| `lohnverrechnung` | Auswertung & Lohn | Auswertung & Lohn |
| `objektleitung` | Dienstplan (lesen), Wasserzähler, Objektkontrolle, Objektdoku | Wasserzähler, Objektkontrolle, Objektdoku |
| `objektservice` | Wasserzähler, Objektkontrolle, Objektdoku | Wasserzähler, Objektkontrolle |
| `ableser` | Wasserzähler | Wasserzähler |
| `pruefer` – Prüfer/in | Objektkontrolle, Objektdoku | Objektkontrolle |
| `fuhrpark` – Fuhrpark | Fahrzeuge & Reifen | Fahrzeuge & Reifen |
| `lesen` | Dienstplan | nichts |

- Mehrere Rollen addieren sich (z. B. Objektmanagement und Vorarbeiter).
- Bei den Werkzeugen entscheidet die Rolle, wer sie in der App sieht. Was jemand darin lesen oder ändern darf, regeln die SharePoint-Rechte auf die Ordner der Werkzeuge (Tabelle unten).
- **Mattenwechsel wird pro Gruppe zugewiesen:** die Objekt-ID der Microsoft-Gruppe (z. B. Fahrer:innen der Touren) unter `access.groups.mattenwechsel` eintragen. Wer zusätzlich in einer anderen Gruppe ist, bekommt beides (z. B. Vorarbeiter + Mattenwechsel). Die Gruppe braucht in SharePoint „Bearbeiten“ auf `Mattenwechsel` und auf `Stammdaten` (der Mattenwechsel pflegt beim Abschließen den gemeinsamen Kundenstamm `Stammdaten/Kunden.json`).
- **Im Betrieb (SharePoint) gilt: ohne Rolle kein Zugriff.** Wer keiner Gruppe zugeordnet ist, sieht „Kein Bereich freigegeben“, und die App lädt keine einzige Datei.
- `office@cleanos.at` und `it@cleanos.at` haben Vollzugriff (`config.production.json` → `access.planners`), auch bevor die Gruppen eingerichtet sind.
- Im Browser-Modus (Probe ohne SharePoint) gibt es oben „Ansicht als …“. Damit lässt sich ausprobieren, was eine Rolle sieht. Ohne jede Einrichtung darf dort jede Person alles.
- Die Ansicht **Stammdaten → Berechtigungen** zeigt für Vollzugriff, welche Gruppe was sieht und welche SharePoint-Rechte sie braucht, berechnet aus denselben Regeln, nach denen die App arbeitet.

### Rechte über Microsoft-Gruppen (empfohlen, geht mit jeder Lizenz)

1. **Entra ID → Gruppen → Neue Gruppe**, Typ **Sicherheit**, je Rolle eine Gruppe, z. B.
   - „App Cleanos – Vollzugriff“ (office@, it@ und wer sonst alles darf)
   - „App Cleanos – Objektmanagement“
   - „App Cleanos – Vorarbeiter“
   Mitglieder hinzufügen. Die vorhandene Gruppe „Wasserzaehler_Ablesung“ kann gleich als Vorarbeiter-Gruppe dienen.
2. Von jeder Gruppe in der *Übersicht* die **Objekt-ID** kopieren.
3. **App-Registrierungen → Cleanos App → Tokenkonfiguration → Gruppenanspruch hinzufügen → Sicherheitsgruppen**, beim ID-Token „Gruppen-ID“. Dann stehen die Gruppen nach der Anmeldung im Token.
4. In `config.production.json` die Objekt-IDs eintragen:

```json
"access": {
  "planners": ["office@cleanos.at", "it@cleanos.at"],
  "groups": {
    "disposition": ["Objekt-ID der Gruppe Vollzugriff"],
    "objektmanagement": ["Objekt-ID der Gruppe Objektmanagement"],
    "vorarbeiter": ["Objekt-ID der Gruppe Vorarbeiter"],
    "mattenwechsel": ["Objekt-ID der Gruppe Mattenwechsel"]
  }
}
```

5. Neu bauen und hochladen, oder `config.json` am Server direkt ändern (kein Build nötig). Ab der nächsten Anmeldung gilt die neue Zuordnung. Wer neu in eine Gruppe kommt, meldet sich einmal ab und wieder an.

Ab dann wird nur noch in Entra ID gearbeitet: Person in die Gruppe aufnehmen oder entfernen, fertig.

### Variante mit App-Rollen (Entra ID P1, z. B. Microsoft 365 Business Premium)

1. **App-Registrierungen → Cleanos App → App-Rollen → App-Rolle erstellen**, je Rolle: Anzeigename (z. B. „Objektmanagement“), zulässige Mitgliedstypen **Benutzer/Gruppen**, Wert `objektmanagement` (auch `Cleanos.Objektmanagement` geht), aktiviert.
2. **Unternehmensanwendungen → Cleanos App → Benutzer und Gruppen → Benutzer/Gruppe hinzufügen**: Gruppe wählen, Rolle wählen. Dann braucht es keine Objekt-IDs in der Konfiguration.
3. Unter *Eigenschaften* **Zuweisung erforderlich = Ja**: Wer keiner zugewiesenen Gruppe angehört, kann sich gar nicht erst anmelden.

### Eigene Rollen und E-Mail-Listen

```json
"access": {
  "members": { "vorarbeiter": ["max.muster@cleanos.at"] },
  "roles": {
    "hausbetreuung": { "label": "Hausbetreuung", "modules": ["zaehler", "objektmappe"], "edit": ["zaehler"] }
  }
}
```

Gruppen, App-Rollen und `members` addieren sich. Modulnamen: `planung`, `auswertung`, `stammdaten`, `zaehler` (Wasserzähler), `kontrolle` (Objektkontrolle), `objektmappe` (Objektdoku), `matten` (Mattenwechsel), `fahrzeuge`.

## Daten wirklich trennen: SharePoint-Rechte je Ordner

Die Rollen steuern, was die App zeigt und welche Dateien sie überhaupt anfragt. **Echten Schutz geben die SharePoint-Rechte**, denn die App arbeitet nur mit den Rechten der angemeldeten Person; ohne SharePoint-Recht kommt auch niemand mit einem anderen Programm an die Daten. Deshalb hat jede Berechtigungsstufe einen eigenen Ordner.

Bibliothek `Cleanos_Daten`, Ordner `Plattform`:

| Ordner | Inhalt | Vollzugriff | Objektmanagement | Vorarbeiter |
|---|---|---|---|---|
| `objekte/` | Objekte (Name, Adresse, Revier) | Bearbeiten | Lesen | – |
| `daten/` | Mitarbeitende, Leistungen, Regeln | Bearbeiten | Lesen | – |
| `plaene/` | Wochenpläne (Einteilungen, Änderungsprotokoll) | Bearbeiten | Lesen | – |
| `personal/` | Urlaub und Krankenstände (Gesundheitsdaten) | Bearbeiten | – | – |
| `lohn/` | Zeitkonto, Stundenlöhne, Monatsabschlüsse | Bearbeiten | – | – |
| `fahrzeuge/` | Fahrzeuge, Reifen, Service, Pickerl | Bearbeiten | – | – |
| `exporte/` | Excel- und PDF-Wochenpläne | Bearbeiten | – | – |

So geht's in SharePoint: Bibliothek öffnen → Ordner `Plattform` → **Zugriff verwalten** → nur die Gruppe Vollzugriff behalten. Dann je Unterordner: **⋯ → Zugriff verwalten → Erweitert → Berechtigungsvererbung beenden**, alle Einträge außer Vollzugriff entfernen und die Gruppe aus der Tabelle mit „Lesen“ bzw. „Bearbeiten“ hinzufügen. Die Ordner legt die App beim ersten Start mit Vollzugriff an.

- **Lohn und Krankenstände** liegen in eigenen Ordnern (`lohn/`, `personal/`), die nur Vollzugriff (und ggf. Lohnverrechnung) öffnen kann. Wer früher schon Daten unter `daten/` hatte: Beim ersten Start mit Vollzugriff verschiebt die App `abwesenheiten.json`, `zeitkonto.json` und alle Wochenpläne aus `daten/plaene/` in die neuen Ordner und löscht die alten Dateien (Papierkorb der Website). Scheitert das Löschen, versucht sie es beim nächsten Start wieder. Das Änderungsprotokoll der Wochen nennt keinen Grund einer Abwesenheit (es steht bei den Plänen, die auch Objektmanagement liest).
- **Vorarbeiter** brauchen keinen Ordner unter `Plattform`: Sie arbeiten nur im Werkzeug Wasserzähler, die App lädt für sie keine eigene Datei.
- **Gerätespeicher je Konto:** Jedes Microsoft-Konto hat im Gerät einen eigenen Speicher. Auf einem geteilten Tablet liest niemand ohne Netz die Kopie eines anderen.
- **Abmelden** löscht die Kopie der Daten im Gerät (für geteilte Handys); noch nicht gespeicherte Änderungen und wartende Fotos bleiben im Speicher dieses Kontos, bis sie hochgeladen sind.
- **Gleichzeitig bearbeitet:** Speichern zwei Personen dieselbe Datei, führt die App beide Stände zusammen: je Eintrag und Feld, Listen ohne Kennung (z. B. Protokoll, freie Tage) als Menge, eine fremde Änderung schlägt ein eigenes Löschen. Wochen, die ohne Netz nie geöffnet wurden, sind gesperrt, bis sie geladen sind.

**Ordner der Werkzeuge** (in derselben Bibliothek, neben `Plattform`; die Werkzeuge legen sie selbst an):

| Ordner | Inhalt | Vollzugriff | Objektmanagement | Vorarbeiter |
|---|---|---|---|---|
| `Wasserzähler - Ablesung/` | Wasserzähler-Ablesung: Listen, Fotos, Berichte je Standort | Bearbeiten | – | Bearbeiten |
| `Objektpruefprotokolle/` | Objektkontrolle: Protokolle, Fotos, Unterschriften, Objektliste | Bearbeiten | Bearbeiten | – |
| `Objektdoku/` | Objektdoku: Akten, Objektblätter, Vorlagen | Bearbeiten | Bearbeiten | – |
| `Mattenwechsel/` | Mattenwechsel: Touren, Lieferscheine, Standorte | Bearbeiten | – | – |
| `Stammdaten/` | Kundenstamm `Kunden.json` (von allen Werkzeugen gelesen) | Bearbeiten | Lesen | Lesen |

Die Objektdoku liest zusätzlich die Objektliste unter `Objektpruefprotokolle/Stammdaten/`. Wer also nur die Objektdoku hat, braucht dort „Lesen“. Die App zeigt dieselbe Tabelle für die eigenen Gruppen unter **Stammdaten → Berechtigungen**.

**Nur Ordner freigegeben:** Hat jemand nur einzelne Ordner freigegeben bekommen und keinen Zugriff auf die Website (bewährt beim Wasserzähler-Tool), findet die App die Bibliothek über die Freigabe-Adresse des Ordners.

**Website auf der Tenant-Wurzel:** `"siteUrl": "https://cleanconcept1.sharepoint.com"` funktioniert, die App spricht sie richtig an (`/sites/<host>` ohne Doppelpunkt).

## Die eigenen Werkzeuge in der App

Die vier Werkzeuge kommen **unverändert** in die App, genau so, wie sie für den Webspace gebaut sind (`werkzeuge/<name>/index.html`). Nur ihre Farbtöne stellt der Bau auf die Cleanos-Farben der App um, damit alles gleich aussieht (siehe `werkzeuge/LIESMICH.md`, „Farben“):

| Werkzeug | Fassung | Ordner in der App | SharePoint |
|---|---|---|---|
| Wasserzähler-Ablesung | 1.13 | `werkzeuge/wasserzaehler/` | `Wasserzähler - Ablesung` |
| Objektkontrolle (Prüfprotokoll) | 2.9 | `werkzeuge/objektkontrolle/` | `Objektpruefprotokolle/Objekte` |
| Objektdoku (Leistungsverzeichnis) | 2.1 | `werkzeuge/objektdoku/` | `Objektdoku` |
| Mattenwechsel | 2.4 | `werkzeuge/mattenwechsel/` | `Mattenwechsel/Touren` |

- **Eine Anmeldung.** In der App melden sich die Werkzeuge nicht selbst bei Microsoft an, sie bekommen die Anmeldung der App (Anmeldebrücke `werkzeuge/bruecke.js`). Keine Anmeldemaske im Werkzeug, kein zweites Konto antippen.
- **Alles wie gewohnt.** Ablesen, Fotos, Berichte, Kontrollen mit Unterschrift, Objektblatt mit Öffnungscode, Touren und Lieferscheine: Es ist dieselbe Datei, mit denselben Daten in denselben SharePoint-Ordnern. Ohne Netz arbeiten die Werkzeuge weiter wie bisher.
- **Bleibt offen.** Wer zwischendurch in den Dienstplan wechselt, findet das Werkzeug unverändert wieder (auch eine halb erfasste Liste).
- **Startet auch im Keller.** Die installierte App hält die Werkzeuge der eigenen Rolle beim Start (mit Netz) im Gerät vor, in einem eigenen Speicher, den App-Updates nicht löschen. Ein Werkzeug öffnet sich dadurch auch ohne Netz, selbst wenn es auf diesem Gerät noch nie geöffnet wurde. Mit Netz kommt immer die neueste Fassung.
- **„Abschließen“ legt alles in SharePoint ab, auch das PDF.** Ein Klick genügt, niemand muss ans Ablegen denken:

  | Werkzeug | beim Abschließen in SharePoint |
  |---|---|
  | Wasserzähler | Liste, Fotos, PDF-Bericht des Quartals |
  | Objektkontrolle | Protokoll, Fotos (einzeln im Ordner `Fotos`), Objektliste, PDF, auf Wunsch Termin der Nachkontrolle |
  | Objektdoku | neue Fassung im Verlauf, Akte, Fotos, Objektblatt (PDF, mit Öffnungscode, falls gewählt) – Knopf „Abschließen“ unten in der Leiste |
  | Mattenwechsel | Tour, Fotos, Tourbericht und je Kunde ein Lieferschein (PDF) |

  Ohne Netz (Keller) oder mit abgelaufener Anmeldung merkt sich das Gerät, was fehlt, zeigt es an („… wartet auf SharePoint“) und holt es von selbst nach: sobald wieder Netz da ist, beim nächsten Start oder wenn das Werkzeug wieder in den Vordergrund kommt. Lehnt SharePoint etwas ab (z. B. fehlende Rechte), kommt eine Meldung statt endloser Wiederholung.
- **„Eigenes Fenster“** öffnet das Werkzeug allein (z. B. am Handy auf ganzer Fläche). Dort meldet es sich wie bisher selbst an; dafür braucht seine App-Registrierung die Umleitungsadresse `https://app.cleanos.at/werkzeuge/<name>/` (Einrichtung Schritt 2).
- **Neue Fassung eines Werkzeugs:** die `index.html` aus dem Webspace-Paket nach `werkzeuge/<name>/` kopieren, bauen, hochladen. Passt eine neue Fassung nicht mehr zur Anmeldebrücke, bricht der Bau mit einer klaren Meldung ab (Details in `werkzeuge/LIESMICH.md`).
- **Die bisherigen Adressen** (wasserzaehler.cleanos.at, objektdoku.cleanos.at …) können weiterlaufen oder auf `app.cleanos.at/#wasserzaehler` usw. weiterleiten.

## Fahrzeuge & Reifen

Eigener Punkt unter *Stammdaten*: die Firmenfahrzeuge mit Fahrer/in (aus den Mitarbeitenden), Reifensätzen und Einlagerung. Daten liegen in `fahrzeuge/fahrzeuge.json`, mit eigener Rolle `fuhrpark`.

**Je Fahrzeug:** Kennzeichen, Fahrzeug, Art (Pkw, Transporter bis 3,5 t, Lkw über 3,5 t), Fahrer/in, Werkstatt, was montiert ist (Sommer, Winter, Ganzjahr). Je Reifensatz: Größe, wo er eingelagert ist, DOT-Nummer (Alter) und Profiltiefe je Rad.

**Wechselrunde:** Oben steht die laufende Runde mit Frist:

- **Winter:** planen ab September, Frist 31. Oktober. Ab 1. November gilt bei winterlichen Verhältnissen die Winterreifenpflicht (bis 15. April).
- **Sommer:** planen ab März, montieren erst ab 16. April, Ziel 15. Mai.

Je Fahrzeug: Termin fehlt, Termin geplant (informiert oder nicht), Termin vorbei (bestätigen), umgerüstet, Ganzjahresreifen, überfällig.

**Termine vorschlagen:** Für alle Fahrzeuge ohne Termin sucht die App bei der gewählten Werkstatt den ersten freien Platz, an dem die Fahrerin oder der Fahrer keinen Dienst hat (samt Fahrzeit hin und zurück) und nicht abwesend ist. Wochenenden werden übersprungen, ein Platz wird nie doppelt vergeben. In der Tabelle steht der Grund („nach Dienst 06:00–08:30“). Beim einzelnen Termin zeigt die App die Dienste des Tages und warnt bei Überschneidung; „Nächsten freien Termin suchen“ findet den nächsten passenden.

**E-Mails:**

- **An die Fahrer/innen:** je Person eine E-Mail mit Termin, Werkstatt, Adresse und Lagerort der Reifen, dazu der Termin als Kalenderdatei (.ics). Die Adresse kommt aus den Mitarbeitenden; fehlt sie, wird sie im Dialog eingetragen und bei der Person gespeichert. Mit Microsoft 365 (`features.mail`) geht der Versand direkt aus dem eigenen Postfach, sonst öffnet sich je Person das E-Mail-Programm (die .ics-Datei gibt es zum Anhängen).
- **An die Werkstatt:** eine Sammel-E-Mail mit allen Terminen, Reifengrößen und Lagerorten, Text vor dem Senden änderbar, die Liste zusätzlich als CSV.
- Verschiebt man einen Termin, gilt er wieder als „noch nicht informiert“.

**Erledigt:** Datum, km-Stand, Kosten, Profiltiefe der montierten und der eingelagerten Reifen, neuer Lagerort. Damit stimmt am Fahrzeug, was montiert ist und wo der andere Satz liegt.

**Mindestprofil** (Österreich): Winterreifen 4 mm, bei Lkw über 3,5 t 5 mm (dort auch Schneeketten mitführen); Ganzjahresreifen zählen im Winter als Winterreifen; Sommerreifen gesetzlich 1,6 mm, empfohlen 3 mm. Reifen ab 6 Jahren (DOT) werden zum Tausch empfohlen. Was darunter liegt, steht in der Übersicht und in „Zu erledigen“.

**Zu erledigen:** ab drei Wochen vor der Frist Fahrzeuge ohne Termin, vorbeigegangene Termine zum Bestätigen, Termine in den nächsten drei Tagen ohne Info an die Fahrerin oder den Fahrer, Reifen unter dem gesetzlichen Mindestprofil.

**Übernehmen:** „Liste einfügen“ nimmt eine Excel-Liste (Kennzeichen, Fahrzeug, Art, Fahrer/in, Sommerreifen, Winterreifen, Lagerort, Werkstatt, Montiert; dazu Klasse, Erstzulassung, km-Stand, Pickerl als Monat/Jahr, Service als Datum oder Monat, Service bei km). Fahrer/innen und Werkstätten werden über den Namen zugeordnet, vorhandene Kennzeichen ergänzt. Die Schnellsuche findet Kennzeichen auch ohne Bindestrich.

### Service, Pickerl und weitere Fälligkeiten

Zweiter Reiter **Service & Pickerl**: je Fahrzeug km-Stand, Pickerl, Service, weitere Fälligkeiten und der nächste Werkstatttermin.

**Pickerl (§57a KFG):** eingetragen werden Fahrzeugklasse (Zulassungsschein, Feld J), Erstzulassung und der Monat auf der Plakette. Ohne Plakettenmonat schätzt die App aus Klasse und Erstzulassung. Die Fristen:

| Klasse | Intervall | begutachten möglich |
|---|---|---|
| Pkw (M1), Fälligkeit bis Juli 2027 | 3-2-1 Jahre ab Erstzulassung | ab dem Monat davor bis Ende des vierten Monats danach |
| Pkw (M1), ab 19. Mai 2027 (42. KFG-Novelle) | 4-2-2-2-1 Jahre | ab vier Monate vorher bis Ende des Fälligkeitsmonats, keine Nachfrist |
| Lkw N1 (auch Kastenwagen bis 3,5 t), N2, N3 | jährlich | ab drei Monate vorher bis Ende des Fälligkeitsmonats |

Übergang: Ist das Pickerl zwischen Februar und Juli 2027 fällig, gilt noch altes Recht (3-2-1, ab dem Monat davor bis Ende des vierten Monats danach). Wurde ein Pkw vor dem 19. Mai 2027 begutachtet, zählt auch sein nächster Termin nach 3-2-1. Ohne Plakettenmonat schätzt die App beide Rechtslagen und nimmt im Zweifel den früheren Termin.

Stand: bald (30 Tage vor dem Fenster), fällig, in der Nachfrist, abgelaufen. Maßgeblich ist immer der Monat auf der Plakette. Nach der Begutachtung schlägt die App den nächsten Monat vor; wurde ein Pkw noch nach altem Recht begutachtet, nimmt sie im Zweifel den früheren Termin. Der gestanzte Monat der neuen Plakette ersetzt den Vorschlag. Bei schweren Mängeln gibt es keine neue Plakette, das Pickerl bleibt fällig.

**Service:** Intervall in Monaten und/oder km mit letztem Service, oder direkt das nächste Service laut Anzeige im Auto. Fällig ist, was zuerst kommt. Aus den km-Ständen (bei Terminen, beim Reifenwechsel oder über „km“) rechnet die App die km pro Monat und schätzt, wann der km-Stand erreicht ist. „Bald“ heißt: in 30 Tagen oder weniger als 1.500 km.

**Weitere Fälligkeiten:** frei benennbar mit Datum und optional „wiederholen alle … Monate“, z. B. Tachographprüfung (alle 24 Monate), Verbandskasten, Jahresvignette, Leasingende.

**Werkstatttermin:** sammelt, was erledigt werden soll (Service, Pickerl, weitere). Beim Reifenwechsel bietet die App fällige Aufgaben unter „Gleich mit erledigen“ an, damit das Auto nur einmal in die Werkstatt muss. „Werkstatttermine vorschlagen“ sucht für alle Fahrzeuge mit offenen Fälligkeiten freie Plätze neben den Diensten, wie beim Reifenwechsel. Die E-Mail an die Fahrerin oder den Fahrer nennt, was gemacht wird, mit Hinweis „Zulassungsschein im Auto lassen“ fürs Pickerl. Die Sammelliste an die Werkstatt enthält Reifen- und Werkstatttermine.

**Erledigt:** km-Stand, Kosten, nächstes Service (vorgeschlagen aus dem Intervall), Pickerl-Ergebnis und Monat der neuen Plakette, weitere Fälligkeiten abhaken (wiederkehrende rücken weiter).

**Zu erledigen:** Fahrzeuge mit fälligem oder bald fälligem Pickerl, Service oder weiterer Fälligkeit ohne Termin, und Werkstatttermine zum Bestätigen. Die CSV im Reiter „Service & Pickerl“ ist eine Fahrzeugliste mit allen Fälligkeiten.

## Wetter & Winterdienst

Eigener Punkt unter *Einsatzplanung* (Rolle mit Einsatzplanung): Vorhersage und amtliche Warnungen von **GeoSphere Austria** je Revier für heute bis übermorgen, mit Temperatur, Niederschlag, Neuschnee, Böen und Warnungen (gelb, orange, rot). Die Daten lädt jedes Gerät selbst alle 30 Minuten; sie liegen nicht in SharePoint (keine Firmendaten). Ohne Netz bleibt der letzte Stand sichtbar.

**Winterdienst (§ 93 StVO):** Beim Objekt unter *Objekte & Leistungen* „Winterdienst“ einschalten: fertig bis (Standard 6 Uhr), Dauer, Personen, Team und ein Hinweis (Flächen, Streugut). Nötig ist er, wenn vom Vorabend 16 Uhr bis 22 Uhr Neuschnee kommt (ab 1 cm), Niederschlag bei Frost fällt (Glätte) oder GeoSphere vor Schnee oder Glatteis warnt. Dann zeigt die Ansicht die betroffenen Objekte, „Zu erledigen“ meldet es, und der Knopf **„Winterdienst anlegen“** legt je Objekt einen Einsatz an (z. B. 05:15–06:00) und teilt das Team ein: in der eingetragenen Reihenfolge, wer an dem Tag abwesend oder nicht mehr beschäftigt ist, wird übersprungen. Fehlt jemand, bleibt der Einsatz offen wie jeder andere. Die Einsätze stehen in der Wochenübersicht mit Schneeflocke, im Wochenzettel und in den Stunden; Ruhezeit, Nachtruhe Jugendlicher usw. werden wie immer geprüft. „Absagen“ nimmt einen Einsatz wieder heraus (z. B. Schnee blieb aus), „Rückgängig“ geht auch.

**Hitze und Sturm:** Leistungen mit Häkchen **„Arbeit im Freien“** (Außenanlage, Fassade, Glas außen). Gibt GeoSphere für den Tag eine Hitzewarnung aus, markiert der Plan diese Einsätze mit dem Hinweis auf den Hitzeschutzplan (Hitzeschutzverordnung, seit 1.1.2026); ab 30 °C laut Vorhersage gibt es einen Hinweis. Bei Sturm- oder Gewitterwarnung bzw. Böen ab 60 km/h: Hinweis, Arbeit im Freien und in der Höhe zu prüfen. Die Regel „Wetter“ lässt sich im Regelkatalog abschalten.

**Einstellungen** unter *Regeln & Feiertage → Wetter & Winterdienst*: Orte je Revier („Flachgau = 47.90, 13.13“, ein Objekt nimmt den Ort seines Reviers, sonst den ersten), fertig bis, Dauer, ab wie viel Neuschnee, Glätte-Temperatur, Hitze- und Böen-Schwelle.

### Schnee-Alarm: das Team wecken

Damit niemand nachts selbst aufs Wetter schauen muss: Der Webspace prüft **alle 10 Minuten** (Cronjob, auch wenn niemand die App offen hat) je Ort, etwa Salzburg, Hallein oder Obertrum, Vorhersage und Warnungen. Ausgelöst wird bei:

- Schneefall in den nächsten 3 Stunden (ab 0,3 cm je Stunde);
- Glätte, also Niederschlag bei Frost;
- einer Schnee- oder Glatteiswarnung von GeoSphere.

Was dann passiert:

- **Stufe 1** wird per Push aufs Handy geweckt: App **ntfy**, höchste Priorität, Knopf **„Bin wach“**. Auf Wunsch kommt zusätzlich eine E-Mail.
- Bestätigt **15 Minuten** lang niemand, geht der Alarm an **Stufe 2**, z. B. Büro-Handy, Disposition oder E-Mail.
- Ein Ort meldet sich höchstens alle 8 Stunden neu, außer die Warnstufe steigt.
- Optional gibt es eine **Ruhezeit** (z. B. 22–3 Uhr): Dann wird erst am Ende geweckt, Warnung orange oder rot weckt sofort.
- Kommen 2 Stunden lang keine Wetterdaten, erfährt es Stufe 2.

**Einrichten** unter *Wetter & Winterdienst → Alarm einrichten*:

- **Orte:** dazunehmen, für Orte im Land Salzburg genügt der Name („Hallein“, „Obertrum“). Beim Objekt lässt sich der Ort wählen (*Objekte & Leistungen → Winterdienst → Ort*).
- **Stufe 1** sind anfangs die Winterdienst-Teams der Objekte an diesem Ort. **„Stufe 1 wechselt wöchentlich“** teilt die Bereitschaft auf: je Woche eine Person, Wechsel montags.
- **Handys:** Jede Person in Stufe 1 und 2 bekommt ein eigenes ntfy-Thema. Es kommt per „Einladung per E-Mail“ oder wird kopiert. Auf dem Handy: App ntfy installieren, auf + tippen und das Thema abonnieren. Dann beim Thema höchste Priorität und „Nicht stören übergehen“ erlauben (Android: Benachrichtigungskategorie der höchsten Priorität; iPhone: unter Fokus die App ntfy erlauben). „Testalarm senden“ prüft alle Handys.
- **Webspace:** Einmalig „Alarm-Datei herunterladen“ und die Datei in den Ordner `privat/` der App hochladen (Schritt 5 in [EINRICHTUNG.md](EINRICHTUNG.md)), dazu den Cronjob. Danach überträgt „Speichern und übertragen“ jede Änderung direkt.

Die Karte „Schnee-Alarm“ zeigt je Ort:

- wer Bereitschaft hat;
- die Lage;
- den letzten Alarm und wer bestätigt hat;
- wann der Webspace zuletzt geprüft hat. Liegt das über 30 Minuten zurück, ist der Cronjob zu prüfen.

Dazu kommt ein Protokoll.

### Winterdienst-Protokoll: der Nachweis

Wer wann wo geräumt und gestreut hat. Kommt es zu einem Sturz, ist ein lückenloses Protokoll (wann, wer, was, Fotos) der übliche Nachweis, dass die Pflicht nach § 93 StVO erfüllt wurde.

- **Am Handy, ohne Anmeldung:** Die Alarm-Nachricht (ntfy) hat neben „Bin wach“ den Knopf **„Protokoll“**, die Seite „Bin wach“ und die E-Mail führen ebenfalls dorthin. Dort wählt die Person das Objekt und trägt ein: erledigt um, geräumt, gestreut (Streumittel Splitt, Salz, Sand) oder „nur kontrolliert, nichts nötig“, eine Notiz und bis zu 4 Fotos. Die Fotos werden am Handy verkleinert (längste Seite 1600 px), damit sie auch über schwaches Netz ankommen. Der Link gilt 36 Stunden nach dem Alarm. Gespeichert wird am Webspace in `privat/winterdienst/` (gesperrt).
- **In der App:** im Einsatz-Dialog eines Winterdienst-Einsatzes „Erledigt eintragen“, in *Wetter & Winterdienst* „Eintragen“ oder direkt aus „Zu erledigen“.
- **Übernahme:** Öffnet jemand mit Einsatzplanung (bearbeiten) *Wetter & Winterdienst*, übernimmt die App die Protokolle vom Handy in die Woche (SharePoint) und legt die Fotos nach `exporte/Winterdienst/<Monat>/`. Testalarme zählen nicht.
- **Übersicht:** die letzten 14 Tage je Objekt mit Uhrzeit, Person, Tätigkeit, Notiz und Fotos; angelegter Winterdienst ohne Protokoll ist rot markiert und steht 2 Stunden nach „fertig bis“ unter **„Zu erledigen“**.
- **PDF-Nachweis** je Monat: Tabelle (Tag, Objekt mit Adresse, Uhrzeit, wer, Tätigkeit, Wetterlage, Notiz) und die Fotos im Anhang; mit SharePoint zusätzlich unter `exporte/Winterdienst/<Monat>/`.

**Rufbereitschaft:** Wer in Stufe 1 steht, muss erreichbar sein. Das ist Rufbereitschaft (§ 20a AZG) und außerhalb der Arbeitszeit nur an 10 Tagen im Monat erlaubt; der KV kann 30 Tage in 3 Monaten zulassen. Deshalb gibt es den wöchentlichen Wechsel (ab 4 Personen bleibt jede Person bei rund einer Woche im Monat), und der Dialog weist darauf hin. Siehe [RECHTSPRUEFUNG.md](RECHTSPRUEFUNG.md).

**Technik:** Die App fragt GeoSphere direkt (Vorhersage C-LAEF 1 km, Warnungen je Gemeinde). Lässt der Browser das nicht zu oder ist GeoSphere aus dem Firmennetz gesperrt, nimmt sie den Umweg über `wetter.php` am eigenen Webspace (nur diese Adressen von GeoSphere, nur Orte in Österreich, 10 Minuten zwischengespeichert). Benennt GeoSphere Parameter um, liest die App die Metadaten des Datensatzes und nimmt die passenden Namen. `config.json` → `"weather": false` blendet das Modul aus. Daten: GeoSphere Austria, CC BY 4.0.

## Ohne Netz (Keller, Tiefgarage)

Mit SharePoint arbeitet die App auch ohne Netz weiter:

- Der letzte Stand jeder Datei liegt im Gerät (Browser-Speicher). Die App startet auch ohne Netz, wenn das Gerät schon einmal verbunden war.
- Erfasstes im Dienstplan und bei den Fahrzeugen wird im Gerät festgehalten (die Werkzeuge haben ihren eigenen Offline-Speicher wie bisher). Oben steht dann **„Offline · 2 Änderungen warten“**. Das bleibt auch erhalten, wenn die App geschlossen oder das Handy neu gestartet wird.
- Mit Netz (zurück in der App oder Netz wieder da) wird **sofort gespeichert und mit den Änderungen anderer zusammengeführt**. Haben zwei Personen gleichzeitig geändert, bleiben beide Änderungen erhalten, nichts wird still überschrieben.
- Ohne Netz geht nicht: E-Mail-Versand.

## Was die Plattform einfacher macht

- **Eine Anmeldung, eine Adresse, eine App am Handy.** Dienstplan und Werkzeuge in einer Seitenleiste, je nach Rolle.
- **Zu erledigen** sammelt, was in der Einsatzplanung ansteht: Abwesenheiten, periodische Leistungen, Korrekturen, Fahrzeug-Termine, Winterdienst bei Schnee und Glätte.
- **Schnellsuche** mit Strg+K oder der Lupe: Personen, Objekte, Fahrzeuge und Bereiche (auch die Werkzeuge). Suchen in den Werkzeugen geht dort selbst.

## Vorschau

[Fahrzeuge & Reifen](vorschau/42-fahrzeuge-reifen.png) · [Termine vorschlagen](vorschau/43-reifen-vorschlag.png) · [Fahrer/innen informieren](vorschau/44-reifen-mail.png) · [Service & Pickerl](vorschau/45-service-pickerl.png) · [Werkstatttermin](vorschau/46-werkstatttermin.png) · [Pickerl erledigt](vorschau/47-pickerl-erledigt.png) · [Cleanos App, Wochenübersicht](vorschau/48-cleanos-design.png) · [Darstellung wählen](vorschau/49-darstellung.png) · [Cleanos Nachtblau, dunkel](vorschau/50-cleanos-nacht-dunkel.png) · [Berechtigungen](vorschau/51-berechtigungen.png) · [Tablet](vorschau/52-tablet.png) · [Übersicht](vorschau/53-uebersicht.png) · [Wasserzähler in der App](vorschau/54-werkzeug-wasserzaehler.png) · [Objektdoku in der App](vorschau/55-werkzeug-objektdoku.png) · [Mattenwechsel in der App](vorschau/56-werkzeug-mattenwechsel.png) · [Cleanos Kontrast](vorschau/57-cleanos-kontrast.png) · [Schnee-Alarm: Bin wach](vorschau/58-schnee-alarm-bin-wach.png)
