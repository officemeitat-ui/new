import "server-only";
import type { Row } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { workspace } from "@/config/workspace";
import { db } from "@/lib/db";

// Stundenkonten: vorab bezahlte Stundenpakete je Kunde und Zeitbuchungen, die davon abgezogen werden.

/** kontingent: wird vom bezahlten Stundenpaket abgezogen · verrechnen: separat in Rechnung stellen · intern: nicht verrechnet */
export type TimeMode = "kontingent" | "verrechnen" | "intern";

export const TIME_MODE_LABELS: Record<TimeMode, string> = {
  kontingent: "vom Stundenpaket",
  verrechnen: "separat verrechnen",
  intern: "nicht verrechnet",
};

export type HourPackage = {
  id: string;
  customerId: string;
  minutes: number;
  /** JJJJ-MM-TT */
  date: string;
  priceCents: number | null;
  reference: string | null;
  createdAt: string;
};

export type TimeEntry = {
  id: string;
  customerId: string;
  customerName: string;
  date: string;
  minutes: number;
  description: string;
  mode: TimeMode;
  ticketId: string | null;
  source: "manuell" | "assistent";
  createdAt: string;
};

export type HourAccount = {
  customerId: string;
  customerName: string;
  /** Gekaufte Minuten insgesamt */
  purchased: number;
  /** Vom Kontingent verbrauchte Minuten */
  used: number;
  balance: number;
  /** Separat zu verrechnende Minuten im laufenden Monat */
  billableThisMonth: number;
  lastEntry: string | null;
  status: "ok" | "knapp" | "ueberzogen" | "kein_paket";
};

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

function toPackage(row: Row): HourPackage {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    minutes: Number(row.minutes),
    date: String(row.date),
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    reference: text(row.reference),
    createdAt: String(row.created_at),
  };
}

function toEntry(row: Row): TimeEntry {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    customerName: String(row.customer_name ?? ""),
    date: String(row.date),
    minutes: Number(row.minutes),
    description: String(row.description),
    mode: String(row.mode) as TimeMode,
    ticketId: text(row.ticket_id),
    source: String(row.source) as TimeEntry["source"],
    createdAt: String(row.created_at),
  };
}

/** Rundet nach der Einstellung workspace.hours.roundToMinutes auf (angefangene Einheit zählt voll). */
export function roundMinutes(minutes: number, step = workspace.hours.roundToMinutes): number {
  if (step <= 0) return minutes;
  return Math.ceil(minutes / step) * step;
}

function statusOf(purchased: number, balance: number): HourAccount["status"] {
  if (purchased === 0) return "kein_paket";
  if (balance < 0) return "ueberzogen";
  if (balance <= workspace.hours.lowBalanceMinutes) return "knapp";
  return "ok";
}

export async function addPackage(
  input: { customerId: string; minutes: number; date: string; priceCents?: number | null; reference?: string | null },
  now = new Date(),
): Promise<HourPackage> {
  if (!Number.isInteger(input.minutes) || input.minutes <= 0) throw new Error("Ungültige Stundenanzahl");
  const client = await db();
  const id = randomUUID();
  await client.execute({
    sql: "INSERT INTO hour_packages (id, customer_id, minutes, date, price_cents, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [id, input.customerId, input.minutes, input.date, input.priceCents ?? null, input.reference?.trim() || null, now.toISOString()],
  });
  return (await listPackages(input.customerId)).find((p) => p.id === id)!;
}

