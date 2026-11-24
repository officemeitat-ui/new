=== ARTIKEL
titel: SVERWEIS und XVERWEIS – Werte aus einer anderen Tabelle holen
bereich: Excel, Word & PowerPoint
tags: sverweis, xverweis, nachschlagen, excel, formel, artikelliste, preis suchen, vlookup
zielgruppe: kunde
---
**Symptom:** In einer Tabelle (zum Beispiel Bestellungen) sollen passende Werte aus einer zweiten Tabelle (zum Beispiel Artikelliste mit Preisen) automatisch eingetragen werden, statt sie abzutippen.

**Häufige Ursachen:** Die Funktion ist unbekannt, der Suchwert steht nicht in der ersten Spalte der Suchtabelle (bei SVERWEIS), der Spaltenindex ist falsch gezählt oder die letzte Angabe fehlt und liefert dadurch falsche Treffer.

## Lösung
1. **XVERWEIS** (in neueren Versionen von Microsoft 365 und Excel 2021 vorhanden): In die Zielzelle `=XVERWEIS(A2; Artikel!A:A; Artikel!C:C; "nicht gefunden")` schreiben. A2 ist der Suchwert, `Artikel!A:A` die Spalte mit den Suchwerten, `Artikel!C:C` die Spalte mit dem gewünschten Ergebnis.
2. **SVERWEIS** (funktioniert in allen Versionen): `=SVERWEIS(A2; Artikel!A:C; 3; FALSCH)`. Die Zahl 3 bedeutet: dritte Spalte des angegebenen Bereichs. Der Suchwert muss in der ersten Spalte des Bereichs stehen.
3. Die letzte Angabe **FALSCH** bei SVERWEIS nicht weglassen, sonst wird ein ungefährer Treffer gesucht und das Ergebnis kann falsch sein.
4. Formel nach unten kopieren (Doppelklick auf das Ausfüllkästchen unten rechts an der Zelle).
5. Erscheint **#NV**, steht der Suchwert nicht in der Liste oder unterscheidet sich unsichtbar (Leerzeichen am Ende, Zahl als Text).
6. Zum Schluss prüfen: ein paar Ergebnisse von Hand mit der Artikelliste vergleichen.

