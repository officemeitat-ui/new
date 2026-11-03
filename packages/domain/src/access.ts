import {
  forbidden,
  hasPermission,
  PARTNER_ROLE_PERMISSIONS,
  SYSTEM_TENANT_ROLE_PERMISSIONS,
  type PartnerPermission,
  type PartnerRole,
  type SystemTenantRole,
  type TenantPermission,
} from "@nexus/core";
import { and, eq, withPartner, withTenant, withUser, type Database } from "@nexus/db";
import { memberships, partnerMemberships, partners, roles, tenants } from "@nexus/db/schema";

export type Branding = {
  productName: string;
  /** Effective brand colour: the tenant's own, otherwise the partner's. */
  primaryColor: string;
};

export type TenantAccess = {
  userId: string;
  tenantId: string;
  tenantName: string;
  role: SystemTenantRole;
  customRoleName: string | null;
  permissions: readonly TenantPermission[];
  branding: Branding & { tenantColor: string | null; partnerColor: string };
  /** Owners and admins of this tenant must have two-factor authentication enabled. */
  requireAdminTwoFactor: boolean;
  /** EUR per USD set by the partner; null = show costs in US dollars. */
  usdEurRate: number | null;
};

export type PartnerAccess = {
  userId: string;
  partnerId: string;
  partnerName: string;
  role: PartnerRole;
  permissions: readonly PartnerPermission[];
  branding: Branding;
  usdEurRate: number | null;
};

export type UserOverview = {
  tenants: { tenantId: string; name: string; role: SystemTenantRole; status: string }[];
  partners: { partnerId: string; name: string; role: PartnerRole }[];
};

/** Everything a signed-in user belongs to. Used to pick the active tenant after login. */
export async function getUserOverview(db: Database, userId: string): Promise<UserOverview> {
  return withUser(db, userId, async (tx) => {
    const tenantRows = await tx
      .select({
        tenantId: tenants.id,
        name: tenants.name,
        role: memberships.role,
        status: tenants.status,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, userId))
      .orderBy(tenants.name);
    const partnerRows = await tx
      .select({ partnerId: partners.id, name: partners.name, role: partnerMemberships.role })
      .from(partnerMemberships)
      .innerJoin(partners, eq(partners.id, partnerMemberships.partnerId))
      .where(eq(partnerMemberships.userId, userId));
    return { tenants: tenantRows, partners: partnerRows };
  });
}

/**
 * Verifies the user's membership in a tenant and returns the effective permissions.
 * Returns null if the user is not a member or the tenant is suspended.
 */
export async function getTenantAccess(
  db: Database,
  userId: string,
  tenantId: string,
): Promise<TenantAccess | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        role: memberships.role,
        tenantName: tenants.name,
        status: tenants.status,
        customRoleName: roles.name,
        customPermissions: roles.permissions,
        tenantColor: tenants.brandColor,
        partnerColor: partners.brandColor,
        productName: partners.productName,
        requireAdminTwoFactor: tenants.requireAdminTwoFactor,
        usdEurRate: partners.usdEurRate,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .innerJoin(partners, eq(partners.id, tenants.partnerId))
      .leftJoin(roles, eq(roles.id, memberships.customRoleId))
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)));
    if (!row || row.status !== "active") return null;
    return {
      userId,
      tenantId,
      tenantName: row.tenantName,
      role: row.role,
      customRoleName: row.customRoleName,
      permissions: row.customPermissions ?? SYSTEM_TENANT_ROLE_PERMISSIONS[row.role],
      branding: {
        productName: row.productName,
        primaryColor: row.tenantColor ?? row.partnerColor,
        tenantColor: row.tenantColor,
        partnerColor: row.partnerColor,
      },
      requireAdminTwoFactor: row.requireAdminTwoFactor,
      usdEurRate: row.usdEurRate,
    };
  });
}

export async function getPartnerAccess(
  db: Database,
  userId: string,
  partnerId: string,
): Promise<PartnerAccess | null> {
  return withPartner(db, partnerId, async (tx) => {
    const [row] = await tx
      .select({
        role: partnerMemberships.role,
        partnerName: partners.name,
        productName: partners.productName,
        brandColor: partners.brandColor,
        usdEurRate: partners.usdEurRate,
      })
      .from(partnerMemberships)
      .innerJoin(partners, eq(partners.id, partnerMemberships.partnerId))
      .where(
        and(eq(partnerMemberships.userId, userId), eq(partnerMemberships.partnerId, partnerId)),
      );
    if (!row) return null;
    return {
      userId,
      partnerId,
      partnerName: row.partnerName,
      role: row.role,
      permissions: PARTNER_ROLE_PERMISSIONS[row.role],
      branding: { productName: row.productName, primaryColor: row.brandColor },
      usdEurRate: row.usdEurRate,
    };
  });
}

/** Throws a 403 AppError unless the access includes the permission. Call in every action. */
export function requirePermission<P extends string>(
  access: { permissions: readonly P[] },
  permission: P,
): void {
  if (!hasPermission(access.permissions, permission)) throw forbidden();
}

export function can<P extends string>(
  access: { permissions: readonly P[] },
  permission: P,
): boolean {
  return hasPermission(access.permissions, permission);
}

/**
 * Owners are the only ones who may hand out or take away the owner role, so an admin cannot
 * promote themselves or lock out the owner.
 */
export function assertCanAssignRole(
  actorRole: SystemTenantRole,
  change: { from?: SystemTenantRole; to?: SystemTenantRole },
): void {
  if (actorRole !== "owner" && (change.from === "owner" || change.to === "owner")) {
    throw forbidden("Nur Owner dürfen die Owner-Rolle vergeben oder entziehen.");
  }
}

/** True if this role in this tenant must set up two-factor authentication before working. */
export function needsTwoFactorSetup(
  access: Pick<TenantAccess, "role" | "requireAdminTwoFactor">,
  twoFactorEnabled: boolean,
): boolean {
  return access.requireAdminTwoFactor && access.role !== "member" && !twoFactorEnabled;
}
