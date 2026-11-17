import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { safeNamePart } from "@/lib/receipts/files";
import { getCustomer } from "@/lib/workspace/customers";
import { listPorts, portsCsv } from "@/lib/workspace/docs";
import { VaultLockedError } from "@/lib/workspace/vault";

// Patchliste eines Kunden als CSV (für Excel, zum Ausdrucken oder als Übergabe an den Elektriker).
export async function GET(_request: Request, { params }: RouteContext<"/app/kunden/[id]/doku/export">) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) return NextResponse.json({ error: "Kunde nicht gefunden" }, { status: 404 });
  let ports;
  try {
    ports = await listPorts(id);
  } catch (error) {
    if (error instanceof VaultLockedError) return NextResponse.json({ error: error.message }, { status: 423 });
    throw error;
  }
  return new Response(portsCsv(ports), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="patchliste-${safeNamePart(customer.name)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
