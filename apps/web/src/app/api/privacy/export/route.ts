import { isUuid } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { appendAudit, can, exportPersonData, withAuditRequestContext } from "@nexus/domain";
import type { NextRequest } from "next/server";
import { getApiTenantContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

/**
 * Data export for one person (DSGVO Art. 15/20) as a JSON download. Everyone may export their
 * own data; exporting someone else's needs `tenant.members.manage` and is written to the audit log.
 */
export async function GET(request: NextRequest) {
  const ctx = await getApiTenantContext();
  if (!ctx) return new Response(null, { status: 401 });
  const userId = request.nextUrl.searchParams.get("userId") ?? ctx.user.id;
  if (!isUuid(userId)) return new Response(null, { status: 400 });
  const self = userId === ctx.user.id;
  if (!self && !can(ctx.tenant, "tenant.members.manage"))
    return new Response(null, { status: 403 });

  const tenantId = ctx.tenant.tenantId;
  const data = await withAuditRequestContext(
    {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    },
    () =>
      withTenant(getDatabase().db, tenantId, async (tx) => {
        const exported = await exportPersonData(tx, { tenantId, userId }).catch(() => null);
        if (exported) {
          await appendAudit(tx, tenantId, {
            actorType: "user",
            actorId: ctx.user.id,
            action: "privacy.data_exported",
            targetType: "user",
            targetId: userId,
            metadata: { self },
          });
        }
        return exported;
      }),
  );
  if (!data) return new Response(null, { status: 404 });

  const slug =
    data.person.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "person";
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="datenauskunft-${slug}-${date}.json"`,
      "cache-control": "no-store",
    },
  });
}
