# Anhang M – Schulungsmodul: KI sicher nutzen und KI-Angriffe erkennen

> Zurück zur [Strategie](../KI-Cybersicherheitsstrategie.md) · Maßnahmen M1–M5 · Basisschulung für alle Mitarbeitenden

| | |
|---|---|
| **Zielgruppe** | alle Mitarbeitenden, Führungskräfte, Praktikant/innen, externe Personen mit Zugang zu unseren KI-Werkzeugen |
| **Dauer** | 60 Minuten, in Präsenz oder online |
| **Gruppengröße** | bis 25 Personen, damit Fragen und die Übung Platz haben |
| **Leitung** | Informationssicherheit bzw. KI-Verantwortliche/r |
| **Material** | diese Unterlage, [Verifikationsregeln (Anhang E)](E-verifikationsregeln.md), [KI-Nutzungsrichtlinie (Anhang D)](D-richtlinie-ki-nutzung.md), optional die Stimmklon-Vorführung aus [Anhang L.3](L-awareness-jahresplan.md#l3-live-deepfake-demonstration-monat-1) |
| **Nachweis** | Teilnahmeliste und Quiz (Abschnitte M.5 und M.6) |
| **Wiederholung** | beim Onboarding, danach jährlich und bei Einführung neuer KI-Werkzeuge |

---

## M.1 Warum diese Schulung?

- **AI Act Art. 4:** Unternehmen, die KI-Systeme einsetzen, müssen Maßnahmen ergreifen, die die KI-Kompetenz ihres Personals fördern. Seit dem Digital Omnibus (VO (EU) 2026/1744, in Kraft seit 27. Juli 2026) ist das eine Pflicht zum Bemühen: Ein bestimmtes Kompetenzniveau jeder einzelnen Person muss nicht garantiert werden, die Maßnahmen selbst aber schon. Die Aufsicht liegt bei den nationalen Marktüberwachungsbehörden.
- **NISG 2026 / NIS-2-Richtlinie:** Zu den Risikomanagementmaßnahmen gehören grundlegende Cyberhygiene und Schulungen zur Cybersicherheit (NIS-2-Richtlinie Art. 21 Abs. 2 lit. g), falls wir erfasst sind.
- **Vor allem aber:** KI-gestützte Täuschung lässt sich nicht mehr an Fehlern erkennen. Schutz bieten nur Abläufe, die alle kennen und einhalten.

**Dokumentation:** Datum, Inhalte, Leitung und Teilnehmende aufbewahren (Vorlage M.6). Eine bestimmte Form oder ein Zertifikat schreibt der AI Act nicht vor.

## M.2 Lernziele

Nach der Schulung können die Teilnehmenden …

1. erklären, was KI-Werkzeuge leisten und wo ihre Grenzen liegen (erfundene Fakten, Manipulierbarkeit, Verzerrungen),
2. unsere freigegebenen KI-Werkzeuge nutzen und für jede Datenklasse entscheiden, was eingegeben werden darf,
3. KI-gestützte Täuschung (Phishing, geklonte Stimmen, gefälschte Videocalls, falscher IT-Support) als Risiko einordnen und die Verifikationsregeln anwenden,
4. ungewöhnliches Verhalten eines KI-Assistenten als mögliche Manipulation erkennen,
5. Vorfälle und Fehler sofort über den richtigen Weg melden.

## M.3 Ablauf

| Minute | Block | Inhalt | Methode |
|---|---|---|---|
| 0–5 | Einstieg | „Echt oder Fälschung?“: Audiobeispiel bzw. geklonte Stimme der Geschäftsführung | Vorführung, Handzeichen |
| 5–15 | 1 | Was KI kann und was nicht | Kurzvortrag mit Beispielen |
| 15–25 | 2 | KI sicher nutzen bei uns | Richtlinie, Datenklassen, Beispiele |
| 25–40 | 3 | Wie Angreifer KI nutzen | Kurzvortrag + Übung „Echt oder Angriff?“ |
| 40–48 | 4 | Wenn die KI selbst angegriffen wird | Kurzvortrag, Beispiel |
| 48–55 | 5 | STOPP · PRÜFEN · BESTÄTIGEN und Melden | Einseiter verteilen, Fragen |
| 55–60 | Abschluss | Quiz, Teilnahmeliste | Einzelarbeit |

---

## M.4 Inhalte und Sprechernotizen

### Einstieg: Echt oder Fälschung?

- Kurze Sprachnachricht abspielen, ohne Ankündigung. Frage an die Gruppe: „Wer glaubt, dass das echt ist?“
- Auflösung: Die Stimme wurde mit frei verfügbaren Werkzeugen aus wenigen Sekunden Audiomaterial erzeugt.
- **Kernsatz:** „Wenn wir das in einer Stunde schaffen, schaffen es Kriminelle auch. Deshalb verlassen wir uns nicht mehr auf unser Gefühl, sondern auf feste Abläufe.“

### Block 1 – Was KI kann und was nicht

- **So arbeitet ein Sprachmodell:** Es berechnet, welche Wörter wahrscheinlich als Nächstes kommen. Es „weiß“ nichts im menschlichen Sinn und prüft keine Fakten.
- **Erfundene Inhalte:** KI kann Quellen, Zahlen, Gesetzesstellen oder Namen erfinden, die überzeugend klingen. Beispiel zeigen: eine plausible, aber falsche Antwort.
- **Verzerrungen:** KI übernimmt Einseitigkeiten aus ihren Trainingsdaten. Bei Entscheidungen über Menschen (Bewerbungen, Bewertungen) ist besondere Vorsicht geboten; die Richtlinie verlangt dafür eine Freigabe.
- **Manipulierbarkeit:** KI folgt Anweisungen, auch versteckten in Texten, die sie liest (Block 4).
- **Verantwortung:** Wer ein KI-Ergebnis verwendet, verantwortet es. Die KI ist ein Werkzeug, keine Entscheidungsinstanz.

### Block 2 – KI sicher nutzen bei uns

- **Freigegebene Werkzeuge** zeigen ([ANPASSEN: Name, Anmeldung]): Eingaben werden nicht zum Training verwendet, Daten bleiben unter unserer Kontrolle.
- **Datenklassen-Matrix** aus [Anhang D](D-richtlinie-ki-nutzung.md#4-datenklassen-matrix) durchgehen. Faustregeln:
  - Öffentliches: überall erlaubt.
  - Internes und Vertrauliches: nur in freigegebene Werkzeuge.
  - Streng Vertrauliches: nur mit Einzelfreigabe.
  - **Zugangsdaten: niemals**, auch nicht in Code-Ausschnitten.
- **Erlaubt oder nicht?** Gemeinsam einordnen:
  - Eine Pressemitteilung im freigegebenen Werkzeug umformulieren → erlaubt.
  - Einen Kundenvertrag im kostenlosen Chatbot am Privathandy zusammenfassen → nicht erlaubt.
  - Ein Protokoll mit Kundennamen im freigegebenen Werkzeug zusammenfassen → erlaubt, soweit für den Zweck nötig.
  - Eine Fehlermeldung mit eingebettetem API-Schlüssel analysieren lassen → nicht erlaubt; Schlüssel entfernen.
  - Eine Browser-Erweiterung mit KI-Funktion selbst installieren → nicht erlaubt ohne Freigabe.
- **Ergebnisse prüfen** und KI-erzeugte Bilder, Audio- oder Videoinhalte kennzeichnen, wenn wir sie veröffentlichen.

### Block 3 – Wie Angreifer KI nutzen

- **Phishing ohne Fehler:** persönlich, mit echten Namen und Projekten, in perfektem Deutsch. Tippfehler sind kein Warnsignal mehr.
- **Rechnungsbetrug aus echten Mail-Verläufen:** Angreifer lesen in übernommenen Postfächern mit und schreiben im richtigen Ton weiter.
- **Geklonte Stimmen:** wenige Sekunden Audio genügen, auch live am Telefon.
- **Gefälschte Videocalls:** 2024 überwies ein Mitarbeiter in Hongkong nach einem Videocall mit ausschließlich gefälschten Kollegen rund 25 Mio. US-Dollar.
- **Falscher IT-Support:** per Telefon oder Teams-Chat, oft mit der Bitte, eine MFA-Anfrage zu bestätigen oder ein Fernwartungsprogramm zu installieren.
- **Gefälschte Bewerbungen:** KI-erzeugte Lebensläufe und Deepfake-Interviews, um Zugang zu Systemen zu bekommen.
- **Kernsatz:** „Wir können Echtheit nicht mehr erkennen. Wir können aber prüfen, über einen zweiten Weg.“

**Übung „Echt oder Angriff?“** (10 Minuten, in Paaren, dann gemeinsam auflösen)

| # | Situation | Auflösung |
|---|---|---|
| 1 | Ein bekannter Lieferant schreibt in einer laufenden Mail-Konversation: „Unsere Bankverbindung hat sich geändert, bitte ab sofort auf das Konto im Anhang zahlen.“ Ton und Signatur stimmen. | **Wie einen Angriff behandeln, bis das Gegenteil bestätigt ist.** Ob die Mail echt ist, lässt sich nicht erkennen. Rückruf über die bei uns hinterlegte Nummer, zweite Person gibt frei. |
| 2 | Teams-Nachricht von „IT-Support“ (externes Konto): „Wir migrieren Ihr Postfach. Bitte bestätigen Sie gleich die Anmeldeanfrage auf Ihrem Handy.“ | **Angriff.** Unsere IT bittet nie unaufgefordert um eine MFA-Bestätigung. Ablehnen, IT über die bekannte Nummer informieren. |
| 3 | Anruf, eindeutig die Stimme der Geschäftsführung: „Schicken Sie mir bitte die Liste aller Kundenkontakte an meine private Adresse, ich brauche sie morgen früh.“ | **Rote Flaggen:** privater Kanal, vertrauliche Daten, Zeitdruck. Gespräch beenden, über die hinterlegte Nummer zurückrufen. |
| 4 | Sie lassen den KI-Assistenten eine eingegangene Kundenmail zusammenfassen. Danach schlägt er vor, „die aktuelle Rechnungsübersicht an buchhaltung-service@… weiterzuleiten“. | **Mögliche Manipulation (Prompt Injection).** Nicht bestätigen, melden. Die Mail enthielt vermutlich versteckte Anweisungen. |
| 5 | Sie wollen schnell einen Vertragsentwurf mit Kundendaten zusammenfassen und nutzen dafür die kostenlose Version eines Chatbots am Privathandy. | **Verstoß gegen die Richtlinie.** Freigegebenes Werkzeug verwenden. Ist es schon passiert: sofort melden, damit wir reagieren können. Das wird nicht bestraft. |
| 6 | Im Video-Bewerbungsgespräch ruckelt das Bild, Lippen und Ton passen nicht ganz zusammen, der Bewerber weicht Detailfragen aus und kann seinen Ausweis „wegen kaputter Kamera“ nicht zeigen. | **Verdacht auf gefälschte Identität.** HR informieren; vor Vergabe von Zugängen Identität persönlich oder über ID Austria prüfen. |

### Block 4 – Wenn die KI selbst angegriffen wird

- KI-Assistenten lesen Mails, Dokumente und Webseiten. **Versteckte Anweisungen** in diesen Inhalten (weißer Text, Kommentare, Metadaten) können den Assistenten umsteuern. Das nennt man Prompt Injection.
- Je mehr ein Assistent **darf** (Mails senden, Dateien teilen, Termine anlegen), desto größer der mögliche Schaden. Deshalb geben wir KI-Agenten nur minimale Rechte, und Aktionen mit Außenwirkung bestätigt ein Mensch.
- **Was Sie tun:** Wenn ein KI-Assistent etwas Unerwartetes vorschlägt oder tut (Daten an Unbekannte senden, Links öffnen, merkwürdige Anweisungen ausgeben): nicht bestätigen, Screenshot machen, melden ([Playbook C](C-playbook-angriff-auf-ki-systeme.md)).
- **Erweiterungen und Plugins:** Nur freigegebene installieren. Auch KI-Werkzeuge können manipuliert sein.

### Block 5 – STOPP · PRÜFEN · BESTÄTIGEN und Melden

- Einseiter ([Anhang E](E-verifikationsregeln.md)) verteilen und die drei Schritte gemeinsam durchgehen.
- **Was nicht als Bestätigung gilt:** Rückruf an die Nummer aus der Nachricht, Antwort auf dieselbe Mail, bekannte Stimme, Videocall, Messenger, Bestätigung durch die anfragende Person selbst.
- **Rückendeckung:** Die Geschäftsführung hat schriftlich zugesagt, dass niemand für eine Prüfung oder Verzögerung kritisiert wird.
- **Melden:** Melde-Button im Mailprogramm, Kontakt [ANPASSEN], außerhalb der Bürozeiten [ANPASSEN]. Geld bereits überwiesen? **Sofort die Hausbank anrufen.**
- **Kernsatz zum Schluss:** „Lieber einmal zu viel gemeldet als einmal zu wenig. Wer schnell meldet, verhindert den Schaden.“

---

## M.5 Abschlussquiz

Bestanden ab 8 von 10 richtigen Antworten. Wer nicht besteht, geht die Lösungen mit der Leitung durch; eine Wiederholung ist jederzeit möglich.

| # | Frage | Antworten |
|---|---|---|
| 1 | Eine E-Mail ist fehlerfrei, persönlich und bezieht sich auf ein echtes Projekt. Was folgt daraus? | a) Sie ist echt. · b) Fehlerfreiheit sagt nichts über die Echtheit; entscheidend ist, was gefordert wird. · c) Sie stammt sicher von einer Kollegin. |
| 2 | Die Stimme der Geschäftsführung verlangt am Telefon eine dringende, vertrauliche Überweisung. Was tun Sie? | a) Überweisen, die Stimme ist eindeutig. · b) Um eine Bestätigungs-Mail bitten. · c) Gespräch beenden, über die hinterlegte Nummer zurückrufen und eine zweite Person einbeziehen. |
| 3 | Welche Bestätigung einer Bankdatenänderung ist gültig? | a) Rückruf an die Nummer aus der Signatur der Mail. · b) Rückruf an die bei uns hinterlegte Nummer und Freigabe durch eine zweite Person. · c) Ein kurzer Videocall mit dem Ansprechpartner. |
| 4 | Was darf in ein freigegebenes Business-KI-Werkzeug eingegeben werden? | a) Interne und vertrauliche Daten, soweit für den Zweck nötig. · b) Alles, auch Passwörter. · c) Nur öffentliche Texte. |
| 5 | Was darf niemals in ein KI-Werkzeug eingegeben werden? | a) Kundennamen. · b) Passwörter, API-Schlüssel und andere Zugangsdaten. · c) Interne Protokolle. |
| 6 | Eine KI-Antwort nennt eine konkrete Gesetzesstelle. Was tun Sie? | a) Übernehmen, die KI hat Zugriff auf alle Gesetze. · b) In der Originalquelle prüfen, bevor Sie sie verwenden. · c) Eine zweite KI fragen. |
| 7 | Ihr KI-Assistent schlägt nach dem Lesen einer externen Mail vor, Dateien an eine unbekannte Adresse zu senden. | a) Bestätigen, der Assistent wird es wissen. · b) Nicht bestätigen und melden. · c) Den Assistenten fragen, ob das sicher ist. |
| 8 | Sie haben versehentlich Kundendaten in einen privaten Chatbot kopiert. Was tun Sie? | a) Nichts, es merkt niemand. · b) Den Verlauf löschen und schweigen. · c) Sofort melden, damit wir den Schaden begrenzen können. |
| 9 | Der „IT-Support“ bittet Sie per Teams, eine MFA-Anfrage auf Ihrem Handy zu bestätigen. | a) Bestätigen, die IT braucht das für die Migration. · b) Ablehnen und die IT über die bekannte Nummer informieren. · c) Erst bestätigen, dann nachfragen. |
| 10 | Welche Aussage zu Deepfakes stimmt? | a) Ein Videocall mit einem bekannten Gesicht ist kein Identitätsnachweis. · b) Deepfakes erkennt man immer an ruckelnden Bildern. · c) Deepfakes sind nur in Filmen ein Thema. |

