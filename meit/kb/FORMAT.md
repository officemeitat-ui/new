# Hilfe-Bibliothek – Format der Artikel

Jede Datei in diesem Ordner (`NN-bereich.md`) enthält viele Artikel. Das Cockpit liest sie ein und zeigt sie
unter **Wissen**. Eigene Artikel lassen sich im selben Format ergänzen.

## Aufbau eines Artikels

```
=== ARTIKEL
titel: Outlook startet nicht oder bleibt bei „Profil wird geladen“ hängen
bereich: Outlook & E-Mail
tags: outlook, start, profil, hängt, abgesicherter modus
zielgruppe: kunde
---
**Symptom:** Outlook öffnet sich nicht oder bleibt beim Startbild stehen.

**Häufige Ursachen:** ein beschädigtes Profil, ein fehlerhaftes Add-In oder eine zu große Datendatei.

## Lösung
1. Outlook ganz schließen (im Task-Manager prüfen, ob `OUTLOOK.EXE` noch läuft).
2. **Windows-Taste + R**, `outlook.exe /safe` eingeben, Enter. Startet Outlook so, liegt es an einem Add-In.
3. …

## Wenn das nicht hilft
- Ticket anlegen und dazuschreiben: genaue Fehlermeldung, seit wann, was sich davor geändert hat.
```

Regeln für die Kopfzeilen:

| Zeile | Inhalt |
| --- | --- |
| `=== ARTIKEL` | beginnt jeden Artikel, allein in der Zeile |
| `titel:` | so, wie jemand das Problem beschreiben würde; eindeutig; 30–90 Zeichen |
| `bereich:` | der Bereich der Datei, in jeder Datei gleich geschrieben |
| `tags:` | 4–8 Suchwörter, klein, mit Komma getrennt – auch umgangssprachliche („geht nicht“, „langsam“) |
| `zielgruppe:` | `kunde` = Anleitung für Anwender ohne Admin-Rechte, darf im Kundenportal erscheinen · `technik` = interne Anleitung für Techniker |
| `---` | trennt Kopf und Inhalt |

## Inhalt

- **Deutsch**, klare kurze Sätze, Du-Form vermeiden: neutral formulieren („Outlook schließen“, „Im Menü … wählen“).
- **120 bis 260 Wörter** je Artikel. Lieber ein Problem gründlich als fünf angerissen.
- Immer in dieser Reihenfolge: `**Symptom:**` → `**Häufige Ursachen:**` → `## Lösung` (nummerierte Schritte) → `## Wenn das nicht hilft`.
  Technik-Artikel dürfen zusätzlich `## Hintergrund` oder `## Für das Ticket notieren` haben.
- **Schritte müssen stimmen.** Nur Menüpfade, Tastenkürzel und Befehle verwenden, die sicher bekannt sind
  (Windows 10/11 und Microsoft 365 in deutscher Sprache). Ist eine Bezeichnung je nach Version verschieden,
  das dazusagen („je nach Version …“) statt zu raten. Keine erfundenen Fehlercodes, KB-Nummern oder Links.
- Menüpfade mit Pfeil: **Einstellungen → System → Info**. Befehle in Backticks oder als Codeblock.
- Erlaubtes Markdown: `##`-Überschriften, nummerierte und einfache Listen, `**fett**`, Backticks, Codeblöcke
  mit drei Backticks, einfache Tabellen. Kein HTML, keine Bilder, keine Links.
- **Zielgruppe `kunde`:** nichts, was Admin-Rechte braucht, nichts Riskantes (keine Registry, kein Formatieren,
  keine Befehle mit Löschwirkung). Am Ende sagen, welche Angaben ins Ticket gehören.
- **Zielgruppe `technik`:** darf Admin-Schritte, PowerShell und Eingabeaufforderung enthalten. Riskante Schritte
  mit **Achtung:** kennzeichnen (Datenverlust, Neustart, Unterbrechung) und sagen, was vorher zu sichern ist.
- Keine Passwörter, keine Kundennamen, keine Produktwerbung. Herstellernamen nur, wo sie zur Sache gehören.
- Keine Zeile darf mit `=== ARTIKEL` beginnen, außer am Anfang eines Artikels.
