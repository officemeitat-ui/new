import { withTenant } from "@nexus/db";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTenantAccess, getUserOverview } from "../src/access";
import {
  acceptInvitation,
  createInvitation,
  findInvitationByToken,
  hasPendingInvitation,
  listPendingInvitations,
  revokeInvitation,
} from "../src/invitations";
import { createPartnerWithTenant, createUser } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let fx: Awaited<ReturnType<typeof createPartnerWithTenant>>;

beforeAll(async () => {
  fx = await createPartnerWithTenant(db);
});
afterAll(() => handle.close());

describe("invitations", () => {
  it("lets the invited person join – and only them", async () => {
    const invitee = await createUser(db, "Ida");
    const { token } = await withTenant(db, fx.tenant.id, (tx) =>
      createInvitation(tx, {
        tenantId: fx.tenant.id,
        email: invitee.email.toUpperCase(),
        role: "admin",
        invitedBy: fx.owner.id,
      }),
    );

    expect(await hasPendingInvitation(db, invitee.email)).toBe(true);
    expect((await findInvitationByToken(db, token))?.status).toBe("valid");

    const stranger = await createUser(db, "Fremd");
    await expect(
      acceptInvitation(db, { token, userId: stranger.id, userEmail: stranger.email }),
    ).rejects.toThrow(/andere E-Mail-Adresse/);

    const { tenantId } = await acceptInvitation(db, {
      token,
      userId: invitee.id,
      userEmail: invitee.email,
    });
    expect(tenantId).toBe(fx.tenant.id);

    const access = await getTenantAccess(db, invitee.id, fx.tenant.id);
    expect(access?.role).toBe("admin");
    expect(access?.permissions).toContain("agent.edit");
    expect((await getUserOverview(db, invitee.id)).tenants.map((t) => t.tenantId)).toEqual([
      fx.tenant.id,
    ]);

    expect((await findInvitationByToken(db, token))?.status).toBe("accepted");
    expect(await hasPendingInvitation(db, invitee.email)).toBe(false);
    await expect(
      acceptInvitation(db, { token, userId: invitee.id, userEmail: invitee.email }),
    ).rejects.toThrow(/nicht mehr gültig/);
  });

  it("does not reveal anything for unknown tokens", async () => {
    expect(await findInvitationByToken(db, "x".repeat(43))).toBeNull();
    expect(await findInvitationByToken(db, "short")).toBeNull();
  });

  it("replaces an older pending invitation for the same address", async () => {
    const email = "doppelt@example.test";
    const first = await withTenant(db, fx.tenant.id, (tx) =>
      createInvitation(tx, {
        tenantId: fx.tenant.id,
        email,
        role: "member",
        invitedBy: fx.owner.id,
      }),
    );
    await withTenant(db, fx.tenant.id, (tx) =>
      createInvitation(tx, {
        tenantId: fx.tenant.id,
        email,
        role: "admin",
        invitedBy: fx.owner.id,
      }),
    );
    expect((await findInvitationByToken(db, first.token))?.status).toBe("revoked");
    const pending = await withTenant(db, fx.tenant.id, (tx) =>
      listPendingInvitations(tx, fx.tenant.id),
    );
    expect(pending.filter((p) => p.email === email).map((p) => p.role)).toEqual(["admin"]);
  });

  it("can be revoked", async () => {
    const { token, invitationId } = await withTenant(db, fx.tenant.id, (tx) =>
      createInvitation(tx, {
        tenantId: fx.tenant.id,
        email: "weg@example.test",
        role: "member",
        invitedBy: fx.owner.id,
      }),
    );
    await withTenant(db, fx.tenant.id, (tx) =>
      revokeInvitation(tx, { tenantId: fx.tenant.id, invitationId, actorId: fx.owner.id }),
    );
    expect((await findInvitationByToken(db, token))?.status).toBe("revoked");
  });

  it("rejects malformed addresses", async () => {
    await expect(
      withTenant(db, fx.tenant.id, (tx) =>
        createInvitation(tx, {
          tenantId: fx.tenant.id,
          email: "kein-mail",
          role: "member",
          invitedBy: null,
        }),
      ),
    ).rejects.toThrow(/Ungültige E-Mail/);
  });
});
