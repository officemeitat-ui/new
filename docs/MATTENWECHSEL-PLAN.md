# Mattenwechsel – Bestandsaufnahme und Umsetzungsplan

Stand 6. November 2026. Grundlage: „Technisches Umsetzungskonzept – Mattenwechsel-Modul“ der Geschäftsführung (inkl. Nachtrag „Bestehende Mattenwechsel-App erweitern und modernisieren“). **Dieses Dokument ist die Analyse vor der Umsetzung.** Die Entscheidungen der Geschäftsführung stehen in Abschnitt 9, der Stand der Umsetzung je Arbeitspaket in Abschnitt 7.

Fachbegriff: In der App heißt die konkrete Position einer Matte beim Kunden durchgehend **Liegeplatz**. Das bestehende Werkzeug nennt ihn „Standort“ (in der Tour „Halt“) – das wird beim Umbau überall auf „Liegeplatz“ umgestellt.

---

## 0. Kurzfassung

- Die bestehende **Mattenwechsel-App** ist das Werkzeug `werkzeuge/mattenwechsel/index.html`, **Fassung 2.4** (eine Einzeldatei, ~6000 Zeilen, in der Cleanos App unter `#matten` eingebettet). Sie kann schon viel: Liegeplätze mit Matten und Intervall (14/28 Tage als 2/4 Wochen), **gerechnete Fälligkeit**, Tagesbedarf (Ladeliste), Tour am Handy mit Bestätigung je Halt, Fotos, Navigation, Lieferschein je Kunde als PDF, Versand über das eigene Postfach, SharePoint-Ablage mit Nachholen, Reihenfolge über Azure Maps, offline erfassen.
- Es **fehlen**: Preise, Rechnungsentwürfe und „verrechnet“-Stand, die Objektebene (Kunde → Objekt → Liegeplatz), Rollen Büro/Fahrer, Unterschrift je Kunde, eine fortlaufende eindeutige Lieferscheinnummer, automatische Tourenbildung, ein Dashboard.
- **Wichtigster Befund:** Fälligkeit, Verlauf und Auswertung rechnet das Werkzeug **nur aus den Touren, die auf dem jeweiligen Gerät liegen**. Zwei Geräte zeigen unterschiedliche Fälligkeiten, ein neues Gerät hält alles für „sofort fällig“. Für Planung und Abrechnung braucht es eine **zentrale Datenbasis**.
- **Kundenstamm gibt es heute vierfach** (Werkzeug-Kundenliste, Export der Kundenverwaltung, Kunden der Fakturierung, Objekte der App), verknüpft nur über Namen. Das Konzept verlangt zu Recht *eine* Kundenverwaltung.
- **Empfehlung:** Die Funktionen des Werkzeugs als **Modul `matten` direkt in die App** übernehmen (Bedienmuster, Regeln und Ablage bleiben), statt das Einzeldatei-Werkzeug weiter auszubauen. Begründung in Abschnitt 3.1. Das Werkzeug läuft bis zur Umstellung unverändert weiter; die Umstellung ändert keine seiner Dateien.

### Begriffe des Konzepts → Technik dieser App

Das Konzept ist allgemein formuliert (Datenbank, ORM, Backend, Migrationen). Die Cleanos App ist anders gebaut; so wird jede Vorgabe hier erfüllt:

| Konzept | In dieser App |
|---|---|
| Datenbank, Tabellen, ORM | JSON-Dokumente in SharePoint (Bibliothek `Cleanos_Daten`, Ordner `Plattform/…` bzw. Werkzeug-Ordner), gelesen/geschrieben über Microsoft Graph mit eTag (`If-Match`) und Zusammenführen bei Konflikt (`src/core/merge.js`). |
| Migration | Versioniertes Dateiformat (`schema`-Feld), Umwandeln beim Lesen, einmaliger **Übernahme-Assistent** mit Sicherung vorher; alte Dateien werden nie verändert. |
| Transaktion | Ein fachlicher Vorgang schreibt **ein** Dokument (z. B. eine Tour) mit eTag; Folgeschritte (PDF, Mail, Ablage, Rechnung) sind idempotent und wiederholbar. |
| Backend / API / Services | Reine Rechenkerne in `src/core/*.js` (ohne Oberfläche, voll getestet), Ansichten in `src/ui/views/*.js`; PHP am Webspace nur dort, wo ein Schlüssel geschützt oder eine Seite ohne Microsoft-Anmeldung nötig ist (Muster `ki.php`, `mein-plan.php`). |
| Serverseitige Rechteprüfung | **SharePoint-Ordnerrechte je Microsoft-Gruppe** (Graph lehnt Lesen/Schreiben ohne Recht ab); die App blendet zusätzlich aus. Prüfung und Vergabe über *Verwaltung → Berechtigungen* (`src/core/rights-audit.js`). |
| Hintergrundverarbeitung / IntegrationJob | Warteschlange im Gerät (`src/storage/offline.js`: `pending`, `blobs`, `flushUploads`) plus Zustand je Schritt am Dokument (`integration.{pdf,mail,ablage}` mit Versuchen und Fehlertext); das Dashboard zeigt Fehlgeschlagenes, „Erneut“ wiederholt. |
| Rechnung | Fakturierung der App (`src/core/invoicing.js`): Lieferschein ist dort schon eine Belegart (Nummernkreis `LS`), Sammelrechnung aus Lieferscheinen (`collectDraft`) und Schutz gegen Doppelabrechnung (`billedBy`) gibt es bereits. |

---

## 1. Bestandsaufnahme

Quellen: Werkzeug 2.4 im Repo (Zeilennummern unten beziehen sich darauf), hochgeladene Doku und Quellen des Werkzeugs (Fassung 2.3), die vier Word-Tourenlisten (nur Struktur ausgewertet), die App-Anbindung. Ausführliche Fassung mit allen Belegen: Analyse vom 6.11.2026 (liegt nicht im Repo, weil sie Strukturangaben zum Kundenbestand enthält).

### 1.1 Übersicht (verlangtes Format)

