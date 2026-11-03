"use server";

import { getDatabase } from "@nexus/db";
import { acceptInvitation, getTenantAccess } from "@nexus/domain";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/lib/actions";
import { auth } from "@/lib/auth";
import { ACTIVE_TENANT_COOKIE, requireUser } from "@/lib/session";

async function setActiveTenant(tenantId: string) {
  (await cookies()).set(ACTIVE_TENANT_COOKIE, tenantId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 90,
  });
}

/** Switches the active tenant after verifying the membership. */
export async function selectTenantAction(tenantId: string): Promise<void> {
  const user = await requireUser();
  const access = await getTenantAccess(getDatabase().db, user.id, tenantId);
  if (!access) redirect("/select-tenant");
  await setActiveTenant(tenantId);
  redirect("/");
}

export async function acceptInvitationAction(token: string): Promise<ActionResult> {
  let tenantId: string | undefined;
  const result = await runAction<undefined>("acceptInvitation", async () => {
    const user = await requireUser();
    ({ tenantId } = await acceptInvitation(getDatabase().db, {
      token,
      userId: user.id,
      userEmail: user.email,
    }));
  });
  if (!result.ok || !tenantId) return result;
  await setActiveTenant(tenantId);
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  (await cookies()).delete(ACTIVE_TENANT_COOKIE);
  redirect("/login");
}
