=== ARTIKEL
titel: Benutzer in Active Directory anlegen, kopieren und sperren
bereich: Server & Active Directory
tags: benutzer anlegen, neuer mitarbeiter, active directory, konto kopieren, deaktivieren, austritt
zielgruppe: technik
---
**Symptom:** Ein neuer Mitarbeiter braucht ein Domänenkonto, oder das Konto eines ausgeschiedenen Mitarbeiters muss gesperrt werden.

**Häufige Ursachen:** Konten werden uneinheitlich angelegt, Gruppenmitgliedschaften fehlen, alte Konten bleiben aktiv.

## Lösung
1. **Server-Manager → Tools → Active Directory-Benutzer und -Computer** öffnen und die richtige Organisationseinheit (OU) wählen.
2. Neuen Benutzer anlegen: Rechtsklick auf die OU → **Neu → Benutzer**. Anmeldenamen nach dem Namensschema des Kunden vergeben, Startkennwort setzen und **Benutzer muss Kennwort bei der nächsten Anmeldung ändern** aktiviert lassen.
3. Zum Kopieren einen ähnlichen Benutzer markieren und **Kopieren** wählen. Gruppenmitgliedschaften werden dabei übernommen, Heimatordner und Profilpfad müssen angepasst werden.
4. Mitgliedschaften unter **Eigenschaften → Mitglied von** prüfen.
5. Zum Sperren das Konto per Rechtsklick **Konto deaktivieren**. Das Konto bleibt erhalten, Postfach und Dateien gehen nicht verloren.
6. Per PowerShell: `Disable-ADAccount -Identity max.muster` und `Enable-ADAccount -Identity max.muster`.
7. Deaktivierte Konten in eine eigene OU verschieben und Datum notieren.

**Achtung:** Konto nicht sofort löschen. Gelöschte Konten erhalten eine neue SID, Berechtigungen und Profil sind danach nicht ohne Weiteres wiederherzustellen.

## Wenn das nicht hilft
- Meldet sich der Benutzer nicht an, Replikation zwischen den Domänencontrollern prüfen und Kontoeigenschaften auf Anmeldezeiten und abgelaufenes Konto kontrollieren.

=== ARTIKEL
titel: Konto ständig gesperrt – Quelle der falschen Anmeldungen finden
bereich: Server & Active Directory
tags: konto gesperrt, lockout, 4740, kennwort falsch, gesperrt immer wieder, sperrung
zielgruppe: technik
---
**Symptom:** Ein Domänenkonto wird mehrmals täglich gesperrt, obwohl der Benutzer das Kennwort richtig eingibt.

**Häufige Ursachen:** Ein Gerät oder Dienst verwendet das alte Kennwort, etwa Smartphone, gespeicherte Netzlaufwerke, geplante Aufgaben, Dienste oder getrennte Remotesitzungen.

## Lösung
1. Sperrstatus prüfen: `Get-ADUser -Identity max.muster -Properties LockedOut | Select Name,LockedOut`.
2. Entsperren: `Unlock-ADAccount -Identity max.muster`. Alle gesperrten Konten: `Search-ADAccount -LockedOut`.
3. Den PDC-Emulator ermitteln: `(Get-ADDomain).PDCEmulator`. Dort laufen Sperrungen zusammen.
4. Auf dem PDC-Emulator im Sicherheitsprotokoll nach Ereignis-ID **4740** (Benutzerkonto wurde gesperrt) suchen:
```
Get-WinEvent -FilterHashtable @{LogName='Security';Id=4740} -MaxEvents 20 | Format-List TimeCreated,Message
```
5. Im Text steht der **Aufrufercomputername**. Das ist die Quelle der Fehlanmeldungen.
6. Auf diesem Rechner Ereignis-ID **4625** (Anmeldung fehlgeschlagen) im Sicherheitsprotokoll suchen. Der Prozessname zeigt oft den Verursacher.
7. Dort alte Kennwörter beseitigen: Windows-Anmeldeinformationen, Dienste mit Anmeldekonto, geplante Aufgaben, getrennte RDP-Sitzungen.

## Wenn das nicht hilft
- Steht kein Rechner im Ereignis, kann die Quelle ein Gerät außerhalb der Domäne sein (WLAN, Handy, Drucker mit Scan-Konto). Kennwort dort aktualisieren oder Gerät trennen.
- Kontosperrungsrichtlinie prüfen (eigener Artikel).

=== ARTIKEL
titel: Kennwortrichtlinie und Kontosperrung in der Domäne prüfen
bereich: Server & Active Directory
tags: kennwortrichtlinie, kontosperrung, passwort ablauf, komplexität, fine grained, domänenrichtlinie
zielgruppe: technik
---
**Symptom:** Kennwörter werden abgelehnt, laufen unerwartet ab, oder Konten werden nach wenigen Fehlversuchen gesperrt.

**Häufige Ursachen:** Strenge Vorgaben in der Default Domain Policy, eine abweichende Richtlinie für bestimmte Gruppen oder lokale Richtlinien auf Einzelrechnern.

## Lösung
1. Domänenweite Vorgaben anzeigen: `Get-ADDefaultDomainPasswordPolicy`. Relevant sind `MinPasswordLength`, `MaxPasswordAge`, `ComplexityEnabled`, `LockoutThreshold`, `LockoutDuration` und `LockoutObservationWindow`.
2. Alternativ auf einem Domänenmitglied: `net accounts /domain`.
3. Abweichende Richtlinien (Fine-Grained) auflisten: `Get-ADFineGrainedPasswordPolicy -Filter *`.
4. Für einen bestimmten Benutzer die tatsächlich geltende Richtlinie anzeigen: `Get-ADUserResultantPasswordPolicy -Identity max.muster`. Bleibt die Ausgabe leer, gilt die Domänenrichtlinie.
5. Bearbeiten in der **Gruppenrichtlinienverwaltung**: Default Domain Policy → **Computerkonfiguration → Richtlinien → Windows-Einstellungen → Sicherheitseinstellungen → Kontorichtlinien**.
6. Kontoeigenschaften prüfen: Option **Kennwort läuft nie ab** und **Konto ist gesperrt**.

**Achtung:** Änderungen an der Domänenrichtlinie betreffen alle Konten, auch Dienstkonten. Vorgaben vorher mit dem Kunden abstimmen und Auswirkungen auf Dienste bedenken.

## Wenn das nicht hilft
- Wirkt die Einstellung nicht, `gpresult` am Domänencontroller prüfen und den Artikel zu Gruppenrichtlinien beachten.

=== ARTIKEL
titel: Berechtigungen richtig aufbauen: Benutzer in Gruppe, Gruppe auf Ordner
bereich: Server & Active Directory
tags: gruppen, berechtigungen, ordner, agdlp, sicherheitsgruppe, dateiserver, rechte
zielgruppe: technik
---
**Symptom:** Berechtigungen auf dem Dateiserver sind unübersichtlich, einzelne Benutzer stehen direkt auf Ordnern, Änderungen dauern lange.

**Häufige Ursachen:** Rechte wurden von Fall zu Fall an Personen vergeben statt an Gruppen.

## Hintergrund
Grundprinzip: **Benutzer → Gruppe → Ordner**. Berechtigungen werden nur an Gruppen vergeben, Personen werden nur Mitglied. Bei einer Domäne genügt für kleine Betriebe meist eine Gruppe je Ordner und Zugriffsart, etwa `FS_Buchhaltung_Lesen` und `FS_Buchhaltung_Ändern`.

