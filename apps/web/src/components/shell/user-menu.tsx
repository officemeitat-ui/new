"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Building2, Check, ChevronsUpDown, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { selectTenantAction, signOutAction } from "@/app/actions/session";

type TenantOption = { tenantId: string; name: string };

const itemClass =
  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted [&_svg]:size-4";

export function UserMenu({
  user,
  tenants,
  activeTenantId,
}: {
  user: { name: string; email: string };
  tenants: TenantOption[];
  activeTenantId: string | null;
}) {
  const t = useTranslations("userMenu");
  const [, startTransition] = useTransition();
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const activeTenant = tenants.find((tenant) => tenant.tenantId === activeTenantId);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
        aria-label={t("open")}
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
          {initials || "?"}
        </span>
        <span className="hidden max-w-40 truncate text-left lg:block">
          {activeTenant?.name ?? user.name}
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-64 rounded-lg border bg-card p-1 shadow-lg"
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          {tenants.length > 0 ? (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Label className="px-2 py-1 text-xs text-muted-foreground">
                {t("tenants")}
              </DropdownMenu.Label>
              {tenants.map((tenant) => (
                <DropdownMenu.Item
                  key={tenant.tenantId}
                  className={itemClass}
                  onSelect={() => startTransition(() => selectTenantAction(tenant.tenantId))}
                >
                  <Building2 className="text-muted-foreground" aria-hidden />
                  <span className="flex-1 truncate">{tenant.name}</span>
                  {tenant.tenantId === activeTenantId ? <Check aria-hidden /> : null}
                </DropdownMenu.Item>
              ))}
            </>
          ) : null}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className={itemClass}
            onSelect={() => startTransition(() => signOutAction())}
          >
            <LogOut className="text-muted-foreground" aria-hidden />
            {t("signOut")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
