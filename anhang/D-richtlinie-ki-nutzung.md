# Anhang D – KI-Nutzungsrichtlinie (Muster)

> Zurück zur [Strategie](../KI-Cybersicherheitsstrategie.md)

| | |
|---|---|
| **Gültig ab** | [ANPASSEN] |
| **Gilt für** | alle Mitarbeitenden, Führungskräfte, Praktikant/innen und externe Personen mit Zugang zu unseren Systemen oder Daten |
| **Verantwortlich** | [ANPASSEN: KI-Verantwortliche/r] |

---

## 1. Zweck

KI-Werkzeuge machen uns produktiver – wir wollen sie nutzen. Diese Richtlinie stellt sicher, dass dabei keine vertraulichen Daten abfließen, keine Sicherheitslücken entstehen und gesetzliche Pflichten (DSGVO, AI Act, Vertraulichkeitsvereinbarungen) eingehalten werden.

## 2. Grundsätze

1. **Freigegebene Werkzeuge nutzen.** Für die Arbeit verwenden wir ausschließlich KI-Werkzeuge aus der Liste in Abschnitt 3.
2. **Daten nach Klasse behandeln.** Welche Daten in welches Werkzeug dürfen, regelt die Matrix in Abschnitt 4.
3. **Der Mensch bleibt verantwortlich.** KI-Ergebnisse können falsch, erfunden oder manipuliert sein. Wer ein Ergebnis verwendet, prüft es und verantwortet es.
4. **KI-Inhalte sind nicht vertrauenswürdig.** Anweisungen, Links oder Code aus KI-Antworten werden geprüft, bevor wir danach handeln.
5. **Im Zweifel fragen.** Ansprechperson: [ANPASSEN].

## 3. Freigegebene KI-Werkzeuge [ANPASSEN]

| Werkzeug | Zugelassen für | Höchste erlaubte Datenklasse | Hinweise |
|---|---|---|---|
| [z. B. KI-Assistent im Business-/Enterprise-Tarif mit SSO] | Texte, Recherche, Zusammenfassungen, Analysen | Vertraulich | Anmeldung nur mit Firmenkonto |
| [z. B. Office-integrierter Assistent] | Arbeit mit eigenen Dokumenten und Mails | Vertraulich | Findet alles, worauf Sie Zugriff haben |
| [z. B. Coding-Assistent] | Softwareentwicklung | Intern | Keine Zugangsdaten im Code oder Prompt |
| [z. B. internes KI-System] | [Zweck] | Streng vertraulich | nur für berechtigte Gruppen |

**Nicht freigegeben** sind insbesondere: private Konten bei KI-Diensten (auch kostenpflichtige Privat-Tarife), kostenlose Online-Übersetzer und -Transkriptionsdienste, KI-Browser-Erweiterungen, KI-Meeting-Bots und Apps, die nicht in der Liste stehen.

Neue Werkzeuge können beantragt werden: [ANPASSEN: Prozess/Formular]. Die Prüfung erfolgt nach den Kriterien der Strategie (Maßnahme G5).

## 4. Datenklassen-Matrix

| Datenklasse | Beispiele | Öffentliche / private KI-Dienste | Freigegebene Business-KI | Interne KI-Systeme |
|---|---|---|---|---|
| **Öffentlich** | Veröffentlichte Website-Texte, Pressemitteilungen | ✅ erlaubt | ✅ erlaubt | ✅ erlaubt |
| **Intern** | Interne Abläufe, allgemeine Korrespondenz, nicht sensible Entwürfe | ❌ nicht erlaubt | ✅ erlaubt | ✅ erlaubt |
| **Vertraulich** | Kundendaten, personenbezogene Daten, Verträge, Angebote, Finanzdaten, Quellcode | ❌ nicht erlaubt | ✅ erlaubt, soweit für den Zweck nötig | ✅ erlaubt |
| **Streng vertraulich** | Gesundheitsdaten und andere besondere Kategorien, Geschäftsgeheimnisse, M&A, Personalakten, Sicherheitskonfigurationen | ❌ nicht erlaubt | ⚠️ nur mit Einzelfreigabe | ✅ nur wenn ausdrücklich dafür freigegeben |
| **Zugangsdaten** | Passwörter, API-Schlüssel, Tokens, Zertifikate, private Schlüssel | ❌ **niemals** | ❌ **niemals** | ❌ **niemals** |