## Lösung
1. In **Active Directory-Benutzer und -Computer** eine OU „Gruppen“ anlegen.
2. Sicherheitsgruppen (Typ **Sicherheit**) mit sprechenden Namen erstellen.
3. Benutzer unter **Mitglied von** oder in den Gruppeneigenschaften aufnehmen.
4. Am Ordner: **Eigenschaften → Sicherheit → Bearbeiten → Hinzufügen** und die Gruppe eintragen, danach **Ändern** oder **Lesen, Ausführen** setzen.
5. Direkte Einträge einzelner Benutzer entfernen.
6. Vererbung nur bewusst unterbrechen und dokumentieren.
7. Nach einer Gruppenänderung muss sich der Benutzer ab- und wieder anmelden, weil das Zugriffstoken erst bei der Anmeldung neu erstellt wird.

**Achtung:** Die Gruppe **Jeder** oder **Domänen-Benutzer** nicht vorschnell entfernen, bevor die neuen Gruppen greifen. Sonst verlieren alle den Zugriff.

## Wenn das nicht hilft
- Eingrenzung über effektive Berechtigungen (eigener Artikel).

=== ARTIKEL
titel: NTFS- und Freigabeberechtigungen zusammen verstehen
bereich: Server & Active Directory
tags: ntfs, freigabe, berechtigung, share, zugriff, dateiserver, strengste
zielgruppe: technik
---
**Symptom:** Ein Benutzer hat am Ordner Schreibrechte, kann über das Netzwerk aber nur lesen, oder umgekehrt.

**Häufige Ursachen:** Zwei getrennte Berechtigungsebenen wirken gleichzeitig, und die jeweils strengere gewinnt.

## Hintergrund
Beim Zugriff über das Netzwerk gelten **Freigabeberechtigungen** und **NTFS-Berechtigungen** zusammen. Ergebnis ist die Schnittmenge, also das, was beide erlauben. Ein ausdrückliches **Verweigern** schlägt jedes Zulassen. Lokal oder per Remotedesktop am Server zählt nur NTFS.

Bewährte Praxis in kleinen Umgebungen: Freigabe großzügig (Gruppe **Authentifizierte Benutzer** oder Domänenbenutzer mit **Ändern**), die eigentliche Steuerung nur über NTFS-Gruppen.

## Lösung
1. Freigabe prüfen: Ordner → **Eigenschaften → Freigabe → Erweiterte Freigabe → Berechtigungen**.
2. NTFS prüfen: **Eigenschaften → Sicherheit → Erweitert**.
3. Alle Freigaben des Servers anzeigen: `Get-SmbShare`, Rechte je Freigabe: `Get-SmbShareAccess -Name Daten`.
4. Die Gruppen aus beiden Listen mit den Gruppen des Benutzers vergleichen (`whoami /groups` in dessen Sitzung).
5. Fehlt ein Recht, an der strengeren Stelle ergänzen, aber nur an Gruppen.

**Achtung:** Freigabe nicht auf **Jeder → Vollzugriff** mit offenem NTFS kombinieren, ohne den Kunden zu fragen. Dann darf jeder alles.

## Wenn das nicht hilft
- Effektive Berechtigungen prüfen (eigener Artikel).

=== ARTIKEL
titel: „Zugriff verweigert“ auf einem Ordner eingrenzen – effektive Berechtigungen
bereich: Server & Active Directory
tags: zugriff verweigert, effektive berechtigungen, ordner, kein zugriff, ntfs, sperre
zielgruppe: technik
---
**Symptom:** Ein Benutzer erhält „Zugriff verweigert“ auf einen Ordner oder eine Datei, ein Kollege nicht.

**Häufige Ursachen:** Fehlende Gruppenmitgliedschaft, noch nicht neu angemeldet, Verweigern-Eintrag, unterbrochene Vererbung, abweichende Freigabeberechtigung oder Datei in Benutzung durch einen anderen.

## Lösung
1. Zuerst klären: Fehler beim Öffnen, Ändern oder Speichern? Welcher genaue Pfad (UNC-Pfad oder Laufwerk)?
2. Auf dem Server am Ordner: **Eigenschaften → Sicherheit → Erweitert → Effektiver Zugriff** (je nach Version Reiter **Effektiver Zugriff**).
3. **Benutzer auswählen**, Konto eintragen, **Effektiven Zugriff anzeigen**. Nicht erteilte Rechte sind markiert, die Ansicht nennt die Ursache.
4. Mitgliedschaften des Benutzers prüfen: `Get-ADPrincipalGroupMembership max.muster | Select Name`.
5. Auf Verweigern-Einträge achten, auch im übergeordneten Ordner.
6. Freigabeberechtigungen prüfen (`Get-SmbShareAccess -Name Daten`).
7. Eigentümer des Objekts unter **Erweitert** ansehen.
8. Nach Gruppenänderungen Benutzer ab- und anmelden lassen.
9. Bei einer Sperre durch Prozesse: `Get-SmbOpenFile` zeigt offene Dateien.

**Achtung:** Eigentümerrechte nur nach Rücksprache übernehmen und Berechtigungen nicht rekursiv ersetzen, ohne vorher die ACL zu sichern, etwa mit `icacls Pfad /save acl.txt /t`.

## Wenn das nicht hilft
- Ereignisanzeige und Überwachungsprotokolle prüfen, sofern Überwachung aktiv ist.

=== ARTIKEL
titel: Schattenkopien und Vorgängerversionen einrichten und nutzen
bereich: Server & Active Directory
tags: schattenkopien, vorgängerversionen, datei gelöscht, wiederherstellen, vss, versehentlich überschrieben
zielgruppe: technik
---
**Symptom:** Eine Datei wurde versehentlich gelöscht oder überschrieben und soll ohne Datensicherung zurückgeholt werden.

**Häufige Ursachen:** Schattenkopien sind auf dem Datenlaufwerk nicht aktiviert, der Speicherplatz dafür ist zu klein oder der Zeitplan fehlt.

## Lösung
Einrichten:
1. Im Explorer **Dieser PC**, Rechtsklick auf das Datenlaufwerk → **Konfigurieren von Schattenkopien** (je nach Version über **Eigenschaften → Schattenkopien**).
2. Laufwerk wählen, **Einstellungen** öffnen und ein Maximum festlegen, damit die Kopien den Datenträger nicht füllen.
3. Zeitplan prüfen und **Aktivieren** wählen. Standardmäßig werden zwei Zeitpunkte am Tag angelegt.

Nutzen:
1. Am Netzlaufwerk den Ordner mit Rechtsklick → **Eigenschaften → Vorgängerversionen**.
2. Gewünschten Zeitpunkt wählen. **Öffnen** zeigt den Stand, **Kopieren** legt ihn an anderer Stelle ab.
3. Gelöschte Dateien: Den übergeordneten Ordner öffnen und dessen Vorgängerversion anzeigen.

Befehle: `vssadmin list shadows`, `vssadmin list shadowstorage`.

**Achtung:** **Wiederherstellen** überschreibt den aktuellen Ordnerinhalt. Lieber **Kopieren** verwenden. Schattenkopien ersetzen keine Datensicherung, sie liegen auf demselben Datenträger.

## Wenn das nicht hilft
- Ist der Speicherplatz für Schattenkopien voll, werden älteste Stände gelöscht. Maximum erhöhen und Datenträgerplatz prüfen.

=== ARTIKEL
titel: Gruppenrichtlinie wirkt nicht – Prüfung mit gpresult und gpupdate
bereich: Server & Active Directory
tags: gruppenrichtlinie, gpo, gpresult, gpupdate, richtlinie greift nicht, ou
zielgruppe: technik
---
**Symptom:** Eine Gruppenrichtlinie (Laufwerk, Einstellung, Skript) kommt auf einem PC oder bei einem Benutzer nicht an.

**Häufige Ursachen:** Richtlinie an falscher OU verknüpft, Benutzer- und Computerkonfiguration verwechselt, Sicherheitsfilterung oder Delegation falsch, DNS-Probleme, Richtlinie deaktiviert, noch nicht repliziert.

