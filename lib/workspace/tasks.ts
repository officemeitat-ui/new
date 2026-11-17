import "server-only";
import type { Row } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { workspace } from "@/config/workspace";
import { addDays } from "@/lib/calendar";
import { db } from "@/lib/db";

export type TaskPriority = "hoch" | "normal" | "niedrig";
export type TaskStatus = "offen" | "erledigt";
export type TaskRecurrence = "taeglich" | "woechentlich" | "monatlich";
export type TaskSource = "manuell" | "assistent" | "ticket" | "todo" | "email";

export const PRIORITY_LABELS: Record<TaskPriority, string> = { hoch: "Hoch", normal: "Normal", niedrig: "Niedrig" };
export const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  taeglich: "täglich",
  woechentlich: "wöchentlich",
  monatlich: "monatlich",
};

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  listName: string;
  /** JJJJ-MM-TT */
  dueDate: string | null;
  /** HH:MM */
  dueTime: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  recurrence: TaskRecurrence | null;
  customerId: string | null;
  customerName: string | null;
  ticketId: string | null;
  source: TaskSource;
  externalId: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type TaskInput = {
  title: string;
  notes?: string | null;
  listName?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: TaskPriority;
  recurrence?: TaskRecurrence | null;
  customerId?: string | null;
  ticketId?: string | null;
  source: TaskSource;
  externalId?: string | null;
};

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

function toTask(row: Row): Task {
  return {
    id: String(row.id),
    title: String(row.title),
    notes: text(row.notes),
    listName: String(row.list_name),
    dueDate: text(row.due_date),
    dueTime: text(row.due_time),
    priority: String(row.priority) as TaskPriority,
    status: String(row.status) as TaskStatus,
    recurrence: text(row.recurrence) as TaskRecurrence | null,
    customerId: text(row.customer_id),
    customerName: text(row.customer_name),
    ticketId: text(row.ticket_id),
    source: String(row.source) as TaskSource,
    externalId: text(row.external_id),
    completedAt: text(row.completed_at),
    createdAt: String(row.created_at),
  };
}

const SELECT = "SELECT t.*, c.name AS customer_name FROM tasks t LEFT JOIN customers c ON c.id = t.customer_id";
/** Überfällig und hoch zuerst, dann nach Datum und Uhrzeit; ohne Datum ans Ende. */
const ORDER = `ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, COALESCE(t.due_time, '99:99'),
  CASE t.priority WHEN 'hoch' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.created_at`;

