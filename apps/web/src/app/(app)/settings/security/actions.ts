"use server";

import { getDatabase, withTenant } from "@nexus/db";
import { requirePermission, updateTenantSecurity } from "@nexus/domain";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/session";

export async function updateSecurityAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("updateSecurity", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "tenant.settings.manage");
    const requireAdminTwoFactor = formData.get("requireAdminTwoFactor") === "on";
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      updateTenantSecurity(tx, {
        tenantId: ctx.tenant.tenantId,
        requireAdminTwoFactor,
        actorId: ctx.user.id,
      }),
    );
    revalidatePath("/settings", "layout");
    return {
      message: requireAdminTwoFactor
        ? "Owner und Admins brauchen ab sofort die Zwei-Faktor-Anmeldung."
        : "Die Zwei-Faktor-Pflicht ist aufgehoben.",
    };
  });
}
