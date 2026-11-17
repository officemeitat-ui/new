import "server-only";
import { SLA, type PackageId, type SlaPriority } from "@/config/services";
import { workspace } from "@/config/workspace";
import { addDays, localDate, zonedToUtc } from "@/lib/calendar";
import { db } from "@/lib/db";

// SLA-Tracking (aus dem ME-IT Cockpit): garantierte Reaktions- und Lösungszeiten je Paket – messbar statt versprochen.
// Zeiten in Geschäftsstunden (Standard Mo–Fr 8–17 Uhr, Wiener Zeit). Reaktion = erste Technikerantwort bzw. erster
// Statuswechsel in Atera (beim Abgleich festgehalten).

export type SlaState = "ok" | "knapp" | "verletzt" | "erfüllt" | "keine Zusage";
export type SlaPart = { targetH: number | null; state: SlaState; due?: string; leftH?: number; tookH?: number };
export type TicketSla = { package: PackageId; priority: SlaPriority; response: SlaPart; resolution: SlaPart };

export const ATERA_PRIORITY: Record<string, SlaPriority> = { Critical: "kritisch", High: "hoch", Medium: "normal", Low: "niedrig" };
export const SLA_STYLE: Record<SlaState, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  knapp: "bg-amber-100 text-amber-800",
  verletzt: "bg-red-100 text-red-800",
  erfüllt: "bg-emerald-50 text-emerald-700",
  "keine Zusage": "bg-slate-100 text-slate-500",
};

const bh = SLA.businessHours;
const tz = workspace.timeZone;
const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Zeitpunkt, an dem `hours` Geschäftsstunden nach `start` erreicht sind. */
export function addBusinessHours(start: Date, hours: number): Date {
  let remaining = hours * 3_600_000;
  let day = localDate(start, tz);
  let cursor = start.getTime();
  for (let i = 0; i < 3700; i++) {
    const dayStart = zonedToUtc(day, hhmm(bh.start), tz).getTime();
    const dayEnd = zonedToUtc(day, hhmm(bh.end), tz).getTime();
    if (bh.days.includes(weekday(day)) && cursor < dayEnd) {
      const begin = Math.max(cursor, dayStart);
      const available = dayEnd - begin;
      if (remaining <= available) return new Date(begin + remaining);
      remaining -= available;
    }
    day = addDays(day, 1);
    cursor = zonedToUtc(day, "00:00", tz).getTime();
  }
  return new Date(cursor);
}

/** Geschäftsstunden zwischen zwei Zeitpunkten. */
export function businessHoursBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let total = 0;
  let day = localDate(start, tz);
  const last = localDate(end, tz);
  for (let i = 0; i < 3700 && day <= last; i++) {
    if (bh.days.includes(weekday(day))) {
      const a = Math.max(start.getTime(), zonedToUtc(day, hhmm(bh.start), tz).getTime());
      const b = Math.min(end.getTime(), zonedToUtc(day, hhmm(bh.end), tz).getTime());
      if (b > a) total += b - a;
    }
    day = addDays(day, 1);
  }
  return total / 3_600_000;
}

export function ticketSla(
  ticket: { createdAt: string | null; firstResponseAt: string | null; resolvedAt: string | null; status: string; priority: string | null },
  pkg: PackageId,
  now = new Date(),
): TicketSla {
  const priority = ATERA_PRIORITY[ticket.priority ?? ""] ?? "normal";
  const [responseTarget, resolutionTarget] = SLA.packages[pkg]?.[priority] ?? [null, null];
  const created = ticket.createdAt ? new Date(ticket.createdAt) : now;
  const resolved = ticket.resolvedAt && /Resolved|Closed/.test(ticket.status) ? new Date(ticket.resolvedAt) : null;
  const responded = ticket.firstResponseAt ? new Date(ticket.firstResponseAt) : resolved;
  const part = (target: number | null, done: Date | null): SlaPart => {
    if (target === null) return { targetH: null, state: "keine Zusage" };
    const due = addBusinessHours(created, target);
    if (done) {
      return {
        targetH: target,
        due: due.toISOString(),
        state: done <= due ? "erfüllt" : "verletzt",
        tookH: Math.round(businessHoursBetween(created, done) * 10) / 10,
      };
    }
    const left = now < due ? businessHoursBetween(now, due) : -businessHoursBetween(due, now);
    const state: SlaState = now > due ? "verletzt" : left <= Math.max(0.5, 0.25 * target) ? "knapp" : "ok";
    return { targetH: target, due: due.toISOString(), state, leftH: Math.round(left * 10) / 10 };
  };
  return { package: pkg, priority, response: part(responseTarget, responded), resolution: part(resolutionTarget, resolved) };
}

