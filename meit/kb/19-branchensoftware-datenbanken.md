=== ARTIKEL
titel: Programm meldet „Keine Verbindung zur Datenbank“ oder „Server nicht erreichbar“
bereich: Branchensoftware & Datenbanken
tags: keine verbindung, datenbank, server nicht erreichbar, branchensoftware, geht nicht, fehlermeldung
zielgruppe: kunde
---
**Symptom:** Die Fachanwendung (Warenwirtschaft, Auftragsverwaltung, Praxis- oder Handwerkersoftware) startet, meldet aber „Keine Verbindung zur Datenbank“ oder „Server nicht erreichbar“. Daten lassen sich nicht öffnen.

**Häufige Ursachen:** Der Server oder PC mit der Datenbank wurde neu gestartet und ist noch nicht fertig hochgefahren. Das Netzwerkkabel oder WLAN ist getrennt. Die VPN-Verbindung im Homeoffice ist nicht aktiv. Der Datenbankdienst auf dem Server läuft nicht.

## Lösung
1. Fehlermeldung genau abschreiben oder mit **Windows-Taste + Umschalt + S** als Bild festhalten.
2. Prüfen, ob andere Programme Internet und Netzlaufwerke erreichen (zum Beispiel einen Ordner auf dem Server öffnen). Geht das nicht, liegt ein Netzwerkproblem vor.
3. Im Homeoffice prüfen, ob die VPN-Verbindung aktiv ist, und diese bei Bedarf neu herstellen.
4. Die Fachanwendung ganz schließen und nach etwa zwei Minuten neu starten. Nach einem Serverneustart braucht der Datenbankdienst mitunter etwas Zeit.
5. Kolleginnen und Kollegen fragen, ob dort die Anwendung funktioniert. Betrifft es alle, liegt das Problem am Server.
6. Den Computer einmal neu starten und danach erneut versuchen.
7. Keine Einstellungen der Anwendung ändern und keine Datenbankdateien verschieben oder löschen.

## Wenn das nicht hilft
Ticket anlegen und dazuschreiben:
- genauer Wortlaut der Meldung (oder Bild)
- seit wann das Problem besteht und wer davon betroffen ist
- ob andere Programme und Netzlaufwerke funktionieren
- ob im Büro oder im Homeoffice gearbeitet wird
- ob kurz vorher ein Update, ein Stromausfall oder ein Neustart stattfand

=== ARTIKEL
titel: Lizenz abgelaufen oder Schutzstecker (Dongle) wird nicht erkannt – was zu melden ist
bereich: Branchensoftware & Datenbanken
tags: lizenz abgelaufen, dongle, schutzstecker, usb stecker, lizenzfehler, programm läuft nicht
zielgruppe: kunde
---
**Symptom:** Die Fachanwendung meldet, die Lizenz sei abgelaufen, ungültig oder nicht gefunden, oder der Schutzstecker (Dongle, ein kleiner USB-Stecker) werde nicht erkannt. Das Programm startet nur eingeschränkt oder gar nicht.

**Häufige Ursachen:** Der Stecker sitzt locker oder steckt an einem anderen USB-Anschluss bzw. an einem anderen Computer. Der Lizenzvertrag oder das Wartungsjahr ist ausgelaufen. Ein Update des Programms oder von Windows hat die Erkennung gestört. Der Stecker ist defekt.

## Lösung
1. Meldung genau notieren oder fotografieren, auch die angezeigte Lizenz- oder Kundennummer, sofern vorhanden.
2. Prüfen, ob der Schutzstecker richtig steckt. Er sollte direkt am Computer stecken, nicht an einem Verteiler oder einer Verlängerung, und seine Leuchte (falls vorhanden) sollte leuchten.
3. Den Stecker einmal abziehen, einige Sekunden warten und wieder einstecken. Wenn möglich einen anderen USB-Anschluss am selben Gerät verwenden.
4. Die Anwendung schließen und neu starten.
5. Bei Lizenzen ohne Stecker: Programm schließen, Computer neu starten und erneut öffnen.
6. Den Stecker niemals an einem anderen Computer ausprobieren, wenn dort bereits eine Lizenz hängt. Die Lizenz keinesfalls selbst neu eingeben oder „reparieren“.

## Wenn das nicht hilft
Ticket anlegen. Der Hersteller entscheidet über Lizenzfragen, der IT-Dienstleister meldet sie dorthin. Ins Ticket gehören:
- Wortlaut der Meldung
- Gerät und USB-Anschluss, an dem der Stecker steckt
- ob die Anwendung an mehreren Arbeitsplätzen betroffen ist
- ob der Lizenzvertrag oder die Wartung kürzlich verlängert wurde

=== ARTIKEL
titel: Branchensoftware startet nach einem Update nicht mehr
bereich: Branchensoftware & Datenbanken
tags: update, programm startet nicht, nach update, branchensoftware, fehler, hängt
zielgruppe: kunde
---
**Symptom:** Nach einem Programm-Update der Fachanwendung oder nach Windows-Updates startet die Anwendung nicht mehr, zeigt eine Fehlermeldung oder bleibt beim Startbild stehen.

**Häufige Ursachen:** Das Update wurde nur auf einem Teil der Arbeitsplätze eingespielt, sodass Programm- und Datenbankversion nicht zusammenpassen. Der Computer wurde nach dem Update nicht neu gestartet. Eine benötigte Zusatzkomponente fehlt noch. Die Datenbank wird gerade vom Hersteller-Update umgestellt.

## Lösung
1. Meldung notieren oder fotografieren.
2. Prüfen, ob gerade ein Update läuft oder ein Fenster im Hintergrund wartet (zum Beispiel „Datenbank wird aktualisiert“). Dann abwarten und nichts abbrechen.
3. Die Anwendung vollständig schließen. Im Task-Manager (**Strg + Umschalt + Esc**) nachsehen, ob sie noch als Prozess läuft, und sie dort beenden.
4. Den Computer neu starten und die Anwendung erneut öffnen.
5. Kolleginnen und Kollegen fragen, ob die Anwendung dort läuft. Läuft sie an einem anderen Arbeitsplatz, liegt es am einzelnen Gerät.
6. Nicht versuchen, die Anwendung selbst neu zu installieren oder ältere Dateien zurückzukopieren. Das kann Daten gefährden.

## Wenn das nicht hilft
Ticket anlegen und angeben:
- Name und Version der Anwendung, falls bekannt
- wann das Update lief und wer es gestartet hat
- genauer Wortlaut der Meldung
- welche Arbeitsplätze betroffen sind
- ob andere Programme normal funktionieren

Der Techniker prüft dann Sicherung, Version und Zusatzkomponenten.

=== ARTIKEL
titel: Kartenterminal oder Kassa ist offline – erste Prüfungen
bereich: Branchensoftware & Datenbanken
tags: kartenterminal, kassa, offline, zahlung geht nicht, registrierkasse, terminal verbindung
zielgruppe: kunde
---
**Symptom:** Das Kartenterminal meldet „offline“ oder „keine Verbindung“, Kartenzahlungen funktionieren nicht, oder die Kassa kann keine Belege abschließen oder sich nicht mit dem Netz verbinden.

**Häufige Ursachen:** Netzwerkkabel oder WLAN am Gerät getrennt, Router oder Switch im Betrieb ausgefallen, Internetleitung gestört, Stromversorgung des Geräts locker, oder ein Neustart des Netzwerks hat die Verbindung unterbrochen.

## Lösung
1. Prüfen, ob Stromkabel und Netzwerkkabel am Terminal bzw. an der Kassa fest stecken. Bei WLAN-Geräten das Netz in den Geräteeinstellungen ansehen.
2. Kontrollieren, ob andere Geräte im Betrieb Internet haben. Fehlt das Internet überall, Router und Leitung beim IT-Dienstleister melden.
3. Das Kartenterminal nach Herstellerangabe aus- und wieder einschalten. Die Kassa ebenfalls nach Anleitung des Herstellers neu starten.
4. Nichts an Einstellungen, Zugangsdaten oder Tagesabschlüssen ändern und keine Daten löschen.
5. Bei Ausfall mit Kunden vor Ort: Vorgehen bei Kassenausfall laut Anweisung des Herstellers bzw. der Steuerberatung beachten. Belege und Notizen aufbewahren.

