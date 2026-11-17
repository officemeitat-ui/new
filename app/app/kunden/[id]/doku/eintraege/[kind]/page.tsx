import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordForm } from "@/components/workspace/RecordForm";
import { findLayout } from "@/config/records";
import { requireAdmin } from "@/lib/auth";
import { GRADE_STYLE, type DomainCheck } from "@/lib/checks/domain";
import { isCheckError } from "@/lib/checks/run";
import { localDate } from "@/lib/calendar";
import { workspace } from "@/config/workspace";
import { getCustomer } from "@/lib/workspace/customers";
import { shortDate } from "@/lib/workspace/format";
import { listRecords } from "@/lib/workspace/records";

export default async function RecordListPage({ params, searchParams }: PageProps<"/app/kunden/[id]/doku/eintraege/[kind]">) {
  await requireAdmin();
  const { id, kind } = await params;
  const { neu } = await searchParams;
  const [customer, layout] = [await getCustomer(id), findLayout(kind)];
  if (!customer || !layout) notFound();
  const items = await listRecords(id, kind);
  const columns = layout.fields.filter((f) => f.list && f.key !== layout.titleField).slice(0, 4);
  const today = localDate(new Date(), workspace.timeZone);
  const soon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const base = `/app/kunden/${id}/doku/eintraege/${kind}`;
  const showForm = neu === "1" || items.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link href={`/app/kunden/${id}/doku`} className="text-sm text-slate-500 hover:text-slate-900">
            ← {customer.name}
          </Link>
          <h1 className="text-2xl font-bold">{layout.plural}</h1>
          <p className="text-sm text-slate-500">{layout.hint}</p>
        </div>
        {!showForm && (
          <Link href={`${base}?neu=1`} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
            + {layout.label}
          </Link>
        )}
      </div>

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">{layout.fields.find((f) => f.key === layout.titleField)?.label}</th>
                {columns.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-medium">
                    {c.label}
                  </th>
                ))}
                {(layout.due || layout.checkField) && (
                  <th className="px-3 py-2 font-medium">{layout.checkField ? "Prüfung" : layout.due?.label}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const check = item.check && !isCheckError(item.check) ? (item.check as DomainCheck) : null;
                return (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium">
                      <Link href={`${base}/${item.id}`} className="hover:underline">
                        {item.title}
                      </Link>
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-slate-600">
                        {c.type === "date" && item.data[c.key]
                          ? shortDate(item.data[c.key])
                          : c.type === "boolean"
                            ? item.data[c.key]
                              ? "✓"
                              : ""
                            : item.data[c.key]}
                      </td>
                    ))}
                    {layout.checkField ? (
                      <td className="px-3 py-2">
                        {check ? (
                          <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${GRADE_STYLE[check.grade]}`}>{check.grade}</span>
                        ) : (
                          <span className="text-xs text-slate-400">–</span>
                        )}
                      </td>
                    ) : layout.due ? (
                      <td className="px-3 py-2">
                        {item.dueAt ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${item.dueAt < today ? "bg-red-100 text-red-800" : item.dueAt <= soon ? "bg-amber-100 text-amber-800" : "text-slate-600"}`}
                          >
                            {shortDate(item.dueAt)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">–</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="font-semibold">Neu: {layout.label}</h2>
          <RecordForm customerId={id} kind={kind} fields={layout.fields} submitLabel="Anlegen" />
        </section>
      )}
    </div>
  );
}
