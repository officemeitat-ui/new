=== ARTIKEL
titel: Hyper-V-Host sauber einrichten – Rollen, Speicherorte, Namensschema
bereich: Virtualisierung, Azure & Hybrid
tags: hyper-v, host, einrichten, speicherort, namensschema, virtualisierung, neuer server
zielgruppe: technik
---
**Symptom:** Ein neuer physischer Server soll als Hyper-V-Host für einen Kleinbetrieb eingerichtet werden. Standardpfade auf C: und uneinheitliche Namen führen später zu Platzproblemen und Chaos.

**Häufige Ursachen:** Der Host wird nebenbei mit weiteren Rollen belegt, VM-Dateien landen auf dem Systemlaufwerk, und Namen der virtuellen Maschinen (VM) folgen keinem Schema.

## Lösung
1. Host nur für Hyper-V verwenden. Dateiserver, Domänencontroller-Rolle und Ähnliches gehören in eigene VMs.
2. Datenträger planen: kleines Laufwerk für das Betriebssystem, getrenntes Laufwerk oder Volume für VM-Dateien (zum Beispiel `D:\Hyper-V`). RAID-Controller und Cache-Akku prüfen.
3. Rolle installieren: `Install-WindowsFeature Hyper-V -IncludeManagementTools -Restart`
4. Standardpfade setzen, damit neue VMs nicht auf C: landen:
```
Set-VMHost -VirtualMachinePath "D:\Hyper-V\VMs" -VirtualHardDiskPath "D:\Hyper-V\Disks"
```
5. Namensschema festlegen, zum Beispiel Kürzel plus Funktion (`DC01`, `FS01`, `APP01`). Der VM-Name im Hyper-V-Manager sollte dem Computernamen im Gast entsprechen.
6. Host-Verwaltung (iDRAC, iLO oder Ähnliches), Zeitquelle und Updates dokumentieren. Der Host sollte nach Möglichkeit Mitglied der Domäne sein, aber nicht von einem DC abhängen, der nur auf ihm selbst läuft, ohne dass das bedacht wurde.
7. Virtuelle Switches anlegen (eigener Artikel) und Sicherung des Hosts einrichten.

## Hintergrund
Ein Pfad pro VM (Unterordner mit dem VM-Namen) erleichtert Sicherung, Umzug und Aufräumen.

## Wenn das nicht hilft
- Ticket mit Servermodell, Datenträgerlayout und Fehlermeldung bei der Rollen-Installation. Prüfen, ob Virtualisierung im BIOS/UEFI aktiviert ist.

=== ARTIKEL
titel: Virtuelle Switches in Hyper-V – extern, intern, privat
bereich: Virtualisierung, Azure & Hybrid
tags: hyper-v, virtueller switch, extern, intern, privat, netzwerk, vlan, vm kein netz
zielgruppe: technik
---
**Symptom:** Eine VM soll Netzwerkzugang bekommen, oder eine VM erreicht das Netz nicht, obwohl der Host online ist.

**Häufige Ursachen:** Falscher Switch-Typ gewählt, Switch an die falsche Netzwerkkarte gebunden, oder die Verwaltungsverbindung des Hosts ging beim Anlegen verloren.

## Lösung
1. Typen unterscheiden:
   - **Extern:** bindet an eine physische Netzwerkkarte, VMs sind im Firmennetz erreichbar.
   - **Intern:** Verbindung zwischen VMs und Host, ohne Zugang zum Firmennetz.
   - **Privat:** nur VMs untereinander, auch der Host ist ausgeschlossen.
2. Für den Normalbetrieb genügt meist ein externer Switch. Anlegen im Hyper-V-Manager über **Manager für virtuelle Switches** oder per PowerShell:
```
New-VMSwitch -Name "Extern" -NetAdapterName "Ethernet" -AllowManagementOS $true
```
3. **Achtung:** Das Anlegen kann die Netzverbindung des Hosts kurz unterbrechen. Bei Fernzugriff nur mit Konsolenzugang (iDRAC, iLO) oder vor Ort durchführen.
4. Die Option „Gemeinsames Verwenden des Netzwerkadapters durch das Verwaltungsbetriebssystem“ (AllowManagementOS) lässt den Host weiter über dieselbe Karte erreichbar.
5. In den VM-Einstellungen unter **Netzwerkadapter** den Switch auswählen. Bei VLANs die VLAN-ID an der VM setzen und den Switch-Port als Trunk konfigurieren.
6. Test in der VM mit `ipconfig` und `ping` auf das Gateway.

## Wenn das nicht hilft
- Ticket mit Ausgabe von `Get-VMSwitch`, `Get-VMNetworkAdapter -VMName <Name>` und der Angabe, ob VLANs im Einsatz sind.

=== ARTIKEL
titel: Neue virtuelle Maschine in Hyper-V anlegen – Generation, Speicher, Datenträger
bereich: Virtualisierung, Azure & Hybrid
tags: hyper-v, neue vm, generation 2, vhdx, arbeitsspeicher, datenträger, anlegen
zielgruppe: technik
---
**Symptom:** Eine neue VM soll angelegt werden. Einige Einstellungen lassen sich später nur umständlich ändern.

**Häufige Ursachen:** Falsche Generation, zu knapp bemessener Speicher, ein Datenträger für alles, VM-Dateien am falschen Ort.

## Lösung
1. Im Hyper-V-Manager **Aktion → Neu → Virtueller Computer** wählen, Namen nach Schema vergeben und Speicherort prüfen.
2. **Generation 2** wählen, wenn das Gastsystem es unterstützt (aktuelle Windows-Server- und Windows-Clientversionen). Generation 1 nur für sehr alte Gastsysteme. Die Generation lässt sich nachträglich nicht ändern.
3. Arbeitsspeicher festlegen. Bei Servern mit Datenbanken feste Zuweisung bevorzugen (siehe Artikel zu dynamischem Arbeitsspeicher).
4. Netzwerk: den passenden virtuellen Switch auswählen.
5. Datenträger als **VHDX** anlegen. Dynamisch erweiterbar spart Platz, fest bietet berechenbaren Verbrauch. Betriebssystem und Daten möglichst auf getrennte virtuelle Datenträger legen.
6. Installationsmedium (ISO) einbinden. Bei Generation 2 ist Secure Boot aktiv; Linux-Gäste brauchen je nach Distribution eine passende Vorlage.
7. Nach der Installation die Integrationsdienste prüfen und Windows-Updates einspielen. Prozessoranzahl zunächst zurückhaltend wählen.
8. VM in Sicherung, Überwachung und Dokumentation aufnehmen.

## Hintergrund
Dynamische VHDX wachsen mit dem Bedarf. Der Host muss genug Platz für das Maximum haben, sonst pausiert die VM bei vollem Volume.

## Wenn das nicht hilft
- Ticket mit Hyper-V-Version, Gastsystem, gewählter Generation und Fehlermeldung.

=== ARTIKEL
titel: Dynamischer Arbeitsspeicher in Hyper-V – wann sinnvoll, wann nicht
bereich: Virtualisierung, Azure & Hybrid
tags: hyper-v, dynamic memory, dynamischer arbeitsspeicher, ram, vm langsam, speicher
zielgruppe: technik
---
**Symptom:** Der Host hat wenig Arbeitsspeicher übrig, oder eine VM ist trotz freiem RAM im Gast langsam. Es ist unklar, ob dynamischer Speicher aktiviert werden soll.

**Häufige Ursachen:** Dynamischer Speicher wird pauschal für alle VMs gesetzt, auch für Datenbank- oder Mailserver, die ihren Speicher selbst verwalten.

## Lösung
1. Je VM entscheiden. Eher geeignet: Dateiserver, Domänencontroller, einfache Anwendungsserver mit schwankendem Bedarf. Eher ungeeignet: SQL-Server, Exchange und Anwendungen, die Speicher beim Start fest reservieren oder eigenes Caching nutzen.
2. Einstellung in den VM-Einstellungen unter **Arbeitsspeicher**. Eine Änderung der Art (statisch/dynamisch) erfordert in der Regel, dass die VM ausgeschaltet ist.
3. Drei Werte bewusst setzen: **Startwert** (reicht für Start und Grundlast), **Minimum** und **Maximum**. Das Maximum nicht auf den Hostspeicher setzen.
4. Speicherpuffer und Gewichtung nur anpassen, wenn Engpässe tatsächlich auftreten.
5. Im Betrieb beobachten: im Hyper-V-Manager die Spalten für zugewiesenen und angeforderten Speicher einblenden, im Gast die Auslastung prüfen.
6. Hostspeicher nicht überbuchen. Für den Host selbst Reserve einplanen.
7. Herstellerangaben der Anwendung beachten und die Entscheidung dokumentieren.

