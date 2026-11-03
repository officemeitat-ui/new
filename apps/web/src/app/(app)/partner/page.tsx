import { formatDate } from "@nexus/core";
import { getDatabase } from "@nexus/db";
import { can, listPartnerTenants } from "@nexus/domain";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@nexus/ui";
import { Building2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { CreateTenantForm } from "@/components/partner/create-tenant-form";
import { requirePartner } from "@/lib/session";

export const metadata = { title: "Partner-Konsole" };

export default async function PartnerPage() {
  const t = await getTranslations("partner");
  const tPlans = await getTranslations("plans");
  const ctx = await requirePartner();
  const tenants = await listPartnerTenants(getDatabase().db, ctx.partner.partnerId);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("subtitle", { partner: ctx.partner.partnerName })}
        </p>
      </div>

      {can(ctx.partner, "partner.tenants.manage") ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("createTitle")}</CardTitle>
            <CardDescription>{t("createDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateTenantForm />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle", { count: tenants.length })}</CardTitle>
          <CardDescription>{t("listDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {tenants.length === 0 ? (
            <EmptyState
              className="m-5"
              icon={<Building2 aria-hidden />}
              title={t("emptyTitle")}
              description={t("emptyDescription")}
            />
          ) : (
            <ul className="divide-y">
              {tenants.map((tenant) => (
                <li key={tenant.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{tenant.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("createdAt", { date: formatDate(tenant.createdAt) })}
                    </p>
                  </div>
                  {tenant.ownerInvitationPending ? (
                    <Badge variant="warning">{t("invitationPending")}</Badge>
                  ) : null}
                  {tenant.status === "suspended" ? (
                    <Badge variant="danger">{t("suspended")}</Badge>
                  ) : null}
                  <Badge variant="accent">{tPlans(tenant.plan)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
