/** Prices in US dollars per million tokens. */
export type ModelPrice = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  /** 5-minute cache writes. */
  cacheWritePerMTok: number;
};

/**
 * Defaults used to seed `price_tables` and as a fallback in tests. Source: Anthropic price
 * list as of October 2026 (cache writes at 1.25× input). Production costs come from the
 * database table, which has validity dates – update it when prices change.
 */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": {
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 5,
  },
  "claude-sonnet-5-5": {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 2.5,
  },
  "claude-haiku-5-5": {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    cacheWritePerMTok: 0.125,
  },
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Maps the `usage` object of an API response. Cache fields may be null. */
export function usageFromApi(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Cost in micro-dollars (1 USD = 1,000,000). Convenient identity: a price of $X per million
 * tokens is exactly X micro-dollars per token.
 */
export function costUsdMicros(usage: TokenUsage, price: ModelPrice): number {
  return Math.round(
    usage.inputTokens * price.inputPerMTok +
      usage.outputTokens * price.outputPerMTok +
      usage.cacheReadTokens * price.cacheReadPerMTok +
      usage.cacheWriteTokens * price.cacheWritePerMTok,
  );
}

/** Bedrock model IDs carry an "anthropic." prefix; prices are keyed by the plain model ID. */
export function priceFor(
  model: string,
  prices: Record<string, ModelPrice>,
): ModelPrice | undefined {
  return prices[model] ?? prices[model.replace(/^anthropic\./, "")];
}