| Funktionsbereich | Aktueller Stand (nach Codeanalyse) | Erforderliche Änderung |
|---|---|---|
| **Kundenverwaltung** | Eigene Kundenliste im Werkzeug (`K-0001`…, Felder Name, Nr., Adresse, Mails, Ansprechpartner, Notiz) in `Stammdaten/Kunden.json`, aus den Liegeplätzen gebildet und **über den Namen** mit dem Export der Kundenverwaltung (551 Kunden) abgeglichen. Daneben Kunden der Fakturierung und Objekte der App – keine Verknüpfung. Die Objektdoku liest dieselbe `Stammdaten/Kunden.json` als „Export, nur lesen“ → Konflikt. | **Umbauen**: Kunden der **Fakturierung** werden führend (`customers[]`, Kundennummer, Rechnungs-/Lieferschein-Mail, Ansprechpartner). Felder für Mattenwechsel ergänzen (Lieferschein-Mail, Abrechnungsart, Abrechnungsintervall). Werkzeug-Kunden werden einmalig zugeordnet, keine zweite Kundenverwaltung. |
| **Objekte** | Gibt es im Werkzeug nicht; der Liegeplatz trägt Adresse und Kundennamen selbst. Gruppierung nur über das „Gebiet“ (Tourrunde). | **Neu**: Ebene Objekt = App-Objekte (`objekte/objekte.json`, Name, Adresse, Revier, Koordinaten); Kunde ↔ Objekt über `customers[].objectIds`. Gebiet bleibt als Tourrunde. |
| **Liegeplätze** | „Standorte“ `L-0001`… mit Matten (Anzahl, Farbe, Größe, Eigentum), Intervall in Wochen, Lage im Haus, Hinweis, Prüfgrund, Koordinaten; Bestand 114 Liegeplätze (alle 4 Wochen, 15 „zu prüfen“, keiner mit Koordinaten). IDs zählen **je Gerät** hoch (Doppel möglich), Zusammenführen „lokal gewinnt“, Änderungen nur per Knopf „sichern“. | **Erweitern/Anpassen**: Kern beibehalten; ergänzen um Objektbezug, Stockwerk, Zugang/Schlüssel, Öffnungszeiten/Zeitfenster, geschätzte Arbeitszeit, Starttermin, Pausen; IDs eindeutig (nicht hochgezählt), automatisch speichern und zusammenführen wie alle App-Module. |
| **Matten & Preise** | Matten nur als Text (Farbe aus 6, Größe aus 9 Werten), kein Mattentyp, **keine Preise**. | **Neu**: zentrale Mattentypen/-größen als Artikel der Fakturierung (Standardpreis, Steuersatz), **Kundenpreise mit Gültigkeitszeitraum**; Preis wird beim bestätigten Wechsel eingefroren. |
| **Wechselplanung** | Fälligkeit **gerechnet** (letzter bestätigter Wechsel + Intervall; „nicht rein“ schreibt nicht fort), Ansicht „Fällig“, Tagesbedarf als Ladeliste. Intervall ab letztem Ist-Wechsel, kein fester Rhythmus, keine Pausen, kein Kalender. **Datenbasis nur das eigene Gerät.** | **Umbauen**: Regel „gerechnet, nicht gepflegt“ und Tagesbedarf **beibehalten**; zentrale Einsätze je Liegeplatz und Termin mit eindeutigem Schlüssel (kein Doppel bei erneutem Planen), Rhythmus wählbar (fest ab Starttermin / ab letztem Wechsel), Verschieben ohne Rhythmusänderung, Aussetzen (Betriebsurlaub), Nachholen, Wochen-/Monatskalender. |
| **Tourenplanung** | Tour von Hand: Liefertag, Fahrer als **Freitext**, Gebiet, Halte aus „Fällige übernehmen“/„Ganzes Gebiet“/einzeln. Halt = Kopie der Liegeplatzdaten (gut für Nachweis). Reihenfolge je Gebiet nur im Gerät gemerkt. | **Erweitern**: Tourvorschlag aus fälligen Einsätzen je Tag (Gebiet, Fahrer, Arbeitszeit, Öffnungszeiten), Fahrer aus den Mitarbeitenden, Fahrzeug aus dem Fuhrpark, mehrere Liegeplätze eines Objekts = ein Stopp, Freigabe durch das Büro, Reihenfolge zentral gespeichert. |
| **Routing** | Azure Maps (Geokodierung, Route mit `computeBestOrder`, Abschnitte à 48 Halte, Betriebshof als Start/Ziel) mit **Einstellungen je Gerät**, Schnittstellen-Version 1.0 (Ablösung durch Microsoft prüfen). Die App selbst geokodiert mit OpenStreetMap (Nominatim) und schätzt Fahrzeiten aus der Luftlinie. | **Anpassen**: austauschbare Routing-Schnittstelle in der App (Abschnitt 4.4), Konfiguration zentral, Schlüssel nie im Code; Anbieter nach Entscheidung (Abschnitt 6). |
| **Fahreransicht** | Gut gelöst: große Knöpfe „Gewechselt“/„Nicht rein“/„Entfällt“, Menge vorbelegt, Bemerkung, Fotos, „zuletzt kein Zugang“-Hinweis, Navigation zu Google/Apple Maps, Fahrzettel. Betriebsart „unterwegs/Büro“ ist **keine Berechtigung**. | **Beibehalten** (Bedienmuster) / **Erweitern**: Tourenübersicht mit Fortschritt und Mattenbedarf je Größe, Bestätigung **je Liegeplatz** im Stopp, Status Geplant → Unterwegs → In Bearbeitung → Abgeschlossen plus Ausnahmen, danach automatisch nächster Stopp; nur eigene Touren. |
| **Unterschrift** | **Eine** Übernahme-Unterschrift je Tour, sie steht auf allen Lieferscheinen der Tour. | **Umbauen**: Unterschrift **je Stopp/Kunde** (Name, Zeitpunkt), optional; „ohne Unterschrift mit Grund“ wie beim Regiebericht (`src/ui/signature.js`). |
| **Lieferscheine** | Automatisch je Kunde und Tour als PDF (über die Graph-Umwandlung HTML→PDF, Grenze 3,8 MB); Nummer `LS-<Datum>-<Kundenname>` – **nicht fortlaufend, kann doppelt vorkommen**; Versand von Hand über das eigene Postfach, Empfänger nicht vorbelegt; Versand in der Tour vermerkt. | **Anpassen**: Lieferschein als **Beleg der Fakturierung** (Belegart `lieferschein`, fortlaufender Nummernkreis, z. B. `LS-2026-000123`, Prüfsumme), je Stopp (ein Objekt, mehrere Liegeplätze), PDF mit der App (pdfmake, auch offline), Empfänger aus dem Kunden, Versand an Kunde/Büro/beide, Versand- und Ablagestatus protokolliert. |
| **SharePoint-Ablage** | Ordner `Mattenwechsel/Touren/<Jahr>/<Tourordner>/…`, Fotos je Liegeplatz, Ablageschritte je Tour gemerkt und nachgeholt (2.4: ohne Doppel-Upload). | **Beibehalten** (Nachholen, Schrittprotokoll, Fotos am Liegeplatz) / **Anpassen**: Lieferschein-PDF zusätzlich unter `Mattenwechsel/Kunden/<Kundennummer>/<Jahr>/<Monat>/Lieferscheine/` mit festem Dateinamen; SharePoint-Datei-ID und Link am Beleg gespeichert. |
| **Rechnungen** | **Keine**; nur „Auswertung je Kunde“ als CSV aus den Touren des Geräts. | **Neu**: Rechnungsentwürfe aus bestätigten Lieferscheinen über die vorhandene Fakturierung – Einzel- oder Sammelabrechnung je Kunde, jede Lieferscheinposition nur einmal, Freigabe von Hand. |
| **Rollen & Rechte** | Im Werkzeug keine Rollen; in der App eine Rolle `mattenwechsel` (sieht/ändert alles im Modul); Fahrer brauchen heute Schreibrecht auf `Stammdaten/`, weil das Werkzeug beim Abschließen die Stammdaten mitschreibt. | **Neu**: Rollen Büro/Disposition und Fahrer (Admin = Vollzugriff); Fahrer ohne Schreibrecht auf Stammdaten und ohne Zugriff auf Preise. |
| **Offline** | IndexedDB im Gerät, Erfassen und Abschließen ohne Netz, Ablage holt nach; Touren mit Fotos bleiben unbegrenzt im Gerät. | **Beibehalten** (Verhalten) / in den Offline-Speicher der App überführen (Fotos als Dateien statt eingebettet). |
| **Büro-Dashboard, Zu erledigen** | Gibt es nicht; die App weiß inhaltlich nichts über den Mattenwechsel. | **Neu**: Dashboard mit den neun verlangten Zahlen, Kalender, Einträge in „Zu erledigen“ und beim digitalen Mitarbeiter. |

### 1.2 Datenbestand heute

| Datei in SharePoint | Inhalt | Umgang |
|---|---|---|
| `Mattenwechsel/Stammdaten/Standorte.json` | Liegeplätze (Array ohne Versionsfeld) | Quelle der Übernahme; bleibt unverändert liegen |
| `Mattenwechsel/Touren/<Jahr>/<Ordner>/<Datum>_<TourId>.json` | Touren mit Halten, Unterschriften und Fotos (eingebettet) | Quelle für „letzter Wechsel“ und Verlauf; bleibt unverändert |
| `…/Lieferschein-<Kunde>-<Datum>.pdf`, `…/Tourbericht-…pdf` | abgelegte Nachweise | bleiben unverändert (Aufbewahrung) |
| `Mattenwechsel/Standorte/<ID>_…/Fotos/*.jpg` | Fotos je Liegeplatz | bleiben, werden weiter genutzt |
| `Stammdaten/Kunden.json` | Werkzeug-Kundenliste **oder** Export – unklar (Frage E2) | wird nicht mehr beschrieben (Konflikt mit Objektdoku aufgelöst) |
| `Objektpruefprotokolle/Stammdaten/Kunden.json` | Export der Kundenverwaltung (nur lesen) | Hilfe bei der Zuordnung der Kundennummern |

Laut Doku des Werkzeugs (Stand 16.10.2026) ist es **nie gegen die echten Microsoft-Dienste gelaufen**; ob seither echte Touren in SharePoint liegen, ist vor der Übernahme zu prüfen (Entscheidung E1). Die vier Word-Tourenlisten (Ursprung des Bestands) enthalten nur Kunde, Stückzahl, Farbe, Größe, Liegeadresse – **kein Intervall, keinen Liefertag, keinen Preis**.

### 1.3 Befunde außerhalb des Plans

- **„Gerät sperren“ im Werkzeug löscht im App-Rahmen den ganzen Browser-Speicher** der App (Abmeldung, App-Einstellungen, Einstellungen der anderen Werkzeuge). Behebung gehört in `werkzeuge/bruecke.js` – als eigene Aufgabe vorgeschlagen, unabhängig vom Modul.
- Die hochgeladenen Quellen (`bauteile/`) sind Fassung **2.3**; wer daraus neu baut, verliert die 2.4-Korrektur (der Test `test/werkzeuge.test.js` fängt das ab).
- Die Werkzeug-Tabelle in `docs/PLATTFORM.md` nennt noch die alten Fassungsnummern der anderen Werkzeuge.

---

## 2. Vorhandene Architektur und wiederverwendbare Funktionen

| Baustein | Wo | Verwendung im Modul |
|---|---|---|
| Modul-Gerüst (eigene JSON-Datei, automatisch speichern, zusammenführen, 403 → leer, später laden) | `src/storage/data-service.js` (`MODULE_DOCS`), `registerView`/`registerActions`/`registerTodo`, `src/ui/views/lazy.js`, `docs/ERWEITERN.md` | Modul `matten` wie Anlagen, Regiebericht, Qualitätsmessung |
| Kunden, Artikel, Belege, Nummernkreise, Prüfsumme | `src/core/invoicing.js` (`customers[]`, `articles[]`, `KINDS.lieferschein`, `SERIES_DEFAULTS.lieferschein = 'LS'`, `nextNumber` mit einstellbarer Stellenzahl, `finalize`, `FIXED_FIELDS`) | Kundenstamm, Mattentypen als Artikel mit Standardpreis und Steuersatz, Lieferschein als echter Beleg |
| Sammelrechnung aus Lieferscheinen, Doppelabrechnungsschutz | `collectDraft`, `billedBy`, `deliveryNotes[]` (Fakturierung) | Sammelabrechnung je Kunde/Monat; jede Lieferscheinposition nur einmal |
| Muster „Quelle → Rechnungsentwurf“ mit eingefrorener Beilage, Stand offen/Entwurf/verrechnet, Storno gibt frei | `src/core/regie.js`, `src/core/fak-abrechnung.js`, `src/core/recharge.js`, `src/core/anlagen-rechnung.js` | Einzelabrechnung, „nicht verrechnen“, Beilage für die Buchhaltung ohne Zugriff aufs Modul |
| Erfassen am Handy → Unterschrift → PDF → Versand → Rechnung | `src/ui/views/regie.js`, `src/export/regie-pdf.js` | Vorbild für Stopp-Abschluss und Lieferschein |
| PDF | `src/ui/pdf.js`, `src/export/pdf-parts.js`, `src/export/invoice-pdf.js` (Lieferschein mit Unterschriftszeile, ohne Preise), Briefpapier | Lieferschein, Tourbericht, Ladeliste – auch offline |
| Unterschrift | `src/ui/signature.js` | je Stopp |
| Mail | `src/ui/mailer.js` (Graph Mail.Send, sonst Mail-App; `onSent`), Sammelversand mit Pause (`src/core/fak-laeufe.js`) | Versand an Kunde/Büro/beide, protokolliert |
| SharePoint und Offline | `src/storage/docstore-sharepoint.js` (eTag, Upload, Ordner, Rechte), `src/storage/offline.js` (Warteschlange, Fotos/Blobs, Nachholen) | Touren am Handy, Fotos, PDF-Ablage mit Wiederholung |
| Geodaten | `src/core/geo.js` (Luftlinie, Fahrzeitschätzung), `src/ui/geocode.js` (Nominatim), Koordinaten an Objekten | Koordinaten je Objekt/Liegeplatz, Fahrzeit-Rückfall |
| Mitarbeitende, Fuhrpark, Termine | Stammdaten, `fahrzeuge/fahrzeuge.json`, `src/core/appointments.js` | Fahrer, Fahrzeug, optional Tour als Termin |
| Material & Lager | `src/core/material.js` | später: Mattenbestand (sauber/beim Kunden/Wäscherei) |
| Zu erledigen, digitale Mitarbeiter, Kennzahlen | `src/ui/views/disponent.js`, `src/core/kpi.js` | Dashboard-Hinweise, Kennzahlen |
| Rechte-Prüfung | `src/core/rights-audit.js`, `src/ui/views/access.js` | neue Ordner mit den richtigen Gruppen anlegen |
| Personen ohne Microsoft-Konto | `mein-plan.php`, `kunden.php` | falls Fahrer ohne Firmenkonto (Entscheidung E7) |
| KI (optional) | `src/ai/*` (Werkzeuge mit Freigabe) | später: „Welche Liegeplätze sind diese Woche fällig?“ |

