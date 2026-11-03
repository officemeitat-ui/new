import type { Env } from "@nexus/core/env";
import { createProvider, type LlmProvider, type ProviderConfig } from "./provider";

export function providerConfigFromEnv(env: Env): ProviderConfig {
  switch (env.LLM_PROVIDER) {
    case "bedrock":
      return { name: "bedrock", region: env.AWS_REGION };
    case "vertex":
      return {
        name: "vertex",
        projectId: env.GOOGLE_VERTEX_PROJECT_ID ?? "",
        region: env.GOOGLE_VERTEX_REGION,
      };
    default:
      // The SDK also honours ANTHROPIC_BASE_URL (used by the E2E mock server).
      return {
        name: "anthropic",
        ...(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}),
      };
  }
}

/** Bedrock and Vertex use the cloud's own credentials; the Claude API needs a key. */
export function isLlmConfigured(env: Env): boolean {
  return env.LLM_PROVIDER !== "anthropic" || Boolean(env.ANTHROPIC_API_KEY);
}

export function providerFromEnv(env: Env): () => Promise<LlmProvider> {
  let cached: Promise<LlmProvider> | undefined;
  return () => (cached ??= createProvider(providerConfigFromEnv(env)));
}
