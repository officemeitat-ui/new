=== ARTIKEL
titel: Neuen Benutzer in Microsoft 365 anlegen (Konto, Lizenz, Gruppen, MFA)
bereich: Microsoft 365 Administration
tags: benutzer anlegen, neuer mitarbeiter, onboarding, lizenz, mfa, postfach, konto
zielgruppe: technik
---
**Symptom:** Ein neuer Mitarbeiter braucht Konto, Postfach und Zugriff auf Teams, SharePoint und Co.

**Häufige Ursachen:** Es fehlen Angaben vom Kunden (Name, Eintrittsdatum, Gruppen) oder der Standort ist nicht gesetzt, dann lässt sich keine Lizenz zuweisen.

## Lösung
1. Vom Kunden holen: Vor- und Nachname, gewünschte E-Mail-Adresse, Abteilung, benötigte Gruppen und freigegebene Postfächer, Gerät.
2. **Microsoft 365 Admin Center → Benutzer → Aktive Benutzer → Benutzer hinzufügen** (Bezeichnung je nach Stand des Portals).
3. Name, Benutzername und Domäne eintragen. Kennwort automatisch erstellen lassen und die Option zum Ändern bei der ersten Anmeldung aktiv lassen.
4. Standort wählen (Österreich) und die passende Lizenz zuweisen. Ohne Standort ist keine Lizenzzuweisung möglich.
5. Rolle: **Kein Administratorzugriff** belassen.
6. Nach dem Anlegen den Benutzer öffnen und unter **Gruppen** die Mitgliedschaften setzen (Teams, Verteilerlisten, Sicherheitsgruppen). Freigegebene Postfächer separat berechtigen.
7. MFA: Die Registrierung erfolgt bei der ersten Anmeldung, wenn Sicherheitsstandards oder eine Richtlinie für bedingten Zugriff aktiv sind. Die Einzelbenutzer-MFA nicht neu einführen.
8. Postfach prüfen: Nach der Lizenzzuweisung kann es einige Minuten dauern. Im Exchange Admin Center unter **Empfänger → Postfächer** kontrollieren oder per `Get-Mailbox -Identity name@domain.at`.
9. Kennwort sicher an den Anwender übergeben, nicht per E-Mail.

## Wenn das nicht hilft
- Benutzername existiert schon (auch als Alias oder gelöschter Benutzer): im Papierkorb der Benutzer und unter den E-Mail-Adressen suchen.
- Ticket mit Benutzername, Lizenz und Fehlermeldung ergänzen.

=== ARTIKEL
titel: Benutzer beim Austritt deaktivieren – Ablauf Schritt für Schritt
bereich: Microsoft 365 Administration
tags: austritt, offboarding, benutzer sperren, postfach, onedrive, lizenz freigeben, weiterleitung
zielgruppe: technik
---
**Symptom:** Ein Mitarbeiter scheidet aus. Konto sperren, Daten erhalten, Lizenz einsparen.

**Häufige Ursachen:** Der Ablauf wird unvollständig durchgeführt, etwa Lizenz entfernt, bevor das Postfach umgewandelt wurde. Dann geht das Postfach nach der Karenzzeit verloren.

## Lösung
1. Zeitpunkt und Zuständigen für Postfach und OneDrive vom Kunden schriftlich bestätigen lassen.
2. **Microsoft 365 Admin Center → Benutzer → Aktive Benutzer →** Benutzer wählen → **Kennwort zurücksetzen** und **Anmeldung blockieren** (Bezeichnung je nach Stand).
3. **Alle Sitzungen abmelden** wählen. Alternativ Entra Admin Center → Benutzer → Sitzungen widerrufen oder `Revoke-MgUserSignInSession`.
4. Mobile Geräte und Anwendungen prüfen, MFA-Methoden bleiben bestehen.
5. Exchange Admin Center → **Empfänger → Postfächer →** In freigegebenes Postfach konvertieren, oder `Set-Mailbox -Identity name@domain.at -Type Shared`.
6. Zugriff für den Vorgesetzten per **Berechtigungen verwalten** vergeben. Eine Weiterleitung nur mit Zustimmung des Kunden einrichten.
7. OneDrive: Daten sichern oder Zugriff auf den Vorgesetzten geben (siehe eigener Artikel), bevor das Konto gelöscht wird.
8. Gruppen, Teams-Besitz und Verteilerlisten bereinigen, Besitz übertragen.
9. Erst danach die Lizenz entfernen. Ein freigegebenes Postfach bis 50 GB braucht keine Lizenz.

**Achtung:** Benutzer erst löschen, wenn OneDrive-Daten gesichert sind. Nach der Löschung bleibt das OneDrive nur für die eingestellte Aufbewahrungsdauer erhalten.

## Wenn das nicht hilft
- Ticket mit Austrittsdatum, Verantwortlichem und durchgeführten Schritten ergänzen.

=== ARTIKEL
titel: Kennwort zurücksetzen und MFA-Methoden neu registrieren lassen
bereich: Microsoft 365 Administration
tags: kennwort zurücksetzen, mfa, neues handy, authenticator, passwort vergessen, anmeldung
zielgruppe: technik
---
**Symptom:** Ein Anwender kennt das Kennwort nicht mehr oder hat ein neues Handy und kommt nicht an den zweiten Faktor.

**Häufige Ursachen:** Gerätewechsel ohne Übertragung des Authenticators, Kennwortablauf, Anwender gesperrt.

## Lösung
1. Identität des Anrufers prüfen, etwa per Rückruf auf die hinterlegte Nummer. Das ist Pflicht, bevor irgendetwas geändert wird.
2. **Microsoft 365 Admin Center → Benutzer → Aktive Benutzer →** Benutzer wählen → **Kennwort zurücksetzen**. Automatisches Kennwort erzeugen, Änderung bei der nächsten Anmeldung verlangen.
3. Für MFA: **Entra Admin Center → Identität → Benutzer →** Benutzer wählen → **Authentifizierungsmethoden** (Bezeichnung je nach Stand des Portals).
4. Alte Methoden (zum Beispiel die Authenticator-App des verlorenen Handys) löschen. Mit **Multi-Faktor-Authentifizierung erneut anfordern** wird bei der nächsten Anmeldung neu registriert, **MFA-Sitzungen widerrufen** erzwingt eine neue Anmeldung.
5. Ist ein Temporärer Zugriffspass in der Richtlinie der Authentifizierungsmethoden aktiviert, lässt sich damit die Neuregistrierung ohne alten Faktor durchführen.
6. Anwender die Neuregistrierung unter der Seite für Sicherheitsinformationen durchführen lassen und anschließend Anmeldung testen.

**Achtung:** Kennwörter nie per E-Mail oder Chat im Klartext senden.

## Wenn das nicht hilft
- Konto gesperrt oder Anmeldung blockiert: Status in Aktive Benutzer und Anmeldeprotokoll prüfen.
- Ticket mit Benutzername, Prüfmethode der Identität und durchgeführten Änderungen ergänzen.

=== ARTIKEL
titel: Lizenzen zuweisen und Lizenzübersicht prüfen
bereich: Microsoft 365 Administration
tags: lizenz, lizenzen, zuweisen, lizenzübersicht, microsoft 365 business, abrechnung
zielgruppe: technik
---
**Symptom:** Einem Benutzer fehlen Dienste (kein Postfach, keine Teams), oder die Lizenzen reichen nicht aus.

**Häufige Ursachen:** Lizenz nicht zugewiesen, kein Standort gesetzt, alle gekauften Lizenzen bereits vergeben.

## Lösung
1. **Microsoft 365 Admin Center → Abrechnung → Lizenzen** öffnen (Bezeichnung je nach Stand). Dort stehen je Produkt: gekauft, zugewiesen, verfügbar.
2. Einzelne Zuweisung: **Benutzer → Aktive Benutzer →** Benutzer wählen → **Lizenzen und Apps**. Standort setzen, Lizenz anhaken, Speichern.
3. Einzelne Dienste einer Lizenz lassen sich abwählen (zum Beispiel Teams). Nur nach Absprache, damit später keine Überraschungen entstehen.
4. Mehrere Benutzer: in der Lizenzübersicht das Produkt öffnen und Benutzer hinzufügen.
5. Gruppenbasierte Lizenzierung: **Entra Admin Center → Gruppen →** Gruppe → **Lizenzen**. Verfügbar nur mit passender Lizenz (je nach Abonnement prüfen).
6. Ungenutzte Lizenzen finden: Aktive Benutzer nach Lizenzstatus filtern, gesperrte Benutzer mit Lizenz sind Kandidaten. Mit PowerShell: `Connect-MgGraph -Scopes "Organization.Read.All"` und `Get-MgSubscribedSku`.
7. Fehlen Lizenzen, Kunden informieren. Zukauf läuft über die Abrechnung und kostet ab sofort anteilig.