## Wenn das nicht hilft
Ticket anlegen. Der Hersteller des Terminals bzw. der Kassa betreut das Gerät selbst, der IT-Dienstleister prüft das Netzwerk. Angeben:
- Gerätetyp und Standort
- genauer Wortlaut der Anzeige
- seit wann es nicht geht
- ob andere Geräte Internet haben
- ob zuvor etwas am Netzwerk oder Strom geändert wurde

=== ARTIKEL
titel: SQL Server Express – Instanz, Dienste und Version herausfinden
bereich: Branchensoftware & Datenbanken
tags: sql server, express, instanz, sqlexpress, version, dienst, sqlcmd
zielgruppe: technik
---
**Symptom:** Eine Branchensoftware nutzt eine SQL-Server-Datenbank, aber unklar ist, welche Instanz, Version und Edition dahintersteckt und welche Dienste dazugehören. Das wird vor Sicherung, Update oder Umzug gebraucht.

**Häufige Ursachen:** Die Software hat SQL Server Express mit einer benannten Instanz (häufig `SQLEXPRESS`) selbst installiert. Mehrere Instanzen laufen parallel. Die Dokumentation fehlt.

## Lösung
1. Auf dem Server in PowerShell die Dienste auflisten: `Get-Service | Where-Object { $_.Name -like "MSSQL*" -or $_.Name -like "SQL*" }`
2. Aus dem Dienstnamen die Instanz ablesen: `MSSQLSERVER` ist die Standardinstanz, `MSSQL$NAME` eine benannte Instanz. `SQLBrowser` ist der Browserdienst, `SQLWriter` der VSS-Dienst.
3. Mit sqlcmd verbinden (Windows-Anmeldung): `sqlcmd -S .\SQLEXPRESS -E`
4. Version und Edition abfragen:
```
SELECT @@VERSION;
SELECT SERVERPROPERTY('ProductVersion'), SERVERPROPERTY('Edition');
```
Danach `GO` eingeben.
5. Datenbanken auflisten: `SELECT name FROM sys.databases;` mit `GO`.
6. Ergebnis in der Kundendokumentation festhalten, inklusive Dienstkonto der Instanz.

## Hintergrund
Das Werkzeug **SQL Server Configuration Manager** zeigt Dienste, Protokolle und Dienstkonten der Instanzen. Je nach installierter Version ist es unter Start auffindbar.

## Für das Ticket notieren
Servername, Instanzname, Produktversion, Edition, Dienstkonto, Liste der Datenbanken, Speicherort der Datendateien.

## Wenn das nicht hilft
Fehlt `sqlcmd`, im Installationsordner des SQL-Servers suchen oder die Abfrage über ein Verwaltungswerkzeug ausführen. Läuft kein Dienst, Hersteller der Branchensoftware fragen, ob eine eingebettete oder andere Datenbank verwendet wird.

=== ARTIKEL
titel: SQL-Datenbank sichern und wiederherstellen (BACKUP und RESTORE)
bereich: Branchensoftware & Datenbanken
tags: sql sicherung, backup database, restore, bak datei, datenbank wiederherstellen, sqlcmd
zielgruppe: technik
---
**Symptom:** Die Datenbank der Branchensoftware soll vor einem Update oder Umzug gesichert oder nach einem Fehler wiederhergestellt werden. Dateikopien der laufenden Datenbank sind nicht verlässlich.

**Häufige Ursachen:** Die Sicherung wurde durch Kopieren der `.mdf`-Datei versucht, während der Dienst lief. Der Zielordner fehlt oder das Dienstkonto der Instanz darf dort nicht schreiben. Beim Zurückspielen sind Datenbankname oder Dateipfade anders.

## Lösung
1. Zielordner anlegen, auf dem das Dienstkonto der Instanz Schreibrechte hat (nicht auf demselben Laufwerk wie die Datenbank, wenn vermeidbar).
2. Sichern:
```
sqlcmd -S .\SQLEXPRESS -E -Q "BACKUP DATABASE [Datenbankname] TO DISK = N'D:\Sicherung\Datenbankname.bak' WITH INIT, CHECKSUM"
```
3. Sicherungsdatei prüfen: `RESTORE VERIFYONLY FROM DISK = N'D:\Sicherung\Datenbankname.bak'`
4. Dateiinhalt ansehen: `RESTORE FILELISTONLY FROM DISK = N'D:\Sicherung\Datenbankname.bak'` zeigt die logischen Dateinamen.
5. **Achtung:** Wiederherstellen überschreibt die vorhandene Datenbank. Vorher aktuelle Sicherung erstellen und Anwendung sowie Dienste, die zugreifen, beenden.
```
RESTORE DATABASE [Datenbankname] FROM DISK = N'D:\Sicherung\Datenbankname.bak' WITH REPLACE
```
6. Bei anderem Zielpfad `WITH MOVE 'logischer_name' TO 'Pfad'` je Datei ergänzen.
7. Anwendung starten und Stichproben prüfen.

## Wenn das nicht hilft
Fehlermeldung des Servers notieren. Liegt die Sicherung von einer neueren Version vor, lässt sie sich auf einer älteren Version nicht zurückspielen. Dann Version der Instanz prüfen. Für das Ticket: Datenbankname, Version, Pfade, Fehlertext.

=== ARTIKEL
titel: SQL Server Express – Größenbeschränkung, Wartung und automatische Sicherung ohne Agent
bereich: Branchensoftware & Datenbanken
tags: sql express, 10 gb, größe limit, sql agent, automatische sicherung, geplante aufgabe, wartung
zielgruppe: technik
---
**Symptom:** Die Datenbank wächst, Speichern schlägt fehl oder die Anwendung wird langsam. Es gibt keine automatische Sicherung, weil die Express-Edition keinen SQL-Server-Agent mitbringt.

**Häufige Ursachen:** Die Express-Edition begrenzt die Datenbankgröße (üblich ist ein Limit von 10 GB je Datenbank, je nach Version prüfen) sowie Speicher und Rechenkerne. Ohne Agent läuft keine Wartung. Das Transaktionsprotokoll wächst unbemerkt.

## Lösung
1. Größe der Datenbank- und Protokolldateien prüfen: `SELECT name, size*8/1024 AS MB FROM sys.master_files;` (mit `sqlcmd` ausführen).
2. Mit dem Hersteller klären, ob Altdaten archiviert werden dürfen. Keine Daten ohne dessen Freigabe löschen.
3. Sicherungsskript `sicherung.cmd` anlegen, das `sqlcmd -S .\SQLEXPRESS -E -Q "BACKUP DATABASE [Datenbankname] TO DISK = N'D:\Sicherung\Datenbankname.bak' WITH INIT, CHECKSUM"` aufruft.
4. In der Aufgabenplanung eine Aufgabe erstellen, die das Skript täglich zu einer ruhigen Zeit startet, mit einem Konto, das Anmelderecht am SQL Server und Schreibrecht im Zielordner hat.
5. Sicherungsdateien zusätzlich auf ein anderes Medium bzw. in die Datensicherung des Kunden übernehmen.
6. **Achtung:** Protokolldatei nicht per Dateisystem löschen. Bei Bedarf Wiederherstellungsmodell und Protokollsicherung mit dem Hersteller abstimmen.
7. Regelmäßig `DBCC CHECKDB` ausführen und Ergebnis prüfen.

## Wenn das nicht hilft
Wird das Limit erreicht, ist eine höhere Edition nötig. Das mit Hersteller und Auftraggeber abklären. Für das Ticket: Größe je Datenbank, Edition, Wachstum pro Monat.

=== ARTIKEL
titel: Anmeldung am SQL Server scheitert (Windows- oder SQL-Anmeldung)
bereich: Branchensoftware & Datenbanken
tags: sql anmeldung, login failed, 18456, sa passwort, windows authentifizierung, benutzer
zielgruppe: technik
---
**Symptom:** Die Anwendung oder ein Verwaltungswerkzeug meldet „Fehler bei der Anmeldung“ am SQL Server, oft mit Fehlernummer 18456 und einem Statuscode im Serverprotokoll.