---

## 3. Integrationskonzept

### 3.1 Grundentscheidung: Werkzeug in ein App-Modul überführen (Begründung)

Das Konzept verlangt, die bestehende App zu erweitern, nicht neu zu bauen. Die „bestehende Mattenwechsel-App“ ist hier ein **eingebettetes Einzeldatei-Werkzeug**, das außerhalb dieses Repos aus eigenen Quellen gebaut wird. Es direkt um Preise, Rechnungen, Rollen, Objektebene und zentrale Planung zu erweitern, hieße:

- eine **zweite Kunden- und Rechnungslogik** im Werkzeug aufzubauen (verboten laut Konzept) oder eine aufwendige Brücke zwischen Werkzeug und Fakturierung;
- die **gerätebezogene Datenhaltung** zu ersetzen – das ist der Kern des Werkzeugs, also ohnehin ein Umbau;
- zwei Codestände (Werkzeug-Quellen beim Ersteller, App im Repo) parallel zu pflegen.

Darum: **Das Modul `matten` entsteht in der App** und übernimmt aus dem Werkzeug die bewährten Teile – Fälligkeitsregel, Tagesbedarf, Bedienmuster der Tour am Handy, Ablagestruktur, Nachholen – als getesteten Code in `src/core/` bzw. `src/ui/views/`. Die vorhandenen Daten werden übernommen (Abschnitt 4.3). Das ist eine **Modernisierung derselben Anwendung** (gleiche Plattform, gleiche Anmeldung, gleiche SharePoint-Ablage, gleiche Daten), keine Neuentwicklung daneben.

- Bis zur Umstellung bleibt das Werkzeug unter `#matten` unverändert nutzbar (**Parallelbetrieb**, Entscheidung E14). Nach der Umstellung zeigt `#matten` das neue Modul; das Werkzeug bleibt noch eine Weile unter „Mattenwechsel (alt)“ nur lesend erreichbar und wird dann entfernt.
- Kein Datenverlust: Die Übernahme liest die alten Dateien und schreibt neue; die alten bleiben unverändert (Rückweg jederzeit möglich).

### 3.2 Einbindung in bestehende Funktionen

- **Kunden**: nur `customers[]` der Fakturierung. Neue optionale Felder (`deliveryNoteEmail`, `matten: { billing: 'einzel' | 'sammel', billingInterval: 'monat' | 'quartal', autoSend }`). Wer die Fakturierung nicht sieht (Fahrer, Disposition ohne Faktura-Recht), bekommt Name, Lieferadresse und Lieferschein-Mail über eine **schmale Kopie** in der Tour (eingefroren beim Freigeben), nicht die Kundenstammdatei.
- **Objekte**: App-Objekte (`objekte/objekte.json`); Liegeplätze hängen am Objekt. Fehlt ein Objekt, legt die Übernahme es an (mit Kundenzuordnung).
- **Matten/Preise**: Mattentypen = Artikel der Fakturierung (Artikelgruppe „Matten“, Standardpreis, Steuersatz). **Kundenpreise** als neue, allgemein nutzbare Liste der Fakturierung `customerPrices[] { id, customerId, articleId, price, currency, vat, validFrom, validTo }` (Vorrang vor dem Standardpreis; auch für andere Module nutzbar).
- **Lieferschein**: Beleg der Fakturierung (`kind: 'lieferschein'`, Nummernkreis `LS`, Stellenzahl einstellbar, z. B. 6 → `LS-2026-000123`), festgeschrieben beim Bestätigen (Prüfsumme). Positionen tragen `source: { type: 'matten', key: '<Einsatz-Schlüssel>' }` und den eingefrorenen Preis (ausgeblendet im PDF).
- **Rechnung**: Einzel = Entwurf je Lieferschein; Sammel = `collectDraft` über die offenen Lieferscheine des Kunden im Zeitraum. Schutz: `billedBy` je Lieferschein + Prüfung je Position (`source.key`) beim Festschreiben, Storno gibt frei.
- **Ablage, Mail, PDF, Unterschrift, Offline, Rechte, Zu erledigen, Kennzahlen**: die App-Bausteine aus Abschnitt 2.

---

## 4. Datenmodell

### 4.1 Zuordnung der Entitäten des Konzepts

| Entität (Konzept) | Umsetzung | Ort |
|---|---|---|
| Customer | `customers[]` (+ Felder s. 3.2) | `fakturierung/fakturierung.json` |
| CustomerObject | `objects[]` (+ `customerId` über `customers[].objectIds`) | `objekte/objekte.json` |
| MatType | `articles[]` mit `group: 'Matten'`, `size`, `color` | `fakturierung/fakturierung.json` |
| CustomerPrice | `customerPrices[]` (neu, mit Gültigkeit) | `fakturierung/fakturierung.json` |
| MatPlacement (Liegeplatz) | `placements[]` | `matten/matten.json` |
| ExchangeSchedule | Felder am Liegeplatz (`intervalDays`, `startDate`, `rule`, `pauses[]`) | `matten/matten.json` |
| ExchangeJob (Einsatz) | `jobs[]`, Schlüssel `<liegeplatzId>:<Solltermin>` | `matten/einsaetze-<Jahr>.json` |
| Tour, TourStop | eine Datei je Tour mit `stops[]` | `matten/touren/<Jahr>/<TourId>.json` |
| ExchangeRecord | `stops[].items[]` (Ist-Menge, Status, Zeit, Bemerkung, eingefrorene Matte) | in der Tour |
| DeliveryNote / Item | `documents[]` mit `kind: 'lieferschein'`, `lines[].source` | `fakturierung/fakturierung.json` |
| InvoiceDraft / Item | `documents[]` (Entwurf), `deliveryNotes[]`, `lines[].source` | `fakturierung/fakturierung.json` |
| DocumentArchive | `archive: { itemId, webUrl, path, uploadedAt }` am Lieferschein | Beleg |
| IntegrationJob | `integration: { pdf, mail, ablage }` je Lieferschein (Status, Versuche, letzter Fehler, Zeit) + Warteschlange im Gerät | Beleg / Gerät |

Alle Einträge: eindeutige ID (zufällig erzeugt, nicht hochgezählt), `createdAt/By`, `updatedAt/By`, Statusfeld; Dateien mit `schema`.

### 4.2 Schemata (Auszug)

```text
matten/matten.json  { schema: 1, settings, placements[], areas[] }
  placements[] { id, legacyId ('L-0001'), objectId, customerId, name (Liegeplatz, z. B. „Haupteingang“),
                 floor, access (Zugang/Schlüssel), hint, active,
                 mats: [{ articleId, qty, owner: 'wir'|'kunde' }],
                 intervalDays (14|28), startDate, rule ('rhythmus' | 'ab-ist'),
                 workMinutes, pauses: [{ from, to, reason }], areaId (Gebiet/Tourrunde),
                 lat, lon, geoQuality, createdAt/By, updatedAt/By }
  settings { depot (Betriebshof), workday { from, to }, shiftRule, routing { provider }, deliveryNote { autoSend, office } }

matten/einsaetze-<Jahr>.json  { schema: 1, jobs[] }
  jobs[] { key: '<placementId>:<Solltermin>', placementId, due (Solltermin), planned (verschoben auf),
           status: geplant|in-tour|erledigt|teilweise|nicht-durchgefuehrt|ausgesetzt|nachzuholen,
           tourId, reason, createdAt/By, updatedAt/By }

matten/touren/<Jahr>/<TourId>.json  { schema: 1, id, date, driverId, vehicleId, areaId,
           status: entwurf|freigegeben|unterwegs|abgeschlossen, order (gespeichert), route { provider, km, minutes },
           stops: [{ id, objectId, customer { id, name, no, deliveryNoteEmail }, address, lat, lon, window,
                     status: geplant|unterwegs|in-bearbeitung|abgeschlossen|nicht-angetroffen|teilweise|nicht-durchgefuehrt,
                     items: [{ jobKey, placementId, placementName, mat { articleId, name, size, color }, planned, actual,
                               status, time, note, photos: [Dateiname] }],
                     signature { name, svg, at } | unsigned { reason }, finishedAt, finishedBy, deliveryNoteId }] }
```

Eingefroren wird, was auf dem Nachweis steht (Liegeplatzname, Matte, Kunde, Adresse) – spätere Änderungen am Stamm ändern alte Touren und Lieferscheine nicht. Der **Preis** wird erst beim Erzeugen des Lieferscheins (im Büro bzw. automatisch, ohne Zugriff des Fahrers auf Preise) in die Belegposition geschrieben und dort festgeschrieben.

### 4.3 Übernahme der vorhandenen Daten (Migration)

Einmaliger **Übernahme-Assistent** im Modul (nur Vollzugriff), schrittweise mit Vorschau:

