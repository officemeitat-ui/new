import { isUuid } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, getEditableDocument, MAX_ARTICLE_CHARS, MAX_MEMORY_CHARS } from "@nexus/domain";
import { EmptyState } from "@nexus/ui";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArticleEditor } from "@/components/knowledge/article-editor";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Artikel bearbeiten" };
export const dynamic = "force-dynamic";

/** Articles and memory entries (including open proposals) are edited here; files are not. */
export default async function EditDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  if (!isUuid(documentId)) notFound();
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
  const document = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    getEditableDocument(tx, ctx.tenant.tenantId, documentId).catch(() => null),
  );
  if (!document) notFound();
  const proposal = document.status === "proposed";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="space-y-3">
        <Link
          href={`/knowledge/${document.collectionId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("documentBack", { name: document.collectionName })}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {proposal ? t("proposalEditTitle") : t("articleEditTitle")}
        </h1>
        {proposal ? <p className="text-sm text-muted-foreground">{t("proposalsHint")}</p> : null}
      </div>
      <ArticleEditor
        mode="edit"
        collectionId={document.collectionId}
        documentId={document.id}
        title={document.title}
        body={document.body}
        proposal={proposal}
        maxLength={document.origin === "memory" ? MAX_MEMORY_CHARS : MAX_ARTICLE_CHARS}
      />
    </div>
  );
}
