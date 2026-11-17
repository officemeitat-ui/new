import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { receiptFileKind, receiptFileName } from "@/lib/receipts/files";
import { getReceiptFile } from "@/lib/receipts/store";

// Belegdatei zum Ansehen im Cockpit (PDF-Vorschau) oder zum Herunterladen.
export async function GET(request: Request, { params }: RouteContext<"/admin/belege/datei/[id]">) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const { id } = await params;
  const file = await getReceiptFile(id);
  if (!file) return NextResponse.json({ error: "Datei nicht vorhanden" }, { status: 404 });
  const download = new URL(request.url).searchParams.has("download");
  const name = receiptFileName(file.receipt);
  // E-Rechnungen (XML) nur als Text anzeigen, damit der Browser darin nichts ausführt.
  const contentType =
    receiptFileKind(file.receipt.contentType ?? undefined, name) === "xml" ? "text/plain; charset=utf-8" : file.receipt.contentType;
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": contentType ?? "application/octet-stream",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
