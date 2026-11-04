import { convertUsdMicros, formatDateTime, isAppError, isUuid } from "@nexus/core";
import { TOOL_CATALOG } from "@nexus/agents/catalog";
import { getDatabase, withTenant } from "@nexus/db";
import { can, findTemplate, getAgentDetail, getIntegration, listCollections } from "@nexus/domain";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AgentEditor } from "@/components/agents/agent-editor";
import { AgentVersions } from "@/components/agents/agent-versions";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Agent bearbeiten" };

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ neu?: string }>;
}) {
  const { agentId } = await params;
  const isNew = (await searchParams).neu === "1";
  if (!isUuid(agentId)) notFound();
  const t = await getTranslations("agents");
  const ctx = await requireTenant();
  const detail = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    getAgentDetail(tx, ctx.tenant.tenantId, agentId),
  ).catch((error: unknown) => {
    if (isAppError(error) && error.code === "not_found") return null;
    throw error;
  });
  if (!detail) notFound();
  const { collections, microsoft } = await withTenant(
    getDatabase().db,
    ctx.tenant.tenantId,
    async (tx) => ({
      collections: await listCollections(tx, ctx.tenant.tenantId),
      microsoft: await getIntegration(tx, ctx.tenant.tenantId, "microsoft365"),
    }),
  );

  const { agent, current, versions } = detail;
  const template = agent.templateId ? findTemplate(agent.templateId) : undefined;
  const rate = ctx.tenant.usdEurRate;
  const limit =
    current.config.maxCostUsdMicros !== undefined
      ? convertUsdMicros(current.config.maxCostUsdMicros, rate).amount
      : undefined;

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="flex flex-col gap-6">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
            <Badge variant="secondary">{t("version", { version: current.version })}</Badge>
            {agent.status === "archived" ? <Badge variant="warning">{t("archived")}</Badge> : null}
          </div>
          <p className="text-muted-foreground">{isNew ? t("createdHint") : t("editSubtitle")}</p>
        </div>
        {agent.partnerTemplateId ? (
          <p role="note" className="rounded-md border bg-accent/40 px-3 py-2 text-sm">
            {agent.currentVersionId === agent.rolledOutVersionId
              ? t("managedHint")
              : t("managedAdaptedHint")}
          </p>
        ) : null}
        <AgentEditor
          agentId={agent.id}
          isDefault={agent.isDefault}
          status={agent.status}
          canPublish={can(ctx.tenant, "agent.publish")}
          currency={rate ? "EUR" : "USD"}
          initial={{
            name: agent.name,
            description: agent.description ?? "",
            instructions: current.config.instructions,
            tier: current.config.tier,
            effort: current.config.effort,
            tools: Object.fromEntries(
              TOOL_CATALOG.map((tool) => [
                tool.name,
                current.config.tools.find((c) => c.name === tool.name && c.mode !== "deny")?.mode ??
                  "off",
              ]),
            ),
            maxSteps: current.config.maxSteps,
            maxCost:
              limit === undefined ? "" : String(Math.round(limit * 100) / 100).replace(".", ","),
            roiMinutes:
              current.config.roiMinutesPerTask === undefined
                ? ""
                : String(current.config.roiMinutesPerTask),
            knowledgeCollectionIds: current.config.knowledgeCollectionIds ?? [],
          }}
          collections={collections.map((c) => ({
            id: c.id,
            name: c.name,
            documents: c.documents,
          }))}
          catalog={TOOL_CATALOG.map((tool) => ({
            name: tool.name,
            risk: tool.risk,
            available: tool.available,
            ...(tool.requires ? { requires: tool.requires } : {}),
          }))}
          connected={microsoft ? ["microsoft365"] : []}
        />
      </div>

      <aside className="flex flex-col gap-6">
        {template ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("testCasesTitle")}</CardTitle>
              <CardDescription>{t("testCasesDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-2 pl-4 text-sm">
                {template.testCases.map((testCase) => (
                  <li key={testCase}>{testCase}</li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ) : null}
        <AgentVersions
          agentId={agent.id}
          currentVersionId={current.id}
          canPublish={can(ctx.tenant, "agent.publish")}
          versions={versions.map((v) => ({
            id: v.id,
            version: v.version,
            createdAt: formatDateTime(v.createdAt),
            createdByName: v.createdByName,
          }))}
        />
      </aside>
    </div>
  );
}
