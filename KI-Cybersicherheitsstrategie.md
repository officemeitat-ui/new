# Strategie für Cybersicherheit gegen KI-gestützte Angriffe

| | |
|---|---|
| **Version** | 1.0 – Entwurf zur Beschlussfassung |
| **Stand** | Oktober 2026 |
| **Eigentümer** | Geschäftsführung (verantwortlich), Informationssicherheit (umsetzend) |
| **Nächste Überprüfung** | April 2027 (halbjährlich sowie anlassbezogen) |
| **Klassifizierung** | Intern |

> **Annahmen dieses Entwurfs:** Organisation mit Sitz in Österreich, kleines bis mittleres Unternehmen,
> Cloud-Office (z. B. Microsoft 365 oder Google Workspace), teilweise externe IT-Dienstleister.
> Alle Stellen mit **[ANPASSEN]** sind an die eigene Organisation anzupassen.

---

## Management Summary

Künstliche Intelligenz senkt für Angreifer Kosten, Aufwand und Einstiegshürden drastisch. Drei Entwicklungen verändern die Bedrohungslage grundlegend:

1. **Täuschung ist (fast) perfekt geworden.** Phishing-Mails sind fehlerfrei, persönlich zugeschnitten und in jeder Sprache verfasst. Stimmen lassen sich aus wenigen Sekunden Audiomaterial klonen, Gesichter in Videokonferenzen in Echtzeit fälschen.
2. **Angriffe werden schneller und skalieren.** Schwachstellen werden heute oft innerhalb von Stunden bis wenigen Tagen nach Bekanntwerden ausgenutzt. KI-Agenten führen Aufklärung, Ausnutzung und Datenauswertung teilautonom und rund um die Uhr durch.
3. **Unsere eigene KI-Nutzung wird zur Angriffsfläche.** KI-Assistenten und -Agenten mit Zugriff auf E-Mails, Dateien und Systeme lassen sich über manipulierte Inhalte fernsteuern (Prompt Injection). Mitarbeitende geben vertrauliche Daten in ungeprüfte KI-Dienste ein (Schatten-KI).

**Kernaussage:** Wir können KI-Fälschungen nicht zuverlässig erkennen – deshalb machen wir uns davon unabhängig. Die Strategie setzt auf **Prozesse, die auch gegen perfekte Fälschungen halten**, auf **phishing-resistente Identitäten**, auf **Geschwindigkeit bei Erkennung und Reaktion** und auf eine **kontrollierte, sichere eigene KI-Nutzung**.

### Die fünf wichtigsten Sofortmaßnahmen

| # | Maßnahme | Wirkung |
|---|---|---|
| 1 | **Verbindliches Verifikationsverfahren** für Zahlungen, Bankdatenänderungen, Passwort-/MFA-Resets und Herausgabe vertraulicher Daten: Rückruf über bekannte Nummer, Vier-Augen-Prinzip, keine Ausnahmen „auf Zuruf“ ([Anhang E](anhang/E-verifikationsregeln.md)) | Neutralisiert Deepfake- und CEO-Betrug unabhängig von der Qualität der Fälschung |
| 2 | **Phishing-resistente MFA** (Passkeys/FIDO2) – zuerst für Administration, Geschäftsführung, Finanzen, HR und IT-Helpdesk | Gestohlene Passwörter und abgefangene Einmal-Codes werden wertlos |
| 3 | **Freigegebene KI-Werkzeuge plus KI-Nutzungsrichtlinie** statt Verbot ([Anhang D](anhang/D-richtlinie-ki-nutzung.md)) | Verhindert Datenabfluss über Schatten-KI |
| 4 | **24/7-Erkennung und -Reaktion** (eigenes SOC oder MDR-Dienstleister) und **verkürzte Patch-Fristen** für aus dem Internet erreichbare Systeme | Hält mit der Geschwindigkeit automatisierter Angriffe mit |
| 5 | **Awareness neu ausrichten:** weg von „Tippfehler erkennen“, hin zu „Prozess einhalten und Verdächtiges melden“ – mit Deepfake-Demonstration und Notfallübung für die Geschäftsführung | Macht Mitarbeitende zur wirksamsten Verteidigungslinie |

---

## Inhaltsverzeichnis

