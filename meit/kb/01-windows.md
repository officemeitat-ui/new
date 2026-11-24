=== ARTIKEL
titel: PC ist sehr langsam oder braucht ewig zum Starten
bereich: Windows & Arbeitsplatz
tags: langsam, pc langsam, hängt, ruckelt, start dauert lange, träge, performance
zielgruppe: kunde
---
**Symptom:** Der PC reagiert träge, Programme öffnen sich verzögert oder das Hochfahren dauert deutlich länger als früher.

**Häufige Ursachen:** viele gleichzeitig geöffnete Programme oder Browser-Tabs, zu viele Autostart-Programme, fast voller Speicherplatz, ein PC, der nie neu gestartet wird, oder im Hintergrund laufende Updates.

## Lösung
1. Nicht benötigte Programme und Browser-Fenster schließen. Zuvor offene Arbeit speichern.
2. Den PC über **Start → Ein/Aus → Neu starten** neu starten. „Herunterfahren“ reicht nicht immer aus, weil Windows dabei den Zustand teilweise speichert; ein Neustart räumt gründlicher auf.
3. **Strg + Umschalt + Esc** drücken (Task-Manager). Im Reiter **Prozesse** auf die Spalten CPU, Arbeitsspeicher und Datenträger klicken, um nach Verbrauch zu sortieren. Auffällige Programme normal schließen. Systemprozesse nicht beenden.
4. Unter **Einstellungen → System → Speicher** prüfen, ob Laufwerk C: fast voll ist (siehe Artikel zu Laufwerk C:).
5. Unter **Einstellungen → Windows Update** prüfen, ob Updates installiert werden oder ein Neustart aussteht. Während der Installation ist der PC oft für einige Zeit langsam.
6. Autostart-Programme prüfen (siehe Artikel zu Autostart).

## Wenn das nicht hilft
Ticket anlegen und angeben: seit wann der PC langsam ist, ob nur bestimmte Programme betroffen sind, welches Programm im Task-Manager am meisten CPU, Arbeitsspeicher oder Datenträger belegt, und ob kürzlich Programme oder Updates installiert wurden.

=== ARTIKEL
titel: Windows-Update hängt oder schlägt fehl
bereich: Windows & Arbeitsplatz
tags: windows update, update hängt, update fehlgeschlagen, fehler, bleibt bei prozent stehen, neustart
zielgruppe: kunde
---
**Symptom:** Ein Update bleibt bei einem Prozentwert stehen, der Bildschirm zeigt lange „Updates werden konfiguriert“, oder unter Windows Update steht, dass die Installation fehlgeschlagen ist.

**Häufige Ursachen:** zu wenig freier Speicherplatz, ein unterbrochener Download, ein ausstehender Neustart oder eine beschädigte Update-Zwischenablage.

## Lösung
1. Bei der Meldung „Schalten Sie den Computer nicht aus“ **geduldig warten**. Je nach PC kann das über eine Stunde dauern. Erst wenn sich über mehrere Stunden nichts ändert, Ticket anlegen. Den PC nicht eigenmächtig ausschalten.
2. Wenn Windows normal läuft: **Einstellungen → Windows Update** öffnen (je nach Version unter **Update und Sicherheit**). Falls ein Neustart ansteht, diesen ausführen.
3. Auf **Nach Updates suchen** klicken und erneut versuchen.
4. Freien Speicherplatz prüfen unter **Einstellungen → System → Speicher**.
5. Die Problembehandlung starten: **Einstellungen → System → Problembehandlung → Andere Problembehandlungen → Windows Update → Ausführen**. In Windows 10 liegt sie unter **Update und Sicherheit → Problembehandlung → Zusätzliche Problembehandlungen**.
6. PC neu starten und die Suche wiederholen.

## Wenn das nicht hilft
Ticket anlegen. Angeben: Name des fehlgeschlagenen Updates und den angezeigten Fehlercode (zu finden unter **Windows Update → Updateverlauf**), seit wann das Problem besteht und wie viel Speicherplatz auf C: frei ist. Ein Foto des Bildschirms genügt.

=== ARTIKEL
titel: Laufwerk C: ist voll – Speicherplatz schaffen
bereich: Windows & Arbeitsplatz
tags: festplatte voll, laufwerk c voll, speicherplatz, kein platz, speicher, aufräumen
zielgruppe: kunde
---
**Symptom:** Windows meldet, dass der Speicherplatz knapp wird, Programme lassen sich nicht mehr speichern oder Updates schlagen fehl.

**Häufige Ursachen:** viele Dateien im Ordner Downloads, ein voller Papierkorb, temporäre Dateien, große Videos oder Installationsdateien und alte Windows-Updates.

## Lösung
1. **Einstellungen → System → Speicher** öffnen. Dort zeigt Windows, welche Kategorien den Platz belegen.
2. Auf **Temporäre Dateien** klicken. Die Häufchen für Papierkorb, Downloads und temporäre Dateien prüfen und nur Einträge anhaken, die nicht mehr gebraucht werden. Dann **Dateien entfernen** wählen. Hinweis: Den Eintrag „Downloads“ nur anhaken, wenn dort nichts Wichtiges liegt.
3. Den **Papierkorb** auf dem Desktop öffnen und leeren, wenn nichts mehr daraus benötigt wird.
4. Im Ordner **Downloads** große und alte Dateien (Installationsprogramme, doppelte PDFs) löschen oder auf ein Netzlaufwerk verschieben.
5. Unter **Einstellungen → System → Speicher** den **Speichersinn** einschalten (in älteren Windows-10-Ständen „Speicheroptimierung“). Er räumt temporäre Dateien automatisch auf.
6. Keine Systemordner wie `Windows` oder `Programme` von Hand leeren.

## Wenn das nicht hilft
Ticket anlegen. Angeben: wie viel GB auf C: frei sind, welche Kategorie unter **Speicher** am größten ist und ob der PC nur eine Festplatte hat.

=== ARTIKEL
titel: Bluescreen (Stoppfehler) – was notiert werden muss
bereich: Windows & Arbeitsplatz
tags: bluescreen, blauer bildschirm, stoppcode, absturz, neustart, stopp-fehler, bsod
zielgruppe: kunde
---
**Symptom:** Der Bildschirm wird blau, zeigt „Ihr PC hat ein Problem festgestellt“ und startet neu.

**Häufige Ursachen:** fehlerhafte Treiber, defekter Arbeitsspeicher, überhitzte oder defekte Hardware, Fehler nach einem Update oder neu angeschlossene Geräte.

## Lösung
1. Wenn der Bluescreen noch sichtbar ist: **Stoppcode** (Text in Großbuchstaben, z. B. mit Unterstrichen) und eventuell genannte Datei **mit dem Handy fotografieren**. Unter Windows 11 zeigt der Bildschirm außerdem einen QR-Code, der nicht nötig ist.
2. Den PC nicht ausschalten, solange Windows noch „Daten werden gesammelt“ meldet. Der PC startet danach von selbst neu.
3. Nach dem Neustart ungespeicherte Arbeit sichern, soweit vorhanden. Programme können Wiederherstellungsdateien anbieten.
4. Notieren: Uhrzeit, welches Programm gerade lief, ob der Fehler beim Start, beim Arbeiten oder bei einer bestimmten Aktion auftritt.
5. Notieren, was kurz vorher geändert wurde: neues Gerät (USB-Stick, Dockingstation, Drucker), Programm oder Update installiert.
6. Nicht erneut selbst testen und keine Treiber oder Programme auf eigene Faust deinstallieren.