## Wenn das nicht hilft
- Meldung bei der Zuweisung: Standort fehlt oder Lizenzkonflikt (zum Beispiel zwei Pakete mit gleichem Dienst). Eines der Pakete entfernen.
- Ticket mit Benutzername, Lizenz und genauer Meldung ergänzen.

=== ARTIKEL
titel: Freigegebenes Postfach anlegen und Berechtigungen vergeben
bereich: Microsoft 365 Administration
tags: freigegebenes postfach, shared mailbox, info@, vollzugriff, senden als, berechtigung
zielgruppe: technik
---
**Symptom:** Ein Team braucht eine gemeinsame Adresse wie office@ oder info@, die mehrere Personen lesen und beantworten.

**Häufige Ursachen:** Statt eines freigegebenen Postfachs wurde ein normaler Benutzer mit Lizenz angelegt, oder die Berechtigung „Senden als“ fehlt.

## Lösung
1. **Microsoft 365 Admin Center → Teams & Gruppen → Freigegebene Postfächer → Postfach hinzufügen** (Bezeichnung je nach Stand). Alternativ Exchange Admin Center → **Empfänger → Postfächer → Freigegebenes Postfach hinzufügen**.
2. Name und E-Mail-Adresse eintragen, anlegen.
3. Mitglieder hinzufügen. Dadurch erhalten sie **Lesen und Verwalten** (Vollzugriff).
4. **Senden als** oder **Senden im Auftrag** separat im Exchange Admin Center über das Postfach → **Berechtigungen verwalten** vergeben.
5. Per PowerShell nach `Connect-ExchangeOnline`:

```
New-Mailbox -Shared -Name "Office" -PrimarySmtpAddress office@domain.at
Add-MailboxPermission -Identity office@domain.at -User anna@domain.at -AccessRights FullAccess -AutoMapping $true
Add-RecipientPermission -Identity office@domain.at -Trustee anna@domain.at -AccessRights SendAs
```

6. Im Outlook des Anwenders erscheint das Postfach nach einiger Zeit automatisch, bei Bedarf bis zu rund eine Stunde warten.
7. Das Postfach hat keine eigene Anmeldung. Keine Lizenz zuweisen, solange es unter 50 GB bleibt und weder Archiv noch Aufbewahrungssperre braucht.

## Wenn das nicht hilft
- Postfach erscheint nicht: Berechtigung prüfen mit `Get-MailboxPermission`.
- Ticket mit Postfachadresse und betroffenen Benutzern ergänzen.

=== ARTIKEL
titel: Verteilerliste, Microsoft-365-Gruppe oder freigegebenes Postfach – was wofür
bereich: Microsoft 365 Administration
tags: verteilerliste, microsoft 365 gruppe, freigegebenes postfach, gruppe, unterschied, auswahl
zielgruppe: technik
---
**Symptom:** Der Kunde wünscht eine gemeinsame Adresse oder Gruppe, und es ist unklar, welcher Typ passt.

**Häufige Ursachen:** Die Typen sehen ähnlich aus, haben aber unterschiedliche Folgen für Zugriff, Teams und Lizenzen.

## Lösung
Entscheidungshilfe:

| Typ | Zweck | Besonderheiten |
| --- | --- | --- |
| Verteilerliste | Eine Nachricht geht an viele Empfänger | Kein gemeinsamer Posteingang, keine Dateiablage |
| Microsoft-365-Gruppe | Zusammenarbeit: Postfach, Kalender, SharePoint, Planner, optional Teams | Mitglieder und Besitzer, Gruppenpostfach |
| Freigegebenes Postfach | Gemeinsamer Posteingang, mehrere Personen antworten | Vollzugriff und Senden als, keine Dateiablage |
| E-Mail-aktivierte Sicherheitsgruppe | Berechtigungen und Verteilung kombiniert | Für Rechtevergabe, selten sinnvoll für E-Mail |

1. Reine Rundmail an feste Personen: Verteilerliste.
2. Anfragen, die nachverfolgt werden (info@, office@, Rechnungen): freigegebenes Postfach.
3. Projekt oder Abteilung mit Dateien, Aufgaben und Chat: Team beziehungsweise Microsoft-365-Gruppe.
4. Extern erreichbar? Bei Verteilerlisten und Gruppen im Exchange Admin Center die Einstellung zum Empfangen von Nachrichten externer Absender prüfen.
5. Anlegen: Exchange Admin Center → **Empfänger → Gruppen** oder Microsoft 365 Admin Center → **Teams & Gruppen → Aktive Teams und Gruppen** (Bezeichnung je nach Stand).

## Wenn das nicht hilft
- Typ lässt sich nachträglich nur eingeschränkt ändern. Im Zweifel neu anlegen und Mitglieder übernehmen.
- Ticket mit gewünschter Adresse, Mitgliedern und Zweck ergänzen.

=== ARTIKEL
titel: Alias und weitere E-Mail-Adressen für ein Postfach hinzufügen
bereich: Microsoft 365 Administration
tags: alias, e-mail-adresse, proxyadresse, primäre adresse, zweite adresse, smtp
zielgruppe: technik
---
**Symptom:** Ein Postfach soll zusätzlich unter einer weiteren Adresse erreichbar sein, oder die primäre Adresse soll wechseln.

**Häufige Ursachen:** Namensänderung, zweite Domain, Funktionsadresse. Die Adresse ist bereits anderweitig vergeben, oder die Domain ist nicht verifiziert.

## Lösung
1. Voraussetzung: Die Domain der neuen Adresse ist unter **Einstellungen → Domänen** hinzugefügt und verifiziert.
2. **Microsoft 365 Admin Center → Benutzer → Aktive Benutzer →** Benutzer wählen → **Konto → Benutzername und E-Mail → Verwalten** (Bezeichnung je nach Stand).
3. Unter **Alias** die neue Adresse eintragen und speichern. Eine Primäradresse ändert sich über denselben Dialog.
4. Per PowerShell nach `Connect-ExchangeOnline`:

```
Set-Mailbox -Identity anna@domain.at -EmailAddresses @{add="smtp:verkauf@domain.at"}
Get-Mailbox -Identity anna@domain.at | Format-List EmailAddresses
```

5. Das Präfix `SMTP:` in Großbuchstaben kennzeichnet die Primäradresse, `smtp:` einen Alias.
6. Bei Änderung der Primäradresse bleibt die alte als Alias erhalten, damit Antworten ankommen. Der Anmeldename (UPN) ist davon getrennt und wird separat geändert.
7. Nach Änderungen Outlook-Autovervollständigung beachten: alte Einträge können Zustellfehler auslösen, gegebenenfalls Zwischenspeicher-Eintrag löschen lassen.
8. Testmail an die neue Adresse senden.

## Wenn das nicht hilft
- Meldung, die Adresse werde bereits verwendet: im Exchange Admin Center und bei gelöschten Objekten suchen.
- Ticket mit Postfach, neuer Adresse und Fehlermeldung ergänzen.

=== ARTIKEL
titel: Eigene Domain zu Microsoft 365 hinzufügen und DNS-Einträge setzen
bereich: Microsoft 365 Administration
tags: domain, dns, mx, spf, dkim, dmarc, autodiscover, verifizieren
zielgruppe: technik
---
**Symptom:** Eine Firmendomain soll für E-Mail und Anmeldung in Microsoft 365 genutzt werden.

**Häufige Ursachen:** DNS-Einträge fehlen oder sind veraltet, zum Beispiel ein alter SPF-Eintrag des früheren Anbieters.

