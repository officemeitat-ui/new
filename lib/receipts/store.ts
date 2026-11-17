import "server-only";
import type { Row } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

/**
 * neu: erfasst und ausgelesen, bereit für die Buchhaltung · pruefen: bitte kurz ansehen (unsicher, Mahnung, Auslesen fehlgeschlagen)
 * fehlt: Rechnung angekündigt, aber keine Datei (z. B. nur Download-Link) · exportiert: an die Buchhaltung übergeben
 */
export type ReceiptStatus = "neu" | "pruefen" | "fehlt" | "exportiert";
export type ReceiptDocType = "rechnung" | "gutschrift" | "mahnung" | "sonstiger_beleg";

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  neu: "Bereit",
  pruefen: "Prüfen",
  fehlt: "Datei fehlt",
  exportiert: "Übergeben",
};

export const DOC_TYPE_LABELS: Record<ReceiptDocType, string> = {
  rechnung: "Rechnung",
  gutschrift: "Gutschrift",
  mahnung: "Mahnung",
  sonstiger_beleg: "Sonstiger Beleg",
};

export type Receipt = {
  id: string;
  emailId: string | null;
  source: "email" | "upload";
  status: ReceiptStatus;
  fileName: string | null;
  contentType: string | null;
  size: number | null;
  hasFile: boolean;
  docType: ReceiptDocType | null;
  supplier: string | null;
  invoiceNumber: string | null;
  /** JJJJ-MM-TT */
  invoiceDate: string | null;
  dueDate: string | null;
  grossCents: number | null;
  netCents: number | null;
  vatCents: number | null;
  currency: string | null;
  /** true: bereits bezahlt (Kreditkarte, Abbuchung …), false: offen, null: unbekannt */
  paid: boolean | null;
  description: string | null;
  /** Buchungsmonat JJJJ-MM (aus dem Belegdatum, sonst Eingangsmonat) */
  month: string;
  note: string | null;
  exportedAt: string | null;
  createdAt: string;
};

export type ReceiptInput = Omit<Receipt, "id" | "hasFile" | "exportedAt" | "createdAt" | "size"> & {
  content: Buffer | null;
  sha256: string | null;
};

const COLUMNS = `id, email_id, source, status, file_name, content_type, size, (content IS NOT NULL) AS has_file, doc_type, supplier,
  invoice_number, invoice_date, due_date, gross_cents, net_cents, vat_cents, currency, paid, description, month, note, exported_at, created_at`;

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
const int = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function toReceipt(row: Row): Receipt {
  return {
    id: String(row.id),
    emailId: text(row.email_id),
    source: String(row.source) as Receipt["source"],
    status: String(row.status) as ReceiptStatus,
    fileName: text(row.file_name),
    contentType: text(row.content_type),
    size: int(row.size),
    hasFile: Number(row.has_file) === 1,
    docType: text(row.doc_type) as ReceiptDocType | null,
    supplier: text(row.supplier),
    invoiceNumber: text(row.invoice_number),
    invoiceDate: text(row.invoice_date),
    dueDate: text(row.due_date),
    grossCents: int(row.gross_cents),
    netCents: int(row.net_cents),
    vatCents: int(row.vat_cents),
    currency: text(row.currency),
    paid: row.paid === null || row.paid === undefined ? null : Number(row.paid) === 1,
    description: text(row.description),
    month: String(row.month),
    note: text(row.note),
    exportedAt: text(row.exported_at),
    createdAt: String(row.created_at),
  };
}

/** Speichert einen Beleg; null, wenn genau diese Datei (gleicher Inhalt) schon vorhanden ist. */
export async function insertReceipt(input: ReceiptInput): Promise<Receipt | null> {
  const client = await db();
  const id = randomUUID();
  const result = await client.execute({
    sql: `INSERT INTO receipts (id, email_id, source, status, file_name, content_type, size, sha256, content, doc_type, supplier,
            invoice_number, invoice_date, due_date, gross_cents, net_cents, vat_cents, currency, paid, description, month, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING`,
    args: [
      id,
      input.emailId,
      input.source,
      input.status,
      input.fileName,
      input.contentType,
      input.content?.length ?? null,
      input.sha256,
      input.content,
      input.docType,
      input.supplier,
      input.invoiceNumber,
      input.invoiceDate,
      input.dueDate,
      input.grossCents,
      input.netCents,
      input.vatCents,
      input.currency,
      input.paid === null ? null : input.paid ? 1 : 0,
      input.description,
      input.month,
      input.note,
      new Date().toISOString(),
    ],
  });
  return result.rowsAffected > 0 ? getReceipt(id) : null;
}

export async function getReceipt(id: string): Promise<Receipt | null> {
  const client = await db();
  const result = await client.execute({ sql: `SELECT ${COLUMNS} FROM receipts WHERE id = ?`, args: [id] });
  return result.rows[0] ? toReceipt(result.rows[0]) : null;
}

export async function getReceiptFile(id: string): Promise<{ receipt: Receipt; content: Buffer } | null> {
  const client = await db();
  const result = await client.execute({ sql: `SELECT ${COLUMNS}, content FROM receipts WHERE id = ?`, args: [id] });
  const row = result.rows[0];
  if (!row || row.content === null || row.content === undefined) return null;
  return { receipt: toReceipt(row), content: Buffer.from(row.content as ArrayBuffer) };
}

