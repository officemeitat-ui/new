"use server";

import { isUuid, validationError } from "@nexus/core";
import { getEnv } from "@nexus/core/env";
import { createLogger } from "@nexus/core/logger";
import { getDatabase, withPartner } from "@nexus/db";
import {
  provisionTenant,
  recordSupportSession,
  requirePermission,
  sendInvitationEmail,
  setPartnerSourcesAllowed,
  signSupportCookie,
  updatePartnerExchangeRate,
  withAuditRequestContext,
} from "@nexus/domain";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requirePartner, SUPPORT_COOKIE } from "@/lib/session";

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

export async function updateExchangeRateAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("updateExchangeRate", async () => {
    const ctx = await requirePartner();
    requirePermission(ctx.partner, "partner.pricing.manage");
    const raw = String(formData.get("usdEurRate") ?? "")
      .trim()
      .replace(",", ".");
    const rate = raw === "" ? null : Number(raw);
    if (rate !== null && Number.isNaN(rate))
      throw validationError("Bitte eine Zahl eingeben, z. B. 0,92.");
    await withPartner(getDatabase().db, ctx.partner.partnerId, (tx) =>
      updatePartnerExchangeRate(tx, { partnerId: ctx.partner.partnerId, usdEurRate: rate }),
    );
    log.info(
      { partnerId: ctx.partner.partnerId, actorId: ctx.user.id, usdEurRate: rate },
      "exchange rate changed",
    );
    revalidatePath("/", "layout");
    return {
      message:
        rate === null
          ? "Kosten werden wieder in US-Dollar angezeigt."
          : "Der Kurs ist gespeichert.",
    };
  });
}

/** Opens a tenant that granted support access. The session ends when the grant ends. */
export async function startSupportSessionAction(tenantId: string): Promise<void> {
  const ctx = await requirePartner();
  requirePermission(ctx.partner, "partner.tenants.manage");
  if (!isUuid(tenantId)) redirect("/partner");
  const grant = await withAuditRequestContext(await auditMeta(), () =>
    recordSupportSession(getDatabase().db, {
      userId: ctx.user.id,
      partnerId: ctx.partner.partnerId,
      tenantId,
      event: "started",
    }),
  );
  if (!grant) redirect("/partner");
  const store = await cookies();
  const options = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
  // Valid for this grant only and never longer than the grant itself.
  store.set(SUPPORT_COOKIE, signSupportCookie(ctx.user.id, { tenantId, ...grant }), {
    ...options,
    maxAge: Math.max(60, Math.floor((grant.expiresAt.getTime() - Date.now()) / 1000)),
  });
  redirect("/");
}

async function auditMeta() {
  const list = await headers();
  return {
    ip: list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip") || null,
    userAgent: list.get("user-agent"),
  };
}

/** BookStack and Atera only for companies the partner admin allowed (ADR 0010). */
export async function setPartnerSourcesAction(
  tenantId: string,
  allowed: boolean,
): Promise<ActionResult> {
  return runAction("setPartnerSources", async () => {
    const ctx = await requirePartner();
    requirePermission(ctx.partner, "partner.sources.manage");
    await setPartnerSourcesAllowed(getDatabase().db, {
      partnerId: ctx.partner.partnerId,
      tenantId,
      allowed,
      actorUserId: ctx.user.id,
    });
    revalidatePath("/partner");
  });
}
