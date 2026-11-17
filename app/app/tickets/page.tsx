import Link from "next/link";
import { SyncButton } from "@/components/workspace/Forms";
import { requireAdmin } from "@/lib/auth";
import { ateraConfigured } from "@/lib/atera";
import { getSyncState, listTickets, TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS } from "@/lib/workspace/customers";
import { ago, PRIORITY_DOT } from "@/lib/workspace/format";
import { outlookConfigured } from "@/lib/workspace/outlook";

const FILTERS = [
  { id: "offen", label: "Alle offenen" },
  { id: "wartend", label: "Wartet auf mich" },
  { id: "dringend", label: "Kritisch & hoch" },
];

export default async function TicketsPage({ searchParams }: PageProps<"/app/tickets">) {
  await requireAdmin();
  const { filter: filterParam } = await searchParams;
  const filter = FILTERS.find((f) => f.id === filterParam)?.id ?? "offen";
  const [all, sync] = await Promise.all([listTickets(), getSyncState("atera")]);
  const tickets = all.filter((t) =>
    filter === "wartend" ? t.waitingForUs : filter === "dringend" ? t.priority === "Critical" || t.priority === "High" : true,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tickets</h1>
          <p className="text-sm text-slate-500">
            {ateraConfigured()
              ? `Aus Atera${sync ? `, abgeglichen ${ago(sync.updatedAt)}` : " – noch nicht abgeglichen"}`
              : "Atera ist nicht verbunden (ATERA_API_KEY)"}
          </p>
        </div>
        {(ateraConfigured() || outlookConfigured()) && <SyncButton todo={outlookConfigured()} />}
      </div>

      <nav className="flex gap-1 overflow-x-auto text-sm font-medium">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={`/app/tickets?filter=${f.id}`}
            className={`rounded-full px-3 py-1.5 whitespace-nowrap ${f.id === filter ? "bg-brand text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
          >
            {f.label}
            <span className="ml-1 opacity-70">
              {f.id === "wartend"
                ? all.filter((t) => t.waitingForUs).length
                : f.id === "dringend"
                  ? all.filter((t) => t.priority === "Critical" || t.priority === "High").length
                  : all.length}
            </span>
          </Link>
        ))}
      </nav>

      {tickets.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">Keine Tickets in dieser Ansicht.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link href={`/app/tickets/${t.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${PRIORITY_DOT[t.priority ?? "Low"] ?? "bg-slate-300"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t.title}</span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    <span>#{t.id}</span>
                    {t.customerName && <span>{t.customerName}</span>}
                    {t.priority && <span>{TICKET_PRIORITY_LABELS[t.priority] ?? t.priority}</span>}
                    <span>{TICKET_STATUS_LABELS[t.status] ?? t.status}</span>
                    {t.technician && <span>{t.technician}</span>}
                    <span>{ago(t.lastCustomerCommentAt ?? t.createdAt)}</span>
                  </span>
                </span>
                {t.waitingForUs && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">wartet</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
