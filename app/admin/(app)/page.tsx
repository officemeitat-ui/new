import Link from "next/link";
import { pipelines } from "@/config/site";
import { Kpi, LeadTable } from "@/components/admin";
import { requireAdmin } from "@/lib/auth";
import { leadsForPipeline, pipelineForLead } from "@/lib/admin-data";
import { formatEuro, formatPercent } from "@/lib/format";
import { listLeads } from "@/lib/leads";
import { pipelineStats } from "@/lib/pipeline";

const DAYS = 30;

export default async function DashboardPage() {
  await requireAdmin();
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const [recent, sections] = await Promise.all([
    listLeads().then((leads) => leads.slice(0, 10)),
    Promise.all(
      Object.values(pipelines).map(async (pipeline) => {
        const leads = await leadsForPipeline(pipeline);
        const lastDays = leads.filter((l) => new Date(l.createdAt) >= since);
        return {
          pipeline,
          stats: pipelineStats(pipeline, leads),
          incoming: lastDays.length,
          qualified: lastDays.filter((l) => l.qualified).length,
        };
      }),
    ),
  ]);

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {sections.map(({ pipeline, stats, incoming, qualified }) => {
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
              <Kpi label={`Eingänge (${DAYS} Tage)`} value={incoming} />
              <Kpi label="Qualifizierungsquote" value={formatPercent(qualified, incoming)} hint={`${qualified} qualifiziert`} />
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
                  <Kpi label="Offen in Bearbeitung" value={stats.openCount} />
                  <Kpi label="Eingestellt" value={stats.wonCount} />
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
                  {pipeline.trackValue && <span className="hidden w-28 text-right text-slate-500 tabular-nums sm:block">{formatEuro(value)}</span>}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <section>
        <h2 className="mb-4 text-lg font-semibold">Neueste Eingänge</h2>
        <LeadTable leads={recent} pipelineFor={pipelineForLead} />
      </section>
    </div>
  );
}
