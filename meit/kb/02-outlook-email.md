=== ARTIKEL
titel: Outlook startet nicht oder bleibt bei „Profil wird geladen“ hängen
bereich: Outlook & E-Mail
tags: outlook, start, startet nicht, profil, hängt, abgesicherter modus, öffnet sich nicht
zielgruppe: kunde
---
**Symptom:** Outlook öffnet sich nicht, bleibt beim Startbild stehen oder meldet, dass das Profil nicht geladen werden kann.

**Häufige Ursachen:** ein hängender Outlook-Prozess, ein fehlerhaftes Add-In, ein beschädigtes Profil oder eine unterbrochene Internetverbindung.

## Lösung
1. Outlook ganz schließen. Im Task-Manager (**Strg + Umschalt + Esc**) prüfen, ob `OUTLOOK.EXE` noch unter „Prozesse“ läuft. Falls ja, den Eintrag markieren und **Task beenden** wählen.
2. Prüfen, ob die Internetverbindung steht (zum Beispiel eine Webseite öffnen).
3. **Windows-Taste + R** drücken, `outlook.exe /safe` eingeben und mit Enter bestätigen. Bei Rückfrage das Profil auswählen.
4. Startet Outlook so, liegt die Ursache sehr wahrscheinlich an einem Add-In. Outlook wieder schließen und normal starten. Tritt das Problem weiter auf, ist das ein Fall für die IT.
5. Den PC einmal neu starten und Outlook erneut öffnen.
6. Zwischendurch lässt sich die Post im Browser lesen (siehe Artikel „Outlook im Web nutzen, wenn Outlook streikt“).

## Wenn das nicht hilft
Ticket anlegen und dazuschreiben:
- die genaue Fehlermeldung (am besten als Foto oder Bildschirmfoto)
- ob der abgesicherte Modus (Schritt 3) funktioniert hat
- seit wann das Problem besteht und was sich davor geändert hat (Update, neuer PC, Kennwortwechsel)
- ob es auch bei anderen Kollegen auftritt

=== ARTIKEL
titel: Outlook sendet oder empfängt keine E-Mails
bereich: Outlook & E-Mail
tags: outlook, senden, empfangen, postausgang, geht nicht, offline, getrennt, keine mails
zielgruppe: kunde
---
**Symptom:** Mails bleiben im Postausgang liegen, neue Mails kommen nicht an oder in der Statusleiste steht „Getrennt“, „Verbindung wird hergestellt“ oder „Offline arbeiten“.

**Häufige Ursachen:** Outlook steht auf „Offline arbeiten“, die Internetverbindung ist gestört, ein Anhang ist zu groß oder die Empfängeradresse ist fehlerhaft.

## Lösung
1. Statusleiste am unteren Fensterrand ansehen. Steht dort „Offline arbeiten“, in der Registerkarte **Senden/Empfangen** auf **Offline arbeiten** klicken, damit die Schaltfläche nicht mehr hervorgehoben ist.
2. Im Browser eine beliebige Webseite öffnen, um die Internetverbindung zu prüfen.
3. **F9** drücken, um Senden und Empfangen anzustoßen.
4. Ordner **Postausgang** öffnen. Eine festhängende Mail doppelt anklicken und prüfen: Ist die Adresse richtig geschrieben? Ist der Anhang sehr groß? Die Mail gegebenenfalls ohne Anhang oder mit korrigierter Adresse erneut senden.
5. Ist die Mail im Postausgang kursiv oder mit Fehlermeldung markiert, den Text der Meldung notieren.
6. Outlook schließen und neu starten.
7. Zur Kontrolle im Browser anmelden (siehe Artikel „Outlook im Web nutzen, wenn Outlook streikt“). Funktioniert das Web, liegt das Problem lokal am PC. Funktioniert es dort auch nicht, liegt es am Konto oder am Postfach.

## Wenn das nicht hilft
Ticket anlegen mit: Wortlaut der Statusleiste, Fehlermeldung im Postausgang, betroffene Empfänger (nur einer oder alle), Uhrzeit der letzten funktionierenden Mail und Ergebnis des Web-Tests.

=== ARTIKEL
titel: Postfach voll – Speicherplatz im Outlook-Postfach schaffen
bereich: Outlook & E-Mail
tags: postfach voll, speicher, kontingent, platz, aufräumen, outlook, mailbox voll
zielgruppe: kunde
---
**Symptom:** Outlook warnt, dass das Postfach fast voll oder voll ist. Es lassen sich keine Mails mehr senden, später auch nicht mehr empfangen.

**Häufige Ursachen:** viele große Anhänge, ein nie geleerter Ordner „Gelöschte Elemente“ oder „Gesendete Elemente“ mit vielen alten Mails.

## Lösung
1. Größe prüfen: **Datei → Info**. Bei vielen Versionen steht dort ein Balken mit der Postfachgröße, ebenso die Schaltfläche **Postfachbereinigung** (je nach Version leicht abweichend).
2. Große Mails finden: einen Ordner öffnen, in der Registerkarte **Ansicht** bei der Anordnung **Größe** wählen. Die größten Mails stehen dann oben.
3. Mails mit großen Anhängen nur löschen, wenn sie nicht mehr gebraucht werden. Anhänge, die weiter nötig sind, vorher auf dem Laufwerk der Firma speichern.
4. Ordner **Gelöschte Elemente** mit Rechtsklick → **Ordner leeren** leeren. Dasselbe gilt für **Junk-E-Mail**.
5. Danach Outlook kurz schließen und neu öffnen und die Größe erneut prüfen.

Wichtig: Gelöschte Mails können nach dem Leeren nur noch eingeschränkt zurückgeholt werden (siehe Artikel „Gelöschte Elemente wiederherstellen“). Im Zweifel vorher nachfragen.

## Wenn das nicht hilft
Ticket anlegen mit: Wortlaut der Warnung, angezeigte Postfachgröße, wie viele Mails sich noch senden lassen. Die IT kann prüfen, ob ein Archivpostfach oder mehr Speicher möglich ist.

=== ARTIKEL
titel: Outlook-Suche findet keine oder nur wenige Mails
bereich: Outlook & E-Mail
tags: suche, findet nichts, suchen, suchergebnisse, index, outlook, mail nicht gefunden
zielgruppe: kunde
---
**Symptom:** Die Suche in Outlook zeigt keine Treffer, obwohl die Mail sicher vorhanden ist, oder liefert nur neuere Mails.

**Häufige Ursachen:** falscher Suchbereich, Windows-Suchindex noch nicht fertig, oder ältere Mails liegen nicht auf dem PC, sondern nur auf dem Server.

## Lösung
1. Den Suchbereich prüfen. Neben dem Suchfeld oder in der Registerkarte **Suche** kann zwischen aktuellem Ordner, Unterordnern, aktuellem Postfach und allen Postfächern gewählt werden. **Aktuelles Postfach** oder **Alle Postfächer** verwenden.
2. Weniger Suchwörter eingeben, zum Beispiel nur den Nachnamen des Absenders.
3. Am Ende der Ergebnisliste nach einem Hinweis suchen, die Suche auf dem Server fortzusetzen. Der Wortlaut hängt von der Version ab. Ein Klick darauf durchsucht auch Mails, die nicht auf dem PC liegen.
4. Nach einem Neustart oder einem Windows-Update kann der Index neu aufgebaut werden. Das dauert je nach Postfachgröße einige Stunden. Währenddessen sind die Ergebnisse unvollständig. Den Fortschritt zeigt im klassischen Outlook **Suche → Suchtools → Indizierungsstatus**.
5. Zum Gegentest im Browser nach der Mail suchen (siehe Artikel „Outlook im Web nutzen, wenn Outlook streikt“). Dort wird immer direkt auf dem Server gesucht.

## Wenn das nicht hilft
Ticket anlegen mit: Suchbegriff, gewünschtem Absender oder Datum, Ergebnis der Suche im Browser und Angabe, ob Outlook neu oder klassisch ist.

