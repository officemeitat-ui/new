import Link from "next/link";
import type { Lead } from "@/lib/leads";
import type { Pipeline } from "@/lib/pipeline";
import { findStage } from "@/lib/pipeline";
import { formatDateTime } from "@/lib/format";

export function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="h-full rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

const stageTone = {
  won: "bg-emerald-100 text-emerald-800",
  lost: "bg-slate-200 text-slate-600",
  open: "bg-brand-soft text-brand",
};

export function StageBadge({ pipeline, stageId }: { pipeline: Pipeline; stageId: string }) {
  const stage = findStage(pipeline, stageId);
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${stageTone[stage?.closed ?? "open"]}`}>
      {stage?.label ?? stageId}
    </span>
  );
}

export function QualifiedBadge({ qualified }: { qualified: boolean | null }) {
  if (qualified === null) return null;
  return qualified ? (
    <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">qualifiziert</span>
  ) : (
    <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">nicht qualifiziert</span>
  );
}

export function LeadTable({ leads, pipelineFor }: { leads: Lead[]; pipelineFor: (lead: Lead) => Pipeline | undefined }) {
  if (leads.length === 0) {
    return <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">Noch keine Einträge.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Unternehmen</th>
            <th className="px-4 py-3 font-medium">Pipeline</th>
            <th className="px-4 py-3 font-medium">Stufe</th>
            <th className="px-4 py-3 font-medium">Score</th>
            <th className="px-4 py-3 font-medium">Eingang</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {leads.map((lead) => {
            const pipeline = pipelineFor(lead);
            return (
              <tr key={lead.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/admin/leads/${lead.id}`} className="hover:text-brand">
                    {lead.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{lead.company ?? "–"}</td>
                <td className="px-4 py-3 text-slate-600">{pipeline?.label ?? lead.funnel}</td>
                <td className="px-4 py-3">{pipeline ? <StageBadge pipeline={pipeline} stageId={lead.stage} /> : lead.stage}</td>
                <td className="px-4 py-3 tabular-nums">{lead.score ?? "–"}</td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-500">{formatDateTime(lead.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
