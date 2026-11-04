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
| **Fakturierung** | Angebote, Rechnungen, Daueraufträge, offene Posten, Mahnungen | Disposition, Buchhaltung |

## Rollen

| Rolle (Wert in Entra ID) | sieht | darf ändern |
|---|---|---|
| `disposition` – Vollzugriff (Büro, IT) | alles | alles |
| `objektmanagement` – Objektmanagement | Einsatzplanung (lesen), Leistungsnachweis, Objektkontrolle, Objektdoku, Reklamationen, Schlüsselbuch, Material & Lager | Objektkontrolle, Objektdoku, Reklamationen, Schlüsselbuch, Material & Lager |
| `vorarbeiter` – Vorarbeiter/in | Wasserzähler | Wasserzähler |
| `mattenwechsel` – Mattenwechsel | Mattenwechsel | Mattenwechsel |
| `lohnverrechnung` | Auswertung & Lohn | Auswertung & Lohn |
| `objektleitung` | Dienstplan (lesen), Leistungsnachweis, Wasserzähler, Objektkontrolle, Objektdoku, Reklamationen, Schlüsselbuch, Material & Lager, Unterweisungen & Fristen | Wasserzähler, Objektkontrolle, Objektdoku, Reklamationen, Schlüsselbuch, Material & Lager, Unterweisungen & Fristen |
| `objektservice` | Wasserzähler, Objektkontrolle, Objektdoku, Reklamationen, Schlüsselbuch, Material & Lager | Wasserzähler, Objektkontrolle, Reklamationen, Material & Lager |
| `lager` – Lager & Einkauf | Material & Lager | Material & Lager |
| `ableser` | Wasserzähler | Wasserzähler |
| `pruefer` – Prüfer/in | Objektkontrolle, Objektdoku | Objektkontrolle |
| `fuhrpark` – Fuhrpark | Fahrzeuge & Reifen | Fahrzeuge & Reifen |
| `buchhaltung` – Buchhaltung | Fakturierung (dazu nur die Objektliste) | Fakturierung |
| `lesen` | Dienstplan | nichts |

- Mehrere Rollen addieren sich (z. B. Objektmanagement und Vorarbeiter).
- Bei den Werkzeugen entscheidet die Rolle, wer sie in der App sieht. Was jemand darin lesen oder ändern darf, regeln die SharePoint-Rechte auf die Ordner der Werkzeuge (Tabelle unten).
- **Mattenwechsel wird pro Gruppe zugewiesen:** die Objekt-ID der Microsoft-Gruppe (z. B. Fahrer:innen der Touren) unter `access.groups.mattenwechsel` eintragen. Wer zusätzlich in einer anderen Gruppe ist, bekommt beides (z. B. Vorarbeiter + Mattenwechsel). Die Gruppe braucht in SharePoint „Bearbeiten“ auf `Mattenwechsel` und auf `Stammdaten` (der Mattenwechsel pflegt beim Abschließen den gemeinsamen Kundenstamm `Stammdaten/Kunden.json`).
- **Im Betrieb (SharePoint) gilt: ohne Rolle kein Zugriff.** Wer keiner Gruppe zugeordnet ist, sieht „Kein Bereich freigegeben“, und die App lädt keine einzige Datei.
- `office@cleanos.at` und `it@cleanos.at` haben Vollzugriff (`config.production.json` → `access.planners`), auch bevor die Gruppen eingerichtet sind.
- Im Browser-Modus (Probe ohne SharePoint) gibt es unten in der Seitenleiste „Ansicht als …“ (am Handy unter „Mehr“ → „Konto & Daten“). Damit lässt sich ausprobieren, was eine Rolle sieht. Ohne jede Einrichtung darf dort jede Person alles.
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

### Variante mit App-Rollen (ohne Objekt-IDs, ohne neues Paket)

1. **App-Registrierungen → Cleanos App → App-Rollen → App-Rolle erstellen**, je Rolle: Anzeigename (z. B. „Objektmanagement“), zulässige Mitgliedstypen **Benutzer/Gruppen**, Wert `objektmanagement` (auch `Cleanos.Objektmanagement` geht, Groß-/Kleinschreibung egal), Beschreibung (Pflichtfeld, frei), aktiviert.
2. **Unternehmensanwendungen → Cleanos App → Benutzer und Gruppen → Benutzer/Gruppe hinzufügen**: Person (oder Gruppe) wählen, Rolle wählen. Dann braucht es keine Objekt-IDs in der Konfiguration. Einzelne Personen zuweisen geht mit jeder Lizenz; **ganze Gruppen** zuweisen braucht Entra ID P1 (z. B. in Microsoft 365 Business Premium). Nach dem Zuweisen einmal ab- und wieder anmelden.
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

Gruppen, App-Rollen und `members` addieren sich. Modulnamen: `planung`, `auswertung`, `stammdaten`, `zaehler` (Wasserzähler), `kontrolle` (Objektkontrolle), `objektmappe` (Objektdoku), `matten` (Mattenwechsel), `fahrzeuge`, `reklamationen`, `material` (Material & Lager), `schluessel` (Schlüsselbuch), `unterweisungen` (Unterweisungen & Fristen). Der Leistungsnachweis gehört zur Einsatzplanung (`planung`).

## Daten wirklich trennen: SharePoint-Rechte je Ordner

Die Rollen steuern, was die App zeigt und welche Dateien sie überhaupt anfragt. **Echten Schutz geben die SharePoint-Rechte**, denn die App arbeitet nur mit den Rechten der angemeldeten Person; ohne SharePoint-Recht kommt auch niemand mit einem anderen Programm an die Daten. Deshalb hat jede Berechtigungsstufe einen eigenen Ordner.

Bibliothek `Cleanos_Daten`, Ordner `Plattform`:

| Ordner | Inhalt | Vollzugriff | Objektmanagement | Vorarbeiter |
|---|---|---|---|---|
| `objekte/` | Objekte (Name, Adresse, Revier) | Bearbeiten | Lesen | – |
| `daten/` | Mitarbeitende, Leistungen, Regeln; `abwesend.json`: wer wann fehlt, **ohne Grund** | Bearbeiten | Lesen | – |
| `plaene/` | Wochenpläne (Einteilungen, Änderungsprotokoll) | Bearbeiten | Lesen | – |
| `personal/` | Urlaub und Krankenstände (Gesundheitsdaten) | Bearbeiten | – | – |
| `lohn/` | Zeitkonto, Stundenlöhne, Monatsabschlüsse | Bearbeiten | – | – |
| `fahrzeuge/` | Fahrzeuge, Reifen, Service, Pickerl | Bearbeiten | – | – |
| `reklamationen/` | Reklamationen je Objekt | Bearbeiten | Bearbeiten | – |
| `kalkulation/` | Objektkalkulation (Löhne, Margen) | Bearbeiten | – | – |
| `material/` | Material & Lager (Artikel, Buchungen, Bestellungen, Anforderungen) | Bearbeiten | Bearbeiten | – |
| `schluessel/` | Schlüsselbuch (wer hat welchen Schlüssel, Verlauf, Unterschriften) | Bearbeiten | Bearbeiten | – |
| `nachweise/` | Leistungsnachweis: Einstellungen und Versand-Vermerke | Bearbeiten | Bearbeiten | – |
| `unterweisungen/` | Unterweisungen & Fristen je Person (mit Unterschriften) | Bearbeiten | – | – |
| `fakturierung/` | Fakturierung: Kunden, Angebote, Rechnungen, Zahlungen; PDFs unter `fakturierung/belege/` | Bearbeiten | – | – |
| `berichte/` | Berichte automatisch per E-Mail: Abos (Empfänger, Zeitplan, zuletzt gesendet) | Bearbeiten | – | – |
| `exporte/` | Excel- und PDF-Wochenpläne | Bearbeiten | – | – |

So geht's in SharePoint: Bibliothek öffnen → Ordner `Plattform` → **Zugriff verwalten** → nur die Gruppe Vollzugriff behalten. Dann je Unterordner: **⋯ → Zugriff verwalten → Erweitert → Berechtigungsvererbung beenden**, alle Einträge außer Vollzugriff entfernen und die Gruppe aus der Tabelle mit „Lesen“ bzw. „Bearbeiten“ hinzufügen. Die Ordner legt die App beim ersten Start mit Vollzugriff an.

- **Abwesend ohne Grund:** Objektmanagement und Objektleitung sehen unter *Abwesenheiten*, im Plan und in den Prüfregeln, wer wann fehlt – aber nicht, warum. Dafür schreibt die App beim Speichern der Abwesenheiten eine Liste nur mit Person, von und bis nach `daten/abwesend.json`; Art (Urlaub, Krankenstand …) und Notiz bleiben in `personal/`. Eintragen und ändern bleibt beim Büro.
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
- **Alle Funktionen wie im eigenen Fenster.** Braucht ein Werkzeug ein Recht, dem noch niemand zugestimmt hat (Routen im Mattenwechsel über **Azure Maps**, E-Mail direkt senden mit **Mail.Send**, Nachkontroll-Termin mit **Calendars.ReadWrite**), läuft es ohne diese Funktion weiter, und die App zeigt oben im Werkzeug, was fehlt, mit „Zustimmen“. Darf die Person nicht selbst zustimmen, meldet Microsoft „Genehmigung durch Administrator erforderlich“: dann in Entra die Berechtigung hinzufügen und die Administratorzustimmung erteilen (EINRICHTUNG, Schritt 2). Kamera, Standort und Zwischenablage sind im Rahmen erlaubt wie im eigenen Fenster; **Vollbild** zeigt das Werkzeug über den ganzen Bildschirm.
- **Schneller bereit.** Das zuletzt benutzte Werkzeug lädt nach dem Start der App unsichtbar vor.
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

Eigener Punkt unter *Material & Fuhrpark*: die Firmenfahrzeuge mit Fahrer/in (aus den Mitarbeitenden), Reifensätzen und Einlagerung. Daten liegen in `fahrzeuge/fahrzeuge.json`, mit eigener Rolle `fuhrpark`.

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

## Kalkulation je Objekt

Unter *Auswertung → Kalkulation* (Auswertung & Lohn, Vollzugriff), gespeichert in `kalkulation/kalkulation.json` (nur diese Rollen, weil Löhne und Margen darin stehen).

- **Flächen je Objekt:** Bereich, Art (Büro, Sanitär, Stiegenhaus, Gang, Eingang, Küche, Lager, Sonstiges), Fläche in m², Häufigkeit (täglich Mo–Fr, Mo–Sa, 3×, 2×, 1× pro Woche, 14-tägig, monatlich, quartalsweise) und, falls abweichend, ein eigener Leistungswert.
- **Stunden je Monat:** je Fläche m² ÷ Leistungswert (m² je Stunde) × Reinigungen je Woche × 4,33, dazu Rüst- und Nebenzeiten (Standard 10 %).
- **Verrechnungssatz:** Stundenlohn (KV-Lohngruppe aus den Regeln oder eigener Wert) + Lohnnebenkosten + Material und Geräte + Verwaltung und Gemeinkosten + Gewinn und Wagnis, jeweils auf die Summe davor. „So rechnet die Kalkulation“ zeigt jeden Schritt in Euro.
- **Ergebnis:** Preis je Monat netto und brutto, je m², dazu der Vergleich mit dem **Budget** des Objekts und den Stunden **laut Reinigungsplan** im laufenden Monat. „Als Budget übernehmen“ setzt die kalkulierten Stunden als Budget (das Objekt-Controlling vergleicht damit).
- **PDF:** **Angebot** für den Kunden (Leistungsverzeichnis mit Flächen und Häufigkeit, Monatspreis netto, USt., brutto, Gültigkeit 30 Tage; ohne Stunden, Löhne und Zuschläge) und **Kalkulation (intern)** mit allen Werten.
- **Grundlagen** (einmal einstellen): Leistungswerte je Art (Vorgabe Büro 200, Sanitär 60, Stiegenhaus 150, Gang 250, Eingang 120, Küche 80, Lager 300, Sonstiges 150 m²/h; Ausschreibungen nennen etwa Büro 150–250, Sanitär 35–120, Treppenhaus 130–200), Lohngruppe, Lohnnebenkosten (Vorgabe 90 %; den eigenen Wert aus dem WKO-Merkblatt „Lohnnebenkosten Gebäudereiniger“ oder von der Steuerberatung nehmen), Rüstzeit, Material (8 %), Verwaltung (15 %), Gewinn (5 %), USt. (20 %). Alle Vorgaben sind Richtwerte, mit der eigenen Nachkalkulation abgleichen.

## Export für das Lohnprogramm (BMD, RZL)

Unter *Überstunden & Auszahlung* → **„Export Lohnprogramm“** (Rolle Lohnverrechnung oder Vollzugriff): eine Textdatei mit Bewegungsdaten je Person und Lohnart für den Monat, zum Einlesen in BMD, RZL oder ein anderes Lohnprogramm.

- **Lohnarten:** Je Kennzahl die Lohnart-Nummer aus dem eigenen Lohnprogramm eintragen (die Nummern legt jede Lohnverrechnung selbst fest). Kennzahlen: Normalstunden, Mehrarbeit ausbezahlt, Überstunden je Tag/Nacht/Sonntag/Sonntagnacht/Feiertag, 11./12. Stunde, nur Überstundenzuschlag (bei „Zeitausgleich 1:1 + Zuschlag in Geld“), Nacht-, Sonntags- und Feiertagsstunden für die Zuschläge, Feiertag angerechnet, Urlaub und Krankenstand (Tage und angerechnete Stunden), Fahrzeit. Leer = nicht exportieren. Der Dialog zeigt je Kennzahl die Summe im Monat.
- **Überstunden** kommen nur in die Datei, wenn sie ausbezahlt werden; bei Zeitausgleich 1:1,5 bleiben sie im Zeitkonto.
- **Dateiformat:** Spalten und Reihenfolge (Personalnummer, Name, Lohnart, Menge, Einheit, Satz, Betrag, Von, Bis, Monat, Text), Kopfzeile, Trennzeichen (Strichpunkt, Komma, Tabulator), Dezimalzeichen, Datum (TT.MM.JJJJ, JJJJ-MM-TT, MM/JJJJ). Vorgabe: `Personalnummer;Lohnart;Menge;Satz;Von;Bis;Text`, UTF-8, Zeilenende wie unter Windows. Im Lohnprogramm einmal ein Importformat mit genau diesen Spalten anlegen (BMD: Bewegungsdaten-Import, RZL: Import der variablen Bezüge) oder hier die Spalten an eine vorhandene Vorlage anpassen.
- **Hinweise** vor dem Herunterladen: Monat noch nicht abgeschlossen, fehlende Wochen, Personen ohne Personalnummer, Werte ohne Lohnart. Vorschau der ersten Zeilen.
- Gespeichert werden Lohnarten und Format im Zeitkonto (`lohn/zeitkonto.json`), also nur für Lohnverrechnung und Vollzugriff.