## Wenn das nicht hilft
Ticket anlegen mit: Foto des Bluescreens oder abgeschriebenem Stoppcode, Datum und Uhrzeit, Häufigkeit (einmalig oder wiederholt), Name des PCs und den Notizen aus den Schritten 4 und 5. Bei häufigen Abstürzen den PC nicht weiter für wichtige Arbeit nutzen.

=== ARTIKEL
titel: Anmeldung am PC nicht möglich oder Passwort vergessen
bereich: Windows & Arbeitsplatz
tags: anmelden, passwort vergessen, kennwort falsch, login, gesperrt, sperrbildschirm, anmeldung geht nicht
zielgruppe: kunde
---
**Symptom:** Beim Anmelden erscheint „Das Kennwort ist falsch“ oder eine andere Fehlermeldung, oder das Passwort ist nicht mehr bekannt.

**Häufige Ursachen:** Feststelltaste aktiv, falsches Tastaturlayout, Tippfehler, falscher Benutzername, ein kürzlich geändertes Passwort oder ein nach mehreren Fehlversuchen gesperrtes Konto.

## Lösung
1. Prüfen, ob die **Feststelltaste** (Caps Lock) leuchtet. Die Taste ausschalten.
2. Unten rechts im Anmeldebildschirm die Sprache prüfen (z. B. **DEU**). Mit dem Augensymbol im Passwortfeld lässt sich die Eingabe kurz anzeigen.
3. Prüfen, dass der richtige Benutzername angezeigt wird. Über **Anderer Benutzer** lässt sich ein anderes Konto wählen.
4. Wurde das Passwort kürzlich geändert (z. B. am anderen PC oder im Browser), das neue Passwort verwenden.
5. Nach mehreren Fehlversuchen nicht weiter raten: Das Konto kann vorübergehend gesperrt werden. Einige Minuten warten und einmal sorgfältig erneut versuchen.
6. Bei Laptops: nach einer Änderung muss der PC unter Umständen mit dem Netzwerk verbunden sein, damit das neue Passwort erkannt wird.
7. Ist das Passwort vergessen, kann es nur durch den IT-Dienstleister zurückgesetzt werden. Das Passwort nicht am Telefon oder per E-Mail nennen.

## Wenn das nicht hilft
Ticket anlegen mit: Benutzername, Name des PCs, genauem Wortlaut der Fehlermeldung (Foto) und Zeitpunkt der letzten erfolgreichen Anmeldung. Das Passwort selbst nie angeben.

=== ARTIKEL
titel: Programm reagiert nicht – wie sich ein hängendes Programm beenden lässt
bereich: Windows & Arbeitsplatz
tags: reagiert nicht, programm hängt, eingefroren, task-manager, beenden, abgestürzt, hängt
zielgruppe: kunde
---
**Symptom:** Ein Programmfenster lässt sich nicht bedienen, die Titelleiste zeigt „(Keine Rückmeldung)“ oder das Fenster wird weiß.

**Häufige Ursachen:** das Programm rechnet gerade an einer großen Aufgabe, ein Add-In oder eine große Datei bremst es, zu wenig Arbeitsspeicher oder ein Programmfehler.

## Lösung
1. **1 bis 2 Minuten warten.** Oft arbeitet das Programm noch, etwa beim Öffnen großer Dateien oder beim Speichern auf einem Netzlaufwerk.
2. Prüfen, ob ein Dialogfenster hinter dem Hauptfenster versteckt ist: **Alt + Tab** drücken.
3. Reagiert es weiterhin nicht, mit **Strg + Umschalt + Esc** den Task-Manager öffnen.
4. Im Reiter **Prozesse** das hängende Programm markieren und **Task beenden** wählen. Dabei gehen ungespeicherte Änderungen verloren. Office-Programme bieten beim nächsten Start meist die Wiederherstellung an.
5. Das Programm neu starten.
6. Hängt der gesamte PC, vorher etwa eine Minute warten. Erst dann den Ein/Aus-Schalter einige Sekunden gedrückt halten, um den PC auszuschalten. Das ist die letzte Möglichkeit.

Nicht beenden: Prozesse, die „Windows“ oder „System“ heißen und nicht dem hängenden Programm gehören.

## Wenn das nicht hilft
Ticket anlegen mit: Name des Programms, was kurz vorher getan wurde, ob es jedes Mal oder nur bei einer bestimmten Datei hängt und ob die Datei auf einem Netzlaufwerk liegt.

=== ARTIKEL
titel: Zweiter Bildschirm wird nicht erkannt
bereich: Windows & Arbeitsplatz
tags: zweiter bildschirm, monitor, kein signal, erweitern, dockingstation, anzeige, hdmi
zielgruppe: kunde
---
**Symptom:** Ein angeschlossener Monitor bleibt dunkel, zeigt „Kein Signal“ oder erscheint nicht in den Anzeigeeinstellungen.

**Häufige Ursachen:** ein lockeres Kabel, ein falscher Eingang am Monitor, ein falscher Anzeigemodus oder eine nicht korrekt arbeitende Dockingstation.

## Lösung
1. Monitor eingeschaltet? Netzkabel und Videokabel (HDMI, DisplayPort) an beiden Enden fest einstecken.
2. Am Monitor mit der Eingangstaste (oft „Input“ oder „Source“) den passenden Eingang wählen.
3. **Windows-Taste + P** drücken und **Erweitern** oder **Duplizieren** wählen. Auch wenn „Nur PC-Bildschirm“ eingestellt ist, bleibt der zweite Monitor dunkel.
4. **Einstellungen → System → Bildschirm** öffnen. Unter **Mehrere Bildschirme** auf **Erkennen** klicken (je nach Version erst den Bereich aufklappen).
5. Anderes Kabel oder anderen Anschluss am PC versuchen.
6. Wird eine Dockingstation verwendet: den Monitor testweise direkt am PC anschließen.
7. Den PC neu starten, mit angeschlossenem und eingeschaltetem Monitor.

Keine Treiber von beliebigen Internetseiten installieren.

## Wenn das nicht hilft
Ticket anlegen mit: Modell des Monitors und des PCs, Art des Kabels (HDMI, DisplayPort, USB-C), ob eine Dockingstation im Einsatz ist, und ob der Monitor am selben Kabel an einem anderen PC funktioniert.

=== ARTIKEL
titel: Kein Ton am PC – Lautsprecher oder Headset bleibt stumm
bereich: Windows & Arbeitsplatz
tags: kein ton, lautsprecher, stumm, audio, headset, lautstärke, sound weg
zielgruppe: kunde
---
**Symptom:** Aus Lautsprechern oder Headset kommt kein Ton, oder die Wiedergabe erfolgt über das falsche Gerät.

**Häufige Ursachen:** Ton stumm geschaltet, falsches Ausgabegerät gewählt, lockeres Kabel, leeres Headset oder Programme, die den Ton stumm stellen.

## Lösung
1. Das **Lautsprechersymbol** unten rechts in der Taskleiste prüfen. Ist es durchgestrichen, den Ton einschalten und die Lautstärke erhöhen. Auch die Lautstärketasten am Headset oder an den Lautsprechern prüfen.
2. Kabel der Lautsprecher bzw. des Headsets prüfen. Bei USB- oder Bluetooth-Geräten das Gerät kurz aus- und wieder einstecken bzw. neu verbinden.
3. **Einstellungen → System → Ton** öffnen. Unter **Ausgabe** das richtige Gerät auswählen und die Lautstärke prüfen.
4. Im selben Bereich den **Lautstärkemixer** öffnen (je nach Version Teil der Ton-Einstellungen). Prüfen, ob das betroffene Programm auf null steht.
5. Im Programm selbst (z. B. Videoanruf oder Browser-Tab) prüfen, ob Ton oder Lautsprecher stummgeschaltet sind.
6. **Problembehandlung** für Audio starten: **Einstellungen → System → Problembehandlung → Andere Problembehandlungen** (Windows 10: **Update und Sicherheit → Problembehandlung**).
7. PC neu starten.

