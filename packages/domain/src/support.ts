import { createHmac, timingSafeEqual } from "node:crypto";
import { conflict, isUuid, notFound, SUPPORT_PERMISSIONS, validationError } from "@nexus/core";
import { getEnv } from "@nexus/core/env";
import {
  and,
  desc,
  enterTenant,
  eq,
  gt,
  isNull,
  withPartner,
  type Database,
  type Tx,
} from "@nexus/db";
import { authUser, partners, supportAccessGrants, tenants } from "@nexus/db/schema";
import type { TenantAccess } from "./access";
import { appendAudit } from "./audit";

export const SUPPORT_DURATIONS_HOURS = [1, 4, 24, 72] as const;

/* -------------------------------------------------------------- session cookie */

function cookieKey(): Buffer {
  const secret = getEnv().BETTER_AUTH_SECRET ?? "development-secret-change-me-0000000000";
  return createHmac("sha256", secret).update("nexus:support-session").digest();
}

const cookieSignature = (userId: string, tenantId: string) =>
  createHmac("sha256", cookieKey()).update(`${userId}:${tenantId}`).digest();

/**
 * Value of the support-session cookie: the tenant plus an HMAC bound to the person. Only the
 * start action (which writes the audit entry) can create it, so a hand-made cookie does not
 * open a support session without a trace.
 */
export function signSupportCookie(userId: string, tenantId: string): string {
  return `${tenantId}.${cookieSignature(userId, tenantId).toString("base64url")}`;
}

/** The tenant of a valid support cookie for this person, otherwise null. */
export function verifySupportCookie(value: string | undefined, userId: string): string | null {
  const [tenantId, signature, ...rest] = (value ?? "").split(".");
  if (!tenantId || !signature || rest.length > 0 || !isUuid(tenantId)) return null;
  const given = Buffer.from(signature, "base64url");
  const expected = cookieSignature(userId, tenantId);
  return given.length === expected.length && timingSafeEqual(given, expected) ? tenantId : null;
}

/**
 * The tenant grants its partner time-limited access (M12). Only one grant is active at a time;
 * a new grant replaces the previous one.
 */
export async function grantSupportAccess(
  tx: Tx,
  input: { tenantId: string; grantedBy: string; hours: number; reason: string },
) {
  if (!(SUPPORT_DURATIONS_HOURS as readonly number[]).includes(input.hours)) {
    throw validationError("Ungültige Dauer.");
  }
  const reason = input.reason.trim();
  if (reason.length < 3) throw validationError("Bitte kurz den Anlass angeben.");
  const [tenant] = await tx
    .select({ partnerId: tenants.partnerId })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  if (!tenant) throw notFound("Mandant nicht gefunden.");

  const now = new Date();
  await tx
    .update(supportAccessGrants)
    .set({ revokedAt: now })
    .where(
      and(
        eq(supportAccessGrants.tenantId, input.tenantId),
        isNull(supportAccessGrants.revokedAt),
        gt(supportAccessGrants.expiresAt, now),
      ),
    );
  const [grant] = await tx
    .insert(supportAccessGrants)
    .values({
      tenantId: input.tenantId,
      partnerId: tenant.partnerId,
      grantedBy: input.grantedBy,
      reason: reason.slice(0, 500),
      expiresAt: new Date(now.getTime() + input.hours * 3_600_000),
    })
    .returning();
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.grantedBy,
    action: "support.granted",
    targetType: "support_access",
    targetId: grant!.id,
    metadata: { hours: input.hours, reason: grant!.reason },
  });
  return grant!;
}

export async function revokeSupportAccess(
  tx: Tx,
  input: { tenantId: string; grantId: string; actorId: string },
): Promise<void> {
  const updated = await tx
    .update(supportAccessGrants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(supportAccessGrants.id, input.grantId),
        eq(supportAccessGrants.tenantId, input.tenantId),
        isNull(supportAccessGrants.revokedAt),
      ),
    )
    .returning({ id: supportAccessGrants.id });
  if (updated.length === 0) throw notFound("Kein aktiver Support-Zugriff.");
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "support.revoked",
    targetType: "support_access",
    targetId: input.grantId,
  });
}

