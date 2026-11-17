import { NextResponse } from "next/server";
import { runDomainChecks } from "@/lib/checks/run";
import { secretsMatch } from "@/lib/secrets";

// Tägliche Prüfung aller Kunden-Domains (SPF, DMARC, DKIM, MX, Zertifikat):
//   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/checks
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET ist nicht gesetzt" }, { status: 503 });
  if (!secretsMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  return NextResponse.json(await runDomainChecks());
}
