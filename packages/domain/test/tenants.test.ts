import { eq, withSystem, withTenant } from "@nexus/db";
import { openTestDatabase } from "@nexus/db/testing";
import { tenants } from "@nexus/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertCanAssignRole,
  getPartnerAccess,
  getTenantAccess,
  requirePermission,
} from "../src/access";
import { verifyAuditChain } from "../src/audit";
import { findInvitationByToken } from "../src/invitations";
import { changeMemberRole, listMembers, removeMember } from "../src/members";
import { listPartnerTenants, provisionTenant, slugify } from "../src/tenants";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let fx: Awaited<ReturnType<typeof createPartnerWithTenant>>;

beforeAll(async () => {
  fx = await createPartnerWithTenant(db);
});
afterAll(() => handle.close());

describe("slugify", () => {
  it("handles German names", () => {
    expect(slugify("Müller & Söhne Großhandel GmbH")).toBe("mueller-soehne-grosshandel-gmbh");
    expect(slugify("  !!! ")).toBe("mandant");
  });
});

describe("provisionTenant", () => {
  it("creates the tenant, invites the owner and starts the audit chain", async () => {
    const { tenant, invitation } = await provisionTenant(db, {
      partnerId: fx.partner.id,
      actorUserId: fx.staff.id,
      name: "Huber Haustechnik GmbH",
      plan: "business",
      ownerEmail: "chefin@huber.example",
    });
    expect(tenant.slug).toMatch(/^huber-haustechnik-gmbh/);
    expect(tenant.plan).toBe("business");
    const view = await findInvitationByToken(db, invitation.token);
    expect(view).toMatchObject({ email: "chefin@huber.example", role: "owner", status: "valid" });

    const chain = await withTenant(db, tenant.id, (tx) => verifyAuditChain(tx, tenant.id));
    expect(chain).toEqual({ valid: true, count: 2 });

    const list = await listPartnerTenants(db, fx.partner.id);
    expect(list.find((t) => t.id === tenant.id)?.ownerInvitationPending).toBe(true);
  });

  it("finds a free slug when the name is taken by another partner", async () => {
    const other = await createPartnerWithTenant(db);
    const first = await provisionTenant(db, {
      partnerId: other.partner.id,
      actorUserId: other.staff.id,
      name: "Gleicher Name KG",
      plan: "starter",
      ownerEmail: "a@example.test",
    });
    const second = await provisionTenant(db, {
      partnerId: fx.partner.id,
      actorUserId: fx.staff.id,
      name: "Gleicher Name KG",
      plan: "starter",
      ownerEmail: "b@example.test",
    });
    expect(first.tenant.slug).toBe("gleicher-name-kg");
    expect(second.tenant.slug).toMatch(/^gleicher-name-kg-[a-z0-9]{1,4}$/);
  });
});

describe("access and members", () => {
  it("resolves permissions and enforces them", async () => {
    const access = await getTenantAccess(db, fx.owner.id, fx.tenant.id);
    expect(access?.role).toBe("owner");
    expect(() => requirePermission(access!, "tenant.billing.manage")).not.toThrow();

    const partnerAccess = await getPartnerAccess(db, fx.staff.id, fx.partner.id);
    expect(partnerAccess?.permissions).toContain("partner.tenants.manage");
    expect(await getPartnerAccess(db, fx.owner.id, fx.partner.id)).toBeNull();
    expect(await getTenantAccess(db, fx.staff.id, fx.tenant.id)).toBeNull();
  });

  it("reserves the owner role for owners", () => {
    expect(() => assertCanAssignRole("admin", { to: "owner" })).toThrow(/Nur Owner/);
    expect(() => assertCanAssignRole("admin", { from: "owner", to: "member" })).toThrow(
      /Nur Owner/,
    );
    expect(() => assertCanAssignRole("admin", { from: "member", to: "admin" })).not.toThrow();
    expect(() => assertCanAssignRole("owner", { to: "owner" })).not.toThrow();
  });

  it("denies access to suspended tenants", async () => {
    const other = await createPartnerWithTenant(db);
    await withSystem(db, "test: suspend tenant", (tx) =>
      tx.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, other.tenant.id)),
    );
    expect(await getTenantAccess(db, other.owner.id, other.tenant.id)).toBeNull();
  });

  it("never leaves a tenant without an owner", async () => {
    const [owner] = await withTenant(db, fx.tenant.id, (tx) => listMembers(tx, fx.tenant.id));
    await expect(
      withTenant(db, fx.tenant.id, (tx) =>
        removeMember(tx, {
          tenantId: fx.tenant.id,
          membershipId: owner!.membershipId,
          actorId: fx.owner.id,
        }),
      ),
    ).rejects.toThrow(/letzte Owner/);
    await expect(
      withTenant(db, fx.tenant.id, (tx) =>
        changeMemberRole(tx, {
          tenantId: fx.tenant.id,
          membershipId: owner!.membershipId,
          role: "member",
          actorId: fx.owner.id,
        }),
      ),
    ).rejects.toThrow(/mindestens einen Owner/);
  });
});