## Hintergrund
Feste Zuweisung ist berechenbar. Dynamischer Speicher nutzt Hardware besser aus, kann aber bei Lastspitzen zu Engpässen führen.

## Wenn das nicht hilft
- Ticket mit VM-Name, Speicherwerten (Start, Min, Max), Hostspeicher und Anwendung im Gast.

=== ARTIKEL
titel: Hyper-V-Replikat als Ausfallschutz einrichten
bereich: Virtualisierung, Azure & Hybrid
tags: hyper-v, replikat, replication, ausfallschutz, zweiter host, failover, notfall
zielgruppe: technik
---
**Symptom:** Ein Betrieb möchte, dass wichtige VMs bei einem Hostausfall auf einem zweiten Server schnell wieder laufen. Ein Cluster ist zu aufwendig.

**Häufige Ursachen:** Replikat wird mit Datensicherung verwechselt, die Netzwerk- und Zertifikatsanforderungen werden unterschätzt, oder der Zielhost hat zu wenig Ressourcen.

## Lösung
1. Voraussetzungen klären: zwei Hyper-V-Hosts, ausreichend Speicher und Platz am Ziel, Netzwerkverbindung zwischen den Hosts, passende Firewallregeln.
2. Am Zielhost im Hyper-V-Manager unter **Hyper-V-Einstellungen → Replikationskonfiguration** den Host als Replikatserver aktivieren. Bei Domänenmitgliedschaft kann die Kerberos-Authentifizierung genutzt werden, sonst Zertifikate.
3. Firewallregel für Hyper-V-Replikat am Zielhost aktivieren (je nach Authentifizierung HTTP- oder HTTPS-Regel).
4. Am Quellhost die VM wählen: **Replikation aktivieren**, Zielhost, Authentifizierung und Replikationsfrequenz angeben.
5. Erstreplikation durchführen, bei großen VMs außerhalb der Arbeitszeit oder per Austauschmedium.
6. Failover mindestens einmal testen, **Testfailover** nutzen, damit der Betrieb nicht gestört wird.
7. Beachten: IP-Adressen im Zielnetz können abweichen. Den Ablauf schriftlich festhalten.

## Hintergrund
Replikat kopiert Änderungen zeitversetzt. Gelöschte oder beschädigte Daten werden mitkopiert. Eine Sicherung ersetzt das nicht.

## Wenn das nicht hilft
- Ticket mit Replikationsstatus (`Get-VMReplication`), Authentifizierungsart und Fehlermeldung aus der Ereignisanzeige.

=== ARTIKEL
titel: Virtuelle Maschine auf einen anderen Hyper-V-Host umziehen
bereich: Virtualisierung, Azure & Hybrid
tags: hyper-v, vm umziehen, export, import, verschieben, neuer host, migration
zielgruppe: technik
---
**Symptom:** Eine VM soll auf einen neuen oder anderen Hyper-V-Host übersiedeln, etwa nach einem Hardwaretausch.

**Häufige Ursachen:** Fehlender Platz am Ziel, ein anderer virtueller Switch-Name, unterschiedliche Prozessoren, doppelte VM-Kennungen beim Import oder Prüfpunkte, die noch hängen.

## Lösung
1. Zielhost vorbereiten: gleiche oder neuere Hyper-V-Version, genug Platz, gleichnamiger virtueller Switch.
2. Vorher prüfen: Prüfpunkte zusammenführen, Sicherung der VM vorhanden, VM-Konfigurationsversion beachten (eine VM von neuerem auf älteren Host zu bringen geht nicht ohne Weiteres).
3. **Achtung:** Beim Export-Weg ist die VM abgeschaltet. Wartungsfenster einplanen.
4. VM herunterfahren und exportieren:
```
Export-VM -Name "APP01" -Path "E:\Export"
```
5. Ordner zum Zielhost kopieren und dort importieren, im Hyper-V-Manager unter **Aktion → Virtuellen Computer importieren** oder per `Import-VM`. Bei Bedarf Option „Kopie erstellen“ mit neuer ID wählen, wenn die Original-VM noch existiert.
6. Netzwerkadapter dem Switch zuordnen und VM starten. Gast prüfen: Netzwerk, Dienste, Zeit.
7. Alternative bei Hosts in derselben Domäne: **Verschieben** im Hyper-V-Manager (Live-Migration), setzt Konfiguration von Delegierung oder CredSSP voraus.
8. Original erst nach einigen Tagen Betrieb entfernen.

## Wenn das nicht hilft
- Ticket mit Hyper-V-Versionen beider Hosts, Fehlermeldung beim Import und Ausgabe von `Compare-VM`.

=== ARTIKEL
titel: Virtuelle Maschinen konsistent sichern – Host- oder Gastsicherung
bereich: Virtualisierung, Azure & Hybrid
tags: hyper-v, vm sichern, backup, konsistent, vss, datenbank, wiederherstellung
zielgruppe: technik
---
**Symptom:** Virtuelle Maschinen sollen gesichert werden. Nach einer Wiederherstellung startet eine VM nicht sauber, oder Datenbanken melden Fehler.

**Häufige Ursachen:** Absturzkonsistente statt anwendungskonsistente Sicherung, Integrationsdienste für die Sicherung deaktiviert, Sicherung nur auf demselben Host oder Volume.

## Lösung
1. Methode wählen: **Hostsicherung** (Sicherungssoftware am Hyper-V-Host sichert die VM ganz) oder **Gastsicherung** (Agent in der VM). Oft ergänzen sich beide.
2. Bei der Hostsicherung nutzt Hyper-V den Schattenkopiedienst (VSS) im Gast. Dazu muss der Integrationsdienst **Datensicherung** der VM aktiv sein und der Gast VSS-fähig laufen.
3. Anwendungen wie SQL oder Exchange nur dann ohne Gastagent sichern, wenn die Sicherungssoftware dies ausdrücklich unterstützt.
4. Sicherungsziel nicht auf demselben Datenträger oder in derselben VM ablegen. Mindestens eine Kopie extern oder offline.
5. Prüfpunkte nicht als Sicherung betrachten.
6. **Wiederherstellungstest** regelmäßig: VM an anderer Stelle oder mit getrenntem Netzwerk starten und Anwendung prüfen. Dauer der Wiederherstellung festhalten.
7. Sicherungsprotokolle auf Warnungen zu VSS durchsehen.
8. Bei Domänencontrollern Hinweise des Herstellers zur Wiederherstellung beachten, ohne die Datenbank blind zurückzuspielen.

## Hintergrund
Anwendungskonsistent heißt, die Anwendung wurde vor dem Schnappschuss in einen sauberen Zustand gebracht.

## Wenn das nicht hilft
- Ticket mit Sicherungssoftware, Fehlermeldung, Ausgabe von `vssadmin list writers` im Gast und letzter erfolgreicher Sicherung.

=== ARTIKEL
titel: Updates am Hyper-V-Host – Reihenfolge und Wartungsfenster
bereich: Virtualisierung, Azure & Hybrid
tags: hyper-v, host update, windows update, wartungsfenster, neustart, reihenfolge
zielgruppe: technik
---
**Symptom:** Der Host braucht Windows-Updates und einen Neustart. Alle VMs sind betroffen, deshalb muss die Wartung geplant werden.

**Häufige Ursachen:** Updates ohne Ankündigung, Neustart mitten im Betrieb, VMs fahren nicht sauber herunter, Firmware wird vergessen, keine Rückfallebene.

