import { formatDateTime } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, listSupportGrants } from "@nexus/domain";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@nexus/ui";
import { Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { RevokeSupportButton, SupportGrantForm } from "@/components/settings/support-form";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Support-Zugriff" };

export default async function SupportAccessPage() {
  const t = await getTranslations("settings.support");
  const ctx = await requireTenant();
  if (!can(ctx.tenant, "tenant.support_access.manage")) {
    return (
      <EmptyState
        icon={<Lock aria-hidden />}
        title={t("forbiddenTitle")}
        description={t("forbiddenDescription")}
      />
    );
  }
  const grants = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    listSupportGrants(tx, ctx.tenant.tenantId),
  );
  const now = new Date();
  const active = grants.find((g) => !g.revokedAt && g.expiresAt > now);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>
            {t("description", { partner: ctx.tenant.branding.productName })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {active ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <span className="flex-1">
                {t("activeUntil", {
                  date: formatDateTime(active.expiresAt),
                  reason: active.reason,
                })}
              </span>
              <RevokeSupportButton grantId={active.id} />
            </div>
          ) : null}
          <SupportGrantForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("historyTitle")}</CardTitle>
          <CardDescription>{t("historyDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {grants.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">{t("historyEmpty")}</p>
          ) : (
            <ul className="divide-y">
              {grants.map((grant) => {
                const state = grant.revokedAt
                  ? "revoked"
                  : grant.expiresAt > now
                    ? "active"
                    : "expired";
                return (
                  <li
                    key={grant.id}
                    className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{grant.reason}</p>
                      <p className="text-muted-foreground">
                        {t("grantedBy", {
                          name: grant.grantedByName ?? "–",
                          date: formatDateTime(grant.createdAt),
                        })}
                      </p>
                    </div>
                    <Badge variant={state === "active" ? "warning" : "secondary"}>
                      {t(`state_${state}`)}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
