import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { withPartner, withSystem, withTenant } from "../src/context";
import { openTestDatabase } from "./helpers";

const handle = openTestDatabase();
afterAll(() => handle.close());

const TENANT = "0190f0c0-0000-7000-8000-000000000001";
const PARTNER = "0190f0c0-0000-7000-8000-0000000000aa";

async function readContext(tx: Parameters<Parameters<typeof withTenant>[2]>[0]) {
  const result = await tx.execute<{
    tenant: string | null;
    partner: string | null;
    system: boolean;
  }>(
    sql`select app_current_tenant() as tenant, app_current_partner() as partner, app_is_system() as system`,
  );
  return result.rows[0];
}

describe("database context", () => {
  it("sets the tenant only inside the transaction", async () => {
    const inside = await withTenant(handle.db, TENANT, readContext);
    expect(inside).toEqual({ tenant: TENANT, partner: null, system: false });

    const outside = await handle.db.transaction(readContext);
    expect(outside).toEqual({ tenant: null, partner: null, system: false });
  });

  it("does not leak context to the next user of a pooled connection", async () => {
    const single = openTestDatabase();
    try {
      await withTenant(single.db, TENANT, async () => undefined);
      const after = await single.db.transaction(readContext);
      expect(after?.tenant).toBeNull();
    } finally {
      await single.close();
    }
  });

  it("supports partner and system contexts", async () => {
    expect(await withPartner(handle.db, PARTNER, readContext)).toEqual({
      tenant: null,
      partner: PARTNER,
      system: false,
    });
    expect((await withSystem(handle.db, "test of the system context", readContext))?.system).toBe(
      true,
    );
  });

  it("rejects malformed ids before touching the database", async () => {
    await expect(withTenant(handle.db, "' or 1=1 --", async () => 1)).rejects.toThrow(/UUID/);
  });

  it("requires a reason for system access", async () => {
    await expect(withSystem(handle.db, "", async () => 1)).rejects.toThrow(/Begründung/);
  });
});
