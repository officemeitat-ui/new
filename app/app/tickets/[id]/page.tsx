import Link from "next/link";
import { notFound } from "next/navigation";
import { workspace } from "@/config/workspace";
import { changeTicketStatus } from "@/app/app/actions";
import { QuickAddTask, Submit, TicketBriefPanel } from "@/components/workspace/Forms";
import { TimeEntryForm } from "@/components/workspace/HoursForms";
import { localDate } from "@/lib/calendar";
import { formatHours } from "@/lib/workspace/format";
import { getAccount } from "@/lib/workspace/hours";
import { requireAdmin } from "@/lib/auth";
import { ateraConfigured, ateraTicketComments, type TicketComment } from "@/lib/atera";
import { getCustomer, getTicket, listCustomers, TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS } from "@/lib/workspace/customers";
import { ago } from "@/lib/workspace/format";

export default async function TicketPage({ params, searchParams }: PageProps<"/app/tickets/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const { fehler } = await searchParams;
  const ticket = await getTicket(id);
  if (!ticket) notFound();
  const month = localDate(new Date(), workspace.timeZone).slice(0, 7);
  const [customer, customers, account] = await Promise.all([
    ticket.customerId ? getCustomer(ticket.customerId) : null,
    listCustomers(),
    ticket.customerId ? getAccount(ticket.customerId, month) : null,
  ]);
  let comments: TicketComment[] = [];
  let commentsError: string | null = null;
  if (ateraConfigured()) {
    try {
      comments = await ateraTicketComments(ticket.id);
    } catch (error) {
      commentsError = error instanceof Error ? error.message : "Verlauf nicht abrufbar";
    }
  }
  const canChange = ateraConfigured() && workspace.atera.allowStatusChange && (ticket.status === "Open" || ticket.status === "Pending");

  return (
    <div className="space-y-4">
      <Link href="/app/tickets" className="text-sm text-slate-500 hover:text-slate-900">
        ← Tickets
      </Link>
      <header className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm text-slate-500">
          #{ticket.id} · {TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}
          {ticket.priority && ` · ${TICKET_PRIORITY_LABELS[ticket.priority] ?? ticket.priority}`}
          {ticket.type && ` · ${ticket.type}`} · eröffnet {ago(ticket.createdAt)}
        </p>
        <h1 className="mt-1 text-xl font-bold">{ticket.title}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {customer ? (
            <Link href={`/app/kunden/${customer.id}`} className="font-medium text-brand hover:underline">
              {customer.name}
            </Link>
          ) : (
            ticket.customerName
          )}
          {ticket.contactName && ` · ${ticket.contactName}`}
          {ticket.contactPhone && (
            <>
              {" · "}
              <a href={`tel:${ticket.contactPhone}`} className="text-brand hover:underline">
                {ticket.contactPhone}
              </a>
            </>
          )}
          {ticket.contactEmail && (
            <>
              {" · "}
              <a href={`mailto:${ticket.contactEmail}`} className="text-brand hover:underline">
                {ticket.contactEmail}
              </a>
            </>
          )}
        </p>
        {typeof fehler === "string" && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Status nicht geändert: {fehler.slice(0, 200)}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={workspace.atera.ticketUrl.replace("{id}", encodeURIComponent(ticket.id))}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            In Atera öffnen
          </a>
          {customer?.keeperUrl && (
            <a
              href={customer.keeperUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300"
            >
              Zugang in Keeper
            </a>
          )}
          {canChange &&
            (ticket.status === "Open" ? [["Pending", "Auf Wartend setzen"]] : [["Open", "Wieder öffnen"]])
              .concat([["Resolved", "Als gelöst markieren"]])
              .map(([status, label]) => (
                <form key={status} action={changeTicketStatus}>
                  <input type="hidden" name="id" value={ticket.id} />
                  <input type="hidden" name="status" value={status} />
                  <Submit className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
                    {label}
                  </Submit>
                </form>
              ))}
        </div>
      </header>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 font-semibold">KI-Unterstützung</h2>
        <TicketBriefPanel ticketId={ticket.id} />
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">Zeit buchen</h2>
          {account && account.purchased > 0 && (
            <Link href={`/app/stunden/${account.customerId}`} className="text-sm text-slate-500 hover:text-brand">
              Stundenpaket: {formatHours(account.balance)} übrig
            </Link>
          )}
        </div>
        <TimeEntryForm
          customers={customers.map((c) => ({ id: c.id, name: c.name }))}
          customerId={ticket.customerId ?? undefined}
          ticketId={ticket.id}
          defaultDescription={`#${ticket.id} ${ticket.title}`}
          today={localDate(new Date(), workspace.timeZone)}
          roundTo={workspace.hours.roundToMinutes}
        />
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Als Aufgabe merken</h2>
        <QuickAddTask
          lists={workspace.lists}
          customers={customers.map((c) => ({ id: c.id, name: c.name }))}
          customerId={ticket.customerId ?? undefined}
          ticketId={ticket.id}
          defaultTitle={`#${ticket.id} ${ticket.title}`}
        />
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 font-semibold">Verlauf</h2>
        {!ateraConfigured() ? (
          <p className="text-sm text-slate-500">Atera ist nicht verbunden.</p>
        ) : commentsError ? (
          <p className="text-sm text-red-700">{commentsError}</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-slate-500">Noch keine Kommentare.</p>
        ) : (
          <ol className="space-y-3">
            {comments.map((c, i) => (
              <li
                key={i}
                className={`rounded-xl p-3 text-sm ${c.internal ? "bg-amber-50 ring-1 ring-amber-200" : c.fromCustomer ? "bg-slate-50" : "bg-brand-soft"}`}
              >
                <p className="text-xs text-slate-500">
                  {c.author}
                  {c.internal && " · interne Notiz"} · {ago(c.date)}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{c.text}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