1. **Sicherung**: Kopie von `Mattenwechsel/Stammdaten/Standorte.json`, `Stammdaten/Kunden.json` und der Tour-Liste nach `Mattenwechsel/_Sicherung/<Datum>/`; dazu bleibt der Versionsverlauf von SharePoint.
2. **Kunden zuordnen**: je Werkzeug-Kunde Vorschlag eines Fakturierungs-Kunden (Kundennummer, sonst Name); unklare von Hand; fehlende anlegen (Entscheidung E3).
3. **Objekte**: Liegeplätze nach Adresse zu Objekten gruppieren (Vorschlag), vorhandene App-Objekte wiederverwenden, sonst anlegen.
4. **Liegeplätze**: `L-xxxx` → `placements[]` mit `legacyId`; Matten auf Mattentypen abbilden (Größe/Farbe → Artikel); Intervall Wochen → Tage; 15 „zu prüfen“ bleiben markiert.
5. **Letzter Wechsel**: aus allen Tour-Dateien in SharePoint (nicht nur einem Gerät) je Liegeplatz → Startpunkt der Fälligkeit.
6. **Verlauf/Lieferscheine**: alte Touren und PDFs bleiben, wo sie sind, und werden im Modul nur lesend als „Verlauf (alt)“ angezeigt; sie werden **nicht** nachträglich zu Belegen der Fakturierung und nicht abgerechnet (sonst Doppelabrechnung mit bisheriger Abrechnung).

Eigenschaften: **idempotent** (zweimal ausführen ändert nichts – Zuordnung über `legacyId`), alte Dateien werden nie geschrieben, Rückweg = neue Dateien löschen bzw. Werkzeug weiter benutzen. Ein Testlauf mit den Werkzeug-Beispieldaten ist Teil der Tests.

### 4.4 Routing-Schnittstelle

`src/core/routing.js` definiert eine Anbieter-Schnittstelle:

```text
geocode(adresse) → { lat, lon, quality }
matrix(punkte) → Fahrzeiten/Entfernungen
optimize({ depot, stops[{ lat, lon, window, minutes }], drivers[{ start, end, vehicle }] }) → Touren mit Reihenfolge, Ankunftszeiten, Rest
```

Anbieter: `luftlinie` (eingebaut, kostenlos: Luftlinie × Faktor, Nächster-Nachbar + 2-opt, Zeitfenster grob) als Rückfall immer verfügbar; `google` (Google Maps Platform, Schlüssel nur am Webspace in einem kleinen Durchreicher nach Muster `ki.php`, mit Microsoft-Anmeldung und Tageslimit); `azure` (Azure Maps über Entra-Token, wie im Werkzeug – ohne Schlüssel im Code). Welcher gilt, ist eine Einstellung. Die Navigation am Handy braucht **keinen** Schlüssel (Link `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lon>`).

---

## 5. Abläufe, Rechte und Oberflächen

### 5.1 Ablauf

1. **Planen**: Die App rechnet aus den Liegeplätzen die Einsätze der nächsten Wochen (Schlüssel verhindert Doppel); Büro sieht Kalender, verschiebt/setzt aus/holt nach.
2. **Tour vorschlagen**: je Tag/Gebiet aus fälligen Einsätzen, gruppiert je Objekt zu Stopps, Reihenfolge über die Routing-Schnittstelle; Büro prüft, ändert Reihenfolge (ziehen), weist Fahrer/Fahrzeug zu, **gibt frei**.
3. **Fahren**: Fahrer sieht nur eigene freigegebene Touren, startet, navigiert, bestätigt je Liegeplatz die Ist-Menge, erfasst Ausnahmen, Unterschrift (optional), schließt den Stopp ab → nächster Stopp.
4. **Lieferschein**: beim Abschluss des Stopps entsteht der Lieferschein (Beleg, Nummer, PDF); Versand je nach Einstellung automatisch oder nach Prüfung; Ablage in SharePoint mit Wiederholung.
5. **Abrechnen**: bestätigte Lieferscheine → Rechnungsentwurf (einzeln sofort oder gesammelt am Monatsende); Büro prüft, korrigiert, gibt frei, stellt aus. **Nie automatisch versenden**, außer ausdrücklich eingestellt.

### 5.2 Rollen (Erweiterung der vorhandenen Rechteverwaltung)

| Rolle | Darf | SharePoint-Ordner |
|---|---|---|
| Vollzugriff (= Administrator) | alles inkl. Einstellungen, Preise, Übernahme | alle |
| **Mattenwechsel Büro** (neu, ersetzt `mattenwechsel` für das Büro) | Liegeplätze, Kalender, Touren planen/freigeben, Lieferscheine prüfen/versenden; Rechnungsentwürfe nur zusätzlich mit Recht Fakturierung | `matten/` bearbeiten |
| **Fahrer Mattenwechsel** (neu) | eigene Touren sehen, Wechsel bestätigen, Lieferschein senden (wenn erlaubt) | `matten/touren/` bearbeiten, Rest nicht; keine Preise, kein Kundenstamm |

Grenze von SharePoint: Rechte gelten **je Ordner, nicht je Datensatz**. Fahrer können technisch alle Touren im Ordner lesen; die App zeigt nur die eigenen. Soll das streng getrennt sein, bekommt jeder Fahrer einen eigenen Unterordner mit eigenem Recht (Entscheidung E9). Preise liegen in der Fakturierung – dorthin haben Fahrer kein Recht.

### 5.3 Oberflächen

**Büro (PC und Tablet)**: *Übersicht* (Dashboard mit: heute fällig, geplante Touren, in Durchführung, abgeschlossen, überfällig, nicht durchgeführt, nicht versendete Lieferscheine, fehlgeschlagene Ablage, offene Rechnungsentwürfe) · *Kalender* (Woche/Monat) · *Liegeplätze* (je Kunde → Objekt, Tabelle wie im Konzept-Beispiel) · *Mattentypen & Preise* (in der Fakturierung, Reiter „Matten“) · *Touren* (Vorschlag, Karte/Liste, Reihenfolge ziehen, Fahrer zuweisen, Freigabe) · *Lieferscheine* (Status Versand/Ablage, erneut senden/ablegen) · *Abrechnung* (offene Lieferscheine je Kunde, Entwurf erzeugen) · *Übernahme* (einmalig).

**Fahrer (Handy)**: *Meine Touren* (Stopps gesamt/erledigt/offen, Mattenbedarf je Größe = Ladeliste) · *Stopp* (Kunde, Objekt, Liegeplätze mit Plus/Minus, „Navigation starten“, Ausnahmen, Fotos, Unterschrift) · nach Abschluss automatisch der nächste Stopp. Die Leiste unten bekommt für die Fahrer-Rolle „Tour“ als Vorgabe.

Design: bestehende Bauteile (Karten, Dropdowns, Tabellen, Handy-Blätter, Unterschriftsfeld), keine neue Designsprache.

---

## 6. Externe Integrationen

| Dienst | Zweck | Stand | Hinweise |
|---|---|---|---|
| Microsoft Graph – SharePoint | Daten, Fotos, PDF-Ablage | vorhanden | keine neuen Rechte nötig |
| Microsoft Graph – Mail.Send | Lieferscheinversand | vorhanden (Rückfall Mail-App) | Versand aus dem Postfach der angemeldeten Person bzw. eines Sammelpostfachs (Entscheidung E10) |
| Google Maps (Navigation) | „Navigation starten“ am Handy | Link, kein Schlüssel | nichts einzurichten |
| Google Maps Platform – Geokodierung, Routes / Route Optimization | Koordinaten, Fahrzeiten, Tourenoptimierung | neu | Konto mit Abrechnung, Schlüssel nur am Webspace (Durchreicher), Tageslimit; Kosten je Anfrage – vor dem Einschalten Preise prüfen; bei ~100–200 Liegeplätzen geringes Volumen |
| Azure Maps | Alternative (im Werkzeug schon verwendet) | Konto/Zustimmung je Gerät, Schnittstelle 1.0 | Ablösung der 1.0-Schnittstellen durch Microsoft prüfen |
| OpenStreetMap Nominatim | Geokodierung ohne Kosten | in der App vorhanden | Nutzungsregeln (1 Anfrage/s), Genauigkeit bei Stiegen begrenzt |

Empfehlung: Start mit dem **eingebauten Anbieter** (Luftlinie + Optimierung in der App, Geokodierung über Nominatim mit Korrektur von Hand) – kostenlos und für die heutige Größe ausreichend; Google als zweiter Anbieter, sobald freigegeben. Die Schnittstelle erlaubt den Wechsel ohne Umbau.

---

## 7. Arbeitspakete (priorisiert, je für sich prüfbar)

Jedes Paket: eigener Commit, Unit-Tests der Rechenkerne, Browser-Test in `.pruefung/`, Doku und Hilfe-Thema; erst das nächste beginnen, wenn das vorige grün ist.

