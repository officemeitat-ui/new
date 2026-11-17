import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteRecordAction } from "@/app/app/record-actions";
import { DomainCheckPanel } from "@/components/workspace/DomainCheckPanel";
import { RecordForm } from "@/components/workspace/RecordForm";
import { findLayout } from "@/config/records";
import { workspace } from "@/config/workspace";
import { requireAdmin } from "@/lib/auth";
import { getCustomer } from "@/lib/workspace/customers";
import { shortDate } from "@/lib/workspace/format";
import { getRecord } from "@/lib/workspace/records";

export default async function RecordPage({ params, searchParams }: PageProps<"/app/kunden/[id]/doku/eintraege/[kind]/[recordId]">) {
  await requireAdmin();
  const { id, kind, recordId } = await params;
  const { bearbeiten } = await searchParams;
  const [customer, layout, record] = [await getCustomer(id), findLayout(kind), await getRecord(recordId)];
  if (!customer || !layout || !record || record.customerId !== id || record.kind !== kind) notFound();
  const base = `/app/kunden/${id}/doku/eintraege/${kind}`;
  const editing = bearbeiten === "1";
  const when = new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short", timeZone: workspace.timeZone }).format(
    new Date(record.updatedAt),
  );
  const value = (key: string, type: string) => {
    const v = record.data[key];
    if (!v) return null;
    if (type === "date") return shortDate(v);
    if (type === "boolean") return "ja";
    if (type === "email")
      return (
        <a href={`mailto:${v}`} className="text-brand hover:underline">
          {v}
        </a>
      );
    if (type === "phone")
      return (
        <a href={`tel:${v.replace(/[^+\d]/g, "")}`} className="text-brand hover:underline">
          {v}
        </a>
      );
    if (type === "url")
      return (
        <a href={v} target="_blank" rel="noreferrer" className="text-brand hover:underline">
          {v}
        </a>
      );
    return <span className="whitespace-pre-wrap">{v}</span>;
  };

  return (
    <div className="space-y-4">
      <Link href={base} className="text-sm text-slate-500 hover:text-slate-900">
        ← {layout.plural} · {customer.name}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{layout.label}</p>
          <h1 className="text-2xl font-bold">{record.title}</h1>
          <p className="text-xs text-slate-500">
            zuletzt geändert {when}
            {record.updatedBy ? ` von ${record.updatedBy}` : ""}
          </p>
        </div>
        {!editing && (
          <Link
            href={`${base}/${record.id}?bearbeiten=1`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            Bearbeiten
          </Link>
        )}
      </div>

      {record.dueAt && layout.due && (
        <p className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          {layout.due.label}: <strong>{shortDate(record.dueAt)}</strong> – erscheint rechtzeitig unter „Fristen“ und auf „Heute“.
        </p>
      )}

      {editing ? (
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <RecordForm customerId={id} kind={kind} fields={layout.fields} id={record.id} initial={record.data} />
          <form action={deleteRecordAction} className="border-t border-slate-100 pt-3">
            <input type="hidden" name="id" value={record.id} />
            <button type="submit" className="text-sm text-slate-400 hover:text-red-700">
              {layout.label} löschen
            </button>
          </form>
        </section>
      ) : (
        <dl className="grid gap-x-6 gap-y-3 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200 sm:grid-cols-2">
          {layout.fields
            .filter((f) => record.data[f.key])
            .map((f) => (
              <div key={f.key} className={f.wide || f.type === "textarea" ? "sm:col-span-2" : ""}>
                <dt className="text-xs text-slate-500">{f.label}</dt>
                <dd className="font-medium text-slate-900">{value(f.key, f.type)}</dd>
              </div>
            ))}
        </dl>
      )}

      {layout.checkField && <DomainCheckPanel recordId={record.id} result={record.check} checkedAt={record.checkedAt} />}
    </div>
  );
}
