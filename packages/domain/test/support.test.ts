import { SUPPORT_PERMISSIONS } from "@nexus/core";
import { withSystem, withTenant } from "@nexus/db";
import { supportAccessGrants } from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appendAudit,
  listAuditEntries,
  verifyAuditChain,
  withAuditRequestContext,
} from "../src/audit";
import {
  getSupportAccess,
  grantSupportAccess,
  listActiveSupportGrants,
  recordSupportSession,
  revokeSupportAccess,
  signSupportCookie,
  verifySupportCookie,
} from "../src/support";
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

describe("support access", () => {
  it("exists only while the tenant grants it, and only for its own partner", async () => {
    const ids = { userId: fx.staff.id, partnerId: fx.partner.id, tenantId: fx.tenant.id };
    expect(await getSupportAccess(db, ids)).toBeNull();
    await expect(recordSupportSession(db, { ...ids, event: "started" })).rejects.toThrow(
      /kein Support-Zugriff/,
    );

    const grant = await withTenant(db, fx.tenant.id, (tx) =>
      grantSupportAccess(tx, {
        tenantId: fx.tenant.id,
        grantedBy: fx.owner.id,
        hours: 4,
        reason: "Agent einrichten",
      }),
    );
    const access = await getSupportAccess(db, ids);
    expect(access?.permissions).toEqual(SUPPORT_PERMISSIONS);
    expect(access?.permissions).not.toContain("tenant.members.manage");
    expect(access?.support?.expiresAt.getTime()).toBe(grant.expiresAt.getTime());
    expect((await listActiveSupportGrants(db, fx.partner.id)).map((g) => g.tenantId)).toEqual([
      fx.tenant.id,
    ]);

    // Another partner cannot use the grant.
    expect(
      await getSupportAccess(db, { ...ids, userId: other.staff.id, partnerId: other.partner.id }),
    ).toBeNull();

    await recordSupportSession(db, { ...ids, event: "started" });
    await withTenant(db, fx.tenant.id, (tx) =>
      revokeSupportAccess(tx, { tenantId: fx.tenant.id, grantId: grant.id, actorId: fx.owner.id }),
    );
    expect(await getSupportAccess(db, ids)).toBeNull();

    const entries = await withTenant(db, fx.tenant.id, (tx) => listAuditEntries(tx, fx.tenant.id));
    expect(entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(["support.granted", "support.session_started", "support.revoked"]),
    );
    expect(entries.find((e) => e.action === "support.session_started")?.actorType).toBe("partner");
    expect(
      await withTenant(db, fx.tenant.id, (tx) => verifyAuditChain(tx, fx.tenant.id)),
    ).toMatchObject({ valid: true });
  });

  it("ends by itself when the grant expires", async () => {
    await withSystem(db, "test: expired grant", (tx) =>
      tx.insert(supportAccessGrants).values({
        tenantId: other.tenant.id,
        partnerId: other.partner.id,
        reason: "abgelaufen",
        expiresAt: new Date(Date.now() - 1000),
      }),
    );
    expect(
      await getSupportAccess(db, {
        userId: other.staff.id,
        partnerId: other.partner.id,
        tenantId: other.tenant.id,
      }),
    ).toBeNull();
  });

  it("only accepts a support cookie for this person, this grant and before it expires", async () => {
    const tag = { tenantId: fx.tenant.id, grantId: "0199a1b2-0000-7000-8000-000000000001" };
    const expiresAt = new Date(Date.now() + 3_600_000);
    const value = signSupportCookie(fx.staff.id, { ...tag, expiresAt });
    expect(verifySupportCookie(value, fx.staff.id)).toEqual(tag);
    // A hand-made cookie, another person's cookie or a tampered value opens nothing.
    expect(verifySupportCookie(fx.tenant.id, fx.staff.id)).toBeNull();
    expect(verifySupportCookie(value, fx.owner.id)).toBeNull();
    const parts = value.split(".");
    expect(
      verifySupportCookie([other.tenant.id, ...parts.slice(1)].join("."), fx.staff.id),
    ).toBeNull();
    const later = String(Number(parts[2]) + 86_400);
    expect(
      verifySupportCookie([parts[0], parts[1], later, parts[3]].join("."), fx.staff.id),
    ).toBeNull();
    expect(verifySupportCookie(`${value}.x`, fx.staff.id)).toBeNull();
    expect(verifySupportCookie(undefined, fx.staff.id)).toBeNull();
    // Expired.
    expect(
      verifySupportCookie(value, fx.staff.id, new Date(expiresAt.getTime() + 1000)),
    ).toBeNull();
  });

  it("ends a session when its grant is replaced, even if the cookie is kept", async () => {
    const ids = { userId: fx.staff.id, partnerId: fx.partner.id, tenantId: fx.tenant.id };
    await withTenant(db, fx.tenant.id, (tx) =>
      grantSupportAccess(tx, {
        tenantId: fx.tenant.id,
        grantedBy: fx.owner.id,
        hours: 1,
        reason: "Test A",
      }),
    );
    const first = await recordSupportSession(db, { ...ids, event: "started" });
    expect(await getSupportAccess(db, { ...ids, grantId: first!.grantId })).not.toBeNull();
    // A new grant replaces the old one: the old session (cookie) no longer opens anything.
    await withTenant(db, fx.tenant.id, (tx) =>
      grantSupportAccess(tx, {
        tenantId: fx.tenant.id,
        grantedBy: fx.owner.id,
        hours: 1,
        reason: "Test B",
      }),
    );
    expect(await getSupportAccess(db, { ...ids, grantId: first!.grantId })).toBeNull();
  });

  it("rejects durations outside the offered options", async () => {
    await expect(
      withTenant(db, fx.tenant.id, (tx) =>
        grantSupportAccess(tx, {
          tenantId: fx.tenant.id,
          grantedBy: fx.owner.id,
          hours: 999,
          reason: "zu lange",
        }),
      ),
    ).rejects.toThrow(/Ungültige Dauer/);
  });
});

describe("audit request context", () => {
  it("records IP address and user agent of the request", async () => {
    const entry = await withAuditRequestContext(
      { ip: "203.0.113.7", userAgent: "Mozilla/5.0 Test" },
      () =>
        withTenant(db, fx.tenant.id, (tx) =>
          appendAudit(tx, fx.tenant.id, { actorType: "user", action: "test.meta" }),
        ),
    );
    expect(entry.ip).toBe("203.0.113.7");
    expect(entry.userAgent).toBe("Mozilla/5.0 Test");
  });
});
