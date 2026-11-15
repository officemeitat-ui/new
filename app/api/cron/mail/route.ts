import { after, NextResponse } from "next/server";
import { imapConfigured } from "@/lib/mail/imap";
import { pollMailbox } from "@/lib/mail/process";
import { dispatchEvents } from "@/lib/notify";
import { secretsMatch } from "@/lib/secrets";

// Postfach-Abruf für den E-Mail-Assistenten. Regelmäßig aufrufen, z. B. alle 5 Minuten per Cron:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://cockpit.example.at/api/cron/mail
// (Vercel Cron sendet denselben Header automatisch, wenn CRON_SECRET gesetzt ist.)
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET ist nicht gesetzt" }, { status: 503 });
  if (!secretsMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  if (!imapConfigured()) return NextResponse.json({ error: "IMAP ist nicht konfiguriert" }, { status: 503 });

  try {
    const { fetched, processed, events } = await pollMailbox();
    if (events.length > 0) after(() => dispatchEvents(events));
    return NextResponse.json({ fetched, processed });
  } catch (error) {
    console.error("Postfach-Abruf fehlgeschlagen:", error);
    return NextResponse.json({ error: "Postfach-Abruf fehlgeschlagen" }, { status: 500 });
  }
}
