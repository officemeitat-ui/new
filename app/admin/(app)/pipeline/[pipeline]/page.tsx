import { notFound } from "next/navigation";
import { getPipeline } from "@/config/site";
import { Kpi } from "@/components/admin";
import { PipelineBoard } from "@/components/PipelineBoard";
import { requireAdmin } from "@/lib/auth";
import { leadsForPipeline } from "@/lib/admin-data";
import { formatDate, formatEuro } from "@/lib/format";
import { itemValue, pipelineStats } from "@/lib/pipeline";

export default async function PipelinePage({ params }: PageProps<"/admin/pipeline/[pipeline]">) {
  await requireAdmin();
  const pipeline = getPipeline((await params).pipeline);
  if (!pipeline) notFound();

  const leads = await leadsForPipeline(pipeline);
  const stats = pipelineStats(pipeline, leads);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Pipeline {pipeline.label}</h1>
          <p className="text-sm text-slate-500">Karten per Drag & Drop oder über die Auswahl verschieben.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi label="Offen" value={stats.openCount} />
          {pipeline.trackValue ? (
            <>
              <Kpi label="Gewichteter Forecast" value={formatEuro(stats.weightedForecast)} />
              <Kpi label="Gewonnen" value={formatEuro(stats.wonValue)} />
            </>
          ) : (
            <Kpi label="Eingestellt" value={stats.wonCount} />
          )}
        </div>
      </div>
      <PipelineBoard
        stages={pipeline.stages}
        cards={leads.map((lead) => ({
          id: lead.id,
          name: lead.name,
          company: lead.company,
          stage: lead.stage,
          score: lead.score,
          qualified: lead.qualified,
          value: pipeline.trackValue ? formatEuro(itemValue(pipeline, lead)) : null,
          createdAt: formatDate(lead.createdAt),
        }))}
      />
    </div>
  );
}
