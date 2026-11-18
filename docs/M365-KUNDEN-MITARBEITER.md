# Microsoft 365 der Kunden · Ein- und Austritte

Zwei Abläufe, die bei fast jedem Kunden laufend anfallen: **Ist das Microsoft 365 sicher und stimmt die
Lizenzrechnung?** und **Ein Mitarbeiter kommt oder geht – ist an alles gedacht?**

---

## 1. Microsoft 365 der Kunden

### Einmalig bei ME-IT einrichten (ca. 10 Minuten)

1. Entra ID (eigener Tenant) → **App-Registrierungen → Neue Registrierung**
   - Name: z. B. „ME-IT Cockpit – Kundenüberwachung“
   - Unterstützte Kontotypen: **Konten in einem beliebigen Organisationsverzeichnis (mehrinstanzenfähig)**
   - Umleitungs-URI (Web): `https://<cockpit-adresse>/api/public/m365/consent`
     (die genaue Adresse zeigt das Cockpit unter *Microsoft 365 → Anleitung*; mit `PUBLIC_URL` die öffentliche Adresse)
2. **API-Berechtigungen → Microsoft Graph → Anwendungsberechtigungen** (alle nur lesend):

   | Berechtigung | wofür |
   |---|---|
   | `Directory.Read.All` | Benutzer, Lizenzen, Admin-Rollen, Domains |
   | `AuditLog.Read.All` | letzte Anmeldung (ungenutzte Konten) |
   | `Reports.Read.All` | MFA-Registrierungsbericht |
   | `UserAuthenticationMethod.Read.All` | MFA-Methoden je Benutzer (falls kein Bericht) |
   | `MailboxSettings.Read` | Posteingangsregeln (externe Weiterleitungen) |
   | `SecurityEvents.Read.All` | Microsoft Secure Score |
   | `Policy.Read.All` | Sicherheitsstandards, bedingter Zugriff |

3. **Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel**
4. In `.env`: `M365_CLIENT_ID=…` und `M365_CLIENT_SECRET=…` (leer = es werden `GRAPH_CLIENT_ID/SECRET` verwendet),
   optional `M365_SYNC_HOURS=24`. Cockpit neu starten.

> Die App hat **keine Schreibrechte**. Das Cockpit kann im Tenant des Kunden nichts verändern.
> Für den Kunden-Tenant braucht es weder GDAP noch ein Passwort – nur die einmalige Zustimmung.

### Kunden verbinden

Kunde → **Microsoft 365 → Verbinden** (oder *Microsoft 365 → + Kunde verbinden*):
Domain eingeben → **Zustimmungs-Link erzeugen** → Link (bzw. den fertigen Mailtext) dem globalen Administrator
des Kunden schicken oder gemeinsam öffnen → „Akzeptieren“. Der Kunde landet auf einer Bestätigungsseite im
ME-IT-Design, im Cockpit steht der Tenant auf „verbunden“. Danach **Jetzt abrufen** – ab dann täglich automatisch.

Jeder Link gilt nur einmal. Trennen: Kunde → Microsoft 365 → Details → *Trennen* (löscht die abgerufenen Daten;
im Tenant des Kunden zusätzlich die Unternehmensanwendung entfernen).

### Was geprüft wird

| Befund | Stufe | Warum |
|---|---|---|
| **Externe Weiterleitung** per Posteingangsregel | kritisch → **Ticket wird automatisch angelegt** | typisches Zeichen für ein übernommenes Postfach (Rechnungsbetrug) |
| Regel, die Mails versteckt/löscht (z. B. „Rechnung“ → RSS-Ordner, gelesen markieren) | hoch | ebenfalls typisch nach Konto-Übernahme |
| Admin-Konto ohne MFA | kritisch | häufigster Einstieg in Microsoft 365 |
| Benutzer ohne MFA | hoch/mittel | ein gestohlenes Passwort reicht |
| Keine MFA-Pflicht (Sicherheitsstandards aus, keine Richtlinie) | hoch | registrierte MFA wird nicht erzwungen |
| Mehr als 4 bzw. nur 1 globaler Admin, Admins mit Postfach | mittel/niedrig | Angriffsfläche bzw. kein Notfallzugang |
| Gesperrte Konten mit Lizenz, > 90 Tage ohne Anmeldung | mittel | Kosten + unbeobachtete Konten (mit €-Einsparung, sofern Preis hinterlegt) |
| Inaktive Gastkonten (> 180 Tage) | niedrig | externer Zugriff auf Teams/SharePoint |
| Secure Score unter 60 % (unter 40 % = hoch) | mittel/hoch | Verlauf wird gespeichert und im Bericht gezeigt |

