import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { KI_KOMPETENZ, SELF_ASSESSMENT } from "@/lib/awareness/content";
import { overview } from "@/lib/awareness/store";
import { listCustomers } from "@/lib/workspace/customers";

/** Security Awareness: Schulungsstand je Organisation – das eigene Team und Kunden. */
export default async function AwarenessPage() {
  await requireAdmin();
  const [orgs, customers] = await Promise.all([overview(), listCustomers()]);
  const listed = new Set(orgs.map((o) => o.org));
  const available = customers.filter((c) => !listed.has(c.id));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Security Awareness</h1>
        <p className="text-sm text-slate-500">
          Online-Schulung „{KI_KOMPETENZ.title}“ ({KI_KOMPETENZ.legalBasis}) mit Übung, Quiz und Teilnahmenachweis – für dein Team und für
          Kunden. Teilnehmende brauchen kein Konto, nur ihren persönlichen Link.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {orgs.map((o) => (
          <li key={o.org}>
            <Link
              href={`/app/awareness/${o.org}`}
              className="block space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-brand"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{o.name}</span>
                {o.org === "intern" && <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-600">eigenes Team</span>}
              </span>
              {o.learners ? (
                <>
                  <span className="block h-2 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className="block h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.round((o.passed / o.learners) * 100)}%` }}
                    />
                  </span>
                  <span className="block text-sm text-slate-600">
                    {o.passed} von {o.learners} geschult
                    {o.expiring ? ` · ${o.expiring} laufen bald ab` : ""}
                  </span>
                </>
              ) : (
                <span className="block text-sm text-slate-500">Noch keine Teilnehmenden</span>
              )}
              <span className="block text-xs text-slate-500">
                Selbstbewertung: {o.assessment ? `${o.assessment.score}/${SELF_ASSESSMENT.max} Punkte` : "noch keine"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {available.length > 0 && (
        <form action="/app/awareness/oeffnen" className="flex flex-wrap gap-2">
          <select name="org" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" aria-label="Kunde">
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
            Kunden aufnehmen
          </button>
        </form>
      )}
    </div>
  );
}
