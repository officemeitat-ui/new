# Anhang H – Notfallübung (Tabletop): Szenario „Freitagabend“

> Zurück zur [Strategie](../KI-Cybersicherheitsstrategie.md) · Maßnahme R6

**Ziel:** Prüfen, ob Verifikationsregeln, Playbooks, Erreichbarkeiten und Entscheidungswege unter realistischem Druck funktionieren – bevor ein echter Angriff es tut.

| | |
|---|---|
| **Dauer** | 2,5–3 Stunden |
| **Teilnehmende** | Geschäftsführung, Informationssicherheit, IT-Betrieb bzw. IT-Dienstleister, Finanzen, Kommunikation, HR, Datenschutz; optional MDR-Dienstleister |
| **Rollen** | Moderation (stellt die Einspielungen vor), Beobachtung (misst Zeiten, notiert Lücken), Protokoll |
| **Format** | Gesprächsübung am Tisch, keine echten Systemeingriffe; die Zeit im Szenario läuft schneller als real |
| **Frequenz** | mindestens jährlich, Szenario jedes Mal variieren |

## Spielregeln

1. **Keine Schuldzuweisung.** Es geht um Lücken im System, nicht um Fehler von Personen.
2. **Echte Entscheidungen.** Antworten wie „das würden wir dann klären“ gelten nicht – wer entscheidet was, womit, wann?
3. **Nur vorhandene Hilfsmittel.** Kontaktlisten, Playbooks und Zugänge werden so genutzt, wie sie heute existieren. Was fehlt, wird notiert.
4. **Erreichbarkeit realistisch.** Die Moderation legt fest, wer „am Freitagabend“ nicht erreichbar ist (z. B. Geschäftsführung im Urlaub, IT-Leitung im Flugzeug).

## Vorbereitung (Moderation)

- [ ] Termin mit allen Teilnehmenden, Raum ohne Unterbrechungen
- [ ] Ausgedruckte Playbooks ([A](A-playbook-deepfake-ceo-betrug.md), [B](B-playbook-ki-phishing-kontouebernahme.md), [C](C-playbook-angriff-auf-ki-systeme.md)), Notfallkontakte, Verifikationsregeln
- [ ] Optional: kurze Audioaufnahme einer geklonten Stimme der Geschäftsführung (nur mit deren Einverständnis) für Einspielung 1
- [ ] Einspielungen auf Karten oder Folien
- [ ] Beobachtungsbogen (Abschnitt „Auswertung“)

---

## Szenario

### Einspielung 1 – Freitag, 16:40 Uhr: Der Anruf

Die Buchhaltung erhält einen Anruf von einer unbekannten Mobilnummer. Die Stimme ist eindeutig die der Geschäftsführerin [ANPASSEN: Name]. Sie sei auf dem Weg zu einem vertraulichen Notartermin für eine Firmenübernahme, die noch nicht öffentlich ist. Bis 17:30 Uhr müssen **[ANPASSEN: z. B. 185.000 €]** als Anzahlung auf ein Treuhandkonto überwiesen werden, sonst platze der Deal. Sie bitte um absolute Verschwiegenheit, auch gegenüber den Kolleginnen und Kollegen. Zwei Minuten später kommt eine E-Mail mit der Bankverbindung – von einer Adresse, die bis auf einen Buchstaben der Firmendomain entspricht.

**Fragen:**
- Was tut die Buchhaltung jetzt – Schritt für Schritt?
- Welche roten Flaggen liegen vor?
- Die Geschäftsführerin ist tatsächlich nicht erreichbar (Rückruf geht auf die Mailbox). Was passiert dann?
- Wer wird informiert, und wie schnell?
- Erkennt unser E-Mail-Schutz die Lookalike-Domain?

### Einspielung 2 – Freitag, 17:20 Uhr: Variante „Es ist schon passiert“

Die Moderation teilt mit: In einer Parallelwelt wurde die Überweisung freigegeben. Die zweite zeichnungsberechtigte Person hatte kurz zuvor einen Teams-Videocall mit der „Geschäftsführerin“ und einem „Rechtsanwalt“ – Kamera an, Bild ruckelig, Stimmen echt.

**Fragen:**
- Wer hat die Notfallnummer der Hausbank – jetzt, am Freitag nach 17 Uhr?
- Wer darf entscheiden, die Bank um Rückholung zu bitten, und wer erstattet Anzeige?
- Welche Beweise werden gesichert und wo?
- Wann und wie wird die Versicherung informiert? Ist der Fall überhaupt gedeckt?
- Wie gehen wir mit den beiden Mitarbeitenden um?

### Einspielung 3 – Freitag, 22:30 Uhr: Die Kontoübernahme

Der MDR-Dienstleister meldet: Am Konto der Buchhalterin gab es eine erfolgreiche Anmeldung aus dem Ausland. Kurz danach wurde eine Posteingangsregel angelegt, die alle Mails mit „Rechnung“, „Zahlung“ und „Bank“ in einen versteckten Ordner verschiebt. Gleichzeitig laufen Massen-Downloads aus der Finanzablage.

