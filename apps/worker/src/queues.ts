/** Queue names. Payloads carry IDs only; the state lives in Postgres (docs/adr/0005-jobs-bullmq.md). */
export const QUEUES = {
  system: "system",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
