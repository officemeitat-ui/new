import { conflict, forbidden, notFound, validationError, type SystemTenantRole } from "@nexus/core";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  or,
  sql,
  withSystem,
  type Database,
  type Tx,
} from "@nexus/db";
import {
  agents,
  agentVersions,
  approvals,
  auditLogs,
  authUser,
  conversations,
  defectReports,
  integrations,
  knowledgeCollections,
  knowledgeDocuments,
  memberships,
  messages,
  partnerMemberships,
  runs,
  tenants,
} from "@nexus/db/schema";
import { assertCanAssignRole } from "./access";
import { appendAudit } from "./audit";

/* ----------------------------------------------------------------- retention */

/** Allowed retention periods in days; null keeps data until it is deleted by hand. */
export const RETENTION_OPTIONS = [30, 90, 180, 365, 730] as const;
export type RetentionDays = (typeof RETENTION_OPTIONS)[number] | null;

const isRetention = (value: number | null): value is RetentionDays =>
  value === null || (RETENTION_OPTIONS as readonly number[]).includes(value);

export async function getPrivacySettings(tx: Tx, tenantId: string) {
  const [row] = await tx
    .select({
      chatRetentionDays: tenants.chatRetentionDays,
      documentRetentionDays: tenants.documentRetentionDays,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!row) throw notFound("Firma nicht gefunden.");
  return row;
}

export async function updateRetention(
  tx: Tx,
  input: {
    tenantId: string;
    chatRetentionDays: number | null;
    documentRetentionDays: number | null;
    actorId: string;
  },
) {
  if (!isRetention(input.chatRetentionDays) || !isRetention(input.documentRetentionDays)) {
    throw validationError("Bitte wählen Sie eine der angebotenen Fristen.");
  }
  const before = await getPrivacySettings(tx, input.tenantId);
  await tx
    .update(tenants)
    .set({
      chatRetentionDays: input.chatRetentionDays,
      documentRetentionDays: input.documentRetentionDays,
    })
    .where(eq(tenants.id, input.tenantId));
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "privacy.retention_changed",
    targetType: "tenant",
    targetId: input.tenantId,
    metadata: {
      before,
      after: {
        chatRetentionDays: input.chatRetentionDays,
        documentRetentionDays: input.documentRetentionDays,
      },
    },
  });
}

/** Runs that still need their conversation: never deleted by retention. */
const ACTIVE_RUN = sql`exists (select 1 from ${runs} r where r.conversation_id = ${conversations.id} and r.status in ('queued','running'))`;

/**
 * Nightly deletion job (M13): removes conversations (with messages, runs, steps and approvals)
 * without activity for longer than the tenant's period, and documents older than theirs.
 * Usage figures for billing stay, without any link to the content. Each tenant's deletion is
 * written to its audit log.
 */
