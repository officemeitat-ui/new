# Plattform: ein Tool, mehrere Module, Rollen statt eigener Programme

Bisher gab es vier getrennte Werkzeuge mit je eigener Anmeldung: den Dienstplan, die Wasserzähler-Ablesung, die Objektkontrolle und die Objektdokumentation. Jetzt läuft alles in einer App. Es gibt eine Anmeldung, die Objekte und Mitarbeitenden sind gemeinsam gepflegt, und es gibt eine Glocke „Zu erledigen“. Jede Rolle sieht nur ihre Module.

| Modul | Ersetzt | Wer arbeitet damit |
|---|---|---|
| **Dienstplan** (Planung) | – | Disposition |
| **Auswertung & Lohn** | – | Disposition, Lohnverrechnung |
| **Stammdaten** | Objektlisten in den Einzeltools | Disposition |
| **Zählerstände** | Wasserzähler-Ablesung (wasserzaehler.cleanos.at) | Ableser, Objektservice, Objektleitung |
| **Objektkontrolle** | Prüfprotokoll-Tool (pruefprotokoll.cleanos.at) | Prüfer/in, Objektservice, Objektleitung |
| **Objektmappe** | Objektdokumentation (objektdoku.cleanos.at) | Objektleitung; Prüfer/Objektservice lesen |
| **Fahrzeuge & Reifen** | Listen und Zettel zum Reifenwechsel | Disposition, Fuhrpark |

## Rollen

| Rolle (Wert in Entra ID) | sieht | darf ändern |
|---|---|---|
| `disposition` – Disposition / Büro | alles | alles |
| `lohnverrechnung` | Auswertung & Lohn | Auswertung & Lohn |
| `objektleitung` | Dienstplan (lesen), Zähler, Kontrolle, Objektmappe | Zähler, Kontrolle, Objektmappe |
| `objektservice` | Zähler, Kontrolle, Objektmappe | Zähler, Kontrolle |
| `ableser` | Zählerstände | Zählerstände |
| `pruefer` – Prüfer/in | Objektkontrolle, Objektmappe | Objektkontrolle |
| `fuhrpark` – Fuhrpark | Fahrzeuge & Reifen | Fahrzeuge & Reifen |
| `lesen` | Dienstplan | nichts |

- Mehrere Rollen addieren sich (z. B. Objektleitung und Lohnverrechnung).
- Ohne jede Rolleneinrichtung dürfen alle angemeldeten Personen alles (wie bisher).
- Ist etwas eingerichtet und eine Person hat keine Rolle, sieht sie den Dienstplan nur lesend.
- Eigene Rollen gehen per `config.json` (siehe unten).
- Im Browser-Modus (ohne SharePoint) gibt es oben „Ansicht als …“. Damit lässt sich ausprobieren, was eine Rolle sieht.

### Rollen in Entra ID einrichten (empfohlen)

1. **Entra ID → App-Registrierungen → Cleanos Dienstplan → App-Rollen → App-Rolle erstellen**. Für jede Rolle:
   - Anzeigename: z. B. „Ableser“
   - Zulässige Mitgliedstypen: **Benutzer/Gruppen**
   - Wert: `ableser`; auch `Dienstplan.Ableser` funktioniert
   - Beschreibung beliebig, Häkchen „aktiviert“ setzen
2. **Unternehmensanwendungen → Cleanos Dienstplan → Benutzer und Gruppen → Benutzer/Gruppe hinzufügen**: Person oder Gruppe wählen, dann die Rolle wählen.
   - Gruppen zuweisen braucht Entra ID P1 (in Microsoft 365 Business Premium enthalten). Ohne P1 die Personen einzeln zuweisen.
   - Die vorhandene Gruppe „Wasserzaehler_Ablesung“ kann einfach die Rolle `ableser` bekommen.
