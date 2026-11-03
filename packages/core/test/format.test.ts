import { describe, expect, it } from "vitest";
import {
  dayPeriod,
  formatCurrency,
  formatDate,
  formatDateWithWeekday,
  hourInTimeZone,
} from "../src/format";

const normalize = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("de-AT formatting", () => {
  it("formats euros the Austrian way", () => {
    expect(normalize(formatCurrency(1234.56))).toBe("€ 1.234,56");
  });

  it("formats dates in Vienna time", () => {
    // 23:30 UTC on 1 Nov is already 2 Nov in Vienna (UTC+1).
    expect(formatDate("2026-11-01T23:30:00Z")).toBe("02.11.2026");
  });

  it("includes the weekday for appointment proposals", () => {
    expect(formatDateWithWeekday("2026-11-10T08:00:00Z")).toBe("Dienstag, 10.11.2026");
  });
});

describe("dayPeriod", () => {
  it("uses Vienna time, not the server clock", () => {
    // 06:30 UTC = 07:30 in Vienna (winter time)
    expect(hourInTimeZone(new Date("2026-11-03T06:30:00Z"))).toBe(7);
    expect(dayPeriod(new Date("2026-11-03T06:30:00Z"))).toBe("morning");
    expect(dayPeriod(new Date("2026-11-03T12:00:00Z"))).toBe("day");
    expect(dayPeriod(new Date("2026-11-03T19:00:00Z"))).toBe("evening");
  });

  it("follows daylight saving time", () => {
    // 06:30 UTC = 08:30 in Vienna (summer time)
    expect(hourInTimeZone(new Date("2026-07-01T06:30:00Z"))).toBe(8);
  });
});
