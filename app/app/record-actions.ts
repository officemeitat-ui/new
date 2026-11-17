"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { findLayout } from "@/config/records";
import { logAction, requireAdmin } from "@/lib/auth";
import { runDomainChecks } from "@/lib/checks/run";
import { getCustomer } from "@/lib/workspace/customers";
import { deleteRecord, getRecord, RecordError, saveRecord } from "@/lib/workspace/records";
import { VaultLockedError } from "@/lib/workspace/vault";

export type RecordState = { ok?: boolean; error?: string; message?: string; values?: Record<string, string> };

export async function saveRecordAction(_prev: RecordState, formData: FormData): Promise<RecordState> {
  const user = await requireAdmin();
  const customer = await getCustomer(String(formData.get("customerId") ?? ""));
  const layout = findLayout(String(formData.get("kind") ?? ""));
  if (!customer || !layout) return { error: "Nicht gefunden" };
  const id = String(formData.get("id") ?? "") || undefined;
  const values: Record<string, string> = {};
  for (const field of layout.fields) values[field.key] = String(formData.get(field.key) ?? "");
  let saved;
  try {
    saved = await saveRecord({ id, customerId: customer.id, kind: layout.kind, data: values }, user.name);
  } catch (error) {
    if (error instanceof RecordError || error instanceof VaultLockedError) return { error: error.message, values };
    throw error;
  }
  await logAction(id ? `${layout.label} geändert` : `${layout.label} angelegt`, `${customer.name}: ${saved.title}`);
  revalidatePath(`/app/kunden/${customer.id}/doku`, "layout");
  if (!id && layout.checkField) await runDomainChecks([saved.id]).catch(() => undefined);
  if (!id) redirect(`/app/kunden/${customer.id}/doku/eintraege/${layout.kind}/${saved.id}`);
  return { ok: true, message: "Gespeichert." };
}

export async function deleteRecordAction(formData: FormData) {
  await requireAdmin();
  const record = await getRecord(String(formData.get("id") ?? ""));
  if (!record) return;
  await deleteRecord(record.id);
  await logAction(`${findLayout(record.kind)?.label ?? "Eintrag"} gelöscht`, record.title);
  revalidatePath(`/app/kunden/${record.customerId}/doku`, "layout");
  redirect(`/app/kunden/${record.customerId}/doku/eintraege/${record.kind}`);
}

export async function checkDomainNow(formData: FormData) {
  await requireAdmin();
  const record = await getRecord(String(formData.get("id") ?? ""));
  if (!record) return;
  await runDomainChecks([record.id]);
  revalidatePath(`/app/kunden/${record.customerId}/doku/eintraege/${record.kind}/${record.id}`);
}
