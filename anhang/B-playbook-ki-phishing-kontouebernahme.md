# Anhang B – Playbook: KI-Phishing und Kontoübernahme

> Zurück zur [Strategie](../KI-Cybersicherheitsstrategie.md)

**Gilt für:** Phishing per E-Mail, SMS, Messenger, QR-Code oder Telefon sowie den Verdacht, dass ein Benutzerkonto (E-Mail, Cloud, VPN, Fachanwendung) übernommen wurde – einschließlich Business E-Mail Compromise (BEC).

**Ziel:** Angreifer innerhalb von Minuten aussperren, Umfang bestimmen, Folgeangriffe (Rechnungsbetrug, interne Phishing-Welle, Datenabfluss) verhindern.

---

## 1. Auslöser

- Mitarbeitende/r meldet: Link geklickt, Zugangsdaten oder Code eingegeben, Anhang geöffnet
- MFA-Anfrage, die man nicht selbst ausgelöst hat (insbesondere mehrfach hintereinander)
- Hinweis auf unbekannte Anmeldung, neue MFA-Methode oder Passwortänderung
- Mails im „Gesendet“-Ordner, die man nicht geschrieben hat; Rückfragen von Kontakten zu unbekannten Mails
- Alarm aus Monitoring/MDR (z. B. unmögliche Reise, neue Posteingangsregel, App-Zustimmung, Massen-Download)

## 2. Sofortmaßnahmen (Ziel: ≤ 30 Minuten)

| # | Maßnahme | Hinweis |
|---|---|---|
| 1 | **Alle aktiven Sitzungen und Tokens widerrufen** | Ein reines Passwort-Reset reicht nicht – gestohlene Sitzungs-Cookies bleiben sonst gültig |
| 2 | **Passwort zurücksetzen** | Über sicheren Kanal mitteilen; Identität der Person nach Helpdesk-Prozess prüfen |
| 3 | **Registrierte MFA-Methoden prüfen** und unbekannte entfernen | Angreifer registrieren gern eigene Methoden |
| 4 | **Posteingangsregeln und Weiterleitungen prüfen** und bösartige entfernen | Typisch: Weiterleitung nach extern, Verschieben/Löschen von Mails mit „Rechnung“, „Zahlung“, „Bank“ |
| 5 | **App-Zustimmungen (OAuth) prüfen** und unbekannte widerrufen | Diese überdauern Passwortänderungen |
| 6 | **Endgerät isolieren**, falls ein Anhang geöffnet oder Software ausgeführt wurde | Über EDR; Gerät nicht neu starten, bevor Beweise gesichert sind |
| 7 | **Protokolle sichern** (Anmelde-, Audit-, Postfach- und Cloud-Protokolle) | Vor Ablauf der Aufbewahrungsfrist exportieren |

## 3. Umfang bestimmen

- Von welchen IP-Adressen und Geräten erfolgten Anmeldungen? Seit wann?
- Auf welche Mails, Dateien und Anwendungen wurde zugegriffen? Gab es Massen-Downloads oder Synchronisationen?
- Wurden **Mails im Namen der Person versendet** – intern (Phishing-Welle) oder an Kunden/Lieferanten (Rechnungsbetrug)?
- Gibt es **laufende Zahlungsvorgänge oder Rechnungen** in den betroffenen Konversationen? → Finanzen und betroffene Partner sofort warnen, Zahlungen prüfen.
- Wurden mit dem Konto weitere Konten oder Systeme erreicht (Single Sign-on, gespeicherte Passwörter, Admin-Rechte)?
- Wurden **personenbezogene Daten** offengelegt? → Datenschutz einbinden.

## 4. Eindämmen und bereinigen

1. **Gleiche Phishing-Mail organisationsweit suchen und löschen**; Absender, Domain und URLs sperren.
2. Alle Personen identifizieren, die ebenfalls geklickt oder Daten eingegeben haben → Schritte 2–3 auch für sie.
3. Bei Schadsoftware: Gerät neu aufsetzen statt nur „bereinigen“.
4. Betroffene Partner informieren, wenn aus dem Konto heraus Mails an sie gingen.
5. Auf eine zweite Welle achten: Angreifer nutzen gestohlene Konversationen für Wochen weiter.

## 5. Melden

| Pflicht | Frist | Zuständig |
|---|---|---|
| NISG 2026 (bei erheblichem Vorfall, falls betroffen) – an das zuständige CSIRT | Frühwarnung ≤ 24 h, Meldung ≤ 72 h, Abschlussbericht ≤ 1 Monat | Informationssicherheit |
| DSGVO (bei Verletzung des Schutzes personenbezogener Daten) – an die Datenschutzbehörde | ≤ 72 h | Datenschutz |
| Benachrichtigung betroffener Personen (bei hohem Risiko) | unverzüglich | Datenschutz |
| Versicherung | laut Polizze | Geschäftsführung |
| Polizei (bei Schaden oder Betrug) | zeitnah | Geschäftsführung / Recht |

## 6. Nachbereitung

- Warum hat die MFA nicht geschützt? → **Umstieg auf phishing-resistente MFA** (Passkeys/FIDO2) für das Konto priorisieren.
- Warum hat der E-Mail-Filter nicht gegriffen? Erkennungsregeln anpassen.
- Rückmeldung an die meldende Person – **Dank für die Meldung**, keine Schuldzuweisung.
- Anonymisierte Fallbeschreibung für die nächste Schulung.

## 7. Prävention (Verweise auf die Strategie)

I1 Phishing-resistente MFA · I2 Legacy-Authentifizierung blockieren · I4 Bedingter Zugriff · I6 App-Zustimmungen einschränken · T1–T4 E-Mail-Sicherheit · R2 Erkennungsregeln · M3/M4 Schulung und Simulation
