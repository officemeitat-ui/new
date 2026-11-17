import type { Metadata, Viewport } from "next";
import { workspace } from "@/config/workspace";

export const metadata: Metadata = { title: "Security Awareness", robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#0f172a" };

export default function LernenLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="bg-slate-900 text-white print:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6 text-emerald-400" aria-hidden>
            <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4" />
          </svg>
          <a href="/lernen" className="font-semibold">
            Security Awareness
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 print:max-w-none print:p-0">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-8 text-xs text-slate-400 print:hidden">Bereitgestellt von {workspace.company}</footer>
    </div>
  );
}