**Häufige Ursachen:** Der Server steht nur auf Windows-Authentifizierung, die Anwendung nutzt aber eine SQL-Anmeldung. Das Passwort wurde geändert oder ist abgelaufen. Das Konto ist gesperrt oder deaktiviert. Die Datenbank des Anwenders existiert nicht oder der Benutzer ist einer anderen Anmeldung zugeordnet (verwaister Benutzer nach Wiederherstellung).

## Lösung
1. Anmeldemodus und Konto aus den Anwendungseinstellungen bzw. der Dokumentation ermitteln.
2. Lokal am Server mit Windows-Anmeldung eines Administrators verbinden: `sqlcmd -S .\SQLEXPRESS -E`
3. Serverprotokoll prüfen (Fehlerprotokoll in der Verwaltung oder im Log-Ordner der Instanz). Der Statuscode benennt den genauen Grund.
4. Wird eine SQL-Anmeldung verlangt: in den Servereigenschaften unter Sicherheit den gemischten Modus aktivieren. **Achtung:** Danach ist ein Neustart des SQL-Dienstes nötig, das unterbricht laufende Verbindungen.
5. Anmeldung prüfen: `SELECT name, is_disabled FROM sys.server_principals;`
6. Verwaisten Benutzer in der betroffenen Datenbank neu verknüpfen: `ALTER USER [Benutzer] WITH LOGIN = [Benutzer];`
7. Neue Zugangsdaten nur im Passwortmanager ablegen und in der Anwendung hinterlegen.

## Wenn das nicht hilft
Ist kein Administratorzugang mehr vorhanden, Hersteller fragen und Vorgehen für Instanz-Notzugang abstimmen. Für das Ticket: Fehlertext, Statuscode, Anmeldemodus, was geändert wurde.

=== ARTIKEL
titel: SQL Server im Netz erreichbar machen – Protokolle, Ports, Firewall
bereich: Branchensoftware & Datenbanken
tags: sql server, tcp ip, port 1433, firewall, sql browser, remote verbindung, client verbindet nicht
zielgruppe: technik
---
**Symptom:** Die Anwendung am Arbeitsplatz erreicht die Datenbank auf dem Server nicht. Lokal am Server funktioniert sie.

**Häufige Ursachen:** Das Protokoll TCP/IP ist in der Instanz deaktiviert. Die Windows-Firewall blockiert den Port. Bei benannten Instanzen ist der Port dynamisch und der Browserdienst läuft nicht. Der Server ist über einen anderen Namen oder eine andere Adresse gemeint.

## Lösung
1. Im SQL Server Configuration Manager unter Netzwerkkonfiguration der Instanz prüfen, ob **TCP/IP** aktiviert ist.
2. In den Eigenschaften von TCP/IP den verwendeten Port ablesen. Standardinstanz meist TCP 1433, benannte Instanzen oft dynamisch. Für Firewallregeln einen festen Port eintragen.
3. **Achtung:** Nach Änderungen den SQL-Dienst neu starten. Das unterbricht laufende Verbindungen, daher außerhalb der Arbeitszeit.
4. Eingehende Firewallregel für den festen Port anlegen und nur für das lokale Netz freigeben. Bei dynamischen Ports zusätzlich den SQL-Browserdienst (UDP 1434) zulassen und starten.
5. Vom Client testen: `Test-NetConnection Servername -Port 1433`
6. In der Anwendung Servernamen und Instanz richtig eintragen (`Server\Instanz` oder `Server,Port`).
7. Die Datenbank nie ins Internet freigeben, Zugriff von außen nur über VPN.

## Wenn das nicht hilft
DNS-Auflösung des Servernamens prüfen und mit der IP-Adresse testen. Prüfen, ob Virenschutz oder Netzwerkfirewall blockiert. Für das Ticket: Servername, Instanz, Port, Ergebnis von `Test-NetConnection`.

=== ARTIKEL
titel: ODBC-Datenquelle einrichten – 32 oder 64 Bit
bereich: Branchensoftware & Datenbanken
tags: odbc, datenquelle, dsn, 32 bit, 64 bit, odbcad32, treiber
zielgruppe: technik
---
**Symptom:** Eine Anwendung, ein Excel-Bericht oder eine Schnittstelle findet die ODBC-Datenquelle nicht oder meldet „Datenquellenname nicht gefunden“ bzw. „Architekturkonflikt zwischen Treiber und Anwendung“.

**Häufige Ursachen:** Die Datenquelle wurde mit dem ODBC-Werkzeug der falschen Bitversion angelegt. Es wurde eine Benutzer-Datenquelle statt einer System-Datenquelle erstellt. Der Treiber fehlt oder der Name weicht ab.

## Lösung
1. Bitversion der Anwendung klären (32 Bit oder 64 Bit). Ältere Branchensoftware ist häufig 32 Bit.
2. Passendes Werkzeug starten:
   - 64 Bit: `C:\Windows\System32\odbcad32.exe`
   - 32 Bit: `C:\Windows\SysWOW64\odbcad32.exe`
3. Reiter **System-DSN** für alle Benutzer oder Dienste, **Benutzer-DSN** nur für das angemeldete Konto. Dienste brauchen eine System-DSN.
4. Hinzufügen, passenden Treiber wählen, Namen exakt wie in der Anwendung vergeben, Server und Datenbank eintragen, Anmeldeart wählen.
5. Verbindung testen.
6. Auf Terminalservern und mehreren Clients die Datenquelle auf jedem Gerät gleich anlegen, Namen dokumentieren.
7. Bei vielen Geräten Einrichtung per Skript oder Richtlinie nur nach Absprache mit dem Hersteller.

## Hintergrund
Je Bitversion gibt es eigene Listen von Treibern und Datenquellen. Ein 32-Bit-Programm sieht keine 64-Bit-Datenquellen.

## Wenn das nicht hilft
Treiberversion mit Herstellerangabe vergleichen und Treiber der passenden Bitversion nachinstallieren. Für das Ticket: Bitversion, Treibername, DSN-Name, Fehlertext.

=== ARTIKEL
titel: Datenbank auf einen neuen Server umziehen (SQL Server)
bereich: Branchensoftware & Datenbanken
tags: datenbank umzug, neuer server, sql migration, backup restore, anwendung umziehen, verbindungszeichenfolge
zielgruppe: technik
---
**Symptom:** Die Datenbank der Branchensoftware soll auf einen neuen Server wandern, etwa nach Hardwaretausch. Die Anwendung soll danach ohne Datenverlust weiterlaufen.

**Häufige Ursachen:** Anmeldungen und Benutzer fehlen auf dem Zielserver. Version oder Edition passen nicht. Clients zeigen weiter auf den alten Servernamen. Datenpfade sind anders. Die Anwendung wurde noch während der Umstellung verwendet.

## Lösung
1. Vor dem Start Sicherung der Datenbank und der Programmdaten erstellen. Mit dem Hersteller prüfen, ob für die Zielversion Auflagen gelten.
2. Ziel-Instanz in passender Version einrichten (gleiche oder neuere Version, gleicher Instanzname, wenn die Anwendung ihn erwartet) und Kollation mit der alten abgleichen.
3. Zugriff auf der Quelle beenden: Anwendung und Dienste stoppen, Anwender abmelden.
4. Endgültige Sicherung ziehen: `BACKUP DATABASE [Datenbankname] TO DISK = N'D:\Umzug\Datenbankname.bak' WITH INIT, CHECKSUM`
5. Datei auf den neuen Server kopieren und mit `RESTORE DATABASE … FROM DISK` zurückspielen, Pfade bei Bedarf mit `WITH MOVE` anpassen.
6. Anmeldungen anlegen und verwaiste Benutzer verknüpfen (`ALTER USER … WITH LOGIN`).
7. Servernamen in der Anwendung, ODBC-Quellen, Schnittstellen und geplanten Aufgaben anpassen. Alternativ Alias oder DNS-Eintrag nutzen.
8. Test mit Stichproben, dann alten Server nur gesperrt aufbewahren.

## Wenn das nicht hilft
Alten Zustand beibehalten und Fehler dokumentieren. Für das Ticket: Versionen, Instanznamen, Zeitplan, Rückfallweg.

=== ARTIKEL
titel: Branchensoftware auf neuen Server oder PC umziehen – Checkliste
bereich: Branchensoftware & Datenbanken
tags: umzug, neuer pc, neuer server, branchensoftware, checkliste, migration, lizenz
zielgruppe: technik
---
**Symptom:** Ein Kunde bekommt neue Hardware, und die Fachanwendung samt Daten, Schnittstellen und Lizenz soll mit.