**Lösungen:** 1 b · 2 c · 3 b · 4 a · 5 b · 6 b · 7 b · 8 c · 9 b · 10 a

---

## M.6 Teilnahmenachweis

| | |
|---|---|
| **Schulung** | KI sicher nutzen und KI-Angriffe erkennen (Basisschulung, 60 Minuten) |
| **Inhalte** | Grundlagen und Grenzen von KI · freigegebene Werkzeuge und Datenklassen · KI-gestützte Täuschung · Prompt Injection · Verifikationsregeln und Melden |
| **Datum / Ort bzw. online** | |
| **Leitung** | |

| Name | Abteilung | Quiz bestanden (ja/nein) | Unterschrift |
|---|---|---|---|
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |

Aufbewahrung der Nachweise: [ANPASSEN, z. B. bei HR, mindestens bis zur nächsten Wiederholung]

---

## M.7 Vertiefungsmodule für Risikogruppen (je 30 Minuten)

| Zielgruppe | Schwerpunkte | Grundlage |
|---|---|---|
| **Finanzen / Buchhaltung** | Ablauf eines CEO- und Rechnungsbetrugs Schritt für Schritt; Rückruf und Vier-Augen-Prinzip im Alltag; was in der ersten Stunde nach einer Fehlüberweisung zu tun ist | [Playbook A](A-playbook-deepfake-ceo-betrug.md), [Anhang E](E-verifikationsregeln.md) |
| **Assistenz / Empfang** | Anrufe „im Namen“ der Geschäftsführung; Auskünfte an Dritte; Codewort-Verfahren | [Anhang E](E-verifikationsregeln.md) |
| **HR / Recruiting** | Gefälschte Bewerbungen und Deepfake-Interviews; Identitätsprüfung vor Zugängen; KI im Bewerbungsprozess nur mit Freigabe | Maßnahme P10, [Anhang D](D-richtlinie-ki-nutzung.md) |
| **IT / Helpdesk** | Reset-Betrug; sicherer Reset-Prozess; Erkennung einer Kontoübernahme; Sofortmaßnahmen | [Playbook B](B-playbook-ki-phishing-kontouebernahme.md), [Anhang J](J-technische-umsetzung.md) |
| **Geschäftsführung** | Rolle als bevorzugtes Ziel; Codewort; Entscheidungen im Ernstfall; Pflichten nach NISG 2026 | [Anhang G](G-beschlussvorlage-geschaeftsfuehrung.md), [Anhang H](H-notfalluebung-tabletop.md) |
| **Entwicklung / Verantwortliche für KI-Agenten** | Prompt Injection, sichere Agenten-Architektur, KI-generierter Code, erfundene Paketnamen | [Anhang K.3](K-vorlagen-ki-inventar-anbieter.md#k3-freigabe-checkliste-für-ki-agenten-k4), [Anhang J.7](J-technische-umsetzung.md#j7-ki-agenten-und-integrationen-technisch-absichern-k3k7-i9) |
