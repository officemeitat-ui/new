import { getDatabase, withTenant } from "@nexus/db";
import { can, listCollections } from "@nexus/domain";
import { Badge, Card, CardDescription, CardHeader, CardTitle, EmptyState } from "@nexus/ui";
import { BookOpen, Brain, FolderOpen, Lock } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CollectionForm } from "@/components/knowledge/collection-form";
import { MemoryCard } from "@/components/knowledge/memory-card";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Wissen" };
export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
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
  const all = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    listCollections(tx, ctx.tenant.tenantId),
  );
  // The company memory comes first.
  const collections = [
    ...all.filter((c) => c.kind === "memory"),
    ...all.filter((c) => c.kind !== "memory"),
  ];
  const hasMemory = collections.some((c) => c.kind === "memory");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {canManage ? <CollectionForm /> : null}

      {canManage && !hasMemory ? <MemoryCard /> : null}

      {collections.length === 0 ? (
        <EmptyState
          icon={<BookOpen aria-hidden />}
          title={t("emptyTitle")}
          description={canManage ? t("emptyDescription") : t("emptyReadOnly")}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection) => (
            <li key={collection.id}>
              <Link
                href={`/knowledge/${collection.id}`}
                className="block h-full rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Card className="h-full transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                        {collection.kind === "memory" ? (
                          <Brain className="size-5" aria-hidden />
                        ) : (
                          <FolderOpen className="size-5" aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0 space-y-1">
                        <CardTitle className="truncate">{collection.name}</CardTitle>
                        <CardDescription>
                          {t("documentsCount", { count: collection.documents })}
                          {collection.documents > collection.ready
                            ? ` · ${t("notReadyCount", { count: collection.documents - collection.ready })}`
                            : ""}
                        </CardDescription>
                        {canManage && collection.proposed > 0 ? (
                          <Badge variant="warning">
                            {t("proposalsCount", { count: collection.proposed })}
                          </Badge>
                        ) : null}
                        {collection.description ? (
                          <p className="line-clamp-2 text-sm text-muted-foreground">
                            {collection.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
