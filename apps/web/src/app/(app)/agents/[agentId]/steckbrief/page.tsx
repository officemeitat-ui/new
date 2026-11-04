import { convertUsdMicros, formatDateTime, isAppError, isUuid } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import {
  agentProfile,
  getAgentDetail,
  getIntegration,
  getPrivacySettings,
  listCollections,
} from "@nexus/domain";
import { Badge } from "@nexus/ui";
import { ArrowLeft, CircleAlert, Info, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PrintButton } from "@/components/privacy/print-button";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Agenten-Steckbrief" };
export const dynamic = "force-dynamic";

const MODE_VARIANT = { auto: "secondary", approve: "warning", deny: "outline" } as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid space-y-2 rounded-lg border p-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="text-sm">{children}</div>
    </section>
  );
}

/** Agenten-Steckbrief (EU AI Act, M13): generated from the published configuration. */
export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  if (!isUuid(agentId)) notFound();
  const t = await getTranslations("profile");
  const tTools = await getTranslations("tools");
  const format = await getFormatter();
  const ctx = await requireTenant();
  const tenantId = ctx.tenant.tenantId;
  const data = await withTenant(getDatabase().db, tenantId, async (tx) => ({
    detail: await getAgentDetail(tx, tenantId, agentId),
    collections: await listCollections(tx, tenantId),
    settings: await getPrivacySettings(tx, tenantId),
    microsoft: await getIntegration(tx, tenantId, "microsoft365"),
  })).catch((error: unknown) => {
    if (isAppError(error) && error.code === "not_found") return null;
    throw error;
  });
  if (!data) notFound();
  const { agent, current } = data.detail;
  const toolLabel = (name: string) =>
    tTools.has(`${name}.label`) ? tTools(`${name}.label`) : name;
  const profile = agentProfile({
    config: current.config,
    collections: data.collections,
    chatRetentionDays: data.settings.chatRetentionDays,
    microsoftConnected: data.microsoft !== null,
    label: toolLabel,
  });
  const limit = profile.limits.maxCostUsdMicros
    ? convertUsdMicros(profile.limits.maxCostUsdMicros, ctx.tenant.usdEurRate)
    : null;

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <Link
          href={`/agents/${agent.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Link>
        <PrintButton label={t("print")} />
      </div>

      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{t("kicker")}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
        <p className="text-sm text-muted-foreground">
          {t("meta", {
            tenant: ctx.tenant.tenantName,
            version: current.version,
            date: formatDateTime(current.createdAt),
          })}
        </p>
      </header>

      <Section title={t("purpose")}>
        <p>{agent.description ?? t("noPurpose")}</p>
      </Section>

      <Section title={t("model")}>
        <p>
          {profile.model} · {profile.provider.name} ({profile.provider.location})
        </p>
        {profile.provider.note ? (
          <p className="text-xs text-warning">{profile.provider.note}</p>
        ) : null}
      </Section>

      <Section title={t("data")}>
        <ul className="list-inside list-disc space-y-1">
          <li>{t("dataConversations")}</li>
          {profile.knowledge.length > 0 ? (
            <li>{t("dataKnowledge", { names: profile.knowledge.join(", ") })}</li>
          ) : null}
          {profile.tools.some((tool) => tool.name.startsWith("geraet")) ? (
            <li>{t("dataDevices")}</li>
          ) : null}
        </ul>
      </Section>

      <Section title={t("tools")}>
        {profile.tools.length === 0 ? (
          <p>{t("noTools")}</p>
        ) : (
          <ul className="divide-y">
            {profile.tools.map((tool) => (
              <li key={tool.name} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{toolLabel(tool.name)}</span>
                  <span className="text-muted-foreground"> – {tool.riskText}</span>
                </span>
                {tool.unavailable ? <Badge variant="outline">{t("inactive")}</Badge> : null}
                <Badge variant={MODE_VARIANT[tool.mode]}>{t(`modes.${tool.mode}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("oversight")}>
        <p>
          {profile.oversight.length > 0
            ? t("oversightApprovals", { tools: profile.oversight.map(toolLabel).join(", ") })
            : t("oversightNone")}
        </p>
        <p>
          {t("limits", {
            steps: profile.limits.maxSteps,
            cost: limit
              ? format.number(limit.amount, { style: "currency", currency: limit.currency })
              : t("noLimit"),
          })}
        </p>
      </Section>

      <Section title={t("logging")}>
        <p>
          {profile.logging.chatRetentionDays
            ? t("loggingRetention", { days: profile.logging.chatRetentionDays })
            : t("loggingKeep")}
        </p>
      </Section>

      <Section title={t("risks")}>
        <ul className="space-y-2">
          {profile.risks.map((risk) => {
            const Icon =
              risk.level === "danger" ? ShieldAlert : risk.level === "warning" ? CircleAlert : Info;
            return (
              <li key={risk.text} className="flex gap-2">
                <Icon
                  className={`mt-0.5 size-4 shrink-0 ${risk.level === "danger" ? "text-danger" : risk.level === "warning" ? "text-warning" : "text-muted-foreground"}`}
                  aria-hidden
                />
                {risk.text}
              </li>
            );
          })}
        </ul>
      </Section>

      <p className="text-xs text-muted-foreground">{t("footer")}</p>
    </article>
  );
}