## Wenn das nicht hilft
- Zahlen und Text mischen sich oft: siehe Artikel zu Zahlen, die als Text erkannt werden.
- Ticket anlegen und dazuschreiben: Dateiname, welche Formel in welcher Zelle steht, was angezeigt wird (zum Beispiel #NV) und welche Excel-Version genutzt wird.

=== ARTIKEL
titel: Zahlen werden als Text erkannt oder Datum wird falsch dargestellt
bereich: Excel, Word & PowerPoint
tags: excel, zahl als text, datum falsch, summe null, komma punkt, grünes dreieck, import
zielgruppe: kunde
---
**Symptom:** Eine Spalte lässt sich nicht addieren (Summe ist 0), Zahlen stehen linksbündig mit einem kleinen grünen Dreieck, oder aus einem Datum wird eine fünfstellige Zahl oder ein falsches Datum (Tag und Monat vertauscht).

**Häufige Ursachen:** Daten stammen aus einem Export oder einer E-Mail und wurden als Text übernommen, die Zelle ist als „Text“ formatiert, es stehen unsichtbare Leerzeichen davor oder dahinter, oder Dezimalzeichen und Datumsformat passen nicht zur Spracheinstellung.

## Lösung
1. Zelle anklicken: Zeigt sie ein gelbes Warnsymbol, darauf klicken und **In Zahl umwandeln** wählen.
2. Für ganze Spalten: Spalte markieren, **Daten → Text in Spalten**, direkt auf **Fertig stellen** klicken. Excel erkennt den Inhalt dann neu.
3. Steht eine Zahl nach der Umwandlung weiter linksbündig, Zellformat prüfen: **Start** → Auswahlfeld im Bereich „Zahl“ → **Standard** oder **Zahl** wählen.
4. Unsichtbare Leerzeichen entfernen: **Strg + H**, im Feld „Suchen nach“ ein Leerzeichen eingeben, „Ersetzen durch“ leer lassen, **Alle ersetzen**.
5. Falsch dargestelltes Datum: Zellen markieren, **Strg + 1** (Zellen formatieren), Register **Zahlen**, Kategorie **Datum**, das gewünschte Format wählen. Zeigt die Zelle eine große Zahl, genügt meist diese Umstellung.
6. Sind Tag und Monat vertauscht, wurde die Datei mit anderer Regionseinstellung erstellt. Dann die Spalte neu einlesen (siehe Artikel zur CSV-Datei) statt Werte einzeln zu ändern.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: woher die Daten stammen (Programm, Export, E-Mail), Beispiel eines falschen Wertes und wie er angezeigt wird. Möglichst Datei anhängen.

=== ARTIKEL
titel: Formel zeigt #NV, #WERT!, #BEZUG! oder #DIV/0! – was bedeutet das
bereich: Excel, Word & PowerPoint
tags: excel, fehlermeldung, #nv, #wert, #bezug, #div/0, formel fehler, wennfehler
zielgruppe: kunde
---
**Symptom:** Statt eines Ergebnisses zeigt eine Zelle eine Fehlermeldung mit Raute, etwa #NV, #WERT!, #BEZUG!, #DIV/0! oder #NAME?.

**Häufige Ursachen:** Jede Meldung hat eine typische Bedeutung: **#NV** – gesuchter Wert nicht gefunden (häufig bei SVERWEIS). **#WERT!** – falscher Datentyp, zum Beispiel Text in einer Rechnung. **#BEZUG!** – referenzierte Zeile, Spalte oder Tabelle wurde gelöscht. **#DIV/0!** – Division durch null oder durch eine leere Zelle. **#NAME?** – Funktionsname falsch geschrieben oder unbekannt.

## Lösung
1. Zelle mit dem Fehler anklicken und die Formel in der Bearbeitungsleiste ansehen.
2. Bei **#NV**: Suchwert auf Tippfehler und Leerzeichen prüfen, außerdem prüfen, ob der Wert in der Suchliste überhaupt vorkommt.
3. Bei **#WERT!**: Zellen der Rechnung ansehen, ob irgendwo Text statt einer Zahl steht (siehe Artikel zu Zahlen als Text).
4. Bei **#BEZUG!**: Das Löschen mit **Strg + Z** rückgängig machen, wenn es gerade erst passiert ist. Sonst die Formel neu auf die richtige Zelle verweisen lassen.
5. Bei **#DIV/0!**: Nenner prüfen. Wenn der Fall erlaubt ist, die Formel mit `=WENNFEHLER(A1/B1; "")` umhüllen, damit die Zelle leer bleibt.
6. Bei **#NAME?**: Schreibweise der Funktion prüfen. Neue Funktionen wie XVERWEIS gibt es nicht in alten Excel-Versionen.
7. Mit **WENNFEHLER** nur dann arbeiten, wenn der Fehler wirklich erwartet wird, denn er verdeckt sonst echte Probleme.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, Zelle, genaue Meldung, Inhalt der Formel (aus der Bearbeitungsleiste abschreiben) und was zuletzt geändert wurde.

=== ARTIKEL
titel: Zeilen und Spalten fixieren, damit Überschriften sichtbar bleiben
bereich: Excel, Word & PowerPoint
tags: excel, fenster fixieren, überschrift, scrollen, kopfzeile, spalte einfrieren, lange tabelle
zielgruppe: kunde
---
**Symptom:** Beim Blättern durch eine lange oder breite Tabelle verschwinden die Überschriften, und es ist nicht mehr erkennbar, welche Spalte was bedeutet.

**Häufige Ursachen:** Die Funktion „Fenster fixieren“ wurde nicht genutzt, oder die falsche Zelle war markiert, sodass zu viel oder zu wenig fixiert wurde.

## Lösung
1. Nur die oberste Zeile fixieren: **Ansicht → Fenster fixieren → Oberste Zeile fixieren**.
2. Nur die erste Spalte fixieren: **Ansicht → Fenster fixieren → Erste Spalte fixieren**.
3. Mehrere Zeilen oder Spalten gleichzeitig fixieren: Die Zelle anklicken, die direkt **unterhalb** der zu fixierenden Zeilen und **rechts** der zu fixierenden Spalten liegt. Beispiel: Zeilen 1 bis 3 und Spalte A bleiben stehen, dann Zelle B4 anklicken. Danach **Ansicht → Fenster fixieren → Fenster fixieren**.
4. Fixierung lösen: **Ansicht → Fenster fixieren → Fixierung aufheben**.
5. Beim Drucken sollen sich die Überschriften auf jeder Seite wiederholen: Das ist eine andere Einstellung, nämlich **Seitenlayout → Drucktitel → Wiederholungszeilen oben**.
6. Wirkt die Fixierung seltsam (es lässt sich nicht nach oben blättern), zuerst die Fixierung aufheben und neu setzen, diesmal mit sorgfältig gewählter Zelle.
7. Die Fixierung gilt je Tabellenblatt und wird mit der Datei gespeichert.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, Excel-Version und welche Zeilen oder Spalten sichtbar bleiben sollen. Ein Screenshot der Ansicht hilft.

=== ARTIKEL
titel: Tabelle filtern und sortieren, ohne Daten durcheinanderzubringen
bereich: Excel, Word & PowerPoint
tags: excel, sortieren, filtern, autofilter, daten verrutscht, zeilen getrennt, a bis z
zielgruppe: kunde
---
**Symptom:** Nach dem Sortieren passen Namen und Zahlen nicht mehr zusammen, oder Zeilen fehlen scheinbar, weil ein Filter aktiv ist.

**Häufige Ursachen:** Es war nur eine einzelne Spalte markiert, in der Tabelle gibt es leere Zeilen oder Spalten, die Überschriftenzeile wurde nicht erkannt, oder ein vergessener Filter blendet Zeilen aus.

## Lösung
1. Vor dem Sortieren eine Kopie der Datei speichern (**Datei → Speichern unter**), falls etwas schiefgeht.
2. Eine **einzelne Zelle** in der Tabelle anklicken, nicht eine Spalte markieren. Excel erkennt den zusammenhängenden Bereich dann selbst.
3. **Daten → Sortieren** wählen, die Spalte und die Reihenfolge festlegen. Das Häkchen **Daten haben Überschriften** muss gesetzt sein.
4. Zum Filtern **Daten → Filter** wählen (oder **Strg + Umschalt + L**). In den Pfeilen der Überschriften lassen sich Werte abhaken.
5. Gefilterte Spalten erkennbar am Trichtersymbol. Zeilennummern erscheinen blau, wenn Zeilen ausgeblendet sind.
6. Filter wieder entfernen: **Daten → Löschen** hebt alle Filter auf und zeigt alle Zeilen. **Daten → Filter** nochmals anklicken schaltet die Pfeile ab.
7. Ist schon etwas durcheinandergeraten und wurde noch nicht gespeichert, hilft sofort **Strg + Z**. Sonst eine frühere Version oder die gespeicherte Kopie öffnen.
8. Für dauerhaft gepflegte Listen eignet sich **Einfügen → Tabelle**: Sortieren und Filtern bleiben dort zuverlässig an die Zeilen gebunden.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, Uhrzeit des Fehlers, ob die Datei in OneDrive oder auf dem Server liegt (für eine frühere Version) und was vor dem Sortieren markiert war.

=== ARTIKEL
titel: Doppelte Einträge in Excel finden und entfernen
bereich: Excel, Word & PowerPoint
tags: excel, duplikate, doppelte werte, doppelt, liste bereinigen, kundenliste
zielgruppe: kunde
---
**Symptom:** In einer Adress-, Kunden- oder Artikelliste kommen Einträge mehrfach vor und sollen gefunden oder gelöscht werden.

**Häufige Ursachen:** Listen wurden zusammengeführt, Daten mehrfach importiert, oder derselbe Eintrag ist leicht verschieden geschrieben (Leerzeichen, Groß-/Kleinschreibung), sodass er nicht als gleich erkannt wird.

## Lösung
1. Zuerst eine Sicherungskopie der Datei speichern, denn das Entfernen lässt sich später nicht gezielt rückgängig machen.
2. **Nur markieren, noch nicht löschen:** Spalte markieren, **Start → Bedingte Formatierung → Regeln zum Hervorheben von Zellen → Doppelte Werte**, Farbe wählen. Doppelte Einträge werden eingefärbt und lassen sich prüfen.
3. **Löschen:** Eine Zelle der Liste anklicken, **Daten → Duplikate entfernen**. Im Fenster die Spalten ankreuzen, die gemeinsam entscheiden, ob eine Zeile doppelt ist. Beispiel: Vorname, Nachname und Ort zusammen.
4. Mit **OK** bestätigen. Excel meldet, wie viele doppelte Zeilen entfernt wurden und wie viele eindeutige Werte bleiben.
5. Bei Einträgen mit abweichender Schreibweise vorher Leerzeichen entfernen: **Strg + H**, ein Leerzeichen suchen, nichts eintragen, ersetzen (nur wenn Leerzeichen sonst nirgends nötig sind).
6. Bei Excel in neueren Microsoft-365-Versionen gibt es zusätzlich die Funktion `=EINDEUTIG(A2:A100)`, die eine Liste ohne Doppelte erzeugt und die Originaldaten unverändert lässt.
7. Ergebnis stichprobenartig prüfen.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, Zeilenanzahl, nach welchen Spalten doppelte Einträge gelten sollen und ein Beispiel für einen Eintrag, der nicht erkannt wird.

=== ARTIKEL
titel: Druckbereich festlegen und Excel-Tabelle auf eine Seite drucken
bereich: Excel, Word & PowerPoint
tags: excel, drucken, druckbereich, eine seite, seitenumbruch, querformat, skalieren
zielgruppe: kunde
---
**Symptom:** Beim Drucken wird die Tabelle auf mehrere Seiten verteilt, Spalten landen auf einer Extraseite, oder es werden Bereiche gedruckt, die nicht gedruckt werden sollen.

**Häufige Ursachen:** Kein Druckbereich festgelegt, Seitenausrichtung passt nicht zur Tabelle, die Skalierung steht auf 100 Prozent oder manuelle Seitenumbrüche sind gesetzt.

## Lösung
1. Den gewünschten Bereich mit der Maus markieren.
2. **Seitenlayout → Druckbereich → Druckbereich festlegen**. Aufheben geht über **Druckbereich aufheben**.
3. **Seitenlayout → Ausrichtung → Querformat** wählen, wenn die Tabelle breit ist.
4. Auf eine Seite verkleinern: **Datei → Drucken**, unter „Einstellungen“ die Skalierungsoption **Blatt auf einer Seite darstellen** wählen. Alternativ **Nur alle Spalten auf einer Seite darstellen**, wenn die Tabelle lang sein darf.
5. In der **Seitenvorschau** rechts im Druckfenster prüfen, ob alles lesbar bleibt. Wird die Schrift zu klein, lieber Spalten schmaler machen oder Papier im Format A3 verwenden, wenn der Drucker es kann.
6. Seitenumbrüche sichtbar machen: **Ansicht → Umbruchvorschau**. Blaue Linien lassen sich mit der Maus verschieben.
7. Überschriften auf jeder Seite: **Seitenlayout → Drucktitel → Wiederholungszeilen oben**.
8. Erst dann drucken. Für Kontrolle ohne Papierverbrauch bietet sich der Druck als PDF an.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, Druckername, was auf dem Papier erscheint im Vergleich zur Vorschau, und ob andere Dateien richtig drucken.

=== ARTIKEL
titel: Excel-Blatt oder einzelne Zellen vor Änderungen schützen
bereich: Excel, Word & PowerPoint
tags: excel, blattschutz, zellen sperren, schützen, formeln schützen, kennwort, formular
zielgruppe: kunde
---
**Symptom:** In einer Vorlage oder Kalkulation sollen Formeln und Überschriften nicht versehentlich überschrieben werden, während bestimmte Felder weiter ausgefüllt werden dürfen.

**Häufige Ursachen:** Der Blattschutz wurde direkt aktiviert, ohne vorher die Eingabefelder freizugeben, sodass anschließend gar nichts mehr geändert werden kann. Oder das Kennwort wurde vergessen.

## Lösung
1. Zuerst die Zellen freigeben, die weiter bearbeitet werden sollen: Zellen markieren, **Strg + 1**, Register **Schutz**, Häkchen bei **Gesperrt** entfernen, **OK**. Standardmäßig sind alle Zellen gesperrt, der Schutz wirkt aber erst nach Schritt 2.
2. **Überprüfen → Blatt schützen**. Im Fenster festlegen, was Benutzer weiterhin dürfen (zum Beispiel Zellen formatieren oder sortieren).
3. Ein Kennwort ist optional. Wird eines vergeben, an einem sicheren Ort notieren. Excel kann es bei Verlust nicht anzeigen.
4. Aufheben: **Überprüfen → Blattschutz aufheben**, gegebenenfalls Kennwort eingeben.
5. Ganze Arbeitsmappe vor dem Einfügen oder Löschen von Blättern schützen: **Überprüfen → Arbeitsmappe schützen**.
6. Wichtig: Der Blattschutz verhindert Versehen, ist aber **kein Sicherheitsschutz** für vertrauliche Daten. Dafür ist die Verschlüsselung der Datei mit Kennwort oder die Freigabe über Berechtigungen gedacht.
7. Nach dem Schützen testen: Ein freigegebenes Feld ausfüllen und ein gesperrtes anklicken.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, was geschützt werden soll, welche Meldung beim Bearbeiten erscheint. Bei vergessenem Kennwort nicht probieren, sondern melden und die letzte ungeschützte Sicherung heraussuchen.

=== ARTIKEL
titel: CSV-Datei richtig öffnen (Trennzeichen, Umlaute, führende Nullen)
bereich: Excel, Word & PowerPoint
tags: csv, excel, umlaute, trennzeichen, semikolon, führende nullen, import, zeichensatz
zielgruppe: kunde
---
**Symptom:** Eine CSV-Datei (zum Beispiel aus Buchhaltung, Webshop oder Bank) steht in Excel komplett in einer Spalte, Umlaute sind als Zeichensalat zu sehen, oder aus 00123 wird 123.

**Häufige Ursachen:** Das Trennzeichen (Semikolon oder Komma) passt nicht zur Regionseinstellung, die Datei ist in UTF-8 gespeichert und wird anders gelesen, oder Excel macht beim direkten Doppelklick aus Zahlenfolgen echte Zahlen und entfernt führende Nullen.

## Lösung
1. Datei **nicht** per Doppelklick öffnen. Stattdessen Excel starten, leere Arbeitsmappe öffnen, **Daten → Aus Text/CSV** wählen und die Datei auswählen.
2. In der Vorschau **Dateiursprung** prüfen. Bei Zeichensalat **65001: Unicode (UTF-8)** wählen, bei alten Programmen oft **1252: Westeuropäisch**.
3. **Trennzeichen** prüfen. Steht alles in einer Spalte, Semikolon, Komma oder Tabulator auswählen.
4. Für führende Nullen (Postleitzahlen, Artikelnummern, Telefonnummern) auf **Daten transformieren** klicken, die Spalte markieren und den Datentyp auf **Text** stellen. Danach **Schließen und laden**.
5. Das Ergebnis als normale Arbeitsmappe speichern (**Datei → Speichern unter → Excel-Arbeitsmappe**). Eine erneut als CSV gespeicherte Datei verliert Formatierungen.
6. Soll die Datei für ein anderes Programm wieder als CSV gespeichert werden: **Speichern unter → CSV UTF-8 (durch Trennzeichen getrennt)**, wenn Umlaute erhalten bleiben sollen.
7. Die Menübezeichnungen können je nach Version leicht abweichen.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Herkunft der Datei, Beispielzeile (ohne vertrauliche Daten), was falsch angezeigt wird und ob die Datei zur Weiterverwendung in einem anderen Programm gedacht ist.

=== ARTIKEL
titel: Pivot-Tabelle in Excel – erste Schritte zur Auswertung
bereich: Excel, Word & PowerPoint
tags: pivot, pivottable, excel, auswertung, summe nach, umsatz, gruppieren, aktualisieren
zielgruppe: kunde
---
**Symptom:** Aus einer langen Liste (zum Beispiel Umsätze, Stunden, Bestellungen) sollen Summen nach Kunde, Monat oder Produkt gebildet werden, ohne Formeln zu schreiben.

**Häufige Ursachen:** Die Quelldaten sind nicht sauber aufgebaut (leere Zeilen, verbundene Zellen, fehlende Überschriften), oder neue Daten fehlen in der Auswertung, weil die Pivot-Tabelle nicht aktualisiert wurde.

## Lösung
1. Quelldaten prüfen: Jede Spalte hat oben genau **eine** Überschrift, keine leeren Zeilen oder Spalten, keine Summenzeilen mitten in den Daten.
2. Eine Zelle in der Liste anklicken, **Einfügen → PivotTable**, auf **OK** klicken. Die Auswertung entsteht auf einem neuen Blatt.
3. Rechts die **Felder** in die vier Bereiche ziehen: **Zeilen** (Gruppen, zum Beispiel Kunde), **Spalten** (zweite Einteilung, zum Beispiel Monat), **Werte** (zu summierende Zahlen), **Filter** (Einschränkung auf ein Jahr).
4. Im Bereich Werte lässt sich mit Klick auf das Feld und **Wertfeldeinstellungen** zwischen Summe, Anzahl und Mittelwert wechseln.
5. Änderungen in den Quelldaten erscheinen erst nach **Rechtsklick in die Pivot-Tabelle → Aktualisieren**.
6. Datumswerte lassen sich mit Rechtsklick auf ein Datum und **Gruppieren** zu Monaten, Quartalen oder Jahren zusammenfassen.
7. Die Quelldaten nie in der Pivot-Tabelle selbst verändern. Zahlen dort sind Ergebnisse und keine Eingabefelder.
8. Wachsen die Quelldaten ständig, lohnt es sich, sie vorher mit **Einfügen → Tabelle** zu formatieren, damit neue Zeilen automatisch erfasst werden.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, welche Auswertung gewünscht ist und was die Pivot-Tabelle stattdessen zeigt.

=== ARTIKEL
titel: Bedingte Formatierung – Werte in Excel farbig hervorheben
bereich: Excel, Word & PowerPoint
tags: bedingte formatierung, excel, farbe, hervorheben, ampel, überfällig, größer als
zielgruppe: kunde
---
**Symptom:** In einer Liste sollen bestimmte Werte automatisch auffallen, etwa überfällige Termine, Beträge über einem Grenzwert oder niedrige Lagerbestände.

**Häufige Ursachen:** Die Zellen werden von Hand eingefärbt und die Farbe passt nach Änderungen nicht mehr. Oder eine Regel wirkt nicht, weil Zahlen als Text vorliegen oder mehrere Regeln einander überdecken.

## Lösung
1. Die Zellen markieren, die bewertet werden sollen (zum Beispiel die Spalte „Betrag“).
2. **Start → Bedingte Formatierung → Regeln zum Hervorheben von Zellen**. Dort etwa **Größer als**, **Kleiner als**, **Zwischen** oder **Datum** wählen.
3. Grenzwert eingeben und rechts das Farbformat wählen, mit **OK** bestätigen.
4. Für eine ganze Zeile färben, wenn eine Zelle zutrifft: **Bedingte Formatierung → Neue Regel → Formel zur Ermittlung der zu formatierenden Zellen verwenden**, zum Beispiel `=$C2>1000`, dann Format wählen. Das Dollarzeichen vor C hält die Spalte fest.
5. Für Ampeln oder Balken **Bedingte Formatierung → Symbolsätze** oder **Datenbalken** wählen.
6. Regeln prüfen, ändern oder löschen: **Bedingte Formatierung → Regeln verwalten**. Bei Überschneidung zählt die Reihenfolge der Liste, die obere Regel hat Vorrang.
7. Alle Regeln entfernen: **Bedingte Formatierung → Regeln löschen → Regeln aus dem gesamten Blatt löschen**.
8. Wirkt eine Regel nicht, Zahl-als-Text-Problem prüfen (grünes Dreieck in der Zelle).

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, Zellbereich, gewünschte Regel in einem Satz und die Excel-Version.

=== ARTIKEL
titel: Dropdown-Liste in einer Excel-Zelle anlegen (Datenüberprüfung)
bereich: Excel, Word & PowerPoint
tags: dropdown, auswahlliste, excel, datenüberprüfung, liste, zelle, eingabe einschränken
zielgruppe: kunde
---
**Symptom:** In einer Zelle soll nur zwischen festgelegten Werten gewählt werden können (zum Beispiel Status „offen, in Arbeit, erledigt“), damit keine Tippfehler oder abweichenden Schreibweisen entstehen.

**Häufige Ursachen:** Die Liste wurde nicht über die Datenüberprüfung angelegt, die Quelle ist falsch eingegeben (Trennzeichen) oder die Liste ist erweitert worden, ohne dass die Auswahl mitwächst.

## Lösung
1. Zelle oder Zellbereich markieren, in dem die Auswahl erscheinen soll.
2. **Daten → Datenüberprüfung**. Im Register **Einstellungen** bei „Zulassen“ den Eintrag **Liste** wählen.
3. Bei **Quelle** entweder die Werte direkt eintippen, durch Strichpunkt getrennt (`offen;in Arbeit;erledigt`), oder auf eine Zellspalte mit den Werten klicken und diesen Bereich markieren.
4. Das Häkchen **In-Zellen-Dropdown** muss gesetzt sein. Mit **OK** bestätigen.
5. Wächst die Liste, ist eine Quelle aus einer Excel-Tabelle (**Einfügen → Tabelle**) praktisch. Alternativ den Bereich großzügiger markieren oder im Feld Quelle erweitern.
6. Unter **Fehlermeldung** lässt sich festlegen, ob andere Eingaben abgelehnt (Stopp) oder nur gewarnt werden.
7. Entfernen: Zellen markieren, **Daten → Datenüberprüfung → Alle löschen**.
8. Hinweis: Wird ein Wert hineinkopiert, kann die Prüfung umgangen werden. Sie ist eine Eingabehilfe und kein Schutz.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, Zelle, was in der Quelle steht und was beim Anklicken der Zelle passiert (kein Pfeil, Fehlermeldung, falsche Einträge).

=== ARTIKEL
titel: Serienbrief in Word mit einer Excel-Adressliste erstellen
bereich: Excel, Word & PowerPoint
tags: serienbrief, seriendruck, word, excel, adressliste, briefe, etiketten, felder
zielgruppe: kunde
---
**Symptom:** Derselbe Brief soll an viele Empfänger gehen, jeweils mit eigener Anrede und Adresse aus einer Excel-Liste.

**Häufige Ursachen:** Die Excel-Liste ist nicht sauber aufgebaut (leere Zeilen, keine Überschriften, mehrere Blätter), die Datei ist noch in Excel geöffnet, oder Zahlen und Datumswerte erscheinen im Brief in anderem Format als in der Tabelle.

## Lösung
1. Excel-Liste vorbereiten: Erste Zeile enthält Spaltenüberschriften (Anrede, Vorname, Nachname, Straße, PLZ, Ort), darunter je Empfänger eine Zeile. Keine leeren Zeilen. Datei speichern und **in Excel schließen**.
2. In Word einen neuen Brief schreiben. **Sendungen → Seriendruck starten → Briefe**.
3. **Empfänger auswählen → Vorhandene Liste verwenden**, Excel-Datei und das richtige Tabellenblatt wählen, Häkchen bei „Erste Datenzeile enthält Spaltenüberschriften“ prüfen.
4. Cursor an die Stelle im Brief setzen und über **Seriendruckfeld einfügen** die Felder einsetzen, etwa Anrede, Vorname, Nachname. Leerzeichen und Zeilenwechsel zwischen den Feldern selbst setzen.
5. **Vorschau Ergebnisse** einschalten und mit den Pfeilen einige Empfänger durchblättern.
6. **Fertig stellen und zusammenführen → Einzelne Dokumente bearbeiten**, wenn das Ergebnis vorher noch geprüft werden soll. Direktes Drucken geht über **Dokumente drucken**.
7. Stimmt die Anzeige von Beträgen oder Datumswerten nicht, die Spalte in Excel als Text formatieren oder das Ergebnisfeld in Word anpassen lassen.
8. Der Seriendruck eignet sich auch für Etiketten und E-Mails.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Word- und Excel-Version, Speicherort der Liste (lokal, OneDrive, Server), genaue Meldung beim Verbinden und wie viele Empfänger betroffen sind.

=== ARTIKEL
titel: Formatvorlagen und automatisches Inhaltsverzeichnis in Word
bereich: Excel, Word & PowerPoint
tags: word, formatvorlagen, überschrift, inhaltsverzeichnis, gliederung, seitenzahlen, aktualisieren
zielgruppe: kunde
---
**Symptom:** Ein längeres Dokument (Angebot, Handbuch, Bericht) soll einheitlich aussehen und ein Inhaltsverzeichnis erhalten. Bisher wird jede Überschrift von Hand fett und größer gemacht, ein Verzeichnis passt dann nicht.

**Häufige Ursachen:** Überschriften sind nur optisch formatiert und nicht als Überschrift ausgezeichnet. Das Inhaltsverzeichnis wurde nach Änderungen nicht aktualisiert oder von Hand getippt.

## Lösung
1. Überschrift markieren, **Start → Formatvorlagen** und **Überschrift 1** wählen. Untergeordnete Abschnitte erhalten **Überschrift 2**, darunter **Überschrift 3**.
2. Aussehen für alle Überschriften ändern: Rechtsklick auf die Formatvorlage im Menü **Ändern** wählen, Schrift und Abstände anpassen. Alle Überschriften dieser Ebene ändern sich gemeinsam.
3. Normalen Text mit der Vorlage **Standard** (je nach Version „Normal“) formatieren, statt Absätze mit Leerzeilen zu trennen.
4. Cursor an die Stelle des Verzeichnisses setzen, **Verweise → Inhaltsverzeichnis** wählen und eine der Vorlagen anklicken.
5. Nach Änderungen: ins Verzeichnis klicken und **Tabelle aktualisieren** wählen. Es erscheint die Frage, ob nur Seitenzahlen oder das gesamte Verzeichnis aktualisiert werden soll. **Gesamtes Verzeichnis** wählen.
6. Über **Ansicht → Navigationsbereich** lässt sich die Gliederung links anzeigen. Überschriften können dort sogar verschoben werden.
7. Das Verzeichnis nicht von Hand ändern, denn die Änderungen gehen beim nächsten Aktualisieren verloren.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Word-Version, Dateiname, welche Überschrift im Verzeichnis fehlt oder falsch erscheint und ob die Datei aus einer fremden Vorlage stammt.

=== ARTIKEL
titel: Seitenzahlen, Kopf- und Fußzeilen, erste Seite anders in Word
bereich: Excel, Word & PowerPoint
tags: word, seitenzahl, kopfzeile, fußzeile, deckblatt, erste seite anders, abschnittswechsel
zielgruppe: kunde
---
**Symptom:** Seitenzahlen fehlen, erscheinen auf dem Deckblatt oder zählen falsch. Kopf- oder Fußzeile soll auf der ersten Seite fehlen oder in einem Dokumentteil anders aussehen.

**Häufige Ursachen:** Die Option „Erste Seite anders“ ist nicht gesetzt, es gibt einen Abschnittswechsel mit verknüpften oder getrennten Fußzeilen, oder die Nummerierung beginnt mit einer anderen Zahl.

## Lösung
1. Seitenzahl einfügen: **Einfügen → Seitenzahl**, Position (Seitenende, Seitenanfang) und Stil wählen.
2. Kopf- oder Fußzeile bearbeiten: Doppelklick in den oberen oder unteren Seitenrand. Es erscheinen die Kopf- und Fußzeilentools. Mit Doppelklick auf den Textbereich geht es zurück.
3. Deckblatt ohne Seitenzahl: In der Kopf- oder Fußzeile bei **Kopf- und Fußzeilentools** das Häkchen **Erste Seite anders** setzen. Die Fußzeile der ersten Seite bleibt dann leer.
4. Nummerierung bei einer bestimmten Zahl beginnen lassen: **Einfügen → Seitenzahl → Seitenzahlen formatieren**, bei „Beginnen bei“ den Wert eintragen.
5. Verschiedene Teile mit verschiedenen Fußzeilen: Cursor an die Stelle setzen, **Layout → Umbrüche → Abschnittsumbruch (Nächste Seite)**. In der Fußzeile des neuen Abschnitts **Mit vorheriger verknüpfen** abschalten und dann ändern.
6. Anzeige von Formatierungszeichen mit **Strg + Umschalt + *** hilft, Abschnittswechsel zu erkennen.
7. Beim Speichern als PDF prüfen, ob die Zahlen wie gewünscht erscheinen.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, Word-Version, auf welcher Seite das Problem auftritt und ob das Dokument aus mehreren Dateien zusammenkopiert wurde.

=== ARTIKEL
titel: Änderungen nachverfolgen und Kommentare in Word
bereich: Excel, Word & PowerPoint
tags: word, änderungen nachverfolgen, kommentar, überarbeiten, annehmen, ablehnen, korrektur
zielgruppe: kunde
---
**Symptom:** Mehrere Personen bearbeiten ein Dokument und es soll sichtbar sein, wer was geändert hat. Oder ein Dokument zeigt rote Streichungen und Randnotizen, die weg sollen.

**Häufige Ursachen:** Die Nachverfolgung wurde unbemerkt eingeschaltet oder gar nicht aktiviert, Änderungen wurden nie angenommen oder abgelehnt, oder die Ansicht blendet Markierungen aus und das Dokument wirkt unverändert.

## Lösung
1. Nachverfolgung einschalten: **Überprüfen → Änderungen nachverfolgen** (oder **Strg + Umschalt + E**). Ab jetzt werden Einfügungen und Löschungen markiert.
2. Kommentar hinzufügen: Text markieren, **Überprüfen → Neuer Kommentar** und den Hinweis schreiben. Auf einen Kommentar kann mit **Antworten** reagiert werden.
3. Ansicht wählen: Über **Überprüfen → Überarbeitungsmodus** (je nach Version „Anzeige für Überprüfung“) lassen sich **Alle Markups**, **Einfaches Markup**, **Keine Markups** oder **Original** einstellen. Auch bei „Keine Markups“ sind die Änderungen noch im Dokument.
4. Änderungen prüfen: **Überprüfen → Weiter** springt zur nächsten Änderung. **Annehmen** übernimmt sie, **Ablehnen** verwirft sie.
5. Alle Änderungen auf einmal annehmen: Im Menü bei **Annehmen** den Eintrag **Alle Änderungen annehmen** wählen. Das erst tun, wenn alles geprüft ist.
6. Vor Weitergabe an Externe prüfen: **Datei → Informationen → Auf Probleme überprüfen → Dokument prüfen**, damit keine Kommentare oder Änderungsspuren unbeabsichtigt versendet werden.
7. Bei gemeinsamer Arbeit in OneDrive oder SharePoint ist die Funktion im Browser und Desktop ähnlich nutzbar.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, Word-Version, was angezeigt wird und was erwartet war. Bei Streit über eine Änderung die ältere Version über den Versionsverlauf holen.

=== ARTIKEL
titel: Formatierung springt oder Tabelle und Bild verrutschen in Word
bereich: Excel, Word & PowerPoint
tags: word, formatierung, tabelle verrutscht, bild verschiebt text, textumbruch, layout, absatz
zielgruppe: kunde
---
**Symptom:** Nach dem Einfügen von Text springt die Schrift, Abstände ändern sich, eine Tabelle rutscht auf die nächste Seite oder ein Bild verschiebt den Text unkontrolliert.

**Häufige Ursachen:** Text wurde aus einer anderen Quelle mit deren Formatierung eingefügt, Abstände wurden mit Leertaste, Tabulator oder Leerzeilen erzeugt, Seitenumbrüche sind fest gesetzt, oder das Bild ist nicht „mit Text in Zeile“ verankert.

## Lösung
1. Formatierungszeichen anzeigen: **Strg + Umschalt + *** (oder **Start → Absatzmarke**). Leerzeichen, Tabulatoren und Absatzmarken werden sichtbar.
2. Beim Einfügen von fremdem Text das Symbol **Einfügeoptionen** unten am Text nutzen und **Nur den Text übernehmen** wählen. Das geht auch über **Start → Einfügen → Einfügen (Dropdown)**.
3. Überflüssige Leerzeilen löschen und Abstände über **Start → Absatz → Abstand vor/nach** einstellen.
4. Tabelle verrutscht: In die Tabelle klicken, **Tabelleneigenschaften** öffnen (Rechtsklick) und Breite und Textumbruch prüfen. **Layout → Autoanpassen → Fenster automatisch anpassen** hilft bei zu breiten Tabellen.
5. Bild verschiebt Text: Bild anklicken, **Bildformat → Textumbruch**. **Mit Text in Zeile** verhält sich wie ein Zeichen und springt am wenigsten. **Quadrat** oder **Oben und unten** erlauben freie Platzierung.
6. Schwierige Stellen vermeiden, indem nach Möglichkeit mit Formatvorlagen gearbeitet wird.
7. Direkt nach einer unerwünschten Änderung hilft **Strg + Z**.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, Word-Version, Stelle im Dokument und ob das Problem nur auf einem Gerät oder nach dem Öffnen auf anderen PCs auftritt. Datei anhängen.

=== ARTIKEL
titel: PowerPoint – Folienmaster und Firmenvorlage verwenden
bereich: Excel, Word & PowerPoint
tags: powerpoint, folienmaster, vorlage, firmenvorlage, layout, logo, design, schriftart
zielgruppe: kunde
---
**Symptom:** Präsentationen sehen uneinheitlich aus, das Firmenlogo fehlt auf einzelnen Folien oder Schriftarten und Farben weichen von der Firmenvorlage ab.

**Häufige Ursachen:** Folien wurden aus alten Präsentationen kopiert und behalten deren Design, Formatierung wurde auf einzelnen Folien von Hand geändert, oder die Vorlage wurde nicht als Ausgangspunkt benutzt.

## Lösung
1. Neue Präsentation immer aus der Firmenvorlage beginnen: **Datei → Neu**, dann die Vorlage unter **Benutzerdefiniert** oder **Persönlich** wählen (die Bezeichnung hängt von Version und Einrichtung ab). Alternativ die Vorlagendatei öffnen und sofort unter neuem Namen speichern.
2. Folien-Layout wählen: **Start → Layout**. Dort stehen Titelfolie, Titel und Inhalt, zwei Inhalte und weitere Layouts. Platzhalter nutzen, statt eigene Textfelder zu zeichnen.
3. Folien aus einer anderen Präsentation einfügen: In der Folienleiste mit Rechtsklick **Einfügen** und **Design der Zielfolien verwenden** wählen.
4. Einzelne Folie zurücksetzen: **Start → Zurücksetzen** stellt Position und Formatierung wie im Layout wieder her.
5. Den **Folienmaster** nur ändern, wenn für alle Folien etwas gelten soll: **Ansicht → Folienmaster**. Änderungen am obersten Master (Logo, Schriftarten, Farben) gelten für alle Layouts. Schließen mit **Masteransicht schließen**.
6. Firmenfarben und Schriftarten liegen unter **Entwurf → Varianten**. Im Zweifel nur bestehende Einträge verwenden.
7. Die Vorlage selbst nicht überschreiben.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, PowerPoint-Version, welches Element abweicht (Logo, Schrift, Farben) und wo die Vorlage liegt. Bei fehlender Firmenvorlage Ansprechpartner im Betrieb nennen.

=== ARTIKEL
titel: PowerPoint – Referentenansicht und Präsentation am Beamer
bereich: Excel, Word & PowerPoint
tags: powerpoint, referentenansicht, beamer, präsentation, zwei bildschirme, notizen, folien starten
zielgruppe: kunde
---
**Symptom:** Beim Präsentieren zeigt der Beamer die Notizen statt der Folie, die Folien erscheinen nur auf dem Laptop, oder die Referentenansicht lässt sich nicht aktivieren.

**Häufige Ursachen:** Die Bildschirmanzeige steht auf Duplizieren statt Erweitern, die Referentenansicht ist nicht eingeschaltet, oder der Beamer wird als falscher Monitor verwendet.

## Lösung
1. Vor dem Termin Beamer anschließen. **Windows-Taste + P** drücken und **Erweitern** wählen, wenn Referentenansicht gewünscht ist. **Duplizieren** zeigt auf beiden Bildschirmen dasselbe.
2. In PowerPoint **Bildschirmpräsentation** öffnen. Dort **Referentenansicht verwenden** aktivieren und bei „Bildschirmpräsentation anzeigen auf“ den Beamer auswählen.
3. Präsentation starten: **F5** beginnt bei der ersten Folie, **Umschalt + F5** bei der aktuellen Folie.
4. In der Referentenansicht sind aktuelle Folie, nächste Folie, Notizen und Zeit sichtbar, das Publikum sieht nur die Folie.
5. Zeigen Beamer und Laptop die falschen Inhalte, mit **Windows-Taste + P** zwischen den Modi wechseln oder in der Referentenansicht oben auf **Anzeigeeinstellungen → Referenten- und Bildschirmpräsentationsansicht tauschen** gehen.
6. Zum Beenden **Esc** drücken. Mit **B** wird der Bildschirm schwarz, mit **W** weiß, zur Fortsetzung dieselbe Taste noch einmal.
7. Videos, Ton und Verlinkungen vorher einmal komplett durchspielen. Im Notfall die Präsentation zusätzlich als PDF auf einem USB-Stick mitnehmen.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Laptop-Modell, Beamer oder Monitor, Art des Kabels (HDMI, USB-C), was auf beiden Bildschirmen zu sehen ist. Siehe auch den Artikel zum Laptop am Beamer.

=== ARTIKEL
titel: PowerPoint-Datei ist zu groß – Bilder komprimieren
bereich: Excel, Word & PowerPoint
tags: powerpoint, datei zu groß, bilder komprimieren, mail zu groß, verkleinern, pptx, mb
zielgruppe: kunde
---
**Symptom:** Eine Präsentation ist zu groß für den E-Mail-Versand, öffnet und speichert sich langsam oder belegt viel Platz im Postfach oder in OneDrive.

**Häufige Ursachen:** Fotos in voller Kameraauflösung, viele eingebettete Videos, ausgeschnittene Bildbereiche, die weiter gespeichert werden, oder viele Folien mit Hintergrundbildern und Animationen.

## Lösung
1. Zuerst eine Kopie speichern (**Datei → Speichern unter**), denn die Komprimierung kann Bildqualität verringern.
2. Ein Bild anklicken, **Bildformat → Bilder komprimieren**.
3. Im Fenster das Häkchen bei **Nur auf dieses Bild anwenden** entfernen, damit alle Bilder bearbeitet werden. Das Häkchen bei **Zugeschnittene Bildbereiche löschen** setzen.
4. Auflösung wählen. Für Bildschirm und E-Mail reicht in der Regel eine mittlere Auflösung (zum Beispiel 150 ppi), für Druck eine höhere. Die Namen der Stufen unterscheiden sich je nach Version.
5. Mit **OK** bestätigen und speichern. Dateigröße im Explorer vergleichen.
6. Videos komprimieren: **Datei → Informationen → Medien komprimieren**, falls die Option erscheint. Dabei sinkt auch die Qualität.
7. Als Alternative große Bilder vorab in einem Bildprogramm verkleinern oder große Videos nicht einbetten.
8. Ist die Datei trotzdem zu groß für den Versand, statt Anhang einen Freigabelink aus OneDrive oder SharePoint senden.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, Größe in MB, Anzahl Folien, ob Videos enthalten sind und wie die Datei verschickt werden soll.

=== ARTIKEL
titel: Video oder Ton in PowerPoint wird nicht abgespielt
bereich: Excel, Word & PowerPoint
tags: powerpoint, video, ton, audio, abspielen, mp4, medien, kein ton
zielgruppe: kunde
---
**Symptom:** Ein Video bleibt schwarz oder zeigt ein Fragezeichen, Ton ist stumm, oder das Video lief am eigenen PC und fehlt am Beamer oder auf einem anderen Rechner.

**Häufige Ursachen:** Das Video ist nur verknüpft und die Datei fehlt am neuen Ort, das Format wird nicht unterstützt, die Wiedergabe ist nicht auf Start eingestellt, oder der falsche Lautsprecher ist in Windows gewählt.

## Lösung
1. Prüfen, ob das Medium **eingebettet** oder **verknüpft** ist. Verknüpfte Dateien müssen zusammen mit der Präsentation im selben Ordner liegen. Besser einbetten: **Einfügen → Video → Video auf meinem Gerät**, dann **Einfügen** wählen (nicht „Verknüpfen“).
2. Bei Verknüpfungen: Präsentation und Medien gemeinsam in einen Ordner legen und von dort neu verknüpfen. Beim Weitergeben den ganzen Ordner mitgeben.
3. Format prüfen: Am zuverlässigsten funktionieren MP4-Videos und MP3- oder M4A-Ton. Bei seltenen Formaten das Medium vorher konvertieren lassen.
4. **Datei → Informationen**: Wird dort **Kompatibilität optimieren** angeboten, diese ausführen.
5. Wiedergabeeinstellungen: Video anklicken, **Wiedergabe**, bei **Start** die Einstellung **Automatisch** oder **Beim Klicken** wählen. Lautstärke im selben Bereich prüfen.
6. Ton in Windows prüfen: Lautstärke-Symbol in der Taskleiste, richtigen Ausgang wählen, besonders beim Wechsel zu HDMI oder Beamer.
7. Vorab die Präsentation im Referentenmodus am Zielgerät testen.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, Videoformat (Dateiendung), ob eingebettet oder verknüpft, auf welchem Gerät es nicht funktioniert und welche Meldung erscheint.

=== ARTIKEL
titel: Dokument mit Kennwort schützen – und was bei vergessenem Kennwort gilt
bereich: Excel, Word & PowerPoint
tags: kennwort, passwort, verschlüsseln, word, excel, powerpoint, vergessen, dokument schützen
zielgruppe: kunde
---
**Symptom:** Ein Dokument mit sensiblen Inhalten soll nur mit Kennwort geöffnet werden können. Oder ein Kennwort wurde vergessen und die Datei lässt sich nicht mehr öffnen.

**Häufige Ursachen:** Das Kennwort wurde nirgends notiert, mit Blattschutz oder Schreibschutz verwechselt, oder die Datei wird per Mail weitergegeben, ohne dass das Kennwort sicher mitgeteilt wird.

## Lösung
1. Zum Verschlüsseln: **Datei → Informationen → Dokument schützen** (in Excel „Arbeitsmappe schützen“, in PowerPoint „Präsentation schützen“) **→ Mit Kennwort verschlüsseln**.
2. Kennwort eingeben und bestätigen, anschließend die Datei speichern. Ab dem nächsten Öffnen wird das Kennwort verlangt.
3. Kennwort **sicher aufbewahren**, etwa im Passwort-Manager des Betriebs. Es sollte lang und nicht erratbar sein.
4. Kennwort nicht in derselben Mail wie die Datei senden. Besser getrennt mitteilen, etwa telefonisch.
5. Kennwort entfernen: Datei öffnen, wieder **Mit Kennwort verschlüsseln**, Feld leeren, **OK**, speichern.
6. Wichtig: Bei vergessenem Kennwort **kann Microsoft die Datei nicht entsperren**, und es gibt keine einfache Wiederherstellung. Hilfreich ist dann eine ältere unverschlüsselte Version (OneDrive-Versionsverlauf, Datensicherung, frühere Mailanhänge).
7. Von Kennwort-Knack-Programmen ist abzuraten. Sie sind unzuverlässig und oft schädlich.
8. Bei Datenschutzfragen (welche Dokumente zu verschlüsseln sind) mit der Datenschutzverantwortlichen oder dem Datenschutzbeauftragten abstimmen.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Dateiname, Speicherort und Datum der letzten Bearbeitung, damit die Technik nach einer Sicherung oder früheren Version suchen kann. Kennwort nie ins Ticket schreiben.

=== ARTIKEL
titel: Rechtschreibprüfung prüft in der falschen Sprache
bereich: Excel, Word & PowerPoint
tags: rechtschreibung, sprache, word, englisch, rote wellenlinie, korrekturhilfe, deutsch österreich
zielgruppe: kunde
---
**Symptom:** Deutsche Wörter werden rot unterringelt, englische Texte werden nach deutschen Regeln geprüft, oder die Prüfung scheint ganz zu fehlen.

**Häufige Ursachen:** Die Korrekturhilfesprache des Textes steht auf Englisch oder einer anderen Sprache, die Option „Rechtschreibung nicht prüfen“ ist gesetzt, oder Text wurde aus einer anderen Quelle mit anderer Sprache eingefügt.

## Lösung
1. Den betroffenen Text markieren, bei vollständigem Dokument **Strg + A**.
2. **Überprüfen → Sprache → Korrekturhilfesprache festlegen** (je nach Version unter „Sprache“ zu finden). Im Fenster die gewünschte Sprache wählen, zum Beispiel **Deutsch (Österreich)**.
3. Darauf achten, dass das Häkchen **Rechtschreibung und Grammatik nicht überprüfen** **nicht** gesetzt ist.
4. Soll die Sprache dauerhaft gelten, im Fenster **Als Standard festlegen** wählen. Die Rückfrage mit **Ja** bestätigen.
5. Die aktuelle Sprache steht in Word unten in der Statusleiste und lässt sich dort anklicken.
6. Prüfung beim Einfügen von fremdem Text: **Nur den Text übernehmen** wählen, dann übernimmt Word die Sprache des Dokuments eher.
7. In Outlook gilt die Einstellung unter **Datei → Optionen → E-Mail → Rechtschreibung und Autokorrektur** und zusätzlich je Nachricht über **Überprüfen → Sprache**.
8. Fehlt die gewünschte Sprache ganz, wird sie von der IT nachinstalliert. Das geht nicht ohne Administratorrechte.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Programm (Word, Outlook, PowerPoint), Version, welche Sprache fehlt oder falsch ist und ob nur ein bestimmtes Dokument betroffen ist.

=== ARTIKEL
titel: Autokorrektur und automatische Formatierung in Word abschalten
bereich: Excel, Word & PowerPoint
tags: autokorrektur, word, automatisch formatieren, aufzählung, großschreibung, bindestrich, störend
zielgruppe: kunde
---
**Symptom:** Word oder Excel ändert beim Tippen Wörter, setzt automatisch Aufzählungen, macht Großbuchstaben, ersetzt Zeichen durch Symbole oder wandelt Eingaben in Links oder Datumswerte um.

**Häufige Ursachen:** Die Autokorrektur und die Autoformatierung sind eingeschaltet, was meist hilfreich ist, aber bei Abkürzungen, Codes und Artikelnummern stört.

## Lösung
1. Direkt nach einer unerwünschten Korrektur **Strg + Z** drücken. Die automatische Änderung wird damit zurückgenommen, der getippte Text bleibt.
2. Word: **Datei → Optionen → Dokumentprüfung → Autokorrektur-Optionen**.
3. Im Register **AutoKorrektur** die Liste „Während der Eingabe ersetzen“ ansehen. Störende Einträge markieren und **Löschen** wählen, oder das Häkchen **Während der Eingabe ersetzen** entfernen.
4. Register **AutoFormat während der Eingabe**: Dort lassen sich automatische Aufzählungen, Nummerierungen, Rahmenlinien und Internetpfade durch Links abschalten.
5. Register **Autokorrektur** (oben links im Fenster): Bei Bedarf die Optionen für Großschreibung am Satzanfang abschalten.
6. Excel hat unter **Datei → Optionen → Dokumentprüfung → Autokorrektur-Optionen** ähnliche Einstellungen. Zahlen mit führender Null (Postleitzahl, Artikelnummer) bleiben erhalten, wenn die Zelle vorher als **Text** formatiert wird.
7. Änderungen betreffen das Programm und alle Dokumente auf diesem PC.
8. Nur Einstellungen ändern, die klar erkennbar sind. Im Zweifel nichts abschalten und stattdessen **Strg + Z** nutzen.

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: Programm und Version, ein Beispiel (was getippt wurde und was daraus wird) und ob es nur in einer Datei passiert.

=== ARTIKEL
titel: Office-Vorlagen zentral für alle Mitarbeiter bereitstellen
bereich: Excel, Word & PowerPoint
tags: vorlagen, arbeitsgruppenvorlagen, dotx, potx, xltx, organisationsbibliothek, firmenvorlage, sharepoint
zielgruppe: technik
---
**Symptom:** Briefpapier, Angebots- und Präsentationsvorlagen sollen für alle Mitarbeiter einheitlich bereitstehen und nicht lokal verteilt oder von alten Dateien kopiert werden.

**Häufige Ursachen:** Vorlagen liegen auf Desktops oder in Mails, der Pfad zu einer Netzfreigabe ist nicht gesetzt, Vorlagen ändern sich lokal ohne Rückspiegelung, oder der Speicherort ist für manche Benutzer nicht erreichbar.

## Lösung
1. Vorlagen als Vorlagendateien speichern: `.dotx` (Word), `.xltx` (Excel), `.potx` (PowerPoint). Makros brauchen `.dotm`, `.xltm` oder `.potm`. Lesezugriff für alle, Schreibrechte nur für zuständige Personen.
2. **Variante Microsoft 365:** Je nach Lizenz und Tenant lässt sich im Microsoft 365 Admin Center eine Organisationsbibliothek (SharePoint-Bibliothek für Vorlagen) hinterlegen, die in Word und PowerPoint unter **Datei → Neu** erscheint. Verfügbarkeit und Bezeichnung je nach Version und Tenant prüfen.
3. **Variante Netzfreigabe:** Ordner auf dem Server freigeben, Pfad per UNC (`\\server\vorlagen`) angeben. In Word den Ort unter **Datei → Optionen → Erweitert → Dateispeicherorte → Arbeitsgruppenvorlagen** eintragen.
4. Diesen Pfad per Richtlinie oder Anmeldeskript zentral setzen, statt von Hand. Der zugehörige Eintrag liegt je nach Office-Version unter den Registry-Pfaden von Office (Common\General). **Achtung:** Registrywerte vor der Änderung sichern.
5. Excel verwendet für automatisch geladene Vorlagen den Ordner **XLStart** oder den unter **Datei → Optionen → Erweitert → Allgemein** gesetzten **Alternativen Startordner**.
6. Mit einem Testbenutzer prüfen: **Datei → Neu**, Vorlage auswählen, speichern, schließen.
7. Änderungen an Vorlagen versionieren und kurz dokumentieren.

## Hintergrund
Vorlagenpfade gelten pro Benutzer. Ist der Server nicht erreichbar (VPN), fehlen die Vorlagen.

## Wenn das nicht hilft
- Berechtigungen auf Freigabe und SharePoint prüfen, Pfad und Office-Version im Ticket festhalten.

=== ARTIKEL
titel: Vertrauenswürdige Speicherorte und Makro-Einstellungen per Richtlinie
bereich: Excel, Word & PowerPoint
tags: vertrauenswürdige speicherorte, makros, richtlinie, gpo, trust center, vba, excel, sicherheit
zielgruppe: technik
---
**Symptom:** Excel- oder Word-Dateien mit Makros (zum Beispiel Branchenlösungen oder Auswertungen) werden blockiert oder fragen ständig nach. Der Wunsch ist, Makros sicher nur aus bestimmten Ordnern zuzulassen.

**Häufige Ursachen:** Dateien liegen auf Netzlaufwerk, in der Cloud oder wurden aus dem Internet geladen und sind daher markiert („Mark of the Web“). Netzpfade sind nicht als vertrauenswürdig definiert oder Makros sind per Richtlinie komplett gesperrt.

## Lösung
1. Bedarf klären: Welche Dateien benötigen Makros und wer ist Absender? Nur geprüfte Dateien freigeben.
2. Lokal testen: **Datei → Optionen → Trust Center → Einstellungen für das Trust Center → Vertrauenswürdige Speicherorte**. Ordner hinzufügen. Netzpfade benötigen dort das Häkchen **Vertrauenswürdige Speicherorte auf meinem Netzwerk zulassen**.
3. Zentral per Gruppenrichtlinie oder Intune: Die administrativen Vorlagen für Office verwenden, im Benutzerzweig unter dem jeweiligen Programm (zum Beispiel Excel, Word) → Optionen → Sicherheit → Trust Center → **Vertrauenswürdige Speicherorte**. Dort Pfad und Option für Netzwerkpfade festlegen. Die exakten Namen unterscheiden sich je nach Version der ADMX-Dateien.
4. Makroeinstellungen im selben Bereich: **VBA-Makrobenachrichtigung**. Empfehlung: **alle Makros mit Benachrichtigung** oder **nur digital signierte Makros**. Makros aktivieren ohne Rückfrage vermeiden.
5. Einstellung **Makros in Office-Dateien aus dem Internet blockieren** nicht abschalten. Stattdessen Dateien nach Prüfung in einen vertrauenswürdigen Ordner legen.
6. Speicherort mit möglichst engem Pfad definieren, nie ganze Laufwerke oder den Download-Ordner.
7. Änderung mit `gpupdate /force` ausrollen und am Testbenutzer prüfen.

## Hintergrund
Vertrauenswürdige Ordner umgehen die Schutzmechanismen. Zugriff auf den Ordner entspricht daher einer Sicherheitsentscheidung.

## Für das Ticket notieren
- Pfad, Dateiname, Office-Version, Zweck des Makros, Freigabe durch Verantwortlichen.

=== ARTIKEL
titel: Excel oder Word stürzt ab – Add-Ins systematisch ausschließen
bereich: Excel, Word & PowerPoint
tags: absturz, add-in, excel, word, abgesicherter modus, com-add-ins, ereignisanzeige, hängt
zielgruppe: technik
---
**Symptom:** Excel oder Word stürzt beim Start, beim Öffnen bestimmter Dateien oder beim Drucken ab oder friert ein. Standardschritte des Kunden (neu starten, abgesicherter Modus) sind schon gemacht.

**Häufige Ursachen:** Fehlerhafte oder veraltete COM-Add-Ins (PDF-Erzeuger, Branchensoftware, Scanner-Tools), beschädigte Dateien, Druckertreiber oder Grafikbeschleunigung.

## Lösung
1. Testen im abgesicherten Modus: **Windows-Taste + R**, `excel /safe` oder `winword /safe`. Läuft das Programm so stabil, ist ein Add-In oder eine Einstellung die Ursache.
2. Add-Ins ansehen: **Datei → Optionen → Add-Ins**, unten bei **Verwalten** den Eintrag **COM-Add-Ins** wählen, **Los**. Alle Haken entfernen, Programm neu starten.
3. Haken einzeln wieder setzen und jeweils neu starten, bis der Absturz wiederkehrt. Dasselbe für **Excel-Add-Ins** und Word-Vorlagen im Startordner (`Normal.dotm`).
4. Ursache belegen: **Ereignisanzeige → Windows-Protokolle → Anwendung**, Quelle **Application Error** oder **Application Hang**. Der Name des fehlerhaften Moduls verweist oft auf das Add-In oder den Treiber.
5. Weitere Tests: **Datei → Optionen → Erweitert → Anzeige → Hardwaregrafikbeschleunigung deaktivieren**, anderen Standarddrucker testen, Office reparieren (siehe Artikel zur Office-Reparatur).
6. **Achtung:** `Normal.dotm` nur umbenennen, nicht löschen. Dabei gehen eigene Formatvorlagen, AutoText und Makros der Vorlage verloren, deshalb vorher kopieren.
7. Problematisches Add-In aktualisieren oder beim Hersteller melden.

## Hintergrund
Im abgesicherten Modus werden Add-Ins und eigene Einstellungen nicht geladen.

## Für das Ticket notieren
- Office-Version und Build, fehlerhaftes Modul laut Ereignisanzeige, Add-In-Name, Tests mit Ergebnis.

=== ARTIKEL
titel: Beschädigte Excel- oder Word-Datei retten
bereich: Excel, Word & PowerPoint
tags: datei beschädigt, korrupt, excel, word, öffnen und reparieren, wiederherstellen, frühere version
zielgruppe: technik
---
**Symptom:** Excel oder Word meldet, die Datei sei beschädigt oder das Format passe nicht zur Dateiendung. Die Datei lässt sich nicht öffnen oder zeigt Datenreste.

**Häufige Ursachen:** Absturz oder Stromausfall beim Speichern, unterbrochene Synchronisierung, Speichern auf instabilem Netzlaufwerk oder USB-Stick, Virenscanner-Eingriffe, sehr große Dateien.

## Lösung
1. **Originaldatei nicht überschreiben.** Zuerst eine Kopie der beschädigten Datei an anderem Ort anlegen und nur mit der Kopie arbeiten.
2. Frühere Versionen prüfen: OneDrive und SharePoint (**Versionsverlauf**), Windows (Rechtsklick → **Eigenschaften → Vorgängerversionen**, falls Schattenkopien aktiv sind) und die Datensicherung des Kunden.
3. **Öffnen und Reparieren:** Excel oder Word starten, **Datei → Öffnen → Durchsuchen**, Datei markieren, neben **Öffnen** auf den Pfeil klicken, **Öffnen und reparieren** wählen. In Excel zunächst **Reparieren**, bei Misserfolg **Daten extrahieren**.
4. In Word zusätzlich im Dateityp-Auswahlfeld **Text aus einer beliebigen Datei wiederherstellen** wählen. Das liefert Text, aber ohne Layout.
5. Autowiederherstellung und nicht gespeicherte Dateien prüfen: **Datei → Informationen → Dokument verwalten → Nicht gespeicherte Dokumente wiederherstellen** (Bezeichnung je nach Version).
6. Eine Excel-Datei im Format `.xlsx` lässt sich notfalls öffnen, indem eine Kopie in `.zip` umbenannt wird. Daten finden sich dann in den XML-Dateien. Das ist die letzte Möglichkeit und aufwendig.
7. Gerettete Datei unter neuem Namen speichern und mit dem Kunden Inhalte prüfen.
8. **Achtung:** Dateisystem- oder Laufwerksfehler als Ursache ausschließen (Speicherplatz, Datenträgerprüfung am NAS).

## Für das Ticket notieren
- Dateiname, Größe, Speicherort, letzte bekannte gute Version, durchgeführte Schritte.

=== ARTIKEL
titel: Verknüpfungen zu externen Arbeitsmappen finden, aktualisieren, lösen
bereich: Excel, Word & PowerPoint
tags: excel, verknüpfungen, externe links, arbeitsmappe, verknüpfungen bearbeiten, quelle nicht gefunden, aktualisieren
zielgruppe: technik
---
**Symptom:** Beim Öffnen einer Excel-Datei erscheint „Diese Arbeitsmappe enthält Verknüpfungen zu externen Quellen“ oder eine Aktualisierungsabfrage, zum Teil mit Verweis auf einen nicht mehr vorhandenen Pfad oder alten Server.

**Häufige Ursachen:** Die Datei wurde aus einer anderen Datei kopiert, Quelldateien wurden verschoben oder umbenannt (Servertausch, OneDrive-Migration), oder Verknüpfungen stecken in Namen, Diagrammen oder bedingter Formatierung.

## Lösung
1. **Achtung:** Vor Änderungen eine Kopie der Arbeitsmappe sichern. Das Lösen von Verknüpfungen wandelt Formeln in Werte um und ist nicht rückgängig zu machen.
2. **Daten → Abfragen und Verbindungen** (je nach Version **Daten → Verknüpfungen bearbeiten**) öffnen. Die Liste zeigt Quelle, Typ und Status.
3. Quelle erreichbar: **Werte aktualisieren**. Bei verschobener Quelle **Quelle ändern** und die neue Datei auswählen.
4. Formeln mit externen Bezügen finden: **Strg + F**, Suchen nach `[` (eckige Klammer), **Suchen in: Formeln**. Auch auf `.xls` und Laufwerkspfade suchen.
5. Nicht auffindbare Quellen: **Formeln → Namens-Manager** prüfen, ebenso Diagramme, Datenüberprüfung und bedingte Formatierung auf fremde Bezüge.
6. Wird keine Verbindung mehr benötigt: In **Verknüpfungen bearbeiten** den Eintrag wählen, **Verknüpfung lösen**. Die Zahlen bleiben als Werte erhalten.
7. Abfrage beim Öffnen steuern: **Daten → Verknüpfungen bearbeiten → Eingabeaufforderung beim Start** (Bezeichnung je nach Version).
8. Gelöste Datei mit dem Kunden gegenprüfen.

## Hintergrund
Verknüpfte Dateien sollten nicht von mehreren Benutzern parallel verschoben werden. Besser Daten zentral in einer Datei halten.

## Für das Ticket notieren
- Dateiname, Quelle laut Liste, Status, Entscheidung (aktualisiert, neu verknüpft, gelöst).

=== ARTIKEL
titel: Standard-Speicherort und Standard-Dateiformat für Office festlegen
bereich: Excel, Word & PowerPoint
tags: standard speicherort, dateiformat, speichern, office, onedrive, docx, optionen, richtlinie
zielgruppe: technik
---
**Symptom:** Office speichert neue Dateien standardmäßig in OneDrive oder auf dem falschen Laufwerk, oder in einem alten Format. Mitarbeiter sollen beim Speichern gleich den richtigen Ort und das passende Format vorfinden.

**Häufige Ursachen:** Voreinstellung „Standardmäßig auf Computer speichern“ ist nicht gesetzt, der lokale Pfad zeigt auf ein altes Profil, Benutzer wählen manuell das alte Format `.doc` oder `.xls`.

## Lösung
1. An einem Testbenutzer prüfen: **Datei → Optionen → Speichern**.
2. **Dateien in diesem Format speichern** wählen: Word-Dokument (`.docx`), Excel-Arbeitsmappe (`.xlsx`) oder PowerPoint-Präsentation (`.pptx`).
3. **Standardmäßig auf Computer speichern** aktivieren, wenn nicht der Cloud-Dialog erscheinen soll. Den **Standardspeicherort für lokale Dateien** auf den Ordner **Dokumente**, einen Serverpfad oder die OneDrive-Ordner setzen.
4. Word zusätzlich: **Datei → Optionen → Erweitert → Dateispeicherorte** für Dokumente und Vorlagen.
5. Für alle Benutzer zentral: Die administrativen Vorlagen für Office verwenden, unter **Optionen → Speichern** je Programm das Standardformat und den Standardpfad festlegen. Bezeichnungen unterscheiden sich je nach Version der ADMX-Dateien.
6. **Achtung:** Pfad nur auf Ordner zeigen lassen, die für alle Benutzer vorhanden und beschreibbar sind. Bei Serverpfaden die Erreichbarkeit im Homeoffice (VPN) bedenken.
7. Nach der Ausrollung mit `gpupdate /force` und einem Testbenutzer prüfen. Ordner über Windows-Umleitung oder OneDrive-Known-Folder-Verschiebung ergänzend beachten.
8. Kunden über die Änderung informieren, damit nach dem Speichern keine Dateien „verschwinden“.

## Hintergrund
Das Format `.docx` ist heute der Standard. Für ältere Partner kann gezielt `.doc` oder PDF gespeichert werden.

## Für das Ticket notieren
- Betroffene Programme, gewünschter Pfad, Format, Richtlinie oder Einzelplatz.

