import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/shell/brand-mark";
import { CommandPalette } from "@/components/shell/command-palette";
import { MobileNav } from "@/components/shell/mobile-nav";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { resolveBranding } from "@/lib/branding";
import { getAppContext } from "@/lib/session";
import { endSupportSessionAction } from "@/app/actions/session";
import { formatDateTime } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { approvalScopeFor, can, countOpenReports, countPendingApprovals } from "@nexus/domain";
import { Button } from "@nexus/ui";
import { LifeBuoy } from "lucide-react";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("app");
  const { productName } = await resolveBranding();
  const ctx = await getAppContext();
  const isPartner = Boolean(ctx.partner);
  const tenant = ctx.tenant;
  const openApprovals =
    tenant && can(tenant, "approval.decide")
      ? await withTenant(getDatabase().db, tenant.tenantId, (tx) =>
          countPendingApprovals(tx, tenant.tenantId, approvalScopeFor(tenant)),
        )
      : 0;
  const openReports =
    tenant && can(tenant, "reports.manage")
      ? await withTenant(getDatabase().db, tenant.tenantId, (tx) =>
          countOpenReports(tx, tenant.tenantId),
        )
      : 0;
  const badges = { approvals: openApprovals, reports: openReports };
  const tenants = ctx.overview.tenants
    .filter((tenant) => tenant.status === "active")
    .map(({ tenantId, name }) => ({ tenantId, name }));

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t("skipToContent")}
      </a>

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r bg-muted/30 p-4 md:flex print:hidden">
        <div className="px-2 pt-1">
          <BrandMark productName={productName} />
        </div>
        <SidebarNav isPartner={isPartner} badges={badges} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {ctx.tenant?.support ? (
          // Everyone must see that partner staff are working in this tenant (M12).
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 border-b border-warning/40 bg-warning/15 px-4 py-2 text-sm text-foreground md:px-8"
          >
            <LifeBuoy className="size-4 shrink-0 text-warning" aria-hidden />
            <span className="flex-1">
              {t("supportBanner", {
                partner: ctx.tenant.support.partnerName,
                tenant: ctx.tenant.tenantName,
                until: formatDateTime(ctx.tenant.support.expiresAt),
              })}
            </span>
            <form action={endSupportSessionAction}>
              <Button type="submit" size="sm" variant="outline">
                {t("supportEnd")}
              </Button>
            </form>
          </div>
        ) : null}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-8 print:hidden">
          <div className="md:hidden">
            <BrandMark productName={productName} compact />
          </div>
          <div className="flex min-w-0 flex-1 justify-end md:justify-start">
            <CommandPalette isPartner={isPartner} />
          </div>
          <ThemeToggle />
          <UserMenu
            user={{ name: ctx.user.name, email: ctx.user.email }}
            tenants={tenants}
            activeTenantId={ctx.tenant?.tenantId ?? null}
          />
        </header>
        <main id="main" className="flex-1 px-4 pb-24 pt-6 md:px-8 md:py-8 print:p-0">
          {children}
        </main>
      </div>
      {tenant ? <MobileNav badges={badges} /> : null}
    </div>
  );
}
