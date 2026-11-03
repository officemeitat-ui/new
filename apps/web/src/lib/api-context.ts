import "server-only";
import type { TenantAccess } from "@nexus/domain";
import { resolveAppContext, type SessionUser } from "./session";

/** Like requireTenant(), but returns null instead of redirecting – for route handlers. */
export async function getApiTenantContext(): Promise<{
  user: SessionUser;
  tenant: TenantAccess;
} | null> {
  const ctx = await resolveAppContext();
  return ctx?.tenant ? { user: ctx.user, tenant: ctx.tenant } : null;
}
