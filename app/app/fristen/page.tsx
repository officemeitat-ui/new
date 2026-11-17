import Link from "next/link";
import { deadlineToTask } from "@/app/app/fristen/actions";
import { workspace } from "@/config/workspace";
import { requireAdmin } from "@/lib/auth";
import { localDate } from "@/lib/calendar";
import { db } from "@/lib/db";
import { allDeadlines } from "@/lib/workspace/deadlines";
import { shortDate } from "@/lib/workspace/format";

/** Fristen aller Kunden: was läuft ab, was muss gekündigt, getestet oder aufgefrischt werden. */
export default async function FristenPage({ searchParams }: PageProps<"/app/fristen">) {
  await requireAdmin();
  const { tage } = await searchParams;
  const days = [30, 90, 180, 365].includes(Number(tage)) ? Number(tage) : 90;
  const today = localDate(new Date(), workspace.timeZone);
  const items = await allDeadlines(days);
  const tasks = new Set(
    (await (await db()).execute("SELECT external_id FROM tasks WHERE external_id LIKE 'frist:%'")).rows.map((r) => String(r.external_id)),
  );
  const month = (iso: string) =>
    iso < today ? "Überfällig" : new Intl.DateTimeFormat("de-AT", { month: "long", year: "numeric" }).format(new Date(`${iso}T12:00:00Z`));
  const groups = [...new Set(items.map((i) => month(i.dueAt)))];
  const locked = items.some((i) => i.title === null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Fristen</h1>
          <p className="text-sm text-slate-500">
            Lizenzen, Kündigungstermine, Garantien, Domains, Zertifikate, Backup-Tests und Schulungen.
          </p>
        </div>
        <nav className="flex gap-1 text-sm">
          {[30, 90, 180, 365].map((d) => (
            <Link
              key={d}
              href={`/app/fristen?tage=${d}`}
              className={`rounded-full px-3 py-1 ${d === days ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"}`}
            >
              {d} Tage
            </Link>
          ))}
        </nav>
      </div>
      {locked && (
        <p className="rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-600">
          Die Doku ist gesperrt – Bezeichnungen sind ausgeblendet.{" "}
          <Link href="/app/doku" className="text-brand underline">
            Entsperren
          </Link>
        </p>
      )}
      {items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
          In diesem Zeitraum ist nichts fällig.
        </p>
      )}
      {groups.map((group) => (
        <section key={group} className="space-y-2">
          <h2 className={`text-sm font-semibold ${group === "Überfällig" ? "text-red-700" : "text-slate-500"}`}>{group}</h2>
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {items
              .filter((i) => month(i.dueAt) === group)
              .map((item) => {
                const title = `${item.label}: ${item.title ?? item.kind} (${item.customerName})`;
                return (
                  <li key={item.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span
                      className={`w-24 shrink-0 text-sm font-semibold tabular-nums ${item.dueAt < today ? "text-red-700" : "text-slate-700"}`}
                    >
                      {item.dueAt < today
                        ? new Intl.DateTimeFormat("de-AT", { dateStyle: "medium" }).format(new Date(`${item.dueAt}T12:00:00Z`))
                        : shortDate(item.dueAt)}
                    </span>
                    <Link href={item.href} className="min-w-0 flex-1 hover:underline">
                      <span className="block font-medium">
                        {item.label}: {item.title ?? item.kind}
                      </span>
                      <span className="text-xs text-slate-500">
                        {item.customerName} · {item.kind}
                      </span>
                    </Link>
                    {tasks.has(`frist:${item.key}:${item.dueAt}`) ? (
                      <span className="text-xs text-emerald-700">Aufgabe angelegt ✓</span>
                    ) : (
                      <form action={deadlineToTask}>
                        <input type="hidden" name="key" value={item.key} />
                        <input type="hidden" name="dueAt" value={item.dueAt} />
                        <input type="hidden" name="customerId" value={item.customerId ?? ""} />
                        <input type="hidden" name="title" value={title} />
                        <button
                          type="submit"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium hover:bg-slate-50"
                        >
                          Als Aufgabe
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
