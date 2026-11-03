"use server";

import { getDatabase, withTenant } from "@nexus/db";
import { requirePermission, updateTenantBranding } from "@nexus/domain";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/session";

export async function updateBrandingAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("updateBranding", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "tenant.settings.manage");
    const reset = formData.get("intent") === "reset";
    const color = reset ? null : String(formData.get("color") ?? "");
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      updateTenantBranding(tx, {
        tenantId: ctx.tenant.tenantId,
        brandColor: color,
        actorId: ctx.user.id,
      }),
    );
    // The palette is rendered in the root layout.
    revalidatePath("/", "layout");
    return { message: reset ? "Die Partner-Farbe gilt wieder." : "Die Farbe ist gespeichert." };
  });
}
