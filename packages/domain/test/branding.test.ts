import { withTenant } from "@nexus/db";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTenantAccess } from "../src/access";
import { listAuditEntries } from "../src/audit";
import { normalizeHexColor, updateTenantBranding } from "../src/branding";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let fx: Awaited<ReturnType<typeof createPartnerWithTenant>>;

beforeAll(async () => {
  fx = await createPartnerWithTenant(db);
});
afterAll(() => handle.close());

describe("tenant branding", () => {
  it("inherits the partner colour until the tenant sets its own", async () => {
    const before = await getTenantAccess(db, fx.owner.id, fx.tenant.id);
    expect(before?.branding).toEqual({
      productName: "ME-IT Nexus",
      primaryColor: "#2454d6",
      tenantColor: null,
      partnerColor: "#2454d6",
    });

    await withTenant(db, fx.tenant.id, (tx) =>
      updateTenantBranding(tx, {
        tenantId: fx.tenant.id,
        brandColor: "#E30613",
        actorId: fx.owner.id,
      }),
    );
    const after = await getTenantAccess(db, fx.owner.id, fx.tenant.id);
    expect(after?.branding.primaryColor).toBe("#e30613");

    await withTenant(db, fx.tenant.id, (tx) =>
      updateTenantBranding(tx, { tenantId: fx.tenant.id, brandColor: null, actorId: fx.owner.id }),
    );
    expect((await getTenantAccess(db, fx.owner.id, fx.tenant.id))?.branding.primaryColor).toBe(
      "#2454d6",
    );

    const entries = await withTenant(db, fx.tenant.id, (tx) => listAuditEntries(tx, fx.tenant.id));
    expect(entries.filter((e) => e.action === "tenant.branding_changed")).toHaveLength(2);
  });

  it("rejects anything that is not a hex colour", () => {
    expect(() => normalizeHexColor("red")).toThrow(/#RRGGBB/);
    expect(() => normalizeHexColor("#12345")).toThrow();
    expect(() => normalizeHexColor("#123456; background:url(x)")).toThrow();
    expect(normalizeHexColor(" #AbCdEf ")).toBe("#abcdef");
  });
});