## Wenn das nicht hilft
Ticket anlegen mit: Art des Geräts (Lautsprecher, Headset, Monitor-Lautsprecher), ob andere Geräte Ton ausgeben und ob der Ton nur in einem Programm fehlt.

=== ARTIKEL
titel: Uhrzeit oder Datum am PC ist falsch
bereich: Windows & Arbeitsplatz
tags: uhrzeit falsch, datum falsch, zeit, zeitzone, sommerzeit, uhr geht falsch
zielgruppe: kunde
---
**Symptom:** Die Uhr in der Taskleiste zeigt die falsche Zeit oder das falsche Datum, oder Webseiten melden Zertifikatsfehler.

**Häufige Ursachen:** falsche Zeitzone, ausgeschaltete automatische Zeiteinstellung, fehlgeschlagene Synchronisierung oder eine leere Pufferbatterie im PC.

## Lösung
1. **Einstellungen → Zeit und Sprache → Datum und Uhrzeit** öffnen.
2. **Zeitzone automatisch festlegen** einschalten. Falls die Option nicht verfügbar ist, die Zeitzone von Hand wählen: **(UTC+01:00) Amsterdam, Berlin, Bern, Rom, Stockholm, Wien**.
3. **Uhrzeit automatisch festlegen** einschalten.
4. Unter **Weitere Einstellungen** (Windows 10: **Uhr jetzt synchronisieren**) auf **Jetzt synchronisieren** klicken. Dafür muss der PC mit dem Internet oder Firmennetz verbunden sein.
5. Ist die Option ausgegraut oder wird die Zeit sofort wieder verstellt, steuert vermutlich eine Vorgabe des Betriebs die Zeit. Dann nichts von Hand ändern.
6. Geht die Uhr nach jedem Ausschalten falsch oder zeigt ein altes Datum, kann die Batterie der Hauptplatine leer sein. Das kann nur ein Techniker beheben.

## Wenn das nicht hilft
Ticket anlegen mit: angezeigter Uhrzeit und Datum, der tatsächlichen Zeit, der eingestellten Zeitzone und ob der Fehler nach jedem Neustart wiederkehrt.

=== ARTIKEL
titel: Startmenü oder Taskleiste reagiert nicht
bereich: Windows & Arbeitsplatz
tags: startmenü, taskleiste, reagiert nicht, startknopf, hängt, desktop eingefroren, explorer
zielgruppe: kunde
---
**Symptom:** Ein Klick auf Start oder auf Symbole in der Taskleiste bewirkt nichts, die Taskleiste ist eingefroren oder fehlt.

**Häufige Ursachen:** ein hängender Windows-Explorer-Prozess, ein ausstehendes Update, ein fehlerhaftes Programm im Infobereich oder beschädigte Windows-Komponenten.

## Lösung
1. **Strg + Umschalt + Esc** drücken, um den Task-Manager zu öffnen. Falls nur ein kleines Fenster erscheint, links unten auf **Mehr Details** klicken.
2. Im Reiter **Prozesse** den Eintrag **Windows-Explorer** suchen, rechts anklicken und **Neu starten** wählen. Die Taskleiste verschwindet kurz und kommt zurück.
3. Hilft das nicht: **Start → Ein/Aus → Neu starten**. Lässt sich das Startmenü nicht öffnen, **Strg + Alt + Entf** drücken und unten rechts das Ein/Aus-Symbol verwenden.
4. Nach dem Neustart prüfen, ob ein Update ansteht: **Einstellungen → Windows Update** (Einstellungen öffnen mit **Windows-Taste + I**).
5. Kürzlich installierte Programme notieren, die mit dem Problem zusammenfallen.

Wichtig: Nicht auf eigene Faust Befehle aus dem Internet eingeben. Manche löschen Daten oder verändern Windows dauerhaft.

## Wenn das nicht hilft
Ticket anlegen mit: seit wann das Problem besteht, ob es nach einem Neustart kurz verschwindet, welche Programme kurz vorher installiert wurden und ob der Fehler bei einem anderen Benutzer am selben PC ebenfalls auftritt.

=== ARTIKEL
titel: Standardprogramm ändern, z. B. PDF-Dateien mit anderem Programm öffnen
bereich: Windows & Arbeitsplatz
tags: standardprogramm, pdf, öffnen mit, standard-apps, dateityp, falsches programm, pdf öffnet im browser
zielgruppe: kunde
---
**Symptom:** Dateien, etwa PDFs, öffnen sich im falschen Programm, zum Beispiel im Browser statt im PDF-Reader.

**Häufige Ursachen:** nach einem Update oder einer Programminstallation hat Windows den Standard geändert, oder es wurde ein Programm als Vorgabe gewählt.

## Lösung
**Variante 1 – direkt an der Datei**
1. Die Datei mit der rechten Maustaste anklicken und **Öffnen mit → Andere App auswählen** wählen. Unter Windows 11 eventuell zuerst **Weitere Optionen anzeigen**.
2. Das gewünschte Programm auswählen.
3. **Immer diese App zum Öffnen von .pdf-Dateien verwenden** anhaken und bestätigen.

**Variante 2 – in den Einstellungen**
1. **Einstellungen → Apps → Standard-Apps** öffnen.
2. Windows 11: Oben ins Suchfeld den Dateityp eingeben, z. B. `.pdf`, und das Programm wählen. Alternativ das Programm in der Liste anklicken und Dateitypen zuordnen.
3. Windows 10: **Standard-Apps nach Dateityp auswählen** öffnen und `.pdf` suchen.

Hinweis: Ist die Auswahl ausgegraut oder wird sie zurückgesetzt, kann der Betrieb den Standard vorgeben. Dann nichts weiter ändern.

## Wenn das nicht hilft
Ticket anlegen mit: Dateityp, gewünschtem Programm, ob das Programm in der Liste erscheint, und ob die Einstellung nach einem Neustart zurückspringt.

=== ARTIKEL
titel: Autostart-Programme prüfen und ausschalten, damit Windows schneller startet
bereich: Windows & Arbeitsplatz
tags: autostart, programme beim start, startet langsam, hochfahren, task-manager, start beschleunigen
zielgruppe: kunde
---
**Symptom:** Nach der Anmeldung öffnen sich viele Programme von selbst, der PC braucht lange, bis er benutzbar ist.

**Häufige Ursachen:** Programme tragen sich bei der Installation selbst in den Autostart ein, z. B. Chat-, Update- oder Hilfsprogramme.

## Lösung
1. **Strg + Umschalt + Esc** drücken. Falls nur ein kleines Fenster erscheint, **Mehr Details** wählen.
2. Den Bereich **Autostart** öffnen. In Windows 10 ist das ein Reiter, in Windows 11 heißt der Eintrag in der linken Leiste **Autostart-Apps**.
3. Die Spalte **Startauswirkung** zeigt, welche Programme den Start am meisten bremsen.
4. Ein Programm, das nicht sofort benötigt wird, rechts anklicken und **Deaktivieren** wählen. Dadurch wird es nur nicht mehr automatisch gestartet. Es bleibt installiert.
5. Alternativ **Einstellungen → Apps → Autostart** öffnen und dort Programme ausschalten.
6. Den PC neu starten und die Startzeit vergleichen.

Nicht deaktivieren: Einträge mit Bezug zu Virenschutz (z. B. Windows-Sicherheit), zu Treibern der Grafikkarte, Touchpad oder Tastatur sowie Programme, die der Betrieb vorgibt. Im Zweifel erst nachfragen.

