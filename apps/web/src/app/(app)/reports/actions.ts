"use server";

import { isUuid, validationError } from "@nexus/core";
import { createLogger } from "@nexus/core/logger";
import { getDatabase, withTenant } from "@nexus/db";
import {
  createFacility,
  requirePermission,
  sendDefectResolvedEmail,
  setFacilityActive,
  updateDefectReport,
} from "@nexus/domain";
import type { DefectStatus } from "@nexus/db/schema";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/session";

const log = createLogger("web");

export async function createFacilityAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("createFacility", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "tenant.settings.manage");
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      createFacility(tx, {
        tenantId: ctx.tenant.tenantId,
        name: String(formData.get("name") ?? ""),
        address: String(formData.get("address") ?? ""),
        contactEmail: String(formData.get("contactEmail") ?? ""),
        actorId: ctx.user.id,
      }),
    );
    revalidatePath("/reports/objects");
    return { message: "Das Objekt ist angelegt. Drucken Sie jetzt den QR-Aushang." };
  });
}

export async function setFacilityActiveAction(
  facilityId: string,
  active: boolean,
): Promise<ActionResult> {
  return runAction("setFacilityActive", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "tenant.settings.manage");
    if (!isUuid(facilityId)) throw validationError("Ungültiges Objekt.");
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      setFacilityActive(tx, {
        tenantId: ctx.tenant.tenantId,
        facilityId,
        active,
        actorId: ctx.user.id,
      }),
    );
    revalidatePath("/reports/objects");
  });
}

export async function updateReportAction(input: {
  reportId: string;
  status: DefectStatus;
  note?: string | null;
}): Promise<ActionResult> {
  return runAction("updateReport", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "reports.manage");
    if (!isUuid(input.reportId)) throw validationError("Ungültige Meldung.");
    const { notify } = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      updateDefectReport(tx, {
        tenantId: ctx.tenant.tenantId,
        reportId: input.reportId,
        status: input.status,
        note: input.note ?? null,
        actorId: ctx.user.id,
      }),
    );
    if (notify) {
      await sendDefectResolvedEmail(notify).catch((error: unknown) =>
        log.warn({ err: error }, "resolved e-mail failed"),
      );
    }
    revalidatePath("/reports");
    revalidatePath("/", "layout");
    return {
      message: notify ? "Erledigt – die meldende Person wurde benachrichtigt." : "Gespeichert.",
    };
  });
}
