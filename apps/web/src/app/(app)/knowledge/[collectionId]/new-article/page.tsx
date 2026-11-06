import { isUuid } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, getCollection } from "@nexus/domain";
import { EmptyState } from "@nexus/ui";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArticleEditor } from "@/components/knowledge/article-editor";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Neuer Artikel" };
export const dynamic = "force-dynamic";

export default async function NewArticlePage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const { collectionId } = await params;
  if (!isUuid(collectionId)) notFound();
  const t = await getTranslations("knowledge");
  const ctx = await requireTenant();
  if (!can(ctx.tenant, "knowledge.manage")) {
    return (
      <EmptyState
        icon={<Lock aria-hidden />}
        title={t("forbiddenTitle")}
        description={t("forbiddenDescription")}
      />
    );
  }
  const collection = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    getCollection(tx, ctx.tenant.tenantId, collectionId).catch(() => null),
  );
  if (!collection) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="space-y-3">
        <Link
          href={`/knowledge/${collection.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("documentBack", { name: collection.name })}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t("articleNewTitle")}</h1>
      </div>
      <ArticleEditor mode="create" collectionId={collection.id} />
    </div>
  );
}