**Häufige Ursachen:** Unvollständige Bestandsaufnahme: vergessene Zusatzdienste, Druckerzuordnungen, Netzlaufwerke, ODBC-Quellen, geplante Aufgaben, Lizenzbindung an die alte Hardware, Installationsmedien nicht mehr auffindbar.

## Lösung
1. Bestand erfassen: Programmversion, Installationsmedium bzw. Download, Lizenzdaten, Datenbank und Pfade, Dienste, Schnittstellen, Drucker, Laufwerke, Zusatzsoftware, Laufzeitumgebungen.
2. Hersteller früh kontaktieren: Vorgehen, Freigaben, Lizenzübertragung, Termin.
3. Vollständige Sicherung von Programmordner, Datenordner und Datenbank anlegen und eine Rücksicherung testen.
4. Neue Umgebung vorbereiten: Betriebssystem, Updates, Laufzeitumgebungen, Firewall, Virenschutz-Ausnahmen, Benutzerrechte.
5. Anwendung in der vom Hersteller vorgesehenen Version installieren, nicht einfach den Ordner kopieren, sofern nicht ausdrücklich freigegeben.
6. Datenbank gemäß Umzugsartikel zurückspielen, Verbindungen und Pfade anpassen.
7. Lizenz oder Schutzstecker auf das neue Gerät übertragen lassen.
8. Test mit einem Anwender: Anmelden, Daten öffnen, Drucken, Exportieren.
9. **Achtung:** Alte Umgebung erst nach erfolgreicher Abnahme und einer festgelegten Frist abschalten.

## Für das Ticket notieren
Alte und neue Gerätebezeichnung, Version, Umzugsdatum, Ansprechperson beim Hersteller, Abnahme durch den Kunden.

## Wenn das nicht hilft
Rückfall auf die alte Umgebung, Fehler dokumentieren und mit dem Hersteller klären.

=== ARTIKEL
titel: Dienst der Anwendung startet nicht – Abhängigkeiten und Dienstkonto
bereich: Branchensoftware & Datenbanken
tags: dienst startet nicht, windows dienst, dienstkonto, abhängigkeit, fehler 1069, anwendungsserver
zielgruppe: technik
---
**Symptom:** Ein Windows-Dienst der Branchensoftware (Anwendungsserver, Lizenzdienst, Schnittstellendienst) lässt sich nicht starten oder beendet sich sofort wieder. Die Anwendung zeigt „Server nicht erreichbar“.

**Häufige Ursachen:** Ein abhängiger Dienst, meist der Datenbankdienst, läuft nach dem Start noch nicht. Das Dienstkonto hat ein geändertes oder abgelaufenes Passwort oder fehlendes Recht „Anmelden als Dienst“. Zugriff auf Ordner oder Datenbank ist verweigert. Ein Port ist bereits belegt.

## Lösung
1. In der Dienste-Verwaltung (`services.msc`) Eigenschaften des Dienstes öffnen. Reiter **Anmelden**: Dienstkonto prüfen. Reiter **Abhängigkeiten**: von welchen Diensten er abhängt.
2. Abhängige Dienste zuerst starten, dann den Anwendungsdienst.
3. Ereignisanzeige öffnen, **Windows-Protokolle → System** und **Anwendung** nach Einträgen zum Dienstnamen durchsuchen. Die genaue Meldung notieren.
4. Konto prüfen: Passwort aktuell, Konto nicht gesperrt, Recht auf Anmeldung als Dienst vorhanden, Schreibrechte auf Programm- und Datenordner.
5. Bei Startreihenfolge-Problemen den Starttyp „Automatisch (Verzögerter Start)“ erwägen.
6. Belegten Port prüfen: `netstat -ano | findstr :Portnummer`
7. **Achtung:** Dienstkonto oder Abhängigkeiten nur nach Rücksprache mit dem Hersteller ändern und Einstellungen vorher notieren.

## Wenn das nicht hilft
Protokolldateien im Programmordner und Herstellerdokumentation heranziehen. Für das Ticket: Dienstname, Dienstkonto, Fehlertext der Ereignisanzeige, letzte Änderung am Server.

=== ARTIKEL
titel: Automatische Exporte und Importe der Branchensoftware als geplante Aufgabe
bereich: Branchensoftware & Datenbanken
tags: geplante aufgabe, export, import, aufgabenplanung, automatisch, skript, schnittstelle
zielgruppe: technik
---
**Symptom:** Ein Export (zum Beispiel Datenübergabe an Buchhaltung) oder Import läuft nicht automatisch oder nur, wenn jemand angemeldet ist. Die Aufgabe läuft manuell, aber nicht zeitgesteuert.

**Häufige Ursachen:** Die Aufgabe läuft unter einem Benutzerkonto, das nicht angemeldet ist oder ein altes Passwort hat. Netzlaufwerke sind in der Aufgabe nicht eingebunden. Arbeitsverzeichnis fehlt. Die Anwendung erwartet eine Benutzeroberfläche.

## Lösung
1. Mit dem Hersteller klären, ob es einen Kommandozeilenparameter oder ein Hilfsprogramm für Exporte ohne Oberfläche gibt.
2. Zuerst manuell in einer Eingabeaufforderung testen, mit dem Konto, das später läuft.
3. In der Aufgabenplanung (`taskschd.msc`) eine Aufgabe anlegen. Auf **Unabhängig von der Benutzeranmeldung ausführen** achten, damit sie ohne angemeldeten Benutzer läuft.
4. Bei Aktion Programm, Argumente und **Starten in** (Arbeitsverzeichnis) ausfüllen.
5. Netzpfade als UNC-Pfad (`\\server\freigabe`) angeben, nicht als Laufwerksbuchstaben.
6. Ausgabe in eine Protokolldatei umleiten, damit Fehler sichtbar sind.
7. Zeitpunkt so wählen, dass keine Sicherung und keine Anwenderarbeit kollidieren.
8. Aufgabe einmal über **Ausführen** testen und das Ergebnis im Protokoll kontrollieren.

## Wenn das nicht hilft
Letztes Ausführungsergebnis in der Aufgabenplanung und die Ereignisanzeige prüfen. Für das Ticket: Aufgabenname, Konto, Befehl, Ergebniscode, Protokollauszug.

=== ARTIKEL
titel: Lizenzserver und Schutzstecker in virtuellen Umgebungen
bereich: Branchensoftware & Datenbanken
tags: dongle, virtuell, hyper-v, vmware, usb durchreichen, lizenzserver, usb über netzwerk
zielgruppe: technik
---
**Symptom:** Nach dem Umzug der Branchensoftware auf eine virtuelle Maschine wird der Schutzstecker nicht mehr erkannt oder der Lizenzdienst meldet keine Lizenz.

**Häufige Ursachen:** Ein USB-Gerät lässt sich nicht ohne Weiteres an eine virtuelle Maschine durchreichen. Nach Live-Migration oder Wechsel des Hosts fehlt der Stecker. Die Lizenz ist an Hardwarekennung gebunden. Der Hersteller untersagt Virtualisierung.

## Lösung
1. Beim Hersteller klären, ob die Lizenz virtualisierbar ist und welche Variante vorgesehen ist (softwarebasierte Lizenz, Netzwerk-Lizenzserver oder Stecker).
2. Optionen mit Vor- und Nachteilen abwägen:
   - Hostseitiges USB-Durchreichen, sofern die Virtualisierungslösung es unterstützt, bindet die VM an einen Host.
   - USB-over-IP-Geräte im Netz, wenn der Hersteller sie freigibt.
   - Lizenzdienst auf einem kleinen physischen Gerät oder PC belassen.
3. Dienst und Treiber des Schutzsteckers in der VM installieren, nach Herstellerangabe.
4. Nach Neustart von Host und VM prüfen, ob der Stecker wieder erkannt wird.
5. **Achtung:** Vor Änderungen Lizenzdaten und Sicherung der VM bereitstellen.
6. Ausfallkonzept festlegen: Wer entscheidet bei Hostausfall, wo der Stecker steckt.
7. Dokumentieren, an welchem Host der Stecker steckt.

