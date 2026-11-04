import { formatDateTime } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, getIntegration, microsoftAppConfig } from "@nexus/domain";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@nexus/ui";
import { CircleAlert, Laptop, Plug } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DisconnectButton } from "@/components/integrations/disconnect-button";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Integrationen" };
export const dynamic = "force-dynamic";

const ERRORS = new Set([
  "abgelehnt",
  "sitzung",
  "zugriff",
  "berechtigung",
  "nicht_eingerichtet",
  "vergeben",
  "kein_admin",
]);

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ verbunden?: string; fehler?: string }>;
}) {
  const t = await getTranslations("integrationsPage");
  const query = await searchParams;
  const ctx = await requireTenant();
  const canManage = can(ctx.tenant, "integration.manage");
  const configured = microsoftAppConfig() !== null;
  const microsoft = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    getIntegration(tx, ctx.tenant.tenantId, "microsoft365"),
  );
  const error = query.fehler && ERRORS.has(query.fehler) ? query.fehler : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {query.verbunden === "1" && microsoft ? (
        <p role="status" className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
          {t("connectedMessage", { name: microsoft.displayName ?? "Microsoft 365" })}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="flex gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <Card data-testid="integration-microsoft365">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Plug className="size-5" aria-hidden />
              </span>
              <div className="space-y-1">
                <CardTitle>Microsoft 365</CardTitle>
                <CardDescription>{t("microsoftDescription")}</CardDescription>
              </div>
            </div>
            {microsoft ? (
              <Badge variant={microsoft.status === "connected" ? "success" : "danger"}>
                {microsoft.status === "connected" ? t("statusConnected") : t("statusError")}
              </Badge>
            ) : (
              <Badge variant="secondary">{t("statusNotConnected")}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {microsoft ? (
            <>
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
                <dt className="text-muted-foreground">{t("organisation")}</dt>
                <dd className="font-medium">{microsoft.displayName ?? "–"}</dd>
                <dt className="text-muted-foreground">{t("directory")}</dt>
                <dd className="font-mono text-xs">{microsoft.externalTenantId}</dd>
                <dt className="text-muted-foreground">{t("connectedBy")}</dt>
                <dd>
                  {microsoft.connectedByName ?? "–"} · {formatDateTime(microsoft.createdAt)}
                </dd>
                {microsoft.lastError ? (
                  <>
                    <dt className="text-muted-foreground">{t("lastError")}</dt>
                    <dd className="text-danger">{microsoft.lastError}</dd>
                  </>
                ) : null}
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href="/devices">
                    <Laptop aria-hidden />
                    {t("showDevices")}
                  </Link>
                </Button>
                {canManage ? (
                  <>
                    <Button asChild variant="outline">
                      <a href="/api/integrations/microsoft365/connect">{t("reconnect")}</a>
                    </Button>
                    <DisconnectButton />
                  </>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">{t("revokeHint")}</p>
            </>
          ) : configured ? (
            <>
              <p>{t("connectExplain")}</p>
              <ul className="list-inside list-disc text-muted-foreground">
                <li>{t("permissionRead")}</li>
                <li>{t("permissionActions")}</li>
                <li>{t("permissionSharePoint")}</li>
                <li>{t("permissionOrganisation")}</li>
              </ul>
              {canManage ? (
                <Button asChild>
                  <a href="/api/integrations/microsoft365/connect">{t("connect")}</a>
                </Button>
              ) : (
                <p className="text-muted-foreground">{t("askAdmin")}</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">{t("notConfigured")}</p>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">{t("more")}</p>
    </div>
  );
}