## Lösung
1. Am betroffenen PC Richtlinien neu laden: `gpupdate /force`. Manche Einstellungen verlangen Abmeldung oder Neustart.
2. Ergebnis anzeigen: `gpresult /r`. Für die Computerseite in einer Eingabeaufforderung als Administrator: `gpresult /scope computer /r`.
3. Unter **Angewendete Gruppenrichtlinienobjekte** und **Die folgenden GPOs wurden nicht angewendet** nachsehen, mit Begründung.
4. Ausführlicher Bericht: `gpresult /h C:\Temp\gpo.html`.
5. In der **Gruppenrichtlinienverwaltung** prüfen: Verknüpfung an der OU, in der das **Benutzer- oder Computerobjekt** liegt, Verknüpfung aktiviert, Reiter **Delegierung** (Lesen für **Authentifizierte Benutzer** oder den betroffenen Computer), Sicherheitsfilterung, WMI-Filter.
6. Prüfen, ob der PC den Domänencontroller per DNS findet (`nslookup domäne.local`, `nltest /dsgetdc:domäne.local`).
7. Ereignisanzeige: **Anwendungs- und Dienstprotokolle → Microsoft → Windows → GroupPolicy → Betriebsbereit**.

## Wenn das nicht hilft
- Replikation von SYSVOL und Active Directory mit `repadmin /replsummary` prüfen.
- Computerkonto in der richtigen OU? Dienste und Zeit der Domäne kontrollieren.

=== ARTIKEL
titel: Laufwerkszuordnung per Gruppenrichtlinie einrichten
bereich: Server & Active Directory
tags: laufwerk zuordnen, netzlaufwerk, gruppenrichtlinie, gpo, laufwerksbuchstabe, fehlt
zielgruppe: technik
---
**Symptom:** Netzlaufwerke fehlen nach der Anmeldung oder sollen für alle Mitarbeiter einer Abteilung zentral verteilt werden.

**Häufige Ursachen:** Zuordnung per Hand statt zentral, Richtlinie an der falschen OU, Zielgruppe nicht passend, Freigabe nicht erreichbar.

## Lösung
1. **Gruppenrichtlinienverwaltung** öffnen, an der OU der Benutzer eine neue Richtlinie erstellen und verknüpfen, Rechtsklick **Bearbeiten**.
2. **Benutzerkonfiguration → Einstellungen → Windows-Einstellungen → Laufwerkszuordnungen**.
3. Rechtsklick → **Neu → Zugeordnetes Laufwerk**.
4. Aktion **Aktualisieren** (oder **Erstellen**) wählen, Pfad im Format `\\server\freigabe` eintragen, Buchstaben festlegen und **Erneut verbinden** aktivieren.
5. Für gruppenabhängige Laufwerke Reiter **Gemeinsame Optionen → Zielgruppenadressierung** nutzen und die Sicherheitsgruppe angeben.
6. Am Client `gpupdate /force`, danach Ab- und Anmeldung.
7. Kontrolle mit `gpresult /r` und `net use`.

Hinweise: Pfade mit `%username%` funktionieren nur, wenn die Ordner existieren. Die Ordnerberechtigungen bleiben Sache der Gruppen am Server, die Richtlinie verbindet nur das Laufwerk.

## Wenn das nicht hilft
- Ist das Laufwerk nach Anmeldung trotzdem rot oder fehlt, Netzwerkstandort, DNS-Namensauflösung und Freigabe-Zugriff getrennt prüfen.
- Alte Anmeldeskripte, die dieselben Buchstaben belegen, entfernen.

=== ARTIKEL
titel: Anmeldung am PC dauert sehr lange – typische Ursachen am Server
bereich: Server & Active Directory
tags: anmeldung langsam, anmeldung dauert, profil, anmeldeskript, dns, bitte warten
zielgruppe: technik
---
**Symptom:** Nach der Anmeldung bleibt der Bildschirm minutenlang bei „Willkommen“ oder „Bitte warten“.

**Häufige Ursachen:** Falsche DNS-Server am Client, großes Roaming-Profil oder umgeleitete Ordner, langsame Anmeldeskripte, nicht erreichbare Laufwerkszuordnungen, überlastete oder defekte Domänencontroller.

## Lösung
1. Am PC prüfen, ob als DNS nur der Domänencontroller eingetragen ist: `ipconfig /all`. Externe DNS-Server gehören dort nicht hin.
2. Domänencontroller-Erreichbarkeit: `nltest /dsgetdc:domäne.local`.
3. Dauer der Richtlinienverarbeitung in der Ereignisanzeige unter **Microsoft → Windows → GroupPolicy → Betriebsbereit** an den Zeitstempeln ablesen.
4. Anmeldeskripte und Laufwerkszuordnungen prüfen: zeigt ein Eintrag auf einen abgeschalteten Server, wartet die Anmeldung auf den Zeitablauf.
5. Profilgröße kontrollieren (`C:\Users\Name`) und umgeleitete Ordner (Desktop, Dokumente) auf großen Inhalt prüfen.
6. Test mit einem neuen Testbenutzer: Ist dieser schnell, liegt es am Profil des Benutzers.
7. Zustand der Domänencontroller prüfen (`dcdiag`, `repadmin /replsummary`).

**Achtung:** Profile nur umbenennen oder löschen, wenn Daten gesichert sind.

## Wenn das nicht hilft
- Ereignisse und Dauer notieren: Uhrzeit, Benutzer, PC-Name, Ergebnis des Testbenutzers, `gpresult`-Bericht.

=== ARTIKEL
titel: DNS auf dem Domänencontroller – Weiterleitungen und häufige Fehler
bereich: Server & Active Directory
tags: dns, weiterleitung, domänencontroller, namensauflösung, forwarder, _msdcs
zielgruppe: technik
---
**Symptom:** Interne Namen werden nicht aufgelöst, Internetnamen funktionieren nicht, oder Domänenfunktionen melden DNS-Fehler.

**Häufige Ursachen:** Der Domänencontroller zeigt auf einen externen DNS-Server, Weiterleitungen fehlen oder sind falsch, Clients nutzen den Router als DNS, die Zone ist veraltet.

## Lösung
1. Am Domänencontroller im Netzwerkadapter als bevorzugten DNS-Server die eigene Adresse oder einen anderen Domänencontroller eintragen, keine externen Adressen.
2. **DNS-Manager** öffnen → Rechtsklick auf den Server → **Eigenschaften → Weiterleitungen**. Dort die Adresse des Routers oder des Providers-DNS eintragen.
3. Per PowerShell: `Get-DnsServerForwarder`, `Set-DnsServerForwarder -IPAddress 192.0.2.1`.
4. Clients bekommen als DNS ausschließlich Domänencontroller, auch per DHCP-Option.
5. Zone prüfen: `Get-DnsServerZone`. Die Zone `_msdcs` muss vorhanden sein, die Zonen sollten Active Directory-integriert sein.
6. Test: `nslookup server.domäne.local` und `nslookup www.beispiel.at`.
7. Diagnose: `dcdiag /test:dns`.
8. Fehlende Einträge: auf dem betroffenen Gerät `ipconfig /registerdns`.

**Achtung:** Zonen oder `_msdcs` nicht löschen, ohne die Folgen zu kennen. Anmeldungen und Replikation hängen davon ab.

## Wenn das nicht hilft
- Dienst **DNS-Server** und Netlogon neu starten (Ausfallzeit bedenken) und die Ereignisanzeige unter **DNS-Server** prüfen.

=== ARTIKEL
titel: DHCP-Serverrolle einrichten – Bereich, Reservierungen, Autorisierung
bereich: Server & Active Directory
tags: dhcp, bereich, reservierung, autorisieren, ip-adresse, scope, router
zielgruppe: technik
---
**Symptom:** Clients bekommen keine Adresse oder eine Adresse aus dem falschen Bereich; ein DHCP-Server soll neu eingerichtet werden.