**Einmal mit der Lohnverrechnung abstimmen:** Lohnart-Nummern, ob der Stundenlohn als Satz mitgehen soll oder das Lohnprogramm ihn selbst kennt, und ob Urlaub und Krankenstand in Tagen oder Stunden gebucht werden. Den ersten Monat parallel zur bisherigen Erfassung prüfen.

## Fahrzeiten aus Adressen

Zwischen zwei Einsätzen am selben Tag rechnet die App eine Fahrt (zählt als Arbeitszeit). Woher die Minuten kommen, in dieser Reihenfolge:

1. eine für die Woche oder die Leistung eingetragene Fahrt (Einsatz → „Fahrt danach“);
2. eine Strecke unter *Regeln & Feiertage → Fahrzeiten zwischen Objekten*;
3. **eine Schätzung aus den Koordinaten** beider Objekte: Luftlinie × 1,35 (Straße statt Luftlinie), geteilt durch die Durchschnittsgeschwindigkeit (Standard 35 km/h), plus Zuschlag je Fahrt (Standard 5 Minuten: Parken, Gehen, Laden), auf 5 Minuten aufgerundet; unter 100 m: 0 Minuten;
4. die Pauschale (Standard 30 Minuten).

**Koordinaten:** im Objekt (*Objekte & Leistungen → Objekt bearbeiten*) „Suchen“ fragt OpenStreetMap nach der Adresse; oder von Hand „Breite, Länge“ eintragen (z. B. in Google Maps: Rechtsklick auf den Ort, Zahlen kopieren). Unter *Regeln & Feiertage → Fahrzeiten* sucht „Fehlende suchen (OpenStreetMap)“ alle Objekte ohne Koordinaten nacheinander (eine Anfrage je Sekunde, wie OpenStreetMap es verlangt). „Schätzen“ zeigt für zwei Objekte die Kilometer und Minuten; „Hinzufügen“ trägt den Wert fest ein, z. B. wenn er korrigiert werden soll. Geschwindigkeit und Zuschlag sind einstellbar, die Schätzung lässt sich abschalten.

**Genauigkeit:** Die Schätzung ersetzt keinen Routenplaner (Einbahnen, Brücken, Stau). Für Strecken, die oft vorkommen und deutlich abweichen, eine feste Strecke eintragen. **Datenschutz:** Gesucht werden nur Objektadressen, keine Namen; die Anfrage geht an die OpenStreetMap Foundation (Nominatim). Wer das nicht will, trägt die Koordinaten von Hand ein.

## Reklamationen

Eigener Punkt unter *Objekte & Kunden* (Modul „Reklamationen“; Rollen Objektmanagement, Objektleitung, Objektservice und Vollzugriff). Gespeichert in `reklamationen/reklamationen.json`.

- **Erfassen:** Objekt, Tag des Mangels, Eingang (Telefon, E-Mail, vor Ort, Objektkontrolle, intern), Art (Reinigung mangelhaft, Leistung nicht erbracht, nicht erschienen, Schaden, Schlüssel/Sicherheit, Verhalten, Sonstiges), Beschreibung, Ansprechperson. Auch direkt aus dem Einsatz-Dialog („Reklamation erfassen“, Objekt und Tag vorbelegt).
- **Laut Plan dort:** Die App zeigt, wer am Tag und am Vortag (Abendreinigung) im Objekt eingeteilt war; ankreuzen, wer betroffen ist. Nur intern.
- **Maßnahme und Frist:** Die Frist wird nach der Art vorgeschlagen (Reinigung, nicht erbracht, Schlüssel: 1 Tag; Schaden, Verhalten: 3 Tage; Sonstiges: 7 Tage). Status offen, in Arbeit, erledigt; **Erledigt** nur mit Ergebnis, dazu „Kunde informiert“. Jede Änderung steht im Verlauf.
- **Übersicht:** offen (überfällige zuerst), erledigt, alle, je Objekt; Kennzahlen (offen, überfällig, letzte 90 Tage, Tage bis erledigt) und ein Hinweis bei **Häufung** (3 oder mehr in 90 Tagen im selben Objekt). CSV für die Auswertung.
- **PDF für den Kunden:** Eingang, Mangel, Maßnahme, Ergebnis und Verlauf, **ohne Namen der Mitarbeitenden**.
- **Zu erledigen** meldet Reklamationen mit überschrittener Frist; der Einsatz-Dialog zeigt offene Reklamationen des Objekts.

## Material & Lager

Eigener Punkt *Material* in der Seitenleiste (Modul „Material & Lager“; Rollen Lager & Einkauf, Objektmanagement, Objektleitung, Objektservice und Vollzugriff). Gespeichert in `material/material.json`.

- **Start:** „Grundsortiment anlegen“ (14 übliche Artikel mit Melde- und Sollbestand, ohne Preise) oder „Liste einfügen“ aus Excel (Spalten Artikel, Einheit, Kategorie, Lieferant, Artikelnummer, Preis, Mindestbestand, Sollbestand, Packung, Bestand; vorhandene Artikel gleichen Namens werden aktualisiert, neue Lieferanten angelegt, „Bestand“ wird Anfangsbestand). Danach Lieferanten mit Bestell-E-Mail ergänzen und einmal Inventur machen.
- **Bestand** je Lager (Hauptlager, dazu z. B. Außenlager oder Bus), Melde- und Sollbestand, bestellte Mengen, Zustand (ok, nachbestellen, leer), Lagerwert, Suche, CSV. Der Bestand wird nie gespeichert, sondern immer aus den Buchungen gerechnet; so stimmt er auch, wenn zwei Personen gleichzeitig buchen.
- **Buchen:** *Ausgabe* an ein Objekt oder an eine Person (z. B. Arbeitskleidung), *Wareneingang* ohne Bestellung, *Umbuchen* zwischen Lagern, *Inventur* (gezählte Mengen eintragen, gebucht wird nur die Differenz; Zählliste als PDF). Fällt ein Bestand unter null, kommt ein Hinweis. Gebucht wird nie überschrieben: *Buchungen* zeigt das Journal, „Stornieren“ bucht die Gegenrichtung. Buchungen älter als zwei Jahre fasst die App je Artikel und Lager zu einem Übertrag zusammen (Datei bleibt klein).
- **Bestellen:** Der *Bestellvorschlag* nimmt jeden Artikel am oder unter dem Meldebestand, der noch nicht bestellt ist, füllt bis zum Sollbestand auf (auf Packungen gerundet) und gruppiert je Lieferant. „Bestellung anlegen“ → Entwurf prüfen → **„Per E-Mail bestellen“** (mit Mail.Send aus dem eigenen Postfach, Bestellschein als PDF im Anhang; sonst öffnet sich das E-Mail-Programm und das PDF liegt im Download-Ordner) oder „Als bestellt markieren“ (Telefon, Webshop). **Wareneingang** je Position, auch in Teilen; der Preis der Lieferung wird zum Artikelpreis. Überfällige Lieferungen stehen unter „Zu erledigen“.
- **Anforderungen:** Objektleitung oder Vorarbeiter:innen erfassen, was im Objekt fehlt (Artikel mit Menge oder Freitext). Mit **Plan am Handy** melden es die Reinigungskräfte selbst: „Material fehlt?“ → Objekt (nur Objekte aus dem eigenen Plan) → was fehlt. Das Büro bekommt einen Push; sobald die App im Büro offen ist, landet die Meldung automatisch hier und die Person bekommt „notiert“. Im Lager: **Ausgeben** (Freitext wird, wo möglich, einem Artikel zugeordnet; Objekt vorbelegt; die Person bekommt „erledigt“), **Bestellen** (in den Entwurf beim Lieferanten) oder **Ablehnen** mit Antwort ans Handy. Offene Anforderungen zeigt auch der Einsatz-Dialog beim Objekt.
- **Verbrauch** je Objekt, je Person und je Kategorie für Monat, Quartal oder 12 Monate, zum Preis bei der Ausgabe; CSV. Wer die Kalkulation sehen darf, bekommt daneben das **Materialbudget** aus der Objektkalkulation (kalkulierte Stunden × Zuschlag „Material und Geräte“ je Stunde) und die Abweichung.
- **Sicherheitsdatenblatt:** Je Artikel lässt sich ein Link hinterlegen (z. B. auf die Datei in SharePoint oder beim Hersteller).
- **Zu erledigen** meldet: Artikel zum Nachbestellen, überfällige Lieferungen, offene Anforderungen.

## Schlüsselbuch

Eigener Punkt unter *Objekte & Kunden* (Modul „Schlüsselbuch“; Rollen Objektmanagement, Objektleitung, Vollzugriff bearbeiten, Objektservice liest). Gespeichert in `schluessel/schluessel.json`.

- **Schlüssel anlegen** je Objekt: Bezeichnung, Nummer/Prägung, Art (Schlüssel, Transponder, Zutrittskarte, Fernbedienung), Aufbewahrung im Büro. Mehrere gleiche auf einmal (bekommen Nummer 1, 2, 3 …). Schlüssel, die bisher direkt beim Objekt eingetragen waren, übernimmt „Übernehmen“ einmal ins Buch (mit der Person, die ihn hat); danach zeigt *Objekt bearbeiten* sie nur noch an.
- **Ausgeben** (auch Weitergabe von Person zu Person) mit Datum, optional „Rückgabe bis“, **Unterschrift am Handy oder Tablet** und **Quittung als PDF**; **Rückgabe** einzeln oder alle Schlüssel einer Person (z. B. beim Austritt, mit Liste als PDF zum Abhaken).
- **Verlust melden** mit Umständen und Maßnahme (Zylinder tauschen, Transponder sperren); **Verlustmeldung als PDF** für den Kunden (ohne Namen). Bis „Kunde informiert“ angehakt ist, steht der Verlust unter „Zu erledigen“. „Wieder da“ und „an Kunden zurück“ schließen den Fall.
- **Hinweise:** Person ausgetreten und hat noch Schlüssel (Fehler), Austritt in 14 Tagen, vereinbarte Rückgabe überschritten, Person länger abwesend.
- **Übergaben laut Plan:** Wer in den nächsten 7 Tagen in einem Objekt eingeteilt ist und keinen Schlüssel hat, mit „Übergeben“ direkt daneben. Die Prüfregel „Schlüsselübergabe nötig“ im Plan liest das Schlüsselbuch (Objekte ohne Eintrag im Buch: weiter die Schlüssel am Objekt).
- Jeder Schritt steht im **Verlauf** des Schlüssels (wann, wer, von wem an wen, unterschrieben ja/nein). Der Einsatz-Dialog zeigt, wer im Objekt welchen Schlüssel hat.

## Leistungsnachweis

Unter *Objekte & Kunden* (für alle, die die Einsatzplanung sehen). Je Objekt und Monat, was laut Plan geleistet wurde:

- je Einsatz: Datum, Zeit laut Plan, Leistung (Sonderleistungen markiert), Status **erbracht**, **entfällt** (Feiertag oder abgesagt, mit Grund), **geplant** (noch nicht vorbei) oder **nicht besetzt** (vor dem Versand im Plan klären; die Übersicht warnt);
- mit **Zeiterfassung im Objekt:** die gestempelten Zeiten je Einsatz („erfasst im Objekt 05:58–08:03“) und der Anteil der Einsätze mit Stempelung;
- **Winterdienst** laut Protokoll (Datum, Uhrzeit, geräumt/gestreut);
- Summen: Einsätze, Stunden laut Plan; Feld für die Unterschrift des Auftraggebers (abschaltbar).

**Namen der Mitarbeitenden** stehen nur drin, wenn eingestellt („Vornamen“ oder „ganze Namen“), Standard ist ohne Namen. **PDF** je Objekt oder **alle als ZIP**; **E-Mail an den Kunden** mit dem PDF im Anhang (mit Mail.Send aus dem eigenen Postfach, sonst E-Mail-Programm), einzeln oder „Alle mit E-Mail senden“ für alle Objekte mit hinterlegter Adresse, die den Monat noch nicht bekommen haben. Die Adresse steht beim Objekt (*Objekt bearbeiten → E-Mail für den Leistungsnachweis*) oder wird beim ersten Versand gemerkt. Jeder Versand wird vermerkt (wann, an wen, wie). Standardmonat ist der Vormonat.

## Kundenbereich

Unter *Objekte & Kunden → Kundenbereich* (Vollzugriff und alle Rollen, die Reklamationen oder die Einsatzplanung bearbeiten: Objektmanagement, Objektleitung, Objektservice). Jeder Kunde oder jedes Objekt bekommt einen **persönlichen Link** (`kunden.php?k=CODE`) und sieht damit ohne Anmeldung eine eigene Seite, so wie „Mein Dienstplan“ für die Mitarbeitenden. Gespeichert in `kundenbereich/kundenbereich.json` (Links mit Code, Einstellungen); den Ordner dürfen nur diese Rollen lesen, weil die Links wie Passwörter wirken.

**Was der Kunde sieht** (je Link einstellbar, Standard: alles):

