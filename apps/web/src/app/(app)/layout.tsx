import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/shell/brand-mark";
import { CommandPalette } from "@/components/shell/command-palette";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { getBrand } from "@/lib/brand";
import { getAppContext } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("app");
  const { productName } = getBrand();
  const ctx = await getAppContext();
  const isPartner = Boolean(ctx.partner);
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

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r bg-muted/30 p-4 md:flex">
        <div className="px-2 pt-1">
          <BrandMark productName={productName} />
        </div>
        <SidebarNav isPartner={isPartner} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-8">
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
        <main id="main" className="flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
