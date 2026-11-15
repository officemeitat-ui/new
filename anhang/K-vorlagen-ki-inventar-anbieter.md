# Anhang K – Vorlagen: KI-Inventar, Agenten-Freigabe und Anbieterbewertung

> Zurück zur [Strategie](../KI-Cybersicherheitsstrategie.md) · Maßnahmen G2, G5, K4, L1, L4

---

## K.1 KI-Inventar (G2)

Jedes KI-System wird erfasst – auch KI-Funktionen, die in bestehender Software stecken (Office-Assistent, CRM-, ERP-, Helpdesk- oder Buchhaltungs-KI, Meeting-Transkription, Übersetzung). Eine ausfüllbare Tabelle liegt als [CSV-Vorlage](../vorlagen/ki-inventar.csv) bei.

| Feld | Beschreibung |
|---|---|
| ID | fortlaufend, z. B. KI-001 |
| Name / Produkt | Bezeichnung und Anbieter |
| Art | Chat-Assistent · eingebettete KI-Funktion · KI-Agent mit Handlungsrechten · Wissensdatenbank (RAG) · Kunden-Chatbot · eigenes Modell · Coding-Assistent |
| Zweck | Wofür wird es genutzt? |
| Fachverantwortlich | Person im Fachbereich |
| Nutzende | Gruppen / Anzahl |
| Höchste Datenklasse | Öffentlich · Intern · Vertraulich · Streng vertraulich ([Anhang D](D-richtlinie-ki-nutzung.md)) |
| Personenbezogene Daten | ja/nein; besondere Kategorien ja/nein |
| Verarbeitet externe Inhalte | ja/nein (eingehende Mails, Webseiten, fremde Dokumente) |
| Handlungsrechte | keine (nur Antworten) · lesend · schreibend · Außenwirkung (senden, teilen, zahlen) |
| Ausleitungsweg möglich | ja/nein (Mailversand, Web-Anfragen, externe Links/Bilder) |
| Menschliche Freigabe | ja/nein, für welche Aktionen |
| Vertrag | Business/Enterprise, Auftragsverarbeitungsvertrag ja/nein, Training mit unseren Daten ausgeschlossen ja/nein |
| Datenstandort | EU / Drittland (welches) |
| AI-Act-Einordnung | minimales Risiko · Transparenzpflicht (Art. 50) · Hochrisiko (Anhang III, z. B. Recruiting) · verboten |
| Risikostufe | niedrig · mittel · hoch (siehe K.2) |
| Freigabe | Datum, freigegeben durch |
| Nächste Überprüfung | Datum |

---

## K.2 Risikostufe bestimmen

| Kriterium | niedrig | mittel | hoch |
|---|---|---|---|
| Höchste Datenklasse | Öffentlich / Intern | Vertraulich | Streng vertraulich |
| Handlungsrechte | keine | lesend oder schreibend intern | Außenwirkung (senden, teilen, zahlen, löschen) oder Änderung von Zahlungs- bzw. Bankdaten |
| Externe Inhalte + vertrauliche Daten + Ausleitungsweg („gefährliches Dreieck“) | höchstens eines davon | zwei davon | **alle drei** – ohne menschliche Freigabe nicht zulässig |
| Entscheidungen über Menschen | nein | unterstützt Menschen | beeinflusst Einstellung, Bewertung, Kündigung o. Ä. |
| AI-Act-Einordnung | minimales Risiko | Transparenzpflicht | Hochrisiko |

**Regel:** Das höchste zutreffende Kriterium bestimmt die Stufe.

| Risikostufe | Freigabe durch | Anforderungen | Überprüfung |
|---|---|---|---|
| niedrig | KI-Verantwortliche/r | Eintrag im Inventar, Richtlinie gilt | jährlich |
| mittel | KI-Verantwortliche/r + Informationssicherheit | zusätzlich Anbieterbewertung (K.4), Protokollierung | halbjährlich |
| hoch | zusätzlich Datenschutz und Geschäftsführung | zusätzlich Agenten-Freigabe (K.3), Sicherheitstest vor Inbetriebnahme (K8), ggf. Datenschutz-Folgenabschätzung | quartalsweise |

---

## K.3 Freigabe-Checkliste für KI-Agenten (K4)

Für jede KI, die nicht nur antwortet, sondern **handelt**.

| # | Prüfpunkt | Erfüllt |
|---|---|---|
| 1 | Zweck, Fachverantwortliche/r und technische/r Verantwortliche/r sind dokumentiert | ☐ |
| 2 | Der Agent hat eine eigene Identität (kein persönliches Konto, kein geteiltes Konto) | ☐ |
| 3 | Berechtigungen sind auf das Minimum begrenzt und einzeln begründet | ☐ |
| 4 | Liste aller Werkzeuge, Plugins und MCP-Server liegt vor; alle stehen auf der Allowlist, Versionen sind fixiert | ☐ |
| 5 | Aktionen mit Außenwirkung oder ohne Rückgängig-Möglichkeit erfordern menschliche Freigabe | ☐ |
| 6 | Das „gefährliche Dreieck“ ist aufgelöst oder durch menschliche Freigabe abgesichert | ☐ |
| 7 | Ausgehender Netzverkehr ist auf freigegebene Ziele begrenzt | ☐ |
| 8 | Geheimnisse liegen in einem Tresor, nicht im Code oder Prompt; Rotation ist geregelt | ☐ |
| 9 | Prompts, Werkzeugaufrufe und Ergebnisse werden protokolliert und überwacht | ☐ |
| 10 | Kill-Switch ist dokumentiert und wurde getestet | ☐ |
| 11 | Test gegen Prompt Injection (direkt und über verarbeitete Inhalte) wurde durchgeführt, Ergebnis dokumentiert | ☐ |
| 12 | Datenschutz geprüft (Rechtsgrundlage, Auftragsverarbeitung, ggf. Folgenabschätzung) | ☐ |
| 13 | Eintrag im KI-Inventar ist vollständig | ☐ |