| Nr | Paket | Ergebnis / Abnahme |
|---|---|---|
| **Phase 2 – Stammdaten** | | |
| P1 | Modul-Gerüst `matten` (Datei, Rechte, Rollen Büro/Fahrer, später laden, Ordner in der Rechte-Prüfung) | leere Ansicht je Rolle sichtbar, Rechte-Tests grün |
| P2 | Kunden-Erweiterung in der Fakturierung (Lieferschein-Mail, Abrechnungsart/-intervall) + `customerPrices[]` mit Gültigkeit + Preisermittlung `priceFor(customer, article, date)` | Tests: Kundenpreis vor Standardpreis, Gültigkeit, Steuersatz |
| P3 | Mattentypen als Artikel (Reiter „Matten“) | Größen/Farben gepflegt, Preis je Typ |
| P4 | Liegeplätze je Kunde → Objekt (Tabelle, Dialog, Zugang, Zeitfenster, Arbeitszeit, Intervall, Start, Pausen), Koordinaten | Konzept-Beispiel (3 Liegeplätze, 14/28 Tage) anlegbar |
| P5 | Übernahme-Assistent (Sicherung, Kunden/Objekte zuordnen, Liegeplätze, letzter Wechsel aus allen Touren) | Beispieldaten des Werkzeugs vollständig übernommen, zweiter Lauf ändert nichts, alte Dateien unverändert |
| **Phase 3 – Planung** | | |
| P6 | Fälligkeitsrechner `jobsFor(placements, von, bis)` (Rhythmus fest / ab Ist, Pausen, Verschieben ohne Rhythmusänderung, Nachholen, eindeutiger Schlüssel) | Tests 14/28 Tage, verschoben, ausgefallen, Betriebsurlaub, erneutes Planen ohne Doppel |
| P7 | Kalender Woche/Monat, Verschieben/Aussetzen/Nachholen | Büro plant eine Woche im Kalender |
| P8 | Routing-Schnittstelle + eingebauter Anbieter, Tourvorschlag (Stopps je Objekt, Arbeitszeit, Zeitfenster) | Tour für 2 Fahrer, ein Objekt mit 3 Liegeplätzen = 1 Stopp |
| P9 | Tourenplanung im Büro (Reihenfolge ziehen, Fahrer/Fahrzeug, Freigabe, Ladeliste) | freigegebene Tour mit gespeicherter Reihenfolge |
| **Phase 4 – Fahrer** | | |
| P10 | Fahreransicht: Meine Touren, Stopp, Bestätigung je Liegeplatz, Status, Ausnahmen, Fotos, Navigation, nächster Stopp, offline | Fahrer-Ablauf am Handy (390 px) inkl. Funkloch |
| P11 | Unterschrift je Stopp bzw. ohne Unterschrift mit Grund | Unterschrift auf dem Lieferschein |
| **Phase 5 – Lieferscheine** | | |
| P12 | Lieferschein als Beleg (Nummernkreis, eingefrorene Positionen/Preise, Prüfsumme), PDF ohne Preise | richtiges PDF, Nummer fortlaufend, zweites Bestätigen erzeugt keinen zweiten Lieferschein |
| P13 | Versand (Kunde/Büro/beide, erneut), Protokoll; SharePoint-Ablage `Mattenwechsel/Kunden/<Nr>/<Jahr>/<Monat>/Lieferscheine/` mit Datei-ID/Link, Wiederholung, kein Doppel | Mail- und SharePoint-Ausfall: Lieferschein bleibt, später nachgeholt |
| **Phase 6 – Abrechnung** | | |
| P14 | Rechnungsentwurf einzeln/gesammelt je Kunde, Prüfen → Freigeben → Ausstellen über die Fakturierung, Korrekturen protokolliert, Doppelabrechnungsschutz je Position | Tests: unterschiedliche Kundenpreise, Teilmengen, doppelte Entwürfe verhindert, Storno gibt frei |
| **Phase 7 – Abschluss** | | |
| P15 | Dashboard, Zu erledigen, digitaler Mitarbeiter, Kennzahlen | neun Zahlen aus dem Konzept sichtbar |
| P16 | Gesamtprüfung nach den Abnahmekriterien (Abschnitt 16 des Konzepts), Doku, Umstellung `#matten`, Werkzeug „alt“ nur lesend | Abnahme durch die Geschäftsführung |
| optional | Fahrerseite ohne Microsoft-Konto (Webspace), Mattenbestand/Wäscherei, Google-Anbieter, Lieferscheine im Kundenbereich | je nach Entscheidung |

Grobe Reihenfolge der Auslieferung: P1–P5 (Stammdaten + Übernahme) → P6–P9 (Planung) → P10–P13 (Fahrer + Lieferschein) → P14–P16. Nach jeder Phase ein Paket zum Hochladen; das alte Werkzeug bleibt bis P16 parallel nutzbar.

**Stand der Umsetzung**

