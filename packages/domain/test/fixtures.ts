import { uuidv7 } from "@nexus/core";
import { withSystem, type Database } from "@nexus/db";
import { authUser, memberships, partnerMemberships, partners, tenants } from "@nexus/db/schema";

export async function createUser(db: Database, name: string) {
  const [user] = await withSystem(db, "test: create user", (tx) =>
    tx
      .insert(authUser)
      .values({ name, email: `${name.toLowerCase()}-${uuidv7().slice(-8)}@example.test` })
      .returning(),
  );
  return user!;
}

export async function createPartnerWithTenant(db: Database) {
  const tag = uuidv7().slice(-8);
  const owner = await createUser(db, "Owner");
  const staff = await createUser(db, "Staff");
  return withSystem(db, "test: partner fixture", async (tx) => {
    const [partner] = await tx
      .insert(partners)
      .values({ name: `Partner ${tag}`, slug: `partner-${tag}` })
      .returning();
    const [tenant] = await tx
      .insert(tenants)
      .values({ partnerId: partner!.id, name: `Kunde ${tag}`, slug: `kunde-${tag}` })
      .returning();
    await tx.insert(memberships).values({ tenantId: tenant!.id, userId: owner.id, role: "owner" });
    await tx
      .insert(partnerMemberships)
      .values({ partnerId: partner!.id, userId: staff.id, role: "partner_admin" });
    return { partner: partner!, tenant: tenant!, owner, staff };
  });
}
