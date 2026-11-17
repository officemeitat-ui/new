import "server-only";
import { randomUUID } from "node:crypto";
import { findTemplate } from "@/config/checklists";
import { db } from "@/lib/db";

// Checklisten aus Vorlagen (Onboarding, Offboarding, Jahreswartung …) – je Kunde, mit „wer hat wann abgehakt“.

export type ChecklistItem = {
  idx: number;
  section: string | null;
  text: string;
  hint: string | null;
  doneAt: string | null;
  doneBy: string | null;
};
export type Checklist = {
  id: string;
  customerId: string;
  customerName: string;
  templateId: string;
  title: string;
  dueDate: string | null;
  createdBy: string | null;
  createdAt: string;
  doneAt: string | null;
  total: number;
  done: number;
};

const toChecklist = (r: Record<string, unknown>): Checklist => ({
  id: String(r.id),
  customerId: String(r.customer_id),
  customerName: String(r.customer_name ?? ""),
  templateId: String(r.template_id),
  title: String(r.title),
  dueDate: (r.due_date as string | null) ?? null,
  createdBy: (r.created_by as string | null) ?? null,
  createdAt: String(r.created_at),
  doneAt: (r.done_at as string | null) ?? null,
  total: Number(r.total ?? 0),
  done: Number(r.done ?? 0),
});

const SELECT = `SELECT c.*, k.name AS customer_name,
  (SELECT COUNT(*) FROM checklist_items i WHERE i.checklist_id = c.id) AS total,
  (SELECT COUNT(*) FROM checklist_items i WHERE i.checklist_id = c.id AND i.done_at IS NOT NULL) AS done
  FROM checklists c JOIN customers k ON k.id = c.customer_id`;

export async function createChecklist(
  input: { customerId: string; templateId: string; subject?: string | null; dueDate?: string | null },
  by: string | null,
  now = new Date(),
): Promise<string> {
  const template = findTemplate(input.templateId);
  if (!template) throw new Error("Unbekannte Vorlage");
  const subject = input.subject?.trim();
  const title = subject ? `${template.title}: ${subject}` : template.title;
  const id = randomUUID();
  const client = await db();
  await client.execute({
    sql: "INSERT INTO checklists (id, customer_id, template_id, title, due_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [id, input.customerId, template.id, title.slice(0, 200), input.dueDate || null, by, now.toISOString()],
  });
  let idx = 0;
  for (const section of template.sections) {
    for (const item of section.items) {
      const text = typeof item === "string" ? item : item.text;
      const hint = typeof item === "string" ? null : item.hint;
      await client.execute({
        sql: "INSERT INTO checklist_items (checklist_id, idx, section, text, hint) VALUES (?, ?, ?, ?, ?)",
        args: [id, idx++, section.title, text, hint],
      });
    }
  }
  return id;
}

export async function listChecklists(filter: { customerId?: string; open?: boolean } = {}): Promise<Checklist[]> {
  const where = [filter.customerId ? "c.customer_id = ?" : null, filter.open ? "c.done_at IS NULL" : null].filter(Boolean);
  const result = await (
    await db()
  ).execute({
    sql: `${SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY c.done_at IS NOT NULL, COALESCE(c.due_date, '9999'), c.created_at DESC`,
    args: filter.customerId ? [filter.customerId] : [],
  });
  return result.rows.map((r) => toChecklist(r as Record<string, unknown>));
}

export async function getChecklist(id: string): Promise<(Checklist & { items: ChecklistItem[] }) | null> {
  const client = await db();
  const result = await client.execute({ sql: `${SELECT} WHERE c.id = ?`, args: [id] });
  if (!result.rows[0]) return null;
  const items = await client.execute({ sql: "SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY idx", args: [id] });
  return {
    ...toChecklist(result.rows[0] as Record<string, unknown>),
    items: items.rows.map((r) => ({
      idx: Number(r.idx),
      section: (r.section as string | null) ?? null,
      text: String(r.text),
      hint: (r.hint as string | null) ?? null,
      doneAt: (r.done_at as string | null) ?? null,
      doneBy: (r.done_by as string | null) ?? null,
    })),
  };
}

/** Punkt abhaken bzw. wieder öffnen. Sind alle erledigt, gilt die Checkliste als abgeschlossen. */
export async function toggleChecklistItem(id: string, idx: number, by: string | null, now = new Date()) {
  const client = await db();
  const row = (await client.execute({ sql: "SELECT done_at FROM checklist_items WHERE checklist_id = ? AND idx = ?", args: [id, idx] }))
    .rows[0];
  if (!row) throw new Error("Punkt nicht gefunden");
  await client.execute({
    sql: "UPDATE checklist_items SET done_at = ?, done_by = ? WHERE checklist_id = ? AND idx = ?",
    args: row.done_at ? [null, null, id, idx] : [now.toISOString(), by, id, idx],
  });
  const open = Number(
    (await client.execute({ sql: "SELECT COUNT(*) AS n FROM checklist_items WHERE checklist_id = ? AND done_at IS NULL", args: [id] }))
      .rows[0].n,
  );
  await client.execute({ sql: "UPDATE checklists SET done_at = ? WHERE id = ?", args: [open === 0 ? now.toISOString() : null, id] });
}

export async function deleteChecklist(id: string) {
  await (await db()).execute({ sql: "DELETE FROM checklists WHERE id = ?", args: [id] });
}