- **P1 – fertig** (Modul-Gerüst): Rechte-Modul `matten` (Werkzeug und Büro-Modul) und neues Modul `mattentour` (Fahrer). Rolle `mattenwechsel` heißt jetzt „Mattenwechsel Büro“ (Gruppen-Zuordnung in `config.json` gilt weiter; Module `matten`, `mattentour`), neue Rolle `mattenfahrer` „Fahrer Mattenwechsel“ (nur `mattentour`). Datei `matten/matten.json` (`{ schema: 1, settings, placements[], areas[] }`, `MODULE_DOCS.matten`), Rechte `matten/` (Büro) und `matten/touren/` (Büro, Fahrer) in `dataRights`, `FOLDERS` und der Rechte-Prüfung; das Büro liest zusätzlich `objekte/`, Fahrer nichts außer `matten/touren/`. Ansichten „Matten-Liegeplätze“ (`mw-liegeplaetze`) und „Matten-Touren“ (`mw-touren`, noch leer) unter *Objekte & Kunden*, später geladen (`src/ui/views/matten.js`); das Werkzeug bleibt unverändert unter `#matten` als „Mattenwechsel (Werkzeug)“. Leiste: Büro Werkzeug und Liegeplätze, Fahrer Touren. Suche, „+ Neu“, Cleo-Themen. Tests `test/rechte.test.js`, `test/lazy.test.js`, `test/leiste.test.js`, Browser-Test `.pruefung/matten_stamm_app.mjs`.
- **P2 – fertig** (Fakturierung, `src/core/invoicing.js`, `src/ui/views/invoicing-matten.js`): Kundenblatt mit Reiter „Mattenwechsel“ (`deliveryNoteEmail`, `matten { billing, billingInterval, priceModel: 'wechsel' | 'pauschale', monthlyFlat[], autoSend }`) und „Kundenpreise“ (`customerPrices[]` mit Gültigkeit, Prüfung ohne Überschneidung, Preis ≥ 0, Dezimalkomma). Eine Preislogik: `priceFor(data, customerId, articleId, date)` (Kundenpreis vor Standard, Kundenrabatt nicht zusätzlich), `monthlyFlatFor`/`monthlyFlats` für die Pauschale. Tests `test/fak-preise.test.js`, Browser-Test `.pruefung/matten_preise_app.mjs`. Alle Felder optional, Prüfsumme der Belege unverändert.
- **P3 – fertig**: Reiter „Matten“ (Stammdaten) mit Mattentypen als Artikel (`group: 'Matten'`, `size`, `color`, `matKind`, Preis je Wechsel), Vorlage der üblichen Größen ohne Preise, Hilfen `matTypes`, `matLabel`, `matName`, `matSize`. Beispieldaten: zwei Mattentypen und ein Kundenpreis.
- **P4 – fertig** (Liegeplätze): je Kunde (Fakturierung, nur lesend; ohne Recht die Kopie am Liegeplatz) → Objekt (`customers[].objectIds`) → Tabelle Liegeplatz \| Matte \| Stückzahl \| Intervall \| nächster Wechsel; Dialog mit Name, Stockwerk, Zugang, Hinweis, Matten `[{ articleId, qty, owner }]` (Mattentypen über `matTypes`, Beschriftung `matLabel` aus der Fakturierung, Kopie von Bezeichnung, Größe, Farbe, Art), Intervall 14/28 (andere erlaubt), Starttermin (Pflicht, auch bei „ab letztem Wechsel“), Regel `rhythmus`/`ab-ist`, Arbeitszeit, Zeitfenster, Pausen, Gebiet (`areas[]`), aktiv, Koordinaten (Objekt bzw. OpenStreetMap). „Nächster Wechsel“ rechnet `nextDue` aus `src/core/matten-plan.js` (bestätigter Wechsel vorerst der letzte aus der Übernahme, `doneFromPlacements`); keine eigene Fälligkeitslogik im Modul. Ohne Mattentypen Hinweis mit Weg in den Reiter „Stammdaten → Matten“ der Fakturierung. Rechenkern `src/core/matten.js`, Tests `test/matten.test.js` (Konzept-Beispiel mit 3 Liegeplätzen, 14/28 Tage).
- **P5 – fertig** (Übernahme-Assistent, nur Vollzugriff, Reiter in „Matten-Liegeplätze“): Sicherung nach `Mattenwechsel/_Sicherung/<Datum>/` (Standorte.json, Kunden.json, Liste der Tour-Dateien; nichts wird ersetzt), Vorschau mit Zuordnung von Hand (Kunden über Kundennummer, sonst Name; fehlende nur auf Klick anlegen, mit `deliveryNoteEmail`; Objekte je Kunde und Adresse, vorhandene wiederverwendet; Größe/Farbe → Mattentyp, bei mehreren Arten „Standard“, fehlende genannt), Übernehmen mit `legacyId`, Intervall Wochen → Tage, letzter Wechsel aus allen Tour-Dateien (`lastExchange`, zugleich Starttermin; ohne Wechsel der Tag der Übernahme = sofort fällig). Idempotent, alte Dateien nie geschrieben, alte Touren/PDFs nicht zu Belegen. Kern `src/core/matten-import.js`, Oberfläche `src/ui/views/matten-uebernahme.js`, Tests `test/matten-import.test.js` mit erfundenen Werkzeug-Beispieldaten (`src/data/demo-matten.js`); Browser-Test mit SharePoint-Attrappe (Sicherung angelegt, Werkzeug-Dateien unverändert, zweiter Lauf ohne Änderung).
- **P6 – Rechenkern fertig** (`src/core/matten-plan.js`, ohne Oberfläche; Tests `test/matten-plan.test.js`): `jobsFor({ placements, done, jobs, closures, von, bis, skip })` mit Schlüssel `<placementId>:<Solltermin>` (erneutes Planen ohne Doppel, vorhandene bleiben mit Status), Regeln `rhythmus` und `ab-ist` (höchstens ein offener Einsatz je Liegeplatz), Pausen und Betriebsurlaub (`ausgesetzt` oder `nachzuholen` am ersten freien Tag danach), `shiftJob` (Verschieben ohne Rhythmusänderung), `markNotDone` → `nachzuholen`, `markDone`, `skipJob`, `discardJob` (neuer Status `verworfen`), `dueOn`, `overdue`, `nextDue`, `dueDates` (Vorschau), `calendarWeek`, `calendarMonth`, `groupByObject`. Kalender und Bedienung folgen in P7.
- **P7 – fertig** (Einsätze speichern und Kalender; Kern `src/core/matten-einsaetze.js`, Ansicht „Matten-Kalender“ `mw-kalender` in `src/ui/views/matten-kalender.js`, Tests `test/matten-einsaetze.test.js`, Browser-Test `.pruefung/matten_kalender_app.mjs`): Einsätze je Jahr des Solltermins in `matten/einsaetze-<Jahr>.json` (`{ schema: 1, jobs[] }`, `id` = Schlüssel `<placementId>:<Solltermin>`), gespeichert über den vorhandenen Weg der App (`YEAR_DOCS` in `src/storage/data-service.js`, wie die Wochenpläne: automatisch, je Einsatz zusammengeführt, offline; Start lädt Vorjahr, laufendes und nächstes Jahr, weitere `ensureYears`). „Einsätze planen“ (Vorgabe 8 Wochen, `planJobs` → `jobsFor`): „x neu, y unverändert, z zur Prüfung“, erneutes Planen ohne Doppel, „Anpassen“ für die zur Prüfung (`resolveReview`). Kalender Woche/Monat je Tag nach Gebiet → Objekt mit Status in Farbe und Text, Matten je Größe, Ladeliste je Tag (`loadList`, für P9), Hinweisliste überfällig/nachzuholen; Verschieben (Rhythmus bleibt), Aussetzen und Verwerfen (mit Grund), Nachholen (`catchUpJob`, neu im Rechner, ebenso `pauseEffect`) je Einsatz und für mehrere markierte. Betriebsurlaub/Schließtage in `settings.closures` mit `settings.skip` (`entfaellt` | `nachholen`), beim Speichern auf geplante Einsätze angewandt (`applyPauses`). Bestätigte Wechsel über `confirmedExchanges` (heute `lastExchange`, nimmt die Touren dazu, sobald es sie gibt). Zu erledigen und digitaler Mitarbeiter „Fristen“ (nur Büro, nur „Öffnen“): „Mattenwechsel überfällig (n Liegeplätze)“, „Einsätze für die nächsten Wochen noch nicht geplant“ (14 Tage). „Nächster Wechsel“ in den Liegeplätzen mit Einsätzen und Betriebsurlaub. Büro darf zusätzlich `assistenz/` bearbeiten. Fahrer sehen nichts davon.
- **P8 – Rechenkern fertig** (ohne Oberfläche; die Bedienung im Büro folgt mit P9): Routing-Schnittstelle `src/core/routing.js` (Register `registerRoutingProvider`/`routingProvider`, Auswahl mit Rückfall `routingFor`) mit dem eingebauten Anbieter **`luftlinie`** (Matrix aus Luftlinie × 1,35 und 35 km/h + 5 Minuten wie `estimateTravel`, einstellbar; Geokodierung über OpenStreetMap; Optimierung `planRoutes` für mehrere Fahrer: Startpunkte je Fahrer, Einfügen mit Bedauern (Regret-2) mit Prüfung der Ankunftszeiten gegen Zeitfenster und Arbeitsende, Kapazität in Matten optional, 2-opt/Or-opt je Tour, Verlegen zwischen Touren; deterministisch; nicht Einplanbares mit Grund `koordinaten`/`zeitfenster`/`arbeitszeit`/`kapazitaet`), `scheduleRoute` (Zeiten einer festen Reihenfolge), Stub **`google`** (wirft „noch nicht eingerichtet“, Anfrageformat für den späteren Durchreicher `routing.php` nach Muster `ki.php`, kein Schlüssel im Code) und `navigationUrl` (Google-Maps-Link). Tourvorschlag `src/core/matten-tour.js`: `stopsFromJobs` (ein Stopp je Objekt: Arbeitszeit summiert, Zeitfenster geschnitten, Matten je Typ, Kunde/Adresse/Liegeplätze eingefroren), `proposeTours` (Touren im Format 4.2, Status `entwurf`, zufällige ID, Gebiete auf Wunsch getrennt), `loadList`, `moveStop`, `assignDriver`, `recalcTimes`, `tourMatrix`, `tourProblems`, `tourId`, `tourFileName` (`matten/touren/<Jahr>/<TourId>.json`). Tests `test/routing.test.js`, `test/matten-tour.test.js` (Tour für 2 Fahrer, Objekt mit 3 Liegeplätzen = 1 Stopp, 150 Stopps unter 2 s – gemessen 16–80 ms). Doku: PLATTFORM, „Touren und Routen (Rechenkern)“.
- **P9 – fertig** (Tourenplanung im Büro; Ansicht „Matten-Tourenplanung“ `mw-planung` in `src/ui/views/matten-planung.js`, Rechenkern `src/core/matten-touren.js`, Tests `test/matten-touren.test.js`, Browser-Test `.pruefung/matten_touren_app.mjs`): **eine Datei je Tour** `matten/touren/<Jahr>/<TourId>.json` (Format 4.2, dazu `vehicleLabel`, `driverEmail`, `releasedAt/By`), über die **gemeinsame Touren-Ablage mit der Fahreransicht** (`TourStore` in `src/storage/matten-touren.js`, eine Instanz je Sitzung über `src/ui/matten-tourablage.js`): Ordner eines Jahres mit eTag auflisten (`listFiles`, eine Anfrage), nur Neues und Geändertes lesen, Änderungen zuerst im Gerät, Schreiben mit If-Match der Reihe nach, bei Konflikt neu lesen und **an einer Stelle zusammenführen** (`mergeTour` aus P10), Änderungen des Büros ab `unterwegs` gesperrt (`TourLockedError`). Tag wählen (Vorgabe nächster Arbeitstag), Fahrer des Tages (Arbeitszeit, Fahrzeug aus dem Fuhrpark, Platz), „Vorschlag erzeugen“ (`stopsFromJobs` mit Überfälligen, ohne Einsätze anderer Touren; `proposeTours`; zweiter Klick ersetzt die Entwürfe des Tages), je Tour Stopps mit Ankunftszeit, Zeitfenster, Liegeplätze und Matten, km/Minuten, **Ladeliste** (je Tour und des Tages), Warnungen, „Route in Google Maps ansehen“ (Wegpunkte, ab 10 Stopps in Teilen), „Nicht eingeplant“ mit Grund. Bearbeiten (Entwürfe): Pfeile hoch/runter, am PC ziehen (auch in eine andere Tour), in die Tour eines anderen Fahrers, entfernen, „Zu Tour …“ (gleiches Objekt = derselbe Stopp), Fahrer/Fahrzeug/Arbeitszeit, neue leere Tour; danach `recalcTimes`. **Freigabe** mit Prüfung (`releaseProblems`: Fahrer, Stopps, Tag ab heute, kein Einsatz in einer anderen Tour – frisch gelesen, auch Entwürfe anderer Büro-Plätze –, Einsätze noch offen), Status `freigegeben`, Einsätze `in-tour` mit `tourId` und `beforeTour` über die Einsatz-Speicherung; „Freigabe zurücknehmen“ und „Entwurf löschen“ geben sie frei. Betriebshof und Arbeitszeit (`settings.depot`, `settings.workday`, `settings.splitByArea`), Fahrer als schmale Kopie (`settings.drivers`, „Mattenfahrer“: aus den Mitarbeitenden oder von Hand). Kalender: je Tag „Touren planen“, „in Tour (Fahrer)“; Zu erledigen und digitaler Mitarbeiter „Morgen fällige Einsätze ohne freigegebene Tour“ (nur Büro, nur „Öffnen“). Büro liest zusätzlich `fahrzeuge/fahrzeuge.json` (Rechte-Test). Hilfe-Themen `mw-touren-planen`, `mw-tour-freigeben`, `mw-betriebshof`, `mw-fahrer`. Leiste unten des Büros: „Tourplanung“ als vierter Platz. Nach der Zusammenführung mit P10/P11 eine gemeinsame Touren-Ablage für Büro und Fahrer; Beispieldaten mit Betriebshof, zwei Fahrern und Koordinaten.
- **P10/P11 – fertig** (Fahreransicht mit Firmenkonto und Unterschrift je Stopp; die Webspace-Seite P10b folgt und nutzt dieselben Rechenkerne): Ansicht „Matten-Touren“ (`mw-touren`, `src/ui/views/matten-fahrer.js`, eigenes kleines Paket, Kürzel `mwf-`), Rechenkern `src/core/matten-fahrt.js` (ohne Oberfläche) und Speicher `src/storage/matten-touren.js`. **Touren:** Fahrer sehen nur eigene (`driverId` über `driverEmail` an der Tour bzw. E-Mail in den Mitarbeitenden; `proposeTours`/`assignDriver` kopieren die E-Mail an die Tour) mit Status `freigegeben`/`unterwegs` von heute bis +7 Tage, vergangene offene oben mit Hinweis; das Büro sieht alle außer Entwürfen. **Tourenübersicht** mit Stopps gesamt/erledigt/offen, geplanter Reihenfolge, Mattenbedarf je Größe (`loadList`), „Tour starten“ (`unterwegs`, `startedAt/By`), „Navigation starten“ zum nächsten offenen Stopp (`navigationUrl`). **Stopp:** Kunde, Objekt, Adresse, Zugang, Hinweis, Stockwerk, Liegeplätze mit Soll; je Liegeplatz „Gewechselt“ (Soll vorbelegt), Plus/Minus (Abweichung markiert), „Nicht möglich“ mit Grund, Bemerkung, Fotos (verkleinert, `matten/fotos/<Jahr>/<placementId>/<Datum>_<TourId>_<NN>.jpg`, ohne Netz in der Warteschlange). Stopp-Status `geplant` → `unterwegs` → `in-bearbeitung` → `abgeschlossen` bzw. `teilweise`/`nicht-angetroffen`/`nicht-durchgefuehrt` (aus den Liegeplätzen abgeleitet oder als Ausnahme gewählt). **Abschluss (P11):** Unterschrift am Gerät (Name, Funktion) oder ohne Unterschrift mit Grund; gespeichert `finishedAt`, `finishedBy`, `driverId`, `signature`/`unsigned`, `confirmation`, `outcome`, `note`, `totals`, `deviations`, `deliveryNote { state: 'offen' }` (Merker für P12, Lieferschein noch nicht gebaut); danach fest für den Fahrer (Korrektur nur Büro: `reopenStop` mit Grund, Verlauf in `corrections`) und automatisch der nächste offene Stopp; alle fertig → Tour `abgeschlossen`. **Offline:** jede Änderung zuerst im Gerät (eigener Speicher je Konto), dann mit eTag nach SharePoint; „wartet auf Netz“, Nachholen automatisch, kein Verlust beim Neuladen; bei Konflikt `mergeTour(base, mine, theirs)` je Stopp (wer ihn zuletzt geändert hat, gewinnt für diesen Stopp). **Für das Büro:** `jobUpdatesFromTour(tour)` → `[{ key, status: 'erledigt' | 'teilweise' | 'nachzuholen', date, actual, … }]` (inkl. `alsoJobKeys`) und `doneFromTours(tours)` → `[{ placementId, date }]` für den Fälligkeitsrechner; Einsätze schreibt nur das Büro. **Rechte:** neuer Ordner `matten/fotos/` (Büro und Fahrer: Bearbeiten), Fahrer schreibt nur `matten/touren/` und `matten/fotos/`, keine Preise, kein Kundenstamm. Tests `test/matten-fahrt.test.js` (Statusübergänge, Ableitung, Abweichungen, Abschluss, Korrektur, Einsätze, Fälligkeit, Zusammenführen, Speichern mit Konflikt und ohne Netz), `test/rechte.test.js`, `test/lazy.test.js`; Browser-Test `.pruefung/matten_fahrer_app.mjs` (Handy 390 px, Funkloch mit Neuladen, zweiter Fahrer, Büro mit Korrektur); Hilfe-Themen `mw-touren`, `mw-stopp`, `mw-stopp-abschliessen`, `mw-touren-offline`; Beispiel-Tour für den Browser-Modus (`createMattenTourDemo`).

