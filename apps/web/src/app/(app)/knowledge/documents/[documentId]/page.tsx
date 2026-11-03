import { formatDateTime, isUuid } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, getDocument } from "@nexus/domain";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@nexus/ui";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Chunks repeat the end of the previous chunk (overlap for search); the reader sees it once. */
function withoutOverlap(previous: string | undefined, text: string): string {
  if (!previous) return text;
  for (let length = Math.min(previous.length, text.length, 400); length >= 20; length--) {
    if (previous.endsWith(text.slice(0, length))) return text.slice(length).trimStart();
  }
  return text;
}

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  if (!isUuid(documentId)) notFound();
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
  const document = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    getDocument(tx, ctx.tenant.tenantId, documentId).catch(() => null),
  );
  if (!document) notFound();

  const sections = document.chunks.map((chunk, index) => {
    const previous = document.chunks[index - 1];
    return {
      ...chunk,
      pageMarker: chunk.page !== null && chunk.page !== (previous?.page ?? null),
      showHeading: chunk.heading !== null && chunk.heading !== (previous?.heading ?? null),
      display: withoutOverlap(previous?.text, chunk.text),
    };
  });

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
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{document.title}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{t(`kinds.${document.kind}`)}</Badge>
            {document.fileName}
            {document.pageCount ? ` · ${t("pages", { count: document.pageCount })}` : ""}
            {` · ${formatDateTime(document.createdAt)}`}
          </p>
        </div>
      </div>

      {document.status === "failed" ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
          {document.error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("extractedText")}</CardTitle>
          <CardDescription>{t("extractedHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          {sections.map((section) => (
            <section key={section.seq} id={`abschnitt-${section.seq}`} className="scroll-mt-20">
              {section.pageMarker ? (
                <p
                  id={`seite-${section.page}`}
                  className="mb-2 border-b pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {t("page", { page: section.page! })}
                </p>
              ) : null}
              {section.showHeading ? (
                <h2 className="mb-1 font-semibold">{section.heading}</h2>
              ) : null}
              <p className="whitespace-pre-wrap">{section.display}</p>
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