## Lösung
1. Wartungsfenster mit der Geschäftsleitung abstimmen, Betroffene informieren. Ablauf und Dauer schätzen.
2. Vorher prüfen: Sicherungen aller VMs erfolgreich, freier Platz am Host, Zugriff auf Konsole (iDRAC, iLO) vorhanden, Zugangsdaten bekannt.
3. Reihenfolge einhalten: zuerst die Gast-Server nach Abhängigkeit aktualisieren oder bewusst getrennt planen, dann den Host. Beim Herunterfahren zuletzt die Domänencontroller, beim Hochfahren zuerst.
4. **Achtung:** Der Host-Neustart unterbricht alle VMs. Das Verhalten beim Herunterfahren in den VM-Einstellungen prüfen (Aktion bei Herunterfahren des Hosts, am besten „Gast herunterfahren“).
5. Updates und, falls vorgesehen, Firmware/Treiber einspielen. Dann neu starten.
6. Danach kontrollieren: Alle VMs gestartet, Dienste laufen, Replikation und Sicherung funktionieren, Ereignisanzeige ohne neue Fehler.
7. Bei zwei Hosts nacheinander aktualisieren und VMs zwischendurch verschieben.
8. Durchgeführte Updates und Dauer dokumentieren.

## Wenn das nicht hilft
- Ticket mit Updatestand, Fehlermeldung, Reihenfolge der Schritte und Zustand der VMs nach dem Neustart.

=== ARTIKEL
titel: Alten physischen Server virtualisieren – Vorgehen und Stolpersteine
bereich: Virtualisierung, Azure & Hybrid
tags: p2v, physisch zu virtuell, server virtualisieren, disk2vhd, migration, hyper-v
zielgruppe: technik
---
**Symptom:** Ein alter physischer Server (Dateiserver, Anwendungsserver) soll als VM weiterlaufen, damit die Hardware abgelöst werden kann.

**Häufige Ursachen:** Treiber und Herstellersoftware im Abbild, fehlende Zeit für Tests, Lizenzbindung an Hardware, Domänencontroller werden wie normale Server behandelt, Abbild während laufender Datenbank.

## Lösung
1. Prüfen, ob eine Neuinstallation mit Datenmigration sauberer ist. Bei sehr altem System oft die bessere Wahl.
2. Anwendungs- und Lizenzfragen beim Hersteller klären, etwa Bindung an Hardware oder Dongle.
3. Bestandsaufnahme: Betriebssystem, Datenträgergrößen, Dienste, Herstellertreiber, Rolle im Netz.
4. **Achtung:** Vollständige Sicherung vor Beginn anlegen und die Wiederherstellung prüfen. Domänencontroller nicht per Abbild klonen oder virtualisieren, stattdessen neu aufsetzen.
5. Abbild erstellen, zum Beispiel mit einem Werkzeug des Sicherungsherstellers oder dem Sysinternals-Werkzeug Disk2vhd, und in VHDX umwandeln. Für laufende Datenbanken zuvor Dienste beenden.
6. Neue VM mit passender Generation anlegen, Abbild einbinden und starten. Beim ersten Start Herstelleragenten und Treiber der Hardware entfernen, Integrationsdienste prüfen.
7. Altes Gerät **abgeschaltet und getrennt** halten, damit keine doppelte Adresse entsteht. Das Original nicht zeitgleich im Netz betreiben.
8. Testphase mit Anwendern, dann Altgerät erst nach Wartezeit außer Betrieb nehmen.

## Wenn das nicht hilft
- Ticket mit Betriebssystem, Rolle, Fehlermeldung beim Start der VM und Nennung des verwendeten Werkzeugs.

=== ARTIKEL
titel: Windows-Server-Lizenzierung in virtuellen Umgebungen – worauf zu achten ist
bereich: Virtualisierung, Azure & Hybrid
tags: lizenz, windows server, virtualisierung, vm, hyper-v, cal, lizenzierung
zielgruppe: technik
---
**Symptom:** Ein Kunde will mehrere VMs auf einem Host betreiben und fragt, ob die Windows-Server-Lizenzen dafür reichen.

**Häufige Ursachen:** Annahmen aus der Zeit physischer Server, Verwechslung von Server- und Zugriffslizenzen, unklare Zuordnung bei Hostwechsel, veraltete Informationen aus dem Internet.

## Lösung
1. Wichtig vorab: Dieser Artikel ersetzt keine Lizenzberatung. Verbindliche Aussagen kommen vom Lizenzgeber oder Distributor und aus den aktuellen Produktbedingungen des Herstellers.
2. Bestandsaufnahme: Welche Server-Betriebssysteme laufen als VM, in welcher Edition und Version? Wie viele Prozessoren und Kerne hat der Host? Wie viele Personen oder Geräte greifen zu?
3. Fragen, die geklärt werden sollten: Welche Edition erlaubt wie viele VMs? Wie wird nach Prozessorkernen gezählt? Sind Zugriffslizenzen (CAL) erforderlich und welcher Art?
4. Auch Zusatzprodukte (Datenbank, Remotedesktopdienste, Anwendungen) haben eigene Regeln.
5. Bei Hostwechsel, Replikat oder Failover-Host vorab klären, ob der Zweithost mitlizenziert werden muss.
6. Lizenznachweise (Kaufbelege, Keys, Vertragsdaten) zentral ablegen und mit dem Ist-Zustand abgleichen.
7. Aktivierung der VMs prüfen: Der Aktivierungsstatus sagt nichts darüber, ob die Lizenzierung vollständig ist.
8. Offene Punkte schriftlich an den Lizenzgeber geben und Antwort ablegen.

## Wenn das nicht hilft
- Ticket mit Liste der VMs, Editionen, Hostdaten (Prozessoren, Kerne) und der konkreten Frage an den Lizenzgeber.

=== ARTIKEL
titel: Von einer anderen Virtualisierungsplattform zu Hyper-V wechseln – Überblick
bereich: Virtualisierung, Azure & Hybrid
tags: umstieg, hyper-v, vmware, virtualisierung, vm konvertieren, vhdx, migration
zielgruppe: technik
---
**Symptom:** Ein Kunde betreibt VMs auf einer anderen Plattform und will auf Hyper-V wechseln, etwa aus Kosten- oder Lizenzgründen.

**Häufige Ursachen:** Unterschätzter Aufwand für Treiber und Gasttools, Netzwerk- und IP-Änderungen, Sicherung und Überwachung hängen an der alten Plattform, kein Rückweg.

## Lösung
1. Bestand erfassen: VMs, Betriebssysteme, Datenträger, Netzwerke, Abhängigkeiten, Sicherungs- und Überwachungswerkzeuge.
2. Zielhost nach Standard einrichten (eigener Artikel) und Sicherung dort vorbereiten.
3. Methode je VM wählen: Konvertierung der Datenträger in VHDX mit einem Werkzeug (je nach Hersteller und Version verfügbar, aktuelle Dokumentation prüfen), Sicherung und Wiederherstellung auf dem Zielhost, oder Neuaufbau mit Datenmigration. Domänencontroller und sehr alte Systeme besser neu aufbauen.
4. **Achtung:** Vor jeder Konvertierung die VM sichern und Original unverändert behalten. Die VM ist während der Konvertierung abgeschaltet.
5. Nach dem Start: Gasttools der alten Plattform entfernen, Integrationsdienste von Hyper-V prüfen, Netzwerkadapter neu zuordnen. Eine neue Netzwerkkarte kann die IP-Einstellung zurücksetzen, deshalb Werte vorher notieren.
6. Aktivierung und Lizenz prüfen, da sich virtuelle Hardware ändert.
7. Testbetrieb mit Anwendern, danach alte VM nach einer Wartezeit abschalten und löschen.
8. Pilot mit einer unkritischen VM vorab durchführen.

## Wenn das nicht hilft
- Ticket mit Ausgangsplattform und Version, Betriebssystem der VM, genutztem Werkzeug und Fehlermeldung.

=== ARTIKEL
titel: Verzeichnissynchronisierung mit Microsoft 365 – Überblick und Voraussetzungen
bereich: Virtualisierung, Azure & Hybrid
tags: entra connect, azure ad connect, synchronisierung, active directory, microsoft 365, hybrid, identität
zielgruppe: technik
---
**Symptom:** Ein Betrieb hat ein lokales Active Directory und Microsoft 365. Benutzer sollen mit demselben Anmeldenamen und Kennwort in beiden Welten arbeiten.

**Häufige Ursachen:** Domäne ist nicht öffentlich nutzbar (.local), Benutzernamen passen nicht zur E-Mail-Adresse, AD ist nicht bereinigt, die Rolle des Synchronisationsservers ist unklar.

