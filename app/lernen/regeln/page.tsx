import Link from "next/link";
import { Poster } from "@/components/awareness/Poster";
import { PrintButtons } from "@/components/awareness/PrintButton";
import { learnerContext } from "@/lib/awareness/view";

export default async function RegelnPage() {
  const { fill } = await learnerContext();
  return (
    <div className="space-y-4">
      <PrintButtons />
      <div className="flex items-center justify-between print:hidden">
        <Link href="/lernen" className="text-sm text-slate-500 hover:text-slate-900">
          ← Übersicht
        </Link>
        <button type="button" data-print className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
          Drucken
        </button>
      </div>
      <Poster fill={fill} />
    </div>
  );
}
