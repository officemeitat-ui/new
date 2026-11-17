import "server-only";
import { createHash } from "node:crypto";
import { business } from "@/config/business";
import { AiError } from "@/lib/ai";
import { localDate } from "@/lib/calendar";
import type { Email, MailAttachment } from "@/lib/emails";
import { extractReceipt, type ReceiptExtraction } from "@/lib/receipts/extract";
import { normalizeContentType, RECEIPT_MAX_BYTES, receiptFileKind } from "@/lib/receipts/files";
import {
  findSameInvoice,
  insertReceipt,
  receiptExistsWithHash,
  type Receipt,
  type ReceiptDocType,
  type ReceiptInput,
  type ReceiptStatus,
} from "@/lib/receipts/store";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const validDate = (value: string | undefined | null) =>
  value && DATE.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) ? value : null;
const cents = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null);
const monthOf = (date: Date) => localDate(date, business.timeZone).slice(0, 7);

export const sha256 = (content: Buffer) => createHash("sha256").update(content).digest("hex");

/** Übernimmt die ausgelesenen Angaben in die Felder eines Belegs (ohne Datei und Herkunft). */
export function fieldsFromExtraction(extraction: ReceiptExtraction, receivedAt: Date) {
  const invoiceDate = validDate(extraction.rechnungsdatum);
  const docType = extraction.dokumentart === "kein_beleg" ? null : (extraction.dokumentart as ReceiptDocType);
  const note =
    docType === "mahnung"
      ? "Mahnung – bitte Zahlung prüfen"
      : docType === "sonstiger_beleg"
        ? "Keine klassische Rechnung (z. B. Quittung oder Zahlungsbestätigung) – bitte prüfen"
        : extraction.unsicher
          ? "Angaben unsicher – bitte mit dem Beleg vergleichen"
          : null;
  return {
    status: (note ? "pruefen" : "neu") as ReceiptStatus,
    docType,
    supplier: extraction.lieferant.trim() || null,
    invoiceNumber: extraction.rechnungsnummer.trim() || null,
    invoiceDate,
    dueDate: validDate(extraction.faelligAm),
    grossCents: cents(extraction.brutto),
    netCents: cents(extraction.netto),
    vatCents: cents(extraction.ust),
    currency: (extraction.waehrung.trim() || "EUR").toUpperCase().slice(0, 3),
    paid: extraction.bezahlt === "ja" ? true : extraction.bezahlt === "nein" ? false : null,
    description: extraction.beschreibung.trim() || null,
    month: invoiceDate ? invoiceDate.slice(0, 7) : monthOf(receivedAt),
    note,
  };
}

/**
 * Speichert die Belege aus Dateien (E-Mail-Anhänge oder Upload) und liest sie aus.
 * Dateien, die kein Beleg sind (AGB, Lieferschein …), werden nicht gespeichert; doppelte Dateien übersprungen.
 */
export async function captureReceipts(input: {
  files: MailAttachment[];
  source: "email" | "upload";
  email?: Pick<Email, "id" | "fromName" | "fromAddress" | "subject"> | null;
  receivedAt: Date;
}): Promise<{ stored: Receipt[]; duplicates: number; skipped: number }> {
  const stored: Receipt[] = [];
  let duplicates = 0;
  let skipped = 0;
  for (const file of input.files) {
    const contentType = normalizeContentType(file.contentType, file.name);
    if (!receiptFileKind(contentType, file.name)) {
      skipped++;
      continue;
    }
    const base: Omit<ReceiptInput, "status" | "content" | "sha256" | "fileName" | "contentType"> = {
      emailId: input.email?.id ?? null,
      source: input.source,
      docType: null,
      supplier: input.email?.fromName ?? null,
      invoiceNumber: null,
      invoiceDate: null,
      dueDate: null,
      grossCents: null,
      netCents: null,
      vatCents: null,
      currency: null,
      paid: null,
      description: null,
      month: monthOf(input.receivedAt),
      note: null,
    };
    if (file.content.length > RECEIPT_MAX_BYTES) {
      const tooLarge = await insertReceipt({
        ...base,
        status: "fehlt",
        fileName: file.name,
        contentType,
        content: null,
        sha256: null,
        note: `Datei „${file.name}“ ist größer als 20 MB und wurde nicht übernommen – bitte direkt in der Buchhaltung ablegen.`,
      });
      if (tooLarge) stored.push(tooLarge);
      continue;
    }
    const hash = sha256(file.content);
    if (await receiptExistsWithHash(hash)) {
      duplicates++;
      continue;
    }

    let fields: Partial<ReceiptInput> & { status: ReceiptStatus } = {
      status: "pruefen",
      note: "Beleg konnte nicht automatisch ausgelesen werden – bitte Angaben ergänzen",
    };
    try {
      const extraction = await extractReceipt({ ...file, contentType }, input.email ?? {});
      if (extraction.dokumentart === "kein_beleg") {
        skipped++;
        continue;
      }
      fields = fieldsFromExtraction(extraction, input.receivedAt);
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
      fields = { ...fields, note: `${error.message} Bitte Angaben ergänzen oder „Neu auslesen“.` };
    }
    if (fields.supplier && fields.invoiceNumber) {
      const same = await findSameInvoice(fields.supplier, fields.invoiceNumber);
      if (same) {
        fields = {
          ...fields,
          status: "pruefen",
          note: `Rechnungsnummer ${fields.invoiceNumber} gibt es schon (Monat ${same.month}) – Doppelt?`,
        };
      }
    }
    const receipt = await insertReceipt({
      ...base,
      ...fields,
      fileName: file.name,
      contentType,
      content: file.content,
      sha256: hash,
    });
    if (receipt) stored.push(receipt);
    else duplicates++;
  }
  return { stored, duplicates, skipped };
}

/** Eine E-Mail kündigt eine Rechnung an, bringt aber keine Datei mit (meist nur Download-Link im Kundenportal). */
export async function recordMissingReceipt(
  email: Pick<Email, "id" | "fromName" | "fromAddress" | "subject" | "receivedAt">,
): Promise<Receipt | null> {
  return insertReceipt({
    emailId: email.id,
    source: "email",
    status: "fehlt",
    fileName: null,
    contentType: null,
    content: null,
    sha256: null,
    docType: "rechnung",
    supplier: email.fromName ?? email.fromAddress.split("@")[1] ?? email.fromAddress,
    invoiceNumber: null,
    invoiceDate: null,
    dueDate: null,
    grossCents: null,
    netCents: null,
    vatCents: null,
    currency: null,
    paid: null,
    description: email.subject,
    month: monthOf(new Date(email.receivedAt)),
    note: "Rechnung ohne Anhang – vermutlich nur als Link in der E-Mail. Bitte herunterladen und hier hochladen.",
  });
}
