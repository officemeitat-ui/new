import { isAppError, isUuid } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, exportCollection, withAuditRequestContext } from "@nexus/domain";
import type { NextRequest } from "next/server";
import { getApiTenantContext } from "@/lib/api-context";
import { allow } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * A collection as a ZIP of Markdown files (opens as an Obsidian vault). Needs knowledge.manage:
 * a bulk copy of the company's knowledge is more than reading single documents. Each export is
 * written to the audit log.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const ctx = await getApiTenantContext();
  if (!ctx) return new Response(null, { status: 401 });
  if (!can(ctx.tenant, "knowledge.manage")) return new Response(null, { status: 403 });
  const { collectionId } = await params;
  if (!isUuid(collectionId)) return new Response(null, { status: 400 });
  // Building the archive reads every document: at most 10 exports per person and 10 minutes.
  if (!(await allow(`knowledge-export:${ctx.user.id}`, 10, 600))) {
    return new Response("Zu viele Exporte. Bitte in ein paar Minuten erneut versuchen.", {
      status: 429,
      headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "600" },
    });
  }

  const tenantId = ctx.tenant.tenantId;
  const exported = await withAuditRequestContext(
    {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    },
    () =>
      withTenant(getDatabase().db, tenantId, (tx) =>
        exportCollection(tx, { tenantId, collectionId, actorId: ctx.user.id }),
      ),
  ).catch((error: unknown) => {
    if (isAppError(error)) return null;
    throw error;
  });
  if (!exported) return new Response(null, { status: 404 });

  const date = new Date().toISOString().slice(0, 10);
  const name = exported.fileName.replace(/\.zip$/, "");
  return new Response(new Uint8Array(exported.zip), {
    headers: {
      "content-type": "application/zip",
      // RFC 6266: ASCII fallback plus the UTF-8 name (umlauts in collection names).
      "content-disposition": `attachment; filename="${asciiName(name)}-${date}.zip"; filename*=UTF-8''${encodeURIComponent(`${name}-${date}.zip`)}`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function asciiName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ß/g, "ss")
      .replace(/[^A-Za-z0-9._ -]+/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "wissen"
  );
}
