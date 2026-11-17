import { NextResponse } from "next/server";
import { workspace } from "@/config/workspace";
import { isAdmin, logAction } from "@/lib/auth";
import { evidenceCsv, listLearners, orgName } from "@/lib/awareness/store";
import { safeNamePart } from "@/lib/receipts/files";

/** Nachweisliste der Schulungen einer Organisation als CSV. */
export async function GET(_request: Request, { params }: RouteContext<"/app/awareness/[org]/export">) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const { org } = await params;
  const name = await orgName(org);
  if (!name) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  await logAction("Awareness: Nachweisliste exportiert", name);
  return new Response(evidenceCsv(name, await listLearners(org), workspace.timeZone), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="schulungsnachweis-${safeNamePart(name)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
