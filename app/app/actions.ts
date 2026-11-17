"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { workspace } from "@/config/workspace";
import { AiError } from "@/lib/ai";
import { requireAdmin } from "@/lib/auth";
import { ateraConfigured, AteraError, ateraTicketComments, updateAteraTicketStatus } from "@/lib/atera";
import { localDate } from "@/lib/calendar";
import { GraphError } from "@/lib/graph";
import { syncAtera } from "@/lib/workspace/atera-sync";
import { getCustomer, getTicket, setTicketStatus, updateCustomer } from "@/lib/workspace/customers";
import { importTodoTasks, outlookConfigured } from "@/lib/workspace/outlook";
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  reopenTask,
  updateTask,
  type TaskPriority,
  type TaskRecurrence,
} from "@/lib/workspace/tasks";
import { briefTicket, type TicketBrief } from "@/lib/workspace/ticket-ai";

export type WorkspaceActionState = { ok?: boolean; error?: string; message?: string };

const today = () => localDate(new Date(), workspace.timeZone);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const PRIORITIES: TaskPriority[] = ["hoch", "normal", "niedrig"];
const RECURRENCES: TaskRecurrence[] = ["taeglich", "woechentlich", "monatlich"];

function refresh() {
  revalidatePath("/app", "layout");
}

function taskFields(formData: FormData) {
  const field = (name: string) => String(formData.get(name) ?? "").trim();
  const dueDate = DATE.test(field("dueDate")) ? field("dueDate") : null;
  const priority = field("priority") as TaskPriority;
  const recurrence = field("recurrence") as TaskRecurrence;
  return {
    title: field("title"),
    notes: field("notes") || null,
    listName: workspace.lists.includes(field("listName")) ? field("listName") : workspace.lists[0],
    dueDate,
    dueTime: dueDate && TIME.test(field("dueTime")) ? field("dueTime") : null,
    priority: PRIORITIES.includes(priority) ? priority : "normal",
    recurrence: RECURRENCES.includes(recurrence) ? recurrence : null,
    customerId: field("customerId") || null,
  };
}

export async function addTask(_prev: WorkspaceActionState, formData: FormData): Promise<WorkspaceActionState> {
  await requireAdmin();
  const fields = taskFields(formData);
  if (!fields.title) return { error: "Bitte einen Titel eingeben" };
  const ticketId = String(formData.get("ticketId") ?? "") || null;
  await createTask({ ...fields, ticketId, source: ticketId ? "ticket" : "manuell" });
  refresh();
  return { ok: true, message: `„${fields.title}“ angelegt` };
}

export async function saveTask(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  const fields = taskFields(formData);
  if (fields.title) await updateTask(id, fields);
  refresh();
  redirect("/app/aufgaben");
}

export async function toggleTask(formData: FormData) {
  await requireAdmin();
  const task = await getTask(String(formData.get("id")));
  if (!task) return;
  if (task.status === "offen") await completeTask(task.id, today());
  else await reopenTask(task.id);
  refresh();
}

export async function removeTask(formData: FormData) {
  await requireAdmin();
  await deleteTask(String(formData.get("id")));
  refresh();
  redirect("/app/aufgaben");
}

export async function saveCustomer(_prev: WorkspaceActionState, formData: FormData): Promise<WorkspaceActionState> {
  await requireAdmin();
  const id = String(formData.get("id"));
  if (!(await getCustomer(id))) return { error: "Kunde nicht gefunden" };
  const field = (name: string) => String(formData.get(name) ?? "");
  const keeperUrl = field("keeperUrl").trim();
  if (keeperUrl && !/^https:\/\//.test(keeperUrl)) return { error: "Der Keeper-Link muss mit https:// beginnen" };
  await updateCustomer(id, {
    domains: field("domains").split(/[,;\s]+/),
    email: field("email"),
    phone: field("phone"),
    address: field("address"),
    keeperUrl,
    notes: field("notes"),
  });
  refresh();
  return { ok: true, message: "Gespeichert" };
}

/** Atera abgleichen und – falls verbunden – offene Aufgaben aus Microsoft To Do übernehmen. */
export async function syncNow(_prev: WorkspaceActionState, _formData: FormData): Promise<WorkspaceActionState> {
  await requireAdmin();
  const parts: string[] = [];
  try {
    if (ateraConfigured()) {
      const result = await syncAtera();
      parts.push(
        `Atera: ${result.customers} Kunden, ${result.tickets} offene Tickets, ${result.alerts} Warnungen, ${result.devices} Geräte`,
      );
    }
    if (outlookConfigured() && _formData.get("todo") === "1") {
      const todo = await importTodoTasks();
      parts.push(`To Do: ${todo.imported} neue Aufgaben aus ${todo.lists} ${todo.lists === 1 ? "Liste" : "Listen"}`);
    }
  } catch (error) {
    if (error instanceof AteraError || error instanceof GraphError) return { error: error.message };
    throw error;
  }
  refresh();
  return parts.length ? { ok: true, message: parts.join(" · ") } : { error: "Weder Atera noch Outlook sind verbunden" };
}

export async function changeTicketStatus(formData: FormData) {
  await requireAdmin();
  const ticket = await getTicket(String(formData.get("id")));
  const status = String(formData.get("status"));
  if (!ticket || !["Open", "Pending", "Resolved", "Closed"].includes(status) || !workspace.atera.allowStatusChange) return;
  try {
    await updateAteraTicketStatus(ticket.id, status);
  } catch (error) {
    if (!(error instanceof AteraError)) throw error;
    redirect(`/app/tickets/${ticket.id}?fehler=${encodeURIComponent(error.message)}`);
  }
  await setTicketStatus(ticket.id, status);
  refresh();
}

export type BriefState = { brief?: TicketBrief; error?: string };

export async function summarizeTicket(_prev: BriefState, formData: FormData): Promise<BriefState> {
  await requireAdmin();
  const ticket = await getTicket(String(formData.get("id")));
  if (!ticket) return { error: "Ticket nicht gefunden" };
  try {
    const comments = ateraConfigured() ? await ateraTicketComments(ticket.id) : [];
    const customer = ticket.customerId ? await getCustomer(ticket.customerId) : null;
    return { brief: await briefTicket(ticket, comments, customer) };
  } catch (error) {
    if (error instanceof AiError || error instanceof AteraError) return { error: error.message };
    throw error;
  }
}
