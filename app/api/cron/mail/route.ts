import { after, NextResponse } from "next/server";
import { business } from "@/config/business";
import { activeMailbox } from "@/lib/mail/mailbox";
import { pollMailbox } from "@/lib/mail/process";
import { dispatchEvents } from "@/lib/notify";
import { purgeExportedFiles } from "@/lib/receipts/store";
import { secretsMatch } from "@/lib/secrets";

// Postfach-Abruf für den E-Mail-Assistenten (IMAP oder Microsoft 365). Regelmäßig aufrufen, z. B. alle 5 Minuten per Cron:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://cockpit.example.at/api/cron/mail
// (Vercel Cron sendet denselben Header automatisch, wenn CRON_SECRET gesetzt ist.)
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET ist nicht gesetzt" }, { status: 503 });
  if (!secretsMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const mailbox = activeMailbox();
  if (!mailbox) return NextResponse.json({ error: "Kein Postfach konfiguriert (Microsoft 365 oder IMAP)" }, { status: 503 });

  try {
    const { fetched, processed, draftsSent, events } = await pollMailbox(mailbox);
    const filesPurged = await purgeExportedFiles(business.receipts.keepFilesDaysAfterExport);
    if (events.length > 0) after(() => dispatchEvents(events));
    return NextResponse.json({ mailbox: mailbox.kind, fetched, processed, draftsSent, filesPurged });
  } catch (error) {
    console.error("Postfach-Abruf fehlgeschlagen:", error);
    return NextResponse.json({ error: "Postfach-Abruf fehlgeschlagen" }, { status: 500 });
  }
}
