=== ARTIKEL
titel: Mac ist langsam oder ein Programm reagiert nicht – Sofort beenden
bereich: Mac, iPhone & iPad
tags: mac, langsam, hängt, programm reagiert nicht, sofort beenden, regenbogen, aktivitätsanzeige
zielgruppe: kunde
---
**Symptom:** Der Mac arbeitet zäh, der bunte Wartecursor (Farbrad) dreht sich, oder ein Programm lässt sich nicht mehr bedienen.

**Häufige Ursachen:** ein hängendes Programm, zu viele gleichzeitig geöffnete Programme, ein seit Wochen nicht neu gestarteter Mac oder fast voller Speicher.

## Lösung
1. Kurz warten, manche Programme brauchen nach dem Öffnen großer Dateien einige Minuten.
2. Reagiert ein Programm weiter nicht: Im Apple-Menü (Apfel links oben) **Sofort beenden …** wählen, das Programm markieren und **Sofort beenden** klicken. Alternativ **Befehl + Wahl + Esc** drücken.
3. Nicht gespeicherte Änderungen können dabei verloren gehen. Beim nächsten Start bietet das Programm oft eine Wiederherstellung an.
4. Ist der ganze Mac langsam: alle nicht benötigten Programme mit **Befehl + Q** beenden.
5. Den Mac über das Apple-Menü **Neustart …** neu starten. Das hilft erstaunlich oft.
6. Freien Speicher prüfen: Im Apple-Menü **Über diesen Mac** öffnen und bei Speicher nachsehen (je nach Version unter **Weitere Infos**). Bleibt kaum Platz frei, helfen Aufräumen und Löschen großer Dateien.
7. Zeigt das Programm **Aktivitätsanzeige** (Programme → Dienstprogramme) einen Vorgang mit dauerhaft sehr hoher Auslastung, dessen Namen notieren.

## Wenn das nicht hilft
- Ticket anlegen mit: Name des Programms, was zuletzt geschehen ist, Mac-Modell und macOS-Version (Apple-Menü → Über diesen Mac), seit wann das Problem besteht und ob ein Neustart geholfen hat.

=== ARTIKEL
titel: macOS aktualisieren – Vorbereitung und Ablauf am Firmen-Mac
bereich: Mac, iPhone & iPad
tags: macos, update, aktualisieren, upgrade, softwareupdate, neustart, mac
zielgruppe: kunde
---
**Symptom:** Der Mac meldet, dass ein Update bereitsteht, oder ein größeres macOS-Upgrade wird angeboten. Unklar ist, ob und wann es installiert werden soll.

**Häufige Ursachen:** Unsicherheit, ob Programme (zum Beispiel Office oder Branchensoftware) mit der neuen Version funktionieren, zu wenig freier Speicher oder ein leerer Akku.

## Lösung
1. Bei großen Versionssprüngen (neue Hauptversion von macOS) zuerst bei der IT nachfragen. Nicht jede Fachsoftware ist sofort kompatibel.
2. Offene Dokumente speichern und alle Programme beenden.
3. Prüfen, dass genügend freier Speicher vorhanden ist. Bei großen Updates sind oft mehrere Gigabyte nötig.
4. Sicherstellen, dass eine aktuelle Sicherung vorliegt (siehe Artikel zu Time Machine) und das Netzteil angeschlossen ist.
5. Update öffnen: **Systemeinstellungen → Allgemein → Softwareupdate** (je nach Version nur **Systemeinstellungen → Softwareupdate**).
6. **Jetzt aktualisieren** bzw. **Jetzt neu starten** wählen. Der Mac startet mehrmals neu, der Bildschirm kann zwischendurch schwarz sein. Das ist normal.
7. Den Vorgang nicht unterbrechen und den Deckel nicht schließen. Je nach Update dauert es 20 Minuten bis über eine Stunde.
8. Danach Outlook, OneDrive und Drucker kurz auf Funktion prüfen.

## Wenn das nicht hilft
- Ticket anlegen mit: aktueller macOS-Version, Wortlaut der Meldung, freiem Speicher und ob der Vorgang abgebrochen oder festgefahren ist.
- Den Mac bei hängendem Update nicht eigenmächtig ausschalten, sondern zuerst die IT anrufen.

=== ARTIKEL
titel: Drucker am Mac hinzufügen – Netzwerkdrucker einrichten
bereich: Mac, iPhone & iPad
tags: mac, drucker, hinzufügen, airprint, netzwerkdrucker, drucken, einrichten
zielgruppe: kunde
---
**Symptom:** Am Mac erscheint der Bürodrucker nicht in der Druckauswahl, oder ein neuer Drucker soll eingerichtet werden.

**Häufige Ursachen:** der Mac ist nicht im selben Netzwerk wie der Drucker (zum Beispiel im Gäste-WLAN), der Drucker ist ausgeschaltet oder es fehlt der passende Treiber.

## Lösung
1. Prüfen, dass der Mac im Firmen-WLAN oder per Kabel im Firmennetz hängt und der Drucker eingeschaltet ist.
2. **Systemeinstellungen → Drucker & Scanner** öffnen.
3. Unter der Druckerliste auf **Drucker, Scanner oder Fax hinzufügen** (Plus-Symbol) klicken.
4. Den Drucker in der Liste auswählen. Moderne Netzwerkdrucker erscheinen oft mit dem Zusatz **AirPrint** oder **Bonjour**.
5. Im Feld **Verwenden** den vorgeschlagenen Treiber belassen. Wird eine Auswahl angeboten, bevorzugt den Eintrag mit AirPrint oder dem Namen des Herstellers wählen.
6. **Hinzufügen** klicken, gegebenenfalls Zusatzoptionen wie Papierfach bestätigen.
7. Eine Testseite aus einem beliebigen Programm mit **Befehl + P** drucken.
8. Erscheint der Drucker nicht, im Reiter für IP-Adressen die Adresse des Druckers eintragen, falls die IT sie genannt hat.

## Wenn das nicht hilft
- Ticket anlegen mit: Druckername und Standort, Meldung am Mac, macOS-Version und ob Drucken von einem Windows-PC funktioniert.
- Keine Treiber aus unbekannten Quellen installieren, sondern bei der IT nachfragen.

=== ARTIKEL
titel: Windows-Freigabe oder Netzlaufwerk am Mac verbinden
bereich: Mac, iPhone & iPad
tags: mac, netzlaufwerk, freigabe, smb, mit server verbinden, laufwerk, finder
zielgruppe: kunde
---
**Symptom:** Am Mac sind die Ordner vom Firmenserver oder NAS nicht sichtbar. Das Netzlaufwerk, das am Windows-PC vorhanden war, fehlt.

**Häufige Ursachen:** der Mac ist nicht im Firmennetz oder VPN, die Serveradresse ist falsch geschrieben oder die Anmeldedaten stimmen nicht.

## Lösung
1. Sicherstellen, dass der Mac im Firmennetz oder per VPN verbunden ist.
2. Im Finder im Menü **Gehe zu → Mit Server verbinden …** wählen (oder **Befehl + K**).
3. Die Adresse eintragen, die die IT mitgeteilt hat, zum Beispiel in der Form `smb://servername/freigabe`.
4. **Verbinden** klicken, mit dem Firmenbenutzernamen und dem Kennwort anmelden. Bei Domänenkonten kann der Benutzername in der Form `domäne\benutzer` verlangt werden, das gibt die IT vor.
5. Wird die Option angeboten, das Kennwort im Schlüsselbund zu sichern, nur auf dem eigenen, persönlichen Mac zustimmen.
6. Die Freigabe erscheint danach in der Seitenleiste des Finders unter **Orte** bzw. **Standorte**.
7. Soll sie nach dem Anmelden automatisch erscheinen: Das Laufwerk ins Dock bzw. unter **Systemeinstellungen → Allgemein → Anmeldeobjekte** (je nach Version) hinzufügen.

