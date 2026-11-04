"use server";

import { isAppError } from "@nexus/core";
import { getEnv } from "@nexus/core/env";
import { createLogger } from "@nexus/core/logger";
import { getDatabase } from "@nexus/db";
import { sendDefectReportEmail, submitDefectReport } from "@nexus/domain";
import { headers } from "next/headers";
import { allow } from "@/lib/rate-limit";

const log = createLogger("web");

const CATEGORY_LABEL: Record<string, string> = {
  verschmutzung: "Verschmutzung",
  nachfuellen: "Nachfüllen (Seife, Papier …)",
  schaden: "Schaden oder Defekt",
  sonstiges: "Sonstiges",
};

export type ReportState = { ok: true } | { ok: false; error: string } | null;

/** Public: anyone with the QR code may report. Rate-limited and with a bot trap. */
export async function submitReportAction(
  token: string,
  _prev: ReportState,
  formData: FormData,
): Promise<ReportState> {
  // Bots fill every field; people never see this one.
  if (String(formData.get("website") ?? "") !== "") return { ok: true };
  const list = await headers();
  const ip = list.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (
    !(await allow(`report:ip:${ip}`, 10, 600)) ||
    !(await allow(`report:token:${token}`, 200, 86_400))
  ) {
    return {
      ok: false,
      error: "Zu viele Meldungen in kurzer Zeit. Bitte versuchen Sie es später erneut.",
    };
  }
  try {
    const { facility, report } = await submitDefectReport(getDatabase().db, {
      token,
      report: {
        category: String(formData.get("category") ?? "") as "sonstiges",
        location: String(formData.get("location") ?? ""),
        description: String(formData.get("description") ?? ""),
        reporterEmail: String(formData.get("email") ?? ""),
      },
    });
    if (facility.contactEmail) {
      // The report is stored; a failing mail server must not turn it into an error.
      await sendDefectReportEmail({
        to: facility.contactEmail,
        facilityName: facility.name,
        category: CATEGORY_LABEL[report.category] ?? report.category,
        location: report.location,
        description: report.description,
        url: `${getEnv().APP_URL}/reports`,
      }).catch((error: unknown) => log.warn({ err: error }, "defect report e-mail failed"));
    }
    return { ok: true };
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.message };
    log.error({ err: error }, "defect report failed");
    return { ok: false, error: "Das hat nicht geklappt. Bitte versuchen Sie es erneut." };
  }
}
