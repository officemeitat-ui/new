const HEX = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_BRAND_COLOR = "#2454d6";

export type Brand = { productName: string; primaryColor: string };

export function safeColor(
  value: string | null | undefined,
  fallback = DEFAULT_BRAND_COLOR,
): string {
  return value && HEX.test(value) ? value : fallback;
}

/** Platform defaults from the environment. Partners and tenants override them (M1). */
export function getBrand(): Brand {
  return {
    productName: process.env.BRAND_PRODUCT_NAME?.trim() || "ME-IT Nexus",
    primaryColor: safeColor(process.env.BRAND_PRIMARY_COLOR),
  };
}
