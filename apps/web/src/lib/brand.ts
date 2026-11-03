const HEX = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_BRAND_COLOR = "#2454d6";

/** Platform-wide brand settings. Per-tenant branding (M1) overrides these in Phase 1+. */
export function getBrand(): { productName: string; primaryColor: string } {
  const color = process.env.BRAND_PRIMARY_COLOR;
  return {
    productName: process.env.BRAND_PRODUCT_NAME?.trim() || "ME-IT Nexus",
    primaryColor: color && HEX.test(color) ? color : DEFAULT_BRAND_COLOR,
  };
}
