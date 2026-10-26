# Plattform: ein Tool, mehrere Module, Rollen statt eigener Programme

Bisher gab es vier getrennte Werkzeuge mit je eigener Anmeldung: den Dienstplan, die Wasserzähler-Ablesung, die Objektkontrolle und die Objektdokumentation. Jetzt läuft alles in einer App unter **app.cleanos.at**: einmal anmelden, alle Bereiche, die die eigene Gruppe darf, stehen in den Registern (am Handy unter „Mehr“). Direkt zu einem Bereich: `app.cleanos.at/#zaehler`, `#kontrolle`, `#objektmappe`, `#dienstplan` (auch `#wasserzaehler`, `#pruefprotokoll`, `#objektdoku`), z. B. als Lesezeichen oder als Weiterleitung der alten Adressen. Es gibt eine Anmeldung, die Objekte und Mitarbeitenden sind gemeinsam gepflegt, und es gibt eine Glocke „Zu erledigen“. Jede Rolle sieht nur ihre Module.

| Modul | Ersetzt | Wer arbeitet damit |
|---|---|---|
| **Dienstplan** (Planung) | – | Disposition |
| **Auswertung & Lohn** | – | Disposition, Lohnverrechnung |
| **Stammdaten** | Objektlisten in den Einzeltools | Disposition |
| **Zählerstände** | Wasserzähler-Ablesung (wasserzaehler.cleanos.at) | Ableser, Objektservice, Objektleitung |
| **Objektkontrolle** | Prüfprotokoll-Tool (pruefprotokoll.cleanos.at) | Prüfer/in, Objektservice, Objektleitung |
| **Objektmappe** | Objektdokumentation (objektdoku.cleanos.at) | Objektleitung; Prüfer/Objektservice lesen |
| **Fahrzeuge & Reifen** | Listen und Zettel zu Reifenwechsel, Service und Pickerl | Disposition, Fuhrpark |

## Rollen

| Rolle (Wert in Entra ID) | sieht | darf ändern |
|---|---|---|
| `disposition` – Vollzugriff (Büro, IT) | alles | alles |
| `objektmanagement` – Objektmanagement | Einsatzplanung (lesen), Objektkontrolle, Objektmappe | Objektkontrolle, Objektmappe |
| `vorarbeiter` – Vorarbeiter/in | Zählerstände (Wasserzähler) | Zählerstände |
| `lohnverrechnung` | Auswertung & Lohn | Auswertung & Lohn |
| `objektleitung` | Dienstplan (lesen), Zähler, Kontrolle, Objektmappe | Zähler, Kontrolle, Objektmappe |
| `objektservice` | Zähler, Kontrolle, Objektmappe | Zähler, Kontrolle |
| `ableser` | Zählerstände | Zählerstände |
| `pruefer` – Prüfer/in | Objektkontrolle, Objektmappe | Objektkontrolle |
| `fuhrpark` – Fuhrpark | Fahrzeuge & Reifen | Fahrzeuge & Reifen |
| `lesen` | Dienstplan | nichts |

- Mehrere Rollen addieren sich (z. B. Objektmanagement und Vorarbeiter).
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
    "vorarbeiter": ["Objekt-ID der Gruppe Vorarbeiter"]
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

Gruppen, App-Rollen und `members` addieren sich. Modulnamen: `planung`, `auswertung`, `stammdaten`, `zaehler`, `kontrolle`, `objektmappe`, `fahrzeuge`.

## Daten wirklich trennen: SharePoint-Rechte je Ordner

Die Rollen steuern, was die App zeigt und welche Dateien sie überhaupt anfragt. **Echten Schutz geben die SharePoint-Rechte**, denn die App arbeitet nur mit den Rechten der angemeldeten Person; ohne SharePoint-Recht kommt auch niemand mit einem anderen Programm an die Daten. Deshalb hat jede Berechtigungsstufe einen eigenen Ordner.

Bibliothek `Cleanos_Daten`, Ordner `Plattform`:

