import { NextResponse } from "next/server";
import { sendDueReminders } from "@/lib/reminders";
import { secretsMatch } from "@/lib/secrets";

// Terminerinnerungen an Kunden. Stündlich aufrufen, z. B.:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://cockpit.example.at/api/cron/reminders
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET ist nicht gesetzt" }, { status: 503 });
  if (!secretsMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  try {
    return NextResponse.json(await sendDueReminders());
  } catch (error) {
    console.error("Terminerinnerungen fehlgeschlagen:", error);
    return NextResponse.json({ error: "Terminerinnerungen fehlgeschlagen" }, { status: 500 });
  }
}