**Fragen:**
- Wen erreicht der MDR-Dienstleister am Freitagabend? Gibt es eine Rufbereitschaft?
- Wer darf das Konto sperren und Sitzungen widerrufen – auch ohne Rücksprache?
- Wie kam der Angreifer an das Konto, obwohl MFA aktiv ist? (Hinweis: Phishing-Seite, die Codes in Echtzeit weiterleitet)
- Welche Schritte aus [Playbook B](B-playbook-ki-phishing-kontouebernahme.md) greifen?
- Müssen Kunden und Lieferanten gewarnt werden, die mit diesem Postfach kommuniziert haben?

### Einspielung 4 – Samstag, 03:10 Uhr: Verschlüsselung

Das EDR meldet Verschlüsselungsaktivität auf dem Fileserver und zwei weiteren Servern. Auf den Desktops erscheint eine Lösegeldforderung. Die Angreifer drohen, die erbeuteten Finanzdaten zu veröffentlichen.

**Fragen:**
- Wer entscheidet, ob Systeme oder die Internetverbindung getrennt werden?
- Sind die Sicherungen unversehrt? Wer prüft das, und woher wissen wir es?
- Wie lange dauert die Wiederherstellung der kritischen Systeme realistisch?
- Ab wann läuft die **24-Stunden-Frist** für die Frühwarnung nach NISG 2026, wer meldet an das CSIRT? Liegt zusätzlich eine Datenschutzverletzung vor (72 h)?
- Wie ist unsere Haltung zu Lösegeldzahlungen – und wer darf darüber entscheiden?
- Wann wird der Incident-Response-Dienstleister gerufen? Besteht ein Rahmenvertrag?

### Einspielung 5 – Samstag, 11:00 Uhr: Der Deepfake in der Öffentlichkeit

Auf LinkedIn kursiert ein Video, in dem die Geschäftsführerin sagt: „Wir wurden gehackt, alle Kundendaten sind verloren, wir können derzeit nicht liefern.“ Das Video ist gefälscht. Ein Journalist bittet um Stellungnahme bis 14 Uhr; erste Kunden rufen an.

**Fragen:**
- Wer spricht nach außen, über welche verifizierten Kanäle?
- Wie belegen wir, dass das Video gefälscht ist – ohne zu verschweigen, dass es tatsächlich einen Angriff gibt?
- Was sagen wir Kunden, Lieferanten und Mitarbeitenden – und in welcher Reihenfolge?
- Wie veranlassen wir die Entfernung des Videos?

### Einspielung 6 – Montag, 08:00 Uhr: Der Wiederanlauf

Mitarbeitende kommen ins Büro, viele Systeme sind nicht verfügbar. Ein Lieferant ruft an: Er habe „von Ihnen“ per E-Mail neue Bankdaten erhalten und wolle das nur kurz bestätigen.

**Fragen:**
- Wie informieren wir die Belegschaft, wenn E-Mail und Teams nicht verfügbar sind?
- Welche Geschäftsprozesse laufen im Notbetrieb weiter, welche nicht?
- Wie verhält sich unsere Mitarbeiterin am Telefon gegenüber dem Lieferanten richtig?
- Wann ist der Abschlussbericht nach NISG 2026 fällig?

---

## Auswertung

### Beobachtungsbogen

| Prüfpunkt | Erfüllt | Teilweise | Nicht erfüllt | Notiz |
|---|---|---|---|---|
| Verifikationsregel wurde angewendet, bevor gehandelt wurde | | | | |
| Notfallnummer der Hausbank war sofort verfügbar | | | | |
| Entscheidungsbefugnisse waren klar (Konto sperren, Netz trennen, Meldung) | | | | |
| Rufbereitschaft am Wochenende war erreichbar | | | | |
| Playbooks waren bekannt und auffindbar | | | | |
| Meldefristen (NISG, DSGVO) und zuständige Stellen waren bekannt | | | | |
| Zustand und Wiederherstellungszeit der Sicherungen waren bekannt | | | | |
| Krisenkommunikation hatte vorbereitete Texte und Kanäle | | | | |
| Kommunikation ohne E-Mail/Teams war möglich (Notfall-Kontaktliste offline) | | | | |
| Versicherungsdeckung war bekannt | | | | |

### Gemessene Zeiten (Szenario-Zeit)

| Ereignis | Zeit bis Reaktion |
|---|---|
| Rote Flaggen erkannt → Meldung an Informationssicherheit | |
| Zahlung bemerkt → Bank kontaktiert | |
| MDR-Alarm → Konto gesperrt | |
| Verschlüsselung erkannt → Entscheidung Netztrennung | |
| Vorfall bekannt → Frühwarnung an CSIRT vorbereitet | |

### Nachbereitung (innerhalb von 2 Wochen)

| # | Erkannte Lücke | Maßnahme | Verantwortlich | Termin |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

Ergebnisse fließen in die Aktualisierung der Strategie, der Playbooks und der Kontaktlisten ein und werden im nächsten Quartalsbericht an die Geschäftsführung berichtet.
