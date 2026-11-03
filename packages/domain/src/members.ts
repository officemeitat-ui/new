import { conflict, notFound, type SystemTenantRole } from "@nexus/core";
import { and, eq, ne, type Tx } from "@nexus/db";
import { authUser, memberships } from "@nexus/db/schema";
import { appendAudit } from "./audit";

export async function listMembers(tx: Tx, tenantId: string) {
  return tx
    .select({
      membershipId: memberships.id,
      userId: authUser.id,
      name: authUser.name,
      email: authUser.email,
      twoFactorEnabled: authUser.twoFactorEnabled,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(authUser, eq(authUser.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId))
    .orderBy(authUser.name);
}

async function otherOwnerCount(tx: Tx, tenantId: string, exceptMembershipId: string) {
  const rows = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.role, "owner"),
        ne(memberships.id, exceptMembershipId),
      ),
    );
  return rows.length;
}

async function loadMembership(tx: Tx, tenantId: string, membershipId: string) {
  const [row] = await tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, tenantId)));
  if (!row) throw notFound("Mitglied nicht gefunden.");
  return row;
}

/** A tenant must always keep at least one owner (billing, support access, security). */
export async function changeMemberRole(
  tx: Tx,
  input: { tenantId: string; membershipId: string; role: SystemTenantRole; actorId: string },
): Promise<void> {
  const current = await loadMembership(tx, input.tenantId, input.membershipId);
  if (current.role === input.role) return;
  if (current.role === "owner" && (await otherOwnerCount(tx, input.tenantId, current.id)) === 0) {
    throw conflict("Der Mandant braucht mindestens einen Owner.");
  }
  await tx.update(memberships).set({ role: input.role }).where(eq(memberships.id, current.id));
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "member.role_changed",
    targetType: "user",
    targetId: current.userId,
    metadata: { from: current.role, to: input.role },
  });
}

export async function removeMember(
  tx: Tx,
  input: { tenantId: string; membershipId: string; actorId: string },
): Promise<void> {
  const current = await loadMembership(tx, input.tenantId, input.membershipId);
  if (current.role === "owner" && (await otherOwnerCount(tx, input.tenantId, current.id)) === 0) {
    throw conflict("Der letzte Owner kann nicht entfernt werden.");
  }
  await tx.delete(memberships).where(eq(memberships.id, current.id));
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "member.removed",
    targetType: "user",
    targetId: current.userId,
    metadata: { role: current.role },
  });
}