## Wenn das nicht hilft
- Ticket anlegen mit: verwendeter Adresse, genauer Fehlermeldung, ob VPN verbunden ist und ob der Zugriff am Windows-PC funktioniert.
- Kennwörter nie ins Ticket schreiben.

=== ARTIKEL
titel: Outlook und Microsoft 365 am Mac einrichten
bereich: Mac, iPhone & iPad
tags: mac, outlook, microsoft 365, einrichten, konto, office, anmelden
zielgruppe: kunde
---
**Symptom:** Auf einem neuen oder anderen Mac soll Outlook mit dem Firmenkonto eingerichtet werden, oder Office-Programme fordern zur Anmeldung auf.

**Häufige Ursachen:** Office ist noch nicht installiert, die Anmeldung erfolgt mit einem privaten statt dem Firmenkonto oder die Zwei-Faktor-Anmeldung wird nicht abgeschlossen.

## Lösung
1. Prüfen, ob Outlook bereits unter **Programme** im Finder vorhanden ist. Falls nicht, die IT um die Installation bitten.
2. Outlook öffnen und **Konto hinzufügen** wählen, beim ersten Start erscheint der Assistent von selbst.
3. Die Firmen-E-Mail-Adresse eintragen (zum Beispiel `vorname.nachname@firma.at`) und auf **Weiter** klicken.
4. Auf der Microsoft-Anmeldeseite das Kennwort eingeben und die Zwei-Faktor-Bestätigung in der Authenticator-App freigeben.
5. Bei der Frage nach Konto-Typ nicht eigenmächtig POP oder IMAP wählen. Für Microsoft 365 wird das Konto automatisch erkannt.
6. Warten, bis Posteingang, Kalender und Kontakte geladen sind. Das dauert bei großen Postfächern einige Minuten.
7. In Word oder Excel unten links bzw. oben rechts prüfen, dass mit dem Firmenkonto angemeldet ist. Je nach Version heißt die Stelle **Konto** oder **Anmelden**.
8. Zusätzlich bei Bedarf OneDrive einrichten (siehe eigener Artikel).

## Wenn das nicht hilft
- Ticket anlegen mit: E-Mail-Adresse, Wortlaut der Fehlermeldung, Version von Outlook (Outlook → Über Outlook) und macOS-Version.
- Kennwörter nie ins Ticket schreiben.

=== ARTIKEL
titel: OneDrive am Mac – Synchronisierung einrichten und Probleme beheben
bereich: Mac, iPhone & iPad
tags: onedrive, mac, synchronisieren, sync, wolke, dateien auf abruf, menüleiste
zielgruppe: kunde
---
**Symptom:** OneDrive-Dateien erscheinen am Mac nicht im Finder, die Synchronisierung steht still oder das Wolkensymbol in der Menüleiste zeigt eine Warnung.

**Häufige Ursachen:** OneDrive ist nicht angemeldet, das Programm läuft nicht, der Speicherplatz am Mac ist knapp oder eine Datei hat ein unzulässiges Zeichen im Namen.

## Lösung
1. In der Menüleiste oben rechts nach dem Wolkensymbol von OneDrive suchen. Fehlt es, OneDrive aus **Programme** öffnen.
2. Beim ersten Start mit der Firmen-E-Mail-Adresse anmelden und den Anweisungen folgen. Den Speicherort des Ordners nur ändern, wenn die IT es vorgibt.
3. Fragt macOS nach Berechtigungen (zum Beispiel für Dateien und Ordner), diese erlauben. Je nach Version stehen sie unter **Systemeinstellungen → Datenschutz & Sicherheit**.
4. Auf das Wolkensymbol klicken. Dort erscheint der Status und eine Liste der Fehler.
5. Dateien mit Namen, die Zeichen wie `:` `?` `*` oder `|` enthalten, umbenennen.
6. Bei **Pausiert** auf die Meldung klicken und **Synchronisierung fortsetzen** wählen.
7. Dateien, die nur in der Wolke liegen, werden beim Öffnen geladen. Dafür muss eine Internetverbindung bestehen.
8. Als Letztes OneDrive beenden und neu starten, danach den Mac neu starten.

## Wenn das nicht hilft
- Ticket anlegen mit: Text der Meldung beim Klick auf das Wolkensymbol, betroffener Ordner oder Dateiname, macOS-Version und freier Speicher.
- OneDrive nicht eigenmächtig zurücksetzen oder Ordner löschen.

=== ARTIKEL
titel: Tastatur am Mac – @, €, Sonderzeichen und wichtige Kürzel für Umsteiger
bereich: Mac, iPhone & iPad
tags: mac tastatur, at zeichen, euro, wahltaste, befehlstaste, kürzel, umsteiger
zielgruppe: kunde
---
**Symptom:** Nach dem Wechsel von Windows auf den Mac lassen sich @, € oder Klammern nicht finden, und Strg-Kürzel funktionieren nicht.

**Häufige Ursachen:** Auf dem Mac heißen die Tasten anders: **Befehl** (⌘) ersetzt meist Strg, **Wahl** (⌥) ersetzt Alt Gr.

## Lösung
Bei deutscher Tastaturbelegung gilt (je nach eingestelltem Layout kann es abweichen):
1. **@**: Wahl + L
2. **€**: Wahl + E
3. **Eckige Klammern** [ ]: Wahl + 5 und Wahl + 6
4. **Geschweifte Klammern** { }: Wahl + 8 und Wahl + 9
5. **Senkrechter Strich** |: Wahl + 7
6. **Tilde** ~: Wahl + N, danach die Leertaste
7. **Backslash** \: Wahl + Umschalt + 7

Wichtige Kürzel:

| Aktion | Mac |
| --- | --- |
| Kopieren / Einfügen / Ausschneiden | Befehl + C / V / X |
| Rückgängig | Befehl + Z |
| Speichern | Befehl + S |
| Programm beenden | Befehl + Q |
| Fenster schließen | Befehl + W |
| Zwischen Programmen wechseln | Befehl + Tab |
| Suche (Spotlight) | Befehl + Leertaste |

Entfernen nach rechts: **Fn + Rückschritt**. Ob das richtige Layout gewählt ist, zeigt **Systemeinstellungen → Tastatur** (je nach Version mit Eingabequellen).

## Wenn das nicht hilft
- Ticket anlegen mit: Tastaturmodell, eingestelltem Layout, welches Zeichen fehlt oder falsch erscheint und was stattdessen getippt wird.

=== ARTIKEL
titel: Bildschirmfoto am Mac erstellen – Screenshot von Fenster oder Bereich
bereich: Mac, iPhone & iPad
tags: mac, screenshot, bildschirmfoto, bildschirmaufnahme, ausschnitt, kürzel
zielgruppe: kunde
---
**Symptom:** Am Mac soll ein Bildschirmfoto aufgenommen werden, die Windows-Taste „Druck“ gibt es nicht.

**Häufige Ursachen:** Die Kürzel sind anders als unter Windows. Außerdem ist unklar, wo das Bild abgelegt wird.

## Lösung
1. **Ganzer Bildschirm:** Umschalt + Befehl + 3 drücken.
2. **Bereich auswählen:** Umschalt + Befehl + 4 drücken, dann mit gedrückter Maustaste einen Rahmen aufziehen. Mit Esc abbrechen.
3. **Einzelnes Fenster:** Umschalt + Befehl + 4 drücken, dann die Leertaste. Der Zeiger wird zur Kamera. Auf das gewünschte Fenster klicken.
4. **Auswahlleiste mit allen Optionen** (auch Bildschirmaufnahme als Video): Umschalt + Befehl + 5.
5. Das Bild erscheint kurz als Vorschau in der Ecke und wird standardmäßig auf dem Schreibtisch abgelegt. Der Speicherort lässt sich in der Auswahlleiste über **Optionen** ändern.
6. **Direkt in die Zwischenablage** statt als Datei: zusätzlich die **Control-Taste** gedrückt halten, zum Beispiel Control + Umschalt + Befehl + 4. Danach mit Befehl + V in eine Mail oder ein Dokument einfügen.
7. Vor dem Weitergeben prüfen, ob auf dem Bild Kennwörter, Kundendaten oder Mails sichtbar sind.

