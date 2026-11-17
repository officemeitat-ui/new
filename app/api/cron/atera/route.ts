import { NextResponse } from "next/server";
import { ateraConfigured, AteraError } from "@/lib/atera";
import { secretsMatch } from "@/lib/secrets";
import { syncAtera } from "@/lib/workspace/atera-sync";

// Abgleich mit Atera (Kunden, offene Tickets, Warnungen, Geräte). Alle 5 Minuten aufrufen:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/atera
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET ist nicht gesetzt" }, { status: 503 });
  if (!secretsMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  if (!ateraConfigured()) return NextResponse.json({ error: "Atera ist nicht verbunden (ATERA_API_KEY)" }, { status: 503 });
  try {
    return NextResponse.json(await syncAtera());
  } catch (error) {
    console.error("Atera-Abgleich fehlgeschlagen:", error);
    const message = error instanceof AteraError ? error.message : "Atera-Abgleich fehlgeschlagen";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
