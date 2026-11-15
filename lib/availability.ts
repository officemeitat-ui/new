import "server-only";
import { business, getService, type Service } from "@/config/business";
import { busyBetween } from "@/lib/appointments";
import { addDays, formatSlot, localDate, suggestSlots, zonedToUtc } from "@/lib/calendar";

export const SEARCH_DAYS = 14;

export type SlotOffer = { start: string; vorlesen: string };

/** Freie Terminvorschläge für eine Leistung ab einem Datum (frühestens heute), aus Kalender und Buchungen. */
export async function offerSlots(
  serviceId: string,
  fromDate: string,
  now: Date,
  options: { total?: number; perDay?: number } = {},
): Promise<{ service: Service; slots: SlotOffer[] } | null> {
  const service = getService(serviceId);
  if (!service) return null;
  const today = localDate(now, business.timeZone);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && fromDate > today ? fromDate : today;
  const busy = await busyBetween(
    zonedToUtc(from, "00:00", business.timeZone),
    zonedToUtc(addDays(from, SEARCH_DAYS + 1), "00:00", business.timeZone),
  );
  const slots = suggestSlots(business, service.durationMinutes, from, busy, now, {
    total: options.total ?? 4,
    perDay: options.perDay ?? 2,
    searchDays: SEARCH_DAYS,
  });
  return { service, slots: slots.map((s) => ({ start: s.toISOString(), vorlesen: formatSlot(s, business) })) };
}