## Wenn das nicht hilft
Ticket anlegen mit: Liste der Autostart-Programme (Foto des Task-Managers), Zeit bis zur Benutzbarkeit und seit wann der Start langsam ist.

=== ARTIKEL
titel: Tastatur schreibt falsche Zeichen (Sprache oder Layout)
bereich: Windows & Arbeitsplatz
tags: tastatur, falsche zeichen, z und y vertauscht, layout, sprache, at-zeichen, umschalten
zielgruppe: kunde
---
**Symptom:** Beim Tippen erscheinen andere Zeichen als erwartet, zum Beispiel sind Y und Z vertauscht, das @-Zeichen fehlt oder Sonderzeichen stimmen nicht.

**Häufige Ursachen:** ein zweites Tastaturlayout (z. B. Englisch) wurde versehentlich aktiviert, meist durch ein Tastenkürzel, oder die Num-Taste bzw. Feststelltaste ist gesetzt.

## Lösung
1. In der Taskleiste unten rechts das Sprachkürzel ansehen, z. B. **DEU** oder **ENG**.
2. Mit **Windows-Taste + Leertaste** zwischen den installierten Layouts wechseln, bis wieder **DEU** erscheint. Auch **Alt + Umschalt** kann umschalten.
3. Das richtige Layout dauerhaft prüfen unter **Einstellungen → Zeit und Sprache → Sprache und Region** (Windows 10: **Sprache**). Bei **Deutsch (Österreich)** die Sprachoptionen öffnen und unter **Tastaturen** kontrollieren.
4. Nicht benötigte Layouts nur dann entfernen, wenn sicher ist, dass sie nicht gebraucht werden.
5. Feststelltaste und Num-Taste prüfen. Bei Laptops fehlt der Ziffernblock oft; dort sind Buchstaben bei aktivierter Num-Taste teils mit Ziffern belegt.
6. Das @-Zeichen lässt sich auf einer deutschen Tastatur mit **AltGr + Q** schreiben.

## Wenn das nicht hilft
Ticket anlegen mit: welche Zeichen falsch erscheinen, welches Sprachkürzel angezeigt wird, ob die Tastatur fest am PC oder per Bluetooth/Dockingstation angeschlossen ist und aufgedruckte Tastaturbeschriftung (z. B. QWERTZ).

=== ARTIKEL
titel: Bildschirm steht auf dem Kopf oder Anzeige ist zu groß oder zu klein
bereich: Windows & Arbeitsplatz
tags: bildschirm drehen, skalierung, anzeige zu groß, zu klein, auflösung, kopfstehen, schrift zu klein
zielgruppe: kunde
---
**Symptom:** Der Bildschirminhalt ist gedreht, seitlich gekippt oder Schrift und Symbole sind zu groß oder zu klein.

**Häufige Ursachen:** versehentlich gedrückte Tastenkombination, geänderte Skalierung nach Anschluss eines Monitors oder Beamers oder eine zurückgesetzte Auflösung.

## Lösung
**Bildschirm gedreht**
1. **Einstellungen → System → Bildschirm** öffnen (Einstellungen mit **Windows-Taste + I**).
2. Falls mehrere Bildschirme angezeigt werden, oben den betroffenen auswählen.
3. Bei **Bildschirmausrichtung** (Windows 10: **Ausrichtung**) die Option **Querformat** wählen. Dann **Änderungen beibehalten** bestätigen.
4. Manche Grafiktreiber verwenden Tastenkürzel mit **Strg + Alt + Pfeiltaste**. Ob das auf dem PC funktioniert, hängt vom Treiber ab.

**Alles zu groß oder zu klein**
1. In **Einstellungen → System → Bildschirm** den Eintrag **Skalierung** suchen. Üblich sind 100 % bis 150 %. Ein größerer Wert vergrößert Text und Fenster.
2. Die **Bildschirmauflösung** sollte auf dem mit **(Empfohlen)** markierten Wert stehen.
3. Nach der Änderung kann ein Programm erneut gestartet werden müssen.

Ist nach der Umstellung nichts mehr erkennbar, wartet Windows kurz und stellt die alte Einstellung automatisch wieder her.

## Wenn das nicht hilft
Ticket anlegen mit: Modell des Monitors, eingestellter Auflösung und Skalierung, ob es nach Anschluss eines weiteren Geräts begann.

=== ARTIKEL
titel: Bildschirmfoto erstellen – Screenshot von Fenster oder Bereich
bereich: Windows & Arbeitsplatz
tags: bildschirmfoto, screenshot, snipping, druck-taste, ausschnitt, fehlermeldung abfotografieren
zielgruppe: kunde
---
**Symptom:** Eine Fehlermeldung oder ein Fenster soll für ein Ticket oder zur Dokumentation als Bild festgehalten werden.

**Häufige Ursachen:** keine; es handelt sich um eine Anleitung. Häufig wird nur nicht bemerkt, dass Windows dies bereits eingebaut hat.

## Lösung
1. **Windows-Taste + Umschalt + S** drücken. Der Bildschirm wird abgedunkelt, oben erscheint eine kleine Leiste. Mit der Maus den gewünschten Bereich aufziehen. Das Bild liegt danach in der Zwischenablage. Eine kleine Meldung unten rechts öffnet es zum Bearbeiten und Speichern.
2. Mit **Strg + V** lässt sich das Bild direkt in eine E-Mail, ein Word-Dokument oder ein Ticket einfügen.
3. **Druck**-Taste (je nach Tastatur **PrtSc**): kopiert den gesamten Bildschirm in die Zwischenablage.
4. **Alt + Druck**: kopiert nur das gerade aktive Fenster.
5. **Windows-Taste + Druck**: speichert den ganzen Bildschirm als Datei im Ordner **Bilder → Bildschirmfotos**.
6. Alternativ das Programm **Ausschneiden und Skizzieren** (Windows 10) bzw. **Snipping Tool** (Windows 11) über die Startmenü-Suche öffnen.

Bei Laptops ist die Druck-Taste manchmal mit einer anderen Funktion belegt und nur zusammen mit der **Fn**-Taste nutzbar.

Vor dem Versenden prüfen, dass kein Passwort und keine vertraulichen Daten sichtbar sind.

## Wenn das nicht hilft
Ein Foto des Bildschirms mit dem Handy ist ebenfalls ausreichend für ein Ticket.

=== ARTIKEL
titel: Windows 10 Support-Ende – ist dieser PC für Windows 11 geeignet?
bereich: Windows & Arbeitsplatz
tags: windows 10, support ende, windows 11, upgrade, tpm, kompatibilität, pc-integritätsprüfung
zielgruppe: kunde
---
**Symptom:** Es besteht Unsicherheit, ob ein Windows-10-PC weiter genutzt werden darf und ob er auf Windows 11 umgestellt werden kann.

**Hintergrund:** Der reguläre Support für Windows 10 ist am 14. Oktober 2025 ausgelaufen. Danach gibt es für normale Installationen keine kostenlosen Sicherheitsupdates mehr. Kostenpflichtige erweiterte Sicherheitsupdates sind je nach Lizenzmodell möglich; das klärt der IT-Dienstleister.

**Häufige Ursachen für „nicht geeignet“:** ein zu alter Prozessor, fehlender TPM-2.0-Chip oder dieser ist abgeschaltet, Secure Boot ist aus, zu wenig Arbeitsspeicher (mindestens 4 GB) oder Speicher (mindestens 64 GB).

