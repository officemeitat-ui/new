import Link from "next/link";
import { newChecklist } from "@/app/app/checklisten/actions";
import { CHECKLIST_TEMPLATES } from "@/config/checklists";
import { requireAdmin } from "@/lib/auth";
import { listChecklists } from "@/lib/workspace/checklists";
import { listCustomers } from "@/lib/workspace/customers";
import { shortDate } from "@/lib/workspace/format";

/** Checklisten für wiederkehrende Abläufe – je Kunde, mit Fortschritt. */
export default async function ChecklistenPage({ searchParams }: PageProps<"/app/checklisten">) {
  await requireAdmin();
  const { kunde, alle } = await searchParams;
  const customerId = typeof kunde === "string" ? kunde : undefined;
  const [checklists, customers] = await Promise.all([listChecklists({ customerId, open: alle !== "1" }), listCustomers()]);
  const input = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-base md:text-sm focus:border-brand focus:outline-none";
  const customerName = customers.find((c) => c.id === customerId)?.name;

  return (
    <div className="space-y-4">
      <div>
        {customerId && (
          <Link href={`/app/kunden/${customerId}/doku`} className="text-sm text-slate-500 hover:text-slate-900">
            ← Dokumentation {customerName}
          </Link>
        )}
        <h1 className="text-2xl font-bold">Checklisten{customerName ? ` · ${customerName}` : ""}</h1>
        <p className="text-sm text-slate-500">
          Onboarding, Offboarding, neuer PC, Jahreswartung, Neukunde, M365-Grundschutz – abhaken statt vergessen.
        </p>
      </div>

      <form
        action={newChecklist}
        className="grid gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-[1fr_1fr_1fr_auto_auto]"
      >
        <select name="customerId" defaultValue={customerId} required className={input} aria-label="Kunde">
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="templateId" className={input} aria-label="Vorlage">
          {CHECKLIST_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <input name="subject" placeholder="Wer bzw. was? (z. B. Name)" className={input} aria-label="Betreff" />
        <input name="dueDate" type="date" className={input} aria-label="Fällig am" />
        <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
          Starten
        </button>
      </form>

      <div className="flex gap-2 text-sm">
        <Link
          href={`/app/checklisten${customerId ? `?kunde=${customerId}` : ""}`}
          className={`rounded-full px-3 py-1 ${alle !== "1" ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"}`}
        >
          Offen
        </Link>
        <Link
          href={`/app/checklisten?alle=1${customerId ? `&kunde=${customerId}` : ""}`}
          className={`rounded-full px-3 py-1 ${alle === "1" ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"}`}
        >
          Alle
        </Link>
      </div>

      {checklists.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">Keine offenen Checklisten.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          {checklists.map((c) => (
            <li key={c.id}>
              <Link href={`/app/checklisten/${c.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{c.title}</span>
                  <span className="text-xs text-slate-500">
                    {c.customerName}
                    {c.dueDate ? ` · fällig ${shortDate(c.dueDate)}` : ""}
                    {c.doneAt ? " · abgeschlossen" : ""}
                  </span>
                </span>
                <span className="w-28 shrink-0">
                  <span className="block h-2 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className={`block h-full rounded-full ${c.doneAt ? "bg-emerald-500" : "bg-brand"}`}
                      style={{ width: `${c.total ? Math.round((c.done / c.total) * 100) : 0}%` }}
                    />
                  </span>
                  <span className="text-xs text-slate-500">
                    {c.done}/{c.total}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
