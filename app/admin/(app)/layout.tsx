import type { Metadata } from "next";
import Link from "next/link";
import { pipelines, site } from "@/config/site";
import { requireAdmin } from "@/lib/auth";
import { logout } from "../actions";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/admin" className="font-bold">
            <span className="text-brand">●</span> {site.brand.name}
          </Link>
          <nav className="flex flex-1 flex-wrap gap-4 text-sm font-medium text-slate-600">
            <Link href="/admin" className="hover:text-slate-900">
              Dashboard
            </Link>
            {Object.values(pipelines).map((pipeline) => (
              <Link key={pipeline.id} href={`/admin/pipeline/${pipeline.id}`} className="hover:text-slate-900">
                {pipeline.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/" className="text-slate-500 hover:text-slate-900">
              Website ↗
            </Link>
            <form action={logout}>
              <button type="submit" className="text-slate-500 hover:text-slate-900">
                Abmelden
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
