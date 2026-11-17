import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { safeNamePart } from "@/lib/receipts/files";
import { getCustomer } from "@/lib/workspace/customers";
import { entriesCsv } from "@/lib/workspace/hours";

// Leistungsnachweis eines Kunden für einen Monat als CSV (für Excel oder als Beilage zur Rechnung).
export async function GET(request: Request, { params }: RouteContext<"/app/stunden/[id]/export">) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const { id } = await params;
  const month = new URL(request.url).searchParams.get("monat") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "Monat fehlt (monat=JJJJ-MM)" }, { status: 400 });
  const customer = await getCustomer(id);
  if (!customer) return NextResponse.json({ error: "Kunde nicht gefunden" }, { status: 404 });
  return new Response(await entriesCsv(id, month), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leistungsnachweis-${safeNamePart(customer.name)}-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
