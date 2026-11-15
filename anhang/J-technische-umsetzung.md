# Anhang J – Technische Umsetzungshinweise

> Zurück zur [Strategie](../KI-Cybersicherheitsstrategie.md) · Maßnahmen I1–I9, T1–T14, K1–K7, R2

Konkrete Einstellungen für die häufigsten Umgebungen. Schwerpunkt ist **Microsoft 365 / Microsoft Entra ID**; Entsprechungen für **Google Workspace** stehen jeweils dabei. Bezeichnungen in Admin-Oberflächen ändern sich regelmäßig – vor der Umsetzung mit der aktuellen Herstellerdokumentation abgleichen.

> **Grundregel für alle Änderungen:** Erst im Prüf- bzw. Report-only-Modus einführen, Auswirkungen beobachten, dann scharf schalten. Notfallkonten (siehe J.1) nie aussperren.

---

## J.1 Phishing-resistente MFA einführen (I1)

**Warum:** Einmal-Codes per SMS, App oder Push lassen sich über Echtzeit-Phishing-Seiten (Adversary-in-the-Middle) abgreifen. Passkeys und FIDO2-Schlüssel sind an die echte Domain gebunden und funktionieren auf einer gefälschten Seite schlicht nicht.

**Stufenplan**

| Stufe | Zielgruppe | Zeitraum |
|---|---|---|
| 0 | **Zwei Notfallkonten** (nur Cloud, nicht personengebunden) mit je zwei FIDO2-Schlüsseln, getrennt und sicher verwahrt; jede Anmeldung löst einen Alarm aus (UC08) | Woche 1 |
| 1 | Alle Administratorkonten | Woche 1–2 |
| 2 | Geschäftsführung, Assistenz, Finanzen, HR, IT-Helpdesk | Woche 2–4 |
| 3 | Alle übrigen Mitarbeitenden | Monat 2–6 |
| 4 | SMS- und Anruf-MFA für alle Gruppen deaktivieren, die umgestellt sind | laufend |

**Microsoft Entra ID**

- *Authentifizierungsmethoden → Richtlinien:* „Passkey (FIDO2)“ aktivieren; für die Zielgruppen gerätegebundene Passkeys (Microsoft Authenticator) und/oder FIDO2-Sicherheitsschlüssel zulassen. Windows Hello for Business bzw. Platform SSO (macOS) als Alternative an verwalteten Geräten.
- **Erstregistrierung ohne SMS:** Nach persönlicher Identitätsprüfung einen **Befristeten Zugriffspass (Temporary Access Pass)** ausstellen, mit dem die Person ihren Passkey registriert.
- Bedingter Zugriff mit **Authentifizierungsstärke „Phishing-resistente MFA“** erzwingen (Richtlinien CA02, CA04 in J.2).
- Nummernabgleich bei Push-Benachrichtigungen ist Standard – Push bleibt dennoch nur Übergangslösung.

**Google Workspace**

- *Sicherheit → Authentifizierung → Bestätigung in zwei Schritten:* erzwingen; für Risikogruppen als zulässige Methode **„Nur Sicherheitsschlüssel“** wählen; Passkeys zulassen.
- Für Geschäftsführung und Administration das **Erweiterte Sicherheitsprogramm (Advanced Protection)** aktivieren.

---

## J.2 Bedingter Zugriff – Basisrichtlinien (I2, I4, I5)

Gilt für Microsoft Entra ID (bedingter Zugriff ab Entra ID P1, risikobasierte Richtlinien ab P2). Notfallkonten aus allen Richtlinien ausnehmen und separat überwachen.

| ID | Richtlinie | Zielgruppe | Einstellung |
|---|---|---|---|
| CA01 | Legacy-Authentifizierung blockieren | Alle Benutzer | Client-Apps „Exchange ActiveSync“ und „Andere Clients“ → **Blockieren** |
| CA02 | Phishing-resistente MFA für Administration | Alle Admin-Rollen | Gewähren: **Authentifizierungsstärke „Phishing-resistente MFA“** |
| CA03 | MFA für alle | Alle Benutzer | Gewähren: MFA erforderlich (später auf Authentifizierungsstärke umstellen) |
| CA04 | Phishing-resistente MFA für Risikogruppen | Gruppe „Sicherheit-Risikogruppen“ | Gewähren: Authentifizierungsstärke „Phishing-resistente MFA“ |
| CA05 | Nur verwaltete Geräte | Alle Benutzer, Office-Apps | Gewähren: konformes oder hybrid eingebundenes Gerät; für nicht verwaltete Geräte nur Browserzugriff ohne Download |
| CA06 | Riskante Anmeldungen | Alle Benutzer | Anmelderisiko mittel/hoch → phishing-resistente MFA bzw. Blockieren (P2) |
| CA07 | Riskante Benutzer | Alle Benutzer | Benutzerrisiko hoch → Blockieren und Prüfung durch IT (P2) |
| CA08 | Registrierung von Sicherheitsinformationen absichern | Alle Benutzer | Benutzeraktion „Sicherheitsinformationen registrieren“ → nur von konformem Gerät, vertrauenswürdigem Standort oder mit Befristetem Zugriffspass |
| CA09 | Kurze Sitzungen für Administration | Alle Admin-Rollen | Anmeldehäufigkeit z. B. 4 Stunden; keine dauerhaften Browsersitzungen |

