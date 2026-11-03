import { can } from "@nexus/domain";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from "@nexus/ui";
import { Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { BrandingForm } from "@/components/settings/branding-form";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Branding" };

export default async function BrandingPage() {
  const t = await getTranslations("settings.branding");
  const ctx = await requireTenant();
  if (!can(ctx.tenant, "tenant.settings.manage")) {
    return (
      <EmptyState
        icon={<Lock aria-hidden />}
        title={t("forbiddenTitle")}
        description={t("forbiddenDescription")}
      />
    );
  }
  const { branding } = ctx.tenant;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description", { product: branding.productName })}</CardDescription>
      </CardHeader>
      <CardContent>
        <BrandingForm
          current={branding.primaryColor}
          ownColor={branding.tenantColor}
          partnerColor={branding.partnerColor}
          productName={branding.productName}
        />
      </CardContent>
    </Card>
  );
}
