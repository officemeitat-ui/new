import { getEnv } from "@nexus/core/env";
import { adminConsentUrl, can, microsoftAppConfig, signConsentState } from "@nexus/domain";
import { NextResponse } from "next/server";
import { getApiTenantContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

/** Starts the admin consent at Microsoft (ADR 0008). Only for people who manage integrations. */
export async function GET() {
  const appUrl = getEnv().APP_URL;
  const ctx = await getApiTenantContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", appUrl));
  if (!can(ctx.tenant, "integration.manage")) {
    return NextResponse.redirect(new URL("/integrations?fehler=berechtigung", appUrl));
  }
  const config = microsoftAppConfig();
  if (!config)
    return NextResponse.redirect(new URL("/integrations?fehler=nicht_eingerichtet", appUrl));
  const url = adminConsentUrl(config, {
    redirectUri: `${appUrl}/api/integrations/microsoft365/callback`,
    state: signConsentState({ tenantId: ctx.tenant.tenantId, userId: ctx.user.id }),
  });
  return NextResponse.redirect(url);
}