## Wenn das nicht hilft
Herstellersupport einschalten und gegebenenfalls Ersatzlizenz anfragen. Für das Ticket: Virtualisierungslösung, Host, Steckertyp, Fehlermeldung.

=== ARTIKEL
titel: Laufzeitumgebungen (.NET, Java, Visual-C++-Pakete) – fehlende oder falsche Version
bereich: Branchensoftware & Datenbanken
tags: runtime, .net framework, java, visual c++, dll fehlt, programm startet nicht, laufzeit
zielgruppe: technik
---
**Symptom:** Die Fachanwendung bricht beim Start mit einer Meldung über eine fehlende DLL oder Komponente ab, oder verlangt eine bestimmte Version von .NET, Java oder der Visual-C++-Laufzeit.

**Häufige Ursachen:** Auf dem neuen oder zurückgesetzten PC fehlt eine Laufzeitumgebung. Es ist eine andere Hauptversion installiert, die nicht kompatibel ist. 32-Bit- und 64-Bit-Variante passen nicht zur Anwendung. Ein Java-Update hat die Standardversion geändert.

## Lösung
1. Vom Hersteller die Systemvoraussetzungen und die Programmversion einholen, auch die Bitversion der Anwendung.
2. Installierte Komponenten ansehen: **Einstellungen → Apps → Installierte Apps** (je nach Windows-Version „Apps und Features“). Dort stehen Visual-C++-Pakete, Java und .NET-Laufzeiten.
3. Fehlende Version in der vom Hersteller geforderten Variante nachinstallieren. Visual-C++-Pakete sind parallel installierbar, mehrere Jahrgänge sind normal.
4. Bei älteren Programmen ist ein Windows-Feature nötig: **Windows-Features aktivieren oder deaktivieren** öffnen und .NET Framework 3.5 aktivieren, wenn verlangt.
5. Bei Java den vom Hersteller genannten Pfad nutzen, nicht blind die neueste Version.
6. **Achtung:** Vorhandene Versionen nicht deinstallieren, bevor feststeht, dass keine andere Anwendung sie braucht.
7. Anwendung neu starten, Ereignisanzeige bei Fehlern ansehen.

## Wenn das nicht hilft
Genauen Dateinamen aus der Fehlermeldung notieren und dem Hersteller melden. Für das Ticket: Programmversion, Bitversion, Fehlertext, installierte Laufzeiten.

=== ARTIKEL
titel: Altes Programm braucht angeblich Administratorrechte – bessere Wege
bereich: Branchensoftware & Datenbanken
tags: administratorrechte, admin, altes programm, berechtigung, schreibzugriff, uac, standardbenutzer
zielgruppe: technik
---
**Symptom:** Eine ältere Branchensoftware läuft nur mit Administratorrechten, oder der Hersteller empfiehlt, allen Anwendern Adminrechte zu geben. Ohne diese Rechte gibt es Fehler beim Speichern oder Starten.

**Häufige Ursachen:** Das Programm schreibt in den Programmordner oder in geschützte Bereiche der Registrierung. Datenordner haben falsche Berechtigungen. Konfigurationsdateien liegen im Programmverzeichnis.

## Lösung
1. Ursache sichtbar machen: Mit dem Sysinternals-Werkzeug Process Monitor Zugriffe mit Ergebnis „Zugriff verweigert“ aufzeichnen und Pfade notieren.
2. Beim Hersteller nach einer aktuellen Version oder einer Einstellung für den Datenspeicherort fragen.
3. Ordner, in die das Programm schreibt, gezielt berechtigen: Änderungsrecht für eine Benutzergruppe auf genau diesen Datenordner, nicht auf die gesamte Festplatte.
4. Datenordner möglichst aus dem Programmverzeichnis verlagern (Freigabe oder Ordner außerhalb von „Programme“).
5. Nur wenn nötig, die Anwendung für einen einzelnen Arbeitsplatz über die Kompatibilitätseinstellungen als Administrator starten lassen. Das ist kein Dauerzustand.
6. **Achtung:** Berechtigungen vor der Änderung dokumentieren. Nie „Jeder: Vollzugriff“ auf Systemordner vergeben.
7. Mit einem Standardbenutzer testen.

## Wenn das nicht hilft
Risiko mit Auftraggeber und Hersteller besprechen und Alternativen wie Terminalserver prüfen. Für das Ticket: betroffene Pfade, Programmversion, Fehlerbild.

=== ARTIKEL
titel: Branchensoftware langsam oder stürzt ab – Netzlaufwerk, Datenbank, Engpass finden
bereich: Branchensoftware & Datenbanken
tags: langsam, netzlaufwerk, programm stürzt ab, datenbank langsam, performance, engpass, freigabe
zielgruppe: technik
---
**Symptom:** Die Datenbank-Anwendung reagiert träge, Listen laden lange, oder ein Programm, das auf einem Netzlaufwerk liegt, stürzt ab oder hängt.

**Häufige Ursachen:** Ausgelastete Netzwerkverbindung oder WLAN statt Kabel. Programm und Datenbank laufen von einer Freigabe, deren Zugriff instabil ist. Server mit zu wenig Arbeitsspeicher, volle oder langsame Festplatte. Virenschutz prüft jede Datei. Fehlende Datenbankpflege. Gleichzeitige Sicherung.

## Lösung
1. Eingrenzen: betrifft es einen Arbeitsplatz, alle, bestimmte Uhrzeiten oder bestimmte Funktionen?
2. Am Server im Task-Manager bzw. in der Leistungsüberwachung CPU, Arbeitsspeicher, Datenträger und Netzwerk beobachten, während das Problem auftritt.
3. Am Client dasselbe tun und die Verbindung (Kabel, Switch, Geschwindigkeit) prüfen.
4. Prüfen, ob Sicherungen, Updates oder Scans zur selben Zeit laufen.
5. Bei Programmen auf Netzlaufwerken: Mit dem Hersteller klären, ob ein Betrieb von der Freigabe unterstützt wird. Besser ist eine lokale Installation mit zentralem Datenordner oder ein Terminalserver.
6. Zugriff über UNC-Pfad statt zugeordnetem Laufwerk testen und Offlinedateien für diesen Ordner ausschalten.
7. Datenbankpflege prüfen (Größe, Sicherungsmodell, Indizes laut Herstellervorgabe) und freien Speicher auf dem Datenträger sicherstellen.
8. **Achtung:** Konfigurationsänderungen am Server nur außerhalb der Arbeitszeit und nach Sicherung.

## Wenn das nicht hilft
Messwerte und Zeitpunkte sammeln und dem Hersteller geben. Für das Ticket: betroffene Funktion, Messwerte, Netzwerkart, Vergleich zwischen Arbeitsplätzen.

=== ARTIKEL
titel: Ausnahmen im Virenschutz für Datenbanken und Programmordner
bereich: Branchensoftware & Datenbanken
tags: virenschutz, ausnahme, defender, antivirus, datenbank langsam, ausschluss, programmordner
zielgruppe: technik
---
**Symptom:** Die Fachanwendung ist nach der Einführung eines Virenschutzes oder nach einem Update langsam, Datenbankdateien sind gesperrt, oder Dateien wurden in Quarantäne verschoben.

**Häufige Ursachen:** Der Echtzeitscan prüft Datenbank- und Protokolldateien bei jedem Zugriff. Programmdateien der Branchensoftware werden fälschlich erkannt. Der Scan läuft während der Arbeitszeit.

## Lösung
1. Vom Hersteller der Branchensoftware und der Datenbank die empfohlenen Ausnahmen einholen (Ordner, Dateitypen, Prozesse).
2. Typische Kandidaten: Datenordner der Datenbank (Datendateien und Protokolldateien), Programmordner der Anwendung, deren Prozesse und Dienste, Ordner für Sicherungsdateien.
3. Ausnahmen in der eingesetzten Virenschutzlösung zentral eintragen, bei Microsoft Defender unter den Einstellungen zu Viren- & Bedrohungsschutz im Bereich Ausschlüsse (je nach Version unterschiedlich benannt).
4. Ausnahmen so eng wie möglich halten: genaue Pfade und Prozesse, keine ganzen Laufwerke.
5. Geplante Vollscans in die Nacht legen.
6. **Achtung:** Eine Ausnahme senkt den Schutz. Entscheidung dokumentieren, mit dem Kunden abstimmen und die betroffenen Ordner nicht für Downloads oder Postfachanhänge nutzen.
7. Danach Verhalten der Anwendung testen und Quarantäne auf fälschlich blockierte Dateien prüfen.

