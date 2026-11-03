"use server";

import { validationError } from "@nexus/core";
import { getEnv } from "@nexus/core/env";
import { createLogger } from "@nexus/core/logger";
import { getDatabase } from "@nexus/db";
import { provisionTenant, requirePermission, sendInvitationEmail } from "@nexus/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requirePartner } from "@/lib/session";

const log = createLogger("web");

const schema = z.object({
  name: z.string().trim().min(2, "Bitte einen Firmennamen eingeben.").max(120),
  plan: z.enum(["starter", "business", "enterprise"]),
  ownerEmail: z.email("Bitte eine gültige E-Mail-Adresse eingeben."),
});

export async function createTenantAction(
  _prev: ActionResult<{ link?: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ link?: string }>> {
  return runAction("createTenant", async () => {
    const ctx = await requirePartner();
    requirePermission(ctx.partner, "partner.tenants.manage");
    const parsed = schema.safeParse({
      name: formData.get("name"),
      plan: formData.get("plan"),
      ownerEmail: formData.get("ownerEmail"),
    });
    if (!parsed.success) throw validationError(parsed.error.issues[0]!.message);

    const { tenant, invitation } = await provisionTenant(getDatabase().db, {
      partnerId: ctx.partner.partnerId,
      actorUserId: ctx.user.id,
      name: parsed.data.name,
      plan: parsed.data.plan,
      ownerEmail: parsed.data.ownerEmail,
    });
    revalidatePath("/partner");

    const link = `${getEnv().APP_URL}/invite/${invitation.token}`;
    try {
      await sendInvitationEmail({
        to: parsed.data.ownerEmail,
        tenantName: tenant.name,
        inviterName: ctx.user.name,
        url: link,
      });
      return {
        message: `„${tenant.name}“ ist angelegt. Die Einladung ging an ${parsed.data.ownerEmail}.`,
      };
    } catch (error) {
      log.warn({ err: error }, "owner invitation e-mail could not be sent");
      return {
        message: `„${tenant.name}“ ist angelegt, die E-Mail konnte aber nicht gesendet werden. Einladungslink:`,
        data: { link },
      };
    }
  });
}