## Lösung
1. **Einstellungen → System → Info** öffnen. Unter **Windows-Spezifikationen** stehen **Edition** und **Version**. Notieren, ob Windows 10 oder 11 steht.
2. Bei Windows 10: **Einstellungen → Update und Sicherheit → Windows Update** öffnen. Dort steht häufig, ob der PC Windows 11 erhalten kann.
3. Alternativ die App **PC-Integritätsprüfung** über die Startmenü-Suche öffnen, wenn sie installiert ist, und **Jetzt prüfen** wählen.
4. Das Ergebnis und die genannten Gründe notieren.
5. Nicht selbst auf Windows 11 umstellen. Der IT-Dienstleister plant dies mit Datensicherung und Programmprüfung.

## Wenn das nicht hilft
Ticket anlegen mit: Hersteller, Modell und Seriennummer des PCs (Aufkleber an Gerät), Anschaffungsjahr, Ergebnis der Prüfung und den dort genannten Gründen.

=== ARTIKEL
titel: Fenster ist verschwunden oder außerhalb des Bildschirms
bereich: Windows & Arbeitsplatz
tags: fenster weg, außerhalb, nicht sichtbar, verschoben, zweiter monitor, fenster verschwunden, titelleiste
zielgruppe: kunde
---
**Symptom:** Ein Programm läuft laut Taskleiste, ist aber nicht zu sehen, oder das Fenster liegt teilweise außerhalb des Bildschirms.

**Häufige Ursachen:** ein zweiter Monitor wurde abgesteckt, an dem das Fenster zuletzt lag, oder die Auflösung hat sich geändert.

## Lösung
1. Programm in der Taskleiste anklicken, damit es im Vordergrund ist.
2. **Windows-Taste + Pfeil nach oben** drücken. Das Fenster wird maximiert und liegt auf dem sichtbaren Bildschirm.
3. Alternativ **Windows-Taste + Pfeil nach links** oder **rechts**, um das Fenster an eine Bildschirmseite zu heften.
4. Funktioniert das nicht: **Alt + Leertaste** drücken. Es öffnet sich das Fenstermenü mit **Wiederherstellen**, **Verschieben**, **Größe ändern**, **Minimieren**, **Maximieren**, **Schließen**. **Verschieben** wählen, dann mit den **Pfeiltasten** das Fenster holen und mit **Enter** bestätigen.
5. Bei zwei Monitoren: **Windows-Taste + Umschalt + Pfeil nach links** oder **rechts** schiebt das Fenster zwischen den Bildschirmen.
6. Alternativ **Windows-Taste + P** drücken und **Erweitern** wählen. Der zweite Monitor muss dann angeschlossen sein.

## Wenn das nicht hilft
Ticket anlegen mit: Name des Programms, ob ein zweiter Monitor oder eine Dockingstation genutzt wird und ob das Problem nur bei diesem Programm auftritt.

=== ARTIKEL
titel: Datei versehentlich gelöscht – Papierkorb und vorherige Versionen
bereich: Windows & Arbeitsplatz
tags: datei gelöscht, papierkorb, wiederherstellen, vorherige versionen, gelöscht, ordner weg
zielgruppe: kunde
---
**Symptom:** Eine Datei oder ein Ordner wurde gelöscht, überschrieben oder ist verschwunden.

**Häufige Ursachen:** versehentliches Löschen, Speichern am falschen Ort oder überschreiben mit einer falschen Version.

## Lösung
1. Sofort nichts weiter an dem Ordner ändern und keine neuen großen Dateien dorthin speichern.
2. Den **Papierkorb** auf dem Desktop öffnen. Die Datei suchen (oben nach Name suchen), rechts anklicken und **Wiederherstellen** wählen. Sie landet am ursprünglichen Ort.
3. Wurde die Datei auf einem **Netzlaufwerk** gelöscht, liegt sie nicht im Papierkorb des PCs. Dann direkt Ticket anlegen.
4. Bei einer überschriebenen Datei: die Datei oder den Ordner mit der rechten Maustaste anklicken, **Eigenschaften** wählen (unter Windows 11 eventuell über **Weitere Optionen anzeigen**, oder **Alt + Enter**) und den Reiter **Vorherige Versionen** öffnen. Ist dort eine Version aufgelistet, **Öffnen** wählen, um sie anzusehen, und danach **Wiederherstellen** nutzen. Ist die Liste leer, wird keine solche Sicherung geführt.
5. In Office-Programmen unter **Datei → Informationen** prüfen, ob Versionen oder nicht gespeicherte Dateien angeboten werden.

## Wenn das nicht hilft
Ticket anlegen mit: Dateiname und Ordnerpfad, Zeitpunkt des Löschens oder der letzten guten Version und ob die Datei lokal oder auf einem Netzlaufwerk lag. Der IT-Dienstleister prüft, ob eine Sicherung vorhanden ist.

=== ARTIKEL
titel: Datei lässt sich nicht löschen oder verschieben, weil sie in Verwendung ist
bereich: Windows & Arbeitsplatz
tags: datei in verwendung, löschen geht nicht, verschieben, gesperrt, anderes programm geöffnet, zugriff verweigert
zielgruppe: kunde
---
**Symptom:** Windows meldet, dass die Aktion nicht abgeschlossen werden kann, weil die Datei in einem anderen Programm geöffnet ist.

**Häufige Ursachen:** die Datei ist noch in einem Programm offen (auch unsichtbar im Hintergrund), die Vorschau im Explorer hält sie fest, oder auf einem Netzlaufwerk hat eine andere Person die Datei geöffnet.

## Lösung
1. Die Datei in allen Programmen schließen, besonders Word, Excel, PDF-Reader und Bildprogramme. Auch in der Taskleiste nachsehen, ob noch ein zweites Fenster offen ist.
2. Im Explorer das **Vorschaufenster** ausschalten: Registerkarte **Ansicht** öffnen und **Vorschaufenster** abwählen. Die Tastenkombination **Alt + P** schaltet es ebenfalls um.
3. Die Meldung nennt oft das Programm, das die Datei hält. Dieses Programm schließen. Dabei vorher speichern.
4. Bei Netzlaufwerken kurz im Kollegenkreis nachfragen, ob jemand die Datei geöffnet hat.
5. Als letzten Schritt den PC neu starten und es erneut versuchen.

Nicht ausprobieren: fremde Löschprogramme oder Hilfsprogramme aus dem Internet, die Dateien „entsperren“.

Bei der Meldung „Zugriff verweigert“ fehlt die Berechtigung. Dann nichts an Berechtigungen ändern.

## Wenn das nicht hilft
Ticket anlegen mit: vollständigem Pfad der Datei, exaktem Wortlaut der Meldung (Foto) und ob die Datei auf dem PC oder einem Netzlaufwerk liegt.

=== ARTIKEL
titel: Maus oder Touchpad reagiert nicht oder Zeiger springt
bereich: Windows & Arbeitsplatz
tags: maus, touchpad, zeiger, springt, reagiert nicht, kabellose maus, cursor hängt
zielgruppe: kunde
---
**Symptom:** Der Mauszeiger bewegt sich nicht, ruckelt oder springt, oder Klicks werden nicht erkannt.

**Häufige Ursachen:** leere Batterie bei kabelloser Maus, verschmutzter Sensor, lockerer USB-Anschluss, ausgeschaltetes Touchpad am Laptop oder ein ungeeigneter Untergrund.

