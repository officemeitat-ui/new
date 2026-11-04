"use server";

import { isUuid, validationError } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import {
  deleteAccountIfOrphaned,
  erasePerson,
  requirePermission,
  updateRetention,
} from "@nexus/domain";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/session";

const days = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "");
  return text === "" || text === "none" ? null : Number(text);
};

export async function updateRetentionAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("updateRetention", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "tenant.settings.manage");
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      updateRetention(tx, {
        tenantId: ctx.tenant.tenantId,
        chatRetentionDays: days(formData.get("chatRetentionDays")),
        documentRetentionDays: days(formData.get("documentRetentionDays")),
        actorId: ctx.user.id,
      }),
    );
    revalidatePath("/settings/privacy");
    return {
      message: "Die Aufbewahrungsfristen sind gespeichert. Der Löschlauf erfolgt jede Nacht.",
    };
  });
}

/** Erasure of a person's data in this company (Art. 17 DSGVO). */
export async function erasePersonAction(userId: string): Promise<ActionResult> {
  return runAction("erasePerson", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "tenant.members.manage");
    if (!isUuid(userId)) throw validationError("Ungültige Person.");
    const db = getDatabase().db;
    const tenantId = ctx.tenant.tenantId;
    const { conversations } = await withTenant(db, tenantId, (tx) =>
      erasePerson(tx, { tenantId, userId, actorId: ctx.user.id, actorRole: ctx.tenant.role }),
    );
    const accountDeleted = await deleteAccountIfOrphaned(db, { userId, tenantId });
    revalidatePath("/settings/privacy");
    revalidatePath("/settings/members");
    return {
      message: `Gelöscht: ${conversations} Gespräch(e) und die Mitgliedschaft${accountDeleted ? ", außerdem das Benutzerkonto" : " (das Konto bleibt, weil die Person noch zu einer anderen Firma gehört)"}.`,
    };
  });
}
