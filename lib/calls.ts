import "server-only";
import type { Row } from "@libsql/client";
import { db } from "@/lib/db";

export type Call = {
  id: string;
  leadId: string | null;
  phone: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  endedReason: string | null;
  summary: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  cost: number | null;
  createdAt: string;
};

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

function toCall(row: Row): Call {
  return {
    id: String(row.id),
    leadId: text(row.lead_id),
    phone: text(row.phone),
    startedAt: text(row.started_at),
    endedAt: text(row.ended_at),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    endedReason: text(row.ended_reason),
    summary: text(row.summary),
    transcript: text(row.transcript),
    recordingUrl: text(row.recording_url),
    cost: row.cost === null ? null : Number(row.cost),
    createdAt: String(row.created_at),
  };
}

/** Speichert ein Gesprächsprotokoll. Liefert false, wenn der Anruf schon gespeichert war (Wiederholung durch Vapi). */
export async function saveCall(call: Omit<Call, "createdAt">): Promise<boolean> {
  const client = await db();
  const result = await client.execute({
    sql: `INSERT INTO calls (id, lead_id, phone, started_at, ended_at, duration_seconds, ended_reason, summary, transcript, recording_url, cost, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    args: [
      call.id,
      call.leadId,
      call.phone,
      call.startedAt,
      call.endedAt,
      call.durationSeconds,
      call.endedReason,
      call.summary,
      call.transcript,
      call.recordingUrl,
      call.cost,
      new Date().toISOString(),
    ],
  });
  return result.rowsAffected > 0;
}

export async function listCalls(limit = 100): Promise<Call[]> {
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM calls ORDER BY created_at DESC LIMIT ?", args: [limit] });
  return result.rows.map(toCall);
}

export async function listCallsForLead(leadId: string): Promise<Call[]> {
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM calls WHERE lead_id = ? ORDER BY created_at DESC", args: [leadId] });
  return result.rows.map(toCall);
}
