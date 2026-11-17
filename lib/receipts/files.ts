// Welche Dateien als Beleg in Frage kommen und wie sie im Monatspaket heißen.

/** Größere Dateien werden nicht ausgelesen und nicht gespeichert, sondern als „fehlt“ vermerkt. */
export const RECEIPT_MAX_BYTES = 20 * 1024 * 1024;

export type ReceiptFileKind = "pdf" | "image" | "xml";

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** Normalisiert den Dateityp; Mail-Programme schicken PDFs oft als „application/octet-stream“. */
export function normalizeContentType(contentType: string | undefined, name: string | undefined): string {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const extension = (name ?? "").toLowerCase().split(".").pop() ?? "";
  if (type === "application/x-pdf" || ((type === "" || type === "application/octet-stream") && extension === "pdf")) {
    return "application/pdf";
  }
  if ((type === "" || type === "application/octet-stream") && IMAGE_TYPES[extension]) return IMAGE_TYPES[extension];
  if ((type === "" || type === "application/octet-stream") && extension === "xml") return "application/xml";
  if (type === "image/jpg") return "image/jpeg";
  return type || "application/octet-stream";
}

export function receiptFileKind(contentType: string | undefined, name: string | undefined): ReceiptFileKind | null {
  const type = normalizeContentType(contentType, name);
  if (type === "application/pdf") return "pdf";
  if (Object.values(IMAGE_TYPES).includes(type)) return "image";
  if (type === "application/xml" || type === "text/xml") return "xml";
  return null;
}

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/xml": "xml",
  "text/xml": "xml",
};

/** Nur Buchstaben, Ziffern und wenige Zeichen – Umlaute umschreiben, damit der Name überall funktioniert. */
export function safeNamePart(value: string, maxLength = 40): string {
  return value
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9.,+-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, maxLength)
    .replace(/[-.]+$/g, "");
}

/** Betrag in Cent als „1234,56“ (österreichische Schreibweise, ohne Tausenderpunkt). */
export function formatCents(cents: number | null): string {
  if (cents === null) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** z. B. „2026-11-05_Wortmann-AG_RE-2026-1234_1234,56EUR.pdf“ */
export function receiptFileName(
  receipt: {
    invoiceDate: string | null;
    month: string;
    supplier: string | null;
    invoiceNumber: string | null;
    grossCents: number | null;
    currency: string | null;
    contentType: string | null;
  },
  used: Set<string> = new Set(),
): string {
  const parts = [
    receipt.invoiceDate ?? `${receipt.month}-00`,
    safeNamePart(receipt.supplier || "Unbekannt"),
    receipt.invoiceNumber ? safeNamePart(receipt.invoiceNumber, 30) : null,
    receipt.grossCents !== null ? `${formatCents(receipt.grossCents)}${safeNamePart(receipt.currency || "EUR", 3)}` : null,
  ].filter((p): p is string => Boolean(p));
  const extension = EXTENSIONS[receipt.contentType ?? ""] ?? "bin";
  const stem = parts.join("_");
  let name = `${stem}.${extension}`;
  for (let i = 2; used.has(name); i++) name = `${stem}_${i}.${extension}`;
  used.add(name);
  return name;
}

/** Betrag aus einem Eingabefeld („1.234,56“, „1234.56“, „-12,5“) in Cent; leer = null, ungültig = NaN. */
export function parseAmount(input: string): number | null {
  const value = input.trim().replace(/\s|€|EUR/gi, "");
  if (!value) return null;
  // Letztes Komma oder letzter Punkt mit 1–2 Stellen dahinter ist das Dezimaltrennzeichen, alles andere Tausenderpunkte.
  const match = value.match(/^(-?)([\d.,]*?)(?:[.,](\d{1,2}))?$/);
  if (!match || !match[2].replace(/[.,]/g, "").match(/^\d*$/) || (!match[2] && !match[3])) return Number.NaN;
  const whole = match[2].replace(/[.,]/g, "") || "0";
  const fraction = (match[3] ?? "").padEnd(2, "0");
  return (match[1] ? -1 : 1) * (Number(whole) * 100 + Number(fraction || "0"));
}