export async function addTimeEntry(
  input: {
    customerId: string;
    date: string;
    minutes: number;
    description: string;
    mode: TimeMode;
    ticketId?: string | null;
    source?: TimeEntry["source"];
  },
  now = new Date(),
): Promise<TimeEntry> {
  if (!Number.isInteger(input.minutes) || input.minutes <= 0 || input.minutes > 24 * 60) throw new Error("Ungültige Dauer");
  const client = await db();
  const id = randomUUID();
  await client.execute({
    sql: `INSERT INTO time_entries (id, customer_id, date, minutes, description, mode, ticket_id, source, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.customerId,
      input.date,
      roundMinutes(input.minutes),
      input.description.trim().slice(0, 500),
      input.mode,
      input.ticketId ?? null,
      input.source ?? "manuell",
      now.toISOString(),
    ],
  });
  return (await listEntries({ customerId: input.customerId, limit: 500 })).find((e) => e.id === id)!;
}

export async function deletePackage(id: string): Promise<void> {
  const client = await db();
  await client.execute({ sql: "DELETE FROM hour_packages WHERE id = ?", args: [id] });
}

export async function deleteTimeEntry(id: string): Promise<void> {
  const client = await db();
  await client.execute({ sql: "DELETE FROM time_entries WHERE id = ?", args: [id] });
}

export async function listPackages(customerId: string): Promise<HourPackage[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM hour_packages WHERE customer_id = ? ORDER BY date DESC, created_at DESC",
    args: [customerId],
  });
  return result.rows.map(toPackage);
}

export async function listEntries(filter: { customerId?: string; month?: string; limit?: number } = {}): Promise<TimeEntry[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.customerId) {
    where.push("e.customer_id = ?");
    args.push(filter.customerId);
  }
  if (filter.month) {
    where.push("e.date LIKE ?");
    args.push(`${filter.month}-%`);
  }
  const client = await db();
  const result = await client.execute({
    sql: `SELECT e.*, c.name AS customer_name FROM time_entries e JOIN customers c ON c.id = e.customer_id
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY e.date DESC, e.created_at DESC LIMIT ?`,
    args: [...args, filter.limit ?? 200],
  });
  return result.rows.map(toEntry);
}

/** Stundenkonten aller Kunden, die ein Paket oder eine Buchung haben – überzogene und knappe zuerst. */
export async function listAccounts(month: string): Promise<HourAccount[]> {
  const client = await db();
  const result = await client.execute({
    sql: `SELECT c.id, c.name,
            COALESCE((SELECT SUM(minutes) FROM hour_packages p WHERE p.customer_id = c.id), 0) AS purchased,
            COALESCE((SELECT SUM(minutes) FROM time_entries e WHERE e.customer_id = c.id AND e.mode = 'kontingent'), 0) AS used,
            COALESCE((SELECT SUM(minutes) FROM time_entries e WHERE e.customer_id = c.id AND e.mode = 'verrechnen' AND e.date LIKE ?), 0) AS billable,
            (SELECT MAX(date) FROM time_entries e WHERE e.customer_id = c.id) AS last_entry
          FROM customers c
          WHERE EXISTS (SELECT 1 FROM hour_packages p WHERE p.customer_id = c.id)
             OR EXISTS (SELECT 1 FROM time_entries e WHERE e.customer_id = c.id)`,
    args: [`${month}-%`],
  });
  const order = { ueberzogen: 0, knapp: 1, ok: 2, kein_paket: 3 };
  return result.rows
    .map((row) => {
      const purchased = Number(row.purchased);
      const used = Number(row.used);
      return {
        customerId: String(row.id),
        customerName: String(row.name),
        purchased,
        used,
        balance: purchased - used,
        billableThisMonth: Number(row.billable),
        lastEntry: text(row.last_entry),
        status: statusOf(purchased, purchased - used),
      };
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.balance - b.balance || a.customerName.localeCompare(b.customerName));
}

export async function getAccount(customerId: string, month: string): Promise<HourAccount | null> {
  return (await listAccounts(month)).find((a) => a.customerId === customerId) ?? null;
}

/** Gebuchte Minuten eines Monats nach Art – für den Überblick und die Abrechnung. */
export async function monthSummary(month: string): Promise<Record<TimeMode, number>> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT mode, SUM(minutes) AS minutes FROM time_entries WHERE date LIKE ? GROUP BY mode",
    args: [`${month}-%`],
  });
  const summary: Record<TimeMode, number> = { kontingent: 0, verrechnen: 0, intern: 0 };
  for (const row of result.rows) summary[String(row.mode) as TimeMode] = Number(row.minutes);
  return summary;
}

const csvField = (value: string) => (/[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
const decimalHours = (minutes: number) => (minutes / 60).toFixed(2).replace(".", ",");

/** Leistungsnachweis eines Kunden für einen Monat (CSV für Excel) inkl. Summen und Reststand. */
export async function entriesCsv(customerId: string, month: string): Promise<string> {
  const entries = (await listEntries({ customerId, month, limit: 2000 })).reverse();
  const account = await getAccount(customerId, month);
  const lines = [
    ["Datum", "Stunden", "Tätigkeit", "Ticket", "Art"].join(";"),
    ...entries.map((e) =>
      [e.date, decimalHours(e.minutes), e.description, e.ticketId ? `#${e.ticketId}` : "", TIME_MODE_LABELS[e.mode]]
        .map(csvField)
        .join(";"),
    ),
    "",
    ...(["kontingent", "verrechnen", "intern"] as TimeMode[]).map((mode) =>
      [
        "",
        decimalHours(entries.filter((e) => e.mode === mode).reduce((sum, e) => sum + e.minutes, 0)),
        `Summe ${TIME_MODE_LABELS[mode]}`,
        "",
        "",
      ]
        .map(csvField)
        .join(";"),
    ),
    ...(account && account.purchased > 0
      ? [["", decimalHours(account.balance), "Reststand Stundenpaket (aktuell)", "", ""].map(csvField).join(";")]
      : []),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