| Ordner | Inhalt | Vollzugriff | Objektmanagement | Vorarbeiter |
|---|---|---|---|---|
| `objekte/` | Objekte (Name, Adresse, Revier) | Bearbeiten | Lesen | Lesen |
| `daten/` | Mitarbeitende, Leistungen, Wochenpläne | Bearbeiten | Lesen | – |
| `personal/` | Urlaub und Krankenstände (Gesundheitsdaten) | Bearbeiten | – | – |
| `lohn/` | Zeitkonto, Stundenlöhne, Monatsabschlüsse | Bearbeiten | – | – |
| `zaehler/` | Zählerstände mit Fotos | Bearbeiten | – | Bearbeiten |
| `kontrolle/` | Objektkontrollen mit Fotos, Unterschriften | Bearbeiten | Bearbeiten | – |
| `objektmappe/` | Objektmappe, Leistungsverzeichnis | Bearbeiten | Bearbeiten | – |
| `fahrzeuge/` | Fahrzeuge, Reifen, Service, Pickerl | Bearbeiten | – | – |
| `exporte/` | Excel- und PDF-Wochenpläne | Bearbeiten | – | – |

So geht's in SharePoint: Bibliothek öffnen → Ordner `Plattform` → **Zugriff verwalten** → nur die Gruppe Vollzugriff behalten. Dann je Unterordner: **⋯ → Zugriff verwalten → Erweitert → Berechtigungsvererbung beenden**, alle Einträge außer Vollzugriff entfernen und die Gruppe aus der Tabelle mit „Lesen“ bzw. „Bearbeiten“ hinzufügen. Die Ordner legt die App beim ersten Start mit Vollzugriff an.

- **Lohn und Krankenstände** liegen in eigenen Ordnern (`lohn/`, `personal/`), die nur Vollzugriff (und ggf. Lohnverrechnung) öffnen kann. Wer früher schon Daten unter `daten/` hatte: Beim ersten Start mit Vollzugriff verschiebt die App `abwesenheiten.json` und `zeitkonto.json` in die neuen Ordner und löscht die alten Dateien (Papierkorb der Website).
- **Objekte** stehen in `objekte/`, damit Vorarbeiter die Zähler ihren Objekten zuordnen können, ohne die Personaldaten in `daten/` lesen zu dürfen. Auch das zieht beim ersten Start mit Vollzugriff von selbst um.
- **Abmelden** löscht die Kopie der Daten im Gerät (für geteilte Handys); noch nicht gespeicherte Änderungen und wartende Fotos bleiben, bis sie hochgeladen sind.

**Nur Ordner freigegeben:** Hat jemand nur einzelne Ordner freigegeben bekommen und keinen Zugriff auf die Website (bewährt beim Wasserzähler-Tool), findet die App die Bibliothek über die Freigabe-Adresse des Ordners.

**Website auf der Tenant-Wurzel:** `"siteUrl": "https://cleanconcept1.sharepoint.com"` funktioniert, die App spricht sie richtig an (`/sites/<host>` ohne Doppelpunkt).

## Übernahme aus den bisherigen Werkzeugen

### Direkt aus SharePoint

Die Werkzeuge speichern schon in SharePoint (Bibliothek `Cleanos_Daten`). Die App liest diese Ordner direkt, ohne Herunterladen:

| Ordner in der Bibliothek | Inhalt | wird zu |
|---|---|---|
| `Wasserzähler - Ablesung` | Jahreslisten `Ablesung_<Ort>_<Jahr>.json`, Fotos | Zählstellen, Ablesungen, abgeschlossene Quartale |
| `Stammdaten/Kunden.json` | Kundenstamm (551 Kunden) | Kundenstamm der Objektmappe |
| `Objektpruefprotokolle` | `Stammdaten/Objekte.json`, je Objekt die Protokolle, Fotos, Unterschriften | Kunde, Nummer, E-Mail Hausverwaltung; Kontrollen |
| `Objektdoku` | Akten je Objekt, `Vorlagen.json`, Fotos | Objektmappe mit Verlauf, Raumbuch, Fotos; Bereichsvorlagen |

