"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; icon: React.ReactNode; badge?: number };

const icon = (d: string) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-6 w-6"
    aria-hidden
  >
    <path d={d} />
  </svg>
);

export const ICONS = {
  heute: icon("M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"),
  aufgaben: icon("M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"),
  tickets: icon("M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM10 5v12"),
  kunden: icon(
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  ),
  assistent: icon("M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3"),
  stunden: icon("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2"),
  doku: icon("M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5zM8 7h8M8 11h6"),
};

export function WorkspaceNav({ ticketsWaiting, tasksDue, hoursLow }: { ticketsWaiting: number; tasksDue: number; hoursLow: number }) {
  const pathname = usePathname();
  const items: Item[] = [
    { href: "/app", label: "Heute", icon: ICONS.heute },
    { href: "/app/aufgaben", label: "Aufgaben", icon: ICONS.aufgaben, badge: tasksDue },
    { href: "/app/assistent", label: "Assistent", icon: ICONS.assistent },
    { href: "/app/tickets", label: "Tickets", icon: ICONS.tickets, badge: ticketsWaiting },
    { href: "/app/kunden", label: "Kunden", icon: ICONS.kunden },
    { href: "/app/stunden", label: "Stunden", icon: ICONS.stunden, badge: hoursLow },
    { href: "/app/doku", label: "Doku", icon: ICONS.doku },
  ];
  // Am Handy: fünf Reiter unten, der Assistent als runder Knopf darüber (immer mit dem Daumen erreichbar).
  const tabs = items.filter((item) => item.href !== "/app/assistent" && item.href !== "/app/doku");
  const active = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));
  const cockpit = [
    { href: "/admin/emails", label: "E-Mails" },
    { href: "/admin/belege", label: "Belege" },
    { href: "/admin/termine", label: "Terminbuchungen" },
    { href: "/admin", label: "Cockpit" },
  ];

  return (
    <>
      {/* Desktop: Seitenleiste */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-slate-200 bg-white px-3 py-5 md:flex print:hidden">
        <Link href="/app" className="px-3 text-lg font-bold">
          <span className="text-brand">●</span> Arbeitsplatz
        </Link>
        <nav className="mt-6 space-y-1">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                active(item.href) ? "bg-brand-soft text-brand" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {item.badge ? <span className="rounded-full bg-amber-500 px-1.5 text-xs text-white">{item.badge}</span> : null}
            </Link>
          ))}
        </nav>
        <p className="mt-8 px-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">Büro</p>
        <nav className="mt-2 space-y-1">
          {cockpit.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Handy: Leiste unten */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden">
        <ul className="grid grid-cols-5">
          {tabs.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-label={item.label}
                className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active(item.href) ? "text-brand" : "text-slate-500"}`}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.badge ? (
                  <span className="absolute top-1 right-[calc(50%-1.25rem)] rounded-full bg-amber-500 px-1.5 text-[10px] text-white">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {!active("/app/assistent") && (
        <Link
          href="/app/assistent"
          aria-label="Assistent"
          className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg ring-4 ring-white md:hidden print:hidden"
        >
          {ICONS.assistent}
        </Link>
      )}
    </>
  );
}
