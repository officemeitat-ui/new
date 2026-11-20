# Überwachung – von der Störung erfahren, bevor der Kunde anruft

Unter **Überwachung** prüft das Cockpit alle paar Minuten, ob Websites und Dienste der Kunden
erreichbar sind.

## Was geprüft werden kann

| Art | Beispiel | In Ordnung, wenn … |
| --- | --- | --- |
| Website / Web-Dienst | `https://www.kunde.at`, Webshop, Webmail, Kundenportal | die Seite antwortet (kein Fehler wie 404 oder 500) – optional mit **Suchtext**, der auf der Seite stehen muss. Verlangt die Seite eine Anmeldung (401/403), gilt der Dienst als erreichbar. |
| Anschluss (TCP) | `mail.kunde.at:587`, VPN, Fernzugang, Warenwirtschaft | der Dienst Verbindungen annimmt |

Der Suchtext erkennt auch den Fall „Seite lädt, zeigt aber nur eine Fehlermeldung“ – zum Beispiel
„Warenkorb“ beim Webshop.

## Was bei einer Störung passiert

1. Ein einzelner Aussetzer löst noch nichts aus; das Cockpit prüft nach einer Minute nach.
2. Nach **zwei Fehlversuchen in Folge** gilt der Dienst als gestört: Es entsteht ein dringendes
   Ticket beim Kunden (mit Glocke, E-Mail und Teams, je nach Einstellung der Benachrichtigungen).
3. Solange die Störung dauert, wird jede Minute nachgeprüft.
4. Antwortet der Dienst wieder, steht die **Ausfalldauer als Notiz im Ticket**. Geschlossen wird
   das Ticket nicht automatisch – das entscheidest du.
5. Fällt derselbe Dienst erneut aus, während das Ticket noch offen ist, kommt eine Notiz dazu statt
   eines zweiten Tickets.

## Verfügbarkeit

Je Dienst zeigt das Cockpit die Verfügbarkeit der letzten 30 Tage in Prozent, die Antwortzeit und
einen Verlauf mit einem Strich je Tag (grün = ohne Fehler, gelb = einzelne Aussetzer, rot = längere
Störung). Der Kunde sieht denselben Status in seinem Portal auf der Startseite – ohne Adressen und
nur für Dienste, bei denen „Im Kundenportal anzeigen“ gesetzt ist.

Die Verfügbarkeit ist aus den Prüfungen gerechnet (Anteil erfolgreicher Prüfungen), nicht aus
Sekunden. Für einen Vertrag mit zugesicherter Verfügbarkeit ist das eine gute Orientierung, aber
kein Messprotokoll.

## Grenzen – wichtig zu wissen

- **Geprüft wird vom Server des Cockpits aus.** Interne Adressen eines Kunden sind nur erreichbar,
  wenn der Server sie erreicht (zum Beispiel über VPN).
- **Fällt dein eigener Internetanschluss aus**, sähe das wie eine Störung aller Kunden aus. Deshalb
  pausiert die Überwachung, wenn in einem Durchgang alle Prüfungen gleichzeitig scheitern (ab drei
  Prüfungen), und meldet das in der Übersicht – ohne Tickets anzulegen. In dieser Zeit erfährst du
  aber auch von echten Störungen nichts.
- **Ein Standort.** Es gibt keine Gegenprobe von einem zweiten Ort; eine Störung auf dem Weg vom
  Cockpit zum Kunden sieht aus wie eine Störung beim Kunden.
- Geprüft wird Erreichbarkeit, nicht Funktion: Ob im Webshop auch bestellt werden kann, zeigt die
  Prüfung nicht.
- Zertifikate und E-Mail-Sicherheit prüft **Domains & E-Mail**, Sicherungen der **Backup-Wächter**.
