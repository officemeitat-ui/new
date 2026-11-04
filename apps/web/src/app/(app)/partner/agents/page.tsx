import { getDatabase } from "@nexus/db";
import {
  AGENT_TEMPLATES,
  can,
  findTemplate,
  listAgentPackages,
  listPartnerTenants,
} from "@nexus/domain";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@nexus/ui";
import { ArrowLeft, Lock, Package } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  CreatePackageForm,
  PackageEditor,
  RolloutForm,
  type TenantRolloutState,
} from "@/components/partner/agent-packages";
import { requirePartner } from "@/lib/session";

export const metadata = { title: "Agenten-Pakete" };
export const dynamic = "force-dynamic";

/** Partner console: prepare an agent once, roll it out to every customer with the same task. */
export default async function AgentPackagesPage() {
  const t = await getTranslations("agentPackages");
  const ctx = await requirePartner();
  if (!can(ctx.partner, "partner.templates.manage")) {
    return (
      <EmptyState
        icon={<Lock aria-hidden />}
        title={t("forbiddenTitle")}
        description={t("forbiddenDescription")}
      />
    );
  }
  const db = getDatabase().db;
  const [packages, tenants] = await Promise.all([
    listAgentPackages(db, ctx.partner.partnerId),
    listPartnerTenants(db, ctx.partner.partnerId),
  ]);
  const activeTenants = tenants.filter((tenant) => tenant.status === "active");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="space-y-3">
        <Link
          href="/partner"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Link>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("createTitle")}</CardTitle>
          <CardDescription>{t("createDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CreatePackageForm
            templates={AGENT_TEMPLATES.map((template) => ({
              id: template.id,
              name: template.name,
            }))}
          />
        </CardContent>
      </Card>

      {packages.length === 0 ? (
        <EmptyState
          icon={<Package aria-hidden />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        packages.map((pkg) => {
          const rollouts = new Map(pkg.rollouts.map((r) => [r.tenantId, r]));
          const rows = activeTenants.map((tenant) => {
            const rollout = rollouts.get(tenant.id);
            const state: TenantRolloutState = !rollout
              ? "none"
              : rollout.archived
                ? "archived"
                : rollout.version === pkg.version
                  ? "current"
                  : rollout.adapted
                    ? "adapted"
                    : "outdated";
            return { id: tenant.id, name: tenant.name, state, version: rollout?.version ?? null };
          });
          const base = pkg.baseTemplateId ? findTemplate(pkg.baseTemplateId) : undefined;
          return (
            <Card key={pkg.id} data-testid="agent-package">
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{pkg.name}</CardTitle>
                  <Badge variant="accent">{t("version", { version: pkg.version })}</Badge>
                  <Badge variant="outline">
                    {t("rolledOut", { count: pkg.rollouts.length, total: activeTenants.length })}
                  </Badge>
                </div>
                {base ? (
                  <CardDescription>{t("base", { template: base.name })}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                <PackageEditor
                  pkg={{
                    id: pkg.id,
                    name: pkg.name,
                    description: pkg.description ?? "",
                    instructions: pkg.config.instructions,
                  }}
                />
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noTenants")}</p>
                ) : (
                  <RolloutForm packageId={pkg.id} tenants={rows} />
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
