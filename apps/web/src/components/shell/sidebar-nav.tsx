"use client";

import { Badge, cn } from "@nexus/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { isActive, visibleNavItems, type NavItem } from "./nav";

function NavLink({ item }: { item: NavItem }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const Icon = item.icon;
  const base = "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors";

  if (!item.available) {
    return (
      <span
        aria-disabled="true"
        title={t("soonHint")}
        className={cn(base, "cursor-not-allowed text-muted-foreground/70")}
      >
        <Icon className="size-4" aria-hidden />
        <span className="flex-1">{t(item.key)}</span>
        <Badge variant="secondary" className="px-1.5 text-[10px]">
          {t("soon")}
        </Badge>
      </span>
    );
  }

  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        base,
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {t(item.key)}
    </Link>
  );
}

export function SidebarNav({ isPartner }: { isPartner: boolean }) {
  const t = useTranslations("nav");
  const items = visibleNavItems(isPartner);
  return (
    <nav aria-label={t("label")} className="flex flex-1 flex-col gap-6">
      <ul className="flex flex-col gap-0.5">
        {items
          .filter((i) => i.section === "main")
          .map((item) => (
            <li key={item.key}>
              <NavLink item={item} />
            </li>
          ))}
      </ul>
      <ul className="mt-auto flex flex-col gap-0.5">
        {items
          .filter((i) => i.section === "admin")
          .map((item) => (
            <li key={item.key}>
              <NavLink item={item} />
            </li>
          ))}
      </ul>
    </nav>
  );
}