export async function listSupportGrants(tx: Tx, tenantId: string) {
  return tx
    .select({
      id: supportAccessGrants.id,
      reason: supportAccessGrants.reason,
      expiresAt: supportAccessGrants.expiresAt,
      revokedAt: supportAccessGrants.revokedAt,
      createdAt: supportAccessGrants.createdAt,
      grantedByName: authUser.name,
    })
    .from(supportAccessGrants)
    .leftJoin(authUser, eq(authUser.id, supportAccessGrants.grantedBy))
    .where(eq(supportAccessGrants.tenantId, tenantId))
    .orderBy(desc(supportAccessGrants.createdAt))
    .limit(20);
}

async function activeGrant(tx: Tx, partnerId: string, tenantId: string) {
  const [grant] = await tx
    .select()
    .from(supportAccessGrants)
    .where(
      and(
        eq(supportAccessGrants.partnerId, partnerId),
        eq(supportAccessGrants.tenantId, tenantId),
        isNull(supportAccessGrants.revokedAt),
        gt(supportAccessGrants.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(supportAccessGrants.expiresAt))
    .limit(1);
  return grant ?? null;
}

/** Active grants per tenant, for the partner console. */
export async function listActiveSupportGrants(db: Database, partnerId: string) {
  return withPartner(db, partnerId, (tx) =>
    tx
      .select({ tenantId: supportAccessGrants.tenantId, expiresAt: supportAccessGrants.expiresAt })
      .from(supportAccessGrants)
      .where(
        and(
          eq(supportAccessGrants.partnerId, partnerId),
          isNull(supportAccessGrants.revokedAt),
          gt(supportAccessGrants.expiresAt, new Date()),
        ),
      ),
  );
}

/**
 * Tenant access for partner staff during a granted support session. Returns null as soon as
 * the grant expires or is revoked – the session ends automatically.
 */
export async function getSupportAccess(
  db: Database,
  input: { userId: string; partnerId: string; tenantId: string },
): Promise<TenantAccess | null> {
  return withPartner(db, input.partnerId, async (tx) => {
    const grant = await activeGrant(tx, input.partnerId, input.tenantId);
    if (!grant) return null;
    const [row] = await tx
      .select({
        name: tenants.name,
        status: tenants.status,
        tenantColor: tenants.brandColor,
        partnerColor: partners.brandColor,
        productName: partners.productName,
        partnerName: partners.name,
        requireAdminTwoFactor: tenants.requireAdminTwoFactor,
        usdEurRate: partners.usdEurRate,
      })
      .from(tenants)
      .innerJoin(partners, eq(partners.id, tenants.partnerId))
      .where(eq(tenants.id, input.tenantId));
    if (!row || row.status !== "active") return null;
    return {
      userId: input.userId,
      tenantId: input.tenantId,
      tenantName: row.name,
      role: "admin",
      customRoleName: null,
      permissions: SUPPORT_PERMISSIONS,
      branding: {
        productName: row.productName,
        primaryColor: row.tenantColor ?? row.partnerColor,
        tenantColor: row.tenantColor,
        partnerColor: row.partnerColor,
      },
      requireAdminTwoFactor: row.requireAdminTwoFactor,
      usdEurRate: row.usdEurRate,
      support: { expiresAt: grant.expiresAt, partnerName: row.partnerName },
    };
  });
}

/** Records the start or end of a support session in the tenant's audit log. */
export async function recordSupportSession(
  db: Database,
  input: { userId: string; partnerId: string; tenantId: string; event: "started" | "ended" },
): Promise<void> {
  await withPartner(db, input.partnerId, async (tx) => {
    if (input.event === "started" && !(await activeGrant(tx, input.partnerId, input.tenantId))) {
      throw conflict("Für diesen Mandanten ist kein Support-Zugriff freigegeben.");
    }
    // The partner acts on a tenant that granted access: write into its audit chain.
    await enterTenant(tx, input.tenantId);
    await appendAudit(tx, input.tenantId, {
      actorType: "partner",
      actorId: input.userId,
      action: `support.session_${input.event}`,
      targetType: "tenant",
      targetId: input.tenantId,
    });
  });
}