## Lösung
1. Bei kabelloser Maus Batterie wechseln und den Schalter an der Unterseite prüfen. Den kleinen USB-Empfänger neu einstecken.
2. Kabelgebundene Maus an einem anderen USB-Anschluss testen. Nicht in eine Dockingstation, sondern direkt am PC.
3. Sensor an der Unterseite mit einem trockenen Tuch reinigen und einen anderen Untergrund verwenden. Glatte, glänzende oder durchsichtige Flächen funktionieren schlecht.
4. Laptop: Das Touchpad lässt sich oft mit einer Taste in der oberen Tastenreihe (zusammen mit **Fn**) oder durch zweimaliges Tippen in der Ecke ein- und ausschalten. Je nach Gerät verschieden.
5. **Windows-Taste + I** drücken, mit den Pfeil- und Tab-Tasten navigieren, bis **Bluetooth & Geräte → Maus** (Windows 10: **Geräte → Maus**) erscheint. Dort die Zeigergeschwindigkeit prüfen.
6. Wenn die Maus gar nicht mehr geht, den PC mit der Tastatur neu starten: **Strg + Alt + Entf**, dann unten rechts das Ein/Aus-Symbol mit **Tab** und **Enter** auswählen.

## Wenn das nicht hilft
Ticket anlegen mit: Art der Maus (Kabel, Funk, Bluetooth, Touchpad), ob eine andere Maus am selben PC funktioniert und seit wann das Problem besteht.

=== ARTIKEL
titel: Temporäres Profil wird geladen – „Sie wurden mit einem temporären Profil angemeldet“
bereich: Windows & Arbeitsplatz
tags: temporäres profil, benutzerprofil, desktop leer, profil beschädigt, profilist, .bak, anmeldung
zielgruppe: technik
---
**Symptom:** Nach der Anmeldung ist der Desktop leer, Einstellungen fehlen, und Windows meldet ein temporäres Profil. Änderungen gehen beim Abmelden verloren.

**Häufige Ursachen:** beschädigter Profilschlüssel in der Registry, ein gesperrter Profilordner (z. B. durch Virenscanner oder Backup), volles Laufwerk oder ein nach Abbruch zurückgebliebener `.bak`-Eintrag.

## Lösung
**Achtung:** Registry-Änderung. Vorher unter **Datei → Exportieren** den Schlüssel `ProfileList` sichern. Den Profilordner unter `C:\Users` nicht löschen, nur umbenennen oder kopieren.
1. Betroffenen Benutzer abmelden und mit einem Administratorkonto anmelden. Freien Speicher auf C: prüfen.
2. `regedit` öffnen, zu `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList` gehen.
3. Unter den SID-Schlüsseln anhand von `ProfileImagePath` den Benutzer finden. Gibt es zwei Schlüssel mit gleicher SID, einmal mit Endung `.bak`, so ist der `.bak`-Schlüssel das ursprüngliche Profil.
4. Den Schlüssel ohne `.bak` in `.old` umbenennen. Danach den `.bak`-Schlüssel um die Endung `.bak` kürzen.
5. Im Schlüssel `ProfileImagePath` auf den richtigen Ordner prüfen. `State` und `RefCount` auf `0` setzen.
6. PC neu starten, Benutzer anmelden.
7. Hilft das nicht: unter `C:\Users` eine Kopie des Ordners ziehen, neues Profil durch Anmeldung erzeugen lassen und Daten (Desktop, Dokumente) zurückkopieren.

## Für das Ticket notieren
Ereignisse der Quelle „User Profile Service“ in der Ereignisanzeige (Protokoll **Anwendung**), freier Speicher auf C:, Auffälligkeiten bei Virenschutz oder Backup, SID des Benutzers (`whoami /user`).

=== ARTIKEL
titel: Systemdateien reparieren mit sfc und DISM
bereich: Windows & Arbeitsplatz
tags: sfc, dism, systemdateien, scannow, beschädigt, reparieren, restorehealth, cbs.log
zielgruppe: technik
---
**Symptom:** Windows-Komponenten stürzen ab, Updates schlagen wiederholt fehl, oder Systemprogramme starten nicht.

**Häufige Ursachen:** beschädigte Systemdateien nach Stromausfall, Festplattenfehlern oder abgebrochenen Updates sowie ein beschädigter Komponentenspeicher.

## Lösung
**Achtung:** Läuft lange, der PC sollte am Strom hängen und nicht ausgeschaltet werden. Für Daten ist das Risiko gering, bei Verdacht auf defekte Festplatte zuerst sichern.
1. Eingabeaufforderung oder PowerShell **als Administrator** öffnen.
2. Komponentenspeicher prüfen:
```
DISM /Online /Cleanup-Image /CheckHealth
DISM /Online /Cleanup-Image /ScanHealth
```
3. Reparieren (benötigt Internetzugang oder Quelle, dauert teils lange, Anzeige bleibt zeitweise bei einem Prozentwert stehen):
```
DISM /Online /Cleanup-Image /RestoreHealth
```
4. Danach Systemdateien prüfen:
```
sfc /scannow
```
5. Meldet sfc, Dateien seien repariert worden, den Lauf wiederholen, bis keine Verletzungen mehr gemeldet werden, und neu starten.
6. Meldet sfc nicht reparierbare Dateien, Details auslesen:
```
findstr /c:"[SR]" %windir%\Logs\CBS\CBS.log > "%userprofile%\Desktop\sfclogs.txt"
```
Das DISM-Protokoll liegt unter `%windir%\Logs\DISM\dism.log`.

## Hintergrund
DISM repariert den Komponentenspeicher, aus dem sfc seine Vorlagen holt. Deshalb zuerst DISM, dann sfc.

## Für das Ticket notieren
Wortlaut der Ergebnismeldungen, Ausschnitte der Protokolle und Windows-Version (`winver`).

=== ARTIKEL
titel: Zuverlässigkeitsverlauf und Ereignisanzeige zur Fehlersuche auswerten
bereich: Windows & Arbeitsplatz
tags: zuverlässigkeitsverlauf, ereignisanzeige, eventvwr, absturz, protokoll, kernel-power, fehlersuche
zielgruppe: technik
---
**Symptom:** Ein PC stürzt unregelmäßig ab, friert ein oder startet ungeplant neu, und die Ursache ist unklar.

**Häufige Ursachen:** Treiber- oder Programmfehler, Stromprobleme, Festplattenfehler oder fehlgeschlagene Updates, die sich im Protokoll zeitlich zuordnen lassen.

## Lösung
1. **Zuverlässigkeitsverlauf:** `perfmon /rel` ausführen (alternativ **Systemsteuerung → Sicherheit und Wartung → Wartung → Zuverlässigkeitsverlauf anzeigen**). Die Zeitleiste zeigt Anwendungsfehler, Windows-Fehler, Warnungen und Installationen. Einen Tag mit rotem Kreuz anklicken, unten erscheinen die **Technischen Details**.
2. **Ereignisanzeige:** `eventvwr.msc` öffnen, **Windows-Protokolle → System** wählen.
3. Rechts **Aktuelles Protokoll filtern** wählen, **Kritisch**, **Fehler** und einen passenden Zeitraum setzen.
4. Hinweise auf Ursachen:
   - **Kernel-Power** (Ereignis-ID 41, kritisch): PC wurde ohne sauberes Herunterfahren beendet.
   - **BugCheck** (ID 1001): enthält den Stoppcode eines Bluescreens.
   - Quellen **disk** oder **Ntfs**: Hinweise auf Datenträgerprobleme.
5. Programmfehler stehen unter **Windows-Protokolle → Anwendung**.
6. Per PowerShell:
```
Get-WinEvent -FilterHashtable @{LogName='System'; Level=1,2; StartTime=(Get-Date).AddDays(-2)} | Select-Object TimeCreated, ProviderName, Id, Message -First 30
```
7. Ereignisse unmittelbar vor dem Fehler beachten, nicht nur den Fehler selbst. Zeitpunkt mit Installationen im Zuverlässigkeitsverlauf abgleichen.

