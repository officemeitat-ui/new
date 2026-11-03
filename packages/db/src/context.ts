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

function assertUuid(value: string, name: string): void {
  if (!isUuid(value)) throw new Error(`${name} ist keine gültige UUID.`);
}