=== ARTIKEL
titel: E-Mail-Signatur in Outlook einrichten oder ändern
bereich: Outlook & E-Mail
tags: signatur, outlook, unterschrift, grußformel, standardsignatur, neue mail
zielgruppe: kunde
---
**Symptom:** Neue Mails haben keine Signatur, die Signatur ist veraltet oder wird bei Antworten nicht angefügt.

**Häufige Ursachen:** Es wurde noch keine Signatur angelegt oder sie ist nicht als Standard für neue Nachrichten beziehungsweise Antworten ausgewählt.

## Lösung im klassischen Outlook
1. **Datei → Optionen → E-Mail → Signaturen…** wählen.
2. **Neu** anklicken und einen Namen vergeben, zum Beispiel „Firma“.
3. Im unteren Feld den Text eingeben: Name, Funktion, Firma, Telefon, Adresse.
4. Rechts oben unter **Standardsignatur auswählen** das richtige Konto wählen und festlegen, ob die Signatur für **Neue Nachrichten** und für **Antworten/Weiterleitungen** gelten soll.
5. Mit **OK** bestätigen. Eine neue Mail öffnen und prüfen.

## Lösung im neuen Outlook und im Web
Zahnrad-Symbol (**Einstellungen**) → **Konto** → **Signaturen** (je nach Version kann der Pfad leicht abweichen). Dort Signatur anlegen und die Standardzuordnung für neue Mails und Antworten setzen.

## Hinweise
- Die Signatur der Firma sollte einheitlich sein. Vorgaben dazu kommen von der Geschäftsleitung.
- Bilder und Logos wirken je nach Empfänger nicht immer gleich. Kleine Bilder verwenden.

## Wenn das nicht hilft
Ticket anlegen mit: verwendeter Outlook-Version, Beschreibung des Fehlers (Signatur fehlt, Format kaputt) und, wenn möglich, einem Bildschirmfoto.

=== ARTIKEL
titel: Abwesenheitsnotiz (automatische Antwort) einrichten
bereich: Outlook & E-Mail
tags: abwesenheitsnotiz, automatische antwort, urlaub, abwesend, out of office, vertretung
zielgruppe: kunde
---
**Symptom:** Absender sollen bei Urlaub oder Krankheit automatisch eine Antwort erhalten. Oder: Die Notiz ist aktiv, wird aber nicht gesendet.

**Häufige Ursachen:** Der Zeitraum ist falsch gesetzt, die Option für externe Absender ist ausgeschaltet oder die Notiz wurde nicht gespeichert.

## Lösung im klassischen Outlook
1. Im Menü **Datei** auf **Automatische Antworten (Abwesenheitsnotiz)** klicken.
2. **Automatische Antworten senden** auswählen.
3. **Nur in diesem Zeitraum senden** ankreuzen und Beginn und Ende eintragen. Dann endet die Notiz von selbst.
4. In der Registerkarte **Innerhalb meiner Organisation** den Text für Kollegen eingeben.
5. In der Registerkarte **Außerhalb meiner Organisation** die Option für externe Absender einschalten und Text eingeben. Dort kann gewählt werden, ob nur Kontakte oder alle externen Absender eine Antwort erhalten.
6. Mit **OK** speichern.

## Im neuen Outlook und im Web
Zahnrad-Symbol (**Einstellungen**) → **Automatische Antworten** (die Bezeichnung kann je nach Version abweichen). Schalter einschalten, Zeitraum und Text setzen, speichern.

## Hinweise
- Vertretung mit Name und Telefonnummer nennen, keine privaten Details.
- Pro Absender wird in der Regel nur eine automatische Antwort gesendet.

## Wenn das nicht hilft
Ticket anlegen mit: Zeitraum, Text, ob die Notiz intern oder extern nicht ankommt und Angabe der Outlook-Version.

=== ARTIKEL
titel: Freigegebenes Postfach in Outlook öffnen und als Absender nutzen
bereich: Outlook & E-Mail
tags: freigegebenes postfach, shared mailbox, info-postfach, sammelpostfach, öffnen, absender
zielgruppe: kunde
---
**Symptom:** Ein gemeinsames Postfach (zum Beispiel für Anfragen oder Rechnungen) erscheint nicht in Outlook, oder Mails lassen sich nicht im Namen des Postfachs versenden.

**Häufige Ursachen:** Die Berechtigung wurde erst kürzlich vergeben, das Postfach wurde noch nicht automatisch eingebunden oder im Nachrichtenfenster ist das Feld „Von“ nicht sichtbar.

## Lösung im klassischen Outlook
1. Berechtigung abwarten. Nach neuer Freigabe kann es bis zu einer Stunde dauern, bis das Postfach in der linken Ordnerliste erscheint. Outlook einmal schließen und neu starten.
2. Erscheint es nicht: **Datei → Kontoeinstellungen → Kontoeinstellungen**, das eigene Konto doppelt anklicken, **Weitere Einstellungen → Erweitert → Hinzufügen** und die Adresse des freigegebenen Postfachs eintragen.
3. Als freigegebenes Postfach senden: **Neue E-Mail** öffnen. Fehlt die Zeile **Von**, in der Registerkarte **Optionen** auf **Von** klicken.
4. In der Zeile **Von** die Adresse des freigegebenen Postfachs wählen. Falls sie nicht in der Liste steht, **Andere E-Mail-Adresse…** wählen und die Adresse eingeben.

## Im Web
Rechtsklick auf **Ordner** in der linken Leiste und ein freigegebenes Postfach hinzufügen (die Bezeichnung hängt von der Version ab). Zum Senden die Zeile **Von** im Nachrichtenfenster einblenden.

## Wenn das nicht hilft
Ticket anlegen mit: Adresse des Postfachs, wer die Berechtigung seit wann haben soll, ob nur Lesen oder auch Senden nötig ist und ob eine Fehlermeldung erscheint.

=== ARTIKEL
titel: Kalender in Outlook für Kollegen freigeben
bereich: Outlook & E-Mail
tags: kalender freigeben, kalender teilen, berechtigung, termine, kollegen, vertretung
zielgruppe: kunde
---
**Symptom:** Kollegen oder Vorgesetzte sollen den eigenen Kalender sehen oder bearbeiten können, oder ein freigegebener Kalender ist nicht sichtbar.

**Häufige Ursachen:** Der Kalender wurde nicht freigegeben, die Berechtigungsstufe ist zu niedrig oder die Einladung wurde nicht angenommen.

## Lösung im klassischen Outlook
1. In die Kalenderansicht wechseln.
2. In der Registerkarte **Start** auf **Kalender freigeben** klicken. Alternativ Rechtsklick auf den eigenen Kalender → **Eigenschaften** → Registerkarte **Berechtigungen**.
3. Person hinzufügen und eine Berechtigungsstufe wählen. Üblich sind: nur Verfügbarkeit (Frei/Gebucht), Titel und Orte, alle Details, bearbeiten. Die genauen Bezeichnungen können je nach Version abweichen.
4. Mit **OK** bestätigen. Die eingeladene Person erhält eine Nachricht und kann den Kalender annehmen.

## Im neuen Outlook und im Web
Zahnrad-Symbol (**Einstellungen**) → **Kalender → Freigegebene Kalender** (je nach Version). Dort Person eintragen und Stufe wählen.

## Hinweise
- Nur so viel freigeben wie nötig. Private Termine lassen sich als **Privat** markieren, sie erscheinen dann ohne Details.
- Vertretung braucht oft die Stufe „bearbeiten“.

## Wenn das nicht hilft
Ticket anlegen mit: wessen Kalender, für wen und mit welcher Berechtigung freigegeben werden soll, sowie Fehlermeldung. Kalender anderer Personen darf nur der Besitzer freigeben.

