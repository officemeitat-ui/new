import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { safeNamePart } from "@/lib/receipts/files";
import { getCustomer } from "@/lib/workspace/customers";
import { listPorts, portsCsv } from "@/lib/workspace/docs";

// Patchliste eines Kunden als CSV (für Excel, zum Ausdrucken oder als Übergabe an den Elektriker).
export async function GET(_request: Request, { params }: RouteContext<"/app/kunden/[id]/doku/export">) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) return NextResponse.json({ error: "Kunde nicht gefunden" }, { status: 404 });
  return new Response(portsCsv(await listPorts(id)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="patchliste-${safeNamePart(customer.name)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
