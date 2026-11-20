# Suche und „Sicher teilen“

## Globale Suche (Strg+K)

Eine Eingabe durchsucht das ganze Cockpit. Öffnen mit **Strg+K** (Mac: ⌘K), mit **/** oder über
„Suchen“ oben rechts. Mit den Pfeiltasten wählen, mit Enter öffnen.

Durchsucht werden: Kunden, Tickets (auch über die Nummer, z. B. `#128`), Nachrichten, Geräte,
Geräte-Check, Wissen, **Dateien samt Inhalt**, Dokumente, Rechnungen, Angebote, Leads, Lizenzen,
Portal-Kontakte, Microsoft-365-Benutzer, Domains, Ein- und Austritte, Belege. Dazu Seiten des
Cockpits („abrech“ → Abrechnung) und häufige Aktionen („Neues Ticket“).

So wird gesucht:

- Groß- und Kleinschreibung sowie Umlaute sind egal: `muller` findet „Müller“, `strasse` findet „Straße“.
- Mehrere Wörter müssen alle vorkommen: `huber drucker`.
- Es wird auch mitten im Wort gesucht: `vertrag` findet „Wartungsvertrag“.

**Dateiinhalt:** Word, Excel, PowerPoint, OpenDocument, PDF und Textdateien werden beim Ablegen
und bei jedem Speichern ausgelesen (bis 200.000 Zeichen je Datei). Bilder und eingescannte PDFs
ohne Textebene enthalten keinen lesbaren Text – sie werden nur über den Dateinamen gefunden.
Nach dem ersten Start mit vielen vorhandenen Dateien läuft das Einlesen im Hintergrund; die Suche
zeigt an, wie viele Dateien noch ausstehen.

## Sicher teilen

Startpasswörter, WLAN-Schlüssel und Zugangsdaten gehören nicht im Klartext in eine E-Mail.
Unter **Sicher teilen** entsteht stattdessen ein Link, der sich nach dem Öffnen selbst zerstört.

### Passwort oder Zugangsdaten senden

1. Text eingeben (oder „Passwort erzeugen“).
2. Gültigkeit wählen (1 Stunde bis 30 Tage) und wie oft der Link geöffnet werden darf (Standard: einmal).
3. Optional ein zusätzliches Kennwort setzen – das teilst du getrennt mit, zum Beispiel am Telefon.
4. „Link erstellen“ – den Link kopieren oder direkt per E-Mail senden lassen.

Der Empfänger braucht kein Konto. Er sieht eine Seite in deinem Design und klickt auf „Nachricht
anzeigen“. Danach ist die Nachricht gelöscht.

### Datei teilen

**Office & Dateien** → Datei anklicken → **Link teilen**. Der Link läuft ab und ist auf eine
Anzahl von Abrufen begrenzt.

### Was dahintersteckt

| Schutz | Wirkung |
| --- | --- |
| Schlüssel nur im Link | Der Text liegt verschlüsselt in der Datenbank. Den Schlüssel enthält nur der Link; das Cockpit speichert vom Link nur eine Prüfsumme. Auch mit Zugriff auf Datenbank oder Sicherung ist der Text nicht lesbar. |
| Schlüssel hinter dem „#“ | Dieser Teil der Adresse wird vom Browser nie an einen Server gesendet und steht in keinem Protokoll. |
| Anzeige erst nach Klick | Link-Prüfer von Mailprogrammen rufen die Seite ab, klicken aber nicht – die Nachricht wird dadurch nicht verbraucht. |
| Löschen nach Abruf | Nach dem letzten erlaubten Abruf und nach Ablauf wird der verschlüsselte Text gelöscht. |
| Kennwort | Fünf Fehlversuche sperren den Link dauerhaft. |
| Widerruf | Jeder offene Link lässt sich unter „Erstellte Links“ sofort zurückziehen. |
| Nachvollziehbar | Jeder Abruf erscheint mit Zeit und Adresse in der Liste, im Sicherheitsprotokoll und als Benachrichtigung (Glocke). |

**Wichtig:** Der Link wird nur einmal angezeigt, direkt nach dem Erstellen. Das Cockpit kann ihn
später nicht mehr anzeigen – das ist Absicht.

**Datei-Freigaben** sind anders geschützt als Nachrichten: Die Datei selbst liegt wie alle Dateien
unverschlüsselt in der Ablage des Cockpits; der Link begrenzt nur, wer sie wie lange abrufen kann.

### Von außen erreichbar machen

Empfänger außerhalb deines Netzes erreichen den Link nur, wenn die Seite `/s` öffentlich ist.
Im mitgelieferten `deploy/Caddyfile` ist sie zusammen mit dem Kundenportal freigegeben; die
Adresse dafür kommt aus `PUBLIC_URL` in der `.env`. Ohne öffentliche Adresse funktionieren die
Links nur im eigenen Netz.