=== ARTIKEL
titel: Regel in Outlook erstellen, um Mails automatisch zu verschieben
bereich: Outlook & E-Mail
tags: regel, regeln, mails sortieren, automatisch verschieben, ordner, outlook, filter
zielgruppe: kunde
---
**Symptom:** Bestimmte Mails (Newsletter, Meldungen, Mails eines Kunden) sollen automatisch in einen Ordner wandern oder eine Meldung erzeugen. Oder: Eine Regel läuft nicht.

**Häufige Ursachen:** Die Regel ist nicht aktiviert, die Bedingung passt nicht genau oder die Regel gilt nur auf dem PC und läuft nur, solange Outlook geöffnet ist.

## Lösung im klassischen Outlook
1. Zuerst den Zielordner anlegen: Rechtsklick auf das Postfach oder einen Ordner → **Neuen Ordner**.
2. Eine passende Mail markieren, **Start → Regeln → Regel erstellen…** wählen. Alternativ **Start → Regeln → Regeln und Benachrichtigungen verwalten…** und dort **Neue Regel…**.
3. Bedingung wählen, zum Beispiel „Von“ einer bestimmten Adresse oder Betreff enthält ein Stichwort.
4. Aktion wählen, zum Beispiel **Element in Ordner verschieben** und den Zielordner auswählen.
5. Regel benennen, **Regel aktivieren** angehakt lassen und **Fertig stellen**.
6. Zum Test: in **Regeln und Benachrichtigungen verwalten…** die Schaltfläche **Regeln jetzt anwenden** nutzen, um bestehende Mails zu sortieren.

## Hinweise
- Regeln werden von oben nach unten ausgeführt. Die Reihenfolge lässt sich ändern.
- Meldet Outlook, dass eine Regel nur auf diesem Computer läuft, funktioniert sie nur bei geöffnetem Outlook.
- Im neuen Outlook und im Web: **Einstellungen → E-Mail → Regeln**. Die Auswahl ist anders aufgebaut.

## Wenn das nicht hilft
Ticket anlegen mit: gewünschter Bedingung, Aktion, Meldung beim Speichern und der Angabe, ob Outlook klassisch oder neu ist.

=== ARTIKEL
titel: Erwartete Mail kommt nicht an – Junk-Ordner und Absender prüfen
bereich: Outlook & E-Mail
tags: junk, spam, mail fehlt, kommt nicht an, sichere absender, kein junk, erwartete mail
zielgruppe: kunde
---
**Symptom:** Eine erwartete Mail (zum Beispiel von einem Kunden oder Lieferanten) fehlt im Posteingang.

**Häufige Ursachen:** Die Mail wurde als Junk eingestuft, ist in einem anderen Ordner gelandet (etwa durch eine Regel) oder wurde vom Absender nicht richtig versendet.

## Lösung
1. Ordner **Junk-E-Mail** öffnen und nach der Mail suchen.
2. Mail gefunden: Markieren, dann **Start → Junk-E-Mail → Kein Junk** wählen. Dabei kann Outlook anbieten, den Absender oder die Domäne als sicher einzutragen. Die Mail wird in den Posteingang verschoben.
3. Alternativ den Absender dauerhaft sicher stellen: **Start → Junk-E-Mail → Junk-E-Mail-Optionen… → Sichere Absender** und die Adresse hinzufügen.
4. Nicht gefunden: In der Suche **Alle Postfächer** und **Alle Elemente** wählen, falls eine Regel die Mail verschoben hat. Auch Ordner **Gelöschte Elemente** prüfen.
5. Beim Absender nachfragen, ob die Adresse stimmt und die Mail tatsächlich weg ist. Auch auf Unzustellbarkeitsmeldungen achten, die dort eingegangen sein könnten.
6. Im neuen Outlook und im Web steht der Junk-Bereich ebenfalls in der Ordnerliste. Die Schaltflächen heißen ähnlich, der Ort kann abweichen.

Bei verdächtigen Mails (unbekannter Absender, Aufforderung zu Zahlung oder Anmeldung) nichts anklicken, sondern die IT informieren.

## Wenn das nicht hilft
Ticket anlegen mit: Absenderadresse, ungefährer Sendezeitpunkt, Betreff und Ergebnis der Suche. Die IT kann nachverfolgen, ob die Mail im Unternehmen angekommen ist.

=== ARTIKEL
titel: Anhang zu groß – E-Mail mit großer Datei versenden
bereich: Outlook & E-Mail
tags: anhang zu groß, dateigröße, limit, mb, große datei, senden, link teilen
zielgruppe: kunde
---
**Symptom:** Outlook meldet, dass der Anhang zu groß ist, die Mail bleibt im Postausgang oder der Empfänger meldet eine Ablehnung.

**Häufige Ursachen:** Die Gesamtgröße der Mail liegt über dem Limit. Bei Exchange Online liegt das Standardlimit bei etwa 25 MB je Nachricht. Durch die Kodierung der Anhänge ist die tatsächlich nutzbare Dateigröße etwas kleiner. Zudem kann der Empfänger ein niedrigeres Limit haben.

## Lösung
1. Größe der Dateien prüfen (im Explorer Rechtsklick → **Eigenschaften**).
2. Bilder verkleinern oder Dokumente als PDF mit geringerer Qualität speichern.
3. Mehrere Anhänge auf mehrere Mails aufteilen.
4. Besser: Datei als Link statt als Anhang senden. Im Nachrichtenfenster **Einfügen → Dateien anfügen** wählen und die Datei aus dem Cloudspeicher auswählen, dann als Link freigeben. Die Bezeichnungen hängen von der Version ab. Dabei Zugriffsrechte beachten: Nur Personen mit Berechtigung dürfen den Link öffnen.
5. Vor dem Versenden prüfen, wer Zugriff erhält, und bei vertraulichen Daten die Freigabe einschränken.

## Hinweise
- Ein erneutes Senden löscht eine festhängende Mail nicht. Die alte Mail aus dem Postausgang löschen, bevor eine neue gesendet wird.
- Ein zu großer Anhang löst manchmal eine Unzustellbarkeitsmeldung aus. Siehe Artikel „Unzustellbarkeitsnachricht verstehen“.

## Wenn das nicht hilft
Ticket anlegen mit: Dateigröße, Dateityp, Empfänger und genauer Fehlermeldung.

=== ARTIKEL
titel: Falsche E-Mail-Adresse im Autovervollständigen entfernen
bereich: Outlook & E-Mail
tags: autovervollständigen, falsche adresse, vorschlag, alte adresse, empfänger, nickname, vorschlagsliste
zielgruppe: kunde
---
**Symptom:** Beim Eintippen eines Namens schlägt Outlook eine alte oder falsche Adresse vor. Mails gehen deshalb an die falsche Person oder werden unzustellbar.

**Häufige Ursachen:** Outlook merkt sich Adressen aus früheren Mails. Auch nach einer Änderung der Adresse bleibt der alte Eintrag zunächst in der Liste.

## Lösung für einen einzelnen Eintrag
1. Eine neue Mail öffnen und den Namen in das Feld **An** tippen, bis der falsche Vorschlag erscheint.
2. Mit der Pfeiltaste nach unten den falschen Eintrag markieren (oder mit der Maus darüberfahren).
3. Auf das kleine **X** neben dem Eintrag klicken oder die Taste **Entf** drücken.
4. Danach die richtige Adresse einmal manuell eingeben und die Mail senden. Outlook merkt sich diese Adresse künftig.

## Lösung für die ganze Liste (klassisches Outlook)
1. **Datei → Optionen → E-Mail**.
2. Im Abschnitt **Nachrichten senden** auf **Liste der automatischen Vervollständigung leeren** klicken (die genaue Bezeichnung kann je nach Version leicht abweichen) und bestätigen.
3. Achtung: Dadurch gehen alle gemerkten Vorschläge verloren. Danach lernt Outlook neu.

## Hinweise
- Taucht der falsche Eintrag danach wieder auf, kommt er oft aus einem Kontakt. Unter **Personen** nach dem Namen suchen und veralteten Kontakt anpassen oder löschen.