## Lösung
1. Zweck klären: Das lokale AD bleibt die führende Quelle, die Konten werden mit Microsoft Entra ID (früher Azure AD) synchronisiert. Dafür dient Microsoft Entra Connect (früher Azure AD Connect).
2. Voraussetzungen prüfen: unterstütztes Serverbetriebssystem, Domänenmitglied, Internetzugang, Konto mit passenden Rechten in AD und im Mandanten, aktuelle Anforderungen laut Herstellerdokumentation.
3. Domäne und UPN-Suffix prüfen: Die Anmeldenamen sollten eine im Mandanten überprüfte Domäne verwenden. Eine nicht routbare Endung wie `.local` muss vorher durch ein UPN-Suffix ersetzt werden.
4. AD bereinigen: doppelte Adressen, ungültige Zeichen, veraltete Konten. Das Prüfwerkzeug IdFix des Herstellers kann dabei helfen.
5. Anmeldemethode wählen: Kennworthash-Synchronisierung ist die einfachste, Passthrough-Authentifizierung oder Verbund sind aufwendiger.
6. Zuerst nur eine Test-OU synchronisieren, dann erweitern. Der Server braucht Sicherung und Überwachung.
7. Nach dem Start Status im Entra-Admin-Center und mit dem Synchronization Service Manager prüfen.

## Hintergrund
Nach der Synchronisierung werden synchronisierte Konten im Cloud-Verzeichnis nicht mehr direkt verwaltet, sondern lokal.

## Wenn das nicht hilft
- Ticket mit Domänenname, UPN-Suffixen, Version des Synchronisationswerkzeugs und Fehlertexten.

=== ARTIKEL
titel: Synchronisierungsfehler finden – doppelte Adressen und nicht synchronisierte Objekte
bereich: Virtualisierung, Azure & Hybrid
tags: synchronisierungsfehler, entra connect, proxyaddresses, doppelt, attribut, konto fehlt, sync
zielgruppe: technik
---
**Symptom:** Ein Benutzer erscheint nicht in Microsoft 365, eine Änderung kommt nicht an, oder im Admin-Center steht ein Hinweis auf Synchronisierungsfehler.

**Häufige Ursachen:** Dieselbe E-Mail-Adresse (`proxyAddresses`) oder derselbe UPN bei zwei Objekten, ungültige Zeichen in Attributen, Objekt liegt außerhalb der synchronisierten OU, Synchronisierung läuft nicht.

## Lösung
1. Im Microsoft-365-Admin-Center oder Entra-Admin-Center nach Hinweisen zu Verzeichnissynchronisierungsfehlern suchen. Das Objekt und das betroffene Attribut werden genannt.
2. Lokal die doppelten Werte suchen, zum Beispiel:
```
Get-ADUser -Filter "proxyAddresses -like '*smtp:max@beispiel.at'" -Properties proxyAddresses
```
3. Auch Gruppen, Kontakte und Ressourcenpostfächer prüfen, nicht nur Benutzer.
4. Fehlerhaftes Attribut im AD korrigieren oder den Doppelten entfernen. **Achtung:** Vor Änderungen an Adressen klären, welches Objekt das richtige ist, damit keine Postfächer die Adresse verlieren.
5. Synchronisierung auf dem Server anstoßen:
```
Start-ADSyncSyncCycle -PolicyType Delta
```
6. Fehlt ein Objekt ganz, Filterung prüfen: OU-Auswahl im Konfigurationsassistenten, Attributfilter und ob das Konto deaktiviert oder ausgenommen ist.
7. Im Synchronization Service Manager die Fehler am Connector einsehen.
8. Nach wenigen Minuten prüfen, ob der Fehler verschwindet.

## Wenn das nicht hilft
- Ticket mit Benutzername, Wortlaut der Fehlermeldung, betroffenem Attribut und Zeitpunkt des letzten Synchronisationslaufs.

=== ARTIKEL
titel: Anmeldenamen (UPN) an die E-Mail-Adresse angleichen
bereich: Virtualisierung, Azure & Hybrid
tags: upn, anmeldename, e-mail-adresse, upn-suffix, domäne, microsoft 365, anmeldung
zielgruppe: technik
---
**Symptom:** Benutzer müssen sich in Microsoft 365 mit einem anderen Namen anmelden, als ihre E-Mail-Adresse lautet. Oder das UPN-Suffix ist `.local` und lässt sich nicht synchronisieren.

**Häufige Ursachen:** Das AD wurde mit einem internen Domänennamen angelegt, UPN und Mailadresse wurden nie abgestimmt, Skripte oder Anwendungen nutzen den alten Anmeldenamen.

## Lösung
1. Zieldomäne festlegen: Der UPN soll auf eine im Mandanten überprüfte Domäne enden, am besten identisch mit der Hauptadresse.
2. Bestehende UPN prüfen: `Get-ADUser -Filter * -Properties UserPrincipalName | Select Name,UserPrincipalName`
3. Neues UPN-Suffix im AD hinzufügen: **Active Directory-Domänen und -Vertrauensstellungen**, Eigenschaften des obersten Knotens, Feld für alternative UPN-Suffixe.
4. **Achtung:** Ein neuer UPN ändert den Anmeldenamen. Anwender informieren. Anwendungen, VPN, Netzwerkgeräte und Dienste mit festem Anmeldenamen vorher erfassen. Wartungsfenster wählen, Sicherung des AD prüfen.
5. Für einen Test zuerst ein Konto ändern, per Skript oder im AD-Benutzer-Dialog (Reiter **Konto**):
```
Set-ADUser -Identity max.muster -UserPrincipalName max.muster@beispiel.at
```
6. Synchronisierung anstoßen und im Entra-Admin-Center prüfen. Danach die übrigen Konten umstellen.
7. Auf Clients kann sich Outlook, Teams und OneDrive neu anmelden müssen.

## Wenn das nicht hilft
- Ticket mit altem und neuem UPN, Fehlermeldung bei der Anmeldung und betroffenen Anwendungen.

=== ARTIKEL
titel: Letzter Exchange-Server im Haus – was nach der Migration bleibt
bereich: Virtualisierung, Azure & Hybrid
tags: exchange, hybrid, exchange online, migration, letzter server, attribute, mailverwaltung
zielgruppe: technik
---
**Symptom:** Alle Postfächer sind nach Exchange Online umgezogen. Der alte Exchange-Server läuft noch, und es ist unklar, ob er abgeschaltet werden darf.

**Häufige Ursachen:** Die Verzeichnissynchronisierung ist weiter führend für Mailattribute, Drucker, Scanner und Anwendungen senden noch über den Server, Zertifikate und DNS verweisen noch auf ihn.

## Lösung
1. Vollständige Bestandsaufnahme: Postfächer, Öffentliche Ordner, freigegebene Postfächer, Verteiler, Connectoren, Zertifikate, DNS-Einträge (Autodiscover, MX).
2. Mailfluss prüfen: Wer sendet noch über den lokalen Server (Scanner, Software, Drucker)? Auf Exchange Online umstellen, etwa mit einem Connector oder authentifiziertem Versand.
3. Mit synchronisiertem AD bleiben die Mailattribute lokal führend. Eine Verwaltung ohne Exchange-Server ist nur in bestimmten Konstellationen vorgesehen. Aktuelle Herstellervorgaben dazu prüfen, bevor der Server entfernt wird.
4. Häufige Praxis: einen verwalteten Rest-Server oder die Verwaltungstools behalten. Nicht einfach löschen.
5. **Achtung:** Vor Deinstallation Sicherung des Servers und des AD, Hybridkonfiguration sauber zurückbauen und Dokumentation lesen. Ein unsauber entfernter Server hinterlässt Einträge im AD.
6. Danach: DNS bereinigen, Zertifikate und Firewallregeln entfernen, Testmails prüfen.
7. Entscheidung und Zustand dokumentieren.

## Hintergrund
Die Hybridkonfiguration ermöglicht die Mailverwaltung für synchronisierte Konten aus Exchange-Werkzeugen heraus.

## Wenn das nicht hilft
- Ticket mit Exchange-Version, Hybrid-Status, restlichen Verbrauchern und Fehlern beim Mailfluss.

