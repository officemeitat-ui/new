import "server-only";
import { randomUUID } from "node:crypto";
import { findLayout, RECORD_LAYOUTS, type RecordLayout } from "@/config/records";
import { db } from "@/lib/db";
import { docKey, seal, unseal, VaultLockedError } from "@/lib/workspace/vault";

// Strukturierte Kunden-Dokumentation (Ansprechpartner, Inventar, Domains, Lizenzen, Verträge …) nach Feldvorlagen.
// Inhalt und Titel liegen verschlüsselt im Doku-Tresor. Lesbar bleiben nur Bereich, Frist (für Erinnerungen) und – bei
// Domains – der Domainname für die automatische Prüfung (öffentliche Information).

export type RecordItem = {
  id: string;
  customerId: string;
  kind: string;
  title: string;
  data: Record<string, string>;
  dueAt: string | null;
  checkTarget: string | null;
  check: unknown | null;
  checkedAt: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export class RecordError extends Error {}

const toItem = (r: Record<string, unknown>, key: Buffer | null): RecordItem => ({
  id: String(r.id),
  customerId: String(r.customer_id),
  kind: String(r.kind),
  title: unseal(key, r.title) ?? "",
  data: JSON.parse(unseal(key, r.data) ?? "{}") as Record<string, string>,
  dueAt: (r.due_at as string | null) ?? null,
  checkTarget: (r.check_target as string | null) ?? null,
  check: r.check_result ? (JSON.parse(String(r.check_result)) as unknown) : null,
  checkedAt: (r.checked_at as string | null) ?? null,
  updatedBy: (r.updated_by as string | null) ?? null,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

/** Domain aus Eingaben wie „https://www.Huber-STB.at/“ → „huber-stb.at“. */
export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

/** Prüft und bereinigt die Eingaben nach der Feldvorlage. */
export function cleanRecordData(layout: RecordLayout, input: Record<string, unknown>): Record<string, string> {
  const data: Record<string, string> = {};
  for (const field of layout.fields) {
    const raw = input[field.key];
    let value = typeof raw === "string" ? raw.trim() : raw === true ? "ja" : "";
    if (field.type === "boolean") value = raw === true || raw === "on" || raw === "ja" ? "ja" : "";
    if (!value) {
      if (field.required) throw new RecordError(`Bitte „${field.label}“ ausfüllen`);
      continue;
    }
    if (value.length > (field.type === "textarea" ? 5000 : 300)) throw new RecordError(`„${field.label}“ ist zu lang`);
    switch (field.type) {
      case "email":
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new RecordError(`„${field.label}“ ist keine gültige E-Mail-Adresse`);
        value = value.toLowerCase();
        break;
      case "url":
        if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
        break;
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RecordError(`„${field.label}“: Datum bitte als JJJJ-MM-TT`);
        break;
      case "number":
        value = value.replace(",", ".");
        if (!Number.isFinite(Number(value))) throw new RecordError(`„${field.label}“ ist keine Zahl`);
        break;
      case "select":
        if (field.options && !field.options.includes(value)) throw new RecordError(`„${field.label}“: ungültige Auswahl`);
        break;
    }
    if (layout.checkField === field.key) value = normalizeDomain(value);
    data[field.key] = value;
  }
  if (layout.checkField && data[layout.checkField] && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(data[layout.checkField])) {
    throw new RecordError("Bitte eine gültige Domain angeben, z. B. huber-stb.at");
  }
  return data;
}

export async function listRecords(customerId: string, kind?: string): Promise<RecordItem[]> {
  const key = await docKey();
  const result = await (
    await db()
  ).execute({
    sql: `SELECT * FROM records WHERE customer_id = ?${kind ? " AND kind = ?" : ""}`,
    args: kind ? [customerId, kind] : [customerId],
  });
  return result.rows
    .map((r) => toItem(r as Record<string, unknown>, key))
    .sort((a, b) => a.title.localeCompare(b.title, "de", { numeric: true }));
}

export async function getRecord(id: string): Promise<RecordItem | null> {
  const key = await docKey();
  const result = await (await db()).execute({ sql: "SELECT * FROM records WHERE id = ?", args: [id] });
  return result.rows[0] ? toItem(result.rows[0] as Record<string, unknown>, key) : null;
}

export async function saveRecord(
  input: { id?: string; customerId: string; kind: string; data: Record<string, unknown> },
  by: string | null,
  now = new Date(),
): Promise<RecordItem> {
  const layout = findLayout(input.kind);
  if (!layout) throw new RecordError("Unbekannter Bereich");
  const data = cleanRecordData(layout, input.data);
  const key = await docKey();
  const title = data[layout.titleField] ?? layout.label;
  const due = layout.due?.compute(data) ?? null;
  const target = layout.checkField ? (data[layout.checkField] ?? null) : null;
  const client = await db();
  const stamp = now.toISOString();
  if (input.id) {
    const existing = await client.execute({ sql: "SELECT customer_id, kind, check_target FROM records WHERE id = ?", args: [input.id] });
    const row = existing.rows[0];
    if (!row || row.customer_id !== input.customerId || row.kind !== input.kind) throw new RecordError("Eintrag nicht gefunden");
    const targetChanged = row.check_target !== target;
    await client.execute({
      sql: `UPDATE records SET title = ?, data = ?, due_at = ?, check_target = ?, updated_by = ?, updated_at = ?
            ${targetChanged ? ", check_result = NULL, checked_at = NULL" : ""} WHERE id = ?`,
      args: [seal(key, title), seal(key, JSON.stringify(data)), due, target, by, stamp, input.id],
    });
    return (await getRecord(input.id))!;
  }
  const id = randomUUID();
  await client.execute({
    sql: `INSERT INTO records (id, customer_id, kind, title, data, due_at, check_target, updated_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, input.customerId, input.kind, seal(key, title), seal(key, JSON.stringify(data)), due, target, by, stamp, stamp],
  });
  return (await getRecord(id))!;
}

export async function deleteRecord(id: string) {
  await (await db()).execute({ sql: "DELETE FROM records WHERE id = ?", args: [id] });
}

/** Anzahl je Bereich – ohne Entschlüsseln (für Navigation und Übersicht). */
export async function countRecords(customerId: string): Promise<Record<string, number>> {
  const result = await (
    await db()
  ).execute({ sql: "SELECT kind, COUNT(*) AS n FROM records WHERE customer_id = ? GROUP BY kind", args: [customerId] });
  return Object.fromEntries(result.rows.map((r) => [String(r.kind), Number(r.n)]));
}

export type DueItem = {
  id: string;
  customerId: string;
  customerName: string;
  kind: string;
  kindLabel: string;
  dueLabel: string;
  dueAt: string;
  /** null, wenn die Doku gesperrt ist */
  title: string | null;
};

/** Fristen bis einschließlich `until` (auch überfällige). Titel nur, wenn der Tresor offen ist. */
export async function dueRecords(until: string, customerId?: string): Promise<DueItem[]> {
  let key: Buffer | null = null;
  let locked = false;
  try {
    key = await docKey();
  } catch (error) {
    if (!(error instanceof VaultLockedError)) throw error;
    locked = true;
  }
  const result = await (
    await db()
  ).execute({
    sql: `SELECT r.id, r.customer_id, r.kind, r.title, r.due_at, c.name AS customer_name FROM records r JOIN customers c ON c.id = r.customer_id
          WHERE r.due_at IS NOT NULL AND r.due_at <= ?${customerId ? " AND r.customer_id = ?" : ""} ORDER BY r.due_at`,
    args: customerId ? [until, customerId] : [until],
  });
  return result.rows.map((r) => {
    const layout = findLayout(String(r.kind));
    return {
      id: String(r.id),
      customerId: String(r.customer_id),
      customerName: String(r.customer_name),
      kind: String(r.kind),
      kindLabel: layout?.label ?? String(r.kind),
      dueLabel: layout?.due?.label ?? "Frist",
      dueAt: String(r.due_at),
      title: locked ? null : unseal(key, r.title),
    };
  });
}

/** Alle Prüfziele (Domains) – für die tägliche Prüfung, ohne Entschlüsseln. */
export async function checkTargets(): Promise<{ id: string; customerId: string; target: string }[]> {
  const result = await (await db()).execute("SELECT id, customer_id, check_target FROM records WHERE check_target IS NOT NULL");
  return result.rows.map((r) => ({ id: String(r.id), customerId: String(r.customer_id), target: String(r.check_target) }));
}

export async function saveCheckResult(id: string, result: unknown, now = new Date()) {
  await (
    await db()
  ).execute({
    sql: "UPDATE records SET check_result = ?, checked_at = ? WHERE id = ?",
    args: [JSON.stringify(result), now.toISOString(), id],
  });
}

/** Prüfergebnisse eines Kunden (lesbar ohne Tresor). */
export async function checkResults(
  customerId?: string,
): Promise<{ id: string; customerId: string; target: string; result: unknown; checkedAt: string | null }[]> {
  const result = await (
    await db()
  ).execute({
    sql: `SELECT id, customer_id, check_target, check_result, checked_at FROM records WHERE check_target IS NOT NULL${customerId ? " AND customer_id = ?" : ""}`,
    args: customerId ? [customerId] : [],
  });
  return result.rows.map((r) => ({
    id: String(r.id),
    customerId: String(r.customer_id),
    target: String(r.check_target),
    result: r.check_result ? JSON.parse(String(r.check_result)) : null,
    checkedAt: (r.checked_at as string | null) ?? null,
  }));
}

/** Für die Suche: alle Einträge entschlüsselt mit Kundennamen. */
export async function allRecordsForSearch(key: Buffer | null, customerId?: string) {
  const result = await (
    await db()
  ).execute({
    sql: `SELECT r.*, c.name AS customer_name FROM records r JOIN customers c ON c.id = r.customer_id${customerId ? " WHERE c.id = ?" : ""}`,
    args: customerId ? [customerId] : [],
  });
  return result.rows.map((r) => ({ ...toItem(r as Record<string, unknown>, key), customerName: String(r.customer_name) }));
}

/** Kurzbeschreibung eines Eintrags aus den Listenfeldern (für Suche und Assistent). */
export function describeRecord(item: { kind: string; data: Record<string, string> }): string {
  const layout = findLayout(item.kind);
  if (!layout) return "";
  return layout.fields
    .filter((f) => f.key !== layout.titleField && item.data[f.key])
    .map((f) => (f.type === "boolean" ? f.label : `${f.label}: ${item.data[f.key]}`))
    .join(" · ");
}

export const RECORD_KINDS = RECORD_LAYOUTS.map((l) => l.kind);
