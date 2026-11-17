"use server";

import { revalidatePath } from "next/cache";
import { logAction, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { createTask } from "@/lib/workspace/tasks";

/** Aus einer Frist eine Aufgabe machen (zwei Wochen vorher fällig) – einmal je Frist. */
export async function deadlineToTask(formData: FormData) {
  await requireAdmin();
  const key = String(formData.get("key") ?? "");
  const dueAt = String(formData.get("dueAt") ?? "");
  const externalId = `frist:${key}:${dueAt}`;
  const existing = await (await db()).execute({ sql: "SELECT id FROM tasks WHERE external_id = ?", args: [externalId] });
  if (existing.rows[0]) return;
  const remind = new Date(`${dueAt}T12:00:00Z`);
  remind.setUTCDate(remind.getUTCDate() - 14);
  const today = new Date().toISOString().slice(0, 10);
  const due = remind.toISOString().slice(0, 10) < today ? today : remind.toISOString().slice(0, 10);
  await createTask({
    title: String(formData.get("title") ?? "Frist").slice(0, 200),
    notes: `Frist: ${dueAt}`,
    listName: "Kunden",
    dueDate: due,
    priority: "hoch",
    customerId: String(formData.get("customerId") ?? "") || null,
    source: "manuell",
    externalId,
  });
  await logAction("Aufgabe aus Frist", String(formData.get("title") ?? ""));
  revalidatePath("/app/fristen");
}
