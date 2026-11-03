import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withPartner, withSystem, withTenant, withUser } from "../src/context";
import { auditLogs, invitations, memberships, partners, roles, tenants } from "../src/schema";
import { createFixture, type Fixture } from "./fixtures";
import { openTestDatabase } from "./helpers";

const handle = openTestDatabase();
const db = handle.db;
let f: Fixture;

beforeAll(async () => {
  f = await createFixture(db);
});
afterAll(() => handle.close());

const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id).sort();

/** Drizzle wraps driver errors; the Postgres error (SQLSTATE 42501) is the cause. */
async function expectRlsViolation(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, "expected a row-level security violation").toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
  expect(cause?.code).toBe("42501");
  expect(cause?.message).toMatch(/row-level security/);
}

describe("tenant isolation", () => {
  it("returns nothing without a context", async () => {
    const result = await db.transaction(async (tx) => ({
      tenants: await tx.select().from(tenants),
      memberships: await tx.select().from(memberships),
      partners: await tx.select().from(partners),
      roles: await tx.select().from(roles),
    }));
    expect(result).toEqual({ tenants: [], memberships: [], partners: [], roles: [] });
  });

  it("shows a tenant only its own rows", async () => {
    await withTenant(db, f.tenantA.id, async (tx) => {
      expect(ids(await tx.select().from(tenants))).toEqual([f.tenantA.id]);
      const members = await tx.select().from(memberships);
      expect(members.every((m) => m.tenantId === f.tenantA.id)).toBe(true);
      expect(members.map((m) => m.userId).sort()).toEqual([f.alice.id, f.carol.id].sort());
      // Branding needs the tenant's own partner – and only that one.
      expect(ids(await tx.select().from(partners))).toEqual([f.partner1.id]);
    });
  });

  it("refuses to write into another tenant", async () => {
    await expectRlsViolation(
      withTenant(db, f.tenantA.id, (tx) =>
        tx
          .insert(memberships)
          .values({ tenantId: f.tenantB.id, userId: f.alice.id, role: "owner" }),
      ),
    );
    await expectRlsViolation(
      withTenant(db, f.tenantA.id, (tx) =>
        tx.insert(roles).values({ tenantId: f.tenantB.id, name: "Eindringling" }),
      ),
    );
  });

  it("cannot change or delete another tenant's rows", async () => {
    await withTenant(db, f.tenantA.id, async (tx) => {
      const updated = await tx
        .update(tenants)
        .set({ name: "gekapert" })
        .where(eq(tenants.id, f.tenantB.id))
        .returning();
      expect(updated).toEqual([]);
      const deleted = await tx
        .delete(memberships)
        .where(eq(memberships.tenantId, f.tenantB.id))
        .returning();
      expect(deleted).toEqual([]);
    });
    const b = await withTenant(db, f.tenantB.id, (tx) => tx.select().from(tenants));
    expect(b[0]?.name).toBe("Tenant B");
  });

  it("lets a user see exactly their own memberships and tenants", async () => {
    await withUser(db, f.carol.id, async (tx) => {
      const own = await tx.select().from(memberships);
      expect(own.map((m) => m.tenantId).sort()).toEqual([f.tenantA.id, f.tenantB.id].sort());
      expect(own.every((m) => m.userId === f.carol.id)).toBe(true);
      expect(ids(await tx.select().from(tenants))).toEqual([f.tenantA.id, f.tenantB.id].sort());
    });
    await withUser(db, f.alice.id, async (tx) => {
      expect(ids(await tx.select().from(tenants))).toEqual([f.tenantA.id]);
    });
  });

  it("gives partners their tenant list but not the tenants' members", async () => {
    await withPartner(db, f.partner1.id, async (tx) => {
      expect(ids(await tx.select().from(tenants))).toEqual([f.tenantA.id]);
      expect(await tx.select().from(memberships)).toEqual([]);
    });
  });

  it("lets a partner invite into its own tenants only", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    await withPartner(db, f.partner1.id, (tx) =>
      tx.insert(invitations).values({
        tenantId: f.tenantA.id,
        email: "neu@example.test",
        role: "owner",
        tokenHash: `hash-a-${f.tenantA.id}`,
        expiresAt,
      }),
    );
    await expectRlsViolation(
      withPartner(db, f.partner1.id, (tx) =>
        tx.insert(invitations).values({
          tenantId: f.tenantB.id,
          email: "neu@example.test",
          role: "owner",
          tokenHash: `hash-b-${f.tenantB.id}`,
          expiresAt,
        }),
      ),
    );
  });

  it("keeps the audit log append-only", async () => {
    const [entry] = await withTenant(db, f.tenantA.id, (tx) =>
      tx
        .insert(auditLogs)
        .values({
          tenantId: f.tenantA.id,
          seq: 1,
          actorType: "system",
          action: "test.entry",
          prevHash: "0",
          hash: "h1",
        })
        .returning(),
    );
    await withTenant(db, f.tenantA.id, async (tx) => {
      expect(await tx.update(auditLogs).set({ action: "manipuliert" }).returning()).toEqual([]);
      expect(await tx.delete(auditLogs).returning()).toEqual([]);
    });
    // Even the system context cannot rewrite history.
    await withSystem(db, "test: audit immutability", async (tx) => {
      expect(await tx.update(auditLogs).set({ action: "manipuliert" }).returning()).toEqual([]);
    });
    const [after] = await withTenant(db, f.tenantA.id, (tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.id, entry!.id)),
    );
    expect(after?.action).toBe("test.entry");
  });
});
