import "server-only";
import { funnels, getFunnel, getPipeline } from "@/config/site";
import { listLeads, type Lead } from "@/lib/leads";
import type { Pipeline } from "@/lib/pipeline";

export function funnelIdsFor(pipeline: Pipeline): string[] {
  return Object.values(funnels)
    .filter((f) => f.pipelineId === pipeline.id)
    .map((f) => f.id);
}

export function pipelineForLead(lead: Lead): Pipeline | undefined {
  const funnel = getFunnel(lead.funnel);
  return funnel && getPipeline(funnel.pipelineId);
}

export function leadsForPipeline(pipeline: Pipeline, since?: Date): Promise<Lead[]> {
  return listLeads({ funnels: funnelIdsFor(pipeline), since });
}
