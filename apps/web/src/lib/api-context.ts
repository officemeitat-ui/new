import "server-only";
import { needsTwoFactorSetup, type TenantAccess } from "@nexus/domain";
import { resolveAppContext, type SessionUser } from "./session";

/** Like requireTenant(), but returns null instead of redirecting – for route handlers. */
export async function getApiTenantContext(): Promise<{
  user: SessionUser;
  tenant: TenantAccess;
} | null> {
  const ctx = await resolveAppContext();
  if (!ctx?.tenant) return null;
  // Same tenant policy as pages: owners/admins without required 2FA get nothing (finding 8).
  if (needsTwoFactorSetup(ctx.tenant, ctx.user.twoFactorEnabled)) return null;
  return { user: ctx.user, tenant: ctx.tenant };
}
