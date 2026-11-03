import { notFound, validationError } from "@nexus/core";
import { eq, type Tx } from "@nexus/db";
import { tenants } from "@nexus/db/schema";
import { appendAudit } from "./audit";

const HEX_COLOR = /^#[0-9a-f]{6}$/;

export function normalizeHexColor(value: string): string {
  const color = value.trim().toLowerCase();
  if (!HEX_COLOR.test(color)) throw validationError("Bitte eine Farbe im Format #RRGGBB angeben.");
  return color;
}

/**
 * Sets the tenant's own brand colour (white-label, M1) or – with `null` – returns to the
 * partner's colour. The palette derived from it is contrast-checked in packages/ui/palette.
 */
export async function updateTenantBranding(
  tx: Tx,
  input: { tenantId: string; brandColor: string | null; actorId: string },
): Promise<void> {
  const brandColor = input.brandColor === null ? null : normalizeHexColor(input.brandColor);
  const [before] = await tx
    .select({ brandColor: tenants.brandColor })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  if (!before) throw notFound("Mandant nicht gefunden.");
  if (before.brandColor === brandColor) return;

  await tx.update(tenants).set({ brandColor }).where(eq(tenants.id, input.tenantId));
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "tenant.branding_changed",
    targetType: "tenant",
    targetId: input.tenantId,
    metadata: { from: before.brandColor, to: brandColor },
  });
}

/** Tenant security policy (M2): require two-factor authentication for owners and admins. */
export async function updateTenantSecurity(
  tx: Tx,
  input: { tenantId: string; requireAdminTwoFactor: boolean; actorId: string },
): Promise<void> {
  const [before] = await tx
    .select({ requireAdminTwoFactor: tenants.requireAdminTwoFactor })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  if (!before) throw notFound("Mandant nicht gefunden.");
  if (before.requireAdminTwoFactor === input.requireAdminTwoFactor) return;
  await tx
    .update(tenants)
    .set({ requireAdminTwoFactor: input.requireAdminTwoFactor })
    .where(eq(tenants.id, input.tenantId));
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "tenant.security_changed",
    targetType: "tenant",
    targetId: input.tenantId,
    metadata: { requireAdminTwoFactor: input.requireAdminTwoFactor },
  });
}