- **P12/P13 – fertig** (Lieferschein je Stopp, Versand, SharePoint-Ablage; Ansicht „Matten-Lieferscheine“ `mw-lieferscheine` in `src/ui/views/matten-lieferscheine.js`, Kürzel `mw-ls-`/`mwl-`, Rechenkern `src/core/matten-lieferschein.js`, Tests `test/matten-lieferschein.test.js` und `test/rechte.test.js`, Browser-Test `.pruefung/matten_lieferschein_app.mjs`): **ein Lieferschein je abgeschlossenem Stopp** (auch „teilweise“, dann nur die gewechselten Mengen; „Kunde nicht angetroffen“, „nicht durchgeführt“ oder nichts gewechselt: kein Lieferschein, Vermerk `deliveryNote { state: 'keiner', reason }` am Stopp) als **Beleg der Fakturierung** (`kind: 'lieferschein'`, Nummernkreis `LS` über `finalize`, 6 Stellen als Vorgabe über `settings.numberDigits.lieferschein`, gemeinsam mit den Lieferscheinen von Hand, z. B. `LS-2026-000123`; festgeschrieben mit Prüfsumme beim Erstellen). Kopf: Kunde der Fakturierung, Objektadresse als Lieferadresse, Datum (Abschluss, Wien), Uhrzeit und Fahrer im Einleitungstext, Bemerkungen mit Abweichungen und Gründen im Schlusstext, Unterschrift bzw. „ohne Unterschrift: Grund“ als `receipt` (in der Prüfsumme über `FIXED_OPTIONAL`; `FIXED_FIELDS` unverändert). Positionen: je Liegeplatz ein Titel, darunter je Mattentyp die **tatsächliche Stückzahl** mit dem **am Tag des Abschlusses gültigen Preis** (`priceFor`, Kundenpreis vor Standard, eingefroren; im PDF ausgeblendet) und `source { type: 'matten', key: '<tourId>:<stopId>:<placementId>:<Mattentyp>', jobKey, … }`; nicht Gewechseltes als Textzeile. **Idempotent** über `source.key = 'matten:<tourId>:<stopId>'` (Prüfung über alle Belege, vorher frischer Stand der Touren und Belege). Am Stopp `deliveryNote { state: 'erstellt' | 'versendet', docId, number, at, by }`. **PDF** über `invoice-pdf.js` (Unterschrift als Bild aus der SVG-Linie). **Ablage** nach `Mattenwechsel/Kunden/<Kundennummer>/<Jahr>/<Monat>/Lieferscheine/LS-…_<Kunde>_<Datum>.pdf` (Bibliothek-Wurzel wie das Werkzeug; neue Root-Methoden `rootFile`/`uploadRoot` mit `conflictBehavior=fail`: vorher prüfen, nichts überschreiben, kein Doppel), ohne Netz über die Warteschlange der Ablage (`CachedDocStore.uploadRoot`, Eintrag `root`), Protokoll `archive { itemId, webUrl, path, uploadedAt }` und `integration.ablage { status, tries, lastError, at }`; Fehler → „Ablage fehlgeschlagen – erneut versuchen“ in „Zu erledigen“ und beim digitalen Mitarbeiter. **Versand** über das Senden-Fenster: an Kunde (`deliveryNoteEmail`, sonst `email`), Büro (`settings.officeEmail` in `matten.json`), beide; „PDF herunterladen“, „Erneut senden“; Sammelversand mit Pause (`MAIL_PAUSE_MS` aus `fak-laeufe.js`); Kunden mit `matten.autoSend` bekommen ihn gleich nach dem Erstellen durch die angemeldete Büro-Person; Protokoll `sent[]` und `integration.mail { status, to, at, by, tries, lastError }`. Büro-Ansicht mit Filtern (ohne Lieferschein, nicht versendet, versendet, Ablage fehlgeschlagen, alle), „Lieferscheine erstellen (n)“ einzeln und gesammelt, Einstellung „automatisch erstellen“ (aus), Lieferschein aus dem Stopp öffnen (auch aus der Fahreransicht des Büros); in der Fakturierung erscheinen die Lieferscheine ganz normal (nur ein Hinweis „Aus dem Mattenwechsel“). Hilfe-Themen `mw-lieferscheine`, `mw-lieferschein-senden`, `mw-lieferschein-ablage`.

Annahmen P12/P13 (bis zur Entscheidung): Erstellen, Senden und Ablegen darf nur, wer den Mattenwechsel **und** die Fakturierung bearbeitet (wie der Rechnungsentwurf beim Regiebericht) – heute der Vollzugriff oder eine eigene Rolle mit beiden Bereichen; die Rolle „Mattenwechsel Büro“ bleibt ohne Fakturierung und sieht nur den Stand (Kopie am Stopp). Die Ablage liegt wie im Plan in der Bibliothek-Wurzel unter `Mattenwechsel/Kunden/…` (keine Abweichung nach `matten/lieferscheine/` nötig: wer den Mattenwechsel bearbeitet, hat dort schon „Bearbeiten“ für das Werkzeug); die PDFs liegen nicht zusätzlich unter `fakturierung/belege/`. Ist für Lieferscheine keine Stellenzahl eingestellt, schreibt das erste Erstellen `numberDigits.lieferschein = 6` in die Einstellungen der Fakturierung (frühere Lieferscheine von Hand behalten 4 Stellen, gezählt wird weiter fortlaufend). Datum des Lieferscheins ist der Tag des Abschlusses in Wien; der Preis gilt an diesem Tag. Die Unterschrift (SVG, wenige KB) steht im Beleg, damit auch die Buchhaltung dasselbe PDF erzeugt. Die Kopie am Stopp kennt nur „erstellt“/„versendet“, nicht den Stand der Ablage. Ein Kunde ohne Eintrag in der Fakturierung bekommt den Empfänger aus der Kopie in der Tour (Hinweis), ohne Kundennummer liegt das PDF unter `ohne-Kundennummer`. „Automatisch senden“ geht nur mit Microsoft 365 (sonst bleibt der Lieferschein „nicht versendet“ mit Hinweis); „automatisch erstellen“ läuft, sobald eine berechtigte Person die App öffnet und die Touren gelesen sind (einmal je Stopp und Sitzung). Zwei Büro-Plätze, die im selben Augenblick denselben Stopp erstellen, könnten zwei Belege anlegen (wie beim Festschreiben in der Fakturierung: vorher wird der Stand der anderen geholt); ein Storno für Lieferscheine gibt es in der Fakturierung nicht.

Annahmen P10/P11 (bis zur Entscheidung): Der Fahrer wird über die **E-Mail seines Kontos** erkannt; dafür trägt die Tour beim Zuweisen die E-Mail des Mitarbeiters (`driverEmail`), denn Fahrer lesen die Stammdaten nicht – ohne E-Mail in den Stammdaten sieht der Fahrer seine Tour nicht (Hinweis im Büro). Das Büro darf in der Fahreransicht mitarbeiten (z. B. Nachtragen nach Anruf); abgeschlossene Stopps öffnet nur das Büro wieder (mit Grund), auch das Büro schließt danach neu ab. Plus/Minus vor „Gewechselt“ belegt nur die Menge vor; eine Menge 0 bei „gewechselt“ ist erlaubt und als Abweichung markiert. Bemerkung und Fotos gehören zum Liegeplatz (am ersten Eintrag des Liegeplatzes gespeichert), eine Bemerkung zum Stopp gibt es zusätzlich im Abschluss. Die Unterschrift ist optional; ohne Unterschrift ist ein Grund Pflicht (bei „Kunde nicht angetroffen“ vorbelegt). Datum eines Wechsels ist der Tag des Abschlusses (Wien), nicht das Datum der Tour. Ein Wechsel mit weniger als Soll gilt für den Einsatz als `teilweise`, nichts gewechselt als `nachzuholen`. Tour-Dateien der Jahre davor, dieses und danach werden gelesen; abgeschlossene Touren älter als 14 Tage nur aus dem Gerät.

Annahmen in P7: Das Jahr der Datei ist das des Solltermins (nicht des verschobenen Tags). Verschieben und Nachholen nur auf heute oder später; Einsätze in einer Tour und erledigte ändert der Kalender nicht. Ein entfernter Betriebsurlaub öffnet ausgesetzte Einsätze nicht von selbst. „Noch nicht geplant“ schaut 14 Tage voraus. Verworfene Einsätze stehen nicht im Kalender. Das Büro sieht den digitalen Mitarbeiter „Fristen“ und darf dessen Entscheidungen speichern (`assistenz/`).

Annahmen dieser Phase (bis zur Entscheidung): übernommene Liegeplätze behalten die Regel des Werkzeugs („ab dem letzten Wechsel“); neue beginnen mit „fester Rhythmus“ (E5). Werkzeug-Kunden ohne Vorschlag werden nicht übernommen, bis jemand „neu anlegen“ oder einen Kunden wählt (E3). Neue Kunden bekommen die Lieferschein-Adressen des Werkzeugs als `deliveryNoteEmail`, keine Rechnungs-Mail. Liegeplätze desselben Kunden an derselben Adresse werden ein Objekt; zwei Kunden an einer Adresse ergeben zwei Objekte (ein Objekt gehört in der Fakturierung genau einem Kunden). Übernommene Liegeplätze lassen sich nur inaktiv setzen, nicht löschen (sonst holt sie ein späterer Lauf wieder). Ohne Fakturierung (Büro) stehen nur Kunden und Mattentypen zur Wahl, die an Liegeplätzen schon vorkommen.

