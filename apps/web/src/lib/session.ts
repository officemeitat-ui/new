import "server-only";
import { getDatabase } from "@nexus/db";
import {
  getPartnerAccess,
  getSupportAccess,
  getTenantAccess,
  getUserOverview,
  needsTwoFactorSetup,
  type PartnerAccess,
  type TenantAccess,
  type UserOverview,
  verifySupportCookie,
} from "@nexus/domain";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";

export const ACTIVE_TENANT_COOKIE = "nexus_tenant";
/** Tenant ID of a support session started from the partner console (M12). */
export const SUPPORT_COOKIE = "nexus_support";

export type SessionUser = { id: string; name: string; email: string; twoFactorEnabled: boolean };

/** Data access layer: every page and server action verifies the session here (not in proxy.ts). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    twoFactorEnabled: Boolean(session.user.twoFactorEnabled),
  };
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
 * never trusted on its own) and partner access. Returns null without a session.
 */
export const resolveAppContext = cache(async (): Promise<AppContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const db = getDatabase().db;
  const overview = await getUserOverview(db, user.id);

  const wanted = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  const active = overview.tenants.filter((t) => t.status === "active");
  const tenantId =
    active.find((t) => t.tenantId === wanted)?.tenantId ??
    (active.length === 1 ? active[0]!.tenantId : undefined);

  const firstPartner = overview.partners[0];
  const partner = firstPartner ? await getPartnerAccess(db, user.id, firstPartner.partnerId) : null;

  // A support session (granted by the tenant, still valid) takes precedence.
  const supportTenantId = verifySupportCookie(
    (await cookies()).get(SUPPORT_COOKIE)?.value,
    user.id,
  );
  const support =
    partner && supportTenantId
      ? await getSupportAccess(db, {
          userId: user.id,
          partnerId: partner.partnerId,
          tenantId: supportTenantId,
        })
      : null;

  const tenant = support ?? (tenantId ? await getTenantAccess(db, user.id, tenantId) : null);
  return { user, overview, tenant, partner };
});

export async function getAppContext(): Promise<AppContext> {
  const ctx = await resolveAppContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** For pages that work inside a tenant. Sends users without an active tenant to the picker. */
export async function requireTenant(): Promise<AppContext & { tenant: TenantAccess }> {
  const ctx = await getAppContext();
  if (!ctx.tenant)
    redirect(
      ctx.overview.tenants.length > 0 ? "/select-tenant" : ctx.partner ? "/partner" : "/no-access",
    );
  // Tenant policy: owners and admins must set up 2FA before they can work (M2).
  if (needsTwoFactorSetup(ctx.tenant, ctx.user.twoFactorEnabled)) redirect("/account?2fa=required");
  return ctx as AppContext & { tenant: TenantAccess };
}

export async function requirePartner(): Promise<AppContext & { partner: PartnerAccess }> {
  const ctx = await getAppContext();
  if (!ctx.partner) redirect("/");
  return ctx as AppContext & { partner: PartnerAccess };
}
