import type { Logger } from "@nexus/core/logger";
import type { Database } from "@nexus/db";
import { applyRetention } from "@nexus/domain";
import type { Job } from "bullmq";

export type SystemJobResult =
  | { pong: true; at: string }
  | { retention: { tenants: number; conversations: number; documents: number } };

export type SystemJobDeps = { db: Database; log: Logger };

/**
 * Maintenance jobs of the platform itself. `ping` is used by monitoring to prove the queue
 * works; `retention` deletes expired data every night (DSGVO, M13).
 */
export async function handleSystemJob(
  job: Pick<Job, "name" | "id">,
  deps?: SystemJobDeps,
): Promise<SystemJobResult> {
  switch (job.name) {
    case "ping":
      return { pong: true, at: new Date().toISOString() };
    case "retention": {
      if (!deps) throw new Error("retention braucht eine Datenbank.");
      const results = await applyRetention(deps.db);
      const summary = {
        tenants: results.length,
        conversations: results.reduce((sum, r) => sum + r.conversations, 0),
        documents: results.reduce((sum, r) => sum + r.documents, 0),
      };
      deps.log.info(summary, "retention applied");
      return { retention: summary };
    }
    default:
      throw new Error(`Unbekannter System-Job: ${job.name}`);
  }
}