So geht's: **Daten → Bisherige Werkzeuge** (oder in den Modulen „Übernehmen“) → **In SharePoint suchen**. Die App zeigt vorher, was übernommen wird und was die eigene Rolle darf. Objekte, die es im Dienstplan noch nicht gibt, werden angelegt (dafür braucht es das Recht „Stammdaten“).

- **Fotos und Unterschriften bleiben, wo sie sind**, und sind verlinkt. Fürs PDF lädt die App sie bei Bedarf.
- **Mehrmals abgleichen geht.** Ein neuer Abgleich übernimmt nur Neues und ersetzt Geändertes, er verdoppelt nichts. Die Werkzeuge können also bis zur Umstellung parallel laufen.
- **Andere Ordnernamen** stehen in `config.json` → `sharepoint.sources`:

```json
"sources": { "wasserzaehler": "Wasserzähler - Ablesung", "pruefprotokoll": "Objektpruefprotokolle", "objektdoku": "Objektdoku" }
```

Ohne SharePoint (Browser-Modus) lassen sich dieselben JSON-Dateien im selben Dialog auswählen.

### Wasserzähler-Ablesung (im Echtbetrieb)

Das Modul folgt dem Datenmodell des Werkzeugs, damit nichts verloren geht:

- **Zählstelle mit stabiler ID** (`S-<ort>-NN`) und Nummernverlauf (Tausch oder Berichtigung).
- **Ablesung je Quartal**: entweder ein Stand oder ein Grund ohne Stand (kein Zutritt, nicht ablesbar, nicht gefunden, Abriss).
- **Fällig** 30 Tage vor bis 60 Tage nach Quartalsende, einstellbar.
- **Verbrauch wird immer gerechnet**, auch über den Zählertausch: (Endstand alt − Vorstand) + (Stand − Anfangsstand neu).
- Endstand und Anfangsstand werden **nicht vorbelegt**. Bis beide eingetragen sind, gilt der Tausch als „unvollständig“ und es gibt keinen Leckalarm.
- **Plausibilität** gegen dasselbe Quartal im Vorjahr, sonst gegen den Schnitt:
  - kritisch: negativ oder über 2,5-fach
  - hoch: 0 m³ oder über 1,4-fach
  - niedrig: unter 25 %
- **Runde abschließen** sperrt die Werte (Freigabe durch das Büro).
- **Liste (CSV/PDF)** je Quartal mit „Auffällige Zähler“ und Jahresliste im Excel-Zuschnitt des Werkzeugs; Versand per E-Mail, nichts vorbelegt.

**Übernehmen:** wie oben unter „Direkt aus SharePoint“. Ergebnis:

   - Standorte ohne passendes Objekt werden als Objekte angelegt, z. B. „EBG Hallein“.
   - Fotos bleiben in SharePoint und sind verlinkt.
   - Abgeschlossene Quartale bleiben gesperrt.
   - Ein zweiter Import ersetzt die Daten, er verdoppelt nichts. Ein Parallelbetrieb bis zur Umstellung ist also möglich.

**Neu gegenüber dem Werkzeug:**

- **„Einplanen“** legt die Ablesung als Einsatz im Dienstplan an, mit Dauer nach Anzahl der Zähler. Damit sind Ableser zugeteilt und die Stunden zählen.
- **Erinnerung** in „Zu erledigen“.
- **Hinweis im Einsatz** am Objekt.
- **Rollen in der App.**

### Objektkontrolle (Prüfprotokoll-Tool, noch nicht im Echtbetrieb)

Übernommen:

- Prüfkatalog mit 9 Kapiteln und 39 Punkten (jetzt als Daten, also bearbeitbar und erweiterbar)
- Bewertung OK / R / M / G / N-A; Tastatur 1–5, Pfeile, B für Bemerkung
- Priorität G→1, M→2, R→3
- Vorschlag Gesamtzustand: G → Kritisch, ab 3 M → Handlungsbedarf, M oder ab 4 R → Gut, sonst Sehr gut
- Vorbefunde direkt beim Prüfpunkt; derselbe Punkt später OK → Mangel erledigt
- „Rest OK“ / „Rest N/A“, Fotos (Kamera und Galerie getrennt), zwei Unterschriften
- Abschließen sperrt; PDF mit Fotos und Unterschriften
- Versand An/CC/BCC mit **nichts vorbelegt** und bekannten Adressen zum Antippen

