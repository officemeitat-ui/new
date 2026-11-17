"use server";

import { revalidatePath } from "next/cache";
import { AiError } from "@/lib/ai";
import { logAction, requireAdmin } from "@/lib/auth";
import { M365Error, resolveFolderLink, type DriveFile } from "@/lib/m365";
import { getCustomer, setCustomerFiles } from "@/lib/workspace/customers";
import { askKnowledge } from "@/lib/workspace/knowledge";

export type KnowledgeState = { error?: string; question?: string; answer?: string; sources?: DriveFile[] };
export type FolderState = { ok?: boolean; error?: string; message?: string };

export async function askKnowledgeAction(_prev: KnowledgeState, formData: FormData): Promise<KnowledgeState> {
  const user = await requireAdmin();
  const question = String(formData.get("question") ?? "").trim();
  if (question.length < 3) return { error: "Bitte eine Frage stellen" };
  try {
    const result = await askKnowledge(user.id, question.slice(0, 500));
    return { question, answer: result.answer, sources: result.sources };
  } catch (error) {
    if (error instanceof M365Error || error instanceof AiError) return { question, error: error.message };
    throw error;
  }
}

export async function linkCustomerFolder(_prev: FolderState, formData: FormData): Promise<FolderState> {
  const user = await requireAdmin();
  const customer = await getCustomer(String(formData.get("customerId") ?? ""));
  if (!customer) return { error: "Kunde nicht gefunden" };
  try {
    const folder = await resolveFolderLink(user.id, String(formData.get("url") ?? ""));
    await setCustomerFiles(customer.id, { driveId: folder.driveId, itemId: folder.itemId, url: folder.url });
    await logAction("Kundenordner verknüpft", `${customer.name}: ${folder.name}`);
    revalidatePath(`/app/kunden/${customer.id}`);
    return { ok: true, message: `Ordner „${folder.name}“ verknüpft.` };
  } catch (error) {
    if (error instanceof M365Error) return { error: error.message };
    throw error;
  }
}

export async function unlinkCustomerFolder(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("customerId") ?? "");
  await setCustomerFiles(id, null);
  revalidatePath(`/app/kunden/${id}`);
}
