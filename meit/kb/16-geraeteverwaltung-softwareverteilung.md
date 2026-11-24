=== ARTIKEL
titel: Intune im Kleinbetrieb – was es bringt und was dafür nötig ist
bereich: Geräteverwaltung & Softwareverteilung
tags: intune, mdm, geräteverwaltung, kleinbetrieb, voraussetzungen, cloud, endpoint manager
zielgruppe: technik
---
**Symptom:** Ein Kunde mit 10 bis 50 Arbeitsplätzen fragt, ob sich Intune lohnt, oder die Geräte sollen ohne Domänencontroller zentral verwaltet werden.

**Häufige Ursachen:** Unklare Erwartungen (Intune ersetzt weder Server noch Dateiablage), fehlende Lizenz im Tenant, Mischbetrieb aus lokalem AD und Cloud ohne Plan, keine Zuständigkeit für laufende Pflege.

## Lösung
1. Prüfen, ob die vorhandene Microsoft-365-Lizenz Intune enthält (Lizenzübersicht im Admin-Center). Bei Unklarheit nicht raten, sondern die Lizenzbeschreibung des Herstellers heranziehen.
2. Nutzen benennen: Geräte ohne Domäne verwalten, Software und Einstellungen zentral verteilen, Updates steuern, Verschlüsselung erzwingen, Geräte aus der Ferne zurücksetzen, Bestandsliste ohne Handarbeit.
3. Voraussetzungen klären: Benutzerkonten in Entra ID, Windows 10/11 in Pro-, Enterprise- oder Education-Edition (Home lässt sich nicht sinnvoll verwalten), Internetzugang der Geräte, ein Administratorkonto mit passender Rolle.
4. Mit einer kleinen Pilotgruppe (2 bis 3 Geräte) beginnen, Gruppen für Pilot und Alle anlegen.
5. Reihenfolge festlegen: Registrierung, Update-Ringe, Verschlüsselung, Sicherheitsbasis, Anwendungen, erst danach Feinheiten.
6. Betrieb festlegen: wer prüft Fehlerberichte, wer pflegt Pakete, wer entscheidet über Updates.

## Hintergrund
Intune verwaltet Geräte über Richtlinien aus der Cloud. Ein lokales Active Directory ist nicht nötig, kann aber parallel bestehen (Hybrid-Beitritt).

## Wenn das nicht hilft
- Ist der Nutzen fraglich (z. B. ein einziger Arbeitsplatz), Gruppenrichtlinien oder manuelle Pflege weiter einsetzen.
- Für das Ticket notieren: Lizenzstand, Geräteanzahl, Windows-Editionen, vorhandenes AD ja/nein.

=== ARTIKEL
titel: Windows Autopilot – Ablauf von der Lieferung bis zum fertigen Arbeitsplatz
bereich: Geräteverwaltung & Softwareverteilung
tags: autopilot, neuinstallation, bereitstellung, oobe, esp, neuer pc, einrichtung
zielgruppe: technik
---
**Symptom:** Neue Geräte sollen ohne Handinstallation beim Mitarbeiter ankommen und sich beim ersten Start selbst einrichten.

**Häufige Ursachen:** Hardware-Kennung nicht erfasst, Autopilot-Profil keiner Gerätegruppe zugewiesen, Gerät beim ersten Start ohne Internet, Anwender ohne Intune-Lizenz.

## Lösung
1. Hardware-Kennung (Hardware-Hash) erfassen: durch den Händler bei Lieferung oder selbst (siehe Artikel zum Erfassen bestehender PCs).
2. Im Intune-Portal prüfen, dass das Gerät in der Autopilot-Geräteliste steht. Optional eine Gruppenkennung (Group Tag) vergeben.
3. Bereitstellungsprofil anlegen und dem Gerät oder der Gerätegruppe zuweisen: Beitrittsart (Entra-Beitritt), Benutzerkontoart (Standardbenutzer statt Administrator), Sprache und Region, Umgang mit den Lizenzbedingungen.
4. Anwendungen und Richtlinien den Geräte- oder Benutzergruppen zuweisen. Wichtige Programme in die Statusseite zur Registrierung (Enrollment Status Page) aufnehmen, damit der Anwender erst nach der Installation arbeitet.
5. Gerät ans Netz (LAN oder WLAN) anschließen und starten. Windows fragt nach Region, Tastatur und Netzwerk und zeigt die Firmenanmeldung.
6. Anwender meldet sich mit dem Firmenkonto an. Richtlinien und Programme werden geladen, die Statusseite zeigt den Fortschritt.
7. Nach dem ersten Anmelden stichprobenartig prüfen: Verschlüsselung, Defender, Programme, Benutzerprofil.

## Wenn das nicht hilft
- Bleibt die Einrichtung hängen, Gerät mit dem Hardware-Hash in der Autopilot-Liste und die Profilzuweisung abgleichen.
- Für das Ticket notieren: Seriennummer, Zeitpunkt, Seite der Statusanzeige, Fehlertext.

=== ARTIKEL
titel: Bestehenden PC für Autopilot erfassen (Hardware-Hash auslesen und hochladen)
bereich: Geräteverwaltung & Softwareverteilung
tags: autopilot, hardware-hash, erfassen, get-windowsautopilotinfo, csv, bestandsgerät, import
zielgruppe: technik
---
**Symptom:** Ein vorhandener PC soll mit Autopilot neu aufgesetzt oder in die Verwaltung übernommen werden, steht aber nicht in der Autopilot-Geräteliste.

**Häufige Ursachen:** Der Händler hat die Kennung nicht hinterlegt, das Gerät wurde getauscht (Mainboard), das Skript läuft ohne Administratorrechte, die Exportdatei wurde nicht korrekt importiert.

## Lösung
1. PowerShell als Administrator starten.
2. Skript aus dem PowerShell-Katalog holen und ausführen:
```
Install-Script -Name Get-WindowsAutopilotInfo
Get-WindowsAutopilotInfo -Online
```
Mit `-Online` wird die Kennung direkt in den Tenant hochgeladen (Anmeldung mit passendem Administratorkonto, Zustimmung zu Berechtigungen nötig). Ein Bestätigungsdialog zur Skriptinstallation kann erscheinen.
3. Alternativ als Datei exportieren:
```
Get-WindowsAutopilotInfo -OutputFile C:\Temp\hash.csv
```
Datei im Intune-Portal im Bereich der Autopilot-Geräte importieren (Bezeichnung je nach Stand des Portals).
4. Nach dem Import einige Minuten warten, bis das Gerät in der Liste steht, und Profil zuweisen.
5. Ist das Gerät bereits in Intune registriert, vor dem Zurücksetzen den alten Eintrag beachten, sonst entstehen Dubletten.

**Achtung:** Das anschließende Zurücksetzen löscht alle lokalen Daten. Vorher Daten sichern (OneDrive-Stand prüfen) und Lizenzschlüssel notieren.

## Wenn das nicht hilft
- Skript über Installationsfehler prüfen (Ausführungsrichtlinie, TLS, Proxy).
- Für das Ticket notieren: Seriennummer, Fehlermeldung, verwendetes Konto.

=== ARTIKEL
titel: Entra-Beitritt, Hybrid-Beitritt oder nur registriert – Unterschiede
bereich: Geräteverwaltung & Softwareverteilung
tags: entra join, hybrid join, registriert, azure ad, domäne, dsregcmd, beitritt, workplace join
zielgruppe: technik
---
**Symptom:** Für neue oder bestehende Geräte muss entschieden werden, wie sie mit Entra ID verbunden werden. Oder es ist unklar, in welchem Zustand ein Gerät gerade ist.

**Häufige Ursachen:** Vermischung der Begriffe, private Geräte versehentlich beigetreten, Hybrid-Beitritt ohne vorhandenes Active Directory geplant.

## Lösung
1. Die drei Zustände unterscheiden:
   - **Entra-beigetreten:** Gerät gehört der Firma, Anmeldung mit dem Firmenkonto, keine Domäne nötig. Standard für neue Geräte im Kleinbetrieb.
   - **Hybrid-beigetreten:** Gerät ist Mitglied der lokalen Domäne und zusätzlich in Entra ID. Sinnvoll, wenn Server, Gruppenrichtlinien oder Dateifreigaben mit Domänenanmeldung weiter gebraucht werden. Erfordert Synchronisierung (Entra Connect) und Einrichtung.
   - **Entra-registriert:** Privates oder fremdes Gerät mit einem Konto für Apps. Nur eingeschränkte Verwaltung, kein Firmenzugriff auf das ganze Gerät.
