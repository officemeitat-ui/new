"use server";

import { validationError } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { requirePermission, updateTenantGeneral } from "@nexus/domain";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/session";

export async function updateGeneralAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("updateGeneral", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "tenant.settings.manage");
    const rate = Number(String(formData.get("hourlyRate") ?? "").replace(",", "."));
    if (!Number.isFinite(rate)) throw validationError("Bitte einen Stundensatz in Euro angeben.");
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      updateTenantGeneral(tx, {
        tenantId: ctx.tenant.tenantId,
        name: String(formData.get("name") ?? ""),
        hourlyRateCents: Math.round(rate * 100),
        actorId: ctx.user.id,
      }),
    );
    revalidatePath("/", "layout");
    return { message: "Gespeichert." };
  });
}
