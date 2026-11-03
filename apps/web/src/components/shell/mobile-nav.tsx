"use client";

import { cn } from "@nexus/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { isActive, MOBILE_NAV_KEYS, NAV_ITEMS, type NavBadges } from "./nav";
import { CountBadge } from "./sidebar-nav";

/** Bottom bar on phones: the most used areas within thumb reach, approvals with a counter. */
export function MobileNav({ badges = {} }: { badges?: NavBadges }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const items = MOBILE_NAV_KEYS.map((key) => NAV_ITEMS.find((item) => item.key === key)!).filter(
    (item) => item.available,
  );
  return (
    <nav
      aria-label={t("mobileLabel")}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className="relative">
                  <Icon className="size-5" aria-hidden />
                  <CountBadge
                    count={badges[item.key] ?? 0}
                    className="absolute -right-3 -top-1.5 min-w-4 px-1 text-[10px] leading-4"
                  />
                </span>
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
