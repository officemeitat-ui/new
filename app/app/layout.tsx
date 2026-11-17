import type { Metadata, Viewport } from "next";
import { workspace } from "@/config/workspace";
import { ServiceWorkerRegister } from "@/components/workspace/Forms";
import { WorkspaceNav } from "@/components/workspace/Nav";
import { requireAdmin } from "@/lib/auth";
import { localDate } from "@/lib/calendar";
import { listTickets } from "@/lib/workspace/customers";
import { taskCounts } from "@/lib/workspace/tasks";

export const metadata: Metadata = {
  title: "Arbeitsplatz",
  robots: { index: false },
  appleWebApp: { capable: true, title: "Arbeitsplatz", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const today = localDate(new Date(), workspace.timeZone);
  const [counts, tickets] = await Promise.all([taskCounts(today), listTickets()]);
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <WorkspaceNav ticketsWaiting={tickets.filter((t) => t.waitingForUs).length} tasksDue={counts.today + counts.overdue} />
      <ServiceWorkerRegister />
      <main className="mx-auto max-w-5xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-32 md:ml-60 md:px-8 md:pt-8 md:pb-10 lg:ml-[max(15rem,calc(50vw-32rem))]">
        {children}
      </main>
    </div>
  );
}
