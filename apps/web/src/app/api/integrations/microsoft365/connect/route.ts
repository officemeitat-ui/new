import { signInUrl } from "@nexus/connectors";
import { getEnv } from "@nexus/core/env";
import { can, microsoftAppConfig, signConsentState } from "@nexus/domain";
import { NextResponse } from "next/server";
import { getApiTenantContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

/**
 * Step 1 of connecting Microsoft 365 (ADR 0008): the administrator signs in at Microsoft, so the
 * platform learns their directory from Microsoft itself. Admin consent follows in the callback.
 */
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
  return NextResponse.redirect(
    signInUrl(config, {
      redirectUri: `${appUrl}/api/integrations/microsoft365/callback`,
      state: signConsentState({
        tenantId: ctx.tenant.tenantId,
        userId: ctx.user.id,
        step: "signin",
      }),
    }),
  );
}
