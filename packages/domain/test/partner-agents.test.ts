import { eq, withPartner, withSystem, withTenant } from "@nexus/db";
import { partnerAgentTemplates, tenants } from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAgentDetail, listAgents, saveAgentVersion, setAgentStatus } from "../src/agents";
import { listAuditEntries } from "../src/audit";
import {
  createAgentPackage,
  listAgentPackages,
  rolloutAgentPackage,
  updateAgentPackage,
} from "../src/partner-agents";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let fx: Awaited<ReturnType<typeof createPartnerWithTenant>>;
let other: Awaited<ReturnType<typeof createPartnerWithTenant>>;
let second: { id: string; name: string };

beforeAll(async () => {
  fx = await createPartnerWithTenant(db);
  other = await createPartnerWithTenant(db);
  const [tenant] = await withSystem(db, "test: second tenant of the partner", (tx) =>
    tx
      .insert(tenants)
      .values({
        partnerId: fx.partner.id,
        name: "Gruber Reinigung GmbH",
        slug: `gruber-${fx.partner.slug}`,
      })
      .returning(),
  );
  second = tenant!;
});
afterAll(() => handle.close());

describe("agent packages", () => {
  it("rolls one agent out to several tenants and updates the ones that did not adapt it", async () => {
    const pkg = await createAgentPackage(db, {
      partnerId: fx.partner.id,
      baseTemplateId: "angebote",
      actorId: fx.staff.id,
    });
    expect(pkg).toMatchObject({ name: "Angebots-Assistent", version: 1 });
    expect(pkg.config.instructions).toContain("{{firma.name}}");

    // Another partner neither sees the package nor can roll it out.
    expect(await listAgentPackages(db, other.partner.id)).toEqual([]);
    await expect(
      rolloutAgentPackage(db, {
        partnerId: other.partner.id,
        packageId: pkg.id,
        tenantIds: [other.tenant.id],
        actorId: other.staff.id,
      }),
    ).rejects.toThrow(/nicht gefunden/);

    const first = await rolloutAgentPackage(db, {
      partnerId: fx.partner.id,
      packageId: pkg.id,
      tenantIds: [fx.tenant.id, second.id, other.tenant.id],
      actorId: fx.staff.id,
    });
    expect(first.map((r) => r.outcome)).toEqual(["created", "created", "unavailable"]);
    // The other partner's tenant got nothing.
    expect(await withTenant(db, other.tenant.id, (tx) => listAgents(tx, other.tenant.id))).toEqual(
      [],
    );

    const [mine] = await withTenant(db, fx.tenant.id, (tx) => listAgents(tx, fx.tenant.id));
    expect(mine).toMatchObject({ name: "Angebots-Assistent", version: 1 });
    expect(mine!.config.instructions).toContain(fx.tenant.name);
    expect(mine!.config.instructions).not.toContain("{{firma.name}}");
    const audit = await withTenant(db, fx.tenant.id, (tx) => listAuditEntries(tx, fx.tenant.id, 5));
    expect(audit.map((e) => e.action)).toContain("agent.rolled_out");

    // Rolling out again changes nothing.
    const again = await rolloutAgentPackage(db, {
      partnerId: fx.partner.id,
      packageId: pkg.id,
      tenantIds: [fx.tenant.id],
      actorId: fx.staff.id,
    });
    expect(again[0]!.outcome).toBe("current");

    // The first tenant adapts its agent; the partner improves the package.
    await withTenant(db, fx.tenant.id, (tx) =>
      saveAgentVersion(tx, {
        tenantId: fx.tenant.id,
        agentId: mine!.id,
        name: mine!.name,
        description: mine!.description,
        config: { ...mine!.config, instructions: `${mine!.config.instructions}\nRabatt: 3 %.` },
        actorId: fx.owner.id,
      }),
    );
    const { package: v2, changed } = await updateAgentPackage(db, {
      partnerId: fx.partner.id,
      packageId: pkg.id,
      name: "Angebots-Assistent",
      description: pkg.description,
      instructions: `${pkg.config.instructions}\nNennen Sie immer die Gültigkeit des Angebots.`,
    });
    expect(changed).toBe(true);
    expect(v2.version).toBe(2);

    const update = await rolloutAgentPackage(db, {
      partnerId: fx.partner.id,
      packageId: pkg.id,
      tenantIds: [fx.tenant.id, second.id],
      actorId: fx.staff.id,
    });
    expect(update.map((r) => r.outcome)).toEqual(["adapted", "updated"]);

    // The adapted agent keeps the tenant's version; the other one got the improvement.
    const [kept] = await withTenant(db, fx.tenant.id, (tx) => listAgents(tx, fx.tenant.id));
    expect(kept!.config.instructions).toContain("Rabatt: 3 %.");
    expect(kept!.config.instructions).not.toContain("Gültigkeit des Angebots");
    const [updated] = await withTenant(db, second.id, (tx) => listAgents(tx, second.id));
    expect(updated).toMatchObject({ version: 2 });
    expect(updated!.config.instructions).toContain("Gültigkeit des Angebots");
    expect(updated!.config.instructions).toContain("Gruber Reinigung GmbH");
    const detail = await withTenant(db, second.id, (tx) =>
      getAgentDetail(tx, second.id, updated!.id),
    );
    expect(detail.versions).toHaveLength(2);

    // The partner sees the state per tenant, nothing of the content.
    const [listed] = await listAgentPackages(db, fx.partner.id);
    expect(listed!.rollouts).toEqual(
      expect.arrayContaining([
        { tenantId: fx.tenant.id, version: 1, adapted: true, archived: false },
        { tenantId: second.id, version: 2, adapted: false, archived: false },
      ]),
    );
    expect(JSON.stringify(listed!.rollouts)).not.toContain("Rabatt");

    // An archived agent stays archived.
    await withTenant(db, second.id, (tx) =>
      setAgentStatus(tx, {
        tenantId: second.id,
        agentId: updated!.id,
        status: "archived",
        actorId: fx.owner.id,
      }),
    );
    await updateAgentPackage(db, {
      partnerId: fx.partner.id,
      packageId: pkg.id,
      name: "Angebots-Assistent",
      description: pkg.description,
      instructions: `${v2.config.instructions}\nVersion drei.`,
    });
    const archived = await rolloutAgentPackage(db, {
      partnerId: fx.partner.id,
      packageId: pkg.id,
      tenantIds: [second.id],
      actorId: fx.staff.id,
    });
    expect(archived[0]!.outcome).toBe("archived");
  });

  it("keeps packages to their partner and checks the instructions", async () => {
    const pkg = await createAgentPackage(db, {
      partnerId: fx.partner.id,
      baseTemplateId: "angebote",
      actorId: fx.staff.id,
    });
    await expect(
      updateAgentPackage(db, {
        partnerId: fx.partner.id,
        packageId: pkg.id,
        name: "A",
        description: null,
        instructions: pkg.config.instructions,
      }),
    ).rejects.toThrow(/2 bis 80/);
    await expect(
      updateAgentPackage(db, {
        partnerId: fx.partner.id,
        packageId: pkg.id,
        name: "Angebote",
        description: null,
        instructions: "zu kurz",
      }),
    ).rejects.toThrow(/zu kurz/);
    const unchanged = await updateAgentPackage(db, {
      partnerId: fx.partner.id,
      packageId: pkg.id,
      name: "Angebote kurz",
      description: null,
      // As a browser form sends it.
      instructions: pkg.config.instructions.replaceAll("\n", "\r\n"),
    });
    expect(unchanged).toMatchObject({ changed: false, package: { version: 1 } });
    // Row Level Security: another partner's context sees no package rows at all.
    const rows = await withPartner(db, other.partner.id, (tx) =>
      tx.select().from(partnerAgentTemplates).where(eq(partnerAgentTemplates.id, pkg.id)),
    );
    expect(rows).toEqual([]);
  });
});
