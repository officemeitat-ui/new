import { createHash } from "node:crypto";
import { asc, desc, eq, sql, type Tx } from "@nexus/db";
import { auditLogs, authUser, type AuditActorType } from "@nexus/db/schema";

export const GENESIS_HASH = "0".repeat(64);

export type AuditInput = {
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

export type HashedFields = {
  tenantId: string;
  seq: number;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

/** JSON with sorted object keys, so the same content always produces the same hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function computeAuditHash(prevHash: string, fields: HashedFields): string {
  return createHash("sha256")
    .update(`${prevHash}\n${canonicalJson(fields)}`)
    .digest("hex");
}

/**
 * Appends an entry to the tenant's hash chain. An advisory lock per tenant serialises writers,
 * so two concurrent requests cannot both claim the same sequence number.
 * Must run inside a transaction whose context can read and write the tenant's audit log.
 */
export async function appendAudit(tx: Tx, tenantId: string, input: AuditInput) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${tenantId}`}, 0))`);
  const [last] = await tx
    .select({ seq: auditLogs.seq, hash: auditLogs.hash })
    .from(auditLogs)
    .where(eq(auditLogs.tenantId, tenantId))
    .orderBy(desc(auditLogs.seq))
    .limit(1);

  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS_HASH;
  const createdAt = new Date();
  const fields: HashedFields = {
    tenantId,
    seq,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? {},
    createdAt: createdAt.toISOString(),
  };

  const [row] = await tx
    .insert(auditLogs)
    .values({
      ...fields,
      createdAt,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      prevHash,
      hash: computeAuditHash(prevHash, fields),
    })
    .returning();
  return row!;
}

export type ChainCheck = { valid: true; count: number } | { valid: false; brokenAtSeq: number };

type StoredEntry = Omit<HashedFields, "createdAt"> & {
  createdAt: Date;
  prevHash: string;
  hash: string;
};

/** Recomputes the chain. Any changed, removed or reordered entry breaks it. */
export function verifyEntries(entries: StoredEntry[]): ChainCheck {
  let prevHash = GENESIS_HASH;
  for (const [index, entry] of entries.entries()) {
    const expectedSeq = index + 1;
    const { prevHash: storedPrev, hash, createdAt, ...rest } = entry;
    const recomputed = computeAuditHash(prevHash, { ...rest, createdAt: createdAt.toISOString() });
    if (entry.seq !== expectedSeq || storedPrev !== prevHash || hash !== recomputed) {
      return { valid: false, brokenAtSeq: entry.seq };
    }
    prevHash = hash;
  }
  return { valid: true, count: entries.length };
}

export async function verifyAuditChain(tx: Tx, tenantId: string): Promise<ChainCheck> {
  const entries = await tx
    .select({
      tenantId: auditLogs.tenantId,
      seq: auditLogs.seq,
      actorType: auditLogs.actorType,
      actorId: auditLogs.actorId,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      prevHash: auditLogs.prevHash,
      hash: auditLogs.hash,
    })
    .from(auditLogs)
    .where(eq(auditLogs.tenantId, tenantId))
    .orderBy(asc(auditLogs.seq));
  return verifyEntries(entries);
}

/** Latest entries with the actor's name, newest first (settings → audit log). */
export async function listAuditEntries(tx: Tx, tenantId: string, limit = 100) {
  return tx
    .select({
      id: auditLogs.id,
      seq: auditLogs.seq,
      action: auditLogs.action,
      actorType: auditLogs.actorType,
      actorName: authUser.name,
      targetType: auditLogs.targetType,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(authUser, sql`${authUser.id}::text = ${auditLogs.actorId}`)
    .where(eq(auditLogs.tenantId, tenantId))
    .orderBy(desc(auditLogs.seq))
    .limit(limit);
}