2. Zustand am Gerät prüfen: Eingabeaufforderung öffnen, `dsregcmd /status` eingeben. Wichtig sind die Zeilen `AzureAdJoined`, `DomainJoined` und `WorkplaceJoined`.
3. Entscheidungshilfe: Keine Server-Abhängigkeit → Entra-Beitritt. Bestehendes AD mit vielen Richtlinien → Hybrid, mittelfristig Ablösung planen. Privatgeräte → registrieren oder nur App-Schutz.
4. Wechsel zwischen Zuständen erfordert in der Regel Zurücksetzen oder erneuten Beitritt. Daten vorher sichern.

## Wenn das nicht hilft
- Dateifreigaben per Kerberos prüfen, bevor ein Entra-Beitritt erfolgt.
- Für das Ticket notieren: Ausgabe von `dsregcmd /status`, Gerätename, geplantes Ziel.

=== ARTIKEL
titel: Anwendungen über Intune verteilen (Microsoft 365 Apps, Store, Win32)
bereich: Geräteverwaltung & Softwareverteilung
tags: intune, apps, software verteilen, win32, microsoft store, office, installation, zuweisung
zielgruppe: technik
---
**Symptom:** Programme sollen auf mehreren Geräten ohne Handinstallation landen, oder eine Zuweisung kommt nicht an.

**Häufige Ursachen:** Falsche Zuweisungsart (verfügbar statt erforderlich), Gruppe enthält Benutzer statt Geräte, fehlerhafte Erkennungsregel, Paket unpassend zur Prozessorarchitektur.

## Lösung
1. Appart wählen:
   - **Microsoft 365 Apps:** eingebaute App-Art mit Auswahl der Programme, Architektur und Updatekanal.
   - **Microsoft Store (neuer Store-Eintrag):** für Programme, die dort angeboten werden. Aktualisiert sich meist selbst.
   - **Win32-App:** für MSI und EXE, als .intunewin-Paket verpackt (siehe Artikel zu Installationspaketen).
2. App im Intune-Portal anlegen und Pflichtangaben ausfüllen. Bei Win32: Installations- und Deinstallationsbefehl, Erkennungsregel, Voraussetzungen.
3. Zuweisung festlegen: **Erforderlich** installiert automatisch, **Verfügbar** erscheint im Unternehmensportal, **Deinstallieren** entfernt die App.
4. Zuerst nur der Pilotgruppe zuweisen, dann allen Geräten.
5. Installationsstatus pro Gerät prüfen. Gerät bei Bedarf synchronisieren.
6. Lokale Protokolle für Win32-Apps: `C:\ProgramData\Microsoft\IntuneManagementExtension\Logs`.

## Hintergrund
Win32-Apps werden von der Intune-Verwaltungserweiterung auf dem Gerät installiert. Fehlt diese, ist der Dienst `IntuneManagementExtension` zu prüfen.

## Wenn das nicht hilft
- Installationsbefehl lokal als SYSTEM-Konto testen.
- Für das Ticket notieren: App-Name, Zuweisung, Gerät, Fehler im Portal und Auszug aus dem Protokoll.

=== ARTIKEL
titel: Software mit winget installieren und aktuell halten
bereich: Geräteverwaltung & Softwareverteilung
tags: winget, paketmanager, installieren, upgrade, software aktualisieren, windows paketmanager, silent
zielgruppe: technik
---
**Symptom:** Programme sollen schnell und einheitlich installiert oder aktualisiert werden, ohne Setup-Dateien einzeln zu suchen.

**Häufige Ursachen:** winget fehlt auf älteren Windows-10-Ständen, Quelle nicht erreichbar, Ausführung im SYSTEM-Kontext funktioniert anders als im Benutzerkontext, Programme wurden anders installiert und werden nicht erkannt.

## Lösung
1. Prüfen, ob winget vorhanden ist: Eingabeaufforderung öffnen und `winget --version` eingeben.
2. Paket suchen: `winget search 7zip`. Die genaue Kennung (ID) in der Ausgabe notieren.
3. Installieren mit fester Kennung und ohne Rückfragen:
```
winget install --id 7zip.7zip -e --silent --accept-package-agreements --accept-source-agreements
```
4. Verfügbare Aktualisierungen anzeigen: `winget upgrade`.
5. Alle Programme aktualisieren: `winget upgrade --all --silent`. Nicht erkannte Programme bleiben unberührt.
6. Zum Verteilen über Intune ein PowerShell-Skript oder eine App-Art verwenden und vorher prüfen, ob der Aufruf im Systemkontext funktioniert. Bezeichnung und Verfahren je nach Stand von Intune.

**Achtung:** `upgrade --all` kann Programme auf Hauptversionen anheben und Fachanwendungen brechen. Fachsoftware vorher ausnehmen und erst an einem Testgerät prüfen.

## Hintergrund
winget nutzt Paketquellen, die nicht jede Firmensoftware abdecken. Fachprogramme brauchen weiterhin eigene Pakete.

## Wenn das nicht hilft
- `winget source update` ausführen und Internet/Proxy prüfen.
- Für das Ticket notieren: Befehl, Ausgabe, Windows-Version, Benutzer- oder Systemkontext.

=== ARTIKEL
titel: Update-Ringe für Windows – Qualitätsupdates gestaffelt ausrollen
bereich: Geräteverwaltung & Softwareverteilung
tags: update-ring, windows update for business, qualitätsupdate, pilot, verzögerung, neustart, frist
zielgruppe: technik
---
**Symptom:** Windows-Updates sollen nicht alle Geräte gleichzeitig treffen, damit ein fehlerhaftes Update nicht den ganzen Betrieb lahmlegt.

**Häufige Ursachen:** Nur ein einziger Ring für alle Geräte, zu kurze oder gar keine Fristen, Neustarts zu Arbeitszeiten, Gerätegruppen nicht gepflegt.

## Lösung
1. Mindestens zwei Ringe planen: **Pilot** (2 bis 3 Geräte, auch IT) und **Produktiv** (übrige). Bei größerem Bestand einen mittleren Ring ergänzen.
2. Im Intune-Portal eine Richtlinie für Windows-Update-Ringe anlegen (Bezeichnung je nach Stand des Portals).
3. Wichtige Einstellungen:
   - Zurückstellung für Qualitätsupdates: Pilot 0 bis 2 Tage, Produktiv z. B. 5 bis 7 Tage.
   - Frist (Deadline) für die Installation und eine Karenzzeit bis zum erzwungenen Neustart.
   - Aktive Stunden oder Benachrichtigungen vor dem Neustart.
   - Treiberupdates über Windows Update zulassen oder ausschließen (siehe Artikel zu Treibern).
4. Gerätegruppen zuweisen. Überlappende Zuweisungen vermeiden, jedes Gerät gehört genau einem Ring an.
5. Nach dem Patchday im Pilotring beobachten, dann den Produktivring freigeben. Im Fehlerfall Rückstellung verlängern oder Updates pausieren.
6. Berichte zu Updatestand und Fehlschlägen kontrollieren.

**Achtung:** Ein Pausieren schützt nur zeitweise. Sicherheitsupdates nicht unbegrenzt aufschieben.

## Wenn das nicht hilft
- Auf dem Gerät prüfen, ob noch lokale Gruppenrichtlinien oder ein WSUS-Eintrag Vorrang haben.
- Für das Ticket notieren: Ring, Gerät, Updatestand, Fehlertext.

=== ARTIKEL
titel: Funktionsupdates steuern und Windows-11-Umstieg planen
bereich: Geräteverwaltung & Softwareverteilung
tags: funktionsupdate, windows 11, umstieg, 24h2, tpm, hardware-voraussetzung, windows 10 ende
zielgruppe: technik
---
**Symptom:** Geräte sollen kontrolliert auf eine bestimmte Windows-Version gehoben werden, oder alte Windows-10-Geräte müssen auf Windows 11 umgestellt werden.

**Häufige Ursachen:** Hardware erfüllt die Anforderungen nicht, Fachsoftware nicht freigegeben, Geräte springen unkontrolliert auf neue Versionen, Speicherplatz zu knapp.