Annahmen P8 (bis zur Entscheidung): Die Arbeit an einem Stopp muss bis zum Ende des Zeitfensters **fertig** sein (nicht nur begonnen). Jeder eingeteilte Fahrer bekommt mindestens einen Stopp, solange es genug gibt – welche Fahrer an einem Tag fahren, entscheidet das Büro. Ohne Arbeitszeit am Liegeplatz gelten 5 Minuten je Liegeplatz. Ein Liegeplatz mit mehreren offenen Einsätzen (überfällig und heute) wird einmal gewechselt. Zwei Kunden an einem Objekt ergeben zwei Stopps (je Stopp ein Lieferschein).

Annahmen P9 (bis zur Entscheidung): Das Büro des Mattenwechsels liest die Stammdaten weiterhin **nicht**; die Fahrer stehen als schmale Kopie (Name, E-Mail, Arbeitszeit, Fahrzeug, Platz) in `matten.json`, gepflegt von jemandem, der die Mitarbeitenden sieht, oder von Hand. Fahrzeuge liest das Büro aus dem Fuhrpark (neues Leserecht auf `fahrzeuge/`; ohne Recht plant die App ohne Fahrzeug). Ein Entwurf hält Einsätze nur für Vorschläge fest (sie kommen in keinen zweiten Vorschlag); „in Tour“ setzt erst die Freigabe. Entwürfe vergangener Tage halten nichts fest. Freigegebene Touren ändert das Büro nur nach „Freigabe zurücknehmen“; ab `unterwegs` gar nicht mehr (Korrektur einzelner Stopps folgt). Freigeben nur für heute und später. Gleichzeitige Änderungen (Büro, Fahrer, zweiter Büro-Platz) führt `mergeTour` je Stopp zusammen. Änderungen an Entwürfen werden ohne Netz im Gerät gehalten und nachgeholt; Freigeben, Zurücknehmen und Löschen nur mit Verbindung. An der Tour steht als `driverId` die Kennung der Person aus den Mitarbeitenden (sonst die des Fahrer-Eintrags), die E-Mail als `driverEmail`. „Morgen fällig“ meint den nächsten Arbeitstag (am Freitag bis Montag mit dem Wochenende). Gelesen werden die Tour-Ordner des Jahres des Tages (beim Vorschlag und vor der Freigabe auch des Vorjahres); auf einem neuen Gerät einmal alle Dateien dieser Jahre, danach nur Geänderte. Keine Karte (nur der Google-Maps-Link; die Kachelkarte des Wetter-Radars könnte später dienen). Die Beispieldaten haben einen erfundenen Betriebshof, zwei Fahrer (Kopie der Beispiel-Mitarbeitenden) und Koordinaten an den Liegeplätzen: im Browser-Modus plant der Vorschlag Stopps ein; die freigegebene Beispiel-Tour der Fahreransicht nutzt denselben Betriebshof und Fahrer.

---

## 8. Sicherung, Rückweg, Tests

- **Vor jeder Umstellung**: Sicherung der betroffenen Dateien in `_Sicherung/<Datum>/`, Versionsverlauf in SharePoint eingeschaltet (Prüfung im Systemcheck).
- **Rückweg**: Neue Dateien liegen getrennt (`matten/…`); die alten Werkzeug-Dateien werden nie geschrieben. Bis zur Freigabe kann jederzeit mit dem Werkzeug weitergearbeitet werden.
- **Tests** (Konzept Phase 7): 14-/28-Tage-Intervalle, verschobene und ausgefallene Wechsel, mehrere Liegeplätze je Objekt, mehrere Kunden je Tour, unterschiedliche Kundenpreise, teilweise Wechsel, wiederholte Bestätigung, doppelte Entwürfe, SharePoint- und Mail-Ausfall, Fahrer- und Büro-Rechte – als Unit-Tests der Rechenkerne und Browser-Tests mit der SharePoint-Attrappe; die bestehende Gesamtprüfung (81 Browser-Prüfungen) läuft bei jedem Paket mit.
- **Datenschutz**: Unterschriften und Fotos nur in SharePoint (Ordnerrechte), Aufbewahrung nach Entscheidung E15, Standortdaten der Fahrer werden nicht aufgezeichnet (nur „Navigation starten“) – sonst Betriebsvereinbarung nötig.

---

## 9. Offene Entscheidungen

**Entschieden am 6.11.2026 (Geschäftsführung):**

- **Grundweg:** Modul in der App mit Übernahme der vorhandenen Daten und Parallelbetrieb des Werkzeugs bis zur Abnahme (Abschnitt 3.1).
- **Fahrer (E7):** gemischt – Fahrer mit Firmenkonto arbeiten in der App (Rolle „Fahrer Mattenwechsel“), Fahrer ohne Konto über einen persönlichen Link am Webspace (Muster „Plan am Handy“). Zusätzliches Arbeitspaket **P10b** (Fahrerseite am Webspace: Tour, Bestätigung je Liegeplatz, Fotos, Unterschrift; Daten holt die App ab und legt sie in SharePoint ab).
- **Preismodell (E4):** je Kunde wählbar – **je gewechselter Matte** (Stückzahl × Preis je Mattentyp, Kundenpreis vor Standardpreis, mit Gültigkeit) **oder Pauschale je Monat** (je Liegeplatz bzw. Objekt). Wird in P2 und P14 umgesetzt.
- **Routing (E8):** zuerst der **eingebaute Anbieter** (OpenStreetMap-Koordinaten, Optimierung in der App); Google Maps Platform später über dieselbe Schnittstelle zuschaltbar. Navigation am Handy öffnet Google Maps.

Für die übrigen Punkte gilt bis auf Weiteres der Vorschlag in der rechten Spalte; Änderungen jederzeit möglich, bevor das betroffene Paket gebaut wird.

| Nr | Frage | Vorschlag |
|---|---|---|
| E1 | Liegen schon **echte Touren/Lieferscheine** des Werkzeugs in SharePoint? Wurde es produktiv benutzt? | prüfe ich beim ersten Paket mit Lesezugriff (Übernahme-Vorschau) |
| E2 | Was liegt in `Stammdaten/Kunden.json` (Werkzeug-Liste oder Export)? Ist die „Kundenverwaltung“ mit 551 Kunden orgaMAX, und ist ihre Nummer die Kundennummer der Fakturierung? | Fakturierung führend; Nummer aus dem Export zur Zuordnung |
| E3 | Kunden der Fakturierung als **einziger Kundenstamm** für den Mattenwechsel? | ja |
| E4 | **Preismodell**: Preis je gewechselter Matte, Pauschale je Monat, Mietmatte vs. Kundeneigentum? Gibt es heute Preislisten/Verträge, wie wird bisher abgerechnet? | Preis je Wechsel und Matte (Konzept), Pauschale später |
| E5 | **Rhythmus**: fest ab Starttermin (z. B. jeden 2. Dienstag) oder ab letztem tatsächlichem Wechsel? Fester Liefertag je Gebiet? | fest ab Starttermin, Verschieben ändert den Rhythmus nicht (Konzept) |
| E6 | Wie viele **Fahrer/Fahrzeuge/Touren** je Woche, wie viele Liegeplätze mittelfristig? | bestimmt, ob Reihenfolge genügt oder Mehrfahrzeug-Planung nötig |
| E7 | Haben die **Fahrer ein Microsoft-Konto** (Lizenz)? Sonst Fahrerseite am Webspace (Link wie „Plan am Handy“)? | mit Konto (sicherer, einfacher); Webspace-Seite als Option |
| E8 | **Routing-Anbieter**: eingebaut (kostenlos) zuerst, Google später? Google-Konto und Kosten freigegeben? | eingebaut zuerst, Google als Option |
| E9 | Müssen Fahrer **technisch** auf ihre eigenen Touren beschränkt sein (Ordner je Fahrer)? | nein, Anzeige reicht; sonst Ordner je Fahrer |
| E10 | **Lieferscheinversand**: automatisch nach Abschluss oder nach Prüfung im Büro? Aus welchem Postfach (Fahrer, Büro-Sammelpostfach)? Mit Kopie ans Büro? | nach Prüfung im Büro, Option „automatisch“ je Kunde |
| E11 | **Abrechnung**: Standard Sammelrechnung monatlich je Kunde? Je Objekt getrennt? Ein Rechnungsempfänger für mehrere Objekte? | monatlich je Kunde, Einzel je Kunde einstellbar |
| E12 | **Unterschrift**: wer unterschreibt (Hausbetreuung, Portier)? Reicht Foto, wenn niemand da ist? | optional, sonst „ohne Unterschrift, Grund“ + Foto |
| E13 | **Lieferscheinnummer**: `LS-2026-000123` (6 Stellen, je Jahr neu)? Gemeinsamer Nummernkreis mit anderen Lieferscheinen der Fakturierung? | ja, gemeinsamer Kreis, 6 Stellen |
| E14 | **Parallelbetrieb**: Werkzeug bis zur Abnahme weiter nutzen? Wer pflegt bis dahin seine Quellen (2.4)? | ja; keine Weiterentwicklung im Werkzeug mehr |
| E15 | **Aufbewahrung**: Lieferscheine/Tourberichte 7 Jahre? Fotos/Unterschriften wie lange? | 7 Jahre Belege, Fotos 2 Jahre (zu bestätigen) |
| E16 | **Mattenbestand/Wäscherei** (sauber/beim Kunden/Schwund) gleich mit bauen? | später, eigenes Paket |
| E17 | Modul **je Revier** trennen? | nein (wie heute) |

Sobald diese Punkte entschieden sind, beginnt die Umsetzung mit P1–P5. Die Antworten werden hier und in `docs/AUSBAU.md` eingetragen.
