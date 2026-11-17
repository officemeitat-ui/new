import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteQuoteAction, setStatusAction } from "@/app/app/angebote/actions";
import { PrintButtons } from "@/components/awareness/PrintButton";
import { QuoteDraftButton } from "@/components/workspace/QuoteUI";
import { workspace } from "@/config/workspace";
import { requireAdmin } from "@/lib/auth";
import { eur } from "@/lib/workspace/catalog";
import { getCustomer } from "@/lib/workspace/customers";
import { getQuote, QUOTE_STATUS, type QuoteTier } from "@/lib/workspace/quotes";

const date = (iso: string, days = 0) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("de-AT", { dateStyle: "long", timeZone: workspace.timeZone }).format(d);
};

function ItemsTable({ tier }: { tier: QuoteTier }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-slate-500">
        <tr className="border-b border-slate-200">
          <th className="py-1.5 text-left font-medium">Leistung</th>
          <th className="py-1.5 pl-3 text-right font-medium">Menge</th>
          <th className="py-1.5 pl-4 text-right font-medium">Einzelpreis</th>
          <th className="py-1.5 pl-4 text-right font-medium">Gesamt</th>
        </tr>
      </thead>
      <tbody>
        {tier.items.map((item) => (
          <tr key={item.code} className="border-b border-slate-100 align-top">
            <td className="py-2 pr-3">
              <span className="font-medium">{item.name}</span>
              <span className="block text-xs text-slate-500">
                {item.description}
                {item.reason && item.reason !== "Premium-Ergänzung" ? ` – ${item.reason}` : ""}
              </span>
            </td>
            <td className="py-2 pl-3 text-right whitespace-nowrap tabular-nums">
              {item.quantity.toLocaleString("de-AT")} {item.unit.replace(/\/Monat$/, "")}
            </td>
            <td className="py-2 pl-4 text-right whitespace-nowrap tabular-nums">
              {eur(item.price)}
              {item.recurring ? " /Mon." : ""}
            </td>
            <td className="py-2 pl-4 text-right whitespace-nowrap tabular-nums">
              {eur(item.total)}
              {item.recurring ? " /Mon." : ""}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot className="text-sm">
        {tier.totalOnce > 0 && (
          <tr>
            <td colSpan={3} className="pt-2 pr-4 text-right">
              Einmalig netto · zzgl. 20 % USt. · brutto
            </td>
            <td className="pt-2 text-right font-semibold whitespace-nowrap tabular-nums">
              {eur(tier.totalOnce)} · {eur(tier.totalOnce * 0.2)} · {eur(tier.totalOnce * 1.2)}
            </td>
          </tr>
        )}
        {tier.totalMonthly > 0 && (
          <tr>
            <td colSpan={3} className="pr-4 text-right">
              Monatlich netto · brutto
            </td>
            <td className="text-right font-semibold whitespace-nowrap tabular-nums">
              {eur(tier.totalMonthly)} · {eur(tier.totalMonthly * 1.2)}
            </td>
          </tr>
        )}
      </tfoot>
    </table>
  );
}

export default async function AngebotPage({ params, searchParams }: PageProps<"/app/angebote/[id]">) {
  const user = await requireAdmin();
  const { id } = await params;
  const { hinweis } = await searchParams;
  const quote = await getQuote(id);
  if (!quote) notFound();
  const customer = await getCustomer(quote.customerId);
  const recommended = quote.tiers.find((t) => t.key === quote.chosenTier) ?? quote.tiers.find((t) => t.recommended) ?? quote.tiers[0];

  return (
    <div className="space-y-4">
      <PrintButtons />
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/app/angebote" className="text-sm text-slate-500 hover:text-slate-900">
          ← Angebote
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium">{QUOTE_STATUS[quote.status]}</span>
          <button type="button" data-print className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white">
            Drucken / PDF
          </button>
          {user.role === "inhaber" && quote.status !== "angenommen" && <QuoteDraftButton id={quote.id} />}
        </div>
      </div>
      {typeof hinweis === "string" && <p className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900 print:hidden">{hinweis}</p>}

      <article className="space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-10 print:p-0 print:shadow-none print:ring-0">
        <header className="flex flex-wrap justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-lg font-bold">{workspace.company}</p>
            <p className="mt-4 text-sm">
              {customer?.name}
              {customer?.address ? <span className="block text-slate-600">{customer.address}</span> : null}
            </p>
          </div>
          <dl className="text-right text-sm">
            <dt className="text-xs text-slate-500">Angebot</dt>
            <dd className="font-mono font-semibold">{quote.number}</dd>
            <dt className="mt-1 text-xs text-slate-500">Datum</dt>
            <dd>{date(quote.createdAt)}</dd>
            <dt className="mt-1 text-xs text-slate-500">Gültig bis</dt>
            <dd>{date(quote.createdAt, 30)}</dd>
          </dl>
        </header>
        <h1 className="text-2xl font-bold">{quote.title}</h1>
        <p className="text-sm leading-relaxed">Guten Tag, {quote.intro}</p>

        {quote.tiers.length > 1 && (
          <section className="grid gap-3 sm:grid-cols-3">
            {quote.tiers.map((tier) => (
              <div
                key={tier.key}
                className={`rounded-xl p-4 ring-1 ${tier.key === recommended.key ? "bg-brand-soft ring-2 ring-brand" : "ring-slate-200"}`}
              >
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  {tier.recommended ? "Unsere Empfehlung" : tier.key === "XL" ? "Rundum-sorglos" : "Einstieg"}
                </p>
                <p className="font-bold">{tier.label}</p>
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs">
                  {tier.items.map((i) => (
                    <li key={i.code}>{i.name}</li>
                  ))}
                </ul>
                <p className="mt-3 text-sm tabular-nums">
                  {tier.totalOnce > 0 && <span className="block">{eur(tier.totalOnce)} einmalig</span>}
                  {tier.totalMonthly > 0 && <span className="block font-semibold">{eur(tier.totalMonthly)} / Monat</span>}
                </p>
              </div>
            ))}
          </section>
        )}

        <section className="space-y-2">
          <h2 className="font-semibold">{quote.tiers.length > 1 ? `${recommended.label} im Detail` : "Leistungen"}</h2>
          <ItemsTable tier={recommended} />
        </section>
        {quote.tiers
          .filter((t) => t.key !== recommended.key)
          .map((tier) => (
            <details key={tier.key}>
              <summary className="cursor-pointer text-sm font-semibold">{tier.label} im Detail</summary>
              <div className="mt-2">
                <ItemsTable tier={tier} />
              </div>
            </details>
          ))}
        {quote.notes && <p className="text-sm text-slate-600">Hinweise: {quote.notes}</p>}
        <p className="text-xs text-slate-500">
          Alle Preise in EUR zzgl. 20 % USt. Laufende Leistungen monatlich im Voraus. Angebot gültig 30 Tage.
        </p>
      </article>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 print:hidden">
        <h2 className="font-semibold">Status</h2>
        {quote.status === "angenommen" ? (
          <p className="text-sm text-emerald-800">
            Angenommen{quote.decidedAt ? ` am ${date(quote.decidedAt)}` : ""} – {recommended.label}. Die laufenden Leistungen sind beim
            Kunden gebucht.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <form action={setStatusAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={quote.id} />
              <input type="hidden" name="status" value="angenommen" />
              {quote.tiers.length > 1 && (
                <select
                  name="tier"
                  defaultValue={recommended.key}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  aria-label="Paket"
                >
                  {quote.tiers.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              )}
              <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white">
                Angenommen
              </button>
            </form>
            {quote.status === "entwurf" && (
              <form action={setStatusAction}>
                <input type="hidden" name="id" value={quote.id} />
                <input type="hidden" name="status" value="gesendet" />
                <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium">
                  Als gesendet markieren
                </button>
              </form>
            )}
            <form action={setStatusAction}>
              <input type="hidden" name="id" value={quote.id} />
              <input type="hidden" name="status" value="abgelehnt" />
              <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-red-700">
                Abgelehnt
              </button>
            </form>
            <form action={deleteQuoteAction}>
              <input type="hidden" name="id" value={quote.id} />
              <button type="submit" className="px-3 py-1.5 text-sm text-slate-400 hover:text-red-700">
                Löschen
              </button>
            </form>
          </div>
        )}
        {quote.need && (
          <details>
            <summary className="cursor-pointer text-sm text-slate-500">Gesprächsnotizen</summary>
            <p className="mt-1 text-sm whitespace-pre-wrap text-slate-600">{quote.need}</p>
          </details>
        )}
        <p className="text-xs text-slate-400">
          Erstellt von {quote.createdBy ?? "–"} ·{" "}
          {quote.provider === "claude" ? "Auswahl und Text: Claude, Preise: Katalog" : "Auswahl nach Stichworten"}
        </p>
      </section>
    </div>
  );
}
