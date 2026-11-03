import { isAppError } from "@nexus/core";
import { getEnv } from "@nexus/core/env";
import { createLogger } from "@nexus/core/logger";
import { getDatabase } from "@nexus/db";
import {
  can,
  connectMicrosoft365,
  microsoftAppConfig,
  verifyConsentState,
  withAuditRequestContext,
} from "@nexus/domain";
import { NextResponse, type NextRequest } from "next/server";
import { getApiTenantContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";
const log = createLogger("web");

/**
 * Return from the admin consent: ?admin_consent=True&tenant=<directory id>&state=…
 * (https://learn.microsoft.com/graph/auth-v2-service#successful-response). On refusal Microsoft
 * sends error and error_description instead.
 */
export async function GET(request: NextRequest) {
  const appUrl = getEnv().APP_URL;
  const back = (query: string) => NextResponse.redirect(new URL(`/integrations?${query}`, appUrl));
  const params = request.nextUrl.searchParams;

  const ctx = await getApiTenantContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", appUrl));
  if (params.get("error") || params.get("admin_consent") !== "True") {
    log.warn({ error: params.get("error") }, "microsoft admin consent not granted");
    return back("fehler=abgelehnt");
  }
  const config = microsoftAppConfig();
  if (!config) return back("fehler=nicht_eingerichtet");

  try {
    const state = verifyConsentState(params.get("state") ?? "");
    // The consent must come back to the same person and company that started it.
    if (
      state.userId !== ctx.user.id ||
      state.tenantId !== ctx.tenant.tenantId ||
      !can(ctx.tenant, "integration.manage")
    ) {
      return back("fehler=sitzung");
    }
    await withAuditRequestContext(
      {
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: request.headers.get("user-agent"),
      },
      () =>
        connectMicrosoft365(getDatabase().db, {
          tenantId: ctx.tenant.tenantId,
          directoryTenantId: params.get("tenant") ?? "",
          actorId: ctx.user.id,
          config,
        }),
    );
    return back("verbunden=1");
  } catch (error) {
    if (isAppError(error)) return back("fehler=sitzung");
    log.error({ err: error }, "microsoft 365 connection failed");
    return back("fehler=zugriff");
  }
}
