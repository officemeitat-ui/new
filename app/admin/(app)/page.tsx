import Link from "next/link";
import { business } from "@/config/business";
import { funnels, pipelines, resolveSource } from "@/config/site";
import { Kpi, LeadTable } from "@/components/admin";
import { requireAdmin } from "@/lib/auth";
import { leadsForPipeline, pipelineForLead } from "@/lib/admin-data";
import { formatEuro, formatPercent } from "@/lib/format";
import { listLeads } from "@/lib/leads";
import { pipelineStats } from "@/lib/pipeline";
import { impactStats } from "@/lib/stats";

const DAYS = 30;

export default async function DashboardPage() {
  await requireAdmin();
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const [impact, recent, sections] = await Promise.all([
    impactStats(since, new Date()),
    listLeads().then((leads) => leads.slice(0, 10)),
    Promise.all(
      Object.values(pipelines).map(async (pipeline) => {
        const leads = await leadsForPipeline(pipeline);
        const lastDays = leads.filter((l) => new Date(l.createdAt) >= since);
        const bySource = new Map<string, number>();
        for (const lead of lastDays) {
          const label = resolveSource(lead.funnel)?.label ?? lead.funnel;
          bySource.set(label, (bySource.get(label) ?? 0) + 1);
        }
        return {
          pipeline,
          total: leads.length,
          scored: Object.values(funnels).some((f) => f.pipelineId === pipeline.id),
          stats: pipelineStats(pipeline, leads),
          incoming: lastDays.length,
          qualified: lastDays.filter((l) => l.qualified).length,
          bySource: [...bySource.entries()].map(([label, n]) => `${n} ${label}`).join(", "),
        };
      }),
    ),
  ]);

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Wirkung der KI-Mitarbeiter ({DAYS} Tage)</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Kpi label="Anrufe angenommen" value={impact.calls} />
          <Kpi label="WhatsApp-Gespräche" value={impact.chats} hint={`${impact.chatReplies} Antworten`} />
          <Kpi
            label="Termine gebucht"
            value={impact.appointments.automated}
            hint={`${impact.appointments.telefon} Telefon, ${impact.appointments.whatsapp} WhatsApp, ${impact.appointments.email} E-Mail`}
          />
          <Kpi label="E-Mails bearbeitet" value={impact.emailsHandled} hint={`${impact.repliesSent} Antworten gesendet`} />
          <Link href="/admin/belege" className="block h-full">
            <Kpi label="Belege erfasst" value={impact.receipts} hint="für die Buchhaltung abgelegt →" />
          </Link>
          <Link href="/admin/emails" className="block h-full">
            <Kpi label="Offene Entwürfe" value={impact.openDrafts} hint="warten auf Freigabe →" />
          </Link>
          <Kpi
            label="Geschätzte Zeitersparnis"
            value={`${(impact.minutesSaved / 60).toLocaleString("de-AT", { maximumFractionDigits: 1 })} Std.`}
            hint={`Annahme: ${business.impact.minutesPerCall} Min./Anruf, ${business.impact.minutesPerEmail} Min./E-Mail, ${business.impact.minutesPerChat} Min./Chat, ${business.impact.minutesPerAppointment} Min./Termin, ${business.impact.minutesPerReceipt} Min./Beleg`}
          />
        </div>
      </section>

      {sections
        .filter((section) => section.total > 0)
        .map(({ pipeline, stats, incoming, qualified, scored, bySource }) => {
          const wonLabel = pipeline.stages.find((s) => s.closed === "won")?.label ?? "Abgeschlossen";
          const maxCount = Math.max(1, ...stats.perStage.map((s) => s.count));
          return (
            <section key={pipeline.id}>
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">{pipeline.label}</h2>
                <Link href={`/admin/pipeline/${pipeline.id}`} className="text-sm font-medium text-brand hover:underline">
                  Zur Pipeline →
                </Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi label={`Eingänge (${DAYS} Tage)`} value={incoming} hint={scored ? undefined : bySource} />
                {scored ? (
                  <Kpi label="Qualifizierungsquote" value={formatPercent(qualified, incoming)} hint={`${qualified} qualifiziert`} />
                ) : (
                  <Kpi label="Offen in Bearbeitung" value={stats.openCount} />
                )}
                {pipeline.trackValue ? (
                  <>
                    <Kpi
                      label="Gewichteter Forecast"
                      value={formatEuro(stats.weightedForecast)}
                      hint={`Offene Pipeline: ${formatEuro(stats.openValue)}`}
                    />
                    <Kpi label="Gewonnen" value={formatEuro(stats.wonValue)} hint={`${stats.wonCount} Abschlüsse`} />
                  </>
                ) : (
                  <>
                    {scored && <Kpi label="Offen in Bearbeitung" value={stats.openCount} />}
                    <Kpi label={wonLabel} value={stats.wonCount} />
                    {!scored && (
                      <Kpi label={pipeline.stages.find((s) => s.closed === "lost")?.label ?? "Verloren"} value={stats.lostCount} />
                    )}
                  </>
                )}
              </div>
              <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-white p-5">
                {stats.perStage.map(({ stage, count, value }) => (
                  <div key={stage.id} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 text-slate-600">{stage.label}</span>
                    <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100">
                      <div
                        className={`h-full rounded ${stage.closed === "lost" ? "bg-slate-300" : stage.closed === "won" ? "bg-emerald-500" : "bg-brand"}`}
                        style={{ width: `${(count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 text-right font-medium tabular-nums">{count}</span>
                    {pipeline.trackValue && (
                      <span className="hidden w-28 text-right text-slate-500 tabular-nums sm:block">{formatEuro(value)}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

      {sections.some((section) => section.total === 0) && (
        <p className="text-sm text-slate-500">
          Ohne Einträge (ausgeblendet):{" "}
          {sections
            .filter((section) => section.total === 0)
            .map((section) => section.pipeline.label)
            .join(", ")}
        </p>
      )}

      <section>
        <h2 className="mb-4 text-lg font-semibold">Neueste Eingänge</h2>
        <LeadTable leads={recent} pipelineFor={pipelineForLead} />
      </section>
    </div>
  );
}
