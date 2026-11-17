import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listCustomers } from "@/lib/workspace/customers";
import { HEALTH_STYLE, healthForCustomers } from "@/lib/workspace/health";

export default async function KundenPage({ searchParams }: PageProps<"/app/kunden">) {
  await requireAdmin();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim().toLowerCase() : "";
  const customers = (await listCustomers()).filter((c) => !query || c.name.toLowerCase().includes(query));
  const health = await healthForCustomers(customers.map((c) => c.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Kunden</h1>
        <Link href="/app/doku" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
          Doku durchsuchen
        </Link>
      </div>
      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Kunde suchen …"
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base focus:border-brand focus:outline-none md:text-sm"
        />
      </form>
      {customers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          {query ? "Kein Kunde gefunden." : "Noch keine Kunden – sie kommen beim ersten Atera-Abgleich (Tickets → Jetzt abgleichen)."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          {customers.map((c) => (
            <li key={c.id}>
              <Link href={`/app/kunden/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand">
                  {c.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block text-xs text-slate-500">
                    {c.devices} Geräte{c.offline > 0 && `, ${c.offline} offline`} · {c.openTasks} Aufgaben
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
                  {c.openTickets > 0 && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">{c.openTickets} Tickets</span>}
                  {c.alerts > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">{c.alerts} Warn.</span>}
                  {health.get(c.id) && (
                    <span
                      title={`Gesundheit: ${health.get(c.id)!.grade}`}
                      className={`rounded-lg px-2 py-1 text-sm font-bold tabular-nums ${HEALTH_STYLE[health.get(c.id)!.grade]}`}
                    >
                      {health.get(c.id)!.score}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
