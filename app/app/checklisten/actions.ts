"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAction, requireAdmin } from "@/lib/auth";
import { createChecklist, deleteChecklist, getChecklist, toggleChecklistItem } from "@/lib/workspace/checklists";
import { getCustomer } from "@/lib/workspace/customers";

export async function newChecklist(formData: FormData) {
  const user = await requireAdmin();
  const customer = await getCustomer(String(formData.get("customerId") ?? ""));
  if (!customer) return;
  const id = await createChecklist(
    {
      customerId: customer.id,
      templateId: String(formData.get("templateId") ?? ""),
      subject: String(formData.get("subject") ?? ""),
      dueDate: String(formData.get("dueDate") ?? "") || null,
    },
    user.name,
  );
  await logAction("Checkliste angelegt", customer.name);
  redirect(`/app/checklisten/${id}`);
}

export async function toggleItem(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  await toggleChecklistItem(id, Number(formData.get("idx")), user.name);
  revalidatePath(`/app/checklisten/${id}`);
}

export async function removeChecklist(formData: FormData) {
  await requireAdmin();
  const checklist = await getChecklist(String(formData.get("id") ?? ""));
  if (!checklist) return;
  await deleteChecklist(checklist.id);
  await logAction("Checkliste gelöscht", `${checklist.customerName}: ${checklist.title}`);
  redirect(`/app/checklisten?kunde=${checklist.customerId}`);
}