=== ARTIKEL
titel: Dateiserver nach SharePoint und OneDrive umziehen – Planung
bereich: Virtualisierung, Azure & Hybrid
tags: dateiserver, sharepoint, onedrive, umzug, migration, planung, laufwerke
zielgruppe: technik
---
**Symptom:** Ein Betrieb will den lokalen Dateiserver zugunsten von SharePoint und OneDrive ablösen. Es fehlt ein Plan, was wohin gehört.

**Häufige Ursachen:** 1:1-Kopie ohne Aufräumen, zu lange Pfade, Dateien mit unzulässigen Zeichen, riesige Ordner, Anwendungen mit Zugriff auf Netzlaufwerke, unklare Berechtigungen.

## Lösung
1. Bestandsaufnahme: Datenmenge, Anzahl Dateien, Ordnerstruktur, größte Dateien, Alter, Berechtigungen. Alte Daten vorher archivieren oder löschen.
2. Zielstruktur festlegen: Abteilungs- und Projektdaten gehören in Teams-/SharePoint-Bibliotheken, persönliche Daten in OneDrive. Nicht ein einziges Riesen-Laufwerk abbilden.
3. Berechtigungen vereinfachen: wenige Gruppen (Besitzer, Mitglieder, Besucher) statt einzelner Ordnerrechte.
4. Einschränkungen prüfen: Pfadlänge, unzulässige Zeichen und Dateitypen, Dateigrößen, Anzahl Elemente pro Bibliothek, Synchronisation großer Bibliotheken im Explorer.
5. Software prüfen: Branchenprogramme, Access-Dateien, Makros und Verknüpfungen, die feste Laufwerkspfade brauchen. Diese bleiben oft besser lokal.
6. Anwender einbinden: Schulung zu Synchronisation, Teilen, Versionen und Papierkorb. Alte Netzlaufwerke nach der Umstellung schreibgeschützt halten.
7. Pilotabteilung zuerst, dann der Rest. Zeitplan mit Datenstichtag.
8. Sicherung der Cloud-Daten klären, da Papierkorb und Versionen keine Datensicherung sind.

## Wenn das nicht hilft
- Ticket mit Datenmenge, Anzahl Dateien, Struktur, Spezialsoftware und gewünschtem Zeitplan.

=== ARTIKEL
titel: Migration mit dem SharePoint-Migrationstool – Ablauf und Stolpersteine
bereich: Virtualisierung, Azure & Hybrid
tags: spmt, sharepoint migrationstool, dateien migrieren, dateiserver, fehlerbericht, migration
zielgruppe: technik
---
**Symptom:** Daten vom Dateiserver sollen mit dem SharePoint-Migrationstool (SPMT) in SharePoint oder OneDrive kopiert werden. Einzelne Dateien werden nicht übertragen.

**Häufige Ursachen:** Unzulässige Zeichen oder zu lange Pfade, gesperrte oder geöffnete Dateien, fehlende Rechte im Ziel, Zielbibliothek zu früh befüllt, Bandbreite.

## Lösung
1. Vorbereitung: Zielwebsites und Bibliotheken anlegen, Berechtigungen setzen, Planung des Umzugs (eigener Artikel) abschließen.
2. Tool auf einem Rechner oder Server mit gutem Zugriff auf die Quelle und schneller Internetverbindung installieren und mit einem Konto anmelden, das im Ziel ausreichend Rechte hat.
3. Quelle (Freigabe oder Ordner) und Ziel (Website und Bibliothek) angeben. Zuerst eine kleine Testmigration durchführen.
4. Einstellungen prüfen: Umgang mit Berechtigungen, Datum der letzten Änderung erhalten, Filter für Dateitypen. Je nach Version des Tools verschieden.
5. **Achtung:** Quelle nicht verändern, bis die Prüfung abgeschlossen ist. Quelle schreibgeschützt setzen, um Änderungen nach dem Stichtag zu verhindern.
6. Migration starten, in zeitlich passenden Abschnitten, notfalls außerhalb der Arbeitszeit.
7. Berichte auswerten: nicht migrierte Elemente mit Grund. Ursachen beheben, zum Beispiel Dateinamen anpassen, und erneut ausführen. Schrittweise Nachsynchronisation vor dem Umschalten nutzen.
8. Stichproben im Ziel prüfen, Anwender auf neue Orte hinweisen.

## Wenn das nicht hilft
- Ticket mit Fehlerbericht des Tools, Quellpfad, Zielbibliothek und Version des Tools.

=== ARTIKEL
titel: Azure Files als Ersatz für den Dateiserver – Überblick
bereich: Virtualisierung, Azure & Hybrid
tags: azure files, dateifreigabe, smb, cloud, dateiserver, azure file sync, netzlaufwerk
zielgruppe: technik
---
**Symptom:** Ein Kunde möchte Netzlaufwerke behalten, aber den Dateiserver nicht mehr lokal betreiben. Azure Files wurde als Möglichkeit genannt.

**Häufige Ursachen:** Unterschätzte Anbindung (Leitung, Port 445 beim Internetanbieter), fehlende Identitätsanbindung, Annahme, dass Rechte automatisch wie am alten Server funktionieren.

## Lösung
1. Prinzip: Azure Files stellt SMB-Freigaben in einem Speicherkonto bereit, die als Netzlaufwerk eingebunden werden können.
2. Anforderungen prüfen: Zugriff auf den SMB-Port (445) von den Standorten oder über VPN beziehungsweise private Verbindung, ausreichende Bandbreite und geringe Latenz.
3. Identität: Für Berechtigungen wie am Server (NTFS-Rechte je Benutzer) muss die Authentifizierung an das AD oder an Entra angebunden werden. Mögliche Varianten und Voraussetzungen sind je nach Stand beim Hersteller nachzulesen.
4. Alternative bei Bedarf an lokalem Cache: **Azure File Sync** hält einen lokalen Server als Zwischenspeicher. Dann bleibt ein lokaler Server bestehen.
5. Vergleich mit SharePoint: Azure Files passt, wenn Anwendungen klassische Laufwerke und Dateisystemfunktionen brauchen.
6. Kosten, Redundanzstufe und Sicherung (Momentaufnahmen, Azure Backup) vorab planen. Konkrete Preise mit dem Anbieter oder Lizenzpartner klären.
7. Pilot mit einer Freigabe, Zugriffsgeschwindigkeit messen, Daten kopieren und Laufwerke umstellen.

## Wenn das nicht hilft
- Ticket mit Datenmenge, Standorten, Leitungsbandbreiten, vorhandener Identitätslösung und Zielbild.

=== ARTIKEL
titel: Virtuelle Maschine in Azure – Größe, Datenträger, Erreichbarkeit
bereich: Virtualisierung, Azure & Hybrid
tags: azure, virtuelle maschine, vm größe, datenträger, öffentliche ip, nsg, bastion
zielgruppe: technik
---
**Symptom:** Ein Server soll als VM in Azure laufen. Die Auswahl von Größe, Datenträgern und Zugang ist unübersichtlich, oder die VM ist zu langsam, zu teuer oder offen aus dem Internet erreichbar.

**Häufige Ursachen:** Zu große Standardgröße, falscher Datenträgertyp, öffentliche IP mit offenem RDP-Port, fehlende Sicherung.

## Lösung
1. Ressourcengruppe, Region und virtuelles Netzwerk vorab festlegen (siehe Artikel zur Ordnung von Ressourcen).
2. Größe nach tatsächlichem Bedarf wählen (Kerne, Arbeitsspeicher). Die Größe lässt sich später ändern, meist mit Neustart. Anbieterauswahl und Preise im Azure-Portal prüfen.
3. Datenträger: Betriebssystemdatenträger und separate Datenträger für Daten. Leistungsstufe (Standard oder Premium, SSD oder HDD) nach Last wählen.
4. Erreichbarkeit: **Achtung:** Keine öffentliche IP mit offenem RDP-Port (3389) für den Dauerbetrieb. Besser Zugang über VPN, Azure Bastion oder Remotedesktop-Gateway. Zugriff mit der Netzwerksicherheitsgruppe auf bekannte Adressen beschränken.
5. Automatisches Herunterfahren für Testsysteme einrichten. Beachten: Eine heruntergefahrene VM im Gast ist nicht automatisch freigegeben. Erst „Beenden“ im Portal gibt Rechenzeit frei, Datenträger kosten weiter.
6. Sicherung aktivieren (eigener Artikel), Markierungen (Tags) setzen, Zeitzone und Updates prüfen.
7. Lizenzierung des Betriebssystems und der Anwendungen mit dem Lizenzgeber klären.