## Lösung
1. **Microsoft 365 Admin Center → Einstellungen → Domänen → Domäne hinzufügen** (Bezeichnung je nach Stand).
2. Domainnamen eingeben. Der Assistent nennt einen Verifizierungseintrag, meist TXT. Diesen beim DNS-Anbieter anlegen und **Verifizieren** wählen.
3. Im nächsten Schritt zeigt der Assistent die benötigten Einträge. Exakte Werte immer dem Assistenten entnehmen:
   - **MX:** zeigt auf eine Adresse der Form `domain-at.mail.protection.outlook.com`
   - **SPF (TXT):** typisch `v=spf1 include:spf.protection.outlook.com -all`, bestehende SPF-Einträge zusammenführen, es darf nur einer existieren
   - **CNAME autodiscover:** `autodiscover.outlook.com`
4. DKIM: **Microsoft Defender Portal → E-Mail & Zusammenarbeit → Richtlinien und Regeln → Bedrohungsrichtlinien → E-Mail-Authentifizierungseinstellungen** (Bezeichnung je nach Stand). Zwei CNAME-Einträge anlegen, danach DKIM aktivieren.
5. DMARC als TXT-Eintrag `_dmarc` zunächst mit `p=none` und Berichtsadresse starten.

**Achtung:** Der Wechsel des MX-Eintrags leitet die Post um. Vorher alte Postfächer sichern, Zeitpunkt abstimmen, niedrige TTL einige Tage vorher setzen.

## Wenn das nicht hilft
- Verifizierung schlägt fehl: DNS-Propagation abwarten und Eintrag mit einer DNS-Abfrage prüfen.
- Ticket mit Domain, DNS-Anbieter und vorhandenen Einträgen ergänzen.

=== ARTIKEL
titel: Externe Weiterleitungen von Postfächern unterbinden
bereich: Microsoft 365 Administration
tags: weiterleitung extern, automatische weiterleitung, datenabfluss, anti-spam, posteingangsregel
zielgruppe: technik
---
**Symptom:** Mails werden automatisch an externe Adressen weitergeleitet. Das kann Datenabfluss oder ein Hinweis auf ein kompromittiertes Konto sein.

**Häufige Ursachen:** Posteingangsregeln von Anwendern, Weiterleitung im Postfach, absichtlich eingerichtete Weiterleitung an private Adressen.

## Lösung
1. **Microsoft Defender Portal → E-Mail & Zusammenarbeit → Richtlinien und Regeln → Bedrohungsrichtlinien → Anti-Spam-Richtlinien** öffnen (Bezeichnung je nach Stand).
2. Die ausgehende Richtlinie (Standard) bearbeiten. Bei **Automatische Weiterleitung** den Wert **Aus** wählen. Die Voreinstellung „Automatisch, vom System gesteuert“ blockiert externe Weiterleitung in der Regel bereits, ausdrücklich auf Aus zu stellen ist aber eindeutig.
3. Per PowerShell nach `Connect-ExchangeOnline`: `Set-HostedOutboundSpamFilterPolicy -Identity Default -AutoForwardingMode Off`.
4. Bestehende Weiterleitungen finden:

```
Get-Mailbox -ResultSize Unlimited | Where-Object {$_.ForwardingSmtpAddress -or $_.ForwardingAddress} | Format-Table Name,ForwardingSmtpAddress,ForwardingAddress
```

5. Posteingangsregeln eines Postfachs prüfen mit `Get-InboxRule -Mailbox anna@domain.at`.
6. Legitime Ausnahme: eigene Richtlinie nur für betroffene Benutzer anlegen, schriftlich begründen lassen.
7. Unbekannte Weiterleitung entdeckt: Verdacht auf Kompromittierung, Vorgehen laut Bereich Sicherheitsvorfälle.

## Wenn das nicht hilft
- Weiterleitung greift trotzdem: Richtlinienpriorität und Regel auf Transportebene prüfen.
- Ticket mit betroffenem Postfach, Zieladresse und Datum ergänzen.

=== ARTIKEL
titel: Spam und Quarantäne verwalten, Absender zulassen oder sperren
bereich: Microsoft 365 Administration
tags: spam, quarantäne, absender zulassen, absender sperren, mail kommt nicht an, phishing
zielgruppe: technik
---
**Symptom:** Eine erwartete Mail kommt nicht an, oder unerwünschte Mails erreichen den Posteingang.

**Häufige Ursachen:** Mail liegt in der Quarantäne oder im Junk-Ordner, der Absender hat einen fehlerhaften SPF- oder DKIM-Eintrag, oder es gibt eine alte Zulassungsregel.

## Lösung
1. **Microsoft Defender Portal → E-Mail & Zusammenarbeit → Überprüfen → Quarantäne** öffnen (Bezeichnung je nach Stand).
2. Nach Empfänger, Absender und Zeitraum filtern. Grund der Quarantäne ansehen (Spam, Phishing, Schadsoftware).
3. Fehlalarm: Nachricht auswählen und **Freigeben**, auf Wunsch dem Microsoft-Prüfdienst als Fehlalarm melden.
4. **Achtung:** Hochgradiges Phishing und Schadsoftware nur nach Rücksprache freigeben.
5. Absender dauerhaft zulassen oder sperren: **Richtlinien und Regeln → Bedrohungsrichtlinien → Zulassen/Blockieren-Liste für Mandanten** (Bezeichnung je nach Stand). Einträge für Absender mit Ablaufdatum anlegen.
6. Alternative: Transportregel im Exchange Admin Center unter **E-Mail-Fluss → Regeln**. Zulassungen über Transportregeln umgehen Prüfungen und sind riskant, nur gezielt verwenden.
7. Einzelne Anwender können eigene Absenderlisten in Outlook pflegen, das ist für Kunden-Support in einem eigenen Artikel beschrieben.
8. Zustellung prüfen mit der Nachrichtenablaufverfolgung im Exchange Admin Center (**E-Mail-Fluss → Nachrichtenablaufverfolgung**).

## Wenn das nicht hilft
- Kein Eintrag in Quarantäne: Nachrichtenablaufverfolgung prüfen, Absenderdomain bei Sendern auf Fehler testen lassen.
- Ticket mit Absender, Empfänger, Zeitpunkt und Betreff ergänzen.

=== ARTIKEL
titel: Postfachgröße, Archiv und Aufbewahrungsrichtlinien verstehen
bereich: Microsoft 365 Administration
tags: postfach voll, archiv, aufbewahrung, online-archiv, speicherplatz, retention, 50 gb
zielgruppe: technik
---
**Symptom:** Ein Postfach ist fast voll, oder der Kunde fragt, wie lange Mails aufbewahrt werden.

**Häufige Ursachen:** Große Anhänge, Papierkorb nie geleert, Postfachkontingent der Lizenz erreicht.

## Lösung
1. Größe prüfen: `Get-MailboxStatistics -Identity anna@domain.at | Format-List DisplayName,TotalItemSize,ItemCount`. Kontingent: `Get-Mailbox -Identity anna@domain.at | Format-List ProhibitSendQuota`.
2. Das Kontingent hängt von der Lizenz ab, bei Business-Paketen meist 50 GB. Aktuellen Wert dem Lizenzplan entnehmen.
3. Online-Archiv: Exchange Admin Center → **Empfänger → Postfächer →** Postfach → **Archiv** (Bezeichnung je nach Stand) oder `Enable-Mailbox -Identity anna@domain.at -Archive`. Ob das Archiv in der Lizenz enthalten ist, vorher klären.
4. Archivierung selbst läuft über Richtlinien: Aufbewahrungsrichtlinie des Postfachs verschiebt ältere Mails ins Archiv. Der Managed Folder Assistant arbeitet zeitversetzt, Wirkung nach Tagen.
5. Gelöschte Elemente: Standard 14 Tage, verlängerbar auf 30 mit `Set-Mailbox -Identity anna@domain.at -RetainDeletedItemsFor 30.00:00:00`.
6. Aufbewahrungsrichtlinien für Compliance: **Microsoft Purview Portal → Datenlebenszyklus-Verwaltung** (Bezeichnung je nach Stand). Richtlinien mit Löschung sorgfältig planen.

**Achtung:** Aufbewahrungsrichtlinien mit Löschaktion entfernen Inhalte endgültig. Vorgaben des Kunden dokumentieren.

## Wenn das nicht hilft
- Postfach voll trotz Archiv: Archivstatus und Lizenz prüfen.
- Ticket mit Postfach, Größe und Lizenz ergänzen.

