import "server-only";
import { isLlmConfigured } from "@nexus/agents";
import { getEnv } from "@nexus/core/env";

export function llmConfigured(): boolean {
  return isLlmConfigured(getEnv());
}
