import "server-only";
import type { Row } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { business } from "@/config/business";
import { db } from "@/lib/db";
import type { Answers } from "@/lib/funnel";
import { BriefingSchema, FollowUpSchema, type Briefing, type FollowUp } from "@/lib/ai-schema";

export type Lead = {
  id: string;
  funnel: string;
  stage: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  link: string | null;
  message: string | null;
  answers: Answers;
  /** Nur bei Einträgen aus Funnels mit Bewertung, sonst null. */
  score: number | null;
  qualified: boolean | null;
  value: number | null;
  source: Record<string, string> | null;
  briefing: Briefing | null;
  followup: FollowUp | null;
  createdAt: string;
  updatedAt: string;
};

export type ActivityType = "created" | "stage" | "value" | "note" | "ai" | "call" | "email" | "appointment";

export type Activity = {
  id: number;
  leadId: string;
  type: ActivityType;
  text: string;
  createdAt: string;
};

export type NewLead = {
  /** Funnel- oder Kanal-ID (z. B. „telefon“, „email“), bestimmt die Pipeline. */
  funnel: string;
  stage: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  link?: string;
  message?: string;
  answers?: Answers;
  score?: number;
  qualified?: boolean;
  source?: Record<string, string>;
};

function parseJson<T>(raw: unknown, parse: (value: unknown) => T | null): T | null {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    return parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function toLead(row: Row): Lead {
  return {
    id: String(row.id),
    funnel: String(row.funnel),
    stage: String(row.stage),
    name: String(row.name),
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    link: (row.link as string | null) ?? null,
    message: (row.message as string | null) ?? null,
    answers: parseJson(row.answers, (v) => v as Answers) ?? {},
    score: row.score === null ? null : Number(row.score),
    qualified: row.qualified === null ? null : Number(row.qualified) === 1,
    value: row.value === null ? null : Number(row.value),
    source: parseJson(row.source, (v) => v as Record<string, string>),
    briefing: parseJson(row.briefing, (v) => BriefingSchema.safeParse(v).data ?? null),
    followup: parseJson(row.followup, (v) => FollowUpSchema.safeParse(v).data ?? null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toActivity(row: Row): Activity {
  return {
    id: Number(row.id),
    leadId: String(row.lead_id),
    type: String(row.type) as ActivityType,
    text: String(row.text),
    createdAt: String(row.created_at),
  };
}

export async function createLead(input: NewLead, activityText: string): Promise<Lead> {
  const client = await db();
  const id = randomUUID();
  const now = new Date().toISOString();
  await client.batch(
    [
      {
        sql: `INSERT INTO leads (id, funnel, stage, name, email, phone, company, link, message,
                answers, score, qualified, source, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          input.funnel,
          input.stage,
          input.name,
          input.email || null,
          input.phone ? normalizePhone(input.phone) : null,
          input.company || null,
          input.link || null,
          input.message || null,
          JSON.stringify(input.answers ?? {}),
          input.score ?? null,
          input.qualified === undefined ? null : input.qualified ? 1 : 0,
          input.source && Object.keys(input.source).length > 0 ? JSON.stringify(input.source) : null,
          now,
          now,
        ],
      },
      {
        sql: `INSERT INTO activities (lead_id, type, text, created_at) VALUES (?, 'created', ?, ?)`,
        args: [id, activityText, now],
      },
    ],
    "write",
  );
  const lead = await getLead(id);
  if (!lead) throw new Error("Lead konnte nicht gespeichert werden");
  return lead;
}

/**
 * Vereinheitlicht Telefonnummern ins internationale Format, damit Anrufe derselben Person
 * demselben Kontakt zugeordnet werden („0664 123“ → „+43664123“).
 */
export function normalizePhone(raw: string, countryCode = business.countryCode): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+${countryCode}${digits.slice(1)}`;
  return digits ? `+${digits}` : trimmed;
}

/** Sucht einen bestehenden Kontakt per Telefonnummer oder E-Mail-Adresse (jüngster zuerst). */
export async function findLeadByContact(contact: { phone?: string | null; email?: string | null }): Promise<Lead | null> {
  const client = await db();
  if (contact.phone) {
    const result = await client.execute({
      sql: "SELECT * FROM leads WHERE phone = ? ORDER BY created_at DESC LIMIT 1",
      args: [normalizePhone(contact.phone)],
    });
    if (result.rows[0]) return toLead(result.rows[0]);
  }
  if (contact.email) {
    const result = await client.execute({
      sql: "SELECT * FROM leads WHERE lower(email) = lower(?) ORDER BY created_at DESC LIMIT 1",
      args: [contact.email.trim()],
    });
    if (result.rows[0]) return toLead(result.rows[0]);
  }
  return null;
}

/** Ergänzt fehlende Kontaktdaten (Name, Telefon, E-Mail), ohne vorhandene zu überschreiben. */
export async function completeContact(lead: Lead, data: { name?: string; phone?: string; email?: string }): Promise<void> {
  const updates: [string, string][] = [];
  if (data.phone && !lead.phone) updates.push(["phone", normalizePhone(data.phone)]);
  if (data.email && !lead.email) updates.push(["email", data.email.trim()]);
  if (data.name && /^(unbekannt|anrufer)/i.test(lead.name)) updates.push(["name", data.name.trim()]);
  if (updates.length === 0) return;
  const client = await db();
  await client.execute({
    sql: `UPDATE leads SET ${updates.map(([column]) => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
    args: [...updates.map(([, value]) => value), new Date().toISOString(), lead.id],
  });
}

export async function getLead(id: string): Promise<Lead | null> {
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM leads WHERE id = ?", args: [id] });
  return result.rows[0] ? toLead(result.rows[0]) : null;
}

export async function listLeads(filter: { funnels?: string[]; since?: Date } = {}): Promise<Lead[]> {
  const client = await db();
  const where: string[] = [];
  const args: string[] = [];
  if (filter.funnels) {
    if (filter.funnels.length === 0) return [];
    where.push(`funnel IN (${filter.funnels.map(() => "?").join(", ")})`);
    args.push(...filter.funnels);
  }
  if (filter.since) {
    where.push("created_at >= ?");
    args.push(filter.since.toISOString());
  }
  const result = await client.execute({
    sql: `SELECT * FROM leads ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`,
    args,
  });
  return result.rows.map(toLead);
}

async function touch(id: string, column: string, value: string | number | null, activity?: { type: ActivityType; text: string }) {
  const client = await db();
  const now = new Date().toISOString();
  await client.batch(
    [
      { sql: `UPDATE leads SET ${column} = ?, updated_at = ? WHERE id = ?`, args: [value, now, id] },
      ...(activity
        ? [
            {
              sql: "INSERT INTO activities (lead_id, type, text, created_at) VALUES (?, ?, ?, ?)",
              args: [id, activity.type, activity.text, now],
            },
          ]
        : []),
    ],
    "write",
  );
}

export function setStage(id: string, stage: string, activityText: string) {
  return touch(id, "stage", stage, { type: "stage", text: activityText });
}

export function setValue(id: string, value: number | null, activityText: string) {
  return touch(id, "value", value, { type: "value", text: activityText });
}

export function saveBriefing(id: string, briefing: Briefing) {
  return touch(id, "briefing", JSON.stringify(briefing), { type: "ai", text: "KI-Gesprächsvorbereitung erstellt" });
}

export function saveFollowup(id: string, followup: FollowUp) {
  return touch(id, "followup", JSON.stringify(followup), { type: "ai", text: "KI-Follow-up erstellt" });
}

export async function addActivity(leadId: string, type: ActivityType, text: string): Promise<void> {
  const client = await db();
  const now = new Date().toISOString();
  await client.batch(
    [
      { sql: "INSERT INTO activities (lead_id, type, text, created_at) VALUES (?, ?, ?, ?)", args: [leadId, type, text, now] },
      { sql: "UPDATE leads SET updated_at = ? WHERE id = ?", args: [now, leadId] },
    ],
    "write",
  );
}

export async function listActivities(leadId: string): Promise<Activity[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM activities WHERE lead_id = ? ORDER BY created_at DESC, id DESC",
    args: [leadId],
  });
  return result.rows.map(toActivity);
}
