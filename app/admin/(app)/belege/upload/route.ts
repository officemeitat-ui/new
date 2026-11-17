import { NextResponse } from "next/server";
import { isOwner } from "@/lib/auth";
import { AiError } from "@/lib/ai";
import { captureReceipts, fieldsFromExtraction, sha256 } from "@/lib/receipts/capture";
import { extractReceipt } from "@/lib/receipts/extract";
import { normalizeContentType, receiptFileKind } from "@/lib/receipts/files";
import { getReceipt, receiptExistsWithHash, updateReceipt } from "@/lib/receipts/store";

// Beleg hochladen (eine Datei je Anfrage, damit auch größere PDFs durchgehen) –
// als neuer Beleg oder als fehlende Datei zu einem bestehenden („Datei fehlt“).
const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!(await isOwner())) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Ungültige Herkunft" }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Keine Datei" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: `${file.name}: größer als 9 MB` }, { status: 413 });
  const contentType = normalizeContentType(file.type, file.name);
  if (!receiptFileKind(contentType, file.name)) {
    return NextResponse.json({ error: `${file.name}: nur PDF, Fotos (JPG, PNG) oder E-Rechnung (XML)` }, { status: 415 });
  }
  const content = Buffer.from(await file.arrayBuffer());

  const receiptId = form?.get("receiptId");
  if (typeof receiptId === "string" && receiptId) {
    // Fehlende Datei zu einem angekündigten Beleg nachreichen.
    const receipt = await getReceipt(receiptId);
    if (!receipt) return NextResponse.json({ error: "Beleg nicht gefunden" }, { status: 404 });
    const hash = sha256(content);
    if (await receiptExistsWithHash(hash)) {
      return NextResponse.json({ error: `${file.name}: diese Datei ist schon abgelegt` }, { status: 409 });
    }
    await updateReceipt(receipt.id, { file: { name: file.name, contentType, content, sha256: hash }, status: "pruefen", note: null });
    try {
      const fields = fieldsFromExtraction(await extractReceipt({ name: file.name, contentType, content }), new Date(receipt.createdAt));
      await updateReceipt(receipt.id, { ...fields, supplier: fields.supplier ?? receipt.supplier });
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
      await updateReceipt(receipt.id, { note: `${error.message} Bitte Angaben ergänzen.` });
    }
    return NextResponse.json({ stored: 1, duplicates: 0, skipped: 0 });
  }

  const result = await captureReceipts({ files: [{ name: file.name, contentType, content }], source: "upload", receivedAt: new Date() });
  return NextResponse.json({ stored: result.stored.length, duplicates: result.duplicates, skipped: result.skipped });
}
