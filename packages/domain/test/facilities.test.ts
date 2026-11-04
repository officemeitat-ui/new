import { eq, withTenant } from "@nexus/db";
import { defectReports } from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  countOpenReports,
  createDefectReportsTool,
  createFacility,
  findFacilityByToken,
  listDefectReports,
  listFacilities,
  setFacilityActive,
  submitDefectReport,
  updateDefectReport,
} from "../src/facilities";
import { applyRetention, updateRetention } from "../src/privacy";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let a: Awaited<ReturnType<typeof createPartnerWithTenant>>;
let b: Awaited<ReturnType<typeof createPartnerWithTenant>>;

beforeAll(async () => {
  a = await createPartnerWithTenant(db);
  b = await createPartnerWithTenant(db);
});
afterAll(() => handle.close());

describe("QR defect reports", () => {
  it("accepts a report through the facility's QR token and lets the team resolve it", async () => {
    const tenantId = a.tenant.id;
    const facility = await withTenant(db, tenantId, (tx) =>
      createFacility(tx, {
        tenantId,
        name: "Bürohaus Ring 12",
        contactEmail: "objekt@huber.example",
        actorId: a.owner.id,
      }),
    );
    expect(facility.publicToken).toMatch(/^[\w-]{24}$/);
    expect(await findFacilityByToken(db, "x".repeat(24))).toBeNull();

    const { report } = await submitDefectReport(db, {
      token: facility.publicToken,
      report: {
        category: "nachfuellen",
        location: "WC Damen 2. OG",
        description: "Seife leer",
        reporterEmail: "Gast@Example.at",
      },
    });
    expect(report).toMatchObject({ status: "open", reporterEmail: "gast@example.at", tenantId });
    await expect(
      submitDefectReport(db, {
        token: facility.publicToken,
        report: { category: "schaden", description: "x" },
      }),
    ).rejects.toThrow(/kurz/);

    expect(await withTenant(db, tenantId, (tx) => countOpenReports(tx, tenantId))).toBe(1);
    const [listed] = await withTenant(db, tenantId, (tx) => listDefectReports(tx, tenantId));
    expect(listed).toMatchObject({ facilityName: "Bürohaus Ring 12", hasReporterEmail: true });
    expect(listed).not.toHaveProperty("reporterEmail");
    // Another company sees nothing.
    expect(await withTenant(db, b.tenant.id, (tx) => listDefectReports(tx, b.tenant.id))).toEqual(
      [],
    );
    expect(await withTenant(db, b.tenant.id, (tx) => listFacilities(tx, b.tenant.id))).toEqual([]);

    const progress = await withTenant(db, tenantId, (tx) =>
      updateDefectReport(tx, {
        tenantId,
        reportId: report.id,
        status: "in_progress",
        actorId: a.owner.id,
      }),
    );
    expect(progress.notify).toBeNull();
    // The team's default list shows open and in-progress reports, but not done ones.
    const unresolved = () =>
      withTenant(db, tenantId, (tx) => listDefectReports(tx, tenantId, { status: "unresolved" }));
    expect(await unresolved()).toMatchObject([{ status: "in_progress" }]);
    const done = await withTenant(db, tenantId, (tx) =>
      updateDefectReport(tx, {
        tenantId,
        reportId: report.id,
        status: "done",
        note: "Seife aufgefüllt",
        actorId: a.owner.id,
      }),
    );
    expect(done.notify).toEqual({
      to: "gast@example.at",
      facilityName: "Bürohaus Ring 12",
      note: "Seife aufgefüllt",
    });
    // The e-mail was only needed for that message (data minimisation).
    const [stored] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(defectReports).where(eq(defectReports.id, report.id)),
    );
    expect(stored).toMatchObject({ status: "done", reporterEmail: null });
    expect(await unresolved()).toEqual([]);

    // Agents see the reports, but never the reporter's e-mail address.
    const tool = createDefectReportsTool({ db });
    const output = await tool.run(
      { status: "alle", tage: 30, objekt: "ring" },
      {
        tenantId,
        userId: a.owner.id,
        runId: "r",
        now: new Date(),
        signal: new AbortController().signal,
        idempotencyKey: "k",
      },
    );
    expect(output).toMatchObject({
      anzahl: 1,
      meldungen: [{ objekt: "Bürohaus Ring 12", status: "done" }],
    });
    expect(JSON.stringify(output)).not.toContain("gast@example.at");

    // A deactivated facility's QR code stops working.
    await withTenant(db, tenantId, (tx) =>
      setFacilityActive(tx, {
        tenantId,
        facilityId: facility.id,
        active: false,
        actorId: a.owner.id,
      }),
    );
    await expect(
      submitDefectReport(db, {
        token: facility.publicToken,
        report: { category: "sonstiges", description: "Licht kaputt" },
      }),
    ).rejects.toThrow(/nicht \(mehr\) gültig/);
  });

  it("deletes done reports after the conversation retention period", async () => {
    const tenantId = a.tenant.id;
    await withTenant(db, tenantId, async (tx) => {
      await updateRetention(tx, {
        tenantId,
        chatRetentionDays: 30,
        documentRetentionDays: null,
        actorId: a.owner.id,
      });
      await tx
        .update(defectReports)
        .set({ resolvedAt: new Date(Date.now() - 40 * 86_400_000) })
        .where(eq(defectReports.tenantId, tenantId));
    });
    await applyRetention(db);
    expect(await withTenant(db, tenantId, (tx) => listDefectReports(tx, tenantId))).toEqual([]);
  });
});
