/**
 * The code only knows model tiers. Which model serves a tier is data (per partner/tenant),
 * so a new model generation is a configuration change, not a deployment (ADR 0006).
 */
export const MODEL_TIERS = ["smart", "balanced", "fast"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  smart: "claude-opus-5-5",
  balanced: "claude-sonnet-5-5",
  fast: "claude-haiku-5-5",
};

export function resolveModel(
  tier: ModelTier,
  overrides: Partial<Record<ModelTier, string>> = {},
): string {
  return overrides[tier] ?? DEFAULT_TIER_MODELS[tier];
}

export function isModelTier(value: string): value is ModelTier {
  return (MODEL_TIERS as readonly string[]).includes(value);
}

export function isEffort(value: string): value is Effort {
  return (EFFORTS as readonly string[]).includes(value);
}
