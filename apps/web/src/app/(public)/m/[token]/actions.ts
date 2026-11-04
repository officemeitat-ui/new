"use server";

import { isAppError } from "@nexus/core";
import { getEnv } from "@nexus/core/env";
import { createLogger } from "@nexus/core/logger";
import { getDatabase } from "@nexus/db";
import { findFacilityByToken, sendDefectReportEmail, submitDefectReport } from "@nexus/domain";
import { isIP } from "node:net";
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

const PUBLIC_TOKEN = /^[\w-]{20,40}$/;
const INVALID = "Dieser QR-Code ist nicht (mehr) gültig.";
const TOO_MANY = "Zu viele Meldungen in kurzer Zeit. Bitte versuchen Sie es später erneut.";

/** Public: anyone with the QR code may report. Rate-limited and with a bot trap. */
export async function submitReportAction(
  token: string,
  _prev: ReportState,
  formData: FormData,
): Promise<ReportState> {
  // Bots fill every field; people never see this one.
  if (String(formData.get("website") ?? "") !== "") return { ok: true };
  // The token is client input: check its format before it is used anywhere (security review).
  if (!PUBLIC_TOKEN.test(token)) return { ok: false, error: INVALID };
  const list = await headers();
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ip = isIP(forwarded) ? forwarded : "unknown";
  const limited = { ok: false as const, error: TOO_MANY };
  if (!(await allow(`report:ip:${ip}`, 10, 600, { failClosed: true }))) return limited;
  const target = await findFacilityByToken(getDatabase().db, token);
  if (!target) return { ok: false, error: INVALID };
  // Per object and per company, so one QR code cannot flood the object manager's inbox.
  if (
    !(await allow(`report:facility:${target.id}`, 50, 86_400, { failClosed: true })) ||
    !(await allow(`report:tenant:${target.tenantId}`, 300, 86_400, { failClosed: true }))
  ) {
    return limited;
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