## Wenn das nicht hilft
Fehlalarme dem Hersteller des Virenschutzes und der Branchensoftware melden. Für das Ticket: Pfade, Produkt, Alarmtext, Zeitpunkt.

=== ARTIKEL
titel: Branchensoftware über Remotedesktop oder als RemoteApp bereitstellen
bereich: Branchensoftware & Datenbanken
tags: remoteapp, remotedesktop, terminalserver, rds, branchensoftware, homeoffice, drucken
zielgruppe: technik
---
**Symptom:** Die Fachanwendung soll für Homeoffice oder mehrere Standorte bereitgestellt werden, ohne sie auf jedem PC zu installieren. Oder die Anwendung läuft per Remotedesktop, macht aber Probleme beim Drucken, Scannen oder mit mehreren Anwendern.

**Häufige Ursachen:** Die Software ist nicht für mehrere gleichzeitige Sitzungen freigegeben. Lizenzen für den Remotezugriff fehlen. Konfigurationsdateien liegen im gemeinsamen Programmordner. Druck- und Schnittstellenumleitung funktioniert nicht.

## Lösung
1. Beim Hersteller klären, ob Betrieb auf einem Terminalserver oder per Remotedesktop unterstützt und lizenziert ist.
2. Windows-Lizenzierung für Remotedesktop-Zugriffe (Clientzugriffslizenzen) prüfen und mit der Lizenzberatung abstimmen.
3. Anwendung auf dem Server im vom Hersteller beschriebenen Installationsmodus installieren.
4. Bei Bedarf als RemoteApp veröffentlichen, damit nur das Programmfenster erscheint, statt eines ganzen Desktops.
5. Benutzerdaten und Einstellungen pro Benutzer trennen, Schreibrechte auf Datenordner prüfen.
6. Druckerumleitung testen. Für Formulare und Etiketten Standarddrucker des Servers oder umgeleiteten Client-Drucker festlegen.
7. Zugriff von außen nur über VPN oder ein Gateway mit Mehrfaktoranmeldung, nie direkt aus dem Internet.
8. **Achtung:** Änderungen am produktiven Server außerhalb der Arbeitszeit, nach Sicherung.

## Wenn das nicht hilft
Mit zwei Testbenutzern gleichzeitig prüfen und das Fehlerbild dem Hersteller schildern. Für das Ticket: Serverversion, Anzahl Anwender, Meldung, betroffene Funktion.

=== ARTIKEL
titel: Druck aus der Branchensoftware – Formulare, Schächte, Etiketten
bereich: Branchensoftware & Datenbanken
tags: drucken, formular, papierschacht, etikettendrucker, rand verschoben, standarddrucker, branchensoftware
zielgruppe: technik
---
**Symptom:** Aus der Fachanwendung gedruckte Formulare, Rechnungen oder Etiketten sind verschoben, kommen aus dem falschen Schacht oder gar nicht, oder der falsche Drucker wird verwendet.

**Häufige Ursachen:** Die Anwendung nutzt einen eigenen Druckernamen, der nach dem Druckertausch nicht mehr stimmt. Neuer Druckertreiber mit anderem Seitenrand. Schächte sind im Treiber anders belegt. Etikettendrucker mit falscher Papiergröße. Auf dem Terminalserver fehlt der Drucker in der Sitzung.

## Lösung
1. In der Anwendung nachsehen, ob Formulare einem bestimmten Drucker zugeordnet sind (Druckeinstellungen oder Formularverwaltung, je nach Hersteller).
2. In Windows unter **Einstellungen → Bluetooth & Geräte → Drucker & Scanner** prüfen, welcher Drucker Standard ist und ob der Name zur Zuordnung passt.
3. Druckereinstellungen öffnen und Papiergröße, Schacht und Skalierung kontrollieren. Skalierung auf 100 Prozent und keine Anpassung an Seite.
4. Bei Etiketten die Papiergröße im Treiber exakt auf Etikettenformat setzen.
5. Druckertreiber des Herstellers in der passenden Version verwenden, nicht den allgemeinen Treiber, wenn Ränder abweichen.
6. Testdruck auf normalem Papier, bevor Vordrucke eingelegt werden.
7. Ränder und Schächte im Formular nur nach Anleitung des Herstellers der Software anpassen.
8. **Achtung:** Treibertausch kann andere Formulare verschieben, daher Einstellungen vorher notieren.

## Wenn das nicht hilft
Prüfen, ob der Fehler in jedem Programm auftritt oder nur in der Anwendung. Für das Ticket: Druckermodell, Treiber, Formular, Muster als Foto.

=== ARTIKEL
titel: Schnittstellen und Exporte zur Buchhaltung oder Steuerberatung (allgemein)
bereich: Branchensoftware & Datenbanken
tags: buchhaltung, export, steuerberater, schnittstelle, datev, csv, datenübergabe
zielgruppe: technik
---
**Symptom:** Daten aus der Branchensoftware (Rechnungen, Zahlungen, Belege) sollen an Buchhaltung oder Steuerberatung übergeben werden. Der Export fehlt, ist unvollständig oder wird von der Gegenseite abgelehnt.

**Häufige Ursachen:** Exportformat, Zeitraum oder Konten-Zuordnung passen nicht zur Vorgabe der Steuerberatung. Der Export wurde nach einem Update verändert. Dateien enthalten Sonderzeichen oder doppelte Belege. Der Ablauf ist nur Einzelpersonen bekannt.

## Lösung
1. Mit der Steuerberatung schriftlich klären: gewünschtes Format, Zeitraum, Rhythmus, Übergabeweg und Ansprechperson. Fachliche Vorgaben legt die Steuerberatung fest, nicht die IT.
2. Beim Hersteller der Branchensoftware die vorgesehene Exportfunktion bzw. Schnittstelle erfragen.
3. Export mit kleinem Zeitraum testen und das Ergebnis von der Steuerberatung prüfen lassen.
4. Übergabeweg sicher wählen: verschlüsselter Austausch oder ein Portal statt unverschlüsselter E-Mail-Anhänge.
5. Wiederkehrende Exporte ggf. als geplante Aufgabe automatisieren und Ergebnis kontrollieren.
6. Ablauf kurz dokumentieren: Wer exportiert, wann, wohin, was nach Updates zu prüfen ist.
7. Exportdateien nach Übergabe nicht dauerhaft auf Freigaben liegen lassen, sondern gemäß Absprache aufbewahren oder löschen.

## Hintergrund
Aufbewahrung und Form von Buchhaltungsdaten sind fachliche und rechtliche Themen. Die IT liefert die technische Umsetzung nach Vorgabe der Steuerberatung.

## Wenn das nicht hilft
Beispieldatei und Ablehnungsgrund der Gegenseite sammeln und zusammen mit dem Hersteller prüfen. Für das Ticket: Programmversion, Formatname, Zeitraum, Fehlertext.

=== ARTIKEL
titel: Banking-Software und Bankzugänge auf einen neuen PC umziehen (allgemein)
bereich: Branchensoftware & Datenbanken
tags: banking software, bankzugang, neuer pc, umzug, tan, bankdaten, finanzsoftware
zielgruppe: technik
---
**Symptom:** Auf einem neuen PC soll die Banking-Software des Kunden laufen. Bankdaten, Konten, Zahlungsvorlagen und Zugänge sollen mit.

**Häufige Ursachen:** Datenordner der Software und Zugangsdateien werden nicht mitgenommen. Die Freigabeverfahren der Bank (App, Lesegerät, Zertifikat) sind an das alte Gerät gebunden. Die Lizenz der Software ist gerätegebunden. Zugangsdaten sind nur einer Person bekannt.