## Wenn das nicht hilft
Ticket anlegen mit: Name der Person, welche Adresse erscheint, welche richtig wäre und ob Outlook klassisch oder neu ist.

=== ARTIKEL
titel: E-Mail zurückrufen – was wirklich funktioniert
bereich: Outlook & E-Mail
tags: mail zurückrufen, zurückrufen, falsch gesendet, rückruf, senden rückgängig, verzögern
zielgruppe: kunde
---
**Symptom:** Eine Mail wurde an die falsche Person oder mit falschem Inhalt versendet und soll zurückgeholt werden.

**Häufige Ursachen:** Fehler bei der Empfängerauswahl, etwa durch Autovervollständigen, oder versehentliches „Antwort an alle“.

## Was ein Rückruf kann
- Der Rückruf funktioniert nur im klassischen Outlook, nur innerhalb derselben Organisation und nur, solange die Nachricht noch ungelesen im Postfach des Empfängers liegt.
- Bei externen Empfängern funktioniert er nicht. Auch bei internen ist er nicht zuverlässig: Der Empfänger kann eine Meldung über den Rückruf erhalten und sieht dadurch erst recht, dass etwas schiefgelaufen ist.
- Rückruf im neuen Outlook oder im Web ist je nach Version eingeschränkt oder anders gelöst.

## Rückruf versuchen (klassisches Outlook)
1. Ordner **Gesendete Elemente** öffnen und die Mail doppelt anklicken, damit sie in einem eigenen Fenster geöffnet wird.
2. **Datei → Info → Nachricht erneut senden und zurückrufen → Diese Nachricht zurückrufen…** wählen.
3. Optionen auswählen und bestätigen.

## Besser vorbeugen
- Die Zeile **An** vor dem Senden kontrollieren.
- Senden verzögern: **Start → Regeln → Regeln und Benachrichtigungen verwalten… → Neue Regel → Regel auf von mir gesendete Nachrichten anwenden** und die Zustellung um einige Minuten verzögern. In dieser Zeit liegt die Mail im Postausgang und kann geändert oder gelöscht werden.

## Wenn das nicht hilft
Bei vertraulichen Daten sofort die IT und den Vorgesetzten informieren. Ticket mit: Empfänger, Zeitpunkt, Inhalt in Stichworten (ohne Inhalt weiterzugeben).

=== ARTIKEL
titel: Gelöschte E-Mails und Elemente in Outlook wiederherstellen
bereich: Outlook & E-Mail
tags: gelöscht, wiederherstellen, papierkorb, gelöschte elemente, mail weg, kontakt gelöscht, termin gelöscht
zielgruppe: kunde
---
**Symptom:** Eine Mail, ein Termin oder ein Kontakt wurde versehentlich gelöscht oder ist verschwunden.

**Häufige Ursachen:** Versehentliches Löschen, eine Regel, die Mails verschoben hat, oder ein geleerter Ordner „Gelöschte Elemente“.

## Lösung
1. Ordner **Gelöschte Elemente** öffnen, nach dem Element suchen und per Rechtsklick **Verschieben → Anderer Ordner** (oder per Ziehen) zurück in den gewünschten Ordner legen.
2. Nicht dort? Ordner **Junk-E-Mail** und über die Suche **Alle Postfächer** prüfen.
3. Wurde auch **Gelöschte Elemente** geleert: Ordner **Gelöschte Elemente** markieren und im klassischen Outlook die Registerkarte **Ordner** öffnen, dort **Gelöschte Elemente wiederherstellen** wählen. Die Bezeichnung kann je nach Version leicht abweichen.
4. Im Fenster das Element markieren und **Ausgewählte Elemente wiederherstellen** wählen. Es wird in den Ordner **Gelöschte Elemente** zurückgelegt und kann von dort verschoben werden.
5. Im Web: Ordner **Gelöschte Elemente** öffnen und am oberen Rand die Option zum Wiederherstellen gelöschter Elemente aus diesem Ordner nutzen.

## Hinweise
- Gelöschte Elemente bleiben nach dem Leeren nur begrenzt auf dem Server erhalten, meist 14 Tage, höchstens 30 Tage je nach Einstellung. Danach sind sie ohne Datensicherung oder Aufbewahrungsrichtlinie nicht mehr erreichbar.
- Es empfiehlt sich, rasch zu handeln.

## Wenn das nicht hilft
Ticket anlegen mit: Art des Elements, ungefährer Löschzeitpunkt, Absender oder Betreff und bisher geprüfte Ordner. Je früher das Ticket kommt, desto größer die Chance.

=== ARTIKEL
titel: Besprechung in Outlook planen mit Raum und Teams-Link
bereich: Outlook & E-Mail
tags: besprechung, termin, teams-link, raum, einladung, planungsassistent, outlook kalender
zielgruppe: kunde
---
**Symptom:** Eine Besprechung soll mit mehreren Personen, einem Raum und einem Link für Online-Teilnahme geplant werden. Oder: Der Teams-Link oder Raum fehlt in der Einladung.

**Häufige Ursachen:** Es wurde ein einfacher Termin statt einer Besprechung angelegt, die Teams-Funktion ist nicht verfügbar oder Räume sind nicht als Raumpostfächer eingerichtet.

## Lösung im klassischen Outlook
1. In der Kalenderansicht **Neue Besprechung** wählen (alternativ **Neue Elemente → Besprechung**).
2. Bei **An** die Teilnehmer eintragen, Betreff, Datum und Uhrzeit setzen.
3. Über **Planungsassistent** prüfen, wann alle Teilnehmer frei sind.
4. Für Online-Teilnahme in der Registerkarte **Besprechung** auf **Teams-Besprechung** klicken. Der Link und die Einwahldaten werden in den Text der Einladung eingefügt.
5. Für einen Raum bei **Ort** auf die Auswahl (Raumsuche) klicken oder die Schaltfläche **Raum hinzufügen** nutzen. Räume stehen nur zur Auswahl, wenn sie von der IT als Raumpostfach eingerichtet sind.
6. **Senden** klicken. Zusagen erscheinen später in der Besprechung unter **Nachverfolgung**.

## Im neuen Outlook und im Web
Im Kalender **Neues Ereignis** wählen. Teams-Option und Ort sind im Formular vorhanden. Bezeichnungen können je nach Version abweichen.

## Wenn das nicht hilft
Ticket anlegen mit: Outlook-Version, ob die Teams-Schaltfläche fehlt, gewünschtem Raum und Fehlermeldung. Hinweis: Einstellungen von Teams selbst gehören nicht in diesen Artikel.

=== ARTIKEL
titel: Unterschied zwischen neuem Outlook und klassischem Outlook
bereich: Outlook & E-Mail
tags: neues outlook, klassisches outlook, umschalter, unterschied, wechseln, add-ins, menüband
zielgruppe: kunde
---
**Symptom:** Outlook sieht auf einmal anders aus, es fehlen Funktionen oder Anleitungen passen nicht zur Oberfläche.

**Häufige Ursachen:** Es gibt zwei Programme mit dem Namen Outlook. Auf manchen PCs wird zum neuen Outlook umgeschaltet oder es wird automatisch angeboten.

## So lässt sich die Version erkennen
- **Klassisches Outlook:** Oben links gibt es das Menü **Datei**, darunter die Registerkarten **Start**, **Senden/Empfangen**, **Ordner**, **Ansicht**.
- **Neues Outlook:** Es gibt kein Menü **Datei**. Die Oberfläche ähnelt Outlook im Web. Einstellungen sind über das Zahnrad-Symbol erreichbar.

