import { formatDateTime } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, listDefectReports } from "@nexus/domain";
import { Badge, Button, Card, CardContent, EmptyState, cn } from "@nexus/ui";
import { Building2, CheckCheck, Lock } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ReportActions } from "@/components/reports/report-actions";
import { ReportFeedback } from "@/components/reports/report-feedback";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Meldungen" };
export const dynamic = "force-dynamic";

const FILTERS = ["unresolved", "open", "in_progress", "done", "all"] as const;
const VARIANT = { open: "danger", in_progress: "warning", done: "success" } as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const t = await getTranslations("reports");
  const ctx = await requireTenant();
  if (!can(ctx.tenant, "reports.manage")) {
    return (
      <EmptyState
        icon={<Lock aria-hidden />}
        title={t("forbiddenTitle")}
        description={t("forbiddenDescription")}
      />
    );
  }
  const query = await searchParams;
  const status = (FILTERS as readonly string[]).includes(query.status ?? "")
    ? (query.status as (typeof FILTERS)[number])
    : "unresolved";
  const reports = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    listDefectReports(tx, ctx.tenant.tenantId, { status }),
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        {can(ctx.tenant, "tenant.settings.manage") ? (
          <Button asChild variant="outline">
            <Link href="/reports/objects">
              <Building2 aria-hidden />
              {t("manageObjects")}
            </Link>
          </Button>
        ) : null}
      </div>

      <nav className="flex flex-wrap gap-1" aria-label={t("filterLabel")}>
        {FILTERS.map((key) => (
          <Link
            key={key}
            href={`/reports?status=${key}`}
            aria-current={status === key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              status === key
                ? "border-primary bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t(`filters.${key}`)}
          </Link>
        ))}
      </nav>

      <ReportFeedback>
        {reports.length === 0 ? (
          <EmptyState
            icon={<CheckCheck aria-hidden />}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {reports.map((report) => (
                  <li
                    key={report.id}
                    data-testid="report"
                    className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {report.facilityName}
                        {report.location ? (
                          <span className="text-muted-foreground">· {report.location}</span>
                        ) : null}
                        <Badge variant={VARIANT[report.status]}>
                          {t(`status.${report.status}`)}
                        </Badge>
                        <Badge variant="secondary">{t(`categories.${report.category}`)}</Badge>
                      </p>
                      <p className="whitespace-pre-wrap">{report.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(report.createdAt)}
                        {report.hasReporterEmail ? ` · ${t("withEmail")}` : ""}
                        {report.resolvedAt
                          ? ` · ${t("resolved", { name: report.resolvedByName ?? "–", date: formatDateTime(report.resolvedAt) })}`
                          : ""}
                      </p>
                      {report.resolutionNote ? (
                        <p className="text-xs">{report.resolutionNote}</p>
                      ) : null}
                    </div>
                    {report.status !== "done" ? (
                      <ReportActions reportId={report.id} status={report.status} />
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </ReportFeedback>
    </div>
  );
}
