# Sichere Anbindungen: Microsoft 365, SharePoint, To Do, BookStack

Grundsätze: **so wenig Rechte wie möglich**, **Zertifikat statt Passwort**, **gespeicherte Anmeldungen
verschlüsselt**, alles im Cockpit unter **System → Verbindungen & Sicherheit** prüfbar. Der Live-Test liest bei
Microsoft die tatsächlich erteilten Rechte aus dem Token und zeigt rot, was zu weit geht.

---

## 1. App-Registrierung „ME-IT Cockpit“ (eigener Tenant)

Entra ID → App-Registrierungen → Neue Registrierung (*nur Konten in diesem Organisationsverzeichnis*).
Werte in `.env`: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_MAILBOX`.

### Zertifikat statt Geheimnis

1. Cockpit → **Verbindungen & Sicherheit** → *Microsoft 365* → **Zertifikat erzeugen**
   (oder auf dem Server: `python -m meit.msauth zertifikat`).
2. **ME-IT-Cockpit.cer herunterladen** – das ist nur der öffentliche Teil.
3. App-Registrierung → *Zertifikate & Geheimnisse → Zertifikate → Zertifikat hochladen*.
4. Im Cockpit **Aktivieren & testen**. Erst wenn Microsoft das Zertifikat akzeptiert, wird es verwendet.
5. Danach `GRAPH_CLIENT_SECRET` aus der `.env` **und** das Geheimnis in der App-Registrierung löschen.

Der private Schlüssel (`data/zertifikate/*.pem`, nur für den Dienst lesbar) verlässt den Server nie.
Anmeldung nach Microsoft-Vorgabe: signierte Client-Assertion (PS256, `x5t#S256`). Ablauf nach 2 Jahren –
das Verbindungs-Center warnt 30 Tage vorher.

### Rechte je Funktion (Anwendungsberechtigungen)

| Funktion | Berechtigung | Einschränken |
|---|---|---|
| Postfach (KI-Mitarbeiter, Versand) | `Mail.ReadWrite`, `Mail.Send` | **nur das ME-IT-Postfach**, siehe unten |
| Terminvorschläge (`GRAPH_CALENDAR=true`) | `Calendars.Read` | ebenfalls auf das Postfach beschränken |
| Dokumentenablage SharePoint | **`Sites.Selected`** | nur die eine Site freigeben, siehe unten |
| Dokumentenablage OneDrive | `Files.ReadWrite.All` | (OneDrive kennt kein „Selected“ – SharePoint bevorzugen) |

Nicht vergeben: `Directory.ReadWrite.All`, `User.ReadWrite.All`, `Sites.FullControl.All`, `Application.ReadWrite.All`
– das Verbindungs-Center markiert sie rot.

### Postfach-Rechte auf das ME-IT-Postfach beschränken (Exchange Online, RBAC für Anwendungen)

Ohne diese Einschränkung könnte die App **jedes** Postfach des Tenants lesen. In PowerShell
(`Connect-ExchangeOnline` als Exchange-Admin), Werte ersetzen:

```powershell
New-ServicePrincipal -AppId <GRAPH_CLIENT_ID> -ObjectId <Objekt-ID der Unternehmensanwendung> -DisplayName "ME-IT Cockpit"
New-ManagementScope -Name "ME-IT Cockpit Postfach" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'office@ihre-domain.at'"
New-ManagementRoleAssignment -App <GRAPH_CLIENT_ID> -Role "Application Mail.ReadWrite" -CustomResourceScope "ME-IT Cockpit Postfach"
New-ManagementRoleAssignment -App <GRAPH_CLIENT_ID> -Role "Application Mail.Send" -CustomResourceScope "ME-IT Cockpit Postfach"
Test-ServicePrincipalAuthorization -Identity <GRAPH_CLIENT_ID> -Resource office@ihre-domain.at
```

Danach `Mail.ReadWrite`/`Mail.Send` in der App-Registrierung **entfernen** (sonst gilt die tenant-weite Freigabe
weiter). Der Live-Test zeigt die Mail-Rechte dann nicht mehr im Token – die Warnung verschwindet.

### SharePoint: nur die Ablage-Site (Sites.Selected)

1. App-Registrierung: `Sites.Selected` (Anwendung) hinzufügen, Zustimmung erteilen; `Sites.ReadWrite.All` /
   `Files.ReadWrite.All` entfernen.
2. Cockpit → Verbindungen → *SharePoint* → **Nur diese Site freigeben** zeigt die zwei Graph-Aufrufe
   (Site-ID abfragen, Freigabe `POST /sites/{site-id}/permissions` mit Rolle `write` für die App) zum Kopieren –
   einmalig im Graph-Explorer als SharePoint-Administrator ausführen.
3. **Live testen**: Lesen *und* Schreiben (Testdatei anlegen und löschen) müssen grün sein.

---

## 2. Microsoft To Do

To Do erlaubt **keine** App-weiten Rechte – das ist gut: Jeder Mitarbeiter verbindet nur seine **eigenen**
Aufgaben (delegiert, `Tasks.ReadWrite`, `User.Read`, `offline_access`).

Einmalig in der App-Registrierung (oder einer eigenen, dann `TODO_CLIENT_ID` setzen):
*Authentifizierung → Erweiterte Einstellungen → „Öffentliche Clientflows zulassen“ = **Ja***;
*API-Berechtigungen → Delegiert:* `Tasks.ReadWrite`, `User.Read`, `offline_access` (optional Admin-Zustimmung).

Dann je Mitarbeiter: Cockpit → *Verbindungen & Sicherheit* → **Mit Microsoft verbinden** → Code auf
microsoft.com/devicelogin eingeben → fertig. Es entsteht die Liste **„ME-IT Cockpit“**:

| Im Cockpit | In To Do |
|---|---|
| Ticket (mir zugewiesen bzw. dringend) | Aufgabe mit Link zurück ins Ticket, „wichtig“ bei hoch/kritisch |
| Ticket gelöst | Aufgabe erledigt |
| Ein-/Austritt | Aufgabe mit **Checkliste**, Fälligkeit = Stichtag |
| Schritt im Cockpit abgehakt | Unterpunkt in To Do abgehakt – **und umgekehrt** (am Handy abhaken → Cockpit) |
| Ticket jemand anderem zugewiesen | Aufgabe verschwindet aus meiner Liste |

In To Do gelöschte Aufgaben werden nicht wieder angelegt. Eine in To Do erledigte Ticket-Aufgabe schließt das
Ticket **nicht** (die Lösung fehlt) – es gibt einen Hinweis im Aktivitätenprotokoll. Abgleich alle 10 Minuten
(`TODO_SYNC_MINUTES`) oder per Knopf. Ohne Benutzerverwaltung (Einzelbetrieb) werden dringende Tickets übernommen.

Das Anmelde-Token ist **verschlüsselt** gespeichert (Tresor, Schlüssel `data/tresor.key` oder `MEIT_SECRET_KEY`).
Trennen: Cockpit → *Trennen*; zusätzlich in Microsoft unter *Mein Konto → Apps* widerrufbar.

---

## 3. BookStack

1. In BookStack eine Rolle **„Cockpit-API“** anlegen: *Systemberechtigungen → Zugriff auf System-API*,
   sonst **keine** Admin-Rechte (keine Benutzer-/Rollen-/Einstellungsverwaltung).
   Inhaltsrechte: Bücher/Seiten erstellen und bearbeiten – am besten nur im Regal für IT-Doku und Wissen.
2. Benutzer `cockpit@…` mit nur dieser Rolle anlegen, als dieser Benutzer *Profil → API-Tokens* erzeugen.
3. `.env`: `BOOKSTACK_URL` (**https://**), `BOOKSTACK_TOKEN_ID`, `BOOKSTACK_TOKEN_SECRET`.
4. Cockpit → Verbindungen → *BookStack* → **Live testen**: Das Cockpit probiert Benutzer-, Rollen- und
   Audit-Log-Zugriff und warnt, falls der Token Admin-Rechte hat; ohne HTTPS über das Internet = rot.

Zugangsdaten gehören nicht ins Wiki: vor jedem Export schwärzt der Passwort-Wächter Klartext-Passwörter (→ Keeper).

---

## 4. Weitere Prüfungen im Verbindungs-Center

- **Cockpit-Zugang**: rot ohne Anmeldung; Hinweis, wenn das Cockpit im Netzwerk lauscht; öffentliche Adresse nur mit HTTPS.
- **Kunden-Tenants** (Microsoft 365 der Kunden): Die Kunden-App darf **nur lesen** – jedes `…Write…`-Recht ist rot.
- **Atera**: Der API-Schlüssel hat Vollzugriff – nur in der `.env` auf dem Server, bei Personalwechsel neu erzeugen.
- **Claude**: Cloud an/aus, Pseudonymisierung, Budget.
- **Datensicherung**: Alter der letzten Sicherung. `tresor.key` und `data/zertifikate/` liegen bewusst getrennt von der
  Datenbank – für eine Wiederherstellung separat und sicher aufbewahren (z. B. in Keeper).