=== ARTIKEL
titel: Postfach eines ausgeschiedenen Mitarbeiters durchsuchen und exportieren (Überblick)
bereich: Microsoft 365 Administration
tags: postfach durchsuchen, export, ediscovery, pst, inhaltssuche, ausgeschieden, purview
zielgruppe: technik
---
**Symptom:** Für ein Projekt oder eine Rechtsfrage müssen Mails eines ausgeschiedenen Mitarbeiters gefunden oder gesichert werden.

**Häufige Ursachen:** Fehlende Berechtigung für die Suche, Postfach bereits gelöscht, Vorgaben zu Datenschutz und Betriebsvereinbarung nicht geklärt.

## Lösung
1. Vorher Auftrag und Rechtsgrundlage vom Kunden schriftlich festhalten. Zugriff auf Mails Dritter unterliegt Datenschutz und gegebenenfalls Mitbestimmung.
2. Einfachster Weg: Postfach in ein freigegebenes Postfach umwandeln und dem Vorgesetzten Zugriff geben, dann in Outlook suchen.
3. Gezielte Suche und Export: **Microsoft Purview Portal → eDiscovery** (Bezeichnung je nach Stand und Lizenz). Dazu ist eine passende Rolle nötig, etwa eDiscovery-Manager, die im Portal unter den Berechtigungen zugewiesen wird.
4. Neue Suche mit Postfach und Stichwörtern oder Zeitraum anlegen, Ergebnisse prüfen und als PST oder einzelne Nachrichten exportieren, sofern Funktion und Lizenz verfügbar sind.
5. Alternativ den Export von Outlook aus (Datei → Öffnen und exportieren) durch einen Benutzer mit Vollzugriff durchführen.
6. Exportdateien verschlüsselt ablegen, Zugriff begrenzen, Löschfrist festlegen.
7. Gelöschte Postfächer sind nur begrenzte Zeit wiederherstellbar. Sofort handeln.

**Achtung:** Der Export enthält personenbezogene Daten. Weitergabe nur an berechtigte Personen.

## Wenn das nicht hilft
- Menüpunkt fehlt: Lizenz und Rollen prüfen.
- Ticket mit Auftrag, Suchkriterien und Ablageort ergänzen.

=== ARTIKEL
titel: Sicherheitsstandards oder bedingter Zugriff – was passt zum Kunden
bereich: Microsoft 365 Administration
tags: sicherheitsstandards, bedingter zugriff, security defaults, mfa, entra, lizenz
zielgruppe: technik
---
**Symptom:** Ein neuer Mandant braucht einen Basisschutz für Anmeldungen. Es ist unklar, ob Sicherheitsstandards genügen.

**Häufige Ursachen:** Unkenntnis der Unterschiede. Beides gleichzeitig aktivieren ist nicht möglich.

## Hintergrund
- **Sicherheitsstandards:** vorkonfigurierter Schutz, kostenlos. Verlangt MFA-Registrierung für alle, MFA für Administratoren, blockiert Legacy-Authentifizierung. Keine Ausnahmen, keine Feinsteuerung.
- **Bedingter Zugriff:** frei konfigurierbare Richtlinien nach Benutzer, App, Gerät, Standort und Risiko. Erfordert eine passende Lizenz, zum Beispiel in Microsoft 365 Business Premium enthalten (je nach Abonnement prüfen).

## Lösung
1. Lizenz klären: **Entra Admin Center → Identität → Übersicht** oder Lizenzübersicht im Admin Center.
2. Ohne passende Lizenz: Sicherheitsstandards aktivieren unter **Entra Admin Center → Identität → Übersicht → Eigenschaften → Sicherheitsstandards verwalten** (Bezeichnung je nach Stand).
3. Mit passender Lizenz: Sicherheitsstandards deaktivieren und gleichwertige Richtlinien für bedingten Zugriff einrichten (MFA für alle, Legacy blockieren, MFA für Administratoren).
4. Vor dem Umschalten Notfallkonto anlegen und Ausnahmen festlegen.
5. Umstellung außerhalb der Hauptarbeitszeit, Anwender vorab informieren.

**Achtung:** Beim Deaktivieren der Sicherheitsstandards ohne Ersatzrichtlinien besteht kurz kein MFA-Schutz. Ersatz sofort anlegen.

## Wenn das nicht hilft
- Meldung zu fehlender Lizenz: Lizenzen im Mandanten prüfen.
- Ticket mit gewähltem Modell und Begründung ergänzen.

=== ARTIKEL
titel: Richtlinie „MFA für alle“ mit bedingtem Zugriff einrichten, Notfallkonto
bereich: Microsoft 365 Administration
tags: mfa für alle, bedingter zugriff, notfallkonto, break glass, ausnahme, richtlinie
zielgruppe: technik
---
**Symptom:** Alle Benutzer sollen sich nur mit zweitem Faktor anmelden dürfen, ohne dass Administratoren sich aussperren.

**Häufige Ursachen:** Richtlinie ohne Testlauf aktiviert, kein Notfallkonto, Dienstkonten mit Anmeldung ohne MFA vergessen.

## Lösung
1. Zwei Notfallkonten anlegen: reine Cloudkonten mit der Domäne `onmicrosoft.com`, Rolle Globaler Administrator, sehr langes zufälliges Kennwort, offline verwahrt. Ihre Anmeldung überwachen.
2. Prüfen, welche Benutzer MFA registriert haben: **Entra Admin Center → Schutz → Authentifizierungsmethoden → Aktivität** (Bezeichnung je nach Stand).
3. **Entra Admin Center → Schutz → Bedingter Zugriff → Richtlinien → Neue Richtlinie**.
4. Benutzer: alle einschließen, Notfallkonten ausschließen. Zielressourcen: alle Ressourcen. Zugriff gewähren: **Multi-Faktor-Authentifizierung erforderlich**.
5. Richtlinie zunächst auf **Nur Bericht** stellen, einige Tage Anmeldeprotokolle auswerten (Registerkarte Bedingter Zugriff beim Eintrag).
6. Ausnahmen sparsam: Dienstkonten besser durch moderne Verfahren ersetzen. Jede Ausnahme mit Grund und Ablaufdatum dokumentieren.
7. Auf **Ein** schalten, mit einem Testkonto prüfen. Zwei Administratoren sollten gleichzeitig angemeldet bleiben, bis der Test erfolgreich ist.

**Achtung:** Fehlkonfiguration kann alle Administratoren aussperren. Notfallkonto vor Aktivierung testen.

## Wenn das nicht hilft
- Anwender werden ständig gefragt: Anmeldehäufigkeit und Gerätevertrauen prüfen.
- Ticket mit Richtlinienname, Ausnahmen und Testergebnis ergänzen.

=== ARTIKEL
titel: Legacy-Authentifizierung blockieren (POP, IMAP, SMTP AUTH)
bereich: Microsoft 365 Administration
tags: legacy authentifizierung, pop, imap, smtp auth, basic auth, scanner, bedingter zugriff
zielgruppe: technik
---
**Symptom:** Anmeldungen mit alten Protokollen umgehen MFA. Alte Geräte (Scanner, Programme) senden oder rufen Post darüber ab.

**Häufige Ursachen:** Ältere Multifunktionsgeräte, Branchensoftware mit SMTP-Versand, alte Mail-Apps.

## Lösung
1. Zuerst Nutzung ermitteln: **Entra Admin Center → Identität → Überwachung und Integrität → Anmeldeprotokolle** (Bezeichnung je nach Stand). Spalte oder Filter für die Clientanwendung verwenden, nach Legacy-Clients wie IMAP, POP oder SMTP filtern.
2. Betroffene Geräte und Programme auflisten und umstellen, etwa auf moderne Authentifizierung oder auf einen Connector beziehungsweise Relay.
3. Richtlinie anlegen: **Schutz → Bedingter Zugriff → Neue Richtlinie**, Bedingungen → **Clientanwendungen** → Haken bei **Exchange ActiveSync-Clients** und **Andere Clients**, Zugriff **Blockieren**. Notfallkonten ausschließen. Erst im Modus **Nur Bericht** prüfen.
4. Auf Postfachebene absichern, nach `Connect-ExchangeOnline`:

```
Set-CASMailbox -Identity anna@domain.at -PopEnabled $false -ImapEnabled $false
Set-TransportConfig -SmtpClientAuthenticationDisabled $true
```

