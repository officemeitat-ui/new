import { formatDateTime, isUuid } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, getCollection, listDocuments } from "@nexus/domain";
import { EmptyState } from "@nexus/ui";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DeleteCollectionButton } from "@/components/knowledge/delete-collection-button";
import { DocumentList } from "@/components/knowledge/document-list";
import { SearchTest } from "@/components/knowledge/search-test";
import { UploadForm } from "@/components/knowledge/upload-form";
import { requireTenant } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const { collectionId } = await params;
  if (!isUuid(collectionId)) notFound();
  const t = await getTranslations("knowledge");
  const ctx = await requireTenant();
  if (!can(ctx.tenant, "knowledge.read")) {
    return (
      <EmptyState
        icon={<Lock aria-hidden />}
        title={t("forbiddenTitle")}
        description={t("forbiddenDescription")}
      />
    );
  }
  const canManage = can(ctx.tenant, "knowledge.manage");
  const data = await withTenant(getDatabase().db, ctx.tenant.tenantId, async (tx) => {
    try {
      return {
        collection: await getCollection(tx, ctx.tenant.tenantId, collectionId),
        documents: await listDocuments(tx, ctx.tenant.tenantId, collectionId),
      };
    } catch {
      return null;
    }
  });
  if (!data) notFound();
  const { collection, documents } = data;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="space-y-3">
        <Link
          href="/knowledge"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{collection.name}</h1>
            {collection.description ? (
              <p className="text-muted-foreground">{collection.description}</p>
            ) : null}
          </div>
          {canManage ? (
            <DeleteCollectionButton collectionId={collection.id} name={collection.name} />
          ) : null}
        </div>
      </div>

      {canManage ? <UploadForm collectionId={collection.id} /> : null}

      <DocumentList
        collectionId={collection.id}
        canManage={canManage}
        documents={documents.map((d) => ({
          id: d.id,
          title: d.title,
          fileName: d.fileName,
          kind: d.kind,
          sizeBytes: d.sizeBytes,
          status: d.status,
          error: d.error,
          pageCount: d.pageCount,
          chunkCount: d.chunkCount,
          uploaded: `${d.createdByName ?? "–"} · ${formatDateTime(d.createdAt)}`,
        }))}
      />

      {documents.some((d) => d.status === "ready") ? (
        <SearchTest collectionId={collection.id} />
      ) : null}
    </div>
  );
}