## Für das Ticket notieren
Zeitpunkte, Ereignisquellen und -IDs, Wortlaut der Meldung sowie kurz davor installierte Software oder Updates.

=== ARTIKEL
titel: Speicherabbilder und Minidump nach einem Bluescreen finden
bereich: Windows & Arbeitsplatz
tags: minidump, memory.dmp, speicherabbild, bluescreen, dump, windbg, absturzanalyse
zielgruppe: technik
---
**Symptom:** Für die Analyse eines Bluescreens werden die gespeicherten Absturzdaten benötigt.

**Häufige Ursachen für fehlende Dumps:** Auslagerungsdatei deaktiviert oder zu klein, Einstellung auf „Kein Speicherabbild“, zu wenig Platz auf C: oder ein Aufräumprogramm hat die Dateien gelöscht.

## Lösung
1. Orte der Dateien (Administratorrechte nötig):
   - kleines Speicherabbild: `C:\Windows\Minidump` (Dateien `*.dmp`)
   - Kernel- oder Komplettabbild: `C:\Windows\MEMORY.DMP`
2. Auflisten per PowerShell:
```
Get-ChildItem C:\Windows\Minidump | Sort-Object LastWriteTime -Descending
```
3. Einstellungen prüfen: `sysdm.cpl`, Reiter **Erweitert**, **Starten und Wiederherstellen → Einstellungen**. Unter **Debuginformationen speichern** steht z. B. **Kleines Speicherabbild**, **Kernelspeicherabbild** oder **Automatisches Speicherabbild** (Bezeichnungen je nach Version).
4. Kopie der Dateien auf einen anderen Datenträger legen, nicht direkt im Systemordner analysieren.
5. Analyse mit WinDbg aus den Windows-Debugging-Tools: Datei öffnen, Symbole laden und `!analyze -v` ausführen. Ergebnis nennt Stoppcode und den vermuteten Treiber.
6. Fehlt die Auslagerungsdatei, unter **Leistung → Einstellungen → Erweitert → Virtueller Arbeitsspeicher** prüfen. Für Dumps muss auf dem Systemlaufwerk eine Auslagerungsdatei vorhanden sein.

**Achtung:** Komplette Abbilder enthalten Speicherinhalte (auch Passwörter oder Dokumente). Vertraulich behandeln, nicht per E-Mail weitergeben.

## Für das Ticket notieren
Dateinamen mit Datum, Stoppcode, vermuteter Treiber, aktuelle Treiberversion.

=== ARTIKEL
titel: Datenträgerbereinigung und WinSxS – Speicher sicher freigeben
bereich: Windows & Arbeitsplatz
tags: datenträgerbereinigung, winsxs, cleanmgr, windows.old, komponentenspeicher, dism, platz schaffen
zielgruppe: technik
---
**Symptom:** C: ist voll, der Ordner `C:\Windows\WinSxS` erscheint sehr groß, oder Updates scheitern an zu wenig Platz.

**Häufige Ursachen:** angesammelte Update-Reste, ältere Windows-Installation (`Windows.old`), Treiberpakete und Protokolle.

## Lösung
**Achtung:** `WinSxS` nie von Hand leeren oder Dateien darin löschen. Das kann Windows unbrauchbar machen. Größenangaben im Explorer sind irreführend, weil viele Dateien Verknüpfungen auf andere Orte sind.
1. Als Administrator `cleanmgr` ausführen, Laufwerk C: wählen und **Systemdateien bereinigen** klicken.
2. Eintrag **Bereinigung von Windows Update** anhaken. **Vorherige Windows-Installation(en)** nur anhaken, wenn kein Zurückkehren zur alten Version mehr nötig ist. Danach ist die Rückkehr nicht mehr möglich.
3. Komponentenspeicher analysieren:
```
DISM /Online /Cleanup-Image /AnalyzeComponentStore
```
4. Wenn die Analyse eine Bereinigung empfiehlt:
```
DISM /Online /Cleanup-Image /StartComponentCleanup
```
5. Der Zusatz `/ResetBase` entfernt zusätzlich die Möglichkeit, installierte Updates zu deinstallieren. **Achtung:** nicht rückgängig zu machen, nur bei echtem Platzmangel und nach Prüfung.
6. Für Serienläufe: `cleanmgr /sageset:1` einmal einrichten, danach `cleanmgr /sagerun:1` ausführen.
7. Speicher mit **Einstellungen → System → Speicher** erneut prüfen.

## Für das Ticket notieren
Freier Platz vorher und nachher, Ausgabe der Analyse (Größe des Komponentenspeichers) und größte Verursacher.

=== ARTIKEL
titel: Windows-Update-Komponenten zurücksetzen (SoftwareDistribution und catroot2)
bereich: Windows & Arbeitsplatz
tags: windows update, reset, softwaredistribution, catroot2, update-komponenten, bits, wuauserv, update fehler
zielgruppe: technik
---
**Symptom:** Windows Update findet nichts, lädt nicht herunter oder scheitert dauerhaft, auch nach Neustart und Problembehandlung.

**Häufige Ursachen:** beschädigter Update-Zwischenspeicher, hängende Dienste oder ein beschädigter Komponentenspeicher.

## Lösung
**Achtung:** Der Updateverlauf wird danach unter Umständen leer angezeigt, und die erneute Suche kann lange dauern. Vorher auf freien Platz (mindestens einige GB) prüfen und zuerst `DISM` und `sfc` ausführen (siehe Artikel dazu).
1. Eingabeaufforderung **als Administrator** öffnen.
2. Dienste anhalten:
```
net stop wuauserv
net stop cryptSvc
net stop bits
net stop msiserver
```
3. Zwischenspeicher umbenennen (nicht löschen, damit ein Zurück möglich bleibt):
```
ren C:\Windows\SoftwareDistribution SoftwareDistribution.old
ren C:\Windows\System32\catroot2 catroot2.old
```
4. Dienste wieder starten:
```
net start wuauserv
net start cryptSvc
net start bits
net start msiserver
```
5. PC neu starten, unter **Einstellungen → Windows Update** auf **Nach Updates suchen** klicken.
6. Läuft alles, die `.old`-Ordner später löschen.
7. Zur Fehleranalyse in PowerShell `Get-WindowsUpdateLog` ausführen. Es erzeugt standardmäßig eine Datei `WindowsUpdate.log` auf dem Desktop.

## Für das Ticket notieren
Fehlercode aus dem Updateverlauf, Meldungen beim Stoppen der Dienste und Ergebnis der Neusuche.

=== ARTIKEL
titel: Windows-Version, Edition und Aktivierungsstatus ermitteln
bereich: Windows & Arbeitsplatz
tags: windows version, build, edition, aktivierung, winver, systeminfo, slmgr, lizenz
zielgruppe: technik
---
**Symptom:** Für Support, Updates oder Inventur werden Version, Edition und Aktivierung eines PCs benötigt, oder Windows zeigt „Windows ist nicht aktiviert“.

**Häufige Ursachen für Aktivierungsmeldungen:** Hardwareänderung (z. B. Hauptplatine), falscher Lizenzschlüssel, nicht erreichbarer Aktivierungsserver oder abgelaufene Testversion.

