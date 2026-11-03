import { uuidv7 } from "@nexus/core";
import type { Database } from "../src/client";
import { withSystem } from "../src/context";
import { authUser, memberships, partnerMemberships, partners, tenants } from "../src/schema";

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

/**
 * Two partners, each with one tenant, plus users:
 *   alice – owner of tenant A (partner 1)
 *   bob   – owner of tenant B (partner 2)
 *   carol – member of both tenants
 *   paul  – staff of partner 1
 */
export async function createFixture(db: Database) {
  const tag = uuidv7().slice(-8);
  return withSystem(db, "test fixture setup", async (tx) => {
    const [p1, p2] = await tx
      .insert(partners)
      .values([
        { name: "Partner Eins", slug: `p1-${tag}` },
        { name: "Partner Zwei", slug: `p2-${tag}` },
      ])
      .returning();
    const [tenantA, tenantB] = await tx
      .insert(tenants)
      .values([
        { partnerId: p1!.id, name: "Tenant A", slug: `a-${tag}` },
        { partnerId: p2!.id, name: "Tenant B", slug: `b-${tag}` },
      ])
      .returning();
    const [alice, bob, carol, paul] = await tx
      .insert(authUser)
      .values(
        ["alice", "bob", "carol", "paul"].map((name) => ({
          name,
          email: `${name}-${tag}@example.test`,
        })),
      )
      .returning();
    await tx.insert(memberships).values([
      { tenantId: tenantA!.id, userId: alice!.id, role: "owner" },
      { tenantId: tenantB!.id, userId: bob!.id, role: "owner" },
      { tenantId: tenantA!.id, userId: carol!.id, role: "member" },
      { tenantId: tenantB!.id, userId: carol!.id, role: "member" },
    ]);
    await tx
      .insert(partnerMemberships)
      .values({ partnerId: p1!.id, userId: paul!.id, role: "partner_admin" });

    return {
      partner1: p1!,
      partner2: p2!,
      tenantA: tenantA!,
      tenantB: tenantB!,
      alice: alice!,
      bob: bob!,
      carol: carol!,
      paul: paul!,
    };
  });
}
