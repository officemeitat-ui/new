import { eq, withTenant } from "@nexus/db";
import { runs, usageEvents } from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentFromTemplate } from "../src/agents";
import { startRun } from "../src/chat";
import { getDashboard, updateTenantGeneral } from "../src/dashboard";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let fx: Awaited<ReturnType<typeof createPartnerWithTenant>>;

beforeAll(async () => {
  fx = await createPartnerWithTenant(db);
});
afterAll(() => handle.close());

describe("dashboard", () => {
  it("is empty for a new tenant", async () => {
    const dashboard = await withTenant(db, fx.tenant.id, (tx) => getDashboard(tx, fx.tenant.id));
    expect(dashboard).toMatchObject({
      runsToday: 0,
      openApprovals: 0,
      savedMinutesWeek: 0,
      costUsdMicrosMonth: 0,
    });
    expect(dashboard.runsLast7Days).toHaveLength(7);
  });

  it("counts runs, approvals, time saved and costs", async () => {
    const tenantId = fx.tenant.id;
    const offers = await withTenant(db, tenantId, (tx) =>
      createAgentFromTemplate(tx, {
        tenantId,
        templateId: "angebote",
        tenantName: "Huber",
        actorId: fx.owner.id,
      }),
    );
    // Two completed quote runs (25 min each), one waiting for approval.
    for (const status of ["completed", "completed", "awaiting_approval"] as const) {
      const { runId } = await withTenant(db, tenantId, (tx) =>
        startRun(tx, {
          tenantId,
          userId: fx.owner.id,
          userName: "O",
          text: `Angebot ${status}`,
          agentId: offers.id,
        }),
      );
      await withTenant(db, tenantId, async (tx) => {
        await tx.update(runs).set({ status, costUsdMicros: 20_000 }).where(eq(runs.id, runId));
        await tx.insert(usageEvents).values({
          tenantId,
          runId,
          agentId: offers.id,
          model: "claude-opus-5-5",
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsdMicros: 20_000,
        });
      });
    }
    const dashboard = await withTenant(db, tenantId, (tx) => getDashboard(tx, tenantId));
    expect(dashboard.runsToday).toBe(3);
    expect(dashboard.completedToday).toBe(2);
    expect(dashboard.openApprovals).toBe(1);
    expect(dashboard.savedMinutesWeek).toBe(50);
    expect(dashboard.costUsdMicrosMonth).toBe(60_000);
    expect(dashboard.runsLast7Days.at(-1)?.runs).toBe(3);
    expect(dashboard.recentRuns[0]?.agentName).toBe("Angebots-Assistent");
  });

  it("stores the hourly rate used for savings", async () => {
    await withTenant(db, fx.tenant.id, (tx) =>
      updateTenantGeneral(tx, {
        tenantId: fx.tenant.id,
        name: "Huber GmbH",
        hourlyRateCents: 6200,
        actorId: fx.owner.id,
      }),
    );
    const dashboard = await withTenant(db, fx.tenant.id, (tx) => getDashboard(tx, fx.tenant.id));
    expect(dashboard.hourlyRateCents).toBe(6200);
    await expect(
      withTenant(db, fx.tenant.id, (tx) =>
        updateTenantGeneral(tx, {
          tenantId: fx.tenant.id,
          name: "Huber GmbH",
          hourlyRateCents: 5,
          actorId: fx.owner.id,
        }),
      ),
    ).rejects.toThrow(/Stundensatz/);
  });
});