Neu:

- **Zuständigkeit und Frist je Mangel.** Bei „R“ ist die Stammkraft des Objekts vorgeschlagen, die Frist richtet sich nach der Priorität.
- **„Nacharbeit“** legt einen Einsatz im Dienstplan an, direkt nach dem regulären Einsatz der Stammkraft. Ist die Person dann abwesend, kommt eine Warnung.
- **Offene Mängel aller Objekte** in einer Liste.
- **Rhythmus je Objekt** (monatlich bis jährlich). Nachkontrolle mit Termin geht vor, Fälliges steht in „Zu erledigen“.
- **Eigene Checklisten** je Objektart.
- Der **Kundenstamm** (Kunden.json, 551 Kunden) lässt sich in der Objektmappe einlesen.
- Die **Nachkontrolle** steht in „Zu erledigen“ und kommt auf Knopfdruck in den Kalender:
  - als **Termin-Datei (.ics)**: öffnet sich in Outlook, braucht kein zusätzliches Recht;
  - oder **direkt in Outlook**, wenn `features.calendar` eingeschaltet ist (Recht *Calendars.ReadWrite*, siehe EINRICHTUNG). Wird der Termin der Nachkontrolle verschoben, verschiebt „Termin in Outlook verschieben“ den vorhandenen Eintrag.

Kontrollen aus dem Werkzeug werden mit Fotos und Unterschriften übernommen. Waren es nur Testdaten, nach der Übernahme unter „Kontrollen“ löschen.

### Objektdokumentation

Die Objektmappe übernimmt das Modell des Werkzeugs (Schnittstelle 1:1) und hängt am zentralen Objekt. Vorhandene Akten werden mit Verlauf, Fotos und Versandliste übernommen.

Jedes Objekt hat:

- Ansprechpartner (auch intern)
- Zugang ohne Codes, nur der Hinweis, wo sie zu erfragen sind
- Geräte
- Hinweise
- Dokumente als Links
- Objektleitung und Vertretung, Einsatztage und Zeitfenster laut Vertrag
- das Leistungsverzeichnis: Bereiche mit Leistungen, Häufigkeit (dieselben 15 Kennungen wie im Werkzeug, von „täglich Mo–So“ bis „jährlich“, „nach Bedarf“, „witterungsabhängig“) und Richtzeit
- das **Raumbuch** je Bereich: Nr., Raum, m², Boden, Bemerkung. Ohne eigene Fläche gilt beim Bereich die Summe der Räume.
- **Fotos:** Ablauf-Fotos (wie und wo gereinigt wird) und Zugangsfotos (vertraulich)

Die Stunden werden gerechnet und mit dem Stammplan des Dienstplans verglichen. Eine Abweichung über 10 % wird markiert.

**Bereich aus Vorlage:** Der Katalog des Werkzeugs (13 Bereiche, 80 Leistungen) ist eingebaut, eigene Vorlagen kommen dazu („Als Vorlage“ bei einem Bereich). Die Häufigkeiten passen sich den Einsatztagen an: Bei 3 Einsatztagen wird aus „täglich Mo–Fr“ „3× Woche“. Ohne vertragliche Einsatztage gelten die Tage aus dem Stammplan.

**Fassungen:** Jedes Speichern ist eine neue Fassung, auf Wunsch mit Anlass („Vertrag 2027“). Unter **Verlauf** steht je Fassung, was sich geändert hat, in Worten (z. B. „Stiegenhaus: Böden wischen 2× Woche → täglich Mo–Fr“, „Stunden/Woche: 2,79 → 4,09“). Vor dem Speichern zeigt der Verlauf, was sich ändern wird. „Zurückholen“ lädt eine frühere Fassung als Entwurf; erst Speichern macht sie zur aktuellen. Die letzten 50 Fassungen bleiben. Gespeichert wird nur, was sich geändert hat, damit die Datei klein bleibt.