5. Der Befehl für SMTP AUTH gilt mandantenweit. Benötigt ein Gerät SMTP AUTH, es einzeln mit `Set-CASMailbox -SmtpClientAuthenticationDisabled $false` ausnehmen oder auf einen Connector wechseln.
6. Ohne bedingten Zugriff blockieren die Sicherheitsstandards Legacy-Anmeldung bereits.

**Achtung:** Scan-to-Mail und Branchensoftware stoppen sofort. Vorher inventarisieren.

## Wenn das nicht hilft
- Ticket mit Gerätename, Protokoll und Fehlermeldung ergänzen.

=== ARTIKEL
titel: Administratorrollen sparsam vergeben
bereich: Microsoft 365 Administration
tags: administratorrolle, globaler administrator, berechtigung, rollen, admin-konto, least privilege
zielgruppe: technik
---
**Symptom:** Zu viele Personen haben volle Adminrechte, oder ein Anwender braucht nur eine einzelne Verwaltungsaufgabe.

**Häufige Ursachen:** Rolle „Globaler Administrator“ wird aus Bequemlichkeit vergeben, Admin-Konten werden für die tägliche Arbeit verwendet.

## Lösung
1. Bestand prüfen: **Microsoft 365 Admin Center → Rollen → Rollenzuweisungen** oder **Entra Admin Center → Identität → Rollen und Administratoren** (Bezeichnung je nach Stand).
2. Pro Rolle die Mitglieder ansehen. Globale Administratoren auf wenige, namentlich bekannte Personen begrenzen, mindestens zwei Konten für den Ausfall (inklusive Notfallkonto).
3. Für Aufgaben die kleinste passende Rolle wählen, zum Beispiel Benutzeradministrator, Exchange-Administrator, Helpdeskadministrator oder Kennwortadministrator.
4. Administratoren erhalten ein eigenes Konto ohne Lizenz und ohne Postfach, das nur für Verwaltung dient. Das Alltagskonto bleibt ohne Rechte.
5. Admin-Konten mit MFA absichern, bevorzugt mit FIDO2-Schlüssel oder Authenticator.
6. Externe Dienstleister: Delegierte Rechte oder Gastadministrator mit zeitlich begrenzter Rolle nutzen, nach Abschluss entfernen. Zeitgesteuerte Rollen (Privileged Identity Management) benötigen eine höhere Lizenz.
7. Zuweisungen dokumentieren und vierteljährlich überprüfen.

**Achtung:** Letzte Globale Administratoren nie entfernen, bevor ein Ersatz funktioniert.

## Wenn das nicht hilft
- Rolle nicht auffindbar: Bezeichnungen sind je nach Portal verschieden, über Suche im Rollenverzeichnis prüfen.
- Ticket mit Person, Rolle, Grund und Dauer ergänzen.

=== ARTIKEL
titel: Gastzugriff und externe Freigaben in Microsoft 365 steuern
bereich: Microsoft 365 Administration
tags: gastzugriff, extern teilen, gäste, freigabe, sharepoint extern, teams gast
zielgruppe: technik
---
**Symptom:** Externe Partner sollen Dateien oder Teams nutzen dürfen, oder Freigaben sind zu offen.

**Häufige Ursachen:** Voreinstellungen erlauben Einladungen durch alle Mitglieder, Freigabelinks „Jeder“ sind aktiv, alte Gäste werden nie entfernt.

## Lösung
1. Entra: **Entra Admin Center → Externe Identitäten → Einstellungen für die externe Zusammenarbeit** (Bezeichnung je nach Stand). Festlegen, wer Gäste einladen darf, und Domänen zulassen oder sperren.
2. SharePoint: **SharePoint Admin Center → Richtlinien → Freigabe** (Bezeichnung je nach Stand). Externe Freigabe für OneDrive und SharePoint getrennt einstellen, etwa „Neue und vorhandene Gäste“ statt „Jeder“.
3. Standardlinktyp auf „Bestimmte Personen“ stellen, Gültigkeit von Gastzugriff begrenzen.
4. Teams: **Teams Admin Center → Benutzer → Externer Zugriff** (Föderation) und **Gastzugriff** sind getrennte Einstellungen. Nur aktivieren, was gebraucht wird.
5. Die Microsoft-365-Gruppeneinstellung zu Gästen wirkt zusätzlich je Gruppe.
6. Bestehende Gäste prüfen: **Entra Admin Center → Benutzer** mit Filter Benutzertyp Gast. Ungenutzte Gäste entfernen.
7. Gäste in Gruppen oder Teams aufnehmen, statt Einzeldateien an viele Adressen zu verteilen.

**Achtung:** Strengere Einstellungen können laufende Freigaben beenden. Vorab Auswirkungen prüfen.

## Wenn das nicht hilft
- Einladung kommt nicht an oder lässt sich nicht einlösen: Einstellungen der Partnerdomäne und Spamordner prüfen.
- Ticket mit Gastadresse, Ziel und Fehlermeldung ergänzen.

=== ARTIKEL
titel: Teams anlegen, Besitzer festlegen und Lebenszyklus verwalten
bereich: Microsoft 365 Administration
tags: teams anlegen, besitzer, team archivieren, team löschen, ablaufrichtlinie, microsoft-365-gruppe
zielgruppe: technik
---
**Symptom:** Ein neues Team wird gebraucht, oder Teams ohne Besitzer und Altlasten häufen sich.

**Häufige Ursachen:** Anwender legen Teams ohne Konzept an, Besitzer verlassen die Firma, niemand räumt auf.

## Lösung
1. Anlegen: **Teams Admin Center → Teams → Teams verwalten → Hinzufügen** (Bezeichnung je nach Stand). Name, Beschreibung, Besitzer und Mitglieder angeben, Datenschutz privat oder öffentlich wählen.
2. Jedes Team ist an eine Microsoft-365-Gruppe und eine SharePoint-Website gebunden. Berechtigungen laufen über Besitzer und Mitglieder der Gruppe.
3. Mindestens zwei Besitzer festlegen, damit das Team bei Austritt nicht verwaist. Prüfen unter **Teams verwalten → Team → Mitglieder**.
4. Namenskonvention mit dem Kunden abstimmen (zum Beispiel Abteilung oder Projekt als Präfix).
5. Ablauf: **Entra Admin Center → Gruppen → Ablauf** (Bezeichnung je nach Stand, benötigt passende Lizenz). Besitzer werden vor Ablauf benachrichtigt.
6. Nicht mehr benötigte Teams zuerst **archivieren**: Inhalt bleibt lesbar. Löschen nur nach Freigabe.
7. Gelöschte Gruppen sind etwa 30 Tage wiederherstellbar (Microsoft 365 Admin Center → Teams & Gruppen → Gelöschte Gruppen).
8. Die Bedienung für Anwender ist nicht Teil dieses Artikels.

**Achtung:** Beim Löschen eines Teams werden Dateien, Kalender und Gruppenpostfach mit entfernt.

## Wenn das nicht hilft
- Team ohne Besitzer: Besitzer über das Admin Center ergänzen.
- Ticket mit Teamname, Besitzern und gewünschtem Vorgehen ergänzen.

=== ARTIKEL
titel: SharePoint-Website anlegen und Berechtigungsgruppen richtig nutzen
bereich: Microsoft 365 Administration
tags: sharepoint, website, berechtigung, besitzer, mitglieder, besucher, teamwebsite
zielgruppe: technik
---
**Symptom:** Ein Kunde braucht eine Ablage für Abteilungen oder Projekte, und Berechtigungen sind unübersichtlich.

**Häufige Ursachen:** Rechte werden an einzelne Personen oder Ordner vergeben, einzelne Freigaben wuchern.

## Lösung
1. **SharePoint Admin Center → Websites → Aktive Websites → Erstellen** (Bezeichnung je nach Stand).
2. Typ wählen: **Teamwebsite** (mit Microsoft-365-Gruppe, passend zu Teams) oder **Kommunikationswebsite** (Informationen für viele Leser).
3. Besitzer und Mitglieder festlegen. Mindestens zwei Besitzer.
4. Standardgruppen der Website:
   - **Besitzer:** Vollzugriff und Verwaltung
   - **Mitglieder:** Bearbeiten
   - **Besucher:** nur Lesen