## Wenn das nicht hilft
- Ticket mit Region, Größe, Datenträgertypen, Netzwerkregeln und Fehlermeldung aus dem Portal.

=== ARTIKEL
titel: Azure Backup für Server und virtuelle Maschinen
bereich: Virtualisierung, Azure & Hybrid
tags: azure backup, sicherung, recovery services, mars-agent, vm sichern, cloud-backup
zielgruppe: technik
---
**Symptom:** Server oder VMs sollen zusätzlich in der Cloud gesichert werden, als externe Kopie. Es ist unklar, welche Variante passt.

**Häufige Ursachen:** Kein Wiederherstellungstest, Aufbewahrung nicht festgelegt, Sicherung bleibt im selben Abonnement ohne Schutz vor Löschung, Bandbreite reicht für die Erstsicherung nicht.

## Lösung
1. Sicherungstresor anlegen (Recovery Services Tresor oder je nach Portal-Stand Backup-Tresor), in passender Region und Ressourcengruppe.
2. Variante wählen:
   - **Azure-VMs:** Sicherung direkt im Portal aktivieren, Richtlinie auswählen.
   - **Lokale Dateien und Ordner:** MARS-Agent auf dem Windows-Server installieren, Tresoranmeldedaten laden, Zeitplan und Aufbewahrung festlegen.
   - **Lokale Hyper-V-VMs und mehr:** je nach Lösung des Herstellers zusätzliche Komponenten. Aktuelle Dokumentation prüfen.
3. Das Verschlüsselungskennwort (Passphrase) des Agenten sicher und getrennt aufbewahren. **Achtung:** Ohne Passphrase ist keine Wiederherstellung möglich.
4. Aufbewahrung und Zeitplan mit dem Kunden abstimmen. Erstsicherung außerhalb der Arbeitszeit, Bandbreite begrenzen.
5. Schutz vor versehentlichem oder böswilligem Löschen im Tresor aktivieren (Funktionen zu vorläufigem Löschen und Mehrfaktor je nach Angebot).
6. Benachrichtigungen bei Fehlern einrichten und regelmäßig prüfen.
7. Wiederherstellung testen und Zeitbedarf festhalten.
8. Kosten hängen von Datenmenge ab. Schätzung mit dem Lizenzpartner abstimmen.

## Wenn das nicht hilft
- Ticket mit Art der Sicherung, Agentenversion, Fehlermeldung, Datenmenge und Ergebnis des letzten Wiederherstellungstests.

=== ARTIKEL
titel: Azure Site Recovery – Überblick Notfallstandort
bereich: Virtualisierung, Azure & Hybrid
tags: azure site recovery, asr, notfallstandort, disaster recovery, failover, replikation
zielgruppe: technik
---
**Symptom:** Ein Kunde fragt, ob Server bei einem Standortausfall (Brand, Wasser, Stromausfall) in Azure weiterlaufen könnten.

**Häufige Ursachen:** Erwartung, dass Failover automatisch alles löst, vergessene Abhängigkeiten (DNS, Domänencontroller, Internetanbindung), fehlendes Netzwerkkonzept, nie getestet.

## Lösung
1. Zweck verstehen: Azure Site Recovery (ASR) repliziert VMs fortlaufend in Azure. Im Notfall werden Kopien dort gestartet. Es ist eine Ergänzung zur Sicherung, kein Ersatz.
2. Ziele festlegen: Wie lange darf der Ausfall dauern (Wiederanlaufzeit) und wie viel Datenverlust ist tragbar? Danach richtet sich der Aufwand.
3. Kandidaten auswählen: nur wirklich kritische Server. Reihenfolge und Abhängigkeiten festhalten, zum Beispiel Domänencontroller und DNS zuerst.
4. Voraussetzungen prüfen: Unterstützung des Gastsystems und der Hyper-V- oder anderen Plattform, Verbindung nach Azure, Tresor, Replikationsrichtlinie. Vorgaben des Herstellers sind versionsabhängig.
5. Netzwerk in Azure planen: Adressbereiche, VPN, wie Anwender im Notfall zugreifen (Homeoffice, VPN-Client).
6. **Achtung:** Testfailover regelmäßig in einem isolierten Netz durchführen, nie ungeprüft produktiv umschalten.
7. Notfallhandbuch schreiben: Wer entscheidet, wer führt aus, wie wird zurückgeschwenkt.
8. Kosten fallen für Speicher und Replikation laufend an. Details mit dem Lizenzpartner klären.

## Wenn das nicht hilft
- Ticket mit gewünschten Wiederanlaufzeiten, Serverliste, Plattform und Netzwerkanbindung.

=== ARTIKEL
titel: Azure Virtual Desktop oder Windows 365 – Entscheidungshilfe
bereich: Virtualisierung, Azure & Hybrid
tags: azure virtual desktop, windows 365, cloud-pc, avd, entscheidung, remote arbeiten, desktop
zielgruppe: technik
---
**Symptom:** Ein Betrieb möchte Arbeitsplätze aus der Cloud bereitstellen, etwa für Homeoffice, Außenstellen oder Branchensoftware. Beide Angebote wirken ähnlich.

**Häufige Ursachen:** Vergleich nur nach Preis, Anwendungs- und Netzwerkabhängigkeiten unbeachtet, Aufwand für Betrieb unterschätzt, Erwartung, dass alles ohne Verwaltung läuft.

## Lösung
1. Grundunterschied: **Windows 365** liefert pro Benutzer einen festen Cloud-PC mit überschaubarem Verwaltungsaufwand. **Azure Virtual Desktop** ist flexibler (Sitzungen auf geteilten Hosts, Skalierung, mehr Einstellungen), braucht aber mehr Planung und Betrieb.
2. Anforderungen sammeln: Anzahl Benutzer, Anwendungen, Leistungsbedarf (Grafik, Speicher), Zugriff auf Daten und Server im Büro, Drucken, Peripherie.
3. Netzwerk klären: Zugriff auf lokale Ressourcen verlangt ein VPN oder eine private Verbindung zu Azure. Die Latenz zu Datenbanken oder Dateiservern beachten.
4. Verwaltung: Wer pflegt Abbilder, Updates, Profile (zum Beispiel mit FSLogix) und Anwendungen?
5. Lizenzierung und Voraussetzungen (Microsoft-365-Pläne, Windows-Berechtigung) ändern sich. Mit Lizenzgeber oder Distributor klären, ebenso die Kosten.
6. Pilot mit wenigen Benutzern und echten Arbeitsabläufen, Rückmeldung einholen.
7. Entscheidung dokumentieren, auch Alternativen wie klassischer Remotedesktop-Server oder normale PCs mit VPN.

## Wenn das nicht hilft
- Ticket mit Benutzerzahl, Anwendungsliste, Standorten, Bandbreiten und Anforderungen an lokale Ressourcen.

=== ARTIKEL
titel: Azure-Kosten im Griff behalten – Budgets und Warnungen
bereich: Virtualisierung, Azure & Hybrid
tags: azure, kosten, budget, warnung, cost management, abrechnung, überraschung
zielgruppe: technik
---
**Symptom:** Die Azure-Rechnung fällt höher aus als erwartet, oder niemand weiß, welche Ressourcen die Kosten verursachen.

**Häufige Ursachen:** Vergessene Testsysteme, laufende VMs außerhalb der Arbeitszeit, ungenutzte Datenträger und öffentliche IPs, Datenabfluss, zu große Größen, keine Tags.

