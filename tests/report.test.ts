import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "bericht-")), "test.db")}`;

let report: typeof import("@/lib/report");
let db: typeof import("@/lib/db");
let calls: typeof import("@/lib/calls");
let leads: typeof import("@/lib/leads");
let emails: typeof import("@/lib/emails");
beforeAll(async () => {
  report = await import("@/lib/report");
  db = await import("@/lib/db");
  calls = await import("@/lib/calls");
  leads = await import("@/lib/leads");
  emails = await import("@/lib/emails");
});

describe("Monatsberechnung", () => {
  it("verschiebt Monate über Jahresgrenzen", () => {
    expect(report.shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(report.shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(report.lastCompletedMonth(new Date("2027-01-01T10:00:00Z"))).toBe("2026-12");
  });

  it("rechnet Monatsgrenzen in Wiener Zeit, auch bei Zeitumstellung", () => {
    expect(report.monthRange("2026-11").from.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(report.monthRange("2026-10").from.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(report.monthRange("2026-10").to.toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });

  it("beschreibt Veränderungen verständlich", () => {
    expect(report.change(12, 10)).toBe("+20 %");
    expect(report.change(9, 10)).toBe("−10 %");
    expect(report.change(5, 0)).toBe("neu");
    expect(report.change(0, 0)).toBe("±0 %");
    expect(report.monthLabel("2026-11")).toBe("November 2026");
    expect(report.isMonth("2026-13")).toBe(false);
  });
});

describe("monthlyReport", () => {
  it("zählt den Monat und vergleicht mit dem Vormonat", async () => {
    const month = report.currentMonth();
    const previous = report.monthRange(report.shiftMonth(month, -1)).from;
    const lead = await leads.createLead({ funnel: "telefon", stage: "neu", name: "Test", phone: "0664 1" }, "angelegt");

    // laufender Monat: 2 Anrufe (5 Min.), 1 Rückruf, 1 E-Mail gesendet
    for (const id of ["a", "b"]) {
      await calls.saveCall({
        id,
        leadId: lead.id,
        phone: null,
        startedAt: null,
        endedAt: null,
        durationSeconds: 150,
        endedReason: null,
        summary: null,
        transcript: null,
        recordingUrl: null,
        cost: null,
      });
    }
    await leads.addActivity(lead.id, "callback", "Rückrufwunsch: Test");
    const mail = await emails.insertEmail({
      messageId: "<r1@x>",
      fromAddress: "a@b.at",
      fromName: null,
      subject: "S",
      body: "B",
      receivedAt: new Date(),
    });
    await emails.updateEmail(mail!.id, { status: "gesendet", category: "terminanfrage" });

    // Vormonat: 1 Anruf
    const client = await db.db();
    await client.execute({
      sql: "INSERT INTO calls (id, created_at) VALUES ('alt', ?)",
      args: [new Date(previous.getTime() + 86_400_000).toISOString()],
    });

    const result = await report.monthlyReport(month);
    expect(result.current).toMatchObject({ calls: 2, callMinutes: 5, callbacks: 1, emailsHandled: 1, repliesSent: 1 });
    expect(result.previous.calls).toBe(1);
    expect(result.emailsByCategory).toEqual([{ label: "Terminanfrage", count: 1 }]);

    const text = report.reportText(result, "https://cockpit.example.at/admin/bericht");
    expect(text).toContain("2 Anrufe angenommen (Vormonat 1, +100 %)");
    expect(text).toContain("1 Rückrufwunsch für Sie notiert");
    expect(text).toContain("1 E-Mail bearbeitet, 1 Antwort gesendet");
    expect(text).toContain("• Terminanfrage: 1");
    expect(text).toContain("Details im Cockpit: https://cockpit.example.at/admin/bericht");
  });
});