## Lösung
1. Bestand erfassen: Welche Geräte laufen mit Windows 10, welche Edition und welche Version. Das Geräteinventar liefert die Liste.
2. Eignung prüfen: Windows 11 verlangt unter anderem TPM 2.0, Secure Boot, einen unterstützten Prozessor und ausreichend Arbeitsspeicher und Speicher. Im Intune-Bericht zur Eignung (Bezeichnung je nach Stand) oder lokal mit dem Herstellertool prüfen.
3. Fachsoftware beim Hersteller auf Windows-11-Freigabe prüfen.
4. Richtlinie für Funktionsupdates anlegen: Zielversion festlegen. Geräte bleiben dann auf dieser Version, bis die Richtlinie geändert wird.
5. Zuerst Pilotgruppe, dann Rest. Datensicherung und freien Speicherplatz vorab kontrollieren.
6. Nicht geeignete Geräte ersetzen. Der Support für Windows 10 ist beendet, weiterer Betrieb nur mit erweiterten Sicherheitsupdates nach den Bedingungen des Herstellers. Mit dem Kunden Ersatzplan und Budget abstimmen.

**Achtung:** Funktionsupdates dauern länger und starten mehrfach neu. Nicht im laufenden Betrieb der Hauptzeit ausrollen.

## Wenn das nicht hilft
- Hardware-Prüfung wiederholen, BIOS-Einstellungen für TPM und Secure Boot kontrollieren.
- Für das Ticket notieren: Gerät, Modell, Prüfergebnis, Fehlertext.

=== ARTIKEL
titel: Treiber- und Firmware-Updates kontrolliert verteilen
bereich: Geräteverwaltung & Softwareverteilung
tags: treiber, firmware, bios, driver update, intune, windows update, hersteller
zielgruppe: technik
---
**Symptom:** Treiber sollen aktuell sein, aber ein unkontrolliertes Update hat schon einmal Bildschirm, WLAN oder Drucker gestört.

**Häufige Ursachen:** Treiber kommen automatisch über Windows Update, unterschiedliche Modelle ohne Pflege, BIOS-Update ohne Vorbereitung, kein Testgerät.

## Lösung
1. Entscheiden, wie Treiber kommen sollen: automatisch über Windows Update, per Freigabe über Intune oder über Herstellerwerkzeug (je nach Hersteller).
2. In Intune gibt es Richtlinien für Treiber- und Firmwareupdates. Dort lassen sich Treiber prüfen, genehmigen oder zurückhalten (Bezeichnung und Lizenzvoraussetzung je nach Stand des Portals prüfen).
3. Alternativ im Update-Ring die Treiberupdates über Windows Update ausschließen und Treiber nur bewusst verteilen.
4. Gerätemodelle in Gruppen gliedern, damit Treiber nur zum passenden Modell kommen.
5. Neuen Treiber zuerst auf einem Pilotgerät testen: Netzwerk, Anzeige, Ton, Docking, Drucken.
6. Bei Problemen im Geräte-Manager den Treiber zurücksetzen (Eigenschaften → Treiber → Vorheriger Treiber).

**Achtung:** Ein BIOS- oder Firmwareupdate darf nicht unterbrochen werden. Notebook am Netzteil lassen, BitLocker-Wiederherstellungsschlüssel vorher sicherstellen (er kann nach Firmwareänderung abgefragt werden).

## Wenn das nicht hilft
- Treiber über das Herstellerpaket manuell installieren und Modell-Dokumentation zur Hilfe nehmen.
- Für das Ticket notieren: Modell, Treiberversion vor und nach dem Update, Symptom.

=== ARTIKEL
titel: Konfigurationsprofile in Intune – Einstellungen zentral setzen
bereich: Geräteverwaltung & Softwareverteilung
tags: konfigurationsprofil, einstellungskatalog, settings catalog, richtlinie, intune, vorlagen, zuweisung
zielgruppe: technik
---
**Symptom:** Einstellungen wie Sperrbildschirm, Edge-Startseite oder Energieoptionen sollen auf vielen Geräten einheitlich gesetzt werden. Eine Einstellung greift nicht oder widerspricht einer anderen.

**Häufige Ursachen:** Mehrere Profile setzen dieselbe Einstellung, falsche Zuweisung (Benutzer statt Gerät), Gerät hat noch nicht synchronisiert, Einstellung gilt nur für bestimmte Editionen.

## Lösung
1. Im Intune-Portal ein neues Konfigurationsprofil für Windows 10 und höher anlegen. Profiltyp **Einstellungskatalog** (Settings Catalog) ist für neue Vorhaben meist die beste Wahl, da er die meisten Einstellungen enthält. Bezeichnung je nach Stand des Portals.
2. Einstellungen per Suche hinzufügen und Wert festlegen. Sprechenden Namen vergeben, z. B. mit Bereich und Zweck.
3. Zuweisung an eine Gerätegruppe (für Gerätebereich) oder Benutzergruppe (für Benutzerbereich) vornehmen. Erst Pilotgruppe, dann alle.
4. Auf dem Gerät Synchronisierung anstoßen und Wirkung prüfen.
5. Im Portal den Status des Profils kontrollieren: erfolgreich, Konflikt, Fehler.
6. Konflikte lösen: Dieselbe Einstellung nur in einem Profil setzen.

## Hintergrund
Ein Profil ändert nur das, was ausdrücklich konfiguriert ist. Nicht konfigurierte Einstellungen bleiben unberührt, Entfernen eines Profils setzt Einstellungen je nach Art nicht immer auf den alten Wert zurück.

## Wenn das nicht hilft
- Bericht zu den Geräten mit Fehler öffnen und Einstellung einzeln prüfen.
- Für das Ticket notieren: Profilname, Gerät, Status, Einstellung mit Konflikt.

=== ARTIKEL
titel: Windows LAPS – lokale Administratorkennwörter automatisch verwalten
bereich: Geräteverwaltung & Softwareverteilung
tags: laps, lokales admin-kennwort, windows laps, rotation, entra id, notfallkonto, administrator
zielgruppe: technik
---
**Symptom:** Auf allen PCs gibt es dasselbe lokale Administratorkennwort, oder das lokale Konto wird nie geändert.

**Häufige Ursachen:** Gleiches Kennwort aus dem Abbild, Notfallkonto ohne Dokumentation, Richtlinie nicht zugewiesen, Gerät nicht in der Cloud verwaltet.

## Lösung
1. Voraussetzung: aktuelles Windows 10/11 mit Windows LAPS (in den Updates seit 2023 enthalten). Speicherort wählen: Entra ID für entra-beigetretene Geräte, lokales Active Directory für domänenbeigetretene.
2. Für die Speicherung in Entra ID im Tenant die LAPS-Funktion aktivieren (Einstellung in den Geräteeinstellungen, Bezeichnung je nach Stand des Portals).
3. In Intune eine LAPS-Richtlinie anlegen (üblicherweise im Bereich Endpoint Security → Kontoschutz, Bezeichnung je nach Stand). Festlegen: Sicherungsziel, Kontoname, Kennwortlänge und Komplexität, Alter vor Wechsel.
4. Ein eigenes lokales Notfallkonto verwenden, nicht das eingebaute Administratorkonto, sofern das Verfahren das vorsieht, und Verwaltung durch LAPS aktivieren.
5. Zuweisung an eine Gerätegruppe, erst Pilot.
6. Kennwort bei Bedarf im Portal beim Gerät abrufen. Der Zugriff ist rollenbasiert und wird protokolliert. Nach Nutzung Rotation auslösen.

**Achtung:** Vor dem Aktivieren sicherstellen, dass mindestens ein weiteres Administratorkonto funktioniert, sonst droht Aussperrung.

## Wenn das nicht hilft
- Ereignisprotokoll zu LAPS auf dem Gerät prüfen und Richtlinienstatus vergleichen.
- Für das Ticket notieren: Gerät, Sicherungsziel, Richtlinienstatus, Fehlertext.

=== ARTIKEL
titel: Lokale Administratoren zentral festlegen (Entra-beigetretene Geräte)
bereich: Geräteverwaltung & Softwareverteilung
tags: lokale administratoren, admin rechte, entra join, gruppe administratoren, intune, rechte entziehen
zielgruppe: technik
---
**Symptom:** Mitarbeiter haben Administratorrechte auf ihrem PC, oder ein Techniker bekommt auf neuen Geräten keine Administratorrechte.

**Häufige Ursachen:** Der erste Anmelder wird bei Entra-Beitritt ohne passende Einstellung zum Administrator, Standardregeln wurden nie angepasst, Änderungen kommen nicht an, weil das Gerät nicht synchronisiert.

