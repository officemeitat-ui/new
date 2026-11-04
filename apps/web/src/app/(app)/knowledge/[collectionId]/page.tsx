import { formatDateTime, isUuid } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import {
  can,
  getCollection,
  getIntegration,
  getKnowledgeSource,
  isSyncStale,
  listDocuments,
  microsoftAppConfig,
} from "@nexus/domain";
import { EmptyState } from "@nexus/ui";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DeleteCollectionButton } from "@/components/knowledge/delete-collection-button";
import { DocumentList } from "@/components/knowledge/document-list";
import { SearchTest } from "@/components/knowledge/search-test";
import { KnowledgeSource } from "@/components/knowledge/knowledge-source";
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
        source: await getKnowledgeSource(tx, ctx.tenant.tenantId, collectionId),
        microsoft: await getIntegration(tx, ctx.tenant.tenantId, "microsoft365"),
      };
    } catch {
      return null;
    }
  });
  if (!data) notFound();
  const { collection, documents, source, microsoft } = data;

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

      <KnowledgeSource
        collectionId={collection.id}
        canManage={canManage}
        microsoftConnected={Boolean(microsoft) && microsoftAppConfig() !== null}
        source={source ? sourceView(source) : null}
      />

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
          uploaded: `${d.fromSource ? PROVIDER_LABEL[source?.provider ?? "sharepoint"] : (d.createdByName ?? "–")} · ${formatDateTime(d.createdAt)}`,
          sourceUrl: d.sourceUrl,
        }))}
      />

      {documents.some((d) => d.status === "ready") ? (
        <SearchTest collectionId={collection.id} />
      ) : null}
    </div>
  );
}

const PROVIDER_LABEL = { sharepoint: "SharePoint", bookstack: "BookStack", atera: "Atera" } as const;

/** What the browser may see of a source: never the secret. */
function sourceView(source: NonNullable<Awaited<ReturnType<typeof getKnowledgeSource>>>) {
  const settings = (source.settings ?? {}) as { baseUrl?: unknown; monthsBack?: unknown };
  const common = {
    status: source.status,
    stale: isSyncStale(source),
    lastSync: source.lastSyncAt ? formatDateTime(source.lastSyncAt) : null,
    lastError: source.lastError,
    itemsSeen: source.itemsSeen,
    itemsImported: source.itemsImported,
    itemsSkipped: source.itemsSkipped,
  };
  if (source.provider === "bookstack") {
    return {
      ...common,
      provider: "bookstack" as const,
      name: source.displayName ?? "BookStack",
      detail: null,
      url: typeof settings.baseUrl === "string" ? settings.baseUrl : null,
      monthsBack: null,
    };
  }
  if (source.provider === "atera") {
    return {
      ...common,
      provider: "atera" as const,
      name: source.displayName ?? "Atera",
      detail: null,
      url: null,
      monthsBack: typeof settings.monthsBack === "number" ? settings.monthsBack : null,
    };
  }
  return {
    ...common,
    provider: "sharepoint" as const,
    name: source.driveName ?? "SharePoint",
    detail: source.siteName,
    url: source.siteUrl,
    monthsBack: null,
  };
}
