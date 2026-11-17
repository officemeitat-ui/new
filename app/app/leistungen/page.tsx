import { ServicePriceForm } from "@/components/workspace/ContractUI";
import { requireAdmin } from "@/lib/auth";
import { eur, listServices, mrrByCustomer } from "@/lib/workspace/catalog";

/** Leistungskatalog mit Preisen – Grundlage für Angebote, MRR und Umsatz-Radar. */
export default async function LeistungenPage() {
  const user = await requireAdmin();
  const [services, mrr] = await Promise.all([listServices(true), mrrByCustomer()]);
  const total = [...mrr.values()].reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Leistungen & Preise</h1>
          <p className="text-sm text-slate-500">
            Netto-Preise. Angebote und Radar rechnen damit – die KI wählt nur aus, gerechnet wird im Code.
          </p>
        </div>
        <p className="rounded-xl bg-white px-4 py-2 text-sm shadow-sm ring-1 ring-slate-200">
          Wiederkehrender Umsatz (MRR): <strong>{eur(total)}</strong> / Monat · {mrr.size} Kunden
        </p>
      </div>
      {(["Laufende Leistungen", "Projekte und Einmalleistungen"] as const).map((group) => (
        <section key={group} className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-500">{group}</h2>
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {services
              .filter((s) => s.recurring === (group === "Laufende Leistungen"))
              .map((s) => (
                <li key={s.code} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${s.active ? "" : "opacity-50"}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {s.name} <span className="font-mono text-xs text-slate-400">{s.code}</span>
                    </span>
                    <span className="block text-xs text-slate-500">
                      {s.description} · je {s.unit}
                    </span>
                  </span>
                  {user.role === "inhaber" ? (
                    <ServicePriceForm code={s.code} price={s.price} active={s.active} />
                  ) : (
                    <span className="font-semibold">{eur(s.price)}</span>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
