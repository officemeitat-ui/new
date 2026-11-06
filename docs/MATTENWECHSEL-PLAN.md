# Mattenwechsel – Bestandsaufnahme und Umsetzungsplan

Stand 6. November 2026. Grundlage: „Technisches Umsetzungskonzept – Mattenwechsel-Modul“ der Geschäftsführung (inkl. Nachtrag „Bestehende Mattenwechsel-App erweitern und modernisieren“). **Dieses Dokument ist die Analyse vor der Umsetzung – es wurde noch nichts am Mattenwechsel geändert.** Gebaut wird erst, wenn die offenen Entscheidungen (Abschnitt 9) getroffen sind.

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

---

## 8. Sicherung, Rückweg, Tests

- **Vor jeder Umstellung**: Sicherung der betroffenen Dateien in `_Sicherung/<Datum>/`, Versionsverlauf in SharePoint eingeschaltet (Prüfung im Systemcheck).
- **Rückweg**: Neue Dateien liegen getrennt (`matten/…`); die alten Werkzeug-Dateien werden nie geschrieben. Bis zur Freigabe kann jederzeit mit dem Werkzeug weitergearbeitet werden.
- **Tests** (Konzept Phase 7): 14-/28-Tage-Intervalle, verschobene und ausgefallene Wechsel, mehrere Liegeplätze je Objekt, mehrere Kunden je Tour, unterschiedliche Kundenpreise, teilweise Wechsel, wiederholte Bestätigung, doppelte Entwürfe, SharePoint- und Mail-Ausfall, Fahrer- und Büro-Rechte – als Unit-Tests der Rechenkerne und Browser-Tests mit der SharePoint-Attrappe; die bestehende Gesamtprüfung (81 Browser-Prüfungen) läuft bei jedem Paket mit.
- **Datenschutz**: Unterschriften und Fotos nur in SharePoint (Ordnerrechte), Aufbewahrung nach Entscheidung E15, Standortdaten der Fahrer werden nicht aufgezeichnet (nur „Navigation starten“) – sonst Betriebsvereinbarung nötig.

---

## 9. Offene Entscheidungen

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
