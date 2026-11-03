import { withPartner } from "@nexus/db";
import { priceTables } from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPartnerAccess, getTenantAccess } from "../src/access";
import { loadCurrentPrices, updatePartnerExchangeRate } from "../src/pricing";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let fx: Awaited<ReturnType<typeof createPartnerWithTenant>>;

beforeAll(async () => {
  fx = await createPartnerWithTenant(db);
});
afterAll(() => handle.close());

describe("price table", () => {
  it("serves the seeded prices and respects validity dates", async () => {
    const now = await loadCurrentPrices(db);
    expect(now["claude-opus-5-5"]).toEqual({
      inputPerMTok: 4,
      outputPerMTok: 20,
      cacheReadPerMTok: 0.2,
      cacheWritePerMTok: 5,
    });

    // A price change next year does not affect today's calculation.
    await db.insert(priceTables).values({
      model: "claude-opus-5-5",
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheReadPerMTok: 0.15,
      cacheWritePerMTok: 3.75,
      validFrom: new Date("2027-06-01T00:00:00Z"),
    });
    expect((await loadCurrentPrices(db))["claude-opus-5-5"]?.inputPerMTok).toBe(4);
    expect(
      (await loadCurrentPrices(db, new Date("2027-07-01T00:00:00Z")))["claude-opus-5-5"]
        ?.inputPerMTok,
    ).toBe(3);
  });
});

describe("exchange rate", () => {
  it("is set by the partner and visible to its tenants", async () => {
    expect((await getTenantAccess(db, fx.owner.id, fx.tenant.id))?.usdEurRate).toBeNull();
    await withPartner(db, fx.partner.id, (tx) =>
      updatePartnerExchangeRate(tx, { partnerId: fx.partner.id, usdEurRate: 0.9123456789 }),
    );
    expect((await getTenantAccess(db, fx.owner.id, fx.tenant.id))?.usdEurRate).toBe(0.912346);
    expect((await getPartnerAccess(db, fx.staff.id, fx.partner.id))?.usdEurRate).toBe(0.912346);
  });

  it("rejects implausible rates", async () => {
    await expect(
      withPartner(db, fx.partner.id, (tx) =>
        updatePartnerExchangeRate(tx, { partnerId: fx.partner.id, usdEurRate: 92 }),
      ),
    ).rejects.toThrow(/zwischen 0,1 und 10/);
  });
});
