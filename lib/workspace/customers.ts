import "server-only";
import type { Row } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

// Kunden des IT-Dienstleisters mit dem, was aus Atera gespiegelt wird: Tickets, Warnungen, Geräte.

export type Customer = {
  id: string;
  name: string;
  ateraId: string | null;
  /** E-Mail-Domains, an denen Mails dem Kunden zugeordnet werden (kommagetrennt gespeichert). */
  domains: string[];
  email: string | null;
  phone: string | null;
  address: string | null;
  /** Link zum Ordner oder Datensatz in Keeper – Passwörter selbst liegen nie hier. */
  keeperUrl: string | null;
  notes: string | null;
};

export type CustomerOverview = Customer & { openTickets: number; alerts: number; devices: number; offline: number; openTasks: number };

export type TicketStatus = "Open" | "Pending" | "Resolved" | "Closed";
export const TICKET_STATUS_LABELS: Record<string, string> = {
  Open: "Offen",
  Pending: "Wartend",
  Resolved: "Gelöst",
  Closed: "Geschlossen",
};
export const TICKET_PRIORITY_LABELS: Record<string, string> = {
  Critical: "Kritisch",
  High: "Hoch",
  Medium: "Mittel",
  Low: "Niedrig",
};

export type Ticket = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  title: string;
  status: string;
  priority: string | null;
  type: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  technician: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  lastCustomerCommentAt: string | null;
  lastTechnicianCommentAt: string | null;
  /** Letzte Nachricht kam vom Kunden (oder noch gar keine Antwort): Ball liegt bei uns. */
  waitingForUs: boolean;
};

export type Alert = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  deviceName: string | null;
  title: string;
  severity: string | null;
  message: string | null;
  ticketId: string | null;
  createdAt: string | null;
};

export type Device = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  name: string;
  os: string | null;
  online: boolean | null;
  lastSeen: string | null;
  loggedUser: string | null;
  appUrl: string | null;
};

const text = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));

function toCustomer(row: Row): Customer {
  return {
    id: String(row.id),
    name: String(row.name),
    ateraId: text(row.atera_id),
    domains: (text(row.domains) ?? "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    email: text(row.email),
    phone: text(row.phone),
    address: text(row.address),
    keeperUrl: text(row.keeper_url),
    notes: text(row.notes),
  };
}

export function toTicket(row: Row): Ticket {
  const customer = text(row.last_customer_comment_at);
  const technician = text(row.last_technician_comment_at);
  const open = row.status === "Open" || row.status === "Pending";
  return {
    id: String(row.id),
    customerId: text(row.customer_id),
    customerName: text(row.customer_name),
    title: String(row.title),
    status: String(row.status),
    priority: text(row.priority),
    type: text(row.type),
    contactName: text(row.contact_name),
    contactEmail: text(row.contact_email),
    contactPhone: text(row.contact_phone),
    technician: text(row.technician),
    createdAt: text(row.created_at),
    resolvedAt: text(row.resolved_at),
    lastCustomerCommentAt: customer,
    lastTechnicianCommentAt: technician,
    waitingForUs: open && row.status !== "Pending" && (!technician || (customer !== null && customer > technician)),
  };
}

function toAlert(row: Row): Alert {
  return {
    id: String(row.id),
    customerId: text(row.customer_id),
    customerName: text(row.customer_name),
    deviceName: text(row.device_name),
    title: String(row.title),
    severity: text(row.severity),
    message: text(row.message),
    ticketId: text(row.ticket_id),
    createdAt: text(row.created_at),
  };
}

function toDevice(row: Row): Device {
  return {
    id: String(row.id),
    customerId: text(row.customer_id),
    customerName: text(row.customer_name),
    name: String(row.name),
    os: text(row.os),
    online: row.online === null || row.online === undefined ? null : Number(row.online) === 1,
    lastSeen: text(row.last_seen),
    loggedUser: text(row.logged_user),
    appUrl: text(row.app_url),
  };
}

export async function createCustomer(input: { name: string; ateraId?: string | null }, now = new Date()): Promise<Customer> {
  const client = await db();
  const id = randomUUID();
  await client.execute({
    sql: "INSERT INTO customers (id, name, atera_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    args: [id, input.name.trim(), input.ateraId ?? null, now.toISOString(), now.toISOString()],
  });
  return (await getCustomer(id))!;
}

/** Legt Atera-Kunden an bzw. aktualisiert den Namen; eigene Angaben (Keeper-Link, Notizen) bleiben erhalten. */
export async function upsertAteraCustomer(ateraId: string, name: string, now = new Date()): Promise<string> {
  const client = await db();
  const existing = await client.execute({ sql: "SELECT id FROM customers WHERE atera_id = ?", args: [ateraId] });
  if (existing.rows[0]) {
    await client.execute({
      sql: "UPDATE customers SET name = ?, updated_at = ? WHERE atera_id = ?",
      args: [name, now.toISOString(), ateraId],
    });
    return String(existing.rows[0].id);
  }
  return (await createCustomer({ name, ateraId }, now)).id;
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM customers WHERE id = ?", args: [id] });
  return result.rows[0] ? toCustomer(result.rows[0]) : null;
}

export async function updateCustomer(
  id: string,
  fields: {
    domains?: string[];
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    keeperUrl?: string | null;
    notes?: string | null;
  },
  now = new Date(),
): Promise<void> {
  const client = await db();
  const sets: string[] = [];
  const args: (string | null)[] = [];
  const set = (column: string, value: string | null | undefined) => {
    if (value === undefined) return;
    sets.push(`${column} = ?`);
    args.push(value?.trim() || null);
  };
  set(
    "domains",
    fields.domains
      ?.map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean)
      .join(","),
  );
  set("email", fields.email);
  set("phone", fields.phone);
  set("address", fields.address);
  set("keeper_url", fields.keeperUrl);
  set("notes", fields.notes);
  if (sets.length === 0) return;
  await client.execute({
    sql: `UPDATE customers SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`,
    args: [...args, now.toISOString(), id],
  });
}

