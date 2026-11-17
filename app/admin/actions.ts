"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { resolveSource } from "@/config/site";
import { AiError, generateBriefing, generateFollowUp } from "@/lib/ai";
import { logAction, requireOwner } from "@/lib/auth";
import { formatEuro } from "@/lib/format";
import { addActivity, getLead, saveBriefing, saveFollowup, setStage, setValue, type Lead } from "@/lib/leads";
import { findStage } from "@/lib/pipeline";
import { readSessionToken, SESSION_COOKIE } from "@/lib/session";
import { revokeSessionByToken } from "@/lib/users";
import { sendWebhook } from "@/lib/webhook";

/** Abmelden: Sitzung in der Datenbank widerrufen, Cookie löschen. */
export async function logout() {
  const store = await cookies();
  const token = await readSessionToken(store.get(SESSION_COOKIE)?.value);
  if (token) {
    await logAction("Abmeldung");
    await revokeSessionByToken(token.sessionId);
  }
  store.delete(SESSION_COOKIE);
  redirect("/admin/login");
}

async function loadLead(leadId: string) {
  const lead = await getLead(leadId);
  const source = lead && resolveSource(lead.funnel);
  if (!lead || !source?.pipeline) throw new Error("Eintrag nicht gefunden");
  return { lead, funnel: source.funnel, sourceLabel: source.label, pipeline: source.pipeline };
}

function refresh(lead: Lead) {
  revalidatePath(`/admin/leads/${lead.id}`);
  revalidatePath("/admin", "layout");
}

export async function moveLead(leadId: string, stageId: string) {
  await requireOwner();
  const { lead, pipeline } = await loadLead(leadId);
  const from = findStage(pipeline, lead.stage);
  const to = findStage(pipeline, stageId);
  if (!to || lead.stage === stageId) return;
  await setStage(lead.id, to.id, `Stufe: ${from?.label ?? lead.stage} → ${to.label}`);
  after(() => sendWebhook({ event: "lead.stage_changed", leadId: lead.id, from: lead.stage, to: to.id }));
  refresh(lead);
}

export async function moveLeadFromForm(formData: FormData) {
  await moveLead(String(formData.get("leadId")), String(formData.get("stage")));
}

export async function updateValue(formData: FormData) {
  await requireOwner();
  const { lead } = await loadLead(String(formData.get("leadId")));
  const raw = String(formData.get("value") ?? "").replace(/[^\d]/g, "");
  const value = raw ? Math.min(Number(raw), 1_000_000_000) : null;
  await setValue(lead.id, value, value === null ? "Deal-Wert entfernt" : `Deal-Wert: ${formatEuro(value)}`);
  refresh(lead);
}

export async function addNote(formData: FormData) {
  await requireOwner();
  const { lead } = await loadLead(String(formData.get("leadId")));
  const text = String(formData.get("note") ?? "")
    .trim()
    .slice(0, 10000);
  if (!text) return;
  await addActivity(lead.id, "note", text);
  refresh(lead);
}

export type AiState = { error?: string; ok?: boolean };

export async function createBriefing(_prev: AiState, formData: FormData): Promise<AiState> {
  await requireOwner();
  const { lead, funnel, sourceLabel, pipeline } = await loadLead(String(formData.get("leadId")));
  try {
    await saveBriefing(lead.id, await generateBriefing(lead, { label: sourceLabel, funnel }, pipeline));
  } catch (error) {
    if (error instanceof AiError) return { error: error.message };
    throw error;
  }
  refresh(lead);
  return { ok: true };
}

export async function createFollowUp(_prev: AiState, formData: FormData): Promise<AiState> {
  await requireOwner();
  const { lead, funnel, sourceLabel, pipeline } = await loadLead(String(formData.get("leadId")));
  const notes = String(formData.get("notes") ?? "")
    .trim()
    .slice(0, 50000);
  if (notes.length < 20) return { error: "Bitte Gesprächsnotizen oder ein Transkript einfügen (mindestens 20 Zeichen)." };
  try {
    const followup = await generateFollowUp(lead, { label: sourceLabel, funnel }, pipeline, notes);
    await addActivity(lead.id, "note", notes);
    await saveFollowup(lead.id, followup);
  } catch (error) {
    if (error instanceof AiError) return { error: error.message };
    throw error;
  }
  refresh(lead);
  return { ok: true };
}
