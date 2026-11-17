import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { buildMonthExport } from "@/lib/receipts/export";

// Monatspaket: alle Belege eines Monats als ZIP plus Liste (CSV) – zum gesammelten Hochladen in die Buchhaltung.
export async function GET(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const month = new URL(request.url).searchParams.get("monat") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "Monat fehlt (monat=JJJJ-MM)" }, { status: 400 });
  const { zip } = await buildMonthExport(month);
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="belege-${month}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
