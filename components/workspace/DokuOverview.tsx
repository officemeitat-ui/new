import Link from "next/link";
import { RECORD_LAYOUTS } from "@/config/records";
import { workspace } from "@/config/workspace";
import { GRADE_STYLE, type DomainCheck } from "@/lib/checks/domain";
import { isCheckError } from "@/lib/checks/run";
import { localDate } from "@/lib/calendar";
import { countDocs } from "@/lib/workspace/docs";
import { shortDate } from "@/lib/workspace/format";
import { checkResults, countRecords, dueRecords } from "@/lib/workspace/records";

/** Was zu einer vollständigen Kunden-Doku gehört – fehlt etwas, steht es hier. */
const ESSENTIALS: { key: string; label: string; href: (base: string) => string }[] = [
  { key: "kontakt", label: "Ansprechpartner", href: (b) => `${b}/eintraege/kontakt` },
  { key: "standort", label: "Standort", href: (b) => `${b}/eintraege/standort` },
  { key: "netzwerk", label: "Netzplan", href: (b) => `${b}/netzwerk` },
  { key: "geraet", label: "Inventar", href: (b) => `${b}/eintraege/geraet` },
  { key: "domain", label: "Domains", href: (b) => `${b}/eintraege/domain` },
  { key: "m365", label: "Microsoft 365", href: (b) => `${b}/eintraege/m365` },
  { key: "backup", label: "Datensicherung", href: (b) => `${b}/eintraege/backup` },
  { key: "vertrag", label: "Verträge", href: (b) => `${b}/eintraege/vertrag` },
];

export async function DokuOverview({ customerId }: { customerId: string }) {
  const base = `/app/kunden/${customerId}/doku`;
  const today = localDate(new Date(), workspace.timeZone);
  const horizon = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
  const [records, docs, due, checks] = await Promise.all([
    countRecords(customerId),
    countDocs(customerId),
    dueRecords(horizon, customerId),
    checkResults(customerId),
  ]);
  const have: Record<string, number> = { ...records, netzwerk: docs.netzwerk };
  const missing = ESSENTIALS.filter((e) => !have[e.key]);
  const done = ESSENTIALS.length - missing.length;
  const card = "space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200";

  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Vollständigkeit</h2>
          <span className="text-sm text-slate-600">
            {done} von {ESSENTIALS.length}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((done / ESSENTIALS.length) * 100)}%` }} />
        </div>
        {missing.length > 0 ? (
          <p className="flex flex-wrap gap-2 text-sm">
            <span className="text-slate-500">Noch offen:</span>
            {missing.map((m) => (
              <Link
                key={m.key}
                href={m.href(base)}
                className="rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-900 ring-1 ring-amber-200 hover:ring-amber-400"
              >
                {m.label}
              </Link>
            ))}
          </p>
        ) : (
          <p className="text-sm text-emerald-800">Alles Wesentliche ist dokumentiert.</p>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className={card}>
          <h2 className="font-semibold">Fristen (120 Tage)</h2>
          {due.length === 0 ? (
            <p className="text-sm text-slate-500">Nichts fällig.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {due.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`${base}/eintraege/${d.kind}/${d.id}`} className="min-w-0 truncate hover:underline">
                    <span className="text-slate-500">{d.dueLabel}:</span> {d.title ?? d.kindLabel}
                  </Link>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${d.dueAt < today ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}
                  >
                    {shortDate(d.dueAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={card}>
          <h2 className="font-semibold">Domains & E-Mail-Sicherheit</h2>
          {checks.length === 0 ? (
            <p className="text-sm text-slate-500">
              Keine Domain erfasst.{" "}
              <Link href={`${base}/eintraege/domain?neu=1`} className="text-brand underline">
                Domain anlegen
              </Link>{" "}
              – sie wird dann täglich geprüft.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {checks.map((c) => {
                const check = c.result && !isCheckError(c.result) ? (c.result as DomainCheck) : null;
                return (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`${base}/eintraege/domain/${c.id}`} className="min-w-0 truncate hover:underline">
                      {c.target}
                      {check && (
                        <span className="ml-2 text-xs text-slate-500">
                          {check.findings.find((f) => f.level !== "info")?.text ?? "alles in Ordnung"}
                        </span>
                      )}
                    </Link>
                    {check ? (
                      <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${GRADE_STYLE[check.grade]}`}>{check.grade}</span>
                    ) : (
                      <span className="text-xs text-slate-400">{c.result ? "Fehler" : "offen"}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className={card}>
        <h2 className="font-semibold">Bereiche</h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {RECORD_LAYOUTS.map((layout) => (
            <li key={layout.kind}>
              <Link href={`${base}/eintraege/${layout.kind}`} className="block rounded-xl px-3 py-2 ring-1 ring-slate-200 hover:ring-brand">
                <span className="block text-sm font-medium">{layout.plural}</span>
                <span className="text-xs text-slate-500">
                  {records[layout.kind] ? `${records[layout.kind]} ${records[layout.kind] === 1 ? "Eintrag" : "Einträge"}` : "leer"}
                </span>
              </Link>
            </li>
          ))}
          {[
            { href: `${base}/netzwerk`, label: "Netzplan & VLANs", n: docs.netzwerk ? "angelegt" : "leer" },
            {
              href: `${base}?tab=schrank`,
              label: "Patchschrank",
              n: docs.schrank ? `${docs.schrank} ${docs.schrank === 1 ? "Schrank" : "Schränke"}` : "leer",
            },
            {
              href: `${base}?tab=verkabelung`,
              label: "Verkabelung",
              n: docs.verkabelung ? `${docs.verkabelung} ${docs.verkabelung === 1 ? "Port" : "Ports"}` : "leer",
            },
            {
              href: `${base}?tab=seiten`,
              label: "Seiten",
              n: docs.seiten ? `${docs.seiten} ${docs.seiten === 1 ? "Seite" : "Seiten"}` : "leer",
            },
          ].map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="block rounded-xl px-3 py-2 ring-1 ring-slate-200 hover:ring-brand">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="text-xs text-slate-500">{item.n}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