**Häufige Ursachen:** Der DHCP-Server ist in Active Directory nicht autorisiert, der Bereich ist nicht aktiviert, ein zweiter DHCP-Server (oft der Router) läuft parallel.

## Lösung
1. Rolle **DHCP-Server** über **Server-Manager → Verwalten → Rollen und Features hinzufügen** installieren. Danach im Server-Manager die Meldung zur Fertigstellung der DHCP-Konfiguration abschließen.
2. Autorisieren: **DHCP-Manager**, Rechtsklick auf den Server → **Autorisieren**. Per PowerShell: `Add-DhcpServerInDC` und Kontrolle mit `Get-DhcpServerInDC`.
3. Bereich anlegen: Rechtsklick auf **IPv4 → Neuer Bereich**. Adressbereich, Ausschlüsse für Server und Drucker, Lease-Dauer festlegen.
4. Bereichsoptionen setzen: **003 Router**, **006 DNS-Server** (Domänencontroller), **015 DNS-Domänenname**.
5. Reservierungen: **Bereich → Reservierungen → Neue Reservierung**, MAC-Adresse eintragen. Per PowerShell `Add-DhcpServerv4Reservation`.
6. Bereich **Aktivieren**.
7. Am Router den DHCP-Dienst abschalten.
8. Test am Client mit `ipconfig /renew`.

**Achtung:** Zwei aktive DHCP-Server im selben Netz verteilen widersprüchliche Adressen. Vor dem Abschalten des Routers-DHCP Wartungsfenster wählen.

## Wenn das nicht hilft
- Ereignisanzeige des DHCP-Servers prüfen und ob der Bereich Adressen frei hat (Statistik im DHCP-Manager).

=== ARTIKEL
titel: Zeitabweichung in der Domäne prüfen und korrigieren (w32tm)
bereich: Server & Active Directory
tags: zeit, zeitabweichung, w32tm, kerberos, uhrzeit falsch, ntp
zielgruppe: technik
---
**Symptom:** Anmeldungen schlagen fehl, Domänenbeitritt oder Freigabezugriff meldet Fehler, die Uhrzeit auf PCs weicht ab.

**Häufige Ursachen:** Kerberos verträgt nur geringe Zeitunterschiede (standardmäßig fünf Minuten). Der PDC-Emulator hat keine externe Zeitquelle, eine VM synchronisiert mit dem Host, die Systemzeit nach Stromausfall ist falsch.

## Hintergrund
In einer Domäne holen sich Clients die Zeit vom Domänencontroller, die Domänencontroller vom PDC-Emulator. Nur dieser sollte eine externe Quelle verwenden.

## Lösung
1. Zeitstatus: `w32tm /query /status`, Quelle: `w32tm /query /source`.
2. Abweichung zu einem Domänencontroller: `w32tm /monitor`.
3. Den PDC-Emulator ermitteln (`netdom query fsmo`) und dort die externe Quelle setzen:
```
w32tm /config /manualpeerlist:"pool.ntp.org" /syncfromflags:manual /reliable:yes /update
net stop w32time && net start w32time
w32tm /resync
```
4. Auf anderen Domänencontrollern und Mitgliedern: `w32tm /config /syncfromflags:domhier /update` und `w32tm /resync`.
5. Bei virtuellen Domänencontrollern die Zeitsynchronisierung in den Integrationsdiensten prüfen, damit nicht zwei Quellen streiten.
6. Zeitzone und Datum kontrollieren.

**Achtung:** Zeit nicht manuell stark verstellen, solange Dienste laufen. Dienstneustart nur außerhalb der Hauptzeiten.

## Wenn das nicht hilft
- Firewall nach außen für UDP 123 prüfen und Alternativ-Zeitserver wählen.

=== ARTIKEL
titel: Zustand des Domänencontrollers prüfen – dcdiag und repadmin
bereich: Server & Active Directory
tags: dcdiag, repadmin, replikation, domänencontroller, gesundheitscheck, ad fehler
zielgruppe: technik
---
**Symptom:** Anmeldungen, Gruppenrichtlinien oder DNS verhalten sich unregelmäßig; vor Änderungen am Server soll der Zustand geprüft werden.

**Häufige Ursachen:** Replikationsfehler, DNS-Fehler, Zeitabweichung, Dienste, die nicht laufen, oder ein veralteter, nicht entfernter Domänencontroller.

## Lösung
1. Als Domänenadministrator eine Eingabeaufforderung öffnen.
2. Gesamtprüfung: `dcdiag`, ausführlicher `dcdiag /v`, nur Fehler `dcdiag /q`. DNS gezielt: `dcdiag /test:dns`.
3. In der Ausgabe auf **failed** achten. Tests zu Diensten, NetLogons, Advertising, FsmoCheck und Replications sind zentral.
4. Replikation zusammengefasst: `repadmin /replsummary`. Spalten mit Fehlern und große Zeitabstände beachten.
5. Details je Partner: `repadmin /showrepl`.
6. Replikation anstoßen: `repadmin /syncall /AdeP`.
7. Zeit (`w32tm /query /status`) und DNS-Auflösung der Partner prüfen.
8. Dienste kontrollieren: Active Directory-Domänendienste, DNS-Server, Netlogon, Kerberos-Schlüsselverteilungscenter.
9. Ergebnis mit Datum im Ticket festhalten.

**Achtung:** Metadaten eines Domänencontrollers nur bereinigen, wenn er dauerhaft ausgefallen ist. Vorher Sicherung und Rollenverteilung klären (`netdom query fsmo`).

## Wenn das nicht hilft
- Fehlermeldungen von `dcdiag` im Wortlaut ins Ticket kopieren und die Ereignisprotokolle **Verzeichnisdienst** und **DFS-Replikation** auswerten.

=== ARTIKEL
titel: PC lässt sich nicht in die Domäne aufnehmen oder Vertrauensstellung verloren
bereich: Server & Active Directory
tags: domäne beitreten, vertrauensstellung, computerkonto, secure channel, anmeldung nicht möglich, nltest
zielgruppe: technik
---
**Symptom:** Der Beitritt zur Domäne scheitert, oder die Anmeldung meldet, die Vertrauensstellung zwischen der Arbeitsstation und der Primärdomäne sei fehlgeschlagen.

**Häufige Ursachen:** Der Client nutzt nicht den Domänencontroller als DNS, das Computerkonto wurde gelöscht oder zurückgesetzt, ein altes Abbild oder eine zurückgesetzte VM hat ein veraltetes Computerkennwort, die Zeit weicht ab.

## Lösung
Beitritt:
1. Am Client prüfen: `ipconfig /all` (DNS nur Domänencontroller), `nslookup domäne.local`, Zeit.
2. **Einstellungen → System → Info → Domäne oder Arbeitsgruppe** (je nach Version) und Domänenkonto mit Beitrittsrecht verwenden.
3. Gleicher Computername schon vorhanden? Konto in **Active Directory-Benutzer und -Computer** prüfen.

Vertrauensstellung:
1. Mit lokalem Administrator anmelden.
2. Prüfen: `Test-ComputerSecureChannel -Verbose` und `nltest /sc_verify:domäne.local`.
3. Reparieren: `Test-ComputerSecureChannel -Repair -Credential (Get-Credential)` in PowerShell als Administrator.
4. Alternativ `Reset-ComputerMachinePassword -Server dc01 -Credential (Get-Credential)`, danach Neustart.
5. Hilft das nicht: aus der Domäne in eine Arbeitsgruppe wechseln und neu beitreten.

**Achtung:** Beim Entfernen und Neubeitreten kann das Profil unter Umständen neu erstellt werden, wenn sich die Zuordnung ändert. Vorher Daten sichern.

## Wenn das nicht hilft
- Zustand der Domänencontroller und die Replikation prüfen (`dcdiag`, `repadmin /replsummary`).

