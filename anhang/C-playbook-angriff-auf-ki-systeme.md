# Anhang C – Playbook: Angriff auf eigene KI-Systeme

> Zurück zur [Strategie](../KI-Cybersicherheitsstrategie.md) · Verknüpft mit [HF5 – Sichere Nutzung eigener KI](../KI-Cybersicherheitsstrategie.md#hf5--sichere-nutzung-eigener-ki-systeme-und-ki-agenten)

**Gilt für:** Vorfälle mit KI-Assistenten, KI-Agenten, Chatbots, Wissensdatenbanken (RAG), KI-Plugins/MCP-Servern sowie Datenabfluss über KI-Dienste.

**Ziel:** Missbrauchten KI-Zugriff sofort stoppen, Datenabfluss begrenzen, Ursache (z. B. eingeschleuste Anweisung) finden und beseitigen.

---

## 1. Szenarien und Anzeichen

| Szenario | Anzeichen |
|---|---|
| **Indirekte Prompt Injection** | KI-Assistent oder Agent führt Aktionen aus, die niemand angefordert hat (Mails versenden, Dateien teilen, Links aufrufen) – oft nach Verarbeitung einer externen Mail, Webseite oder eines Dokuments |
| **Missbrauch eines Agenten** | Ungewöhnliche Werkzeugaufrufe, API-Nutzung außerhalb der Geschäftszeiten, Zugriffe auf ungewöhnliche Datenbereiche, sprunghaft steigende Kosten |
| **Datenabfluss über Schatten-KI** | Vertrauliche Daten wurden in einen nicht freigegebenen KI-Dienst eingegeben (Meldung, DLP-Alarm, Web-Filter) |
| **Offenlegung über KI-Suche** | Nutzende erhalten über den KI-Assistenten Inhalte, für die sie nicht berechtigt sein sollten |
| **Vergiftete Wissensdatenbank** | KI liefert falsche, manipulierte Informationen (z. B. geänderte Bankdaten, falsche Anweisungen) |
| **Kompromittierte Erweiterung / MCP-Server / Paket** | Sicherheitswarnung des Herstellers, unerwartete Netzwerkverbindungen, neue Version mit verändertem Verhalten |
| **Manipulierter Kunden-Chatbot** | Chatbot gibt vertrauliche, falsche oder rufschädigende Antworten; Missbrauch für Kosten- oder Ressourcenangriffe |

## 2. Sofortmaßnahmen (Ziel: ≤ 1 Stunde)

| # | Maßnahme |
|---|---|
| 1 | **Kill-Switch:** Agent, Integration oder Plugin deaktivieren; bei Kunden-Chatbot Wartungshinweis oder Fallback auf Menschen |
| 2 | **Zugangsdaten des Agenten widerrufen und erneuern** (API-Schlüssel, Tokens, Dienstkonto-Passwörter, Verbindungen zu Postfach/Dateien) |
| 3 | **Protokolle sichern:** Eingaben (Prompts), verarbeitete Inhalte, Werkzeugaufrufe, Ausgaben, Zeitstempel, beteiligte Konten |
| 4 | **Quelle der Manipulation identifizieren** (z. B. bestimmte Mail, Datei, Webseite, Dokument im Wissensspeicher) und isolieren bzw. in Quarantäne verschieben |
| 5 | **Ausgeführte Aktionen ermitteln und rückgängig machen:** versendete Mails, geteilte Dateien, geänderte Daten, angelegte Regeln oder Konten |

## 3. Besonderheiten je Szenario

**Datenabfluss über Schatten-KI**

1. Art und Umfang der eingegebenen Daten feststellen (personenbezogen? Geschäftsgeheimnis? Zugangsdaten?).
2. Eingegebene **Zugangsdaten oder Schlüssel sofort ändern**.
3. Verlauf im betreffenden Konto löschen und beim Anbieter Löschung beantragen; Nutzungsbedingungen zur Datenverwendung (Training) prüfen.
4. Datenschutz einbinden: Liegt eine meldepflichtige Datenschutzverletzung vor (≤ 72 h)?
5. Ursache klären: Fehlte ein freigegebenes Werkzeug? War die Richtlinie unbekannt? → Angebot und Schulung verbessern, nicht nur sanktionieren.

**Offenlegung über KI-Suche**

1. Betroffene Datenbestände identifizieren, Berechtigungen korrigieren (Freigaben „für alle“, verwaiste Gruppen, falsche Vererbung).
2. Prüfen, wer welche Inhalte über die KI abgefragt hat (Audit-Protokolle).
3. Bis zur Bereinigung KI-Zugriff auf die betroffenen Bereiche sperren.

**Vergiftete Wissensdatenbank**

1. Manipulierte Dokumente identifizieren (Änderungsprotokoll: wer, wann, was).
2. Aus Sicherung wiederherstellen, Index neu aufbauen.
3. Prüfen, welche Entscheidungen oder Auskünfte auf Basis falscher Inhalte getroffen wurden.
4. Schreibrechte auf die Quellen einschränken.

**Kompromittierte Erweiterung, MCP-Server oder Paket**

1. Auf allen Systemen entfernen bzw. auf geprüfte Version zurücksetzen.
2. Alle Zugangsdaten rotieren, auf die die Komponente Zugriff hatte.
3. Systeme mit der Komponente auf weitere Kompromittierung prüfen (EDR).
4. Allowlist aktualisieren.

## 4. Wiederinbetriebnahme – nur wenn alle Punkte erfüllt sind

- [ ] Ursache verstanden und beseitigt
- [ ] Berechtigungen des Agenten auf das Minimum reduziert
- [ ] Menschliche Freigabe für Aktionen mit Außenwirkung eingebaut
- [ ] Das „gefährliche Dreieck“ (vertrauliche Daten + nicht vertrauenswürdige Inhalte + Ausleitungsweg) aufgelöst
- [ ] Protokollierung und Alarmierung für das beobachtete Muster eingerichtet
- [ ] Test mit dem konkreten Angriffsmuster (und Varianten) erfolgreich
- [ ] Freigabe durch KI-Verantwortliche/n dokumentiert

## 5. Melden

Wie in [Playbook B, Abschnitt 5](B-playbook-ki-phishing-kontouebernahme.md#5-melden) (NISG 2026, DSGVO, Versicherung). Zusätzlich: **Anbieter des KI-Systems** informieren, wenn eine Schwachstelle im Produkt vorliegt.

## 6. Unterscheidung: Angriff oder Fehlverhalten?

Nicht jedes falsche Verhalten einer KI ist ein Angriff – Halluzinationen und Fehlinterpretationen kommen regelmäßig vor. Ein Angriff ist wahrscheinlich, wenn

- das Verhalten durch **externe Inhalte** ausgelöst wurde und **gezielt** wirkt (z. B. Daten an eine bestimmte externe Adresse),
- **versteckte Anweisungen** in verarbeiteten Inhalten zu finden sind (weißer Text, Kommentare, Metadaten, unsichtbare Zeichen),
- das Verhalten **reproduzierbar** mit demselben Inhalt auftritt.

Beide Fälle werden dokumentiert; auch Fehlverhalten ohne Angriff kann eine Anpassung der Rechte oder Freigabeschritte erfordern.