## Wichtige Unterschiede
1. Das neue Outlook basiert auf der Web-Version. Viele Funktionen sind gleich, einige Bereiche sind anders aufgebaut.
2. Einige Funktionen und manche Zusatzprogramme (Add-Ins) sind je nach Version im neuen Outlook nicht oder anders vorhanden. Ob etwas fehlt, hängt vom Funktionsstand ab, der sich laufend ändert.
3. Dateien mit lokalen Mails (PST) werden im neuen Outlook nicht im gleichen Umfang unterstützt.
4. Anleitungen in dieser Bibliothek nennen den Pfad für beide Versionen, wenn er sich unterscheidet.

## Zwischen den Versionen wechseln
Oben rechts gibt es in der Regel einen Schalter **Neues Outlook** beziehungsweise im neuen Outlook den Weg zurück zum klassischen Outlook. Die Position und Bezeichnung können je nach Version abweichen. Daten gehen beim Wechsel nicht verloren, da Mails auf dem Server liegen.

## Wenn das nicht hilft
Ticket anlegen mit: welche Version in Gebrauch ist, welche Funktion fehlt und wer den Wechsel veranlasst hat. Die Entscheidung, welche Version eingesetzt wird, trifft die IT.

=== ARTIKEL
titel: Outlook im Web nutzen, wenn Outlook auf dem PC streikt
bereich: Outlook & E-Mail
tags: outlook im web, owa, browser, notlösung, webmail, outlook streikt, mails im browser
zielgruppe: kunde
---
**Symptom:** Outlook am PC startet nicht, hängt oder zeigt keine neuen Mails, die Arbeit muss aber weitergehen.

**Häufige Ursachen:** Fehler beim Programm oder Profil auf dem PC. Das Postfach selbst auf dem Server ist davon meist nicht betroffen.

## Lösung
1. Einen Browser öffnen, zum Beispiel Microsoft Edge.
2. Die Adresse `outlook.office.com` eingeben.
3. Mit der Firmenadresse anmelden. Bei Aufforderung zur zusätzlichen Bestätigung die gewohnte Methode nutzen.
4. Es erscheint das Postfach mit Posteingang, Kalender und Kontakten wie in Outlook.
5. Nach der Arbeit **Abmelden** wählen, besonders an fremden oder gemeinsam genutzten PCs.

## Gut zu wissen
- Alle Mails, Termine und Kontakte sind identisch, da sie auf dem Server liegen.
- Einige Funktionen unterscheiden sich vom klassischen Outlook, etwa der Menüaufbau und die Verfügbarkeit mancher Add-Ins.
- Der Test ist zugleich eine Diagnose: Funktioniert das Postfach im Browser, liegt das Problem am PC. Funktioniert es auch dort nicht, liegt es am Konto, Kennwort oder Postfach.
- Signatur und Regeln müssen im Web eventuell getrennt eingerichtet werden, je nach Version.

## Wenn das nicht hilft
Ticket anlegen mit: Ergebnis des Web-Tests (geht oder geht nicht), Fehlermeldung bei der Anmeldung und Zeitpunkt, seit dem Outlook am PC nicht mehr funktioniert.

=== ARTIKEL
titel: Unzustellbarkeitsnachricht verstehen und richtig reagieren
bereich: Outlook & E-Mail
tags: unzustellbar, unzustellbarkeitsbericht, ndr, bounce, mailer-daemon, zustellung fehlgeschlagen, abgelehnt
zielgruppe: kunde
---
**Symptom:** Kurz nach dem Senden kommt eine Nachricht zurück, zum Beispiel mit dem Betreff „Unzustellbar“ oder „Undeliverable“.

**Häufige Ursachen:** Tippfehler in der Adresse, Empfängerpostfach voll oder nicht vorhanden, Mail zu groß oder die Empfängerseite lehnt die Nachricht ab.

## Lösung
1. Die Nachricht ganz öffnen und den ersten Absatz lesen. Meist steht dort in einfachen Worten, was das Problem ist, und welche Adresse betroffen ist.
2. Adresse prüfen: Buchstabendreher, falsche Endung, alte Adresse? Mit der korrekten Adresse erneut senden. Einen alten Eintrag gegebenenfalls aus dem Autovervollständigen entfernen (siehe eigener Artikel).
3. Im unteren Teil steht ein Code der Form 5.x.x. Grob bedeuten: **5.1.1** die Adresse existiert nicht, **5.2.2** das Postfach des Empfängers ist voll, **5.7.1** der Versand wurde nicht erlaubt oder abgelehnt. Codes, die mit 4 beginnen, deuten meist auf ein vorübergehendes Problem hin.
4. Bei „Postfach voll“ oder 4.x.x später erneut senden oder den Empfänger anderweitig kontaktieren.
5. Bei zu großem Anhang die Datei verkleinern oder als Link senden.

## Hinweise
- Bei Meldungen über abgelehnte Nachrichten wegen Spam oder Richtlinien nicht mehrfach erneut senden.
- Die ganze Nachricht (mit Text unten) ist für Techniker wichtig.

## Wenn das nicht hilft
Ticket anlegen und die Unzustellbarkeitsnachricht als Anhang oder Bildschirmfoto beifügen. Dazu: Empfängeradresse, Zeitpunkt und ob die Adresse früher funktioniert hat.

=== ARTIKEL
titel: Outlook fragt ständig nach dem Kennwort
bereich: Outlook & E-Mail
tags: kennwort, passwort, anmeldung, outlook fragt, anmeldefenster, popup, anmeldedaten
zielgruppe: kunde
---
**Symptom:** Outlook zeigt immer wieder ein Anmeldefenster und verlangt das Kennwort, oder die Statusleiste meldet „Kennwort erforderlich“.

**Häufige Ursachen:** Das Kennwort wurde kürzlich geändert, die Anmeldung ist abgelaufen, Datum und Uhrzeit des PCs stimmen nicht oder die Verbindung ist gestört.

## Lösung
1. Prüfen, ob die Anmeldung im Browser funktioniert (siehe Artikel „Outlook im Web nutzen, wenn Outlook streikt“). Wird dort das Kennwort nicht akzeptiert, ist es falsch oder abgelaufen. Dann Kennwort laut Firmenverfahren zurücksetzen lassen.
2. Funktioniert die Web-Anmeldung, Outlook schließen und den PC neu starten.
3. Outlook öffnen und das Kennwort einmal sorgfältig eingeben. Wenn angeboten, die Option zum Merken der Anmeldedaten aktivieren, sofern das in der Firma erlaubt ist.
4. Datum und Uhrzeit prüfen: Rechtsklick auf die Uhr in der Taskleiste → **Datum/Uhrzeit anpassen**. Die Zeit sollte automatisch eingestellt sein.
5. Wird zusätzlich eine zweite Bestätigung verlangt (zum Beispiel per App), diese durchführen. Fragen dazu gehören nicht in diesen Artikel.
6. Mehrfaches falsches Eingeben des Kennworts kann das Konto sperren. Daher nur sorgfältig und selten versuchen.

## Wenn das nicht hilft
Ticket anlegen mit: Ergebnis der Web-Anmeldung, Zeitpunkt der letzten Kennwortänderung, Text im Anmeldefenster und ob auch andere Programme (zum Beispiel Teams) nach dem Kennwort fragen. Das Kennwort selbst nie ins Ticket schreiben.

=== ARTIKEL
titel: Outlook läuft langsam oder reagiert verzögert
bereich: Outlook & E-Mail
tags: langsam, outlook langsam, hängt, verzögert, träge, reagiert nicht, ruckelt
zielgruppe: kunde
---
**Symptom:** Outlook braucht lange zum Öffnen von Mails, beim Tippen oder beim Wechsel zwischen Ordnern. Gelegentlich steht „Keine Rückmeldung“ im Fenstertitel.

**Häufige Ursachen:** sehr viele Mails in einem Ordner, ein volles Postfach, Add-Ins, eine lahme Internetverbindung oder ein PC mit wenig freiem Speicher.

