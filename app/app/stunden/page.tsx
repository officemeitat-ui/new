import Link from "next/link";
import { workspace } from "@/config/workspace";
import { removeTimeEntry } from "@/app/app/actions";
import { PackageForm, TimeEntryForm } from "@/components/workspace/HoursForms";
import { requireAdmin } from "@/lib/auth";
import { localDate } from "@/lib/calendar";
import { listCustomers } from "@/lib/workspace/customers";
import { BALANCE_STYLE, formatHours, shortDate } from "@/lib/workspace/format";
import { listAccounts, listEntries, monthSummary, TIME_MODE_LABELS } from "@/lib/workspace/hours";

export default async function StundenPage() {
  await requireAdmin();
  const today = localDate(new Date(), workspace.timeZone);
  const month = today.slice(0, 7);
  const [accounts, entries, summary, customers] = await Promise.all([
    listAccounts(month),
    listEntries({ limit: 30 }),
    monthSummary(month),
    listCustomers(),
  ]);
  const options = customers.map((c) => ({ id: c.id, name: c.name }));
  const prepaid = accounts.filter((a) => a.purchased > 0);
  const monthName = new Intl.DateTimeFormat("de-AT", { month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Stunden</h1>
        <p className="text-sm text-slate-500">Vorab bezahlte Stundenpakete und gebuchte Zeiten je Kunde.</p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [formatHours(prepaid.reduce((sum, a) => sum + Math.max(0, a.balance), 0)), "offene Paket-Stunden"],
          [formatHours(summary.kontingent), `im ${monthName} vom Paket`],
          [formatHours(summary.verrechnen), `im ${monthName} zu verrechnen`],
          [String(prepaid.filter((a) => a.status === "knapp" || a.status === "ueberzogen").length), "Konten knapp / überzogen"],
        ].map(([value, label]) => (
          <div key={label} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-slate-500">{label}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Stundenkonten</h2>
        {accounts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
            Noch keine Stunden. Unten ein bezahltes Paket gutschreiben oder Zeit buchen.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {accounts.map((a) => {
              const style = BALANCE_STYLE[a.status];
              const share = a.purchased > 0 ? Math.max(0, Math.min(100, (a.balance / a.purchased) * 100)) : 0;
              return (
                <li key={a.customerId}>
                  <Link href={`/app/stunden/${a.customerId}`} className="block px-4 py-3 hover:bg-slate-50">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-medium">{a.customerName}</span>
                      <span className={`shrink-0 text-lg font-bold tabular-nums ${style.className}`}>
                        {a.purchased > 0 ? formatHours(a.balance) : "–"}
                      </span>
                    </div>
                    {a.purchased > 0 && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${a.status === "ok" ? "bg-emerald-500" : a.status === "knapp" ? "bg-amber-500" : "bg-red-500"}`}
                          style={{ width: `${share}%` }}
                        />
                      </div>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      {[
                        a.purchased > 0 ? `${formatHours(a.used)} von ${formatHours(a.purchased)} verbraucht` : "ohne Stundenpaket",
                        style.label,
                        a.billableThisMonth > 0 ? `${formatHours(a.billableThisMonth)} diesen Monat zu verrechnen` : null,
                        a.lastEntry ? `zuletzt ${shortDate(a.lastEntry)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 font-semibold">Zeit buchen</h2>
          <TimeEntryForm customers={options} today={today} roundTo={workspace.hours.roundToMinutes} />
        </section>
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 font-semibold">Bezahlte Stunden gutschreiben</h2>
          <PackageForm customers={options} today={today} />
        </section>
      </div>

      {entries.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Letzte Buchungen</h2>
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="w-14 shrink-0 font-semibold tabular-nums">{formatHours(e.minutes)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block">{e.description}</span>
                  <span className="block text-xs text-slate-500">
                    {[shortDate(e.date), e.customerName, TIME_MODE_LABELS[e.mode], e.ticketId ? `Ticket #${e.ticketId}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <form action={removeTimeEntry}>
                  <input type="hidden" name="id" value={e.id} />
                  <button type="submit" className="text-xs text-slate-400 hover:text-red-600" aria-label="Buchung löschen">
                    Löschen
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