- **Leistungsnachweise** je Monat als PDF, genau wie unter [Leistungsnachweis](#leistungsnachweis) (gleiche Einstellungen für Namen, erfasste Zeiten und Unterschriftsfeld), für die letzten 3, 6, 12 oder 24 Monate. Der Vormonat erscheint ab dem 5. des Folgemonats (einstellbar), damit das Büro vorher prüfen kann. Hat ein Monat nicht besetzte Einsätze, hält die App ihn zurück und zeigt oben „Zurückgehalten“; erst nach dem Klären im Plan erscheint er. Monate ganz ohne Einteilung (vor der App) entfallen.
- **Winterdienst-Nachweis** je Monat als PDF für Objekte mit Winterdienst-Protokoll: Tag, Uhrzeit, Tätigkeit, Wetterlage, Notiz; ohne Fotos (die bleiben im Büro) und ohne Namen, außer der Leistungsnachweis zeigt Namen.
- **Nächste Termine:** periodische Leistungen der nächsten 13 Wochen (alles außer wöchentlich: 14-tägig, monatlich, quartalsweise, einmalig, z. B. Grund- oder Glasreinigung), verschobene mit Hinweis, entfallene nicht; dazu Termine der Art *Kundentermin* und *Objektbegehung* am Objekt, mit Titel und Uhrzeit, ohne Notiz und Teilnehmende. Qualitätskontrollen und interne Termine nie.
- **Reklamation melden:** Objekt, Art (Reinigung nicht in Ordnung, Leistung nicht erbracht, Schaden, Sonstiges), Beschreibung, aufgefallen am, ein Foto (optional), Name und Telefon oder E-Mail; auf Wunsch eine E-Mail bei jedem neuen Stand. **„Ihre Meldungen“** zeigt eingegangen, in Arbeit oder erledigt, bei erledigt „Unsere Rückmeldung“ (das Ergebnis aus der Reklamation).

Die Seite spricht den Kunden mit „Sie“ an, hat Logo und Hausfarbe der App, ist fürs Handy gebaut (am PC zwei Spalten) und zeigt unten Telefon, E-Mail und die Datenschutzerklärung aus den Einstellungen.

**Links verwalten:**

- **Link anlegen:** Bezeichnung (Überschrift beim Kunden), Objekte (Suche; mit Fakturierung auch „Aus der Kundenliste übernehmen“), E-Mail des Kunden, Zeitraum der Nachweise, was der Link zeigt. „Speichern und übertragen“.
- **„Link“** kopiert ihn, **„E-Mail“** öffnet das Senden-Fenster (siehe [E-Mail aus der App](#e-mail-aus-der-app)) mit fertigem Text in der Sie-Form; die Adresse kommt vom Link oder vom Objekt (E-Mail für den Leistungsnachweis). Im Menü „⋯“: **Kundenseite ansehen**, **Neuer Link** (neuer Code, der alte gilt sofort nicht mehr, die PDFs bleiben) und **Sperren** (die Seite gilt nicht mehr, ihre Daten am Webspace werden gelöscht). Gesperrte Links lassen sich mit neuem Code wieder freigeben oder löschen. Neuer Link und Sperren brauchen einen zweiten Klick.
- Der Code hat 20 Zeichen (rund 117 Bit). Im Link steht nur er, nichts über den Kunden; der Webspace kennt nur seinen Hashwert (SHA-256).

**Übertragen wie bei Plan am Handy:** Je Link geht ein kleines JSON an `kunden.php` (Bezeichnung, Objekte mit Adresse, Termine, Liste der Nachweise mit Prüfsumme). Der Webspace antwortet, welche PDFs fehlen oder sich geändert haben; nur diese erstellt die App und schickt sie hinterher. Ältere Monate rechnet sie nicht jedes Mal neu (im Menü „⋯“ erzwingt **„Alle Nachweise neu erstellen“** das). Übertragen wird beim Speichern eines Links, mit „Jetzt übertragen“ und **einmal am Tag von selbst**, sobald jemand mit Einsatzplanung die App offen hat. Rollen ohne Plan (z. B. Objektservice) übertragen nur Links und Stand; Nachweise und Termine bleiben dann, wie sie waren.

**Reklamationen zurück in die App:** Das Büro-Handy bekommt einen Push (nur Objekt und Art, ohne Text, weil ntfy ein fremder Dienst ist), die E-Mail-Adressen aus den Einstellungen die ganze Meldung. Die App holt neue Meldungen alle 3 Minuten, solange jemand mit Reklamationen (bearbeiten) sie offen hat (im Menü „⋯“ auch sofort), und legt je Meldung eine **Reklamation mit Eingang „Kundenbereich“** an: Objekt, Tag, Art, Beschreibung, Kontakt, Frist nach der Art. Das Foto kommt nach SharePoint (`reklamationen/fotos/<Monat>/`) und wird dann am Webspace gelöscht; ohne SharePoint bleibt es dort („Foto vom Kunden laden“ im Dialog, nach 60 Tagen gelöscht). Neue Meldungen ohne Maßnahme stehen unter **„Zu erledigen“**. Ändert sich der Status oder wird die Reklamation mit Ergebnis erledigt, geht das beim nächsten Abruf an die Kundenseite; Maßnahme, betroffene Personen und Verlauf bleiben intern.

**Grenzen und Schutz am Webspace:** nach 20 ungültigen Codes von derselben Adresse in 15 Minuten ist für sie 15 Minuten Pause; höchstens 5 Meldungen je Link und 10 je Adresse am Tag; Fotos nur JPEG, PNG oder WebP bis 8 MB, am Inhalt geprüft (fileinfo, Bildmaße) und mit der PHP-Erweiterung GD neu als JPEG gespeichert (längste Seite 1600 px, ohne Metadaten wie den Aufnahmeort), am Handy vorher verkleinert; PDFs nur als PDF (Kopf und Ende geprüft), bis 8 MB und nur Dateien aus der Liste des Links; Formular nur von der eigenen Seite; Seite ohne Zwischenspeicher, nicht für Suchmaschinen, ohne Referrer.

**Einrichten:** *Kundenbereich → Einstellungen*: einschalten, Büro-Handy (Push) und E-Mail für neue Reklamationen, Absender, Telefon, E-Mail und Datenschutzerklärung für die Kundenseite, ab welchem Tag der Vormonat erscheint. „Speichern und übertragen“ richtet den Webspace direkt ein, wenn dort schon Plan am Handy oder der Schnee-Alarm läuft (deren Schlüssel schaltet die erste Einrichtung frei); sonst einmalig „Einrichtungs-Datei herunterladen“ und `kundenbereich.json` nach `privat/` laden ([EINRICHTUNG.md](EINRICHTUNG.md), Schritt 8). Der Systemcheck prüft Datei, Schlüssel und GD.

**Datenschutz:** Am Webspace liegen je Link der Hashwert, Bezeichnung, Name und Adresse der Objekte, Termine und PDFs, dazu die Meldungen mit Kontakt (erledigte nach 180 Tagen gelöscht, Fotos nach der Übernahme bzw. nach 60 Tagen). Keine Namen von Mitarbeitenden außer laut Einstellung des Leistungsnachweises, keine Daten anderer Kunden, keine Lohn- oder Gesundheitsdaten. Was vor dem Einschalten zu klären ist: [RECHTSPRUEFUNG.md](RECHTSPRUEFUNG.md#kundenbereich-neu). `config.json` → `"customerPortal": false` lässt `kunden.php` beim Bauen weg.

Technik: `kunden.php` (Webspace), `src/ui/views/customer-portal.js` (App), `src/core/customer-portal.js` (Rechenkern). Tests: `test/customer-portal.test.js`.

## Unterweisungen & Fristen

Unter *Verwaltung* (Modul „Unterweisungen & Fristen“; Vollzugriff und Objektleitung). Gespeichert in `unterweisungen/unterweisungen.json`.

- **Matrix** Person × Art mit Ampel: grün gültig, gelb läuft in 30 Tagen ab, rot abgelaufen oder fehlt (bei Pflicht). Feld anklicken zum Eintragen (Datum, gültig bis: Vorschlag aus der Gültigkeit der Art, Notiz). Filter Team, Suche, „nur mit Handlungsbedarf“, CSV.
- **Arten** (änderbar): Sicherheitsunterweisung und Unterweisung Reinigungsmittel (§ 14 ASchG, Vorgabe 12 Monate, Pflicht für alle), Erste-Hilfe-Auffrischung (§ 40 AStV, 48 Monate, nur Ersthelfer:innen), Führerscheinkontrolle (§ 103 KFG, 6 Monate, Pflicht mit Qualifikation „Führerschein“), Aufenthaltstitel/Arbeitserlaubnis (AuslBG, Ablaufdatum von Hand, **sperrt**). Eigene Arten dazu, z. B. Hygieneschulung; nicht mehr benötigte auf „aktiv“ aus (Einträge bleiben).
- **Unterweisung durchführen:** Art, Datum, Ort, wer unterweist, Inhalt; vorausgewählt sind alle mit Bedarf (abgelaufen, fehlt, läuft bald ab). Wahlweise **Unterschrift jeder Person am Tablet**; der **Nachweis als PDF** (Teilnehmerliste mit Unterschriften bzw. leeren Feldern zum Unterschreiben) lässt sich jederzeit wieder erstellen.
- **Im Plan:** abgelaufener Aufenthaltstitel = Fehler (nicht einteilen), abgelaufene Führerscheinkontrolle = Warnung bei Einsätzen mit Qualifikation „Führerschein“. Fehlende Einträge meldet nur „Zu erledigen“ (je Art gesammelt, sperrende Dokumente je Person schon 30 Tage vorher).
- Gesetzliche Grundlagen und offene Punkte: [RECHTSPRUEFUNG.md](RECHTSPRUEFUNG.md).

## Fakturierung

Eigenes Modul unter *Finanzen* (Rolle `buchhaltung` oder Vollzugriff), gespeichert in `fakturierung/fakturierung.json`, die PDFs in `fakturierung/belege/JAHR/`. Wie bei orgamax oder FreeFinance, abgestimmt auf die Gebäudereinigung:

- **Kunden** (Rechnungsempfänger, oft die Hausverwaltung) mit Kundennummer, Anschrift, UID, E-Mail, Zahlungsziel, Stundensatz, Debitorenkonto und den **Objekten**, die zu ihnen gehören. „Kunden aus Objekten anlegen“ übernimmt Name, Adresse und die E-Mail des Leistungsnachweises. **Reverse Charge** je Kunde (siehe unten), **Verbraucher** für private Auftraggeber.
- **Artikel** als Vorlagen für Positionen (übliche Leistungen auf Knopfdruck, ohne Preise).
- **Angebot → Auftragsbestätigung → Rechnung** mit einem Klick; Positionen mit Menge, Einheit, Einzelpreis, Positionsrabatt und USt-Satz (20, 13, 10, 0 %), Rabatt auf alles, Leistungszeitraum, Fälligkeit nach Zahlungsziel. „Preis aus Kalkulation“ setzt den Monatspreis aus der Objektkalkulation ein (wer die Kalkulation sehen darf).
- **Pflichtangaben** werden vor dem Festschreiben geprüft (§ 11 UStG): Absender mit UID, Empfänger mit Anschrift, Leistungszeitraum, Positionen; über 10.000 € brutto die UID des Empfängers; bis 400 € brutto genügt eine **Kleinbetragsrechnung**.
- **Festschreiben** vergibt die nächste **fortlaufende Nummer** je Belegart und Jahr (`RE-2026-0001`, Storno `ST-…`, Korrektur `KO-…`, Angebot `AN-…`, Auftrag `AB-…`; Kürzel, Stellen und eine Startnummer beim Umstieg einstellbar). Danach ist der Beleg **unveränderlich** (Prüfsumme; eine nachträgliche Änderung in der Datei wird angezeigt). Korrigiert wird mit **Stornorechnung** (ganzer Beleg mit umgekehrtem Vorzeichen, mit Grund) oder **Rechnungskorrektur** (z. B. Preisminderung nach Reklamation), jeweils ein eigener Beleg mit Bezug.
- **Gleichzeitig festgeschrieben:** Die App holt vor der Nummernvergabe den Stand der anderen und speichert gleich danach. Haben trotzdem zwei Personen im selben Moment dieselbe Nummer vergeben, bekommt der spätere, noch nicht versendete Beleg beim nächsten Öffnen die nächste freie Nummer (mit Vermerk im Verlauf). Sind beide schon versendet, meldet „Zu erledigen“ das zum Stornieren.
- **Daueraufträge** je Kunde und Objekt (monatlich, quartalsweise, halbjährlich, jährlich, mit Laufzeit). Der **Monatslauf** erstellt die Rechnungsentwürfe des Monats, nie doppelt. **Wertsicherung** nach VPI: Indexzahlen monatlich eintragen (Statistik Austria); ab der Schwelle (z. B. 3 %) passt der Lauf die Preise um die ganze Veränderung an, vermerkt das auf der Rechnung, und der neue Wert wird die Basis (wahlweise nur Erhöhungen).
- **Aus dem Leistungsnachweis:** je Objekt ein Entwurf für den Monat, regelmäßige Einsätze als Stunden × Stundensatz, Sonderleistungen einzeln mit Datum; Objekte mit Dauerauftrag bekommen nur ihre Sonderleistungen.
- **Offene Posten:** Zahlungseingang (auch in Teilen), Status offen, überfällig, teilweise bezahlt, bezahlt, storniert. **Mahnwesen** in drei Stufen (Zahlungserinnerung, 1. und 2. Mahnung; Tage und Inhalt einstellbar) mit Verzugszinsen (Unternehmer: Basiszinssatz + 9,2 Prozentpunkte, Verbraucher 4 %) und einmal 40 € Pauschale unter Unternehmern; Mahnung als PDF oder per E-Mail.
- **PDF** mit Logo, Anschriftfeld für Fensterkuverts, allen Rechnungsmerkmalen, Hinweis bei Reverse Charge bzw. Kleinunternehmer und einem **QR-Code zum Bezahlen** (EPC/Stuzza: Banking-Apps übernehmen Empfänger, IBAN, Betrag und Rechnungsnummer). Entwürfe tragen „ENTWURF“ und keinen QR-Code.
- **Versand per E-Mail** mit dem PDF im Anhang (Mail.Send, sonst E-Mail-Programm); jeder Versand wird vermerkt, das PDF liegt danach auch in SharePoint.
- **Export für die Steuerberatung:** CSV je Zeitraum, eine Zeile je Beleg und Steuersatz (Belegnummer, Datum, AR/GU, Debitor, Erlöskonto je Steuersatz bzw. Reverse Charge, Kunde, UID, Steuercode, Netto, Steuer, Brutto, Leistungszeitraum); Konten in den Einstellungen, mit der Steuerberatung abstimmen.
- **Übersicht:** Umsatz netto je Monat und Kunde, offene und überfällige Summe, fällige Mahnungen und Daueraufträge (auch in „Zu erledigen“); beim Objekt der Rechnungsempfänger und offene Rechnungen.
- **Bankabgleich** (Reiter „Bank“): siehe unten.
- **Reverse Charge** (§ 19 Abs. 1a UStG) gilt für die Reinigung von Bauwerken **nur**, wenn der Auftraggeber selbst üblicherweise Bauleistungen erbringt oder mit der Leistung beauftragt ist (typisch: Subauftrag einer anderen Reinigungs- oder Baufirma). Hausverwaltungen, Büros, Geschäfte: normale Rechnung mit 20 % USt. Rechtliches und offene Punkte: [RECHTSPRUEFUNG.md](RECHTSPRUEFUNG.md#fakturierung).

### Bankabgleich

Kontoauszug im Online-Banking herunterladen und unter Fakturierung → **Bank** → „Kontoauszug einlesen“ wählen. Die App ordnet die Eingänge den offenen Rechnungen zu; gebucht wird erst nach Bestätigung.

- **Formate:** **camt.053** (Tagesauszug), **camt.052** (Umsätze untertags) und **camt.054** als XML (ISO 20022, in George, ELBA und den Business-Banking-Programmen der österreichischen Banken als „camt“ bzw. „XML“). **CSV** aus George (Erste Bank, Sparkassen), ELBA (Raiffeisen, Volksbank, Hypo; ohne Kopfzeile), Bank Austria und BAWAG; jede andere CSV mit **Spaltenzuordnung** in der Vorschau (Datum, Betrag oder Haben/Soll, Name, IBAN, Text, Zahlungsreferenz). Trennzeichen (; , Tab) und Dezimalkomma werden erkannt. Bei ELBA stehen Auftraggeber, IBAN, Zahlungsreferenz und Verwendungszweck im Buchungstext und werden daraus gelesen.
- **Vorschau** vor dem Übernehmen: erkanntes Format, Konto, Zeitraum, Eingänge und Abbuchungen, die ersten Buchungen. Schon eingelesene Buchungen werden erkannt (Kennung aus Datum, Betrag, IBAN und Text) und nicht doppelt übernommen; zwei gleiche Zahlungen am selben Tag in einer Datei bleiben beide.
- **Sammelgutschriften** (mehrere Zahlungen in einer Buchung, camt `TxDtls`) werden in die einzelnen Zahlungen aufgeteilt. Vorgemerkte Buchungen (noch nicht gebucht) werden übersprungen, Rückbuchungen der Bank markiert.
- **Zuordnung** je Eingang, mit Sicherheit und Begründung:
  - **sicher:** Rechnungsnummer im Verwendungszweck oder in der Zahlungsreferenz (auch „RE 2026 7“, „RE20260007“; so steht sie im QR-Code der Rechnung) und der Betrag stimmt, auch mehrere Rechnungen in einer Zahlung; **Teilzahlungen** mit Nummer (danach offen …); ohne Nummer, wenn die **IBAN des Kunden** bekannt ist und der Betrag genau einer offenen Rechnung entspricht.
  - **wahrscheinlich:** Name des Zahlers passt zum Kunden bzw. Rechnungsempfänger und der Betrag zu einer Rechnung oder zur Summe mehrerer; **Überzahlung** mit Nummer (der Mehrbetrag bleibt bei der Rechnung, Gutschrift oder Rückzahlung klären).
  - **unsicher:** nur der Betrag passt, oder die genannte Rechnung ist **storniert** bzw. schon **bezahlt** (Hinweis auf Doppelzahlung oder Rückzahlung, keine Buchung vorgeschlagen).
- **Zuordnen** bucht die Zahlung bei der Rechnung (Datum der Bank, Vermerk „Bank: Name“), die offenen Posten und Mahnstufen richten sich danach. **Alle sicheren übernehmen** erledigt die sicheren auf einmal. **Andere Rechnung** wählt von Hand eine oder mehrere Rechnungen mit Beträgen. **Ignorieren** für Eingänge, die keine Kundenzahlungen sind. **Lösen** nimmt eine Zuordnung samt Zahlung wieder zurück.
- Die **IBAN des Zahlers** wird beim Kunden gemerkt; die nächste Zahlung ohne Rechnungsnummer wird dann sicher erkannt.
- **Abbuchungen** werden nur angezeigt (keine Eingangsrechnungen in der App).
- **Zu erledigen:** Eingänge, die seit über 7 Tagen keiner Rechnung zugeordnet sind.
- **Gespeichert** in `fakturierung/fakturierung.json` (Teil `bank`): die Buchungen der letzten 13 Monate (Datum, Betrag, Name, IBAN, Text gekürzt, Zuordnung) und die Kennungen gegen doppeltes Einlesen; ältere werden beim nächsten Einlesen entfernt. Die Zahlungen selbst stehen dauerhaft bei den Rechnungen. Rechte wie die Fakturierung.

## KI-Assistent

Knopf **„Assistent“** in der Kopfleiste (Sprechblase; am Handy oben rechts), Tastatur **Strg+J**. Man schreibt oder **spricht** (Mikrofon im Chat, Deutsch/Österreich), was zu tun ist; der Assistent schlägt in der App nach und erledigt es mit denselben Rechten wie die angemeldete Person. **Alles, was etwas ändert oder verschickt, zeigt er vorher als Karte mit „Ausführen“ und „Abbrechen“.** Nachschlagen geht ohne Rückfrage.

| Kann nachschlagen | Kann erledigen (nach Bestätigung) |
|---|---|
| Dienstplan eines Zeitraums (auch je Person, Objekt, nur offene) | **Termin in Outlook** anlegen, mit Ort, Einladungen an Mitarbeitende oder E-Mail-Adressen, optional als Teams-Besprechung |
| Personen, Objekte (Adresse, Anweisungen, Schlüssel, offene Reklamationen) | **Abwesenheit** eintragen (Urlaub, Krankenstand …) und sagen, welche Einsätze betroffen sind |
| Abwesenheiten, „Zu erledigen“ | **Vertretungen verteilen** wie „Automatisch verteilen“ im Abwesenheits-Assistenten |
| eigener Outlook-Kalender | **Einteilen oder Austragen** (vorher geprüft nach AZG, Verfügbarkeit, Einschulung; bei einem Verstoß nicht) |
| Vertretungsvorschläge mit Begründung | **Reklamation** erfassen, **Material** für ein Objekt anfordern |
| Lagerbestand, Schlüsselbuch | **E-Mail** aus dem eigenen Postfach senden |

Beispiele: „Termin morgen 12 Uhr in Salzburg mit Herrn Maier, maier@beispiel.at“, „Elif ist bis Freitag krank, bitte Vertretung organisieren“, „Wer arbeitet morgen in der Kanzlei?“, „Wie viele Müllsäcke 120 l haben wir noch?“, „Schreib Ana, dass sie am Donnerstag in Lehen einspringt“. Unklares fragt er nach (z. B. die Uhrzeit), Übliches nimmt er an und sagt es (ein Termin dauert eine Stunde, wenn nichts anderes gesagt wird).

- **Rechte:** Der Assistent bekommt nur die Werkzeuge, die die Person nutzen darf (Lesen: Bereich sichtbar, Ändern: Schreibrecht). Wer nur das Lager sieht, kann keine Einteilungen ändern.
- **Spuren:** Einteilungen und Abwesenheiten stehen im Änderungsprotokoll der Woche („über den KI-Assistenten“), Reklamationen im Verlauf; „Rückgängig“ wirkt wie gewohnt.
- **Gespräch:** bleibt bis zum Neuladen der Seite oder „Neues Gespräch“; nichts davon wird in SharePoint gespeichert.
- **Einstellungen (Vollzugriff):** API-Schlüssel, Modell (Claude Opus 5.5 empfohlen; Sonnet 5.5 günstiger; Haiku 5.5 sehr günstig, für einfache Fragen), Aufwand (schnell, ausgewogen, gründlich), Tageslimits je Person und gesamt, Ein/Aus, Verbrauch und geschätzte Kosten des Monats.
- **Kosten** (Listenpreise Anthropic, Stand 11/2026): Claude Opus 5.5 $4 je Million Tokens Eingabe, $20 Ausgabe; der gleichbleibende Teil (Anweisungen, Werkzeuge, Verlauf) wird zwischengespeichert und kostet beim Wiederlesen nur einen Bruchteil. Eine typische Aufgabe kostet grob 2–5 Cent; bei 30 Aufgaben am Tag etwa 20–40 $ im Monat. Maßgeblich ist die Anzeige in den Einstellungen bzw. die Abrechnung in der Anthropic Console (dort Ausgabenlimit setzen).
- **Technik:** Das offizielle Anthropic-SDK läuft im Browser mit dem Tool Runner; die Anfragen gehen an `ki.php` am Webspace, das die Microsoft-Anmeldung prüft (eigener Tenant, eigene App, echtes Token), Modell, Aufwand und Tageslimit festlegt und mit dem Schlüssel an die Claude-API weiterreicht. Ausweich-Modelle bei Ablehnungen sind eingeschaltet. Einrichtung: [EINRICHTUNG.md](EINRICHTUNG.md#8-ki-assistent-einschalten-optional).

## Digitale Mitarbeiter

Vier Routinen gehen laufend die Daten der App durch, wie eine erfahrene Bürokraft, und bereiten fertige Arbeitsschritte vor (Bereich **Digitale Mitarbeiter** ganz oben im Menü; die Übersicht sagt, wie viele Vorschläge warten):

| Digitaler Mitarbeiter | bereitet vor | „Ausführen“ |
|---|---|---|
| **Disponent** | Vertretungen bei Urlaub und Krankenstand; offene Einsätze dieser und nächster Woche; Woche veröffentlichen (ab 3 Tage vorher); Korrektur buchen, wenn sich eine veröffentlichte Woche geändert hat | Vertretungen regelkonform verteilen, Woche planen, Veröffentlichen öffnen |
| **Buchhaltung** | Daueraufträge des Monats; überfällige Rechnungen (Mahnstufe fällig); Leistungsnachweise des Vormonats ohne Versand | Rechnungsentwürfe erstellen (Festschreiben bleibt bei dir), offene Posten öffnen |
| **Lager** | Bestellung je Lieferant, wenn Artikel unter dem Mindestbestand sind (offene Bestellungen eingerechnet, auf Packungen gerundet); Anforderungen aus den Objekten | Bestellung vorbereiten (Dialog zum Prüfen und Senden) |
| **Fristen** | ablaufende oder fehlende Unterweisungen und Kurse (je Art gesammelt); Kontrollen und Dokumente (Führerschein, Aufenthaltstitel); Fahrzeuge (Pickerl, Service); überfällige Reklamationen | gemeinsamen Schulungstermin mit allen Betroffenen anlegen |

- Je Vorschlag: **Ausführen** (in der Planung mit Rückgängig), **Öffnen** (selbst erledigen), **Später** (bis morgen), **Ablehnen** (bis sich die Lage ändert, z. B. mehr offene Einsätze), **KI fragen** (den Vorschlag mit dem KI-Assistenten besprechen).
- Ein Vorschlag verschwindet von selbst, wenn die Sache erledigt ist. „Später“ und „Ablehnen“ gelten für alle im Büro (Ordner `assistenz/`).
- Jede Rolle sieht nur die digitalen Mitarbeiter ihrer Bereiche (z. B. Lager & Einkauf nur „Lager“).
- Die Regeln sind fest und nachvollziehbar, ohne KI-Modell und ohne Kosten. Der KI-Assistent kann die Vorschläge lesen („Was haben die digitalen Mitarbeiter vorbereitet?“).

## Termine (mit Outlook)

Kalender der Firma in der App (Planung → **Termine**): Woche mit Uhrzeiten (am Handy als Liste), darunter die nächsten 14 Tage. Ein Klick in den Kalender oder in eine freie Stelle der Zeitlinie legt einen Termin zu dieser Zeit an (in der Zeitlinie gleich für diese Person).

- **Arten:** Kundentermin, Objektbegehung, Qualitätskontrolle, Schulung/Unterweisung, Werkstatt, Bewerbungsgespräch, intern, sonstiges; mit Objekt (Ort kommt aus der Adresse), Notiz, Erinnerung, ganztägig oder mehrtägig.
- **Teilnehmende:** Mitarbeitende aus dem Dienstplan (stehen auch in der Zeitlinie), Personen der Firma aus dem Microsoft-Verzeichnis (Suche nach Name oder E-Mail) und freie E-Mail-Adressen (z. B. Hausverwaltung).
- **Outlook:** „Speichern und einladen“ legt den Termin im Outlook-Kalender der Person an, die ihn einträgt, und schickt allen Teilnehmenden eine Einladung. Exchange Online stellt die Einladung bei ihnen von selbst in den Kalender (vorläufig, mit Zusage fest). Änderungen und Absagen gehen ebenso an alle. Auf Wunsch als Teams-Besprechung.
- **Vor dem Speichern:** „Frei/Belegt prüfen“ zeigt je Person der Firma, ob sie zu der Zeit frei ist; Hinweise, wenn jemand laut Plan einen Einsatz hat oder abwesend ist. Bei bestehenden Terminen stehen die Antworten (zugesagt, abgesagt, vorläufig) dabei.
- **Serientermine:** jede Woche, alle 2 Wochen, jeden Monat am selben Tag oder am selben Wochentag (z. B. jeden 1. Dienstag), mit oder ohne Ende. In Outlook als echte Serie; „Nur diesen Termin absagen“ sagt ein einzelnes Vorkommen ab (auch in Outlook), die Serie bleibt.
- **Mein Outlook einblenden:** zeigt die eigenen Outlook-Termine der Woche grau im Kalender (nur lesen).
- **Wer darf:** Vollzugriff, Objektmanagement und Objektleitung tragen ein; wer plant, sieht die Termine (Zeitlinie, Konflikte). Ablage: `termine/termine.json`.
- **Ohne Microsoft-Anmeldung** (Browser-Modus) bleiben Termine in der App; „.ics herunterladen“ öffnet sie in Outlook, Google oder Apple Kalender.
- Gelingt das Eintragen nicht (z. B. Recht fehlt), steht der Termin unter „Zu erledigen“ mit „Erneut eintragen“.
- Den Outlook-Termin ändern oder absagen kann nur, wer ihn angelegt hat (Organisator). Ändert jemand anderer in der App, sagt die App das dazu.
- Der **KI-Assistent** legt Termine über dieses Modul an („Termin morgen 12 Uhr in Salzburg mit …“).

**Kalender-Abo für Mitarbeitende (Plan am Handy):** Unter „Im Kalender“ auf der eigenen Plan-Seite: „Kalender abonnieren“ (iPhone, Android) oder die Adresse in Outlook („Kalender hinzufügen → Aus dem Internet abonnieren“) bzw. Google Kalender („Per URL“) einfügen. Dann stehen Einsätze, Termine und Abwesenheiten der veröffentlichten Wochen im eigenen Kalender und aktualisieren sich von selbst (je nach Kalender alle paar Stunden). Wer Push (ntfy) eingerichtet hat, bekommt eine Stunde vor einem Termin eine Erinnerung aufs Handy (über den Cronjob der Zeiterfassung, `aktion=pruefen`). Die Adresse ist persönlich wie der Link zum Plan; bei „Neuer Link“ gilt auch das alte Abo nicht mehr.

## Kennzahlen

Für die Geschäftsführung, im Menü unter *Start* gleich nach der Übersicht. Jede Kachel und jedes Diagramm erscheint nur, wenn die Rolle das Modul dahinter sieht (Umsatz und offene Posten also nur mit Fakturierung, Plus-Stunden nur mit Auswertung). Zeitraum oben wählbar: **4 Wochen · 3 Monate**, **8 Wochen · 6 Monate** (Vorgabe) oder **13 Wochen · 12 Monate**.

- **Kacheln** mit einer großen Zahl (die erste), Trend gegen die Vorwoche bzw. den Vormonat (▲▼ grün, wenn es gut ist, rot, wenn nicht) und einer kleinen Verlaufslinie. Monatswerte zeigen den **letzten abgeschlossenen Monat**, Wochenwerte die laufende Woche. Ein Klick auf die Kachel öffnet den Bereich (z. B. Besetzungsgrad → Vertretungen, Umsatz → Fakturierung).
- **Stunden je Woche:** laut Plan, eingeteilt und – sobald gestempelt wird – Ist aus der Zeiterfassung; **Fahrzeit** je Woche aus den Wochenzetteln.
- **Besetzung:** Besetzungsgrad (eingeteilte Plätze ÷ benötigte) und offene Einsätze je Woche, nur für Wochen, die schon eingeteilt sind.
- **Krankenstand und Urlaub** je Monat als Anteil an den Soll-Tagen (Mo–Fr laut Vertrag, ohne gesetzliche Feiertage).
- **Auslastung je Person:** eingeteilte Stunden gegen Vertragsstunden, sortiert; bei mehr als zehn Personen die fünf meisten und die fünf wenigsten, Strich bei 100 %.
- **Plus-Stunden** je Monat: Ist über Soll laut Plan je Person summiert, getrennt nach Vollzeit (Überstunden) und Teilzeit (Mehrarbeit). Das ist eine Näherung; die abgerechneten Werte stehen in „Überstunden & Auszahlung“.
- **Reklamationen** je Monat, die fünf Objekte mit den meisten und die Zahl der offenen.
- **Fakturierung:** Umsatz netto je Monat (festgeschriebene Rechnungen; Storno und Korrekturen mindern), **offene Posten nach Fälligkeit** (nicht fällig, 1–30, 31–60, über 60 Tage), Kunden mit dem meisten Umsatz.
- **Material:** Verbrauch (Ausgaben an Objekte und Personen × Einzelpreis) und Bestellwert je Monat.
- **Deckungsbeitrag je Objekt** (mit Fakturierung und Auswertung): Umsatz − Personal (eingeteilte Stunden × Stundenlohn aus der Kalkulation samt Lohnnebenkosten) − Material des Objekts.

Jedes Diagramm zeigt beim Zeigen oder Antippen die Werte (auch mit der Tastatur), hat eine **Tabellenansicht** („Als Tabelle“) und den Knopf „Öffnen“. Farben nach eigenen Stufen für hell und dunkel, am Handy einspaltig. Gerechnet wird in `src/core/kpi.js` (reine Funktionen, Tests in `test/kpi.test.js`), die Ansicht ist `src/ui/views/kpi.js`, die Diagramme sind eigenes SVG ohne Bibliothek (`src/ui/kpi-charts.js`). Das Ergebnis wird je Zeitraum und Tag gemerkt und nach jeder Datenänderung neu gerechnet.

## Zeitlinie

Ein Tag, je Person eine Zeile: Einsätze in Objektfarbe, geplante Fahrten (rot, wenn sie nicht bis zum nächsten Einsatz passen), **Termine** (schraffiert mit Kalender-Symbol; Termine ohne Person in der Zeile „Termine“), **Ist-Zeiten** aus der Zeiterfassung als grüne Linie unter den Einsätzen, Abwesenheiten schraffiert, entfallene Einsätze durchgestrichen, heute eine rote **Jetzt-Linie**. Ein Klick in eine freie Stelle legt einen Termin für diese Person zu dieser Uhrzeit an.

## Schneller Start und Laden aus SharePoint

- Die App startet mit dem **letzten Stand im Gerät** und gleicht SharePoint im Hintergrund ab (unten links „Gleicht mit SharePoint ab …“). Hat inzwischen jemand anderer gespeichert, kommt dessen Stand nach; gleichzeitige Änderungen werden zusammengeführt wie bisher.
- Dateien werden **gebündelt** gelesen (Microsoft Graph `$batch`, bis zu 20 Dateien in einer Anfrage), ebenso der minütliche Abgleich. Das spart Wartezeit und schont die Drosselung von Microsoft.
- Die vorige und die nächste Woche werden im Hintergrund vorgeladen, Blättern geht dadurch sofort.
- Das zuletzt benutzte Werkzeug (z. B. Wasserzähler) lädt nach dem Start unsichtbar vor, damit es beim Öffnen schon seine Daten hat (nicht bei „Daten sparen“ am Handy).
- Der allererste Start auf einem Gerät lädt alles aus SharePoint (danach geht es schnell). Abschalten: `"sharepoint": { "quickStart": false }` in `config.production.json`.

**Abgleich mit SharePoint**

- **Takt:** Solange jemand arbeitet (Tippen, Klicken in den letzten 2 Minuten), alle **20 Sekunden**; sonst alle 60 Sekunden; im Hintergrund (anderer Tab, Handy gesperrt) gar nicht. Beim Zurückkommen und wenn das Netz wiederkommt sofort. Einstellbar mit `sharepoint.fastSeconds` und `sharepoint.refreshSeconds`.
- **Ein Abgleich** fragt alle offenen Dateien mit einer Anfrage je 20 Dateien ab (nur die Kennungen) und lädt nur, was sich geändert hat. Hat hier jemand gleichzeitig etwas geändert, wird zusammengeführt.
- **Mehrere Fenster** im selben Browser (z. B. Wochenübersicht und Termine nebeneinander): Speichert eines, haben die anderen den Stand nach etwa einer Sekunde, direkt aus dem Gerät, ohne Anfrage an SharePoint.
- **Speichern:** kurz nach der letzten Änderung, mehrere Dateien gleichzeitig. Jede Änderung liegt nach einer Viertelsekunde auch im Gerät; wird die App in den Hintergrund geschickt (Handy: App gewechselt) oder geschlossen, speichert sie sofort. Geht das nicht mehr, holt der nächste Start die Änderung nach.
- **Jetzt abgleichen:** der Pfeil neben dem Speicherstand unten links (am Handy: Mehr → Konto & Daten); der Tooltip sagt, wann zuletzt abgeglichen wurde.

**Rechenzeit:** Die Ansichten werden nur dort neu gezeichnet, wo sich etwas geändert hat (Scrollposition und angefangene Eingaben bleiben stehen). Vorschläge für Vertretungen und die Zuweisung werden je Datenstand einmal gerechnet und gemerkt; die Zuweisung braucht dadurch statt rund 30 Sekunden (Handy) nur noch einen Bruchteil einer Sekunde. „Zu erledigen“ wird nach dem Start im Hintergrund berechnet und hält den Start nicht mehr auf.

### Ladezeit

- **Nur was der Start braucht, kommt sofort.** Große, seltener gebrauchte Teile laden erst, wenn man sie öffnet, oder kurz nach dem Start im Hintergrund, und nur für Bereiche, die die eigene Rolle sieht: Fakturierung mit Bankabgleich, Kalkulation, Leistungsnachweis, Material, Fahrzeuge, Schlüsselbuch, Reklamationen, Unterweisungen, Wetter mit Radar und Karte, Mitarbeitende, Objekte & Leistungen, Regeln, Systemcheck, Kennzahlen, Anleitung samt Cleos Hilfe-Themen, die PDF-Vorlagen dieser Bereiche. Der KI-Assistent, pdfmake, ExcelJS und JSZip kamen schon bisher erst bei Bedarf.
- **Gemessen** (Handy-Emulation iPhone 13, CPU 4× langsamer, 1,6 Mbit/s mit 150 ms Antwortzeit): Code für den Start 1416 → 785 KB (komprimiert 467 → 282 KB). Erster Aufruf oder nach einem Update: App sichtbar nach 2,4 statt 4,0 Sekunden (komprimiert ausgeliefert, wie Azure und Apache mit `.htaccess`), unkomprimiert 5,5 statt 9,3 Sekunden; „Wird geladen …“ erscheint so früh wie bisher. Jeder weitere Start (Service Worker) bleibt bei etwa einer halben Sekunde: Dort zählt das Rechnen, nicht der Code.
- **Reihenfolge beim Laden:** zuerst die Stile, dann alle Teile des Starts gleichzeitig, und `config.json` gleich mit (ein kleines Skript `app/start-….js` im Kopf der Seite, von `npm run build` erzeugt), nicht erst nacheinander.
- **Menü, Suche, Cleo und Rollen** kennen die später geladenen Bereiche von Anfang an. Zähler (z. B. offene Rechnungen) und ihre Punkte in „Zu erledigen“ erscheinen, sobald der Bereich im Hintergrund geladen ist, meist nach Sekundenbruchteilen.
- **Ohne Netz (Keller):** Der Service Worker hält alle Teile vor, auch die später geladenen. Zusätzlich holt die App nach jedem Start die Bereiche der eigenen Rolle, damit sie auch dann vollständig ist, wenn gerade eine neue Version kam und der Service Worker sie noch nicht ganz hat.
- **Webspace und Azure:** Alles liegt unter `app/` mit Inhalts-Hash im Namen (ein Jahr im Browser gültig). Die `.htaccess` lässt Apache Code und Stile komprimiert ausliefern (Azure macht das selbst). Hochladen mit `--aufraeumen` (EINRICHTUNG.md) löscht alte Teile; wer die alte Fassung noch offen hat und einen dort noch nicht geladenen Bereich öffnet, bekommt den Hinweis, die App neu zu laden (selten: die Bereiche der eigenen Rolle lädt die App gleich nach dem Start).
- Wie ein neues Modul später lädt: [ERWEITERN.md](ERWEITERN.md), „Später laden“.

## Cleo – Hilfe zu jeder Funktion

**Cleo, der Sauberheld**, ist das Maskottchen der Cleanos App: ein freundlicher Wassertropfen als Superheld – Tropfenkopf mit Locke, runde Heldenmaske, große Augen, rote Bäckchen, blauer Anzug, Umhang in Cleanos-Grün, gelber Gürtel und weißes Wappen mit „C“. Cleo steht unten rechts auf jeder Seite (am Handy über der Leiste unten); ein Klick (oder **F1**) öffnet den Hilfe-Chat:

- **Fragen in eigenen Worten:** „Wie trage ich Urlaub ein?“, „es schneit, was tun“, „Zählerstände eintragen“, „Rechnung stornieren“. Cleo versteht Umlaute, Tippfehler, Mehrzahl und Wörter aus dem Betrieb (Dienstplan, Krankmeldung, streuen, Pickerl …) und antwortet mit einer kurzen Erklärung und den Schritten.
- **„Zeig es mir“** springt in die richtige Ansicht und markiert dort den passenden Knopf; ein zweiter Knopf startet die Aktion gleich (z. B. „Abwesenheit eintragen“, „Woche jetzt planen“). „In der Anleitung“ öffnet das Thema zum Nachlesen.
- **Vorschläge** passend zur offenen Ansicht und zu jedem Bereich; **Begriffe** („Was ist eine Stammkraft?“, „Was bedeutet Reverse Charge?“).
- **Nur was die Rolle sieht:** Fragen zu Bereichen ohne Recht beantwortet Cleo mit dem Hinweis, das Büro zu fragen.
- **Ohne KI und ohne Netz:** Cleo arbeitet mit den Hilfe-Themen in der App (`src/help/topics.js`, Suche in `src/help/match.js`), speichert nichts und schickt nichts weg. Findet Cleo nichts, gibt es die Übergabe an den **KI-Assistenten** (falls eingerichtet), mit der Frage schon eingetragen.
- **Posen:** Gesten für die Hilfe (Hallo, Daumen hoch, geschafft, fliegt hin, stark, Idee, denkt nach, zeigt, Checkliste, am Handy, Danke mit Herz, hoppla, Nachtruhe) und je Reinigungsbereich ein Werkzeug: Unterhalts-, Büro-, Glas- und Fenster-, Fassaden-, Sanitär-, Teppich-, Stiegenhaus-, Grund- und Bauendreinigung, Desinfektion und Praxis, Hausbetreuung, Grünflächenpflege, Laub und Dachrinne, Winterdienst, Müllraum, Graffiti-Entfernung, Photovoltaik, Tiefgarage, Tatortreinigung (Schutzanzug, Absperrband) und Veranstaltungsreinigung (Ballons, Konfetti). Die Antworten wählen die passende Pose (Wetter → Schaufel, Zu erledigen → Checkliste, „danke“ → Herz); auf der Übersicht schläft Cleo nachts, schaufelt bei Schnee und hält bei offenen Punkten die Checkliste. Umhang weht, Cleo blinzelt; bei „Bewegung reduzieren“ im System bleibt alles ruhig.
- **Saison-Looks:** Nach dem Datum (Wien) verkleidet sich Cleo und die Übersicht und das Cleo-Fenster bekommen eine leichte Deko mit Animation: Halloween (24.10.–1.11.: Hexenhut, Kürbis, Spinnennetz, Fledermäuse, Gespenst), Advent und Weihnachten (1. Adventsonntag bis 26.12.: Weihnachtsmütze, Lichterkette, Schneefall), Silvester und Neujahr (27.12.–6.1.: Partyhut, Konfetti, Feuerwerk), Fasching (11.11. und Unsinniger Donnerstag bis Faschingsdienstag), Ostern (Palmsonntag bis Ostermontag, berechnet: Hasenohren, Eier) und Frühjahrsputz (15.3.–20.4.: Kopftuch, Staubwedel, Blumen, Seifenblasen). Die Deko liegt hinter dem Inhalt und nimmt keine Klicks; unter **Darstellung → Saison-Deko** „Nach Datum“ oder „Aus“, dazu eine Vorschau je Saison (zum Ausprobieren auch `?saison=halloween` in der Adresse). Bei „Schlicht“ und „Bewegung reduzieren“ steht sie still. Code: `src/core/season.js` (Datum → Saison), `src/ui/season.js` (Einstellung, Deko), `src/ui/mascot.js` (Figur).

## Anleitung

Unter **Anleitung** (ganz oben im Menü, Suche „Hilfe“) stehen alle Funktionen zum Nachlesen: nach Bereichen wie im Menü, je Thema Kurzantwort, Schritte, Tipps und „Zeig es mir“, dazu die wichtigsten Begriffe. Die Suche findet dieselben Themen wie Cleo. **Drucken / PDF** ergibt ein sauberes Handbuch (ohne Seitenleiste und Knöpfe). Dieselben Texte stehen in [`docs/ANLEITUNG.md`](ANLEITUNG.md) (`npm run anleitung` erzeugt die Datei neu, wenn Themen dazukommen).

**Neue Funktion, neues Thema:** in `src/help/topics.js` einen Eintrag ergänzen (id, Bereich, Ansicht, Titel, typische Fragen, Antwort, Schritte, optional Aktion). `test/help-topics.test.js` prüft, dass Ansichten, Aktionen und Verweise existieren.

## Aussehen

Stil **Modern** (Voreinstellung): ruhige weiße Flächen mit feinen Linien, eine Akzentfarbe (Cleanos-Blau), klare Schrift, keine Verläufe, kein Leuchten, kein Glas. Die aktive Ansicht ist eine helle Fläche mit Akzentkante, Bereiche haben eine eigene Farbe für Symbole (Planung blau, Einsätze petrol, Objekte violett, Material orange, Finanzen grün, Verwaltung schiefer), Reiter sind Umschalter, Kacheln zeigen Zustände als Punkt. Die Übersicht beginnt mit Cleo, Begrüßung und den wichtigsten Zahlen. Unter Darstellung lässt sich **Schlicht** wählen (flacher, ohne Bereichsfarben); bei den Kontrast-Schemata immer schlicht. Ebenfalls unter Darstellung: **Saison-Deko** nach Datum oder aus (siehe Cleo); „Voreinstellung“ setzt auch sie zurück.

## Schnellfunktionen und Tastenkürzel

- **„+ Neu“** in der Kopfleiste (Taste **N**): Termin (**T**), Abwesenheit (**A**), Zeit nachtragen (**Z**), Reklamation (**R**), Material anfordern (**M**), Rechnung (**F**), Angebot, Aufgabe per E-Mail (**E**), Leistung im Reinigungsplan, KI-Assistent (**K**). Es erscheint nur, was die eigene Rolle darf. Am Handy: Mehr → „Neu anlegen …“.
- **Springen zu …** (Strg+K oder **/**) findet auch Befehle: „urlaub“ → Abwesenheit eintragen, „rechnung“ → Rechnung schreiben, „termin“ → Termin.
- **← / →** blättert die Woche, **H** springt zur aktuellen Woche, **?** zeigt alle Kürzel. Beim Tippen in einem Feld lösen die Tasten nichts aus.


## Menü

Die Seitenleiste ist in Abschnitte gegliedert: **Planung** (Wochenübersicht, Zeitlinie, Termine, Vertretungen, Abwesenheiten, Objektplan, Prüfbericht), **Einsätze & Zeiten** (Zeiterfassung, Wochenzettel, periodische Leistungen, Müllplan, Wetter & Winterdienst), **Objekte & Kunden** (Reklamationen, Leistungsnachweis, Schlüsselbuch, Werkzeuge), **Material & Fuhrpark**, **Finanzen** (Fakturierung, Kalkulation, Objekt-Controlling, Monatsauswertung, Überstunden) und **Verwaltung** (Mitarbeitende, Objekte & Leistungen, Zuweisung, Unterweisungen, Regeln, Berechtigungen, Systemcheck).

- Abschnitte lassen sich auf- und zuklappen (gemerkt je Gerät); der Abschnitt der offenen Ansicht ist immer offen. Zugeklappte Abschnitte zeigen die Summe ihrer Zähler.
- Mit dem Stern (beim Darüberfahren) wird ein Bereich oben **angeheftet**.
- **Springen zu …** (oder Strg+K) findet Bereiche auch unter Alltagswörtern („Urlaub“, „Rechnung“, „Radar“, „Stempeln“), dazu Personen, Objekte und Fahrzeuge.
- Am Handy ist das Menü „Mehr“ gleich gegliedert, mit Suche oben.

**Aufklappmenüs in den Ansichten.** Damit die Kopfzeilen nicht mit Knöpfen zugepflastert sind, bleibt je Ansicht nur das Wichtigste direkt sichtbar (z. B. „+ Rechnung“, „Ausgabe“, „Unterweisung durchführen“); der Rest steckt gegliedert in Aufklappmenüs:

| Ansicht | direkt | Aufklappmenüs |
|---|---|---|
| Fakturierung | + Rechnung | **Anlegen** (Beleg: Angebot, Auftragsbestätigung, Dauerauftrag, aus Leistungsnachweis · Stammdaten: Kunde, Artikel), **Export** (Steuerberatung, Kontoauszug) |
| Material & Lager | Ausgabe | **Buchen** (Wareneingang, Umbuchen, Inventur), **Anlegen** (Anforderung, Bestellung · Stammdaten: Artikel, Lieferant, Lager, Excel-Liste), **Export** (Bestand, Verbrauch) |
| Fahrzeuge | + Fahrzeug | **Verwalten** (Werkstätten, Excel-Liste · Export CSV); je Zeile Termin/Erledigt, dahinter **⋯** (Termin ändern, Fahrer/in informieren, bearbeiten) |
| Schlüsselbuch | Ausgeben, Rückgabe | **Mehr** (Schlüssel anlegen · Export CSV) |
| Unterweisungen | Unterweisung durchführen | **Mehr** (einzeln eintragen, Arten verwalten · Export CSV) |
| Zeiterfassung | Zeit nachtragen, Woche freigeben | **Mehr** (alle Abweichungen übernehmen, jetzt abrufen · Export CSV) |
| Wochenzettel, Monatsauswertung, Überstunden | Versenden, Monat abschließen | **Export** (für Excel kopieren, Excel, PDF, CSV, Lohnprogramm · Drucken) |
| Mitarbeitende | + Mitarbeiter:in | **Mehr** (Plan am Handy, aus Excel einfügen) |
| Kalkulation | Angebot (PDF) | **Mehr** (Kalkulation intern, als Budget übernehmen) |
| Leistungsnachweis | je Zeile „Ansehen“ | **⋯** je Zeile (PDF, E-Mail) |

- **Reiter gruppiert:** Fakturierung hat statt neun Reitern fünf: Übersicht · **Belege ▾** (Rechnungen, Angebote & Aufträge, Daueraufträge) · **Zahlungen ▾** (Offene Posten, Bank) · **Stammdaten ▾** (Kunden, Artikel) · Einstellungen. Material: Bestand · Bestellen · Anforderungen · **Auswertung ▾** (Verbrauch, Buchungen) · Lieferanten & Lager. Der gewählte Unterpunkt steht im Reiter („Zahlungen: Offene Posten“), Zähler werden je Gruppe zusammengezählt.
- **Bereich oben in der Kopfleiste** („Finanzen ▾ / Fakturierung“): ein Klick zeigt alle Ansichten dieses Bereichs mit Zählern und wechselt direkt dorthin, ohne Seitenleiste.
- **„⋯“ oben rechts** ist gegliedert: *Diese Woche* (Veröffentlichen, Neu planen, Versenden), *App* (Jetzt abgleichen mit letztem Stand, Daten & Sicherung, Darstellung, Tastenkürzel), *Konto* (Abmelden).
- **Bedienung:** Es ist immer nur ein Menü offen; ein Klick daneben, ein Bildlauf oder **Esc** schließt es (Esc schließt erst das Menü, nicht gleich den Dialog dahinter). Mit der Tastatur: **Pfeil runter** öffnet und springt in die Liste, Pfeile, Pos1 und Ende wandern, Tab verlässt das Menü. Menüs passen sich dem Platz an (nach oben oder zur anderen Seite) und werden in Tabellen nicht abgeschnitten.
- **Am Handy** gehen Menüs als Blatt von unten auf (große Einträge, Hintergrund abgedunkelt; Tipp daneben schließt).
- Was eine Rolle nicht darf, fehlt auch im Menü; bleibt nur ein Eintrag übrig, erscheint er als normaler Knopf.

## Wetter & Winterdienst

Eigener Punkt unter *Einsätze & Zeiten* (Rolle mit Einsatzplanung): Vorhersage und amtliche Warnungen von **GeoSphere Austria** je Revier für heute bis übermorgen, mit Temperatur, Niederschlag, Neuschnee, Böen und Warnungen (gelb, orange, rot). Die Daten lädt jedes Gerät selbst alle 30 Minuten; sie liegen nicht in SharePoint (keine Firmendaten). Ohne Netz bleibt der letzte Stand sichtbar.

**Winterdienst (§ 93 StVO):** Beim Objekt unter *Objekte & Leistungen* „Winterdienst“ einschalten: fertig bis (Standard 6 Uhr), Dauer, Personen, Team und ein Hinweis (Flächen, Streugut). Nötig ist er, wenn vom Vorabend 16 Uhr bis 22 Uhr Neuschnee kommt (ab 1 cm), Niederschlag bei Frost fällt (Glätte) oder GeoSphere vor Schnee oder Glatteis warnt. Dann zeigt die Ansicht die betroffenen Objekte, „Zu erledigen“ meldet es, und der Knopf **„Winterdienst anlegen“** legt je Objekt einen Einsatz an (z. B. 05:15–06:00) und teilt das Team ein: in der eingetragenen Reihenfolge, wer an dem Tag abwesend oder nicht mehr beschäftigt ist, wird übersprungen. Fehlt jemand, bleibt der Einsatz offen wie jeder andere. Die Einsätze stehen in der Wochenübersicht mit Schneeflocke, im Wochenzettel und in den Stunden; Ruhezeit, Nachtruhe Jugendlicher usw. werden wie immer geprüft. „Absagen“ nimmt einen Einsatz wieder heraus (z. B. Schnee blieb aus), „Rückgängig“ geht auch.

**Hitze und Sturm:** Leistungen mit Häkchen **„Arbeit im Freien“** (Außenanlage, Fassade, Glas außen). Gibt GeoSphere für den Tag eine Hitzewarnung aus, markiert der Plan diese Einsätze mit dem Hinweis auf den Hitzeschutzplan (Hitzeschutzverordnung, seit 1.1.2026); ab 30 °C laut Vorhersage gibt es einen Hinweis. Bei Sturm- oder Gewitterwarnung bzw. Böen ab 60 km/h: Hinweis, Arbeit im Freien und in der Höhe zu prüfen. Die Regel „Wetter“ lässt sich im Regelkatalog abschalten.

**Grafisch wie in Wetter-Apps** (oben in der Ansicht, je Ort als Reiter):

- **Nächste 3 Stunden (Nowcast):** „Leichter Regen ab ca. 14:45 (in 25 Min.)“, „Jetzt mäßiger Schneefall, hört ca. 16:30 auf“ oder „Trocken in den nächsten 3 Stunden“, darunter ein Streifen mit 12 Viertelstunden (Farbe = Art und Stärke). Die Reiter der Orte zeigen den Kurzhinweis („Regen in 25 Min.“).
- **Tageskarten** heute bis übermorgen: Symbol, Höchst- und Tiefstwert, Niederschlag und Regenstunden, Neuschnee, Böen, Sonnenauf- und -untergang, Warnungen.
- **Stundenverlauf** (waagrecht scrollbar, rund 48 Stunden): Temperaturlinie mit 0-°C-Linie, Niederschlagsbalken (blau Regen, lila Schnee), Wettersymbole, Böen mit Windrichtung (ab 60 km/h hervorgehoben), Schneefallgrenze bei Niederschlag, Nacht dunkel, „jetzt“ rot.
- **Niederschlagsradar** auf einer Karte mit den Orten und den Objekten mit Winterdienst: die letzten 3 Stunden (INCA-Analyse aus Radar und Stationen), jetzt bis +3 Stunden in Viertelstunden (Nowcast) und danach bis +9 Stunden (Modell C-LAEF). Zeitregler, „Abspielen“, „Jetzt“; der Streifen darunter zeigt je Bild, wie viel vom Ausschnitt nass ist (lila = Schnee), ein Klick springt hin. Karte ziehen, Mausrad, zwei Finger oder +/− zoomen. Regen hellblau bis violett nach Stärke (0,1 bis über 50 mm/h), Schnee lila, Schneeregen und gefrierender Regen eigene Farben.

Länger als rund 2½ Tage rechnet kein freier Datensatz von GeoSphere voraus; eine 7-Tage-Vorhersage gäbe es nur aus einer weiteren Quelle (z. B. ECMWF-Open-Data oder ein Vertrag mit einem Wetterdienst).

**Quellen und Namensnennung:** GeoSphere Austria Data Hub (CC BY 4.0): Vorhersage `nwp-v2-1h-1km` (Temperatur, Niederschlag, Schnee, Böen, Bewölkung, Wettersymbol, Schneefallgrenze, Wind), Nowcast `nowcast-v1-15min-1km`, INCA `inca-v1-1h-1km`; Karte © OpenStreetMap-Mitwirkende (ODbL), wahlweise basemap.at (CC BY 4.0, `config.json` → `"weatherMap": { "tiles": "basemap" }`; nur Österreich, außerhalb leer). Beides steht auf der Karte. Das Radar wird nur geladen, solange die Ansicht offen ist (höchstens alle 10 Minuten, nur im Arbeitsspeicher), als Gitter mit 1 km im Ausschnitt um die Orte (in der Form der Karte, höchstens etwa 1,1° × 1,8°); liefert GeoSphere das Gitter nicht, nimmt die App ein gröberes Raster aus 12 × 12 Punkten. Lässt der Browser GeoSphere nicht zu, gehen Nowcast und Radar über `wetter.php` (`art=nowcast`, `art=raster`, nur Österreich, Zwischenspeicher 10 Minuten). GeoSphere erlaubt 240 Abfragen je Stunde und Adresse; das Radar braucht 3 je Aktualisierung. Der Systemcheck prüft „Nowcast und Radar“.

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
- **Wer abwesend ist** (Urlaub, Krankenstand laut App) am Tag des Einsatzes, wird nicht geweckt; abends ab 18 Uhr zählt schon der nächste Morgen. Bei wöchentlichem Wechsel springt dann der/die Nächste in der Reihe ein. Ausgeschiedene (Austritt vorbei) werden nie geweckt.
- **Orte ohne Winterdienst-Objekte** sind von selbst aus (keine nächtlichen Alarme an niemanden); wurde niemand geweckt, gibt es auch keine Eskalation ans Büro.
- Die Alarm-Datei am Webspace hält die App **von selbst aktuell**: Ändern sich Abwesenheiten, Teams oder Austritte, überträgt sie die Datei neu (geprüft alle 15 Minuten, sobald jemand mit Planungsrecht die App offen hat, nach dem ersten „Speichern und übertragen“).

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

- **Am Handy, ohne Anmeldung:** Die Alarm-Nachricht (ntfy) hat neben „Bin wach“ den Knopf **„Protokoll“**, die Seite „Bin wach“ und die E-Mail führen ebenfalls dorthin. Dort wählt die Person das Objekt und trägt ein: erledigt um, geräumt, gestreut (Streumittel Splitt, Salz, Sand) oder „nur kontrolliert, nichts nötig“, eine Notiz und bis zu 4 Fotos. Die Fotos werden am Handy verkleinert (längste Seite 1600 px), damit sie auch über schwaches Netz ankommen. Der Link gilt 36 Stunden nach dem Alarm. Gespeichert wird am Webspace in `privat/winterdienst/` (gesperrt); die Fotos löscht die App dort, sobald sie in SharePoint liegen (fehlgeschlagene Uploads holt sie beim nächsten Abruf nach).
- **In der App:** im Einsatz-Dialog eines Winterdienst-Einsatzes „Erledigt eintragen“, in *Wetter & Winterdienst* „Eintragen“ oder direkt aus „Zu erledigen“.
- **Übernahme:** Öffnet jemand mit Einsatzplanung (bearbeiten) *Wetter & Winterdienst*, übernimmt die App die Protokolle vom Handy in die Woche (SharePoint) und legt die Fotos nach `exporte/Winterdienst/<Monat>/`. Testalarme zählen nicht.
- **Übersicht:** die letzten 14 Tage je Objekt mit Uhrzeit, Person, Tätigkeit, Notiz und Fotos; angelegter Winterdienst ohne Protokoll ist rot markiert und steht 2 Stunden nach „fertig bis“ unter **„Zu erledigen“**.
- **PDF-Nachweis** je Monat: Tabelle (Tag, Objekt mit Adresse, Uhrzeit, wer, Tätigkeit, Wetterlage, Notiz) und die Fotos im Anhang; mit SharePoint zusätzlich unter `exporte/Winterdienst/<Monat>/`.

**Rufbereitschaft:** Wer in Stufe 1 steht, muss erreichbar sein. Das ist Rufbereitschaft (§ 20a AZG) und außerhalb der Arbeitszeit nur an 10 Tagen im Monat erlaubt; der KV kann 30 Tage in 3 Monaten zulassen. Deshalb gibt es den wöchentlichen Wechsel (ab 4 Personen bleibt jede Person bei rund einer Woche im Monat), und der Dialog weist darauf hin. Siehe [RECHTSPRUEFUNG.md](RECHTSPRUEFUNG.md).

**Technik:** Die App fragt GeoSphere direkt (Vorhersage C-LAEF 1 km, Warnungen je Gemeinde). Lässt der Browser das nicht zu oder ist GeoSphere aus dem Firmennetz gesperrt, nimmt sie den Umweg über `wetter.php` am eigenen Webspace (nur diese Adressen von GeoSphere, nur Orte in Österreich, 10 Minuten zwischengespeichert). Benennt GeoSphere Parameter um, liest die App die Metadaten des Datensatzes und nimmt die passenden Namen. `config.json` → `"weather": false` blendet das Modul aus. Daten: GeoSphere Austria, CC BY 4.0.

## Plan am Handy (Mein Dienstplan)

Für Mitarbeitende ohne Firmenkonto: Jede Person bekommt einen **persönlichen Link** und sieht damit am Handy ihre veröffentlichten Wochen, ohne Anmeldung. Einrichten unter *Mitarbeitende → Plan am Handy* (Rolle mit Einsatzplanung, bearbeiten).

**Was die Person sieht** (`mein-plan.php` am Webspace):

- diese und die kommenden veröffentlichten Wochen: je Tag Uhrzeit, Objekt, Leistung, Adresse mit Link zur Karte, Hinweise (Fahrt danach, Vertretung, Müll, Zuschlag);
- entfallene Einsätze durchgestrichen (Feiertag, Urlaub, Zeitausgleich), Feiertage und eigene Abwesenheiten markiert;
- Stunden der Woche, Soll und Zeitkonto danach;
- „geändert am …“, wenn eine Woche nach dem Veröffentlichen korrigiert wurde;
- offene Einsätze, die sie übernehmen könnte (Einsatzbörse, siehe unten);
- mit Zeiterfassung: die erfassten Zeiten beim Einsatz;
- ihre Anträge und Meldungen mit Status (offen, genehmigt, abgelehnt mit Begründung, eingetragen, eingeteilt, bei Material: gemeldet, notiert, erledigt);
- **„Material fehlt?“** (nur mit Einsätzen): Objekt aus dem eigenen Plan wählen, schreiben, was fehlt; geht ans Lager (siehe [Material & Lager](#material--lager)).

Beim ersten Öffnen merkt sich das Handy den Link (Cookie, 400 Tage). Danach genügt das Symbol am Startbildschirm. „Auf diesem Gerät vergessen“ löscht ihn wieder.

**Anträge vom Handy:**

- **Krank melden:** ab heute, voraussichtlich bis (wenn bekannt), Notiz ohne Diagnose. Das Büro-Handy bekommt einen dringlichen Push, dazu auf Wunsch eine E-Mail. Der Hinweis „zusätzlich anrufen, wenn der Dienst bald beginnt“ steht dabei; die Krankenstandsbestätigung bleibt nötig.
- **Urlaub, Zeitausgleich, Pflegefreistellung beantragen:** von, bis, Notiz.
- Grenzen: höchstens 60 Tage je Antrag, Beginn höchstens 7 Tage zurück, höchstens 10 Anträge am Tag.

**Im Büro** stehen die Anträge unter **„Zu erledigen → Anträge von Mitarbeitenden“** (die App holt sie alle 3 Minuten):

- **Eintragen** (Krankmeldung) bzw. **Genehmigen** trägt die Abwesenheit ein und öffnet sofort den Abwesenheits-Assistenten: welche Einsätze neu zu besetzen sind, Vertretung vorschlagen, veröffentlichte Wochen korrigieren.
- **Ablehnen** verlangt eine kurze Begründung, die die Person aufs Handy bekommt.
- **Schon erledigt** (Krankmeldung, z. B. schon telefonisch eingetragen) schließt sie ohne Eintrag.

**Einsatzbörse:** Offene Einsätze der veröffentlichten Wochen (ab einer Stunde vor Beginn nicht mehr) erscheinen am Handy unter **„Offene Einsätze für dich“**, aber nur bei Personen, die sie laut Regeln übernehmen dürfen: dieselbe Prüfung wie bei „Vorschlagen“ (eingeschult, wo nötig; verfügbar; keine Überschneidung; Ruhezeit; Höchstarbeitszeit; nicht abwesend; Jugendschutz). Höchstens 20 je Person. Wer **„Ich übernehme“** tippt, meldet sich; das Büro-Handy bekommt einen Push. Unter „Zu erledigen“ prüft **„Einteilen“** noch einmal, teilt fixiert ein, sagt weiteren Meldungen für denselben Einsatz ab („Schon vergeben“) und veröffentlicht die Woche neu; die Person bekommt „Du bist eingeteilt“. „Ablehnen“ geht mit kurzer Begründung. Neue Angebote kommen mit dem Push für den Plan („1 offener Einsatz für dich“). Abschalten: Häkchen „Einsatzbörse“ im Dialog.

**Dienst abgeben und tauschen:** Am Handy hat jeder Einsatz, der in mehr als 2 Stunden beginnt, den Punkt **„Abgeben“** (Grund optional). Das Büro-Handy bekommt einen Push, die App zeigt es unter „Zu erledigen“: **„In die Börse“** bietet den Einsatz allen an, die ihn laut Regeln übernehmen dürfen („wird von einer Kollegin oder einem Kollegen abgegeben“); die abgebende Person bleibt eingeteilt, bis jemand übernimmt, und bekommt Bescheid. Meldet sich jemand, **tauscht „Einteilen“**: die neue Person wird fixiert eingeteilt, die abgebende ausgetragen, beide bekommen einen Push („Du bist eingeteilt“ bzw. „Abgegeben: … Übernimmt: …“), die Woche wird neu veröffentlicht. „Ablehnen“ geht mit Begründung. Auch ohne Anfrage kann das Büro einen Einsatz im Einsatz-Dialog je Person **„In die Börse“** stellen bzw. „Aus der Börse“ nehmen. Findet sich niemand, bleibt alles, wie es ist.

**Zeiterfassung im Objekt (QR-Code):** im selben Dialog einschalten (anfangs aus). Je Objekt gibt es einen Code; **„QR-Aushänge (PDF)“** erstellt je Objekt eine A4-Seite zum Aufhängen (innen, z. B. Putzraum; laminiert). Statt Papier geht auch ein NFC-Aufkleber mit derselben Adresse.

- **Am Objekt:** Handy-Kamera auf den Code, Link öffnen, **„Kommen erfassen“**; nach der Arbeit wieder scannen, **„Gehen erfassen“**. Die Uhrzeit nimmt der Server, nicht das Handy. Die Seite zeigt den Einsatz laut Plan; ohne Einsatz (eingesprungen) geht es trotzdem. Zweimal getippt zählt einmal. Wer den persönlichen Link auf dem Handy noch nie geöffnet hat, wird dazu aufgefordert (so weiß der Server, wer stempelt). Im Plan am Handy steht danach „✓ 05:57–08:32“ beim Einsatz.
- **In der App:** Ansicht **„Zeiterfassung“** (unter Einsätze & Zeiten) mit Plan, Kommen, Gehen, Ist-Stunden und Status je Einsatz: passt, später gekommen, früher gegangen (Toleranz 10 Minuten), noch nicht ausgestempelt, nicht eingestempelt, ohne Einsatz laut Plan. „Jetzt abrufen“ holt die letzten 14 Tage, sonst holt die App alle 2 Minuten, was neu ist, solange jemand mit Einsatzplanung sie offen hat. CSV für die Lohnverrechnung. Im Einsatz-Dialog steht der Block „Zeiterfassung“. Gespeichert wird je Woche in SharePoint.
- **Nachtragen und korrigieren:** „Zeit nachtragen“ (auch direkt bei „nicht eingestempelt“) mit Person, Einsatz oder Objekt, Kommen, Gehen, Pause und einem **Grund** (Stempeln vergessen, Handy/Netz, falsch gestempelt, länger, früher beendet, Sonstiges). Korrekturen gestempelter Zeiten behalten den ersten Stand und jede Änderung mit Grund, Person und Zeitpunkt; nachgetragene Zeiten lassen sich löschen, gestempelte nicht.
- **Ruhepause:** Arbeitet jemand an einem Tag mehr als 6 Stunden ohne 30 Minuten Pause (eingetragen oder als Lücke zwischen den Einsätzen), steht oben ein Hinweis (§ 11 AZG).
- **Freigabe:** „Woche freigeben“ markiert alle vollständigen Zeiten als geprüft (mit Person und Zeitpunkt); eine spätere Korrektur hebt die Freigabe auf.
- **Monat je Person:** Soll laut Plan, Ist laut Zeiterfassung (ohne Pausen), Differenz, Abweichungen, fehlende, nachgetragene und noch nicht freigegebene Zeiten; je Person die **Arbeitszeitaufzeichnung als PDF** (mit Nachträgen, Korrekturen und Unterschriftsfeldern), alle als ZIP, Übersicht als CSV.
- Ohne QR-Zeiterfassung ist die Ansicht trotzdem da: Zeiten lassen sich von Hand erfassen und auswerten.
- **Nicht eingestempelt:** Unter „Zu erledigen“ (und als Zahl bei „Zeiterfassung“) stehen begonnene Einsätze ohne Stempelung, nach der eingestellten Zeit (Standard 20 Minuten). Zusätzlich meldet der Webspace es per Push ans Büro-Handy und an die Person, auch nachts und wenn niemand die App offen hat; dafür braucht es einen **Cronjob** wie beim Schnee-Alarm (Adresse im Dialog). Der Alarm gilt nur für Personen, die schon einmal gestempelt haben, damit es beim Einführen keine Fehlalarme gibt, und höchstens einmal je Einsatz.
- **Stunden:** Der Wochenzettel und die Lohnverrechnung rechnen weiter mit den geplanten Zeiten. Weicht die Ist-Zeit um mehr als 10 Minuten ab, setzt **„Ist übernehmen“** (je Zeile, im Einsatz-Dialog oder „Alle Abweichungen übernehmen“) Beginn und Ende des Einsatzes an diesem Tag auf die erfassten Zeiten, mit Vermerk „Ist-Zeit laut Zeiterfassung“. Das geht nur, wenn eine Person im Einsatz ist (die Zeit gilt für den ganzen Einsatz). In veröffentlichten Wochen danach wie gewohnt die Korrektur buchen; „Rückgängig“ geht auch.
- **Grenzen:** Ein Foto des Codes ließe sich auch anderswo scannen; der Code beweist die Anwesenheit nicht sicher, reicht aber für den Alltag und für Stichproben. Kein GPS, keine Ortung.

**Push (ntfy, wie beim Schnee-Alarm):** „Push einrichten“ gibt der Person ein Thema; wer schon ein Thema für den Schnee-Alarm hat, behält es. Die Person bekommt eine Nachricht, wenn ihr Plan für eine neue Woche da ist oder eine Woche geändert wurde, und wenn über einen Antrag entschieden ist. Ohne Push sieht sie alles beim Öffnen.

**Veröffentlichen:** „Woche veröffentlichen“ und „Korrektur buchen“ schicken die Woche je Person automatisch an den Webspace. Unveränderte Wochen lösen keinen Push aus.

**Link verloren?** „Neuer Link“: Nach „Speichern und übertragen“ gilt der alte nicht mehr; offene Anträge vom alten Link bleiben zuordenbar.

**Einmalig am Webspace:** „Einrichtungs-Datei herunterladen“ und `mitarbeiter.json` in den Ordner `privat/` laden (wie die Alarm-Datei, Schritt 5 in [EINRICHTUNG.md](EINRICHTUNG.md)). Danach überträgt „Speichern und übertragen“ Einstellungen und Pläne direkt.

**Datenschutz:** Am Webspace liegen je Person nur Name und ihre Wochen (Einsätze, Stunden, Zeitkonto) sowie die offenen Einsätze für sie, unter dem Hashwert des Links; mit Zeiterfassung dazu Kommen und Gehen je Objekt (62 Tage, dann gelöscht; dauerhaft in SharePoint). Die Links selbst, Lohndaten und Gründe von Krankenständen liegen dort nicht. Der Ordner `privat/` ist gesperrt; Pläne älter als 8 Wochen fallen weg. `config.json` → `"staffPortal": false` lässt `mein-plan.php` beim Bauen weg.

## E-Mail aus der App

Berichte, Exporte, Aufgaben und „Zu erledigen“ gehen direkt aus der App per E-Mail – immer über dasselbe **Senden-Fenster** (`src/ui/mailer.js`, reine Hilfen in `src/core/mail.js`):

- **Exporte per E-Mail:** In den Export-Menüs steht unter „Per E-Mail senden“ jeder Export noch einmal (Lagerbestand, Verbrauch, Schlüsselliste, Unterweisungen, Fahrzeugliste, Monatsauswertung, Überstunden, Wochen-Excel, Ist-Zeiten, Kalkulation und Angebot). Neben einzelnen Download-Knöpfen steht „E-Mail“ (Reklamation als PDF und CSV, Winterdienst-Nachweis, Arbeitszeit-PDFs, Datei fürs Lohnprogramm, Ausgangsrechnungen für die Steuerberatung). Die Datei wird dann nicht heruntergeladen, sondern als Anhang eingesammelt; der Betreff kommt aus dem Dateinamen („Lagerbestand 04.11.2026“). Für Entwickler: einen Menüeintrag mit `mail: true` (oder `mail: { hint, subject }`) markieren, oder einen Knopf `data-action="mail-export" data-of="<export-aktion>"` setzen – die Export-Aktion bleibt unverändert.
- **Diese Ansicht per E-Mail** (⋯ rechts oben, am Handy unter „Mehr“): macht aus dem, was gerade zu sehen ist, einen PDF-Bericht mit Logo, Kennzahlen als Kacheln, Tabellen und Listen (mit Filter; Knöpfe und Menüs fallen weg) und eine CSV-Datei der Tabellen. Geht in jeder Ansicht, z. B. Kennzahlen, Prüfbericht, Schlüsselbuch, Monatsauswertung. Breite Tabellen kommen quer, sehr lange gekürzt (vollständig in der CSV).
- **Aufgabe per E-Mail** („+ Neu“, Taste **E**, oder ⋯): Empfänger, Aufgabe, Fälligkeit, Objekt, Beschreibung. Im Anhang eine Kalender-Erinnerung (.ics, ganztägig am Fälligkeitstag, Erinnerung am Vortag 9 Uhr), damit die Aufgabe auch ohne Microsoft 365 im Kalender des Empfängers steht.
- **„Zu erledigen“ weitergeben:** jeder Abschnitt hat „E-Mail“, unten „Per E-Mail weitergeben“ für die ganze Liste – als Text mit Link in die App.
- **Berichte automatisch** (⋯ → „Berichte automatisch“, nur Vollzugriff): Abos wie „Kennzahlen jeden Montag ab 7 Uhr an die Geschäftsführung“. Wählbar sind Kennzahlen, Prüfbericht der Woche, Vertretungen und offene Einsätze, Periodische Leistungen, Reklamationen, Material & Lager (je als PDF mit CSV) und Zu erledigen (als Text mit Link). Rhythmus wöchentlich (Wochentag), jeden Werktag oder monatlich am 1., jeweils ab einer Uhrzeit (Wien). **Gesendet wird ohne Server und ohne gespeichertes Passwort** aus dem Postfach der Person, die das Abo angelegt hat, sobald sie die App an oder nach dem Termin offen hat (PC oder Handy, Prüfung beim Start, alle 5 Minuten und beim Zurückkehren in die App). Ein verpasster Termin wird einmal nachgeholt, ältere nicht; zwei offene Fenster senden nicht doppelt. Fehler (z. B. fehlende Berechtigung) stehen beim Abo und werden frühestens nach 6 Stunden wiederholt. „Jetzt“ erstellt den Bericht sofort im Senden-Fenster. Die Abos liegen in `berichte/abos.json` (nur Vollzugriff); Zeitplan in `src/core/report-schedule.js`, Versand in `src/ui/report-subscriptions.js`. Wer ganz ohne geöffnete App senden will, braucht einen Server-Dienst mit eigener Microsoft-365-Berechtigung (Anwendungsberechtigung Mail.Send) – bewusst nicht eingebaut.
- **Senden-Fenster:** An und Kopie (mehrere mit Strichpunkt, „Name <adresse>“ geht auch), „+ aus der Liste …“ mit Mitarbeitenden, Kundschaft, Objekten (Adresse für den Leistungsnachweis), Lieferanten und Werkstätten – je nachdem, was die Rolle sieht – und den zuletzt verwendeten Adressen (nur auf diesem Gerät, höchstens 10). Betreff und Text sind vorbereitet; Anhänge einzeln entfernen oder herunterladen. Ungültige Adressen werden vor dem Senden gemeldet.
- **Versand:** Mit `features.mail` und Mail.Send geht die Mail aus dem eigenen Postfach (oder aus `mail.from`) und liegt unter „Gesendete Elemente“; „Kopie an mich“ setzt die eigene Adresse in Bcc. Anhänge bis rund 3 MB je Mail (Grenze von Microsoft Graph für eine Anfrage), sonst Hinweis. Ohne Microsoft 365 öffnet sich das E-Mail-Programm (mailto) und die Anhänge landen im Download-Ordner.
- Die eigenen Versand-Wege mit Versandstand bleiben: Wochenpläne an Mitarbeitende, Leistungsnachweise, Rechnungen und Mahnungen, Bestellungen, Auszahlungen, Werkstatt-Termine.

Tests: `test/mail.test.js` (Adressen, Betreff, CSV, mailto, Aufgabe mit .ics, Bericht-PDF), `test/menu.test.js` (Menüeinträge), Browser-Prüfung beider Wege (E-Mail-Programm und Microsoft 365 mit Graph-Attrappe).

## Systemcheck (Inbetriebnahme)

Unter *Verwaltung → Systemcheck* (nur Vollzugriff): prüft vom Browser aus Webspace, Einrichtung und Microsoft 365 und sagt je Punkt, was zu tun ist. Nur lesend.

- **Webspace:** HTTPS, Sicherheitsregeln (`.htaccess`), `privat/` von außen gesperrt, PHP 8 und Erweiterungen (json, mbstring, curl, openssl, fileinfo), `privat/` beschreibbar, Upload-Grenze für Fotos (8 MB), freier Speicher, Webspace erreicht das Internet (GeoSphere über `wetter.php`; nötig für Schnee-Alarm und Push).
- **Schnee-Alarm**, **Plan am Handy** und **Kundenbereich** (wenn eingeschaltet): Einrichtungsdatei in `privat/`, Schlüssel von App und Webspace passen, letzter Lauf der Cronjobs (Warnung, wenn länger als 30 Minuten her), beim Kundenbereich die PHP-Erweiterung GD für die Fotos.
- **Microsoft 365:** Daten in SharePoint (nicht im Browser-Modus), Anwendungs-ID eingetragen, angemeldete Person und Rolle, Daten geladen.
- „Bericht kopieren“ gibt alles als Text, z. B. für IT oder Support.

`system.php` am Webspace liefert dafür nur Ja/Nein-Werte und Zeitpunkte, keine Inhalte; PHP-Version und freien Speicher nur mit dem Schlüssel aus der App (oder bevor etwas eingerichtet ist). Sie läuft auch auf älterem PHP, damit sie melden kann, dass PHP zu alt ist.

## Ohne Netz (Keller, Tiefgarage)

Mit SharePoint arbeitet die App auch ohne Netz weiter:

- Der letzte Stand jeder Datei liegt im Gerät (Browser-Speicher). Die App startet auch ohne Netz, wenn das Gerät schon einmal verbunden war.
- Erfasstes im Dienstplan und bei den Fahrzeugen wird im Gerät festgehalten (die Werkzeuge haben ihren eigenen Offline-Speicher wie bisher). Oben steht dann **„Offline · 2 Änderungen warten“**. Das bleibt auch erhalten, wenn die App geschlossen oder das Handy neu gestartet wird.
- Mit Netz (zurück in der App oder Netz wieder da) wird **sofort gespeichert und mit den Änderungen anderer zusammengeführt**. Haben zwei Personen gleichzeitig geändert, bleiben beide Änderungen erhalten, nichts wird still überschrieben.
- Ohne Netz geht nicht: E-Mail-Versand.

## Was die Plattform einfacher macht

- **Eine Anmeldung, eine Adresse, eine App am Handy.** Dienstplan und Werkzeuge in einer Seitenleiste, je nach Rolle.
- **Zu erledigen** sammelt, was in der Einsatzplanung ansteht: Abwesenheiten, periodische Leistungen, Korrekturen, Fahrzeug-Termine, Winterdienst bei Schnee und Glätte, Anträge und Krankmeldungen vom Handy, Meldungen aus der Einsatzbörse, nicht eingestempelte Einsätze, überfällige Reklamationen.
- **Schnellsuche** mit Strg+K oder der Lupe: Personen, Objekte, Fahrzeuge und Bereiche (auch die Werkzeuge). Suchen in den Werkzeugen geht dort selbst.

## Vorschau

[Fahrzeuge & Reifen](vorschau/42-fahrzeuge-reifen.png) · [Termine vorschlagen](vorschau/43-reifen-vorschlag.png) · [Fahrer/innen informieren](vorschau/44-reifen-mail.png) · [Service & Pickerl](vorschau/45-service-pickerl.png) · [Werkstatttermin](vorschau/46-werkstatttermin.png) · [Pickerl erledigt](vorschau/47-pickerl-erledigt.png) · [Cleanos App, Wochenübersicht](vorschau/48-cleanos-design.png) · [Darstellung wählen](vorschau/49-darstellung.png) · [Cleanos Nachtblau, dunkel](vorschau/50-cleanos-nacht-dunkel.png) · [Berechtigungen](vorschau/51-berechtigungen.png) · [Tablet](vorschau/52-tablet.png) · [Übersicht](vorschau/53-uebersicht.png) · [Wasserzähler in der App](vorschau/54-werkzeug-wasserzaehler.png) · [Objektdoku in der App](vorschau/55-werkzeug-objektdoku.png) · [Mattenwechsel in der App](vorschau/56-werkzeug-mattenwechsel.png) · [Cleanos Kontrast](vorschau/57-cleanos-kontrast.png) · [Schnee-Alarm: Bin wach](vorschau/58-schnee-alarm-bin-wach.png)