Jeder Befund: **Ticket anlegen** (mit betroffenen Benutzern und Empfehlung) oder **Ausblenden** (z. B. bewusst
akzeptiertes Notfall-Admin-Konto). Ausgeblendete Befunde zählen nicht mehr in Übersicht, Radar und Bericht.

Hinweis: Letzte Anmeldung und der MFA-Bericht benötigen im Tenant **Entra ID P1** (z. B. in Business Premium
enthalten). Ohne P1 prüft das Cockpit die MFA-Methoden je Benutzer einzeln (bis 300 Benutzer); ungenutzte
Konten werden dann nicht erkannt – das steht unter „Hinweise zum Abruf“.

### Lizenzabgleich mit der Rechnung

Für jedes kostenpflichtige Microsoft-Produkt im Tenant vergleicht das Cockpit **gekauft / zugewiesen / verrechnet**
(Anzahl unter *Lizenzen & Verträge*). Die Zuordnung erfolgt automatisch über den Namen
(„Microsoft 365 Business Premium“ ↔ `SPB`) oder per Auswahl im Detailfenster.

- **Mehr zugewiesen als verrechnet** → Befund „hoch“ mit €/Monat, **Anzahl übernehmen** mit einem Klick
  (gilt ab dem nächsten Rechnungslauf), erscheint als Chance im Umsatz-Radar („Nachverrechnen“).
- **Mehr verrechnet als zugewiesen** → Einsparung für den Kunden (Vertrauen, spätestens im QBR ein Thema).
- **Gekauft, aber nicht zugewiesen** → freie Lizenzen beim nächsten Eintritt verwenden.
- **Nicht erfasst** → **Als Lizenz anlegen** (Preis ergänzen, dann läuft sie im Rechnungslauf mit).

Monatsbericht und QBR enthalten MFA-Abdeckung, Secure Score (mit Vorwert) und offene kritische Befunde.

---

## 2. Ein- und Austritte

**Ein- & Austritte → + Eintritt / + Austritt** (oder direkt beim Kunden). Daraus entstehen:

- eine **Checkliste** aus der Vorlage (Konto, Lizenz, MFA, Gerät, Keeper, Berechtigungen, Einweisung bzw.
  Sperre zum Stichtag, Postfach, Datenübergabe, Gerät zurück, Lizenz frei, Keeper-Zugänge),
- ein **Ticket** (Kategorie *Benutzerverwaltung*; automatische Zuweisung, falls aktiviert).

Beim Austritt kann die Person direkt aus der Microsoft-365-Benutzerliste gewählt werden.
Schritte abhaken (wer/wann wird gespeichert), eigene Schritte ergänzen. Sind alle erledigt – oder per
**Abschließen** – passiert automatisch:

- **Lizenzanzahl ±1** der gewählten Lizenz (→ nächste Rechnung stimmt), abschaltbar je Vorgang,
- **Mitarbeiterzahl** des Kunden ±1 (Lizenz-Abgleich, Health Score, Radar),
- Ticket gelöst mit Protokoll der erledigten Schritte, Eintrag im Aktivitätenprotokoll und Monatsbericht.

**Kundenportal → Mitarbeiter**: Der Kunde meldet Ein-/Austritte selbst (Stichtag, Lizenz, Gerät, Postfach,
Übergabe), sieht den Fortschritt jedes Vorgangs und – wenn Microsoft 365 verbunden ist – seine Konten mit
Lizenz, letzter Anmeldung und **ob die Zwei-Faktor-Anmeldung aktiv ist**.

**Vorlagen** (Ein- & Austritte → Vorlagen): ein Schritt pro Zeile, Platzhalter `{person} {datum} {abteilung}
{lizenz} {geraet} {postfach} {uebergabe} {weiterleitung}`. Mit `?feld ` am Zeilenanfang erscheint der
Schritt nur, wenn das Feld ausgefüllt ist (z. B. `?telefon Teams-Telefonie einrichten`).

Die Übersicht zeigt anstehende Vorgänge (14 Tage) mit Fortschritt; überfällige werden rot markiert.
