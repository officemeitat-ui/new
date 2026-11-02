# ME-IT Nexus – Prompt-Paket für die KI-Agenten-Plattform

Mit diesem Paket lässt ME-IT von **Claude Code** eine verkaufsfertige SaaS-Plattform bauen: **KI-Agenten, Integrationen, Workflows, Freigaben, ROI-Reports, Abrechnung und Partner-Konsole**. Mandantenfähig, White-Label-fähig und DSGVO-konform in der EU betrieben.

## Inhalt

| Datei | Wofür |
|---|---|
| [`prompts/00_MASTER_PROMPT.md`](prompts/00_MASTER_PROMPT.md) | **Der Haupt-Prompt.** Vollständige Produkt- und Technikspezifikation; damit startet der Bau |
| [`prompts/01_BUILD_PHASEN.md`](prompts/01_BUILD_PHASEN.md) | Elf Phasen-Prompts (0–10) zum Kopieren, plus Prompts für den Alltag (Review, Bugfix, neuer Konnektor …) |
| [`prompts/02_AGENTEN_BIBLIOTHEK.md`](prompts/02_AGENTEN_BIBLIOTHEK.md) | Basis-Systemprompt, zwei Meta-Agenten und 12 fertige Agenten-Vorlagen mit Systemprompts und Testfällen, dazu Branchenpakete |
| [`sales/VERKAUFSSKRIPT.md`](sales/VERKAUFSSKRIPT.md) | Positionierung, Pakete und Preise, Gesprächsleitfaden, Demo mit drei Wow-Momenten, ROI-Rechnung, Einwandbehandlung |

## In drei Schritten loslegen

1. **Anpassen:** Tragen Sie in `prompts/00_MASTER_PROMPT.md` unter *Abschnitt 0* Produktname, Markenfarbe und Domain ein.
2. **Starten:** Öffnen Sie dieses Repository in Claude Code und senden Sie den Master-Prompt (alles zwischen `PROMPT START` und `PROMPT ENDE`). Claude liefert zuerst Architektur, Roadmap und Rückfragen und wartet auf Ihr OK.
3. **Bauen:** Arbeiten Sie die Phasen aus `prompts/01_BUILD_PHASEN.md` der Reihe nach ab. Ab **Phase 6** ist die Plattform demo-fähig.

## Was Sie vor dem Start brauchen

- **Claude API-Key** (Anthropic Console). Optional, für reine EU-Verarbeitung: ein Zugang zu Amazon Bedrock oder Google Vertex AI in einer EU-Region
- **EU-Hosting**, z. B. ein Server bei Hetzner oder AWS in Frankfurt (für den Start reicht ein Server mit Docker)
- **Microsoft Entra ID App-Registrierung** (für Microsoft 365 und SSO) und **Google OAuth-Client** (für Google Workspace)
- Eine **Domain** für die App und eine Absenderadresse für E-Mails
- Für den Demo-Mandanten: Beispiel-Preisliste, FAQ und AGB (Claude erzeugt realistische Platzhalter, wenn nichts vorliegt)

## Highlights der Plattform

- 🧠 **„Agent aus Beschreibung“:** Ein Satz genügt, und ein vollständiger Agent mit Werkzeugen, Freigaberegeln und Testfällen entsteht
- 🔌 **Integrationen:** Microsoft 365, Google Workspace, E-Mail, CRM, OpenAPI-Import, MCP (als Client und als Server)
- ✅ **Freigabe-Inbox:** Nichts geht ohne OK nach außen, Freigabe mobil mit einem Tipp
- 📈 **ROI-Dashboard und Monatsreport als PDF:** gesparte Stunden und Euro, schwarz auf weiß
- 🏢 **Partner-Konsole für ME-IT:** alle Kunden, Nutzung, Kosten, Marge und Health-Score auf einen Blick
- 🇪🇺 **DSGVO und EU AI Act:** EU-Hosting, Audit-Log, KI-Kennzeichnung, Agenten-Steckbriefe

## Hinweise

- Preise im Verkaufsskript sind **Vorschläge** und müssen mit den echten KI-Kosten kalkuliert werden.
- Rechtliche Inhalte (DSGVO, AI Act, Rechnungsmerkmale, AVV) sind **Orientierung, keine Rechtsberatung**. Lassen Sie sie vor dem Einsatz prüfen.
- Die technischen Vorgaben zur Claude API entsprechen dem Stand von **November 2026**. Der Master-Prompt weist Claude an, vor der Implementierung die aktuelle Dokumentation zu prüfen.