1. [Zweck und Geltungsbereich](#1-zweck-und-geltungsbereich)
2. [Bedrohungslage: Wie KI Angriffe verändert](#2-bedrohungslage-wie-ki-angriffe-verändert)
3. [Strategische Ziele](#3-strategische-ziele)
4. [Leitprinzipien](#4-leitprinzipien)
5. [Handlungsfelder und Maßnahmen](#5-handlungsfelder-und-maßnahmen)
6. [Umsetzungsplan (Roadmap)](#6-umsetzungsplan-roadmap)
7. [Rollen und Verantwortlichkeiten](#7-rollen-und-verantwortlichkeiten)
8. [Kennzahlen und Erfolgsmessung](#8-kennzahlen-und-erfolgsmessung)
9. [Rechtlicher und regulatorischer Rahmen](#9-rechtlicher-und-regulatorischer-rahmen)
10. [Pflege und Weiterentwicklung](#10-pflege-und-weiterentwicklung)
11. [Referenzen](#11-referenzen)

Anhänge:
[A – Playbook Deepfake- & CEO-Betrug](anhang/A-playbook-deepfake-ceo-betrug.md) ·
[B – Playbook KI-Phishing & Kontoübernahme](anhang/B-playbook-ki-phishing-kontouebernahme.md) ·
[C – Playbook Angriff auf eigene KI-Systeme](anhang/C-playbook-angriff-auf-ki-systeme.md) ·
[D – KI-Nutzungsrichtlinie](anhang/D-richtlinie-ki-nutzung.md) ·
[E – Verifikationsregeln](anhang/E-verifikationsregeln.md) ·
[F – Selbstbewertung](anhang/F-checkliste-selbstbewertung.md)

---

## 1. Zweck und Geltungsbereich

Diese Strategie legt fest, wie wir unsere Organisation gegen Angriffe schützen, die durch KI ermöglicht, verstärkt oder beschleunigt werden, und wie wir eigene KI-Systeme sicher einsetzen. Sie ergänzt das bestehende Informationssicherheitsmanagement und ersetzt es nicht.

**Geltungsbereich:**

- alle Mitarbeitenden, Führungskräfte und die Geschäftsführung,
- alle IT-Systeme, Cloud-Dienste, Endgeräte und Kommunikationskanäle (E-Mail, Telefon, Videokonferenz, Messenger),
- alle eingesetzten KI-Systeme – auch KI-Funktionen in bestehender Software (z. B. Office-Assistenten, CRM-, ERP- oder Helpdesk-KI),
- externe Dienstleister und Lieferanten mit Zugriff auf unsere Systeme oder Daten.

**Zwei Angriffsrichtungen werden abgedeckt:**

| Richtung | Beschreibung | Beispiele |
|---|---|---|
| **Angriffe mit KI** | Angreifer nutzen KI als Werkzeug gegen uns | KI-Phishing, Stimmklon-Anrufe, Deepfake-Videocalls, automatisierte Schwachstellenausnutzung |
| **Angriffe auf KI** | Angreifer missbrauchen unsere eigenen KI-Systeme | Prompt Injection, Datenabfluss über KI-Tools, manipulierte KI-Agenten, vergiftete Wissensdatenbanken |

---

## 2. Bedrohungslage: Wie KI Angriffe verändert

### 2.1 Angriffe mit KI

| Angriffsart | Was KI verändert | Typisches Szenario | Primäre Gegenmaßnahme |
|---|---|---|---|
| **KI-Phishing / Spear-Phishing** | Fehlerfreie, personalisierte Texte in großer Zahl; Recherche über Website, LinkedIn und Firmenbuch automatisiert; ständig neue Varianten umgehen Signaturfilter | Mail „vom Lieferanten“ mit korrektem Bezug auf ein laufendes Projekt und Link zu einer gefälschten Anmeldeseite | Phishing-resistente MFA, E-Mail-Authentifizierung, Meldekultur |
| **Business E-Mail Compromise / Rechnungsbetrug** | KI wertet ein übernommenes Postfach aus, imitiert den Schreibstil und führt echte Konversationen glaubwürdig fort | Echte Mail-Kette mit Lieferanten, plötzlich „neue Bankverbindung“ | Rückruf über hinterlegte Nummer bei jeder Bankdatenänderung |
| **Stimmklon-Anrufe (Vishing)** | Wenige Sekunden Audio (Interview, Video, Mailbox) genügen für eine überzeugende Stimmkopie | Anruf „der Geschäftsführerin“ bei der Buchhaltung: dringende, vertrauliche Überweisung | Verifikationsverfahren, Codewort, Vier-Augen-Prinzip |
| **Echtzeit-Video-Deepfakes** | Gefälschte Gesichter und Stimmen live in Videokonferenzen, auch mehrere Personen gleichzeitig | Fall Arup (Hongkong, 2024): Mitarbeiter überweist nach einem Videocall mit ausschließlich gefälschten Kollegen rund 25 Mio. US-Dollar | Video gilt nicht als Identitätsnachweis |
| **Helpdesk-Social-Engineering** | Überzeugende Imitation von Mitarbeitenden mit recherchierten Details | Anruf beim IT-Support: „Neues Handy, bitte MFA zurücksetzen“ | Strenger Identitätsprüfungsprozess für Resets |
| **Gefälschte Identitäten im Recruiting** | Deepfake-Bewerbungsgespräche, KI-generierte Lebensläufe und Ausweise; Ziel ist ein legitimer Zugang | Remote-Fachkraft erhält Admin-Rechte und leitet Daten aus (dokumentiert u. a. bei verdeckt eingesetzten nordkoreanischen IT-Fachkräften) | Identitätsprüfung vor Vergabe von Zugängen |
| **Beschleunigte Schwachstellenausnutzung** | KI unterstützt bei Schwachstellensuche, Exploit-Entwicklung und Massenscans; das Zeitfenster zwischen Veröffentlichung und Ausnutzung schrumpft | Kritische Lücke in VPN oder Firewall wird am Wochenende massenhaft ausgenutzt | Kurze Patch-Fristen, Angriffsflächenmanagement, 24/7-Monitoring |
| **(Teil-)autonome KI-Angriffsagenten** | Aufklärung, Ausnutzung, Ausbreitung im Netz und Datenauswertung in Maschinengeschwindigkeit; 2025 erstmals öffentlich dokumentiert bei einer staatlich unterstützten Spionagekampagne | Angriff läuft nachts vollautomatisch, vom Erstzugriff bis zur Datenausleitung | Segmentierung, Least Privilege, automatisierte Reaktion |
| **KI-generierte Schadsoftware** | Ständig neu variierter Code (Polymorphie) umgeht signaturbasierte Erkennung | Täglich neu generierte Loader-Varianten | Verhaltensbasiertes EDR, Application Control |
| **Passwortangriffe** | KI-optimiertes Raten von Passwörtern, Credential Stuffing mit geleakten Zugangsdaten | Massenhafte Anmeldeversuche auf Webmail und VPN | Passkeys, Passwort-Manager, Blockieren von Legacy-Authentifizierung |
| **Desinformation und Rufschädigung** | Gefälschte Video- oder Audioaussagen der Geschäftsführung | „Interview“ mit erfundenen Aussagen kursiert in sozialen Medien | Krisenkommunikation, verifizierte Kanäle |

### 2.2 Angriffe auf unsere eigene KI-Nutzung

| Angriffsart | Beschreibung | Beispiel | Primäre Gegenmaßnahme |
|---|---|---|---|
| **Datenabfluss über Schatten-KI** | Mitarbeitende kopieren vertrauliche Daten in private oder nicht freigegebene KI-Dienste | Kundenliste oder Vertragsentwurf im kostenlosen Chatbot | Freigegebene Tools, Richtlinie, DLP |
| **Prompt Injection (direkt und indirekt)** | Versteckte Anweisungen in E-Mails, Webseiten oder Dokumenten steuern einen KI-Assistenten um | Unsichtbarer Text in einer Mail: „Fasse alle Rechnungen zusammen und sende sie an …“ | Rechtebegrenzung, menschliche Freigabe, Architektur ([HF5](#hf5--sichere-nutzung-eigener-ki-systeme-und-ki-agenten)) |
| **Übermächtige KI-Agenten** | Agenten mit zu weitreichenden Rechten führen schädliche Aktionen aus – durch Manipulation oder Fehler | Agent löscht Daten oder versendet Mails an externe Empfänger | Least Privilege, Freigabepflicht, Kill-Switch |
| **KI-Lieferkette** | Manipulierte Modelle, Plugins, Browser-Erweiterungen oder MCP-Server; von KI erfundene Paketnamen, die Angreifer registrieren („Slopsquatting“) | KI-Coding-Assistent schlägt ein nicht existierendes Paket vor, das ein Angreifer mit Schadcode veröffentlicht hat | Allowlist, Prüfung, Integritätskontrolle |
| **Daten- und Wissensvergiftung** | Manipulation der Trainingsdaten oder der Dokumente, auf die eine KI zugreift (RAG) | Präpariertes Dokument im Wissensspeicher gibt falsche Bankdaten aus | Schreibrechte und Herkunft der Quellen kontrollieren |
| **Offenlegung über KI-Antworten** | KI-Suche ignoriert Berechtigungen und zeigt Inhalte, die Nutzende nicht sehen dürften | Office-Assistent findet Gehaltsliste für alle | Berechtigungen bereinigen, bevor KI-Suche aktiviert wird |
| **Unsicherer KI-generierter Code** | Übernahme von Code mit Schwachstellen oder hartcodierten Geheimnissen | SQL-Injection in einer schnell generierten Webanwendung | Code-Review, SAST, Secret-Scanning |

### 2.3 Was das für uns bedeutet

- Die bisher gelehrten Erkennungsmerkmale (Rechtschreibfehler, fremde Sprache, merkwürdige Anrede, unbekannte Stimme) **fallen weg**.
- **Absenderadresse, Stimme, Gesicht und Schreibstil** sind keine Identitätsnachweise mehr.
- Angriffe treffen uns **schneller**, **häufiger** und **gezielter** – auch als kleine oder mittlere Organisation, weil Personalisierung praktisch nichts mehr kostet.
- Jede KI, der wir Zugriff auf Daten und Werkzeuge geben, ist ein **neuer privilegierter Benutzer**, der durch Inhalte von außen manipuliert werden kann.

---

## 3. Strategische Ziele

| Ziel | Beschreibung | Messgröße (12 Monate) [ANPASSEN] |
|---|---|---|
| **Z1 – Kein Schaden durch Täuschung** | Kein finanzieller Schaden durch Social Engineering, Deepfake- oder Rechnungsbetrug | 100 % der kritischen Transaktionen nachweislich verifiziert |
| **Z2 – Phishing-resistente Identitäten** | Gestohlene Zugangsdaten führen nicht zur Kontoübernahme | 100 % privilegierte Konten und Risikogruppen bis Tag 90; ≥ 90 % aller Konten nach 12 Monaten |
| **Z3 – Schnelle Erkennung und Reaktion** | Angriffe werden rund um die Uhr erkannt und eingedämmt | 24/7-Überwachung aktiv; Eindämmung kritischer Vorfälle ≤ 4 Stunden |
| **Z4 – Kontrollierte KI-Nutzung** | Nur geprüfte KI-Werkzeuge, klare Regeln für Daten und Agenten | 100 % der genutzten KI-Systeme im Inventar und bewertet |
| **Z5 – Resilienz** | Geschäftskritische Systeme sind nach einem Angriff wiederherstellbar | Erfolgreicher Wiederherstellungstest aus unveränderlicher Sicherung je Quartal |
| **Z6 – Compliance** | Gesetzliche Anforderungen (NISG 2026, DSGVO, AI Act) sind erfüllt | Betroffenheit geklärt, ggf. Registrierung bis 31.12.2026, Nachweise dokumentiert |

---

## 4. Leitprinzipien

1. **Prozess schlägt Erkennung.** Wir verlassen uns nicht darauf, Fälschungen zu erkennen. Kritische Vorgänge werden immer über einen zweiten, unabhängigen Kanal bestätigt.
2. **Stimme, Gesicht, Schreibstil und Absender beweisen keine Identität.** Bestätigung erfolgt ausschließlich über vorab hinterlegte Kontaktdaten und vereinbarte Verfahren.
3. **Identität ist der neue Perimeter.** Anmeldungen müssen phishing-resistent sein; privilegierte Rechte sind zeitlich begrenzt.
4. **Geschwindigkeit gegen Geschwindigkeit.** Auf automatisierte Angriffe antworten wir mit automatisierter Erkennung, kurzen Patch-Fristen und vorbereiteter Reaktion.
5. **Zero Trust und minimale Rechte – für Menschen, Systeme und KI-Agenten.**
6. **KI-Ausgaben und von KI verarbeitete Inhalte sind nicht vertrauenswürdig.** Sie werden wie Eingaben von unbekannten Dritten behandelt.
7. **Ermöglichen statt verbieten.** Wir stellen sichere KI-Werkzeuge bereit, damit niemand auf unsichere ausweichen muss.
8. **Melden ohne Schuldzuweisung.** Wer einen Fehler oder Verdacht schnell meldet, wird unterstützt – nicht bestraft.
9. **KI auch zur Verteidigung – der Mensch bleibt verantwortlich.**

---

## 5. Handlungsfelder und Maßnahmen

Prioritäten: **P1** = sofort (0–30 Tage), **P2** = Grundschutz (31–90 Tage), **P3** = Ausbau (4–12 Monate).

### HF1 – Governance, Verantwortung und Compliance

| ID | Maßnahme | Prio | Verantwortlich |
|---|---|---|---|
| G1 | Geschäftsführung beschließt diese Strategie, benennt eine verantwortliche Person für Informationssicherheit und eine für KI-Governance (kann dieselbe Person sein) | P1 | Geschäftsführung |
| G2 | **KI-Inventar** aufbauen: alle genutzten KI-Systeme inkl. eingebetteter KI-Funktionen – Zweck, verarbeitete Daten, Anbieter, Berechtigungen, Risiko | P1 | KI-Verantwortliche/r |
| G3 | **KI-Nutzungsrichtlinie** in Kraft setzen ([Anhang D](anhang/D-richtlinie-ki-nutzung.md)) | P1 | Informationssicherheit, Datenschutz |
| G4 | KI-spezifische Bedrohungen in die Risikoanalyse des ISMS aufnehmen (Orientierung: ISO/IEC 27001; optional ISO/IEC 42001 für ein KI-Managementsystem) | P2 | Informationssicherheit |
| G5 | Bewertungskriterien für KI-Anbieter festlegen: Auftragsverarbeitungsvertrag, Datenstandort, kein Training mit unseren Daten, Subdienstleister, Zertifizierungen, Audit-Logs, Vorfallmeldung | P2 | Einkauf, Informationssicherheit |
| G6 | Compliance-Abgleich NISG 2026, DSGVO, AI Act (siehe [Kapitel 9](#9-rechtlicher-und-regulatorischer-rahmen)); Betroffenheit nach NISG 2026 klären | P1 | Geschäftsführung, Recht |
| G7 | Quartalsbericht an die Geschäftsführung (Kennzahlen, Vorfälle, Fortschritt der Roadmap) | P2 | Informationssicherheit |
| G8 | Budget für die Roadmap verbindlich freigeben | P1 | Geschäftsführung |

### HF2 – Identitäten und Zugriffe

| ID | Maßnahme | Prio | Verantwortlich |
|---|---|---|---|
| I1 | **Phishing-resistente MFA** (Passkeys oder FIDO2-Sicherheitsschlüssel) – zuerst Administration, Geschäftsführung, Finanzen, HR, Helpdesk; danach alle. SMS- und Anruf-MFA für privilegierte Konten abschalten; Push-Bestätigung nur mit Nummernabgleich | P1 → P3 | IT-Betrieb |
| I2 | **Legacy-Authentifizierung blockieren** (Protokolle ohne MFA-Unterstützung) | P1 | IT-Betrieb |
| I3 | **Helpdesk-Prozess für Resets:** Passwort- oder MFA-Reset nur nach starker Identitätsprüfung – Rückruf an hinterlegte Nummer **und** Bestätigung durch die vorgesetzte Person; nie allein aufgrund eines Anrufs, Chats oder Videocalls | P1 | IT-Helpdesk |
| I4 | **Bedingter Zugriff:** Anmeldung nur von verwalteten Geräten; risikobasierte Regeln (ungewöhnlicher Ort, anonyme IP-Adressen) | P2 | IT-Betrieb |
| I5 | **Privilegierte Konten:** getrennte Admin-Konten, Rechte nur bei Bedarf und zeitlich begrenzt (Just-in-Time), keine dauerhaften globalen Administratoren, gesicherte Notfallkonten | P2 | IT-Betrieb |
| I6 | **App-Zustimmungen einschränken:** Mitarbeitende dürfen Drittanbieter-Apps keinen Zugriff auf Postfach oder Dateien gewähren (Schutz vor Consent-Phishing) | P1 | IT-Betrieb |
| I7 | Passwort-Manager für alle; Abgleich gegen bekannte geleakte Passwörter | P2 | IT-Betrieb |
| I8 | **Eintritt, Wechsel, Austritt:** Rechte zeitnah anpassen bzw. entziehen; Identitätsprüfung bei Einstellung (Ausweis im Original oder ID Austria) vor Vergabe von Zugängen | P2 | HR, IT-Betrieb |
| I9 | **Eigene Identitäten für KI-Agenten und Dienstkonten:** keine geteilten Konten, keine Nutzung persönlicher Zugangsdaten durch Agenten, kurzlebige Tokens | P2 | IT-Betrieb |

### HF3 – Prozesse gegen Täuschung (Deepfake und Social Engineering)

Dies ist das wirksamste und günstigste Handlungsfeld: **Ein gut eingehaltener Prozess stoppt auch eine perfekte Fälschung.**

| ID | Maßnahme | Prio | Verantwortlich |
|---|---|---|---|
| P1 | **Verifikationsregeln** verbindlich einführen ([Anhang E](anhang/E-verifikationsregeln.md)) für: Zahlungen über [ANPASSEN: z. B. 5.000 €] oder außerhalb des Üblichen, jede Änderung von Bankverbindungen, Passwort-/MFA-Resets, Herausgabe vertraulicher Daten, Änderung von Zugriffsrechten, ungewöhnliche Anweisungen von Führungskräften | P1 | Geschäftsführung, Finanzen |
| P2 | **Rückruf ausschließlich über hinterlegte Nummern** (Stammdaten, Telefonverzeichnis) – nie über Kontaktdaten aus der Anfrage selbst | P1 | alle |
| P3 | **Vier-Augen-Prinzip** im Zahlungsverkehr, technisch im Online-Banking erzwungen (Kollektivzeichnung, Limits) | P1 | Finanzen |
| P4 | **Codewort-Verfahren** für Geschäftsführung, Assistenz und Finanzen: persönlich vereinbart, nirgends digital gespeichert, regelmäßig gewechselt | P1 | Geschäftsführung |
| P5 | **Rote Flaggen** verbindlich definieren: Dringlichkeit + Geheimhaltung + Abweichung vom Prozess + ungewohnter Kanal (privates Handy, Messenger) = **STOPP und prüfen** | P1 | Informationssicherheit |
| P6 | **Keine geschäftskritischen Anweisungen über private Messenger** oder neue, unbekannte Konten | P1 | alle |
| P7 | **Schriftliche Rückendeckung der Geschäftsführung:** Niemand wird kritisiert, weil er eine Anweisung verzögert, um sie zu prüfen – auch nicht, wenn sie echt war | P1 | Geschäftsführung |
| P8 | **Lieferanten-Stammdaten:** Änderungen nur nach Rückruf und dokumentierter Freigabe durch zweite Person; Lieferanten und Kunden über unser Verfahren informieren („Wir ändern unsere Bankdaten nie per E-Mail“) | P1 | Finanzen, Einkauf |
| P9 | **Öffentlich verfügbare Angriffsinformationen reduzieren:** Website, Social Media und Stellenanzeigen auf Organigramme, Zuständigkeiten in Finanzen/IT, Durchwahlen und eingesetzte Systeme prüfen | P2 | Marketing, Informationssicherheit |
| P10 | **Recruiting absichern:** mindestens ein persönliches Gespräch oder verifizierte Identität (z. B. ID Austria) vor Vergabe privilegierter Zugänge; Referenzen über selbst recherchierte Kontaktdaten prüfen; neue Mitarbeitende starten mit minimalen Rechten | P2 | HR |

### HF4 – Technische Abwehr

**E-Mail und Kommunikation**

| ID | Maßnahme | Prio | Verantwortlich |
|---|---|---|---|
| T1 | **SPF, DKIM und DMARC** für alle eigenen Domains – DMARC schrittweise bis `p=reject`, Berichte auswerten; auch nicht für E-Mail genutzte Domains absichern | P1 | IT-Betrieb |
| T2 | E-Mail-Sicherheit mit **Verhaltens- und KI-Analyse** (Erkennung von BEC, Lookalike-Domains, Erstkontakten), Kennzeichnung externer Absender | P2 | IT-Betrieb |
| T3 | Überwachung von **Lookalike-Domains** der eigenen Marke (Tippfehler-Domains) | P2 | IT-Betrieb |
| T4 | **Melde-Button** im E-Mail-Programm mit automatisierter Auswertung und schneller Rückmeldung | P1 | IT-Betrieb |

**Endgeräte und Server**

| ID | Maßnahme | Prio | Verantwortlich |
|---|---|---|---|
| T5 | **Verhaltensbasiertes EDR/XDR** auf allen Endgeräten und Servern mit Manipulationsschutz | P1 | IT-Betrieb |
| T6 | Lokale Administratorrechte entfernen; Makros und Skripte einschränken; Application Control für Server und Risikoarbeitsplätze | P2 | IT-Betrieb |
| T7 | Härtung nach anerkannten Baselines (z. B. CIS Benchmarks) | P3 | IT-Betrieb |

**Schwachstellen und Angriffsfläche**

| ID | Maßnahme | Prio | Verantwortlich |
|---|---|---|---|
| T8 | **Verbindliche Patch-Fristen** [ANPASSEN]: aktiv ausgenutzte Lücken (z. B. CISA-KEV-Katalog, CERT.at-Warnung) an aus dem Internet erreichbaren Systemen **≤ 48 Stunden** – sonst Notfallmaßnahme oder Abschalten; kritisch extern ≤ 7 Tage; kritisch intern ≤ 14 Tage; hoch ≤ 30 Tage | P1 | IT-Betrieb |
| T9 | **Externe Angriffsfläche** regelmäßig scannen; unnötige Dienste schließen (offenes RDP, VPN ohne MFA, veraltete Webanwendungen, Testsysteme) | P1 | IT-Betrieb |
| T10 | Vollständiges **Asset-Inventar** inkl. Cloud-Diensten, SaaS und Schatten-IT | P2 | IT-Betrieb |

**Netzwerk, Daten und Wiederherstellung**

| ID | Maßnahme | Prio | Verantwortlich |
|---|---|---|---|
| T11 | **Netzwerksegmentierung**; Administration nur über gesicherte Zugänge | P3 | IT-Betrieb |
| T12 | **Sicherungen nach 3-2-1-1-0:** drei Kopien, zwei Medien, eine extern, eine offline bzw. unveränderlich, null Fehler beim Wiederherstellungstest; Sicherungs-Zugänge getrennt von der Domäne | P1 | IT-Betrieb |
| T13 | DNS- und Webfilter (auch zur Steuerung nicht freigegebener KI-Dienste) | P2 | IT-Betrieb |
| T14 | **Zentrale Protokollierung** (Identität, E-Mail, Endgeräte, Cloud, KI-Dienste); Aufbewahrung [ANPASSEN: mind. 6–12 Monate] | P2 | IT-Betrieb |
| T15 | **Datenklassifizierung und DLP**, insbesondere für Uploads in KI-Dienste und externe Freigaben | P3 | Informationssicherheit |

### HF5 – Sichere Nutzung eigener KI-Systeme und KI-Agenten

| ID | Maßnahme | Prio | Verantwortlich |
|---|---|---|---|
| K1 | **Freigegebene KI-Werkzeuge** bereitstellen – nur Business-/Enterprise-Verträge: kein Training mit unseren Daten, Auftragsverarbeitungsvertrag, Single Sign-on, Audit-Logs, Admin-Kontrolle, Datenverarbeitung in der EU wo erforderlich. Nicht freigegebene Dienste blockieren oder mit Warnhinweis versehen | P1 | IT-Betrieb, KI-Verantwortliche/r |
| K2 | **Datenklassen-Matrix:** welche Daten in welches Werkzeug dürfen ([Anhang D](anhang/D-richtlinie-ki-nutzung.md)) | P1 | Informationssicherheit, Datenschutz |
| K3 | **Berechtigungen bereinigen, bevor KI-Suche oder Office-Assistenten aktiviert werden** – die KI findet alles, worauf der Nutzer formal Zugriff hat | P1 | IT-Betrieb |
| K4 | **Regeln für KI-Agenten** (siehe unten) verbindlich anwenden; jeder Agent mit Systemzugriff benötigt eine dokumentierte Freigabe | P2 | KI-Verantwortliche/r |
| K5 | **Wissensdatenbanken (RAG):** Berechtigungen der Quelldokumente werden in Antworten durchgesetzt; Schreibzugriff auf Quellen ist kontrolliert und protokolliert | P2 | IT-Betrieb |
| K6 | **KI-generierter Code:** gleiche Review-Pflicht wie für menschlichen Code; statische Analyse, Secret-Scanning, Prüfung aller Abhängigkeiten (existiert das Paket wirklich, ist es etabliert?) | P2 | Entwicklung |
| K7 | **KI-Lieferkette:** Modelle, Plugins, Erweiterungen und MCP-Server nur aus geprüften Quellen und von einer Allowlist; Versionen fixieren; Integrität prüfen (Hashes/Signaturen); bei eigenen Modellen sichere Formate (z. B. safetensors) und eine Stückliste (AI-BOM) | P2 | IT-Betrieb, Entwicklung |
| K8 | **Sicherheitstests vor Inbetriebnahme** eigener KI-Anwendungen: Red-Teaming bzw. Penetrationstest gegen OWASP Top 10 for LLM Applications und OWASP Top 10 for Agentic Applications; MITRE ATLAS als Katalog der Angriffstechniken | P3 | Informationssicherheit |
| K9 | **Transparenz nach AI Act Art. 50:** von uns veröffentlichte Deepfakes (KI-erzeugte oder manipulierte Bilder, Audio, Video) kennzeichnen; eigene Chatbots für Kunden als KI erkennbar machen | P1 | Marketing, KI-Verantwortliche/r |

**Sicherheitsregeln für KI-Agenten und Assistenten mit Systemzugriff**

1. **Minimale Rechte:** Ein Agent erhält nur die Rechte, die er für genau seine Aufgabe braucht – lesend, wo immer möglich.
2. **Mensch in der Schleife:** Aktionen mit Außenwirkung oder ohne Rückgängig-Möglichkeit erfordern eine menschliche Freigabe – insbesondere E-Mails an Externe, Zahlungen, Löschungen, Rechteänderungen, Deployments.
3. **Das „gefährliche Dreieck“ vermeiden:** Kein Agent darf ohne menschliche Kontrolle gleichzeitig
   (a) Zugriff auf vertrauliche Daten,
   (b) Kontakt mit nicht vertrauenswürdigen Inhalten (eingehende Mails, Webseiten, fremde Dokumente) und
   (c) einen Weg zur Datenausleitung (Mailversand, Web-Anfragen, Rendern externer Links oder Bilder) haben.
4. **Prompt Injection gilt als nicht vollständig lösbar.** Filter helfen, reichen aber nicht. Der mögliche Schaden wird durch die Architektur (Punkte 1–3) begrenzt.
5. **Eigene Identität, kurzlebige Tokens, keine Geheimnisse im Prompt.**
6. **Vollständige Protokollierung** aller Eingaben, Werkzeugaufrufe und Aktionen; Auswertung im Monitoring.
7. **Kill-Switch:** Jeder Agent kann sofort deaktiviert und seine Zugangsdaten widerrufen werden – die Verantwortlichen wissen, wie.

### HF6 – Menschen: Bewusstsein, Kompetenz und Kultur

| ID | Maßnahme | Prio | Verantwortlich |
|---|---|---|---|
| M1 | **Kernbotschaft neu ausrichten:** „Echtheit lässt sich nicht mehr erkennen – deshalb halten wir den Prozess ein.“ | P1 | Informationssicherheit |
| M2 | **Deepfake-Demonstration** bei der nächsten Mitarbeiterveranstaltung (z. B. mit Einverständnis geklonte Stimme der Geschäftsführung) – die wirksamste Einzelmaßnahme für Bewusstsein | P1 | Informationssicherheit, Geschäftsführung |
| M3 | **Zielgruppenspezifische Schulungen** (siehe Tabelle) | P1 → P2 | Informationssicherheit, HR |
| M4 | **Realistische Simulationen:** KI-generiertes Phishing, Vishing-Tests (nach Information des Betriebsrats und unter Wahrung der Datenschutzanforderungen) | P2 | Informationssicherheit |
| M5 | **KI-Kompetenz nach AI Act Art. 4** für alle, die KI nutzen – Inhalte und Teilnahme dokumentieren | P2 | HR, KI-Verantwortliche/r |
| M6 | **Meldekultur:** Melden mit einem Klick, schnelle Rückmeldung, Anerkennung für Meldungen, keine Sanktion bei gemeldeten Fehlern | P1 | Geschäftsführung |

**Schulungsprogramm nach Zielgruppen** [ANPASSEN]

| Zielgruppe | Schwerpunkte | Format und Frequenz |
|---|---|---|
| **Alle Mitarbeitenden** | KI-Phishing, Deepfakes, Verifikationsregeln, Melden, KI-Nutzungsrichtlinie, KI-Kompetenz | Onboarding + jährlich 60 min, monatliche Kurzimpulse, Simulationen |
| **Geschäftsführung** | Rolle als bevorzugtes Deepfake-Ziel, Codewort-Verfahren, Krisenentscheidungen, Haftung und Schulungspflicht nach NISG 2026 | Jährlich, inkl. Notfallübung (Tabletop) |
| **Finanzen / Buchhaltung** | CEO- und Rechnungsbetrug, Bankdatenänderungen, Rückrufpflicht, Vorgehen nach Fehlüberweisung | Halbjährlich, praxisnahe Fallbeispiele |
| **Assistenz / Empfang** | Vishing, Informationsabfrage durch Dritte, Weiterleitung an falsche „Vorgesetzte“ | Halbjährlich |
| **HR / Recruiting** | Gefälschte Bewerbende, Deepfake-Interviews, Identitätsprüfung, Schadsoftware in Bewerbungsunterlagen | Jährlich |
| **IT / Helpdesk** | Reset-Betrug, Admin-Phishing, Erkennungsregeln, Incident Response | Halbjährlich, technische Übungen |
| **Entwicklung / KI-Anwender mit Agenten** | Prompt Injection, sichere Agenten-Architektur, KI-generierter Code, Lieferkette | Jährlich + vor neuen KI-Projekten |

### HF7 – Erkennung, Reaktion und Wiederherstellung

| ID | Maßnahme | Prio | Verantwortlich |
|---|---|---|---|
| R1 | **24/7-Überwachung** durch eigenes SOC oder MDR-Dienstleister – automatisierte Angriffe richten sich nicht nach Bürozeiten | P2 | IT-Betrieb |
| R2 | **Erkennungsregeln für typische Muster:** unmögliche Reisen, neue MFA-Methode registriert, Reset nach Helpdesk-Kontakt, neue Posteingangsregeln (Weiterleitung, Löschung), App-Zustimmungen, Massen-Downloads, Anmeldungen über Hosting-/Anonymisierungs-IPs, ungewöhnliche Agenten- oder API-Aktivität, Bankdatenänderungen im ERP | P2 | IT-Betrieb / MDR |
| R3 | **Incident-Response-Plan** mit KI-spezifischen Playbooks ([A](anhang/A-playbook-deepfake-ceo-betrug.md), [B](anhang/B-playbook-ki-phishing-kontouebernahme.md), [C](anhang/C-playbook-angriff-auf-ki-systeme.md)); klare Entscheidungsbefugnisse (wer darf Systeme vom Netz nehmen?) | P1 | Informationssicherheit |
| R4 | **Meldeprozesse vorbereiten:** NISG 2026 (Frühwarnung ≤ 24 h, Meldung ≤ 72 h, Abschlussbericht ≤ 1 Monat an das zuständige CSIRT), DSGVO (≤ 72 h an die Datenschutzbehörde), Bank, Polizei, Versicherung | P1 | Informationssicherheit, Recht |
| R5 | **Notfallkontakte vorab festlegen:** Incident-Response-Dienstleister mit Rahmenvertrag, Hausbank (Betrugs-Hotline), CERT.at, Polizei, WKO Cyber-Security-Hotline (0800 888 133), Versicherung | P1 | Informationssicherheit |
| R6 | **Übungen:** jährliche Tabletop-Übung mit der Geschäftsführung (z. B. „Deepfake-Anruf der Geschäftsführung und Ransomware am Freitagabend“); Wiederherstellungstests quartalsweise | P2 | Informationssicherheit |
| R7 | **Krisenkommunikation**, auch für Deepfakes der eigenen Führung: vorbereitete Stellungnahmen, verifizierte Kommunikationskanäle, Monitoring | P3 | Kommunikation |
| R8 | **Cyber-Versicherung prüfen:** Ist Social Engineering bzw. „Fake President“ ausdrücklich gedeckt (häufig ausgeschlossen oder nur mit niedrigem Sublimit)? | P2 | Geschäftsführung |

### HF8 – Lieferkette und Partner

| ID | Maßnahme | Prio | Verantwortlich |
|---|---|---|---|
| L1 | **Mindestanforderungen an IT-Dienstleister:** phishing-resistente MFA, Meldung von Vorfällen ≤ 24 h, protokollierte Zugriffe, Fernwartung nur nach Freigabe | P2 | Einkauf, IT-Betrieb |
| L2 | **Fernwartungszugänge** inventarisieren, nur bei Bedarf freischalten | P1 | IT-Betrieb |
| L3 | **Partner informieren** über unser Verifikationsverfahren und um Gleiches bitten | P2 | Finanzen, Vertrieb |
| L4 | **KI-Anbieter** nach den Kriterien aus G5 bewerten, vor Vertragsabschluss und jährlich | P2 | Einkauf |
| L5 | Bei eigener Software: **SBOM** und Prüfung von Abhängigkeiten | P3 | Entwicklung |

### HF9 – KI für die Verteidigung

| ID | Maßnahme | Prio | Verantwortlich |
|---|---|---|---|
| D1 | KI-gestützte E-Mail-Analyse, EDR und Protokollauswertung nutzen (in modernen Sicherheitsprodukten meist enthalten) | P2 | IT-Betrieb |
| D2 | KI-Assistenz im SOC für Triage, Zusammenfassung und Vorschläge – **folgenreiche Aktionen bestätigt ein Mensch** | P3 | IT-Betrieb / MDR |
| D3 | KI-gestützte Prüfung von Code und Konfigurationen, um Schwachstellen vor Angreifern zu finden | P3 | Entwicklung, IT-Betrieb |
| D4 | Verteidigungs-KI unterliegt denselben Regeln wie HF5 – sie hat oft besonders hohe Rechte | P2 | Informationssicherheit |
| D5 | **Deepfake-Erkennungstools nur als Ergänzung** – nie als alleinige Kontrolle; ihre Erkennungsraten sind unzuverlässig und Angreifer passen sich an | P3 | Informationssicherheit |

---

## 6. Umsetzungsplan (Roadmap)

### Phase 1 – Sofortmaßnahmen (Tag 0–30)

**Ziel:** Die häufigsten und teuersten KI-Angriffe (Deepfake-/CEO-Betrug, Kontoübernahme, Schatten-KI) wirksam stoppen.

- [ ] Strategie beschlossen, Verantwortliche benannt, Budget freigegeben (G1, G8)
- [ ] Verifikationsregeln, Vier-Augen-Prinzip, Codewort-Verfahren und schriftliche Rückendeckung der Geschäftsführung in Kraft (P1–P7)
- [ ] Prozess für Lieferanten-Bankdatenänderungen (P8)
- [ ] Helpdesk-Reset-Prozess verschärft (I3)
- [ ] Phishing-resistente MFA für Administration, Geschäftsführung, Finanzen, HR, Helpdesk (I1, erste Stufe)
- [ ] Legacy-Authentifizierung blockiert, App-Zustimmungen eingeschränkt (I2, I6)
- [ ] DMARC mindestens `p=quarantine`, Plan bis `p=reject` (T1)
- [ ] Freigegebenes KI-Werkzeug bereitgestellt, KI-Nutzungsrichtlinie veröffentlicht (K1, K2, G3)
- [ ] Berechtigungen geprüft, bevor KI-Suche/Office-Assistenten aktiv sind (K3)
- [ ] Offline-/unveränderliche Sicherung geprüft (T12), externe Angriffsfläche gescannt (T9), Patch-Fristen festgelegt (T8)
- [ ] Kurzbriefing und Deepfake-Demonstration für Risikogruppen (M1–M3)
- [ ] Notfallkontakte und Meldewege dokumentiert (R4, R5); NISG-Betroffenheit geklärt (G6)

### Phase 2 – Grundschutz (Tag 31–90)

**Ziel:** Flächendeckender Basisschutz und Erkennungsfähigkeit.

- [ ] KI-Inventar vollständig, KI-Risiken in der Risikoanalyse (G2, G4)
- [ ] EDR auf allen Systemen, 24/7-Überwachung (eigen oder MDR) aktiv (T5, R1)
- [ ] Erkennungsregeln für KI-Angriffsmuster (R2)
- [ ] Bedingter Zugriff, getrennte Admin-Konten, Just-in-Time-Rechte (I4, I5)
- [ ] E-Mail-Sicherheit mit Verhaltensanalyse, Lookalike-Domain-Überwachung (T2, T3)
- [ ] Regeln für KI-Agenten verbindlich, Freigabeprozess etabliert (K4–K7)
- [ ] Zielgruppenschulungen gestartet, erste Phishing-Simulation (M3, M4)
- [ ] Erste Tabletop-Übung mit der Geschäftsführung (R6)
- [ ] Anforderungen an IT-Dienstleister und KI-Anbieter vertraglich verankert (L1, L4, G5)
- [ ] Registrierung nach NISG 2026 (falls betroffen) – **Frist 31.12.2026**

### Phase 3 – Ausbau (Monat 4–12)

**Ziel:** Reife, Nachweisbarkeit und kontinuierliche Verbesserung.

- [ ] Phishing-resistente MFA für ≥ 90 % aller Konten (I1)
- [ ] Netzwerksegmentierung, Härtung, Application Control (T6, T7, T11)
- [ ] Datenklassifizierung und DLP inkl. KI-Uploads (T15)
- [ ] Red-Teaming eigener KI-Anwendungen und Agenten (K8)
- [ ] Krisenkommunikation inkl. Deepfake-Szenario (R7)
- [ ] KI-gestützte Verteidigung ausgebaut (D1–D3)
- [ ] Selbstbewertung wiederholt ([Anhang F](anhang/F-checkliste-selbstbewertung.md)), Strategie überprüft

### Phase 4 – Kontinuierlich (ab Monat 12)

- Halbjährliche Überprüfung der Strategie und Bedrohungslage
- Jährliche Notfallübung, quartalsweise Wiederherstellungstests
- Laufende Simulationen und Schulungen
- Jährliche Bewertung von KI-Anbietern und IT-Dienstleistern
- Selbstdeklaration zur Wirksamkeit des Risikomanagements nach NISG 2026 (falls betroffen)

---

## 7. Rollen und Verantwortlichkeiten

**R** = durchführend, **A** = verantwortlich (entscheidet), **C** = konsultiert, **I** = informiert

| Aufgabe | Geschäftsführung | Informations­sicherheit | KI-Verant­wortliche/r | IT-Betrieb / MSP | Finanzen | HR | Datenschutz | Alle Mitarbeitenden |
|---|---|---|---|---|---|---|---|---|
| Strategie beschließen und überwachen | A | R | C | C | I | I | C | I |
| Verifikationsregeln einhalten | A | C | – | – | R | R | – | R |
| Identitäten und MFA | I | A | – | R | – | C | – | R |
| KI-Inventar und KI-Freigaben | I | C | A/R | C | – | – | C | I |
| KI-Nutzungsrichtlinie | A | R | R | C | – | C | C | R |
| Technische Schutzmaßnahmen | I | A | C | R | – | – | – | – |
| Schulung und Awareness | A | R | C | C | – | R | C | R |
| Erkennung und Vorfallsbehandlung | I | A | C | R | C | – | C | R (melden) |
| Behördenmeldungen (NISG, DSGVO) | A | R | C | C | – | – | R | – |
| Lieferanten- und KI-Anbieterbewertung | I | A | R | C | C | – | C | – |

---

## 8. Kennzahlen und Erfolgsmessung

| Kennzahl | Zielwert [ANPASSEN] | Quelle | Frequenz |
|---|---|---|---|
| Anteil Konten mit phishing-resistenter MFA – privilegiert / alle | 100 % / ≥ 90 % | Identitätsplattform | monatlich |
| Kritische Transaktionen mit dokumentierter Verifikation | 100 % | Stichprobe Finanzen | quartalsweise |
| **Melderate** in Phishing-Simulationen (wichtiger als die Klickrate) | ≥ 70 % | Simulationsplattform | je Kampagne |
| Klickrate / Dateneingaberate in Simulationen | sinkend / < 3 % | Simulationsplattform | je Kampagne |
| Zeit bis zum Schließen aktiv ausgenutzter Lücken an extern erreichbaren Systemen | ≤ 48 h | Schwachstellenmanagement | monatlich |
| Zeit bis zur Eindämmung kritischer Vorfälle | ≤ 4 h | SOC/MDR | je Vorfall |
| Genutzte KI-Systeme im Inventar und bewertet | 100 % | KI-Inventar | quartalsweise |
| Funde nicht freigegebener KI-Dienste (Schatten-KI) | sinkend | Web-Filter / CASB | monatlich |
| KI-Agenten mit dokumentierter Freigabe und Kill-Switch | 100 % | KI-Inventar | quartalsweise |
| Schulungsquote (inkl. KI-Kompetenz) | ≥ 95 % | HR | quartalsweise |
| Erfolgreiche Wiederherstellungstests | 4 pro Jahr | IT-Betrieb | quartalsweise |
| Durchgeführte Notfallübungen mit der Geschäftsführung | ≥ 1 pro Jahr | Informationssicherheit | jährlich |

---

## 9. Rechtlicher und regulatorischer Rahmen

*Stand Oktober 2026. Diese Übersicht ersetzt keine Rechtsberatung; Fristen und Pflichten sind im Einzelfall mit dem Gesetzestext (RIS, EUR-Lex) zu prüfen.*

### NISG 2026 (österreichische Umsetzung der NIS-2-Richtlinie)

- Kundgemacht als BGBl. I Nr. 94/2025, **in Kraft seit 1. Oktober 2026**; ersetzt das NISG 2018.
- **Betroffenheit prüfen:** grundsätzlich mittlere und große Unternehmen (ab 50 Beschäftigten oder über 10 Mio. € Umsatz bzw. Bilanzsumme) in den erfassten Sektoren; kleinere Unternehmen können indirekt als Zulieferer betroffen sein.
- **Registrierung** bei der Cybersicherheitsbehörde bis **31. Dezember 2026**.
- **Risikomanagementmaßnahmen** ohne Übergangsfrist – die Maßnahmen dieser Strategie (insbesondere HF2, HF4, HF7, HF8) zahlen direkt darauf ein.
- **Meldepflichten** bei erheblichen Vorfällen an das zuständige CSIRT: Frühwarnung binnen 24 Stunden, Meldung binnen 72 Stunden, Abschlussbericht binnen eines Monats.
- **Leitungsorgane** müssen die Maßnahmen billigen, ihre Umsetzung überwachen und an Cybersicherheitsschulungen teilnehmen.
- **Sanktionen** bis 10 Mio. € bzw. 2 % des weltweiten Jahresumsatzes (wesentliche Einrichtungen) bzw. 7 Mio. € bzw. 1,4 % (wichtige Einrichtungen).

### EU-Verordnung über künstliche Intelligenz (AI Act, VO (EU) 2024/1689)

- **Seit 2. Februar 2025:** Verbotene KI-Praktiken; **Pflicht zur KI-Kompetenz** (Art. 4) für Personal, das KI-Systeme betreibt oder nutzt → Maßnahme M5.
- **Seit 2. August 2025:** Pflichten für Anbieter von KI-Modellen mit allgemeinem Verwendungszweck.
- **Seit 2. August 2026:** **Transparenzpflichten** (Art. 50) – u. a. Kennzeichnung von Deepfakes durch Betreiber → Maßnahme K9.
- **Hochrisiko-KI:** Durch den „Digital Omnibus“ verschoben – eigenständige Hochrisiko-Systeme (Anhang III) voraussichtlich ab 2. Dezember 2027, in Produkte eingebettete (Anhang I) ab 2. August 2028. Relevant, falls wir KI z. B. im Recruiting oder zur Bewertung von Beschäftigten einsetzen.

### DSGVO

- Datenschutz-Folgenabschätzung bei KI-Verarbeitung personenbezogener Daten mit hohem Risiko.
- Auftragsverarbeitungsverträge mit KI-Anbietern; Prüfung von Drittlandübermittlungen.
- Meldung von Datenschutzverletzungen binnen 72 Stunden an die Datenschutzbehörde.

### Weitere, je nach Tätigkeit

- **DORA** (seit 17. Jänner 2025) – für Finanzunternehmen und deren IKT-Dienstleister.
- **Cyber Resilience Act** – für Hersteller von Produkten mit digitalen Elementen: Meldepflichten seit 11. September 2026, volle Anwendung ab 11. Dezember 2027.
- **Arbeitsrecht** – Mitbestimmung des Betriebsrats bei Kontrollmaßnahmen (z. B. Monitoring, Simulationen) beachten.

---

## 10. Pflege und Weiterentwicklung

- **Regelmäßige Überprüfung:** halbjährlich durch Informationssicherheit, Freigabe durch die Geschäftsführung.
- **Anlassbezogene Überprüfung:** nach erheblichen Vorfällen, bei neuen Angriffstechniken (z. B. Warnungen von CERT.at, Watchlist Internet, ENISA), bei Gesetzesänderungen oder bei Einführung neuer KI-Systeme mit Systemzugriff.
- **Erfolgskontrolle:** Kennzahlen aus [Kapitel 8](#8-kennzahlen-und-erfolgsmessung) und Selbstbewertung ([Anhang F](anhang/F-checkliste-selbstbewertung.md)).
- **Versionierung:** Änderungen werden in diesem Repository nachvollziehbar dokumentiert.

---

## 11. Referenzen

**Rahmenwerke und Kataloge**

- OWASP Top 10 for LLM Applications – <https://genai.owasp.org/llm-top-10/>
- OWASP Top 10 for Agentic Applications (2026) – <https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/>
- MITRE ATLAS (Angriffstechniken gegen KI-Systeme) – <https://atlas.mitre.org/>
- NIST AI Risk Management Framework – <https://www.nist.gov/itl/ai-risk-management-framework>
- ENISA (Bedrohungslageberichte) – <https://www.enisa.europa.eu/>

**Rechtsquellen**

- Rechtsinformationssystem des Bundes (NISG 2026) – <https://www.ris.bka.gv.at/>
- AI Act, VO (EU) 2024/1689 – <https://eur-lex.europa.eu/eli/reg/2024/1689/oj>

**Anlaufstellen in Österreich**

- CERT.at (Warnungen, Vorfallmeldung) – <https://www.cert.at/>
- Watchlist Internet (aktuelle Betrugsmaschen) – <https://www.watchlist-internet.at/>
- WKO Cyber-Security-Hotline, 24/7, für Mitglieder kostenlos: **0800 888 133** – <https://www.wko.at/cyber-security-hotline>
