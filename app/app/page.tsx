import Link from "next/link";
import { workspace } from "@/config/workspace";
import { CommandBar } from "@/components/workspace/Assistant";
import { TaskCheck } from "@/components/workspace/Forms";
import { requireAdmin } from "@/lib/auth";
import { addDays, localDate, localTime, zonedToUtc } from "@/lib/calendar";
import { listEmails } from "@/lib/emails";
import { openReceiptCount } from "@/lib/receipts/store";
import { getSyncState, listAlerts, listTickets, TICKET_PRIORITY_LABELS } from "@/lib/workspace/customers";
import { ago, BALANCE_STYLE, dueLabel, formatHours, PRIORITY_DOT, SEVERITY_STYLE } from "@/lib/workspace/format";
import { listEvents, outlookConfigured, type CalendarEntry } from "@/lib/workspace/outlook";
import { listTasks } from "@/lib/workspace/tasks";
import { listAccounts } from "@/lib/workspace/hours";

function Card({ title, href, count, children }: { title: string; href?: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold">
          {title}
          {count !== undefined && <span className="ml-2 text-sm font-normal text-slate-500">{count}</span>}
        </h2>
        {href && (
          <Link href={href} className="text-sm font-medium text-brand hover:underline">
            Alle →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-slate-500">{children}</p>;

export default async function HeutePage() {
  await requireAdmin();
  const now = new Date();
  const today = localDate(now, workspace.timeZone);
  const hour = Number(localTime(now, workspace.timeZone).slice(0, 2));
  const greeting = hour < 11 ? "Guten Morgen" : hour < 18 ? "Hallo" : "Guten Abend";
  const dateLabel = new Intl.DateTimeFormat("de-AT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: workspace.timeZone,
  }).format(now);

  let events: CalendarEntry[] | null = null;
  let calendarError: string | null = null;
  if (outlookConfigured()) {
    try {
      events = await listEvents(zonedToUtc(today, "00:00", workspace.timeZone), zonedToUtc(addDays(today, 1), "00:00", workspace.timeZone));
    } catch (error) {
      calendarError = error instanceof Error ? error.message : "Kalender nicht erreichbar";
    }
  }
  const [tasks, tickets, alerts, drafts, receipts, sync, accounts] = await Promise.all([
    listTasks("heute", today),
    listTickets(),
    listAlerts(),
    listEmails(["entwurf"]),
    openReceiptCount(),
    getSyncState("atera"),
    listAccounts(today.slice(0, 7)),
  ]);
  const waiting = tickets.filter((t) => t.waitingForUs);
  const urgentTickets = tickets.filter((t) => t.priority === "Critical" || t.priority === "High");
  const ticketFocus = [...new Map([...urgentTickets, ...waiting].map((t) => [t.id, t])).values()].slice(0, 6);
  const critical = alerts.filter((a) => a.severity === "Critical");
  const lowAccounts = accounts.filter((a) => a.status === "knapp" || a.status === "ueberzogen");

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-slate-500 capitalize">{dateLabel}</p>
        <h1 className="text-2xl font-bold">
          {greeting}, {workspace.ownerName}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {tasks.length} {tasks.length === 1 ? "Aufgabe" : "Aufgaben"} für heute · {waiting.length}{" "}
          {waiting.length === 1 ? "Ticket wartet" : "Tickets warten"} auf dich
          {critical.length > 0 && ` · ${critical.length} kritische Warnung${critical.length === 1 ? "" : "en"}`}
          {events && ` · ${events.length} Termin${events.length === 1 ? "" : "e"}`}
        </p>
      </header>

      <CommandBar />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Termine heute" count={events?.length}>
          {!outlookConfigured() ? (
            <Empty>Outlook-Kalender ist nicht verbunden (MS_* in der Umgebung).</Empty>
          ) : calendarError ? (
            <p className="text-sm text-red-700">{calendarError}</p>
          ) : events!.length === 0 ? (
            <Empty>Keine Termine – freie Bahn.</Empty>
          ) : (
            <ul className="space-y-2">
              {events!.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className="w-24 shrink-0 font-medium tabular-nums text-slate-600">
                    {e.isAllDay ? "ganztägig" : `${localTime(e.start, workspace.timeZone)}–${localTime(e.end, workspace.timeZone)}`}
                  </span>
                  <span>
                    {e.webLink ? (
                      <a href={e.webLink} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                        {e.subject}
                      </a>
                    ) : (
                      <span className="font-medium">{e.subject}</span>
                    )}
                    {e.location && <span className="block text-slate-500">{e.location}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Aufgaben" count={tasks.length} href="/app/aufgaben">
          {tasks.length === 0 ? (
            <Empty>Nichts fällig. Sag dem Assistenten einfach, was dir einfällt.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {tasks.slice(0, 8).map((task) => {
                const due = task.dueDate ? dueLabel(task.dueDate, today) : null;
                return (
                  <li key={task.id} className="flex items-start gap-3">
                    <TaskCheck id={task.id} done={false} label={task.title} />
                    <Link href={`/app/aufgaben/${task.id}`} className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{task.title}</span>
                      <span className="block text-xs text-slate-500">
                        {[
                          due && (due.tone === "overdue" ? `⚠ ${due.label}` : due.label),
                          task.dueTime,
                          task.customerName,
                          task.priority === "hoch" ? "dringend" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Tickets im Fokus" count={tickets.length} href="/app/tickets">
          {tickets.length === 0 ? (
            <Empty>{sync ? "Keine offenen Tickets." : "Atera ist noch nicht abgeglichen – siehe Tickets."}</Empty>
          ) : ticketFocus.length === 0 ? (
            <Empty>Nichts Dringendes, nichts wartet auf dich.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {ticketFocus.map((t) => (
                <li key={t.id}>
                  <Link href={`/app/tickets/${t.id}`} className="flex items-start gap-3">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${PRIORITY_DOT[t.priority ?? "Low"] ?? "bg-slate-300"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.title}</span>
                      <span className="block text-xs text-slate-500">
                        {[
                          t.customerName,
                          t.priority ? TICKET_PRIORITY_LABELS[t.priority] : null,
                          t.waitingForUs ? "wartet auf dich" : null,
                          ago(t.lastCustomerCommentAt ?? t.createdAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Warnungen" count={alerts.length} href="/app/kunden">
          {alerts.length === 0 ? (
            <Empty>Keine aktiven Warnungen.</Empty>
          ) : (
            <ul className="space-y-2">
              {alerts.slice(0, 6).map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-sm">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${SEVERITY_STYLE[a.severity ?? ""] ?? "bg-slate-100 text-slate-700"}`}
                  >
                    {a.severity === "Critical" ? "Kritisch" : a.severity === "Warning" ? "Warnung" : "Info"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{a.title}</span>
                    <span className="block text-xs text-slate-500">
                      {[a.customerName, a.deviceName, ago(a.createdAt)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {lowAccounts.length > 0 && (
          <Card title="Stundenpakete knapp" count={lowAccounts.length} href="/app/stunden">
            <ul className="space-y-2">
              {lowAccounts.slice(0, 6).map((a) => (
                <li key={a.customerId}>
                  <Link href={`/app/stunden/${a.customerId}`} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium">{a.customerName}</span>
                    <span className={`shrink-0 font-semibold tabular-nums ${BALANCE_STYLE[a.status].className}`}>
                      {formatHours(a.balance)} {a.status === "ueberzogen" ? "überzogen" : "übrig"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link href="/admin/emails" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-brand">
          <p className="text-2xl font-bold">{drafts.length}</p>
          <p className="text-sm text-slate-500">E-Mail-Entwürfe warten</p>
        </Link>
        <Link href="/admin/belege" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-brand">
          <p className={`text-2xl font-bold ${receipts > 0 ? "text-amber-600" : ""}`}>{receipts}</p>
          <p className="text-sm text-slate-500">Belege prüfen</p>
        </Link>
        <Link href="/app/tickets?filter=wartend" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-brand">
          <p className={`text-2xl font-bold ${waiting.length > 0 ? "text-amber-600" : ""}`}>{waiting.length}</p>
          <p className="text-sm text-slate-500">Tickets warten auf dich</p>
        </Link>
        <Link href="/app/kunden" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-brand">
          <p className={`text-2xl font-bold ${critical.length > 0 ? "text-red-600" : ""}`}>{critical.length}</p>
          <p className="text-sm text-slate-500">kritische Warnungen</p>
        </Link>
      </section>
      {sync && <p className="text-xs text-slate-400">Atera zuletzt abgeglichen: {ago(sync.updatedAt, now)}</p>}
    </div>
  );
}