export async function receiptExistsWithHash(sha256: string): Promise<boolean> {
  const client = await db();
  const result = await client.execute({ sql: "SELECT 1 FROM receipts WHERE sha256 = ?", args: [sha256] });
  return result.rows.length > 0;
}

/** Anderer Beleg mit derselben Rechnungsnummer vom selben Lieferanten (z. B. Rechnung zweimal geschickt, einmal als Kopie). */
export async function findSameInvoice(supplier: string, invoiceNumber: string): Promise<Receipt | null> {
  const client = await db();
  const result = await client.execute({
    sql: `SELECT ${COLUMNS} FROM receipts WHERE lower(supplier) = lower(?) AND lower(invoice_number) = lower(?) LIMIT 1`,
    args: [supplier, invoiceNumber],
  });
  return result.rows[0] ? toReceipt(result.rows[0]) : null;
}

export async function listReceipts(month: string): Promise<Receipt[]> {
  const client = await db();
  const result = await client.execute({
    sql: `SELECT ${COLUMNS} FROM receipts WHERE month = ? ORDER BY COALESCE(invoice_date, created_at), created_at`,
    args: [month],
  });
  return result.rows.map(toReceipt);
}

export async function receiptsForEmails(emailIds: string[]): Promise<Map<string, Receipt[]>> {
  const map = new Map<string, Receipt[]>();
  if (emailIds.length === 0) return map;
  const client = await db();
  const result = await client.execute({
    sql: `SELECT ${COLUMNS} FROM receipts WHERE email_id IN (${emailIds.map(() => "?").join(", ")})`,
    args: emailIds,
  });
  for (const receipt of result.rows.map(toReceipt)) {
    map.set(receipt.emailId!, [...(map.get(receipt.emailId!) ?? []), receipt]);
  }
  return map;
}

/** Monate mit Belegen, neueste zuerst. */
export async function receiptMonths(): Promise<string[]> {
  const client = await db();
  const result = await client.execute("SELECT DISTINCT month FROM receipts ORDER BY month DESC");
  return result.rows.map((r) => String(r.month));
}

/** Belege, um die sich jemand kümmern muss (Prüfen, Datei fehlt). */
export async function openReceiptCount(): Promise<number> {
  const client = await db();
  const result = await client.execute("SELECT COUNT(*) AS n FROM receipts WHERE status IN ('pruefen', 'fehlt')");
  return Number(result.rows[0]?.n ?? 0);
}

export async function updateReceipt(
  id: string,
  fields: Partial<
    Pick<
      Receipt,
      | "status"
      | "docType"
      | "supplier"
      | "invoiceNumber"
      | "invoiceDate"
      | "dueDate"
      | "grossCents"
      | "netCents"
      | "vatCents"
      | "currency"
      | "paid"
      | "description"
      | "month"
      | "note"
    >
  > & { file?: { name: string; contentType: string; content: Buffer; sha256: string } },
): Promise<void> {
  const columns: Record<string, string> = {
    status: "status",
    docType: "doc_type",
    supplier: "supplier",
    invoiceNumber: "invoice_number",
    invoiceDate: "invoice_date",
    dueDate: "due_date",
    grossCents: "gross_cents",
    netCents: "net_cents",
    vatCents: "vat_cents",
    currency: "currency",
    paid: "paid",
    description: "description",
    month: "month",
    note: "note",
  };
  const sets: string[] = [];
  const args: (string | number | Buffer | null)[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!(key in columns)) continue;
    sets.push(`${columns[key]} = ?`);
    args.push(value === undefined || value === null ? null : typeof value === "boolean" ? (value ? 1 : 0) : (value as string | number));
  }
  if (fields.file) {
    sets.push("file_name = ?", "content_type = ?", "size = ?", "content = ?", "sha256 = ?");
    args.push(fields.file.name, fields.file.contentType, fields.file.content.length, fields.file.content, fields.file.sha256);
  }
  if (sets.length === 0) return;
  const client = await db();
  await client.execute({ sql: `UPDATE receipts SET ${sets.join(", ")} WHERE id = ?`, args: [...args, id] });
}

export async function deleteReceipt(id: string): Promise<void> {
  const client = await db();
  await client.execute({ sql: "DELETE FROM receipts WHERE id = ?", args: [id] });
}

/** Markiert alle Belege eines Monats mit Datei als an die Buchhaltung übergeben. Liefert die Anzahl. */
export async function markMonthExported(month: string, now = new Date()): Promise<number> {
  const client = await db();
  const result = await client.execute({
    sql: `UPDATE receipts SET status = 'exportiert', exported_at = ? WHERE month = ? AND status IN ('neu', 'pruefen') AND content IS NOT NULL`,
    args: [now.toISOString(), month],
  });
  return result.rowsAffected;
}

/** Löscht die Dateien übergebener Belege nach Ablauf der Frist; Eckdaten bleiben. Liefert die Anzahl. */
export async function purgeExportedFiles(days: number, now = new Date()): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const client = await db();
  const result = await client.execute({
    sql: `UPDATE receipts SET content = NULL, note = 'Datei nach der Übergabe an die Buchhaltung gelöscht'
          WHERE status = 'exportiert' AND exported_at < ? AND content IS NOT NULL`,
    args: [cutoff],
  });
  return result.rowsAffected;
}
