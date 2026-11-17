import Link from "next/link";
import { notFound } from "next/navigation";
import { workspace } from "@/config/workspace";
import { CustomerForm, QuickAddTask, TaskCheck } from "@/components/workspace/Forms";
import { requireAdmin } from "@/lib/auth";
import { localDate } from "@/lib/calendar";
import { getCustomer, listAlerts, listCustomers, listDevices, listTickets, TICKET_STATUS_LABELS } from "@/lib/workspace/customers";
import { ago, BALANCE_STYLE, dueLabel, formatHours, PRIORITY_DOT, SEVERITY_STYLE } from "@/lib/workspace/format";
import { getAccount } from "@/lib/workspace/hours";
import { listTasks } from "@/lib/workspace/tasks";

export default async function KundePage({ params }: PageProps<"/app/kunden/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const today = localDate(new Date(), workspace.timeZone);
  const [tickets, alerts, devices, tasks, customers, account] = await Promise.all([
    listTickets({ customerId: id }),
    listAlerts(id),
    listDevices(id),
    listTasks("alle", today, { customerId: id }),
    listCustomers(),
    getAccount(id, today.slice(0, 7)),
  ]);
  const offline = devices.filter((d) => d.online === false).length;

  return (
    <div className="space-y-4">
      <Link href="/app/kunden" className="text-sm text-slate-500 hover:text-slate-900">
        ← Kunden
      </Link>
      <header className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold">{customer.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {[customer.address, customer.ateraId ? `Atera #${customer.ateraId}` : null].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {customer.phone && (
            <a href={`tel:${customer.phone}`} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
              Anrufen
            </a>
          )}
          {customer.email && (
            <a href={`mailto:${customer.email}`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium">
              E-Mail
            </a>
          )}
          <a
            href={customer.keeperUrl ?? workspace.keeper.vaultUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300"
          >
            {customer.keeperUrl ? "Zugänge in Keeper" : "Keeper öffnen"}
          </a>
          <Link
            href={`/app/assistent?frage=${encodeURIComponent(`Wie ist der Stand bei ${customer.name}?`)}`}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium"
          >
            Assistent fragen
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            [tickets.length, "Tickets"],
            [alerts.length, "Warnungen"],
            [`${devices.length - offline}/${devices.length}`, "online"],
            [tasks.length, "Aufgaben"],
          ].map(([value, label]) => (
            <div key={String(label)} className="rounded-xl bg-slate-50 py-2">
              <p className="text-lg font-bold">{value}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </div>
          ))}
        </div>
        <Link
          href={`/app/stunden/${customer.id}`}
          className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm hover:bg-slate-100"
        >
          <span className="font-medium">Stundenkonto</span>
          <span className={`font-semibold tabular-nums ${BALANCE_STYLE[account?.status ?? "kein_paket"].className}`}>
            {account && account.purchased > 0
              ? `${formatHours(account.balance)} übrig${BALANCE_STYLE[account.status].label ? ` · ${BALANCE_STYLE[account.status].label}` : ""}`
              : "kein Paket – Zeit buchen →"}
          </span>
        </Link>
      </header>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 font-semibold">Offene Tickets</h2>
          {tickets.length === 0 ? (
            <p className="text-sm text-slate-500">Keine.</p>
          ) : (
            <ul className="space-y-2">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link href={`/app/tickets/${t.id}`} className="flex items-start gap-2 text-sm">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[t.priority ?? "Low"] ?? "bg-slate-300"}`} />
                    <span>
                      <span className="font-medium">{t.title}</span>
                      <span className="block text-xs text-slate-500">
                        {TICKET_STATUS_LABELS[t.status] ?? t.status}
                        {t.waitingForUs && " · wartet auf dich"} · {ago(t.lastCustomerCommentAt ?? t.createdAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 font-semibold">Warnungen</h2>
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-500">Keine aktiven Warnungen.</p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-sm">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${SEVERITY_STYLE[a.severity ?? ""] ?? "bg-slate-100"}`}>
                    {a.severity ?? "Info"}
                  </span>
                  <span>
                    <span className="font-medium">{a.title}</span>
                    <span className="block text-xs text-slate-500">{[a.deviceName, ago(a.createdAt)].filter(Boolean).join(" · ")}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Geräte</h2>
          {devices.length === 0 ? (
            <p className="text-sm text-slate-500">Keine Geräte aus Atera.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${d.online ? "bg-emerald-500" : d.online === false ? "bg-red-500" : "bg-slate-300"}`}
                  />
                  <span className="min-w-0 flex-1">
                    {d.appUrl ? (
                      <a href={d.appUrl} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                        {d.name}
                      </a>
                    ) : (
                      <span className="font-medium">{d.name}</span>
                    )}
                    <span className="block truncate text-xs text-slate-500">
                      {[d.os, d.loggedUser, d.online === false && d.lastSeen ? `zuletzt ${ago(d.lastSeen)}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">Aufgaben</h2>
        <QuickAddTask lists={workspace.lists} customers={customers.map((c) => ({ id: c.id, name: c.name }))} customerId={customer.id} />
        {tasks.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {tasks.map((task) => {
              const due = task.dueDate ? dueLabel(task.dueDate, today) : null;
              return (
                <li key={task.id} className="flex items-start gap-3 px-4 py-3">
                  <TaskCheck id={task.id} done={false} label={task.title} />
                  <Link href={`/app/aufgaben/${task.id}`} className="min-w-0 flex-1">
                    <span className="block font-medium">{task.title}</span>
                    {due && <span className={`text-xs ${due.tone === "overdue" ? "text-red-600" : "text-slate-500"}`}>{due.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 font-semibold">Stammdaten & Notizen</h2>
        <CustomerForm customer={customer} />
      </section>
    </div>
  );
}
