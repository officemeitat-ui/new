import Link from "next/link";
import { workspace } from "@/config/workspace";
import { QuickAddTask, TaskCheck } from "@/components/workspace/Forms";
import { requireAdmin } from "@/lib/auth";
import { localDate } from "@/lib/calendar";
import { listCustomers } from "@/lib/workspace/customers";
import { dueLabel } from "@/lib/workspace/format";
import { listTasks, RECURRENCE_LABELS, type Task, type TaskView } from "@/lib/workspace/tasks";

const VIEWS: { id: TaskView; label: string }[] = [
  { id: "heute", label: "Heute" },
  { id: "demnaechst", label: "Demnächst" },
  { id: "alle", label: "Alle offenen" },
  { id: "erledigt", label: "Erledigt" },
];

const TONE: Record<string, string> = {
  overdue: "text-red-600 font-medium",
  today: "text-brand font-medium",
  soon: "text-slate-600",
  later: "text-slate-500",
};

function TaskRow({ task, today }: { task: Task; today: string }) {
  const due = task.dueDate ? dueLabel(task.dueDate, today) : null;
  const done = task.status === "erledigt";
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <TaskCheck id={task.id} done={done} label={task.title} />
      <Link href={`/app/aufgaben/${task.id}`} className="min-w-0 flex-1">
        <span className={`block font-medium ${done ? "text-slate-400 line-through" : ""}`}>
          {task.priority === "hoch" && !done && <span className="mr-1 text-red-500">!</span>}
          {task.title}
        </span>
        <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
          {due && !done && (
            <span className={TONE[due.tone]}>
              {due.label}
              {task.dueTime && ` ${task.dueTime}`}
            </span>
          )}
          {task.customerName && <span>{task.customerName}</span>}
          {task.recurrence && <span>↻ {RECURRENCE_LABELS[task.recurrence]}</span>}
          {task.ticketId && <span>Ticket #{task.ticketId}</span>}
          <span>{task.listName}</span>
          {task.source === "assistent" && <span>vom Assistenten</span>}
        </span>
      </Link>
    </li>
  );
}

export default async function AufgabenPage({ searchParams }: PageProps<"/app/aufgaben">) {
  await requireAdmin();
  const { ansicht, liste } = await searchParams;
  const view = VIEWS.find((v) => v.id === ansicht)?.id ?? "heute";
  const listName = typeof liste === "string" && workspace.lists.includes(liste) ? liste : undefined;
  const today = localDate(new Date(), workspace.timeZone);
  const [tasks, customers] = await Promise.all([listTasks(view, today, { listName }), listCustomers()]);
  const link = (params: Record<string, string | undefined>) => {
    const query = new URLSearchParams(
      Object.entries({ ansicht: view, liste: listName, ...params }).filter(([, v]) => v) as [string, string][],
    );
    return `/app/aufgaben?${query}`;
  };

  // „Alle“ nach Listen gruppieren, sonst eine Liste.
  const groups =
    view === "alle" && !listName
      ? workspace.lists
          .map((l) => ({ name: l, tasks: tasks.filter((t) => t.listName === l) }))
          .concat([{ name: "Sonstige", tasks: tasks.filter((t) => !workspace.lists.includes(t.listName)) }])
          .filter((g) => g.tasks.length > 0)
      : [{ name: null as string | null, tasks }];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Aufgaben</h1>
      <QuickAddTask lists={workspace.lists} customers={customers.map((c) => ({ id: c.id, name: c.name }))} />

      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 text-sm font-medium">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={link({ ansicht: v.id })}
            className={`rounded-full px-3 py-1.5 whitespace-nowrap ${v.id === view ? "bg-brand text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
          >
            {v.label}
          </Link>
        ))}
        <span className="mx-1 w-px shrink-0 bg-slate-200" />
        {workspace.lists.map((l) => (
          <Link
            key={l}
            href={link({ liste: l === listName ? "" : l })}
            className={`rounded-full px-3 py-1.5 whitespace-nowrap ${l === listName ? "bg-slate-800 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
          >
            {l}
          </Link>
        ))}
      </nav>

      {tasks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          {view === "heute" ? "Für heute ist alles erledigt. 🎉" : "Keine Aufgaben in dieser Ansicht."}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.name ?? "alle"}>
            {group.name && <h2 className="mb-2 text-sm font-semibold text-slate-500">{group.name}</h2>}
            <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              {group.tasks.map((task) => (
                <TaskRow key={task.id} task={task} today={today} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
