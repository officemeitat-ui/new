import { eq, getDatabase, withTenant } from "@nexus/db";
import { can } from "@nexus/domain";
import { tenants } from "@nexus/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from "@nexus/ui";
import { Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { GeneralForm } from "@/components/settings/general-form";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Allgemein" };

export default async function GeneralSettingsPage() {
  const t = await getTranslations("settings.general");
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
  const [tenant] = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    tx
      .select({ name: tenants.name, hourlyRateCents: tenants.hourlyRateCents })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenant.tenantId)),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <GeneralForm
          name={tenant!.name}
          hourlyRate={String(tenant!.hourlyRateCents / 100).replace(".", ",")}
        />
      </CardContent>
    </Card>
  );
}
