import Link from "next/link";
import { site } from "@/config/site";
import { TrackingCapture } from "@/components/TrackingCapture";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TrackingCapture />
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-lg font-bold tracking-tight">
            <span className="text-brand">●</span> {site.brand.name}
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium sm:gap-6">
            <Link href="/#prozess" className="hidden text-slate-600 hover:text-slate-900 sm:inline">
              Prozess
            </Link>
            <Link href="/#faq" className="hidden text-slate-600 hover:text-slate-900 sm:inline">
              FAQ
            </Link>
            <Link href="/bewerben" className="text-slate-600 hover:text-slate-900">
              Karriere
            </Link>
            <Link href="/termin" className="rounded-lg bg-brand px-4 py-2 text-white hover:bg-brand-dark">
              Erstgespräch
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:justify-between">
          <p>
            © {new Date().getFullYear()} {site.legal.company}
          </p>
          <div className="flex gap-4">
            <Link href="/impressum" className="hover:text-slate-900">
              Impressum
            </Link>
            <Link href="/datenschutz" className="hover:text-slate-900">
              Datenschutz
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