export async function listCustomers(): Promise<CustomerOverview[]> {
  const client = await db();
  const result = await client.execute(`
    SELECT c.*,
      (SELECT COUNT(*) FROM tickets t WHERE t.customer_id = c.id AND t.status IN ('Open', 'Pending')) AS open_tickets,
      (SELECT COUNT(*) FROM alerts a WHERE a.customer_id = c.id) AS alert_count,
      (SELECT COUNT(*) FROM devices d WHERE d.customer_id = c.id) AS device_count,
      (SELECT COUNT(*) FROM devices d WHERE d.customer_id = c.id AND d.online = 0) AS offline_count,
      (SELECT COUNT(*) FROM tasks k WHERE k.customer_id = c.id AND k.status = 'offen') AS open_tasks
    FROM customers c ORDER BY lower(c.name)`);
  return result.rows.map((row) => ({
    ...toCustomer(row),
    openTickets: Number(row.open_tickets),
    alerts: Number(row.alert_count),
    devices: Number(row.device_count),
    offline: Number(row.offline_count),
    openTasks: Number(row.open_tasks),
  }));
}

/** Findet einen Kunden zu einer Angabe wie „Huber“, „huber-stb.at“ oder einer E-Mail-Adresse. */
export async function findCustomer(query: string): Promise<Customer | null> {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const customers = (await listCustomers()) as Customer[];
  const domain = needle.includes("@") ? needle.split("@").pop()! : needle;
  return (
    customers.find((c) => c.name.toLowerCase() === needle) ??
    customers.find((c) => c.domains.some((d) => domain === d || domain.endsWith(`.${d}`))) ??
    customers.find((c) => c.name.toLowerCase().includes(needle)) ??
    customers.find((c) => needle.split(/\s+/).some((word) => word.length > 2 && c.name.toLowerCase().includes(word))) ??
    null
  );
}

export async function listTickets(filter: { status?: "offen" | "alle"; customerId?: string } = {}): Promise<Ticket[]> {
  const where: string[] = [];
  const args: string[] = [];
  if (filter.status !== "alle") where.push("status IN ('Open', 'Pending')");
  if (filter.customerId) {
    where.push("customer_id = ?");
    args.push(filter.customerId);
  }
  const client = await db();
  const result = await client.execute({
    sql: `SELECT * FROM tickets ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY CASE priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, created_at DESC LIMIT 300`,
    args,
  });
  return result.rows.map(toTicket);
}

export async function getTicket(id: string): Promise<Ticket | null> {
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM tickets WHERE id = ?", args: [id] });
  return result.rows[0] ? toTicket(result.rows[0]) : null;
}

export async function setTicketStatus(id: string, status: string): Promise<void> {
  const client = await db();
  await client.execute({ sql: "UPDATE tickets SET status = ? WHERE id = ?", args: [status, id] });
}

export async function listAlerts(customerId?: string): Promise<Alert[]> {
  const client = await db();
  const result = await client.execute({
    sql: `SELECT * FROM alerts ${customerId ? "WHERE customer_id = ?" : ""}
          ORDER BY CASE severity WHEN 'Critical' THEN 0 WHEN 'Warning' THEN 1 ELSE 2 END, created_at DESC LIMIT 200`,
    args: customerId ? [customerId] : [],
  });
  return result.rows.map(toAlert);
}

export async function listDevices(customerId: string): Promise<Device[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM devices WHERE customer_id = ? ORDER BY online, lower(name)",
    args: [customerId],
  });
  return result.rows.map(toDevice);
}

export async function getSyncState(key: string): Promise<{ value: string | null; updatedAt: string } | null> {
  const client = await db();
  const result = await client.execute({ sql: "SELECT value, updated_at FROM sync_state WHERE key = ?", args: [key] });
  const row = result.rows[0];
  return row ? { value: text(row.value), updatedAt: String(row.updated_at) } : null;
}

export async function setSyncState(key: string, value: string | null, now = new Date()): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, value, now.toISOString()],
  });
}
