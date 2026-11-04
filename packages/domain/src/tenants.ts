import { isUuid, notFound, type SystemTenantRole } from "@nexus/core";
import { and, desc, enterTenant, eq, withPartner, type Database } from "@nexus/db";
import { invitations, tenants, type TenantPlan } from "@nexus/db/schema";
import { appendAudit } from "./audit";
import { createInvitation } from "./invitations";

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "mandant";
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code === "23505";
}

export type ProvisionInput = {
  partnerId: string;
  actorUserId: string;
  name: string;
  plan: TenantPlan;
  ownerEmail: string;
  ownerRole?: SystemTenantRole;
};

/**
 * Creates a tenant for a partner and invites its first owner, in one transaction (M1, M12).
 * Returns the invitation token so the caller can send the e-mail.
 */
export async function provisionTenant(db: Database, input: ProvisionInput) {
  const base = slugify(input.name);
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    try {
      return await withPartner(db, input.partnerId, async (tx) => {
        const [tenant] = await tx
          .insert(tenants)
          .values({ partnerId: input.partnerId, name: input.name.trim(), slug, plan: input.plan })
          .returning();
        // The partner just created this tenant; act on it within the same transaction.
        await enterTenant(tx, tenant!.id);
        await appendAudit(tx, tenant!.id, {
          actorType: "partner",
          actorId: input.actorUserId,
          action: "tenant.created",
          targetType: "tenant",
          targetId: tenant!.id,
          metadata: { plan: input.plan, partnerId: input.partnerId },
        });
        const invitation = await createInvitation(tx, {
          tenantId: tenant!.id,
          email: input.ownerEmail,
          role: input.ownerRole ?? "owner",
          invitedBy: input.actorUserId,
        });
        return { tenant: tenant!, invitation };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("Konnte keinen eindeutigen Kurznamen für den Mandanten finden.");
}

/** Tenant overview for the partner console. Contains no tenant content (ADR 0002). */
export async function listPartnerTenants(db: Database, partnerId: string) {
  return withPartner(db, partnerId, async (tx) => {
    const rows = await tx
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        plan: tenants.plan,
        status: tenants.status,
        partnerSourcesAllowed: tenants.partnerSourcesAllowed,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .where(eq(tenants.partnerId, partnerId))
      .orderBy(desc(tenants.createdAt));
    const pending = await tx
      .select({ tenantId: invitations.tenantId, acceptedAt: invitations.acceptedAt })
      .from(invitations);
    return rows.map((row) => ({
      ...row,
      ownerInvitationPending: pending.some((i) => i.tenantId === row.id && !i.acceptedAt),
    }));
  });
}

/**
 * Allows or forbids a company to connect BookStack and Atera (partner systems with data of many
 * customers, ADR 0010). Only the partner can change it; the database enforces that too.
 */
export async function setPartnerSourcesAllowed(
  db: Database,
  input: { partnerId: string; tenantId: string; allowed: boolean; actorUserId: string },
) {
  if (!isUuid(input.tenantId)) throw notFound("Firma nicht gefunden.");
  await withPartner(db, input.partnerId, async (tx) => {
    const [tenant] = await tx
      .update(tenants)
      .set({ partnerSourcesAllowed: input.allowed })
      .where(and(eq(tenants.id, input.tenantId), eq(tenants.partnerId, input.partnerId)))
      .returning({ id: tenants.id });
    if (!tenant) throw notFound("Firma nicht gefunden.");
    await enterTenant(tx, tenant.id);
    await appendAudit(tx, tenant.id, {
      actorType: "partner",
      actorId: input.actorUserId,
      action: input.allowed ? "tenant.partner_sources_allowed" : "tenant.partner_sources_revoked",
      targetType: "tenant",
      targetId: tenant.id,
      metadata: { partnerId: input.partnerId },
    });
  });
}
