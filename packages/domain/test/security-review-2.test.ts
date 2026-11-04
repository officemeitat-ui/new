import { eq, withPartner, withPublicToken, withTenant } from "@nexus/db";
import { facilities, tenants } from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFacility } from "../src/facilities";
import { setPartnerSourcesAllowed } from "../src/tenants";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let fx: Awaited<ReturnType<typeof createPartnerWithTenant>>;
let other: Awaited<ReturnType<typeof createPartnerWithTenant>>;

beforeAll(async () => {
  fx = await createPartnerWithTenant(db);
  other = await createPartnerWithTenant(db);
});
afterAll(() => handle.close());

describe("partner-only approval for BookStack and Atera", () => {
  it("can be set by the partner, never by the company itself or another partner", async () => {
    // The company's own context (e.g. a tenant admin) cannot set the flag – the database refuses.
    await expect(
      withTenant(db, fx.tenant.id, (tx) =>
        tx.update(tenants).set({ partnerSourcesAllowed: true }).where(eq(tenants.id, fx.tenant.id)),
      ),
    ).rejects.toThrow();
    // Another partner does not even see the company.
    await expect(
      setPartnerSourcesAllowed(db, {
        partnerId: other.partner.id,
        tenantId: fx.tenant.id,
        allowed: true,
        actorUserId: other.staff.id,
      }),
    ).rejects.toThrow(/nicht gefunden/);

    await setPartnerSourcesAllowed(db, {
      partnerId: fx.partner.id,
      tenantId: fx.tenant.id,
      allowed: true,
      actorUserId: fx.staff.id,
    });
    const [row] = await withPartner(db, fx.partner.id, (tx) =>
      tx
        .select({ allowed: tenants.partnerSourcesAllowed })
        .from(tenants)
        .where(eq(tenants.id, fx.tenant.id)),
    );
    expect(row?.allowed).toBe(true);
  });
});

describe("public QR token context", () => {
  it("sees exactly one facility and its company, nothing else", async () => {
    const mine = await withTenant(db, fx.tenant.id, (tx) =>
      createFacility(tx, { tenantId: fx.tenant.id, name: "Objekt A", actorId: fx.owner.id }),
    );
    await withTenant(db, other.tenant.id, (tx) =>
      createFacility(tx, { tenantId: other.tenant.id, name: "Objekt B", actorId: other.owner.id }),
    );
    const visible = await withPublicToken(db, mine.publicToken, async (tx) => ({
      facilities: await tx.select({ id: facilities.id }).from(facilities),
      tenants: await tx.select({ id: tenants.id }).from(tenants),
    }));
    expect(visible.facilities.map((f) => f.id)).toEqual([mine.id]);
    expect(visible.tenants.map((t) => t.id)).toEqual([fx.tenant.id]);
    // A wrong token sees nothing at all.
    const none = await withPublicToken(db, "x".repeat(24), (tx) =>
      tx.select({ id: facilities.id }).from(facilities),
    );
    expect(none).toEqual([]);
    await expect(withPublicToken(db, "zu kurz", async () => null)).rejects.toThrow();
  });
});
