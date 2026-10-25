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

## Rollen

| Rolle (Wert in Entra ID) | sieht | darf ändern |
|---|---|---|
| `disposition` – Disposition / Büro | alles | alles |
| `lohnverrechnung` | Auswertung & Lohn | Auswertung & Lohn |
| `objektleitung` | Dienstplan (lesen), Zähler, Kontrolle, Objektmappe | Zähler, Kontrolle, Objektmappe |
| `objektservice` | Zähler, Kontrolle, Objektmappe | Zähler, Kontrolle |
| `ableser` | Zählerstände | Zählerstände |
| `pruefer` – Prüfer/in | Objektkontrolle, Objektmappe | Objektkontrolle |
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

**Übernehmen:**

1. In SharePoint unter `Cleanos_Daten/Wasserzähler - Ablesung/…` die Jahreslisten `Ablesung_<Ort>_<Jahr>.json` herunterladen (oder die Komplett-Sicherung des Werkzeugs).
2. In der App unter **Zählerstände → Übernehmen** alle Dateien auf einmal wählen.
3. Ergebnis:
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
- Statt Kalendertermin in Outlook steht die Nachkontrolle in „Zu erledigen“. Das braucht kein zusätzliches Recht wie *Calendars.ReadWrite*, dessen fehlende Zustimmung sonst die ganze Anmeldung scheitern ließe.

Die bisherigen Kontrollen sind Testdaten und werden nicht übernommen.

### Objektdokumentation

Laut Werkzeug liegen keine echten Daten in SharePoint, weil die Anmeldung nie funktioniert hat. Die Objektmappe übernimmt das Modell und hängt am zentralen Objekt.

Jedes Objekt hat:

- Ansprechpartner (auch intern)
- Zugang ohne Codes, nur der Hinweis, wo sie zu erfragen sind
- Geräte
- Hinweise
- Dokumente als Links
- das Leistungsverzeichnis: Bereiche mit Leistungen, Häufigkeit (täglich bis jährlich, nach Bedarf, witterungsabhängig) und Richtzeit

Die Stunden werden gerechnet und mit dem Stammplan des Dienstplans verglichen. Eine Abweichung über 10 % wird markiert.

Das **Objektblatt** gibt es mit drei Voreinstellungen:

- **Mitarbeiter**: mit Zugang, ohne Richtzeiten
- **Kunde**: Leistungsverzeichnis; vertrauliche Abschnitte sind gesperrt und nie enthalten
- **Akte**: alles

Vertrauliche Abschnitte sind in der Fußzeile vermerkt.

Noch nicht übernommen (nächste Schritte, falls gewünscht):

- Fassungsverlauf mit Unterschieden
- Raumbuch
- Blatt in Englisch/Rumänisch
- PDF mit Öffnungscode

Hinweis: Im Ordner `06_Software\serviceERP1` liegt eine Server-Fassung der Objektdoku (MongoDB, eigene Rechteverwaltung). Die Plattform hier braucht keinen eigenen Server, keine Datenbank und kein Hosting außer statischen Dateien. Alles bleibt in SharePoint und nutzt die Microsoft-Anmeldung. Das passt zu den bestehenden Werkzeugen und spart Betrieb und Wartung.

## Was die Plattform einfacher macht

- **Eine Anmeldung, eine Adresse, eine App am Handy.** Am Handy zeigt die Leiste unten die Module der eigenen Rolle (z. B. Zähler, Kontrolle, Mappe).
- **Gemeinsame Objekte.** Objekt-ID, Kunde und Adresse stehen einmal zentral. Damit fallen die Schreibvarianten und freien Objektnummern der Einzelwerkzeuge weg.
- **Zu erledigen** sammelt alles, was ansteht, je nach Rolle: Abwesenheiten, periodische Leistungen, Korrekturen, fällige Ablesungen, fällige Kontrollen, Gefahren und überschrittene Fristen.
- **Hinweise im Einsatz:** Wer den Einsatz an einem Objekt öffnet, sieht fällige Ablesungen und offene Mängel dort.
- **Schnellsuche** mit Strg+K oder der Lupe: Personen, Objekte, Kunden, Zählernummern, Kontrollen und Ansichten.
- **Rundgang:** Alle offenen Zähler eines Objekts nacheinander, sortiert nach Lage, mit „Speichern & weiter“.
- **Planung verbindet die Module:** Ablesung und Nacharbeit landen als Einsatz im Dienstplan, mit Zeit, Person, Stunden und Zeitkonto.

## Vorschau

[Zählerstände](vorschau/32-zaehlerstaende.png) · [Ablesen am Handy](vorschau/33-ablesen-handy.png) · [Objektkontrolle](vorschau/34-objektkontrolle.png) · [Offene Mängel](vorschau/35-offene-maengel.png) · [Kontrolle am Handy](vorschau/36-kontrolle-handy.png) · [Objektmappe, Leistungsverzeichnis](vorschau/37-objektmappe-leistungen.png)
