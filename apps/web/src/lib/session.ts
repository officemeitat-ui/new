import "server-only";
import { getDatabase } from "@nexus/db";
import {
  getPartnerAccess,
  getTenantAccess,
  getUserOverview,
  type PartnerAccess,
  type TenantAccess,
  type UserOverview,
} from "@nexus/domain";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";

export const ACTIVE_TENANT_COOKIE = "nexus_tenant";

export type SessionUser = { id: string; name: string; email: string };

/** Data access layer: every page and server action verifies the session here (not in proxy.ts). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return { id: session.user.id, name: session.user.name, email: session.user.email };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export type AppContext = {
  user: SessionUser;
  overview: UserOverview;
  tenant: TenantAccess | null;
  partner: PartnerAccess | null;
};

/**
 * Resolves the signed-in user, the active tenant (cookie, verified against the memberships –
 * never trusted on its own) and partner access.
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const user = await requireUser();
  const db = getDatabase().db;
  const overview = await getUserOverview(db, user.id);

  const wanted = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  const active = overview.tenants.filter((t) => t.status === "active");
  const tenantId =
    active.find((t) => t.tenantId === wanted)?.tenantId ??
    (active.length === 1 ? active[0]!.tenantId : undefined);

  const tenant = tenantId ? await getTenantAccess(db, user.id, tenantId) : null;
  const firstPartner = overview.partners[0];
  const partner = firstPartner ? await getPartnerAccess(db, user.id, firstPartner.partnerId) : null;
  return { user, overview, tenant, partner };
});

/** For pages that work inside a tenant. Sends users without an active tenant to the picker. */
export async function requireTenant(): Promise<AppContext & { tenant: TenantAccess }> {
  const ctx = await getAppContext();
  if (!ctx.tenant)
    redirect(
      ctx.overview.tenants.length > 0 ? "/select-tenant" : ctx.partner ? "/partner" : "/no-access",
    );
  return ctx as AppContext & { tenant: TenantAccess };
}

export async function requirePartner(): Promise<AppContext & { partner: PartnerAccess }> {
  const ctx = await getAppContext();
  if (!ctx.partner) redirect("/");
  return ctx as AppContext & { partner: PartnerAccess };
}