## Lösung
1. Ist-Zustand prüfen: Auf dem Gerät in der Eingabeaufforderung `net localgroup Administratoren` ausführen (bei englischem Windows `Administrators`).
2. Beim Autopilot-Profil die Benutzerkontoart auf **Standardbenutzer** setzen, damit der Anmelder kein Administrator wird.
3. Im Entra-Tenant legt die Einstellung zu den Geräten fest, ob Benutzer lokale Administratoren werden und welche Rollen auf allen beigetretenen Geräten Administratorrechte haben (Bezeichnung je nach Stand des Portals).
4. Gezielte Mitglieder pro Gerätegruppe über eine Intune-Richtlinie für lokale Benutzergruppen festlegen (Bereich Endpoint Security → Kontoschutz, Bezeichnung je nach Stand). Dabei hinzufügen, ersetzen oder entfernen wählen.
5. Techniker über eine Gruppe oder Rolle berechtigen, nicht über Einzelkonten.
6. Wirkung nach Synchronisierung und Neuanmeldung prüfen.

**Achtung:** Beim Ersetzen der Mitglieder werden vorhandene Einträge entfernt. Vorher sicherstellen, dass ein Notfallweg (LAPS-Konto oder Technikergruppe) bestehen bleibt.

## Wenn das nicht hilft
- Richtlinienstatus und Konflikte im Portal prüfen, Gerät neu anmelden.
- Für das Ticket notieren: Gerät, Ausgabe von `net localgroup Administratoren`, Richtlinienname.

=== ARTIKEL
titel: Microsoft Defender for Business – Geräte einbinden
bereich: Geräteverwaltung & Softwareverteilung
tags: defender for business, onboarding, endpoint, virenschutz, edr, intune, sicherheitsportal
zielgruppe: technik
---
**Symptom:** Neue oder bestehende Geräte erscheinen nicht im Defender-Portal, oder ihr Zustand wird als nicht eingebunden angezeigt.

**Häufige Ursachen:** Lizenz nicht zugewiesen, Verbindung zwischen Intune und Defender nicht aktiviert, Geräte ohne Verwaltung, Fremdvirenschutz noch installiert, Onboarding-Richtlinie keiner Gruppe zugewiesen.

## Lösung
1. Lizenz prüfen: Der Dienst muss im Tenant lizenziert sein, die Benutzer brauchen die passende Lizenz (Lizenzstand im Admin-Center einsehen).
2. Im Defender-Portal die Einrichtung abschließen und die Verbindung mit Intune aktivieren (Bezeichnung je nach Stand des Portals), damit Geräte automatisch eingebunden werden können.
3. Bei in Intune verwalteten Geräten eine Richtlinie zur Einbindung (Onboarding) anlegen und einer Gerätegruppe zuweisen (Bereich Endpoint Security → Endpunkterkennung und -antwort, Bezeichnung je nach Stand).
4. Für nicht verwaltete Geräte das Einbindungspaket aus dem Portal herunterladen und lokal als Administrator ausführen.
5. Nach einigen Minuten bis Stunden im Geräteinventar des Defender-Portals prüfen, ob das Gerät erscheint und die Integritätsmeldung „aktiv“ zeigt.
6. Einrichtungsrichtlinien für Virenschutz, Firewall und Angriffsflächenreduzierung getrennt zuweisen.

**Achtung:** Läuft noch ein Fremdvirenschutz, vor der Umstellung Wechsel planen, damit nicht zwei Produkte gleichzeitig scannen.

## Wenn das nicht hilft
- Auf dem Gerät `Get-MpComputerStatus` in PowerShell prüfen und Dienststatus kontrollieren.
- Für das Ticket notieren: Gerät, Lizenzstand, Richtlinienstatus, Fehlertext.

=== ARTIKEL
titel: Regeln zur Verringerung der Angriffsfläche – Überblick und vorsichtige Einführung
bereich: Geräteverwaltung & Softwareverteilung
tags: asr, angriffsfläche, attack surface reduction, defender, makros, überwachungsmodus, ausnahmen
zielgruppe: technik
---
**Symptom:** Ein Kunde möchte Schutzregeln gegen Makro-Schadcode, Skriptmissbrauch und Programmstarts aus E-Mails aktivieren, ohne den Arbeitsablauf zu stören.

**Häufige Ursachen:** Regeln werden ohne Testphase blockierend gesetzt, Fachanwendungen oder Makros werden dadurch gestoppt, Ausnahmen fehlen, Anwender melden Störungen ohne Hinweis auf die Regel.

## Lösung
1. Die Regeln sind Teil von Defender und lassen sich in Intune über Endpoint-Security-Richtlinien zur Angriffsflächenreduzierung setzen (Bezeichnung je nach Stand des Portals).
2. Pro Regel stehen mehrere Modi zur Verfügung, üblicherweise Nicht konfiguriert, Überwachen (Audit), Blockieren und Warnen. Mit **Überwachen** beginnen.
3. Eine Pilotgruppe mit typischen Anwendern auswählen und zwei bis vier Wochen im Überwachungsmodus laufen lassen.
4. Ereignisse auswerten: im Defender-Portal oder lokal in der Ereignisanzeige unter Microsoft → Windows → Windows Defender → Operational. Betroffene Programme und Pfade notieren.
5. Ausnahmen für nachweislich benötigte Programme eintragen, so eng wie möglich (Datei oder Pfad, nicht ganze Laufwerke).
6. Regeln einzeln auf **Blockieren** oder **Warnen** stellen, nicht alle gleichzeitig.
7. Nach Umstellung Rückmeldungen der Anwender einsammeln.

**Achtung:** Blockierende Regeln können Fachsoftware lahmlegen. Rückweg bereithalten: Regel wieder auf Überwachen stellen.

## Wenn das nicht hilft
- Bei unklarer Blockade das Ereignis mit Regelkennung suchen und Regel gezielt zurücknehmen.
- Für das Ticket notieren: Regel, Programm, Pfad, Zeitpunkt, Ereignistext.

=== ARTIKEL
titel: Windows Hello for Business einführen – Voraussetzungen und Ablauf
bereich: Geräteverwaltung & Softwareverteilung
tags: windows hello, pin, biometrie, anmeldung, tpm, kennwortlos, whfb, gesicht
zielgruppe: technik
---
**Symptom:** Die Anmeldung per Kennwort soll durch PIN, Fingerabdruck oder Gesicht ersetzt werden. Beim Einrichten erscheint kein Angebot oder die PIN-Einrichtung scheitert.

**Häufige Ursachen:** Gerät ohne TPM oder Kamera/Sensor, Gerät nicht beigetreten, Richtlinie nicht zugewiesen, Mehrfaktor-Anmeldung noch nicht eingerichtet, Konflikt mit lokalen Richtlinien.

## Lösung
1. Voraussetzungen prüfen: Entra-beigetretenes oder hybrid-beigetretenes Gerät, TPM (empfohlen 2.0), Mehrfaktor-Anmeldung für das Konto vorhanden.
2. In Intune die Richtlinie für Windows Hello for Business setzen, entweder auf Tenant-Ebene (Registrierungseinstellungen) oder als Richtlinie für Geräte (Bezeichnung je nach Stand des Portals). Festlegen: aktivieren, PIN-Länge und Komplexität, Biometrie erlauben, TPM verlangen.
3. Bei Hybridgeräten zusätzlich die passende Vertrauensart wählen. Mit Cloud-Kerberos-Vertrauen lassen sich lokale Ressourcen ohne aufwendige Zertifikatsinfrastruktur erreichen. Bezeichnung und Voraussetzungen im aktuellen Herstellerleitfaden prüfen.
4. An Pilotgruppe zuweisen.
5. Am Gerät anmelden. Windows bietet nach der ersten Anmeldung die PIN-Einrichtung an, danach optional Fingerabdruck oder Gesicht (Einstellungen → Konten → Anmeldeoptionen).
6. Anwender in kurzem Ablauf einweisen: Die PIN gilt nur am Gerät.

## Wenn das nicht hilft
- Ereignisprotokoll Hello for Business auf dem Gerät und `dsregcmd /status` (Zeile `NgcSet`) prüfen.
- Für das Ticket notieren: Gerät, Beitrittsart, TPM-Stand, Meldung bei der Einrichtung.

=== ARTIKEL
titel: Kiosk- und Einzel-App-Modus für Empfang oder Werkstatt einrichten
bereich: Geräteverwaltung & Softwareverteilung
tags: kiosk, einzel-app, assigned access, empfang, werkstatt, gesperrter pc, autostart
zielgruppe: technik
---
**Symptom:** Ein PC am Empfang, in der Werkstatt oder als Stempeluhr soll nur ein Programm oder eine Webseite zeigen und nicht für anderes nutzbar sein.

