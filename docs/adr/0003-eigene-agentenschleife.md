# ADR 0003 – Eigene Agentenschleife statt Tool Runner oder Managed Agents

**Status:** angenommen · **Datum:** 2026-11-03

## Kontext

Agenten müssen mitten im Lauf pausieren können, bis ein Mensch eine Aktion freigibt, und danach (auch nach einem Neustart des Workers) fortsetzen. Jeder Schritt muss gespeichert, abgerechnet und live an die UI gestreamt werden. Die Plattform soll mit der Claude API, mit Amazon Bedrock und mit Google Vertex AI laufen (EU-Datenverarbeitung).

## Optionen

1. **Tool Runner des SDK** (`client.beta.messages.toolRunner`): wenig Code, Hooks pro Runde. Beta-Status, und das dauerhafte Pausieren über Prozessgrenzen hinweg müsste man trotzdem selbst bauen.
2. **Managed Agents:** Anthropic betreibt Schleife und Sandbox. Nicht auf Bedrock und Vertex verfügbar, und die Daten der Läufe lägen nicht in unserer Datenbank.
3. **Eigene Schleife** über `messages.stream()`: volle Kontrolle über Pausieren, Persistenz, Budgets und Provider.

## Entscheidung

Option 3. Die Schleife in `packages/agents` ist klein und vollständig getestet:

- Streaming über das offizielle SDK, Endergebnis über `finalMessage()`.
- Alle `stop_reason`-Werte werden behandelt (`end_turn`, `tool_use`, `max_tokens`, `pause_turn`, `refusal`).
- Parallele Werkzeugaufrufe werden gemeinsam ausgeführt; alle Ergebnisse gehen in **einer** Nachricht zurück, Fehler als `is_error`.
- Vor jeder Ausführung prüft eine Policy-Funktion (`automatisch`, `Freigabe`, `verboten`). Bei „Freigabe“ endet der Lauf mit Status `awaiting_approval` und dem vollständigen Verlauf; er wird mit dem Verlauf und der Entscheidung fortgesetzt.
- Der Verlauf wird nur angehängt, nie nachträglich bearbeitet.
- Persistenz und Streaming werden über Hooks injiziert (`onEvent`). Die Runtime selbst kennt weder Datenbank noch Queue.

## Konsequenzen

- Etwas mehr eigener Code, dafür keine Abhängigkeit von Beta-Helfern im Kern.
- Läuft gleich auf allen drei Providern.
