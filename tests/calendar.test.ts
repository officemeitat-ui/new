import { describe, expect, it } from "vitest";
import { business, type BusinessProfile } from "@/config/business";
import { addDays, formatSlot, isBookable, localDate, localTime, slotsForDay, suggestSlots, weekdayOf, zonedToUtc } from "@/lib/calendar";

const profile: BusinessProfile = {
  ...business,
  timeZone: "Europe/Vienna",
  openingHours: {
    mo: [
      ["08:00", "12:00"],
      ["13:00", "16:00"],
    ],
    di: [["08:00", "12:00"]],
    mi: [],
    do: [],
    fr: [],
    sa: [],
    so: [],
  },
  closedDates: ["2026-11-24"],
  booking: { slotStepMinutes: 60, capacity: 1, minLeadHours: 2, maxDaysAhead: 30 },
};

// Sonntag, 15.11.2026, 12:00 Uhr Wiener Zeit
const now = zonedToUtc("2026-11-15", "12:00", "Europe/Vienna");
const times = (slots: Date[]) => slots.map((s) => localTime(s, "Europe/Vienna"));

describe("Zeitzonen", () => {
  it("rechnet Wiener Ortszeit im Winter und Sommer korrekt nach UTC", () => {
    expect(zonedToUtc("2026-11-16", "08:00", "Europe/Vienna").toISOString()).toBe("2026-11-16T07:00:00.000Z");
    expect(zonedToUtc("2026-07-01", "08:00", "Europe/Vienna").toISOString()).toBe("2026-07-01T06:00:00.000Z");
  });

  it("stimmt am Tag der Zeitumstellung", () => {
    // 29.03.2026: Umstellung auf Sommerzeit um 02:00
    expect(zonedToUtc("2026-03-29", "10:00", "Europe/Vienna").toISOString()).toBe("2026-03-29T08:00:00.000Z");
  });

  it("Hilfsfunktionen für Datum und Wochentag", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-11-16")).toBe("mo");
    expect(localDate(new Date("2026-11-15T23:30:00Z"), "Europe/Vienna")).toBe("2026-11-16");
  });
});

describe("slotsForDay", () => {
  it("berücksichtigt Öffnungszeiten, Mittagspause und Dauer", () => {
    expect(times(slotsForDay(profile, 60, "2026-11-16", [], now))).toEqual(["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00"]);
    expect(times(slotsForDay(profile, 120, "2026-11-16", [], now))).toEqual(["08:00", "09:00", "10:00", "13:00", "14:00"]);
  });

  it("lässt belegte Zeiten weg und respektiert die Kapazität", () => {
    const busy = [{ start: zonedToUtc("2026-11-16", "09:00", "Europe/Vienna"), end: zonedToUtc("2026-11-16", "11:00", "Europe/Vienna") }];
    expect(times(slotsForDay(profile, 60, "2026-11-16", busy, now))).toEqual(["08:00", "11:00", "13:00", "14:00", "15:00"]);
    const twoLifts = { ...profile, booking: { ...profile.booking, capacity: 2 } };
    expect(slotsForDay(twoLifts, 60, "2026-11-16", busy, now)).toHaveLength(7);
  });

  it("keine Termine an geschlossenen Tagen, ohne Vorlaufzeit oder zu weit in der Zukunft", () => {
    expect(slotsForDay(profile, 60, "2026-11-18", [], now)).toEqual([]); // Mittwoch geschlossen
    expect(slotsForDay(profile, 60, "2026-11-24", [], now)).toEqual([]); // Betriebsurlaub
    const mondayMorning = zonedToUtc("2026-11-16", "09:30", "Europe/Vienna");
    expect(times(slotsForDay(profile, 60, "2026-11-16", [], mondayMorning))).toEqual(["13:00", "14:00", "15:00"]);
    expect(slotsForDay(profile, 60, "2027-01-04", [], now)).toEqual([]);
  });
});

describe("isBookable und suggestSlots", () => {
  it("akzeptiert nur Zeiten im Raster", () => {
    expect(isBookable(profile, 60, zonedToUtc("2026-11-16", "10:00", "Europe/Vienna"), [], now)).toBe(true);
    expect(isBookable(profile, 60, zonedToUtc("2026-11-16", "10:15", "Europe/Vienna"), [], now)).toBe(false);
    expect(isBookable(profile, 60, zonedToUtc("2026-11-16", "12:00", "Europe/Vienna"), [], now)).toBe(false);
  });

  it("schlägt über Tage verteilte Termine vor und überspringt geschlossene Tage", () => {
    const slots = suggestSlots(profile, 60, "2026-11-18", [], now, { total: 4, perDay: 2 });
    expect(slots.map((s) => `${localDate(s, "Europe/Vienna")} ${localTime(s, "Europe/Vienna")}`)).toEqual([
      "2026-11-23 08:00",
      "2026-11-23 15:00",
      "2026-11-30 08:00",
      "2026-11-30 15:00",
    ]);
  });

  it("formatiert Termine zum Vorlesen", () => {
    expect(formatSlot(zonedToUtc("2026-11-17", "09:30", "Europe/Vienna"), profile)).toBe("Dienstag, 17. November, 9:30 Uhr");
  });
});
