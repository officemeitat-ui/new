import { convertUsdMicros, dayPeriod } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { approvalScopeFor, can, getDashboard } from "@nexus/domain";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@nexus/ui";
import { Bot, CheckCheck, Clock, Coins, Inbox, LayoutGrid, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { RunsChart } from "@/components/dashboard/runs-chart";
import { checkHealth, type CheckResult } from "@/lib/health";
import { requireTenant } from "@/lib/session";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "secondary"> = {
  completed: "success",
  awaiting_approval: "warning",
  failed: "danger",
  refused: "danger",
};

function Tile({
  label,
  icon,
  value,
  hint,
  href,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  hint: ReactNode;
  /** Makes the whole tile a link. */
  href?: string;
}) {
  const card = (
    <Card className={href ? "h-full transition-colors hover:bg-muted/50" : undefined}>
      <CardHeader className="flex-row items-center justify-between">
        <CardDescription>{label}</CardDescription>
        <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
      {card}
    </Link>
  ) : (
    card
  );
}

export default async function StartPage() {
  const t = await getTranslations("start");
  const tStatus = await getTranslations("runStatus");
  const format = await getFormatter();
  const { user, tenant } = await requireTenant();
  const firstName = user.name.split(/\s+/)[0];
  const greeting = {
    morning: t("greetingMorning"),
    day: t("greetingDay"),
    evening: t("greetingEvening"),
  }[dayPeriod()];

  const [dashboard, health] = await Promise.all([
    withTenant(getDatabase().db, tenant.tenantId, (tx) =>
      getDashboard(tx, tenant.tenantId, approvalScopeFor(tenant)),
    ),
    checkHealth(),
  ]);

  const rateEur = dashboard.hourlyRateCents / 100;
  const savedWeekEur = (dashboard.savedMinutesWeek / 60) * rateEur;
  const savedMonthEur = (dashboard.savedMinutesMonth / 60) * rateEur;
  const cost = convertUsdMicros(dashboard.costUsdMicrosMonth, tenant.usdEurRate);
  const money = (amount: number, currency: string, digits = 2) =>
    format.number(amount, { style: "currency", currency, maximumFractionDigits: digits });
  const hours = format.number(dashboard.savedMinutesWeek / 60, { maximumFractionDigits: 1 });
  const roiFactor = cost.currency === "EUR" && cost.amount > 0 ? savedMonthEur / cost.amount : null;
  const hasActivity = dashboard.recentRuns.length > 0;

  const checks: { label: string; result: CheckResult }[] = [
    { label: t("checkDatabase"), result: health.checks.database },
    { label: t("checkRedis"), result: health.checks.redis },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("kpiLabel")}>
        <Tile
          label={t("kpiApprovals")}
          icon={<Inbox aria-hidden />}
          value={format.number(dashboard.openApprovals)}
          hint={dashboard.openApprovals > 0 ? t("approvalsWaiting") : t("approvalsNone")}
          href="/approvals"
        />
        <Tile
          label={t("kpiRuns")}
          icon={<Bot aria-hidden />}
          value={format.number(dashboard.runsToday)}
          hint={t("runsCompleted", { count: dashboard.completedToday })}
        />
        <Tile
          label={t("kpiSaved")}
          icon={<Clock aria-hidden />}
          value={t("hours", { hours })}
          hint={
            <>
              {t("savedValue", {
                amount: money(savedWeekEur, "EUR", 0),
                rate: money(rateEur, "EUR", 0),
              })}{" "}
              <Link href="/settings/general" className="underline underline-offset-2">
                {t("changeRate")}
              </Link>
            </>
          }
        />
        {/* Company-wide costs only for people with analytics rights (finding 14). */}
        {can(tenant, "analytics.read") ? (
          <Tile
            label={t("kpiCost")}
            icon={<Coins aria-hidden />}
            value={money(cost.amount, cost.currency, cost.amount < 10 ? 2 : 0)}
            hint={
              roiFactor && roiFactor >= 1
                ? t("roiFactor", { factor: format.number(roiFactor, { maximumFractionDigits: 0 }) })
                : t("costHint")
            }
          />
        ) : null}
      </section>

      {hasActivity ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <Card>
            <CardHeader>
              <CardTitle>{t("chartTitle")}</CardTitle>
              <CardDescription>
                {t("chartDescription", { agents: dashboard.activeAgents })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RunsChart data={dashboard.runsLast7Days} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div className="space-y-1">
                <CardTitle>{t("activityTitle")}</CardTitle>
                <CardDescription>{t("activityDescription")}</CardDescription>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href="/chat">
                  <MessagesSquare aria-hidden />
                  {t("openChat")}
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {dashboard.recentRuns.map((run) => {
                  const runCost = convertUsdMicros(run.costUsdMicros, tenant.usdEurRate);
                  return (
                    <li key={run.id}>
                      <Link
                        href={`/chat/${run.conversationId}`}
                        className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/60"
                      >
                        <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-medium">{run.agentName}</span>
                        <Badge variant={STATUS_VARIANT[run.status] ?? "secondary"}>
                          {tStatus(run.status)}
                        </Badge>
                        <span className="hidden w-20 text-right tabular-nums text-muted-foreground sm:block">
                          {money(runCost.amount, runCost.currency, 3)}
                        </span>
                        <span className="w-24 text-right text-xs text-muted-foreground">
                          {format.relativeTime(run.createdAt, new Date())}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : (
        <EmptyState
          icon={<Bot aria-hidden />}
          title={t("firstAgentTitle")}
          description={t("firstAgentDescription")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/agents/new">
                  <LayoutGrid aria-hidden />
                  {t("chooseTemplate")}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/chat">
                  <MessagesSquare aria-hidden />
                  {t("openChat")}
                </Link>
              </Button>
            </div>
          }
        />
      )}

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-sm">{t("systemTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {checks.map(({ label, result }) => (
              <li key={label} className="flex items-center justify-between gap-3 text-sm">
                <span>{label}</span>
                {result.ok ? (
                  <Badge variant="success">
                    <CheckCheck className="size-3" aria-hidden />
                    {t("statusOk")} · {result.latencyMs} ms
                  </Badge>
                ) : (
                  <Badge variant="danger">{t("statusDown")}</Badge>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