=== ARTIKEL
titel: Server-Speicherplatz voll – Ursachen finden
bereich: Server & Active Directory
tags: speicherplatz voll, laufwerk voll, c: voll, festplatte, platte voll, server
zielgruppe: technik
---
**Symptom:** Das Systemlaufwerk oder ein Datenlaufwerk ist fast voll, Dienste melden Fehler, Updates schlagen fehl.

**Häufige Ursachen:** Protokolldateien, Windows-Update-Reste, Schattenkopien, Prüfpunkte von virtuellen Maschinen, Sicherungs- oder Temp-Dateien, wachsende Benutzerprofile (Remotedesktop), Datenbanken.

## Lösung
1. Überblick: `Get-Volume` oder `Get-PSDrive -PSProvider FileSystem`.
2. Größte Ordner finden, zum Beispiel:
```
Get-ChildItem D:\ -Directory | ForEach-Object { "{0:N1} GB  {1}" -f ((Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1GB), $_.Name }
```
3. Speicher der Schattenkopien: `vssadmin list shadowstorage`; bei Bedarf das Maximum mit `vssadmin resize shadowstorage` verkleinern.
4. Bei Hyper-V Prüfpunkte (`.avhdx`) und dynamische Festplatten mit `Get-VMSnapshot -VMName *` prüfen.
5. Auf Systemlaufwerk: Ordner `C:\Windows\Temp`, Profile unter `C:\Users`, `C:\Windows\SoftwareDistribution\Download`.
6. Komponentenspeicher bereinigen: `dism /online /Cleanup-Image /StartComponentCleanup`.
7. Datenträgerbereinigung `cleanmgr` als Administrator.

**Achtung:** Nichts im Ordner `C:\Windows` per Hand löschen, außer den genannten Stellen. Vor dem Löschen von Datenordnern Rücksprache mit dem Kunden und Sicherung prüfen.

## Wenn das nicht hilft
- Datenträger vergrößern oder Daten verschieben, Wachstum dokumentieren.

=== ARTIKEL
titel: Windows-Server-Updates planen und Neustartfenster festlegen
bereich: Server & Active Directory
tags: windows update, server, neustart, patchen, wartungsfenster, updates planen
zielgruppe: technik
---
**Symptom:** Updates werden nicht oder zu ungünstigen Zeiten installiert, der Server startet unerwartet neu, oder Updates stehen dauerhaft aus.

**Häufige Ursachen:** Keine Wartungsplanung, automatische Installation mit Neustart in der Arbeitszeit, ausstehender Neustart, zu wenig Speicherplatz.

## Lösung
1. Mit dem Kunden ein festes Wartungsfenster vereinbaren, zum Beispiel außerhalb der Geschäftszeiten.
2. Vorher: aktuelle Sicherung kontrollieren, freien Speicherplatz prüfen, offene Sitzungen ankündigen.
3. Verhalten per Gruppenrichtlinie steuern: **Computerkonfiguration → Administrative Vorlagen → Windows-Komponenten → Windows Update**. Dort die Richtlinie zur automatischen Updates festlegen, etwa Herunterladen automatisch, Installation geplant.
4. Reihenfolge bei mehreren Servern: erst Hyper-V-Host oder Domänencontroller einzeln und nacheinander, nie alle Domänencontroller gleichzeitig. Gäste vorher sauber herunterfahren.
5. Nach dem Neustart prüfen: Dienste laufen, `Get-HotFix | Sort InstalledOn -Descending | Select -First 5`, Ereignisanzeige, `dcdiag /q`.
6. Update-Verlauf unter **Einstellungen → Windows Update → Updateverlauf** (je nach Version) kontrollieren.
7. Durchgeführte Updates und Datum in der Serverdokumentation vermerken.

**Achtung:** Neustart beendet alle Sitzungen und Dienste. Datenbank- und Sicherungsjobs vorher abwarten.

## Wenn das nicht hilft
- Meldung und Fehlercode des fehlgeschlagenen Updates festhalten und Ereignisprotokoll **System** auswerten.

=== ARTIKEL
titel: Ereignisanzeige gezielt auswerten statt endlos scrollen
bereich: Server & Active Directory
tags: ereignisanzeige, eventlog, fehler suchen, get-winevent, protokoll, 4625
zielgruppe: technik
---
**Symptom:** Ein Fehler tritt auf, die Ursache ist unklar, die Ereignisanzeige enthält tausende Einträge.

**Häufige Ursachen:** Es wird ohne Zeitraum und Filter gesucht, das falsche Protokoll betrachtet oder die Quelle nicht eingegrenzt.

## Lösung
1. **Windows-Taste + R**, `eventvwr.msc`, Enter.
2. Zeitpunkt des Problems notieren und im passenden Protokoll arbeiten: **Windows-Protokolle → System** (Dienste, Treiber, Neustarts), **Anwendung**, **Sicherheit** (Anmeldungen).
3. Rechtsklick auf das Protokoll → **Aktuelles Protokoll filtern**: Zeitraum und Ebene (Kritisch, Fehler, Warnung) wählen.
4. Auf die **Quelle** und den ersten Fehler zeitlich vor dem Ausfall achten. Folgefehler sind oft unwichtig.
5. Speziellere Protokolle unter **Anwendungs- und Dienstprotokolle → Microsoft → Windows**, zum Beispiel GroupPolicy oder TerminalServices.
6. Per PowerShell:
```
Get-WinEvent -FilterHashtable @{LogName='System';Level=2;StartTime=(Get-Date).AddDays(-1)} | Format-Table TimeCreated,Id,ProviderName,Message -Wrap
```
7. Nützliche IDs im Sicherheitsprotokoll: 4624 (Anmeldung erfolgreich), 4625 (fehlgeschlagen), 4740 (Konto gesperrt).
8. Wichtige Einträge per Rechtsklick **Ereignis speichern** oder den Text ins Ticket kopieren.

**Achtung:** **Protokoll löschen** vernichtet Beweise. Nur nach Sicherung und Rücksprache.

## Wenn das nicht hilft
- Ereignis-ID, Quelle und Uhrzeit ins Ticket schreiben und nicht nur die Fehlermeldung.

=== ARTIKEL
titel: Dienst startet nicht – Ursachen eingrenzen
bereich: Server & Active Directory
tags: dienst startet nicht, dienst, services.msc, 7000, 7009, anmeldekonto, abhängigkeit
zielgruppe: technik
---
**Symptom:** Ein Windows-Dienst lässt sich nicht starten oder beendet sich sofort wieder, eine Anwendung auf dem Server ist dadurch unerreichbar.

**Häufige Ursachen:** Kennwort des Dienstkontos geändert oder Konto gesperrt, abhängiger Dienst läuft nicht, Datei oder Port belegt, beschädigte Programmdateien, zu wenig Speicherplatz, Zeitüberschreitung beim Start.

## Lösung
1. **Windows-Taste + R**, `services.msc`. Dienst öffnen, Reiter **Anmelden** (Konto) und **Abhängigkeiten** prüfen.
2. Status per PowerShell: `Get-Service -Name Dienstname`, Konten aller Dienste: `Get-CimInstance Win32_Service | Select Name,StartName,State`.
3. Starten: `Start-Service -Name Dienstname`. Die Fehlermeldung beachten.
4. Ereignisanzeige, Protokoll **System**, Quelle **Service Control Manager**: 7000 (Start fehlgeschlagen), 7001 (Abhängigkeit), 7009 (Zeitüberschreitung), 7031 und 7034 (unerwartet beendet).
5. Dienstkonto kontrollieren: Kennwort neu setzen, Konto nicht gesperrt oder abgelaufen, Recht **Anmelden als Dienst** vorhanden.
6. Abhängige Dienste zuerst starten.
7. Anwendungsprotokolle des Herstellers ansehen.
8. Freien Speicherplatz prüfen.

