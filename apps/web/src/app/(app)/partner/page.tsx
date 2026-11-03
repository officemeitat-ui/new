import { formatDate } from "@nexus/core";
import { getDatabase } from "@nexus/db";
import { can, listPartnerTenants, loadCurrentPrices } from "@nexus/domain";
import { modelDisplayName } from "@nexus/agents/models";
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
import { getFormatter, getTranslations } from "next-intl/server";
import { CreateTenantForm } from "@/components/partner/create-tenant-form";
import { ExchangeRateForm } from "@/components/partner/exchange-rate-form";
import { requirePartner } from "@/lib/session";

export const metadata = { title: "Partner-Konsole" };

export default async function PartnerPage() {
  const t = await getTranslations("partner");
  const tPlans = await getTranslations("plans");
  const ctx = await requirePartner();
  const db = getDatabase().db;
  const [tenants, prices] = await Promise.all([
    listPartnerTenants(db, ctx.partner.partnerId),
    loadCurrentPrices(db),
  ]);
  const format = await getFormatter();

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

      <Card>
        <CardHeader>
          <CardTitle>{t("pricingTitle")}</CardTitle>
          <CardDescription>{t("pricingDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t("priceModel")}</th>
                  <th className="py-2 pr-4 font-medium">{t("priceInput")}</th>
                  <th className="py-2 pr-4 font-medium">{t("priceOutput")}</th>
                  <th className="py-2 pr-4 font-medium">{t("priceCacheRead")}</th>
                  <th className="py-2 font-medium">{t("priceCacheWrite")}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(prices).map(([model, price]) => (
                  <tr key={model} className="border-b last:border-0">
                    <td className="py-2 pr-4">{modelDisplayName(model)}</td>
                    {[
                      price.inputPerMTok,
                      price.outputPerMTok,
                      price.cacheReadPerMTok,
                      price.cacheWritePerMTok,
                    ].map((value, index) => (
                      <td key={index} className="py-2 pr-4 tabular-nums">
                        {format.number(value, {
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 3,
                        })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">{t("priceUnit")}</p>
          </div>
          {can(ctx.partner, "partner.pricing.manage") ? (
            <ExchangeRateForm rate={ctx.partner.usdEurRate} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
