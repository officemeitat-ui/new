import { bigint, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./_columns";
import { tenants } from "./tenancy";

export type AuditActorType = "user" | "partner" | "system" | "agent";

/**
 * Append-only audit log with a hash chain per tenant (M13). RLS allows SELECT and INSERT only;
 * there are no UPDATE or DELETE policies, so entries cannot be changed through the app role.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    seq: bigint({ mode: "number" }).notNull(),
    actorType: text().$type<AuditActorType>().notNull(),
    actorId: text(),
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ip: text(),
    userAgent: text(),
    prevHash: text().notNull(),
    hash: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("audit_logs_tenant_seq_uq").on(t.tenantId, t.seq),
    index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);
