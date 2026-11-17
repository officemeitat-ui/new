"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type DokuNavItem = { href: string; label: string; count?: number; group: string };

/** Navigation der Kunden-Dokumentation: am PC links, am Handy als wischbare Leiste. */
export function DokuNav({ items }: { items: DokuNavItem[] }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const isActive = (href: string) => {
    const [path, query] = href.split("?");
    if (query) return pathname === path && `tab=${tab}` === query;
    if (path.endsWith("/doku")) return pathname === path && !tab;
    return pathname.startsWith(path);
  };
  const groups = [...new Set(items.map((i) => i.group))];
  const link = (item: DokuNavItem, mobile: boolean) => (
    <Link
      key={item.href}
      href={item.href}
      className={
        mobile
          ? `rounded-full px-3 py-1.5 whitespace-nowrap ${isActive(item.href) ? "bg-brand text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`
          : `flex items-center justify-between rounded-lg px-3 py-1.5 ${isActive(item.href) ? "bg-brand-soft font-semibold text-brand" : "text-slate-600 hover:bg-slate-100"}`
      }
    >
      {item.label}
      {item.count ? <span className={mobile ? "ml-1 opacity-70" : "text-xs text-slate-400"}>{item.count}</span> : null}
    </Link>
  );
  return (
    <>
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 text-sm font-medium lg:hidden print:hidden">
        {items.map((i) => link(i, true))}
      </nav>
      <nav className="sticky top-4 hidden space-y-4 text-sm lg:block print:hidden">
        {groups.map((group) => (
          <div key={group}>
            <p className="mb-1 px-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">{group}</p>
            <div className="space-y-0.5">{items.filter((i) => i.group === group).map((i) => link(i, false))}</div>
          </div>
        ))}
      </nav>
    </>
  );
}