## Wenn das nicht hilft
- Ticket anlegen mit: verwendetem Kürzel, was passiert (nichts, Fehlermeldung), macOS-Version. In manchen Versionen verhindert eine Datenschutz-Einstellung die Aufnahme, das kann die IT prüfen.

=== ARTIKEL
titel: Time Machine einrichten und prüfen, ob der Mac gesichert wird
bereich: Mac, iPhone & iPad
tags: time machine, mac, sicherung, backup, externe festplatte, datensicherung
zielgruppe: kunde
---
**Symptom:** Unklar ist, ob die Daten am Mac gesichert werden, oder Time Machine meldet, dass die letzte Sicherung zu lange her ist.

**Häufige Ursachen:** die externe Festplatte ist nicht angesteckt, der Platz auf dem Sicherungsmedium ist voll oder Time Machine wurde nie eingerichtet.

## Lösung
1. Prüfen, ob für den Mac eine Firmenregel gilt: Oft sind Daten in OneDrive oder auf dem Server gesichert, dann ist Time Machine nur eine Ergänzung. Im Zweifel die IT fragen.
2. Eine externe Festplatte anschließen. Sie sollte ausschließlich für die Sicherung dienen.
3. **Systemeinstellungen → Allgemein → Time Machine** öffnen (je nach Version **Systemeinstellungen → Time Machine**).
4. **Sicherungsvolume hinzufügen** bzw. **Sicherungsvolume auswählen** klicken, die Festplatte auswählen und bestätigen. Eine Verschlüsselung der Sicherung anbieten lassen und das Kennwort sicher aufbewahren.
5. Den Status prüfen: In den Einstellungen steht, wann die letzte Sicherung stattgefunden hat. Die Uhrzeit sollte aktuell sein.
6. Zusätzlich im Menü der Menüleiste die Anzeige für Time Machine einblenden lassen, falls vorhanden.
7. Die Festplatte regelmäßig anschließen, am besten täglich beim Arbeitsbeginn.

## Wenn das nicht hilft
- Ticket anlegen mit: Zeitpunkt der letzten Sicherung, Wortlaut der Meldung, Modell der Festplatte und macOS-Version.
- Das Sicherungsvolume nicht eigenmächtig löschen oder neu formatieren.

=== ARTIKEL
titel: Mac an Beamer oder zweiten Bildschirm anschließen
bereich: Mac, iPhone & iPad
tags: mac, beamer, bildschirm, monitor, hdmi, spiegeln, adapter, zweiter bildschirm
zielgruppe: kunde
---
**Symptom:** Am Mac bleibt der Beamer oder der zusätzliche Bildschirm schwarz, oder das Bild erscheint falsch (gespiegelt, verzerrt).

**Häufige Ursachen:** fehlender oder ungeeigneter Adapter, lockeres Kabel, falscher Eingang am Beamer oder eine nicht passende Anzeigeeinstellung.

## Lösung
1. Prüfen, welchen Anschluss der Mac hat (je nach Modell USB-C/Thunderbolt oder HDMI). Dazu passend das richtige Kabel oder einen Adapter verwenden.
2. Beamer oder Monitor einschalten und am Gerät den richtigen Eingang wählen (zum Beispiel HDMI 1).
3. Kabel auf beiden Seiten fest einstecken. Erst dann den Mac prüfen.
4. **Systemeinstellungen → Displays** öffnen. Dort sollte das zweite Gerät erscheinen. Falls nicht, in der Fenstermitte **Displays erkennen** halten (Wahltaste gedrückt halten, falls die Schaltfläche fehlt).
5. Im Bereich für das zweite Display die Anordnung wählen: **Erweitern** (zusätzliche Fläche) oder **Spiegeln** (gleiches Bild, ideal für Präsentationen).
6. Bei unscharfem Bild die Auflösung am zweiten Display auf den empfohlenen Wert stellen.
7. Fehlt der Ton, in den Toneinstellungen den Ausgang auf den Beamer stellen.
8. Nach der Präsentation das Kabel erst nach dem Ausschalten des Beamers abziehen.

## Wenn das nicht hilft
- Ticket anlegen mit: Mac-Modell, verwendetem Kabel oder Adapter, Modell von Beamer oder Monitor und ob die Anzeige an einem anderen Gerät funktioniert.

=== ARTIKEL
titel: Schlüsselbund am Mac fragt ständig nach dem Passwort
bereich: Mac, iPhone & iPad
tags: schlüsselbund, mac, passwort, fragt ständig, keychain, kennwort geändert, anmeldung
zielgruppe: kunde
---
**Symptom:** Programme wie Outlook, Teams oder Safari fragen immer wieder nach dem Kennwort, oder eine Meldung nennt den Schlüsselbund „Anmeldung“.

**Häufige Ursachen:** Das Anmeldekennwort des Macs wurde geändert (zum Beispiel über das Firmenkonto), der Schlüsselbund kennt das neue Kennwort nicht, oder ein Programm hat ein veraltetes gespeichertes Kennwort.

## Lösung
1. Die Abfrage genau lesen: Fragt sie nach dem Kennwort für den Schlüsselbund, das bisherige Mac-Anmeldekennwort eingeben (das von früher, bevor es geändert wurde).
2. Bei **Immer erlauben** nur zustimmen, wenn das Programm vertrauenswürdig und bekannt ist.
3. Fragt ein einzelnes Programm, dort das aktuelle Firmenkennwort neu eingeben und die Zwei-Faktor-Anmeldung bestätigen.
4. Den Mac einmal neu starten, die Abfragen verschwinden oft danach.
5. Ist das alte Kennwort nicht mehr bekannt: Nichts zurücksetzen oder löschen. Der Schlüsselbund würde dabei geleert und gespeicherte Kennwörter wären weg.
6. Meldungen mit der Aufforderung, Kennwörter für unbekannte Programme einzugeben, nicht bestätigen. Bei Unsicherheit abbrechen und die IT fragen.

## Wenn das nicht hilft
- Ticket anlegen mit: Wortlaut der Meldung, welches Programm fragt, ob das Mac-Kennwort kürzlich geändert wurde, macOS-Version.
- Kennwörter nie ins Ticket schreiben.

=== ARTIKEL
titel: Dateien mit AirDrop zwischen Mac, iPhone und iPad übertragen
bereich: Mac, iPhone & iPad
tags: airdrop, mac, iphone, ipad, dateien übertragen, fotos, senden, empfangen
zielgruppe: kunde
---
**Symptom:** Ein Foto oder Dokument soll vom iPhone auf den Mac (oder umgekehrt) übertragen werden, aber das andere Gerät erscheint nicht in AirDrop.

**Häufige Ursachen:** AirDrop ist auf „Empfang aus“ gestellt, WLAN oder Bluetooth sind ausgeschaltet, die Geräte sind zu weit auseinander oder der Bildschirm des Empfängers ist gesperrt.

