import "server-only";
import { channels, funnels, resolveSource } from "@/config/site";
import { listLeads, type Lead } from "@/lib/leads";
import type { Pipeline } from "@/lib/pipeline";

/** Alle Funnel- und Kanal-IDs, deren Einträge in dieser Pipeline landen. */
export function sourceIdsFor(pipeline: Pipeline): string[] {
  return [...Object.values(funnels), ...Object.values(channels)].filter((s) => s.pipelineId === pipeline.id).map((s) => s.id);
}

export function pipelineForLead(lead: Lead): Pipeline | undefined {
  return resolveSource(lead.funnel)?.pipeline;
}

export function leadsForPipeline(pipeline: Pipeline, since?: Date): Promise<Lead[]> {
  return listLeads({ funnels: sourceIdsFor(pipeline), since });
}