## Lösung
1. Zuerst abwarten, ob Outlook nach ein bis zwei Minuten wieder reagiert, besonders direkt nach dem Start oder nach einem Update.
2. Nicht benötigte Programme und Browser-Tabs schließen. Dann den PC neu starten, falls er länger nicht neu gestartet wurde.
3. Den Posteingang aufräumen: Ordner mit tausenden Mails in Unterordner sortieren, Ordner **Gelöschte Elemente** und **Junk-E-Mail** leeren (siehe Artikel „Postfach voll“).
4. Mit `outlook.exe /safe` (**Windows-Taste + R**) starten. Ist Outlook so deutlich schneller, bremst vermutlich ein Add-In. Das ist ein Fall für die IT.
5. Internetverbindung prüfen, besonders bei Arbeit im Homeoffice oder mit Mobilfunk.
6. Anhänge in der Vorschau können bremsen. Bei Bedarf Lesebereich über **Ansicht → Lesebereich** vorübergehend ausschalten.

## Wenn das nicht hilft
Ticket anlegen mit: seit wann es langsam ist, ob es nur bei bestimmten Ordnern oder Aktionen auftritt, ob der abgesicherte Modus schneller ist, wie groß das Postfach ungefähr ist und ob Kollegen betroffen sind.

=== ARTIKEL
titel: Outlook-Profil neu erstellen (Techniker)
bereich: Outlook & E-Mail
tags: outlook profil, neues profil, profil beschädigt, mail systemsteuerung, profil neu, technik
zielgruppe: technik
---
**Symptom:** Outlook startet nicht oder meldet beim Start Profilfehler, hängt beim Laden oder zeigt falsche Daten. Der abgesicherte Modus ohne Add-Ins ändert nichts.

**Häufige Ursachen:** beschädigte Profileinstellungen, unterbrochene Updates, fehlerhafte Datendatei.

## Lösung
1. Outlook schließen und in den Task-Manager prüfen, ob `OUTLOOK.EXE` beendet ist.
2. Systemsteuerung öffnen, Ansicht auf **Kleine Symbole** stellen, **Mail (Microsoft Outlook)** wählen. Der Name kann je nach Version abweichen.
3. **Profile anzeigen… → Hinzufügen…**, Profilnamen vergeben, E-Mail-Adresse eingeben und dem Assistenten folgen. Autodiscover trägt die Servereinstellungen ein.
4. Im Fenster **Profile** die Option **Zu verwendendes Profil auffordern** setzen und Outlook mit dem neuen Profil starten. Funktioniert es, **Immer dieses Profil verwenden** wählen.
5. Das alte Profil zunächst nicht löschen, sondern umbenennen oder liegen lassen.
6. Nach dem Start Signaturen, Regeln und Freigaben prüfen. Signaturen liegen unter `%appdata%\Microsoft\Signatures`. Sie bleiben beim Profilwechsel in der Regel erhalten, da sie benutzerbezogen sind.

**Achtung:** Beim Entfernen eines Profils verschwinden lokale Daten, die nicht auf dem Server liegen (zum Beispiel PST-Verbindungen, Offlinedateien, clientseitige Regeln). Vorher klären, was lokal gespeichert ist, und PST-Dateien sichern. Das alte Profil erst löschen, wenn alles bestätigt ist.

## Für das Ticket notieren
Outlook-Version und Build, Fehlerbild vor und nach dem neuen Profil, ob PST-Dateien oder Zusatzkonten verwendet wurden und was nachkonfiguriert werden musste.

=== ARTIKEL
titel: OST-Datei neu aufbauen bei defektem Outlook-Cache (Techniker)
bereich: Outlook & E-Mail
tags: ost, ost-datei, cache, neu aufbauen, synchronisation, ordner fehlen, outlook cache
zielgruppe: technik
---
**Symptom:** Ordner oder Mails fehlen oder stimmen nicht mit dem Web überein. Synchronisationsfehler, Outlook hängt beim Abgleich, oder die Suche ist unvollständig.

**Häufige Ursachen:** beschädigte lokale Cachedatei (OST), nach Abstürzen, vollem Datenträger oder Updates.

## Lösung
1. Vorher prüfen: Stimmt der Inhalt im Browser (Outlook im Web)? Nur dann ist der Server aktuell und der Cache das Problem.
2. Outlook schließen und im Task-Manager prüfen, ob es beendet ist.
3. Ort der Datei ermitteln: **Datei → Kontoeinstellungen → Kontoeinstellungen → Registerkarte Datendateien**, Konto markieren, **Dateispeicherort öffnen**. Üblich ist `%localappdata%\Microsoft\Outlook`.
4. Die `.ost`-Datei des Kontos nicht löschen, sondern umbenennen, zum Beispiel mit der Endung `.old`.
5. Outlook starten. Es legt eine neue OST-Datei an und lädt die Inhalte erneut vom Server. Das kann je nach Postfachgröße und Leitung Stunden dauern. Währenddessen sind Suche und Ordner unvollständig.
6. Nach vollständiger Synchronisation Stand mit dem Web vergleichen. Erst dann die alte Datei löschen.

**Achtung:** Elemente, die nur lokal existieren und nicht synchronisiert wurden (zum Beispiel Entwürfe oder Postausgang bei Verbindungsproblemen), gehen verloren. Beim Kunden vorher nach nicht gesendeten Mails fragen. Auf ausreichend freien Speicherplatz achten.

## Hintergrund
Im Exchange-Cache-Modus ist die OST nur eine Kopie des Serverpostfachs. Die Einstellung **Offline zu haltende E-Mails** (Kontoeinstellungen → Konto → Ändern) begrenzt den Zeitraum.

## Für das Ticket notieren
Größe der alten OST, Dauer der Neusynchronisation, ob die Ursache klar wurde (Speicherplatz, Absturz).

=== ARTIKEL
titel: Add-Ins als Ursache für Outlook-Probleme eingrenzen (Techniker)
bereich: Outlook & E-Mail
tags: add-in, addin, com-add-ins, outlook langsam, abstürze, deaktivieren, eingrenzen
zielgruppe: technik
---
**Symptom:** Outlook startet langsam, stürzt ab, zeigt Fehlermeldungen beim Start oder beim Öffnen von Mails. Im abgesicherten Modus tritt es nicht auf.

**Häufige Ursachen:** veraltete oder inkompatible Zusatzprogramme (zum Beispiel für Telefonie, Archivierung, PDF oder CRM).

## Lösung
1. Test im abgesicherten Modus: Outlook schließen, **Windows-Taste + R**, `outlook.exe /safe`. Läuft es dort sauber, ist ein Add-In wahrscheinlich.
2. Im normalen Start unter **Datei → Optionen → Add-Ins** die Liste ansehen. Unten bei **Verwalten** den Eintrag **COM-Add-Ins** wählen und auf **Los…** klicken.
3. Alle Häkchen entfernen, außer bei Add-Ins, die zum Betrieb zwingend nötig sind. Mit **OK** bestätigen und Outlook neu starten.
4. Läuft Outlook stabil, die Add-Ins einzeln wieder aktivieren, nach jedem Add-In neu starten und testen, bis das Problem zurückkehrt.
5. Das verursachende Add-In aktualisieren, neu installieren oder entfernen. Bei Fachprogrammen mit dem Hersteller oder der Fachabteilung klären.
6. Zusätzlich unter **Verwalten → Deaktivierte Elemente** prüfen, ob Outlook selbst Add-Ins abgeschaltet hat.

**Achtung:** Add-Ins für Telefonie oder Archivierung vor dem Deaktivieren mit dem Kunden abstimmen, damit keine Arbeitsabläufe unterbrochen werden. Bei Add-Ins, die in der Liste nicht deaktivierbar sind (zum Beispiel durch Richtlinien verwaltet), nicht eingreifen.

## Für das Ticket notieren
Outlook-Build, Name und Version des verursachenden Add-Ins, Fehlerbild, Lösung (Update, Entfernung) und betroffene Benutzer.