export async function applyRetention(db: Database, now = new Date()) {
  const configured = await withSystem(db, "retention: tenants with retention periods", (tx) =>
    tx
      .select({
        id: tenants.id,
        chatDays: tenants.chatRetentionDays,
        documentDays: tenants.documentRetentionDays,
      })
      .from(tenants)
      .where(
        or(
          sql`${tenants.chatRetentionDays} is not null`,
          sql`${tenants.documentRetentionDays} is not null`,
        ),
      ),
  );

  const results: { tenantId: string; conversations: number; documents: number }[] = [];
  // One transaction per tenant: a large deletion never holds the locks of all tenants.
  for (const tenant of configured) {
    const result = await withSystem(
      db,
      "retention: nightly deletion of expired data",
      async (tx) => {
        let deletedConversations = 0;
        let deletedDocuments = 0;
        if (tenant.chatDays) {
          const cutoff = new Date(now.getTime() - tenant.chatDays * 86_400_000);
          const deleted = await tx
            .delete(conversations)
            .where(
              and(
                eq(conversations.tenantId, tenant.id),
                sql`${conversations.lastMessageAt} < ${cutoff}`,
                sql`not ${ACTIVE_RUN}`,
              ),
            )
            .returning({ id: conversations.id });
          deletedConversations = deleted.length;
        }
        if (tenant.chatDays) {
          // Defect reports (with the reporter's optional e-mail) follow the conversation period
          // once they are done.
          const cutoff = new Date(now.getTime() - tenant.chatDays * 86_400_000);
          await tx
            .delete(defectReports)
            .where(
              and(
                eq(defectReports.tenantId, tenant.id),
                eq(defectReports.status, "done"),
                sql`${defectReports.resolvedAt} < ${cutoff}`,
              ),
            );
        }
        if (tenant.documentDays) {
          const cutoff = new Date(now.getTime() - tenant.documentDays * 86_400_000);
          const deleted = await tx
            .delete(knowledgeDocuments)
            .where(
              and(
                eq(knowledgeDocuments.tenantId, tenant.id),
                sql`${knowledgeDocuments.createdAt} < ${cutoff}`,
              ),
            )
            .returning({ id: knowledgeDocuments.id });
          deletedDocuments = deleted.length;
        }
        if (deletedConversations + deletedDocuments > 0) {
          await appendAudit(tx, tenant.id, {
            actorType: "system",
            actorId: null,
            action: "privacy.retention_applied",
            targetType: "tenant",
            targetId: tenant.id,
            metadata: { conversations: deletedConversations, documents: deletedDocuments },
          });
        }
        return {
          tenantId: tenant.id,
          conversations: deletedConversations,
          documents: deletedDocuments,
        };
      },
    );
    results.push(result);
  }
  await expireMemoryProposals(db, now);
  return results;
}

/** Proposals nobody reviewed within this many days are dropped (ADR 0011). */
export const PROPOSAL_EXPIRY_DAYS = 60;

/**
 * Company memory proposals that wait too long are removed for every tenant, regardless of its
 * retention settings: an unreviewed proposal is neither confirmed knowledge nor needed.
 */
export async function expireMemoryProposals(db: Database, now = new Date()) {
  const cutoff = new Date(now.getTime() - PROPOSAL_EXPIRY_DAYS * 86_400_000);
  return withSystem(db, "retention: expire unreviewed memory proposals", async (tx) => {
    const expired = await tx
      .delete(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.status, "proposed"),
          sql`${knowledgeDocuments.createdAt} < ${cutoff}`,
        ),
      )
      .returning({ tenantId: knowledgeDocuments.tenantId });
    const perTenant = new Map<string, number>();
    for (const row of expired) perTenant.set(row.tenantId, (perTenant.get(row.tenantId) ?? 0) + 1);
    for (const [tenantId, count] of perTenant) {
      await appendAudit(tx, tenantId, {
        actorType: "system",
        actorId: null,
        action: "knowledge.memory_proposals_expired",
        targetType: "tenant",
        targetId: tenantId,
        metadata: { proposals: count, days: PROPOSAL_EXPIRY_DAYS },
      });
    }
    return expired.length;
  });
}

/* ------------------------------------------------------------ export (Art. 15) */

type Block = { type?: string; text?: string; name?: string };

function readableContent(content: unknown[]): { text: string; werkzeuge: string[] } {
  const blocks = content.filter((b): b is Block => typeof b === "object" && b !== null);
  return {
    text: blocks
      .filter((b) => b.type === "text" && b.text && !b.text.startsWith("<kontext>"))
      .map((b) => b.text)
      .join("\n\n"),
    werkzeuge: blocks.filter((b) => b.type === "tool_use" && b.name).map((b) => b.name!),
  };
}

/**
 * Everything the tenant stores about one person (DSGVO Art. 15 and 20), as JSON with German
 * keys. Covers the account, the membership, own conversations, approvals, uploads and the
 * person's own audit entries.
 */