## Lösung
1. Auf beiden Geräten WLAN und Bluetooth einschalten. Ein Hotspot sollte ausgeschaltet sein.
2. Am iPhone oder iPad im Kontrollzentrum die Funkgruppe gedrückt halten und **AirDrop** antippen. Am Mac im Finder **Gehe zu → AirDrop** oder in der Seitenleiste **AirDrop** wählen.
3. Als Sichtbarkeit **Nur Kontakte** oder **Alle für 10 Minuten** wählen (je nach Version). Für Geräte ohne gemeinsamen Kontakt ist **Alle für 10 Minuten** nötig.
4. Beide Bildschirme entsperren, die Geräte nahe zusammenbringen.
5. Am Sender die Datei öffnen, auf **Teilen** tippen und **AirDrop** und das Zielgerät wählen.
6. Am Empfänger **Annehmen** wählen. Dateien am Mac landen meist im Ordner **Downloads**.
7. Keine Dateien von unbekannten Absendern annehmen.
8. Sensible Firmendaten nur auf Firmengeräte übertragen, nicht auf private Geräte, sofern die Firma es nicht erlaubt.

## Wenn das nicht hilft
- Ticket anlegen mit: beteiligten Geräten und deren Versionen, Sichtbarkeitseinstellung und genauer Meldung.

=== ARTIKEL
titel: iPhone-Speicher ist voll – Platz schaffen ohne Datenverlust
bereich: Mac, iPhone & iPad
tags: iphone, speicher voll, speicherplatz, fotos, apps, iphone-speicher, löschen
zielgruppe: kunde
---
**Symptom:** Das iPhone meldet „Speicher voll“, Fotos oder Updates lassen sich nicht mehr speichern oder installieren.

**Häufige Ursachen:** viele Fotos und Videos, große Offline-Dateien in Mail- oder Chat-Apps, selten genutzte Apps und der Cache von Programmen.

## Lösung
1. **Einstellungen → Allgemein → iPhone-Speicher** öffnen. Nach kurzer Berechnung zeigt die Liste, was am meisten Platz braucht.
2. Fotos und Videos prüfen: Wichtige Aufnahmen vorher sichern (iCloud oder Computer), danach unnötige löschen. Gelöschte Fotos bleiben in **Zuletzt gelöscht** (Fotos-App → Alben) und geben erst nach dem dortigen Löschen Platz frei.
3. Große, selten genutzte Apps in der Liste antippen und **App auslagern** wählen. Die Daten bleiben erhalten, nur das Programm wird entfernt.
4. In WhatsApp und ähnlichen Chat-Apps große Videos aus Chats entfernen. Dienstliche Chat-Inhalte vorher mit der IT abstimmen.
5. In Safari kann der Verlauf gelöscht werden (**Einstellungen → Apps → Safari** bzw. je nach Version **Einstellungen → Safari**). Dabei werden gespeicherte Seitendaten entfernt, Anmeldungen müssen eventuell neu erfolgen.
6. Den Hinweis auf geladene Musik und Videos in Streaming-Apps prüfen und Offline-Downloads entfernen.
7. Zum Schluss das iPhone neu starten.

## Wenn das nicht hilft
- Ticket anlegen mit: iPhone-Modell, Gesamtspeicher, was laut **iPhone-Speicher** am meisten belegt und ob es sich um ein Firmen- oder Privatgerät handelt.
- Keine Apps löschen, die von der Firma vorgegeben sind (zum Beispiel Outlook, Authenticator).

=== ARTIKEL
titel: iPhone sichern – iCloud-Backup oder Sicherung am Computer
bereich: Mac, iPhone & iPad
tags: iphone, backup, sicherung, icloud, finder, itunes, sichern, datensicherung
zielgruppe: kunde
---
**Symptom:** Vor einem Update, Gerätewechsel oder einer Reparatur soll das iPhone gesichert werden. Unklar ist, ob bereits ein aktuelles Backup besteht.

**Häufige Ursachen:** Das iCloud-Backup ist ausgeschaltet, der iCloud-Speicher ist voll, oder das Gerät ist nicht oft genug im WLAN und am Strom.

## Lösung
**Variante A: iCloud**
1. **Einstellungen**, oben auf den eigenen Namen tippen, dann **iCloud** wählen. Dort **iCloud-Backup** öffnen (die genaue Bezeichnung kann je nach Version abweichen).
2. Den Schalter einschalten und **Jetzt sichern** antippen. Das iPhone muss dabei im WLAN sein, am besten am Ladegerät.
3. Unter dem Schalter steht, wann das letzte Backup erfolgte.
4. Ist der iCloud-Speicher voll, entweder Speicher bei Apple erweitern (nach Rücksprache mit der Firma) oder Variante B nutzen.

**Variante B: Computer**
1. Das iPhone per Kabel an den Mac anschließen und im Finder das Gerät in der Seitenleiste wählen. Am Windows-PC das Programm Apple Geräte bzw. iTunes verwenden (je nach Version).
2. **Jetzt sichern** klicken. Mit **Lokales Backup verschlüsseln** werden auch gespeicherte Kennwörter gesichert. Das Kennwort dafür gut aufbewahren.

Ein Backup ersetzt nicht die Firmendaten in Microsoft 365 und auf dem Server.

## Wenn das nicht hilft
- Ticket anlegen mit: Art des Backups, Fehlermeldung, iOS-Version, freiem iCloud-Speicher und ob es ein Firmengerät ist.

=== ARTIKEL
titel: iPhone verloren oder gestohlen – „Wo ist?“ nutzen
bereich: Mac, iPhone & iPad
tags: iphone verloren, wo ist, find my, gestohlen, verloren-modus, orten, sperren
zielgruppe: kunde
---
**Symptom:** Das iPhone (oder iPad) ist nicht mehr auffindbar oder wurde gestohlen.

**Häufige Ursachen:** vergessen im Büro, im Auto oder unterwegs. Bei Diebstahl besteht die Gefahr, dass Firmendaten wie Mails und Chats offen sind.

## Lösung
1. Sofort die IT informieren, bei Diensthandys auch die Vorgesetzten. Die IT kann den Zugriff auf Firmendaten sperren.
2. Wenn „Wo ist?“ eingeschaltet war, ein anderes Gerät mit demselben Apple-Account nehmen und die App **Wo ist?** öffnen. Alternativ im Browser auf der Webseite von iCloud anmelden und **Wo ist?** wählen.
3. Das Gerät in der Liste auswählen. Der Standort wird nur angezeigt, wenn es online ist.
4. **Ton abspielen** nutzen, wenn das Gerät vermutlich in der Nähe liegt.
5. **Als verloren markieren** bzw. **Verloren-Modus** aktivieren: Das Gerät wird gesperrt, eine Telefonnummer kann angezeigt werden.
6. **Gerät löschen** nur nach Rücksprache mit der IT wählen. Danach ist Orten nicht mehr möglich. Bei Diebstahl nicht selbst zur Abholung gehen, sondern Anzeige bei der Polizei erstatten.
7. Die SIM-Karte beim Mobilfunkanbieter sperren lassen.
8. Passwörter wichtiger Konten ändern, sobald die IT es bestätigt.

## Wenn das nicht hilft
- Ticket anlegen mit: Gerät und Rufnummer, Zeitpunkt und Ort des Verlusts, ob „Wo ist?“ aktiv war und ob das Gerät gesperrt war.

=== ARTIKEL
titel: Passwort des Apple-Accounts vergessen – zurücksetzen
bereich: Mac, iPhone & iPad
tags: apple-account, apple id, passwort vergessen, zurücksetzen, anmeldung, wiederherstellung
zielgruppe: kunde
---
**Symptom:** Die Anmeldung beim Apple-Account (früher Apple-ID) klappt nicht, etwa beim App Store, iCloud oder bei „Wo ist?“.

**Häufige Ursachen:** das Passwort wurde vergessen oder geändert, der Account ist aus Sicherheitsgründen gesperrt, oder der Bestätigungscode geht an ein altes Gerät oder eine alte Rufnummer.