const ORDER: Record<SlaState, number> = { verletzt: 0, knapp: 1, ok: 2, erfüllt: 3, "keine Zusage": 4 };
export const worstState = (s: TicketSla): SlaState =>
  ORDER[s.response.state] <= ORDER[s.resolution.state] ? s.response.state : s.resolution.state;

type Row = {
  id: string;
  title: string;
  customer_id: string | null;
  customer_name: string | null;
  status: string;
  priority: string | null;
  created_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  package: string | null;
};

async function rows(sinceIso: string, customerId?: string): Promise<Row[]> {
  const result = await (
    await db()
  ).execute({
    sql: `SELECT t.id, t.title, t.customer_id, t.customer_name, t.status, t.priority, t.created_at, t.first_response_at, t.resolved_at, c.package
          FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id
          WHERE (t.status IN ('Open', 'Pending') OR t.created_at >= ?)${customerId ? " AND t.customer_id = ?" : ""}`,
    args: customerId ? [sinceIso, customerId] : [sinceIso],
  });
  return result.rows as unknown as Row[];
}

const pkgOf = (value: string | null): PackageId => (value && value in SLA.packages ? (value as PackageId) : "keins");

export type SlaQuote = { measured: number; met: number; breached: number; quote: number | null };

function quoteOf(list: TicketSla[]): SlaQuote {
  let measured = 0;
  let met = 0;
  let breached = 0;
  for (const s of list) {
    for (const part of [s.response, s.resolution]) {
      if (part.state === "erfüllt" || part.state === "verletzt") {
        measured++;
        if (part.state === "erfüllt") met++;
        else breached++;
      }
    }
  }
  return { measured, met, breached, quote: measured ? Math.round((1000 * met) / measured) / 10 : null };
}

/** Offene Tickets mit Ampel und Erfüllungsquote je Kunde (letzte `days` Tage). */
export async function slaOverview(days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const list = (await rows(since)).map((t) => ({
    ...t,
    sla: ticketSla(
      { createdAt: t.created_at, firstResponseAt: t.first_response_at, resolvedAt: t.resolved_at, status: t.status, priority: t.priority },
      pkgOf(t.package),
      now,
    ),
  }));
  const open = list
    .filter((t) => t.status === "Open" || t.status === "Pending")
    .sort((a, b) => ORDER[worstState(a.sla)] - ORDER[worstState(b.sla)]);
  const recent = list.filter((t) => t.created_at && t.created_at >= since && t.customer_id);
  const customers = [...new Set(recent.map((t) => t.customer_id!))].map((id) => {
    const own = recent.filter((t) => t.customer_id === id);
    return {
      customerId: id,
      customer: own[0].customer_name ?? "",
      package: pkgOf(own[0].package),
      tickets: own.length,
      ...quoteOf(own.map((t) => t.sla)),
    };
  });
  return {
    open,
    breachedOpen: open.filter((t) => worstState(t.sla) === "verletzt").length,
    atRiskOpen: open.filter((t) => worstState(t.sla) === "knapp").length,
    customers: customers.sort((a, b) => (a.quote ?? 101) - (b.quote ?? 101)),
    ...quoteOf(recent.map((t) => t.sla)),
  };
}

export async function customerSlaQuote(customerId: string, days = 90, now = new Date()): Promise<SlaQuote> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const list = (await rows(since, customerId)).filter((t) => t.created_at && t.created_at >= since);
  return quoteOf(
    list.map((t) =>
      ticketSla(
        {
          createdAt: t.created_at,
          firstResponseAt: t.first_response_at,
          resolvedAt: t.resolved_at,
          status: t.status,
          priority: t.priority,
        },
        pkgOf(t.package),
        now,
      ),
    ),
  );
}

export const formatHours = (h: number) =>
  Math.abs(h) < 1 ? `${Math.round(Math.abs(h) * 60)} Min.` : `${Math.abs(h).toLocaleString("de-AT", { maximumFractionDigits: 1 })} Std.`;