**Häufige Ursachen:** Anmeldung mit normalem Konto, Programm ist keine geeignete App, Neustart bricht aus dem Kiosk aus, Verlassen der App nicht abgesichert.

## Lösung
1. Zweck festlegen: ein Programm (Einzel-App) oder mehrere (Mehr-App), oder eine Webseite im Edge-Kiosk.
2. In Intune ein Konfigurationsprofil für den Kioskmodus anlegen (Vorlage Kiosk oder Einstellungskatalog zum zugewiesenen Zugriff, Bezeichnung je nach Stand).
3. Ein eigenes lokales Benutzerkonto für den Kiosk festlegen oder automatisch erstellen lassen, mit automatischer Anmeldung, wenn es das Profil anbietet.
4. App angeben: bei klassischen Programmen mit Pfad, bei Store-Apps mit Anwendungskennung, bei Webseiten mit der Adresse.
5. Zuweisung ausschließlich an die Gerätegruppe des Kiosks, nicht an Benutzergruppen.
6. Gerät neu starten, prüfen: Anmeldung, Start der App, Verhalten bei Beenden, Neustart, Netzwerkausfall.
7. Wartungszugang einplanen: ein separates Administratorkonto und die Möglichkeit, das Gerät aus dem Kioskmodus zu nehmen (Gerät aus der Zuweisungsgruppe entfernen).

**Achtung:** Zuweisung auf falsche Gruppe sperrt Arbeitsplätze. Zuerst an ein Testgerät, Notfallzugang vorher prüfen.

## Wenn das nicht hilft
- Profilstatus im Portal und ob die App für diesen Modus geeignet ist prüfen.
- Für das Ticket notieren: Gerät, Profil, App, Verhalten beim Start.

=== ARTIKEL
titel: Geräteinventar und Berichte in Intune nutzen
bereich: Geräteverwaltung & Softwareverteilung
tags: inventar, berichte, geräteliste, export, hardware, seriennummer, compliance, bestandsliste
zielgruppe: technik
---
**Symptom:** Für Budgetplanung, Lizenzprüfung oder Rückfragen wird eine Liste aller Geräte mit Modell, Seriennummer, Windows-Version und Zustand gebraucht.

**Häufige Ursachen:** Listen werden von Hand in Tabellen geführt und veralten, verwaiste Einträge verfälschen die Zahl, Geräte sind lange nicht synchronisiert.

## Lösung
1. Im Intune-Portal die Geräteübersicht öffnen (Bereich Geräte, Bezeichnung je nach Stand des Portals).
2. Spalten auswählen: Gerätename, Benutzer, Hersteller, Modell, Seriennummer, Betriebssystemversion, Konformität, letzte Synchronisierung. Verfügbare Spalten je nach Stand.
3. Filtern, z. B. nach Betriebssystem, Konformität oder alter Version.
4. Liste exportieren (CSV) und in der Dokumentation des Kunden ablegen.
5. In den Berichten Übersichten zu Updatestand, Konformität, App-Installationen und Fehlern ansehen (Bereich Berichte, Bezeichnung je nach Stand).
6. Für die Windows-11-Planung Hardware und Version aus der Liste nutzen.
7. Regelmäßig prüfen, ob Geräte seit sehr langer Zeit keine Verbindung hatten, und klären, ob sie noch existieren.

## Hintergrund
Das Inventar zeigt nur Geräte, die registriert sind. Nicht verwaltete Geräte fehlen und müssen anders erfasst werden. Die Daten sind Stand der letzten Synchronisierung und nicht in Echtzeit.

## Wenn das nicht hilft
- Gerät synchronisieren lassen und Daten erneut prüfen. Fehlen Felder, Gerätezustand und Registrierungsart kontrollieren.
- Für das Ticket notieren: Filter, Spalten, erwartete und angezeigte Anzahl.

=== ARTIKEL
titel: Gerät zurücksetzen – Zurücksetzen, Autopilot-Zurücksetzung, Neustart mit sauberem Windows
bereich: Geräteverwaltung & Softwareverteilung
tags: zurücksetzen, wipe, autopilot reset, neustart, fresh start, werkseinstellung, neu aufsetzen
zielgruppe: technik
---
**Symptom:** Ein PC soll für einen neuen Mitarbeiter vorbereitet oder wegen hartnäckiger Fehler neu aufgesetzt werden, ohne ihn per USB neu zu installieren.

**Häufige Ursachen:** Falsche Aktion gewählt, Daten nicht gesichert, Wiederherstellungsumgebung deaktiviert, Gerät offline, Zuweisung nach dem Zurücksetzen fehlt.

## Lösung
1. Aktion wählen (Gerät im Intune-Portal, Menü der Geräteaktionen, Bezeichnungen je nach Stand):
   - **Zurücksetzen (Wipe):** setzt Windows zurück und kann Registrierungsdaten behalten oder entfernen.
   - **Autopilot-Zurücksetzung:** entfernt persönliche Daten und Apps, behält Beitritt und Verwaltung, Gerät landet wieder beim Anmeldebildschirm. Windows-Wiederherstellungsumgebung muss aktiv sein.
   - **Neustart mit sauberem Windows (Fresh Start):** entfernt vom Hersteller vorinstallierte Zusatzsoftware, Verwaltung bleibt.
2. Daten sichern, OneDrive-Synchronisierung auf Fehler prüfen, lokale Daten außerhalb von OneDrive kopieren.
3. Gerät muss online sein. Aktion auslösen und Fortschritt im Portal beobachten.
4. Nach dem Zurücksetzen prüfen, ob Autopilot-Profil und Gruppen zugewiesen sind, damit die Einrichtung sauber durchläuft.
5. Lokal ohne Portal: Einstellungen → System → Wiederherstellung → PC zurücksetzen (Bezeichnung je nach Windows-Stand).

**Achtung:** Alle lokalen Daten gehen verloren. BitLocker-Schlüssel, Lizenzen und Fachsoftware-Zugänge vorher dokumentieren.

## Wenn das nicht hilft
- Läuft die Aktion nicht an, Gerät synchronisieren und Wiederherstellungsumgebung mit `reagentc /info` prüfen.
- Für das Ticket notieren: Gerät, gewählte Aktion, Zeit, Statusmeldung.

=== ARTIKEL
titel: Gerät ausmustern – abkoppeln, löschen, aus allen Portalen entfernen
bereich: Geräteverwaltung & Softwareverteilung
tags: ausmustern, entsorgen, gerät entfernen, retire, löschen, autopilot, entra, verkauf
zielgruppe: technik
---
**Symptom:** Ein PC wird verkauft, entsorgt oder ersetzt. Alte Geräte sollen nicht als Karteileichen in der Verwaltung stehen bleiben.

**Häufige Ursachen:** Gerät wird nur im Portal gelöscht und bleibt in Autopilot, Entra ID oder Defender bestehen, Daten nicht sicher entfernt, Lizenz und Gruppen nicht bereinigt.

## Lösung
1. Datenlage klären: Benötigte Daten sichern, Fachsoftware-Lizenz zurückgeben oder übertragen.
2. Geräteaktionen unterscheiden: **Außerbetriebnahme (Retire)** entfernt Firmendaten und Verwaltung, **Zurücksetzen (Wipe)** setzt das ganze Gerät zurück, **Löschen** entfernt nur den Eintrag im Portal.
3. Gerät zurücksetzen, solange es online ist (Wipe), und Ergebnis abwarten.
4. Eintrag in Intune löschen.
5. Autopilot-Eintrag entfernen, wenn das Gerät nicht mehr genutzt wird (sonst startet es bei der nächsten Einrichtung im Firmenprofil). Der Eintrag lässt sich teils erst nach dem Löschen des Intune-Geräts entfernen.
6. Gerät in Entra ID prüfen und löschen, falls es dort noch steht. BitLocker-Schlüssel vorher bei Bedarf sichern.
7. Im Defender-Portal Eintrag entfernen oder inaktiv lassen und Gruppenzugehörigkeiten bereinigen.
8. Bei Entsorgung Datenträger nach Vorgabe des Kunden vernichten oder sicher löschen und Nachweis ablegen.

**Achtung:** Gelöschte Entra-Einträge sind nicht ohne Weiteres wiederherstellbar. Erst löschen, wenn Gerät endgültig außer Betrieb ist.

