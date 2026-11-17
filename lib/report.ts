import "server-only";
import { business, getService } from "@/config/business";
import { localDate, zonedToUtc } from "@/lib/calendar";
import { EMAIL_CATEGORIES, type EmailCategory } from "@/lib/emails";
import { breakdown, impactStats, type ImpactStats } from "@/lib/stats";

// Monatsbericht für den Kunden: Was hat der KI-Mitarbeiter geleistet, im Vergleich zum Vormonat.
// Grundlage für das Quartalsgespräch und den Ausbau auf weitere KI-Mitarbeiter.

export type MonthlyReport = {
  /** Format YYYY-MM */
  month: string;
  label: string;
  from: Date;
  to: Date;
  current: ImpactStats;
  previous: ImpactStats;
  appointmentsByService: { name: string; count: number }[];
  emailsByCategory: { label: string; count: number }[];
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH.test(value);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export function currentMonth(now = new Date()): string {
  return localDate(now, business.timeZone).slice(0, 7);
}

/** Monatsanfang bis Anfang des Folgemonats, jeweils Mitternacht in der Zeitzone des Betriebs. */
export function monthRange(month: string): { from: Date; to: Date } {
  return {
    from: zonedToUtc(`${month}-01`, "00:00", business.timeZone),
    to: zonedToUtc(`${shiftMonth(month, 1)}-01`, "00:00", business.timeZone),
  };
}

export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("de-AT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

/** Veränderung zum Vormonat als Text, z. B. „+20 %“, „−10 %“, „neu“. */
export function change(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "±0 %" : "neu";
  const percent = Math.round(((current - previous) / previous) * 100);
  return percent === 0 ? "±0 %" : `${percent > 0 ? "+" : "−"}${Math.abs(percent)} %`;
}

const plural = (n: number, singular: string, pluralForm: string) => `${n} ${n === 1 ? singular : pluralForm}`;

export const hours = (minutes: number) => (minutes / 60).toLocaleString("de-AT", { maximumFractionDigits: 1 });

export async function monthlyReport(month: string): Promise<MonthlyReport> {
  const { from, to } = monthRange(month);
  const previousRange = monthRange(shiftMonth(month, -1));
  const [current, previous, byService, byCategory] = await Promise.all([
    impactStats(from, to),
    impactStats(previousRange.from, previousRange.to),
    breakdown("appointmentsByService", from, to),
    breakdown("emailsByCategory", from, to),
  ]);
  const sorted = <T extends { count: number }>(items: T[]) => items.sort((a, b) => b.count - a.count);
  return {
    month,
    label: monthLabel(month),
    from,
    to,
    current,
    previous,
    appointmentsByService: sorted(Object.entries(byService).map(([id, count]) => ({ name: getService(id)?.name ?? id, count }))),
    emailsByCategory: sorted(
      Object.entries(byCategory).map(([id, count]) => ({ label: EMAIL_CATEGORIES[id as EmailCategory] ?? id, count })),
    ),
  };
}

/** Bericht als Text für die E-Mail an den Kunden. */
export function reportText(report: MonthlyReport, link?: string): string {
  const { current: c, previous: p } = report;
  const { minutesPerCall, minutesPerEmail, minutesPerChat, minutesPerAppointment, minutesPerReceipt } = business.impact;
  const booked = c.appointments.automated;
  const lines = [
    `Monatsbericht ${report.label} – ${business.name}`,
    "",
    `Ihre KI-Mitarbeiter haben im ${report.label}:`,
    `• ${plural(c.calls, "Anruf", "Anrufe")} angenommen (Vormonat ${p.calls}, ${change(c.calls, p.calls)}), ${hours(c.callMinutes)} Std. Gesprächszeit`,
    `• ${plural(booked, "Termin", "Termine")} gebucht (${c.appointments.telefon} per Telefon, ${c.appointments.whatsapp} per WhatsApp, ${c.appointments.email} per E-Mail; Vormonat ${p.appointments.automated})`,
    `• ${plural(c.chats, "WhatsApp-Gespräch", "WhatsApp-Gespräche")} geführt (${plural(c.chatReplies, "Antwort", "Antworten")})`,
    `• ${plural(c.callbacks, "Rückrufwunsch", "Rückrufwünsche")} für Sie notiert`,
    `• ${plural(c.emailsHandled, "E-Mail", "E-Mails")} bearbeitet, ${plural(c.repliesSent, "Antwort", "Antworten")} gesendet (Vormonat ${p.emailsHandled})`,
    ...(c.receipts > 0 || p.receipts > 0
      ? [`• ${plural(c.receipts, "Beleg", "Belege")} für die Buchhaltung erfasst (Vormonat ${p.receipts})`]
      : []),
    "",
    `Geschätzte Zeitersparnis: ${hours(c.minutesSaved)} Stunden (Vormonat ${hours(p.minutesSaved)})`,
    `Annahmen: ${minutesPerCall} Min. je Anruf, ${minutesPerEmail} Min. je E-Mail, ${minutesPerChat} Min. je WhatsApp-Gespräch, ${minutesPerAppointment} Min. je Terminvereinbarung, ${minutesPerReceipt} Min. je Beleg.`,
  ];
  if (report.appointmentsByService.length > 0) {
    lines.push("", "Termine nach Leistung:", ...report.appointmentsByService.map((s) => `• ${s.name}: ${s.count}`));
  }
  if (report.emailsByCategory.length > 0) {
    lines.push("", "E-Mails nach Art:", ...report.emailsByCategory.map((e) => `• ${e.label}: ${e.count}`));
  }
  if (c.openDrafts > 0)
    lines.push("", `Hinweis: ${plural(c.openDrafts, "Antwortentwurf wartet", "Antwortentwürfe warten")} auf Ihre Freigabe.`);
  if (link) lines.push("", `Details im Cockpit: ${link}`);
  return lines.join("\n");
}

/** Vormonat relativ zu jetzt – der Bericht wird am Monatsanfang für den abgelaufenen Monat verschickt. */
export function lastCompletedMonth(now = new Date()): string {
  return shiftMonth(currentMonth(now), -1);
}
