import { NextResponse } from "next/server";
import { business } from "@/config/business";
import { sendMail, smtpConfigured } from "@/lib/mail/smtp";
import { isMonth, lastCompletedMonth, monthlyReport, reportText } from "@/lib/report";
import { secretsMatch } from "@/lib/secrets";

// Verschickt den Monatsbericht per E-Mail. Am 1. jedes Monats aufrufen, z. B.:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://cockpit.example.at/api/cron/report
// Optional ?monat=2026-11 für einen bestimmten Monat.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET ist nicht gesetzt" }, { status: 503 });
  if (!secretsMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const to = process.env.REPORT_EMAIL || process.env.TEAM_NOTIFY_EMAIL;
  if (!to || !smtpConfigured()) return NextResponse.json({ error: "REPORT_EMAIL/TEAM_NOTIFY_EMAIL oder SMTP fehlt" }, { status: 503 });

  const requested = new URL(request.url).searchParams.get("monat");
  const month = isMonth(requested) ? requested : lastCompletedMonth();
  const report = await monthlyReport(month);
  const link = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL.replace(/\/$/, "")}/admin/bericht?monat=${month}` : undefined;
  await sendMail({ to, subject: `Monatsbericht ${report.label} – ${business.name}`, text: reportText(report, link) });
  return NextResponse.json({ sent: true, to, month });
}