5. Berechtigungen immer über diese Gruppen vergeben, möglichst Sicherheitsgruppen oder Microsoft-365-Gruppen verwenden, nicht einzelne Personen.
6. Eindeutige Berechtigungen für Ordner oder Dateien vermeiden. Sie sind schwer nachvollziehbar. Wo nötig, eigene Bibliothek oder Website anlegen.
7. Übersicht der Berechtigungen: auf der Website **Einstellungen → Websiteberechtigungen** (Bezeichnung je nach Stand).
8. Externe Freigabe der Website passend zum Kunden einstellen (siehe Artikel zum Gastzugriff).

**Achtung:** Das Aufheben der Vererbung für Ordner führt zu Sonderfällen. Nur mit Dokumentation.

## Wenn das nicht hilft
- Anwender sieht Inhalte nicht: Mitgliedschaft in der Gruppe und Lizenz prüfen.
- Ticket mit Website-Adresse, Benutzer und gewünschter Berechtigung ergänzen.

=== ARTIKEL
titel: OneDrive eines Benutzers dem Vorgesetzten zugänglich machen
bereich: Microsoft 365 Administration
tags: onedrive, zugriff vorgesetzter, austritt, dateien übernehmen, onedrive löschen, aufbewahrung
zielgruppe: technik
---
**Symptom:** Nach dem Austritt sollen Dateien eines Mitarbeiters für den Vorgesetzten erreichbar sein.

**Häufige Ursachen:** Das Konto wurde schon gelöscht, die Aufbewahrungsfrist ist knapp, Freigabe des Kunden fehlt.

## Lösung
1. Schriftliche Freigabe vom Kunden einholen. Persönliche Inhalte können enthalten sein.
2. Bei noch vorhandenem Konto: **Microsoft 365 Admin Center → Benutzer → Aktive Benutzer →** Benutzer wählen → **OneDrive** → **Zugriff auf Dateien erstellen** (Bezeichnung je nach Stand). Der angezeigte Link führt zum OneDrive des Benutzers.
3. Alternativ **SharePoint Admin Center → Weitere Funktionen → Benutzerprofile** (Bezeichnung je nach Stand), dort eigenen Websitesammlungsadministrator hinzufügen. Der Zugriff gilt für das gesamte OneDrive.
4. Beim Löschen des Benutzers bietet der Assistent an, den Zugriff für einen Vorgesetzten zu gewähren.
5. Besser als dauerhafter Zugriff: Dateien in eine SharePoint-Website oder Teams-Ablage verschieben oder kopieren und den Zugriff wieder entfernen.
6. Nach Löschen des Benutzers wird das OneDrive gemäß der Einstellung unter **SharePoint Admin Center → Einstellungen → OneDrive-Aufbewahrung** noch für eine Anzahl Tage aufbewahrt (Standard 30 Tage, konfigurierbar).

**Achtung:** Nach Ablauf der Frist ist das OneDrive endgültig weg. Daten vorher sichern.

## Wenn das nicht hilft
- Zugriff verweigert: Rolle prüfen, Änderung braucht einige Minuten.
- Ticket mit Konto, Vorgesetztem, Datum und Löschfrist ergänzen.

=== ARTIKEL
titel: Geräte in Intune registrieren – Überblick der Wege
bereich: Microsoft 365 Administration
tags: intune, registrierung, autopilot, entra join, geräteverwaltung, mdm, windows
zielgruppe: technik
---
**Symptom:** Firmengeräte sollen zentral verwaltet werden, und es ist unklar, wie sie in Intune gelangen.

**Häufige Ursachen:** Automatische Registrierung ist nicht aktiviert, Lizenz fehlt, Gerät nur privat hinzugefügt.

## Hintergrund
Verwaltung läuft über das Intune Admin Center. Voraussetzung ist eine passende Lizenz (in Business Premium enthalten, sonst separat). Zeiten und Menünamen unterscheiden sich je nach Stand des Portals.

## Lösung
1. MDM-Benutzerbereich prüfen: **Entra Admin Center → Geräte → Mobilgeräteverwaltung** (je nach Stand), Microsoft Intune auf Alle oder ausgewählte Gruppen stellen.
2. Weg A, Entra-Join bei der Einrichtung: Bei der Ersteinrichtung von Windows mit dem Geschäftskonto anmelden. Das Gerät wird in Entra eingebunden und automatisch registriert.
3. Weg B, vorhandenes Gerät: **Einstellungen → Konten → Auf Arbeits- oder Schulkonto zugreifen → Verbinden**.
4. Weg C, Autopilot: Hardware-Hashes im Intune Admin Center unter **Geräte → Windows → Windows-Registrierung** hochladen, Profil zuweisen. Geeignet für neue Geräte in Serie.
5. Weg D, Smartphones: Unternehmensportal oder Registrierung je nach Plattform. Privatgeräte besser mit App-Schutzrichtlinien statt voller Verwaltung.
6. Ergebnis prüfen: **Intune Admin Center → Geräte → Alle Geräte**.

**Achtung:** Ein Zurücksetzen mit Autopilot löscht lokale Daten. Daten vorher sichern.

## Wenn das nicht hilft
- Gerät erscheint nicht: Lizenz, MDM-Bereich und Anmeldung prüfen.
- Ticket mit Gerätename, Registrierungsweg und Meldung ergänzen.

=== ARTIKEL
titel: Kompatibilitätsrichtlinie und BitLocker über Intune einrichten (Überblick)
bereich: Microsoft 365 Administration
tags: intune, kompatibilität, compliance, bitlocker, verschlüsselung, wiederherstellungsschlüssel
zielgruppe: technik
---
**Symptom:** Geräte sollen nur mit Verschlüsselung und aktuellem Schutz auf Firmendaten zugreifen.

**Häufige Ursachen:** Keine Richtlinien zugewiesen, TPM fehlt oder ist deaktiviert, Gerät nicht in Intune registriert.

## Lösung
1. Voraussetzung: Geräte sind in Intune registriert, TPM aktiv.
2. Kompatibilitätsrichtlinie: **Intune Admin Center → Geräte → Konformität → Richtlinien → Erstellen**, Plattform Windows 10 und höher (Bezeichnungen je nach Stand). Typische Vorgaben: BitLocker erforderlich, Firewall und Virenschutz aktiv, Mindestversion des Betriebssystems.
3. Frist für Nichtkonformität (Karenzzeit) und Benachrichtigungen festlegen.
4. BitLocker-Richtlinie: **Endpoint Security → Datenträgerverschlüsselung → Richtlinie erstellen**, Profil BitLocker. Wiederherstellungsschlüssel in Entra sichern lassen.
5. Beide Richtlinien einer Pilotgruppe zuweisen, Ergebnis unter **Geräte → Überwachen** prüfen, danach auf alle Geräte ausrollen.
6. Wiederherstellungsschlüssel abrufen: Entra Admin Center oder Intune beim Gerät, Bereich **Wiederherstellungsschlüssel**.
7. Optional bedingter Zugriff: Zugriff nur mit konformem Gerät verlangen. Erst im Modus Nur Bericht testen.

**Achtung:** Verschlüsselung läuft auf produktiven Geräten im Hintergrund. Sicherung vorher, Geräte nicht abrupt ausschalten. Konformitätspflicht im bedingten Zugriff kann Anwender aussperren.

## Wenn das nicht hilft
- Gerät bleibt nicht konform: Details der Richtlinie je Gerät öffnen, TPM und Windows-Version prüfen.
- Ticket mit Gerät, Richtlinie und Statusmeldung ergänzen.

=== ARTIKEL
titel: Überwachungsprotokoll durchsuchen – wer hat was geändert
bereich: Microsoft 365 Administration
tags: überwachungsprotokoll, audit log, anmeldeprotokoll, purview, wer hat gelöscht, nachvollziehen
zielgruppe: technik
---
**Symptom:** Es ist zu klären, wer eine Datei gelöscht, ein Postfach geändert oder eine Einstellung angepasst hat.

**Häufige Ursachen:** Auditierung nicht aktiv, Aufbewahrung abgelaufen, zu breiter Suchzeitraum.