## Lösung
1. Im Azure-Portal **Kostenverwaltung** (Cost Management) öffnen und mit der Kostenanalyse nach Ressourcengruppe, Ressourcentyp und Tag gruppieren.
2. Ein **Budget** für das Abonnement oder die Ressourcengruppe anlegen: Monatsbetrag festlegen und Warnschwellen (zum Beispiel bei einem Teil des Betrags und bei Erreichen) mit E-Mail-Empfängern einstellen. Ein Budget meldet nur, es stoppt keine Ressourcen.
3. Mehrere Empfänger eintragen, damit die Warnung nicht bei einer Person verpufft.
4. Kosten zuordnen: Tags wie Kunde, Zweck, Verantwortlicher vergeben.
5. Einsparungen prüfen: Testsysteme automatisch herunterfahren, überdimensionierte VMs verkleinern, nicht angehängte Datenträger und ungenutzte IPs entfernen, Aufbewahrung von Sicherungen prüfen. Die Hinweise des Portals zu Optimierungen (Advisor) heranziehen.
6. **Achtung:** Vor dem Löschen von Ressourcen prüfen, ob sie gebraucht werden, und gegebenenfalls sichern.
7. Monatlich die Kosten kurz durchsehen und mit dem Kunden besprechen.
8. Reservierungen und Preismodelle nur mit Lizenzpartner abklären, keine Preise annehmen.

## Wenn das nicht hilft
- Ticket mit Abonnement, Zeitraum der Auffälligkeit und Auszug aus der Kostenanalyse.

=== ARTIKEL
titel: Standort mit Azure verbinden – VPN-Gateway im Überblick
bereich: Virtualisierung, Azure & Hybrid
tags: azure, vpn gateway, site-to-site, standort verbinden, virtuelles netzwerk, gatewaysubnet, ipsec
zielgruppe: technik
---
**Symptom:** Das Firmennetz soll mit einem virtuellen Netzwerk in Azure verbunden werden, damit Server dort wie im Haus erreichbar sind.

**Häufige Ursachen:** Überlappende IP-Bereiche, Firewall des Standorts unterstützt die nötigen Verfahren nicht, falsche Adressbereiche im lokalen Netzwerkgateway, Gateway-Typ passt nicht zum Gerät.

## Lösung
1. IP-Plan prüfen: Das Azure-Netz darf sich nicht mit dem Bürobereich oder dem Homeoffice-Bereich überschneiden.
2. In Azure ein virtuelles Netzwerk anlegen, darin ein eigenes Subnetz mit dem festen Namen `GatewaySubnet` für das Gateway.
3. Ein **VPN-Gateway** (virtuelles Netzwerkgateway) bereitstellen. Gatewaytyp und Leistungsstufe nach Bedarf wählen. Die Bereitstellung dauert eine Weile.
4. Ein **lokales Netzwerkgateway** erstellen: öffentliche IP-Adresse des Standorts und die lokalen Adressbereiche eintragen.
5. Eine **Verbindung** (Site-to-Site, IPsec) mit gemeinsamem Schlüssel anlegen. Den Schlüssel sicher ablegen.
6. Gleiche Parameter (Verschlüsselung, Lebensdauern) an der Firewall im Büro einstellen. Die Anleitungen und unterstützten Geräte beim Hersteller prüfen.
7. Verbindungsstatus im Portal prüfen und Zugriff mit `ping` und Test der Anwendungen verifizieren. Netzwerksicherheitsgruppen in Azure beachten.
8. Für Einzelplätze (Homeoffice) ist alternativ Punkt-zu-Standort möglich.

## Wenn das nicht hilft
- Ticket mit Firewall-Modell, Azure-Adressbereich, lokalem Bereich, Status der Verbindung und Protokollauszug beider Seiten.

=== ARTIKEL
titel: Domänencontroller in Azure – wann sinnvoll
bereich: Virtualisierung, Azure & Hybrid
tags: domänencontroller, azure, active directory, dc in der cloud, hybrid, anmeldung, replikation
zielgruppe: technik
---
**Symptom:** Server in Azure sollen sich an der Domäne anmelden, oder ein Standort soll ohne Büro-Server weiterarbeiten. Die Frage lautet, ob ein Domänencontroller (DC) in Azure nötig ist.

**Häufige Ursachen:** Annahme, dass Azure und lokales AD automatisch zusammenarbeiten, DNS zeigt nicht auf einen erreichbaren DC, VPN fällt aus und die VMs verlieren die Domäne.

## Lösung
1. Bedarf prüfen: Nur wenige VMs in Azure, die selten Domänenanmeldung brauchen? Dann reicht oft der DC im Büro über ein stabiles VPN. Viele VMs, Anwendungen mit häufiger Authentifizierung oder Ausfallschutz sprechen für einen DC in Azure.
2. Alternativen kennen: Microsoft Entra Domain Services oder reine Cloud-Verwaltung. Die Eignung hängt von den Anwendungen ab, etwa wenn Gruppenrichtlinien oder klassische Anmeldeverfahren nötig sind.
3. Wenn ein DC in Azure laufen soll: eigenes Subnetz in Azure und eigener Standort im AD (Active Directory Standorte und Dienste), Subnetz zuordnen.
4. VM mit fester privater IP, Daten der AD-Datenbank auf einem eigenen Datenträger ohne Schreib-Cache, wie vom Hersteller für DCs empfohlen.
5. **Achtung:** Beim Heraufstufen und bei Änderungen an DNS im virtuellen Netzwerk auf Reihenfolge und Erreichbarkeit achten. Sicherung des AD vorher prüfen.
6. DNS-Server im virtuellen Netzwerk auf die DCs setzen, dann die VMs neu starten.
7. Die VM in die Sicherung und Überwachung einbinden. Dem DC keine öffentliche IP geben.

## Wenn das nicht hilft
- Ticket mit Anzahl der VMs in Azure, VPN-Art, vorhandenen DCs und Ausgabe von `dcdiag`.

=== ARTIKEL
titel: DNS in hybriden Umgebungen – lokales Netz, Azure und Microsoft 365
bereich: Virtualisierung, Azure & Hybrid
tags: dns, hybrid, azure, namensauflösung, weiterleitung, split-dns, öffentliche domäne
zielgruppe: technik
---
**Symptom:** Namen werden zwischen Büro und Azure nicht aufgelöst, oder eine Domäne liefert intern andere Ergebnisse als von außen.

**Häufige Ursachen:** Virtuelles Netzwerk nutzt Azure-Standard-DNS statt der AD-DNS-Server, fehlende Weiterleitungen, Split-DNS ohne Pflege, Einträge für Microsoft 365 nur im öffentlichen DNS.

## Lösung
1. Zonen auflisten: interne AD-Zone, öffentliche Domäne beim Anbieter, eventuell private Zonen in Azure.
2. Für Azure-VMs, die Domänennamen brauchen, die DNS-Server des virtuellen Netzwerks auf die DCs oder DNS-Server im Büro oder in Azure setzen. Bereits laufende VMs danach neu starten oder die Netzwerkkonfiguration erneuern.
3. Namen aus Azure im Büro auflösen: bedingte Weiterleitung auf dem lokalen DNS-Server auf den DNS-Dienst in Azure oder auf einen Resolver dort.
4. Split-DNS bewusst nutzen: Gleiche Domäne innen und außen heißt, dass wichtige öffentliche Einträge (zum Beispiel Webseite, Autodiscover) auch in der internen Zone vorhanden sein müssen.
5. Einträge für Microsoft 365 (MX, Autodiscover, weitere) bleiben im öffentlichen DNS. Änderungen mit Bedacht, da E-Mail betroffen ist.
6. **Achtung:** DNS-Änderungen können Anmeldung und Mail stören. Vorher Einträge exportieren oder notieren.
7. Prüfen mit `nslookup name server` und `Resolve-DnsName`, danach den Client-Cache leeren (`ipconfig /flushdns`).

## Wenn das nicht hilft
- Ticket mit Zonenliste, DNS-Servern im Netz und in Azure, betroffenem Namen und Ausgabe von `nslookup`.

=== ARTIKEL
titel: Remotedesktop-Gateway statt offenem Port 3389
bereich: Virtualisierung, Azure & Hybrid
tags: remotedesktop-gateway, rd gateway, port 3389, rdp, zugriff von außen, sicherheit, https
zielgruppe: technik
---
**Symptom:** Von außen wird per Portweiterleitung auf Port 3389 zugegriffen. Das ist ein bekanntes Risiko. Ein sicherer Weg wird gesucht.

**Häufige Ursachen:** Schneller Zugang wurde nie ersetzt, kein Mehrfaktor, Zertifikate fehlen, Richtlinien am Gateway zu offen oder zu streng.

