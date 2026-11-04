import { isUuid } from "@nexus/core";
import { createLogger } from "@nexus/core/logger";
import { sql } from "drizzle-orm";
import type { Database, Tx } from "./client";

const log = createLogger("db");

/**
 * Data access always runs inside a transaction with a context. Row Level Security policies
 * read these settings; without a context, tenant-scoped tables return no rows at all.
 * `set_config(..., true)` makes the value transaction-local, so it can never leak to another
 * request that reuses the pooled connection. See docs/adr/0002-mandanten-isolation-rls.md.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  assertUuid(tenantId, "tenantId");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/** Partner staff: tenant list and administrative data of the partner's own tenants only. */
export async function withPartner<T>(
  db: Database,
  partnerId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  assertUuid(partnerId, "partnerId");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.partner_id', ${partnerId}, true)`);
    return fn(tx);
  });
}

/**
 * Cross-tenant access for system jobs (scheduler, migrations of data, provisioning).
 * Every call is logged with its reason. Never use it to serve a user request.
 */
export async function withSystem<T>(
  db: Database,
  reason: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (reason.trim().length < 5)
    throw new Error("withSystem braucht eine aussagekräftige Begründung.");
  log.info({ reason }, "system context opened");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.system', 'on', true)`);
    return fn(tx);
  });
}

/**
 * Anonymous access by a public token (QR report page): the policies let the transaction see
 * only the facility with this token and its company's name and status. No tenant, partner or
 * system context is set.
 */
export async function withPublicToken<T>(
  db: Database,
  token: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!/^[\w-]{20,40}$/.test(token)) throw new Error("Ungültiger öffentlicher Token.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.public_token', ${token}, true)`);
    return fn(tx);
  });
}

/**
 * Resolves what a signed-in user belongs to (memberships, tenants, partner roles) before a
 * tenant is selected. Sees only rows of this user.
 */
export async function withUser<T>(
  db: Database,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  assertUuid(userId, "userId");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Adds a tenant to the context of an open transaction. Only for server-side flows that
 * legitimately act on a tenant they just created or verified (e.g. partner provisioning,
 * accepting an invitation) and must stay in one transaction.
 */
export async function enterTenant(tx: Tx, tenantId: string): Promise<void> {
  assertUuid(tenantId, "tenantId");
  await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
}

function assertUuid(value: string, name: string): void {
  if (!isUuid(value)) throw new Error(`${name} ist keine gültige UUID.`);
}