## Lösung
1. Zuerst klären, ob es ein privater oder ein von der Firma verwalteter Apple-Account ist. Bei einem verwalteten Account setzt die IT das Passwort zurück, die folgenden Schritte entfallen.
2. Am iPhone: **Einstellungen**, oben auf den Namen tippen, **Anmeldung & Sicherheit** und **Passwort ändern** wählen (je nach Version). Dafür muss der Code des iPhones bekannt sein.
3. Ist das iPhone nicht angemeldet: Auf der Anmeldeseite **Passwort vergessen?** antippen und den Anweisungen folgen.
4. Die Bestätigung erfolgt über ein vertrauenswürdiges Gerät oder eine hinterlegte Rufnummer. Ein Code wird nur an dieses Gerät gesendet und niemals weitergegeben.
5. Gibt es keinen Zugriff auf diese Möglichkeiten, bietet Apple eine Kontowiederherstellung an. Sie kann einige Tage dauern, in dieser Zeit nicht ständig neue Anfragen starten.
6. Ein neues Passwort wählen, das nirgendwo sonst verwendet wird. Ein Passwort-Manager hilft.
7. Betrügerische Mails oder SMS mit Links zur „Entsperrung“ ignorieren.

## Wenn das nicht hilft
- Ticket anlegen mit: privatem oder verwaltetem Account, Meldung auf dem Bildschirm, welche Geräte noch angemeldet sind.
- Passwörter und Bestätigungscodes nie ins Ticket schreiben.

=== ARTIKEL
titel: iOS-Update lässt sich nicht installieren oder bleibt hängen
bereich: Mac, iPhone & iPad
tags: ios, update, iphone, ipad, softwareupdate, fehlgeschlagen, installieren, speicher
zielgruppe: kunde
---
**Symptom:** Am iPhone oder iPad bricht das Update ab, die Meldung lautet „Update konnte nicht installiert werden“, oder der Fortschrittsbalken bleibt lange stehen.

**Häufige Ursachen:** zu wenig freier Speicher, schwaches WLAN, niedriger Akkustand oder ein Update, das noch heruntergeladen wird.

## Lösung
1. **Einstellungen → Allgemein → Softwareupdate** öffnen und den angezeigten Stand lesen.
2. Das Gerät an das Ladegerät anschließen und mit einem stabilen WLAN verbinden, mobile Daten reichen oft nicht.
3. Freien Speicher prüfen (**Einstellungen → Allgemein → iPhone-Speicher** bzw. iPad-Speicher). Wenn nötig, Platz schaffen, Fotos vorher sichern.
4. Vor großen Updates ein Backup erstellen (siehe Artikel zur Sicherung).
5. Bei Abbruch das Gerät neu starten und das Update erneut anstoßen.
6. Bei einem laufenden Update mit Apfel-Logo und Balken: Bis zu eine Stunde warten und das Gerät in Ruhe lassen.
7. Bei Firmengeräten kann die IT Updates verzögern oder vorgeben. Dann erscheint das neueste Update eventuell nicht, bevor die Firma es freigibt.
8. Das Gerät nicht eigenmächtig zurücksetzen oder im Wiederherstellungsmodus löschen.

## Wenn das nicht hilft
- Ticket anlegen mit: Gerätemodell, aktueller iOS-Version, genauer Meldung, freiem Speicher und Ladestand.

=== ARTIKEL
titel: iPad in Besprechungen – Notizen, Unterschreiben und zweiter Bildschirm
bereich: Mac, iPhone & iPad
tags: ipad, besprechung, notizen, unterschreiben, pdf, apple pencil, sidecar, zweiter bildschirm
zielgruppe: kunde
---
**Symptom:** Das iPad soll in Besprechungen genutzt werden: Notizen machen, Dokumente unterschreiben oder als zusätzlicher Bildschirm für den Mac dienen. Es ist unklar, wie das geht.

**Häufige Ursachen:** unbekannte Funktionen, ein Stift ist nicht gekoppelt, oder der Mac und das iPad sind nicht mit demselben Apple-Account angemeldet.

## Lösung
1. **Notizen:** Die App **Notizen** öffnen und ein neues Dokument anlegen. Mit dem Apple Pencil oder dem Finger kann handschriftlich geschrieben werden. Der Bereich für Zeichnen und Texteingabe lässt sich über die Werkzeugleiste wechseln.
2. **PDF unterschreiben:** Das PDF in **Dateien** oder in der Mail-App öffnen, das Stiftsymbol für Markierungen antippen und dort die Unterschrift hinzufügen (je nach Version unter dem Plus-Symbol). Danach das Dokument teilen oder speichern.
3. **Vertrauliches:** Bei Verträgen oder Kundendaten gelten die Vorgaben der Firma. Unterschriebene Dokumente nur über freigegebene Wege versenden.
4. **Teams:** Die App **Teams** installieren, mit dem Firmenkonto anmelden und Besprechungen über den Kalender beitreten.
5. **iPad als zweiter Bildschirm am Mac:** Möglich bei neueren Mac- und iPad-Modellen. Beide Geräte mit demselben Apple-Account anmelden, WLAN und Bluetooth einschalten. Am Mac in den Einstellungen unter **Displays** das iPad als zusätzliches Display hinzufügen (je nach Version).
6. Bei Besprechungen das iPad auf **Nicht stören** stellen.

## Wenn das nicht hilft
- Ticket anlegen mit: iPad- und Mac-Modell, Software-Versionen, Name der App und genauer Beschreibung, wo es hakt.

=== ARTIKEL
titel: iPhone verbindet sich nicht mit dem WLAN
bereich: Mac, iPhone & iPad
tags: iphone, wlan, wifi, verbindet nicht, kein internet, netzwerk, ipad
zielgruppe: kunde
---
**Symptom:** Das iPhone findet das Firmen-WLAN nicht, bleibt beim Verbinden hängen oder zeigt „Falsches Passwort“ bzw. „Keine Internetverbindung“.

**Häufige Ursachen:** das WLAN-Kennwort wurde geändert, der Flugmodus ist aktiv, ein veraltetes Netzwerk ist gespeichert, oder der Router oder Access Point hat eine Störung.

## Lösung
1. Flugmodus im Kontrollzentrum prüfen. Einmal ein- und wieder ausschalten.
2. **Einstellungen → WLAN** öffnen und sicherstellen, dass WLAN eingeschaltet ist und das richtige Netzwerk gewählt wurde (nicht das Gäste-WLAN).
3. Prüfen, ob andere Geräte, zum Beispiel ein Notebook, im selben WLAN Internet haben. Wenn nicht, liegt es am Netz, nicht am iPhone.
4. Beim Netzwerk auf das Info-Symbol (i) tippen und **Dieses Netzwerk ignorieren** wählen. Danach neu verbinden und das aktuelle Kennwort eingeben, das die IT mitgeteilt hat.
5. Im selben Bildschirm kann es eine Option **Private WLAN-Adresse** geben. Hat das Netzwerk besondere Vorgaben, die Einstellung nur nach Rücksprache mit der IT ändern.
6. Das iPhone neu starten.
7. Ein VPN oder einen Filter-Profil-Hinweis nicht eigenmächtig entfernen.
8. Die Netzwerkeinstellungen zurücksetzen nur nach Anweisung der IT, weil dadurch alle gespeicherten WLAN-Kennwörter gelöscht werden.

## Wenn das nicht hilft
- Ticket anlegen mit: Name des WLAN, genauer Meldung, ob andere Geräte funktionieren, Ort im Gebäude und iOS-Version. Kennwörter nie ins Ticket schreiben.

=== ARTIKEL
titel: Firmen-Apps über das Unternehmensportal am iPhone, iPad oder Mac installieren
bereich: Mac, iPhone & iPad
tags: unternehmensportal, company portal, intune, apps installieren, firmen-app, iphone, mac
zielgruppe: kunde
---
**Symptom:** Eine Firmen-App ist nicht auf dem Gerät, oder die IT verweist auf das Unternehmensportal. Es ist unklar, wie die App dort gefunden wird.

