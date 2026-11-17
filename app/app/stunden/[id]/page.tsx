import Link from "next/link";
import { notFound } from "next/navigation";
import { workspace } from "@/config/workspace";
import { removeHourPackage, removeTimeEntry } from "@/app/app/actions";
import { PackageForm, TimeEntryForm } from "@/components/workspace/HoursForms";
import { requireAdmin } from "@/lib/auth";
import { localDate } from "@/lib/calendar";
import { getCustomer } from "@/lib/workspace/customers";
import { BALANCE_STYLE, formatHours, shortDate } from "@/lib/workspace/format";
import { getAccount, listEntries, listPackages, TIME_MODE_LABELS } from "@/lib/workspace/hours";

const euro = (cents: number) => new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(cents / 100);

export default async function StundenkontoPage({ params, searchParams }: PageProps<"/app/stunden/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const { monat } = await searchParams;
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const today = localDate(new Date(), workspace.timeZone);
  const month = typeof monat === "string" && /^\d{4}-\d{2}$/.test(monat) ? monat : today.slice(0, 7);
  const [account, packages, entries, monthEntries] = await Promise.all([
    getAccount(id, today.slice(0, 7)),
    listPackages(id),
    listEntries({ customerId: id, limit: 500 }),
    listEntries({ customerId: id, month, limit: 2000 }),
  ]);
  const balance = account?.balance ?? 0;
  const purchased = account?.purchased ?? 0;
  const style = BALANCE_STYLE[account?.status ?? "kein_paket"];
  const months = [...new Set([today.slice(0, 7), ...entries.map((e) => e.date.slice(0, 7))])].sort().reverse().slice(0, 12);
  const monthLabel = (m: string) =>
    new Intl.DateTimeFormat("de-AT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
  const sum = (mode: string) => monthEntries.filter((e) => e.mode === mode).reduce((total, e) => total + e.minutes, 0);

  return (
    <div className="space-y-4">
      <Link href="/app/stunden" className="text-sm text-slate-500 hover:text-slate-900">
        ← Stunden
      </Link>

      <header className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm text-slate-500">
          Stundenkonto ·{" "}
          <Link href={`/app/kunden/${customer.id}`} className="text-brand hover:underline">
            Kundenakte
          </Link>
        </p>
        <h1 className="text-xl font-bold">{customer.name}</h1>
        <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-2">
          <div>
            <p className="text-xs text-slate-500">Reststand</p>
            <p className={`text-3xl font-bold tabular-nums ${style.className}`}>{purchased > 0 ? formatHours(balance) : "–"}</p>
          </div>
          <div className="text-sm text-slate-600">
            <p>Gekauft: {formatHours(purchased)}</p>
            <p>Verbraucht: {formatHours(account?.used ?? 0)}</p>
          </div>
          {style.label && (
            <span className={`rounded-full bg-slate-100 px-2.5 py-1 text-sm font-semibold ${style.className}`}>{style.label}</span>
          )}
        </div>
        {account?.status === "ueberzogen" && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Das Paket ist um {formatHours(-balance)} überzogen – neues Paket anbieten oder die Stunden separat verrechnen.
          </p>
        )}
        {account?.status === "knapp" && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Nur noch {formatHours(balance)} übrig – rechtzeitig ein neues Paket anbieten.
          </p>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 font-semibold">Zeit buchen</h2>
          <TimeEntryForm customers={[]} customerId={customer.id} today={today} roundTo={workspace.hours.roundToMinutes} />
        </section>
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 font-semibold">Bezahlte Stunden gutschreiben</h2>
          <PackageForm customers={[]} customerId={customer.id} today={today} />
          {packages.length > 0 && (
            <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-sm">
              {packages.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <span className="w-16 shrink-0 font-semibold tabular-nums text-emerald-700">+{formatHours(p.minutes)}</span>
                  <span className="min-w-0 flex-1 text-slate-600">
                    {[shortDate(p.date), p.priceCents !== null ? euro(p.priceCents) : null, p.reference].filter(Boolean).join(" · ")}
                  </span>
                  <form action={removeHourPackage}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="text-xs text-slate-400 hover:text-red-600">
                      Löschen
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Leistungsnachweis</h2>
          <a
            href={`/app/stunden/${customer.id}/export?monat=${month}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            {monthLabel(month)} als CSV
          </a>
        </div>
        <nav className="flex gap-1 overflow-x-auto text-sm font-medium">
          {months.map((m) => (
            <Link
              key={m}
              href={`/app/stunden/${customer.id}?monat=${m}`}
              className={`rounded-full px-3 py-1.5 whitespace-nowrap ${m === month ? "bg-brand text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
            >
              {monthLabel(m)}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-slate-600">
          {formatHours(sum("kontingent"))} vom Paket · {formatHours(sum("verrechnen"))} separat zu verrechnen · {formatHours(sum("intern"))}{" "}
          nicht verrechnet
        </p>
        {monthEntries.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
            Keine Buchungen in diesem Monat.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {monthEntries.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span
                  className={`w-16 shrink-0 font-semibold tabular-nums ${e.mode === "kontingent" ? "text-slate-900" : "text-slate-500"}`}
                >
                  {e.mode === "kontingent" ? "−" : ""}
                  {formatHours(e.minutes)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">{e.description}</span>
                  <span className="block text-xs text-slate-500">
                    {[
                      shortDate(e.date),
                      TIME_MODE_LABELS[e.mode],
                      e.ticketId ? `Ticket #${e.ticketId}` : null,
                      e.source === "assistent" ? "per Assistent" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <form action={removeTimeEntry}>
                  <input type="hidden" name="id" value={e.id} />
                  <button type="submit" className="text-xs text-slate-400 hover:text-red-600">
                    Löschen
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