=== ARTIKEL
titel: Nachrichtenablaufverfolgung in Exchange Online nutzen (Techniker)
bereich: Outlook & E-Mail
tags: nachrichtenablaufverfolgung, message trace, mailfluss, mail verschwunden, zustellung, exchange online
zielgruppe: technik
---
**Symptom:** Der Kunde meldet, eine Mail sei nicht angekommen oder nicht zustellbar. Es soll geklärt werden, wo sie geblieben ist.

**Häufige Ursachen:** Spam- oder Quarantäne-Einstufung, falsche Adresse, abgelehnt vom Zielserver, Regel im Postfach, Weiterleitung.

## Lösung
1. Im Exchange Admin Center (Exchange-Verwaltungscenter) **Mailfluss → Nachrichtenablaufverfolgung** öffnen. Die Anordnung der Menüs kann sich ändern.
2. Eine neue Ablaufverfolgung starten. Absender und/oder Empfänger eintragen und den Zeitraum möglichst eng wählen. Nachrichten der letzten Tage sind im einfachen Bericht sofort verfügbar. Ältere Zeiträume erfordern je nach Funktion einen verzögert erstellten Bericht.
3. Ergebnis lesen. Der Status gibt die Richtung an. Typische Bedeutungen: zugestellt (Mail ist im Empfängerpostfach angekommen), fehlgeschlagen (nicht zugestellt), in Quarantäne oder zur Prüfung zurückgehalten, ausstehend.
4. Eintrag öffnen und die Ereignisdetails ansehen, etwa Zustellung, Ablehnung, Weiterleitung, Spam-Filterung.
5. Bei „zugestellt“ im Postfach des Empfängers nach Regeln, Junk und Unterordnern suchen, ohne Berechtigung nicht in fremde Postfächer schauen.
6. Alternative in PowerShell mit Exchange Online PowerShell: `Get-MessageTrace` beziehungsweise in neueren Modulversionen `Get-MessageTraceV2`. Welcher Befehl zur Verfügung steht, hängt von der Modulversion ab. Mit `Get-Help` prüfen.

## Hintergrund
Die Ablaufverfolgung zeigt nur Metadaten, keinen Nachrichteninhalt. Mails, die nie bei Microsoft 365 ankamen, erscheinen nicht. Dann Absenderseite prüfen.

## Für das Ticket notieren
Absender, Empfänger, Zeitraum, Nachrichten-ID, Status und Ereignisdetails.

=== ARTIKEL
titel: Postfachberechtigungen Vollzugriff und Senden als vergeben (Techniker)
bereich: Outlook & E-Mail
tags: vollzugriff, senden als, fullaccess, sendas, postfachberechtigung, stellvertretung, exchange online
zielgruppe: technik
---
**Symptom:** Ein Benutzer soll ein fremdes oder freigegebenes Postfach öffnen oder in dessen Namen senden können. Oder: Die Berechtigung greift nicht.

**Häufige Ursachen:** Berechtigung fehlt oder falsche Art vergeben, Automapping, Wartezeit nach Änderung.

## Lösung
1. In Exchange Online PowerShell anmelden: `Connect-ExchangeOnline`.
2. Vollzugriff (Postfach öffnen, lesen, bearbeiten):
```
Add-MailboxPermission -Identity postfach@domain.at -User benutzer@domain.at -AccessRights FullAccess -InheritanceType All
```
3. Ohne automatisches Einbinden in Outlook zusätzlich `-AutoMapping $false` anfügen.
4. Senden als (Mail erscheint vom Postfach selbst):
```
Add-RecipientPermission -Identity postfach@domain.at -Trustee benutzer@domain.at -AccessRights SendAs
```
5. Senden im Auftrag (Absender sichtbar „im Auftrag von“):
```
Set-Mailbox -Identity postfach@domain.at -GrantSendOnBehalfTo @{Add="benutzer@domain.at"}
```
6. Kontrolle: `Get-MailboxPermission -Identity postfach@domain.at` und `Get-RecipientPermission -Identity postfach@domain.at`.
7. Outlook auf dem PC neu starten. Es kann bis zu etwa einer Stunde dauern, bis Berechtigungen und Automapping greifen.

Alternativ lassen sich die Rechte im Exchange Admin Center beim jeweiligen Postfach unter den Delegierungen vergeben. Die Bezeichnungen dort können je nach Oberfläche abweichen.

**Achtung:** Vollzugriff und Senden als nur nach Auftrag des Postfachinhabers oder der Geschäftsführung vergeben und dokumentieren.

## Für das Ticket notieren
Postfach, Benutzer, welche Rechte, Auftraggeber und Datum.

=== ARTIKEL
titel: Autodiscover-Probleme in Outlook eingrenzen (Techniker)
bereich: Outlook & E-Mail
tags: autodiscover, profil erstellen, konto einrichten, dns, cname, automatische konfiguration, outlook
zielgruppe: technik
---
**Symptom:** Outlook kann das Konto nicht automatisch einrichten, das Hinzufügen schlägt fehl, oder nach einer Domänenänderung verbindet Outlook nicht mehr.

**Häufige Ursachen:** fehlender oder falscher DNS-Eintrag für Autodiscover, veraltete Zugangsdaten im Cache, Konflikt mit lokalen Einträgen, Firewall oder Proxy.

## Lösung
1. Zuerst im Browser Postfach testen (Outlook im Web). Geht das nicht, ist es kein Autodiscover-Problem.
2. DNS der Maildomäne prüfen:
```
nslookup -type=cname autodiscover.domain.at
```
Für Exchange Online wird üblicherweise ein CNAME auf `autodiscover.outlook.com` erwartet. Im DNS des Domänenanbieters kontrollieren.
3. In Outlook auf dem PC bei gedrückter **Strg-Taste** mit Rechtsklick auf das Outlook-Symbol im Infobereich der Taskleiste klicken und **Konfiguration der automatischen E-Mail-Konfiguration testen** wählen (Bezeichnung je nach Version prüfen). Dort nur Autodiscover verwenden, Kennwort eingeben, Test starten. Das Protokoll zeigt, welche Adressen abgefragt werden und wo es scheitert.
4. Alternativ den Microsoft Remote Connectivity Analyzer im Browser verwenden. Er testet den Autodiscover-Ablauf von außen.
5. Lokale Ursachen: alte Autodiscover-Einträge in einer lokalen DNS-Zone oder ein Eintrag der Datei `hosts`. Bei Kunden mit früherem lokalen Exchange danach schauen.
6. Neues Profil anlegen (siehe Artikel „Outlook-Profil neu erstellen“).

**Achtung:** Änderungen an DNS-Einträgen können den Mailfluss stören. Vorher den bestehenden Stand notieren und die Domäne nicht ohne Auftrag ändern. Registry-Eingriffe nur nach Rücksprache.

## Für das Ticket notieren
Testergebnis, DNS-Antworten, betroffene Benutzer und was geändert wurde.

=== ARTIKEL
titel: Archivpostfach und Aufbewahrung in Exchange Online aktivieren (Techniker)
bereich: Outlook & E-Mail
tags: archivpostfach, online-archiv, aufbewahrung, aufbewahrungsrichtlinie, archive, postfach voll, retention
zielgruppe: technik
---
**Symptom:** Ein Postfach wird zu voll oder der Kunde will ältere Mails automatisch auslagern.

**Häufige Ursachen:** viel Mailverkehr bei begrenztem Hauptpostfach, keine Archivierung eingerichtet.

