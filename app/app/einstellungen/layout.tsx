import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

export default async function EinstellungenLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const tabs = [
    { href: "/app/einstellungen", label: "Konto & Sicherheit" },
    ...(user.role === "inhaber"
      ? [
          { href: "/app/einstellungen/benutzer", label: "Benutzer" },
          { href: "/app/einstellungen/protokoll", label: "Protokoll" },
        ]
      : []),
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Einstellungen</h1>
      <nav className="flex gap-1 overflow-x-auto text-sm font-medium">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="rounded-full bg-white px-3 py-1.5 whitespace-nowrap text-slate-700 ring-1 ring-slate-200 hover:ring-brand"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
