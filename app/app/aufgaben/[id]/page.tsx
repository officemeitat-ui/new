import Link from "next/link";
import { notFound } from "next/navigation";
import { workspace } from "@/config/workspace";
import { removeTask, saveTask } from "@/app/app/actions";
import { Submit } from "@/components/workspace/Forms";
import { requireAdmin } from "@/lib/auth";
import { listCustomers } from "@/lib/workspace/customers";
import { getTask } from "@/lib/workspace/tasks";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base md:text-sm focus:border-brand focus:outline-none";

export default async function AufgabePage({ params }: PageProps<"/app/aufgaben/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const [task, customers] = await Promise.all([getTask(id), listCustomers()]);
  if (!task) notFound();

  return (
    <div className="space-y-4">
      <Link href="/app/aufgaben" className="text-sm text-slate-500 hover:text-slate-900">
        ← Aufgaben
      </Link>
      <form action={saveTask} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <input type="hidden" name="id" value={task.id} />
        <label className="block text-xs text-slate-500">
          Titel
          <input name="title" required defaultValue={task.title} className={input} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-slate-500">
            Fällig am
            <input type="date" name="dueDate" defaultValue={task.dueDate ?? ""} className={input} />
          </label>
          <label className="text-xs text-slate-500">
            Uhrzeit
            <input type="time" name="dueTime" defaultValue={task.dueTime ?? ""} className={input} />
          </label>
          <label className="text-xs text-slate-500">
            Priorität
            <select name="priority" defaultValue={task.priority} className={input}>
              <option value="hoch">Hoch</option>
              <option value="normal">Normal</option>
              <option value="niedrig">Niedrig</option>
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Liste
            <select name="listName" defaultValue={task.listName} className={input}>
              {workspace.lists.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Kunde
            <select name="customerId" defaultValue={task.customerId ?? ""} className={input}>
              <option value="">–</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Wiederholen
            <select name="recurrence" defaultValue={task.recurrence ?? ""} className={input}>
              <option value="">nie</option>
              <option value="taeglich">täglich</option>
              <option value="woechentlich">wöchentlich</option>
              <option value="monatlich">monatlich</option>
            </select>
          </label>
        </div>
        <label className="block text-xs text-slate-500">
          Notiz
          <textarea name="notes" rows={5} defaultValue={task.notes ?? ""} className={input} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Submit>Speichern</Submit>
          {task.ticketId && (
            <Link href={`/app/tickets/${task.ticketId}`} className="text-sm font-medium text-brand hover:underline">
              Zum Ticket #{task.ticketId}
            </Link>
          )}
          {task.customerId && (
            <Link href={`/app/kunden/${task.customerId}`} className="text-sm font-medium text-brand hover:underline">
              Zum Kunden
            </Link>
          )}
        </div>
      </form>
      <form action={removeTask}>
        <input type="hidden" name="id" value={task.id} />
        <button type="submit" className="text-sm text-red-600 hover:underline">
          Aufgabe löschen
        </button>
      </form>
    </div>
  );
}