## Lösung
1. Lizenz prüfen: Ein Archivpostfach ist nicht in jedem Lizenzplan enthalten. Im Zweifel in der Lizenzbeschreibung oder im Admin Center nachsehen, bevor aktiviert wird.
2. In Exchange Online PowerShell anmelden: `Connect-ExchangeOnline`.
3. Archiv aktivieren:
```
Enable-Mailbox -Identity benutzer@domain.at -Archive
```
4. Kontrolle: `Get-Mailbox -Identity benutzer@domain.at | Format-List ArchiveStatus,RetentionPolicy`.
5. Die Standard-Aufbewahrungsrichtlinie (Default MRM Policy) verschiebt Mails nach Ablauf einer Frist automatisch ins Archiv. Der Zeitraum hängt von der Richtlinie ab. Die Prüfung läuft im Hintergrund und kann Tage dauern.
6. Prüfung für ein Postfach anstoßen:
```
Start-ManagedFolderAssistant -Identity benutzer@domain.at
```
7. Im Outlook erscheint das Archiv als zusätzliches Postfach in der Ordnerliste. Nach der Aktivierung kann es dauern, bis es sichtbar wird.

## Hintergrund
Für gesetzliche Aufbewahrungspflichten reicht das Archiv allein nicht. Dafür gibt es Aufbewahrungs- oder Sperrfunktionen (Litigation Hold oder Richtlinien im Purview-Portal). Diese nur nach Vorgabe des Kunden und der Geschäftsführung einrichten.

**Achtung:** Aufbewahrungsrichtlinien ändern das Löschverhalten. Keine Richtlinien ändern, ohne vorher Frist und Umfang zu klären.

## Für das Ticket notieren
Benutzer, Lizenzplan, aktivierte Funktion, Richtlinie und Datum der Aktivierung.

=== ARTIKEL
titel: Abwesenheitsnotiz und Weiterleitung per Exchange Online setzen (Techniker)
bereich: Outlook & E-Mail
tags: abwesenheitsnotiz admin, weiterleitung, forwarding, automatische antwort, powershell, ausgeschiedener mitarbeiter
zielgruppe: technik
---
**Symptom:** Ein Benutzer ist nicht erreichbar (Krankheit, Austritt) und kann keine automatische Antwort oder Weiterleitung selbst einrichten.

**Häufige Ursachen:** Der Benutzer hat keinen Zugriff, oder es besteht ein Auftrag der Geschäftsführung.

## Lösung
1. Auftrag und Berechtigung klären. Eine Weiterleitung auf ein anderes Postfach muss vom Kunden angeordnet sein.
2. In Exchange Online PowerShell anmelden: `Connect-ExchangeOnline`.
3. Automatische Antwort einschalten:
```
Set-MailboxAutoReplyConfiguration -Identity benutzer@domain.at -AutoReplyState Enabled -InternalMessage "Text intern" -ExternalMessage "Text extern"
```
4. Mit Zeitraum: `-AutoReplyState Scheduled -StartTime "01.12.2026 08:00" -EndTime "15.12.2026 17:00"`. Das Datumsformat folgt den Systemeinstellungen. Im Zweifel mit Get-Date gegenprüfen.
5. Kontrolle: `Get-MailboxAutoReplyConfiguration -Identity benutzer@domain.at`.
6. Weiterleitung intern oder extern:
```
Set-Mailbox -Identity benutzer@domain.at -ForwardingSmtpAddress kollege@domain.at -DeliverToMailboxAndForward $true
```
7. Aufheben: `-ForwardingSmtpAddress $null`.

## Hintergrund
Weiterleitungen an externe Adressen können durch Richtlinien gegen Spam blockiert sein. Dann kommen die Mails nicht an. Intern hilft ersatzweise Vollzugriff auf das Postfach.

**Achtung:** Weiterleitungen sind datenschutzrelevant. Nach Ende des Auftrags wieder entfernen und dokumentieren.

## Für das Ticket notieren
Postfach, Auftraggeber, Zeitraum, gesetzte Einstellung und Datum der Aufhebung.

=== ARTIKEL
titel: Postfachgröße und Kontingent in Exchange Online prüfen (Techniker)
bereich: Outlook & E-Mail
tags: postfachgröße, kontingent, quota, get-mailboxstatistics, postfach voll, speicher, exchange online
zielgruppe: technik
---
**Symptom:** Ein Benutzer meldet ein volles Postfach oder kann nicht mehr senden. Oder: Es soll geprüft werden, welche Postfächer sich dem Limit nähern.

**Häufige Ursachen:** große Anhänge, Wachstum über Jahre, ein volles Ordner-Fach „Wiederherstellbare Elemente“.

## Lösung
1. In Exchange Online PowerShell anmelden: `Connect-ExchangeOnline`.
2. Größe und Elementanzahl:
```
Get-MailboxStatistics -Identity benutzer@domain.at | Format-List DisplayName,TotalItemSize,ItemCount
```
3. Limits des Postfachs:
```
Get-Mailbox -Identity benutzer@domain.at | Format-List ProhibitSendQuota,ProhibitSendReceiveQuota,IssueWarningQuota
```
4. Größte Ordner finden:
```
Get-MailboxFolderStatistics -Identity benutzer@domain.at | Sort-Object FolderSize -Descending | Select-Object -First 10 FolderPath,FolderSize
```
5. Auswertung mit dem Benutzer besprechen: Wo liegt der Platz (Anhänge, Gelöschte Elemente, Gesendete Elemente)? Aufräumen lässt der Benutzer selbst (siehe Artikel „Postfach voll“).
6. Reicht das nicht aus, ein Archivpostfach prüfen (siehe Artikel „Archivpostfach und Aufbewahrung aktivieren“).

## Hintergrund
Die Grenzen hängen vom Lizenzplan ab. Dazu im Admin Center oder in der Lizenzbeschreibung nachsehen und die Werte nicht erraten. Freigegebene Postfächer haben ohne Lizenz eine geringere Grenze, je nach Plan.

**Achtung:** Keine Inhalte löschen, solange keine Freigabe des Postfachinhabers vorliegt.

## Für das Ticket notieren
Postfach, Größe, Limits, größte Ordner und vereinbartes Vorgehen.

=== ARTIKEL
titel: Gesendete Mails aus freigegebenem Postfach landen im falschen Ordner (Techniker)
bereich: Outlook & E-Mail
tags: gesendete elemente, freigegebenes postfach, shared mailbox, senden als, kopie, falscher ordner, messagecopyforsentas
zielgruppe: technik
---
**Symptom:** Mitarbeiter senden im Namen eines freigegebenen Postfachs, die gesendete Mail erscheint aber nur im eigenen Ordner „Gesendete Elemente“ und nicht im freigegebenen Postfach. Kollegen sehen die Antwort nicht.

**Häufige Ursachen:** Standardverhalten von Exchange Online: Die Kopie wird im Postfach des Absenders abgelegt, nicht in dem des freigegebenen Postfachs.

## Lösung
1. In Exchange Online PowerShell anmelden: `Connect-ExchangeOnline`.
2. Aktuellen Stand prüfen:
```
Get-Mailbox -Identity postfach@domain.at | Format-List MessageCopyForSentAsEnabled,MessageCopyForSendOnBehalfEnabled
```
3. Für „Senden als“ aktivieren:
```
Set-Mailbox -Identity postfach@domain.at -MessageCopyForSentAsEnabled $true
```
4. Für „Senden im Auftrag“ entsprechend:
```
Set-Mailbox -Identity postfach@domain.at -MessageCopyForSendOnBehalfEnabled $true
```
5. Bei den Benutzern Outlook neu starten und mit einer Testmail aus dem freigegebenen Postfach prüfen.
6. Vorab sicherstellen, dass die Benutzer die passende Berechtigung haben (siehe Artikel „Postfachberechtigungen Vollzugriff und Senden als vergeben“). Der Test ist im Browser und im PC-Outlook zu wiederholen.

## Hintergrund
Die Einstellung wirkt für neu gesendete Mails. Bereits gesendete Mails werden nicht nachträglich kopiert. Bis die Änderung wirkt, kann es etwas dauern.

**Achtung:** Nach der Umstellung liegt eine Kopie im freigegebenen Postfach und eventuell zusätzlich im eigenen Ordner. Das den Benutzern vorab erklären.

## Für das Ticket notieren
Postfach, gesetzte Einstellung, getestete Benutzer und Ergebnis der Testmail.
