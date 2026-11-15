// Terminlogik: freie Zeitfenster aus Öffnungszeiten, Leistungsdauer und bestehenden Buchungen.
// Rein funktional und zeitzonenfest (Öffnungszeiten gelten in der Zeitzone des Betriebs, gespeichert wird UTC).

import type { BusinessProfile, Weekday } from "@/config/business";

const WEEKDAYS: Weekday[] = ["so", "mo", "di", "mi", "do", "fr", "sa"];
const MINUTE = 60_000;

export type Busy = { start: Date; end: Date };

/** Abstand der Zeitzone zu UTC (in ms) zum angegebenen Zeitpunkt. */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallClock = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wallClock - (instant - (instant % 1000));
}

/** Ortszeit (Datum „YYYY-MM-DD“, Uhrzeit „HH:MM“) in der Zeitzone → UTC-Zeitpunkt. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const wallClock = Date.UTC(y, m - 1, d, h, min);
  // Zweimal rechnen, damit Tage mit Sommerzeit-Umstellung stimmen.
  const first = wallClock - zoneOffset(wallClock, timeZone);
  return new Date(wallClock - zoneOffset(first, timeZone));
}

/** Kalenderdatum („YYYY-MM-DD“) eines Zeitpunkts in der Zeitzone. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function overlapping(busy: Busy[], start: Date, end: Date): number {
  return busy.filter((b) => b.start < end && b.end > start).length;
}

/** Freie Startzeiten an einem Tag für eine Leistung mit der angegebenen Dauer. */
export function slotsForDay(profile: BusinessProfile, durationMinutes: number, date: string, busy: Busy[], now: Date): Date[] {
  if (profile.closedDates.includes(date)) return [];
  const { slotStepMinutes, capacity, minLeadHours, maxDaysAhead } = profile.booking;
  const earliest = now.getTime() + minLeadHours * 60 * MINUTE;
  const latest = now.getTime() + maxDaysAhead * 24 * 60 * MINUTE;
  const slots: Date[] = [];

  for (const [open, close] of profile.openingHours[weekdayOf(date)]) {
    const windowEnd = zonedToUtc(date, close, profile.timeZone).getTime();
    for (
      let start = zonedToUtc(date, open, profile.timeZone).getTime();
      start + durationMinutes * MINUTE <= windowEnd;
      start += slotStepMinutes * MINUTE
    ) {
      if (start < earliest || start > latest) continue;
      const end = start + durationMinutes * MINUTE;
      if (overlapping(busy, new Date(start), new Date(end)) < capacity) slots.push(new Date(start));
    }
  }
  return slots;
}

/** Prüft, ob ein konkreter Termin buchbar ist (liegt im Raster, in den Öffnungszeiten und ist frei). */
export function isBookable(profile: BusinessProfile, durationMinutes: number, start: Date, busy: Busy[], now: Date): boolean {
  const date = localDate(start, profile.timeZone);
  return slotsForDay(profile, durationMinutes, date, busy, now).some((s) => s.getTime() === start.getTime());
}

/**
 * Terminvorschläge ab einem Wunschdatum: pro Tag einige über den Tag verteilte Zeiten,
 * bis genug Vorschläge beisammen sind – geeignet, um sie am Telefon vorzulesen.
 */
export function suggestSlots(
  profile: BusinessProfile,
  durationMinutes: number,
  fromDate: string,
  busy: Busy[],
  now: Date,
  { total = 4, perDay = 2, searchDays = 14 } = {},
): Date[] {
  const result: Date[] = [];
  for (let i = 0; i < searchDays && result.length < total; i++) {
    const day = slotsForDay(profile, durationMinutes, addDays(fromDate, i), busy, now);
    if (day.length === 0) continue;
    const picks = Math.min(perDay, day.length, total - result.length);
    for (let k = 0; k < picks; k++) {
      // Gleichmäßig über den Tag verteilt, z. B. Vormittag und Nachmittag.
      result.push(day[Math.round((k * (day.length - 1)) / Math.max(1, picks - 1))]);
    }
  }
  return result;
}

/** Termin für die Sprachausgabe bzw. E-Mail, z. B. „Dienstag, 17. November, 9:30 Uhr“. */
export function formatSlot(start: Date, profile: Pick<BusinessProfile, "timeZone">, locale = "de-AT"): string {
  const day = new Intl.DateTimeFormat(locale, { timeZone: profile.timeZone, weekday: "long", day: "numeric", month: "long" }).format(start);
  const time = new Intl.DateTimeFormat(locale, { timeZone: profile.timeZone, hour: "numeric", minute: "2-digit" }).format(start);
  return `${day}, ${time} Uhr`;
}

/** Lokale Uhrzeit „HH:MM“ eines Zeitpunkts in der Zeitzone. */
export function localTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
}

/** Öffnungszeiten als Text, z. B. für Prompts: „Mo: 07:30–12:00, 13:00–17:00; …“. */
export function describeOpeningHours(profile: BusinessProfile): string {
  const names: Record<Weekday, string> = { mo: "Mo", di: "Di", mi: "Mi", do: "Do", fr: "Fr", sa: "Sa", so: "So" };
  return (Object.keys(names) as Weekday[])
    .map((d) => {
      const windows = profile.openingHours[d];
      return `${names[d]}: ${windows.length ? windows.map(([a, b]) => `${a}–${b}`).join(", ") : "geschlossen"}`;
    })
    .join("; ");
}