## Lösung
1. Mit Kunden und Bank klären, welches Freigabeverfahren verwendet wird und ob es an das Gerät gebunden ist. Zugangsdaten und Freigaben erledigt der Kunde selbst, die IT kennt und speichert sie nicht.
2. Beim Hersteller der Software nachfragen, wie Daten und Einrichtung übertragen werden (Export, Sicherung, Neu-Einrichtung).
3. Sicherung der Programmdaten erstellen und an einem geschützten Ort ablegen, mit eingeschränktem Zugriff.
4. Software auf dem neuen PC installieren, Daten gemäß Herstellerangabe einspielen, Lizenz übertragen.
5. Bankzugänge neu einrichten, wo es die Bank verlangt. Dafür kann die Bank Aktivierungsschritte verlangen. Das erledigt der Kontoinhaber.
6. Test mit Kontoabfrage ohne Zahlung. Zahlungen erst nach Rücksprache mit dem Kunden testen.
7. **Achtung:** Alten PC erst nach erfolgreichem Test und Löschung der Daten nach Absprache entsorgen. Sicherungen mit Bankdaten verschlüsseln.

## Wenn das nicht hilft
Bank und Software-Hersteller einschalten. Für das Ticket: Software und Version, Freigabeverfahren (Art, nicht Zugangsdaten), Meldung.

=== ARTIKEL
titel: Registrierkasse aus IT-Sicht – Datensicherung, Ausfall, Gerätetausch (allgemein)
bereich: Branchensoftware & Datenbanken
tags: registrierkasse, kassa, datensicherung, kassenausfall, gerätetausch, kassensystem, belege
zielgruppe: technik
---
**Symptom:** Eine Kassa oder ein Kassensystem soll gesichert, ersetzt oder nach einem Ausfall wieder in Betrieb genommen werden. Unklar ist, was die IT dabei tun darf und was nicht.

**Häufige Ursachen:** Sicherung der Kassendaten fehlt oder wurde nie getestet. Beim Gerätetausch gehen Einrichtung, Schlüssel oder Belegdaten verloren. Zuständigkeiten zwischen Kassenhersteller, Steuerberatung und IT sind nicht geklärt.

## Lösung
1. Zuständigkeiten klären und festhalten: Der Hersteller bzw. Händler der Kassa betreut das System, die Steuerberatung gibt Anforderungen zu Aufzeichnung, Aufbewahrung und Meldungen vor. Die IT kümmert sich um Netzwerk, Strom, Sicherung der Datenträger und Ersatzhardware.
2. Beim Hersteller erfragen, welche Daten zu sichern sind und wie (Export, Sicherung, Speicherort, Intervall). Sicherung regelmäßig prüfen und auf einem zweiten Medium ablegen.
3. Für den Ausfall einen Ablauf schriftlich vereinbaren: Wen anrufen, was am Gerät nicht verändert werden darf, wie Umsätze zwischenzeitlich festgehalten werden (nach Vorgabe der Steuerberatung).
4. Vor Gerätetausch alle Daten und Einstellungen vom Hersteller sichern bzw. übertragen lassen. Das alte Gerät nicht löschen oder entsorgen, bevor Hersteller und Steuerberatung zustimmen.
5. Nach Tausch Probebeleg, Datum und Uhrzeit sowie Verbindung zu Drucker und Terminal prüfen.
6. **Achtung:** Keine Eingriffe in die Kassensoftware ohne Absprache mit dem Hersteller.

## Wenn das nicht hilft
Hersteller und Steuerberatung einbinden. Für das Ticket: Gerätetyp, Zeitpunkt des Ausfalls, Sicherungsstand, getroffene Maßnahmen.

=== ARTIKEL
titel: Zeiterfassung und Zutrittssystem ans Netz anbinden
bereich: Branchensoftware & Datenbanken
tags: zeiterfassung, zutritt, terminal, netzwerk, feste ip, stempeluhr, vlan
zielgruppe: technik
---
**Symptom:** Ein Zeiterfassungsterminal oder Zutrittskontrollgerät soll ans Netz, oder es verliert die Verbindung zum Server der Software und überträgt keine Buchungen.

**Häufige Ursachen:** Das Gerät bekommt per DHCP eine wechselnde Adresse, während die Software eine feste erwartet. Ein Port ist in der Firewall gesperrt. Gerät und Server liegen in getrennten Netzen. Datum und Uhrzeit weichen ab. Das Kabel oder der PoE-Anschluss ist gestört.

## Lösung
1. Hersteller-Dokumentation für Netzwerkanbindung, Ports und Kommunikationsrichtung einholen (Gerät verbindet zum Server oder umgekehrt).
2. Dem Gerät eine feste Adresse geben: entweder am Gerät oder besser per DHCP-Reservierung auf der Grundlage der MAC-Adresse. Adresse dokumentieren.
3. Gerät möglichst per Kabel anbinden. Bei Zutrittssystemen auf Strom- und Notfallkonzept achten.
4. Firewall am Server und im Netz so anpassen, dass nur der benötigte Port zwischen Gerät und Server geöffnet ist.
5. In der Software Adresse bzw. Gerätenamen eintragen und Verbindung testen.
6. Zeit des Geräts mit dem Server abgleichen, falls es keine automatische Zeitsynchronisation gibt.
7. Zugangsdaten des Geräts vom Standard ändern und im Passwortmanager ablegen.
8. Personenbezogene Daten (Zeiten, Zutritte) nur mit Abstimmung zu Datenschutz und Betriebsvereinbarung verarbeiten.

## Wenn das nicht hilft
Ping und Portprüfung (`Test-NetConnection Adresse -Port Portnummer`) vom Server aus durchführen. Für das Ticket: Gerätetyp, Adresse, Port, Ergebnis des Tests.

=== ARTIKEL
titel: Hersteller-Support einbinden – Fernzugriff, Protokolle, Zuständigkeiten
bereich: Branchensoftware & Datenbanken
tags: herstellersupport, fernwartung, fernzugriff, logdatei, supportanfrage, zuständigkeit, branchensoftware
zielgruppe: technik
---
**Symptom:** Ein Fehler in der Branchensoftware lässt sich intern nicht lösen. Der Hersteller soll eingebunden werden, aber Rückfragen, Fernzugriff und Zuständigkeit verzögern die Lösung.

**Häufige Ursachen:** Die Supportanfrage enthält zu wenig Angaben. Unklar ist, wer beim Kunden Anfragen stellen darf. Der Fernzugriff ist nicht freigegeben. Der Wartungsvertrag deckt die Anfrage nicht ab.

## Lösung
1. Zuständigkeit klären: Wartungsvertrag, Supportzeiten, Meldeweg und Ansprechperson des Kunden festhalten.
2. Fehler reproduzierbar beschreiben: Programmversion, Datenbankversion, Betriebssystem, genaue Meldung, Zeitpunkt, betroffene Arbeitsplätze, letzte Änderungen.
3. Protokolle sammeln: Logdateien der Anwendung (Speicherort im Handbuch oder beim Hersteller erfragen), Auszüge der Ereignisanzeige und Fotos der Meldung.
4. Fernzugriff vorbereiten: Welches Werkzeug der Hersteller nutzt, wer den Zugriff freigibt, auf welchem Gerät. Zugriff zeitlich begrenzen und nur nach Zustimmung des Kunden erteilen.
5. **Achtung:** Vor Eingriffen des Herstellers eine aktuelle Sicherung sicherstellen. Zugangsdaten nicht per E-Mail weitergeben.
6. Während der Sitzung mitlesen und Änderungen notieren, danach Zugriff beenden und eventuell eingerichtete Konten entfernen.
7. Ergebnis und Ticketnummer des Herstellers im eigenen Ticket festhalten.

## Wenn das nicht hilft
Eskalation beim Hersteller und Rücksprache mit dem Auftraggeber zur Dringlichkeit. Für das Ticket: Herstellerticket, Ansprechperson, Wortlaut der Lösung.

=== ARTIKEL
titel: Updates der Branchensoftware – Vorgehen mit Sicherung und Test, Support-Ende im Blick
bereich: Branchensoftware & Datenbanken
tags: update, branchensoftware, sicherung, test, versionswechsel, support ende, bestandsliste
zielgruppe: technik
---
**Symptom:** Ein Programm-Update der Fachanwendung steht an. Es ist unklar, wie es sicher eingespielt wird und welche Software bald keinen Support mehr erhält.

**Häufige Ursachen:** Update ohne Sicherung, nur auf einem Teil der Arbeitsplätze eingespielt, Datenbankumstellung unterbrochen, Zusatzkomponenten oder Schnittstellen passen nicht zur neuen Version. Die Bestandsliste ist veraltet.