**Häufige Ursachen:** das Gerät ist noch nicht in der Firmenverwaltung registriert, die Anmeldung erfolgte mit einem privaten Konto, oder die App wurde dem Benutzer nicht zugewiesen.

## Lösung
1. Die App **Unternehmensportal** (englisch Company Portal) öffnen. Ist sie nicht vorhanden, bei der IT nachfragen, ob und wie sie bereitgestellt wird.
2. Mit dem Firmenkonto anmelden (Firmen-E-Mail-Adresse und Kennwort) und die Zwei-Faktor-Anmeldung bestätigen.
3. Wenn die App dazu auffordert, das Gerät zu registrieren, den angezeigten Schritten folgen. Dabei werden Profile mit Einstellungen der Firma geladen. Das Unternehmensportal erklärt, was die Firma damit einsehen kann.
4. Im Bereich für **Apps** die gewünschte App suchen und **Installieren** antippen.
5. Am iPhone oder iPad kann zusätzlich eine Bestätigung der Verwaltung verlangt werden, diese akzeptieren.
6. Nach der Installation die App öffnen und sich mit dem Firmenkonto anmelden.
7. Fehlt die App in der Liste, die Seite aktualisieren, kurz warten und es erneut versuchen. Nicht zugewiesene Apps erscheinen nicht.

## Wenn das nicht hilft
- Ticket anlegen mit: Gerät und Version, Name der App, Text der Meldung und ob das Gerät bereits im Unternehmensportal als registriert angezeigt wird.

=== ARTIKEL
titel: Mac in die Geräteverwaltung von Microsoft 365 (Intune) aufnehmen – Überblick
bereich: Mac, iPhone & iPad
tags: mac, intune, mdm, geräteverwaltung, registrierung, unternehmensportal, apns, microsoft 365
zielgruppe: technik
---
**Symptom:** Ein Firmen-Mac soll wie die Windows-PCs verwaltet werden (Richtlinien, Verschlüsselung, Apps). Es fehlt der Überblick über Voraussetzungen und Wege.

**Häufige Ursachen:** fehlendes Apple-Push-Zertifikat in Intune, ein Mac mit privatem Apple-Account, bereits fertig eingerichtete Geräte ohne automatische Registrierung, fehlende Lizenz für den Benutzer.

## Lösung
1. Voraussetzungen prüfen: passende Intune-Lizenz für den Benutzer und Intune als MDM-Instanz im Mandanten.
2. Apple-MDM-Push-Zertifikat in Intune einrichten. Es wird mit einem Apple-Account beantragt und muss regelmäßig erneuert werden. Den verwendeten Account und das Ablaufdatum dokumentieren.
3. Den Weg wählen: automatische Registrierung über Apple Business Manager (siehe eigener Artikel, für neue Geräte vorzuziehen) oder manuelle Registrierung über das Unternehmensportal am bereits genutzten Mac.
4. Bei manueller Registrierung: Unternehmensportal installieren, mit dem Firmenkonto anmelden und das Verwaltungsprofil in den Systemeinstellungen bestätigen (Bereich **Datenschutz & Sicherheit → Profile**, je nach Version).
5. Danach Richtlinien zuweisen: FileVault, Updates, Kennwortregeln, WLAN- und Zertifikatsprofile, Apps.
6. Das Gerät im Intune-Portal auf Konformität und Zeitpunkt der letzten Synchronisierung prüfen.

**Achtung:** Bei manueller Registrierung ist das Gerät nicht überwacht, einzelne Funktionen stehen dann nicht zur Verfügung.

## Wenn das nicht hilft
- Für das Ticket notieren: Seriennummer, macOS-Version, Registrierungsweg, Meldung im Unternehmensportal, Status im Intune-Portal.

=== ARTIKEL
titel: Apple Business Manager und automatische Geräteregistrierung – Überblick
bereich: Mac, iPhone & iPad
tags: apple business manager, abm, automatische registrierung, dep, seriennummer, zero touch, intune, mdm
zielgruppe: technik
---
**Symptom:** Neue Macs, iPhones oder iPads sollen schon beim ersten Einschalten in die Firmenverwaltung gelangen, ohne dass jemand sie einzeln vorbereitet.

**Häufige Ursachen:** Geräte wurden nicht über einen Händler im Apple Business Manager (ABM) hinterlegt, der MDM-Server-Token fehlt oder ist abgelaufen, oder das Registrierungsprofil ist keinem Gerät zugewiesen.

## Lösung
1. Für das Unternehmen einen Apple Business Manager einrichten. Die Anmeldung und Prüfung der Organisation verlangt Angaben, die Apple vorgibt. Zugangsdaten dokumentieren und mindestens zwei Verantwortliche eintragen.
2. Im ABM einen MDM-Server für Intune anlegen und den Token im Intune-Portal hinterlegen. Der Token läuft ab und muss erneuert werden.
3. Geräte dem ABM zuordnen: durch den Händler bei Neukauf, oder für vorhandene Geräte über den dafür vorgesehenen Weg von Apple Configurator (je nach Version).
4. In Intune ein Registrierungsprofil anlegen und den Geräten zuweisen. Dort wird festgelegt, welche Schritte im Setup-Assistenten erscheinen und ob das Gerät überwacht wird.
5. Beim ersten Start meldet sich das Gerät mit WLAN und Firmenkonto an und erhält Richtlinien und Apps automatisch.
6. Das Gerät im Intune-Portal prüfen.

**Achtung:** Geräte, die bereits in Gebrauch sind, werden bei nachträglicher Aufnahme unter Umständen erst nach einem Zurücksetzen automatisch registriert. Vorher Daten sichern.

## Wenn das nicht hilft
- Für das Ticket notieren: Seriennummern, Händler, Status im ABM und in Intune, Ablaufdatum des Tokens.

=== ARTIKEL
titel: FileVault am Mac aktivieren und Wiederherstellungsschlüssel verwahren
bereich: Mac, iPhone & iPad
tags: filevault, mac, verschlüsselung, wiederherstellungsschlüssel, festplatte, intune, recovery key
zielgruppe: technik
---
**Symptom:** Ein Mac soll verschlüsselt werden, oder nach vergessenem Kennwort wird der Wiederherstellungsschlüssel gebraucht. Unklar ist, wo er liegt.

**Häufige Ursachen:** FileVault wurde ohne dokumentierten Schlüssel eingeschaltet, der Schlüssel liegt im privaten iCloud-Account eines Mitarbeiters, oder der Mac wird nicht über Intune verwaltet.

## Lösung
1. Status prüfen: In Terminal `fdesetup status` ausführen oder **Systemeinstellungen → Datenschutz & Sicherheit → FileVault** öffnen (je nach Version).
2. Aktivierung bei verwalteten Geräten über eine Intune-Richtlinie für FileVault, die den Schlüssel hinterlegt (Treuhand). Vor dem Rollout testen.
3. Manuell: FileVault einschalten und **Wiederherstellungsschlüssel erstellen** wählen. Die Option, ihn im iCloud-Account zu speichern, bei Firmengeräten nicht verwenden.
4. Schlüssel nur im Passwortspeicher der IT oder im Intune-Portal ablegen, nicht im Ticket im Klartext.
5. Bei Bedarf Schlüssel im Intune-Portal beim betroffenen Gerät abrufen (der Zugriff wird protokolliert) und den Benutzer anleiten.

**Achtung:** Ohne Kennwort und Schlüssel sind die Daten unwiederbringlich verloren. Vor dem ersten Einschalten Sicherung prüfen. Die Verschlüsselung läuft danach im Hintergrund, der Mac sollte am Strom hängen.

## Hintergrund
Apple-Silicon-Macs verschlüsseln den internen Speicher immer in der Hardware. FileVault bindet den Schlüssel zusätzlich an das Benutzerkennwort.

