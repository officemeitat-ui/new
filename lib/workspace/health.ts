import "server-only";
import { workspace } from "@/config/workspace";
import { type DomainCheck } from "@/lib/checks/domain";
import { isCheckError } from "@/lib/checks/run";
import { listLearners } from "@/lib/awareness/store";
import { localDate } from "@/lib/calendar";
import { db } from "@/lib/db";
import { listAlerts, listTickets } from "@/lib/workspace/customers";
import { checkResults } from "@/lib/workspace/records";
import { customerSlaQuote } from "@/lib/sla";

// Kunden-Gesundheit: ein Wert von 0 bis 100 aus Daten, die ohne Doku-Passwort lesbar sind –
// Tickets, Warnungen, Geräte, Fristen, Domain-Sicherheit, Datensicherung, Schulungsstand und Vollständigkeit der Doku.

export type HealthFactor = { label: string; points: number; max: number; note: string };
export type Health = { score: number; grade: "sehr gut" | "gut" | "mittel" | "kritisch"; factors: HealthFactor[] };

export const HEALTH_STYLE: Record<Health["grade"], string> = {
  "sehr gut": "bg-emerald-100 text-emerald-800",
  gut: "bg-lime-100 text-lime-800",
  mittel: "bg-amber-100 text-amber-800",
  kritisch: "bg-red-100 text-red-800",
};

const ESSENTIAL_KINDS = ["kontakt", "standort", "geraet", "domain", "m365", "backup", "vertrag"];
const GRADE_POINTS: Record<DomainCheck["grade"], number> = { A: 15, B: 12, C: 8, D: 4, F: 0 };
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, Math.round(value)));

export async function healthForCustomers(customerIds: string[], now = new Date()): Promise<Map<string, Health>> {
  const client = await db();
  const today = localDate(now, workspace.timeZone);
  const in30 = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const [tickets, alerts, devices, records, networks, checks] = await Promise.all([
    listTickets(),
    listAlerts(),
    client.execute("SELECT customer_id, online FROM devices"),
    client.execute("SELECT customer_id, kind, due_at FROM records"),
    client.execute("SELECT customer_id FROM network_models"),
    checkResults(),
  ]);
  const result = new Map<string, Health>();
  for (const id of customerIds) {
    const factors: HealthFactor[] = [];
    const push = (label: string, points: number, max: number, note: string) =>
      factors.push({ label, points: clamp(points, max), max, note });

    const open = tickets.filter((t) => t.customerId === id);
    const sla = await customerSlaQuote(id, 90, now);
    const critical = open.filter((t) => t.priority === "Critical").length;
    const high = open.filter((t) => t.priority === "High").length;
    push(
      "Tickets",
      15 - critical * 6 - high * 3 - Math.max(0, open.length - 5),
      15,
      open.length ? `${open.length} offen${critical ? `, ${critical} kritisch` : ""}` : "keine offenen",
    );

    if (sla.measured) factors[factors.length - 1].note += ` · SLA ${sla.quote} % erfüllt`;
    if (sla.quote !== null && sla.quote < 90)
      factors[factors.length - 1].points = Math.max(0, factors[factors.length - 1].points - (sla.quote < 75 ? 6 : 3));
    const own = alerts.filter((a) => a.customerId === id);
    const criticalAlerts = own.filter((a) => a.severity === "Critical").length;
    push(
      "Warnungen",
      10 - criticalAlerts * 4 - (own.length - criticalAlerts),
      10,
      own.length ? `${own.length} (${criticalAlerts} kritisch)` : "keine",
    );

    const devs = devices.rows.filter((d) => d.customer_id === id);
    const offline = devs.filter((d) => Number(d.online) === 0 && d.online !== null).length;
    push(
      "Geräte",
      devs.length ? 10 - (offline / devs.length) * 20 : 10,
      10,
      devs.length ? `${offline} von ${devs.length} offline` : "keine aus Atera",
    );

    const recs = records.rows.filter((r) => r.customer_id === id);
    const overdue = recs.filter((r) => r.due_at && String(r.due_at) < today).length;
    const soon = recs.filter((r) => r.due_at && String(r.due_at) >= today && String(r.due_at) <= in30).length;
    push("Fristen", 15 - overdue * 5 - soon * 2, 15, overdue ? `${overdue} überfällig` : soon ? `${soon} in 30 Tagen` : "nichts fällig");

    const domainChecks = checks
      .filter((c) => c.customerId === id)
      .map((c) => (c.result && !isCheckError(c.result) ? (c.result as DomainCheck) : null));
    const grades = domainChecks.filter((c): c is DomainCheck => Boolean(c)).map((c) => c.grade);
    const worst = grades.sort().at(-1);
    push(
      "E-Mail-Sicherheit",
      worst ? GRADE_POINTS[worst] : 6,
      15,
      worst ? `schlechteste Domain: ${worst}` : domainChecks.length ? "noch nicht geprüft" : "keine Domain erfasst",
    );

    const backups = recs.filter((r) => r.kind === "backup");
    const untested = backups.filter((r) => !r.due_at || String(r.due_at) < today).length;
    push(
      "Datensicherung",
      backups.length ? (untested ? 6 : 15) : 0,
      15,
      backups.length ? (untested ? `${untested} ohne aktuellen Wiederherstellungstest` : "getestet") : "nicht dokumentiert",
    );

    const learners = (await listLearners(id, now)).filter((l) => !l.disabled);
    const trained = learners.filter((l) => l.state === "bestanden" || l.state === "laeuft_ab").length;
    push(
      "Schulung",
      learners.length ? (trained / learners.length) * 10 : 0,
      10,
      learners.length ? `${trained} von ${learners.length} geschult` : "noch keine Schulung",
    );

    const kinds = new Set(recs.map((r) => String(r.kind)));
    const docParts = ESSENTIAL_KINDS.filter((k) => kinds.has(k)).length + (networks.rows.some((n) => n.customer_id === id) ? 1 : 0);
    push("Dokumentation", (docParts / (ESSENTIAL_KINDS.length + 1)) * 10, 10, `${docParts} von ${ESSENTIAL_KINDS.length + 1} Bereichen`);

    const score = factors.reduce((sum, f) => sum + f.points, 0);
    result.set(id, { score, grade: score >= 85 ? "sehr gut" : score >= 70 ? "gut" : score >= 50 ? "mittel" : "kritisch", factors });
  }
  return result;
}

export async function healthFor(customerId: string, now = new Date()): Promise<Health> {
  return (await healthForCustomers([customerId], now)).get(customerId)!;
}