**Achtung:** Dienstkonto nicht auf **Lokales System** umstellen, nur um den Fehler zu umgehen. Berechtigungen können sich ändern.

## Wenn das nicht hilft
- Name des Dienstes, Fehlermeldung, Ereignis-ID, letzte Änderung (Update, Kennwort) im Ticket notieren.

=== ARTIKEL
titel: Remotedesktop – Verbindung zum Server nicht möglich
bereich: Server & Active Directory
tags: remotedesktop, rdp, 3389, verbindung fehlgeschlagen, mstsc, kein zugriff
zielgruppe: technik
---
**Symptom:** Die Remotedesktopverbindung (`mstsc`) zum Server bricht ab oder meldet, dass die Verbindung nicht möglich ist.

**Häufige Ursachen:** Remotedesktop deaktiviert, Firewall, Benutzer ist nicht in der Gruppe **Remotedesktopbenutzer**, Dienst beendet, Name löst nicht auf, Netzwerkauthentifizierung, Sitzungslimit erreicht.

## Lösung
1. Namen und Erreichbarkeit prüfen: `nslookup servername`, danach `Test-NetConnection -ComputerName servername -Port 3389`.
2. Ist der Port zu, direkt am Server (Konsole, Hyper-V-Verbindung oder iDRAC-/iLO-Zugang) prüfen.
3. Aktiviert? **Systemeigenschaften → Remote** (`SystemPropertiesRemote.exe`), Option für Remoteverbindungen aktiv.
4. Dienst **Remotedesktopdienste** läuft: `Get-Service TermService`.
5. Firewall: Regelgruppe für Remotedesktop eingehend aktiv (`Get-NetFirewallRule -DisplayGroup "Remotedesktop"`, Bezeichnung je nach Sprachversion).
6. Berechtigung: Benutzer in **Remotedesktopbenutzer** oder Administratoren.
7. Bei Meldungen zur Authentifizierung oder Zertifikat Zeit, Domänenvertrauen und Zertifikat prüfen.
8. Im Server-Manager unter **Remotedesktopdienste** sowie mit `query user` gestapelte oder getrennte Sitzungen prüfen.

**Achtung:** Remotedesktop nicht ungeschützt ins Internet freigeben. Zugang nur über VPN oder Gateway.

## Wenn das nicht hilft
- Ereignisprotokolle **TerminalServices-RemoteConnectionManager** und **Sicherheit** prüfen, genaue Fehlermeldung und Quelladresse notieren.

=== ARTIKEL
titel: Remotedesktopdienste – Lizenzierung und getrennte Sitzungen
bereich: Server & Active Directory
tags: rds, lizenzierung, cal, getrennte sitzungen, terminalserver, sitzung hängt
zielgruppe: technik
---
**Symptom:** Benutzer erhalten Lizenzmeldungen am Terminalserver, Verbindungen werden abgelehnt, oder getrennte Sitzungen belegen Ressourcen.

**Häufige Ursachen:** Lizenzserver nicht aktiviert oder nicht eingetragen, fehlende Client-Zugriffslizenzen (RDS-CALs), abgelaufener Testzeitraum (120 Tage), Sitzungen ohne Zeitlimit.

## Lösung
1. Lizenzserver prüfen: Rolle **Remotedesktoplizenzierung** installiert, im **Remotedesktoplizenzierungs-Manager** (`licmgr.exe`) aktiviert, CALs installiert (Pro Gerät oder Pro Benutzer passend zur Einstellung).
2. Am Sitzungshost den Lizenzserver und Lizenzierungsmodus festlegen: per Gruppenrichtlinie **Computerkonfiguration → Administrative Vorlagen → Windows-Komponenten → Remotedesktopdienste → Remotedesktopsitzungs-Host → Lizenzierung**.
3. Diagnose im Server-Manager unter Remotedesktopdienste beziehungsweise dem Lizenzierungsdiagnose-Werkzeug (je nach Version).
4. Sitzungen ansehen: `query user`. Getrennte Sitzung beenden: `logoff <ID>`.
5. Zeitlimits per Richtlinie unter **Remotedesktopsitzungs-Host → Sitzungszeitlimits** setzen, etwa Beenden getrennter Sitzungen nach vereinbarter Zeit.
6. Benutzer anweisen, sich abzumelden statt das Fenster zu schließen.

**Achtung:** Getrennte Sitzungen mit `logoff` enden sofort, ungespeicherte Arbeit geht verloren. Vorher Benutzer fragen.

## Wenn das nicht hilft
- Lizenzmenge und Lizenzvertrag des Kunden mit dem Vertrieb klären und Fehlertext der Meldung im Ticket festhalten.

=== ARTIKEL
titel: Hyper-V – Prüfpunkte richtig nutzen und zusammenführen
bereich: Server & Active Directory
tags: hyper-v, prüfpunkt, checkpoint, snapshot, avhdx, zusammenführen
zielgruppe: technik
---
**Symptom:** Eine VM wird langsam, der Datenträger füllt sich, oder alte Prüfpunkte liegen monatelang herum.

**Häufige Ursachen:** Prüfpunkte als Dauer-Sicherung missbraucht, Differenzfestplatten (`.avhdx`) wachsen, Zusammenführen vergessen.

## Hintergrund
Ein Prüfpunkt hält den Zustand einer VM fest und leitet neue Schreibvorgänge in eine Differenzdatei um. Er eignet sich für kurzfristige Absicherung vor Updates, nicht als Datensicherung.

## Lösung
1. Prüfpunkte anzeigen: `Get-VMSnapshot -VMName "VM01"`, im **Hyper-V-Manager** unter der VM.
2. Vor Änderungen: `Checkpoint-VM -Name "VM01" -SnapshotName "vor Update"`.
3. Nach erfolgreicher Prüfung Prüfpunkt löschen: Rechtsklick → **Prüfpunkt löschen** oder `Remove-VMSnapshot -VMName "VM01" -Name "vor Update"`. Dabei wird der Inhalt in die Festplatte zusammengeführt, bei laufender VM im Hintergrund.
4. Fortschritt abwarten und freien Speicherplatz beobachten.
5. Bei Problemen **Zurücksetzen** (Anwenden) auf den Prüfpunkt.

**Achtung:** Beim Zurücksetzen gehen alle Änderungen seit dem Prüfpunkt verloren. Nie auf Domänencontrollern zurücksetzen, ohne vorher das Vorgehen zu klären, da sonst Replikationsprobleme entstehen. Differenzdateien nie von Hand löschen oder verschieben. Zum Zusammenführen ausreichend Platz bereithalten.

## Wenn das nicht hilft
- Läuft das Zusammenführen nicht durch, VM ausschalten, Platz schaffen und Vorgang wiederholen. Sicherung vorher prüfen.

=== ARTIKEL
titel: Hyper-V – virtuelle Maschine startet nicht, Speicherplatz knapp
bereich: Server & Active Directory
tags: hyper-v, vm startet nicht, virtuelle maschine, speicherplatz, fehler, vhdx
zielgruppe: technik
---
**Symptom:** Eine VM bleibt im Zustand „Aus“, meldet beim Start einen Fehler oder pausiert („Kritisch pausiert“).

**Häufige Ursachen:** Datenträger des Hosts voll, zu wenig Arbeitsspeicher, gesperrte oder fehlende VHDX-Datei, Berechtigungen auf dem Speicherpfad, beschädigter Zustand nach Stromausfall.

## Lösung
1. Status und Zustand: `Get-VM | Select Name,State,Status`.
2. Freien Platz am Speicherort prüfen: `Get-Volume`. Pausiert die VM wegen Platzmangels, erst Speicher schaffen, dann im Hyper-V-Manager **Fortsetzen**.
3. Arbeitsspeicher prüfen: Startspeicher der VM gegen freien Hostspeicher.
4. Pfade der Festplatten prüfen: `Get-VMHardDiskDrive -VMName "VM01"`, die Dateien müssen vorhanden sein und nicht von einer anderen VM verwendet werden.
5. Differenzdateien und Prüfpunkte kontrollieren (`Get-VMSnapshot`).
6. Meldung im Protokoll **Anwendungs- und Dienstprotokolle → Microsoft → Windows → Hyper-V-VMMS** lesen.
7. Dienst **Hyper-V-Verwaltung** prüfen: `Get-Service vmms`.
8. Danach `Start-VM -Name "VM01"`.

