"use server";

import { validationError } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { grantSupportAccess, requirePermission, revokeSupportAccess } from "@nexus/domain";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/session";

export async function grantSupportAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("grantSupport", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "tenant.support_access.manage");
    const hours = Number(formData.get("hours"));
    if (!Number.isInteger(hours)) throw validationError("Ungültige Dauer.");
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      grantSupportAccess(tx, {
        tenantId: ctx.tenant.tenantId,
        grantedBy: ctx.user.id,
        hours,
        reason: String(formData.get("reason") ?? ""),
      }),
    );
    revalidatePath("/settings/support");
    return { message: "Der Support-Zugriff ist freigegeben." };
  });
}

export async function revokeSupportAction(formData: FormData): Promise<ActionResult> {
  return runAction("revokeSupport", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "tenant.support_access.manage");
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      revokeSupportAccess(tx, {
        tenantId: ctx.tenant.tenantId,
        grantId: String(formData.get("grantId") ?? ""),
        actorId: ctx.user.id,
      }),
    );
    revalidatePath("/settings/support");
  });
}