## Lösung
1. **Microsoft Purview Portal → Überwachung** (Bezeichnung je nach Stand) öffnen. Ist die Überwachung nicht aktiv, wird dies oben angezeigt und kann dort aktiviert werden.
2. Rollen: Der Zugriff erfordert eine Rolle wie Überwachungsprotokolle (Audit Logs) in Exchange Online, die einem Administrator zugewiesen wird.
3. Neue Suche: Zeitraum, Aktivitäten (zum Beispiel Datei gelöscht, Postfach geändert), Benutzer oder Dateiname eingrenzen.
4. Ergebnisse prüfen und bei Bedarf exportieren. Die Ergebnisliste zeigt Datum, Benutzer, Aktivität und Objekt.
5. Anmeldungen: **Entra Admin Center → Identität → Überwachung und Integrität → Anmeldeprotokolle**. Änderungen im Verzeichnis: **Überwachungsprotokolle** daneben.
6. Per PowerShell nach `Connect-ExchangeOnline` ist `Search-UnifiedAuditLog` mit Start, Ende und Benutzer möglich. Die Funktion ist je nach Stand des Dienstes eingeschränkt, im Zweifel die Portalsuche nutzen.
7. Aufbewahrung ist begrenzt (Standard je nach Lizenz einige Monate). Frühzeitig suchen.

**Achtung:** Protokolle enthalten personenbezogene Daten. Zugriff und Weitergabe begrenzen.

## Wenn das nicht hilft
- Keine Treffer: Zeitraum erweitern, Verzögerung von bis zu einigen Stunden beachten.
- Ticket mit Fragestellung, Zeitraum und Ergebnissen ergänzen.

=== ARTIKEL
titel: Dienststatus und Nachrichtencenter prüfen
bereich: Microsoft 365 Administration
tags: dienststatus, störung, nachrichtencenter, microsoft ausfall, service health, ankündigungen
zielgruppe: technik
---
**Symptom:** Mehrere Anwender melden gleichzeitig Probleme mit Outlook, Teams oder Anmeldung. Es soll geklärt werden, ob es an Microsoft liegt.

**Häufige Ursachen:** Dienststörung bei Microsoft, geplante Änderung, oder ein lokales Problem im Kundennetz.

## Lösung
1. **Microsoft 365 Admin Center → Integrität → Dienststatus** öffnen (Bezeichnung je nach Stand). Dort stehen aktuelle Störungen und Hinweise je Dienst, zum Beispiel Exchange Online oder Teams.
2. Eintrag öffnen: Beschreibung, betroffene Funktionen, Stand der Behebung. Die Kennung der Störung ins Ticket übernehmen.
3. Verlauf unter **Dienststatus → Berichtsverlauf** ansehen (je nach Stand), um frühere Störungen zu vergleichen.
4. **Nachrichtencenter** (im Admin Center unter Integrität): Ankündigungen zu neuen Funktionen und Änderungen mit Zeitpunkt. Wichtig für Lizenz- und Portaländerungen. Mit Planen oder Markieren die relevanten Einträge verfolgen.
5. Ist ein Dienst als gestört gemeldet, Kunden informieren und keine Änderungen an Konten oder Einstellungen vornehmen, solange die Störung läuft.
6. Meldet das Portal nichts, lokale Ursachen prüfen: Internet, DNS, Proxy, Konto des Anwenders.
7. Mobile App oder E-Mail-Benachrichtigungen im Admin Center lassen sich für Störungen einrichten.

## Wenn das nicht hilft
- Portal selbst nicht erreichbar: öffentliche Statusseiten von Microsoft und Netzwerkzugang prüfen.
- Ticket mit Störungskennung, betroffenen Diensten und Beginn ergänzen.

=== ARTIKEL
titel: Mit PowerShell verbinden: Exchange Online und Microsoft Graph
bereich: Microsoft 365 Administration
tags: powershell, connect-exchangeonline, connect-mggraph, graph, module, abfragen
zielgruppe: technik
---
**Symptom:** Für Massenabfragen oder Einstellungen ohne Portal wird PowerShell gebraucht.

**Häufige Ursachen:** Module fehlen oder sind veraltet, Rechte der Anmeldung reichen nicht, Anmeldefenster blockiert.

## Lösung
1. PowerShell als Administrator öffnen (Windows PowerShell oder PowerShell 7).
2. Module installieren, einmalig:

```
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Install-Module Microsoft.Graph -Scope CurrentUser
```

3. Exchange Online verbinden und prüfen:

```
Connect-ExchangeOnline -UserPrincipalName admin@domain.at
Get-Mailbox -ResultSize Unlimited | Select DisplayName,PrimarySmtpAddress
Get-Mailbox -RecipientTypeDetails SharedMailbox
```

4. Microsoft Graph verbinden, Berechtigungen (Scopes) nur so weit wie nötig:

```
Connect-MgGraph -Scopes "User.Read.All"
Get-MgUser -All | Select DisplayName,UserPrincipalName,AccountEnabled
```

5. Beim ersten Mal wird Zustimmung zu den angeforderten Berechtigungen verlangt. Den Admin-Konto-Zugriff beachten.
6. Lizenzen eines Benutzers: `Get-MgUserLicenseDetail -UserId anna@domain.at`.
7. Sitzung beenden mit `Disconnect-ExchangeOnline` und `Disconnect-MgGraph`.
8. Nur lesende Abfragen zuerst testen, bei schreibenden Befehlen `-WhatIf` verwenden, wo vorhanden.

**Achtung:** Befehle mit `Remove-` oder `Set-` wirken sofort auf produktive Daten. Vorher Ergebnis der Abfrage prüfen.

## Wenn das nicht hilft
- Anmeldung schlägt fehl: Modulversion aktualisieren, Konto und MFA prüfen.
- Ticket mit Befehl und vollständiger Fehlermeldung ergänzen.

=== ARTIKEL
titel: Kalenderberechtigungen per PowerShell prüfen und setzen
bereich: Microsoft 365 Administration
tags: kalender, kalenderberechtigung, powershell, freigabe, add-mailboxfolderpermission, vertretung
zielgruppe: technik
---
**Symptom:** Kollegen oder die Vertretung sollen einen Kalender sehen oder bearbeiten, oder der Kalender ist für alle offen.

**Häufige Ursachen:** Standardberechtigung zu weit oder zu eng, Ordnername weicht ab (Kalender statt Calendar).

## Lösung
1. Mit `Connect-ExchangeOnline` verbinden.
2. Namen des Kalenderordners prüfen: `Get-MailboxFolderStatistics -Identity anna@domain.at -FolderScope Calendar | Select Name,FolderPath`. In deutschen Postfächern häufig `Kalender`.
3. Bestehende Rechte anzeigen:

```
Get-MailboxFolderPermission -Identity anna@domain.at:\Kalender
```

4. Neue Berechtigung vergeben:

```
Add-MailboxFolderPermission -Identity anna@domain.at:\Kalender -User paul@domain.at -AccessRights Editor
```

5. Bereits vorhandene Berechtigung ändern: `Set-MailboxFolderPermission` mit denselben Parametern. Entfernen: `Remove-MailboxFolderPermission -Identity anna@domain.at:\Kalender -User paul@domain.at`.
6. Häufige Stufen: `AvailabilityOnly` (nur frei oder belegt), `LimitedDetails` (Betreff und Ort), `Reviewer` (lesen), `Editor` (bearbeiten).
7. Standardrecht für alle ändern: `Set-MailboxFolderPermission -Identity anna@domain.at:\Kalender -User Default -AccessRights LimitedDetails`.
8. Für Gruppen die Mailadresse einer Sicherheitsgruppe als Benutzer angeben.

## Wenn das nicht hilft
- Meldung, der Ordner sei nicht gefunden: Ordnername prüfen.
- Meldung, es bestehe bereits ein Eintrag: Set statt Add verwenden.
- Ticket mit Postfach, Benutzer und Stufe ergänzen.

=== ARTIKEL
titel: Raum- und Gerätepostfächer anlegen und Buchung steuern
bereich: Microsoft 365 Administration
tags: raumpostfach, gerätepostfach, besprechungsraum, ressource, buchung, setcalendarprocessing
zielgruppe: technik
---
**Symptom:** Besprechungsräume oder Geräte (Beamer, Firmenwagen) sollen im Kalender buchbar sein.

**Häufige Ursachen:** Normale Benutzerkonten statt Ressourcenpostfächer, automatische Annahme nicht eingestellt.

