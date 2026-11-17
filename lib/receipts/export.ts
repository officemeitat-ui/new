import "server-only";
import { strToU8, zipSync, type Zippable } from "fflate";
import { formatCents, receiptFileName } from "@/lib/receipts/files";
import { DOC_TYPE_LABELS, getReceiptFile, listReceipts, RECEIPT_STATUS_LABELS, type Receipt } from "@/lib/receipts/store";

const CSV_HEADER = [
  "Datei",
  "Belegdatum",
  "Lieferant",
  "Rechnungsnummer",
  "Art",
  "Brutto",
  "Netto",
  "USt",
  "Währung",
  "Fällig am",
  "Bezahlt",
  "Beschreibung",
  "Status",
  "Hinweis",
];

function csvField(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Belegliste als CSV für Excel (Strichpunkt, Dezimalkomma, UTF-8 mit BOM). */
export function receiptsCsv(rows: { receipt: Receipt; fileName: string | null }[]): string {
  const lines = rows.map(({ receipt: r, fileName }) =>
    [
      fileName ?? "",
      r.invoiceDate ?? "",
      r.supplier ?? "",
      r.invoiceNumber ?? "",
      r.docType ? DOC_TYPE_LABELS[r.docType] : "",
      formatCents(r.grossCents),
      formatCents(r.netCents),
      formatCents(r.vatCents),
      r.currency ?? "",
      r.dueDate ?? "",
      r.paid === null ? "" : r.paid ? "ja" : "nein",
      r.description ?? "",
      RECEIPT_STATUS_LABELS[r.status],
      r.note ?? "",
    ]
      .map(csvField)
      .join(";"),
  );
  return `\uFEFF${[CSV_HEADER.join(";"), ...lines].join("\r\n")}\r\n`;
}

/**
 * Monatspaket für die Buchhaltung: alle Belegdateien des Monats mit sprechenden Namen plus Liste als CSV.
 * Belege ohne Datei stehen nur in der Liste (Status „Datei fehlt“), damit nichts untergeht.
 */
export async function buildMonthExport(month: string): Promise<{ zip: Uint8Array; files: number; missing: number }> {
  const receipts = await listReceipts(month);
  const used = new Set<string>();
  const entries: Zippable = {};
  const rows: { receipt: Receipt; fileName: string | null }[] = [];
  let files = 0;
  for (const receipt of receipts) {
    const file = receipt.hasFile ? await getReceiptFile(receipt.id) : null;
    if (!file) {
      rows.push({ receipt, fileName: null });
      continue;
    }
    const name = receiptFileName(receipt, used);
    // PDFs und Bilder sind bereits komprimiert.
    entries[name] = [new Uint8Array(file.content), { level: 0 }];
    rows.push({ receipt, fileName: name });
    files++;
  }
  entries[`belege-${month}.csv`] = strToU8(receiptsCsv(rows));
  return { zip: zipSync(entries), files, missing: rows.length - files };
}