**Achtung:** Dateien im VM-Ordner nicht umbenennen oder löschen. Vor jedem Eingriff Sicherung der VM prüfen. Dynamische Festplatten können wachsen und den Host-Datenträger füllen.

## Wenn das nicht hilft
- Genaue Fehlermeldung, Ereignis des Hyper-V-VMMS, freien Platz und Zeitpunkt des letzten erfolgreichen Starts ins Ticket schreiben.

=== ARTIKEL
titel: Servertausch – Vorgehen und Reihenfolge
bereich: Server & Active Directory
tags: servertausch, migration, neuer server, domänencontroller, umzug, dateiserver
zielgruppe: technik
---
**Symptom:** Ein alter Server soll durch einen neuen ersetzt werden, ohne dass der Betrieb länger steht.

**Häufige Ursachen für Probleme:** fehlende Bestandsaufnahme, vergessene Dienste, Namen und Adressen, unbekannte Abhängigkeiten.

## Lösung
1. Bestand erfassen: Rollen, Freigaben, Software, Dienstkonten, geplante Aufgaben, DHCP- und DNS-Daten, Drucker, Lizenzen.
2. Zieltermin und Wartungsfenster mit dem Kunden festlegen, Datensicherung des alten Servers prüfen.
3. Neuen Server installieren, aktualisieren und als Mitglied in die Domäne aufnehmen.
4. Rolle **Active Directory-Domänendienste** installieren und zum Domänencontroller heraufstufen. Replikation mit `dcdiag` und `repadmin /replsummary` prüfen.
5. Rollenverteilung übertragen (`netdom query fsmo`, Artikel zu FSMO), DNS, DHCP und globalen Katalog umstellen.
6. Daten kopieren: `robocopy Quelle Ziel /E /COPYALL /DCOPY:DAT /R:1 /W:1 /LOG:C:\Temp\kopie.log`. Freigaben neu anlegen (Einstellungen liegen in der Registry unter `HKLM\SYSTEM\CurrentControlSet\Services\LanmanServer\Shares`).
7. Clients, Skripte und Richtlinien auf neue Pfade prüfen.
8. Alten Domänencontroller über Rollenentfernung herabstufen, Server erst dann ausschalten und einige Wochen aufbewahren.

**Achtung:** Nie einen Domänencontroller einfach ausschalten und löschen. Vorher herabstufen. Ältere Dateireplikation (FRS) vorher auf DFSR umstellen, falls vorhanden (`dfsrmig /getglobalstate`).

## Wenn das nicht hilft
- Zurück auf den alten Server, solange er unverändert ist, und Fehler im Ticket dokumentieren.

=== ARTIKEL
titel: FSMO-Rollen anzeigen und übertragen
bereich: Server & Active Directory
tags: fsmo, pdc-emulator, rid-master, schemamaster, rollen übertragen, netdom
zielgruppe: technik
---
**Symptom:** Vor dem Tausch oder der Herabstufung eines Domänencontrollers muss geklärt werden, wo die Betriebsmasterrollen liegen; oder ein Domänencontroller ist dauerhaft ausgefallen.

**Häufige Ursachen:** Rollen blieben auf dem ersten Domänencontroller, Dokumentation fehlt.

## Hintergrund
Es gibt fünf Rollen: Schemamaster und Domänennamenmaster (je Gesamtstruktur) sowie PDC-Emulator, RID-Master und Infrastrukturmaster (je Domäne).

## Lösung
1. Anzeigen: `netdom query fsmo`.
2. Alternativ: `Get-ADDomain | Select PDCEmulator,RIDMaster,InfrastructureMaster` und `Get-ADForest | Select SchemaMaster,DomainNamingMaster`.
3. Vor der Übertragung Replikation prüfen: `repadmin /replsummary`.
4. Übertragen in PowerShell:
```
Move-ADDirectoryServerOperationMasterRole -Identity "DC02" -OperationMasterRole PDCEmulator,RIDMaster,InfrastructureMaster,SchemaMaster,DomainNamingMaster
```
5. Mit `netdom query fsmo` kontrollieren.
6. Danach auf dem PDC-Emulator die Zeitquelle prüfen (`w32tm /query /status`).

**Achtung:** Beim Übernehmen (Seizing, mit `-Force` oder `ntdsutil`) nur vorgehen, wenn der alte Domänencontroller dauerhaft ausgefallen ist. Er darf danach nie wieder ans Netz. Zuerst immer normal übertragen.

## Wenn das nicht hilft
- Meldungen im Protokoll **Verzeichnisdienst** lesen, Erreichbarkeit der Ziel-DC (DNS, Ports) prüfen und Ausgabe von `dcdiag` ins Ticket.

=== ARTIKEL
titel: Zweiter Domänencontroller – wann sinnvoll und wie vorgehen
bereich: Server & Active Directory
tags: zweiter domänencontroller, ausfallsicherheit, redundanz, dc, replikation, globaler katalog
zielgruppe: technik
---
**Symptom:** Fällt der einzige Domänencontroller aus, können sich Benutzer nicht mehr anmelden, DNS und Gruppenrichtlinien fehlen.

**Häufige Ursachen:** Kleine Betriebe laufen oft mit nur einem Domänencontroller. Das Risiko wird erst beim Ausfall sichtbar.

## Hintergrund
Ein zweiter Domänencontroller ist sinnvoll, sobald die Domäne für den Betrieb unverzichtbar ist, also bei fast allen Betrieben mit Domäne. Er stellt Anmeldung, DNS und Verzeichnis auch bei Wartung oder Ausfall bereit. Er ersetzt keine Datensicherung.

## Lösung
1. Zweite Maschine bereitstellen: kleine virtuelle Maschine auf einem anderen Host oder eigener Mini-Server. Nicht beide Domänencontroller auf dieselbe einzelne Hardware legen, wenn sich das vermeiden lässt.
2. Feste IP-Adresse vergeben, als DNS den ersten Domänencontroller.
3. Rolle **Active Directory-Domänendienste** installieren und als zusätzlichen Domänencontroller heraufstufen. DNS-Server und globalen Katalog aktivieren.
4. Replikation prüfen: `dcdiag`, `repadmin /replsummary`.
5. DNS-Einstellungen: Beide Domänencontroller als DNS-Server in DHCP-Option und Netzwerkadaptern eintragen.
6. Sicherung auch für den zweiten einrichten.

**Achtung:** Virtuelle Domänencontroller nie durch Prüfpunkte zurücksetzen. Die Zeitquelle am PDC-Emulator beachten.

## Wenn das nicht hilft
- Bei Fehlern bei der Heraufstufung Zeit, DNS-Auflösung und Funktionsebene prüfen und Fehlermeldung ins Ticket.

=== ARTIKEL
titel: Dienstkonten und geplante Aufgaben richtig einrichten und prüfen
bereich: Server & Active Directory
tags: dienstkonto, geplante aufgabe, aufgabenplanung, kennwort abgelaufen, service account, task
zielgruppe: technik
---
**Symptom:** Eine geplante Aufgabe oder ein Dienst läuft plötzlich nicht mehr, meist nach einer Kennwortänderung oder Kontosperre.

**Häufige Ursachen:** Dienstkonto ist ein persönliches Konto, Kennwort läuft ab, fehlende Rechte wie **Anmelden als Stapelverarbeitungsauftrag**, Aufgabe läuft nur bei angemeldetem Benutzer.