## Lösung
1. **Exchange Admin Center → Empfänger → Ressourcen → Ressource hinzufügen** (Bezeichnung je nach Stand). Typ **Raum** oder **Gerät** wählen, Name, Adresse, Kapazität eintragen.
2. Per PowerShell nach `Connect-ExchangeOnline`:

```
New-Mailbox -Name "Besprechungsraum 1" -Room
New-Mailbox -Name "Beamer" -Equipment
```

3. Buchung automatisieren:

```
Set-CalendarProcessing -Identity "Besprechungsraum 1" -AutomateProcessing AutoAccept
```

4. Buchungsfenster und Beschränkungen können ebenfalls mit `Set-CalendarProcessing` gesetzt werden, zum Beispiel `-BookingWindowInDays` oder `-MaximumDurationInMinutes`.
5. Raumlisten für die Raumsuche in Outlook: `New-DistributionGroup -Name "Standort Wien" -RoomList`, Räume mit `Add-DistributionGroupMember` hinzufügen.
6. Die Postfächer benötigen keine Lizenz. Ein Anmeldekonto wird nicht verwendet, das Kennwort muss nicht gesetzt werden.
7. Testbuchung mit Outlook durchführen, Annahme prüfen.
8. Zugriff auf den Kalender für Verantwortliche bei Bedarf per Kalenderberechtigung vergeben.

## Wenn das nicht hilft
- Anfragen bleiben offen: `Get-CalendarProcessing -Identity "Besprechungsraum 1"` prüfen.
- Ticket mit Ressource, Einstellung und Fehlermeldung ergänzen.

=== ARTIKEL
titel: Backup von Microsoft 365 – warum Papierkorb und Aufbewahrung keine Sicherung sind
bereich: Microsoft 365 Administration
tags: backup, datensicherung, papierkorb, aufbewahrung, ransomware, wiederherstellung, 3-2-1
zielgruppe: technik
---
**Symptom:** Der Kunde glaubt, Microsoft sichere alles. Nach einer Löschung oder Verschlüsselung sind Daten nicht mehr da.

**Häufige Ursachen:** Verwechslung von Verfügbarkeit mit Datensicherung. Microsoft stellt den Dienst bereit, für die Daten bleibt der Kunde verantwortlich.

## Hintergrund
Vorhandene Funktionen sind Wiederherstellungshilfen mit Frist, keine unabhängige Sicherung:
- Papierkorb in SharePoint und OneDrive: begrenzte Zeit (Richtwert 93 Tage über beide Stufen)
- Exchange: gelöschte Elemente standardmäßig 14 Tage, bis 30 Tage einstellbar
- Gelöschte Benutzer und Gruppen: etwa 30 Tage
- Versionsverlauf und Wiederherstellen von OneDrive helfen bei Ransomware nur innerhalb der Frist
- Aufbewahrungsrichtlinien sichern Inhalte für Compliance, bieten aber keine geordnete Wiederherstellung

## Lösung
1. Mit dem Kunden Wiederherstellungsziele klären: Was ist kritisch, wie lange darf es fehlen, wie weit zurück?
2. Externe Sicherungslösung für Exchange, SharePoint, OneDrive und Teams wählen. Sie sichert getrennt vom Mandanten.
3. Sicherung in einem anderen Konto beziehungsweise Anbieter, mit getrennten Zugangsdaten.
4. Wiederherstellung regelmäßig an Stichproben testen und dokumentieren.
5. Sicherungsumfang und Aufbewahrung im Vertrag festhalten.

## Wenn das nicht hilft
- Daten sind schon weg: Papierkorb und Wiederherstellung sofort prüfen, Fristen laufen.
- Ticket mit Datum der Löschung und betroffenen Daten ergänzen.

=== ARTIKEL
titel: Mandantenübergabe und Erstaufnahme – Checkliste für Microsoft 365
bereich: Microsoft 365 Administration
tags: mandant, übernahme, erstaufnahme, checkliste, bestandsaufnahme, dokumentation, onboarding kunde
zielgruppe: technik
---
**Symptom:** Ein Kunde wird neu betreut, oder ein Mandant wird von einem anderen Dienstleister übernommen. Der Ist-Zustand ist unbekannt.

**Häufige Ursachen:** Fehlende Dokumentation, unklare Adminkonten, ungeprüfte Altlasten.

## Lösung
1. Zugang: Administratorzugriff sicherstellen, Notfallkonto prüfen, delegierte Rechte des Vorgängers dokumentieren und bei Wegfall entfernen.
2. Abrechnung: **Admin Center → Abrechnung** – Produkte, Anzahl, Laufzeit, Zahlungsart, Rechnungsempfänger.
3. Benutzer: Aktive, gesperrte und ungenutzte Konten sowie Gäste auflisten. Lizenzzuordnung abgleichen.
4. Domänen und DNS: Domänenliste, MX, SPF, DKIM, DMARC prüfen.
5. Sicherheit: MFA-Abdeckung, Sicherheitsstandards oder bedingter Zugriff, Legacy-Authentifizierung, externe Weiterleitungen, Administratorrollen.
6. E-Mail: freigegebene Postfächer, Verteilerlisten, Transportregeln, Connectoren, Anti-Spam-Einstellungen.
7. Zusammenarbeit: Teams, SharePoint-Websites, Freigabe- und Gasteinstellungen.
8. Geräte: Intune-Registrierung, Richtlinien, BitLocker-Schlüssel.
9. Sicherung: Gibt es eine externe Sicherung, und wurde sie getestet?
10. Ergebnis als Dokument festhalten: Ist-Stand, Risiken, Maßnahmenliste mit Priorität. Kunden die Punkte vorstellen und freigeben lassen.

**Achtung:** Erst dokumentieren, dann ändern. Änderungen an Sicherheit und DNS einzeln, mit Rückfallplan.

## Wenn das nicht hilft
- Kein Administratorzugang: Vorgänger oder Microsoft-Support über den Inhaber der Domäne einbinden.
- Ticket mit Mandantendomäne und Ergebnisliste ergänzen.

=== ARTIKEL
titel: Lizenzwechsel in Microsoft 365 ohne Datenverlust
bereich: Microsoft 365 Administration
tags: lizenzwechsel, upgrade, downgrade, lizenz entfernen, postfach, datenverlust, plan wechseln
zielgruppe: technik
---
**Symptom:** Benutzer wechseln auf ein anderes Lizenzpaket, und es besteht die Sorge, Postfach oder OneDrive könnten verloren gehen.

**Häufige Ursachen:** Alte Lizenz wird entfernt, bevor die neue zugewiesen ist. Die Dienste des neuen Pakets sind kleiner (Archiv, Speicher).

## Lösung
1. Unterschiede der Pakete prüfen: Postfachgröße, Archiv, Teams, Intune, bedingter Zugriff, Sicherheitsfunktionen. Beim Downgrade entfallende Funktionen mit dem Kunden klären.
2. Vorab sichern: Postfachgröße prüfen (`Get-MailboxStatistics`), OneDrive-Inhalte und wichtige Daten extern sichern.
3. Neue Lizenz **zuerst** zuweisen, dann die alte entfernen: **Aktive Benutzer →** Benutzer → **Lizenzen und Apps**. Beides in einem Speichervorgang ändern, wenn das Portal es erlaubt.
4. Für das Wechseln eines ganzen Abonnements bietet das Admin Center je nach Stand eine Funktion zum Wechseln unter **Abrechnung → Ihre Produkte** an (Bezeichnung je nach Stand).
5. Bei gruppenbasierter Lizenzierung die Gruppenlizenz ändern und danach den Verarbeitungsstatus der Gruppe prüfen.
6. Nach dem Wechsel prüfen: Postfach erreichbar, OneDrive offen, Teams und Apps aktiv, Outlook meldet keine Neuanmeldung.

**Achtung:** Ohne Exchange-Lizenz wird ein Postfach nach einer Karenzzeit gelöscht. Postfächer ohne Lizenz erst in freigegebene Postfächer umwandeln, wenn sie so bleiben sollen.

## Wenn das nicht hilft
- Dienste fehlen nach dem Wechsel: Lizenzdetails des Benutzers öffnen und deaktivierte Dienste prüfen.
- Ticket mit Benutzer, alter und neuer Lizenz und Zeitpunkt ergänzen.