**Google Workspace:** Kontextbezogener Zugriff (Context-Aware Access) für Gerätestatus und Standort; Anmeldeherausforderungen und Sitzungsdauer unter *Sicherheit → Zugriffs- und Datenkontrolle*.

---

## J.3 E-Mail-Authentifizierung: SPF, DKIM, DMARC (T1)

**Schritte**

1. **Alle legitimen Absender erfassen:** Mailserver/Microsoft 365, Newsletter-Tool, ERP, CRM, Webshop, Ticketsystem, externe Dienstleister.
2. **SPF** mit allen Absendern und hartem Abschluss `-all`; maximal 10 DNS-Abfragen.
3. **DKIM** für jeden Absender aktivieren (2048-Bit-Schlüssel).
4. **DMARC** schrittweise verschärfen und Berichte auswerten (Auswertungsdienst oder eigenes Postfach):
   - Woche 0: `p=none` – nur beobachten
   - nach 2–4 Wochen ohne legitime Fehlschläge: `p=quarantine`
   - nach weiteren 2–4 Wochen: `p=reject`
5. **Nicht für E-Mail genutzte Domains** (auch Tippfehler-Domains, die wir besitzen) sofort komplett sperren.

**Beispiel-DNS-Einträge** (Domain und Absender anpassen)

```dns
; Genutzte Domain
beispiel.at.          TXT  "v=spf1 include:spf.protection.outlook.com include:<newsletter-anbieter> -all"
_dmarc.beispiel.at.   TXT  "v=DMARC1; p=reject; rua=mailto:dmarc-berichte@beispiel.at; adkim=s; aspf=s"

; Nicht für E-Mail genutzte Domain
beispiel-shop.at.         TXT  "v=spf1 -all"
_dmarc.beispiel-shop.at.  TXT  "v=DMARC1; p=reject"
beispiel-shop.at.         MX   0 .
```

> `adkim=s; aspf=s` (strikte Ausrichtung) erst setzen, wenn die DMARC-Berichte zeigen, dass alle legitimen Absender exakt die Hauptdomain verwenden.

---

## J.4 Härtung von Postfach und Mandant (T2, T4, I6)

| Maßnahme | Microsoft 365 | Google Workspace |
|---|---|---|
| Automatische Weiterleitung nach extern verbieten | Defender: Richtlinie für ausgehenden Spam → automatische Weiterleitung **Aus**; Ausnahmen nur über eigene Richtlinie | Gmail → Endnutzerzugriff → automatische Weiterleitung deaktivieren |
| Zustimmung von Benutzern zu Apps verbieten | Entra: Unternehmensanwendungen → Einwilligung und Berechtigungen → **Keine Benutzereinwilligung**; Admin-Einwilligungs-Workflow aktivieren | Sicherheit → API-Steuerung → Zugriff von Drittanbieter-Apps einschränken |
| Benutzer dürfen keine Apps registrieren | Entra: Benutzereinstellungen → App-Registrierung **Nein** | – |
| Externe Absender kennzeichnen | `Set-ExternalInOutlook -Enabled $true` | Gmail-Warnhinweise für externe Empfänger aktivieren |
| Schutz vor Identitätsfälschung | Defender for Office 365: Antiphishing-Richtlinie mit geschützten Benutzern (Geschäftsführung, Finanzen) und eigenen Domains, Postfachintelligenz | Gmail → Sicherheit → Schutz vor Spoofing und Authentifizierung, erweiterte Prüfung vor der Zustellung |
| Links und Anhänge prüfen | Defender for Office 365: Sichere Links, Sichere Anlagen | Gmail → Sicherheits-Sandbox, Schutz vor schädlichen Links |
| Melde-Button | Integrierte „Melden“-Schaltfläche in Outlook; Meldungen an ein Sicherheitspostfach leiten | Gmail-Funktion „Phishing melden“, Benachrichtigung im Benachrichtigungscenter |
| Audit-Protokollierung | Einheitliches Überwachungsprotokoll und Postfachüberwachung prüfen (standardmäßig aktiv, Aufbewahrung je Lizenz) | Prüfprotokolle und Benachrichtigungscenter |
| Externe Chats begrenzen | Teams: externer Zugriff nur für freigegebene Domains (Angreifer geben sich per Teams-Chat als IT-Support aus) | Google Chat: externe Chats einschränken |

