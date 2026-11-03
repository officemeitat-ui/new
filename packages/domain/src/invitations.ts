import { conflict, notFound, validationError, type SystemTenantRole } from "@nexus/core";
import { and, eq, gt, isNull, withSystem, withTenant, type Database, type Tx } from "@nexus/db";
import { invitations, memberships, tenants } from "@nexus/db/schema";
import { appendAudit } from "./audit";
import { generateToken, hashToken } from "./tokens";

export const INVITATION_TTL_DAYS = 7;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Creates an invitation and returns the plain token (only for the e-mail link).
 * A previous pending invitation for the same address is revoked.
 */
export async function createInvitation(
  tx: Tx,
  input: { tenantId: string; email: string; role: SystemTenantRole; invitedBy: string | null },
): Promise<{ invitationId: string; token: string; expiresAt: Date }> {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validationError("Ungültige E-Mail-Adresse.");

  await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.tenantId, input.tenantId),
        eq(invitations.email, email),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );

  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);
  const [row] = await tx
    .insert(invitations)
    .values({
      tenantId: input.tenantId,
      email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedBy: input.invitedBy,
      expiresAt,
    })
    .returning({ id: invitations.id });

  await appendAudit(tx, input.tenantId, {
    actorType: input.invitedBy ? "user" : "system",
    actorId: input.invitedBy,
    action: "invitation.created",
    targetType: "invitation",
    targetId: row!.id,
    metadata: { email, role: input.role },
  });
  return { invitationId: row!.id, token, expiresAt };
}

export type InvitationStatus = "valid" | "expired" | "accepted" | "revoked";

export type InvitationView = {
  id: string;
  tenantId: string;
  tenantName: string;
  email: string;
  role: SystemTenantRole;
  status: InvitationStatus;
};

/**
 * Looks up an invitation by its secret token. Runs in the system context because the
 * visitor is not a member yet; the 256-bit token is the authorisation.
 */
export async function findInvitationByToken(
  db: Database,
  token: string,
): Promise<InvitationView | null> {
  if (token.length < 20) return null;
  return withSystem(db, "Einladung per Token prüfen", async (tx) => {
    const [row] = await tx
      .select({
        id: invitations.id,
        tenantId: invitations.tenantId,
        tenantName: tenants.name,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        revokedAt: invitations.revokedAt,
      })
      .from(invitations)
      .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
      .where(eq(invitations.tokenHash, hashToken(token)));
    if (!row) return null;
    const status: InvitationStatus = row.revokedAt
      ? "revoked"
      : row.acceptedAt
        ? "accepted"
        : row.expiresAt <= new Date()
          ? "expired"
          : "valid";
    return {
      id: row.id,
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      email: row.email,
      role: row.role,
      status,
    };
  });
}

/** Turns a valid invitation into a membership. The signed-in e-mail must match the invitation. */
export async function acceptInvitation(
  db: Database,
  input: { token: string; userId: string; userEmail: string },
): Promise<{ tenantId: string }> {
  const invitation = await findInvitationByToken(db, input.token);
  if (!invitation) throw notFound("Diese Einladung gibt es nicht.");
  if (invitation.status !== "valid")
    throw conflict(`Diese Einladung ist nicht mehr gültig (${invitation.status}).`);
  if (normalizeEmail(input.userEmail) !== invitation.email) {
    throw conflict("Die Einladung gilt für eine andere E-Mail-Adresse.");
  }

  await withTenant(db, invitation.tenantId, async (tx) => {
    await tx
      .insert(memberships)
      .values({ tenantId: invitation.tenantId, userId: input.userId, role: invitation.role })
      .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] });
    await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, invitation.id));
    await appendAudit(tx, invitation.tenantId, {
      actorType: "user",
      actorId: input.userId,
      action: "invitation.accepted",
      targetType: "invitation",
      targetId: invitation.id,
      metadata: { role: invitation.role },
    });
  });
  return { tenantId: invitation.tenantId };
}

/** Sign-up guard: accounts may only be created for addresses with a pending invitation. */
export async function hasPendingInvitation(db: Database, email: string): Promise<boolean> {
  return withSystem(db, "Registrierung nur mit Einladung", async (tx) => {
    const [row] = await tx
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.email, normalizeEmail(email)),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return Boolean(row);
  });
}

export async function listPendingInvitations(tx: Tx, tenantId: string) {
  return tx
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(
      and(
        eq(invitations.tenantId, tenantId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .orderBy(invitations.createdAt);
}

export async function revokeInvitation(
  tx: Tx,
  input: { tenantId: string; invitationId: string; actorId: string },
): Promise<void> {
  const updated = await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.id, input.invitationId),
        eq(invitations.tenantId, input.tenantId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .returning({ id: invitations.id });
  if (updated.length === 0) throw notFound("Einladung nicht gefunden.");
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "invitation.revoked",
    targetType: "invitation",
    targetId: input.invitationId,
  });
}