export async function exportPersonData(tx: Tx, input: { tenantId: string; userId: string }) {
  const [person] = await tx
    .select({
      id: authUser.id,
      name: authUser.name,
      email: authUser.email,
      emailVerified: authUser.emailVerified,
      twoFactorEnabled: authUser.twoFactorEnabled,
      createdAt: authUser.createdAt,
    })
    .from(authUser)
    .where(eq(authUser.id, input.userId));
  const [membership] = await tx
    .select({ role: memberships.role, since: memberships.createdAt, tenantName: tenants.name })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, input.userId)));
  if (!person || !membership) throw notFound("Diese Person gehört nicht zu Ihrer Firma.");

  const ownConversations = await tx
    .select({
      id: conversations.id,
      title: conversations.title,
      channel: conversations.channel,
      createdAt: conversations.createdAt,
      agentName: agents.name,
    })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(and(eq(conversations.tenantId, input.tenantId), eq(conversations.userId, input.userId)))
    .orderBy(asc(conversations.createdAt));
  const ids = ownConversations.map((c) => c.id);
  const allMessages = ids.length
    ? await tx
        .select({
          conversationId: messages.conversationId,
          role: messages.role,
          content: messages.content,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(inArray(messages.conversationId, ids))
        .orderBy(asc(messages.conversationId), asc(messages.seq))
    : [];

  const decided = await tx
    .select({
      toolName: approvals.toolName,
      status: approvals.status,
      reason: approvals.reason,
      decidedAt: approvals.decidedAt,
    })
    .from(approvals)
    .where(and(eq(approvals.tenantId, input.tenantId), eq(approvals.decidedBy, input.userId)))
    .orderBy(asc(approvals.decidedAt));
  const uploads = await tx
    .select({
      title: knowledgeDocuments.title,
      fileName: knowledgeDocuments.fileName,
      origin: knowledgeDocuments.origin,
      status: knowledgeDocuments.status,
      createdAt: knowledgeDocuments.createdAt,
    })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.tenantId, input.tenantId),
        eq(knowledgeDocuments.createdBy, input.userId),
      ),
    );
  const audit = await tx
    .select({
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
      ip: auditLogs.ip,
      userAgent: auditLogs.userAgent,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.tenantId, input.tenantId), eq(auditLogs.actorId, input.userId)))
    .orderBy(desc(auditLogs.seq))
    .limit(5000);

  return {
    hinweis:
      "Auskunft nach Art. 15 DSGVO und Datenübertragbarkeit nach Art. 20 DSGVO. Enthält alle Daten, die diese Firma in der Plattform zu Ihrer Person speichert.",
    erstellt_am: new Date().toISOString(),
    firma: membership.tenantName,
    person: {
      id: person.id,
      name: person.name,
      email: person.email,
      email_bestaetigt: person.emailVerified,
      zwei_faktor_aktiv: Boolean(person.twoFactorEnabled),
      konto_seit: person.createdAt,
    },
    mitgliedschaft: { rolle: membership.role, seit: membership.since },
    gespraeche: ownConversations.map((c) => ({
      titel: c.title,
      agent: c.agentName,
      kanal: c.channel,
      begonnen: c.createdAt,
      nachrichten: allMessages
        .filter((m) => m.conversationId === c.id)
        .map((m) => ({
          von: m.role === "user" ? "Person" : "Agent",
          zeit: m.createdAt,
          ...readableContent(m.content),
        }))
        .filter((m) => m.text || m.werkzeuge.length > 0),
    })),
    freigaben_entschieden: decided.map((d) => ({
      werkzeug: d.toolName,
      entscheidung: d.status,
      begruendung: d.reason,
      zeit: d.decidedAt,
    })),
    hochgeladene_dokumente: uploads.map((u) => ({
      titel: u.title,
      datei: u.fileName,
      zeit: u.createdAt,
    })),
    protokoll: audit.map((a) => ({
      zeit: a.createdAt,
      aktion: a.action,
      ip_adresse: a.ip,
      browser: a.userAgent,
    })),
  };
}

/* ------------------------------------------------------------- erasure (Art. 17) */

