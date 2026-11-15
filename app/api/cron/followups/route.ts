import { NextResponse } from "next/server";
import { createFollowUps } from "@/lib/followup";
import { secretsMatch } from "@/lib/secrets";

// Nachfass-Entwürfe für offene Anfragen. Einmal täglich aufrufen, z. B. morgens:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://cockpit.example.at/api/cron/followups
// Die Entwürfe landen im Cockpit zur Freigabe – versendet wird nichts automatisch.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET ist nicht gesetzt" }, { status: 503 });
  if (!secretsMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  try {
    return NextResponse.json(await createFollowUps());
  } catch (error) {
    console.error("Nachfass-Entwürfe fehlgeschlagen:", error);
    return NextResponse.json({ error: "Nachfass-Entwürfe fehlgeschlagen" }, { status: 500 });
  }
}
