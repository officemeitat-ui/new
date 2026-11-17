import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { eur } from "@/lib/workspace/catalog";
import { listQuotes, QUOTE_STATUS } from "@/lib/workspace/quotes";
import { shortDate } from "@/lib/workspace/format";

const STATUS_STYLE = {
  entwurf: "bg-slate-100 text-slate-700",
  gesendet: "bg-sky-100 text-sky-800",
  angenommen: "bg-emerald-100 text-emerald-800",
  abgelehnt: "bg-red-100 text-red-800",
};

export default async function AngebotePage() {
  await requireAdmin();
  const quotes = await listQuotes();
  const open = quotes.filter((q) => q.status === "gesendet");
  const won = quotes.filter((q) => q.status === "angenommen");
  const recommended = (q: (typeof quotes)[number]) =>
    q.tiers.find((t) => t.key === q.chosenTier) ?? q.tiers.find((t) => t.recommended) ?? q.tiers[0];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Angebote</h1>
          <p className="text-sm text-slate-500">
            {open.length} offen ({eur(open.reduce((s, q) => s + recommended(q).totalMonthly, 0))} / Monat) · {won.length} angenommen
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/app/radar" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">
            Umsatz-Radar
          </Link>
          <Link href="/app/angebote/neu" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
            + Angebot
          </Link>
        </div>
      </div>
      {quotes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
          Noch keine Angebote – im Umsatz-Radar finden sich Ansatzpunkte.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          {quotes.map((q) => {
            const tier = recommended(q);
            return (
              <li key={q.id}>
                <Link href={`/app/angebote/${q.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="w-28 shrink-0 font-mono text-xs text-slate-500">{q.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{q.title}</span>
                    <span className="text-xs text-slate-500">
                      {q.customerName} · {shortDate(q.createdAt.slice(0, 10))}
                      {q.tiers.length > 1 ? ` · ${q.tiers.length} Pakete` : ""}
                    </span>
                  </span>
                  <span className="text-right text-sm tabular-nums">
                    {tier.totalOnce > 0 && <span className="block">{eur(tier.totalOnce)} einmalig</span>}
                    {tier.totalMonthly > 0 && <span className="block">{eur(tier.totalMonthly)} / Monat</span>}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[q.status]}`}>{QUOTE_STATUS[q.status]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
