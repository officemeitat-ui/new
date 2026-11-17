"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { AiError } from "@/lib/ai";
import { fieldsFromExtraction } from "@/lib/receipts/capture";
import { extractReceipt } from "@/lib/receipts/extract";
import { parseAmount } from "@/lib/receipts/files";
import {
  deleteReceipt,
  getReceipt,
  getReceiptFile,
  markMonthExported,
  updateReceipt,
  type ReceiptDocType,
  type ReceiptStatus,
} from "@/lib/receipts/store";

export type ReceiptActionState = { ok?: boolean; error?: string; message?: string };

const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: ReceiptStatus[] = ["neu", "pruefen", "fehlt", "exportiert"];
const DOC_TYPES: ReceiptDocType[] = ["rechnung", "gutschrift", "mahnung", "sonstiger_beleg"];

function refresh(id?: string) {
  revalidatePath("/admin/belege");
  if (id) revalidatePath(`/admin/belege/${id}`);
  revalidatePath("/admin", "layout");
}

/** Korrigierte Angaben eines Belegs speichern. */
export async function saveReceipt(_prev: ReceiptActionState, formData: FormData): Promise<ReceiptActionState> {
  await requireOwner();
  const id = String(formData.get("id"));
  const receipt = await getReceipt(id);
  if (!receipt) return { error: "Beleg nicht gefunden" };

  const field = (name: string) => String(formData.get(name) ?? "").trim();
  const amounts = { gross: parseAmount(field("gross")), net: parseAmount(field("net")), vat: parseAmount(field("vat")) };
  if (Object.values(amounts).some((v) => Number.isNaN(v))) return { error: "Beträge bitte als Zahl angeben, z. B. 1.234,56" };
  const invoiceDate = field("invoiceDate");
  const dueDate = field("dueDate");
  if ((invoiceDate && !DATE.test(invoiceDate)) || (dueDate && !DATE.test(dueDate))) return { error: "Ungültiges Datum" };
  const status = field("status") as ReceiptStatus;
  const docType = field("docType") as ReceiptDocType;
  if (!STATUSES.includes(status) || !DOC_TYPES.includes(docType)) return { error: "Ungültige Auswahl" };
  const paid = field("paid");

  await updateReceipt(id, {
    supplier: field("supplier") || null,
    invoiceNumber: field("invoiceNumber") || null,
    invoiceDate: invoiceDate || null,
    dueDate: dueDate || null,
    grossCents: amounts.gross,
    netCents: amounts.net,
    vatCents: amounts.vat,
    currency: (field("currency") || "EUR").toUpperCase().slice(0, 3),
    paid: paid === "ja" ? true : paid === "nein" ? false : null,
    description: field("description") || null,
    docType,
    status,
    // Der Buchungsmonat folgt dem Belegdatum.
    month: invoiceDate ? invoiceDate.slice(0, 7) : receipt.month,
    note: status === "neu" || status === "exportiert" ? null : receipt.note,
  });
  refresh(id);
  return { ok: true, message: "Gespeichert" };
}

/** Beleg erneut mit der KI auslesen (z. B. nach einem Fehler). */
export async function rereadReceipt(_prev: ReceiptActionState, formData: FormData): Promise<ReceiptActionState> {
  await requireOwner();
  const id = String(formData.get("id"));
  const file = await getReceiptFile(id);
  if (!file) return { error: "Zu diesem Beleg ist keine Datei vorhanden" };
  try {
    const extraction = await extractReceipt({
      name: file.receipt.fileName ?? "beleg",
      contentType: file.receipt.contentType ?? "application/pdf",
      content: file.content,
    });
    if (extraction.dokumentart === "kein_beleg") {
      await updateReceipt(id, {
        status: "pruefen",
        note: "Laut KI kein Rechnungsbeleg (z. B. Lieferschein oder AGB) – bitte prüfen oder löschen",
      });
    } else {
      const fields = fieldsFromExtraction(extraction, new Date(file.receipt.createdAt));
      await updateReceipt(id, { ...fields, status: file.receipt.status === "exportiert" ? "exportiert" : fields.status });
    }
  } catch (error) {
    if (error instanceof AiError) return { error: error.message };
    throw error;
  }
  refresh(id);
  return { ok: true, message: "Neu ausgelesen" };
}

export async function removeReceipt(formData: FormData) {
  await requireOwner();
  const receipt = await getReceipt(String(formData.get("id")));
  if (receipt) await deleteReceipt(receipt.id);
  refresh();
  redirect(`/admin/belege?monat=${receipt?.month ?? ""}`);
}

/** Nach dem Hochladen in die Buchhaltung: alle Belege des Monats als übergeben markieren. */
export async function markExported(formData: FormData) {
  await requireOwner();
  const month = String(formData.get("month"));
  if (!MONTH.test(month)) return;
  await markMonthExported(month);
  refresh();
}
