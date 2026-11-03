import type { Job } from "bullmq";

export type SystemJobResult = { pong: true; at: string };

/** Maintenance jobs of the platform itself. `ping` is used by monitoring to prove the queue works. */
export async function handleSystemJob(job: Pick<Job, "name" | "id">): Promise<SystemJobResult> {
  switch (job.name) {
    case "ping":
      return { pong: true, at: new Date().toISOString() };
    default:
      throw new Error(`Unbekannter System-Job: ${job.name}`);
  }
}
