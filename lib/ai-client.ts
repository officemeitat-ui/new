import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import AnthropicFoundry from "@anthropic-ai/foundry-sdk";

// Ein Claude-Zugang für die ganze App – direkt bei Anthropic oder über Microsoft Azure (Microsoft Foundry).
//   Anthropic: ANTHROPIC_API_KEY
//   Azure:     AI_PROVIDER=azure, ANTHROPIC_FOUNDRY_RESOURCE (Name der Foundry-Ressource), ANTHROPIC_FOUNDRY_API_KEY
// Auf Azure heißen die Modelle wie die Bereitstellung in Foundry (Standard: wie das Modell).

export type AiProvider = "anthropic" | "azure";

export function aiProvider(): AiProvider {
  return process.env.AI_PROVIDER === "azure" ? "azure" : "anthropic";
}

/** Was die App von Claude nutzt – beide Anbieter liefern dieselbe Schnittstelle. */
export type ClaudeClient = { beta: { messages: Pick<Anthropic["beta"]["messages"], "parse" | "toolRunner"> } };

let cached: { provider: AiProvider; client: ClaudeClient } | undefined;

export function claudeClient(): ClaudeClient {
  const provider = aiProvider();
  if (!cached || cached.provider !== provider) {
    cached = { provider, client: provider === "azure" ? new AnthropicFoundry() : new Anthropic() };
  }
  return cached.client;
}

const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

/**
 * Serverseitige Ersatzmodelle bei Ablehnungen durch Sicherheitsfilter – nur direkt bei Anthropic verfügbar.
 * Auf Azure wird die Anfrage ohne diesen Parameter gestellt (eine Ablehnung landet dann in der normalen Fehlerbehandlung).
 */
export function fallbackOptions(model: string): { betas: string[]; fallbacks: "default" } | Record<string, never> {
  return aiProvider() === "anthropic" && FALLBACK_MODELS.has(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
}
