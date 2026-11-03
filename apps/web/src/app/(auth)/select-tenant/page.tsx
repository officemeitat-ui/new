import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import { Building2, ChevronRight } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { selectTenantAction } from "@/app/actions/session";
import { getAppContext } from "@/lib/session";

export const metadata = { title: "Mandant wählen" };

export default async function SelectTenantPage() {
  const t = await getTranslations("selectTenant");
  const ctx = await getAppContext();
  const tenants = ctx.overview.tenants.filter((tenant) => tenant.status === "active");
  if (tenants.length === 0) redirect(ctx.partner ? "/partner" : "/no-access");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {tenants.map((tenant) => (
          <form key={tenant.tenantId} action={selectTenantAction.bind(null, tenant.tenantId)}>
            <Button type="submit" variant="outline" className="h-auto w-full justify-start py-3">
              <Building2 aria-hidden />
              <span className="flex-1 text-left">{tenant.name}</span>
              <ChevronRight aria-hidden />
            </Button>
          </form>
        ))}
      </CardContent>
    </Card>
  );
}
