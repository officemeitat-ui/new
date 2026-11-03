# ADR 0006 – LLM-Provider-Abstraktion und Modellstufen

**Status:** angenommen · **Datum:** 2026-11-03

## Kontext

Kunden wählen zwischen Qualität und Kosten; Enterprise-Kunden verlangen Datenverarbeitung ausschließlich in der EU. Modelle werden regelmäßig erneuert.

## Entscheidung

- Interface `LlmProvider` mit den Implementierungen `anthropic` (Claude API, Standard), `bedrock` (EU-Region, Client `AnthropicBedrockMantle`, Modell-IDs mit Präfix `anthropic.`) und `vertex` (Region `eu`, Client `AnthropicVertex`). Alle drei liefern dieselbe `messages.stream`-Oberfläche des SDK.
- Eine **Capability-Matrix** pro Provider (z. B. serverseitige Fallbacks, Batches, MCP-Connector). Die Runtime nutzt optionale Funktionen nur, wo sie verfügbar sind.
- Der Code kennt nur **Modellstufen**:

| Stufe      | Standardmodell      |
| ---------- | ------------------- |
| `smart`    | `claude-opus-5-5`   |
| `balanced` | `claude-sonnet-5-5` |
| `fast`     | `claude-haiku-5-5`  |

Die Zuordnung liegt pro Partner/Mandant in der Datenbank; der Code enthält nur die Standardwerte.

- Modellpreise liegen in der Tabelle `price_tables` mit Gültigkeitsdatum. Kosten werden aus `usage` der API-Antwort berechnet, inklusive Cache-Lese- und Cache-Schreib-Tokens.
- Thinking ist adaptiv; Effort wird immer explizit gesetzt. Keine Sampling-Parameter, kein Prefill, `tool_choice` nur `auto`.

## Konsequenzen

- Ein Modellwechsel ist eine Datenänderung, kein Deployment.
- Neue Provider-Features werden über die Capability-Matrix eingeführt.