---

## J.5 Erkennungsregeln (R2)

### Übersicht der Anwendungsfälle

| ID | Anwendungsfall | Datenquelle | Reaktion |
|---|---|---|---|
| UC01 | Neue Posteingangsregel mit Weiterleitung, Löschung oder Verschieben | Exchange-Überwachungsprotokoll | [Playbook B](B-playbook-ki-phishing-kontouebernahme.md) |
| UC02 | Neue oder geänderte MFA-Methode – besonders kurz nach einem Helpdesk-Reset | Entra-Überwachungsprotokoll | Playbook B |
| UC03 | Benutzer stimmt einer App zu | Entra-Überwachungsprotokoll | Playbook B |
| UC04 | Erfolgreiche Anmeldung über Legacy-Protokoll | Entra-Anmeldeprotokoll | Playbook B, CA01 prüfen |
| UC05 | Anmeldung über Anonymisierungsdienst, Hosting-IP oder unmögliche Reise | Entra ID Protection | Playbook B |
| UC06 | Massen-Download aus SharePoint/OneDrive | Microsoft 365-Überwachungsprotokoll | Playbook B bzw. [C](C-playbook-angriff-auf-ki-systeme.md) |
| UC07 | Änderung der Bankverbindung im Kreditorenstamm | ERP-Änderungsprotokoll | [Playbook A](A-playbook-deepfake-ceo-betrug.md) – Rückruf nachweisen |
| UC08 | Anmeldung mit Notfallkonto | Entra-Anmeldeprotokoll | Sofortalarm, Prüfung |
| UC09 | Ungewöhnliche Aktivität eines KI-Agenten bzw. Dienstprinzipals (neue IP, Volumenspitze, Zugriff außerhalb des Zwecks) | Anmeldeprotokolle für Dienstprinzipale, Graph-Aktivitätsprotokolle | Playbook C |
| UC10 | Neue API-Berechtigung für eine App oder einen Agenten | Entra-Überwachungsprotokoll | Playbook C |
| UC11 | Registrierung einer Lookalike-Domain | Domain-Monitoring | Playbook A, Warnung an Finanzen |
| UC12 | Dieselbe Phishing-Mail von mehreren Personen gemeldet | Meldepostfach | Playbook B – organisationsweit suchen und löschen |

### Beispielabfragen für Microsoft Sentinel (KQL)

> Beispiele zur Orientierung. Schwellenwerte, Ausnahmen und Zeitfenster an die eigene Umgebung anpassen und vor dem produktiven Einsatz testen.

**UC01 – Verdächtige Posteingangsregeln**

```kql
OfficeActivity
| where TimeGenerated > ago(1d)
| where Operation in ("New-InboxRule", "Set-InboxRule", "UpdateInboxRules")
| where Parameters has_any ("ForwardTo", "RedirectTo", "ForwardAsAttachmentTo", "DeleteMessage", "MoveToFolder")
| project TimeGenerated, UserId, ClientIP, Operation, Parameters
```

**UC02 – Registrierung oder Änderung von MFA-Methoden**

```kql
AuditLogs
| where TimeGenerated > ago(1d)
| where OperationName in ("User registered security info", "User changed default security info", "User deleted security info", "Admin registered security info")
| extend Benutzer = tostring(TargetResources[0].userPrincipalName)
| project TimeGenerated, OperationName, Benutzer, Result, InitiatedBy
```

**UC03 – App-Zustimmung durch Benutzer**

```kql
AuditLogs
| where TimeGenerated > ago(1d)
| where OperationName == "Consent to application"
| extend Benutzer = tostring(InitiatedBy.user.userPrincipalName), App = tostring(TargetResources[0].displayName)
| project TimeGenerated, Benutzer, App, Result
```

**UC04 – Erfolgreiche Anmeldung mit Legacy-Protokoll**

```kql
SigninLogs
| where TimeGenerated > ago(1d)
| where ResultType == "0"
| where ClientAppUsed !in ("Browser", "Mobile Apps and Desktop clients")
| project TimeGenerated, UserPrincipalName, ClientAppUsed, IPAddress, Location
```

**UC06 – Massen-Download**

