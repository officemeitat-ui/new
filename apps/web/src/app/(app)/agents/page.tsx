import { modelDisplayName, resolveModel, isModelTier } from "@nexus/agents/models";
import { getDatabase, withTenant } from "@nexus/db";
import { can, listAgents } from "@nexus/domain";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@nexus/ui";
import { Bot, MessagesSquare, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Agenten" };

export default async function AgentsPage() {
  const t = await getTranslations("agents");
  const ctx = await requireTenant();
  const agents = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    listAgents(tx, ctx.tenant.tenantId),
  );
  const canEdit = can(ctx.tenant, "agent.edit");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canEdit ? (
          <Button asChild>
            <Link href="/agents/new">
              <Plus aria-hidden />
              {t("new")}
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <Card key={agent.id} data-testid={`agent-${agent.id}`} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Bot className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 space-y-1">
                  <CardTitle className="truncate">{agent.name}</CardTitle>
                  <CardDescription className="line-clamp-2">
                    {agent.description ?? t("noDescription")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="mt-auto space-y-4">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">
                  {modelDisplayName(
                    resolveModel(isModelTier(agent.config.tier) ? agent.config.tier : "smart"),
                  )}
                </Badge>
                <Badge variant="secondary">{t("version", { version: agent.version })}</Badge>
                <Badge variant="outline">{t("runs30d", { count: agent.runs30d })}</Badge>
                {agent.isDefault ? <Badge variant="accent">{t("default")}</Badge> : null}
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm">
                  <Link href={`/chat?agent=${agent.id}`}>
                    <MessagesSquare aria-hidden />
                    {t("chat")}
                  </Link>
                </Button>
                {canEdit ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/agents/${agent.id}`}>
                      <Settings2 aria-hidden />
                      {t("edit")}
                    </Link>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
        {canEdit ? (
          <Link
            href="/agents/new"
            className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <Plus className="size-6" aria-hidden />
            <span className="font-medium">{t("newCardTitle")}</span>
            <span className="text-sm">{t("newCardDescription")}</span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