## Lösung
1. Kurzübersicht: `winver` ausführen. Sie zeigt Version und Build.
2. Detailansicht: **Einstellungen → System → Info**. Unter **Windows-Spezifikationen** stehen Edition, Version und Build, oben Gerätename und Prozessor.
3. Per Eingabeaufforderung:
```
systeminfo | findstr /B /C:"Betriebssystemname" /C:"Betriebssystemversion"
```
Die Bezeichnungen sind auf einem deutschen System deutsch.
4. Aktivierungsstatus: **Einstellungen → System → Aktivierung** (Windows 10: **Update und Sicherheit → Aktivierung**).
5. Per Befehl, als Administrator:
```
slmgr /dli
slmgr /xpr
```
`/dli` zeigt Lizenzinformationen, `/xpr` zeigt, ob und wie lange die Aktivierung gilt.
6. Nach Hardwaretausch zeigt die Aktivierungsseite eine Option für die Problembehandlung. Diese erst nach Prüfung der Lizenz nutzen.
7. Keinen Lizenzschlüssel in Tickets oder E-Mails schreiben.

## Für das Ticket notieren
Version und Build, Edition, Gerätename, Aktivierungsstatus, Fehlermeldung im Wortlaut, letzte Hardwareänderung.

=== ARTIKEL
titel: Windows startet nicht – Wiederherstellungsumgebung und abgesicherter Modus
bereich: Windows & Arbeitsplatz
tags: windows startet nicht, wiederherstellung, abgesicherter modus, starthilfe, winre, reagentc, systemwiederherstellung
zielgruppe: technik
---
**Symptom:** Windows bleibt beim Start hängen, landet in einer Neustartschleife oder zeigt „Automatische Reparatur wird vorbereitet“.

**Häufige Ursachen:** fehlgeschlagene Updates, fehlerhafte Treiber, beschädigte Systemdateien oder Datenträgerfehler.

## Lösung
**Achtung:** Bei aktivierter BitLocker-Verschlüsselung wird der Wiederherstellungsschlüssel verlangt. Vor dem Eingriff sicherstellen, dass er vorliegt. Bei Verdacht auf Festplattendefekt zuerst Daten sichern.
1. Wiederherstellungsumgebung aufrufen: Nach mehreren fehlgeschlagenen Starts öffnet Windows sie automatisch. Bei laufendem Windows **Umschalt** gedrückt halten und **Neu starten** wählen.
2. **Problembehandlung → Erweiterte Optionen** öffnen. Verfügbare Punkte (je nach Version): **Starthilfe**, **Eingabeaufforderung**, **Systemwiederherstellung**, **Updates deinstallieren**, **Starteinstellungen**.
3. Zuerst **Starthilfe** versuchen.
4. Danach **Updates deinstallieren** (neuestes Qualitätsupdate) oder **Systemwiederherstellung**, sofern Wiederherstellungspunkte existieren.
5. Abgesicherter Modus: **Starteinstellungen → Neu starten**, danach **4** oder **F4** für den abgesicherten Modus. Dort Treiber oder Programme entfernen, die mit dem Problem zusammenfallen.
6. In laufendem Windows prüft `reagentc /info` (Administrator), ob die Wiederherstellungsumgebung aktiviert ist.
7. Nach der Fehlersuche im abgesicherten Modus prüfen, dass `msconfig` nicht dauerhaft auf **Abgesicherter Start** steht.

## Für das Ticket notieren
Angezeigte Meldung, letzte Änderung vor dem Fehler, BitLocker ja/nein, verwendete Optionen und Ergebnis.

=== ARTIKEL
titel: Hohe CPU-, Arbeitsspeicher- oder Datenträgerauslastung analysieren
bereich: Windows & Arbeitsplatz
tags: auslastung, cpu 100 prozent, datenträger 100 prozent, ressourcenmonitor, tiworker, msmpeng, searchindexer, speicher
zielgruppe: technik
---
**Symptom:** Der PC ist spürbar langsam, der Lüfter dreht hoch oder der Task-Manager zeigt dauerhaft sehr hohe Auslastung.

**Häufige Ursachen:** laufende Updates, Virenscans, Dateiindizierung, ein klassisches Festplattenlaufwerk (HDD) statt SSD, zu wenig Arbeitsspeicher oder ein fehlerhaftes Programm.

## Lösung
1. Task-Manager öffnen (**Strg + Umschalt + Esc**). Reiter **Prozesse** nach CPU, Arbeitsspeicher und Datenträger sortieren. Im Reiter **Leistung** das Gesamtbild und die Art des Datenträgers (HDD oder SSD) ansehen.
2. Detail mit dem Ressourcenmonitor: `resmon`. Reiter **Datenträger** zeigt, welche Prozesse welche Dateien lesen oder schreiben.
3. Typische Verursacher einordnen:
   - `TiWorker.exe` (Windows Modules Installer Worker): Updates werden verarbeitet, abwarten.
   - `MsMpEng.exe` (Antimalware Service Executable): Scan läuft.
   - `SearchIndexer.exe`: Indizierung, meist nur zeitweise.
4. Per PowerShell:
```
Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Name, CPU, WS
Get-PhysicalDisk | Select-Object FriendlyName, MediaType, HealthStatus
```
5. Datenträger-Zustand prüfen und bei einer HDD über Austausch gegen eine SSD nachdenken.
6. Arbeitsspeicher: Liegt die Nutzung dauerhaft nahe dem Maximum, ist mehr RAM sinnvoll.
7. Autostart und freien Platz auf C: prüfen.

**Achtung:** Systemprozesse nicht beenden. Verdächtige Programme erst dokumentieren, dann entfernen.

## Für das Ticket notieren
Screenshots von Task-Manager und Ressourcenmonitor, Datenträgertyp, RAM-Größe, Zeitraum der Last.

=== ARTIKEL
titel: Gerätetreiber-Problem im Gerätemanager beheben und Treiber zurücksetzen
bereich: Windows & Arbeitsplatz
tags: treiber, gerätemanager, devmgmt, ausrufezeichen, treiber zurücksetzen, pnputil, gerät funktioniert nicht
zielgruppe: technik
---
**Symptom:** Ein Gerät (Grafik, Audio, Touchpad, Dockingstation) arbeitet nicht oder fehlerhaft. Im Gerätemanager steht ein gelbes Ausrufezeichen oder ein Gerät fehlt.

**Häufige Ursachen:** fehlender oder neuer fehlerhafter Treiber nach einem Update, inkompatible Herstellertreiber oder Hardwaredefekt.

## Lösung
**Achtung:** Bei Grafik- und Netzwerkkarten kann die Anzeige oder Verbindung kurz unterbrechen. Vorher sicherstellen, dass ein passender Treiber lokal verfügbar ist. Wiederherstellungspunkt anlegen, wenn Systemschutz aktiv ist.
1. `devmgmt.msc` öffnen. Betroffenes Gerät suchen, Doppelklick, Reiter **Allgemein**. Dort steht der Gerätestatus im Klartext. Diesen notieren.
2. Reiter **Treiber** öffnen. Version und Datum notieren. War der Treiber vorher funktionsfähig, **Vorheriger Treiber** wählen (nur sichtbar, wenn ein Vorgänger gespeichert ist).
3. Sonst **Treiber aktualisieren → Automatisch nach Treibern suchen**. Besser den Treiber der Herstellerseite für Modell und Windows-Version verwenden.
4. Windows Update zeigt teils Treiber unter **Einstellungen → Windows Update → Erweiterte Optionen → Optionale Updates** (Windows 10: **Optionale Updates anzeigen**).
5. Bleibt der Fehler: Gerät über **Gerät deinstallieren** entfernen, dann **Aktion → Nach geänderter Hardware suchen** ausführen. Ein vorhandener Treiber wird neu installiert.
6. Installierte Treiberpakete anzeigen:
```
pnputil /enum-drivers
```
7. USB-Geräte testweise an einem anderen Anschluss prüfen.

## Für das Ticket notieren
Gerätename, Hersteller-ID falls bekannt, Gerätestatus im Klartext, Treiberversion vor und nach der Änderung.
