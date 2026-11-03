import "server-only";
import { getBrand, safeColor, type Brand } from "./brand";
import { resolveAppContext } from "./session";

/**
 * The brand to render: the active tenant's (its own colour or its partner's), otherwise the
 * partner's for partner staff, otherwise the platform default (login pages).
 */
export async function resolveBranding(): Promise<Brand> {
  const fallback = getBrand();
  const ctx = await resolveAppContext();
  const source = ctx?.tenant?.branding ?? ctx?.partner?.branding;
  if (!source) return fallback;
  return {
    productName: source.productName || fallback.productName,
    primaryColor: safeColor(source.primaryColor, fallback.primaryColor),
  };
}