Freigegeben durch: ______________________ Datum: ____________ Nächste Überprüfung: ____________

---

## K.4 Fragebogen für KI-Anbieter (G5, L4)

| # | Frage | Antwort | Bewertung |
|---|---|---|---|
| **Datenverwendung** | | | |
| 1 | Werden unsere Eingaben, Dateien oder Ausgaben zum Training oder zur Verbesserung von Modellen verwendet? Ist das vertraglich ausgeschlossen? | | |
| 2 | Wie lange werden Eingaben und Ausgaben gespeichert? Können wir die Aufbewahrung festlegen bzw. Löschung veranlassen? | | |
| 3 | Wer beim Anbieter kann auf unsere Daten zugreifen (z. B. für Missbrauchsprüfung) und unter welchen Bedingungen? | | |
| **Recht und Datenschutz** | | | |
| 4 | Liegt ein Auftragsverarbeitungsvertrag nach Art. 28 DSGVO vor? | | |
| 5 | Wo werden Daten verarbeitet und gespeichert? Gibt es eine EU-Datenverarbeitungsoption? | | |
| 6 | Welche Unterauftragsverarbeiter werden eingesetzt? Wie werden wir über Änderungen informiert? | | |
| 7 | Grundlage für Drittlandübermittlungen (z. B. Angemessenheitsbeschluss, Standardvertragsklauseln)? | | |
| 8 | Wie erfüllt der Anbieter seine Pflichten aus dem AI Act (z. B. Dokumentation, Transparenz, Kennzeichnung synthetischer Inhalte)? | | |
| **Sicherheit** | | | |
| 9 | Welche Zertifizierungen bzw. Prüfberichte liegen vor (z. B. ISO/IEC 27001, ISO/IEC 42001, SOC 2 Typ II)? | | |
| 10 | Unterstützt der Dienst Single Sign-on und die Durchsetzung unserer MFA-Richtlinien? | | |
| 11 | Gibt es Admin-Kontrollen (Benutzerverwaltung, Funktionsfreigaben, Datenaufbewahrung) und Audit-Protokolle, die wir exportieren können? | | |
| 12 | Wie schützt der Anbieter vor Prompt Injection und Missbrauch von Werkzeugen/Agenten? Welche Einstellungen haben wir dafür? | | |
| 13 | Wie werden Plugins, Erweiterungen und Integrationen von Drittanbietern geprüft? Können wir sie einschränken? | | |
| 14 | Werden Daten bei der Übertragung und Speicherung verschlüsselt? Ist eigene Schlüsselverwaltung möglich? | | |
| **Betrieb und Vorfälle** | | | |
| 15 | Innerhalb welcher Frist informiert uns der Anbieter über Sicherheitsvorfälle, die unsere Daten betreffen? | | |
| 16 | Wie werden wir über Modellwechsel oder wesentliche Verhaltensänderungen informiert? | | |
| 17 | Welche Verfügbarkeit wird zugesagt? Was passiert mit unseren Daten bei Vertragsende? | | |
| 18 | Gibt es ein Programm zur Meldung von Schwachstellen (Bug Bounty, Responsible Disclosure)? | | |

**Ausschlusskriterien:** Training mit unseren Daten nicht ausschließbar · kein Auftragsverarbeitungsvertrag · kein Single Sign-on für Dienste mit vertraulichen Daten · keine Vorfallmeldung zugesagt.

---

## K.5 Mindestanforderungen an IT-Dienstleister (L1)

Folgende Punkte vertraglich vereinbaren (bei bestehenden Verträgen als Zusatzvereinbarung):

1. **Phishing-resistente MFA** für alle Zugänge des Dienstleisters zu unseren Systemen.
2. **Personengebundene Konten** – keine geteilten Zugänge; Liste der berechtigten Personen, Aktualisierung bei Personalwechsel.
3. **Fernwartung nur nach Freigabe** im Einzelfall oder in vereinbarten Zeitfenstern; alle Sitzungen werden protokolliert.
4. **Meldung von Sicherheitsvorfällen** beim Dienstleister, die uns betreffen können, **binnen 24 Stunden** (wichtig für unsere eigene NISG-Frühwarnfrist).
5. **Eigene Verifikationsregeln:** Der Dienstleister führt Passwort-/MFA-Resets, Rechteänderungen und Konfigurationsänderungen nur nach Rückruf über hinterlegte Kontakte aus.
6. **Einsatz von KI-Werkzeugen** bei der Arbeit mit unseren Systemen oder Daten nur nach unserer Zustimmung und unter Einhaltung unserer KI-Nutzungsrichtlinie.
7. **Nachweise** auf Anfrage (z. B. Zertifikate, Prüfberichte, Ergebnisse von Penetrationstests).
8. **Rückgabe und Löschung** von Daten und Zugängen bei Vertragsende.
