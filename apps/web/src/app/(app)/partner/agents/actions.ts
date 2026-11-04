"use server";

import { getDatabase } from "@nexus/db";
import {
  createAgentPackage,
  requirePermission,
  rolloutAgentPackage,
  updateAgentPackage,
  type RolloutOutcome,
} from "@nexus/domain";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { requirePartner } from "@/lib/session";

export async function createAgentPackageAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("createAgentPackage", async () => {
    const ctx = await requirePartner();
    requirePermission(ctx.partner, "partner.templates.manage");
    const created = await createAgentPackage(getDatabase().db, {
      partnerId: ctx.partner.partnerId,
      baseTemplateId: String(formData.get("templateId") ?? ""),
      actorId: ctx.user.id,
    });
    revalidatePath("/partner/agents");
    return {
      message: `Das Paket „${created.name}“ ist angelegt. Passen Sie es an und rollen Sie es aus.`,
    };
  });
}

export async function updateAgentPackageAction(
  packageId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("updateAgentPackage", async () => {
    const ctx = await requirePartner();
    requirePermission(ctx.partner, "partner.templates.manage");
    const { package: saved, changed } = await updateAgentPackage(getDatabase().db, {
      partnerId: ctx.partner.partnerId,
      packageId,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      instructions: String(formData.get("instructions") ?? ""),
    });
    revalidatePath("/partner/agents");
    return {
      message: changed
        ? `Gespeichert als Version ${saved.version}. Rollen Sie die Änderung jetzt aus.`
        : "Gespeichert.",
    };
  });
}

export type RolloutSummary = Partial<Record<RolloutOutcome, number>>;

export async function rolloutAgentPackageAction(
  packageId: string,
  _prev: ActionResult<RolloutSummary> | null,
  formData: FormData,
): Promise<ActionResult<RolloutSummary>> {
  return runAction("rolloutAgentPackage", async () => {
    const ctx = await requirePartner();
    requirePermission(ctx.partner, "partner.templates.manage");
    const results = await rolloutAgentPackage(getDatabase().db, {
      partnerId: ctx.partner.partnerId,
      packageId,
      tenantIds: formData.getAll("tenantId").map(String),
      actorId: ctx.user.id,
    });
    const summary: RolloutSummary = {};
    for (const { outcome } of results) summary[outcome] = (summary[outcome] ?? 0) + 1;
    revalidatePath("/partner/agents");
    return { data: summary };
  });
}