## Wenn das nicht hilft
- Lässt sich ein Eintrag nicht löschen, auf abhängige Einträge und Rollenrechte prüfen.
- Für das Ticket notieren: Seriennummer, durchgeführte Schritte, Datum, Verbleib des Geräts.

=== ARTIKEL
titel: PowerShell-Skripte über Intune verteilen
bereich: Geräteverwaltung & Softwareverteilung
tags: powershell, skript, intune, platform scripts, systemkontext, 64-bit, einmalig
zielgruppe: technik
---
**Symptom:** Eine Einstellung oder Installation soll per Skript auf mehreren Geräten laufen. Das Skript läuft nicht, läuft nur einmal oder liefert andere Ergebnisse als lokal.

**Häufige Ursachen:** Falscher Kontext (System statt Benutzer), 32-Bit-Umgebung, Skript wartet auf Eingaben, Zuweisung an Benutzer statt Gerät, Skript läuft nur einmal je Version.

## Lösung
1. Skript vorher lokal testen, am besten im selben Kontext (als SYSTEM mit einem Prüfwerkzeug) und ohne Rückfragen oder Fenster.
2. Im Intune-Portal ein Skript für Windows anlegen (Bereich Skripte, Bezeichnung je nach Stand).
3. Optionen setzen: Ausführung im Anmeldekontext oder als System, Signaturprüfung, Ausführung in 64-Bit-PowerShell.
4. Zuweisung vornehmen, erst Pilotgruppe.
5. Ergebnis im Portal prüfen (erfolgreich oder fehlgeschlagen je Gerät).
6. Lokale Spur: `C:\ProgramData\Microsoft\IntuneManagementExtension\Logs`, Datei `IntuneManagementExtension.log`.
7. Soll ein Skript erneut laufen, Skript ändern und neu hochladen. Für wiederholte Prüfungen besser Korrekturskripte verwenden.
8. Ausgaben und Fehler im Skript selbst in eine Protokolldatei schreiben (z. B. unter `C:\ProgramData`), das erleichtert die Suche.

**Achtung:** Skripte laufen mit hohen Rechten und wirken auf alle zugewiesenen Geräte. Kennwörter nie im Klartext im Skript ablegen.

## Wenn das nicht hilft
- Dienst `IntuneManagementExtension` und Synchronisierung prüfen.
- Für das Ticket notieren: Skriptname, Kontext, Gerät, Ergebnis im Portal, Protokollauszug.

=== ARTIKEL
titel: Probleme automatisch erkennen und beheben lassen (Korrekturskripte in Intune)
bereich: Geräteverwaltung & Softwareverteilung
tags: korrekturskripte, remediation, proaktive korrekturen, erkennung, intune, selbstheilung, zeitplan
zielgruppe: technik
---
**Symptom:** Immer wieder dieselben Fehler an vielen Geräten (z. B. Dienst gestoppt, Ordner voll, Einstellung zurückgesetzt) müssen von Hand behoben werden.

**Häufige Ursachen:** Fehler tritt periodisch auf, es gibt keinen Zeitplan zur Prüfung, Skripte liefern falsche Rückgabewerte, Lizenzvoraussetzung nicht erfüllt.

## Lösung
1. Vorab Lizenzvoraussetzung für diese Funktion beim Hersteller prüfen (nicht in jeder Lizenz enthalten, Bezeichnung je nach Stand).
2. Zwei Skripte schreiben: ein **Erkennungsskript**, das den Zustand prüft, und ein **Korrekturskript**, das ihn behebt.
3. Rückgabewerte beachten: Das Erkennungsskript beendet sich mit Code 0, wenn alles in Ordnung ist, mit Code 1, wenn ein Problem vorliegt. Eine kurze Textausgabe erscheint im Bericht.
4. Beide Skripte lokal testen, am besten im selben Kontext, in dem sie laufen werden.
5. Im Intune-Portal ein Skriptpaar für Korrekturen anlegen und Kontext (System oder Benutzer) sowie 64-Bit-Ausführung wählen.
6. Zeitplan festlegen (einmalig, täglich, stündlich), Zuweisung an Pilotgruppe.
7. Berichte prüfen: Wie viele Geräte hatten das Problem, wie viele wurden behoben.
8. Nach Bewährung auf alle Geräte ausdehnen.

## Hintergrund
Typische Beispiele: Neustart-Rückstau erkennen, Zwischenspeicher leeren, Dienststartart setzen, Registrierungswert wiederherstellen.

**Achtung:** Korrekturen laufen automatisch und wiederholt. Keine löschenden Aktionen ohne gründlichen Test.

## Wenn das nicht hilft
- Ausgabe des Skripts im Bericht und lokale Protokolle auswerten.
- Für das Ticket notieren: Skriptpaar, Gerät, Rückgabewert, Zeitplan.

=== ARTIKEL
titel: Drucker ohne Druckserver bereitstellen – Überblick der Wege
bereich: Geräteverwaltung & Softwareverteilung
tags: drucker verteilen, universal print, ip-drucker, intune, ohne server, treiber, cloud-druck
zielgruppe: technik
---
**Symptom:** Der Kunde hat keinen Server mehr oder will keinen betreiben, die Drucker sollen aber auf allen Geräten verfügbar sein.

**Häufige Ursachen:** Treiber fehlen auf den Geräten, Drucker nicht per Cloud ansprechbar, Skript läuft im falschen Kontext, Drucker hat keine feste Adresse.

## Lösung
1. Weg wählen:
   - **Universal Print:** Cloud-Druckdienst von Microsoft. Setzt passende Lizenz und einen geeigneten Drucker oder einen Connector voraus (Voraussetzungen im aktuellen Herstellerleitfaden prüfen).
   - **Direkter IP-Druck per Skript:** Treiber, Anschluss und Drucker per PowerShell auf jedem Gerät anlegen.
   - **Herstellerlösung:** manche Druckerhersteller bieten eigene Cloud- oder Verwaltungsdienste.
2. Für den Skriptweg: Drucker mit fester IP oder Reservierung versehen.
3. Treiber im Treiberspeicher des Geräts bereitstellen, z. B. mit `pnputil /add-driver <inf-datei> /install`.
4. Anschluss und Drucker anlegen:
```
Add-PrinterPort -Name "IP_192.0.2.10" -PrinterHostAddress "192.0.2.10"
Add-Printer -Name "Empfang" -DriverName "<Treibername>" -PortName "IP_192.0.2.10"
```
Die Treiberbezeichnung muss exakt dem installierten Treiber entsprechen.
5. Skript als Systemskript über Intune verteilen, Pilot zuerst.
6. Standardwerte (beidseitig, Schwarzweiß) bei Bedarf separat setzen.

## Wenn das nicht hilft
- Treibername mit `Get-PrinterDriver` abgleichen, Port und Erreichbarkeit mit `Test-NetConnection` prüfen.
- Für das Ticket notieren: Druckermodell, IP, Treiber, Skriptausgabe.

=== ARTIKEL
titel: Startmenü und Taskleiste einheitlich vorgeben
bereich: Geräteverwaltung & Softwareverteilung
tags: startmenü, taskleiste, layout, angeheftet, windows 11, intune, vorgabe
zielgruppe: technik
---
**Symptom:** Auf allen PCs sollen dieselben Programme am Start und in der Taskleiste stehen, oder neue Geräte starten mit Werbekacheln und unpassenden Apps.

**Häufige Ursachen:** Layout wird nur beim ersten Anmelden angewendet, unterschiedliche Windows-Stände, Programmverknüpfung mit falschem Pfad, Anwender ändern es wieder.

## Lösung
1. Zielbild festlegen: Welche 5 bis 8 Programme sollen angeheftet sein (Office, Browser, Fachprogramm, Dateiexplorer).
2. Einstellungsmöglichkeiten sind von der Windows-Version abhängig. Unter Windows 11 gibt es Vorgaben für angeheftete Programme im Startmenü und Layoutdateien für die Taskleiste. Im Intune-Einstellungskatalog nach „Start“ und „Taskleiste“ suchen (Bezeichnung je nach Stand).
3. Layout in einer Datei beschreiben (JSON für Startmenü, XML für Taskleiste je nach Verfahren) oder die Einstellungen im Katalog setzen. Verknüpfungspfade und App-Kennungen genau angeben.
4. Anmeldung mit einem Testkonto auf einem Testgerät, Ergebnis prüfen.
5. Zuweisung als Konfigurationsprofil an Gerätegruppe.
6. Beachten: Je nach Verfahren erscheint die Vorgabe nur bei neuen Benutzerprofilen oder wird bei jeder Anmeldung erzwungen. Mit dem Kunden klären, ob Anwender selbst anpassen dürfen.
7. Dokumentieren, welche Programme bewusst fehlen.

