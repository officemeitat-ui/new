import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { requireTenant } from "@/lib/session";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("settings");
  const { tenant } = await requireTenant();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="space-y-1 print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle", { tenant: tenant.tenantName })}</p>
      </div>
      <SettingsTabs />
      {children}
    </div>
  );
}