## Lösung
1. Prüfen, ob der direkte Zugriff überhaupt nötig ist. Oft ist ein VPN der bessere Weg.
2. Für gezielten Zugriff den **Remotedesktop-Gateway** einsetzen. Er kapselt RDP in HTTPS, sodass nur Port 443 nach außen offen ist. Er läuft idealerweise nicht auf dem Domänencontroller.
3. Rolle **Remotedesktop-Gateway** auf einem Server installieren und im Gateway-Manager ein gültiges Zertifikat zuweisen, dessen Name zum öffentlichen Namen passt.
4. Zwei Richtlinien erstellen: Verbindungsautorisierung (**RD CAP**: wer darf sich verbinden) und Ressourcenautorisierung (**RD RAP**: auf welche Computer). Nur nötige Gruppen und Ziele eintragen.
5. Auf der Firewall nur 443 zum Gateway weiterleiten, den alten 3389-Eintrag entfernen. **Achtung:** Erst testen, dann den alten Zugang schließen, sonst sperren sich Anwender aus.
6. Am Client in den RDP-Einstellungen unter **Erweitert** den Gateway-Server eintragen.
7. Mehrfaktor-Authentifizierung ergänzen, wo möglich, und Anmeldeversuche protokollieren und überwachen.
8. Server fest aktualisieren, Zugriff wenn möglich auf bekannte Adressen beschränken.

## Wenn das nicht hilft
- Ticket mit Gateway-Version, Zertifikatsname, Richtliniennamen und Fehlermeldung am Client.

=== ARTIKEL
titel: Server 2012 R2 oder 2016 ablösen – Migration planen
bereich: Virtualisierung, Azure & Hybrid
tags: server 2012, server 2016, ablösen, migration, support-ende, neuer server, upgrade
zielgruppe: technik
---
**Symptom:** Ein Kunde betreibt noch Windows Server 2012 R2 oder 2016. Es wird gefragt, wie die Ablösung angegangen wird und wie dringend sie ist.

**Häufige Ursachen:** Alte Branchensoftware, Angst vor Ausfall, Domänenfunktionsebene, Zeitdruck, fehlende Dokumentation, Verwechslung von Upgrade und Neuaufbau.

## Lösung
1. Supportstatus prüfen: Den aktuellen Stand der Herstellerunterstützung für die eingesetzte Version in den Lebenszyklusseiten des Herstellers nachsehen und den Kunden entsprechend beraten. Verlängerte Sicherheitsupdates, falls angeboten, sind kostenpflichtig und nur eine Übergangslösung.
2. Bestandsaufnahme: Rollen (AD, DNS, DHCP, Datei, Druck), Anwendungen, Zertifikate, Freigaben, geplante Aufgaben, Sicherung, Abhängigkeiten.
3. Zielbild wählen: neuer Server mit aktueller Version (physisch oder als VM), Auslagerung von Diensten (Dateien in die Cloud) oder Neustruktur.
4. Herstellerfreigaben der Anwendungen für das neue Betriebssystem einholen.
5. Strategie: In der Regel **Neuaufbau und Umzug der Rollen** statt Direkt-Upgrade. Für Domänencontroller: neuen DC aufnehmen, FSMO-Rollen übertragen, alten DC herabstufen. Domänen- und Gesamtstrukturfunktionsebene danach anheben.
6. **Achtung:** Vor jeder Umstellung vollständige Sicherung mit geprüfter Wiederherstellung. Alten Server nach dem Umzug einige Wochen heruntergefahren aufbewahren.
7. Zeitplan mit Wartungsfenstern, Test mit Pilotbenutzern, Lizenzfragen mit dem Lizenzgeber klären.

## Wenn das nicht hilft
- Ticket mit Betriebssystemversion, Rollen, Anwendungen, Hardwarealter und gewünschtem Termin.

=== ARTIKEL
titel: Lokaler Server ja oder nein – Entscheidungshilfe für Kleinbetriebe
bereich: Virtualisierung, Azure & Hybrid
tags: server, cloud, entscheidung, kleinbetrieb, lokaler server, nas, microsoft 365, beratung
zielgruppe: technik
---
**Symptom:** Der Server eines Kleinbetriebs ist alt. Die Frage lautet, ob wieder ein lokaler Server angeschafft oder auf Cloud-Dienste umgestellt werden soll.

**Häufige Ursachen:** Entscheidung allein nach Kosten, Branchensoftware mit Serverbedarf unbeachtet, Internetleitung zu schwach, Annahme, dass Cloud keinerlei Pflege braucht.

## Lösung
1. Aufgaben des Servers auflisten: Dateien, Drucken, Anmeldung (AD), Branchensoftware und Datenbank, Telefonie, Scanner, Sicherung, Zugriff von außen.
2. Je Aufgabe Ersatz prüfen: Dateien nach SharePoint/OneDrive, Anmeldung über Entra ID und Geräteverwaltung, Drucken über Netzwerkdrucker oder Cloud-Druck. Branchensoftware: Hersteller fragen, ob eine Cloud- oder Browserversion existiert.
3. Voraussetzungen prüfen: stabile und ausreichend schnelle Internetleitung, Ausweichverbindung, Geräteverwaltung, Sicherung der Cloud-Daten.
4. Gründe für lokalen Server: Spezialsoftware, große Datenmengen mit schnellem Zugriff, Maschinen- oder Messgeräteanbindung, schwache Internetanbindung, Wunsch nach Datenhaltung im Haus.
5. Zwischenlösungen: kleiner Server nur für Software, restliche Dienste in der Cloud. Oder Hybrid mit Synchronisierung.
6. Vergleichsrechnung über mehrere Jahre mit allen Posten (Hardware, Lizenzen, Wartung, Strom, Betreuung, Abos). Preise liefert der Lizenzpartner.
7. Datenschutz und Branchenvorgaben mit Datenschutzbeauftragten und Steuerberatung abstimmen. Entscheidung schriftlich festhalten.

## Wenn das nicht hilft
- Ticket mit Aufgabenliste des Servers, Anzahl Arbeitsplätze, Leitungsgeschwindigkeit und eingesetzter Spezialsoftware.

=== ARTIKEL
titel: Ressourcen in Azure ordnen – Abonnement, Ressourcengruppen, Namen, Zugriffsrechte
bereich: Virtualisierung, Azure & Hybrid
tags: azure, abonnement, ressourcengruppe, namenskonvention, tags, rollen, rbac, ordnung
zielgruppe: technik
---
**Symptom:** In Azure sammeln sich Ressourcen ohne erkennbare Ordnung an. Niemand weiß, was wozu gehört oder wer was ändern darf.

**Häufige Ursachen:** Alles in einer Ressourcengruppe, kryptische Standardnamen, Besitzerrechte für alle, keine Tags, Gastzugänge ohne Prüfung.

## Lösung
1. Die Hierarchie verstehen: Mandant, darunter Abonnement, darin Ressourcengruppen, darin die einzelnen Ressourcen. Kosten und Rechte lassen sich auf jeder Ebene zuordnen.
2. Abonnements bewusst trennen, zum Beispiel Test und Produktion, oder je Kunde, wenn abgerechnet wird.
3. Ressourcengruppen nach Lebenszyklus und Zweck bilden, etwa Netzwerk, Server, Sicherung. Was gemeinsam gelöscht werden darf, gehört zusammen.
4. Namensschema festlegen und schriftlich halten, zum Beispiel Typkürzel, Zweck, Umgebung, Region. Beachten, dass manche Namen weltweit eindeutig sein müssen und Zeichenregeln gelten.
5. Tags vergeben (Kunde, Verantwortlicher, Umgebung, Kostenstelle), möglichst über Richtlinien erzwingen.
6. Zugriff über **Zugriffssteuerung (IAM)** mit rollenbasierten Rechten: Gruppen statt Einzelpersonen, kleinste nötige Rolle. Besitzerrolle nur sparsam vergeben, Administratorkonten mit Mehrfaktor schützen.
7. **Ressourcensperren** gegen versehentliches Löschen bei kritischen Gruppen setzen.
8. Zugriffe und Gäste regelmäßig überprüfen und die Struktur dokumentieren.

## Wenn das nicht hilft
- Ticket mit Abonnementübersicht, Liste der Ressourcengruppen und den derzeit vergebenen Rollen.

