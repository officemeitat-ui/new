import Link from "next/link";
import { notFound } from "next/navigation";
import { removeChecklist, toggleItem } from "@/app/app/checklisten/actions";
import { findTemplate } from "@/config/checklists";
import { workspace } from "@/config/workspace";
import { requireAdmin } from "@/lib/auth";
import { getChecklist } from "@/lib/workspace/checklists";
import { shortDate } from "@/lib/workspace/format";

export default async function ChecklistePage({ params }: PageProps<"/app/checklisten/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const checklist = await getChecklist(id);
  if (!checklist) notFound();
  const template = findTemplate(checklist.templateId);
  const sections = [...new Set(checklist.items.map((i) => i.section ?? ""))];
  const when = (iso: string) =>
    new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short", timeZone: workspace.timeZone }).format(new Date(iso));
  const percent = checklist.total ? Math.round((checklist.done / checklist.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <Link href={`/app/checklisten?kunde=${checklist.customerId}`} className="text-sm text-slate-500 hover:text-slate-900">
        ← Checklisten {checklist.customerName}
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{checklist.title}</h1>
        <p className="text-sm text-slate-500">
          <Link href={`/app/kunden/${checklist.customerId}`} className="hover:underline">
            {checklist.customerName}
          </Link>
          {checklist.dueDate ? ` · fällig ${shortDate(checklist.dueDate)}` : ""} · angelegt {when(checklist.createdAt)}
          {checklist.createdBy ? ` von ${checklist.createdBy}` : ""}
        </p>
        {template && <p className="mt-1 text-sm text-slate-600">{template.description}</p>}
      </div>
      <div className="flex items-center gap-3">
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${checklist.doneAt ? "bg-emerald-500" : "bg-brand"}`} style={{ width: `${percent}%` }} />
        </div>
        <span className="text-sm font-semibold">
          {checklist.done}/{checklist.total}
        </span>
      </div>
      {checklist.doneAt && (
        <p className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-900">✓ Abgeschlossen am {when(checklist.doneAt)}</p>
      )}
      {sections.map((section) => (
        <section key={section} className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          {section && <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">{section}</h2>}
          <ul className="divide-y divide-slate-100">
            {checklist.items
              .filter((i) => (i.section ?? "") === section)
              .map((item) => (
                <li key={item.idx}>
                  <form action={toggleItem}>
                    <input type="hidden" name="id" value={checklist.id} />
                    <input type="hidden" name="idx" value={item.idx} />
                    <button type="submit" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50">
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${item.doneAt ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300"}`}
                      >
                        {item.doneAt ? "✓" : ""}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${item.doneAt ? "text-slate-400 line-through" : ""}`}>{item.text}</span>
                        {item.hint && <span className="block text-xs text-slate-500">{item.hint}</span>}
                        {item.doneAt && (
                          <span className="block text-xs text-emerald-700">
                            {item.doneBy ?? ""} · {when(item.doneAt)}
                          </span>
                        )}
                      </span>
                    </button>
                  </form>
                </li>
              ))}
          </ul>
        </section>
      ))}
      <form action={removeChecklist}>
        <input type="hidden" name="id" value={checklist.id} />
        <button type="submit" className="text-sm text-slate-400 hover:text-red-700">
          Checkliste löschen
        </button>
      </form>
    </div>
  );
}