```kql
OfficeActivity
| where TimeGenerated > ago(1h)
| where Operation in ("FileDownloaded", "FileSyncDownloadedFull")
| summarize Downloads = count() by UserId, ClientIP, bin(TimeGenerated, 10m)
| where Downloads > 200   // Schwellenwert anpassen
```

**UC08 – Anmeldung mit Notfallkonto**

```kql
SigninLogs
| where TimeGenerated > ago(1h)
| where UserPrincipalName in~ ("notfall1@beispiel.at", "notfall2@beispiel.at")
| project TimeGenerated, UserPrincipalName, IPAddress, Location, ResultType
```

**UC10 – Neue API-Berechtigungen für Apps und Agenten**

```kql
AuditLogs
| where TimeGenerated > ago(1d)
| where OperationName in ("Add app role assignment to service principal", "Add delegated permission grant")
| extend Ausgeloest = tostring(InitiatedBy.user.userPrincipalName), Ziel = tostring(TargetResources[0].displayName)
| project TimeGenerated, OperationName, Ausgeloest, Ziel, Result
```

**Ohne SIEM:** Die meisten Fälle lassen sich auch über die eingebauten Warnungen abdecken – Microsoft Defender XDR (Warnungsrichtlinien, Identitätsschutz) bzw. Google Workspace Benachrichtigungscenter (z. B. „Verdächtige Anmeldung“, „Gmail-Einstellungen geändert“). Wichtig ist, dass jemand die Warnungen **rund um die Uhr** bearbeitet (R1).

---

## J.6 Sicherungen (T12)

- **Cloud-Daten zusätzlich sichern:** Microsoft 365 und Google Workspace bieten Verfügbarkeit, aber keinen vollwertigen Schutz gegen Löschung oder Verschlüsselung durch einen übernommenen Administrator. Postfächer, OneDrive/Drive, SharePoint/Geteilte Ablagen und Teams/Chat mit einem separaten Sicherungsdienst sichern.
- **Unveränderlich oder offline:** mindestens eine Kopie mit Unveränderlichkeit (Immutability/Object Lock) oder physisch getrennt.
- **Getrennte Identitäten:** Zugang zum Sicherungssystem mit eigenen Konten, phishing-resistenter MFA und **nicht** über die Unternehmensdomäne.
- **Wiederherstellung üben:** quartalsweise einen kritischen Server bzw. eine Anwendung vollständig wiederherstellen und die Dauer messen.

---

## J.7 KI-Agenten und Integrationen technisch absichern (K3–K7, I9)

| Bereich | Umsetzung |
|---|---|
| **Eigene Identität** | Pro Agent eine eigene App-Registrierung bzw. ein eigenes Dienstkonto; keine Nutzung persönlicher Konten oder Tokens |
| **Minimale API-Rechte** | Nur die Berechtigungen, die der Zweck erfordert. In Microsoft 365 Zugriffe auf bestimmte Postfächer bzw. SharePoint-Sites beschränken (z. B. RBAC für Anwendungen in Exchange Online, Berechtigung `Sites.Selected` statt mandantenweiter Rechte) |
| **Geheimnisse** | Zertifikate statt Client-Secrets, verwaltete Identitäten wo möglich, Schlüssel in einem Tresor (Key Vault o. Ä.), nie im Code oder Prompt; regelmäßige Rotation |
| **Ausgehender Netzverkehr** | Laufzeitumgebung des Agenten darf nur freigegebene Ziele erreichen; Rendern externer Bilder und Links in Agentenausgaben unterbinden (häufiger Weg für Datenausleitung nach Prompt Injection) |
| **Freigabeschritt** | Werkzeugaufrufe mit Außenwirkung (Senden, Teilen, Zahlen, Löschen, Rechte ändern) erst nach Bestätigung durch einen Menschen ausführen |
| **Protokollierung** | Prompts, abgerufene Inhalte, Werkzeugaufrufe und Ergebnisse zentral speichern und an das Monitoring anbinden (UC09, UC10) |
| **MCP-Server, Plugins, Erweiterungen** | Nur aus geprüften Quellen und von der Allowlist; Versionen fixieren; Werkzeugbeschreibungen vor Freigabe lesen (manipulierte Beschreibungen können Anweisungen enthalten); jeder Server mit eigenen, minimalen Zugangsdaten |
| **Abhängigkeiten in KI-generiertem Code** | Paketnamen vor Installation auf Existenz, Herkunft, Alter und Verbreitung prüfen; interne Paket-Spiegel bzw. Allowlists nutzen; Secret-Scanning in der Versionsverwaltung |
| **Kill-Switch** | Dokumentiert und getestet: App/Dienstkonto deaktivieren, Tokens widerrufen, Integration trennen – binnen Minuten |
