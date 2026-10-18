# Anhang A – Playbook: Deepfake-, CEO- und Zahlungsbetrug

> Zurück zur [Strategie](../KI-Cybersicherheitsstrategie.md) · Verknüpft mit [Anhang E – Verifikationsregeln](E-verifikationsregeln.md)

**Gilt für:** Täuschungsversuche per Telefon, Sprachnachricht, Videokonferenz, E-Mail oder Messenger, bei denen sich Angreifer als Führungskraft, Kollegin/Kollege, Lieferant, Kunde, Bank oder Behörde ausgeben – mit oder ohne KI-gefälschte Stimme bzw. Video.

**Ziel:** Kein Geld- oder Datenabfluss. Falls doch: Schaden durch schnelles Handeln in den ersten Stunden begrenzen.

---

## 1. Typische Anzeichen

- Ungewöhnliche Bitte um **Überweisung**, **Änderung einer Bankverbindung**, Kauf von Gutscheinkarten oder Herausgabe vertraulicher Daten
- **Dringlichkeit** („muss heute noch raus“) und **Geheimhaltung** („sprechen Sie mit niemandem darüber“, „vertrauliche Übernahme“)
- **Umgehung des normalen Prozesses** („ausnahmsweise ohne Freigabe“, „ich bin gerade im Flieger“)
- **Ungewohnter Kanal:** private Nummer, neues Messenger-Konto, kurzfristiger Videocall mit schlechter Verbindung oder ausgeschalteter Kamera
- Stimme oder Bild wirken echt – **das ist kein Beweis**

## 2. Während des Kontakts – für alle Mitarbeitenden

| Schritt | Handlung |
|---|---|
| 1 | **Nichts ausführen.** Keine Zahlung, keine Datenänderung, keine Weitergabe. |
| 2 | **Gespräch höflich beenden:** „Ich rufe Sie gleich über die bekannte Nummer zurück.“ Diese Reaktion ist ausdrücklich erlaubt und gewünscht. |
| 3 | **Rückruf über die hinterlegte Nummer** (Telefonverzeichnis, Stammdaten) – nie über die Nummer oder den Link aus der Anfrage. Optional Codewort abfragen. |
| 4 | **Zweite Person einbeziehen** (Vier-Augen-Prinzip). |
| 5 | **Melden** an [ANPASSEN: Informationssicherheit, Tel./Mail] – auch wenn sich die Anfrage als echt herausstellt oder abgelehnt wurde. |
| 6 | **Nichts löschen:** Mails, Anrufliste, Sprachnachrichten, Chatverläufe aufbewahren. |

## 3. Reaktion bei Verdacht ohne Schaden (Informationssicherheit)

1. Vorfall erfassen (Zeitpunkt, Kanal, angebliche Identität, Inhalt, Telefonnummern, Absenderadressen).
2. **Prüfen, ob ein Konto kompromittiert ist:** Kam die Anfrage von einer echten internen Adresse oder aus einer echten Mail-Konversation? → [Playbook B](B-playbook-ki-phishing-kontouebernahme.md).
3. **Gezielte Warnung** an besonders betroffene Gruppen (Finanzen, Assistenz, Helpdesk), da Angreifer oft mehrere Personen kontaktieren.
4. Echte imitierte Person (Führungskraft, Lieferant) informieren.
5. Absender, Domains und Nummern sperren; Lookalike-Domain ggf. melden.
6. Bei Bezug zu Lieferanten oder Kunden: diese warnen.
7. Fall (anonymisiert) für Schulungen nutzen.

## 4. Reaktion bei bereits erfolgter Zahlung – **jede Minute zählt**

| Zeit | Handlung | Verantwortlich |
|---|---|---|
| **sofort** | **Hausbank anrufen** (Betrugs-/Notfallnummer), Rückruf bzw. Rückholung der Überweisung verlangen, Empfängerbank und IBAN nennen | Finanzen |
| **sofort** | Weitere ausstehende Zahlungen an dieselbe Empfänger-IBAN stoppen | Finanzen |
| ≤ 1 h | Informationssicherheit und Geschäftsführung informieren, Krisenteam bei größerem Schaden | Melder/in |
| ≤ 2 h | **Beweise sichern:** Mails inkl. vollständiger Kopfzeilen, Anruflisten, Aufnahmen, Screenshots, Überweisungsbelege | Informationssicherheit |
| ≤ 24 h | **Anzeige bei der Polizei** (jede Polizeidienststelle; Unterlagen mitbringen) | Geschäftsführung / Recht |
| ≤ 24 h | **Cyber-Versicherung** informieren (Meldefristen der Polizze beachten) | Geschäftsführung |
| ≤ 24 h | Prüfen, ob Meldepflichten bestehen (NISG 2026: Frühwarnung ≤ 24 h bei erheblichem Vorfall; DSGVO ≤ 72 h bei Datenschutzverletzung) | Informationssicherheit, Datenschutz |
| ≤ 48 h | Ursachenanalyse: Wie kam der Angreifer an die Informationen? Kompromittiertes Postfach? → [Playbook B](B-playbook-ki-phishing-kontouebernahme.md) | Informationssicherheit |
| ≤ 2 Wochen | Lessons Learned, Anpassung von Prozessen, Limits und Schulungen | Informationssicherheit |

> **Wichtig:** Keine Schuldzuweisung an die betroffene Person. Professionelle Deepfakes täuschen auch erfahrene Fachleute. Entscheidend ist, dass schnell gemeldet wurde.

## 5. Sonderfall: Deepfake der eigenen Führung in der Öffentlichkeit

Wenn ein gefälschtes Video oder Audio der Geschäftsführung in Umlauf ist:

1. Echtheit intern klären (betroffene Person direkt und persönlich kontaktieren).
2. Kommunikation übernimmt: vorbereitete Stellungnahme über **verifizierte Kanäle** (Website, offizielle Social-Media-Konten, Presseverteiler).
3. Plattformen zur Entfernung auffordern (Meldefunktionen, ggf. rechtliche Schritte).
4. Kunden, Partner und Mitarbeitende proaktiv informieren, wenn Täuschungsversuche gegen sie zu erwarten sind.
5. Beweise sichern, Anzeige erwägen.

## 6. Notfallkontakte [ANPASSEN]

| Stelle | Kontakt |
|---|---|
| Informationssicherheit (intern) | |
| Geschäftsführung | |
| Hausbank – Betrugs-/Notfallnummer | |
| Incident-Response-Dienstleister | |
| Cyber-Versicherung (Schadensmeldung) | |
| Polizei | 133 (Notruf) bzw. nächste Dienststelle |
| WKO Cyber-Security-Hotline | 0800 888 133 |
| CERT.at | <https://www.cert.at/> |
