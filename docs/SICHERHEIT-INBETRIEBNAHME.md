# Sicherheitsprüfung · Zwei-Faktor-Anmeldung · Erste Schritte

## Ergebnis der Sicherheitsprüfung (von außen erreichbare Teile)

Geprüft: Kundenportal, Anfrageformular, Bewertungsseite, Anmeldung, Datei-Uploads, Exporte, ausgelieferte Seiten.

| Befund | Risiko | Behoben durch |
|---|---|---|
| Anfragen wurden unbegrenzt in den Speicher gelesen (auch ohne Anmeldung) | Server lahmlegen | Größenlimit **vor** dem Einlesen: öffentliche Formulare und Logins 64 KB, Uploads 21 MB, Agent 512 KB |
| Keine Browser-Schutzregel (Content-Security-Policy) | eingeschleuster Code würde ausgeführt | CSP: nur eigene Skripte; eingebettete Skripte der Seiten per Prüfsumme freigegeben |
| CSV-Export der Belege enthielt Texte aus E-Mails unverändert | Formel-Ausführung in Excel beim Steuerberater | Zellen, die mit `= + - @` beginnen, werden entschärft |
| Anmeldung antwortete bei unbekannter Adresse schneller | verrät, welche Adressen ein Konto haben | gleiche Rechenzeit in beiden Fällen (Cockpit und Portal) |
| Passwort-Hash mit 260.000 Runden | unter aktueller Empfehlung | 600.000 Runden (PBKDF2-SHA256); alte Hashes werden bei der nächsten Anmeldung erneuert |
| Rechnungsansicht mit eingebettetem Skript | hätte die CSP aufgeweicht | eigenes Skript ohne Inline-Code |

Unauffällig waren: Sitzungs-Cookies (HttpOnly, SameSite=Strict, Secure unter HTTPS), Trennung der Kunden im Portal,
Datenbankzugriffe (keine zusammengesetzten Abfragen aus Eingaben), Datei-Downloads (keine aktiven Inhalte),
Markdown-Darstellung (keine Links/HTML aus Eingaben).

Hinweise für den Betrieb:

- Der Reverse-Proxy (Caddy) muss auf **demselben Rechner** laufen oder als vertrauenswürdig eingetragen sein
  (Umgebungsvariable `FORWARDED_ALLOW_IPS`), sonst zählen die Anmelde-Limits alle Besucher als eine Adresse.
- Ohne angelegten Benutzer ist das Cockpit offen – *Verbindungen & Sicherheit* zeigt das rot.
- Eine Prüfung durch Dritte (Penetrationstest) ersetzt das nicht; sinnvoll, bevor viele Kunden das Portal nutzen.

## Zwei-Faktor-Anmeldung fürs Cockpit

*Einstellungen → Meine Zwei-Faktor-Anmeldung → Jetzt einrichten*: QR-Code mit Microsoft/Google Authenticator
(oder Keeper) scannen, Code bestätigen, die zehn **Wiederherstellungscodes** sicher ablegen (werden nur einmal gezeigt).

- Jeder Code gilt nur einmal (auch innerhalb seiner 30 Sekunden); mehr als sechs Code-Eingaben in zehn Minuten werden abgelehnt.
- Der geheime Schlüssel liegt verschlüsselt im Tresor (`data/tresor.key` bzw. `MEIT_SECRET_KEY`).
- Handy verloren: mit einem Wiederherstellungscode anmelden – oder ein Admin setzt die Zwei-Faktor-Anmeldung
  unter *Benutzer & Rollen* zurück (alle Sitzungen des Benutzers enden).
- *Verbindungen & Sicherheit* warnt, solange ein Admin ohne zweiten Faktor arbeitet.

## Erste Schritte

*System → Erste Schritte* zeigt die Inbetriebnahme als Checkliste mit **Live-Status** und dem genauen Ort jeder
Einstellung („Wo: Abrechnung → Firmendaten“), dazu die Übersicht „Wo finde ich was?“. Solange Pflichtschritte offen
sind, erscheint ein Hinweis in der Übersicht (ausblendbar). Schritte ohne automatische Prüfung (Preise, Steuerberater,
Auftragsverarbeitungs-Vertrag) werden von Hand abgehakt.

**Demodaten entfernen** löscht die fünf Demokunden samt Tickets, Geräten, Lizenzen, Rechnungen sowie Demo-Nachrichten
und -Leads. Eigene Kunden, Wissensartikel, Leistungen und Einstellungen bleiben; beim nächsten Start werden keine neuen
Demodaten angelegt. Wer von Anfang an ohne Demodaten starten will: `MEIT_SEED_DEMO=false` in der `.env`.
