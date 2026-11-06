import { isAppError, isUuid } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, exportCollection, withAuditRequestContext } from "@nexus/domain";
import type { NextRequest } from "next/server";
import { getApiTenantContext } from "@/lib/api-context";
import { allow } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * A collection as a ZIP of Markdown files (opens as an Obsidian vault). Needs knowledge.export
 * (owners and admins, not support sessions): a bulk copy of the company's knowledge is more
 * than reading single documents. Each export is written to the audit log.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const ctx = await getApiTenantContext();
  if (!ctx) return new Response(null, { status: 401 });
  if (!can(ctx.tenant, "knowledge.export")) return new Response(null, { status: 403 });
  const { collectionId } = await params;
  if (!isUuid(collectionId)) return new Response(null, { status: 400 });
  // Building the archive reads every document: at most 20 exports per person and 10 minutes.
  if (!(await allow(`knowledge-export:${ctx.user.id}`, 20, 600))) {
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
      // ASCII only: some browsers ignore the UTF-8 form (filename*) and save as "download".
      // The files inside the archive keep their UTF-8 names.
      "content-disposition": `attachment; filename="${asciiName(name)}-${date}.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** German transliteration first (Gedächtnis → Gedaechtnis), then plain ASCII. */
function asciiName(name: string): string {
  const german: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue" };
  return (
    name
      .replace(/[äöüÄÖÜ]/g, (c) => german[c]!)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss")
      .replace(/[^A-Za-z0-9._ -]+/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "wissen"
  );
}