## Wenn das nicht hilft
- Für das Ticket notieren: Modell, macOS-Version, FileVault-Status, Verwaltungsstatus, Ort des hinterlegten Schlüssels.

=== ARTIKEL
titel: Mac zurücksetzen und neu aufsetzen (Wiederherstellungsmodus)
bereich: Mac, iPhone & iPad
tags: mac zurücksetzen, neu aufsetzen, wiederherstellungsmodus, macos neu installieren, löschen, recovery
zielgruppe: technik
---
**Symptom:** Ein Mac soll für einen neuen Benutzer gelöscht werden, oder das System ist so beschädigt, dass es neu installiert werden muss.

**Häufige Ursachen:** Aktivierungssperre, nicht gesicherte Daten, fehlende Internetverbindung im Wiederherstellungsmodus oder ein verwaltetes Gerät, das nach dem Löschen erneut registriert werden muss.

## Lösung
1. Daten sichern und prüfen (Time Machine, Server, OneDrive). Prüfen, dass keine Daten nur lokal liegen.
2. Den Benutzer von Apple-Account und iCloud abmelden und „Wo ist?“ ausschalten, sonst bleibt die Aktivierungssperre bestehen.
3. Neuere Macs (je nach Version ab macOS 12): **Systemeinstellungen → Allgemein → Übertragen oder Zurücksetzen → Alle Inhalte & Einstellungen löschen**. Das ist der saubere Weg.
4. Alternativ den Wiederherstellungsmodus starten. Bei Apple-Silicon-Geräten den Mac ausschalten und die Einschalttaste gedrückt halten, bis die Startoptionen erscheinen. Bei Intel-Geräten beim Start **Befehl + R** halten.
5. Im Wiederherstellungsmenü bei Bedarf das Festplattendienstprogramm zum Löschen des Datenträgers nutzen, danach **macOS neu installieren** wählen. Es wird eine Internetverbindung gebraucht.
6. Bei verwalteten Geräten nach der Installation die Registrierung prüfen und die Richtlinien wieder zuweisen.

**Achtung:** Löschen vernichtet alle lokalen Daten unwiderruflich. Das Gerät währenddessen am Netzteil lassen.

## Wenn das nicht hilft
- Für das Ticket notieren: Modell, Chip, macOS-Version, Fehlermeldung beim Start, ob Aktivierungssperre angezeigt wird.

=== ARTIKEL
titel: Aktivierungssperre bei Firmengeräten vermeiden und lösen
bereich: Mac, iPhone & iPad
tags: aktivierungssperre, activation lock, wo ist, apple-account, gesperrt, iphone, mac, ipad
zielgruppe: technik
---
**Symptom:** Ein gelöschtes oder zurückgegebenes Firmengerät verlangt beim Start einen Apple-Account samt Passwort und ist unbrauchbar.

**Häufige Ursachen:** das Gerät war mit einem privaten Apple-Account des Mitarbeiters angemeldet, „Wo ist?“ blieb eingeschaltet, oder der Mitarbeiter ist ausgeschieden und nicht erreichbar.

## Lösung
**Vermeiden**
1. Firmengeräte nicht mit privatem Apple-Account einrichten. Für Geräte bei Mitarbeitern nur die für die Firma vorgesehene Vorgehensweise verwenden.
2. In der Austrittscheckliste vorsehen, dass der Benutzer sich abmeldet und „Wo ist?“ ausschaltet, bevor das Gerät zurückgegeben wird.
3. Geräte über Apple Business Manager und MDM als überwacht registrieren. Dann kann die Verwaltung die Aktivierungssperre steuern.

**Lösen**
1. Den früheren Benutzer bitten, das Gerät über die Webseite von iCloud aus seinem Account zu entfernen.
2. Bei überwachten Geräten die Funktion der MDM-Lösung für einen Freigabecode (Bypass-Code) nutzen, sofern das Gerät dort noch bekannt ist. Der Weg unterscheidet sich je nach Version und Lösung.
3. Sonst Apple-Support mit Kaufnachweis kontaktieren. Das Ergebnis ist nicht garantiert.

**Achtung:** Eine Aktivierungssperre lässt sich ohne Account oder Nachweis nicht umgehen. Von Fremdangeboten zur Entsperrung ist abzusehen.

## Wenn das nicht hilft
- Für das Ticket notieren: Seriennummer, Kaufbeleg, früherer Benutzer, Status im Apple Business Manager und in der MDM-Lösung.

=== ARTIKEL
titel: Verwaltete und private Apple-Accounts auseinanderhalten
bereich: Mac, iPhone & iPad
tags: apple-account, verwalteter apple-account, privat, apple id, business manager, icloud, app store
zielgruppe: technik
---
**Symptom:** Auf Firmengeräten sind private Apple-Accounts der Mitarbeiter angemeldet, oder es ist unklar, welcher Account für App-Käufe, iCloud und Geräteverwaltung zuständig ist.

**Häufige Ursachen:** Geräte wurden mit dem privaten Account eingerichtet, Firmen-Apps sind mit privaten Accounts gekauft, oder ein ausgeschiedener Mitarbeiter hat seine Daten im privaten iCloud-Konto.

## Lösung
1. Unterschied festhalten: Ein **privater Apple-Account** gehört der Person, auch wenn er auf einem Firmengerät genutzt wird. Ein **verwalteter Apple-Account** wird über Apple Business Manager von der Firma angelegt und kontrolliert, mit eingeschränktem Funktionsumfang (je nach Version).
2. Festlegen, welche Regel der Kunde möchte. In kleinen Betrieben ist oft ausreichend: Geräte verwaltet über MDM, Apps über das Unternehmensportal, kein privater Account auf dem Firmengerät.
3. Diensthandys für Apps ohne persönliche App-Store-Anmeldung einrichten, wo möglich. Firmen-Apps über Intune zuweisen.
4. Für Firmengeräte, die Mitarbeiter auch privat nutzen dürfen, schriftliche Regeln festhalten (Datenschutzbeauftragte oder Rechtsberatung beiziehen).
5. Beim Austritt prüfen, dass der Mitarbeiter sich abgemeldet hat (Aktivierungssperre, siehe eigener Artikel).
6. Konten, Verantwortliche und Wiederherstellungswege dokumentieren.

**Achtung:** Beim Abmelden eines privaten Accounts können Daten vom Gerät entfernt werden. Vorher klären, was gesichert werden muss.

## Wenn das nicht hilft
- Für das Ticket notieren: Gerät, angemeldeter Account-Typ, Ziel des Kunden, ob Apple Business Manager vorhanden ist.

=== ARTIKEL
titel: Mac im Windows-Netz – Anmeldung, Freigaben, Drucker, typische Stolpersteine
bereich: Mac, iPhone & iPad
tags: mac, windows netzwerk, smb, domäne, active directory, freigaben, drucker, entra
zielgruppe: technik
---
**Symptom:** Ein Mac im kleinen Firmennetz erreicht Serverfreigaben nicht, fragt ständig nach Anmeldedaten oder findet den Drucker nicht.

**Häufige Ursachen:** falsche Adresse oder DNS-Name, SMB-Einstellungen am Server (zum Beispiel Signierung), abweichendes Kennwort zwischen Mac und Domänenkonto, oder Dateien mit nicht erlaubten Zeichen im Namen.

