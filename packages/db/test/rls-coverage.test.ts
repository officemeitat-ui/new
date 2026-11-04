import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDatabase } from "./helpers";

const handle = openTestDatabase();
afterAll(() => handle.close());

/** Tables that are tenant data without a `tenant_id` column. */
const EXTRA_PROTECTED = ["tenants", "partners", "partner_memberships", "partner_agent_templates"];

describe("Row Level Security coverage", () => {
  it("protects every tenant-scoped table with enabled, forced RLS and a policy", async () => {
    const { rows } = await handle.db.execute<{
      table_name: string;
      rls: boolean;
      forced: boolean;
      policies: number;
    }>(sql`
      select c.relname as table_name,
             c.relrowsecurity as rls,
             c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and (
          exists (select 1 from information_schema.columns col
                   where col.table_schema = 'public' and col.table_name = c.relname
                     and col.column_name = 'tenant_id')
          or c.relname = any(${sql.raw(`array[${EXTRA_PROTECTED.map((t) => `'${t}'`).join(",")}]`)})
        )
      order by c.relname`);

    expect(rows.length).toBeGreaterThanOrEqual(EXTRA_PROTECTED.length);
    const unprotected = rows.filter((r) => !r.rls || !r.forced || r.policies === 0);
    expect(unprotected.map((r) => r.table_name)).toEqual([]);
  });

  it("keeps the identity tables free of tenant data", async () => {
    const { rows } = await handle.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and table_name like 'auth\_%' and column_name = 'tenant_id'`);
    expect(rows).toEqual([]);
  });
});
