import { deviceProblems, filterDevices } from "@nexus/connectors";
import { isAppError } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, getIntegration, listTenantDevices, microsoftAppConfig } from "@nexus/domain";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  EmptyState,
  Input,
} from "@nexus/ui";
import { CircleAlert, Laptop, Lock, Search, ShieldCheck, ShieldX, Smartphone } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { DeviceActions } from "@/components/integrations/device-actions";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Geräte" };
export const dynamic = "force-dynamic";

const COMPLIANCE_VARIANT: Record<string, "success" | "warning" | "danger" | "secondary"> = {
  compliant: "success",
  inGracePeriod: "warning",
  noncompliant: "danger",
  conflict: "danger",
  error: "danger",
};

function Tile({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardDescription>{label}</CardDescription>
        <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; probleme?: string }>;
}) {
  const t = await getTranslations("devices");
  const format = await getFormatter();
  const query = await searchParams;
  const ctx = await requireTenant();
  // Device lists show people, serial numbers and security gaps: admins only (finding 9).
  if (!can(ctx.tenant, "integration.manage")) {
    return (
      <EmptyState
        icon={<Lock aria-hidden />}
        title={t("forbiddenTitle")}
        description={t("forbiddenDescription")}
      />
    );
  }
  const db = getDatabase().db;
  const integration = await withTenant(db, ctx.tenant.tenantId, (tx) =>
    getIntegration(tx, ctx.tenant.tenantId, "microsoft365"),
  );

  const header = (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground">
        {integration?.displayName
          ? t("subtitleConnected", { name: integration.displayName })
          : t("subtitle")}
      </p>
    </div>
  );

  if (!integration || !microsoftAppConfig()) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        {header}
        <EmptyState
          icon={<Laptop aria-hidden />}
          title={t("notConnectedTitle")}
          description={t("notConnectedDescription")}
          action={
            <Button asChild>
              <Link href="/integrations">{t("toIntegrations")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof listTenantDevices>> | null = null;
  let loadError: string | null = null;
  try {
    result = await listTenantDevices(db, ctx.tenant.tenantId);
  } catch (error) {
    loadError =
      isAppError(error) || (error instanceof Error && error.name === "GraphError")
        ? error.message
        : t("loadError");
  }
  if (!result) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        {header}
        <p
          role="alert"
          className="flex gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          {loadError}
        </p>
      </div>
    );
  }

  const now = new Date();
  const { devices, truncated } = result;
  const problems = devices.map((device) => deviceProblems(device, now));
  const count = (kind: string) => problems.filter((p) => p.includes(kind)).length;
  const onlyProblems = query.probleme === "1";
  const shown = filterDevices(devices, { query: query.q, onlyProblems }, now);
  const canAct = can(ctx.tenant, "integration.manage");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {header}

      <section
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        aria-label={t("overview")}
      >
        <Tile
          label={t("total")}
          value={format.number(devices.length)}
          icon={<Laptop aria-hidden />}
        />
        <Tile
          label={t("noncompliant")}
          value={format.number(count("nicht_konform"))}
          icon={<ShieldX aria-hidden />}
        />
        <Tile
          label={t("unencrypted")}
          value={format.number(count("nicht_verschluesselt"))}
          icon={<Lock aria-hidden />}
        />
        <Tile
          label={t("stale")}
          value={format.number(count("lange_nicht_synchronisiert"))}
          icon={<CircleAlert aria-hidden />}
        />
      </section>

      <form className="flex flex-wrap items-center gap-3" role="search">
        <label htmlFor="device-search" className="sr-only">
          {t("searchLabel")}
        </label>
        <Input
          id="device-search"
          name="q"
          defaultValue={query.q ?? ""}
          placeholder={t("searchPlaceholder")}
          className="max-w-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="probleme"
            value="1"
            defaultChecked={onlyProblems}
            className="size-4 accent-primary"
          />
          {t("onlyProblems")}
        </label>
        <Button type="submit" variant="outline">
          <Search aria-hidden />
          {t("filter")}
        </Button>
      </form>

      <Card>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            <p className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
              <ShieldCheck className="size-4" aria-hidden />
              {onlyProblems ? t("noProblems") : t("noDevices")}
            </p>
          ) : (
            <ul className="divide-y">
              {shown.map((device) => {
                const issues = deviceProblems(device, now);
                const mobile = /ios|android/i.test(device.operatingSystem ?? "");
                const Icon = mobile ? Smartphone : Laptop;
                return (
                  <li
                    key={device.id}
                    data-testid="device"
                    className="flex flex-wrap items-center gap-3 px-5 py-3"
                  >
                    <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {device.deviceName ?? "–"}
                        <Badge
                          variant={COMPLIANCE_VARIANT[device.complianceState ?? ""] ?? "secondary"}
                        >
                          {t.has(`compliance.${device.complianceState}`)
                            ? t(`compliance.${device.complianceState}`)
                            : (device.complianceState ?? t("compliance.unknown"))}
                        </Badge>
                        {issues.includes("nicht_verschluesselt") ? (
                          <Badge variant="danger">{t("problemUnencrypted")}</Badge>
                        ) : null}
                        {issues.includes("lange_nicht_synchronisiert") ? (
                          <Badge variant="warning">{t("problemStale")}</Badge>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          device.userDisplayName,
                          [device.operatingSystem, device.osVersion].filter(Boolean).join(" "),
                          [device.manufacturer, device.model].filter(Boolean).join(" "),
                          device.managedDeviceOwnerType === "personal" ? t("personal") : null,
                          device.lastSyncDateTime
                            ? t("lastSync", {
                                when: format.relativeTime(new Date(device.lastSyncDateTime), now),
                              })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {canAct ? (
                      <DeviceActions deviceId={device.id} deviceName={device.deviceName ?? ""} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      {truncated ? <p className="text-xs text-muted-foreground">{t("truncated")}</p> : null}
    </div>
  );
}