## Lösung
1. Grundlagen prüfen: Mac im richtigen Netz, Namensauflösung, Uhrzeit korrekt. Die Adresse des Servers testen, zum Beispiel mit `ping`.
2. Freigabe über **Finder → Gehe zu → Mit Server verbinden** mit `smb://server/freigabe` aufrufen. Benutzername im vorgegebenen Format (zum Beispiel `domäne\benutzer` oder UPN) testen.
3. Server-seitig die SMB-Version und Signierung prüfen. Der Mac verlangt bei neuen Versionen oft Signierung, was die Einstellungen von NAS-Geräten beeinflussen kann.
4. Kennwortänderung: Das lokale Mac-Kennwort wird nicht automatisch mit dem Domänenkennwort synchronisiert. Bei Microsoft Entra hilft je nach Version die Anmeldung per Plattform-SSO. Eine klassische Bindung an Active Directory wird nur noch eingeschränkt empfohlen.
5. Drucker über IP (IPP oder AirPrint) hinzufügen, wenn Freigabe über Windows-Druckserver Probleme macht.
6. Dateinamen mit `:`, `\` oder `?` und Namen über lange Pfade beheben.
7. Sichtbare Dateien wie `.DS_Store` auf Netzlaufwerken sind normal.

## Wenn das nicht hilft
- Für das Ticket notieren: Serveradresse, Fehlermeldung, macOS-Version, Domänen- oder Entra-Konto, Test vom Windows-PC.

=== ARTIKEL
titel: Virenschutz und Sicherheitseinstellungen am Mac – Gatekeeper, Firewall, Updates
bereich: Mac, iPhone & iPad
tags: mac, virenschutz, gatekeeper, firewall, xprotect, sicherheit, updates, defender
zielgruppe: technik
---
**Symptom:** Für einen Firmen-Mac ist unklar, welcher Schutz bereits eingebaut ist und welche Einstellungen der Techniker prüfen sollte.

**Häufige Ursachen:** Mitarbeiter schalten Schutzfunktionen ab, installieren Software aus unbekannten Quellen, Updates bleiben liegen, oder die Firma setzt Windows-Regeln einfach auf den Mac um.

## Lösung
1. **Gatekeeper** prüft Programme beim ersten Start. Status mit `spctl --status` anzeigen. Ausnahmen sollten die Ausnahme bleiben.
2. **XProtect** und die Systemprüfung von macOS erhalten Updates im Hintergrund. Automatische Updates für Sicherheitsdaten eingeschaltet lassen (**Systemeinstellungen → Allgemein → Softwareupdate**, je nach Version).
3. **Firewall** unter **Systemeinstellungen → Netzwerk → Firewall** (je nach Version unter Datenschutz & Sicherheit) einschalten, wenn der Kunde Verbindungen von außen nicht braucht.
4. **FileVault** aktivieren (siehe eigener Artikel), Bildschirmsperre mit kurzem Zeitraum festlegen und Kennwort nach Ruhezustand verlangen.
5. Einen zusätzlichen Virenschutz oder einen Endpunktschutz nur dann ergänzen, wenn der Kunde dies verlangt oder die Vorgaben es erfordern. Für Microsoft Defender gibt es eine Mac-Version, deren Lizenz geprüft werden muss.
6. Updates für macOS und Programme regelmäßig einspielen, am besten zentral über die Geräteverwaltung.
7. Unnötige Freigaben, zum Beispiel Dateifreigabe oder Entfernte Anmeldung, ausschalten.

**Achtung:** Firewall-Änderungen können Programme blockieren. Danach Funktion von Outlook, Teams und Drucker prüfen.

## Wenn das nicht hilft
- Für das Ticket notieren: macOS-Version, Ergebnis von `spctl --status`, Firewall-Stand, eingesetzte Schutzsoftware.

=== ARTIKEL
titel: Datenübernahme beim Wechsel von Windows auf Mac oder auf einen neuen Mac
bereich: Mac, iPhone & iPad
tags: datenübernahme, migrationsassistent, umstieg, windows auf mac, neuer mac, time machine, umzug
zielgruppe: technik
---
**Symptom:** Ein Mitarbeiter bekommt einen neuen Mac oder steigt von Windows um. Dokumente, Mails und Einstellungen sollen mitkommen.

**Häufige Ursachen:** Daten liegen nur lokal auf dem alten Gerät, Programme gibt es nicht für den Mac, Lizenzen sind ans alte Gerät gebunden, oder Passwörter und Zertifikate wurden nicht gesichert.

## Lösung
1. Vorab erfassen: Was liegt wo? Sind Desktop und Dokumente in OneDrive, die Postfächer in Microsoft 365, Daten auf dem Server? Dann ist die Übernahme meist nur eine Neuanmeldung.
2. Fachprogramme prüfen: Gibt es eine Mac-Version, oder ist ein Webzugang oder eine Remote-Lösung nötig?
3. **Von Mac zu Mac:** Den **Migrationsassistenten** (Programme → Dienstprogramme) auf dem neuen Mac starten und eine Time-Machine-Sicherung oder den alten Mac als Quelle wählen.
4. **Von Windows zu Mac:** Den Migrationsassistenten nutzen und am Windows-PC das dafür vorgesehene Programm von Apple installieren, oder Dateien über Netzlaufwerk bzw. externen Datenträger kopieren.
5. Outlook-Daten: Bei Microsoft 365 reicht die Anmeldung. Lokale PST-Archive vorab klären und per Outlook-Funktionen einlesen (je nach Version).
6. Kennwörter, Zertifikate und Lesezeichen separat übernehmen. Browser-Anmeldungen und den Authenticator beachten.
7. Am Schluss mit dem Benutzer gemeinsam prüfen und erst dann das alte Gerät löschen.

**Achtung:** Das alte Gerät nicht löschen, bevor Daten und Sicherung bestätigt sind.

## Wenn das nicht hilft
- Für das Ticket notieren: Quelle und Ziel, Datenmenge, nicht übernommene Programme und Daten.

=== ARTIKEL
titel: WLAN-, VPN- und Zertifikatsprofile auf Apple-Geräte verteilen
bereich: Mac, iPhone & iPad
tags: konfigurationsprofil, wlan, vpn, zertifikat, scep, intune, iphone, mac
zielgruppe: technik
---
**Symptom:** Firmen-WLAN, VPN oder Zertifikate sollen auf iPhones, iPads und Macs ohne manuelle Eingabe landen. Profile werden aber nicht angewendet oder das WLAN meldet Fehler.

**Häufige Ursachen:** Reihenfolge der Profile, fehlendes Root-Zertifikat, Zuweisung an die falsche Gruppe, Gerät nicht verwaltet oder nicht synchronisiert.

## Lösung
1. Zuerst das Zielbild festlegen: WLAN mit Kennwort, mit Benutzeranmeldung oder mit Zertifikat. Daraus ergibt sich der Aufwand.
2. In Intune zuerst die **Vertrauenswürdigen Zertifikate** (Stamm- und gegebenenfalls Zwischenzertifikat) als Profil für Apple-Geräte erstellen und zuweisen.
3. Falls Zertifikate pro Gerät nötig sind, ein Zertifikatsprofil (je nach Infrastruktur SCEP oder PKCS) einrichten. Das setzt eine passende Zertifizierungsstelle und Anbindung voraus.
4. Danach das **WLAN-Profil** erstellen: Netzwerkname, Sicherheitstyp und, falls verwendet, Verweis auf das Zertifikatsprofil.
5. Ein **VPN-Profil** je nach Verfahren und Client vorbereiten und zuweisen. Prüfen, welche VPN-Typen die Plattform unterstützt (je nach Version und Gerätetyp).
6. Profile derselben Gruppe zuweisen (Benutzer- oder Gerätegruppe), mit einem Testgerät beginnen.
7. Am Gerät die Synchronisierung auslösen und unter **Einstellungen → Allgemein → VPN & Geräteverwaltung** (iOS, je nach Version) bzw. **Profile** am Mac die Installation prüfen.

**Achtung:** Ein falsches WLAN-Profil kann Geräte vom Netz trennen. Vorher einen Zugangsweg ohne Profil aufrechterhalten.

## Wenn das nicht hilft
- Für das Ticket notieren: Gerätetyp, Profilart, Zuweisung, Status im Intune-Portal und Meldung am Gerät.
