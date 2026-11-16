import Link from "next/link";
import { business } from "@/config/business";
import { site } from "@/config/site";
import { PrintButton } from "@/components/PrintButton";
import { requireAdmin } from "@/lib/auth";
import { change, currentMonth, hours, isMonth, lastCompletedMonth, monthlyReport, shiftMonth } from "@/lib/report";

function Metric({ label, value, previous, unit = "" }: { label: string; value: number; previous: number; unit?: string }) {
  const delta = change(value, previous);
  const tone = delta.startsWith("+") || delta === "neu" ? "text-emerald-700" : delta.startsWith("−") ? "text-amber-700" : "text-slate-500";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 break-inside-avoid">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">
        {value.toLocaleString("de-AT")}
        {unit}
      </p>
      <p className="mt-1 text-xs">
        <span className={`font-semibold ${tone}`}>{delta}</span>
        <span className="text-slate-400">
          {" "}
          ggü. Vormonat ({previous.toLocaleString("de-AT")}
          {unit})
        </span>
      </p>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 break-inside-avoid">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Keine Einträge in diesem Monat.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center gap-3 text-sm">
              <span className="w-48 shrink-0 text-slate-600">{row.label}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                <div className="h-full rounded bg-brand" style={{ width: `${(row.count / max) * 100}%` }} />
              </div>
              <span className="w-8 text-right font-medium tabular-nums">{row.count}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default async function ReportPage({ searchParams }: PageProps<"/admin/bericht">) {
  await requireAdmin();
  const { monat } = await searchParams;
  const month = isMonth(monat) ? monat : lastCompletedMonth();
  const report = await monthlyReport(month);
  const { current: c, previous: p } = report;
  const isRunning = month === currentMonth();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <nav className="flex items-center gap-2 text-sm font-medium">
          <Link
            href={`/admin/bericht?monat=${shiftMonth(month, -1)}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
          >
            ← Vormonat
          </Link>
          {!isRunning && (
            <Link
              href={`/admin/bericht?monat=${shiftMonth(month, 1)}`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
            >
              Folgemonat →
            </Link>
          )}
        </nav>
        <PrintButton />
      </div>

      <header className="rounded-xl bg-brand p-6 text-white">
        <p className="text-sm text-white/80">
          {site.brand.name} · Monatsbericht{isRunning && " (laufender Monat)"}
        </p>
        <h1 className="mt-1 text-3xl font-bold">
          {business.name} – {report.label}
        </h1>
        <p className="mt-2 text-white/90">
          Ihre KI-Mitarbeiter haben in diesem Monat geschätzt <strong>{hours(c.minutesSaved)} Stunden</strong> Arbeit übernommen.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Anrufe angenommen" value={c.calls} previous={p.calls} />
        <Metric label="Termine gebucht (Telefon + E-Mail)" value={c.appointments.automated} previous={p.appointments.automated} />
        <Metric label="Rückrufwünsche notiert" value={c.callbacks} previous={p.callbacks} />
        <Metric label="E-Mails bearbeitet" value={c.emailsHandled} previous={p.emailsHandled} />
        <Metric label="Antworten gesendet" value={c.repliesSent} previous={p.repliesSent} />
        <Metric label="Gesprächszeit" value={c.callMinutes} previous={p.callMinutes} unit=" Min." />
        <Metric label="WhatsApp-Gespräche" value={c.chats} previous={p.chats} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown title="Termine nach Leistung" rows={report.appointmentsByService.map((s) => ({ label: s.name, count: s.count }))} />
        <Breakdown title="E-Mails nach Art" rows={report.emailsByCategory} />
      </div>

      <p className="text-xs text-slate-500">
        Zeitersparnis geschätzt mit {business.impact.minutesPerCall} Min. je Anruf, {business.impact.minutesPerEmail} Min. je E-Mail,{" "}
        {business.impact.minutesPerChat} Min. je WhatsApp-Gespräch und {business.impact.minutesPerAppointment} Min. je Terminvereinbarung.
        Termine zählen nach Buchungsdatum, E-Mails nach Eingang.
      </p>
    </div>
  );
}
