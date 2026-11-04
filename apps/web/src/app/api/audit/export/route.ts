import { getDatabase, withTenant } from "@nexus/db";
import { can, exportAuditCsv } from "@nexus/domain";
import { getApiTenantContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

/** Audit log as CSV download (tenant.audit.read). */
export async function GET() {
  const ctx = await getApiTenantContext();
  if (!ctx) return new Response(null, { status: 401 });
  if (!can(ctx.tenant, "tenant.audit.read")) return new Response(null, { status: 403 });
  const csv = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    exportAuditCsv(tx, ctx.tenant.tenantId),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-log-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
