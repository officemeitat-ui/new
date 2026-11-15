import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { zonedToUtc } from "@/lib/calendar";

// Eigene, leere Datenbank für diese Testdatei
process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "termine-")), "test.db")}`;

let appointments: typeof import("@/lib/appointments");
beforeAll(async () => {
  appointments = await import("@/lib/appointments");
});

// Montag, 16.11.2026, früh morgens – Vorführbetrieb: Kapazität 2, Pickerl dauert 60 Minuten
const now = zonedToUtc("2026-11-16", "06:00", "Europe/Vienna");
const at = (time: string) => zonedToUtc("2026-11-16", time, "Europe/Vienna");

describe("bookAppointment", () => {
  it("bucht bis zur Kapazität und lehnt dann ab", async () => {
    const request = { serviceId: "pickerl", start: at("09:00"), name: "Test", phone: "0664 1234567", source: "telefon" as const };
    const first = await appointments.bookAppointment(request, now);
    const second = await appointments.bookAppointment({ ...request, name: "Test 2" }, now);
    const third = await appointments.bookAppointment({ ...request, name: "Test 3" }, now);
    expect(first.ok && second.ok).toBe(true);
    expect(third).toEqual({ ok: false, reason: "nicht_verfuegbar" });
    if (first.ok) {
      expect(first.appointment.phone).toBe("+436641234567");
      expect(first.appointment.end.getTime() - first.appointment.start.getTime()).toBe(60 * 60_000);
    }
  });

  it("lehnt parallele Buchungen über die Kapazität hinaus ab", async () => {
    const request = { serviceId: "reifen", start: at("13:00"), name: "Parallel", source: "telefon" as const };
    const results = await Promise.all([1, 2, 3, 4].map(() => appointments.bookAppointment(request, now)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
  });

  it("lehnt unbekannte Leistungen, Zeiten außerhalb des Rasters und geschlossene Zeiten ab", async () => {
    expect(await appointments.bookAppointment({ serviceId: "xyz", start: at("10:00"), name: "X", source: "manuell" }, now)).toEqual({
      ok: false,
      reason: "unbekannte_leistung",
    });
    for (const time of ["10:15", "12:00", "16:30"]) {
      const result = await appointments.bookAppointment({ serviceId: "pickerl", start: at(time), name: "X", source: "manuell" }, now);
      expect(result.ok, time).toBe(false);
    }
  });

  it("gibt stornierte Termine wieder frei", async () => {
    const list = await appointments.listAppointments(at("00:00"), at("23:59"));
    const nine = list.filter((a) => a.start.getTime() === at("09:00").getTime());
    await appointments.cancelAppointment(nine[0].id);
    const again = await appointments.bookAppointment({ serviceId: "pickerl", start: at("09:00"), name: "Neu", source: "manuell" }, now);
    expect(again.ok).toBe(true);
  });
});
