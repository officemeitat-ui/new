import { dayPeriod } from "@nexus/core";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@nexus/ui";
import { Bot, CheckCheck, Clock, Inbox } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { checkHealth, type CheckResult } from "@/lib/health";

export const dynamic = "force-dynamic";

export default async function StartPage() {
  const t = await getTranslations("start");
  const greeting = {
    morning: t("greetingMorning"),
    day: t("greetingDay"),
    evening: t("greetingEvening"),
  }[dayPeriod()];
  const health = await checkHealth();

  const kpis = [
    { label: t("kpiApprovals"), icon: Inbox },
    { label: t("kpiRuns"), icon: Bot },
    { label: t("kpiSaved"), icon: Clock },
  ];

  const checks: { label: string; result: CheckResult }[] = [
    { label: t("checkDatabase"), result: health.checks.database },
    { label: t("checkRedis"), result: health.checks.redis },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3" aria-label={t("subtitle")}>
        {kpis.map(({ label, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex-row items-center justify-between">
              <CardDescription>{label}</CardDescription>
              <Icon className="size-4 text-muted-foreground" aria-hidden />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">–</p>
              <p className="text-xs text-muted-foreground">{t("kpiNoData")}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <EmptyState
          className="lg:col-span-2"
          icon={<Bot aria-hidden />}
          title={t("firstAgentTitle")}
          description={t("firstAgentDescription")}
        />
        <Card>
          <CardHeader>
            <CardTitle>{t("systemTitle")}</CardTitle>
            <CardDescription>{t("systemDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
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
    </div>
  );
}