3. Unter *Eigenschaften* **Zuweisung erforderlich = Ja** setzen. Dann kann sich niemand ohne Rolle anmelden.
4. Die Rolle steht nach der nächsten Anmeldung im Token (Claim `roles`). Wer gerade angemeldet ist, meldet sich einmal ab und wieder an.

### Alternative ohne Entra-Rollen: config.json

```json
"access": {
  "planners": ["disposition@cleanos.at"],
  "members": {
    "ableser": ["max.muster@cleanos.at"],
    "pruefer": ["pruefer@cleanos.at"],
    "lohnverrechnung": ["lohn@kanzlei.at"]
  },
  "roles": {
    "hausbetreuung": { "label": "Hausbetreuung", "modules": ["zaehler", "objektmappe"], "edit": ["zaehler"] }
  }
}
```

`planners` gilt wie bisher als Disposition. Rollen aus Entra ID und aus `members` addieren sich.

## Daten wirklich trennen: SharePoint-Rechte je Ordner

Die Rollen steuern, was die App zeigt. Echten Schutz geben die SharePoint-Rechte, denn die App arbeitet nur mit den Rechten der angemeldeten Person. Jedes Modul hat seinen eigenen Ordner. Darf jemand eine Datei nicht lesen, bleibt das Modul leer und wird nie gespeichert. Die App läuft weiter.

Empfehlung (Bibliothek `Cleanos_Daten`, Ordner `Plattform`):

| Ordner / Datei | Lesen | Bearbeiten |
|---|---|---|
| `Plattform/` (Grundrecht) | alle Rollen | – |
| `daten/` (Stammdaten, Wochenpläne) | alle Rollen | Disposition |
| `daten/zeitkonto.json` (Salden, Stundenlöhne, Monatsabschlüsse) | nur Disposition, Lohnverrechnung | Disposition, Lohnverrechnung |
| `daten/abwesenheiten.json` (Krankenstände sind Gesundheitsdaten) | Disposition, Lohnverrechnung, Objektleitung | Disposition |
| `zaehler/` (inkl. Fotos) | Objektleitung | Ableser, Objektservice, Objektleitung |
| `kontrolle/` (inkl. Fotos, Unterschriften) | Objektleitung | Prüfer, Objektservice, Objektleitung |
| `objektmappe/` | Prüfer, Objektservice | Objektleitung, Disposition |

**Stundenlöhne** stehen deshalb nicht mehr in `stammdaten.json`, sondern in `zeitkonto.json`. Beim ersten Speichern durch die Disposition wandern sie automatisch dorthin.

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

**Übernehmen:** „Liste einfügen“ nimmt eine Excel-Liste (Kennzeichen, Fahrzeug, Art, Fahrer/in, Sommerreifen, Winterreifen, Lagerort, Werkstatt, Montiert). Fahrer/innen und Werkstätten werden über den Namen zugeordnet, vorhandene Kennzeichen ergänzt. Die Schnellsuche findet Kennzeichen auch ohne Bindestrich.

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

[Zählerstände](vorschau/32-zaehlerstaende.png) · [Ablesen am Handy](vorschau/33-ablesen-handy.png) · [Objektkontrolle](vorschau/34-objektkontrolle.png) · [Offene Mängel](vorschau/35-offene-maengel.png) · [Kontrolle am Handy](vorschau/36-kontrolle-handy.png) · [Objektmappe, Leistungsverzeichnis](vorschau/37-objektmappe-leistungen.png) · [Übernahme aus den Werkzeugen](vorschau/38-uebernahme.png) · [Verlauf der Objektmappe](vorschau/39-objektmappe-verlauf.png) · [Objektblatt auf Rumänisch](vorschau/40-objektblatt-ro.png) · [Öffnungscode](vorschau/41-oeffnungscode.png) · [Fahrzeuge & Reifen](vorschau/42-fahrzeuge-reifen.png) · [Termine vorschlagen](vorschau/43-reifen-vorschlag.png) · [Fahrer/innen informieren](vorschau/44-reifen-mail.png)