## Lösung
1. Hinweise des Herstellers lesen: Voraussetzungen, Reihenfolge, Dauer, Bekanntes.
2. Termin außerhalb der Arbeitszeit abstimmen und alle Anwender abmelden.
3. Vollständige Sicherung von Datenbank und Programmordner anlegen. Rücksicherung möglichst vorab testen.
4. Wenn möglich, Update zuerst auf einer Testkopie oder einem Testarbeitsplatz einspielen.
5. Update auf dem Server bzw. nach Herstellerangabe zuerst, dann die Arbeitsplätze auf dieselbe Version bringen.
6. Test mit Anmelden, Datensatz öffnen, Drucken, Export und Schnittstellen. Ergebnis vom Kunden bestätigen lassen.
7. **Achtung:** Datenbankumstellungen nicht abbrechen. Bei Fehlern Sicherung zurückspielen und den Hersteller einbinden.
8. Bestandsliste pflegen: Programm, Version, Hersteller, Laufzeit der Wartung, bekanntes Support-Ende. Einmal pro Jahr durchgehen und frühzeitig Ersatz planen.

## Für das Ticket notieren
Alte und neue Version, Zeitpunkt, Sicherungsstand, Testergebnis, Support-Ende laut Hersteller.

## Wenn das nicht hilft
Rückfall auf die Sicherung und Rückfrage beim Hersteller.

=== ARTIKEL
titel: Alte Daten archivieren und aufbewahren – technische Umsetzung (allgemein)
bereich: Branchensoftware & Datenbanken
tags: archivierung, aufbewahrung, alte daten, archiv, revisionssicher, altsystem, export
zielgruppe: technik
---
**Symptom:** Eine alte Branchensoftware wird abgelöst oder die Datenbank wird zu groß. Alte Daten sollen aufbewahrt werden, ohne dass das Altsystem dauerhaft laufen muss.

**Häufige Ursachen:** Aufbewahrungsfristen sind nicht geklärt. Daten liegen nur in einem Programmformat, das ohne Programm nicht lesbar ist. Sicherungen enthalten alte Datenstände ohne Konzept. Das Altsystem läuft ungepflegt weiter.

## Lösung
1. Aufbewahrungspflichten und Fristen von Steuerberatung bzw. Rechtsberatung und Datenschutzbeauftragtem festlegen lassen. Die IT setzt um, entscheidet aber nicht über Fristen.
2. Bestandsaufnahme: welche Daten, welcher Zeitraum, welches Format, wer braucht Zugriff.
3. Beim Hersteller erfragen, ob es eine Archiv- oder Exportfunktion in lesbare Formate gibt (zum Beispiel PDF oder CSV, je nach Anforderung).
4. Export erstellen, stichprobenartig auf Vollständigkeit prüfen und mit einer Prüfsumme dokumentieren.
5. Archiv getrennt vom Alltagsbetrieb ablegen: Schreibschutz, eingeschränkte Berechtigungen, Sicherung an einem zweiten Ort. Das Format auf Lesbarkeit prüfen.
6. Alternativ ein Altsystem als abgeschottete virtuelle Maschine ohne Internetzugang vorhalten. Updates und Lizenzfragen mit dem Hersteller klären.
7. **Achtung:** Daten erst löschen, wenn Frist und Freigabe schriftlich vorliegen. Löschung dokumentieren.
8. Archivort und Ansprechperson in der Kundendokumentation festhalten.

## Wenn das nicht hilft
Hersteller und Steuerberatung einbinden. Für das Ticket: Datenumfang, Zeitraum, Format, Speicherort, Freigabe durch den Kunden.

=== ARTIKEL
titel: MySQL, MariaDB oder PostgreSQL – Dienst prüfen und Sicherung erstellen
bereich: Branchensoftware & Datenbanken
tags: mysql, mariadb, postgresql, dump, datenbankdienst, sicherung, mysqldump, pg_dump
zielgruppe: technik
---
**Symptom:** Eine Branchensoftware nutzt MySQL, MariaDB oder PostgreSQL. Der Dienst läuft nicht, die Anwendung findet die Datenbank nicht, oder es gibt keine verlässliche Sicherung.

**Häufige Ursachen:** Der Datenbankdienst ist beendet oder startet nach Updates nicht. Der Datenträger ist voll. Ein Port ist belegt oder durch die Firewall blockiert. Kein regelmäßiger Dump wurde eingerichtet.

## Lösung
1. Dienst finden: `Get-Service | Where-Object { $_.Name -match "mysql|maria|postgres" }`
2. Läuft er nicht, starten und Fehlerprotokoll prüfen (Datenverzeichnis der Datenbank, Ereignisanzeige). Freien Speicherplatz kontrollieren.
3. Standardports zur Orientierung: MySQL und MariaDB 3306, PostgreSQL 5432. Vom Client testen: `Test-NetConnection Servername -Port 3306`
4. Sicherung als logischer Dump, wenn der Hersteller es erlaubt:
   - MySQL/MariaDB: `mysqldump -u Benutzer -p --result-file=D:\Sicherung\Datenbankname.sql Datenbankname` (nicht mit `>` in PowerShell umleiten, das verändert die Zeichenkodierung)
   - PostgreSQL: `pg_dump -U Benutzer -F c -f D:\Sicherung\Datenbankname.dump Datenbankname`
5. Kennwörter nicht im Skript hinterlegen, sondern Konfigurationsdatei des jeweiligen Clients mit eingeschränkten Rechten oder den Passwortmanager verwenden.
6. Den Dump täglich per geplanter Aufgabe erzeugen und auf ein zweites Medium kopieren.
7. Rücksicherung auf einem Testsystem prüfen.
8. **Achtung:** Das Datenverzeichnis nicht im laufenden Betrieb kopieren oder löschen.

## Wenn das nicht hilft
Fehlermeldung aus dem Protokoll und Version der Datenbank an den Hersteller geben. Für das Ticket: Datenbanksystem, Version, Port, Speicherort, Fehlertext.

=== ARTIKEL
titel: Access-Datenbank im Netzwerk – Aufteilung, Beschädigung, Reparatur
bereich: Branchensoftware & Datenbanken
tags: access, mdb, accdb, beschädigt, reparieren, frontend backend, netzwerk, sperrdatei
zielgruppe: technik
---
**Symptom:** Eine auf Microsoft Access basierende Fachanwendung ist langsam, meldet „Datenbank ist beschädigt“ oder lässt sich nicht von mehreren Arbeitsplätzen gleichzeitig öffnen.

**Häufige Ursachen:** Alle Anwender öffnen dieselbe Datei auf der Freigabe, statt einer aufgeteilten Datenbank mit lokalem Frontend. Verbindungsabbrüche im WLAN oder bei VPN beschädigen die Datei. Die Datei ist sehr groß. Eine Sperrdatei (`.ldb` oder `.laccdb`) bleibt nach einem Absturz liegen.

## Lösung
1. **Achtung:** Zuerst alle Anwender abmelden und eine Kopie der Datei an einem anderen Ort ablegen. Nur an der Kopie arbeiten.
2. Prüfen, ob die Datenbank aufgeteilt ist: Backend (Tabellen) liegt auf der Freigabe, Frontend (Formulare, Berichte) liegt auf jedem PC. Ist das nicht der Fall, Aufteilung mit dem Hersteller abstimmen, da die Anwendung dafür vorbereitet sein muss.
3. Frontend je Arbeitsplatz lokal ablegen, Backend nur über UNC-Pfad verknüpfen.
4. Zur Reparatur in Access das Werkzeug **Datenbank komprimieren und reparieren** verwenden (je nach Version im Menü „Datenbanktools“). Danach die Datei stichprobenartig prüfen.
5. Bei fehlerhaften Verbindungen Netzwerk stabilisieren: Kabel statt WLAN, keine Nutzung über VPN, Offlinedateien für den Ordner ausschalten.
6. Backend regelmäßig sichern, am besten nachts bei geschlossener Datei.
7. Langfristig mit dem Hersteller die Umstellung auf eine serverbasierte Datenbank besprechen, besonders bei vielen Anwendern.

## Wenn das nicht hilft
Letzte intakte Sicherung zurückspielen. Für das Ticket: Dateiname, Größe, Zahl der Anwender, Fehlermeldung, letzte Sicherung.
