import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages";

export type ProviderName = "anthropic" | "bedrock" | "vertex";

/**
 * Not every feature exists on every platform (see docs/adr/0006). The runtime only uses an
 * optional feature where the provider supports it, so every agent runs on every provider.
 */
export type ProviderCapabilities = {
  serverSideFallbacks: boolean;
  batches: boolean;
  mcpConnector: boolean;
  filesApi: boolean;
};

export const CAPABILITIES: Record<ProviderName, ProviderCapabilities> = {
  anthropic: { serverSideFallbacks: true, batches: true, mcpConnector: true, filesApi: true },
  bedrock: { serverSideFallbacks: false, batches: false, mcpConnector: false, filesApi: false },
  vertex: { serverSideFallbacks: false, batches: false, mcpConnector: false, filesApi: false },
};

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/** The part of a message stream the runtime uses. The SDK's BetaMessageStream satisfies it. */
export interface MessageStreamLike {
  on(event: "text", listener: (delta: string, snapshot: string) => void): unknown;
  finalMessage(): Promise<BetaMessage>;
}

/** The part of the SDK client the runtime uses. Lets tests inject a scripted client. */
export interface LlmClient {
  beta: {
    messages: {
      stream(
        params: BetaMessageStreamParams,
        options?: { signal?: AbortSignal },
      ): MessageStreamLike;
    };
  };
}

export type ProviderConfig =
  | { name: "anthropic"; apiKey?: string; baseURL?: string }
  | { name: "bedrock"; region: string }
  | { name: "vertex"; projectId: string; region: string };

export type LlmProvider = {
  name: ProviderName;
  client: LlmClient;
  capabilities: ProviderCapabilities;
  /** Platform-specific model ID, e.g. "anthropic.claude-opus-5-5" on Bedrock. */
  modelId(model: string): string;
};

export async function createProvider(config: ProviderConfig): Promise<LlmProvider> {
  switch (config.name) {
    case "anthropic": {
      // Without an explicit key the SDK resolves ANTHROPIC_API_KEY and other standard sources.
      const client = new Anthropic({
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      });
      return {
        name: "anthropic",
        client,
        capabilities: CAPABILITIES.anthropic,
        modelId: (model) => model,
      };
    }
    case "bedrock": {
      const { AnthropicBedrockMantle } = await import("@anthropic-ai/bedrock-sdk");
      const client = new AnthropicBedrockMantle({ awsRegion: config.region });
      return {
        name: "bedrock",
        client: client as unknown as LlmClient,
        capabilities: CAPABILITIES.bedrock,
        modelId: (model) => (model.startsWith("anthropic.") ? model : `anthropic.${model}`),
      };
    }
    case "vertex": {
      const { AnthropicVertex } = await import("@anthropic-ai/vertex-sdk");
      const client = new AnthropicVertex({ projectId: config.projectId, region: config.region });
      return {
        name: "vertex",
        client: client as unknown as LlmClient,
        capabilities: CAPABILITIES.vertex,
        modelId: (model) => model,
      };
    }
  }
}
