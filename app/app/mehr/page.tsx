import Link from "next/link";
import { logout } from "@/app/admin/actions";
import { ICONS } from "@/components/workspace/Nav";
import { requireAdmin } from "@/lib/auth";

/** Am Handy: alles, was nicht in die untere Leiste passt. */
export default async function MehrPage() {
  const user = await requireAdmin();
  const links = [
    { href: "/app/stunden", label: "Stunden", hint: "Stundenpakete und Zeiten", icon: ICONS.stunden },
    { href: "/app/doku", label: "Doku", hint: "Dokumentation, Netzwerk, Suche", icon: ICONS.doku },
    { href: "/app/wissen", label: "Wissen & Dateien", hint: "OneDrive, SharePoint, Wissensdatenbank", icon: ICONS.wissen },
    { href: "/app/awareness", label: "Awareness", hint: "Schulungen für Team und Kunden", icon: ICONS.awareness },
    { href: "/app/einstellungen", label: "Einstellungen", hint: "Konto, Sicherheit, Benutzer", icon: ICONS.einstellungen },
  ];
  const office = [
    { href: "/admin/emails", label: "E-Mails" },
    { href: "/admin/belege", label: "Belege" },
    { href: "/admin/termine", label: "Terminbuchungen" },
    { href: "/admin", label: "Cockpit" },
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mehr</h1>
      <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <span className="text-slate-500">{link.icon}</span>
              <span>
                <span className="block font-medium">{link.label}</span>
                <span className="block text-sm text-slate-500">{link.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {user.role === "inhaber" && (
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">Büro</h2>
          <ul className="grid grid-cols-2 gap-2">
            {office.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="block rounded-xl bg-white px-4 py-3 text-sm font-medium shadow-sm ring-1 ring-slate-200">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form action={logout}>
        <button
          type="submit"
          className="w-full rounded-xl bg-white px-4 py-3 text-sm font-medium text-red-700 shadow-sm ring-1 ring-slate-200"
        >
          Abmelden ({user.name})
        </button>
      </form>
    </div>
  );
}
