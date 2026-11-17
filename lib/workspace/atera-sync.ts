import "server-only";
import {
  getAteraTicket,
  listAteraAgents,
  listAteraAlerts,
  listAteraCustomers,
  listAteraTickets,
  type AteraAgent,
  type AteraAlert,
  type AteraTicket,
} from "@/lib/atera";
import { db } from "@/lib/db";
import { setSyncState, upsertAteraCustomer } from "@/lib/workspace/customers";

export type SyncResult = { customers: number; tickets: number; closed: number; alerts: number; devices: number };

const str = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));

/**
 * Spiegelt Kunden, offene Tickets, aktive Warnungen und Geräte aus Atera in die eigene Datenbank.
 * So lädt die App sofort (auch am Handy) und der Assistent kann ohne Wartezeit darauf zugreifen.
 */
export async function syncAtera(now = new Date()): Promise<SyncResult> {
  const stamp = now.toISOString();
  const customerIds = new Map<number, string>();
  const customers = await listAteraCustomers();
  for (const c of customers) customerIds.set(c.CustomerID, await upsertAteraCustomer(String(c.CustomerID), c.CustomerName, now));
  const local = (ateraId: number | undefined) => (ateraId === undefined ? null : (customerIds.get(ateraId) ?? null));

  const [open, pending, alerts, agents] = await Promise.all([
    listAteraTickets("Open"),
    listAteraTickets("Pending"),
    listAteraAlerts(),
    listAteraAgents(),
  ]);
  const client = await db();
  const ticketRow = (t: AteraTicket) => ({
    sql: `INSERT INTO tickets (id, customer_id, customer_name, title, status, priority, type, contact_name, contact_email, contact_phone,
            technician, created_at, resolved_at, last_customer_comment_at, last_technician_comment_at, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET customer_id = excluded.customer_id, customer_name = excluded.customer_name, title = excluded.title,
            status = excluded.status, priority = excluded.priority, type = excluded.type, contact_name = excluded.contact_name,
            contact_email = excluded.contact_email, contact_phone = excluded.contact_phone, technician = excluded.technician,
            created_at = excluded.created_at, resolved_at = excluded.resolved_at,
            last_customer_comment_at = excluded.last_customer_comment_at,
            last_technician_comment_at = excluded.last_technician_comment_at, synced_at = excluded.synced_at`,
    args: [
      String(t.TicketID),
      local(t.CustomerID),
      str(t.CustomerName),
      t.TicketTitle || `Ticket ${t.TicketID}`,
      t.TicketStatus || "Open",
      str(t.TicketPriority),
      str(t.TicketType),
      [t.EndUserFirstName, t.EndUserLastName].filter(Boolean).join(" ") || null,
      str(t.EndUserEmail),
      str(t.EndUserPhone),
      str(t.TechnicianFullName),
      str(t.TicketCreatedDate),
      str(t.TicketResolvedDate),
      str(t.LastEndUserCommentTimestamp),
      str(t.LastTechnicianCommentTimestamp),
      stamp,
    ],
  });
  const active = [...open, ...pending];
  if (active.length > 0) await client.batch(active.map(ticketRow), "write");
  // Erste Reaktion für das SLA-Tracking: erste beobachtete Technikerantwort bzw. erster Statuswechsel weg von „Open“.
  const firstResponse = `UPDATE tickets SET first_response_at = COALESCE(first_response_at, last_technician_comment_at,
    CASE WHEN status != 'Open' THEN COALESCE(resolved_at, synced_at) END) WHERE first_response_at IS NULL`;

  // Tickets, die bei uns noch offen sind, in Atera aber nicht mehr: aktuellen Stand einzeln holen.
  const activeIds = new Set(active.map((t) => String(t.TicketID)));
  const stale = (await client.execute("SELECT id FROM tickets WHERE status IN ('Open', 'Pending')")).rows
    .map((r) => String(r.id))
    .filter((id) => !activeIds.has(id))
    .slice(0, 50);
  for (const id of stale) {
    const ticket = await getAteraTicket(id);
    if (ticket) await client.execute(ticketRow(ticket));
    else await client.execute({ sql: "UPDATE tickets SET status = 'Closed', synced_at = ? WHERE id = ?", args: [stamp, id] });
  }
  await client.execute(firstResponse);

  const alertRow = (a: AteraAlert) => ({
    sql: `INSERT INTO alerts (id, customer_id, customer_name, device_name, title, severity, message, ticket_id, created_at, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      String(a.AlertID),
      local(a.CustomerID),
      str(a.CustomerName),
      str(a.DeviceName),
      a.Title || "Warnung",
      str(a.Severity),
      str(a.AlertMessage ?? a.AdditionalInfo),
      str(a.TicketID),
      str(a.Created),
      stamp,
    ],
  });
  const deviceRow = (d: AteraAgent) => ({
    sql: `INSERT INTO devices (id, customer_id, customer_name, name, os, online, last_seen, logged_user, app_url, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      String(d.AgentID),
      local(d.CustomerID),
      str(d.CustomerName),
      d.MachineName || d.AgentName || `Gerät ${d.AgentID}`,
      str(d.OS),
      d.Online === undefined ? null : d.Online ? 1 : 0,
      str(d.LastSeen),
      str(d.CurrentLoggedUsers),
      str(d.AppViewUrl),
      stamp,
    ],
  });
  // Warnungen und Geräte werden komplett ersetzt – was in Atera weg ist, verschwindet auch hier.
  await client.batch(
    [{ sql: "DELETE FROM alerts", args: [] }, ...alerts.map(alertRow), { sql: "DELETE FROM devices", args: [] }, ...agents.map(deviceRow)],
    "write",
  );

  const result = {
    customers: customers.length,
    tickets: active.length,
    closed: stale.length,
    alerts: alerts.length,
    devices: agents.length,
  };
  await setSyncState("atera", JSON.stringify(result), now);
  return result;
}