export async function createTask(input: TaskInput, now = new Date()): Promise<Task> {
  const client = await db();
  const id = randomUUID();
  const stamp = now.toISOString();
  await client.execute({
    sql: `INSERT INTO tasks (id, title, notes, list_name, due_date, due_time, priority, status, recurrence, customer_id, ticket_id,
            source, external_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'offen', ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.title.trim().slice(0, 300),
      input.notes?.trim() || null,
      input.listName?.trim() || workspace.lists[0],
      input.dueDate || null,
      input.dueDate ? input.dueTime || null : null,
      input.priority ?? "normal",
      input.recurrence ?? null,
      input.customerId ?? null,
      input.ticketId ?? null,
      input.source,
      input.externalId ?? null,
      stamp,
      stamp,
    ],
  });
  return (await getTask(id))!;
}

/** Übernimmt eine Aufgabe aus einem anderen System (z. B. Microsoft To Do) – nur beim ersten Mal. */
export async function importTask(input: TaskInput & { externalId: string }, now = new Date()): Promise<boolean> {
  const client = await db();
  const existing = await client.execute({ sql: "SELECT 1 FROM tasks WHERE external_id = ?", args: [input.externalId] });
  if (existing.rows.length > 0) return false;
  await createTask(input, now);
  return true;
}

export async function getTask(id: string): Promise<Task | null> {
  const client = await db();
  const result = await client.execute({ sql: `${SELECT} WHERE t.id = ?`, args: [id] });
  return result.rows[0] ? toTask(result.rows[0]) : null;
}

export type TaskView = "heute" | "demnaechst" | "alle" | "erledigt";

/**
 * heute: überfällig, heute fällig und dringende ohne Datum · demnaechst: die nächsten 14 Tage
 * alle: alle offenen · erledigt: zuletzt erledigte
 */
export async function listTasks(view: TaskView, today: string, filter: { customerId?: string; listName?: string } = {}): Promise<Task[]> {
  const where: string[] = [];
  const args: string[] = [];
  if (view === "erledigt") where.push("t.status = 'erledigt'");
  else where.push("t.status = 'offen'");
  if (view === "heute") {
    where.push("((t.due_date IS NOT NULL AND t.due_date <= ?) OR (t.due_date IS NULL AND t.priority = 'hoch'))");
    args.push(today);
  }
  if (view === "demnaechst") {
    where.push("t.due_date > ? AND t.due_date <= ?");
    args.push(today, addDays(today, 14));
  }
  if (filter.customerId) {
    where.push("t.customer_id = ?");
    args.push(filter.customerId);
  }
  if (filter.listName) {
    where.push("t.list_name = ?");
    args.push(filter.listName);
  }
  const order = view === "erledigt" ? "ORDER BY t.completed_at DESC LIMIT 100" : ORDER;
  const client = await db();
  const result = await client.execute({ sql: `${SELECT} WHERE ${where.join(" AND ")} ${order}`, args });
  return result.rows.map(toTask);
}

export async function taskCounts(today: string): Promise<{ open: number; today: number; overdue: number }> {
  const client = await db();
  const result = await client.execute({
    sql: `SELECT COUNT(*) AS open,
            SUM(CASE WHEN due_date = ? THEN 1 ELSE 0 END) AS today,
            SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS overdue
          FROM tasks WHERE status = 'offen'`,
    args: [today, today],
  });
  const row = result.rows[0];
  return { open: Number(row?.open ?? 0), today: Number(row?.today ?? 0), overdue: Number(row?.overdue ?? 0) };
}

/** Nächstes Fälligkeitsdatum einer wiederkehrenden Aufgabe (Monatsende wird berücksichtigt). */
export function nextDueDate(date: string, recurrence: TaskRecurrence): string {
  if (recurrence === "taeglich") return addDays(date, 1);
  if (recurrence === "woechentlich") return addDays(date, 7);
  const [year, month, day] = date.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/** Erledigt eine Aufgabe; bei Wiederholung wird die nächste angelegt. Liefert die Folgeaufgabe, falls es eine gibt. */
export async function completeTask(id: string, today: string, now = new Date()): Promise<Task | null> {
  const task = await getTask(id);
  if (!task || task.status === "erledigt") return null;
  const client = await db();
  await client.execute({
    sql: "UPDATE tasks SET status = 'erledigt', completed_at = ?, updated_at = ? WHERE id = ?",
    args: [now.toISOString(), now.toISOString(), id],
  });
  if (!task.recurrence) return null;
  let due = nextDueDate(task.dueDate ?? today, task.recurrence);
  // Lange liegen gebliebene Aufgaben nicht mehrfach nachholen: nächster Termin ab heute.
  while (due <= today) due = nextDueDate(due, task.recurrence);
  return createTask(
    {
      title: task.title,
      notes: task.notes,
      listName: task.listName,
      dueDate: due,
      dueTime: task.dueTime,
      priority: task.priority,
      recurrence: task.recurrence,
      customerId: task.customerId,
      ticketId: task.ticketId,
      source: task.source,
    },
    now,
  );
}

export async function reopenTask(id: string, now = new Date()): Promise<void> {
  const client = await db();
  await client.execute({
    sql: "UPDATE tasks SET status = 'offen', completed_at = NULL, updated_at = ? WHERE id = ?",
    args: [now.toISOString(), id],
  });
}

export async function updateTask(
  id: string,
  fields: Partial<Pick<Task, "title" | "notes" | "listName" | "dueDate" | "dueTime" | "priority" | "recurrence" | "customerId">>,
  now = new Date(),
): Promise<void> {
  const columns: Record<string, string> = {
    title: "title",
    notes: "notes",
    listName: "list_name",
    dueDate: "due_date",
    dueTime: "due_time",
    priority: "priority",
    recurrence: "recurrence",
    customerId: "customer_id",
  };
  const entries = Object.entries(fields).filter(([key, value]) => key in columns && value !== undefined);
  if (entries.length === 0) return;
  const client = await db();
  await client.execute({
    sql: `UPDATE tasks SET ${entries.map(([key]) => `${columns[key]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
    args: [...entries.map(([, value]) => (value as string | null) ?? null), now.toISOString(), id],
  });
}

export async function deleteTask(id: string): Promise<void> {
  const client = await db();
  await client.execute({ sql: "DELETE FROM tasks WHERE id = ?", args: [id] });
}

/** Offene Aufgaben, die auf den Suchbegriff passen – für den Assistenten („erledige das Backup bei Huber“). */
export async function findOpenTasks(query: string, limit = 10): Promise<Task[]> {
  const client = await db();
  const like = `%${query.trim().toLowerCase()}%`;
  const result = await client.execute({
    sql: `${SELECT} WHERE t.status = 'offen' AND (lower(t.title) LIKE ? OR lower(COALESCE(c.name, '')) LIKE ?) ${ORDER} LIMIT ?`,
    args: [like, like, limit],
  });
  return result.rows.map(toTask);
}