## Wenn das nicht hilft
- Layoutdatei auf Syntax und Pfade prüfen, Gerät neu anmelden, ggf. neues Testprofil verwenden.
- Für das Ticket notieren: Windows-Version, Profilart, Datei, Ergebnis.

=== ARTIKEL
titel: WLAN- und VPN-Profile auf Windows-Geräte verteilen
bereich: Geräteverwaltung & Softwareverteilung
tags: wlan profil, vpn profil, intune, verbinden, firmen-wlan, always on, konfiguration
zielgruppe: technik
---
**Symptom:** Neue Geräte sollen sich ohne Handeingabe mit dem Firmen-WLAN verbinden, oder eine VPN-Verbindung soll vorkonfiguriert ankommen.

**Häufige Ursachen:** Netzname (SSID) oder Sicherheitsart falsch, Zertifikat fehlt, Profil wird nur dem Benutzer statt dem Gerät zugewiesen, Gerät ist beim Start noch nicht im Netz.

## Lösung
1. Netzdaten sammeln: SSID, Sicherheitsart (WPA2/WPA3 mit Schlüssel oder Unternehmensanmeldung), Anmeldeverfahren.
2. Im Intune-Portal ein Konfigurationsprofil für WLAN anlegen (Vorlage WLAN oder Einstellungskatalog, Bezeichnung je nach Stand). Bei einfachem Schlüssel Netzname und Schlüssel eintragen, bei Unternehmensnetzen Zertifikate bzw. Vertrauensstellung ergänzen.
3. Zuweisung an Gerätegruppe, damit das WLAN schon vor der Anmeldung zur Verfügung steht (wichtig für Autopilot).
4. Für VPN ein VPN-Profil mit Servername, Verbindungsart und Authentifizierung anlegen. Welche Art unterstützt wird, hängt von der Gegenstelle und dem Hersteller ab. Bei herstellereigenen Clients erst den Client verteilen, dann das Profil.
5. Auf einem Testgerät prüfen: Verbindung, Wiederverbindung nach Standby, Zugriff auf interne Ressourcen.
6. Pilotgruppe, dann alle.

**Achtung:** Der WLAN-Schlüssel steht im Profil. Bei Änderung des Schlüssels Profil rechtzeitig aktualisieren, sonst brechen Verbindungen ab. Zugriff auf das Profil nur für Administratoren.

## Wenn das nicht hilft
- Profilstatus im Portal prüfen und Verbindungsprotokolle des Geräts lesen.
- Für das Ticket notieren: SSID, Sicherheitsart, Gerät, Meldung bei der Verbindung.

=== ARTIKEL
titel: Zertifikate auf Geräte verteilen – Überblick der Möglichkeiten
bereich: Geräteverwaltung & Softwareverteilung
tags: zertifikat, scep, pkcs, vertrauenswürdig, stammzertifikat, intune, wlan zertifikat, cloud pki
zielgruppe: technik
---
**Symptom:** Geräte sollen einem internen Zertifikat vertrauen oder für WLAN, VPN oder Anmeldung ein eigenes Zertifikat erhalten.

**Häufige Ursachen:** Stammzertifikat fehlt, falscher Speicherort, keine Zertifizierungsstelle vorhanden, Verbindung zur Infrastruktur nicht möglich, abgelaufene Zertifikate.

## Lösung
1. Zweck klären: nur Vertrauen (Stamm- oder Zwischenzertifikat) oder auch Gerätezertifikat für Anmeldung.
2. **Vertrauenswürdiges Zertifikat:** Zertifikatsdatei (öffentlicher Teil, ohne privaten Schlüssel) in Intune als Konfigurationsprofil für vertrauenswürdige Zertifikate hochladen und Gerätegruppe zuweisen.
3. **Gerätezertifikate:** Ausstellung per SCEP oder PKCS. Beide brauchen eine Zertifizierungsstelle und meist Zusatzkomponenten (Connector, Registrierungsdienst), Intune bietet je nach Lizenz auch eine eigene Cloud-PKI an. Voraussetzungen im aktuellen Herstellerleitfaden prüfen.
4. Reihenfolge einhalten: erst Vertrauensprofil, dann SCEP- oder PKCS-Profil, zuletzt WLAN- oder VPN-Profil, das das Zertifikat nutzt.
5. Pilotgerät: Zertifikatsspeicher des Computers öffnen (`certlm.msc`) und Ausstellung sowie Gültigkeit prüfen.
6. Ablauf überwachen: Erneuerung und Ablaufdaten dokumentieren.

**Achtung:** Private Schlüssel und Exportdateien nie ungeschützt weitergeben. Eine Zertifizierungsstelle ist sicherheitskritisch und gehört in den Notfall- und Sicherungsplan.

## Wenn das nicht hilft
- Profilstatus, Zertifikatsspeicher und Protokolle von Connector und Gerät prüfen.
- Für das Ticket notieren: Zertifikatstyp, Profil, Gerät, Fehlerbild.

=== ARTIKEL
titel: Gruppenrichtlinien nach Intune überführen
bereich: Geräteverwaltung & Softwareverteilung
tags: gruppenrichtlinie, gpo, migration, group policy analytics, intune, einstellungskatalog, hybrid
zielgruppe: technik
---
**Symptom:** Das lokale Active Directory soll abgelöst oder entlastet werden, und die bisherigen Gruppenrichtlinien müssen in der Cloud nachgebildet werden.

**Häufige Ursachen:** Viele alte, undokumentierte Richtlinien, nicht jede Einstellung existiert in Intune, Hybridgeräte bekommen beide Richtlinienarten, Reihenfolge unklar.

## Lösung
1. Bestand erfassen: Richtlinien in der Gruppenrichtlinienverwaltung als Bericht (XML) exportieren, ungenutzte oder veraltete aussortieren.
2. Im Intune-Portal die Analyse von Gruppenrichtlinien nutzen: XML hochladen, es wird angezeigt, welche Einstellungen ein Gegenstück in Intune haben (Bezeichnung je nach Stand).
3. Unterstützte Einstellungen in ein Profil des Einstellungskatalogs überführen. Zur Hilfe kann die Analyse ein Profil erzeugen.
4. Nicht unterstützte Einstellungen anders lösen: Skript, Anwendungseinstellung, Sicherheitsbasis oder Verzicht.
5. Pilotgruppe zuweisen und mit `gpresult /r` bzw. dem Portalbericht prüfen, was tatsächlich wirkt.
6. Bei Hybridgeräten Konflikte beachten. Es gibt eine Einstellung, die entscheidet, ob Intune oder Gruppenrichtlinie bei Widerspruch gewinnt (Bezeichnung und Wirkung vorher nachlesen).
7. Erst wenn Intune alles abdeckt, Gruppenrichtlinie entfernen oder Gerät aus dem Bereich nehmen.

**Achtung:** Nicht beide Systeme ungeprüft parallel laufen lassen. Vorher Export der Richtlinien als Sicherung ablegen.

## Wenn das nicht hilft
- Einstellung einzeln betrachten, Wirkung auf einem Testgerät prüfen.
- Für das Ticket notieren: Richtlinienname, Einstellung, Ergebnis der Analyse, Ersatz.

=== ARTIKEL
titel: Abbild oder Autopilot – wann welches Verfahren
bereich: Geräteverwaltung & Softwareverteilung
tags: abbild, image, autopilot, neuinstallation, bereitstellung, vergleich, referenz-pc
zielgruppe: technik
---
**Symptom:** Für neue Geräte oder einen Austausch wird entschieden, ob ein eigenes Windows-Abbild gepflegt oder Autopilot genutzt wird.

**Häufige Ursachen:** Gewohnheit aus der Domänenzeit, Abbild veraltet sofort nach Windows-Updates, Fachsoftware lässt sich nicht automatisch installieren, keine Internetleitung beim Kunden.

