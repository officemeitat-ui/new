import { directoryOfSignedInUser } from "@nexus/connectors";
import { isAppError } from "@nexus/core";
import { getEnv } from "@nexus/core/env";
import { createLogger } from "@nexus/core/logger";
import { getDatabase } from "@nexus/db";
import {
  adminConsentUrl,
  assertDirectoryAvailable,
  can,
  connectMicrosoft365,
  microsoftAppConfig,
  signConsentState,
  verifyConsentState,
  withAuditRequestContext,
} from "@nexus/domain";
import { NextResponse, type NextRequest } from "next/server";
import { getApiTenantContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";
const log = createLogger("web");

/**
 * Both Microsoft round trips end here (ADR 0008):
 * 1. Sign-in: ?code=…&state=… → the directory of the signed-in administrator is asked from
 *    Microsoft (token endpoint + GET /organization); then admin consent is requested for it.
 * 2. Admin consent: ?admin_consent=True&tenant=…&state=… → the reported directory must be the
 *    one proven in step 1, which is carried in the signed state – never taken from the URL alone.
 * On refusal Microsoft sends error and error_description.
 */
export async function GET(request: NextRequest) {
  const appUrl = getEnv().APP_URL;
  const redirectUri = `${appUrl}/api/integrations/microsoft365/callback`;
  const back = (query: string) => NextResponse.redirect(new URL(`/integrations?${query}`, appUrl));
  const params = request.nextUrl.searchParams;

  const ctx = await getApiTenantContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", appUrl));
  if (params.get("error")) {
    log.warn({ error: params.get("error") }, "microsoft sign-in or consent not granted");
    return back("fehler=abgelehnt");
  }
  const config = microsoftAppConfig();
  if (!config) return back("fehler=nicht_eingerichtet");

  try {
    const state = verifyConsentState(params.get("state") ?? "");
    // The round trip must come back to the same person and company that started it.
    if (
      state.userId !== ctx.user.id ||
      state.tenantId !== ctx.tenant.tenantId ||
      !can(ctx.tenant, "integration.manage")
    ) {
      return back("fehler=sitzung");
    }
    const db = getDatabase().db;

    if (state.step === "signin") {
      const code = params.get("code");
      if (!code) return back("fehler=sitzung");
      const directoryId = await directoryOfSignedInUser(config, { code, redirectUri });
      await assertDirectoryAvailable(db, ctx.tenant.tenantId, directoryId);
      return NextResponse.redirect(
        adminConsentUrl(config, {
          directoryId,
          redirectUri,
          state: signConsentState({
            tenantId: ctx.tenant.tenantId,
            userId: ctx.user.id,
            step: "consent",
            directoryId,
          }),
        }),
      );
    }

    if (params.get("admin_consent") !== "True" || !state.directoryId)
      return back("fehler=abgelehnt");
    if (params.get("tenant") !== state.directoryId) return back("fehler=sitzung");
    await withAuditRequestContext(
      {
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: request.headers.get("user-agent"),
      },
      () =>
        connectMicrosoft365(db, {
          tenantId: ctx.tenant.tenantId,
          directoryTenantId: state.directoryId!,
          actorId: ctx.user.id,
          config,
        }),
    );
    return back("verbunden=1");
  } catch (error) {
    if (isAppError(error) && error.code === "conflict") return back("fehler=vergeben");
    if (isAppError(error)) return back("fehler=sitzung");
    log.error({ err: error }, "microsoft 365 connection failed");
    return back("fehler=zugriff");
  }
}