## Lösung
1. Eigenes Dienstkonto je Anwendung anlegen, Namensschema wie `svc_sicherung`, in eigener OU, mit minimalen Rechten. Keine Domänenadministratoren, wenn vermeidbar.
2. Kennwort vergeben und nach Absprache **Kennwort läuft nie ab** setzen, dafür langes Kennwort wählen und im Kennwortmanager des Technikers hinterlegen.
3. Geplante Aufgabe: `taskschd.msc`, Aufgabe öffnen, Reiter **Allgemein**: **Unabhängig von der Benutzeranmeldung ausführen** und bei Bedarf **Mit höchsten Berechtigungen ausführen**.
4. Letztes Ergebnis prüfen: `Get-ScheduledTaskInfo -TaskName "Name"`. 0 bedeutet Erfolg, 0x41301 bedeutet, dass die Aufgabe noch läuft.
5. Alle Aufgaben anzeigen: `Get-ScheduledTask | Select TaskName,State`.
6. Konten der Dienste: `Get-CimInstance Win32_Service | Select Name,StartName`.
7. Nach Kennwortwechsel Dienste und Aufgaben anpassen.
8. Dienstkonten im Active Directory auf Sperre prüfen (`Get-ADUser svc_sicherung -Properties LockedOut`).

**Achtung:** Kennwort eines Dienstkontos nur im Wartungsfenster ändern, weil abhängige Dienste ausfallen können.

## Wenn das nicht hilft
- Ereignisprotokoll **Microsoft → Windows → TaskScheduler → Betriebsbereit** (falls aktiviert) und Sicherheitsprotokoll prüfen.

=== ARTIKEL
titel: Zertifikat auf dem Server läuft ab oder ist abgelaufen
bereich: Server & Active Directory
tags: zertifikat, abgelaufen, ablauf, rdp zertifikat, certlm, ssl
zielgruppe: technik
---
**Symptom:** Browser oder Remotedesktop melden eine Zertifikatswarnung, ein Dienst verweigert die verschlüsselte Verbindung.

**Häufige Ursachen:** Das Zertifikat ist abgelaufen, wurde nicht erneuert, gehört zu einem alten Servernamen oder der Dienst nutzt noch ein altes Zertifikat.

## Lösung
1. Zertifikate des Computers anzeigen: **Windows-Taste + R**, `certlm.msc`, **Eigene Zertifikate → Zertifikate**.
2. Per PowerShell Ablaufdaten auflisten:
```
Get-ChildItem Cert:\LocalMachine\My | Select Subject,NotAfter,Thumbprint | Sort NotAfter
```
3. Prüfen, wofür das Zertifikat verwendet wird: Remotedesktop, Webdienst, LDAPS, Anwendung des Herstellers.
4. Bei selbstsignierten Remotedesktop-Zertifikaten erneuert Windows automatisch. Bei Zertifikaten einer Zertifizierungsstelle oder des Anbieters ein neues Zertifikat beantragen und installieren.
5. Das neue Zertifikat in der Anwendung zuweisen (zum Beispiel Bindung in der Webseite) und den Dienst neu starten.
6. Ablaufdaten in der Serverdokumentation festhalten und eine Erinnerung vor dem Ende anlegen.

**Achtung:** Zertifikate nicht löschen, bevor das neue funktioniert. Der private Schlüssel ist ohne Export nicht wiederherzustellen. Dienstneustart nur im Wartungsfenster.

## Wenn das nicht hilft
- Betroffene Anwendung, Dienstname, Ablaufdatum und Fehlermeldung ins Ticket schreiben.

=== ARTIKEL
titel: Server sauber herunterfahren und nach Stromausfall prüfen
bereich: Server & Active Directory
tags: stromausfall, herunterfahren, usv, neustart, unerwartet, server aus
zielgruppe: technik
---
**Symptom:** Der Server wurde durch Stromausfall hart ausgeschaltet oder soll planmäßig heruntergefahren werden.

**Häufige Ursachen:** Keine oder leere USV, USV-Software nicht konfiguriert, Reihenfolge der Systeme nicht beachtet.

## Lösung
Planmäßig:
1. Benutzer informieren, Datenbank- und Sicherungsjobs beenden lassen.
2. Virtuelle Maschinen zuerst sauber herunterfahren (Anwendungsserver, dann Dateiserver), den Domänencontroller zuletzt. Per PowerShell `Stop-VM -Name "VM01"` (fährt über die Integrationsdienste herunter).
3. Dann den Host: `shutdown /s /t 60 /c "Wartung"`.
4. Einschalten in umgekehrter Reihenfolge: Netzwerk, Domänencontroller (DNS), dann übrige Server.

Nach Stromausfall:
1. Ereignisanzeige, **System**: 41 (Kernel-Power), 6008 (unerwartetes Herunterfahren), 1074 (geplantes Herunterfahren mit Begründung).
2. Dienste prüfen: `Get-Service | Where {$_.StartType -eq 'Automatic' -and $_.Status -ne 'Running'}`.
3. Dateisystem: `fsutil dirty query D:`. Bei Hinweis auf Fehler Prüfung einplanen.
4. Domänencontroller: `dcdiag /q`, `repadmin /replsummary`.
5. Hyper-V-VMs, Datenbanken, Sicherungsjob und Zustand der Datenträger (RAID) kontrollieren.
6. USV prüfen: Akku, Laufzeit, Test.

**Achtung:** `chkdsk /f` kann Daten verändern, zuvor Sicherung kontrollieren. Servern nie mit Netzschalter ausschalten.

## Wenn das nicht hilft
- Zeitpunkt, Ereignisse 41 und 6008 sowie Zustand des RAID und der USV ins Ticket schreiben.

=== ARTIKEL
titel: Serverdokumentation – was festgehalten werden sollte
bereich: Server & Active Directory
tags: dokumentation, serverdoku, inventar, übergabe, checkliste, konfiguration
zielgruppe: technik
---
**Symptom:** Bei Störung oder Tausch fehlen Informationen zu Rollen, Adressen, Zugängen oder Verantwortlichen, die Fehlersuche dauert lange.

**Häufige Ursachen:** Wissen steckt im Kopf einzelner Techniker, Änderungen werden nicht nachgetragen.

## Lösung
Je Server festhalten:
1. **Grunddaten:** Name, Modell oder VM-Host, Seriennummer, Standort, Garantieende, Betriebssystem und Version, Installationsdatum.
2. **Netzwerk:** IP-Adresse, DNS, Gateway, Domäne, Besonderheiten wie feste Reservierungen.
3. **Rollen:** Domänencontroller, FSMO-Rollen (`netdom query fsmo`), DNS, DHCP, Dateiserver, Remotedesktopdienste, Hyper-V und die Verteilung der VMs.
4. **Freigaben und Gruppenstruktur:** Pfade, Gruppen je Ordner, Schattenkopien-Einstellung.
5. **Dienstkonten und geplante Aufgaben:** Name, Zweck, Ablauf, Wartungsfenster.
6. **Zertifikate und Lizenzen:** Ablaufdaten, Lizenzart, RDS-CALs, Lizenzserver.
7. **Sicherung:** Art, Ziel, Zeitplan, letzter Test.
8. **Wartung:** Update-Zeitpunkte, Änderungen mit Datum und Techniker.
9. **Ansprechpartner** beim Kunden und Herstellersupport.
10. Zugangsdaten in einem Kennwortmanager des Dienstleisters ablegen und in der Dokumentation nur darauf verweisen.

**Achtung:** Keine Kennwörter in Textdateien, Tabellen oder Tickets schreiben. Dokumentation selbst sichern und nach jeder Änderung aktualisieren.

## Wenn das nicht hilft
- Fehlende Angaben beim nächsten Besuch ergänzen: Systeminformationen mit `systeminfo` und `ipconfig /all` liefern die Grunddaten.
