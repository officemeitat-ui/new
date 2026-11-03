"use server";

import { isSystemTenantRole, notFound, validationError } from "@nexus/core";
import { getEnv } from "@nexus/core/env";
import { createLogger } from "@nexus/core/logger";
import { getDatabase, withTenant } from "@nexus/db";
import {
  assertCanAssignRole,
  changeMemberRole,
  createInvitation,
  listMembers,
  removeMember,
  requirePermission,
  revokeInvitation,
  sendInvitationEmail,
} from "@nexus/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/session";

const log = createLogger("web");

const roleSchema = z.string().refine(isSystemTenantRole, "Unbekannte Rolle");

async function managerContext() {
  const ctx = await requireTenant();
  requirePermission(ctx.tenant, "tenant.members.manage");
  return ctx;
}

export async function inviteMemberAction(
  _prev: ActionResult<{ link?: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ link?: string }>> {
  return runAction("inviteMember", async () => {
    const ctx = await managerContext();
    const parsed = z
      .object({ email: z.email("Bitte eine gültige E-Mail-Adresse eingeben."), role: roleSchema })
      .safeParse({ email: formData.get("email"), role: formData.get("role") });
    if (!parsed.success) throw validationError(parsed.error.issues[0]!.message);
    const role = parsed.data.role as "owner" | "admin" | "member";
    assertCanAssignRole(ctx.tenant.role, { to: role });

    const { token } = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      createInvitation(tx, {
        tenantId: ctx.tenant.tenantId,
        email: parsed.data.email,
        role,
        invitedBy: ctx.user.id,
      }),
    );
    revalidatePath("/settings/members");

    const link = `${getEnv().APP_URL}/invite/${token}`;
    try {
      await sendInvitationEmail({
        to: parsed.data.email,
        tenantName: ctx.tenant.tenantName,
        inviterName: ctx.user.name,
        url: link,
      });
      return { message: `Einladung an ${parsed.data.email} gesendet.` };
    } catch (error) {
      // The invitation exists; show the link so it can be shared another way.
      log.warn({ err: error }, "invitation e-mail could not be sent");
      return {
        message:
          "Die Einladung wurde erstellt, die E-Mail konnte aber nicht gesendet werden. Teilen Sie diesen Link:",
        data: { link },
      };
    }
  });
}

export async function changeRoleAction(formData: FormData): Promise<ActionResult> {
  return runAction("changeRole", async () => {
    const ctx = await managerContext();
    const membershipId = String(formData.get("membershipId") ?? "");
    const role = roleSchema.parse(formData.get("role")) as "owner" | "admin" | "member";
    await withTenant(getDatabase().db, ctx.tenant.tenantId, async (tx) => {
      const member = (await listMembers(tx, ctx.tenant.tenantId)).find(
        (m) => m.membershipId === membershipId,
      );
      if (!member) throw notFound("Mitglied nicht gefunden.");
      assertCanAssignRole(ctx.tenant.role, { from: member.role, to: role });
      await changeMemberRole(tx, {
        tenantId: ctx.tenant.tenantId,
        membershipId,
        role,
        actorId: ctx.user.id,
      });
    });
    revalidatePath("/settings/members");
  });
}

export async function removeMemberAction(formData: FormData): Promise<ActionResult> {
  return runAction("removeMember", async () => {
    const ctx = await managerContext();
    const membershipId = String(formData.get("membershipId") ?? "");
    await withTenant(getDatabase().db, ctx.tenant.tenantId, async (tx) => {
      const member = (await listMembers(tx, ctx.tenant.tenantId)).find(
        (m) => m.membershipId === membershipId,
      );
      if (!member) throw notFound("Mitglied nicht gefunden.");
      assertCanAssignRole(ctx.tenant.role, { from: member.role });
      await removeMember(tx, { tenantId: ctx.tenant.tenantId, membershipId, actorId: ctx.user.id });
    });
    revalidatePath("/settings/members");
  });
}

export async function revokeInvitationAction(formData: FormData): Promise<ActionResult> {
  return runAction("revokeInvitation", async () => {
    const ctx = await managerContext();
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      revokeInvitation(tx, {
        tenantId: ctx.tenant.tenantId,
        invitationId: String(formData.get("invitationId") ?? ""),
        actorId: ctx.user.id,
      }),
    );
    revalidatePath("/settings/members");
  });
}