## 5. Verbote

- **Keine Zugangsdaten** (Passwörter, Schlüssel, Tokens) in KI-Werkzeuge eingeben – auch nicht in Code-Ausschnitten.
- **Keine automatisierten Entscheidungen über Menschen** (z. B. Bewerbungsauswahl, Leistungsbewertung) allein durch KI. Der Einsatz von KI im Personalbereich muss vorab freigegeben werden (AI Act, DSGVO, Betriebsrat).
- **Keine Deepfakes realer Personen** ohne deren ausdrückliche Einwilligung und ohne Kennzeichnung.
- **Keine eigenen KI-Agenten, Automatisierungen oder Integrationen** mit Zugriff auf Firmensysteme, Postfächer oder Daten ohne Freigabe (Maßnahme K4).
- **Keine KI-Erweiterungen, Plugins oder MCP-Server** installieren, die nicht freigegeben sind.
- **Keine KI-Meeting-Bots** in Besprechungen ohne Zustimmung aller Teilnehmenden.
- Keine Umgehung von Sperren oder Sicherheitsmaßnahmen.

## 6. Pflichten bei der Nutzung

- **Ergebnisse prüfen:** Fakten, Zahlen, Quellen, rechtliche Aussagen und Code vor Verwendung kontrollieren.
- **KI-generierter Code** durchläuft dieselben Reviews und Tests wie selbst geschriebener Code; vorgeschlagene Pakete/Bibliotheken vor der Installation auf Existenz und Vertrauenswürdigkeit prüfen.
- **Kennzeichnen:** KI-erzeugte oder -manipulierte Bilder, Audio- und Videoinhalte, die wir veröffentlichen, als solche kennzeichnen (AI Act Art. 50). Kunden-Chatbots als KI erkennbar machen.
- **Urheberrecht und Vertraulichkeitsvereinbarungen** beachten – auch für Inhalte, die wir in die KI hochladen.
- **Ungewöhnliches Verhalten melden:** Wenn ein KI-Assistent unerwartete Aktionen ausführt, merkwürdige Anweisungen ausgibt oder auf Daten zugreift, die nicht passen → sofort melden ([Playbook C](C-playbook-angriff-auf-ki-systeme.md)).

## 7. KI-Agenten und Assistenten mit Handlungsrechten

Für KI, die nicht nur antwortet, sondern **handelt** (Mails versenden, Dateien ändern, Systeme bedienen), gelten zusätzlich die Sicherheitsregeln der Strategie (HF5):
minimale Rechte, menschliche Freigabe für Aktionen mit Außenwirkung, kein „gefährliches Dreieck“, Protokollierung, Kill-Switch. Jeder solche Agent wird im KI-Inventar erfasst und benötigt eine dokumentierte Freigabe.

## 8. Schulung (KI-Kompetenz)

Alle, die KI-Werkzeuge nutzen, absolvieren die Schulung zur KI-Kompetenz (AI Act Art. 4, [Anhang M](M-schulungsmodul-ki-kompetenz.md)) vor der ersten Nutzung und danach jährlich. Die Teilnahme wird dokumentiert.

## 9. Vorfälle melden

Wurden versehentlich Daten in ein nicht freigegebenes Werkzeug eingegeben? **Sofort melden** an [ANPASSEN]. Schnelles Melden ermöglicht Schadensbegrenzung (z. B. Passwortänderung, Löschantrag) und wird nicht sanktioniert.

## 10. Verstöße

Vorsätzliche oder grob fahrlässige Verstöße können arbeitsrechtliche Konsequenzen haben. Unser Ziel ist jedoch, sichere Nutzung zu ermöglichen – Verbesserungsvorschläge zur Richtlinie sind ausdrücklich willkommen.

---

**Kenntnisnahme**

Ich habe die KI-Nutzungsrichtlinie gelesen und verstanden.

Name: ______________________ Datum: ____________ Unterschrift: ______________________
