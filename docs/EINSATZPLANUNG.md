# Einsatzplanung – Termine, Arbeitsbericht mit Unterschrift, Kalender-Abo

Unter **Einsatzplanung** steht die Woche aller Techniker auf einen Blick. Termine entstehen dort,
direkt aus einem Ticket („Termin planen“) oder auf der Kundenseite.

## Mein Tag

**Mein Tag** ist die persönliche Startseite – Techniker landen nach der Anmeldung direkt dort:

- **Als Nächstes:** der nächste Einsatz mit Uhrzeit, Kunde, Ort (Route in Google Maps) und Hinweisen,
  mit direktem Sprung zum Arbeitsbericht.
- **Heute und morgen:** die eigenen Termine.
- **Meine Tickets:** nach Dringlichkeit sortiert; dazu die Zahl der Tickets, die noch niemand hat.
- **Wartet auf Unterschrift:** Arbeitsberichte, die noch nicht abgeschlossen sind.
- **Wartung fällig:** was in den nächsten sieben Tagen ansteht oder überfällig ist.
- **Zeit:** heute geplant, heute gebucht, diese Woche gebucht.

Ohne Benutzerkonten zeigt die Seite alles für alle.

## Termin anlegen

| Feld | Bedeutung |
| --- | --- |
| Art | 🚗 vor Ort · 🖥 Fernwartung · 📞 Telefon · 🏠 intern |
| Techniker | wer fährt hin. Der Techniker bekommt eine Meldung in der Glocke – auch bei Verschiebung und Absage. |
| Ort | bleibt bei „Vor Ort“ leer → die Adresse des Kunden wird eingesetzt. Im Termin führt der Ort zur Route in Google Maps. |
| Hinweis für den Kunden | steht in der Terminbestätigung und im Kundenportal, z. B. „Der Server ist ca. 30 Minuten nicht erreichbar.“ |
| Interne Notiz | sieht der Kunde nie – weder in der E-Mail noch im Portal noch im Kalender-Abo. |

**Überschneidungen** beim selben Techniker werden mit ⚠ markiert und beim Speichern gemeldet,
aber nicht verboten – manchmal ist das Absicht (zwei kurze Termine im selben Haus).

## Vom Termin zur Rechnung

**Erledigt** schließt den Termin ab und bucht die Zeit auf Kunde und Ticket. Die tatsächliche Dauer
lässt sich anpassen; gebucht wird genau einmal. Die Zeit erscheint danach wie jede andere unter
**Abrechnung**.

## Arbeitsbericht mit Unterschrift des Kunden

Der Leistungsnachweis direkt nach dem Einsatz – am Handy oder Tablet:

1. Im Termin (oder im Ticket) auf **Arbeitsbericht** tippen. Datum, Zeiten, Ort und Techniker sind vorausgefüllt.
2. Tätigkeiten eintragen, bei Bedarf Material und Anfahrt.
3. **Weiter zur Unterschrift**: Der Kunde sieht den Bericht und unterschreibt mit dem Finger am Bildschirm.
4. Das Cockpit erzeugt daraus ein PDF in deinem Design, legt es im Kundenordner ab (auch in SharePoint/OneDrive,
   falls eingerichtet), bucht die Zeit, schließt den Termin ab und schickt den Bericht auf Wunsch sofort per E-Mail.

Gut zu wissen:

- **Niemand da?** „Ohne Unterschrift abschließen“ verlangt einen Grund (z. B. „Fernwartung“) – der steht dann im PDF.
- **Unveränderlich:** Ein abgeschlossener Bericht lässt sich weder ändern noch löschen. Entwürfe schon.
- **Nummern** laufen je Jahr fortlaufend (`AB-2026-0001`).
- **Zeit** wird genau einmal gebucht – auch wenn der Termin zusätzlich auf „Erledigt“ gesetzt wird.
- **Material** steht als Nachweis im Bericht; verrechnet wird es wie bisher über die Rechnung.
- Der Kunde findet seine Berichte im Portal unter **Rechnungen & Dokumente**.
- Rechtlich ist die Unterschrift am Bildschirm eine *einfache elektronische Signatur*: als Leistungsnachweis
  üblich, aber keine qualifizierte Signatur. Für Verträge mit Formvorschrift reicht sie nicht.

## Kunden informieren

**Kunden informieren** schickt eine Terminbestätigung per E-Mail – mit Wochentag, Uhrzeit, Art,
Ort, Techniker, deinem Hinweis und einer Kalenderdatei (`.ics`) im Anhang. Der Termin gilt danach
als „bestätigt“.

Wird ein bereits bestätigter Termin verschoben oder abgesagt, fragt das Cockpit nach, ob der Kunde
informiert werden soll. Die neue Kalenderdatei ersetzt in Outlook und am Handy den alten Eintrag.

Dafür muss der Mailversand eingerichtet sein (Postfach verbinden).

## Kalender abonnieren (Outlook, iPhone, Android)

**Kalender abonnieren** erzeugt einen geheimen Link. Damit erscheinen die Einsätze als eigener
Kalender im Kalenderprogramm und aktualisieren sich selbst.

- **Meine Termine** – nur die eigenen Einsätze.
- **Alle Einsätze (Team)** – alles, zum Beispiel für die Disposition.

Wichtig zu wissen:

- Der Link wird nur einmal angezeigt. Ein neuer Link macht den alten ungültig.
- Übertragen werden Titel, Kunde, Ort, Art und Ticketnummer – **nie** interne Notizen.
- Wer über Google oder Apple abonniert, speichert diese Angaben auch dort.
- Wird ein Benutzer deaktiviert, endet sein Abo sofort.
- Kalenderprogramme holen Änderungen in eigenen Abständen ab (30 Minuten bis einige Stunden).
  Für kurzfristige Änderungen zählt die Glocke im Cockpit.
- Das Cockpit muss dafür unter einer festen Adresse erreichbar sein (`PUBLIC_URL` in der `.env`;
  im mitgelieferten `deploy/Caddyfile` ist der Abo-Link von außen erreichbar).

## Kundenportal

Der Kunde sieht auf der Startseite seines Portals „Ihre nächsten Termine“ mit Zeit, Art, Ort,
Vornamen des Technikers und deinem Hinweis – und kann den Termin in seinen Kalender übernehmen.
Interne und abgesagte Termine erscheinen dort nicht.

## Zeiten und Sommerzeit

Termine werden in der Ortszeit des Servers gespeichert. In Kalenderdateien stehen sie in Weltzeit,
damit jedes Gerät sie richtig anzeigt – auch über die Zeitumstellung hinweg. Der Server muss dafür
auf die richtige Zeitzone eingestellt sein (Österreich: `Europe/Vienna`).

## Was bewusst fehlt

- Keine Serientermine – wiederkehrende Arbeiten gehören in den **Wartungsplan**.
- Kein Abgleich in die andere Richtung: Einträge aus Outlook erscheinen nicht im Cockpit.
- Keine Fahrzeit- oder Routenplanung.
