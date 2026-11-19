# Geräte-Check: eigener Inventar-Agent (nur lesend)

Zeigt je Gerät: Windows-Version und Support-Ende, **BitLocker**, **Virenschutz**, Firewall, **Updates**, Speicherplatz,
lokale Administratoren, RDP, TPM/Secure Boot (Windows-11-Tauglichkeit) und installierte Software.
Daraus entstehen Befunde mit Punktzahl, Tickets, eine Chance im Umsatz-Radar („Arbeitsplätze absichern“),
eine Zeile im Monatsbericht und – für den Kunden – die Spalte „Schutz“ im Portal unter *Geräte*.

## Warum „nur lesend“

Ein Fernwartungs-Agent (Atera, NinjaOne …) kann auf jedem Gerät Befehle ausführen – ein Generalschlüssel.
Dieser Agent ist bewusst eine **Einbahnstraße**:

- Er **sendet** den Zustand per HTTPS ans Cockpit. Die Antwort ist immer nur `{"ok": true}` – es gibt keinen
  Befehlskanal, keine Skriptausführung, kein Nachladen von Programmen. Fernwartung bleibt bei Atera/Splashtop.
- Verbindung nur vom Gerät nach außen, beim Kunden muss kein Port geöffnet werden.
- Das Skript ist kurz und lesbar. `meit-agent.ps1 -ShowOnly` zeigt genau, was gesendet würde (ohne zu senden).
- Ein automatischer Test im Projekt prüft, dass das Skript keine Befehle zum Ausführen/Nachladen von Code und
  keine Systemänderungen enthält und nur im eigenen Ordner schreibt.

## Einrichten

1. Cockpit von außen per **HTTPS** erreichbar machen (`deploy/Caddyfile`, `PUBLIC_URL` in `.env`) – die Agent-Adressen
   liegen unter `/api/public/agent/…` und sind dort bereits freigegeben.
2. *Geräte-Check → Agent installieren*: Skript herunterladen, Kunde wählen, **Registrierungsschlüssel erzeugen**
   (30 Tage gültig, widerrufbar; im Cockpit wird nur eine Prüfsumme gespeichert).
3. Auf den Geräten als Administrator ausführen – einzeln oder über Atera, Intune oder GPO verteilt:

   ```powershell
   powershell -ExecutionPolicy Bypass -File meit-agent.ps1 -Install -Server "https://portal.ihre-domain.at" -Key "meit-…"
   ```

   Das Skript kopiert sich nach `C:\ProgramData\ME-IT\Agent` (nur für SYSTEM und Administratoren lesbar), registriert das
   Gerät, legt den geplanten Task „ME-IT Inventar-Agent“ an (beim Start und alle 6 Stunden, als SYSTEM) und meldet sofort.
4. Entfernen: `powershell -ExecutionPolicy Bypass -File "C:\ProgramData\ME-IT\Agent\meit-agent.ps1" -Uninstall`

Jedes Gerät bekommt bei der Registrierung ein **eigenes Token**. Im Cockpit lässt sich ein Gerät einzeln **sperren**
(Meldungen werden dann abgelehnt) oder entfernen. Wird ein Gerät neu installiert und erneut registriert, bleibt es
dasselbe Gerät (Seriennummer), das alte Token wird ungültig.

## Befunde

| Befund | Stufe |
|---|---|
| Kein aktiver Virenschutz | kritisch |
| Windows ohne Herstellersupport | hoch (endet in < 180 Tagen: mittel) |
| BitLocker aus | Notebook hoch, Desktop mittel, virtuelle Maschinen ausgenommen |
| Firewall-Profil aus | hoch (öffentliches Profil) bzw. mittel |
| Seit > 45 Tagen keine Updates | hoch (> 35 Tage: mittel) |
| Systemlaufwerk < 10 % bzw. < 10 GB frei | hoch (< 15 %: mittel) |
| Virenschutz-Signaturen > 7 Tage alt | mittel |
| Angemeldeter Benutzer ist lokaler Administrator | mittel |
| Neustart seit > 14 Tagen ausständig, RDP auf Arbeitsplatz aktiv, < 8 GB RAM, viele lokale Admins | niedrig |
| Nicht Windows-11-fähig, seit > 14 Tagen keine Meldung | Hinweis |

Befunde lassen sich je Gerät **ausblenden** (z. B. bewusst akzeptiert) oder gesammelt als **Ticket** anlegen.
Geräte erscheinen automatisch unter *Geräte* (neu angelegt oder per Seriennummer/Name zugeordnet).

## Grenzen und Hinweise

- **Noch nicht auf echten Windows-Geräten getestet.** Die Server-Seite ist automatisch getestet; das PowerShell-Skript
  konnte in der Entwicklungsumgebung nicht ausgeführt werden. Zuerst auf einem eigenen Testgerät mit `-ShowOnly`
  und dann mit `-Install` ausprobieren.
- Nur Windows (PowerShell 5.1 oder neuer). macOS/Linux sind nicht abgedeckt.
- Für den Echtbetrieb das Skript mit einem Code-Signing-Zertifikat **signieren** und die Ausführungsrichtlinie
  entsprechend setzen, statt `-ExecutionPolicy Bypass` zu verwenden.
- Eingehende Daten gelten als nicht vertrauenswürdig: Größe max. 512 KB, nur bekannte Felder, begrenzte Längen,
  Meldungen je Gerät und Registrierungen je Adresse sind mengenbegrenzt.
- Datenschutz: Es werden Gerätename, angemeldeter Benutzer, lokale Administratoren und Softwareliste übertragen –
  im Auftragsverarbeitungs-Vertrag mit dem Kunden erwähnen.