Das **Objektblatt** gibt es mit drei Voreinstellungen:

- **Mitarbeiter**: mit Zugang, ohne Richtzeiten
- **Kunde**: Leistungsverzeichnis; vertrauliche Abschnitte sind gesperrt und nie enthalten
- **Akte**: alles

Vertrauliche Abschnitte sind in der Fußzeile vermerkt. Zugangsfotos erscheinen nur im Abschnitt „Schlüssel und Zugang“, nie in der Kundenfassung.

- **Sprache:** Deutsch, Englisch oder Rumänisch. Überschriften, Tabellenköpfe, Häufigkeiten und Wochentage sind übersetzt. Eigene Texte (Hinweise, Leistungen, Methoden) bleiben, wie sie eingetragen sind; das Blatt weist darauf hin.
- **Öffnungscode:** Das PDF ist verschlüsselt (AES-256) und lässt sich nur mit einem Code wie `K7QM-3XRP` öffnen. Drucken geht, Ändern und Kopieren nicht. Der Code wird einmal angezeigt und **nirgends gespeichert**. Er wird getrennt vom PDF weitergegeben (Anruf, SMS), nie in derselben E-Mail. Ist er verloren, einfach ein neues PDF erstellen.

Hinweis: Im Ordner `06_Software\serviceERP1` liegt eine Server-Fassung der Objektdoku (MongoDB, eigene Rechteverwaltung). Die Plattform hier braucht keinen eigenen Server, keine Datenbank und kein Hosting außer statischen Dateien. Alles bleibt in SharePoint und nutzt die Microsoft-Anmeldung. Das passt zu den bestehenden Werkzeugen und spart Betrieb und Wartung.

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

Stand: bald (30 Tage vor dem Fenster), fällig, in der Nachfrist, abgelaufen. Maßgeblich ist immer der Monat auf der Plakette. Nach der Begutachtung schlägt die App den nächsten Monat vor; wurde ein Pkw noch nach altem Recht begutachtet, nimmt sie im Zweifel den früheren Termin. Der gestanzte Monat der neuen Plakette ersetzt den Vorschlag. Bei schweren Mängeln gibt es keine neue Plakette, das Pickerl bleibt fällig.

**Service:** Intervall in Monaten und/oder km mit letztem Service, oder direkt das nächste Service laut Anzeige im Auto. Fällig ist, was zuerst kommt. Aus den km-Ständen (bei Terminen, beim Reifenwechsel oder über „km“) rechnet die App die km pro Monat und schätzt, wann der km-Stand erreicht ist. „Bald“ heißt: in 30 Tagen oder weniger als 1.500 km.

**Weitere Fälligkeiten:** frei benennbar mit Datum und optional „wiederholen alle … Monate“, z. B. Tachographprüfung (alle 24 Monate), Verbandskasten, Jahresvignette, Leasingende.

**Werkstatttermin:** sammelt, was erledigt werden soll (Service, Pickerl, weitere). Beim Reifenwechsel bietet die App fällige Aufgaben unter „Gleich mit erledigen“ an, damit das Auto nur einmal in die Werkstatt muss. „Werkstatttermine vorschlagen“ sucht für alle Fahrzeuge mit offenen Fälligkeiten freie Plätze neben den Diensten, wie beim Reifenwechsel. Die E-Mail an die Fahrerin oder den Fahrer nennt, was gemacht wird, mit Hinweis „Zulassungsschein im Auto lassen“ fürs Pickerl. Die Sammelliste an die Werkstatt enthält Reifen- und Werkstatttermine.

**Erledigt:** km-Stand, Kosten, nächstes Service (vorgeschlagen aus dem Intervall), Pickerl-Ergebnis und Monat der neuen Plakette, weitere Fälligkeiten abhaken (wiederkehrende rücken weiter).

**Zu erledigen:** Fahrzeuge mit fälligem oder bald fälligem Pickerl, Service oder weiterer Fälligkeit ohne Termin, und Werkstatttermine zum Bestätigen. Die CSV im Reiter „Service & Pickerl“ ist eine Fahrzeugliste mit allen Fälligkeiten.