/**
 * Erases a person's personal data in this tenant (DSGVO Art. 17): own conversations with all
 * content, the link to uploads and settings they created, and the membership. Afterwards call
 * deleteAccountIfOrphaned to remove the account if nothing else links the person to the platform.
 *
 * The audit log keeps entries with the person's ID (accountability, Art. 5(2)); names and
 * e-mail addresses are not part of it, and after account deletion the ID no longer resolves.
 */
export async function erasePerson(
  tx: Tx,
  input: { tenantId: string; userId: string; actorId: string; actorRole: SystemTenantRole },
): Promise<{ conversations: number }> {
  if (input.userId === input.actorId) {
    throw forbidden("Sich selbst können Sie hier nicht löschen. Bitten Sie einen anderen Owner.");
  }
  const [membership] = await tx
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, input.userId)));
  if (!membership) throw notFound("Diese Person gehört nicht zu Ihrer Firma.");
  // Like removing a member: only owners may act on owners (finding 5).
  assertCanAssignRole(input.actorRole, { from: membership.role });
  if (membership.role === "owner") {
    const [owners] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.role, "owner")));
    if ((owners?.count ?? 0) <= 1) {
      throw conflict(
        "Der letzte Owner kann nicht gelöscht werden. Ernennen Sie zuerst einen anderen.",
      );
    }
  }

  const removed = await tx
    .delete(conversations)
    .where(and(eq(conversations.tenantId, input.tenantId), eq(conversations.userId, input.userId)))
    .returning({ id: conversations.id });
  // Content created by the person stays (it belongs to the company); the link to them goes.
  await tx
    .update(knowledgeDocuments)
    .set({ createdBy: null })
    .where(
      and(
        eq(knowledgeDocuments.tenantId, input.tenantId),
        eq(knowledgeDocuments.createdBy, input.userId),
      ),
    );
  await tx
    .update(knowledgeCollections)
    .set({ createdBy: null })
    .where(
      and(
        eq(knowledgeCollections.tenantId, input.tenantId),
        eq(knowledgeCollections.createdBy, input.userId),
      ),
    );
  await tx
    .update(agents)
    .set({ createdBy: null })
    .where(and(eq(agents.tenantId, input.tenantId), eq(agents.createdBy, input.userId)));
  await tx
    .update(agentVersions)
    .set({ createdBy: null })
    .where(
      and(eq(agentVersions.tenantId, input.tenantId), eq(agentVersions.createdBy, input.userId)),
    );
  await tx
    .update(approvals)
    .set({ decidedBy: null })
    .where(and(eq(approvals.tenantId, input.tenantId), eq(approvals.decidedBy, input.userId)));
  await tx
    .update(integrations)
    .set({ connectedBy: null })
    .where(
      and(eq(integrations.tenantId, input.tenantId), eq(integrations.connectedBy, input.userId)),
    );
  await tx.delete(memberships).where(eq(memberships.id, membership.id));

  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "privacy.person_erased",
    targetType: "user",
    targetId: input.userId,
    metadata: { conversations: removed.length },
  });
  return { conversations: removed.length };
}

/**
 * Second step of the erasure, after the tenant transaction committed: deletes the account
 * (sessions, logins, 2FA) if the person belongs to no other company and is no partner staff.
 */
export async function deleteAccountIfOrphaned(
  db: Database,
  input: { userId: string; tenantId: string },
): Promise<boolean> {
  return withSystem(db, "privacy: delete account without memberships", async (tx) => {
    const [other] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(memberships)
      .where(eq(memberships.userId, input.userId));
    const [partner] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(partnerMemberships)
      .where(eq(partnerMemberships.userId, input.userId));
    if ((other?.count ?? 0) > 0 || (partner?.count ?? 0) > 0) return false;
    const deleted = await tx
      .delete(authUser)
      .where(eq(authUser.id, input.userId))
      .returning({ id: authUser.id });
    if (deleted.length === 0) return false;
    await appendAudit(tx, input.tenantId, {
      actorType: "system",
      actorId: null,
      action: "privacy.account_deleted",
      targetType: "user",
      targetId: input.userId,
      metadata: {},
    });
    return true;
  });
}