## Lösung
1. Kriterien sammeln: Cloud-Verwaltung ja oder nein, Anzahl der Geräte, Verfügbarkeit der Leitung, Fachsoftware und Treiber, Aufwand für die Pflege.
2. **Autopilot** passt, wenn Geräte per Intune verwaltet werden: Das mitgelieferte Windows wird aktuell eingerichtet, Software und Einstellungen kommen aus der Cloud, kein Abbild zu pflegen. Voraussetzung ist eine gute Internetverbindung.
3. **Eigenes Abbild** passt, wenn kein Intune vorhanden ist, die Leitung schwach ist oder große Software lokal mitgegeben werden muss. Nachteile: Abbild muss regelmäßig neu gebaut werden, Treiber je Modell pflegen.
4. Mischform: schlankes Standard-Windows des Herstellers plus Autopilot für Einstellungen, große Fachsoftware ergänzend über Paket oder lokalen Installer.
5. Entscheidung dokumentieren und einheitlich anwenden.
6. Bei Autopilot zunächst mit einem Testgerät den gesamten Weg bis zum fertigen Arbeitsplatz durchspielen und Dauer notieren.

## Hintergrund
Ein Abbild friert einen Stand ein. Bei Autopilot entsteht der Stand bei jeder Einrichtung neu, was reproduzierbar bleibt, solange Pakete gepflegt werden.

## Wenn das nicht hilft
- Pilotgerät mit beiden Wegen aufsetzen und Aufwand vergleichen.
- Für das Ticket notieren: Geräteanzahl, Leitung, Fachsoftware, Entscheidung und Begründung.

=== ARTIKEL
titel: WSUS ablösen – Wege und Reihenfolge
bereich: Geräteverwaltung & Softwareverteilung
tags: wsus, ablösen, windows update for business, intune, serverupdates, update-server, migration
zielgruppe: technik
---
**Symptom:** Ein vorhandener WSUS-Server soll außer Betrieb genommen oder ersetzt werden, weil Geräte künftig über die Cloud verwaltet werden.

**Häufige Ursachen:** Clients zeigen weiter auf den alten Server, Gruppenrichtlinien widersprechen Intune-Update-Ringen, Serverupdates sind vergessen, Plattenplatz und Pflege des WSUS wurden vernachlässigt.

## Lösung
1. Bestandsaufnahme: Welche Geräte (Arbeitsplätze, Server) beziehen Updates vom WSUS, welche Gruppenrichtlinie setzt den Server.
2. Ersatz wählen: für Arbeitsplätze Windows Update for Business über Intune (Update-Ringe), für Server Windows Update, Azure Arc oder anderen Weg nach Bedarf. Die Weiterentwicklung von WSUS ist von Microsoft eingestellt, der Dienst wird aber weiter unterstützt. Aktuellen Stand beim Hersteller prüfen.
3. Update-Ringe in Intune anlegen und mit Pilotgruppe testen.
4. Auf Pilotgeräten die WSUS-Zuweisung per Richtlinie entfernen oder Geräte in eine Organisationseinheit ohne WSUS-Richtlinie verschieben. Auf Clients prüfen, dass kein Update-Server mehr eingetragen ist.
5. Gruppenweise umstellen, Updatestand im Bericht kontrollieren.
6. Server separat behandeln: Wartungsfenster, Neustartzeiten, Sicherung (siehe Server-Artikel).
7. Zum Schluss WSUS-Rolle erst nach einiger Wartezeit entfernen.

**Achtung:** Die Server-Rolle erst entfernen, wenn kein Gerät mehr darauf zeigt. Vorher Konfiguration und Gruppenrichtlinien notieren.

## Wenn das nicht hilft
- Auf einem Client in den Update-Einstellungen und im Gruppenrichtlinienergebnis prüfen, wohin das Gerät zeigt.
- Für das Ticket notieren: Gerätegruppe, Richtlinie, Updatestand, Fehlermeldung.

=== ARTIKEL
titel: Installationspakete vorbereiten – stille Installation und Parameter finden
bereich: Geräteverwaltung & Softwareverteilung
tags: silent install, stille installation, msi, exe, parameter, intunewin, paket, deinstallation
zielgruppe: technik
---
**Symptom:** Ein Programm soll ohne Klicks verteilt werden, aber der passende Schalter oder die Erkennungsregel ist unbekannt.

**Häufige Ursachen:** Unterschiedliche Installerarten, Neustart wird erzwungen, Programm fragt nach Eingaben, Erkennungsregel passt nicht, keine Deinstallationsroutine.

## Lösung
1. Installerart bestimmen: MSI (Windows Installer) oder EXE.
2. MSI: stille Installation mit `msiexec /i "paket.msi" /qn /norestart`. Eigene Eigenschaften werden als `NAME=Wert` angehängt, Namen stehen in der Herstellerdokumentation.
3. EXE: Schalter hängen vom Hersteller ab. Üblich sind `/S`, `/silent`, `/verysilent`, `/quiet`, aber nicht verbindlich. Hilfe über `setup.exe /?` oder `/help`, sonst Dokumentation des Herstellers.
4. Unter Test mit Administratorrechten ausprobieren, besser mit einem Prüfwerkzeug im Systemkontext, und Ergebnis beobachten.
5. Deinstallationsbefehl bestimmen, z. B. `msiexec /x {Produktcode} /qn` bei MSI (Produktcode aus dem Installationspaket oder der Deinstallationsliste).
6. Erkennungsregel festlegen: Produktcode, Datei mit Version oder Registrierungsschlüssel, der nach der Installation sicher existiert.
7. Für Intune mit dem Verpackungswerkzeug (`IntuneWinAppUtil.exe`) ein .intunewin-Paket erzeugen: Quellordner, Setupdatei, Zielordner angeben.
8. Pilotinstallation, Ergebnis und Protokoll prüfen.

**Achtung:** Pakete nur aus vertrauenswürdiger Quelle verwenden, Prüfsumme des Herstellers vergleichen, wenn angegeben.

## Wenn das nicht hilft
- Installation mit Protokoll starten (bei MSI `/l*v protokoll.log`) und Fehlerzeile auswerten.
- Für das Ticket notieren: Programm, Version, Schalter, Protokollauszug.

=== ARTIKEL
titel: Gerät synchronisiert nicht mit Intune – Fehleranalyse (z. B. mit dsregcmd /status)
bereich: Geräteverwaltung & Softwareverteilung
tags: intune, synchronisierung, sync, dsregcmd, gerät meldet sich nicht, prt, mdm, fehleranalyse
zielgruppe: technik
---
**Symptom:** Ein Gerät steht in Intune mit alter letzter Synchronisierung, erhält keine Richtlinien oder Apps, oder die Zuweisung kommt nicht an.

**Häufige Ursachen:** Gerät aus, ohne Netz oder mit falscher Uhrzeit, Beitrittsstatus defekt, Lizenz des Anwenders fehlt, Verwaltung durch Beschränkung blockiert, doppelter oder verwaister Geräteeintrag.

## Lösung
1. Netz und Uhrzeit des Geräts prüfen. Große Zeitabweichung stört die Anmeldung.
2. Auf dem Gerät Synchronisierung anstoßen: Einstellungen → Konten → Auf Arbeits- oder Schulkonto zugreifen → Konto auswählen → Info → Synchronisieren (Bezeichnung je nach Windows-Stand).
3. Beitrittsstatus mit `dsregcmd /status` prüfen. Relevante Zeilen: `AzureAdJoined`, `DomainJoined`, `AzureAdPrt` (Primary Refresh Token vorhanden), zusätzlich Hinweise im Abschnitt zur Diagnose. Ohne gültiges Token meldet sich das Konto nicht ordentlich an.
4. Ereignisprotokoll für Geräteverwaltung öffnen: Anwendungs- und Dienstprotokolle → Microsoft → Windows → DeviceManagement-Enterprise-Diagnostics-Provider → Admin. Fehlerereignisse zum Zeitpunkt notieren.
5. Im Portal prüfen: Anwenderlizenz, Gerätezustand, ob es doppelte Einträge zur Seriennummer gibt, Einschränkungen bei der Registrierung.
6. Konto am Gerät ab- und neu anmelden, Neustart durchführen.
7. Als letzter Schritt Beitritt trennen und erneut vornehmen, ggf. Gerät zurücksetzen.

**Achtung:** Das Trennen des Beitritts kann Benutzerprofil und lokale Daten betreffen. Vorher sichern, BitLocker-Schlüssel sicherstellen.

## Wenn das nicht hilft
- Mit dem Hersteller-Support Kontakt aufnehmen.
- Für das Ticket notieren: Ausgabe von `dsregcmd /status`, Ereigniseinträge, Gerätename und Seriennummer, Zeitpunkt der letzten Synchronisierung.
