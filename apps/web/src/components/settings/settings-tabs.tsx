"use client";

import { cn } from "@nexus/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const TABS = [
  { href: "/settings/general", key: "general" },
  { href: "/settings/members", key: "members" },
  { href: "/settings/branding", key: "branding" },
  { href: "/settings/security", key: "security" },
  { href: "/settings/support", key: "support" },
  { href: "/settings/audit", key: "audit" },
] as const;

export function SettingsTabs() {
  const t = useTranslations("settings.tabs");
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b" aria-label={t("label")}>
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
