import Link from "next/link";
import { radarTaskAction } from "@/app/app/angebote/actions";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { KIND_LABELS, scanRadar, type OpportunityKind } from "@/lib/radar";
import { eur, mrrByCustomer } from "@/lib/workspace/catalog";

const PRIORITY = { 3: "bg-red-100 text-red-800", 2: "bg-amber-100 text-amber-800", 1: "bg-slate-100 text-slate-600" };

/** Umsatz-Radar: Verkaufschancen mit Begründung und €-Wert – direkt zum Angebot. */
export default async function RadarPage({ searchParams }: PageProps<"/app/radar">) {
  await requireAdmin();
  const { kunde, art } = await searchParams;
  const customerId = typeof kunde === "string" ? kunde : undefined;
  const [radar, mrr] = await Promise.all([scanRadar(customerId), mrrByCustomer()]);
  const kind = typeof art === "string" && art in KIND_LABELS ? (art as OpportunityKind) : null;
  const items = radar.opportunities.filter((o) => !kind || o.kind === kind);
  const tasks = new Set(
    (await (await db()).execute("SELECT external_id FROM tasks WHERE external_id LIKE 'radar:%'")).rows.map((r) => String(r.external_id)),
  );
  const totalMrr = [...mrr.values()].reduce((a, b) => a + b, 0);
  const href = (k: string | null) =>
    `/app/radar?${new URLSearchParams({ ...(customerId ? { kunde: customerId } : {}), ...(k ? { art: k } : {}) })}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Umsatz-Radar{customerId && items[0] ? ` · ${items[0].customer}` : ""}</h1>
        <p className="text-sm text-slate-500">
          Chancen aus Geräten (Support-Ende, Alter), Verträgen, Sicherheit, Domain-Prüfung, NIS2, KI und wiederkehrenden Tickets –
          nachvollziehbar begründet, Werte aus dem Leistungskatalog.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Chancen", String(radar.opportunities.length)],
          ["Einmalig", eur(radar.totalOnce, 0)],
          ["Monatlich", eur(radar.totalMonthly, 0)],
          ["Jahreswert", eur(radar.totalAnnual, 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-slate-200">
            <p className="text-xl font-bold tabular-nums">{value}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">Aktueller wiederkehrender Umsatz (MRR): {eur(totalMrr)} / Monat.</p>
      {radar.inventoryLocked && (
        <p className="rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-600">
          Die Doku ist gesperrt – das Inventar wurde nicht berücksichtigt (nur Geräte aus Atera).{" "}
          <Link href="/app/doku" className="text-brand underline">
            Entsperren
          </Link>
        </p>
      )}
      <nav className="flex flex-wrap gap-1 text-sm">
        <Link
          href={href(null)}
          className={`rounded-full px-3 py-1 ${!kind ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"}`}
        >
          Alle
        </Link>
        {Object.entries(KIND_LABELS).map(([k, label]) => (
          <Link
            key={k}
            href={href(k)}
            className={`rounded-full px-3 py-1 ${kind === k ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
          Keine Chancen gefunden. Tipp: In der Kundenakte unter „Vertrag & Leistungen“ Mitarbeiterzahl, Branche und Paket eintragen.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((o, i) => (
            <li key={`${o.customerId}-${o.code}-${i}`} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-500">
                    <Link href={`/app/kunden/${o.customerId}`} className="hover:underline">
                      {o.customer}
                    </Link>{" "}
                    · {KIND_LABELS[o.kind]}
                  </p>
                  <p className="font-semibold">{o.title}</p>
                  <p className="text-sm text-slate-600">{o.reason}</p>
                  <p className="mt-1 text-xs text-slate-500">Leistung: {o.service}</p>
                </div>
                <div className="text-right">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY[o.priority]}`}>
                    {o.priority === 3 ? "hoch" : o.priority === 2 ? "mittel" : "niedrig"}
                  </span>
                  <p className="mt-1 text-sm tabular-nums">
                    {o.once > 0 && <span className="block">{eur(o.once, 0)} einmalig</span>}
                    {o.monthly > 0 && <span className="block">{eur(o.monthly, 0)} / Monat</span>}
                    {o.annual > 0 && <span className="block text-xs text-slate-500">Jahreswert {eur(o.annual, 0)}</span>}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/app/angebote/neu?${new URLSearchParams({ kunde: o.customerId, leistung: o.code, bedarf: `${o.title}. ${o.reason}` })}`}
                  className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white"
                >
                  Angebot erstellen
                </Link>
                {tasks.has(`radar:${o.customerId}:${o.code}`) ? (
                  <span className="px-2 py-1.5 text-xs text-emerald-700">Aufgabe angelegt ✓</span>
                ) : (
                  <form action={radarTaskAction}>
                    <input type="hidden" name="customerId" value={o.customerId} />
                    <input type="hidden" name="code" value={o.code} />
                    <input type="hidden" name="title" value={`${o.title} (${o.customer})`} />
                    <input type="hidden" name="reason" value={o.reason} />
                    <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
                      Als Aufgabe
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