## Ohne Netz (Keller, Tiefgarage)

Mit SharePoint arbeitet die App auch ohne Netz weiter:

- Der letzte Stand jeder Datei liegt im Gerät (Browser-Speicher). Die App startet auch ohne Netz, wenn das Gerät schon einmal verbunden war.
- Erfasstes (Ablesungen, Kontrollen, Mappe, Dienstplan) wird im Gerät festgehalten. Oben steht dann **„Offline · 2 Änderungen warten“**. Das bleibt auch erhalten, wenn die App geschlossen oder das Handy neu gestartet wird.
- **Fotos** werden zuerst als kleines Vorschaubild gezeigt und hochgeladen, sobald Netz da ist.
- Mit Netz (zurück in der App oder Netz wieder da) wird **sofort gespeichert und mit den Änderungen anderer zusammengeführt**. Haben zwei Personen dieselbe Ablesung erfasst, bleiben beide sichtbar, nichts wird still überschrieben.
- Ohne Netz geht nicht: E-Mail-Versand, Kalender, Übernahme aus SharePoint.

## Was die Plattform einfacher macht

- **Eine Anmeldung, eine Adresse, eine App am Handy.** Am Handy zeigt die Leiste unten die Module der eigenen Rolle (z. B. Zähler, Kontrolle, Mappe).
- **Gemeinsame Objekte.** Objekt-ID, Kunde und Adresse stehen einmal zentral. Damit fallen die Schreibvarianten und freien Objektnummern der Einzelwerkzeuge weg.
- **Zu erledigen** sammelt alles, was ansteht, je nach Rolle: Abwesenheiten, periodische Leistungen, Korrekturen, fällige Ablesungen, fällige Kontrollen, Gefahren und überschrittene Fristen.
- **Hinweise im Einsatz:** Wer den Einsatz an einem Objekt öffnet, sieht fällige Ablesungen und offene Mängel dort.
- **Schnellsuche** mit Strg+K oder der Lupe: Personen, Objekte, Kunden, Zählernummern, Kontrollen und Ansichten.
- **Rundgang:** Alle offenen Zähler eines Objekts nacheinander, sortiert nach Lage, mit „Speichern & weiter“.
- **Planung verbindet die Module:** Ablesung und Nacharbeit landen als Einsatz im Dienstplan, mit Zeit, Person, Stunden und Zeitkonto.

## Vorschau

[Zählerstände](vorschau/32-zaehlerstaende.png) · [Ablesen am Handy](vorschau/33-ablesen-handy.png) · [Objektkontrolle](vorschau/34-objektkontrolle.png) · [Offene Mängel](vorschau/35-offene-maengel.png) · [Kontrolle am Handy](vorschau/36-kontrolle-handy.png) · [Objektmappe, Leistungsverzeichnis](vorschau/37-objektmappe-leistungen.png) · [Übernahme aus den Werkzeugen](vorschau/38-uebernahme.png) · [Verlauf der Objektmappe](vorschau/39-objektmappe-verlauf.png) · [Objektblatt auf Rumänisch](vorschau/40-objektblatt-ro.png) · [Öffnungscode](vorschau/41-oeffnungscode.png) · [Fahrzeuge & Reifen](vorschau/42-fahrzeuge-reifen.png) · [Termine vorschlagen](vorschau/43-reifen-vorschlag.png) · [Fahrer/innen informieren](vorschau/44-reifen-mail.png) · [Service & Pickerl](vorschau/45-service-pickerl.png) · [Werkstatttermin](vorschau/46-werkstatttermin.png) · [Pickerl erledigt](vorschau/47-pickerl-erledigt.png) · [Cleanos App, Wochenübersicht](vorschau/48-cleanos-design.png) · [Darstellung wählen](vorschau/49-darstellung.png) · [Cleanos Nachtblau, dunkel](vorschau/50-cleanos-nacht-dunkel.png) · [Berechtigungen](vorschau/51-berechtigungen.png) · [Tablet](vorschau/52-tablet.png) · [Übersicht](vorschau/53-uebersicht.png)
